// Frontend-mirrored types (slim subset of backend types.ts)

// Widened to string to support dynamically generated multi-village worlds.
export type AgentName = string;

export interface VillageInfo {
  id: string;
  name: string;
  agentCount: number;
  locationTiles?: Record<string, { tx: number; ty: number }>;
  locationTypes?: Record<string, string>;
}

export type Season = "spring" | "summer" | "autumn" | "winter";
export type ItemType = string;
export type Skill = string;

export interface InventoryItem {
  type: ItemType;
  quantity: number;
  reserved?: number;
}

export interface BodyState {
  hunger: number;
  energy: number;
  sleep_quality: string;
  sickness?: number;
  injury?: number;
  starvation_ticks?: number;
}

export interface AgentEconomicState {
  wallet: number;
  inventory: { items: InventoryItem[] };
  tool: { type: string; durability: number } | null;
  skill: Skill;
  homeLocation: string;
  workLocation: string;
  hiredBy?: AgentName;
}

export interface Order {
  id: string;
  agentId: AgentName;
  type: "sell" | "buy";
  item: ItemType;
  quantity: number;
  price: number;
  postedTick: number;
  expiresAtTick: number;
}

export interface Trade {
  id: string;
  tick: number;
  buyer: AgentName;
  seller: AgentName;
  item: ItemType;
  quantity: number;
  pricePerUnit: number;
  total: number;
}

export interface Marketplace {
  orders: Order[];
  history: Trade[];
  priceIndex: Record<ItemType, number>;
  priceHistory: Record<ItemType, { tick: number; price: number }[]>;
}

export interface ActiveEvent {
  type: string;
  description: string;
  startTick: number;
  endTick: number;
}

export interface Loan {
  id: string;
  creditor: AgentName;
  debtor: AgentName;
  amount: number;
  issuedTick: number;
  dueTick: number;
  description: string;
  repaid: boolean;
}

export interface WorldState {
  current_tick: number;
  current_time: string;
  season: Season;
  day_of_season: number;
  weather: string;
  active_events: ActiveEvent[];
  agent_locations: Record<AgentName, string>;
  body: Record<AgentName, BodyState>;
  economics: Record<AgentName, AgentEconomicState>;
  marketplace: Marketplace;
  acquaintances: Record<AgentName, AgentName[]>;
  economy_snapshots: EconomySnapshot[];
  loans?: Loan[];
  /** Running war marches (Kriegszüge) per agent; absent when nobody marches. */
  war_marches?: Record<AgentName, { target: string; phase: WarMarchPhase; arriveTick: number }>;
  /** Human player character; `created` flips to true once a human creates one (until then the "player" agent is a hidden placeholder). */
  player?: { created: boolean; name: string; skill: string; createdTick: number };
}

export interface EconomySnapshot {
  tick: number;
  day: number;
  season: Season;
  totalWealth: number;
  giniCoefficient: number;
  gdp: number;
  scarcityAlerts: ItemType[];
  wealthDistribution: { agent: AgentName; wallet: number; inventoryValue: number }[];
}

export interface FeedEntry {
  id: number;
  tick: number;
  agent: AgentName;
  type: "speak" | "bark" | "do" | "move" | "trade" | "production" | "thought" | "system";
  text: string;
  location?: string;
  /** True for speech that happened during an active Appell (council meeting). */
  council?: boolean;
}

/** Live state of an Appell (council meeting) as built by the server and the store. */
export interface MeetingState {
  phase: "discussion" | "vote" | "result";
  agendaType: string;
  description: string;
  attendees: AgentName[];
  votes: Partial<Record<AgentName, "agree" | "disagree">>;
  proposal: string | null;
  result: { passed: boolean; agreeCount: number } | null;
  discussion: { agent: AgentName; name: string; text: string }[];
}

export type SSEEvent =
  | { type: "init"; state: WorldState; activeMeeting?: MeetingState | null }
  | { type: "tick"; tick: number; time: string; season: Season; weather: string }
  | { type: "thinking"; agent: AgentName; name: string }
  | { type: "stream"; agent: AgentName; name: string; chunk: string }
  | { type: "action"; agent: AgentName; actionType: string; text?: string; result?: string; location: string }
  | { type: "thought"; agent: AgentName; text: string }
  | { type: "trade"; buyer: AgentName; seller: AgentName; item: ItemType; quantity: number; pricePerUnit: number; total: number; tick?: number }
  | { type: "production"; agent: AgentName; item: ItemType; qty: number }
  | { type: "economy"; snapshot: EconomySnapshot }
  | { type: "event"; eventType: string; description: string; active_events?: ActiveEvent[]; agent_locations?: Record<string, string> }
  | { type: "event_expired"; eventType: string }
  | { type: "order"; event: "posted" | "cancelled" | "expired"; orderId: string; agentId: AgentName; orderType?: "sell" | "buy"; item?: ItemType; quantity?: number; price?: number }
  | { type: "meeting:start"; agendaType: string; description: string; attendees: AgentName[]; attendeeCount: number }
  | { type: "meeting:phase"; phase: "discussion" | "vote"; round?: number; proposal?: string }
  | { type: "meeting:vote"; agent: AgentName; side: "agree" | "disagree" }
  | { type: "meeting:result"; passed: boolean; agreeCount: number; law?: unknown }
  | { type: "meeting:end" }
  | { type: "meeting:quorum_fail"; description: string; attendeeCount: number }
  | { type: "harness:tool"; agent: AgentName; name: string; tool: string; summary: string }
  | { type: "agent:model"; agent: AgentName; model: string }
  | ({ type: "player:update" } & PlayerView)
  | ({ type: "war:update" } & WarUpdatePayload)
  | ({ type: "war:raid" } & WarRaidPayload)
  | ({ type: "war:event" } & Partial<WarLogEntry>)
  | ({ type: "war:march" } & WarMarchPayload)
  | ({ type: "sim:control" } & SimStatus)
  | { type: "agent:role"; agent: AgentName; role: AgentRole }
  | ({ type: "agent:bark" } & BarkEvent);

// ─── Barks (Sprüche): short, rough one-liners the colonists shout (backend: src/barks-types.ts) ───

/** Situation a bark fits (mirror of the backend BARK_KINDS). */
export type BarkKind =
  | "gruss" | "abweisen" | "fremder" | "hunger" | "erschoepft" | "verletzt" | "krank" | "arbeit" | "markt"
  | "dieb" | "arm" | "reich" | "spannung"
  | "krieg_marsch" | "krieg_angriff" | "krieg_verteidigung" | "krieg_sieg" | "krieg_niederlage"
  | "appell" | "karzer" | "wetter" | "nacht";

/** Observer setting: 0 = Aus, 1 = Normal, 2 = Viel. Click barks work at every level. */
export type BarkLevel = 0 | 1 | 2;

/** SSE `agent:bark` payload (ambient barks only; click barks come back in the HTTP response). */
export interface BarkEvent {
  agent: AgentName;
  text: string;
  kind: BarkKind;
  location: string;
  tick: number;
}

// ─── Regie: simulation control (backend: GET /api/sim, POST /api/sim/*, SSE sim:control) ───

export interface SimStatus {
  paused: boolean;
  /** Ticks left before the sim pauses by itself; null = unlimited. */
  budget: number | null;
  /** Pause between two ticks in ms (0 = as fast as possible). */
  tickDelayMs: number;
  pausedReason?: string;
  /** Fresh world that has not started yet; "Weiter"/"1 Tick" start it. */
  awaitingStart?: boolean;
  /** Sprüche level; absent on an older server (the Regie row is hidden then). */
  barkLevel?: BarkLevel;
}

// ─── Regie: live role of a colonist (backend: GET/POST /api/agents/<id>/role, SSE agent:role) ───

export interface AgentRole {
  agent: AgentName;
  skill: string;
  council: boolean;
  /** Free-text director's note on the character (max ~600 chars). */
  character: string;
  isElder: boolean;
}

export interface SkillOption {
  id: string;
  label: string;
}

/** GET /api/agents/<id>/role. */
export interface AgentRoleResponse extends AgentRole {
  skills: SkillOption[];
}

// ─── War between settlements (backend: GET /api/war, SSE war:update / war:raid / war:event / war:march) ───

export type WarStance = "frieden" | "spannung" | "krieg";

export interface WarRelation {
  a: string;
  b: string;
  stance: WarStance;
  tension: number;
  since: number;
}

export interface WarLogEntry {
  tick: number;
  kind: string;
  villages: [string, string];
  text: string;
  success?: boolean;
}

export interface WarState {
  villages: { id: string; name: string }[];
  relations: WarRelation[];
  log: WarLogEntry[];
  provokeKinds: { id: string; label: string }[];
}

export type WarMarchPhase = "hin" | "kampf" | "zurueck";

/** SSE `war:march`: a colonist walks to / fights in / returns from an enemy village. "heim" = march finished. */
export interface WarMarchPayload {
  agent: AgentName;
  /** Target village id. */
  target: string;
  phase: WarMarchPhase | "heim";
  arriveTick: number;
}

/** A running march as held in the store (the war:march payload without the agent). */
export interface WarMarchInfo {
  target: string;
  phase: WarMarchPhase;
  arriveTick: number;
}

/** `war:update` carries one relation; tolerate it flat or nested (payload shape is not final). */
export type WarUpdatePayload = Partial<WarRelation> & { relation?: WarRelation; relations?: WarRelation[] };

export interface WarRaidPayload {
  attacker: string;
  target: string;
  success: boolean;
  loot?: unknown;
  wounded?: unknown;
  text?: string;
}

/** A raid as kept in the store (with a running id so views can tell new ones apart). */
export interface WarRaidEvent extends WarRaidPayload {
  id: number;
  at: number;
}

// ─── LLM model per colonist (backend: GET /api/agents/models, POST /api/agents/<id>/model, SSE agent:model) ───

export type ModelTier = "haiku" | "sonnet" | "opus";

export interface ModelOption {
  id: ModelTier;
  label: string;
  /** USD per million tokens. */
  inPerMTok: number;
  outPerMTok: number;
}

export interface AgentModelsInfo {
  /** Effective global default (CHARACTER_MODEL): a tier name, or a raw model ID in OpenRouter/local mode. */
  default: string;
  /** Effective model for every colonist (not the player). */
  models: Record<AgentName, string>;
  options: ModelOption[];
}

// ─── Human player (backend src/player.ts: GET /api/player, SSE player:update) ───

export interface Producible {
  item: string;
  label: string;
  output: string;
  ready: boolean;
  reason?: string;
}

export interface PlayerView {
  created: boolean;
  name: string;
  skill: Skill;
  skillLabel?: string;
  location: string | null;
  home?: string;
  work?: string;
  body: BodyState | null;
  wallet: number;
  inventory: InventoryItem[];
  tool: { type: string; durability: number } | null;
  producible?: Producible[];
  budgetLeft: number;
  budget: number;
  tick?: number;
  time?: string;
  /** Only in GET /api/player (not in SSE updates). */
  perception?: string;
}

export interface PlayerTool {
  name: string;
  description: string;
  argsHint: string;
  free: boolean;
}

// ─── German display labels (copied from backend src/types.ts / src/time.ts; docs/schlackental.md) ───

export const ITEM_LABELS: Record<ItemType, string> = {
  gerste: "Gerste", mehl: "Mehl", brot: "Brot", fleisch: "Fleisch", milch: "Ziegenmilch",
  eier: "Eier", rueben: "Rüben", kraeuter: "Kräuter", arznei: "Arznei",
  eisenerz: "Eisenerz", kohle: "Kohle", werkzeug: "Werkzeug", bauholz: "Bauholz",
  brennholz: "Brennholz", hausrat: "Hausrat", bier: "Dünnbier", eintopf: "Eintopf",
  leinen: "Leinen",
};

/** All item ids in display order. */
export const ALL_ITEM_IDS: ItemType[] = Object.keys(ITEM_LABELS);

export const SKILL_LABELS: Record<Skill, string> = {
  bauer: "Feldarbeiter", hirte: "Hirte", knappe: "Knappe", holzfaeller: "Holzfäller",
  mueller: "Müller", baecker: "Bäcker", schmied: "Schmied", zimmermann: "Zimmermann",
  wirt: "Wirt", bader: "Bader", haendler: "Händler", naeherin: "Flickerin",
  none: "ohne Handwerk",
};

export const SEASON_LABELS: Record<Season, string> = {
  spring: "Frühling", summer: "Sommer", autumn: "Herbst", winter: "Winter",
};

/** World event ids → German names (docs/schlackental.md "World events"). */
export const EVENT_LABELS: Record<string, string> = {
  drought: "Dürre",
  plague: "Grubenfieber",
  caravan: "Schmugglerzug",
  bandit_threat: "Wegelagerer",
  mine_collapse: "Stolleneinbruch",
  tax_day: "Zehnttag",
  double_harvest: "Reiche Ernte",
  plague_rumor: "Fiebergerücht",
};

/** Appell agenda ids → German names. */
export const AGENDA_LABELS: Record<string, string> = {
  general_rule: "Allgemeine Regel",
  tax_change: "Zehnt ändern",
  marketplace_hours: "Tauschbrett-Zeiten",
  banishment: "Karzerstrafe",
};

export const SLEEP_LABELS: Record<string, string> = {
  good: "gut", fair: "mäßig", poor: "schlecht",
};

export const TICKS_PER_DAY = 16;   // 06:00–21:00, one tick = one hour
export const DAYS_PER_SEASON = 7;

export function itemLabel(id: string | undefined | null): string {
  if (!id) return "—";
  return ITEM_LABELS[id] ?? id;
}

export function skillLabel(id: string | undefined | null): string {
  if (!id) return "—";
  return SKILL_LABELS[id] ?? id;
}

/** "15 Gr." — short currency format (Groschen). */
export function gr(n: number): string {
  return `${n} Gr.`;
}

/** Clock label of a tick, e.g. tick 2 → "07:00"; tick 0 → "—". */
export function tickClock(tick: number): string {
  if (tick < 1) return "—";
  const hour = 6 + ((tick - 1) % TICKS_PER_DAY);
  return `${String(hour).padStart(2, "0")}:00`;
}
