import { create } from "zustand";
import type { AgentName, WorldState, FeedEntry, SSEEvent, EconomySnapshot, VillageInfo, MeetingState, Trade, PlayerView, PlayerTool, AgentModelsInfo, ModelTier, WarRelation, WarLogEntry, WarRaidEvent, WarState, WarMarchInfo, SimStatus, AgentRole, AgentRoleResponse, SkillOption, BarkLevel } from "./types";
import { itemLabel, gr } from "./types";

export type { MeetingState } from "./types";

// ─── Human player (der Neue / die Neue) ──────────────────────────────────

export interface Toast {
  id: number;
  text: string;
  tone: "good" | "warn" | "bad" | "info";
}

/** One line of the player's Tagebuch (action result or something heard). */
export interface DiaryEntry {
  id: number;
  time: string;
  text: string;
  kind: "result" | "fail" | "heard";
}

export type PlayerSkillChoice = "bauer" | "knappe" | "holzfaeller" | "none";

const SPECTATE_KEY = "schlackental.spectate";
const DIARY_MAX = 12;

/** Observer-first: without a stored choice the viewer only watches ("Mitspielen" opens creation). */
function loadSpectating(): boolean {
  try {
    const stored = window.localStorage.getItem(SPECTATE_KEY);
    return stored === null ? true : stored === "1";
  } catch (err) {
    console.warn("[viewer] localStorage unavailable (read)", err);
    return true;
  }
}

function saveSpectating(v: boolean): void {
  try {
    window.localStorage.setItem(SPECTATE_KEY, v ? "1" : "0");
  } catch (err) {
    console.warn("[viewer] localStorage unavailable (write)", err);
  }
}

export type MapView = "2d" | "3d";
const VIEW_KEY = "schlackental.view";

/** 2D is the default; the 3D choice is remembered. */
function loadViewMode(): MapView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "3d" ? "3d" : "2d";
  } catch (err) {
    console.warn("[viewer] localStorage unavailable (read view mode)", err);
    return "2d";
  }
}

function saveViewMode(v: MapView): void {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch (err) {
    console.warn("[viewer] localStorage unavailable (write view mode)", err);
  }
}

let raidCounter = 0;

/** Insert or replace one relation (keyed by the unordered village pair). */
function mergeRelation(list: WarRelation[], r: WarRelation): WarRelation[] {
  const same = (x: WarRelation) => (x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a);
  return list.some(same) ? list.map((x) => (same(x) ? r : x)) : [...list, r];
}

function isRelation(r: unknown): r is WarRelation {
  const x = r as Partial<WarRelation> | null;
  return !!x && typeof x.a === "string" && typeof x.b === "string" && typeof x.stance === "string";
}

// ─── Speech bubbles on the 2D map (LLM speech + barks) ───────────────────

/** One bubble over a colonist on the 2D map. Times are `performance.now()` ms. */
export interface MapBubble {
  id: number;
  agent: AgentName;
  text: string;
  kind: "speak" | "bark";
  at: number;
  until: number;
}

const BUBBLE_MAX = 5;
const BUBBLE_TEXT_MAX = 140;
const BARK_THROTTLE_MS = 1500;
let bubbleCounter = 0;
/** Last click-bark per colonist (performance.now ms), for the client-side throttle. */
const lastBarkAt = new Map<string, number>();

/** Bubble lifetime: 4.5 s + 50 ms per character. */
export function bubbleLifetimeMs(text: string): number {
  return 4500 + text.length * 50;
}

/** Adds a bubble (replacing the colonist's previous one); at most BUBBLE_MAX live bubbles, the oldest drops. */
function withBubble(list: MapBubble[], agent: AgentName, raw: string, kind: MapBubble["kind"]): MapBubble[] {
  const text = raw.length > BUBBLE_TEXT_MAX ? `${raw.slice(0, BUBBLE_TEXT_MAX - 1)}…` : raw;
  if (!text) return list;
  const now = performance.now();
  const next = list.filter((b) => b.until > now && b.agent !== agent);
  next.push({ id: bubbleCounter++, agent, text, kind, at: now, until: now + bubbleLifetimeMs(text) });
  return next.slice(-BUBBLE_MAX);
}

let toastCounter = 0;
let diaryCounter = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Reads a JSON body; a broken body is logged and becomes {} so callers still see the HTTP status. */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error(`[viewer] unreadable response body (HTTP ${res.status})`, err);
    return {};
  }
}

/** Backend result tags that mean "nothing happened" (src/player.ts FAILURE_TAG mirrors this). */
export function isFailureText(text: string): boolean {
  return /^\[(Geht nicht|Kann nicht|Nicht essbar|Zu teuer|Dort geht's nicht hin|Kein Angebot|Verboten per Ratsbeschluss|Nicht angeheuert|Tausch gescheitert|Unbekanntes Tool)/.test(text);
}

/** Speech lines out of the perception text, e.g. `Bodo sagt: "Guten Morgen"`. */
function heardLines(perception: string | undefined): string[] {
  if (!perception) return [];
  return perception.split("\n").map((l) => l.trim()).filter((l) => /^[^"]{1,48} sagt: ".*"$/.test(l));
}

/** German feed line for a completed trade (shared by tick-log replay and live SSE). */
function tradeText(buyer: AgentName, seller: AgentName, item: string, quantity: number, total: number): string {
  return `${formatAgentName(buyer)} kauft ${quantity}× ${itemLabel(item)} von ${formatAgentName(seller)} für ${gr(total)}`;
}

function productionText(agent: AgentName, item: string, qty: number): string {
  return `${formatAgentName(agent)} stellt ${qty}× ${itemLabel(item)} her`;
}

export interface AgentAnimation {
  agent: AgentName;
  fromLoc: string;
  toLoc: string;
  startMs: number;
  durationMs: number;
}

const AGENT_DISPLAY_BASE: Record<string, string> = {
  brakel: "Brakel", rike: "Rike", ottmar: "Ottmar", wenzel: "Wenzel", kasper: "Kasper",
  irmel: "Irmel", bodo: "Bodo", eckhart: "Eckhart", lenz: "Lenz",
  grete: "Grete", walburga: "Walburga", jost: "Jost",
  reinhart: "Vogt Reinhart", bruder_anno: "Bruder Anno",
  mattis: "Mattis", vroni: "Vroni", wendel: "Wendel",
  minna: "Minna", gisbert: "Gisbert", player: "Der Neue",
};

/** Format an agent ID as a display name (fallback for dynamically generated agents). */
/**
 * Backend speak results look like `Brakel sagt: "Hallo"` (tools.ts); the feed wants only the spoken words.
 * Keep in sync with tools.ts / TownHallView.
 */
export function speechText(raw: string): string {
  const m = raw.match(/^[^:"]*?\b(?:sagt|says)\b[^:"]*:\s*"([\s\S]*)"\s*$/);
  return (m ? m[1]! : raw).trim();
}

/** Backend thoughts are prefixed with `[Gedanke] ` (or `[Thought] ` in older logs). */
export function thoughtText(raw: string): string {
  return raw.replace(/^\s*\[(?:Gedanke|Thought)\]\s*/, "").trim();
}

/** True when the placeholder player agent should be shown: only once a human created the character. */
export function playerVisible(world: Pick<WorldState, "player"> | null | undefined): boolean {
  return world?.player?.created === true;
}

/** Colonist ids (economics keys) without the not-yet-created placeholder player. */
export function colonistIds(world: WorldState): AgentName[] {
  const showPlayer = playerVisible(world);
  return (Object.keys(world.economics) as AgentName[]).filter((a) => a !== "player" || showPlayer);
}

export function formatAgentName(id: string): string {
  return AGENT_DISPLAY_BASE[id] ?? id.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Auto-formats unknown agent IDs so all AGENT_DISPLAY[x] calls work for generated agents. */
export const AGENT_DISPLAY: Record<string, string> = new Proxy(AGENT_DISPLAY_BASE, {
  get(target, prop: string) {
    return target[prop] ?? prop.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  },
});

let feedCounter = 0;
let orderFeedCounter = 0;

export interface OrderFeedEntry {
  id: number;
  at: number;
  kind: "posted" | "cancelled" | "expired" | "filled";
  side?: "sell" | "buy";
  agent: AgentName;
  counterAgent?: AgentName;
  item?: string;
  quantity?: number;
  price?: number;
}

export interface PriceFlash {
  dir: "up" | "down";
  at: number;
}

// ─── Parse a tick log into feed entries ───────────────────────────────────

interface TickLogAction {
  type: string;
  text?: string;
  result?: string;
}

interface TickLogAgentTurn {
  agent: AgentName;
  actions: TickLogAction[];
}

interface TickLogLocation {
  agents: string[];
  rounds: TickLogAgentTurn[][];
}

interface TickLogRaw {
  tick: number;
  simulated_time: string;
  season: string;
  weather: string;
  locations: Record<string, TickLogLocation>;
  movements: { agent: AgentName; from: string; to: string }[];
  trades: { id: string; buyer: AgentName; seller: AgentName; item: string; quantity: number; pricePerUnit: number; total: number }[];
  productions: { agent: AgentName; item: string; qty: number }[];
}

export function tickLogToFeed(log: TickLogRaw): FeedEntry[] {
  const entries: FeedEntry[] = [];

  for (const [location, info] of Object.entries(log.locations)) {
    for (const round of info.rounds) {
      for (const agentTurn of round) {
        for (const action of agentTurn.actions) {
          if (!action.result) continue;
          const isSpeak = action.type === "speak";
          const isDo = action.type === "do";
          const isMove = action.type === "move_to";
          const isPropose = action.type === "propose_rule";
          const isVote = action.type === "vote";
          if (!isSpeak && !isDo && !isMove && !isPropose && !isVote) continue;
          entries.push({
            id: feedCounter++,
            tick: log.tick,
            agent: agentTurn.agent,
            type: isSpeak ? "speak" : isMove ? "move" : "do",
            text: isSpeak ? speechText(action.result) : action.result,
            location,
          });
        }
      }
    }
  }

  for (const trade of log.trades) {
    entries.push({
      id: feedCounter++,
      tick: log.tick,
      agent: trade.buyer,
      type: "trade",
      text: tradeText(trade.buyer, trade.seller, trade.item, trade.quantity, trade.total),
    });
  }

  for (const prod of log.productions) {
    entries.push({
      id: feedCounter++,
      tick: log.tick,
      agent: prod.agent,
      type: "production",
      text: productionText(prod.agent, prod.item, prod.qty),
    });
  }

  for (const mv of log.movements) {
    if (mv.from !== mv.to) {
      entries.push({
        id: feedCounter++,
        tick: log.tick,
        agent: mv.agent,
        type: "move",
        text: `${formatAgentName(mv.agent)} geht nach ${mv.to}`,
        location: mv.to,
      });
    }
  }

  return entries;
}

// ─── Store ────────────────────────────────────────────────────────────────

type ViewMode = "live" | "history";

export interface StreamEntry {
  agent: AgentName;
  name: string;
  text: string;
}

interface VillageStore {
  world: WorldState | null;
  feed: FeedEntry[];
  selectedAgent: AgentName | null;
  selectedAgentVersion: number;
  connected: boolean;
  currentTick: number;
  latestEconomy: EconomySnapshot | null;
  streaming: Record<string, StreamEntry>;  // agent → live stream
  agentStatus: Record<string, string>;    // agent → current harness tool summary
  orderFeed: OrderFeedEntry[];
  priceFlashes: Record<string, PriceFlash>;
  watchMode: boolean;
  activeMeeting: MeetingState | null;
  activeVillageId: string;
  villages: VillageInfo[];
  needsWorldConfig: boolean;
  setNeedsWorldConfig: (v: boolean) => void;
  setWatchMode: (v: boolean) => void;
  setActiveVillageId: (id: string) => void;
  setVillages: (v: VillageInfo[]) => void;

  // Tick navigation
  mode: ViewMode;
  availableTicks: string[];       // e.g. ["tick_00001", "tick_00002"]
  historyTickId: string | null;   // currently viewed tick in history mode
  historyFeed: FeedEntry[];       // feed for the history tick
  historyLoading: boolean;

  pendingAnimations: AgentAnimation[];

  // Human player
  player: PlayerView | null;
  playerTools: PlayerTool[];
  playerBusy: boolean;
  /** Set by a 429 (budget used up); cleared by the next player:update with budgetLeft > 0. */
  budgetBlocked: boolean;
  diary: DiaryEntry[];
  toasts: Toast[];
  /** User chose "Nur zuschauen" (persisted in localStorage). */
  spectating: boolean;
  /** "Mitspielen" pressed: show the creation overlay even though the user chose to spectate. */
  creationForced: boolean;
  /** Bumped to ask the map to centre on the player. */
  focusNonce: number;
  setSpectating: (v: boolean) => void;
  openCreation: () => void;
  pushToast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;

  // 2D / 3D map toggle
  viewMode: MapView;
  setViewMode: (v: MapView) => void;

  // War between settlements (3D visuals; backend may be missing -> stays empty)
  warRelations: WarRelation[];
  warLog: WarLogEntry[];
  /** Recent raids (newest last), for the 3D fire bursts and the auto-tour. */
  warRaids: WarRaidEvent[];
  /** Settlements and provocation kinds as listed by GET /api/war (for the Regie selects). */
  warVillages: { id: string; name: string }[];
  warProvokeKinds: { id: string; label: string }[];
  /** Running war marches by agent (removed on phase "heim"). */
  warMarches: Record<AgentName, WarMarchInfo>;
  loadWar: () => Promise<void>;
  /** POST /api/war/<action>. Toasts the backend's German error; returns true on success. Reloads the war state. */
  warCommand: (action: "provoke" | "declare" | "peace" | "tribute" | "raid", body: Record<string, unknown>, okText: string) => Promise<boolean>;

  // Regie: simulation control (pause / budget / speed)
  sim: SimStatus | null;
  loadSim: () => Promise<void>;
  /** POST /api/sim/<action>. Toasts errors; returns true on success. */
  simCommand: (action: "pause" | "resume" | "step" | "budget" | "speed" | "barks", body?: Record<string, unknown>) => Promise<boolean>;
  /** POST /api/sim/barks: Sprüche level 0 = Aus, 1 = Normal, 2 = Viel. Updates `sim` from the response. */
  setBarkLevel: (level: BarkLevel) => Promise<boolean>;

  // Barks (Sprüche) and speech bubbles on the 2D map
  /** Live bubbles over colonists (2D map); the renderer skips expired ones. */
  mapBubbles: MapBubble[];
  /** Click on a colonist: POST /api/agents/<id>/bark, shows bubble + feed entry (client throttle 1.5 s per colonist). */
  barkAt: (agentId: AgentName) => Promise<void>;

  // Regie: live roles (skill / council / director's note)
  /** Last known role per colonist (loaded on selection, updated by SSE agent:role). */
  agentRoles: Record<string, AgentRole>;
  roleSkills: SkillOption[];
  loadAgentRole: (agent: AgentName) => Promise<boolean>;
  /** POST /api/agents/<id>/role with a partial patch. Toasts errors; returns true on success. */
  saveAgentRole: (agent: AgentName, patch: { skill?: string; council?: boolean; character?: string }) => Promise<boolean>;

  // LLM model per colonist
  agentModels: AgentModelsInfo | null;
  loadAgentModels: () => Promise<void>;
  /** model = null: back to the global default. Toasts the outcome. */
  setAgentModel: (agent: AgentName, model: ModelTier | null) => Promise<void>;
  refreshPlayer: () => Promise<void>;
  refreshPlayerTools: () => Promise<void>;
  createPlayer: (name: string, skill: PlayerSkillChoice) => Promise<{ ok: boolean; error?: string }>;
  playerAction: (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;
  focusPlayer: () => void;

  setWorld: (w: WorldState) => void;
  selectAgent: (a: AgentName | null) => void;
  setConnected: (v: boolean) => void;
  handleSSEEvent: (e: SSEEvent) => void;
  appendHistoricalFeed: (entries: FeedEntry[]) => void;
  setAvailableTicks: (ticks: string[]) => void;
  setMode: (mode: ViewMode) => void;
  loadHistoryTick: (tickId: string) => Promise<void>;
  stepHistory: (delta: number) => void;
  consumeAnimations: () => AgentAnimation[];
  commitAgentLocation: (agent: AgentName, loc: string) => void;
}

export const useVillageStore = create<VillageStore>((set, get) => {
  /** Takes over a player view (GET /api/player, action response, SSE player:update) and mirrors it into `world`. */
  function applyPlayerView(view: PlayerView): void {
    if (view.created) AGENT_DISPLAY_BASE.player = view.name;
    set((s) => {
      const prev = s.player;
      // SSE updates carry no perception: keep the last fetched text until the refresh lands.
      const merged: PlayerView = { ...view, perception: view.perception ?? prev?.perception };
      const next: Partial<VillageStore> = {
        player: merged,
        budgetBlocked: view.budgetLeft > 0 ? false : s.budgetBlocked,
      };
      const w = s.world;
      if (w && view.created) {
        next.world = {
          ...w,
          player: { created: true, name: view.name, skill: view.skill, createdTick: w.player?.createdTick ?? view.tick ?? w.current_tick },
          agent_locations: view.location ? { ...w.agent_locations, player: view.location } : w.agent_locations,
          body: view.body ? { ...w.body, player: view.body } : w.body,
          economics: {
            ...w.economics,
            player: {
              ...(w.economics.player ?? { hiredBy: undefined }),
              wallet: view.wallet,
              inventory: { items: view.inventory },
              tool: view.tool,
              skill: view.skill,
              homeLocation: view.home ?? w.economics.player?.homeLocation ?? "",
              workLocation: view.work ?? w.economics.player?.workLocation ?? "",
            },
          },
        };
      }
      // Things heard (speech at the player's spot) join the Tagebuch once.
      const known = new Set(s.diary.map((d) => d.text));
      const fresh = heardLines(view.perception).filter((l) => !known.has(l));
      if (fresh.length > 0) {
        next.diary = [
          ...fresh.map((text) => ({ id: diaryCounter++, time: view.time ?? "", text, kind: "heard" as const })).reverse(),
          ...s.diary,
        ].slice(0, DIARY_MAX);
      }
      return next as VillageStore;
    });
  }

  /** A bark (SSE `agent:bark` or a click answer): own feed entry type "bark" plus a map bubble. */
  function applyBark(agent: AgentName, text: string, location: string | undefined, tick: number): void {
    const entry: FeedEntry = {
      id: feedCounter++,
      tick,
      agent,
      type: "bark",
      text,
      ...(location ? { location } : {}),
    };
    set((s) => ({
      feed: [entry, ...s.feed].slice(0, 300),
      mapBubbles: withBubble(s.mapBubbles, agent, text, "bark"),
    }));
  }

  /** Perception + tools change with every tick/action; coalesce bursts of updates into one refetch. */
  function scheduleRefresh(): void {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void get().refreshPlayer();
      void get().refreshPlayerTools();
    }, 250);
  }

  return {
  player: null,
  playerTools: [],
  playerBusy: false,
  budgetBlocked: false,
  diary: [],
  toasts: [],
  spectating: loadSpectating(),
  creationForced: false,
  focusNonce: 0,

  setSpectating: (v) => {
    saveSpectating(v);
    set({ spectating: v, creationForced: false });
  },
  openCreation: () => set({ creationForced: true }),
  focusPlayer: () => {
    get().selectAgent("player");
    set((s) => ({ focusNonce: s.focusNonce + 1 }));
  },

  pushToast: (text, tone = "info") => {
    const id = toastCounter++;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }].slice(-3) }));
    setTimeout(() => get().dismissToast(id), tone === "good" ? 5000 : 7000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  viewMode: loadViewMode(),
  setViewMode: (viewMode) => { saveViewMode(viewMode); set({ viewMode }); },

  warRelations: [],
  warLog: [],
  warRaids: [],
  warVillages: [],
  warProvokeKinds: [],
  warMarches: {},
  loadWar: async () => {
    try {
      const res = await fetch("/api/war");
      if (res.status === 404) return; // backend without war support
      if (!res.ok) { console.warn(`[viewer] GET /api/war -> HTTP ${res.status}`); return; }
      const data = (await res.json()) as Partial<WarState>;
      set({
        warRelations: Array.isArray(data.relations) ? data.relations.filter(isRelation) : [],
        warLog: Array.isArray(data.log) ? data.log.slice(-40) : [],
        warVillages: Array.isArray(data.villages) ? data.villages : [],
        warProvokeKinds: Array.isArray(data.provokeKinds) ? data.provokeKinds : [],
      });
    } catch (err) {
      console.warn("[viewer] loading /api/war failed", err);
    }
  },

  warCommand: async (action, body, okText) => {
    try {
      const res = await fetch(`/api/war/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // A missing route answers 404 or (SPA fallback) HTML instead of JSON.
      const isJson = (res.headers.get("content-type") ?? "").includes("json");
      if (action === "raid" && (res.status === 404 || !isJson)) {
        console.warn(`[viewer] POST /api/war/raid -> HTTP ${res.status} ${isJson ? "json" : "non-JSON"} (route missing on the server)`);
        get().pushToast("Kriegszug-Route fehlt im Server.", "bad");
        return false;
      }
      const data = await readJson(res);
      if (!res.ok || data.ok !== true) {
        const error = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        console.warn(`[viewer] POST /api/war/${action} rejected: ${error}`);
        get().pushToast(error.replace(/^\[[^\]]+\]\s*/, ""), "bad"); // drop the "[Geht nicht]" tag meant for the LLM
        return false;
      }
      get().pushToast(action === "raid" && typeof data.text === "string" && data.text ? data.text : okText, "good");
      void get().loadWar();
      return true;
    } catch (err) {
      console.error(`[viewer] POST /api/war/${action} failed`, err);
      get().pushToast("Keine Verbindung zum Server.", "bad");
      return false;
    }
  },

  sim: null,
  loadSim: async () => {
    try {
      const res = await fetch("/api/sim");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ sim: (await res.json()) as SimStatus });
    } catch (err) {
      console.error("[viewer] loading /api/sim failed", err);
    }
  },
  simCommand: async (action, body) => {
    try {
      const res = await fetch(`/api/sim/${action}`, {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const data = await readJson(res);
      if (!res.ok || data.ok === false) {
        const error = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        console.warn(`[viewer] POST /api/sim/${action} rejected: ${error}`);
        get().pushToast(error, "bad");
        return false;
      }
      if (data.status) set({ sim: data.status as SimStatus });
      return true;
    } catch (err) {
      console.error(`[viewer] POST /api/sim/${action} failed`, err);
      get().pushToast("Keine Verbindung zum Server.", "bad");
      return false;
    }
  },

  setBarkLevel: (level) => get().simCommand("barks", { level }),

  mapBubbles: [],
  barkAt: async (agentId) => {
    // The human player is not a colonist to bark at.
    if (agentId === "player") return;
    const now = performance.now();
    const last = lastBarkAt.get(agentId);
    if (last !== undefined && now - last < BARK_THROTTLE_MS) return;
    lastBarkAt.set(agentId, now);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/bark`, { method: "POST" });
      const data = await readJson(res);
      if (!res.ok || data.ok === false) {
        const error = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        console.warn(`[viewer] POST /api/agents/${agentId}/bark rejected: ${error}`);
        get().pushToast(error, res.status === 409 ? "warn" : "bad");
        return;
      }
      if (typeof data.text !== "string" || !data.text) {
        console.warn(`[viewer] bark of ${agentId} came back without text`, data);
        return;
      }
      applyBark(agentId, data.text, get().world?.agent_locations[agentId], get().currentTick);
    } catch (err) {
      console.error(`[viewer] POST /api/agents/${agentId}/bark failed`, err);
      get().pushToast("Keine Verbindung zum Server.", "bad");
    }
  },

  agentRoles: {},
  roleSkills: [],
  loadAgentRole: async (agent) => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent)}/role`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { skills, ...role } = (await res.json()) as AgentRoleResponse;
      set((s) => ({ agentRoles: { ...s.agentRoles, [agent]: role }, roleSkills: Array.isArray(skills) ? skills : s.roleSkills }));
      return true;
    } catch (err) {
      console.error(`[viewer] loading role of ${agent} failed`, err);
      return false;
    }
  },
  saveAgentRole: async (agent, patch) => {
    const name = AGENT_DISPLAY[agent] ?? agent;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent)}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await readJson(res);
      if (!res.ok || data.ok === false) {
        const error = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        console.warn(`[viewer] POST role of ${agent} rejected: ${error}`);
        get().pushToast(`Rolle von ${name} nicht geändert: ${error}`, "bad");
        return false;
      }
      if (data.role) set((s) => ({ agentRoles: { ...s.agentRoles, [agent]: data.role as AgentRole } }));
      get().pushToast(`Rolle von ${name} gespeichert. Wirkt ab dem nächsten Tick.`, "good");
      return true;
    } catch (err) {
      console.error(`[viewer] POST role of ${agent} failed`, err);
      get().pushToast(`Rolle von ${name} nicht geändert: keine Verbindung zum Server.`, "bad");
      return false;
    }
  },

  agentModels: null,

  loadAgentModels: async () => {
    try {
      const res = await fetch("/api/agents/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ agentModels: (await res.json()) as AgentModelsInfo });
    } catch (err) {
      console.error("[viewer] loading /api/agents/models failed", err);
    }
  },

  setAgentModel: async (agent, model) => {
    const name = AGENT_DISPLAY[agent] ?? agent;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent)}/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const body = await readJson(res);
      if (!res.ok || body.ok === false) {
        const error = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
        get().pushToast(`Modell für ${name} nicht geändert: ${error}`, "bad");
        return;
      }
      const effective = String(body.model);
      set((s) => s.agentModels
        ? { agentModels: { ...s.agentModels, models: { ...s.agentModels.models, [agent]: effective } } }
        : {});
      const label = get().agentModels?.options.find((o) => o.id === effective)?.label ?? effective;
      get().pushToast(
        model === null ? `${name} nutzt wieder das Standardmodell (${label}).` : `${name} läuft jetzt auf ${label}.`,
        "good",
      );
    } catch (err) {
      console.error(`[viewer] POST /api/agents/${agent}/model failed`, err);
      get().pushToast(`Modell für ${name} nicht geändert: keine Verbindung zum Server.`, "bad");
    }
  },

  refreshPlayer: async () => {
    try {
      const res = await fetch("/api/player");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const view = (await res.json()) as PlayerView;
      applyPlayerView(view);
    } catch (err) {
      console.error("[viewer] loading /api/player failed", err);
    }
  },

  refreshPlayerTools: async () => {
    if (!get().player?.created) {
      if (get().playerTools.length > 0) set({ playerTools: [] });
      return;
    }
    try {
      const res = await fetch("/api/player/tools");
      if (res.status === 409) { set({ playerTools: [] }); return; } // not created (yet): expected
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { tools: PlayerTool[] };
      set({ playerTools: body.tools });
    } catch (err) {
      console.error("[viewer] loading /api/player/tools failed", err);
    }
  },

  createPlayer: async (name, skill) => {
    try {
      const res = await fetch("/api/player/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, skill }),
      });
      const body = await readJson(res);
      if (!res.ok || body.ok === false) {
        const error = typeof body.error === "string" ? body.error : `Der Server hat die Anfrage abgelehnt (HTTP ${res.status}).`;
        return { ok: false, error };
      }
      applyPlayerView(body as unknown as PlayerView);
      saveSpectating(false);
      set({ spectating: false, creationForced: false, diary: [] });
      // The world snapshot in the viewer predates the player: reload it so map, list and bars include "player".
      try {
        const st = await fetch("/api/state");
        if (st.ok) get().setWorld((await st.json()) as WorldState);
      } catch (err) {
        console.warn("[viewer] reloading /api/state after create failed", err);
      }
      applyPlayerView(body as unknown as PlayerView);
      void get().refreshPlayerTools();
      get().focusPlayer();
      get().pushToast(`Willkommen im Schlackental, ${String(body.name ?? name)}.`, "good");
      return { ok: true };
    } catch (err) {
      console.error("[viewer] POST /api/player/create failed", err);
      return { ok: false, error: "Keine Verbindung zum Server. Läuft die Kolonie?" };
    }
  },

  playerAction: async (tool, args) => {
    set({ playerBusy: true });
    const record = (text: string, kind: DiaryEntry["kind"]) =>
      set((s) => ({ diary: [{ id: diaryCounter++, time: s.player?.time ?? "", text, kind }, ...s.diary].slice(0, DIARY_MAX) }));
    try {
      const res = await fetch("/api/player/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, args }),
      });
      const body = await readJson(res);
      const text = typeof body.text === "string" ? body.text
        : typeof body.error === "string" ? body.error
        : `Der Server hat die Aktion abgelehnt (HTTP ${res.status}).`;
      if (body.player) applyPlayerView(body.player as PlayerView);
      if (res.status === 429) {
        set({ budgetBlocked: true });
        get().pushToast(text, "warn");
        record(text, "fail");
        return { ok: false, text };
      }
      const ok = res.ok && body.ok !== false && !isFailureText(text);
      get().pushToast(text, ok ? "good" : "warn");
      record(text, ok ? "result" : "fail");
      return { ok, text };
    } catch (err) {
      console.error(`[viewer] POST /api/player/action (${tool}) failed`, err);
      const text = "Keine Verbindung zum Server. Deine Aktion ist nicht angekommen.";
      get().pushToast(text, "bad");
      return { ok: false, text };
    } finally {
      set({ playerBusy: false });
      scheduleRefresh();
    }
  },

  world: null,
  feed: [],
  selectedAgent: null,
  selectedAgentVersion: 0,
  connected: false,
  currentTick: 0,
  latestEconomy: null,
  streaming: {},
  agentStatus: {},
  orderFeed: [],
  priceFlashes: {},
  pendingAnimations: [],
  watchMode: false,
  needsWorldConfig: false,
  setNeedsWorldConfig: (needsWorldConfig) => set({ needsWorldConfig }),
  activeMeeting: null,
  activeVillageId: "schlackental",
  villages: [],
  setWatchMode: (watchMode) => set({ watchMode }),
  setActiveVillageId: (activeVillageId) => set({ activeVillageId }),
  setVillages: (villages) => set({ villages }),

  mode: "live",
  availableTicks: [],
  historyTickId: null,
  historyFeed: [],
  historyLoading: false,

  setWorld: (world) => {
    if (world.player?.created) AGENT_DISPLAY_BASE.player = world.player.name;
    set({ world, warMarches: { ...(world.war_marches ?? {}) } });
  },
  selectAgent: (selectedAgent) => set((s) => ({ selectedAgent, selectedAgentVersion: s.selectedAgentVersion + 1 })),
  setConnected: (connected) => set({ connected }),

  setAvailableTicks: (availableTicks) => set({ availableTicks }),

  appendHistoricalFeed: (entries) =>
    set((s) => ({ feed: [...entries, ...s.feed].slice(0, 300) })),

  setMode: (mode) => set({ mode }),

  loadHistoryTick: async (tickId: string) => {
    set({ historyLoading: true, historyTickId: tickId });
    try {
      const res = await fetch(`/api/tick/${tickId}`);
      const log: TickLogRaw = await res.json();
      const entries = tickLogToFeed(log);
      set({ historyFeed: entries, historyLoading: false });
    } catch (err) {
      console.error(`[viewer] failed to load ${tickId}`, err);
      set({ historyLoading: false });
    }
  },

  stepHistory: (delta: number) => {
    const { availableTicks, historyTickId, mode } = get();
    if (!availableTicks.length) return;
    const currentIdx = historyTickId ? availableTicks.indexOf(historyTickId) : availableTicks.length - 1;
    const newIdx = Math.max(0, Math.min(availableTicks.length - 1, currentIdx + delta));
    const newTickId = availableTicks[newIdx]!;
    if (mode !== "history") set({ mode: "history" });
    get().loadHistoryTick(newTickId);
  },

  consumeAnimations: () => {
    const anims = get().pendingAnimations;
    if (anims.length === 0) return [];
    set({ pendingAnimations: [] });
    return anims;
  },

  commitAgentLocation: (agent: AgentName, loc: string) => {
    set((s) => ({
      world: s.world ? {
        ...s.world,
        agent_locations: { ...s.world.agent_locations, [agent]: loc },
      } : s.world,
    }));
  },

  handleSSEEvent: (e: SSEEvent) => {
    const { world } = get();

    if (e.type === "init") {
      const fills: OrderFeedEntry[] = (e.state.marketplace.history ?? [])
        .slice(-50)
        .reverse()
        .map((trade) => ({
          id: orderFeedCounter++,
          at: Date.now(),
          kind: "filled" as const,
          agent: trade.buyer,
          counterAgent: trade.seller,
          item: trade.item,
          quantity: trade.quantity,
          price: trade.pricePerUnit,
        }));
      const lastSnap = e.state.economy_snapshots?.at(-1) ?? null;
      if (e.state.player?.created) {
        AGENT_DISPLAY_BASE.player = e.state.player.name;
        scheduleRefresh();
      }
      set({
        world: e.state,
        warMarches: { ...(e.state.war_marches ?? {}) },
        currentTick: e.state.current_tick,
        orderFeed: fills,
        latestEconomy: lastSnap,
        activeMeeting: e.activeMeeting ?? null,
      });
      return;
    }

    if (e.type === "harness:tool") {
      set(s => ({ agentStatus: { ...s.agentStatus, [e.agent]: e.summary } }));
      return;
    }

    if (e.type === "thinking") {
      set((s) => ({
        streaming: {
          ...s.streaming,
          [e.agent]: { agent: e.agent, name: e.name, text: "" },
        },
      }));
      return;
    }

    if (e.type === "stream") {
      if (!e.chunk) {
        // Empty chunk = done streaming this agent
        set((s) => {
          const next = { ...s.streaming };
          delete next[e.agent];
          return { streaming: next };
        });
      } else {
        set((s) => {
          const prev = s.streaming[e.agent];
          return {
            streaming: {
              ...s.streaming,
              [e.agent]: { agent: e.agent, name: e.name, text: (prev?.text ?? "") + e.chunk },
            },
          };
        });
      }
      return;
    }

    if (e.type === "tick") {
      set((s) => ({
        currentTick: e.tick,
        streaming: {},     // clear all streams on new tick
        agentStatus: {},   // clear harness status on new tick
        world: s.world ? {
          ...s.world,
          current_tick: e.tick,
          current_time: e.time,
          season: e.season,
          weather: e.weather,
        } : s.world,
      }));  // closes set(
      // Refresh available ticks list so navigator stays up to date
      fetch("/api/ticks")
        .then((r) => r.json())
        .then((ticks: string[]) => get().setAvailableTicks(ticks))
        .catch((err) => console.warn("[viewer] could not refresh tick list", err));
      return;
    }

    if (e.type === "action") {
      if (!e.result || e.actionType === "wait") return;
      const isSpeech = e.actionType === "speak";
      const isMove = e.actionType === "move_to";
      const isThought = e.actionType === "think";

      const atTownHall = e.location === "Vogtei" || e.location.endsWith(":Vogtei");
      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: e.agent,
        type: isThought ? "thought" : isSpeech ? "speak" : isMove ? "move" : "do",
        text: isSpeech ? speechText(e.result ?? "") : isThought ? thoughtText(e.result ?? "") : (e.result ?? ""),
        location: e.location,
        ...(isSpeech && atTownHall && get().activeMeeting ? { council: true } : {}),
      };
      set((s) => {
        const base = {
          feed: [entry, ...s.feed].slice(0, 300),
          ...(isSpeech ? { mapBubbles: withBubble(s.mapBubbles, e.agent, entry.text, "speak") } : {}),
        };
        if (isSpeech && (e.location === "Vogtei" || e.location.endsWith(":Vogtei")) && s.activeMeeting) {
          return {
            ...base,
            activeMeeting: {
              ...s.activeMeeting,
              discussion: [
                ...s.activeMeeting.discussion,
                { agent: e.agent, name: formatAgentName(e.agent), text: e.result ?? "" },
              ].slice(-60),
            },
          };
        }
        return base;
      });

      if (e.location) {
        if (isMove && world) {
          const fromLoc = world.agent_locations[e.agent];
          if (fromLoc && fromLoc !== e.location) {
            set((s) => ({
              pendingAnimations: [
                ...s.pendingAnimations,
                {
                  agent: e.agent,
                  fromLoc,
                  toLoc: e.location!,
                  startMs: performance.now(),
                  durationMs: 1200,
                },
              ],
            }));
          } else {
            set((s) => ({
              world: s.world ? {
                ...s.world,
                agent_locations: { ...s.world.agent_locations, [e.agent]: e.location! },
              } : s.world,
            }));
          }
        }
        // Non-move actions carry an informational location (where the action happened),
        // not a destination — do not snap agent position for speak/do/etc.
      }
      return;
    }

    if (e.type === "thought") {
      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: e.agent,
        type: "thought",
        text: thoughtText(e.text ?? ""),
      };
      set((s) => ({ feed: [entry, ...s.feed].slice(0, 300) }));
      return;
    }

    if (e.type === "trade") {
      const currentPrice = world?.marketplace.priceIndex[e.item] ?? null;
      const dir: PriceFlash["dir"] = currentPrice == null || e.pricePerUnit === currentPrice
        ? "up"
        : e.pricePerUnit > currentPrice ? "up" : "down";

      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: e.buyer,
        type: "trade",
        text: tradeText(e.buyer, e.seller, e.item, e.quantity, e.total),
      };
      const tradeTick = e.tick ?? get().currentTick;
      const trade: Trade = {
        id: `live_${orderFeedCounter}`,
        tick: tradeTick,
        buyer: e.buyer,
        seller: e.seller,
        item: e.item,
        quantity: e.quantity,
        pricePerUnit: e.pricePerUnit,
        total: e.total,
      };
      const orderEntry: OrderFeedEntry = {
        id: orderFeedCounter++,
        at: Date.now(),
        kind: "filled",
        agent: e.buyer,
        counterAgent: e.seller,
        item: e.item,
        quantity: e.quantity,
        price: e.pricePerUnit,
      };
      set((s) => ({
        feed: [entry, ...s.feed].slice(0, 300),
        orderFeed: [orderEntry, ...s.orderFeed].slice(0, 150),
        priceFlashes: { ...s.priceFlashes, [e.item]: { dir, at: Date.now() } },
        // keep the trade ledger current so "Handel heute" / BIP follow the live stream
        world: s.world
          ? {
              ...s.world,
              marketplace: {
                ...s.world.marketplace,
                history: [...(s.world.marketplace.history ?? []), trade].slice(-600),
              },
            }
          : s.world,
      }));
      return;
    }

    if (e.type === "production") {
      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: e.agent,
        type: "production",
        text: productionText(e.agent, e.item, e.qty),
      };
      set((s) => ({ feed: [entry, ...s.feed].slice(0, 300) }));
      return;
    }

    if (e.type === "economy") {
      set((s) => ({
        latestEconomy: e.snapshot,
        world: s.world ? {
          ...s.world,
          economy_snapshots: [...(s.world.economy_snapshots ?? []), e.snapshot],
        } : s.world,
      }));
      return;
    }

    if (e.type === "order") {
      const orderEntry: OrderFeedEntry = {
        id: orderFeedCounter++,
        at: Date.now(),
        kind: e.event,
        side: e.orderType,
        agent: e.agentId,
        item: e.item,
        quantity: e.quantity,
        price: e.price,
      };
      set((s) => ({ orderFeed: [orderEntry, ...s.orderFeed].slice(0, 150) }));
      return;
    }

    if (e.type === "event") {
      const entry: FeedEntry = {
        id: feedCounter++,
        tick: get().currentTick,
        agent: "reinhart",
        type: "system",
        text: e.description,
      };
      set((s) => ({
        feed: [entry, ...s.feed].slice(0, 300),
        world: s.world
          ? {
              ...s.world,
              ...(e.active_events ? { active_events: e.active_events } : {}),
              ...(e.agent_locations ? { agent_locations: e.agent_locations as Record<AgentName, string> } : {}),
            }
          : s.world,
      }));
      return;
    }

    if (e.type === "event_expired") {
      set((s) => {
        if (!s.world?.active_events.some(ev => ev.type === e.eventType)) return s;
        return { world: { ...s.world!, active_events: s.world!.active_events.filter(ev => ev.type !== e.eventType) } };
      });
      return;
    }


    if (e.type === "meeting:start") {
      set({
        activeMeeting: {
          phase: "discussion",
          agendaType: e.agendaType,
          description: e.description,
          attendees: e.attendees,
          votes: {},
          proposal: null,
          result: null,
          discussion: [],
        },
      });
      return;
    }

    if (e.type === "meeting:phase") {
      if (e.phase === "vote") {
        set((s) => ({
          activeMeeting: s.activeMeeting ? {
            ...s.activeMeeting,
            phase: "vote",
            proposal: e.proposal ?? null,
          } : s.activeMeeting,
        }));
      }
      return;
    }

    if (e.type === "meeting:vote") {
      set((s) => ({
        activeMeeting: s.activeMeeting ? {
          ...s.activeMeeting,
          votes: { ...s.activeMeeting.votes, [e.agent]: e.side },
        } : s.activeMeeting,
      }));
      return;
    }

    if (e.type === "meeting:result") {
      set((s) => ({
        activeMeeting: s.activeMeeting ? {
          ...s.activeMeeting,
          phase: "result",
          result: { passed: e.passed, agreeCount: e.agreeCount },
        } : s.activeMeeting,
      }));
      return;
    }

    if (e.type === "meeting:end") {
      setTimeout(() => set({ activeMeeting: null }), 4000);
      return;
    }

    if (e.type === "meeting:quorum_fail") {
      // Brief notification then clear (no meeting happened)
      setTimeout(() => set({ activeMeeting: null }), 3000);
      return;
    }

    if (e.type === "agent:model") {
      set((s) => s.agentModels
        ? { agentModels: { ...s.agentModels, models: { ...s.agentModels.models, [e.agent]: e.model } } }
        : {});
      return;
    }

    if (e.type === "war:update") {
      const cands: unknown[] = [e.relation, ...(Array.isArray(e.relations) ? e.relations : []), e];
      const rels = cands.filter(isRelation);
      if (rels.length === 0) { console.warn("[viewer] war:update without a usable relation", e); return; }
      set((s) => ({ warRelations: rels.reduce((acc, r) => mergeRelation(acc, r), s.warRelations) }));
      return;
    }

    if (e.type === "sim:control") {
      const { type: _type, ...status } = e;
      set({ sim: status });
      return;
    }

    if (e.type === "agent:bark") {
      if (!e.agent || !e.text) { console.warn("[viewer] agent:bark without agent/text", e); return; }
      applyBark(e.agent, e.text, e.location, e.tick ?? get().currentTick);
      return;
    }

    if (e.type === "agent:role") {
      if (!e.agent || !e.role) { console.warn("[viewer] agent:role without agent/role", e); return; }
      set((s) => ({ agentRoles: { ...s.agentRoles, [e.agent]: e.role } }));
      return;
    }

    if (e.type === "war:march") {
      if (!e.agent) { console.warn("[viewer] war:march without agent", e); return; }
      if (e.phase === "heim") {
        set((s) => {
          if (!(e.agent in s.warMarches)) return {};
          const { [e.agent]: _gone, ...rest } = s.warMarches;
          return { warMarches: rest };
        });
      } else {
        const march: WarMarchInfo = { target: e.target, phase: e.phase, arriveTick: e.arriveTick };
        set((s) => ({ warMarches: { ...s.warMarches, [e.agent]: march } }));
      }
      return;
    }

    if (e.type === "war:raid") {
      const raid: WarRaidEvent = { ...e, id: raidCounter++, at: Date.now() };
      set((s) => ({ warRaids: [...s.warRaids, raid].slice(-12) }));
      return;
    }

    if (e.type === "war:event") {
      if (!e.text) return;
      const entry: WarLogEntry = {
        tick: e.tick ?? get().currentTick, kind: e.kind ?? "event", villages: e.villages ?? ["", ""], text: e.text,
        ...(e.success !== undefined ? { success: e.success } : {}),
      };
      set((s) => ({ warLog: [...s.warLog, entry].slice(-40) }));
      return;
    }

    if (e.type === "player:update") {
      const { type: _type, ...view } = e;
      applyPlayerView(view);
      scheduleRefresh(); // perception + tools follow the new state
      return;
    }
  },
  };
});

// ─── Derived economy numbers (live from world state; do not wait for the next snapshot) ──────

export interface LiveEconomy {
  totalWealth: number;
  gini: number;
  /** Sum of trade totals in the last 16 ticks (one in-game day). */
  gdp: number;
  /** Number of trades since 06:00 of the current in-game day. */
  tradesToday: number;
}

export function computeEconomy(world: WorldState): LiveEconomy {
  const wallets = colonistIds(world).map((a) => world.economics[a]!.wallet).sort((a, b) => a - b);
  const n = wallets.length;
  const totalWealth = wallets.reduce((s, v) => s + v, 0);
  const gini = totalWealth > 0 && n > 0
    ? Math.round((wallets.reduce((acc, v, i) => acc + (2 * (i + 1) - n - 1) * v, 0) / (n * totalWealth)) * 100) / 100
    : 0;
  const history = world.marketplace.history ?? [];
  const gdp = history.filter((t) => t.tick >= world.current_tick - 16).reduce((s, t) => s + t.total, 0);
  const dayStart = Math.floor((Math.max(world.current_tick, 1) - 1) / 16) * 16 + 1;
  const tradesToday = history.filter((t) => t.tick >= dayStart).length;
  return { totalWealth, gini, gdp, tradesToday };
}
