/**
 * Human player ("der Neue / die Neue"), agent id "player".
 *
 * The player is a regular colonist: same tool handlers (tool-registry.ts), same validation, same
 * German feedback, same engine pipeline for production/trade/body. This module only adds what a
 * human needs around that: creation, an action budget, a view of the world, and the glue that
 * feeds the player's executed actions and speech into the tick loop.
 *
 * State model: while the engine runs a tick it holds its WorldState in memory for the whole
 * (LLM-bound) tick and writes it at the end. The engine therefore publishes that object via
 * attachLiveTick(); player requests mutate it in place (the handlers are synchronous, so they
 * never interleave with the engine) and the engine's own write persists the result. Between
 * ticks (or without an engine, e.g. `npm run server`) requests read/write world_state.json.
 */

import type {
  AgentTurnResult, ResolvedAction, SimTime, Skill, WorldState, PlayerState,
} from "./types.js";
import { SKILL_LABELS } from "./types.js";
import { tickToTime } from "./time.js";
import { readWorldState, writeWorldState } from "./memory.js";
import { emitSSE } from "./events.js";
import {
  PLAYER_ID, setPlayerIdentity, getDisplayName, getNpcNames, getAgentNames, resolveAgentName,
} from "./world-registry.js";
import { HUB_LOCATION } from "./village-map.js";
import { RECIPES } from "./production.js";
import {
  getToolsForAgent, executeToolCall, getToolSummary, type HarnessToolConfig,
} from "./tool-registry.js";
import {
  createLocationContext, getLiveContext, type LocationContext,
} from "./location-context.js";
import { buildPerception, describeAgent, getProducibleHere } from "./agent-runner.js";
import { getSounds, getLastTickActions } from "./sounds.js";
import { deliverMessages } from "./messages.js";
import { feedbackToAgent } from "./inventory.js";
import { isAgentDead } from "./body.js";
import { PLAYER_WAR_REFUSAL } from "./war.js";

// ─── Constants ───────────────────────────────────────────────

/** Budgeted actions per tick (NPCs get 3–8 tool calls per tick; the player gets a flat 5). */
export const ACTION_BUDGET = 5;

export const PLAYER_START_HOME = "Baracke 6";
const REVIVE_LOCATION = "Baderhütte";
const REVIVE_COST = 10;
const MAX_TEXT_LENGTH = 240;
const HEARD_LINES = 8;
const FEEDBACK_KEEP = 6;

export const PLAYER_SKILL_CHOICES = ["bauer", "knappe", "holzfaeller", "none"] as const;
export type PlayerSkillChoice = (typeof PLAYER_SKILL_CHOICES)[number];

/** Read-only tools: they change nothing, so they do not cost budget. */
const FREE_TOOLS = new Set(["check_inventory", "assess_person"]);
/** Not offered to the player: done/think are NPC loop controls, recall needs an NPC memory file. */
const HIDDEN_TOOLS = new Set(["done", "think", "recall"]);
/** Tools whose handler already emits its own agent:action SSE. */
const SELF_EMITTING_TOOLS = new Set(["move_to", "negotiate", "fine_agent", "seize_goods"]);
/** Result tags that mean "nothing happened" (see the feedback tag table in docs/schlackental.md). */
const FAILURE_TAG = /^\[(Geht nicht|Kann nicht|Nicht essbar|Zu teuer|Dort geht's nicht hin|Kein Angebot|Verboten per Ratsbeschluss|Nicht angeheuert|Tausch gescheitert|Unbekanntes Tool)/;

export const OVER_BUDGET_TEXT = "Du bist für diese Stunde erschöpft — warte auf die nächste Stunde.";

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

// ─── Live state (published by the engine while a tick runs) ──

let live: { state: WorldState; tick: number } | null = null;
/** Moves are limited to one per hour, like NPCs (resolveAction reads this set). */
const movedThisTick = new Set<string>();

/** Engine: call right after reading the state for tick `tick`. */
export function attachLiveTick(state: WorldState, tick: number): void {
  live = { state, tick };
  syncTick(state, tick);
}

/**
 * The engine's in-memory state while a tick runs (null between ticks). Routes that mutate the
 * world (war/diplomacy) must change this object in place instead of writing world_state.json,
 * otherwise the running tick overwrites their change when it persists its own copy.
 */
export function getLiveWorldState(): { state: WorldState; tick: number } | null {
  return live;
}

/** Engine: call after the tick's state has been written (or the tick failed). */
export function detachLiveTick(): void {
  live = null;
}

interface Access {
  state: WorldState;
  /** The hour the player acts in: the running tick, or the upcoming one between ticks. */
  tick: number;
  live: boolean;
  /** Persist after mutating (no-op while the engine owns the state). */
  persist: () => void;
}

function acquire(): Access {
  if (live) return { state: live.state, tick: live.tick, live: true, persist: () => {} };
  const state = readWorldState();
  const tick = Math.max(1, state.current_tick + 1);
  syncTick(state, tick);
  return { state, tick, live: false, persist: () => writeWorldState(state) };
}

/** First touch in a new tick: reset the budget and move flag, rotate messages, trim old feedback. */
function syncTick(state: WorldState, tick: number): void {
  const p = state.player;
  if (!p?.created || p.budgetTick === tick) return;
  p.budgetTick = tick;
  p.actionsUsed = 0;
  movedThisTick.clear();
  const fb = state.action_feedback[PLAYER_ID];
  if (fb && fb.length > FEEDBACK_KEEP) state.action_feedback[PLAYER_ID] = fb.slice(-FEEDBACK_KEEP);
  const delivered = deliverMessages(state, PLAYER_ID, tick);
  p.inbox = delivered ? delivered.split("\n") : [];
}

/**
 * Why the player cannot act this hour (NPCs in the Karzer or dead are skipped by the engine), or
 * null. Read-only tools stay available.
 */
function blockedReason(state: WorldState, tick: number): string | null {
  if (isAgentDead(state.body[PLAYER_ID])) return "[Geht nicht] Du bist zu schwach, um irgendetwas zu tun.";
  const until = state.banned?.[PLAYER_ID];
  if (until != null && tick < until) {
    const hours = until - tick;
    return `[Geht nicht] Du sitzt im Karzer — noch ${hours} ${hours === 1 ? "Stunde" : "Stunden"}.`;
  }
  return null;
}

function timeOf(tick: number): SimTime {
  return tickToTime(Math.max(1, tick));
}

function clampText(value: unknown): string {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, MAX_TEXT_LENGTH);
}

// ─── Views ───────────────────────────────────────────────────

function budgetLeft(p: PlayerState | undefined): number {
  return Math.max(0, ACTION_BUDGET - (p?.actionsUsed ?? 0));
}

function peekMessages(state: WorldState, tick: number): string {
  const queued = state.message_queue[PLAYER_ID] ?? [];
  const lines: string[] = [...(state.player?.inbox ?? [])];
  if (queued.length > 0) {
    // deliverMessages empties the queue — format a copy so reading the world stays side-effect free.
    const copy = { message_queue: { [PLAYER_ID]: [...queued] } } as unknown as WorldState;
    lines.push(...deliverMessages(copy, PLAYER_ID, tick).split("\n"));
  }
  return lines.join("\n");
}

function conversationText(state: WorldState, location: string): string {
  const lines = [...(state.player?.heard ?? [])];
  const liveCtx = getLiveContext(location);
  if (liveCtx) {
    for (const s of liveCtx.speechLog) {
      const line = `${s.name} sagt: "${s.text}"`;
      if (!lines.includes(line)) lines.push(line);
    }
  }
  return lines.slice(-HEARD_LINES).join("\n");
}

/** The perception an NPC at the player's spot would get (agent-runner.buildPerception). */
function buildPlayerPerception(state: WorldState, tick: number): string {
  const location = state.agent_locations[PLAYER_ID]!;
  const others = getAgentNames()
    .filter(a => a !== PLAYER_ID && state.agent_locations[a] === location && !isAgentDead(state.body[a]))
    .map(a => describeAgent(a, PLAYER_ID, state));
  const time = timeOf(tick);
  const sounds = getSounds(PLAYER_ID, location, getLastTickActions(), state.agent_locations);
  return buildPerception(
    PLAYER_ID, state, time,
    conversationText(state, location),
    others,
    peekMessages(state, tick),
    sounds,
  );
}

/** Player state as sent to the viewer (GET /api/player, minus perception = SSE player:update). */
function viewOf(state: WorldState, tick: number, withPerception: boolean): Record<string, unknown> {
  const p = state.player;
  const eco = state.economics[PLAYER_ID];
  if (!p?.created || !eco) {
    return {
      created: false, name: "", skill: "none", location: null, body: null, wallet: 0,
      inventory: [], tool: null, producible: [], budgetLeft: 0, budget: ACTION_BUDGET,
      ...(withPerception ? { perception: "" } : {}),
    };
  }
  const view: Record<string, unknown> = {
    created: true,
    name: p.name,
    skill: p.skill,
    skillLabel: SKILL_LABELS[p.skill] ?? p.skill,
    location: state.agent_locations[PLAYER_ID],
    home: eco.homeLocation,
    work: eco.workLocation,
    body: state.body[PLAYER_ID],
    wallet: eco.wallet,
    inventory: eco.inventory.items,
    tool: eco.tool,
    /** What produce can do right here (same data as the perception's "Hier kannst du herstellen"). */
    producible: getProducibleHere(PLAYER_ID, state),
    budgetLeft: budgetLeft(p),
    budget: ACTION_BUDGET,
    tick,
    time: timeOf(tick).timeLabel,
  };
  if (withPerception) view.perception = buildPlayerPerception(state, tick);
  return view;
}

/** GET /api/player. */
export function getPlayerView(withPerception = true): Record<string, unknown> {
  const a = acquire();
  return viewOf(a.state, a.tick, withPerception);
}

/** SSE `player:update` — same shape as GET /api/player without `perception`. */
export function emitPlayerUpdate(state: WorldState, tick: number): void {
  if (!state.player?.created) return;
  emitSSE("player:update", viewOf(state, tick, false));
}

// ─── Tools ───────────────────────────────────────────────────

/** Location context for a player action: the running harness context if there is one, else a fresh one. */
function contextFor(state: WorldState): { ctx: LocationContext; viaLive: boolean } {
  const location = state.agent_locations[PLAYER_ID]!;
  const liveCtx = getLiveContext(location);
  if (liveCtx) return { ctx: liveCtx, viaLive: true };
  const ctx = createLocationContext(location);
  for (const o of state.player?.incomingOffers ?? []) {
    if (state.agent_locations[o.from] === location) ctx.negotiationOffers.push({ ...o });
  }
  return { ctx, viaLive: false };
}

function allowedTools(state: WorldState, ctx: LocationContext) {
  return getToolsForAgent(PLAYER_ID, state, ctx).filter(t => !HIDDEN_TOOLS.has(t.name));
}

/** GET /api/player/tools — what the player may use right now (same list an NPC would get, minus loop controls). */
export function getPlayerTools(): ApiResult {
  const a = acquire();
  if (!a.state.player?.created) {
    return { status: 409, body: { ok: false, error: "Du bist noch nicht in der Kolonie angekommen." } };
  }
  const { ctx } = contextFor(a.state);
  const blocked = blockedReason(a.state, a.tick) !== null;
  const tools = allowedTools(a.state, ctx).filter(t => !blocked || FREE_TOOLS.has(t.name)).map(t => ({
    name: t.name,
    description: t.description,
    argsHint: t.argsHint,
    free: FREE_TOOLS.has(t.name),
  }));
  return { status: 200, body: { tools, budgetLeft: budgetLeft(a.state.player), budget: ACTION_BUDGET } };
}

// ─── Creation ────────────────────────────────────────────────

const NAME_PATTERN = /^[\p{L}][\p{L} .'’-]*$/u;
const RESERVED_NAMES = new Set(["player", "du", "ich", "neue", "neuer", "der_neue", "die_neue"]);

function purgePlayer(state: WorldState): void {
  for (const mkt of [state.marketplace, ...Object.values(state.marketplaces ?? {})]) {
    mkt.orders = mkt.orders.filter(o => o.agentId !== PLAYER_ID);
  }
  for (const eco of Object.values(state.economics)) {
    if (eco.hiredBy === PLAYER_ID) { eco.hiredBy = undefined; eco.hiredUntilTick = undefined; }
  }
  for (const key of Object.keys(state.acquaintances)) {
    state.acquaintances[key] = (state.acquaintances[key] ?? []).filter(a => a !== PLAYER_ID);
  }
  state.loans = state.loans.filter(l => l.creditor !== PLAYER_ID && l.debtor !== PLAYER_ID);
  delete state.caughtStealing[PLAYER_ID];
  movedThisTick.clear();
}

/** POST /api/player/create. */
export function createPlayer(input: unknown): ApiResult {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const skill = (body.skill ?? "none") as string;
  const force = body.force === true;

  const fail = (status: number, error: string): ApiResult => ({ status, body: { ok: false, error } });

  if (name.length < 2 || name.length > 20) return fail(400, "Der Name muss zwischen 2 und 20 Zeichen lang sein.");
  if (!NAME_PATTERN.test(name)) return fail(400, "Der Name darf nur Buchstaben, Leerzeichen, Punkt, Bindestrich und Apostroph enthalten.");
  if (!(PLAYER_SKILL_CHOICES as readonly string[]).includes(skill)) {
    return fail(400, `Unbekanntes Handwerk "${String(skill)}". Möglich: ${PLAYER_SKILL_CHOICES.join(", ")}.`);
  }
  if (RESERVED_NAMES.has(name.toLowerCase().replace(/\s+/g, "_")) || resolveAgentName(name, getNpcNames())) {
    return fail(400, "Den Namen trägt schon jemand in der Kolonie. Such dir einen anderen.");
  }

  const a = acquire();
  const state = a.state;
  if (state.player?.created && !force) {
    return { status: 409, body: { ok: false, error: "Du bist schon in der Kolonie angekommen. Mit force: true legst du eine neue Figur an.", player: viewOf(state, a.tick, true) } };
  }
  // A new figure is not a way out of the Karzer or a fresh action budget for the same hour.
  const previous = state.player?.created ? state.player : undefined;
  if (previous) {
    const jailed = blockedReason(state, a.tick);
    if (jailed && !isAgentDead(state.body[PLAYER_ID])) {
      return { status: 409, body: { ok: false, error: `${jailed.replace(/^\[Geht nicht\] /, "")} Erst danach kannst du neu anfangen.`, player: viewOf(state, a.tick, true) } };
    }
    purgePlayer(state);
  }
  const carriedBudget = previous && previous.budgetTick === a.tick ? (previous.actionsUsed ?? 0) : 0;
  // A world reset (npm run reset) while the server runs leaves no previous player to purge.
  movedThisTick.clear();

  const chosen = skill as PlayerSkillChoice;
  const recipes = Object.values(RECIPES).filter(r => r.skill === chosen);
  const workLocation = recipes[0]?.location ?? HUB_LOCATION;
  const needsTool = recipes.some(r => r.tool);

  state.player = {
    created: true,
    name,
    skill: chosen as Skill,
    createdTick: live ? live.tick : state.current_tick,
    actionsUsed: carriedBudget,
    budgetTick: a.tick,
    pendingActions: [],
    pendingSpeech: [],
    pendingOffers: [],
    incomingOffers: [],
    heard: [],
    inbox: [],
    moveLog: [],
  };
  state.agent_locations[PLAYER_ID] = HUB_LOCATION;
  state.body[PLAYER_ID] = { hunger: 1, energy: 8, sleep_quality: "good" };
  state.economics[PLAYER_ID] = {
    wallet: 15,
    inventory: { items: [{ type: "brot", quantity: 2 }] },
    tool: needsTool ? { type: "werkzeug", durability: 100 } : null,
    skill: chosen as Skill,
    homeLocation: PLAYER_START_HOME,
    workLocation,
    workSchedule: { open: 6, close: 21 },
  };
  state.action_feedback[PLAYER_ID] = [
    `Du bist im Schlackental angekommen — gerade noch vor dem Bergsturz am Kehlpass. Deine Pritsche steht in ${PLAYER_START_HOME}.`,
  ];
  state.message_queue[PLAYER_ID] = [];
  state.acquaintances[PLAYER_ID] = [];
  setPlayerIdentity({ name, skill: chosen as Skill });
  syncTick(state, a.tick);

  a.persist();
  emitPlayerUpdate(state, a.tick);
  return { status: 200, body: { ok: true, ...viewOf(state, a.tick, true) } };
}

// ─── Actions ─────────────────────────────────────────────────

/** POST /api/player/action. */
export function performPlayerAction(tool: unknown, args: unknown): ApiResult {
  const a = acquire();
  const state = a.state;
  const p = state.player;

  if (!p?.created) {
    return { status: 409, body: { ok: false, text: "[Geht nicht] Du bist noch nicht in der Kolonie angekommen.", player: viewOf(state, a.tick, false) } };
  }
  if (typeof tool !== "string" || !tool.trim()) {
    return { status: 400, body: { ok: false, text: "[Geht nicht] Welches Tool? Gib tool an.", player: viewOf(state, a.tick, false) } };
  }
  if (args != null && (typeof args !== "object" || Array.isArray(args))) {
    return { status: 400, body: { ok: false, text: "[Geht nicht] args muss ein Objekt sein.", player: viewOf(state, a.tick, false) } };
  }
  const toolName = tool.trim();
  const toolArgs: Record<string, unknown> = { ...(args as Record<string, unknown> | null | undefined) };
  // Player text ends up in NPC prompts: one line, bounded length.
  if (typeof toolArgs.text === "string") toolArgs.text = clampText(toolArgs.text);

  // The human is an observer: war actions are refused up front, free of charge (no budget used).
  if (toolName === "ueberfallen" || toolName === "wache_halten") {
    return { status: 400, body: { ok: false, text: PLAYER_WAR_REFUSAL, player: viewOf(state, a.tick, false) } };
  }

  const { ctx, viaLive } = contextFor(state);
  const tools = allowedTools(state, ctx);
  if (!tools.some(t => t.name === toolName)) {
    const names = tools.map(t => t.name).join(", ");
    return {
      status: 400,
      body: { ok: false, text: `[Geht nicht] "${toolName}" kannst du gerade nicht benutzen. Möglich: ${names}.`, player: viewOf(state, a.tick, false) },
    };
  }

  const charged = !FREE_TOOLS.has(toolName);
  const blocked = charged ? blockedReason(state, a.tick) : null;
  if (blocked) {
    return { status: 409, body: { ok: false, text: blocked, player: viewOf(state, a.tick, false) } };
  }
  if (charged && (p.actionsUsed ?? 0) >= ACTION_BUDGET) {
    return { status: 429, body: { ok: false, text: OVER_BUDGET_TEXT, player: viewOf(state, a.tick, false) } };
  }

  p.pendingActions ??= [];
  // movedThisTick lives in memory only; after a server restart the persisted move log still counts.
  if ((p.moveLog?.length ?? 0) > 0) movedThisTick.add(PLAYER_ID);
  const config: HarnessToolConfig = {
    agentId: PLAYER_ID,
    worldState: state,
    locationCtx: ctx,
    time: timeOf(a.tick),
    movedThisTick,
    executedActions: p.pendingActions, // produce stays queued here until the engine resolves it at tick end
    lastTickActions: getLastTickActions(),
  };

  const from = state.agent_locations[PLAYER_ID]!;
  const speechBefore = ctx.speechLog.length;
  const offersBefore = new Set(ctx.negotiationOffers);
  const name = getDisplayName(PLAYER_ID);

  emitSSE("harness:tool", { agent: PLAYER_ID, name, tool: toolName, summary: getToolSummary(toolName, toolArgs) });
  const result = executeToolCall(toolName, toolArgs, config);
  const ok = !FAILURE_TAG.test(result.text);

  // Moves are applied by resolveAction immediately; make sure pendingMove is reflected too.
  if (result.pendingMove) state.agent_locations[PLAYER_ID] = result.pendingMove;
  const to = state.agent_locations[PLAYER_ID]!;
  if (to !== from) (p.moveLog ??= []).push({ from, to });

  // Speech/offers: NPCs at this location hear them in their next decision phase. If an NPC harness
  // is running there right now it already shares `ctx` (heard live, dropped at the end of this tick);
  // otherwise they are queued for the next tick.
  const nextTick = live ? a.tick + 1 : a.tick;
  const stamp = viaLive ? a.tick : nextTick;
  for (const s of ctx.speechLog.slice(speechBefore).filter(s => s.agentId === PLAYER_ID)) {
    (p.pendingSpeech ??= []).push({ name: s.name, text: s.text, location: from, tick: stamp });
    pushHeard(p, `${s.name} sagt: "${s.text}"`);
  }
  for (const o of ctx.negotiationOffers.filter(o => !offersBefore.has(o) && o.from === PLAYER_ID)) {
    (p.pendingOffers ??= []).push({ ...o, location: from, tick: stamp });
  }
  if (!viaLive) {
    p.incomingOffers = ctx.negotiationOffers.filter(o => o.to === PLAYER_ID).map(o => ({ ...o }));
  }

  if (charged && ok) p.actionsUsed = (p.actionsUsed ?? 0) + 1; // failed attempts changed nothing and are free

  // Feed: same agent:action stream the engine emits for NPCs, but immediately.
  const executed = result.executedAction;
  if (executed?.visible && executed.result && !SELF_EMITTING_TOOLS.has(toolName)) {
    emitSSE("agent:action", {
      agent: PLAYER_ID, name, actionType: executed.type, text: executed.text, result: executed.result, location: to,
    });
  }

  a.persist();
  const player = viewOf(state, a.tick, false);
  emitSSE("player:update", player);
  return { status: 200, body: { ok, text: result.text, player } };
}

function pushHeard(p: PlayerState, line: string): void {
  const heard = (p.heard ??= []);
  if (heard[heard.length - 1] === line) return;
  heard.push(line);
  if (heard.length > HEARD_LINES) heard.splice(0, heard.length - HEARD_LINES);
}

// ─── Engine hooks ────────────────────────────────────────────

/**
 * Engine, before step 7: take the actions the player queued this tick so they flow through the same
 * resolution as NPC results (resolveProduction, resolveBarter, updateAcquaintances). Also drops speech
 * and offers that were due this tick. Never feed this result into SSE/memory loops — player actions
 * were emitted live and the player has no memory file.
 */
export function drainPlayerTurn(
  state: WorldState,
  tick: number,
): { turn: AgentTurnResult | null; moves: { from: string; to: string }[] } {
  const p = state.player;
  if (!p?.created) return { turn: null, moves: [] };
  const actions: ResolvedAction[] = p.pendingActions ?? [];
  p.pendingActions = [];
  p.pendingSpeech = (p.pendingSpeech ?? []).filter(s => s.tick > tick);
  p.pendingOffers = (p.pendingOffers ?? []).filter(o => o.tick > tick);
  const moves = p.moveLog ?? [];
  p.moveLog = [];
  movedThisTick.clear();
  return { turn: actions.length > 0 ? { agent: PLAYER_ID, actions } : null, moves };
}

/** Engine: NPC speech at the player's location becomes part of what the player heard. */
export function recordHeardSpeech(state: WorldState, results: AgentTurnResult[]): void {
  const p = state.player;
  if (!p?.created) return;
  const location = state.agent_locations[PLAYER_ID];
  for (const r of results) {
    if (r.agent === PLAYER_ID || state.agent_locations[r.agent] !== location) continue;
    for (const action of r.actions) {
      if (action.type === "speak" && action.visible && action.result) pushHeard(p, action.result);
    }
  }
}

/** Harness: copy player speech/offers due at `ctx.location` into the context NPCs are about to read. */
export function seedLocationContext(ctx: LocationContext, state: WorldState, tick: number): void {
  const p = state.player;
  if (!p?.created) return;
  for (const s of p.pendingSpeech ?? []) {
    if (s.location === ctx.location && s.tick <= tick) {
      ctx.speechLog.push({ agentId: PLAYER_ID, name: s.name, text: s.text });
    }
  }
  for (const o of p.pendingOffers ?? []) {
    if (o.location === ctx.location && o.tick <= tick) {
      ctx.negotiationOffers.push({ from: o.from, fromName: o.fromName, to: o.to, item: o.item, price: o.price, qty: o.qty });
    }
  }
}

/** Harness: after a location's run, remember offers NPCs made to the player so the player can answer. */
export function captureOffersForPlayer(ctx: LocationContext, state: WorldState): void {
  const p = state.player;
  if (!p?.created || state.agent_locations[PLAYER_ID] !== ctx.location) return;
  p.incomingOffers = ctx.negotiationOffers.filter(o => o.to === PLAYER_ID).map(o => ({ ...o }));
}

/** Speech the player made that NPCs at `location` hear this tick, formatted like conversationSoFar. */
export function playerSpeechText(state: WorldState, location: string, tick: number): string {
  const p = state.player;
  if (!p?.created) return "";
  return (p.pendingSpeech ?? [])
    .filter(s => s.location === location && s.tick <= tick)
    .map(s => `${s.name} sagt: "${s.text}"`)
    .join("\n");
}

/**
 * Harness seed-context lines for `observer`: that the player is here, and what they said.
 * Speech that names the observer is skipped — it already shows up in the "An dich gerichtet" block.
 */
export function playerSeedLines(state: WorldState, observer: string, observerName: string, tick: number): string[] {
  const p = state.player;
  if (!p?.created) return [];
  const location = state.agent_locations[observer];
  if (state.agent_locations[PLAYER_ID] !== location || isAgentDead(state.body[PLAYER_ID])) return [];
  const lines = [`Hier ist auch: ${describeAgent(PLAYER_ID, observer, state)}.`];
  const spoken = (p.pendingSpeech ?? []).filter(s =>
    s.location === location && s.tick <= tick && !s.text.toLowerCase().includes(observerName.toLowerCase()));
  if (spoken.length > 0) {
    lines.push("--- Gehört ---");
    for (const s of spoken.slice(-4)) lines.push(`${s.name}: "${s.text}"`);
  }
  return lines;
}

/**
 * Engine, right before checkStarvation: a starving player does not die — Walburga takes them in.
 * (checkStarvation would kill on the third consecutive tick at hunger 5, so we step in on the second.)
 */
export function applyPlayerSoftDeath(state: WorldState): void {
  const p = state.player;
  const body = state.body[PLAYER_ID];
  const eco = state.economics[PLAYER_ID];
  if (!p?.created || !body || !eco) return;
  if (body.hunger < 5 || (body.starvation_ticks ?? 0) < 2) return;

  const cost = Math.min(REVIVE_COST, eco.wallet);
  eco.wallet -= cost;
  const healer = state.economics.walburga;
  if (healer) healer.wallet += cost; // the fee goes to the Baderin, not out of the economy
  body.hunger = 2;
  body.energy = 4;
  body.starvation_ticks = 0;
  state.agent_locations[PLAYER_ID] = REVIVE_LOCATION;
  p.pendingActions = [];
  feedbackToAgent(
    PLAYER_ID, state,
    `[Hinweis] Du bist vor Hunger zusammengebrochen. ${getDisplayName("walburga")} hat dich in der Baderhütte wieder aufgepäppelt (−${cost} Groschen).`,
  );
  console.log(`  ✚ Player collapsed from hunger and was revived in ${REVIVE_LOCATION} (−${cost} Groschen).`);
}
