import { normalizeKey } from "./village-map.js";

// ─── Agents ────────────────────────────────────────────────

// Widened to string to support dynamically generated multi-village worlds.
// The hardcoded constants below (AGENT_NAMES, AGENT_SKILLS, etc.) remain as
// defaults for the 1-village Schlackental world.
export type AgentName = string;

export const AGENT_NAMES: AgentName[] = [
  "brakel", "rike", "ottmar", "wenzel", "kasper",
  "irmel", "bodo", "eckhart", "lenz",
  "grete", "walburga", "jost",
  "reinhart", "bruder_anno",
  "mattis", "vroni", "wendel", "minna", "gisbert",
];

export const COUNCIL_MEMBERS: AgentName[] = ["reinhart", "irmel", "eckhart", "bodo", "brakel"];

export const AGENT_DISPLAY_NAMES: Record<AgentName, string> = {
  brakel: "Brakel", rike: "Rike", ottmar: "Ottmar", wenzel: "Wenzel", kasper: "Kasper",
  irmel: "Irmel", bodo: "Bodo", eckhart: "Eckhart", lenz: "Lenz",
  grete: "Grete", walburga: "Walburga", jost: "Jost",
  reinhart: "Vogt Reinhart", bruder_anno: "Bruder Anno",
  mattis: "Mattis", vroni: "Vroni", wendel: "Wendel",
  minna: "Minna", gisbert: "Gisbert",
};

export const AGENT_HOMES: Record<AgentName, string> = {
  brakel: "Baracke 1", rike: "Baracke 2", ottmar: "Ziegenweide",
  wenzel: "Baracke 4", kasper: "Baracke 5", irmel: "Mühle",
  bodo: "Backstube", eckhart: "Schmiede", lenz: "Zimmerei",
  grete: "Schenke", walburga: "Baderhütte", jost: "Baracke 7",
  reinhart: "Vogtshaus", bruder_anno: "Vogtei",
  mattis: "Baracke 8", vroni: "Baracke 8", wendel: "Baracke 1", minna: "Flickstube", gisbert: "Baracke 3",
};

// ─── Skills ────────────────────────────────────────────────

export type Skill =
  | "bauer" | "hirte" | "knappe" | "holzfaeller"
  | "mueller" | "baecker" | "schmied" | "zimmermann"
  | "wirt" | "bader" | "haendler" | "naeherin"
  | "none";

export const SKILL_LABELS: Record<Skill, string> = {
  bauer: "Feldarbeiter", hirte: "Hirte", knappe: "Knappe", holzfaeller: "Holzfäller",
  mueller: "Müller", baecker: "Bäcker", schmied: "Schmied", zimmermann: "Zimmermann",
  wirt: "Wirt", bader: "Bader", haendler: "Händler", naeherin: "Flickerin",
  none: "ohne Handwerk",
};

export const AGENT_SKILLS: Record<AgentName, Skill> = {
  brakel: "bauer", rike: "none", ottmar: "hirte", wenzel: "bauer",
  kasper: "bauer", irmel: "mueller", bodo: "baecker", eckhart: "schmied",
  lenz: "zimmermann", grete: "wirt", walburga: "bader", jost: "holzfaeller",
  reinhart: "none", bruder_anno: "none",
  mattis: "knappe", vroni: "none", wendel: "bauer",
  minna: "naeherin", gisbert: "knappe",
};

export const AGENT_WORK_LOCATIONS: Record<AgentName, string> = {
  brakel: "Unterfeld", rike: "Baracke 2", ottmar: "Ziegenweide", wenzel: "Oberfeld",
  kasper: "Unterfeld", irmel: "Mühle", bodo: "Backstube", eckhart: "Schmiede",
  lenz: "Zimmerei", grete: "Schenke", walburga: "Baderhütte", jost: "Köhlerwald",
  reinhart: "Vogtshaus", bruder_anno: "Vogtei",
  mattis: "Erzstollen", vroni: "Zechenplatz", wendel: "Unterfeld",
  minna: "Flickstube", gisbert: "Erzstollen",
};

// ─── Seasons ───────────────────────────────────────────────

export type Season = "spring" | "summer" | "autumn" | "winter";

// ─── Items ─────────────────────────────────────────────────

export type ItemType =
  | "gerste" | "mehl" | "brot" | "fleisch" | "milch" | "eier" | "rueben"
  | "kraeuter" | "arznei" | "eisenerz" | "kohle" | "werkzeug"
  | "bauholz" | "brennholz" | "hausrat" | "bier" | "eintopf" | "leinen";

export const ALL_ITEMS: ItemType[] = [
  "gerste", "mehl", "brot", "fleisch", "milch", "eier", "rueben",
  "kraeuter", "arznei", "eisenerz", "kohle", "werkzeug",
  "bauholz", "brennholz", "hausrat", "bier", "eintopf", "leinen",
];

export const ITEM_LABELS: Record<ItemType, string> = {
  gerste: "Gerste", mehl: "Mehl", brot: "Brot", fleisch: "Fleisch", milch: "Ziegenmilch",
  eier: "Eier", rueben: "Rüben", kraeuter: "Kräuter", arznei: "Arznei",
  eisenerz: "Eisenerz", kohle: "Kohle", werkzeug: "Werkzeug", bauholz: "Bauholz",
  brennholz: "Brennholz", hausrat: "Hausrat", bier: "Dünnbier", eintopf: "Eintopf",
  leinen: "Leinen",
};

// Pre-reskin (English) item ids, still accepted as input so stale prompts/saves resolve.
const LEGACY_ITEM_IDS: Record<string, ItemType> = {
  wheat: "gerste", flour: "mehl", bread: "brot", meat: "fleisch", milk: "milch",
  eggs: "eier", vegetables: "rueben", herbs: "kraeuter", medicine: "arznei",
  iron_ore: "eisenerz", coal: "kohle", iron_tools: "werkzeug", timber: "bauholz",
  firewood: "brennholz", furniture: "hausrat", ale: "bier", meal: "eintopf", cloth: "leinen",
};

const ITEM_LOOKUP: Map<string, ItemType> = (() => {
  const m = new Map<string, ItemType>();
  for (const [legacy, id] of Object.entries(LEGACY_ITEM_IDS)) m.set(normalizeKey(legacy), id);
  for (const id of ALL_ITEMS) {
    m.set(normalizeKey(ITEM_LABELS[id]), id);
    m.set(normalizeKey(id), id);
  }
  return m;
})();

/**
 * Normalize an item argument from an LLM action/tool call. Known inputs resolve to their
 * ItemType; unknown non-empty input is passed through unchanged so the caller's existing
 * "no such item / not enough" feedback path still fires. Empty/non-string input → undefined.
 */
export function resolveItemInput(input: unknown): ItemType | undefined {
  if (typeof input !== "string" || !input.trim()) return undefined;
  return resolveItemId(input) ?? (input as ItemType);
}

/**
 * Resolve LLM/player item input to an ItemType. Accepts the new id, the German display
 * label ("Rüben", "Ziegenmilch") or the old English id ("bread"), case/umlaut-insensitive.
 */
export function resolveItemId(input: string): ItemType | null {
  if (typeof input !== "string" || !input.trim()) return null;
  return ITEM_LOOKUP.get(normalizeKey(input)) ?? null;
}

export interface InventoryItem {
  type: ItemType;
  quantity: number;
  reserved?: number;        // locked in sell orders; not available for use/eat
  spoilsAtTick?: number;    // milch (2 days = 32 ticks), fleisch (3 days = 48 ticks)
}

export interface Inventory {
  items: InventoryItem[];
}

// ─── Tools ─────────────────────────────────────────────────

export interface ToolState {
  type: "werkzeug";
  durability: number;       // 0–100
}

// ─── Body ──────────────────────────────────────────────────

export interface BodyState {
  hunger: number;           // 0 (full) → 5 (starving). 5 for 3+ ticks → death
  energy: number;           // 0–10
  sleep_quality: "good" | "fair" | "poor";
  sickness?: number;        // 0 = healthy, 1–3 = sick (reduces productivity)
  injury?: number;          // 0 = fine, 1–3 = injured (mine accident, etc.)
  starvation_ticks?: number; // consecutive ticks at hunger === 5
}

// ─── Economic State (per agent) ────────────────────────────

export interface AgentEconomicState {
  wallet: number;
  inventory: Inventory;
  tool: ToolState | null;
  skill: Skill;
  homeLocation: string;
  workLocation: string;
  workSchedule: { open: number; close: number };
  hiredBy?: AgentName;
  hiredUntilTick?: number;
  villageId?: string;  // undefined = "schlackental" (backward compat)
}

// ─── Marketplace ───────────────────────────────────────────

export interface Order {
  id: string;
  agentId: AgentName;
  type: "sell" | "buy";
  item: ItemType;
  quantity: number;
  price: number;            // coins per unit
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

// ─── Economy Snapshot ──────────────────────────────────────

export interface EconomySnapshot {
  tick: number;
  day: number;
  season: Season;
  totalWealth: number;
  giniCoefficient: number;
  gdp: number;
  priceIndex: Record<ItemType, number>;
  scarcityAlerts: ItemType[];
  wealthDistribution: { agent: AgentName; wallet: number; inventoryValue: number }[];
}

// ─── World Events ──────────────────────────────────────────

export type EventType = "drought" | "plague" | "caravan" | "bandit_threat" | "mine_collapse" | "tax_day" | "double_harvest" | "plague_rumor";

export interface ActiveEvent {
  type: EventType;
  description: string;
  startTick: number;
  endTick: number;
  affectedAgents?: AgentName[];
}

// ─── World Objects ─────────────────────────────────────────

export interface WorldObject {
  id: string;
  type: "notice" | "letter" | "note";
  label: string;
  location: string;
  content: string;
  placed_day: number;
  discovered_by: string[];
  read_by: string[];
  visibility: "private" | "shared";
  duration_days?: number;
  recipient?: AgentName;
}

// ─── Messages ──────────────────────────────────────────────

export interface QueuedMessage {
  from: AgentName;
  type: "message" | "note";
  text?: string;
  sent_tick: number;
}

// ─── Loans ─────────────────────────────────────────────────

export interface Loan {
  id: string;
  creditor: AgentName;
  debtor: AgentName;
  amount: number;
  issuedTick: number;
  dueTick: number;          // issuedTick + 112 (7 in-game days)
  description: string;
  repaid: boolean;
}

// ─── Theft Records ─────────────────────────────────────────

export interface StealRecord {
  from: AgentName;
  item: string;
}

// ─── Governance ────────────────────────────────────────────

export type AgendaType =
  | "tax_change" | "marketplace_hours" | "banishment" | "general_rule"
  | "grant_tools" | "curfew" | "trade_restriction" | "repeal";

export interface PendingMeeting {
  villageId: string;
  scheduledTick: number;
  agendaType: AgendaType;
  description: string;
  target?: AgentName;
  calledAtTick: number;
}

export interface Law {
  id: string;
  type: AgendaType;
  description: string;
  passedTick: number;
  value?: number;
  target?: AgentName;
  // grant_tools: which tools granted to whom
  grantedTools?: string[];
  grantedTo?: AgentName;
  // trade_restriction: what's blocked and when
  restrictedItem?: string;
  restrictedHours?: [number, number];
  // repeal: which law this removes
  repealsLawId?: string;
}

export interface Violation {
  tick: number;
  agent: AgentName;
  lawId: string;
  action: string;
  blocked: boolean;
}

// ─── Action Types ──────────────────────────────────────────

export type AgentActionType =
  | "speak" | "think" | "wait" | "move_to" | "petition_meeting"
  | "knock_door" | "lock_door" | "unlock_door"
  | "send_message" | "leave_note" | "read"
  | "produce" | "eat"
  | "post_order" | "buy_item" | "cancel_order"
  | "hire" | "lend_coin" | "give_coin" | "steal" | "call_meeting" | "propose_rule" | "vote"
  | "propose_repeal" | "fine_agent" | "seize_goods";

export interface AgentAction {
  type: AgentActionType;
  text?: string;
  location?: string;
  target?: string;
  object_id?: string;
  to?: string;
  // produce
  item?: ItemType | string;
  // post_order
  side?: "sell" | "buy" | "agree" | "disagree";
  quantity?: number;
  price?: number;
  // buy_item
  max_price?: number;
  // cancel_order
  order_id?: string;
  // eat
  // hire
  wage?: number;
  task?: string;
  // lend_coin / give_coin
  amount?: number;
  description?: string;
  // governance
  agenda_type?: "tax_change" | "marketplace_hours" | "banishment" | "general_rule";
  value?: number;
}

export interface ResolvedAction extends AgentAction {
  result: string;
  visible: boolean;
}

export interface AgentTurnResult {
  agent: AgentName;
  actions: ResolvedAction[];
  pendingMove?: string;
  historyLines?: string[];
}

// ─── Time ──────────────────────────────────────────────────

export interface SimTime {
  tick: number;
  hour: number;             // 6–21
  dayOfWeek: string;
  dayNumber: number;        // absolute day count from start
  weekNumber: number;
  seasonDay: number;        // 1–7 (day within current season)
  season: Season;
  yearNumber: number;
  isFirstTickOfDay: boolean;
  timeLabel: string;
}

// ─── Player (human colonist, id "player") ──────────────────

/** Speech or offer the player produced that co-located NPCs still have to hear (see player.ts). */
export interface PlayerPendingSpeech {
  name: string;
  text: string;
  location: string;
  /** Tick whose decision phase hears it; dropped at the end of that tick. */
  tick: number;
}

export interface PlayerPendingOffer {
  from: AgentName;
  fromName: string;
  to: AgentName;
  item: string;
  price: number;
  qty: number;
  location: string;
  tick: number;
}

export interface PlayerState {
  created: boolean;
  name: string;
  skill: Skill;
  createdTick: number;
  // ── runtime bookkeeping (managed by player.ts) ──
  /** Budgeted actions used in the tick named by `budgetTick`. */
  actionsUsed?: number;
  /** Tick the budget counter belongs to; a different tick resets the counter. */
  budgetTick?: number;
  /** Actions executed but not yet resolved by the engine (produce is resolved at tick end). */
  pendingActions?: ResolvedAction[];
  /** Player speech NPCs at the same location hear in their next decision phase. */
  pendingSpeech?: PlayerPendingSpeech[];
  /** Offers the player made via negotiate that NPCs at the same location can answer. */
  pendingOffers?: PlayerPendingOffer[];
  /** Offers NPCs made to the player (the player answers with negotiate). */
  incomingOffers?: { from: AgentName; fromName: string; to: AgentName; item: string; price: number; qty: number }[];
  /** Last lines of conversation the player heard (formatted like NPC conversationSoFar). */
  heard?: string[];
  /** Messages (send_message) delivered to the player at the start of the current tick. */
  inbox?: string[];
  /** Moves of the current tick, for the tick log. */
  moveLog?: { from: string; to: string }[];
}

// ─── World State ───────────────────────────────────────────

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
  doors: Record<string, "locked" | "unlocked">;
  message_queue: Record<AgentName, QueuedMessage[]>;
  objects: WorldObject[];
  action_feedback: Record<AgentName, string[]>;
  acquaintances: Record<AgentName, AgentName[]>;

  economy_snapshots: EconomySnapshot[];
  total_tax_collected: number;

  // Production tracking for economy snapshots
  production_log: { tick: number; agent: AgentName; item: ItemType; qty: number }[];

  // Loan records
  loans: Loan[];

  // Theft records (persists forever)
  caughtStealing: Partial<Record<AgentName, StealRecord[]>>;

  // Governance
  pending_meetings: Record<string, PendingMeeting>;
  pending_petitions?: { agent: AgentName; topic: string; tick: number; villageId: string }[];
  active_laws: Law[];
  banned: Partial<Record<AgentName, number>>;
  tax_rate: number;
  violations_log: Violation[];

  // Multi-village: per-village marketplaces (absent = single-village mode using `marketplace`)
  marketplaces?: Record<string, Marketplace>;

  // Human player ("der Neue"). Absent until POST /api/player/create; while absent there are
  // no `player` entries in agent_locations/body/economics either (the player is not in the world).
  player?: PlayerState;
}

// ─── Tick Log ──────────────────────────────────────────────

export interface TickLogEntry {
  agent: AgentName;
  actions: { type: string; text?: string; result?: string }[];
}

export interface MeetingLog {
  description: string;
  agendaType: string;
  attendees: AgentName[];
  discussion: { agent: AgentName; text: string }[];
  proposal: string;
  votes: { agree: AgentName[]; disagree: AgentName[] };
  passed: boolean;
  agreeCount: number;
  requiredCount: number;
  law?: string;
}

export interface TickLog {
  tick: number;
  simulated_time: string;
  season: Season;
  weather: string;
  locations: Record<string, { agents: string[]; rounds: unknown[] }>;
  movements: { agent: AgentName; from: string; to: string }[];
  trades: Trade[];
  productions: { agent: AgentName; item: ItemType; qty: number }[];
  meeting?: MeetingLog;
}
