import type { AgentAction, AgentName, AgentTurnResult, ItemType, Skill, WorldState, SimTime } from "./types.js";
import { ITEM_LABELS, SKILL_LABELS } from "./types.js";
import { callClaudeJSON } from "./llm.js";
import { emitSSE } from "./events.js";
import { readAgentProfile, readAgentMemory } from "./memory.js";
import { getInventoryQty, getReserved } from "./inventory.js";
import { getRelevantOrders, getAgentMarketplace } from "./marketplace.js";
import { getToolPerception } from "./tools-degradation.js";
import { bodyPerception } from "./body.js";
import { buildActionSchema, resolveAction, type ResolveContext } from "./tools.js";
import { tickToTime, SEASON_LABELS } from "./time.js";
import { HUB_LOCATION, TOWNHALL_LOCATION, isBaseLocation } from "./village-map.js";
import { RECIPES, MULTI_FARM_ITEMS } from "./production.js";
import { computeVillageConcerns } from "./village-concerns.js";
import { warPerceptionLines, isWarAgenda, isWarRelevant, villageName } from "./war.js";
import { getAgentNames, getDisplayName, getDescription, getCouncilMembers, getAgentVillage, getVillageAgents, getVillageLocations, getLocationType, getVillages, getVillageElder, getVillageTownHall, getRoads, isRoadLocation, getVillageForLocation, getAgentModel } from "./world-registry.js";

// ─── Agent descriptions for unknown acquaintances ────────────

/** How `observer` sees `agent`: full name + skill when known, otherwise the registry description. */
export function describeAgent(agent: AgentName, observer: AgentName, state: WorldState): string {
  const knows = state.acquaintances[observer]?.includes(agent);
  if (!knows) return `${getDescription(agent)} (unbekannt)`;

  const skill = state.economics[agent]?.skill;
  let label = (skill && skill !== "none")
    ? `${getDisplayName(agent)} (${SKILL_LABELS[skill] ?? skill})`
    : getDisplayName(agent);

  const theftRecords = state.caughtStealing?.[agent];
  if (theftRecords && theftRecords.length > 0) {
    const latest = theftRecords[theftRecords.length - 1]!;
    const fromName = getDisplayName(latest.from);
    const itemLabelText = ITEM_LABELS[latest.item as ItemType] ?? latest.item;
    label += ` (bekannter Dieb — beim Stehlen von ${itemLabelText} bei ${fromName} erwischt)`;
  }
  return label;
}

// ─── Hunger food hint ─────────────────────────────────────────

const EDIBLE_ITEMS = new Set<string>(["brot", "eintopf", "fleisch", "rueben", "eier", "milch"]);

/** German display label of an item id (agents see labels, tool args use ids). */
function itemLabel(item: string): string {
  return ITEM_LABELS[item as ItemType] ?? item;
}

/** German display label of a skill id. */
function skillLabel(skill: string): string {
  return SKILL_LABELS[skill as Skill] ?? skill;
}

const AGENDA_LABELS: Record<string, string> = {
  tax_change: "Zehnt",
  marketplace_hours: "Öffnungszeiten des Tauschbretts",
  banishment: "Karzerstrafe",
  general_rule: "Allgemeine Regel",
  grant_tools: "Werkzeugvergabe",
  curfew: "Sperrstunde",
  trade_restriction: "Handelsbeschränkung",
  repeal: "Aufhebung eines Beschlusses",
  declare_war: "Kriegserklärung",
  make_peace: "Frieden",
  pay_tribute: "Tribut",
};

/** One-line hint for the council on how to handle a war agenda (appended to the discussion prompt). */
function warAgendaHint(type: string, targetVillage: string | undefined): string {
  if (!isWarAgenda(type) || !targetVillage) return "";
  const t = villageName(targetVillage);
  if (type === "declare_war") return `\nEs geht um Krieg gegen ${t}. Wägt ab: Wer kämpft, wer wacht, was kostet uns ein Krieg? Ein Beschluss (propose_rule, z. B. „Krieg gegen ${t}“) erklärt ihn.`;
  if (type === "make_peace") return `\nEs geht um Frieden mit ${t}. Stimmt der Rat zu, wird Frieden geschlossen (oder ${t} muss noch zustimmen). Schlag z. B. „Frieden mit ${t}“ vor.`;
  return `\nEs geht um Tribut an ${t}. Nenne mit propose_rule einen Betrag (value, in Groschen); er wird von den Wohlhabenden eingezogen und beendet einen Krieg.`;
}

function seasonDayLine(time: SimTime): string {
  return `${SEASON_LABELS[time.season]}, Tag ${time.seasonDay}/7`;
}

/** "A ist hier." / "A, B sind hier." */
function othersHereLine(others: string[], where: "here" | "road"): string {
  if (others.length === 0) return where === "road" ? "Du bist allein auf der Straße." : "Du bist hier allein.";
  const suffix = where === "road" ? "auf der Straße" : "hier";
  return `${others.join(", ")} ${others.length === 1 ? "ist" : "sind"} ${suffix}.`;
}


function getHungryNoFoodHint(agent: AgentName, state: WorldState): string {
  const body = state.body[agent];
  if (body.hunger < 2) return "";

  const eco = state.economics[agent];
  const hasFood = eco.inventory.items.some(
    i => EDIBLE_ITEMS.has(i.type) && (i.quantity - (i.reserved ?? 0)) > 0
  );
  if (hasFood) return "";

  return "(Du hast kein Essen im Inventar.)";
}

// ─── Location keeper note ─────────────────────────────────────

const SPECIALIST_SKILLS = new Set<string>(["mueller", "baecker", "wirt", "schmied", "zimmermann", "bader", "naeherin"]);

function getLocationKeeperNote(agent: AgentName, state: WorldState): string {
  const location = state.agent_locations[agent];
  for (const a of getAgentNames()) {
    if (a === agent) continue;
    const aEco = state.economics[a];
    if (aEco.workLocation !== location) continue;
    if (!SPECIALIST_SKILLS.has(aEco.skill)) continue;
    // This is a specialist's work location
    if (state.agent_locations[a] !== location) {
      const keeperName = getDisplayName(a);
      const keeperLoc = state.agent_locations[a];
      return `(Hier ist der Arbeitsplatz von ${keeperName}: ${location}. ${keeperName} ist gerade in ${keeperLoc}. Schick ${keeperName} per send_message eine Nachricht, um einen Kauf zu verabreden, oder schau aufs Tauschbrett auf dem ${HUB_LOCATION}.)`;
    }
    return ""; // Keeper is present — already listed in "Others here"
  }
  return "";
}

// ─── Loan perception ──────────────────────────────────────────

function getLoanPerception(agent: AgentName, state: WorldState): string {
  if (!state.loans || state.loans.length === 0) return "";

  const activeLoans = state.loans.filter(l => !l.repaid);
  const owed = activeLoans.filter(l => l.creditor === agent);
  const owes = activeLoans.filter(l => l.debtor === agent);

  if (owed.length === 0 && owes.length === 0) return "";

  const parts: string[] = [];
  for (const loan of owed) {
    const dueDay = Math.ceil(loan.dueTick / 16);
    parts.push(`${getDisplayName(loan.debtor)} schuldet dir ${loan.amount} Groschen (fällig an Tag ${dueDay}).`);
  }
  for (const loan of owes) {
    const dueDay = Math.ceil(loan.dueTick / 16);
    parts.push(`Du schuldest ${getDisplayName(loan.creditor)} ${loan.amount} Groschen (fällig an Tag ${dueDay}).`);
  }

  return `\nDarlehen: ${parts.join(" ")}`;
}

// ─── Governance helpers ──────────────────────────────────

function getVillageLaws(state: WorldState, time: SimTime): string {
  // War agendas are events, not standing rules: the war lines carry them.
  const laws = (state.active_laws ?? []).filter(l => !isWarAgenda(l.type));
  if (laws.length === 0) return "";
  const lines = laws.map(law => {
    const day = Math.ceil(law.passedTick / 16);
    if (law.type === "tax_change") return `- Zehnt: ${Math.round((law.value ?? 0.1) * 100)} % (beschlossen an Tag ${day})`;
    if (law.type === "banishment" && law.target) {
      const untilTick = state.banned?.[law.target] ?? (law.passedTick + 32);
      const untilDay = Math.ceil(untilTick / 16);
      return `- ${getDisplayName(law.target ?? "")}: Karzerstrafe bis Tag ${untilDay}`;
    }
    if (law.type === "grant_tools" && law.grantedTo && law.grantedTools) {
      return `- ${getDisplayName(law.grantedTo)} erhält [${law.grantedTools.map(itemLabel).join(", ")}] (${law.id}, beschlossen an Tag ${day})`;
    }
    if (law.type === "curfew" && law.value != null) {
      return `- Sperrstunde: um ${String(6 + law.value).padStart(2, "0")}:00 zu Hause sein (${law.id}, beschlossen an Tag ${day})`;
    }
    if (law.type === "trade_restriction") {
      return `- Handelsbeschränkung: ${law.description} (${law.id}, beschlossen an Tag ${day})`;
    }
    return `- ${law.description} (${law.id}, beschlossen an Tag ${day})`;
  });

  // Show recent violations (last 16 ticks) to elder
  const recentViolations = (state.violations_log ?? [])
    .filter(v => time.tick - v.tick <= 16)
    .slice(-5);
  if (recentViolations.length > 0) {
    lines.push("Letzte Verstöße:");
    for (const v of recentViolations) {
      lines.push(`  ${getDisplayName(v.agent)}: ${v.action}${v.blocked ? " (verhindert)" : ""}`);
    }
  }

  return `\nRatsbeschlüsse:\n${lines.join("\n")}`;
}

function getMeetingContext(agent: AgentName, state: WorldState, time: SimTime): string {
  const vid = getAgentVillage(agent);
  const mtg = state.pending_meetings[vid];
  if (!mtg) return "";
  if (time.tick < mtg.scheduledTick) {
    const townHall = getVillageTownHall(vid);
    const meetingTime = tickToTime(mtg.scheduledTick);
    return `\n(Appell: "${mtg.description}" in ${townHall} am ${meetingTime.timeLabel}. Sei dabei.)`;
  }
  return "";
}

// ─── Perception builder ──────────────────────────────────────

function buildInventoryLines(agent: AgentName, state: WorldState): string {
  const eco = state.economics[agent];
  const lines = eco.inventory.items
    .filter(i => i.quantity > 0)
    .map(i => {
      const reserved = i.reserved ?? 0;
      const reservedNote = reserved > 0 ? ` (${reserved} reserviert — wird bei Kauf übergeben)` : "";
      const spoilNote = i.spoilsAtTick && i.spoilsAtTick - state.current_tick < 32 ? " [verdirbt bald]" : "";
      return `${itemLabel(i.type)} ×${i.quantity}${reservedNote}${spoilNote}`;
    });
  return lines.length > 0 ? lines.join(", ") : "leer";
}

function buildMarketboardLines(agent: AgentName, state: WorldState): string {
  const orders = getRelevantOrders(agent, state);
  if (orders.length === 0) return "  (keine aktuellen Angebote)";
  return orders
    .map(o => o.type === "sell"
      ? `  BIETE: ${itemLabel(o.item)} ×${o.quantity} für ${o.price} Groschen (von ${getDisplayName(o.agentId) || o.agentId}, läuft ab in ${o.expiresAtTick - state.current_tick} Stunden)`
      : `  SUCHE: ${itemLabel(o.item)} ×${o.quantity}, zahlt bis zu ${o.price} Groschen (${getDisplayName(o.agentId) || o.agentId})`
    )
    .join("\n");
}

/** What `agent` can produce at their current location (same data the "Hier kannst du herstellen" block lists). */
export interface ProducibleHere {
  item: string;
  label: string;
  /** Output summary, e.g. "3 Eisenerz". */
  output: string;
  ready: boolean;
  /** Why it is not ready (German, without brackets); set when `ready` is false. */
  reason?: string;
}

export function getProducibleHere(agent: AgentName, state: WorldState): ProducibleHere[] {
  const eco = state.economics[agent];
  const location = state.agent_locations[agent];
  const result: ProducibleHere[] = [];

  for (const [itemKey, recipe] of Object.entries(RECIPES)) {
    if (recipe.skill !== eco.skill) continue;
    const validLocations = MULTI_FARM_ITEMS[itemKey] ?? [recipe.location];
    if (!validLocations.includes(location)) continue;

    const output = Object.entries(recipe.output).map(([k, v]) => `${v} ${itemLabel(k)}`).join(", ");
    const base = { item: itemKey, label: itemLabel(itemKey), output };

    if (recipe.tool && (!eco.tool || eco.tool.durability <= 0)) {
      result.push({ ...base, ready: false, reason: "braucht Werkzeug — deins ist kaputt oder fehlt" });
      continue;
    }

    const missing: string[] = [];
    for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
      const have = getInventoryQty(eco.inventory, inputItem as ItemType);
      if (have < qty) missing.push(`${itemLabel(inputItem)} (brauchst ${qty}, hast ${have})`);
    }

    result.push(missing.length === 0
      ? { ...base, ready: true }
      : { ...base, ready: false, reason: `fehlt: ${missing.join(", ")}` });
  }
  return result;
}

function getProducibleBlock(agent: AgentName, state: WorldState): string {
  const lines = getProducibleHere(agent, state).map(p =>
    `- produce "${p.item}" → ${p.output} [${p.ready ? "jetzt möglich" : p.reason}]`);
  if (lines.length === 0) return "";
  return `\nHier kannst du herstellen:\n${lines.join("\n")}`;
}

// ─── Village directory (common knowledge) ────────────────────

function getVillageDirectory(agent: AgentName, state: WorldState): string {
  const villageId = getAgentVillage(agent);
  const villagers = getVillageAgents(villageId);
  const lines: string[] = [];

  for (const a of villagers) {
    if (a === agent) continue;
    const eco = state.economics[a];
    if (!eco?.skill || eco.skill === "none") continue;
    // Registry description carries grammatical gender ("die Müllerin"); skill labels are masculine only.
    lines.push(`${getDisplayName(a)} (${getDescription(a)}) — ${eco.workLocation}`);
  }

  if (lines.length === 0) return "";
  return `\nHandwerker der Kolonie:\n${lines.join("\n")}`;
}

// ─── Travel hint block ────────────────────────────────────────

function buildTravelBlock(agent: AgentName, state: WorldState): string {
  const villages = getVillages();
  if (villages.length <= 1) return "";

  const loc = state.agent_locations[agent];
  const roads = getRoads();
  const onRoad = isRoadLocation(loc);

  if (onRoad) {
    const road = roads.find(r => r.name === loc);
    if (!road) return "";
    const lines = road.connectsVillages.map(vid => {
      const v = villages.find(v => v.id === vid);
      const vName = v?.name ?? vid;
      const vSquare = v?.locations.find(l => isBaseLocation(l, HUB_LOCATION)) ?? v?.locations[0] ?? vid;
      return `  Gehe nach ${vName}: move_to "${vSquare}"`;
    });
    return `Reiseziele (wähle eine Richtung):\n${lines.join("\n")}`;
  }

  const currentVid = getVillageForLocation(loc) ?? getAgentVillage(agent);
  const reachableRoads = roads.filter(r => r.connectsVillages.includes(currentVid));
  if (reachableRoads.length === 0) return "";

  const lines = reachableRoads.map(road => {
    const destVid = road.connectsVillages.find(v => v !== currentVid) ?? "";
    const destName = villages.find(v => v.id === destVid)?.name ?? destVid;
    return `  Reise nach ${destName}: move_to "${road.name}" (${road.transitTicks} Stunden Reise, kostet 1 Hunger)`;
  });
  return `Reise:\n${lines.join("\n")}`;
}

const RULE_LINE = `REGEL: Reden bewegt NIE Waren oder Geld. Nur post_order und buy_item lösen echte Übergaben aus. "Hier sind 4 Groschen" zu sagen bewirkt nichts.`;

// ─── Road perception (minimal — no marketplace, no production) ─

function buildRoadPerception(
  agent: AgentName,
  state: WorldState,
  time: SimTime,
  otherAgentsPresent: string[],
  pendingMessages: string,
  conversationSoFar: string,
): string {
  const eco = state.economics[agent];
  const body = state.body[agent];
  const location = state.agent_locations[agent];
  const feedback = (state.action_feedback[agent] ?? []).join("\n");
  const bodyNote = bodyPerception(body);
  const inventoryLines = buildInventoryLines(agent, state);

  const road = getRoads().find(r => r.name === location);
  const [v1id, v2id] = road?.connectsVillages ?? [];
  const v1Name = getVillages().find(v => v.id === v1id)?.name ?? v1id ?? "?";
  const v2Name = getVillages().find(v => v.id === v2id)?.name ?? v2id ?? "?";

  const othersStr = othersHereLine(otherAgentsPresent, "road");

  return `${RULE_LINE}

Du bist ${getDisplayName(agent)}.
Ort: ${location}. ${time.timeLabel}. ${seasonDayLine(time)}.
Wetter: ${state.weather}

Du bist zwischen ${v1Name} und ${v2Name} unterwegs. Du erreichst dein Ziel in der nächsten Stunde.

${othersStr}
${bodyNote ? bodyNote + "\n" : ""}
Inventar: ${inventoryLines}
Geldbeutel: ${eco.wallet} Groschen

${pendingMessages ? `Nachrichten:\n${pendingMessages}\n` : ""}${feedback ? `Rückmeldung der letzten Stunde:\n${feedback}\n` : ""}${conversationSoFar ? `\nGespräch bisher:\n${conversationSoFar}\n` : ""}`.trim();
}

// ─── Full perception ──────────────────────────────────────────

export function buildPerception(
  agent: AgentName,
  state: WorldState,
  time: SimTime,
  conversationSoFar: string,
  otherAgentsPresent: string[],
  pendingMessages: string,
  sounds: string[],
): string {
  const eco = state.economics[agent];
  const body = state.body[agent];
  const location = state.agent_locations[agent];

  // Road agents get a stripped-down perception with no marketplace/production context
  if (isRoadLocation(location)) {
    return buildRoadPerception(agent, state, time, otherAgentsPresent, pendingMessages, conversationSoFar);
  }

  const bodyNote = bodyPerception(body);
  const hungryHint = getHungryNoFoodHint(agent, state);
  const keeperNote = getLocationKeeperNote(agent, state);
  const loanPerception = getLoanPerception(agent, state);
  const inventoryLines = buildInventoryLines(agent, state);
  const toolLine = getToolPerception(agent, state);
  const producibleBlock = getProducibleBlock(agent, state);
  const villageDirectory = getVillageDirectory(agent, state);
  const marketboardLines = buildMarketboardLines(agent, state);

  const agentOrders = getAgentMarketplace(agent, state).orders.filter(o => o.agentId === agent);
  const activeOrdersBlock = agentOrders.length > 0
    ? `\nDeine aktiven Angebote:\n${agentOrders.map(o =>
        `${o.type === "sell" ? "BIETE" : "SUCHE"} ${itemLabel(o.item)} x${o.quantity} für je ${o.price} Groschen (id: ${o.id}, läuft ab in ${o.expiresAtTick - time.tick} Stunden)`
      ).join("\n")}`
    : "";

  const othersStr = othersHereLine(otherAgentsPresent, "here");

  const soundsStr = sounds.length > 0
    ? `Geräusche: ${sounds.join(" ")}`
    : "";

  const hiredNote = eco.hiredBy
    ? `\nDu bist heute von ${getDisplayName(eco.hiredBy)} angeheuert.`
    : "";

  const laborerNote = (() => {
    for (const a of getAgentNames()) {
      if (state.economics[a].hiredBy === agent) {
        return `\n${getDisplayName(a)} arbeitet heute für dich.`;
      }
    }
    return "";
  })();

  const feedback = (state.action_feedback[agent] ?? []).join("\n");

  const activeEvents = state.active_events.length > 0
    ? `\nEreignisse in der Kolonie: ${state.active_events.map(e => e.description).join("; ")}`
    : "";
  const lawsBlock = getVillageLaws(state, time);
  const meetingCtx = getMeetingContext(agent, state, time);
  const warLines = warPerceptionLines(state, agent);
  const warBlock = warLines.length > 0 ? "\n" + warLines.join("\n") : "";

  const villageConcernsBlock = agent === getVillageElder(getAgentVillage(agent))
    ? (() => {
        const concerns = computeVillageConcerns(state, time.tick);
        return concerns.length > 0 ? "\n" + concerns.join("\n") : "";
      })()
    : "";

  return `${RULE_LINE}

Du bist ${getDisplayName(agent)}.
Ort: ${location}. ${time.timeLabel}. ${seasonDayLine(time)}.
Wetter: ${state.weather}${activeEvents}${lawsBlock}${meetingCtx}${villageConcernsBlock}${warBlock}

${othersStr}${soundsStr ? "\n" + soundsStr : ""}${keeperNote ? "\n" + keeperNote : ""}
${bodyNote ? bodyNote + "\n" : ""}${hungryHint ? hungryHint + "\n" : ""}
Inventar: ${inventoryLines}
Geldbeutel: ${eco.wallet} Groschen${loanPerception}
Werkzeug: ${toolLine}${hiredNote}${laborerNote}${producibleBlock}${activeOrdersBlock}${villageDirectory}

Tauschbrett:
${marketboardLines}

${pendingMessages ? `Nachrichten:\n${pendingMessages}\n` : ""}${feedback ? `Rückmeldung der letzten Stunde:\n${feedback}\n` : ""}${conversationSoFar ? `\nGespräch bisher:\n${conversationSoFar}\n` : ""}`.trim();
}

export function buildMeetingPerception(
  agent: AgentName,
  state: WorldState,
  time: SimTime,
  conversationSoFar: string,
  othersPresent: string[],
  meetingPhase: "discussion" | "vote",
  proposal?: string,
): string {
  const vid = getAgentVillage(agent);
  const mtg = state.pending_meetings[vid]!;
  const eco = state.economics[agent];
  const body = state.body[agent];
  const feedback = (state.action_feedback[agent] ?? []).join("\n");
  const lawsBlock = getVillageLaws(state, time);

  const othersStr = othersPresent.length > 0
    ? `Anwesend: ${othersPresent.join(", ")}.`
    : "Du bist hier allein.";

  const councilNote = getCouncilMembers(vid).includes(agent)
    ? `\nDu hast einen Sitz im Rat der Rottmeister. Dieser Appell gehört zu deinen Pflichten als Ratsmitglied.`
    : "";

  const agendaLabel = (AGENDA_LABELS[mtg.agendaType] ?? mtg.agendaType.replace("_", " "))
    + (mtg.targetVillage ? ` — ${villageName(mtg.targetVillage)}` : "");
  const warLines = warPerceptionLines(state, agent);
  const warBlock = warLines.length > 0 ? `\n${warLines.join("\n")}` : "";
  const warHint = warAgendaHint(mtg.agendaType, mtg.targetVillage);
  const phaseNote = meetingPhase === "discussion"
    ? `\n=== APPELL — AUSSPRACHE ===\nTagesordnung: "${mtg.description}" (${agendaLabel})${warHint}\nSag, was du denkst. Hast du einen konkreten Vorschlag, nutze propose_rule mit einem genauen Text (und value, wenn es eine Zahl ist, z. B. Zehnt 0.15). Du kannst auch einfach sprechen (speak) oder nachdenken (think).`
    : `\n=== APPELL — ABSTIMMUNG ===\nVorschlag auf dem Tisch: "${proposal ?? "(kein konkreter Beschluss vorgeschlagen)"}"\nNutze die Aktion vote mit side "agree" oder "disagree". Sprich vorher, wenn du willst.`;

  return `Du bist ${getDisplayName(agent)}.
Ort: ${TOWNHALL_LOCATION}. ${time.timeLabel}. ${seasonDayLine(time)}.
Wetter: ${state.weather}${lawsBlock}${warBlock}

${othersStr}${councilNote}
${body.hunger > 1 ? `Hunger: ${body.hunger}/5.` : ""}
Geldbeutel: ${eco.wallet} Groschen
${feedback ? `Rückmeldung der letzten Stunde:\n${feedback}\n` : ""}${conversationSoFar ? `\nGespräch bisher:\n${conversationSoFar}\n` : ""}${phaseNote}`.trim();
}

// ─── Prompt builder ───────────────────────────────────────────

function buildPrompt(agent: AgentName, perception: string, actionSchema: string, state: WorldState): string {
  const name = getDisplayName(agent);
  const profile = readAgentProfile(agent);
  const memory = readAgentMemory(agent);

  // Use current physical village, not home village
  const currentLoc = state.agent_locations[agent];
  const onRoad = isRoadLocation(currentLoc);
  const currentVillageId = onRoad
    ? getAgentVillage(agent)
    : (getVillageForLocation(currentLoc) ?? getAgentVillage(agent));

  const villageName = getVillages().find(v => v.id === currentVillageId)?.name ?? "";
  const displayLocs = onRoad ? [] : getVillageLocations(currentVillageId).map(loc =>
    villageName && loc.startsWith(`${villageName}:`) ? loc.slice(villageName.length + 1) : loc
  );
  const locationsLine = displayLocs.length > 0 ? `Orte in der Kolonie: ${displayLocs.join(", ")}` : "";

  const travelBlock = buildTravelBlock(agent, state);

  return `Du bist ${name}.

${profile}
${locationsLine ? "\n" + locationsLine : ""}
${memory}

---

${perception}
${travelBlock ? "\n" + travelBlock + "\n" : ""}
${actionSchema}`;
}

// ─── Run single agent turn ────────────────────────────────────

export async function runAgentTurn(
  agent: AgentName,
  perception: string,
  context: ResolveContext,
): Promise<AgentTurnResult> {
  const model = getAgentModel(agent);
  const hasConcerns = computeVillageConcerns(context.state, context.time.tick).length > 0;
  const agentVid = getAgentVillage(agent);
  const atMeeting = context.agentLocation === getVillageTownHall(agentVid) && !!context.state.pending_meetings[agentVid];
  const prompt = buildPrompt(agent, perception, buildActionSchema(agent, hasConcerns, atMeeting, isWarRelevant(context.state, agent)), context.state);
  const name = getDisplayName(agent);

  // Emit "agent is thinking" to frontend
  emitSSE("agent:thinking", { agent, name });

  let response: { actions: AgentAction[] };
  try {
    response = await callClaudeJSON<{ actions: AgentAction[] }>(prompt, {
      model,
      onChunk: (chunk) => {
        emitSSE("agent:stream", { agent, name, chunk });
      },
    });
  } catch (err) {
    emitSSE("agent:stream", { agent, name, chunk: "" });
    console.error(`  LLM error for ${agent}: ${err}. Defaulting to wait.`);
    return { agent, actions: [{ type: "wait", result: "", visible: false }], pendingMove: undefined };
  }
  emitSSE("agent:stream", { agent, name, chunk: "" });  // signal stream done

  const KNOWN_ACTION_TYPES = new Set([
    "speak", "think", "wait", "move_to", "produce", "buy_item", "post_order",
    "cancel_order", "give_item", "hire", "loan_request", "loan_repay",
    "steal", "vote", "call_meeting", "petition_meeting", "dismiss", "craft",
    "eat", "propose_rule", "propose_repeal", "ueberfallen", "wache_halten",
  ]);
  const actions = (response.actions || []).map(action => {
    let sanitized = action;
    if (!action.type) {
      sanitized = { ...action, type: "think" as const };
    } else if (!KNOWN_ACTION_TYPES.has(action.type)) {
      sanitized = { type: "think" as const, text: action.text ?? String(action.type) };
    }
    return resolveAction(sanitized, context);
  });
  if (actions.length === 0) actions.push(resolveAction({ type: "wait" }, context));

  // One-line terminal summary per agent (collected after resolution, no interleaving)
  const summary = actions
    .filter(a => a.type !== "think" && a.type !== "wait")
    .map(a => a.type === "move_to" ? `→${a.location}` : a.type)
    .join(", ") || "wait";
  console.log(`  ✦ ${name}: ${summary}`);

  // Emit move actions immediately so the map animates in real-time
  for (const action of actions) {
    if (action.type === "move_to" && action.visible && action.result) {
      emitSSE("agent:action", { agent, name, actionType: action.type, text: action.text, result: action.result, location: action.location });
    }
  }

  const pendingMove = actions.find(a => a.type === "move_to" && a.visible)?.location;
  return { agent, actions, pendingMove };
}

// ─── Batched parallel execution ────────────────────────────────

export async function runBatchedAgents(
  agents: AgentName[],
  perceptions: Record<AgentName, string>,
  state: WorldState,
  time: SimTime,
  batchSize = 5,
  movedThisTick?: Set<AgentName>,
): Promise<AgentTurnResult[]> {
  const results: AgentTurnResult[] = [];

  for (let i = 0; i < agents.length; i += batchSize) {
    const batch = agents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(agent => {
        const context: ResolveContext = {
          agent,
          agentLocation: state.agent_locations[agent],
          state,
          time,
          movedThisTick,
        };
        return runAgentTurn(agent, perceptions[agent]!, context);
      })
    );
    results.push(...batchResults);
  }

  return results;
}
