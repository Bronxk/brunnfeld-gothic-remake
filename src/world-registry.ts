/**
 * Runtime world registry.
 *
 * Loads from data/world_config.json if present; otherwise wraps the hardcoded
 * 1-village Schlackental defaults. All engine modules import from here instead of
 * directly from types.ts or village-map.ts.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Skill } from "./types.js";
import {
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

export interface AgentConfig {
  id: string;
  displayName: string;
  skill: Skill;
  homeLocation: string;
  workLocation: string;
  description: string;    // shown to unknown acquaintances: "a farmer", "the miller"
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
  };

  return { villages: [village], roads: [] };
}

// ─── Load (or build default) ──────────────────────────────────

function loadConfig(): WorldConfig {
  const path = join(process.cwd(), "data", "world_config.json");
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

/** Force reload from disk (used after generate-world runs). */
export function reloadConfig(): void {
  _config = null;
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

export function getAgentNames(): string[] {
  return getConfig().villages.flatMap(v => v.agents.map(a => a.id));
}

export function getVillageAgents(villageId: string): string[] {
  const v = getConfig().villages.find(v => v.id === villageId);
  return v ? v.agents.map(a => a.id) : [];
}

export function getAgentVillage(agent: string): string {
  ensureMaps();
  return _agentVillage!.get(agent) ?? DEFAULT_VILLAGE_ID;
}

export function getDisplayName(agent: string): string {
  ensureMaps();
  return _agentMap!.get(agent)?.displayName ?? AGENT_DISPLAY_NAMES[agent] ?? agent;
}

export function getSkill(agent: string): Skill {
  ensureMaps();
  const skill = _agentMap!.get(agent)?.skill;
  if (skill) return skill;
  return AGENT_SKILLS[agent] ?? "none";
}

export function getDescription(agent: string): string {
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
