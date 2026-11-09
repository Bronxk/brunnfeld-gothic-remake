import { create } from "zustand";
import type { AgentName, WorldState, FeedEntry, SSEEvent, EconomySnapshot, VillageInfo, MeetingState, Trade, PlayerView, PlayerTool } from "./types";
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

function loadSpectating(): boolean {
  try {
    return window.localStorage.getItem(SPECTATE_KEY) === "1";
  } catch (err) {
    console.warn("[viewer] localStorage unavailable (read)", err);
    return false;
  }
}

function saveSpectating(v: boolean): void {
  try {
    if (v) window.localStorage.setItem(SPECTATE_KEY, "1");
    else window.localStorage.removeItem(SPECTATE_KEY);
  } catch (err) {
    console.warn("[viewer] localStorage unavailable (write)", err);
  }
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
    set({ world });
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
        const base = { feed: [entry, ...s.feed].slice(0, 300) };
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
