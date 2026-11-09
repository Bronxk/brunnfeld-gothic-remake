/**
 * War / diplomacy between settlements.
 *
 * Pure-ish functions on WorldState (plus feedback notices and SSE events). Everything that moves
 * goods or Groschen only moves them (totals are conserved). Randomness is injectable (`rng`) so
 * tests are deterministic. All state fields are optional and initialised lazily (old saves load).
 *
 * In-world text is German; code and comments are English.
 */

import type {
  AgendaType, AgentName, BodyState, ItemType, Marketplace, Stance, VillageRelation, WarEvent, WorldState,
} from "./types.js";
import { ALL_ITEMS } from "./types.js";
import { normalizeKey } from "./village-map.js";
import {
  getVillages, getVillageMembers, getVillageElder, getVillageTownHall, getAgentVillage,
  getVillageForLocation, isRoadLocation, getDisplayName, PLAYER_ID,
} from "./world-registry.js";
import { addToInventory, removeFromInventory, unreserveInventory, getInventoryQty, feedbackToAgent, itemLabel } from "./inventory.js";
import { isAgentDead } from "./body.js";
import { ticksPerDay } from "./time.js";
import { emitSSE } from "./events.js";

export type Rng = () => number;

export type WarResult =
  | { ok: true; relation: VillageRelation; event?: WarEvent }
  | { ok: false; error: string };

// ─── Constants ───────────────────────────────────────────────

export const PROVOKE_KINDS = [
  { id: "grenzstreit", label: "Grenzstreit" },
  { id: "diebstahl", label: "Diebstahl" },
  { id: "beleidigung", label: "Beleidigung" },
  { id: "geruecht", label: "Gerücht" },
] as const;
export type ProvokeKind = typeof PROVOKE_KINDS[number]["id"];

const WAR_LOG_CAP = 200;
const TRUCE_TICKS = 24;
const RAID_LOOT_CAP = 60;
const RAID_ITEM_SHARE = 0.2;
const RAID_WALLET_SHARE = 0.15;
const PEACE_OFFER_TTL = 32;
const DEFAULT_TRIBUTE = 20;
const MAX_TRIBUTE = 200;
/** Weapon-like items, used only if such an item exists in the item list (currently none does). */
const WEAPON_ITEMS: ItemType[] = (["waffe", "schwert", "knueppel", "speer"] as string[])
  .filter(i => (ALL_ITEMS as string[]).includes(i)) as ItemType[];

export const WAR_AGENDAS: readonly AgendaType[] = ["declare_war", "make_peace", "pay_tribute"];
export function isWarAgenda(t: string): boolean {
  return (WAR_AGENDAS as readonly string[]).includes(t);
}

// ─── Village helpers ─────────────────────────────────────────

export function villageName(id: string): string {
  return getVillages().find(v => v.id === id)?.name ?? id;
}

/** Resolve a village id or name typed by an LLM/human (case/umlaut-insensitive); null if unknown. */
export function resolveVillageId(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const key = normalizeKey(input);
  const vs = getVillages();
  const hit = vs.find(v => normalizeKey(v.id) === key || normalizeKey(v.name) === key);
  return hit?.id ?? null;
}

/** Village whose territory the location belongs to; roads belong to nobody. */
export function locationVillage(loc: string | undefined): string | undefined {
  if (!loc || isRoadLocation(loc)) return undefined;
  return getVillageForLocation(loc);
}

function homeVillage(state: WorldState, agent: AgentName): string {
  return state.economics[agent]?.villageId ?? getAgentVillage(agent);
}

function dayOf(tick: number): number {
  return Math.max(1, Math.ceil(tick / ticksPerDay()));
}

function notifyVillage(state: WorldState, vid: string, text: string): void {
  for (const a of getVillageMembers(vid)) feedbackToAgent(a, state, text);
}

function isFighter(state: WorldState, agent: AgentName): boolean {
  const body = state.body[agent];
  if (!body || !state.economics[agent]) return false;
  if (isAgentDead(body)) return false;
  if (body.energy <= 0) return false;                 // too exhausted to fight
  if (state.banned?.[agent] != null) return false;    // locked up in the Karzer
  return true;
}

function pick<T>(list: T[], rng: Rng): T | undefined {
  if (list.length === 0) return undefined;
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

// ─── Relations ───────────────────────────────────────────────

export function relationKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function defaultRelation(a: string, b: string): VillageRelation {
  const [x, y] = a < b ? [a, b] : [b, a];
  return { a: x, b: y, stance: "frieden", tension: 0, since: 0, raidsWon: {} };
}

/** Read-only lookup; undefined if the pair never had contact. */
export function peekRelation(state: WorldState, a: string, b: string): VillageRelation | undefined {
  return state.diplomacy?.[relationKey(a, b)];
}

/** Relation without mutating the state (default if none stored). */
export function relationOrDefault(state: WorldState, a: string, b: string): VillageRelation {
  return peekRelation(state, a, b) ?? defaultRelation(a, b);
}

/** Relation for a pair; creates a default frieden/0 relation on first read. */
export function getRelation(state: WorldState, a: string, b: string): VillageRelation {
  state.diplomacy ??= {};
  const key = relationKey(a, b);
  let rel = state.diplomacy[key];
  if (!rel) {
    rel = defaultRelation(a, b);
    state.diplomacy[key] = rel;
  }
  rel.raidsWon ??= {};
  return rel;
}

function otherOf(rel: VillageRelation, vid: string): string {
  return rel.a === vid ? rel.b : rel.a;
}

function emitRelation(rel: VillageRelation): void {
  emitSSE("war:update", rel);
}

function pushLog(state: WorldState, ev: WarEvent): WarEvent {
  state.war_log ??= [];
  state.war_log.push(ev);
  while (state.war_log.length > WAR_LOG_CAP) state.war_log.shift();
  emitSSE("war:event", ev);
  return ev;
}

function setStance(rel: VillageRelation, stance: Stance, tick: number): void {
  if (rel.stance !== stance) {
    rel.stance = stance;
    rel.since = tick;
  }
}

function checkVillages(a: string, b: string): string | null {
  const ids = new Set(getVillages().map(v => v.id));
  if (!ids.has(a) || !ids.has(b)) return "Unbekannte Siedlung.";
  if (a === b) return "Eine Siedlung kann nicht gegen sich selbst vorgehen.";
  return null;
}

// ─── Auto-scheduled councils ─────────────────────────────────

/**
 * Schedule a council meeting in `vid` unless a specific agenda is already pending
 * (the regular `general_rule` Appell is replaced). Returns true if scheduled.
 */
function scheduleMeeting(
  state: WorldState, tick: number, vid: string,
  agendaType: AgendaType, description: string, targetVillage: string, delay = 3,
): boolean {
  const existing = state.pending_meetings[vid];
  if (existing && !(existing.agendaType === "general_rule" && existing.scheduledTick > tick)) return false;
  if (!getVillageElder(vid)) return false;
  state.pending_meetings[vid] = {
    villageId: vid,
    scheduledTick: tick + delay,
    agendaType,
    description,
    targetVillage,
    calledAtTick: tick,
  };
  notifyVillage(state, vid,
    `Ein Appell wurde einberufen: „${description}". Treffpunkt: ${getVillageTownHall(vid)}, in ${delay} Stunden. Komm hin und stimm mit ab.`);
  return true;
}

// ─── Provocation ─────────────────────────────────────────────

interface ProvokeText { victim: string; provoker: string; label: string }

function provokeTexts(kind: ProvokeKind, fromName: string, toName: string, theft?: string): ProvokeText {
  switch (kind) {
    case "grenzstreit":
      return {
        label: "Grenzstreit",
        victim: `Leute aus ${fromName} sollen Grenzsteine versetzt und Vieh auf eure Weiden getrieben haben. Im Stollen wird schon über Vergeltung geflüstert.`,
        provoker: `Bei uns heißt es, die Grenze zu ${toName} gehöre eigentlich uns — ein paar Männer haben schon die Steine versetzt.`,
      };
    case "diebstahl":
      return {
        label: "Diebstahl",
        victim: `Leute aus ${fromName} sollen bei uns eingebrochen sein${theft ? ` und ${theft} mitgenommen haben` : ""}. Die Schlösser rasseln, die Gesichter werden hart.`,
        provoker: `Ein paar von uns haben nachts bei ${toName} zugegriffen${theft ? `: ${theft}` : ""}. Man prahlt damit in der Schenke.`,
      };
    case "beleidigung":
      return {
        label: "Beleidigung",
        victim: `Leute aus ${fromName} sollen über uns gelästert haben: Bei uns hausten nur Ratten und Verlierer. Das Wort macht die Runde.`,
        provoker: `Bei uns wird über ${toName} gespottet, dass sich die Balken biegen. Wer weiß, wer das dort hört.`,
      };
    case "geruecht":
      return {
        label: "Gerücht",
        victim: `Aus ${fromName} kommt das Gerücht, wir horteten heimlich Erz und Vorräte. Mancher glaubt es schon.`,
        provoker: `Wir haben das Gerücht in Umlauf gebracht, ${toName} horte heimlich Erz und Vorräte. Es wirkt.`,
      };
  }
}

/** Move a small bit of goods or Groschen from the victim village to a random member of the provoker. */
function stealForProvocation(
  state: WorldState, from: string, to: string, rng: Rng,
): { groschen: number; items: Record<string, number>; text: string } | null {
  const thieves = getVillageMembers(from).filter(a => a !== PLAYER_ID && state.economics[a]);
  const victims = getVillageMembers(to).filter(a => a !== PLAYER_ID && state.economics[a]);
  const thief = pick(thieves, rng);
  if (!thief || victims.length === 0) return null;

  const tryGroschen = (): { groschen: number; items: Record<string, number>; text: string } | null => {
    const rich = victims.filter(v => (state.economics[v]!.wallet ?? 0) > 0);
    const victim = pick(rich, rng);
    if (!victim) return null;
    const amount = Math.min(state.economics[victim]!.wallet, 3 + Math.floor(rng() * 6));
    state.economics[victim]!.wallet -= amount;
    state.economics[thief]!.wallet += amount;
    return { groschen: amount, items: {}, text: `${amount} Groschen` };
  };
  const tryGoods = (): { groschen: number; items: Record<string, number>; text: string } | null => {
    const stocked = victims.filter(v => state.economics[v]!.inventory.items.some(i => getInventoryQty(state.economics[v]!.inventory, i.type) > 0));
    const victim = pick(stocked, rng);
    if (!victim) return null;
    const inv = state.economics[victim]!.inventory;
    const entry = pick(inv.items.filter(i => getInventoryQty(inv, i.type) > 0), rng)!;
    const qty = Math.min(getInventoryQty(inv, entry.type), 1 + Math.floor(rng() * 2));
    removeFromInventory(inv, entry.type, qty);
    addToInventory(state.economics[thief]!.inventory, entry.type, qty, state.current_tick);
    return { groschen: 0, items: { [entry.type]: qty }, text: `${qty}× ${itemLabel(entry.type)}` };
  };

  return rng() < 0.5 ? (tryGroschen() ?? tryGoods()) : (tryGoods() ?? tryGroschen());
}

/**
 * `from` provokes `to` (e.g. the human observer stirs up trouble). Raises tension by 20–35,
 * notifies both villages and may escalate: >= 60 spannung, >= 85 an auto-scheduled council in
 * the victim village with agenda declare_war against the provoker.
 */
export function provoke(
  state: WorldState, tick: number, from: string, to: string, kind: string, rng: Rng = Math.random,
): WarResult {
  const bad = checkVillages(from, to);
  if (bad) return { ok: false, error: bad };
  if (!PROVOKE_KINDS.some(k => k.id === kind)) {
    return { ok: false, error: `Unbekannte Art der Provokation: ${kind}. Möglich: ${PROVOKE_KINDS.map(k => k.id).join(", ")}.` };
  }
  const k = kind as ProvokeKind;
  const rel = getRelation(state, from, to);
  const fromName = villageName(from);
  const toName = villageName(to);

  const loot = k === "diebstahl" ? stealForProvocation(state, from, to, rng) : null;
  const texts = provokeTexts(k, fromName, toName, loot?.text);

  rel.tension = Math.min(100, rel.tension + 20 + Math.floor(rng() * 16));
  notifyVillage(state, to, texts.victim);
  notifyVillage(state, from, texts.provoker);

  const ev: WarEvent = {
    tick, kind: "provocation", villages: [from, to],
    text: `${texts.label}: ${fromName} → ${toName}. ${texts.victim}`,
    actor: from, detail: k,
    ...(loot ? { loot: { groschen: loot.groschen, items: loot.items } } : {}),
  };
  const logged = pushLog(state, ev);

  if (rel.stance === "frieden" && rel.tension >= 60) {
    setStance(rel, "spannung", tick);
    pushLog(state, {
      tick, kind: "tension", villages: [rel.a, rel.b],
      text: `Die Spannung zwischen ${fromName} und ${toName} wächst: ${texts.label}.`, actor: from, detail: k,
    });
  }

  if (rel.tension >= 85 && rel.stance !== "krieg" && !(rel.truceUntil != null && rel.truceUntil > tick)) {
    const scheduled = scheduleMeeting(state, tick, to, "declare_war",
      `Kriegserklärung gegen ${fromName}? (${texts.label})`, from);
    if (scheduled) {
      pushLog(state, {
        tick, kind: "tension", villages: [rel.a, rel.b],
        text: `In ${toName} wird ein Appell über eine Kriegserklärung gegen ${fromName} einberufen.`, actor: to,
      });
    }
  }

  emitRelation(rel);
  return { ok: true, relation: rel, event: logged };
}

// ─── War, peace, tribute ─────────────────────────────────────

export function declareWar(state: WorldState, tick: number, aggressor: string, target: string): WarResult {
  const bad = checkVillages(aggressor, target);
  if (bad) return { ok: false, error: bad };
  const rel = getRelation(state, aggressor, target);
  const aName = villageName(aggressor);
  const tName = villageName(target);
  if (rel.stance === "krieg") {
    return { ok: false, error: `[Geht nicht] Zwischen ${aName} und ${tName} herrscht schon Krieg.` };
  }
  if (rel.truceUntil != null && rel.truceUntil > tick) {
    return { ok: false, error: `[Geht nicht] Zwischen ${aName} und ${tName} gilt noch ein Waffenstillstand bis Tag ${dayOf(rel.truceUntil)}.` };
  }
  setStance(rel, "krieg", tick);
  rel.tension = Math.max(rel.tension, 90);
  delete rel.peaceOfferBy;
  delete rel.peaceOfferTick;
  delete rel.truceUntil;

  notifyVillage(state, target, `⚔ ${aName} hat uns den Krieg erklärt! Wachen aufstellen, Vorräte sichern — Überfälle sind jetzt jederzeit möglich.`);
  notifyVillage(state, aggressor, `⚔ Der Rat hat ${tName} den Krieg erklärt. Mit ueberfallen kannst du dort angreifen, mit wache_halten schützt du unseren Ort.`);
  const ev = pushLog(state, {
    tick, kind: "declared", villages: [rel.a, rel.b],
    text: `${aName} erklärt ${tName} den Krieg.`, actor: aggressor,
  });
  emitRelation(rel);
  return { ok: true, relation: rel, event: ev };
}

function endWar(state: WorldState, rel: VillageRelation, tick: number): void {
  setStance(rel, "frieden", tick);
  rel.truceUntil = tick + TRUCE_TICKS;
  rel.tension = 20;
  delete rel.peaceOfferBy;
  delete rel.peaceOfferTick;
}

export function makePeace(state: WorldState, tick: number, a: string, b: string): WarResult {
  const bad = checkVillages(a, b);
  if (bad) return { ok: false, error: bad };
  const rel = getRelation(state, a, b);
  if (rel.stance === "frieden") {
    return { ok: false, error: `[Geht nicht] Zwischen ${villageName(a)} und ${villageName(b)} herrscht schon Frieden.` };
  }
  endWar(state, rel, tick);
  const text = `Frieden zwischen ${villageName(a)} und ${villageName(b)}. Die Waffen ruhen bis mindestens Tag ${dayOf(rel.truceUntil!)}.`;
  notifyVillage(state, a, `🕊 ${text}`);
  notifyVillage(state, b, `🕊 ${text}`);
  const ev = pushLog(state, { tick, kind: "peace", villages: [rel.a, rel.b], text });
  emitRelation(rel);
  return { ok: true, relation: rel, event: ev };
}

/** Payer village hands `amount` Groschen (collected from its members by wealth) to the receiver's elder. */
export function payTribute(
  state: WorldState, tick: number, payer: string, receiver: string, amount: number,
): WarResult {
  const bad = checkVillages(payer, receiver);
  if (bad) return { ok: false, error: bad };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "[Geht nicht] Der Tribut muss ein positiver Betrag sein." };
  }
  const want = Math.floor(amount);
  const pName = villageName(payer);
  const rName = villageName(receiver);

  const payers = getVillageMembers(payer).filter(a => a !== PLAYER_ID && state.economics[a] && state.economics[a]!.wallet > 0);
  const totalWealth = payers.reduce((s, a) => s + state.economics[a]!.wallet, 0);
  const collect = Math.min(want, totalWealth);
  if (collect <= 0) return { ok: false, error: `[Geht nicht] ${pName} hat nichts, was als Tribut gezahlt werden könnte.` };

  const recipient = [getVillageElder(receiver), ...getVillageMembers(receiver)]
    .find(a => a && state.economics[a] && a !== PLAYER_ID);
  if (!recipient) return { ok: false, error: `[Geht nicht] In ${rName} ist niemand da, der den Tribut annehmen könnte.` };

  // Proportional shares by wealth; floor + largest remainder so the shares sum to exactly `collect`.
  const shares = payers.map(a => {
    const exact = (collect * state.economics[a]!.wallet) / totalWealth;
    return { a, take: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = collect - shares.reduce((s, x) => s + x.take, 0);
  for (const s of [...shares].sort((x, y) => y.rem - x.rem)) {
    if (left <= 0) break;
    if (s.take < state.economics[s.a]!.wallet) { s.take++; left--; }
  }
  for (const s of shares) {
    state.economics[s.a]!.wallet -= s.take;
    if (s.take > 0) feedbackToAgent(s.a, state, `Du musstest ${s.take} Groschen als Tribut an ${rName} abgeben.`);
  }
  state.economics[recipient]!.wallet += collect;
  feedbackToAgent(recipient, state, `${pName} hat ${collect} Groschen Tribut gezahlt. Du verwahrst sie für ${rName}.`);

  const rel = getRelation(state, payer, receiver);
  rel.tension = Math.max(0, rel.tension - 40);
  const wasWar = rel.stance === "krieg";
  if (wasWar) endWar(state, rel, tick);
  else if (rel.stance === "spannung" && rel.tension < 40) setStance(rel, "frieden", tick);

  const text = `${pName} zahlt ${collect} Groschen Tribut an ${rName}${wasWar ? " — der Krieg ist damit beendet" : ""}.`;
  notifyVillage(state, payer, `💰 ${text}`);
  notifyVillage(state, receiver, `💰 ${text}`);
  const ev = pushLog(state, {
    tick, kind: "tribute", villages: [rel.a, rel.b], text, actor: payer,
    loot: { groschen: collect, items: {} },
  });
  emitRelation(rel);
  return { ok: true, relation: rel, event: ev };
}

// ─── Council agendas ─────────────────────────────────────────

/**
 * Apply a passed war agenda of village `vid`'s council. Errors are announced to the village
 * (and logged) rather than thrown.
 */
export function applyWarAgenda(
  state: WorldState, tick: number, vid: string, type: AgendaType, targetVillage: string | undefined, value?: number,
): void {
  const fail = (msg: string) => {
    notifyVillage(state, vid, msg);
    console.warn(`  ⚔ [war] ${type} (${vid} → ${targetVillage ?? "?"}) refused: ${msg}`);
  };
  if (!targetVillage || checkVillages(vid, targetVillage)) {
    fail("[Geht nicht] Der Beschluss nennt keine gültige andere Siedlung.");
    return;
  }
  if (type === "declare_war") {
    const r = declareWar(state, tick, vid, targetVillage);
    if (!r.ok) fail(r.error);
  } else if (type === "pay_tribute") {
    const amount = Math.min(MAX_TRIBUTE, Math.max(1, Math.floor(value && value > 0 ? value : DEFAULT_TRIBUTE)));
    const r = payTribute(state, tick, vid, targetVillage, amount);
    if (!r.ok) fail(r.error);
  } else if (type === "make_peace") {
    const rel = getRelation(state, vid, targetVillage);
    if (rel.peaceOfferBy === targetVillage) {
      const r = makePeace(state, tick, vid, targetVillage);
      if (!r.ok) fail(r.error);
      return;
    }
    if (rel.stance === "frieden") {
      fail(`[Geht nicht] Mit ${villageName(targetVillage)} herrscht schon Frieden.`);
      return;
    }
    rel.peaceOfferBy = vid;
    rel.peaceOfferTick = tick;
    const text = `${villageName(vid)} bietet ${villageName(targetVillage)} Frieden an.`;
    notifyVillage(state, vid, `🕊 ${text} Nun muss ${villageName(targetVillage)} zustimmen.`);
    notifyVillage(state, targetVillage, `🕊 ${text}`);
    pushLog(state, { tick, kind: "peace_offer", villages: [rel.a, rel.b], text, actor: vid });
    scheduleMeeting(state, tick, targetVillage, "make_peace", `Friedensangebot von ${villageName(vid)} annehmen?`, vid);
    emitRelation(rel);
  }
}

// ─── Agent actions ───────────────────────────────────────────

export function isWarRelevant(state: WorldState, agent: AgentName): boolean {
  const v = homeVillage(state, agent);
  return Object.values(state.diplomacy ?? {}).some(r => (r.a === v || r.b === v) && r.stance !== "frieden");
}

/** Validate and record a raid / guard action; the outcome is resolved at tick end by resolveWar. */
export function registerWarAction(
  state: WorldState, tick: number, agent: AgentName, kind: "raid" | "guard", target?: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const home = homeVillage(state, agent);
  const loc = state.agent_locations[agent];
  const here = locationVillage(loc);
  state.war_actions ??= {};

  if (kind === "raid") {
    const tid = resolveVillageId(target);
    if (!tid) return { ok: false, error: "[Geht nicht] Welche Siedlung willst du überfallen? Nenne den Namen." };
    if (tid === home) return { ok: false, error: "[Geht nicht] Du kannst deine eigene Siedlung nicht überfallen." };
    const rel = peekRelation(state, home, tid);
    if (!rel || rel.stance !== "krieg") {
      return { ok: false, error: `[Geht nicht] Zwischen ${villageName(home)} und ${villageName(tid)} herrscht kein Krieg — ohne Kriegserklärung kein Überfall.` };
    }
    if (here !== tid) {
      return { ok: false, error: `[Geht nicht] Du musst dazu in ${villageName(tid)} selbst sein, nicht auf der Straße oder daheim.` };
    }
    state.war_actions[agent] = { kind: "raid", target: tid, tick };
    return { ok: true, text: `stürmt los, um ${villageName(tid)} zu überfallen — wer dort wacht, wird sich wehren. Das Ergebnis kommt am Ende der Stunde.` };
  }

  const tense = Object.values(state.diplomacy ?? {}).some(r => (r.a === home || r.b === home) && r.stance !== "frieden");
  if (!tense) return { ok: false, error: "[Geht nicht] Es herrscht Frieden — niemand muss bewacht werden." };
  if (here !== home) return { ok: false, error: `[Geht nicht] Wache halten kannst du nur in ${villageName(home)} selbst.` };
  state.war_actions[agent] = { kind: "guard", tick };
  return { ok: true, text: `hält Wache und behält die Wege im Auge.` };
}

/** Trade refusal while the agent stands in a village its own village is at war with. */
export function warTradeBlock(state: WorldState, agent: AgentName): string | null {
  const home = homeVillage(state, agent);
  const here = locationVillage(state.agent_locations[agent]);
  if (!here || here === home) return null;
  const rel = peekRelation(state, home, here);
  if (rel?.stance !== "krieg") return null;
  return `[Geht nicht] Krieg: Leute aus ${villageName(home)} werden hier nicht bedient.`;
}

// ─── Raid resolution ─────────────────────────────────────────

function villageMarketplace(state: WorldState, vid: string): Marketplace {
  return state.marketplaces?.[vid] ?? state.marketplace;
}

function armed(state: WorldState, agent: AgentName): boolean {
  if (WEAPON_ITEMS.length === 0) return false;
  const inv = state.economics[agent]?.inventory;
  return !!inv && WEAPON_ITEMS.some(w => getInventoryQty(inv, w) > 0);
}

function strength(state: WorldState, agents: AgentName[], guards: Set<AgentName>, rng: Rng): number {
  let sum = 0;
  for (const a of agents) {
    let s = 1;
    if (guards.has(a)) s *= 2;
    if (armed(state, a)) s *= 1.5;
    sum += s;
  }
  return sum * (0.75 + rng() * 0.5);
}

function wound(body: BodyState): void {
  body.injury = Math.min(3, (body.injury ?? 0) + 1);
  body.energy = Math.max(0, body.energy - 3);
}

function names(ids: AgentName[]): string {
  return ids.map(getDisplayName).join(", ");
}

function lootText(loot: { groschen: number; items: Record<string, number> }): string {
  const parts: string[] = [];
  if (loot.groschen > 0) parts.push(`${loot.groschen} Groschen`);
  for (const [item, q] of Object.entries(loot.items)) parts.push(`${q}× ${itemLabel(item)}`);
  return parts.join(", ");
}

function resolveRaid(
  state: WorldState, tick: number, attackerVid: string, targetVid: string,
  raiders: AgentName[], guards: Set<AgentName>, rng: Rng,
): WarEvent {
  const defenders = getVillageMembers(targetVid)
    .filter(a => isFighter(state, a) && locationVillage(state.agent_locations[a]) === targetVid);
  const aStr = strength(state, raiders, new Set(), rng);
  const dStr = defenders.length === 0 ? 0 : strength(state, defenders, guards, rng);
  const success = aStr > dStr;
  const aName = villageName(attackerVid);
  const tName = villageName(targetVid);
  const rel = getRelation(state, attackerVid, targetVid);
  rel.raidsWon ??= {};

  const loot = { groschen: 0, items: {} as Record<string, number> };
  const wounded: AgentName[] = [];
  let text: string;

  if (success) {
    rel.raidsWon[attackerVid] = (rel.raidsWon[attackerVid] ?? 0) + 1;

    // Groschen: up to 15 % of each present defender's purse, capped overall.
    for (const d of defenders) {
      const eco = state.economics[d]!;
      const take = Math.min(Math.floor(eco.wallet * RAID_WALLET_SHARE), RAID_LOOT_CAP - loot.groschen);
      if (take > 0) { eco.wallet -= take; loot.groschen += take; }
    }

    // Goods: up to 20 % of each sell order on the village marketplace; the cap is on total value.
    const lootItems: { item: ItemType; qty: number }[] = [];
    let value = loot.groschen;
    const mkt = villageMarketplace(state, targetVid);
    for (const order of [...mkt.orders]) {
      if (order.type !== "sell" || order.quantity <= 0) continue;
      const seller = state.economics[order.agentId];
      if (!seller) continue;
      const held = seller.inventory.items.find(i => i.type === order.item)?.quantity ?? 0;
      let take = Math.min(Math.floor(order.quantity * RAID_ITEM_SHARE), held);
      if (order.price > 0) take = Math.min(take, Math.floor((RAID_LOOT_CAP - value) / order.price));
      if (take <= 0) continue;
      unreserveInventory(order.agentId, order.item, take, state);
      removeFromInventory(seller.inventory, order.item, take);
      order.quantity -= take;
      value += take * order.price;
      loot.items[order.item] = (loot.items[order.item] ?? 0) + take;
      lootItems.push({ item: order.item, qty: take });
      feedbackToAgent(order.agentId, state, `Plünderer haben ${take}× ${itemLabel(order.item)} aus deinem Angebot geraubt.`);
    }
    mkt.orders = mkt.orders.filter(o => o.quantity > 0);

    // Split among the raiders: Groschen evenly (remainder to the first), goods unit by unit.
    const n = raiders.length;
    const base = Math.floor(loot.groschen / n);
    const rest = loot.groschen - base * n;
    raiders.forEach((r, i) => { state.economics[r]!.wallet += base + (i < rest ? 1 : 0); });
    let cursor = 0;
    for (const { item, qty } of lootItems) {
      for (let u = 0; u < qty; u++) {
        addToInventory(state.economics[raiders[cursor % n]!]!.inventory, item, 1, tick);
        cursor++;
      }
    }

    for (const d of defenders) {
      if (rng() < 0.5) { wound(state.body[d]!); wounded.push(d); }
    }
    const lt = lootText(loot);
    text = `Überfall auf ${tName}: ${raiders.length} Plünderer aus ${aName} brechen durch${lt ? ` und erbeuten ${lt}` : ""}.`
      + (wounded.length ? ` Verletzt: ${names(wounded)}.` : "");
  } else {
    rel.raidsWon[targetVid] = (rel.raidsWon[targetVid] ?? 0) + 1;
    for (const r of raiders) {
      if (rng() < 0.5) { wound(state.body[r]!); wounded.push(r); }
    }
    text = `Überfall auf ${tName} abgewehrt: ${raiders.length} Angreifer aus ${aName} werden zurückgeschlagen.`
      + (wounded.length ? ` Verletzt: ${names(wounded)}.` : "");
  }

  for (const w of wounded) feedbackToAgent(w, state, "Du wurdest im Handgemenge verletzt.");
  for (const r of raiders) {
    feedbackToAgent(r, state, success
      ? `Der Überfall gelingt.${lootText(loot) ? ` Die Beute wird geteilt: ${lootText(loot)} insgesamt.` : ""}`
      : "Der Überfall scheitert — die Verteidiger waren zu stark.");
  }
  notifyVillage(state, targetVid, `⚔ ${text}`);
  notifyVillage(state, attackerVid, `⚔ ${text}`);

  const ev = pushLog(state, {
    tick, kind: "raid", villages: [rel.a, rel.b], text, actor: raiders[0],
    loot, wounded, success,
  });
  emitSSE("war:raid", { attacker: attackerVid, target: targetVid, success, loot, wounded, text });
  emitRelation(rel);
  return ev;
}

/**
 * Resolve this tick's registered raids and guards (run once per tick, after the agents acted).
 * Clears `war_actions`. Returns the raid events.
 */
export function resolveWar(state: WorldState, tick: number, rng: Rng = Math.random): WarEvent[] {
  const actions = state.war_actions ?? {};
  state.war_actions = {};
  const entries = Object.entries(actions).filter(([, a]) => a.tick === tick);
  if (entries.length === 0) return [];

  const guards = new Set<AgentName>(entries.filter(([, a]) => a.kind === "guard").map(([id]) => id));
  const groups = new Map<string, AgentName[]>();   // `${target}|${attackerVillage}` → raiders
  for (const [id, a] of entries) {
    if (a.kind !== "raid" || !a.target) continue;
    if (!isFighter(state, id)) continue;
    if (locationVillage(state.agent_locations[id]) !== a.target) continue; // moved away / not there any more
    const key = `${a.target}|${homeVillage(state, id)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(id);
  }

  const events: WarEvent[] = [];
  for (const key of [...groups.keys()].sort()) {
    const [target, attacker] = key.split("|") as [string, string];
    if (peekRelation(state, attacker, target)?.stance !== "krieg") continue;
    events.push(resolveRaid(state, tick, attacker, target, groups.get(key)!, guards, rng));
  }
  return events;
}

// ─── Daily diplomacy upkeep ──────────────────────────────────

/** Tension decays by 2 per sim day (not while at war); spannung < 40 → frieden; stale peace offers expire. */
export function tickDiplomacy(state: WorldState, tick: number): void {
  if (!state.diplomacy) return;
  const dawn = (tick - 1) % ticksPerDay() === 0;
  for (const rel of Object.values(state.diplomacy)) {
    let changed = false;
    if (rel.peaceOfferTick != null && tick - rel.peaceOfferTick > PEACE_OFFER_TTL) {
      delete rel.peaceOfferBy;
      delete rel.peaceOfferTick;
      changed = true;
    }
    if (dawn && rel.stance !== "krieg" && rel.tension > 0) {
      rel.tension = Math.max(0, rel.tension - 2);
      changed = true;
      if (rel.stance === "spannung" && rel.tension < 40) {
        setStance(rel, "frieden", tick);
        pushLog(state, {
          tick, kind: "peace", villages: [rel.a, rel.b],
          text: `Die Gemüter zwischen ${villageName(rel.a)} und ${villageName(rel.b)} beruhigen sich.`,
        });
      }
    }
    if (changed) emitRelation(rel);
  }
}

// ─── Perception ──────────────────────────────────────────────

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Short German lines for prompts (cheap in tokens); empty when everything is quiet. */
export function warPerceptionLines(state: WorldState, agent: AgentName): string[] {
  const vid = homeVillage(state, agent);
  const rels = Object.values(state.diplomacy ?? {}).filter(r => r.a === vid || r.b === vid);
  const lines: string[] = [];
  let tense = false;
  let atWar = false;
  const log = state.war_log ?? [];

  for (const rel of rels) {
    const other = otherOf(rel, vid);
    const oName = villageName(other);
    if (rel.stance === "krieg") {
      atWar = tense = true;
      const lost = rel.raidsWon[other] ?? 0;
      lines.push(`⚔ Krieg mit ${oName} seit Tag ${dayOf(rel.since)} — ${lost} Überfall${lost === 1 ? "" : "e"} verloren.`);
    } else if (rel.stance === "spannung") {
      tense = true;
      const cause = [...log].reverse().find(e => e.kind === "provocation" && e.villages.includes(rel.a) && e.villages.includes(rel.b));
      const label = PROVOKE_KINDS.find(k => k.id === cause?.detail)?.label;
      lines.push(`Spannung mit ${oName}${label ? ` (${label})` : ""}.`);
    } else if (rel.truceUntil != null && rel.truceUntil > state.current_tick) {
      lines.push(`Waffenstillstand mit ${oName} bis Tag ${dayOf(rel.truceUntil)}.`);
    }
    if (rel.peaceOfferBy === other) lines.push(`${oName} hat Frieden angeboten — der Rat kann per Appell (make_peace) zustimmen.`);
  }

  const recent = log.filter(e => e.villages.includes(vid)).slice(-3);
  if (recent.length > 0 && (tense || recent.some(e => e.tick >= state.current_tick - ticksPerDay() * 2))) {
    lines.push("Zuletzt: " + recent.map(e => `Tag ${dayOf(e.tick)}: ${clip(e.text, 90)}`).join(" | "));
  }

  if (atWar) {
    lines.push("Mögliches: ueberfallen (Siedlung nennen; nur im feindlichen Ort), wache_halten (schützt deinen Ort); Appell: declare_war, make_peace, pay_tribute (target_village).");
  } else if (tense) {
    lines.push("Mögliches: wache_halten (in deinem Ort); Appell: declare_war, make_peace, pay_tribute (target_village).");
  }
  return lines;
}
