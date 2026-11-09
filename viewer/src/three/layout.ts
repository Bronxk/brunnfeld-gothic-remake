// World layout for the 3D view: maps the 2D tile data (villages, locations, roads) onto the ground plane.
// One map tile = TILE world units; the default village keeps the proportions of the approved demo valley.
// Additional villages are laid out as separate valleys in a row, connected by road corridors.

import { LOCATION_TILES, ADJACENCY } from "../canvas/map";
import type { VillageInfo } from "../types";

export const TILE = 2;
export interface V2 { x: number; z: number }

/** Rounded-rectangle valley (local coordinates of one village). */
export const VALLEY = { x0: -37, x1: 37, z0: -27, z1: 13, r: 8 };
/** Free space between two neighbouring valleys (edge to edge). */
export const VILLAGE_GAP = 40;
export const VILLAGE_STEP = VALLEY.x1 - VALLEY.x0 + VILLAGE_GAP;

/** Kehlpass (buried) in the south wall and the mine portal in the north wall; local to the default village. */
export const PASS = { x: 6, z: 14.5 };
export const MINE_PORTAL = { x: 24, z: -27.6 };

export const toLocal = (tx: number, ty: number): V2 => ({ x: (tx - 16) * TILE, z: (ty - 13) * TILE });

export type BuildKind =
  | "hub" | "bakery" | "tavern" | "forge" | "carpenter" | "mill" | "townhall" | "prison" | "elder"
  | "barracks" | "seamstress" | "healer" | "field" | "pasture" | "forest" | "mine" | "trail";

/** [kind, tile offset x, tile offset z, rotation, width, depth] by bare location name (ported from the demo). */
const SPECS: Record<string, [BuildKind, number, number, number, number, number]> = {
  "Zechenplatz": ["hub", 0, 0, 0, 0, 0],
  "Backstube": ["bakery", 0, 0.5, Math.PI, 2.8, 2.4],
  "Schenke": ["tavern", 0, 0.5, Math.PI, 3.2, 2.7],
  "Schmiede": ["forge", 0, 0.5, Math.PI, 3.0, 2.5],
  "Zimmerei": ["carpenter", 0, 0.5, Math.PI, 3.0, 2.4],
  "Mühle": ["mill", 0.2, 0, Math.PI / 2, 2.6, 2.6],
  "Vogtei": ["townhall", 0, 0, 0, 4.0, 3.0],
  "Karzer": ["prison", 0.5, 0.5, -Math.PI / 2, 1.8, 1.8],
  "Vogtshaus": ["elder", 0, 0, -Math.PI / 2, 5.0, 3.2],
  "Baracke 1": ["barracks", 0, 0, 0, 4.4, 2.2], "Baracke 2": ["barracks", 0, 0, 0, 4.4, 2.2],
  "Baracke 3": ["barracks", 0, 0, 0, 4.4, 2.2], "Baracke 4": ["barracks", 0, 0, 0, 4.4, 2.2],
  "Baracke 5": ["barracks", 0, 0, 0, 4.4, 2.2], "Baracke 6": ["barracks", 0, 0, Math.PI, 4.4, 2.2],
  "Baracke 7": ["barracks", 0, 0, Math.PI, 4.4, 2.2], "Baracke 8": ["barracks", 0, 0, Math.PI, 4.4, 2.2],
  "Baracke 9": ["barracks", 0, 0, Math.PI, 4.4, 2.2],
  "Flickstube": ["seamstress", 0, 0, Math.PI, 2.8, 2.2],
  "Baderhütte": ["healer", 0, 0, Math.PI, 2.6, 2.2],
  "Unterfeld": ["field", 0, 0, 0, 13, 5.2], "Oberfeld": ["field", 0, 0, 0, 13, 5.2],
  "Ziegenweide": ["pasture", 0, 0, 0, 10, 4.8],
  "Köhlerwald": ["forest", 0, 0, 0, 18, 8],
  "Erzstollen": ["mine", 0, 0, 0, 7, 7],
  "Schmugglerpfad": ["trail", 0, 0, 0, 3, 3],
};

/** Fallback by backend location type (world_config locationTypes) for names that are not in SPECS. */
const TYPE_SPEC: Record<string, [BuildKind, number, number, number, number, number]> = {
  square: ["hub", 0, 0, 0, 0, 0], cottage: ["barracks", 0, 0, 0, 4.4, 2.2], farm: ["field", 0, 0, 0, 13, 5.2],
  forest: ["forest", 0, 0, 0, 18, 8], mine: ["mine", 0, 0, 0, 7, 7], merchant: ["trail", 0, 0, 0, 3, 3],
  bakery: ["bakery", 0, 0.5, Math.PI, 2.8, 2.4], tavern: ["tavern", 0, 0.5, Math.PI, 3.2, 2.7],
  forge: ["forge", 0, 0.5, Math.PI, 3.0, 2.5], carpenter: ["carpenter", 0, 0.5, Math.PI, 3.0, 2.4],
  mill: ["mill", 0.2, 0, Math.PI / 2, 2.6, 2.6], townhall: ["townhall", 0, 0, 0, 4.0, 3.0],
  prison: ["prison", 0.5, 0.5, -Math.PI / 2, 1.8, 1.8], elder: ["elder", 0, 0, -Math.PI / 2, 5.0, 3.2],
  seamstress: ["seamstress", 0, 0, Math.PI, 2.8, 2.2], healer: ["healer", 0, 0, Math.PI, 2.6, 2.2],
};

/** Standing points (tile coordinates) in front of the doors; fields etc. use work spots inside the area. */
const NODES: Record<string, [number, number]> = {
  "Zechenplatz": [16, 8.1], "Backstube": [13, 8.75], "Schenke": [15, 8.75], "Schmiede": [20, 8.75], "Zimmerei": [22, 8.75],
  "Mühle": [9.15, 7.9], "Vogtei": [24, 8.95], "Karzer": [24.85, 9.5], "Vogtshaus": [26.0, 7.9],
  "Baracke 1": [2, 12], "Baracke 2": [5, 12], "Baracke 3": [8, 12], "Baracke 4": [13, 12], "Baracke 5": [17, 12],
  "Baracke 6": [2, 12], "Baracke 7": [5, 12], "Baracke 8": [9, 12], "Baracke 9": [13, 12],
  "Flickstube": [20, 12], "Baderhütte": [24, 13.25],
  "Unterfeld": [6.5, 5.7], "Ziegenweide": [10.6, 5.2], "Oberfeld": [17.4, 5.3],
  "Köhlerwald": [7.3, 1.9], "Erzstollen": [28, 1.7], "Schmugglerpfad": [16, 5.8],
};
const SPOTS: Record<string, [number, number]> = {
  "Unterfeld": [4, 4.1], "Oberfeld": [21, 4.1], "Ziegenweide": [13, 3.8], "Köhlerwald": [6, 1.2], "Erzstollen": [28, 1.0], "Schmugglerpfad": [16, 5.2],
};
const VIA: Record<string, [number, number][]> = {
  "Zechenplatz|Backstube": [], "Zechenplatz|Schenke": [], "Zechenplatz|Schmiede": [], "Zechenplatz|Zimmerei": [[21, 8.6]],
  "Zechenplatz|Vogtei": [[23, 8.5]], "Zechenplatz|Vogtshaus": [[18, 6.9], [26, 6.9]], "Zechenplatz|Mühle": [],
  "Zechenplatz|Baracke 1": [[18.6, 9.2], [18.6, 12]], "Zechenplatz|Unterfeld": [[14, 6.7], [8, 6.3]],
  "Zechenplatz|Schmugglerpfad": [], "Backstube|Mühle": [[9.15, 8.6]], "Schenke|Vogtshaus": [[18, 6.9], [26, 6.9]],
  "Vogtei|Vogtshaus": [[25.5, 8.95], [25.5, 7.9]], "Vogtei|Karzer": [[24.85, 9.2]], "Mühle|Unterfeld": [[9.15, 6.1]],
  "Schmiede|Zimmerei": [], "Baracke 5|Baracke 6": [], "Baracke 7|Baderhütte": [[24, 12]],
  "Unterfeld|Ziegenweide": [[8.5, 5.5]], "Ziegenweide|Oberfeld": [[16, 5.35]], "Oberfeld|Köhlerwald": [[17.0, 2.0], [8.5, 1.8]],
  "Köhlerwald|Erzstollen": [[16.5, 1.85]],
};
/** Tile coordinates of the village road lane south of the barracks (used to leave the valley). */
const LANE_TY = 16.4;

export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export interface RoadInfo {
  id: string;
  name: string;
  connectsVillages: [string, string];
  transitTicks?: number;
}

export interface LocSpec {
  name: string;
  bare: string;
  kind: BuildKind;
  villageId: string;
  /** Building origin (world). */
  base: V2;
  rot: number;
  w: number;
  d: number;
  /** Where colonists stand (world). */
  stand: V2;
  /** Radius of the random spread around `stand`. */
  spread: number;
  /** Visual variant (crop colours etc.). */
  variant: number;
}

export interface VillageSlot {
  id: string;
  name: string;
  index: number;
  ox: number;
  oz: number;
  isDefault: boolean;
  hub: V2;
  hubName: string;
  locations: LocSpec[];
  /** Local graph: bare name → world position of the node, and adjacency by bare name. */
  nodes: Map<string, V2>;
  adj: Map<string, Set<string>>;
  via: Map<string, V2[]>;
}

export interface RoadLine {
  id: string;
  name: string;
  a: string;
  b: string;
  /** Polyline from the left village hub to the right village hub. */
  pts: V2[];
  cum: number[];
  length: number;
}

export interface Layout {
  signature: string;
  villages: VillageSlot[];
  roads: RoadLine[];
  locByName: Map<string, LocSpec>;
  /** Terrain bounds incl. margin. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** Rough centre and radius of the whole scene. */
  center: V2;
  radius: number;
  /** True when roads were derived by chaining instead of the API. */
  roadsFallback: boolean;
}

const bareOf = (name: string, vname: string, isDefault: boolean): string => {
  if (isDefault && !name.startsWith(`${vname}:`)) return name;
  return name.startsWith(`${vname}:`) ? name.slice(vname.length + 1) : name.includes(":") ? name.split(":").slice(1).join(":") : name;
};

function specFor(bare: string, type: string | undefined): [BuildKind, number, number, number, number, number] {
  const s = SPECS[bare] ?? (type ? TYPE_SPEC[type] : undefined) ?? TYPE_SPEC.cottage!;
  return s;
}

function buildVillage(v: VillageInfo, index: number, ox: number, oz: number, isDefault: boolean): VillageSlot {
  const tiles = v.locationTiles && Object.keys(v.locationTiles).length > 0 ? v.locationTiles : null;
  const types = v.locationTypes ?? {};
  const names = tiles ? Object.keys(tiles) : Object.keys(LOCATION_TILES).map((b) => (isDefault ? b : `${v.name}:${b}`));
  const locations: LocSpec[] = [];
  const nodes = new Map<string, V2>();
  const toW = (t: [number, number]): V2 => { const p = toLocal(t[0], t[1]); return { x: p.x + ox, z: p.z + oz }; };
  for (const name of names) {
    const bare = bareOf(name, v.name, isDefault);
    const t = tiles?.[name] ?? LOCATION_TILES[bare];
    if (!t) continue;
    const [kind, tox, toz, rot, w, d] = specFor(bare, types[name]);
    const areaKind = kind === "field" || kind === "pasture" || kind === "forest" || kind === "mine" || kind === "trail";
    const spot = SPOTS[bare];
    const bt: [number, number] = areaKind && spot ? spot : [t.tx, t.ty];
    const base = toW([bt[0] + tox, bt[1] + toz]);
    const node = NODES[bare];
    const standT: [number, number] = spot ?? node ?? [t.tx, t.ty + 0.75];
    const stand = toW(standT);
    nodes.set(bare, toW(node ?? standT));
    const spread = kind === "field" ? 3.2 : kind === "pasture" ? 2.6 : kind === "forest" ? 3.2 : kind === "mine" ? 1.6 : kind === "hub" ? 1.7 : 0.8;
    locations.push({
      name, bare, kind, villageId: v.id, base, rot, w, d, stand, spread,
      variant: bare === "Unterfeld" ? 0 : bare === "Oberfeld" ? 1 : Math.floor(hash01(name) * 2),
    });
  }
  const hubLoc = locations.find((l) => l.kind === "hub") ?? locations[0];
  const adj = new Map<string, Set<string>>();
  const via = new Map<string, V2[]>();
  for (const [a, b] of ADJACENCY) {
    if (!nodes.has(a) || !nodes.has(b)) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b); adj.get(b)!.add(a);
    const pts = (VIA[`${a}|${b}`] ?? VIA[`${b}|${a}`] ?? []).map(toW);
    via.set(`${a}|${b}`, pts);
    via.set(`${b}|${a}`, [...pts].reverse());
  }
  return {
    id: v.id, name: v.name, index, ox, oz, isDefault,
    hub: hubLoc ? hubLoc.stand : { x: ox, z: oz - 10 },
    hubName: hubLoc?.name ?? "",
    locations, nodes, adj, via,
  };
}

function polyLength(pts: V2[]): { cum: number[]; length: number } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  return { cum, length: cum[cum.length - 1]! };
}

/** Point at arclength s along a polyline, plus the local direction. */
export function polyAt(pts: V2[], cum: number[], s: number): { p: V2; dir: V2 } {
  const total = cum[cum.length - 1] ?? 0;
  const ss = Math.max(0, Math.min(total, s));
  for (let i = 1; i < pts.length; i++) {
    if (ss <= cum[i]! || i === pts.length - 1) {
      const seg = cum[i]! - cum[i - 1]! || 1;
      const t = (ss - cum[i - 1]!) / seg;
      const a = pts[i - 1]!, b = pts[i]!;
      return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, dir: { x: (b.x - a.x) / seg, z: (b.z - a.z) / seg } };
    }
  }
  return { p: pts[0] ?? { x: 0, z: 0 }, dir: { x: 1, z: 0 } };
}

function roadPoints(left: VillageSlot, right: VillageSlot, between: VillageSlot[] = []): V2[] {
  const exit = (v: VillageSlot): V2[] => {
    // hub → down the lane road beside the barracks → south lane
    const t = (tx: number, ty: number): V2 => { const p = toLocal(tx, ty); return { x: p.x + v.ox, z: p.z + v.oz }; };
    return [t(18.6, 9.2), t(18.6, 12), t(18.6, LANE_TY)];
  };
  const l = exit(left), r = exit(right);
  const eastX = left.ox + VALLEY.x1 - 2, westX = right.ox + VALLEY.x0 + 2;
  const laneZ = l[2]!.z;
  /* Non-neighbouring villages: detour south of the valleys in between instead of crossing them. */
  const detour: V2[] = [];
  if (between.length > 0) {
    const dz = VALLEY.z1 + 7;
    detour.push({ x: eastX + 8, z: dz }, ...between.map((b) => ({ x: b.ox, z: dz })), { x: westX - 8, z: dz });
  }
  return [left.hub, ...l, { x: eastX, z: laneZ }, ...detour, { x: westX, z: r[2]!.z }, ...[...r].reverse(), right.hub];
}

/**
 * Builds the full 3D layout. `roads` null/empty with several villages → chain in village order (caller logs the warning).
 */
export function buildLayout(villagesIn: VillageInfo[], roadsIn: RoadInfo[] | null): Layout {
  const villagesList: VillageInfo[] = villagesIn.length > 0
    ? villagesIn
    : [{ id: "schlackental", name: "Schlackental", agentCount: 0 }];
  const defaultIdx = Math.max(0, villagesList.findIndex((v) => v.id === "schlackental"));
  const slots: VillageSlot[] = villagesList.map((v, i) => buildVillage(v, i, i * VILLAGE_STEP, 0, i === defaultIdx));
  const byId = new Map(slots.map((s) => [s.id, s] as const));

  let roadsFallback = false;
  let infos = roadsIn ?? [];
  if (slots.length > 1 && infos.length === 0) {
    roadsFallback = true;
    infos = slots.slice(0, -1).map((s, i) => ({
      id: `road_${s.id}_${slots[i + 1]!.id}`,
      name: `Road: ${s.name}→${slots[i + 1]!.name}`,
      connectsVillages: [s.id, slots[i + 1]!.id] as [string, string],
    }));
  }
  const roads: RoadLine[] = [];
  for (const r of infos) {
    const a = byId.get(r.connectsVillages[0]), b = byId.get(r.connectsVillages[1]);
    if (!a || !b || a === b) {
      console.warn("[3d] road references an unknown village, skipped", r);
      continue;
    }
    const [l, rr] = a.ox <= b.ox ? [a, b] : [b, a];
    const pts = roadPoints(l, rr, slots.filter((s) => s.ox > l.ox && s.ox < rr.ox));
    roads.push({ id: r.id, name: r.name, a: l.id, b: rr.id, pts, ...polyLength(pts) });
  }

  const locByName = new Map<string, LocSpec>();
  for (const s of slots) for (const l of s.locations) locByName.set(l.name, l);

  const x0 = -VALLEY.x1 - 9 + Math.min(...slots.map((s) => s.ox));
  const x1 = VALLEY.x1 + 9 + Math.max(...slots.map((s) => s.ox));
  const bounds = { x0: Math.min(x0, -46), x1: Math.max(x1, 46), z0: -36, z1: 24 };
  const center = { x: (bounds.x0 + bounds.x1) / 2, z: -4 };
  const radius = Math.hypot(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2;
  const signature = JSON.stringify([
    slots.map((s) => [s.id, s.name, s.locations.map((l) => `${l.name}@${l.base.x.toFixed(1)},${l.base.z.toFixed(1)}`).join(";")]),
    roads.map((r) => [r.name, r.a, r.b]),
  ]);
  return { signature, villages: slots, roads, locByName, bounds, center, radius, roadsFallback };
}

/** Village that a location name belongs to (null for road names / unknown). */
export function villageOfLocation(layout: Layout, loc: string): VillageSlot | null {
  const spec = layout.locByName.get(loc);
  if (spec) return layout.villages.find((v) => v.id === spec.villageId) ?? null;
  if (loc.startsWith("Road:")) return null;
  const prefix = loc.includes(":") ? loc.slice(0, loc.indexOf(":")) : "";
  const byName = prefix ? layout.villages.find((v) => v.name === prefix) : undefined;
  if (byName) return byName;
  return layout.villages.find((v) => v.isDefault) ?? layout.villages[0] ?? null;
}

export function roadByName(layout: Layout, loc: string): RoadLine | undefined {
  return layout.roads.find((r) => r.name === loc);
}

/** Resting position of a colonist (deterministic spread by id) in world coordinates. */
export function standPosition(layout: Layout, loc: string, agentId: string): V2 | null {
  const spec = layout.locByName.get(loc);
  if (spec) {
    const a = hash01(agentId, 11) * Math.PI * 2, r = Math.sqrt(hash01(agentId, 23)) * spec.spread;
    return { x: spec.stand.x + Math.cos(a) * r, z: spec.stand.z + Math.sin(a) * r };
  }
  const road = roadByName(layout, loc);
  if (road) {
    const t = 0.18 + hash01(agentId, 5) * 0.64;
    const { p, dir } = polyAt(road.pts, road.cum, road.length * t);
    const off = (hash01(agentId, 7) - 0.5) * 1.3;
    return { x: p.x - dir.z * off, z: p.z + dir.x * off };
  }
  const v = villageOfLocation(layout, loc);
  if (v) return { x: v.hub.x + (hash01(agentId, 3) - 0.5) * 3, z: v.hub.z + (hash01(agentId, 4) - 0.5) * 3 };
  return null;
}

function bfs(v: VillageSlot, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, ""]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of v.adj.get(cur) ?? []) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const out = [n];
        let p = cur;
        while (p) { out.unshift(p); p = prev.get(p)!; }
        return out;
      }
      q.push(n);
    }
  }
  return null;
}

/** Walking route inside one village along its road graph (world points, excluding the start). */
function villageRoute(v: VillageSlot, fromBare: string, toBare: string): V2[] {
  const names = bfs(v, fromBare, toBare);
  if (!names) return [];
  const pts: V2[] = [];
  for (let i = 0; i < names.length; i++) {
    if (i > 0) pts.push(...(v.via.get(`${names[i - 1]}|${names[i]}`) ?? []));
    pts.push(v.nodes.get(names[i]!)!);
  }
  return pts;
}

function bareName(layout: Layout, loc: string): string | null {
  return layout.locByName.get(loc)?.bare ?? null;
}

/**
 * Walking route between two locations: village road graph inside a village; via the village hub and along the
 * road polyline for roads; straight line as a fallback. Returns world points excluding `from`.
 */
export function routeBetween(layout: Layout, fromLoc: string, toLoc: string, to: V2, agentId: string): V2[] {
  const fv = villageOfLocation(layout, fromLoc), tv = villageOfLocation(layout, toLoc);
  const fRoad = roadByName(layout, fromLoc), tRoad = roadByName(layout, toLoc);
  const fb = bareName(layout, fromLoc), tb = bareName(layout, toLoc);
  if (!fRoad && !tRoad && fv && tv && fv === tv && fb && tb) {
    const r = villageRoute(fv, fb, tb);
    if (r.length) return [...r.slice(0, -1), to];
  }
  const out: V2[] = [];
  /** Walk from a village location to its hub (graph route). */
  const toHub = (v: VillageSlot, bare: string | null): V2[] => {
    const hubBare = layout.locByName.get(v.hubName)?.bare ?? null;
    return bare && hubBare ? villageRoute(v, bare, hubBare) : [v.hub];
  };
  if (tRoad && fv && !fRoad) {
    out.push(...toHub(fv, fb));
    out.push(...alongRoad(tRoad, fv.id, hash01(agentId, 5)));
    out.push(to);
    return out;
  }
  if (fRoad && tv && !tRoad) {
    out.push(...alongRoad(fRoad, tv.id, hash01(agentId, 5), true));
    const hubBare = layout.locByName.get(tv.hubName)?.bare ?? null;
    out.push(tv.hub);
    out.push(...(hubBare && tb ? villageRoute(tv, hubBare, tb) : []));
    out.push(to);
    return out;
  }
  if (fv && tv && fv !== tv && !fRoad && !tRoad) {
    const road = layout.roads.find((r) => (r.a === fv.id && r.b === tv.id) || (r.a === tv.id && r.b === fv.id));
    out.push(...toHub(fv, fb));
    if (road) out.push(...(road.a === fv.id ? road.pts : [...road.pts].reverse()));
    out.push(tv.hub);
    out.push(...(tb ? villageRoute(tv, layout.locByName.get(tv.hubName)?.bare ?? "", tb) : []));
    out.push(to);
    return out;
  }
  return [to];
}

/**
 * Road points between a village hub and the spot where an agent stands on the road (fraction `t` of the agent's hash
 * spread, measured from the left village like `standPosition`). `toward` = walking from the road spot to the village.
 */
function alongRoad(road: RoadLine, villageId: string, t: number, toward = false): V2[] {
  const s = road.length * (0.18 + t * 0.64);
  const isLeft = road.a === villageId;
  const out: V2[] = [];
  if (isLeft) {
    for (let i = 0; i < road.pts.length; i++) if (road.cum[i]! < s) out.push(road.pts[i]!);
  } else {
    for (let i = road.pts.length - 1; i >= 0; i--) if (road.cum[i]! > s) out.push(road.pts[i]!);
  }
  return toward ? out.reverse() : out;
}
