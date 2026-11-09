/**
 * Runtime world registry.
 *
 * Loads from data/world_config.json if present; otherwise wraps the hardcoded
 * 1-village Schlackental defaults. All engine modules import from here instead of
 * directly from types.ts or village-map.ts.
 */

import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import type { Skill, WorldState } from "./types.js";
import { readWorldState, writeWorldState } from "./memory.js";
import {
  SKILL_LABELS,
  AGENT_NAMES,
  AGENT_DISPLAY_NAMES,
  AGENT_SKILLS,
  AGENT_WORK_LOCATIONS,
  AGENT_HOMES,
  COUNCIL_MEMBERS,
} from "./types.js";
import {
  LOCATIONS,
  ADJACENCY,
  OPENING_HOURS,
  LOCATION_TILES,
  HUB_LOCATION,
  PRISON_LOCATION,
  TOWNHALL_LOCATION,
  ELDER_HOME_LOCATION,
  MERCHANT_CAMP_LOCATION,
  normalizeKey,
  resolveLocationName,
  isBaseLocation,
} from "./village-map.js";

// ─── Schema ──────────────────────────────────────────────────

/** Model tier an individual colonist runs on (resolved to a concrete model ID in llm.ts). */
export type ModelTier = "haiku" | "sonnet" | "opus";
export const MODEL_TIERS: readonly ModelTier[] = ["haiku", "sonnet", "opus"];

export interface AgentConfig {
  id: string;
  displayName: string;
  skill: Skill;
  homeLocation: string;
  workLocation: string;
  description: string;    // shown to unknown acquaintances: "a farmer", "the miller"
  /** Per-colonist model tier override; unset = global CHARACTER_MODEL (default "haiku"). */
  model?: ModelTier;
}

export interface VillageConfig {
  id: string;
  name: string;
  agents: AgentConfig[];
  locations: string[];
  locationTypes: Record<string, string>;  // location name → type ("farm", "mill", etc.)
  councilMembers: string[];
  adjacency: Record<string, string[]>;
  openingHours: Partial<Record<string, { open: number; close: number }>>;
  locationTiles?: Record<string, { tx: number; ty: number }>;
  /** One German lore sentence about the settlement (see getVillageDescription). */
  description?: string;
}

export interface RoadConfig {
  id: string;
  name: string;                        // "Road: Schlackental→Rabenstollen"
  connectsVillages: [string, string];  // village IDs
  transitTicks: number;
}

export interface WorldConfig {
  villages: VillageConfig[];
  roads: RoadConfig[];
}

// ─── Default village identity ────────────────────────────────────────────

export const DEFAULT_VILLAGE_ID = "schlackental";
export const DEFAULT_VILLAGE_NAME = "Schlackental";

/** One German lore sentence per known settlement; used by the generator and as a fallback for old configs. */
export const VILLAGE_LORE: Record<string, string> = {
  schlackental: "Schlackental ist eine Strafkolonie im Bergtal: Häftlinge brechen hier Erz, und seit der Bergsturz den Kehlpass verschüttet hat, kommt weder Nachschub herein noch jemand hinaus.",
  rabenstollen: "Rabenstollen ist ein rivalisierendes Bergwerkslager jenseits des Grats, dessen reiche Erzader man in Schlackental mit Neid betrachtet.",
  kehlhof: "Kehlhof ist ein armes Bauerndorf an der alten Passstraße und baut das Korn des ganzen Tals an.",
  moosgrund: "Moosgrund ist ein feuchtes Köhlerdorf am Waldrand, das von Holz, Torf und Gelegenheitsarbeit lebt.",
  aschenbruch: "Aschenbruch ist ein halb verlassener Meiler am Hang, in dem sich nach dem Bergsturz Versprengte eingerichtet haben.",
};

// ─── Skill → workplace (shared by the generator and live role changes) ────

/** Bare (unprefixed) workplace of a skill. `farmIndex` spreads farmers over the three fields. */
export function workLocationForSkill(skill: Skill, farmIndex = 1): string {
  switch (skill) {
    case "bauer":       return farmIndex <= 1 ? "Unterfeld" : farmIndex === 2 ? "Ziegenweide" : "Oberfeld";
    case "hirte":       return "Ziegenweide";
    case "knappe":      return "Erzstollen";
    case "holzfaeller": return "Köhlerwald";
    case "mueller":     return "Mühle";
    case "baecker":     return "Backstube";
    case "schmied":     return "Schmiede";
    case "zimmermann":  return "Zimmerei";
    case "wirt":        return "Schenke";
    case "bader":       return "Baderhütte";
    case "naeherin":    return "Flickstube";
    default:            return HUB_LOCATION;
  }
}

/** German skill labels for the UI: [{ id, label }] in a stable order (reuses SKILL_LABELS from types.ts). */
export function getSkillOptions(): { id: Skill; label: string }[] {
  return (Object.keys(SKILL_LABELS) as Skill[]).map(id => ({ id, label: SKILL_LABELS[id] }));
}

// ─── Default location types (for Schlackental's bare location names) ─────

const LOCATION_TYPE_BY_NAME: Record<string, string> = {
  [normalizeKey("Unterfeld")]: "farm",
  [normalizeKey("Ziegenweide")]: "farm",
  [normalizeKey("Oberfeld")]: "farm",
  [normalizeKey("Mühle")]: "mill",
  [normalizeKey("Schmiede")]: "forge",
  [normalizeKey("Erzstollen")]: "mine",
  [normalizeKey("Köhlerwald")]: "forest",
  [normalizeKey("Backstube")]: "bakery",
  [normalizeKey("Schenke")]: "tavern",
  [normalizeKey("Zimmerei")]: "carpenter",
  [normalizeKey("Baderhütte")]: "healer",
  [normalizeKey("Flickstube")]: "seamstress",
  [normalizeKey(TOWNHALL_LOCATION)]: "townhall",
  [normalizeKey(HUB_LOCATION)]: "square",
  [normalizeKey(ELDER_HOME_LOCATION)]: "elder",
  [normalizeKey(PRISON_LOCATION)]: "prison",
  [normalizeKey(MERCHANT_CAMP_LOCATION)]: "merchant",
};

function inferLocationType(name: string): string | undefined {
  const n = normalizeKey(name);
  if (/^baracke_\d$/.test(n) || n === "baracke") return "cottage";
  const byName = LOCATION_TYPE_BY_NAME[n];
  if (byName) return byName;
  // For prefixed locations (multi-village): "Rabenstollen:Unterfeld" → strip prefix, re-infer
  const colon = name.lastIndexOf(":");
  if (colon !== -1) return inferLocationType(name.slice(colon + 1).trim());
  return undefined;
}

// Default agent descriptions for Schlackental's hardcoded cast (German, shown to strangers)
export const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  brakel: "der Rottmeister der Feldrotte", wendel: "ein Feldarbeiter", wenzel: "ein Rübenbauer",
  kasper: "ein Feldarbeiter", ottmar: "der Ziegenhirte", irmel: "die Müllerin",
  bodo: "der Bäcker", grete: "die Schankwirtin", eckhart: "der Schmied",
  lenz: "der Zimmermann", jost: "ein Holzfäller", mattis: "ein Knappe",
  gisbert: "ein Knappe", walburga: "die Baderin", minna: "die Flickerin",
  rike: "eine Häftlingsfrau aus den Baracken", vroni: "eine Kolonistin",
  reinhart: "der Bergvogt", bruder_anno: "der Kaplan der Kolonie",
};

// ─── Build default single-village config from hardcoded constants ────────

function buildDefaultConfig(): WorldConfig {
  const agents: AgentConfig[] = [...AGENT_NAMES].map(id => ({
    id,
    displayName: AGENT_DISPLAY_NAMES[id] ?? id,
    skill: AGENT_SKILLS[id] ?? "none",
    homeLocation: AGENT_HOMES[id] ?? HUB_LOCATION,
    workLocation: AGENT_WORK_LOCATIONS[id] ?? HUB_LOCATION,
    description: DEFAULT_DESCRIPTIONS[id] ?? "ein Kolonist",
  }));

  const locationTypes: Record<string, string> = {};
  for (const loc of LOCATIONS) {
    const t = inferLocationType(loc);
    if (t) locationTypes[loc] = t;
  }

  const village: VillageConfig = {
    id: DEFAULT_VILLAGE_ID,
    name: DEFAULT_VILLAGE_NAME,
    agents,
    locations: [...LOCATIONS],
    locationTypes,
    councilMembers: [...COUNCIL_MEMBERS],
    adjacency: { ...ADJACENCY },
    openingHours: { ...OPENING_HOURS },
    locationTiles: { ...LOCATION_TILES },
    description: VILLAGE_LORE[DEFAULT_VILLAGE_ID],
  };

  return { villages: [village], roads: [] };
}

// ─── Load (or build default) ──────────────────────────────────

const configPath = () => join(process.cwd(), "data", "world_config.json");

function loadConfig(): WorldConfig {
  const path = configPath();
  if (!existsSync(path)) return buildDefaultConfig();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as WorldConfig;
    // Ensure road adjacency is present in each village's adjacency map
    for (const road of raw.roads ?? []) {
      const [v1id, v2id] = road.connectsVillages;
      const v1 = raw.villages.find(v => v.id === v1id);
      const v2 = raw.villages.find(v => v.id === v2id);
      if (v1 && !v1.adjacency[road.name]) v1.adjacency[road.name] = [];
      if (v2 && !v2.adjacency[road.name]) v2.adjacency[road.name] = [];
    }
    return raw;
  } catch (e) {
    console.warn("[world-registry] Failed to parse world_config.json, using defaults:", e);
    return buildDefaultConfig();
  }
}

// Singleton — loaded once per process
let _config: WorldConfig | null = null;

function getConfig(): WorldConfig {
  if (!_config) _config = loadConfig();
  return _config;
}

/**
 * Force reload from disk (used after generate-world runs and per-agent model changes).
 * Drops the config and every lookup table derived from it; both are rebuilt lazily on the next
 * access. Synchronous, so it is safe mid-tick. The player identity (`_player`) lives outside the
 * config and is deliberately left untouched.
 */
export function reloadConfig(): void {
  _config = null;
  _agentMap = null;
  _agentVillage = null;
  _locationVillage = null;
  _villageMap = null;
}

// ─── Lookup tables (built lazily from config) ────────────────

let _agentMap: Map<string, AgentConfig> | null = null;
let _agentVillage: Map<string, string> | null = null;
let _locationVillage: Map<string, string> | null = null;
let _villageMap: Map<string, VillageConfig> | null = null;

function buildMaps(): void {
  const cfg = getConfig();
  _agentMap = new Map();
  _agentVillage = new Map();
  _locationVillage = new Map();
  _villageMap = new Map();

  for (const village of cfg.villages) {
    _villageMap.set(village.id, village);
    for (const agent of village.agents) {
      _agentMap.set(agent.id, agent);
      _agentVillage.set(agent.id, village.id);
    }
    for (const loc of village.locations) {
      _locationVillage.set(loc, village.id);
    }
    // Roads in this village's adjacency but not in its location list need village mapping too
    for (const road of cfg.roads ?? []) {
      _locationVillage.set(road.name, road.connectsVillages[0]);
    }
  }
}

function ensureMaps(): void {
  if (!_agentMap) buildMaps();
}

// ─── Public API ───────────────────────────────────────────────

// ─── Human player ────────────────────────────────────────────
// The player is not part of the generated cast. While a player exists, the registry
// exposes it as one more agent (so every per-agent loop, name resolution and display
// lookup treats it like a colonist); LLM paths filter PLAYER_ID out explicitly.

export const PLAYER_ID = "player";
/** What NPCs call the player while they don't know the name. */
export const PLAYER_DESCRIPTION = "der Neue aus Baracke 6";

let _player: { name: string; skill: Skill } | null = null;

let _identityPinned = false;

/** Register (or with null: remove) the human player. Called from readWorldState and createPlayer. */
export function setPlayerIdentity(identity: { name: string; skill: Skill } | null): void {
  _player = identity;
}

/**
 * While a tick runs, the engine's in-memory state is authoritative for the player identity:
 * disk reads (God Mode endpoints read world_state.json mid-tick) must not change it.
 */
export function pinPlayerIdentity(pinned: boolean): void {
  _identityPinned = pinned;
}

export function isPlayerIdentityPinned(): boolean {
  return _identityPinned;
}

export function isPlayerActive(): boolean {
  return _player !== null;
}

/** The generated cast only (no player) — use for everything that calls an LLM. */
export function getNpcNames(): string[] {
  return getConfig().villages.flatMap(v => v.agents.map(a => a.id));
}

export function getAgentNames(): string[] {
  const npcs = getNpcNames();
  return _player ? [...npcs, PLAYER_ID] : npcs;
}

/** The generated cast of one village (no player) — meeting participants run through the LLM. */
export function getVillageAgents(villageId: string): string[] {
  const v = getConfig().villages.find(v => v.id === villageId);
  return v ? v.agents.map(a => a.id) : [];
}

/** Everyone who lives in the village, including the player: use for notices and the Zehnt. */
export function getVillageMembers(villageId: string): string[] {
  const npcs = getVillageAgents(villageId);
  return _player && getAgentVillage(PLAYER_ID) === villageId ? [...npcs, PLAYER_ID] : npcs;
}

export function getAgentVillage(agent: string): string {
  ensureMaps();
  return _agentVillage!.get(agent) ?? DEFAULT_VILLAGE_ID;
}

export function getDisplayName(agent: string): string {
  if (agent === PLAYER_ID && _player) return _player.name;
  ensureMaps();
  return _agentMap!.get(agent)?.displayName ?? AGENT_DISPLAY_NAMES[agent] ?? agent;
}

/**
 * Resolve an agent name typed by an LLM/player to an agent id.
 * Accepts the id, the full display name or any single word of the display name
 * ("Reinhart", "Vogt Reinhart", "reinhart", "Anno", "Bruder Anno"), case/umlaut-insensitive
 * via normalizeKey. Full id/display-name matches win; a single-word match that hits
 * more than one candidate is ambiguous and returns null.
 */
export function resolveAgentName(input: string, candidates: readonly string[]): string | null {
  if (typeof input !== "string") return null;
  const key = normalizeKey(input);
  if (!key) return null;

  const exact = candidates.find(id => normalizeKey(id) === key || normalizeKey(getDisplayName(id)) === key);
  if (exact) return exact;

  const byWord = candidates.filter(id =>
    normalizeKey(getDisplayName(id)).split("_").includes(key) ||
    normalizeKey(id).split("_").includes(key)
  );
  return byWord.length === 1 ? byWord[0]! : null;
}

export function getSkill(agent: string): Skill {
  if (agent === PLAYER_ID && _player) return _player.skill;
  ensureMaps();
  const skill = _agentMap!.get(agent)?.skill;
  if (skill) return skill;
  return AGENT_SKILLS[agent] ?? "none";
}

export function getDescription(agent: string): string {
  if (agent === PLAYER_ID && _player) return PLAYER_DESCRIPTION;
  ensureMaps();
  return _agentMap!.get(agent)?.description ?? DEFAULT_DESCRIPTIONS[agent] ?? "ein Kolonist";
}

export function getCouncilMembers(villageId: string): string[] {
  const v = getConfig().villages.find(v => v.id === villageId);
  return v?.councilMembers ?? [];
}

export function getVillageElder(villageId: string): string | undefined {
  return getCouncilMembers(villageId)[0];
}

export function getVillageTownHall(villageId: string): string {
  const v = getConfig().villages.find(v => v.id === villageId);
  if (!v) return TOWNHALL_LOCATION;
  return v.locations.find(l => isBaseLocation(l, TOWNHALL_LOCATION)) ?? TOWNHALL_LOCATION;
}

export function getVillageLocations(villageId: string): string[] {
  ensureMaps();
  const v = _villageMap!.get(villageId);
  if (!v) return [...LOCATIONS];
  // Include road locations connected to this village
  const cfg = getConfig();
  const roads = (cfg.roads ?? [])
    .filter(r => r.connectsVillages.includes(villageId))
    .map(r => r.name);
  return [...v.locations, ...roads];
}

export function getAllLocations(): string[] {
  const cfg = getConfig();
  const locs = cfg.villages.flatMap(v => v.locations);
  const roads = (cfg.roads ?? []).map(r => r.name);
  return [...locs, ...roads];
}

export function getVillageAdjacency(villageId: string): Record<string, string[]> {
  ensureMaps();
  return _villageMap!.get(villageId)?.adjacency ?? ADJACENCY;
}

export function getVillageOpeningHours(
  villageId: string,
): Partial<Record<string, { open: number; close: number }>> {
  ensureMaps();
  return _villageMap!.get(villageId)?.openingHours ?? OPENING_HOURS;
}

export function getLocationTiles(villageId: string): Record<string, { tx: number; ty: number }> {
  ensureMaps();
  return _villageMap!.get(villageId)?.locationTiles ?? LOCATION_TILES;
}

export function getLocationType(loc: string): string | undefined {
  const cfg = getConfig();
  for (const village of cfg.villages) {
    const t = village.locationTypes[loc];
    if (t) return t;
  }
  // Fallback: infer from name
  return inferLocationType(loc);
}

export function getVillageForLocation(loc: string): string | undefined {
  ensureMaps();
  return _locationVillage!.get(loc);
}

export function getVillages(): VillageConfig[] {
  return getConfig().villages;
}

/** Lore sentence of a settlement (config value, else the built-in lore for known ids, else ""). */
export function getVillageDescription(villageId: string): string {
  const v = getConfig().villages.find(v => v.id === villageId);
  return v?.description ?? VILLAGE_LORE[villageId] ?? "";
}

export function getRoads(): RoadConfig[] {
  return getConfig().roads ?? [];
}

export function isRoadLocation(loc: string): boolean {
  return (getConfig().roads ?? []).some(r => r.name === loc);
}

export function isValidLocation(loc: string): boolean {
  ensureMaps();
  return _locationVillage!.has(loc) || isRoadLocation(loc);
}

/**
 * Resolves a potentially bare location name to the fully qualified name for the given agent.
 * e.g. a Rabenstollen agent typing "Köhlerwald" → "Rabenstollen:Köhlerwald"
 * If already valid (or unresolvable), returns the input unchanged.
 */
export function resolveAgentLocation(agent: string, loc: string, currentVillageId?: string): string {
  if (isValidLocation(loc)) return loc;

  // Strip hallucinated village-name prefix (e.g. "Schlackental:Zechenplatz" → "Zechenplatz")
  const cfg = getConfig();
  for (const v of cfg.villages) {
    if (v.name && loc.startsWith(`${v.name}:`)) {
      const stripped = loc.slice(v.name.length + 1);
      if (isValidLocation(stripped)) return stripped;
      const reprefixed = `${v.name}:${stripped}`;
      if (isValidLocation(reprefixed)) return reprefixed;
    }
  }

  const vid = currentVillageId ?? getAgentVillage(agent);
  const vName = cfg.villages.find(v => v.id === vid)?.name ?? "";
  if (vName) {
    const prefixed = `${vName}:${loc}`;
    if (isValidLocation(prefixed)) return prefixed;
  }

  // Normalized match ("Muehle", "baderhütte" → "Mühle", "Baderhütte"), on the agent's own village first.
  const candidates = getVillageLocations(vid);
  const direct = resolveLocationName(loc, candidates);
  if (direct) return direct;
  const bareCandidates = candidates.map(c => c.slice(c.lastIndexOf(":") + 1));
  const bareInput = loc.slice(loc.lastIndexOf(":") + 1);
  const bare = resolveLocationName(bareInput, bareCandidates);
  if (bare) return candidates[bareCandidates.indexOf(bare)]!;

  return loc;
}

/** Returns opening hours for any location, regardless of which village it belongs to. */
export function getLocationHours(loc: string): { open: number; close: number } | undefined {
  const cfg = getConfig();
  for (const village of cfg.villages) {
    if (village.openingHours[loc]) return village.openingHours[loc];
  }
  // Fallback for bare names (single-village mode)
  return OPENING_HOURS[loc];
}

export function isLocationOpenByRegistry(loc: string, hourIndex: number): boolean {
  const hours = getLocationHours(loc);
  if (!hours) return true;
  return hourIndex >= hours.open && hourIndex < hours.close;
}

export function getAgentHomeLocation(agent: string): string {
  ensureMaps();
  return _agentMap!.get(agent)?.homeLocation ?? AGENT_HOMES[agent] ?? HUB_LOCATION;
}

export function getAgentWorkLocation(agent: string): string {
  ensureMaps();
  return _agentMap!.get(agent)?.workLocation ?? AGENT_WORK_LOCATIONS[agent] ?? HUB_LOCATION;
}

// ─── Per-colonist LLM model ───────────────────────────────────

const isModelTier = (v: unknown): v is ModelTier =>
  typeof v === "string" && (MODEL_TIERS as readonly string[]).includes(v);

/** Global default model for colonists without an override. */
export function getDefaultModel(): string {
  return process.env.CHARACTER_MODEL || "haiku";
}

/** Model (tier name, or the raw CHARACTER_MODEL value) this colonist's LLM calls use. */
export function getAgentModel(agent: string): string {
  ensureMaps();
  const tier = _agentMap!.get(agent)?.model;
  return isModelTier(tier) ? tier : getDefaultModel();
}

/**
 * Set (or with null: clear) a colonist's model tier. Persists to data/world_config.json
 * (materialising the current effective config first if the file does not exist yet) and
 * reloads the registry so the next LLM call in this process picks it up.
 */
export function setAgentModel(agent: string, model: ModelTier | null): void {
  if (agent === PLAYER_ID || !getNpcNames().includes(agent)) {
    throw new Error(`Unbekannter Kolonist: ${agent}`);
  }
  if (model !== null && !isModelTier(model)) {
    throw new Error(`Unbekanntes Modell: ${String(model)}. Möglich: ${MODEL_TIERS.join(", ")}.`);
  }

  mutateConfigFile(cfg => {
    const entry = cfg.villages.flatMap(v => v.agents).find(a => a.id === agent);
    if (!entry) throw new Error(`Unbekannter Kolonist: ${agent}`);
    if (model === null) delete entry.model;
    else entry.model = model;
  });
}

/**
 * Read data/world_config.json (materialising the current effective config if the file does not
 * exist yet), apply `mutate`, write-then-rename (a crash mid-write cannot leave a truncated
 * config behind) and reload the registry. If `mutate` throws nothing is written.
 */
function mutateConfigFile(mutate: (cfg: WorldConfig) => void): void {
  const path = configPath();
  const cfg: WorldConfig = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf-8")) as WorldConfig)
    : (JSON.parse(JSON.stringify(getConfig())) as WorldConfig);
  mutate(cfg);
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  renameSync(tmp, path);
  reloadConfig();
}

// ─── Live roles (skill, council seat, director's character note) ─────────

export interface AgentRole {
  agent: string;
  skill: Skill;
  council: boolean;
  /** Text of the profile's "## Regie-Notiz" section ("" = none). */
  character: string;
  isElder: boolean;
}

export interface RolePatch {
  skill?: Skill;
  council?: boolean;
  character?: string;
}

/** Dative phrase for "Der Rat hat dich <zum Schmied> bestimmt". */
const SKILL_TO_PHRASE: Record<Skill, string> = {
  bauer: "zum Feldarbeiter", hirte: "zum Hirten", knappe: "zum Knappen", holzfaeller: "zum Holzfäller",
  mueller: "zum Müller", baecker: "zum Bäcker", schmied: "zum Schmied", zimmermann: "zum Zimmermann",
  wirt: "zum Wirt", bader: "zum Bader", haendler: "zum Händler", naeherin: "zur Flickerin",
  none: "zum Handlanger",
};

/** "in der Schmiede" style phrase for a bare workplace name. */
const WORKPLACE_PHRASE: Record<string, string> = {
  Unterfeld: "auf dem Unterfeld", Oberfeld: "auf dem Oberfeld", Ziegenweide: "auf der Ziegenweide",
  Erzstollen: "im Erzstollen", "Köhlerwald": "im Köhlerwald", "Mühle": "in der Mühle",
  Backstube: "in der Backstube", Schmiede: "in der Schmiede", Zimmerei: "in der Zimmerei",
  Schenke: "in der Schenke", "Baderhütte": "in der Baderhütte", Flickstube: "in der Flickstube",
  Zechenplatz: "auf dem Zechenplatz",
};

export const CHARACTER_NOTE_HEADING = "## Regie-Notiz";
export const CHARACTER_NOTE_MAX = 1000;

const profilePath = (agent: string) => join(process.cwd(), "data", "profiles", `${agent}.md`);

// Matches the whole note section: heading line up to the next "## " heading or end of file.
const CHARACTER_SECTION_RE = new RegExp(`\\n*${CHARACTER_NOTE_HEADING}[^\\n]*\\n[\\s\\S]*?(?=\\n## |$)`);

/** Body of the profile's "## Regie-Notiz" section, "" if there is none (or no profile file). */
export function readCharacterNote(agent: string): string {
  const path = profilePath(agent);
  if (!existsSync(path)) return "";
  const m = CHARACTER_SECTION_RE.exec(readFileSync(path, "utf-8"));
  if (!m) return "";
  return m[0].trim().slice(CHARACTER_NOTE_HEADING.length).trim();
}

function writeCharacterNote(agent: string, text: string): void {
  const path = profilePath(agent);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : `# ${getDisplayName(agent)}\n`;
  const without = existing.replace(CHARACTER_SECTION_RE, "").replace(/\s+$/, "");
  const next = text ? `${without}\n\n${CHARACTER_NOTE_HEADING}\n${text}\n` : `${without}\n`;
  mkdirSync(join(process.cwd(), "data", "profiles"), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, next);
  renameSync(tmp, path);
}

/** Keeps the note a single section: no markdown headings, normalised newlines. */
function sanitizeCharacter(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map(l => l.replace(/^\s*#+\s*/, "")).join("\n").trim();
}

export function getAgentRole(agent: string): AgentRole {
  if (agent === PLAYER_ID || !getNpcNames().includes(agent)) {
    throw new Error(`Unbekannter Kolonist: ${agent}`);
  }
  const council = getCouncilMembers(getAgentVillage(agent));
  return {
    agent,
    skill: getSkill(agent),
    council: council.includes(agent),
    character: readCharacterNote(agent),
    isElder: council[0] === agent,
  };
}

// Role changes written while a tick runs would be overwritten by the engine's in-memory state at
// the end of the tick. They are remembered here and re-applied (idempotently) by
// applyPendingRoleSync, which memory.writeWorldState calls before every write. Entries live until
// clearPendingRoleSync() — sim-control's gateBeforeTick calls it before each tick, because from
// then on the tick reads the changes from disk (and re-adding a consumed notice would duplicate it).
const pendingRoleSync = new Map<string, { skill?: Skill; workLocation?: string; feedback: string[] }>();

export function clearPendingRoleSync(): void {
  pendingRoleSync.clear();
}

export function applyPendingRoleSync(state: WorldState): void {
  for (const [agent, p] of pendingRoleSync) {
    const eco = state.economics[agent];
    if (eco) {
      if (p.skill) eco.skill = p.skill;
      if (p.workLocation) eco.workLocation = p.workLocation;
    }
    if (state.action_feedback[agent]) {
      for (const msg of p.feedback) {
        if (!state.action_feedback[agent]!.includes(msg)) state.action_feedback[agent]!.push(msg);
      }
    }
  }
}

/**
 * Change a colonist's skill, council seat and/or director's character note, live.
 * Validates everything first (nothing is written if anything is invalid), then persists the
 * config (skill, workLocation, council), world_state.json (economics skill/workLocation and a
 * German notice in action_feedback) and the profile file, and reloads the registry.
 */
export function setAgentRole(agent: string, patch: RolePatch): AgentRole {
  if (agent === PLAYER_ID || !getNpcNames().includes(agent)) {
    throw new Error(`Unbekannter Kolonist: ${agent}`);
  }
  if (!patch || typeof patch !== "object") throw new Error("Ungültige Rollenänderung.");
  if (patch.skill !== undefined && !(patch.skill in SKILL_LABELS)) {
    throw new Error(`Unbekanntes Handwerk: ${String(patch.skill)}`);
  }
  if (patch.council !== undefined && typeof patch.council !== "boolean") {
    throw new Error("Ungültiger Ratssitz: erwartet true oder false.");
  }
  if (patch.character !== undefined && typeof patch.character !== "string") {
    throw new Error("Ungültige Charakter-Notiz: erwartet Text.");
  }
  const villageId = getAgentVillage(agent);
  const village = getConfig().villages.find(v => v.id === villageId)!;
  const isElder = village.councilMembers[0] === agent;
  if (patch.council === false && isElder) throw new Error("Der Älteste bleibt im Rat.");
  const character = patch.character === undefined ? undefined : sanitizeCharacter(patch.character);
  if (character !== undefined && character.length > CHARACTER_NOTE_MAX) {
    throw new Error(`Die Charakter-Notiz ist zu lang (höchstens ${CHARACTER_NOTE_MAX} Zeichen).`);
  }

  const notices: string[] = [];
  let newSkill: Skill | undefined;
  let newWork: string | undefined;

  const prevSkill = getSkill(agent);
  const wasCouncil = village.councilMembers.includes(agent);
  const skillChanged = patch.skill !== undefined && patch.skill !== prevSkill;
  const councilChanged = patch.council !== undefined && patch.council !== wasCouncil;

  if (skillChanged || councilChanged) {
    if (skillChanged) {
      newSkill = patch.skill!;
      const bare = workLocationForSkill(newSkill);
      newWork = villageId === DEFAULT_VILLAGE_ID ? bare : `${village.name}:${bare}`;
      notices.push(
        newSkill === "none"
          ? "Der Rat hat dich von deinem Handwerk entbunden. Du hast keine feste Arbeit mehr."
          : `Der Rat hat dich ${SKILL_TO_PHRASE[newSkill]} bestimmt. Deine Arbeit ist jetzt ${WORKPLACE_PHRASE[bare] ?? `in ${bare}`}.`,
      );
    }
    if (councilChanged) {
      notices.push(
        patch.council
          ? `Der Rat hat dich in seine Reihen aufgenommen. Du sitzt jetzt im Rat von ${village.name}.`
          : `Der Rat hat dir deinen Sitz entzogen. Du bist nicht mehr im Rat von ${village.name}.`,
      );
    }
    mutateConfigFile(cfg => {
      const v = cfg.villages.find(x => x.id === villageId);
      const entry = v?.agents.find(a => a.id === agent);
      if (!v || !entry) throw new Error(`Unbekannter Kolonist: ${agent}`);
      if (newSkill && newWork) {
        entry.skill = newSkill;
        entry.workLocation = newWork;
      }
      if (councilChanged) {
        if (patch.council) {
          if (!v.councilMembers.includes(agent)) v.councilMembers.push(agent);
        } else {
          v.councilMembers = v.councilMembers.filter(id => id !== agent);
        }
      }
    });
  }

  const prevCharacter = readCharacterNote(agent);
  const characterChanged = character !== undefined && character !== prevCharacter;
  if (characterChanged) {
    writeCharacterNote(agent, character!);
    if (character) notices.push(`Etwas in dir hat sich verschoben: ${character}`);
  }

  if (newSkill || notices.length > 0) {
    // Register first: writeWorldState re-applies pending entries, so the newest change must win there.
    const pending = pendingRoleSync.get(agent) ?? { feedback: [] };
    if (newSkill && newWork) { pending.skill = newSkill; pending.workLocation = newWork; }
    pending.feedback.push(...notices);
    pendingRoleSync.set(agent, pending);
    if (existsSync(join(process.cwd(), "data", "world_state.json"))) {
      const state = readWorldState();
      const eco = state.economics[agent];
      if (eco && newSkill && newWork) {
        eco.skill = newSkill;
        eco.workLocation = newWork;
      }
      if (!state.action_feedback[agent]) state.action_feedback[agent] = [];
      state.action_feedback[agent]!.push(...notices);
      writeWorldState(state);
    } else {
      console.warn(`[world-registry] setAgentRole(${agent}): world_state.json fehlt, nur Konfiguration/Profil gespeichert.`);
    }
  }

  return getAgentRole(agent);
}
