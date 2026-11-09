#!/usr/bin/env node
/**
 * World Generator for Schlackental
 *
 * Usage:
 *   node dist/generate-world.js                           # 1 village, 19 hardcoded agents
 *   node dist/generate-world.js --villages=2              # 2 villages × 19 agents each
 *   node dist/generate-world.js --villages=3 --agents=30  # 3 villages × 30 agents
 *   node dist/generate-world.js --seed=42                 # deterministic output
 */

import { writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import type {
  WorldState, AgentEconomicState, BodyState, Marketplace, Skill, ItemType,
} from "./types.js";
import {
  AGENT_NAMES, AGENT_DISPLAY_NAMES, AGENT_SKILLS, AGENT_WORK_LOCATIONS, AGENT_HOMES,
  COUNCIL_MEMBERS, ALL_ITEMS,
} from "./types.js";
import {
  LOCATIONS, ADJACENCY, OPENING_HOURS, LOCATION_TILES,
  HUB_LOCATION, PRISON_LOCATION, TOWNHALL_LOCATION, ELDER_HOME_LOCATION, MERCHANT_CAMP_LOCATION,
} from "./village-map.js";
import type { WorldConfig, VillageConfig, AgentConfig, RoadConfig } from "./world-registry.js";
import { DEFAULT_VILLAGE_ID, DEFAULT_VILLAGE_NAME, DEFAULT_DESCRIPTIONS } from "./world-registry.js";

const DATA_DIR = join(process.cwd(), "data");
const DEFAULT_PRICE_INDEX: Record<ItemType, number> = {
  gerste: 2, mehl: 5, brot: 3, fleisch: 8, milch: 2,
  werkzeug: 15, kohle: 3, eisenerz: 4, bauholz: 3, brennholz: 2,
  kraeuter: 1, arznei: 10, bier: 3, eintopf: 6, leinen: 5,
  hausrat: 12, eier: 1, rueben: 2,
};

// ─── Seeded PRNG ──────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 0x100000000;
  };
}

// ─── Name pools ───────────────────────────────────────────────

const MALE_NAMES = [
  // original pool
  "Albrecht", "Arnold", "Balthazar", "Bernd", "Bruno", "Burkhard", "Casimir",
  "Clemens", "Conrad", "Dietmar", "Dietrich", "Eberhard", "Eckart", "Edmund",
  "Ernst", "Erwin", "Felix", "Ferdinand", "Florian", "Franz", "Georg", "Gerard",
  "Gerhard", "Gottfried", "Gottlieb", "Gregor", "Gunter", "Gustav", "Hannes",
  "Helmut", "Herbert", "Herman", "Hugo", "Ignaz", "Jakob", "Johann", "Jonas",
  "Josef", "Karl", "Kaspar", "Klaus", "Leonhard", "Leopold", "Lorenz", "Lucas",
  "Ludwig", "Magnus", "Martin", "Matthias", "Maximilian", "Michael", "Moritz",
  "Niklas", "Norbert", "Oswald", "Peter", "Philipp", "Ralf", "Reinhold", "Richard",
  "Roland", "Rudolf", "Sebastian", "Sigmund", "Stefan", "Thomas", "Tobias",
  "Viktor", "Wendel", "Werner", "Wilhelm", "Willibald", "Wolfgang", "Xaver",
  // expanded pool
  "Adelbert", "Adalbert", "Adalger", "Adalhard", "Adalbero", "Adalwin",
  "Alcuin", "Aldric", "Alwin", "Amelrich", "Ansgar", "Anshelm", "Aribo",
  "Arnulf", "Aswin", "Balduin", "Baldram", "Barthold", "Baturich", "Benno",
  "Benzo", "Bero", "Berthold", "Bertwin", "Bodo", "Bonifaz", "Bruning",
  "Bucelin", "Chunibert", "Dankmar", "Dankward", "Dankwin", "Detlef", "Diemo",
  "Dietbald", "Dietbert", "Dietger", "Dietlef", "Dietwin", "Diez", "Dominik",
  "Eberwin", "Ebregisil", "Eckhard", "Eginhard", "Egino", "Ekkehard", "Emmerich",
  "Engelbert", "Engelhard", "Engelmar", "Engilbert", "Erbo", "Erhard", "Erich",
  "Erkanbald", "Erkenbald", "Folkbert", "Folkmar", "Folko", "Folkwin", "Forchwin",
  "Fridbert", "Friedmar", "Friedwin", "Frizzo", "Fulco", "Gebhard", "Gerbert",
  "Gerfried", "Germar", "Gerold", "Gero", "Gisbert", "Giselbert", "Gotthard",
  "Gottlob", "Gozwin", "Gozelo", "Grimald", "Grimbert", "Gumbert", "Gunther",
  "Guntram", "Haribert", "Hartmann", "Hartmut", "Hartwig", "Hartwin", "Hatto",
  "Helmbrecht", "Helmger", "Helmold", "Helmwin", "Herborg", "Heriger", "Hermann",
  "Herwig", "Hildebrand", "Hildeger", "Hildigrim", "Hildolf", "Hubertus", "Hucbald",
  "Hunold", "Ingelbert", "Ingelram", "Ingolf", "Ingomar", "Ingulf", "Isanbard",
  "Isengrim", "Ivo", "Jordanis", "Konrad", "Kraft", "Kunibald", "Kuno", "Kurt",
  "Lambert", "Lamprecht", "Landbrecht", "Lanzo", "Leodegar", "Liudger", "Liudolf",
  "Liuwin", "Lother", "Luitbert", "Luitpold", "Luitwin", "Madalbert", "Manfred",
  "Marcward", "Markwart", "Meinhard", "Meinolf", "Meinrad", "Meinwerk", "Neidhart",
  "Nikolas", "Nortmann", "Ordulf", "Ortlieb", "Ortwin", "Oswin", "Otger", "Otmar",
  "Otwin", "Pabo", "Peregrin", "Rabanus", "Raimund", "Rainald", "Reginbert",
  "Reginbold", "Reginhar", "Reginmar", "Reginold", "Reginward", "Reinbald",
  "Reinfried", "Reinhard", "Reinmar", "Reinward", "Reinwin", "Rezzo", "Richer",
  "Richwin", "Roderich", "Rotbert", "Ruprecht", "Salomon", "Segesmund", "Sibrand",
  "Siegbert", "Siegfried", "Sieghard", "Siegmar", "Sigibald", "Sigibert", "Sigiwin",
  "Sigisbert", "Sigismund", "Simo", "Theobald", "Theobert", "Theoger", "Thietmar",
  "Thilo", "Ulfried", "Ulwin", "Unwan", "Utto", "Veit", "Volkbert", "Volkmar",
  "Volkwin", "Waldbert", "Waldemar", "Waldfried", "Waldger", "Waldmar", "Walther",
  "Warin", "Wasmund", "Wernher", "Widbert", "Wichmann", "Widulf", "Wigand",
  "Wigbert", "Wilfrid", "Wilfred", "Wilko", "Willram", "Wimbert", "Winfried",
  "Winnibald", "Wipo", "Wolfbert", "Wolfger", "Wolfhard", "Wolfmar", "Wolfram",
  "Wolfwin", "Wulfbert", "Wulfhard",
];

const FEMALE_NAMES = [
  // original pool
  "Adelheid", "Agnes", "Anna", "Barbara", "Berta", "Brigitte", "Cecilia",
  "Christine", "Clara", "Dorothea", "Emma", "Eva", "Franziska", "Frieda",
  "Gisela", "Gretel", "Hedwig", "Helena", "Hildegard", "Ilse", "Ingeborg",
  "Irma", "Johanna", "Josephine", "Kathe", "Klara", "Kunigunde", "Lena",
  "Lotte", "Luise", "Marta", "Mathilde", "Mechthild", "Monika", "Notburga",
  "Ottilie", "Paula", "Petra", "Regina", "Rosalinde", "Sabine", "Sophie",
  "Theresia", "Trude", "Ursula", "Veronika", "Walburga", "Wilhelmine",
  // expanded pool
  "Adela", "Adelburg", "Adelgund", "Adelhild", "Adelmut", "Adeltraud",
  "Adelvera", "Adelvira", "Agathe", "Albrade", "Aleidis", "Alheid", "Alheide",
  "Alide", "Almuth", "Altburg", "Amelgard", "Amelinde", "Ameltraud", "Anngard",
  "Annlinde", "Ansfrid", "Armgard", "Arnhild", "Arntraud", "Athalrat", "Bederun",
  "Berchta", "Berhild", "Bernhild", "Berthild", "Birgitta", "Brunhilde",
  "Christiane", "Cordula", "Cundegund", "Dagmar", "Diemut", "Dietlind",
  "Edwigis", "Egidia", "Eleonore", "Elfriede", "Elsbeth", "Elvira", "Engela",
  "Engelburg", "Engelhild", "Engelmut", "Erdmuth", "Fida", "Fredigard",
  "Friedlind", "Gerlind", "Gerhild", "Gertraud", "Gertrud", "Gilberta",
  "Goldrun", "Gota", "Gotlind", "Gundel", "Gundula", "Hadwigis", "Hadewig",
  "Halla", "Hawis", "Heide", "Heilgard", "Heilwig", "Helmberta", "Herlind",
  "Hildedrud", "Hildegund", "Hildelind", "Hildemut", "Hildetraud", "Hildigund",
  "Hiltrud", "Hroswitha", "Ida", "Inge", "Irmengard", "Irmentrud", "Irmhild",
  "Irmine", "Juta", "Juteke", "Kunhild", "Lamberta", "Leibgart", "Leutgard",
  "Lioba", "Liudgard", "Lora", "Loretta", "Luitgard", "Lutgard", "Mahalda",
  "Mahaut", "Mechthilde", "Mergart", "Meta", "Modesta", "Nele", "Norberta",
  "Nortburga", "Notlind", "Odilia", "Ortlinde", "Petrissa", "Petronella",
  "Radegund", "Raicha", "Rele", "Richildis", "Richenza", "Riquilda", "Rohesia",
  "Roswitha", "Rothild", "Ruthild", "Salome", "Scholastica", "Senke", "Sibilla",
  "Sigrid", "Sibylle", "Stanna", "Tekla", "Thecla", "Theodelinde", "Udelhild",
  "Uta", "Udelinde", "Waldburga", "Wandeltraud", "Werinburg", "Wiburg",
  "Willeburgis", "Wulfhildis", "Wulftraud", "Zeisela",
];

const BYNAMES = [
  "vom Berg", "der Junge", "der Alte", "aus dem Tal", "vom Hof",
  "der Starke", "der Stille", "der Kluge", "am Bach", "am Weg",
  "von der Mühle", "am Markt", "der Frohe", "der Kräftige",
];

// First settlement is the default (Schlackental); the rest are original colony outposts.
const VILLAGE_NAMES = [
  { id: DEFAULT_VILLAGE_ID, name: DEFAULT_VILLAGE_NAME },
  { id: "rabenstollen",      name: "Rabenstollen"       },
  { id: "kehlhof",           name: "Kehlhof"            },
  { id: "moosgrund",         name: "Moosgrund"          },
  { id: "aschenbruch",       name: "Aschenbruch"        },
];

// ─── Skill defaults ───────────────────────────────────────────

interface SkillDefaults {
  wallet: number;
  items: { type: ItemType; quantity: number }[];
  tool: { type: "werkzeug"; durability: number } | null;
  workSchedule: { open: number; close: number };
}

const SKILL_DEFAULTS: Record<Skill, SkillDefaults> = {
  bauer:       { wallet: 20, items: [{ type: "gerste",   quantity: 6 }], tool: { type: "werkzeug", durability: 70 }, workSchedule: { open: 6,  close: 16 } },
  hirte:       { wallet: 35, items: [{ type: "milch",    quantity: 3 }, { type: "fleisch", quantity: 2 }], tool: { type: "werkzeug", durability: 80 }, workSchedule: { open: 6, close: 15 } },
  knappe:      { wallet: 18, items: [{ type: "eisenerz", quantity: 3 }, { type: "kohle", quantity: 2 }], tool: { type: "werkzeug", durability: 70 }, workSchedule: { open: 7, close: 17 } },
  holzfaeller: { wallet: 22, items: [{ type: "bauholz",  quantity: 3 }, { type: "brennholz", quantity: 5 }], tool: { type: "werkzeug", durability: 75 }, workSchedule: { open: 6, close: 17 } },
  mueller:     { wallet: 40, items: [{ type: "mehl",     quantity: 4 }], tool: null, workSchedule: { open: 7, close: 16 } },
  baecker:     { wallet: 30, items: [{ type: "brot",     quantity: 5 }, { type: "mehl", quantity: 2 }], tool: null, workSchedule: { open: 6, close: 13 } },
  schmied:     { wallet: 55, items: [{ type: "eisenerz", quantity: 4 }, { type: "kohle", quantity: 3 }], tool: null, workSchedule: { open: 7, close: 16 } },
  zimmermann:  { wallet: 35, items: [{ type: "bauholz",  quantity: 5 }], tool: { type: "werkzeug", durability: 75 }, workSchedule: { open: 7, close: 16 } },
  wirt:        { wallet: 50, items: [{ type: "bier",     quantity: 6 }, { type: "gerste", quantity: 3 }], tool: null, workSchedule: { open: 10, close: 21 } },
  bader:       { wallet: 28, items: [{ type: "kraeuter", quantity: 5 }, { type: "arznei", quantity: 2 }], tool: null, workSchedule: { open: 7, close: 17 } },
  naeherin:    { wallet: 30, items: [{ type: "leinen",   quantity: 3 }], tool: null, workSchedule: { open: 7, close: 16 } },
  haendler:    { wallet: 80, items: [], tool: null, workSchedule: { open: 6, close: 21 } },
  none:        { wallet: 15, items: [{ type: "brot",     quantity: 2 }], tool: null, workSchedule: { open: 6, close: 21 } },
};

// ─── Skill → work location ────────────────────────────────────

function workLocationForSkill(skill: Skill, farmIndex: number): string {
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

// Specialist skills that live at their workplace
const LIVE_AT_WORK: Set<Skill> = new Set(["mueller", "baecker", "schmied", "zimmermann", "wirt", "bader", "naeherin", "haendler"]);
const BARACKE_LOCATIONS = [
  "Baracke 1", "Baracke 2", "Baracke 3", "Baracke 4", "Baracke 5",
  "Baracke 6", "Baracke 7", "Baracke 8", "Baracke 9",
];

// ─── Skill distribution ───────────────────────────────────────

const SPECIALIST_SKILLS: Skill[] = ["mueller", "baecker", "schmied", "zimmermann", "wirt", "bader", "naeherin"];
const BULK_SKILL_POOL: { skill: Skill; weight: number }[] = [
  { skill: "bauer",       weight: 36 },
  { skill: "hirte",       weight: 12 },
  { skill: "knappe",      weight: 12 },
  { skill: "holzfaeller", weight: 9  },
  { skill: "none",        weight: 31 },
];

function pickFromWeighted(pool: { skill: Skill; weight: number }[], rng: () => number): Skill {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = rng() * total;
  for (const p of pool) {
    r -= p.weight;
    if (r <= 0) return p.skill;
  }
  return pool[pool.length - 1]!.skill;
}

function buildAgentSkills(count: number, rng: () => number): Skill[] {
  const skills: Skill[] = [];
  // Always include one of each specialist
  for (const s of SPECIALIST_SKILLS) {
    if (skills.length < count) skills.push(s);
  }
  // Fill remaining from bulk pool
  while (skills.length < count) {
    skills.push(pickFromWeighted(BULK_SKILL_POOL, rng));
  }
  // Shuffle
  for (let i = skills.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [skills[i], skills[j]] = [skills[j]!, skills[i]!];
  }
  return skills;
}

// ─── Agent name generation ────────────────────────────────────

function generateAgentNames(count: number, rng: () => number, globalUsed: Set<string> = new Set()): { id: string; displayName: string }[] {
  const allFirstNames = [...MALE_NAMES, ...FEMALE_NAMES];
  const result: { id: string; displayName: string }[] = [];

  // Shuffle name pool
  const shuffled = [...allFirstNames];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  let nameIdx = 0;
  let bynameIdx = 0;

  for (let i = 0; i < count; i++) {
    let displayName: string;
    let id: string;

    if (nameIdx < shuffled.length) {
      displayName = shuffled[nameIdx++]!;
      id = displayName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/__+/g, "_");
    } else {
      // Need byname disambiguation
      const base = shuffled[i % shuffled.length]!;
      const byname = BYNAMES[bynameIdx % BYNAMES.length]!;
      bynameIdx++;
      displayName = `${base} ${byname}`;
      id = displayName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/__+/g, "_");
    }

    // Handle ID collisions (checked globally across all villages)
    let finalId = id;
    let suffix = 2;
    while (globalUsed.has(finalId)) {
      finalId = `${id}_${suffix++}`;
    }
    globalUsed.add(finalId);
    result.push({ id: finalId, displayName });
  }

  return result;
}

// ─── Location building ────────────────────────────────────────

function prefixLoc(name: string, villageName: string): string {
  return `${villageName}:${name}`;
}

function buildVillageLocations(villageName: string): string[] {
  if (villageName === DEFAULT_VILLAGE_NAME) return [...LOCATIONS];
  return (LOCATIONS as readonly string[]).map(loc => prefixLoc(loc, villageName));
}

function buildVillageAdjacency(villageName: string): Record<string, string[]> {
  if (villageName === DEFAULT_VILLAGE_NAME) return { ...ADJACENCY };
  const adj: Record<string, string[]> = {};
  for (const [loc, neighbors] of Object.entries(ADJACENCY)) {
    adj[prefixLoc(loc, villageName)] = neighbors.map(n => prefixLoc(n, villageName));
  }
  return adj;
}

function buildVillageOpeningHours(villageName: string): Partial<Record<string, { open: number; close: number }>> {
  if (villageName === DEFAULT_VILLAGE_NAME) return { ...OPENING_HOURS };
  const hours: Partial<Record<string, { open: number; close: number }>> = {};
  for (const [loc, h] of Object.entries(OPENING_HOURS)) {
    hours[prefixLoc(loc, villageName)] = h;
  }
  return hours;
}

function buildVillageLocationTypes(villageName: string): Record<string, string> {
  const TYPE_MAP: Record<string, string> = {
    [HUB_LOCATION]: "square", "Backstube": "bakery", "Schenke": "tavern",
    "Schmiede": "forge", "Zimmerei": "carpenter", "Mühle": "mill",
    [TOWNHALL_LOCATION]: "townhall", [PRISON_LOCATION]: "prison", [ELDER_HOME_LOCATION]: "elder",
    "Flickstube": "seamstress", "Baderhütte": "healer",
    "Unterfeld": "farm", "Ziegenweide": "farm", "Oberfeld": "farm",
    "Köhlerwald": "forest", "Erzstollen": "mine", [MERCHANT_CAMP_LOCATION]: "merchant",
  };
  const locs = LOCATIONS as readonly string[];
  const out: Record<string, string> = {};
  for (const loc of locs) {
    const t = TYPE_MAP[loc];
    if (t) {
      const key = villageName === DEFAULT_VILLAGE_NAME ? loc : prefixLoc(loc, villageName);
      out[key] = t;
    }
    if (/^Baracke \d$/.test(loc)) {
      const key = villageName === DEFAULT_VILLAGE_NAME ? loc : prefixLoc(loc, villageName);
      out[key] = "cottage";
    }
  }
  return out;
}

function resolveLocName(bare: string, villageName: string): string {
  return villageName === DEFAULT_VILLAGE_NAME ? bare : prefixLoc(bare, villageName);
}

// ─── Agent config building ────────────────────────────────────

interface AgentBuildSpec {
  id: string;
  displayName: string;
  skill: Skill;
  homeLocation: string;
  workLocation: string;
  description: string;
}

function buildAgentSpec(
  id: string,
  displayName: string,
  skill: Skill,
  villageName: string,
  farmCounter: { n: number },
  cottageCounter: { n: number },
): AgentBuildSpec {
  let bareWork = workLocationForSkill(skill, farmCounter.n);
  if (skill === "bauer") farmCounter.n++;

  const bareHome = LIVE_AT_WORK.has(skill)
    ? bareWork
    : BARACKE_LOCATIONS[cottageCounter.n++ % BARACKE_LOCATIONS.length]!;

  const workLocation = resolveLocName(bareWork, villageName);
  const homeLocation = resolveLocName(bareHome, villageName);

  const SKILL_DESC: Record<Skill, string> = {
    bauer: "ein Feldarbeiter", hirte: "ein Hirte", knappe: "ein Knappe",
    holzfaeller: "ein Holzfäller", mueller: "der Müller", baecker: "der Bäcker",
    schmied: "der Schmied", zimmermann: "der Zimmermann", wirt: "der Wirt",
    bader: "der Bader", naeherin: "die Flickerin", haendler: "ein Händler",
    none: "ein Kolonist",
  };

  return {
    id, displayName, skill,
    homeLocation, workLocation,
    description: SKILL_DESC[skill],
  };
}

// ─── Initial economics / body ─────────────────────────────────

function initialEconomics(spec: AgentBuildSpec, villageId: string): AgentEconomicState {
  const d = SKILL_DEFAULTS[spec.skill];
  return {
    wallet: d.wallet,
    inventory: { items: d.items.map(i => ({ ...i })) },
    tool: d.tool ? { ...d.tool } : null,
    skill: spec.skill,
    homeLocation: spec.homeLocation,
    workLocation: spec.workLocation,
    workSchedule: { ...d.workSchedule },
    villageId,
  };
}

function initialBody(rng: () => number): BodyState {
  const hunger = rng() < 0.2 ? 2 : 1;
  const energy = 7 + Math.floor(rng() * 3); // 7–9
  const sq = rng() < 0.5 ? "good" : "fair";
  return { hunger, energy, sleep_quality: sq };
}

function emptyMarketplace(): Marketplace {
  return {
    orders: [],
    history: [],
    priceIndex: { ...DEFAULT_PRICE_INDEX },
    priceHistory: Object.fromEntries(ALL_ITEMS.map(i => [i, []])) as Record<string, []>,
  };
}

// ─── Profile / memory stubs ───────────────────────────────────

function profileStub(displayName: string, skill: Skill, villageName: string, workLocation: string): string {
  // Work location may carry a "Village:" prefix in multi-settlement worlds — show only the bare place name.
  const place = workLocation.includes(":") ? workLocation.slice(workLocation.lastIndexOf(":") + 1) : workLocation;
  const SKILL_INTRO: Record<Skill, string> = {
    bauer: `${displayName} arbeitet als Feldarbeiter in ${villageName}, Arbeitsplatz: ${place}.\n\nHarte Arbeit auf steinigem Boden. ${displayName} kennt den Rhythmus der Jahreszeiten und sorgt sich vor allem um eine gute Ernte und faire Preise auf dem Tauschbrett, seit keine Versorgungskarren mehr durch den Kehlpass kommen.`,
    hirte: `${displayName} hütet Ziegen in ${villageName}, Arbeitsplatz: ${place}.\n\nTierhaltung ist langsame, aber verlässliche Arbeit. ${displayName} ist stolz auf die Ziegenmilch und das Fleisch, die die Herde liefert.`,
    knappe: `${displayName} arbeitet als Knappe im Erzstollen von ${villageName}.\n\nDas Leben unter Tage ist gefährlich und dunkel, aber Eisenerz und Kohle halten die Werkzeuge und Herde der ganzen Kolonie am Laufen. ${displayName} weiß, was das wert ist.`,
    holzfaeller: `${displayName} fällt Holz im Köhlerwald bei ${villageName}.\n\nBauholz und Brennholz halten die Baracken durch den Winter warm; ${displayName} hat einen starken Rücken und eine ruhige Axt.`,
    mueller: `${displayName} führt die Mühle in ${villageName}.\n\nAus Gerste wird Mehl — die Mühle ist der Angelpunkt der ganzen Kolonie, und ${displayName} weiß das.`,
    baecker: `${displayName} hält die Backstube in ${villageName} am Laufen, bevor sonst jemand wach ist.\n\nFrisches Brot jeden Morgen ist ein schlichtes Geschenk, aber ${displayName} ist aufrichtig stolz darauf.`,
    schmied: `${displayName} arbeitet in der Schmiede von ${villageName}.\n\nWerkzeug ist die Lebensader jedes Feldarbeiters, Knappen und Holzfällers hier; ${displayName} ist unverzichtbar — und erinnert gelegentlich daran.`,
    zimmermann: `${displayName} ist Zimmermann in ${villageName}, Arbeitsplatz: ${place}.\n\nHausrat, Reparaturen, Grubenstempel — ohne gutes Holzhandwerk fällt eine Kolonie auseinander, und ${displayName} hält sie zusammen.`,
    wirt: `${displayName} führt die Schenke in ${villageName}.\n\nDünnbier und Eintopf, Gerüchte und Wärme — in der Schenke atmet ${villageName} auf, und ${displayName} steht mittendrin.`,
    bader: `${displayName} ist Bader in ${villageName}.\n\nKräuter und Geduld, ruhige Hände und hartes Wissen — ${displayName} versorgt die Kranken und hofft, dass die Fiebergerüchte Gerüchte bleiben.`,
    naeherin: `${displayName} flickt und webt Leinen in ${villageName}.\n\nEine ruhige Hand und ein Auge für Stoff — zu ${displayName} geht die Kolonie, wenn der Winter naht und der alte Mantel nicht mehr hält.`,
    haendler: `${displayName} ist Händler in ${villageName} und handelt mit allem, was das Tal hergibt.\n\nGünstig kaufen, teuer verkaufen, Waren dorthin bringen, wo sie fehlen — ${displayName} hat eine Nase für Gelegenheiten.`,
    none: `${displayName} lebt in ${villageName} und nimmt jede Arbeit an, die Essen bringt.\n\nOhne festes Handwerk kommt ${displayName} durch Anpassungsfähigkeit und Hilfsbereitschaft über die Runden.`,
  };
  return `# ${displayName}\n\n${SKILL_INTRO[skill]}\n`;
}

function memoryStub(displayName: string): string {
  return `# ${displayName}\n\n## Personen\n*(Noch niemand bekannt)*\n\n## Erlebnisse\n*(Noch nichts)*\n\n## Wichtig\n*(Nichts)*\n`;
}

// ─── Build 1-village default world ───────────────────────────

function buildDefaultWorldConfig(): WorldConfig {
  const agents: AgentConfig[] = [...AGENT_NAMES].map(id => {
    const skill = AGENT_SKILLS[id] ?? "none";
    return {
      id,
      displayName: AGENT_DISPLAY_NAMES[id] ?? id,
      skill,
      homeLocation: AGENT_HOMES[id] ?? HUB_LOCATION,
      workLocation: AGENT_WORK_LOCATIONS[id] ?? HUB_LOCATION,
      description: DEFAULT_DESCRIPTIONS[id] ?? "ein Kolonist",
    };
  });

  const locationTypes: Record<string, string> = {};
  for (const [loc, t] of Object.entries(buildVillageLocationTypes(DEFAULT_VILLAGE_NAME))) {
    locationTypes[loc] = t;
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

function buildDefaultWorldState(): WorldState {
  const allAgents = [...AGENT_NAMES];
  const emptyRecord = <T>(fn: (a: string) => T): Record<string, T> =>
    Object.fromEntries(allAgents.map(a => [a, fn(a)]));

  return {
    current_tick: 0,
    current_time: "Simulation nicht gestartet",
    season: "spring",
    day_of_season: 1,
    weather: "Mild, 12 °C, teils bewölkt",
    active_events: [],

    agent_locations: {
      brakel: "Baracke 1", rike: "Baracke 2", ottmar: "Ziegenweide",
      wenzel: "Baracke 4", kasper: "Baracke 5", irmel: "Mühle",
      bodo: "Backstube", eckhart: "Schmiede", lenz: "Zimmerei",
      grete: "Schenke", walburga: "Baderhütte", jost: "Baracke 7",
      reinhart: "Vogtshaus", bruder_anno: "Vogtei",
      mattis: "Baracke 8", vroni: "Baracke 8", wendel: "Baracke 1",
      minna: "Flickstube", gisbert: "Baracke 3",
    },

    body: {
      brakel:      { hunger: 1, energy: 9, sleep_quality: "good" },
      rike:        { hunger: 1, energy: 8, sleep_quality: "fair" },
      ottmar:      { hunger: 2, energy: 8, sleep_quality: "good" },
      wenzel:      { hunger: 1, energy: 9, sleep_quality: "good" },
      kasper:      { hunger: 2, energy: 7, sleep_quality: "fair" },
      irmel:       { hunger: 1, energy: 9, sleep_quality: "good" },
      bodo:        { hunger: 0, energy: 8, sleep_quality: "good" },
      eckhart:     { hunger: 2, energy: 9, sleep_quality: "good" },
      lenz:        { hunger: 1, energy: 8, sleep_quality: "fair" },
      grete:       { hunger: 1, energy: 7, sleep_quality: "fair" },
      walburga:    { hunger: 1, energy: 9, sleep_quality: "good" },
      jost:        { hunger: 2, energy: 9, sleep_quality: "good" },
      reinhart:    { hunger: 1, energy: 7, sleep_quality: "fair" },
      bruder_anno: { hunger: 1, energy: 8, sleep_quality: "good" },
      mattis:      { hunger: 2, energy: 8, sleep_quality: "fair" },
      vroni:       { hunger: 1, energy: 8, sleep_quality: "good" },
      wendel:      { hunger: 1, energy: 9, sleep_quality: "good" },
      minna:       { hunger: 1, energy: 8, sleep_quality: "fair" },
      gisbert:     { hunger: 2, energy: 9, sleep_quality: "good" },
    },

    economics: {
      brakel:      { wallet: 30, inventory: { items: [{ type: "gerste", quantity: 8 }] }, tool: { type: "werkzeug", durability: 80 }, skill: "bauer",       homeLocation: "Baracke 1",   workLocation: "Unterfeld",   workSchedule: { open: 6,  close: 16 } },
      rike:        { wallet: 12, inventory: { items: [{ type: "leinen", quantity: 2 }] }, tool: null, skill: "none",        homeLocation: "Baracke 2",   workLocation: "Baracke 2",   workSchedule: { open: 6,  close: 21 } },
      ottmar:      { wallet: 40, inventory: { items: [{ type: "milch",  quantity: 3 }, { type: "fleisch",  quantity: 2 }] }, tool: { type: "werkzeug", durability: 90 }, skill: "hirte",       homeLocation: "Ziegenweide", workLocation: "Ziegenweide", workSchedule: { open: 6,  close: 15 } },
      wenzel:      { wallet: 20, inventory: { items: [{ type: "rueben", quantity: 4 }] }, tool: { type: "werkzeug", durability: 70 }, skill: "bauer",       homeLocation: "Baracke 4",   workLocation: "Oberfeld",    workSchedule: { open: 6,  close: 16 } },
      kasper:      { wallet: 15, inventory: { items: [{ type: "gerste", quantity: 5 }] }, tool: { type: "werkzeug", durability: 60 }, skill: "bauer",       homeLocation: "Baracke 5",   workLocation: "Unterfeld",   workSchedule: { open: 6,  close: 16 } },
      irmel:       { wallet: 45, inventory: { items: [{ type: "mehl", quantity: 4 }] }, tool: null, skill: "mueller",     homeLocation: "Mühle",       workLocation: "Mühle",       workSchedule: { open: 7,  close: 16 } },
      bodo:        { wallet: 32, inventory: { items: [{ type: "brot", quantity: 6 }, { type: "mehl", quantity: 2 }] }, tool: null, skill: "baecker",     homeLocation: "Backstube",   workLocation: "Backstube",   workSchedule: { open: 6,  close: 13 } },
      eckhart:     { wallet: 60, inventory: { items: [{ type: "eisenerz", quantity: 4 }, { type: "kohle", quantity: 3 }] }, tool: null, skill: "schmied",     homeLocation: "Schmiede",    workLocation: "Schmiede",    workSchedule: { open: 7,  close: 16 } },
      lenz:        { wallet: 35, inventory: { items: [{ type: "bauholz", quantity: 5 }] }, tool: { type: "werkzeug", durability: 75 }, skill: "zimmermann",  homeLocation: "Zimmerei",    workLocation: "Zimmerei",    workSchedule: { open: 7,  close: 16 } },
      grete:       { wallet: 55, inventory: { items: [{ type: "bier",   quantity: 6 }, { type: "gerste", quantity: 4 }] }, tool: null, skill: "wirt",        homeLocation: "Schenke",     workLocation: "Schenke",     workSchedule: { open: 10, close: 21 } },
      walburga:    { wallet: 28, inventory: { items: [{ type: "kraeuter", quantity: 5 }, { type: "arznei", quantity: 2 }] }, tool: null, skill: "bader",       homeLocation: "Baderhütte",  workLocation: "Baderhütte",  workSchedule: { open: 7,  close: 17 } },
      jost:        { wallet: 22, inventory: { items: [{ type: "bauholz", quantity: 3 }, { type: "brennholz", quantity: 6 }] }, tool: { type: "werkzeug", durability: 85 }, skill: "holzfaeller", homeLocation: "Baracke 7",   workLocation: "Köhlerwald",  workSchedule: { open: 6,  close: 17 } },
      reinhart:    { wallet: 120, inventory: { items: [] }, tool: null, skill: "none",      homeLocation: "Vogtshaus",   workLocation: "Vogtshaus",   workSchedule: { open: 6,  close: 21 } },
      bruder_anno: { wallet: 25, inventory: { items: [] }, tool: null, skill: "none",      homeLocation: "Vogtei",      workLocation: "Vogtei",      workSchedule: { open: 6,  close: 21 } },
      mattis:      { wallet: 18, inventory: { items: [{ type: "eisenerz", quantity: 2 }, { type: "kohle", quantity: 1 }] }, tool: { type: "werkzeug", durability: 65 }, skill: "knappe",      homeLocation: "Baracke 8",   workLocation: "Erzstollen",  workSchedule: { open: 7,  close: 17 } },
      vroni:       { wallet: 10, inventory: { items: [{ type: "brot", quantity: 2 }] }, tool: null, skill: "none",      homeLocation: "Baracke 8",   workLocation: "Zechenplatz", workSchedule: { open: 6,  close: 21 } },
      wendel:      { wallet: 25, inventory: { items: [{ type: "gerste", quantity: 6 }, { type: "eier", quantity: 3 }] }, tool: { type: "werkzeug", durability: 55 }, skill: "bauer",       homeLocation: "Baracke 1",   workLocation: "Unterfeld",   workSchedule: { open: 6,  close: 16 } },
      minna:       { wallet: 30, inventory: { items: [{ type: "leinen", quantity: 3 }] }, tool: null, skill: "naeherin",    homeLocation: "Flickstube",  workLocation: "Flickstube",  workSchedule: { open: 7, close: 16 } },
      gisbert:     { wallet: 20, inventory: { items: [{ type: "eisenerz", quantity: 3 }, { type: "kohle", quantity: 2 }] }, tool: { type: "werkzeug", durability: 80 }, skill: "knappe",      homeLocation: "Baracke 3",   workLocation: "Erzstollen",  workSchedule: { open: 7,  close: 17 } },
    },

    marketplace: emptyMarketplace(),

    doors: Object.fromEntries([
      "Baracke 1", "Baracke 2", "Baracke 3", "Baracke 4", "Baracke 5",
      "Baracke 6", "Baracke 7", "Baracke 8", "Baracke 9",
      "Flickstube", "Baderhütte", "Backstube", "Schenke", "Schmiede",
      "Zimmerei", "Mühle", TOWNHALL_LOCATION, PRISON_LOCATION, ELDER_HOME_LOCATION,
      "Unterfeld", "Ziegenweide", "Oberfeld",
    ].map(loc => [loc, "unlocked"])),

    message_queue: emptyRecord(() => []),
    objects: [],
    action_feedback: emptyRecord(() => []),
    acquaintances: {
      brakel: ["wendel"], rike: [], ottmar: [], wenzel: [], kasper: [],
      irmel: ["bodo"], bodo: ["irmel"], eckhart: ["lenz"], lenz: ["eckhart"],
      grete: ["reinhart", "bruder_anno"], walburga: [], jost: ["gisbert"],
      reinhart: ["bruder_anno", "grete"], bruder_anno: ["reinhart"],
      mattis: ["gisbert"], vroni: ["mattis"], wendel: ["brakel"],
      minna: [], gisbert: ["mattis", "jost"],
    },

    economy_snapshots: [],
    total_tax_collected: 0,
    production_log: [],
    loans: [],
    caughtStealing: {},
    violations_log: [],
    pending_meetings: {},
    active_laws: [],
    banned: {},
    tax_rate: 0.10,
  };
}

// ─── Build multi-village world ────────────────────────────────

function buildGeneratedWorldConfig(numVillages: number, agentsPerVillage: number, rng: () => number): WorldConfig {
  const villageSlots = VILLAGE_NAMES.slice(0, numVillages);
  const villages: VillageConfig[] = [];
  const roads: RoadConfig[] = [];

  // Generate all agent names in one pass so the shuffle is global — no village
  // can ever receive a name another village already took, eliminating _2 suffixes.
  const allNames = generateAgentNames(numVillages * agentsPerVillage, rng);
  let nameOffset = 0;

  for (const { id: villageId, name: villageName } of villageSlots) {
    const isDefault = villageName === DEFAULT_VILLAGE_NAME;
    const skills = buildAgentSkills(agentsPerVillage, rng);
    const names = allNames.slice(nameOffset, nameOffset + agentsPerVillage);
    nameOffset += agentsPerVillage;

    const farmCounter = { n: 1 };
    const cottageCounter = { n: 0 };

    const agentSpecs: AgentBuildSpec[] = names.map((n, i) =>
      buildAgentSpec(n.id, n.displayName, skills[i]!, villageName, farmCounter, cottageCounter)
    );

    // Designate council: elder=first "none", plus mueller, schmied, baecker, first bauer
    const councilMembers: string[] = [];
    const findFirst = (s: Skill) => agentSpecs.find(a => a.skill === s)?.id;
    const firstNone = agentSpecs.find(a => a.skill === "none")?.id ?? agentSpecs[0]!.id;
    councilMembers.push(firstNone);
    for (const s of ["mueller", "schmied", "baecker", "bauer"] as Skill[]) {
      const found = findFirst(s);
      if (found && !councilMembers.includes(found)) councilMembers.push(found);
      if (councilMembers.length >= 5) break;
    }

    const agents: AgentConfig[] = agentSpecs.map(s => ({
      id: s.id,
      displayName: s.displayName,
      skill: s.skill,
      homeLocation: s.homeLocation,
      workLocation: s.workLocation,
      description: s.description,
    }));

    const locationTilesRaw = { ...LOCATION_TILES };
    const locationTiles: Record<string, { tx: number; ty: number }> = isDefault
      ? locationTilesRaw
      : Object.fromEntries(
          Object.entries(locationTilesRaw).map(([loc, t]) => [prefixLoc(loc, villageName), t])
        );

    villages.push({
      id: villageId,
      name: villageName,
      agents,
      locations: buildVillageLocations(villageName),
      locationTypes: buildVillageLocationTypes(villageName),
      councilMembers,
      adjacency: buildVillageAdjacency(villageName),
      openingHours: buildVillageOpeningHours(villageName),
      locationTiles,
    });
  }

  // Build roads connecting villages in a ring
  for (let i = 0; i < villageSlots.length - 1; i++) {
    const v1 = villageSlots[i]!;
    const v2 = villageSlots[i + 1]!;
    const roadName = `Road: ${v1.name}→${v2.name}`;
    roads.push({
      id: `road_${v1.id}_${v2.id}`,
      name: roadName,
      connectsVillages: [v1.id, v2.id],
      transitTicks: 2,
    });

    // Add road to both villages' adjacency and location lists
    const v1cfg = villages.find(v => v.id === v1.id)!;
    const v2cfg = villages.find(v => v.id === v2.id)!;

    // Road adjacency entry (bidirectional)
    const v1square = v1.name === DEFAULT_VILLAGE_NAME ? HUB_LOCATION : prefixLoc(HUB_LOCATION, v1.name);
    const v2square = v2.name === DEFAULT_VILLAGE_NAME ? HUB_LOCATION : prefixLoc(HUB_LOCATION, v2.name);
    v1cfg.adjacency[roadName] = [v1square, v2square];
    v2cfg.adjacency[roadName] = [v1square, v2square];

    // Add road to each village's adjacency for the hub (Zechenplatz)
    if (!v1cfg.adjacency[v1square]) v1cfg.adjacency[v1square] = [];
    if (!v1cfg.adjacency[v1square]!.includes(roadName)) v1cfg.adjacency[v1square]!.push(roadName);
    if (!v2cfg.adjacency[v2square]) v2cfg.adjacency[v2square] = [];
    if (!v2cfg.adjacency[v2square]!.includes(roadName)) v2cfg.adjacency[v2square]!.push(roadName);

    // Add road to each village's locations list
    if (!v1cfg.locations.includes(roadName)) v1cfg.locations.push(roadName);
    if (!v2cfg.locations.includes(roadName)) v2cfg.locations.push(roadName);
  }

  return { villages, roads };
}

function buildGeneratedWorldState(config: WorldConfig, rng: () => number): WorldState {
  const agent_locations: Record<string, string> = {};
  const body: Record<string, BodyState> = {};
  const economics: Record<string, AgentEconomicState> = {};
  const message_queue: Record<string, unknown[]> = {};
  const action_feedback: Record<string, unknown[]> = {};
  const acquaintances: Record<string, string[]> = {};

  const marketplaces: Record<string, Marketplace> = {};

  for (const village of config.villages) {
    marketplaces[village.id] = emptyMarketplace();

    for (const agent of village.agents) {
      agent_locations[agent.id] = agent.homeLocation;
      body[agent.id] = initialBody(rng);

      const spec: AgentBuildSpec = {
        id: agent.id,
        displayName: agent.displayName,
        skill: agent.skill,
        homeLocation: agent.homeLocation,
        workLocation: agent.workLocation,
        description: agent.description,
      };
      economics[agent.id] = initialEconomics(spec, village.id);
      message_queue[agent.id] = [];
      action_feedback[agent.id] = [];
      acquaintances[agent.id] = [];
    }
  }

  // Build doors for all lockable locations across all villages
  const doors: Record<string, "locked" | "unlocked"> = {};
  const LOCKABLE_SUFFIXES = [
    "Baracke 1","Baracke 2","Baracke 3","Baracke 4","Baracke 5",
    "Baracke 6","Baracke 7","Baracke 8","Baracke 9",
    "Flickstube","Baderhütte","Backstube","Schenke","Schmiede",
    "Zimmerei","Mühle",TOWNHALL_LOCATION,PRISON_LOCATION,ELDER_HOME_LOCATION,
    "Unterfeld","Ziegenweide","Oberfeld",
  ];
  for (const village of config.villages) {
    for (const suf of LOCKABLE_SUFFIXES) {
      const loc = village.name === DEFAULT_VILLAGE_NAME ? suf : prefixLoc(suf, village.name);
      if (village.locations.includes(loc)) doors[loc] = "unlocked";
    }
  }

  // Use single `marketplace` (default settlement's) for backward compat; also populate `marketplaces`
  const defaultMkt = marketplaces[DEFAULT_VILLAGE_ID] ?? Object.values(marketplaces)[0]!;

  return {
    current_tick: 0,
    current_time: "Simulation nicht gestartet",
    season: "spring",
    day_of_season: 1,
    weather: "Mild, 12 °C, teils bewölkt",
    active_events: [],
    agent_locations,
    body: body as WorldState["body"],
    economics: economics as WorldState["economics"],
    marketplace: defaultMkt,
    marketplaces,
    doors,
    message_queue: message_queue as WorldState["message_queue"],
    objects: [],
    action_feedback: action_feedback as WorldState["action_feedback"],
    acquaintances: acquaintances as WorldState["acquaintances"],
    economy_snapshots: [],
    total_tax_collected: 0,
    production_log: [],
    loans: [],
    caughtStealing: {},
    violations_log: [],
    pending_meetings: {},
    active_laws: [],
    banned: {},
    tax_rate: 0.10,
  };
}

// ─── Profile / memory file writing ───────────────────────────

function writeAgentFiles(config: WorldConfig): void {
  const profDir     = join(DATA_DIR, "profiles");
  const memDir      = join(DATA_DIR, "memory");
  const memInitDir  = join(DATA_DIR, "memory_initial");
  mkdirSync(profDir,    { recursive: true });
  mkdirSync(memDir,     { recursive: true });
  mkdirSync(memInitDir, { recursive: true });

  for (const village of config.villages) {
    for (const agent of village.agents) {
      // Always write profile stub (skip if already exists — profiles accumulate story)
      const profPath = join(profDir, `${agent.id}.md`);
      if (!existsSync(profPath)) {
        writeFileSync(profPath, profileStub(agent.displayName, agent.skill, village.name, agent.workLocation));
      }

      // memory_initial/ is the baseline `npm run reset` restores. Hand-written baselines (the
      // canonical cast ships with first relationships) are kept; new agents get a blank stub.
      // Every generated world starts from the baseline, never from a previous run's memories.
      const initPath = join(memInitDir, `${agent.id}.md`);
      if (!existsSync(initPath)) writeFileSync(initPath, memoryStub(agent.displayName));
      copyFileSync(initPath, join(memDir, `${agent.id}.md`));
    }
  }
}

// ─── CLI ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const getArg = (name: string): number | undefined => {
    const a = args.find(a => a.startsWith(`--${name}=`));
    if (!a) return undefined;
    const v = parseInt(a.split("=")[1] ?? "", 10);
    return isNaN(v) ? undefined : v;
  };

  const numVillages     = Math.min(5, Math.max(1, getArg("villages") ?? 1));
  const agentsPerVillage= Math.min(200, Math.max(7, getArg("agents") ?? 19));
  const seed            = getArg("seed") ?? Date.now();

  const rng = makeRng(seed);

  mkdirSync(DATA_DIR, { recursive: true });

  let worldConfig: WorldConfig;
  let worldState: WorldState;

  if (numVillages === 1 && agentsPerVillage === 19) {
    // Exact default Schlackental world
    worldConfig = buildDefaultWorldConfig();
    worldState  = buildDefaultWorldState();
  } else if (numVillages === 1) {
    // Single village with custom agent count
    worldConfig = buildGeneratedWorldConfig(1, agentsPerVillage, rng);
    worldState  = buildGeneratedWorldState(worldConfig, rng);
  } else {
    // Multi-village
    worldConfig = buildGeneratedWorldConfig(numVillages, agentsPerVillage, rng);
    worldState  = buildGeneratedWorldState(worldConfig, rng);
  }

  // Write world_config.json
  writeFileSync(
    join(DATA_DIR, "world_config.json"),
    JSON.stringify(worldConfig, null, 2),
  );

  // Write world_state.json
  writeFileSync(
    join(DATA_DIR, "world_state.json"),
    JSON.stringify(worldState, null, 2),
  );

  // Write profile/memory stubs for agents that don't have files yet
  writeAgentFiles(worldConfig);

  // Clear tick logs
  const logsDir = join(DATA_DIR, "logs");
  if (existsSync(logsDir)) {
    const { readdirSync, unlinkSync } = await import("fs");
    for (const file of readdirSync(logsDir)) {
      if (file.endsWith(".json")) unlinkSync(join(logsDir, file));
    }
  }

  const totalAgents = worldConfig.villages.reduce((n, v) => n + v.agents.length, 0);
  console.log(`World generated: ${numVillages} village(s), ${totalAgents} agents, seed=${seed}`);
  for (const v of worldConfig.villages) {
    const agentCount = v.agents.length;
    console.log(`  ${v.name}: ${agentCount} agents`);
  }
  console.log(`  Written to data/world_config.json and data/world_state.json`);
}

main().catch(err => {
  console.error("generate-world failed:", err);
  process.exit(1);
});
