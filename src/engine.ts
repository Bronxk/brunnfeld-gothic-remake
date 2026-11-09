import type {
  AgentName, AgentTurnResult, ItemType, Law, ResolvedAction, SimTime, TickLog, WorldState,
} from "./types.js";
import { getAgentNames, getNpcNames, getDisplayName, getCouncilMembers, getVillages, getVillageAgents, getVillageElder, getVillageTownHall, isRoadLocation, PLAYER_ID, isPlayerActive } from "./world-registry.js";
import { emitSSE } from "./events.js";
import { tickToTime, ticksPerDay, getHourIndex } from "./time.js";
import {
  readWorldState, writeWorldState, writeTickLog,
  updateAgentMemoryFromActions, updateRelationships,
} from "./memory.js";
import { buildPerception, buildMeetingPerception, runBatchedAgents, describeAgent } from "./agent-runner.js";
import { runHarnessLocation } from "./harness.js";
import { getLLMStats } from "./llm.js";
import { getSounds, setLastTickActions, getLastTickActions } from "./sounds.js";
import {
  attachLiveTick, detachLiveTick, drainPlayerTurn, recordHeardSpeech, playerSpeechText,
  applyPlayerSoftDeath, emitPlayerUpdate,
} from "./player.js";
import { deliverMessages } from "./messages.js";
import { updateBodyState, applyDawnAutoEat, checkStarvation, isAgentDead } from "./body.js";
import { checkSpoilage, feedbackToAgent, clampReservations } from "./inventory.js";
import { degradeTools, autoEquipTools } from "./tools-degradation.js";
import { resolveProduction } from "./production.js";
import { tickGodModeEvents } from "./god-mode.js";
import { resolveMarketplace } from "./marketplace-resolver.js";
import { resolveBarter } from "./trade-scanner.js";
import { takeEconomySnapshot, getEconomySummary } from "./economy-tracker.js";
import { applyWinterHeating, getSeasonDescription } from "./seasons.js";
import { isLocationOpen, isBaseLocation, HUB_LOCATION, PRISON_LOCATION, TOWNHALL_LOCATION } from "./village-map.js";

// ─── Vote normalisation ──────────────────────────────────────
// Agents now answer in German; the vote tool contract stays "agree"|"disagree",
// but ja/nein/dafür/dagegen must count as well.

const AGREE_ANSWERS = new Set(["agree", "yes", "aye", "ja", "jawohl", "dafuer", "zustimmen", "zustimmung", "stimmezu", "einverstanden", "pro"]);

function normalizeVoteSide(raw: unknown): "agree" | "disagree" {
  const key = String(raw ?? "").trim().toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z]/g, "");
  return AGREE_ANSWERS.has(key) ? "agree" : "disagree";
}

// ─── Weather table (cycles every 14 days) ────────────────────

const WEATHER_TABLE: Record<string, string[]> = {
  spring: ["Mild, 12 °C, sonnig", "Bedeckt, 10 °C", "Leichter Regen, 9 °C", "Sonnig, 14 °C", "Windig, 11 °C", "Klar, 13 °C", "Wolkig, 10 °C"],
  summer: ["Heiß, 24 °C, sonnig", "Warm, 22 °C", "Schwül, 20 °C", "Gewitter, 18 °C", "Sonnig, 25 °C", "Dunstig, 21 °C", "Klar, 23 °C"],
  autumn: ["Kühl, 8 °C, neblig", "Windig, 7 °C", "Regen, 6 °C", "Bedeckt, 9 °C", "Klar, 10 °C", "Kalt, 5 °C", "Nieselregen, 7 °C"],
  winter: ["Frost, -2 °C", "Schnee, -4 °C", "Bittere Kälte, -6 °C", "Bedeckt, 0 °C", "Eis, -3 °C", "Schneesturm, -8 °C", "Grau, -1 °C"],
};

function getWeather(state: WorldState, time: SimTime): string {
  const table = WEATHER_TABLE[time.season] ?? WEATHER_TABLE.spring;
  return table[(time.seasonDay - 1) % table.length]!;
}

// ─── Resolve acquaintances ────────────────────────────────────

function updateAcquaintances(results: AgentTurnResult[], state: WorldState): void {
  // Group by location
  const byLocation: Record<string, AgentName[]> = {};
  for (const agent of getAgentNames()) {
    const loc = state.agent_locations[agent];
    if (!byLocation[loc]) byLocation[loc] = [];
    byLocation[loc]!.push(agent);
  }

  // Agents who spoke to each other become acquaintances
  for (const [, group] of Object.entries(byLocation)) {
    if (group.length < 2) continue;

    const speakersHere = group.filter(a =>
      results.find(r => r.agent === a)?.actions.some(act => act.type === "speak")
    );

    for (const speaker of speakersHere) {
      for (const other of group) {
        if (speaker === other) continue;
        if (!state.acquaintances[speaker]) state.acquaintances[speaker] = [];
        if (!state.acquaintances[speaker].includes(other)) {
          state.acquaintances[speaker].push(other);
        }
      }
    }
  }
}

// ─── Resolve laborer wages ────────────────────────────────────

function resolveHiredWages(state: WorldState, time: SimTime): void {
  for (const agent of getAgentNames()) {
    const eco = state.economics[agent];
    if (!eco.hiredBy || !eco.hiredUntilTick) continue;
    if (time.tick >= eco.hiredUntilTick) {
      // Pay wage (stored as a simple day rate — we use 5 coin default)
      const wage = 5;
      state.economics[eco.hiredBy].wallet -= wage;
      eco.wallet += wage;
      eco.hiredBy = undefined;
      eco.hiredUntilTick = undefined;
    }
  }
}

// ─── Eject agents from closed locations ──────────────────────

function enforceOpeningHours(state: WorldState, time: SimTime): void {
  const hourIdx = getHourIndex(time);
  // Check for active marketplace_hours and curfew laws
  let marketplaceCloseIdx: number | undefined;
  let curfewIdx: number | undefined;
  for (const law of (state.active_laws ?? [])) {
    if (law.type === "marketplace_hours" && law.value != null) {
      marketplaceCloseIdx = law.value;
    }
    if (law.type === "curfew" && law.value != null) {
      curfewIdx = law.value;
    }
  }
  const TAVERN_LOCATION = "Schenke";
  const CURFEW_EXEMPT = new Set([TAVERN_LOCATION, TOWNHALL_LOCATION]);
  for (const agent of getAgentNames()) {
    const loc = state.agent_locations[agent];
    const home = state.economics[agent]?.homeLocation;
    // Marketplace hours law
    if (loc === HUB_LOCATION && marketplaceCloseIdx != null) {
      if (hourIdx >= marketplaceCloseIdx) {
        state.agent_locations[agent] = home;
      }
      continue;
    }
    // Curfew law — send home unless at home, tavern, or town hall
    if (curfewIdx != null && hourIdx >= curfewIdx) {
      if (loc !== home && !CURFEW_EXEMPT.has(loc) && !isBaseLocation(loc, TAVERN_LOCATION) && !isBaseLocation(loc, TOWNHALL_LOCATION)) {
        state.agent_locations[agent] = home;
        feedbackToAgent(agent, state, `[Sperrstunde] Per Ratsbeschluss musst du ab ${String(6 + curfewIdx).padStart(2, "0")}:00 Uhr zu Hause sein.`);
      }
      continue;
    }
    if (!isLocationOpen(loc, hourIdx)) {
      state.agent_locations[agent] = home;
    }
  }
}

// ─── Clean expired objects ────────────────────────────────────

function cleanExpiredObjects(state: WorldState, time: SimTime): void {
  state.objects = state.objects.filter(o => {
    if (!o.duration_days) return true;
    return time.dayNumber < o.placed_day + o.duration_days;
  });
}

// ─── Apply passed law effect ──────────────────────────────

function applyLawEffect(law: Law, state: WorldState, time: SimTime): void {
  switch (law.type) {
    case "tax_change":
      if (law.value != null) {
        state.tax_rate = law.value;
        console.log(`  ⚖ Tax rate changed to ${Math.round(law.value * 100)}%`);
      }
      break;
    case "marketplace_hours":
      // Stored in active_laws; enforceOpeningHours reads it at runtime
      break;
    case "banishment":
      if (law.target) {
        state.banned[law.target] = time.tick + 32;
        state.agent_locations[law.target] = PRISON_LOCATION;
        feedbackToAgent(law.target, state, `Per Ratsbeschluss wurdest du zur Karzerstrafe verurteilt. Du bist 2 Tage lang im ${PRISON_LOCATION} eingesperrt.`);
        console.log(`  ⚖ ${getDisplayName(law.target ?? "")} banished until tick ${time.tick + 32}`);
      }
      break;
    case "general_rule":
      // No mechanical effect — persists in active_laws for perception
      break;
    case "grant_tools":
      if (law.grantedTo && law.grantedTools) {
        console.log(`  ⚖ ${getDisplayName(law.grantedTo)} granted [${law.grantedTools.join(", ")}]`);
      }
      break;
    case "curfew":
      // Stored in active_laws; enforceOpeningHours reads it at runtime
      if (law.value != null) {
        console.log(`  ⚖ Curfew set: agents must be home by ${String(6 + law.value).padStart(2, "0")}:00`);
      }
      break;
    case "trade_restriction":
      console.log(`  ⚖ Trade restriction: ${law.description}`);
      break;
    case "repeal":
      if (law.repealsLawId) {
        const repealed = state.active_laws.find(l => l.id === law.repealsLawId);
        state.active_laws = state.active_laws.filter(l => l.id !== law.repealsLawId);
        console.log(`  ⚖ Repealed: ${repealed?.description ?? law.repealsLawId}`);
      }
      break;
  }
}

// ─── Village Bell — summon agents to the Vogtei ───────────

function ringVillageBell(state: WorldState, time: SimTime, villageId: string): void {
  const townHall = getVillageTownHall(villageId);
  const villageAgents = getVillageAgents(villageId);

  for (const agent of villageAgents) {
    if (isAgentDead(state.body[agent])) continue;
    if (state.banned?.[agent] != null && time.tick < state.banned[agent]!) continue;
    if (isRoadLocation(state.agent_locations[agent])) {
      feedbackToAgent(agent, state,
        `Du hörst von weitem das schwache Läuten der Grubenglocke. Ein Appell findet statt, aber du bist zu weit weg, um teilzunehmen.`);
      continue;
    }
    if (state.agent_locations[agent] === townHall) {
      feedbackToAgent(agent, state,
        `Die Grubenglocke läutet — der Appell beginnt.`);
      continue;
    }
    state.agent_locations[agent] = townHall;
    feedbackToAgent(agent, state,
      `Die Grubenglocke läutet über die Dächer — der Appell wird eröffnet. Du gehst zum Treffpunkt: ${townHall}.`);
  }

  emitSSE("meeting:bell", { villageId, townHall });
  console.log(`  🔔 [${villageId}] Village bell rang — agents summoned to ${townHall}`);
}

// ─── Village Meeting Phase ────────────────────────────────

async function runMeetingPhase(state: WorldState, time: SimTime, villageId: string): Promise<{ attendees: Set<AgentName>; log: import("./types.js").MeetingLog | null }> {
  const mtg = state.pending_meetings[villageId]!;
  const townHall = getVillageTownHall(villageId);
  const villageAgents = getVillageAgents(villageId).filter(a => !isAgentDead(state.body[a]));

  // 1. Attendance check
  const attendees = villageAgents.filter(a => state.agent_locations[a] === townHall);
  const atHall = villageAgents.map(a => `${a}=${state.agent_locations[a]}`).join(", ");
  console.log(`  🏛 [Quorum] [${villageId}] Agents at ${townHall}: ${attendees.length}/${villageAgents.length} — ${attendees.join(", ") || "none"}`);
  console.log(`  🏛 [Quorum] [${villageId}] All locations: ${atHall}`);
  const councilPresent = attendees.filter(a => getCouncilMembers(villageId).includes(a));
  if (councilPresent.length < 3) {
    const msg = `[Beschlussfähigkeit] Der Appell zu „${mtg.description}" ist nicht zustande gekommen — nur ${councilPresent.length} Ratsmitglied(er) waren da (nötig: 3 von 5).`;
    for (const a of getVillageAgents(villageId)) feedbackToAgent(a, state, msg);
    emitSSE("meeting:quorum_fail", { description: mtg.description, attendeeCount: attendees.length, villageId });
    delete state.pending_meetings[villageId];
    return { attendees: new Set<AgentName>(), log: null };
  }

  console.log(`\n  🏛 Village meeting [${villageId}]: "${mtg.description}" — ${attendees.length} attendees`);
  emitSSE("meeting:start", { agendaType: mtg.agendaType, description: mtg.description, attendees, attendeeCount: attendees.length, villageId });

  // 2. Discussion phase — 3 rounds, council members first (up to 5 participants)
  const nonCouncilAttendees = attendees.filter(a => !getCouncilMembers(villageId).includes(a));
  const participants = [
    ...councilPresent,
    ...nonCouncilAttendees,
  ].slice(0, 5) as AgentName[];
  let conversationSoFar = "";
  const collectedProposals: Array<{ text: string; value?: number }> = [];
  const meetingMoved = new Set<AgentName>();
  const discussionLog: { agent: AgentName; text: string }[] = [];

  for (let round = 0; round < 3; round++) {
    emitSSE("meeting:phase", { phase: "discussion", round });
    const roundPerceptions: Record<AgentName, string> = {} as Record<AgentName, string>;
    for (const agent of participants) {
      const others = participants
        .filter(a => a !== agent)
        .map(a => describeAgent(a, agent, state));
      roundPerceptions[agent] = buildMeetingPerception(agent, state, time, conversationSoFar, others, "discussion");
    }
    const roundResults = await runBatchedAgents(participants, roundPerceptions, state, time, 5, meetingMoved);
    for (const r of roundResults) {
      for (const action of r.actions) {
        if (action.type === "propose_rule" && action.text) {
          collectedProposals.push({ text: action.text, value: action.value });
        }
        if (action.type === "speak" && action.text) {
          discussionLog.push({ agent: r.agent, text: action.text });
        }
        if (action.visible && action.result) {
          conversationSoFar += `${action.result}\n`;
          emitSSE("agent:action", { agent: r.agent, actionType: action.type, text: action.text, result: action.result, location: townHall });
        }
      }
    }
  }

  // 3. Extract first valid proposal
  const proposal = collectedProposals[0];
  const proposalText = proposal?.text ?? `${mtg.description} (keine konkrete Regel vorgeschlagen)`;
  const proposalValue = proposal?.value;

  emitSSE("meeting:phase", { phase: "vote", proposal: proposalText });

  // 4. Vote phase — all attendees vote (1 round)
  const votePerceptions: Record<AgentName, string> = {} as Record<AgentName, string>;
  for (const agent of attendees) {
    const others = attendees.filter(a => a !== agent).map(a => describeAgent(a, agent, state));
    votePerceptions[agent] = buildMeetingPerception(agent, state, time, conversationSoFar, others, "vote", proposalText);
  }
  const voteResults = await runBatchedAgents(attendees, votePerceptions, state, time, 5, meetingMoved);

  let agreeCount = 0;
  const agreeVoters: AgentName[] = [];
  const disagreeVoters: AgentName[] = [];
  for (const r of voteResults) {
    for (const action of r.actions) {
      if (action.visible && action.result) {
        emitSSE("agent:action", { agent: r.agent, actionType: action.type, text: action.text, result: action.result, location: townHall });
      }
      if (action.type === "vote") {
        const side = normalizeVoteSide(action.side);
        emitSSE("meeting:vote", { agent: r.agent, side });
        if (side === "agree") { agreeCount++; agreeVoters.push(r.agent); }
        else disagreeVoters.push(r.agent);
      }
    }
  }

  // 5. Resolution — simple majority + 1 of attendees
  const PASS_THRESHOLD = Math.ceil(attendees.length / 2) + 1;
  const passed = agreeCount >= PASS_THRESHOLD;

  let lawText: string | undefined;
  if (passed) {
    const law: Law = {
      id: `law_${mtg.agendaType}_${time.tick}`,
      type: mtg.agendaType,
      description: proposalText,
      passedTick: time.tick,
      value: proposalValue,
      target: mtg.target,
    };
    // Populate type-specific fields
    if (mtg.agendaType === "grant_tools" && mtg.target) {
      law.grantedTo = mtg.target;
      law.grantedTools = ["fine_agent", "seize_goods"];
    }
    if (mtg.agendaType === "repeal") {
      // Find law ID mentioned in proposal text or target field
      const repealTarget = mtg.target ?? state.active_laws.find(l => proposalText.includes(l.id))?.id;
      if (repealTarget) law.repealsLawId = repealTarget;
    }
    state.active_laws.push(law);
    applyLawEffect(law, state, time);
    lawText = proposalText;
    const passMsg = `Ergebnis des Appells: „${proposalText}" ANGENOMMEN (${agreeCount} dafür, nötig: ${PASS_THRESHOLD}). Neues Gesetz eingetragen.`;
    for (const a of getVillageAgents(villageId)) feedbackToAgent(a, state, passMsg);
    emitSSE("meeting:result", { passed: true, agreeCount, law });
    console.log(`  ✅ Law passed: "${proposalText}" (${agreeCount} agreed)`);
  } else {
    const failMsg = `Ergebnis des Appells: „${proposalText}" ABGELEHNT (${agreeCount} dafür, nötig: ${PASS_THRESHOLD} von ${attendees.length} Anwesenden).`;
    for (const a of getVillageAgents(villageId)) feedbackToAgent(a, state, failMsg);
    emitSSE("meeting:result", { passed: false, agreeCount });
    console.log(`  ❌ Vote failed: "${proposalText}" (${agreeCount}/${PASS_THRESHOLD})`);
  }

  delete state.pending_meetings[villageId];
  emitSSE("meeting:end", { villageId });

  const meetingLog: import("./types.js").MeetingLog = {
    description: mtg.description,
    agendaType: mtg.agendaType,
    attendees,
    discussion: discussionLog,
    proposal: proposalText,
    votes: { agree: agreeVoters, disagree: disagreeVoters },
    passed,
    agreeCount,
    requiredCount: PASS_THRESHOLD,
    law: lawText,
  };
  return { attendees: new Set(attendees), log: meetingLog };
}

// ─── Persisted across ticks for harness sounds ────────────────
// Last tick's resolved actions live in sounds.ts (setLastTickActions) so look_around() and the
// human player's perception can report sounds from adjacent locations via getSounds().

/** The human player, if they stand at `location` and are alive (NPCs see them like any colonist). */
function playerAt(state: WorldState, location: string): AgentName[] {
  if (!isPlayerActive()) return [];
  if (state.agent_locations[PLAYER_ID] !== location || isAgentDead(state.body[PLAYER_ID])) return [];
  return [PLAYER_ID];
}

// ─── Core tick ────────────────────────────────────────────────

export async function runTick(tick: number): Promise<void> {
  try {
    await runTickCore(tick);
  } finally {
    detachLiveTick(); // player requests go back to world_state.json
  }
}

async function runTickCore(tick: number): Promise<void> {
  const state = readWorldState();
  const time = tickToTime(tick);
  // Share this in-memory state with the player API for the duration of the tick (src/player.ts).
  attachLiveTick(state, tick);

  console.log(`\n─── Tick ${tick} — ${time.timeLabel} (${time.season}) ───`);

  emitSSE("tick:start", { tick, time: time.timeLabel, season: time.season, weather: state.weather });

  // ── 1. DAWN PHASE ──────────────────────────────────────────
  if (time.isFirstTickOfDay) {
    state.weather = getWeather(state, time);
    state.season = time.season;
    state.day_of_season = time.seasonDay;

    applyWinterHeating(state);
    applyDawnAutoEat(state);
    degradeTools(state);
    autoEquipTools(state);
    checkSpoilage(state, time);
    cleanExpiredObjects(state, time);

    // Overdue loan reminders
    if (state.loans) {
      for (const loan of state.loans) {
        if (loan.repaid) continue;
        if (time.tick >= loan.dueTick && !isAgentDead(state.body[loan.debtor])) {
          const creditorName = getDisplayName(loan.creditor);
          const dueDay = Math.ceil(loan.dueTick / 16);
          feedbackToAgent(loan.debtor, state, `Du schuldest ${creditorName} ${loan.amount} Groschen — fällig war es an Tag ${dueDay}.`);
        }
      }
    }

    if (time.seasonDay === 1) {
      console.log(`  🌿 ${getSeasonDescription(time.season)}`);
    }

    // Monday (Zehnt): collection by the Bergvogt (first council member per village).
    // Tick 1 = Monday, so day 1, 8, 15, ... — independent of the localized weekday name.
    if ((time.dayNumber - 1) % 7 === 0) {
      let taxTotal = 0;
      for (const village of getVillages()) {
        const elder = getCouncilMembers(village.id)[0];
        if (!elder || !state.economics[elder]) continue;
        for (const agent of village.agents.map(a => a.id)) {
          if (agent === elder || !state.economics[agent]) continue;
          const tax = Math.floor(state.economics[agent].wallet * (state.tax_rate ?? 0.10));
          if (tax > 0) {
            state.economics[agent].wallet -= tax;
            state.economics[elder].wallet += tax;
            state.total_tax_collected += tax;
            taxTotal += tax;
          }
        }
      }
      if (taxTotal > 0) {
        const elders = getVillages().map(v => getCouncilMembers(v.id)[0]).filter(Boolean);
        const elderNames = elders.map(e => getDisplayName(e)).join(", ");
        console.log(`  💰 Tax day: ${elderNames} collected ${taxTotal} coin.`);
      }
    }
  }

  // ── 2. ENFORCE CLOSING HOURS ────────────────────────────────
  enforceOpeningHours(state, time);

  // ── 3. UPDATE BODY STATES ────────────────────────────────────
  for (const agent of getAgentNames()) {
    updateBodyState(state.body[agent], time);
  }

  // ── 4. CLEAR LAST TICK'S FEEDBACK ───────────────────────────
  // (keep it around for one tick so agents read it, then clear before next LLM call)
  const feedbackSnapshot = { ...state.action_feedback };
  for (const agent of getAgentNames()) state.action_feedback[agent] = [];

  // ── 4b. GOD MODE EVENTS ──────────────────────────────────────
  tickGodModeEvents(state, time); // expire events, apply bandit theft

  // Expire petitions older than 1 in-game day (16 ticks)
  if (state.pending_petitions && state.pending_petitions.length > 0) {
    state.pending_petitions = state.pending_petitions.filter(p => time.tick - p.tick <= 16);
  }

  // ── 4d. BANNED AGENT ENFORCEMENT ────────────────────────
  if (state.banned) {
    for (const agent of getAgentNames()) {
      const bannedUntil = state.banned[agent];
      if (bannedUntil == null) continue;
      if (time.tick < bannedUntil) {
        if (state.agent_locations[agent] !== PRISON_LOCATION) {
          state.agent_locations[agent] = PRISON_LOCATION;
        }
      } else {
        delete state.banned[agent];
        feedbackToAgent(agent, state, "Deine Karzerstrafe ist vorbei. Du bist wieder frei.");
      }
    }
  }

  // ── 4e. AUTO-SCHEDULE DAILY MEETING (per village) ───────
  // Auto-schedule assembly every 5 ticks (per village)
  for (const village of getVillages()) {
    if (state.pending_meetings[village.id]) continue;
    const elder = getVillageElder(village.id);
    if (!elder) continue;
    const elderName = getDisplayName(elder);
    const townHall = getVillageTownHall(village.id);
    const nextMeetingTick = time.tick + 5;
    state.pending_meetings[village.id] = {
      villageId: village.id,
      scheduledTick: nextMeetingTick,
      agendaType: "general_rule",
      description: `${elderName} hält den Appell ab`,
      calledAtTick: time.tick,
    };
    const noticeText = `${elderName} hat einen Appell einberufen. Er findet in 5 Stunden statt, Treffpunkt: ${townHall}.`;
    for (const a of getVillageAgents(village.id)) feedbackToAgent(a, state, noticeText);
    console.log(`  🏛 [${village.id}] Assembly auto-scheduled for tick ${nextMeetingTick}`);
  }

  // ── 4f. PRE-MEETING NUDGE (per village) ─────────────────────
  for (const [vid, mtg] of Object.entries(state.pending_meetings)) {
    if (time.tick === mtg.scheduledTick - 1) {
      const townHall = getVillageTownHall(vid);
      for (const a of getVillageAgents(vid)) {
        feedbackToAgent(a, state, `Der Appell beginnt in der nächsten Stunde. Die Grubenglocke läutet; Treffpunkt: ${townHall}.`);
      }
    }
  }

  // ── 4g. VILLAGE MEETING PHASE (per village) ────────────────
  // Drop stale meetings
  for (const [vid, mtg] of Object.entries(state.pending_meetings)) {
    if (mtg.scheduledTick < time.tick) {
      console.log(`  🏛 [${vid}] Dropping stale meeting "${mtg.description}" (scheduledTick=${mtg.scheduledTick} < tick=${time.tick})`);
      delete state.pending_meetings[vid];
    }
  }

  let meetingAttendees = new Set<AgentName>();
  let meetingLog: import("./types.js").MeetingLog | null = null;
  for (const [vid, mtg] of Object.entries(state.pending_meetings)) {
    if (time.tick !== mtg.scheduledTick) {
      console.log(`  🏛 [${vid}] Pending meeting "${mtg.description}" scheduledTick=${mtg.scheduledTick}, current tick=${time.tick}`);
      continue;
    }
    ringVillageBell(state, time, vid);
    console.log(`  🏛 [${vid}] FIRING meeting "${mtg.description}" — checking quorum...`);
    const result = await runMeetingPhase(state, time, vid);
    for (const a of result.attendees) meetingAttendees.add(a);
    if (result.log) meetingLog = result.log; // last village's log wins for tick log
    console.log(`  🏛 [${vid}] Done — ${result.attendees.size} attendees excluded from normal tick`);

    // Next assembly auto-scheduled by the top-of-tick loop (no pending → schedules +5)
  }

  // ── 5. BUILD PERCEPTIONS ─────────────────────────────────────
  // NPCs only: the human player never goes through an LLM call (they act via /api/player/action).
  const activeAgents = getNpcNames().filter(a =>
    !isAgentDead(state.body[a]) &&
    !(state.banned?.[a] != null && time.tick < state.banned[a]!) &&
    !meetingAttendees.has(a)   // meeting attendees already acted this tick
  );

  // Build a single pass of sounds based on LAST tick's logged actions (use state objects as proxy)
  const lastTickActions: Record<AgentName, ResolvedAction[]> = {} as Record<AgentName, ResolvedAction[]>;
  for (const agent of activeAgents) lastTickActions[agent] = [];

  const perceptions: Record<AgentName, string> = {} as Record<AgentName, string>;

  for (const agent of activeAgents) {
    const location = state.agent_locations[agent];

    const othersPresent = [
      ...activeAgents.filter(a => a !== agent && state.agent_locations[a] === location),
      ...playerAt(state, location),
    ].map(a => describeAgent(a, agent, state));

    // In harness mode, messages are delivered in buildSeedContext — don't consume them here
    const pendingMessages = process.env.USE_HARNESS === "true" ? "" : deliverMessages(state, agent, tick);
    const sounds = getSounds(agent, location, lastTickActions, state.agent_locations);

    perceptions[agent] = buildPerception(
      agent, state, time,
      playerSpeechText(state, location, tick), // conversationSoFar — player speech due now; NPC speech joins during multi-agent rounds
      othersPresent,
      pendingMessages,
      sounds,
    );
  }

  // ── 6. DECISION PHASE — group by location for conversation ──
  const byLocation: Map<string, AgentName[]> = new Map();
  for (const agent of activeAgents) {
    const loc = state.agent_locations[agent];
    if (!byLocation.has(loc)) byLocation.set(loc, []);
    byLocation.get(loc)!.push(agent);
  }

  const locationList = [...byLocation.keys()];
  console.log(`  Agents: ${activeAgents.length} active across ${locationList.length} locations`);

  // Shared across all rounds this tick — one move per agent per hour
  const movedThisTick = new Set<AgentName>();

  // Process all locations in parallel — each location's agents are independent
  const locationResults = await Promise.all(
    [...byLocation.entries()].map(async ([location, group]) => {
      const locResults: AgentTurnResult[] = [];
      let locationRounds: unknown[] = [];

      if (process.env.USE_HARNESS === "true") {
        // ── Harness path: each agent gets its own tool-calling loop ──
        const results = await runHarnessLocation(group, state, time, movedThisTick, getLastTickActions());
        locResults.push(...results);
        // Populate rounds with real per-agent action data (mirrors non-harness format)
        locationRounds = results.map(r => ({
          agent: r.agent,
          toolCalls: r.historyLines ? Math.floor(r.historyLines.length / 2) : 0,
          actions: r.actions.map(a => ({
            type: a.type,
            ...(a.text ? { text: a.text.slice(0, 120) } : {}),
            ...(a.result ? { result: a.result.slice(0, 120) } : {}),
            ...(a.location ? { location: a.location } : {}),
          })),
        }));
      } else if (group.length === 1) {
        // Solo — single LLM call
        const agent = group[0]!;
        const result = await runBatchedAgents([agent], perceptions, state, time, 5, movedThisTick);
        locResults.push(...result);
        locationRounds = [result.map(r => ({ agent: r.agent, actions: r.actions.map(a => ({ type: a.type, text: a.text, result: a.result })) }))];
      } else {
        // Multi-agent conversation: up to 4 rounds, max 4 participants
        const participants = group.slice(0, 4);
        const observers = group.slice(4);
        let conversationSoFar = playerSpeechText(state, location, tick);

        for (let round = 0; round < 4; round++) {
          const alreadyProducing = new Set(
            locResults
              .filter(r => r.actions.some(a => a.type === "produce"))
              .map(r => r.agent)
          );

          const roundPerceptions: Record<AgentName, string> = {} as Record<AgentName, string>;
          for (const agent of participants) {
            const othersPresent = [...participants.filter(a => a !== agent), ...playerAt(state, location)]
              .map(a => describeAgent(a, agent, state));
            const pendingMessages = round === 0 ? deliverMessages(state, agent, tick) : "";
            const sounds = getSounds(agent, location, lastTickActions, state.agent_locations);
            let perception = buildPerception(
              agent, state, time, conversationSoFar, othersPresent, pendingMessages, sounds,
            );
            if (round > 0 && alreadyProducing.has(agent)) {
              perception += "\n[Hinweis] Du hast diese Runde schon eine Herstellung vorgemerkt. Stelle nicht noch einmal her.";
            }
            roundPerceptions[agent] = perception;
          }

          const roundResults = await runBatchedAgents(participants, roundPerceptions, state, time, 5, movedThisTick);
          locResults.push(...roundResults);

          for (const r of roundResults) {
            for (const action of r.actions) {
              if (action.visible && action.result) {
                conversationSoFar += `${action.result}\n`;
              }
            }
          }

          locationRounds.push(
            roundResults.map(r => ({ agent: r.agent, actions: r.actions.map(a => ({ type: a.type, text: a.text, result: a.result })) }))
          );

          const anyAction = roundResults.some(r =>
            r.actions.some(a => a.type === "speak" || a.type === "move_to")
          );
          if (!anyAction && round > 0) break;
        }

        if (observers.length > 0) {
          const obsPerceptions: Record<AgentName, string> = {} as Record<AgentName, string>;
          for (const agent of observers) {
            const othersPresent = [...group.filter(a => a !== agent), ...playerAt(state, location)]
              .map(a => describeAgent(a, agent, state));
            const pendingMessages = deliverMessages(state, agent, tick);
            obsPerceptions[agent] = buildPerception(agent, state, time, conversationSoFar, othersPresent, pendingMessages, []);
          }
          const obsResults = await runBatchedAgents(observers, obsPerceptions, state, time, 5, movedThisTick);
          locResults.push(...obsResults);
        }
      }

      return { location, group, locResults, locationRounds };
    })
  );

  const allResults: AgentTurnResult[] = [];
  const tickLocations: Record<string, { agents: string[]; rounds: unknown[] }> = {};
  for (const { location, group, locResults, locationRounds } of locationResults) {
    allResults.push(...locResults);
    tickLocations[location] = { agents: group, rounds: locationRounds };
  }

  // What NPCs said at the player's spot becomes part of the player's perception.
  recordHeardSpeech(state, allResults);

  // The player's queued actions (produce etc.) flow through the same resolution below as NPC results.
  // They were already emitted to SSE live and the player has no memory file, so the memory/SSE
  // loops further down skip PLAYER_ID.
  const { turn: playerTurn, moves: playerMoves } = drainPlayerTurn(state, tick);
  if (playerTurn) {
    allResults.push(playerTurn);
    const here = state.agent_locations[PLAYER_ID];
    const entry = (tickLocations[here] ??= { agents: [], rounds: [] });
    if (!entry.agents.includes(PLAYER_ID)) entry.agents.push(PLAYER_ID);
    entry.rounds.push([{
      agent: PLAYER_ID,
      actions: playerTurn.actions.map(a => ({
        type: a.type,
        ...(a.text ? { text: a.text.slice(0, 120) } : {}),
        ...(a.result ? { result: a.result.slice(0, 120) } : {}),
        ...(a.location ? { location: a.location } : {}),
      })),
    }]);
  }

  // Persist resolved actions for next tick's harness look_around() sounds
  setLastTickActions(Object.fromEntries(allResults.map(r => [r.agent, r.actions])));

  // ── 7. SOCIAL RESOLUTION ────────────────────────────────────
  // Capture from-locations before applying moves (for accurate tick log)
  const moveFromLocations: Partial<Record<AgentName, string>> = {};
  for (const result of allResults) {
    if (result.pendingMove) {
      moveFromLocations[result.agent] = state.agent_locations[result.agent];
      state.agent_locations[result.agent] = result.pendingMove;
    }
  }

  updateAcquaintances(allResults, state);

  // ── 8. ECONOMIC RESOLUTION ──────────────────────────────────
  resolveProduction(allResults, state, time);
  resolveMarketplace(allResults, state, time);
  clampReservations(state);
  resolveBarter(allResults, state, time);
  resolveHiredWages(state, time);
  applyPlayerSoftDeath(state); // before checkStarvation: the player is revived instead of dying
  checkStarvation(state, time);

  // ── 8b. MARKETPLACE HINT ────────────────────────────────────
  // Agents speak German now — match German trade vocabulary as well as the English words.
  const TRADE_WORDS = /\b(sell|buy|purchase|marketplace|post.?order|buy.?item|price|coins?|\w*kauf\w*|verkauf\w*|tausch\w*|tauschbrett|preis\w*|groschen|angebot\w*|handel\w*)\b/i;
  for (const result of allResults) {
    if (state.agent_locations[result.agent] !== HUB_LOCATION) continue;
    const spokeAboutTrade = result.actions.some(a => a.type === "speak" && TRADE_WORDS.test(a.text ?? ""));
    if (!spokeAboutTrade) continue;
    const usedMarket = result.actions.some(a => a.type === "post_order" || a.type === "buy_item");
    if (usedMarket) continue;
    feedbackToAgent(result.agent, state, `[Hinweis] Du bist auf dem ${HUB_LOCATION}. Nutze post_order, um Waren am Tauschbrett anzubieten, oder buy_item, um dort zu kaufen. Darüber zu reden, schließt keinen Handel ab.`);
  }


  // ── 9. MEMORY + PERSISTENCE ─────────────────────────────────
  const byLocationForMemory: Record<AgentName, AgentName[]> = {} as Record<AgentName, AgentName[]>;
  for (const agent of activeAgents) {
    const loc = state.agent_locations[agent];
    byLocationForMemory[agent] = [
      ...activeAgents.filter(a => a !== agent && state.agent_locations[a] === loc),
      ...playerAt(state, loc),
    ];
  }

  for (const result of allResults) {
    if (result.agent === PLAYER_ID) continue; // no memory file for the human player
    const others = byLocationForMemory[result.agent]?.map(a => getDisplayName(a)) ?? [];
    updateAgentMemoryFromActions(result.agent, time, state.agent_locations[result.agent], others, result.actions, result.historyLines);
    updateRelationships(result.agent, result.actions, others);
  }

  // ── 10. ECONOMY SNAPSHOT ────────────────────────────────────
  takeEconomySnapshot(state, time);

  // ── 11. UPDATE TICK COUNTER ─────────────────────────────────
  state.current_tick = tick;
  state.current_time = time.timeLabel;

  // ── 12. WRITE STATE ─────────────────────────────────────────
  writeWorldState(state);

  const tickLog: TickLog = {
    tick,
    simulated_time: time.timeLabel,
    season: time.season,
    weather: state.weather,
    locations: tickLocations,
    movements: allResults
      .filter(r => r.pendingMove && r.pendingMove !== (moveFromLocations[r.agent] ?? r.pendingMove))
      .map(r => ({ agent: r.agent, from: moveFromLocations[r.agent] ?? "", to: r.pendingMove! }))
      .concat(playerMoves.map(m => ({ agent: PLAYER_ID, from: m.from, to: m.to }))),
    trades: (state.marketplaces
      ? Object.values(state.marketplaces).flatMap(m => m.history)
      : state.marketplace.history
    ).filter(t => t.tick === tick),
    productions: state.production_log.filter(e => e.tick === tick),
    ...(meetingLog ? { meeting: meetingLog } : {}),
  };
  writeTickLog(tick, tickLog);

  // ── 13. SSE EMIT RESULTS ─────────────────────────────────────
  for (const result of allResults) {
    if (result.agent === PLAYER_ID) continue; // player actions were emitted live in player.ts
    const loc = state.agent_locations[result.agent];
    for (const action of result.actions) {
      if (!action.visible || !action.result) continue;
      if (action.type === "move_to") continue; // already emitted live in agent-runner
      emitSSE("agent:action", {
        agent: result.agent,
        actionType: action.type,
        text: action.text,
        result: action.result,
        location: loc,
      });
    }
  }
  emitPlayerUpdate(state, tick);
  for (const trade of tickLog.trades) {
    emitSSE("trade:completed", trade);
  }
  for (const prod of tickLog.productions) {
    emitSSE("production:done", prod);
  }
  const latestSnapshot = state.economy_snapshots[state.economy_snapshots.length - 1];
  if (latestSnapshot?.tick === tick) {
    emitSSE("economy:snapshot", { snapshot: latestSnapshot });
  }

  // ── 14. CONSOLE SUMMARY ─────────────────────────────────────
  const stats = getLLMStats();
  const trades = tickLog.trades.length;
  const prods = tickLog.productions.length;
  console.log(`  Calls: ${stats.totalCalls} | Trades: ${trades} | Productions: ${prods}`);
  if (time.isFirstTickOfDay) console.log(`  ${getEconomySummary(state)}`);
}

// ─── Simulation loop ──────────────────────────────────────────

export async function runSimulation(startTick?: number, tickOnce = false): Promise<void> {
  const state = readWorldState();
  let tick = startTick ?? state.current_tick + 1;

  console.log(`\nSchlackental — Mining Colony Economy Simulation`);
  console.log(`Starting at tick ${tick} (${tickToTime(tick).timeLabel})\n`);

  while (true) {
    await runTick(tick);
    if (tickOnce) break;

    // Stop if everyone is dead
    const state2 = readWorldState();
    const anyAlive = getNpcNames().some(a => !isAgentDead(state2.body[a]));
    if (!anyAlive) {
      console.log("\n  ⚰  All agents have died. Simulation halted.");
      break;
    }

    tick++;
    await new Promise(r => setTimeout(r, 100));
  }
}
