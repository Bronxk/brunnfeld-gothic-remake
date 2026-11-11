/**
 * Colonist barks (Sprüche): hand-written one-liners shown as speech bubbles in the viewer.
 *
 * Zero tokens, viewer-only flavour: barks NEVER enter agent memory, perception, feedback or
 * prompts (the LLM did not choose those words). Nothing in this module writes into the world state.
 *
 *  - ambient barks: engine calls emitTickBarks() once per tick → SSE "agent:bark"
 *  - click barks:   POST /api/agents/<id>/bark → clickBark() → HTTP response (no SSE)
 *
 * Content lives in barks-pool.ts, the contract in barks-types.ts.
 */

import type { WarEvent, WorldState } from "./types.js";
import type { BarkEvent, BarkKind, BarkLevel, BarkRole } from "./barks-types.js";
import { BARK_ROLES } from "./barks-types.js";
import { BARK_POOL } from "./barks-pool.js";
import { emitSSE } from "./events.js";
import { emitSimControl } from "./sim-control.js";
import { isAgentDead } from "./body.js";
import { isBaseLocation, HUB_LOCATION } from "./village-map.js";
import { peekRelation, villageName, locationVillage } from "./war.js";
import type { Rng } from "./war.js";
import {
  PLAYER_ID, getAgentNames, getAgentVillage, getCouncilMembers, getDisplayName, getLocationType,
  getSkill, getVillageElder, getVillageMembers, getVillageTownHall, getVillages, isRoadLocation,
  resolveAgentName,
} from "./world-registry.js";

// ─── Level (observer setting) ────────────────────────────────

const DEFAULT_LEVEL: BarkLevel = 1;
let level: BarkLevel | null = null;

function isBarkLevel(v: unknown): v is BarkLevel {
  return v === 0 || v === 1 || v === 2;
}

/** Initial level from env BARK_LEVEL ("0"|"1"|"2"), read lazily (dotenv may load after module eval). */
export function getBarkLevel(): BarkLevel {
  if (level === null) {
    const raw = process.env.BARK_LEVEL;
    if (raw === undefined || raw === "") {
      level = DEFAULT_LEVEL;
    } else if (raw === "0" || raw === "1" || raw === "2") {
      level = Number(raw) as BarkLevel;
    } else {
      console.warn(`[barks] Ungültiger BARK_LEVEL "${raw}" — erwartet 0, 1 oder 2. Nehme ${DEFAULT_LEVEL}.`);
      level = DEFAULT_LEVEL;
    }
  }
  return level;
}

export function setBarkLevel(next: BarkLevel): void {
  if (!isBarkLevel(next)) throw new Error("Ungültige Sprüche-Stufe: erwartet 0, 1 oder 2.");
  level = next;
  emitSimControl();
}

// ─── Seeded PRNG ─────────────────────────────────────────────

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG, returns floats in [0, 1). */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function barkRng(tick: number): Rng {
  return mulberry32(hashString(`schlackental-barks|${tick}`));
}

// ─── In-memory per-agent state (history, cooldown, pending raid results) ─────

interface HistoryEntry { tick: number; text: string }
const history = new Map<string, HistoryEntry[]>();
/** Last tick an ambient bark was emitted per agent (click barks have no cooldown). */
const lastAmbient = new Map<string, number>();
/** Raid outcome an agent still shouts after the fight (consumed within the next two ticks). */
const pendingResults = new Map<string, {
  setTick: number; kind: "krieg_sieg" | "krieg_niederlage"; gegner: string;
  /** Tick in which the outcome was shouted (a re-run of that tick still sees it). */
  usedTick?: number;
}>();
const HISTORY_KEEP = 3;
const RESULT_WINDOW_TICKS = 2;

/** Test helper: forget history, cooldowns and pending results. */
export function resetBarkState(): void {
  history.clear();
  lastAmbient.clear();
  pendingResults.clear();
}

function recentTexts(agent: string, beforeTick = Infinity): string[] {
  return (history.get(agent) ?? []).filter(h => h.tick < beforeTick).map(h => h.text);
}

/** `replaceFromTick`: entries of this tick or later belong to an earlier run of the same tick and are dropped. */
function remember(agent: string, tick: number, text: string, replaceFromTick = false): void {
  const kept = replaceFromTick ? (history.get(agent) ?? []).filter(h => h.tick < tick) : [...(history.get(agent) ?? [])];
  kept.push({ tick, text });
  history.set(agent, kept.slice(-HISTORY_KEEP));
}

// ─── Roles ───────────────────────────────────────────────────

const ROLE_SET = new Set<string>(BARK_ROLES);

function homeVillageId(state: WorldState, agent: string): string {
  return state.economics[agent]?.villageId ?? getAgentVillage(agent);
}

/** Preference order: vogt > rottmeister (council) > own craft. Never "any". */
export function barkRole(state: WorldState, agent: string): BarkRole[] {
  const village = homeVillageId(state, agent);
  const roles: BarkRole[] = [];
  if (getVillageElder(village) === agent) roles.push("vogt");
  if (getCouncilMembers(village).includes(agent)) roles.push("rottmeister");
  const skill = state.economics[agent]?.skill ?? getSkill(agent);
  if (skill !== "none" && ROLE_SET.has(skill)) roles.push(skill);
  return roles;
}

// ─── Line selection ──────────────────────────────────────────

/** Fills {dorf}/{gegner}; lines whose placeholder cannot be filled are dropped. */
function fillLines(lines: readonly string[] | undefined, dorf: string | undefined, gegner: string | undefined): string[] {
  const out: string[] = [];
  for (const line of lines ?? []) {
    if (line.includes("{gegner}") && !gegner) continue;
    if (line.includes("{dorf}") && !dorf) continue;
    out.push(line.split("{dorf}").join(dorf ?? "").split("{gegner}").join(gegner ?? ""));
  }
  return out;
}

const ROLE_CHANCE = 0.7;

function pickIndex(n: number, rng: Rng): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

/** Pure selection (no history writes). `recent` = the speaker's last barks, oldest first. */
const MENTIONS_VOGT = /\bVogt\b/;

function pickBarkLine(
  state: WorldState, agent: string, kind: BarkKind, rng: Rng, gegner: string | undefined, recent: readonly string[],
): string | null {
  const poolForKind = BARK_POOL[kind];
  if (!poolForKind) return null;
  const dorf = villageName(homeVillageId(state, agent));

  const roles = barkRole(state, agent);
  // The Vogt does not talk about "the Vogt" in the third person (Vogtei/Vogtamt are fine).
  const anyLines = fillLines(poolForKind.any, dorf, gegner)
    .filter(l => !roles.includes("vogt") || !MENTIONS_VOGT.test(l));
  let rolePool: string[] = [];
  for (const role of roles) {
    const lines = fillLines(poolForKind[role as Exclude<BarkRole, "any">], dorf, gegner);
    if (lines.length > 0) { rolePool = lines; break; }
  }
  const pools = rolePool.length > 0 && rng() < ROLE_CHANCE ? [rolePool, anyLines] : [anyLines, ...(rolePool.length > 0 ? [rolePool] : [])];

  // Avoid the last 3 barks if possible, then only the very last one, then accept a repeat.
  for (const avoidN of [HISTORY_KEEP, 1, 0]) {
    const avoid = avoidN === 0 ? [] : recent.slice(-avoidN);
    for (const pool of pools) {
      const fresh = pool.filter(l => !avoid.includes(l));
      if (fresh.length > 0) return fresh[pickIndex(fresh.length, rng)]!;
    }
  }
  return null;
}

/** One line for `agent` and `kind`, or null if nothing usable. Remembers it in the speaker's history. */
export function pickBark(state: WorldState, agent: string, kind: BarkKind, rng: Rng, gegner?: string): string | null {
  const text = pickBarkLine(state, agent, kind, rng, gegner, recentTexts(agent));
  if (text !== null) remember(agent, state.current_tick ?? 0, text);
  return text;
}

// ─── Shared state lookups ────────────────────────────────────

function isLiving(state: WorldState, agent: string): boolean {
  const body = state.body[agent];
  return !!body && !!state.economics[agent] && !isAgentDead(body);
}

function medianWallet(state: WorldState, villageId: string): number {
  const wallets = getVillageMembers(villageId)
    .filter(a => a !== PLAYER_ID && isLiving(state, a))
    .map(a => state.economics[a]!.wallet)
    .sort((a, b) => a - b);
  if (wallets.length === 0) return 0;
  const mid = Math.floor(wallets.length / 2);
  return wallets.length % 2 ? wallets[mid]! : (wallets[mid - 1]! + wallets[mid]!) / 2;
}

const RICH_FACTOR = 3;
const RICH_FLOOR = 20;   // a purse of 7 is not "rich" just because the median is 2
const POOR_WALLET = 3;

/** Own village's strongest conflict: war beats tension. Returns the other village's display name. */
function conflictOf(state: WorldState, villageId: string): { stance: "krieg" | "spannung"; gegner: string } | null {
  let tension: string | null = null;
  for (const v of getVillages()) {
    if (v.id === villageId) continue;
    const stance = peekRelation(state, villageId, v.id)?.stance;
    if (stance === "krieg") return { stance: "krieg", gegner: villageName(v.id) };
    if (stance === "spannung" && tension === null) tension = villageName(v.id);
  }
  return tension === null ? null : { stance: "spannung", gegner: tension };
}

const BAD_WEATHER = /(regen|gewitter|schnee|frost|kälte|sturm|asche|(^|[^a-zäöüß])eis([^a-zäöüß]|$))/i;
const OUTSIDE_TYPES = new Set(["square", "farm", "forest", "merchant"]);

function isBadWeather(weather: string | undefined): boolean {
  return !!weather && BAD_WEATHER.test(weather);
}

function isOutside(loc: string): boolean {
  if (isRoadLocation(loc)) return true;
  const type = getLocationType(loc);
  return type !== undefined && OUTSIDE_TYPES.has(type);
}

function isJailed(state: WorldState, agent: string, tick: number): boolean {
  const until = state.banned?.[agent];
  return until != null && tick < until;
}

function bottomKind(state: WorldState, agent: string): BarkKind {
  const body = state.body[agent];
  const wallet = state.economics[agent]?.wallet ?? 0;
  return (body && body.hunger >= 2) || wallet <= 10 ? "abweisen" : "gruss";
}

// ─── Click barks ─────────────────────────────────────────────

const FALLTHROUGH_CHANCE = 0.25;
/** A prisoner or a marcher answering "Tach" would not fit: these never fall through. */
const NO_FALLTHROUGH = new Set<BarkKind>(["karzer", "krieg_marsch"]);

/**
 * Context-fitting bark when the observer clicks a colonist. Works at every level, no cooldown.
 * Returns null for the player, dead or unknown agents (or when the pool has nothing usable).
 */
export function clickBark(state: WorldState, agent: string, rng: Rng = Math.random): { text: string; kind: BarkKind } | null {
  if (agent === PLAYER_ID || !isLiving(state, agent)) return null;
  const body = state.body[agent]!;
  const eco = state.economics[agent]!;
  const tick = state.current_tick ?? 0;
  const loc = state.agent_locations[agent];
  const village = homeVillageId(state, agent);

  const matches: { kind: BarkKind; gegner?: string }[] = [];
  const march = state.war_marches?.[agent];
  const conflict = conflictOf(state, village);

  if (isJailed(state, agent, tick)) matches.push({ kind: "karzer" });
  if (march) matches.push({ kind: "krieg_marsch", gegner: villageName(march.target) });
  if ((body.injury ?? 0) > 0) matches.push({ kind: "verletzt" });
  if ((body.sickness ?? 0) > 0) matches.push({ kind: "krank" });
  if (body.hunger >= 3) matches.push({ kind: "hunger" });
  if (body.energy <= 2) matches.push({ kind: "erschoepft" });
  if (conflict) matches.push({ kind: conflict.stance === "krieg" ? "krieg_verteidigung" : "spannung", gegner: conflict.gegner });
  if (loc && eco.workLocation === loc && !isBaseLocation(loc, HUB_LOCATION)) matches.push({ kind: "arbeit" });
  if (loc && isBaseLocation(loc, HUB_LOCATION) && locationVillage(loc) === village) matches.push({ kind: "markt" });
  if (eco.wallet <= POOR_WALLET) matches.push({ kind: "arm" });
  const median = medianWallet(state, village);
  if (eco.wallet >= RICH_FLOOR && eco.wallet >= RICH_FACTOR * median) matches.push({ kind: "reich" });

  const bottomStart = matches.length;
  const bottom = bottomKind(state, agent);
  matches.push({ kind: bottom });
  if (bottom !== "gruss") matches.push({ kind: "gruss" });

  let start = 0;
  if (bottomStart > 0 && !NO_FALLTHROUGH.has(matches[0]!.kind) && rng() < FALLTHROUGH_CHANCE) start = bottomStart;

  const recent = recentTexts(agent);
  for (let i = start; i < matches.length; i++) {
    const m = matches[i]!;
    const text = pickBarkLine(state, agent, m.kind, rng, m.gegner, recent);
    if (text !== null) {
      remember(agent, tick, text);
      return { text, kind: m.kind };
    }
  }
  return null;
}

// ─── Ambient barks (once per tick) ───────────────────────────

/** A resolved raid of this tick, as far as barks care. */
export interface BarkRaid {
  attackerVillage: string;
  targetVillage: string;
  raiders: string[];
  defenders: string[];
  success: boolean;
}

export interface BarkTheft {
  thief: string;
  victim: string;
  /** Where it happened (the thief's location before any move this tick). */
  location: string;
  /** Caught in the act (witnesses saw it); otherwise only the victim notices. */
  caught: boolean;
}

/** What the engine knows this tick. Build it with the helpers below; all lists may be empty. */
export interface TickBarkContext {
  hour: number;
  weather: string;
  raids: BarkRaid[];
  thefts: BarkTheft[];
  /** Agents who produced at their workplace this tick (production_log). */
  producers: string[];
  /** Buyers and sellers of trades at the Tauschbrett this tick (marketplace history). */
  traders: string[];
  /** Village ids whose Appell bell rang this tick. */
  appellVillages: string[];
}

export function emptyTickBarkContext(hour = 12, weather = ""): TickBarkContext {
  return { hour, weather, raids: [], thefts: [], producers: [], traders: [], appellVillages: [] };
}

interface LevelConfig { cap: number; cooldown: number; stateChance: number; ambientChance: number }
const LEVELS: Record<1 | 2, LevelConfig> = {
  1: { cap: 3, cooldown: 4, stateChance: 0.4, ambientChance: 0.12 },
  2: { cap: 8, cooldown: 2, stateChance: 0.7, ambientChance: 0.3 },
};

/** Priorities: higher wins the per-tick slots. */
const PRIO: Record<BarkKind, number> = {
  krieg_angriff: 100, krieg_verteidigung: 100,
  krieg_sieg: 95, krieg_niederlage: 95,
  krieg_marsch: 90,
  dieb: 85,
  karzer: 80,
  fremder: 75,
  appell: 70,
  verletzt: 65,
  hunger: 62,
  krank: 60,
  erschoepft: 50,
  arbeit: 45, markt: 45,
  wetter: 40,
  spannung: 35,
  nacht: 30, arm: 30, reich: 30,
  gruss: 10, abweisen: 10,
};

/** Kinds a lone colonist may shout; everything else needs a listener at the same location. */
const ALONE_OK = new Set<BarkKind>([
  "karzer", "verletzt", "krank", "hunger", "erschoepft", "wetter", "nacht",
  "krieg_marsch", "krieg_angriff", "krieg_verteidigung", "krieg_sieg", "krieg_niederlage",
]);

/** A raid and its outcome are rare, so they ignore the per-agent cooldown (still one bark per agent and tick). */
const WAR_MOMENTS = new Set<BarkKind>(["krieg_angriff", "krieg_verteidigung", "krieg_sieg", "krieg_niederlage"]);

const NIGHT_FROM_HOUR = 20; // the day runs 06–21 and nobody sleeps in the model: "late" is the last two hours

interface Cand {
  agent: string;
  kind: BarkKind;
  prio: number;
  chance: number;
  gegner?: string;
}

/** Per-agent candidate list, highest priority first. Rolls happen in the caller. */
function candidatesFor(
  state: WorldState, tick: number, agent: string, ctx: TickBarkContext, cfg: LevelConfig,
  env: {
    occupants: Map<string, string[]>;
    raidRole: Map<string, { kind: "krieg_angriff" | "krieg_verteidigung"; gegner: string }>;
    thiefVictims: Map<string, { chance: number }>;
    producers: Set<string>; traders: Set<string>; bells: Set<string>;
    medians: Map<string, number>;
  },
): Cand[] {
  const out: Cand[] = [];
  const add = (kind: BarkKind, chance: number, gegner?: string) => out.push({ agent, kind, prio: PRIO[kind], chance, gegner });

  const body = state.body[agent]!;
  const eco = state.economics[agent]!;
  const loc = state.agent_locations[agent];
  const village = homeVillageId(state, agent);
  const march = state.war_marches?.[agent];
  const listeners = (env.occupants.get(loc) ?? []).filter(a => a !== agent);

  // Events
  const raid = env.raidRole.get(agent);
  if (raid) add(raid.kind, 1, raid.gegner);
  const pending = pendingResults.get(agent);
  if (pending && pending.setTick < tick && tick - pending.setTick <= RESULT_WINDOW_TICKS
    && (pending.usedTick === undefined || pending.usedTick >= tick)) add(pending.kind, 1, pending.gegner);
  if (march?.phase === "hin") add("krieg_marsch", 0.5, villageName(march.target));
  if (march) return finish(out, listeners.length > 0); // marchers only shout war

  const theft = env.thiefVictims.get(agent);
  if (theft) add("dieb", theft.chance);
  const stranger = listeners.find(a => homeVillageId(state, a) !== village && locationVillage(loc) === village);
  if (stranger) add("fremder", 0.5, villageName(homeVillageId(state, stranger)));
  if (env.bells.has(village) && loc === getVillageTownHall(village)) add("appell", 0.6);

  // States
  const sc = cfg.stateChance;
  if (isJailed(state, agent, tick)) add("karzer", sc);
  if ((body.injury ?? 0) > 0) add("verletzt", sc);
  if ((body.sickness ?? 0) > 0) add("krank", sc);
  if (body.hunger >= 4) add("hunger", sc);
  if (body.energy <= 2) add("erschoepft", sc);
  if (isBadWeather(ctx.weather) && isOutside(loc)) add("wetter", sc);
  if (ctx.hour >= NIGHT_FROM_HOUR) add("nacht", sc);
  if (env.producers.has(agent)) add("arbeit", sc);
  if (env.traders.has(agent)) add("markt", sc);
  else if (isBaseLocation(loc, HUB_LOCATION) && locationVillage(loc) === village) add("markt", sc * 0.5);
  if (eco.wallet <= POOR_WALLET) add("arm", sc);
  const median = env.medians.get(village) ?? 0;
  if (eco.wallet >= RICH_FLOOR && eco.wallet >= RICH_FACTOR * median) add("reich", sc);
  const conflict = conflictOf(state, village);
  if (conflict) add("spannung", sc, conflict.gegner);

  // Small talk
  add(bottomKind(state, agent), cfg.ambientChance);

  return finish(out, listeners.length > 0);
}

function finish(cands: Cand[], hasListener: boolean): Cand[] {
  return cands
    .filter(c => ALONE_OK.has(c.kind) || c.kind === "dieb" || hasListener)
    .sort((a, b) => b.prio - a.prio);
}

/**
 * Ambient barks for this tick. Emits nothing and never writes into the world state; only the
 * module's cooldown/history/pending-result maps change. The same tick and state give the same
 * barks (entries of this tick or later in those maps belong to an earlier run and are ignored).
 */
export function collectTickBarks(state: WorldState, tick: number, ctx: TickBarkContext): BarkEvent[] {
  const lvl = getBarkLevel();
  if (lvl === 0) return [];
  const cfg = LEVELS[lvl];
  const rng = barkRng(tick);

  const living = getAgentNames().filter(a => a !== PLAYER_ID && isLiving(state, a) && state.agent_locations[a] !== undefined);

  // Everyone alive (the observer included) counts as a listener at their location.
  const occupants = new Map<string, string[]>();
  for (const a of getAgentNames()) {
    if (!isLiving(state, a)) continue;
    const loc = state.agent_locations[a];
    if (loc === undefined) continue;
    const list = occupants.get(loc);
    if (list) list.push(a); else occupants.set(loc, [a]);
  }

  // Raids: battle cries now, the outcome shouted in the next ticks (also while marching home).
  const raidRole = new Map<string, { kind: "krieg_angriff" | "krieg_verteidigung"; gegner: string }>();
  for (const raid of ctx.raids) {
    const attacker = villageName(raid.attackerVillage);
    const target = villageName(raid.targetVillage);
    for (const a of raid.raiders) {
      raidRole.set(a, { kind: "krieg_angriff", gegner: target });
      pendingResults.set(a, { setTick: tick, kind: raid.success ? "krieg_sieg" : "krieg_niederlage", gegner: target });
    }
    for (const a of raid.defenders) {
      raidRole.set(a, { kind: "krieg_verteidigung", gegner: attacker });
      pendingResults.set(a, { setTick: tick, kind: raid.success ? "krieg_niederlage" : "krieg_sieg", gegner: attacker });
    }
  }
  for (const [a, p] of pendingResults) if (tick - p.setTick > RESULT_WINDOW_TICKS) pendingResults.delete(a);

  // Thefts: the victim always notices, witnesses only when the thief was caught.
  const thiefVictims = new Map<string, { chance: number }>();
  for (const t of ctx.thefts) {
    thiefVictims.set(t.victim, { chance: 1 });
    if (!t.caught) continue;
    for (const w of occupants.get(t.location) ?? []) {
      if (w !== t.thief && w !== t.victim && !thiefVictims.has(w)) thiefVictims.set(w, { chance: 0.6 });
    }
  }

  const medians = new Map<string, number>();
  for (const v of getVillages()) medians.set(v.id, medianWallet(state, v.id));

  const env = {
    occupants, raidRole, thiefVictims, medians,
    producers: new Set(ctx.producers), traders: new Set(ctx.traders), bells: new Set(ctx.appellVillages),
  };

  // One candidate per agent: the highest-priority one whose chance roll succeeds.
  const chosen: (Cand & { tie: number })[] = [];
  for (const agent of living) {
    const last = lastAmbient.get(agent);
    const cooling = last !== undefined && last < tick && tick - last < cfg.cooldown;
    for (const c of candidatesFor(state, tick, agent, ctx, cfg, env)) {
      if (cooling && !WAR_MOMENTS.has(c.kind)) continue; // only the fight itself and its outcome cut the cooldown
      if (rng() < c.chance) { chosen.push({ ...c, tie: rng() }); break; }
    }
  }
  chosen.sort((a, b) => b.prio - a.prio || a.tie - b.tie);

  const events: BarkEvent[] = [];
  for (const c of chosen) {
    if (events.length >= cfg.cap) break;
    const text = pickBarkLine(state, c.agent, c.kind, rng, c.gegner, recentTexts(c.agent, tick));
    if (text === null) continue;
    remember(c.agent, tick, text, true);
    lastAmbient.set(c.agent, tick);
    if (c.kind === "krieg_sieg" || c.kind === "krieg_niederlage") {
      const p = pendingResults.get(c.agent);
      if (p && p.setTick < tick) p.usedTick = tick;
    }
    events.push({ agent: c.agent, text, kind: c.kind, location: state.agent_locations[c.agent]!, tick });
  }
  return events;
}

/** Level 0 → nothing. Otherwise collects the tick's barks and sends each as SSE "agent:bark" (+ console line). */
export function emitTickBarks(state: WorldState, tick: number, ctx: TickBarkContext): void {
  if (getBarkLevel() === 0) return;
  for (const ev of collectTickBarks(state, tick, ctx)) {
    emitSSE("agent:bark", ev);
    console.log(`  💬 ${getDisplayName(ev.agent)} (${ev.kind}): „${ev.text}“`);
  }
}

// ─── Context builders for the engine ─────────────────────────

/** A raid group as resolveWar will form it, captured BEFORE resolveWar (it wounds and clears war_actions). */
export interface RaidSetup {
  attackerVillage: string;
  targetVillage: string;
  raiders: string[];
  defenders: string[];
}

function isFighter(state: WorldState, agent: string): boolean {
  if (agent === PLAYER_ID) return false;
  const body = state.body[agent];
  if (!body || !state.economics[agent] || isAgentDead(body)) return false;
  if (body.energy <= 0) return false;
  if (state.banned?.[agent] != null) return false;
  return true;
}

/** Mirrors the grouping in war.ts resolveWar. Call right before resolveWar. */
export function captureRaidSetup(state: WorldState, tick: number): RaidSetup[] {
  const groups = new Map<string, RaidSetup>();
  for (const [agent, a] of Object.entries(state.war_actions ?? {})) {
    if (a.kind !== "raid" || !a.target) continue;
    if (a.tick !== tick && a.tick !== tick - 1) continue;
    if (!isFighter(state, agent)) continue;
    if (locationVillage(state.agent_locations[agent]) !== a.target) continue;
    const attacker = homeVillageId(state, agent);
    const key = `${a.target}|${attacker}`;
    let g = groups.get(key);
    if (!g) {
      const defenders = getVillageMembers(a.target)
        .filter(d => isFighter(state, d) && locationVillage(state.agent_locations[d]) === a.target);
      g = { attackerVillage: attacker, targetVillage: a.target, raiders: [], defenders };
      groups.set(key, g);
    }
    g.raiders.push(agent);
  }
  return [...groups.values()];
}

/** Joins the captured groups with the raid events resolveWar returned (a group without an event did not fight). */
export function buildRaids(setups: RaidSetup[], events: WarEvent[]): BarkRaid[] {
  const raids: BarkRaid[] = [];
  for (const s of setups) {
    const ev = events.find(e => e.kind === "raid" && e.actor === s.raiders[0]);
    if (!ev) continue;
    raids.push({ ...s, success: ev.success === true });
  }
  return raids;
}

/**
 * Thefts of this tick from the resolved actions. Relies on the result texts of tools.ts `steal`
 * ("… unbemerkt mitgehen" / "… auf frischer Tat ertappt"); anything else is ignored.
 */
export function theftsFromResults(
  state: WorldState,
  results: { agent: string; actions: { type: string; target?: unknown; result?: string }[] }[],
  moveFromLocations: Partial<Record<string, string>> = {},
): BarkTheft[] {
  const thefts: BarkTheft[] = [];
  for (const r of results) {
    for (const act of r.actions) {
      if (act.type !== "steal" || !act.result) continue;
      const caught = act.result.includes("ertappt");
      if (!caught && !act.result.includes("unbemerkt")) continue;
      const victim = resolveAgentName(String(act.target ?? ""), getAgentNames());
      const location = moveFromLocations[r.agent] ?? state.agent_locations[r.agent];
      if (!victim || !location) continue;
      thefts.push({ thief: r.agent, victim, location, caught });
    }
  }
  return thefts;
}
