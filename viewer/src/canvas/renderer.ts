import {
  loadSprite, drawSprite, drawSpriteCrop, UNIT_INSET, UNIT_FEET_FRAC, applyLampLight, flicker, lampLabel, prefersReducedMotion,
  LAMP_PALETTE, type Lamp,
} from "./sprites";
import {
  getActiveTiles, getActiveBuildings, findTile, ADJACENCY, TILE_SIZE, WORLD_W, WORLD_H,
} from "./map";
import type { AgentName, WorldState } from "../types";
import { AGENT_DISPLAY, type MapBubble } from "../store";
import { drawBubbles } from "./bubbles";

// ─── Sprite URLs ──────────────────────────────────────────────────────────

const SPRITE_FRAME_W = 192;
const SPRITE_FRAME_H = 192;
const SPRITE_DISPLAY = 64;  // cropped frame (see drawSpriteCrop) rendered at this size
const FEET = Math.round(SPRITE_DISPLAY * UNIT_FEET_FRAC - SPRITE_DISPLAY / 2); // sprite centre → ground contact
const HEAD = 22;            // sprite centre → top of the head

/** Agent id of the (future) human player character. */
export const PLAYER_ID = "player";

const SPRITES = {
  pawnIdle:    "/assets/units/Pawn/Pawn_Idle.png",
  pawnRun:     "/assets/units/Pawn/Pawn_Run.png",
  pawnAxe:     "/assets/units/Pawn/Pawn_Idle Axe.png",
  pawnHammer:  "/assets/units/Pawn/Pawn_Idle Hammer.png",
  pawnPickaxe: "/assets/units/Pawn/Pawn_Idle Pickaxe.png",
  pawnWood:    "/assets/units/Pawn/Pawn_Idle Wood.png",
  monkIdle:    "/assets/units/Monk/Idle.png",
  warriorIdle: "/assets/units/Warrior/Warrior_Idle.png",
  merchantIdle: "/assets/merchant/Gipsy spritesheet.png",
};

// ─── Agent → sprite mapping ───────────────────────────────────────────────

const AGENT_SPRITE: Record<string, keyof typeof SPRITES> = {
  brakel: "pawnAxe", rike: "pawnIdle", ottmar: "pawnIdle", wenzel: "pawnAxe",
  kasper: "pawnAxe", irmel: "pawnHammer", bodo: "pawnHammer",
  eckhart: "pawnHammer", lenz: "pawnHammer", grete: "pawnIdle",
  walburga: "pawnIdle", jost: "pawnWood",
  reinhart: "warriorIdle", bruder_anno: "monkIdle",
  mattis: "pawnPickaxe", vroni: "pawnIdle", wendel: "pawnAxe", minna: "pawnIdle", gisbert: "pawnPickaxe",
  [PLAYER_ID]: "pawnIdle",
};

// Skill → sprite fallback for dynamically generated agents
const SKILL_SPRITE: Record<string, keyof typeof SPRITES> = {
  bauer: "pawnAxe",   hirte: "pawnIdle",     knappe: "pawnPickaxe",
  holzfaeller: "pawnWood", mueller: "pawnHammer", baecker: "pawnHammer",
  schmied: "pawnHammer", zimmermann: "pawnHammer",
  wirt: "pawnIdle",  bader: "pawnIdle",     naeherin: "pawnIdle",
  none: "pawnIdle",
};

// ─── Agent colors (fallback circle while the sprite sheet loads) ─────────
const AGENT_COLORS: Record<string, string> = {
  brakel: "#e8c87a", rike: "#f4b8d4", ottmar: "#a8d48a", wenzel: "#c8a84a",
  kasper: "#d4a870", irmel: "#d4d4a0", bodo: "#f0d890", eckhart: "#c84c4c",
  lenz: "#a07040", grete: "#d878a8", walburga: "#80c8d8", jost: "#80a850",
  reinhart: "#a8a0c8", bruder_anno: "#c8c8e8", mattis: "#909090", vroni: "#e8b090",
  wendel: "#d8c060", minna: "#e878b8", gisbert: "#b0b0b0", [PLAYER_ID]: "#ffd68a",
};

function agentColor(agent: string): string {
  if (AGENT_COLORS[agent]) return AGENT_COLORS[agent]!;
  let h = 0;
  for (const c of agent) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFF;
  return `rgb(${140 + ((h >> 16) & 0x7F)},${100 + ((h >> 8) & 0x7F)},${80 + (h & 0x7F)})`;
}

function agentLabel(agent: string): string {
  return agent === PLAYER_ID ? "Du" : AGENT_DISPLAY[agent]!;
}

// ─── Particles (floating text) ────────────────────────────────────────────

interface Particle {
  x: number; y: number;
  text: string;
  color: string;
  life: number;   // 0–1
  decay: number;  // per frame
}

const particles: Particle[] = [];

export function spawnParticle(worldX: number, worldY: number, text: string, color = "#ffd68a"): void {
  particles.push({ x: worldX, y: worldY, text, color, life: 1.0, decay: 0.018 });
}

// ─── Animation clock ──────────────────────────────────────────────────────

let frameIndex = 0;

// ─── Camera ───────────────────────────────────────────────────────────────

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

// ─── Active Animation ─────────────────────────────────────────────────────

export interface ActiveAnimation {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  toLoc: string;
  startMs: number;
  durationMs: number;
}

// ─── Image loaders ────────────────────────────────────────────────────────

const buildingImages: Map<string, HTMLImageElement | "loading"> = new Map();

function loadBuilding(url: string): HTMLImageElement | null {
  if (!url) return null;
  const hit = buildingImages.get(url);
  if (hit && hit !== "loading") return hit;
  if (hit === "loading") return null;
  buildingImages.set(url, "loading");
  const img = new Image();
  img.onload = () => buildingImages.set(url, img);
  img.onerror = () => console.warn(`[renderer] building sprite failed to load: ${url}`);
  img.src = url;
  return null;
}

// ─── Terrain decoration images ────────────────────────────────────────────

const DECO_ROCKS = [
  "/assets/terrain/decos/Rocks/Rock1.png",
  "/assets/terrain/decos/Rocks/Rock2.png",
  "/assets/terrain/decos/Rocks/Rock3.png",
  "/assets/terrain/decos/Rocks/Rock4.png",
];
const DECO_BUSHES = [
  "/assets/terrain/decos/Bushes/Bushe1.png",
  "/assets/terrain/decos/Bushes/Bushe2.png",
  "/assets/terrain/decos/Bushes/Bushe3.png",
  "/assets/terrain/decos/Bushes/Bushe4.png",
];

// Decorations are tinted once (multiply with a dusky colour) so bright greens don't pop out of the dark.
const ROCK_TINT = "#8a8078";
const BUSH_TINT = "#6a6a48";

const decoCache: Map<string, HTMLCanvasElement | "loading" | "error"> = new Map();
function loadDeco(url: string, tint: string): HTMLCanvasElement | null {
  const hit = decoCache.get(url);
  if (hit && hit !== "loading" && hit !== "error") return hit;
  if (hit) return null;
  decoCache.set(url, "loading");
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = "multiply";
    x.fillStyle = tint;
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = "destination-in";
    x.drawImage(img, 0, 0);
    decoCache.set(url, c);
  };
  img.onerror = () => {
    decoCache.set(url, "error");
    console.warn(`[renderer] decoration failed to load: ${url}`);
  };
  img.src = url;
  return null;
}

// Preload all decos immediately
DECO_ROCKS.forEach((u) => loadDeco(u, ROCK_TINT));
DECO_BUSHES.forEach((u) => loadDeco(u, BUSH_TINT));

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded positions for stable decoration placement
function seededDecos(
  count: number,
  areaX: number, areaY: number, areaW: number, areaH: number,
  seed: number,
): { x: number; y: number; variant: number }[] {
  const out = [];
  let s = seed;
  for (let i = 0; i < count; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const x = areaX + (s % areaW);
    s = (s * 1664525 + 1013904223) >>> 0;
    const y = areaY + (s % areaH);
    s = (s * 1664525 + 1013904223) >>> 0;
    const variant = s % 4;
    out.push({ x, y, variant });
  }
  return out;
}

const T = TILE_SIZE;
// Computed once: positions never change.
const DECOS = {
  mineRocks:    seededDecos(8, 24 * T, 0, 6 * T, 3 * T, 0xABCD),
  riverRocks:   seededDecos(10, 2 * T, 22 * T, 28 * T, 2 * T, 0x1234),
  farmBushes:   seededDecos(12, 0, 5 * T, 30 * T, T, 0xF00D),
  forestBushes: seededDecos(10, 2 * T, 0, 8 * T, 4 * T, 0xBEEF),
  cottageRocks: seededDecos(6, 2 * T, 11 * T, 20 * T, 3 * T, 0x5E1D),
};

function drawDecorations(ctx: CanvasRenderingContext2D): void {
  const rock = (list: { x: number; y: number; variant: number }[], size: number) => {
    for (const { x, y, variant } of list) {
      const img = loadDeco(DECO_ROCKS[variant % 4]!, ROCK_TINT);
      if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    }
  };
  const bush = (list: { x: number; y: number; variant: number }[], w: number, h: number) => {
    for (const { x, y, variant } of list) {
      const img = loadDeco(DECO_BUSHES[variant % 4]!, BUSH_TINT);
      // first 128x128 frame of the 1024x128 spritesheet
      if (img) ctx.drawImage(img, 0, 0, 128, 128, x - w / 2, y - h * 0.6, w, h);
    }
  };
  rock(DECOS.mineRocks, 28);
  rock(DECOS.riverRocks, 24);
  bush(DECOS.farmBushes, 34, 20);
  bush(DECOS.forestBushes, 28, 17);
  rock(DECOS.cottageRocks, 20);
}

// ─── Time of day ──────────────────────────────────────────────────────────

/** Always dusk/night in the valley; slightly lighter around noon, darkest at night. */
function darknessFor(hour: number): number {
  if (hour >= 20 || hour < 6) return 0.82;
  if (hour < 10) return 0.82 - ((hour - 6) / 4) * 0.14;  // 6:00 0.82 → 10:00 0.68
  if (hour <= 16) return 0.68;
  return 0.68 + ((hour - 16) / 4) * 0.14;                // 16:00 0.68 → 20:00 0.82
}

function getHourFromTime(time: string): number {
  // "Montag, 14:00" → 14
  const m = time.match(/(\d{1,2}):\d{2}/);
  return m ? parseInt(m[1]!) : 20;
}

function seasonTint(season: string): string {
  switch (season) {
    case "winter": return "8,14,30";
    case "autumn": return "14,9,14";
    default: return "8,8,18";
  }
}

// ─── Ground (procedural, drawn once into an offscreen canvas) ─────────────

let groundCache: HTMLCanvasElement | null = null;
let groundTilesKey: unknown = null;
let groundBuildingsKey: unknown = null;

function getGround(): HTMLCanvasElement {
  const tiles = getActiveTiles();
  const buildings = getActiveBuildings();
  if (groundCache && groundTilesKey === tiles && groundBuildingsKey === buildings) return groundCache;
  const c = groundCache ?? document.createElement("canvas");
  c.width = WORLD_W;
  c.height = WORLD_H;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, WORLD_W, WORLD_H);
  paintGround(g);
  groundCache = c;
  groundTilesKey = tiles;
  groundBuildingsKey = buildings;
  return c;
}

function paintGround(ctx: CanvasRenderingContext2D): void {
  const rnd = mulberry(0x51AC);

  // Base: dark earth, slightly lighter strip for the fields in the north
  ctx.fillStyle = "#2c2419";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = "#312b1c";
  ctx.fillRect(0, 0, WORLD_W, 7 * T);

  // Mine/forest corner: nearly black
  ctx.fillStyle = "#17261a";
  ctx.fillRect(0, 0, 10 * T, 3 * T);
  ctx.fillStyle = "#26211d";
  ctx.fillRect(24 * T, 0, 8 * T, 3 * T);

  // Earthy blotches break up the flat colour (large soft ellipses)
  const blotch = ["rgba(48,38,24,0.35)", "rgba(10,8,6,0.35)", "rgba(40,44,28,0.25)"];
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = blotch[i % 3]!;
    ctx.beginPath();
    ctx.ellipse(rnd() * WORLD_W, rnd() * WORLD_H, 24 + rnd() * 60, 12 + rnd() * 30, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trails between connected locations (packed dirt)
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [a, b] of ADJACENCY) {
    const ta = findTile(a);
    const tb = findTile(b);
    if (!ta || !tb) continue;
    const ax = ta.tx * T + T / 2, ay = ta.ty * T + T / 2;
    const bx = tb.tx * T + T / 2, by = tb.ty * T + T / 2;
    ctx.strokeStyle = "#33281a";
    ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = "#3c2f1e";
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }

  // Zechenplatz: trampled ash-grey plaza
  const sq = findTile("Zechenplatz") ?? { tx: 16, ty: 8 };
  const sx = sq.tx * T + T / 2, sy = sq.ty * T + T / 2;
  ctx.fillStyle = "#3a2d1d";
  ctx.beginPath(); ctx.ellipse(sx, sy, 3.1 * T, 2.2 * T, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4a3b26";
  ctx.beginPath(); ctx.ellipse(sx, sy, 2.7 * T, 1.85 * T, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(80,64,42,0.55)";
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
    ctx.fillRect(sx + Math.cos(a) * d * 2.5 * T, sy + Math.sin(a) * d * 1.7 * T, 3 + rnd() * 3, 2 + rnd() * 2);
  }

  // Farm plots: tilled furrows
  for (const name of ["Unterfeld", "Ziegenweide", "Oberfeld"]) {
    const tile = findTile(name);
    if (!tile) continue;
    const fx = tile.tx * T - T / 2;
    const fy = tile.ty * T - T / 2;
    ctx.fillStyle = "#3b3020";
    ctx.fillRect(fx, fy, T * 2, T * 2);
    for (let row = 0; row < T * 2; row += 6) {
      ctx.strokeStyle = row % 12 === 0 ? "#4f4129" : "#231b0f";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fx, fy + row + 0.5);
      ctx.lineTo(fx + T * 2, fy + row + 0.5);
      ctx.stroke();
    }
  }

  // Forest: dark pines
  const pine = (x: number, y: number, s: number, shade: number) => {
    ctx.fillStyle = shade % 2 === 0 ? "#0f1d12" : "#1a2e20";
    ctx.beginPath();
    ctx.moveTo(x, y - 20 * s);
    ctx.lineTo(x - 9 * s, y);
    ctx.lineTo(x + 9 * s, y);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - 30 * s);
    ctx.lineTo(x - 7 * s, y - 12 * s);
    ctx.lineTo(x + 7 * s, y - 12 * s);
    ctx.closePath();
    ctx.fill();
  };
  const forest = findTile("Köhlerwald");
  if (forest) {
    const fx = forest.tx * T - T, fy = forest.ty * T - T / 2;
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) pine(fx + col * 32 + 24, fy + row * 24 + 28, 1.3, col + row);
    }
  }
  for (let i = 0; i < 46; i++) {
    pine(rnd() * 10 * T, 12 + rnd() * 3 * T, 0.9 + rnd() * 0.6, i);
  }

  // Mine: slag heaps
  const mine = findTile("Erzstollen");
  if (mine) {
    const mx = mine.tx * T, my = mine.ty * T;
    const patches = [
      [4, 6, 12, 7], [18, 3, 9, 5], [8, 18, 14, 6], [28, 10, 8, 8],
      [35, 22, 11, 5], [12, 30, 10, 7], [26, 35, 9, 6], [40, 8, 7, 10],
      [5, 38, 13, 4], [32, 28, 8, 9], [20, 16, 6, 8], [38, 40, 10, 5],
    ];
    ctx.fillStyle = "#3d3630";
    for (const [rx, ry, rw, rh] of patches) ctx.fillRect(mx + rx!, my + ry!, rw!, rh!);
  }

  // Ash and slag specks
  const specks = ["rgba(90,76,56,0.30)", "rgba(10,8,6,0.45)", "rgba(70,86,48,0.18)"];
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = specks[i % 3]!;
    const s = 2 + Math.floor(rnd() * 3);
    ctx.fillRect(Math.floor(rnd() * WORLD_W), Math.floor(rnd() * WORLD_H), s, s);
  }

  // Creek along the south edge (decorative)
  const riverY = WORLD_H - T;
  ctx.beginPath();
  ctx.moveTo(0, riverY + 18);
  for (let wx = 0; wx < WORLD_W; wx += 64) {
    ctx.quadraticCurveTo(wx + 32, riverY + 4, wx + 64, riverY + 22);
  }
  ctx.lineTo(WORLD_W, WORLD_H);
  ctx.lineTo(0, WORLD_H);
  ctx.closePath();
  ctx.fillStyle = "#22394a";
  ctx.fill();
  ctx.strokeStyle = "rgba(120,160,176,0.18)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) {
    const x = rnd() * WORLD_W, y = riverY + 24 + rnd() * (T - 30);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 8 + rnd() * 10, y + (rnd() - 0.5) * 2);
    ctx.stroke();
  }

  // Contact shadows under buildings
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  for (const [loc, bld] of Object.entries(getActiveBuildings())) {
    const tile = getActiveTiles()[loc];
    if (!tile || !bld.img) continue;
    ctx.beginPath();
    ctx.ellipse(tile.tx * T + T / 2, tile.ty * T + T - 3, bld.w * 0.46, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function bareName(name: string): string {
  const i = name.indexOf(":");
  return i < 0 ? name : name.slice(i + 1);
}

// ─── Buildings ────────────────────────────────────────────────────────────

function drawBuildings(ctx: CanvasRenderingContext2D): void {
  for (const [loc, bld] of Object.entries(getActiveBuildings())) {
    const tile = getActiveTiles()[loc];
    if (!tile || !bld.img) continue;
    const px = tile.tx * T;
    const py = tile.ty * T;
    const img = loadBuilding(bld.img);
    if (img) {
      ctx.drawImage(img, px - (bld.w - T) / 2, py - bld.h + T, bld.w, bld.h);
    } else {
      // Placeholder while loading
      ctx.fillStyle = "#1c1612";
      ctx.fillRect(px + 4, py + 4, T - 8, T - 8);
    }
  }
}

// ─── Agents ───────────────────────────────────────────────────────────────

interface AgentDraw {
  id: AgentName;
  cx: number;
  cy: number;
  moving: boolean;
  /** stagger row for labels of agents standing at the same spot */
  row: number;
  hungry: boolean;
  sick: boolean;
}

// Collected while drawing, reused for lights and for the label pass after the darkness layer.
const agentDraws: AgentDraw[] = [];

function drawAgentSprite(
  ctx: CanvasRenderingContext2D,
  agent: AgentName,
  cx: number,
  cy: number,
  isMoving: boolean,
  world: WorldState,
  row: number,
): void {
  const skill = world.economics[agent]?.skill ?? "none";
  const spriteKey = isMoving ? "pawnRun" : (AGENT_SPRITE[agent] ?? SKILL_SPRITE[skill] ?? "pawnIdle");
  const spriteUrl = SPRITES[spriteKey as keyof typeof SPRITES];
  const sheet = spriteUrl ? loadSprite(spriteUrl, SPRITE_FRAME_W, SPRITE_FRAME_H) : null;
  const animFrame = prefersReducedMotion() ? 0 : Math.floor(frameIndex / (isMoving ? 4 : 8));

  if (sheet) {
    // The sprite carries its own grey ground shadow
    drawSpriteCrop(ctx, sheet, animFrame, UNIT_INSET, cx - SPRITE_DISPLAY / 2, cy - SPRITE_DISPLAY / 2, SPRITE_DISPLAY, SPRITE_DISPLAY);
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + FEET, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = agentColor(agent);
    ctx.beginPath();
    ctx.arc(cx, cy, SPRITE_DISPLAY / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#16110c";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const body = world.body[agent];
  agentDraws.push({
    id: agent, cx, cy, moving: isMoving, row,
    hungry: (body?.hunger ?? 0) >= 3,
    sick: (body?.sickness ?? 0) > 0,
  });
}

function drawAgents(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  animations: Map<AgentName, ActiveAnimation>,
): void {
  const now = performance.now();
  // When caravan is active, Reinhart is rendered by the event overlay as the Gipsy merchant sprite
  const caravanActive = world.active_events.some(e => e.type === "caravan");

  const byLoc: Record<string, AgentName[]> = {};
  for (const [agent, loc] of Object.entries(world.agent_locations)) {
    if (animations.has(agent as AgentName)) continue;
    if (caravanActive && agent === "reinhart" && loc === "Schmugglerpfad") continue;
    if (!byLoc[loc]) byLoc[loc] = [];
    byLoc[loc]!.push(agent as AgentName);
  }

  for (const [loc, agents] of Object.entries(byLoc)) {
    const tile = getActiveTiles()[loc];
    if (!tile) continue;
    const basePx = tile.tx * T;
    const basePy = tile.ty * T;

    agents.forEach((agent, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const ox = (col - 1) * 15;
      const oy = (row - 0.5) * 12 + 4;
      const cx = basePx + T / 2 + ox;
      const cy = basePy + T / 2 + oy;
      drawAgentSprite(ctx, agent, cx, cy, false, world, idx % 3);
    });
  }

  for (const [agent, anim] of animations) {
    if (caravanActive && agent === "reinhart" && anim.toLoc === "Schmugglerpfad") continue;
    const t = Math.min(1, (now - anim.startMs) / anim.durationMs);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const cx = anim.fromX + (anim.toX - anim.fromX) * ease;
    const cy = anim.fromY + (anim.toY - anim.fromY) * ease;
    drawAgentSprite(ctx, agent, cx, cy, t < 1, world, 0);
  }
}

// ─── Event overlays (drawn before the darkness layer) ─────────────────────

const MERCHANT_FRAME = 80;
const MERCHANT_DISPLAY = 52;

function caravanSpot(): { cx: number; cy: number } | null {
  const tile = findTile("Schmugglerpfad");
  if (!tile) return null;
  return { cx: tile.tx * T + T / 2, cy: tile.ty * T + T / 2 + 4 };
}

function drawEventOverlays(ctx: CanvasRenderingContext2D, world: WorldState): void {
  const events = world.active_events;
  if (events.length === 0) return;

  const reduced = prefersReducedMotion();
  const pulse = reduced ? 0.5 : Math.sin(frameIndex * 0.05) * 0.5 + 0.5; // 0–1 slow pulse

  for (const ev of events) {
    switch (ev.type) {

      case "drought": {
        for (const name of ["Unterfeld", "Ziegenweide", "Oberfeld"]) {
          const tile = findTile(name);
          if (!tile) continue;
          const px = tile.tx * T;
          const py = tile.ty * T;
          ctx.fillStyle = "rgba(220,100,20,0.30)";
          ctx.fillRect(px, py, T, T);
          ctx.strokeStyle = "rgba(160,60,0,0.50)";
          ctx.lineWidth = 1;
          for (let dy = 6; dy < T; dy += 10) {
            ctx.beginPath();
            ctx.moveTo(px + 2, py + dy);
            ctx.lineTo(px + T - 2, py + dy + 3);
            ctx.stroke();
          }
        }
        break;
      }

      case "double_harvest": {
        const a = 0.15 + pulse * 0.20;
        for (const name of ["Unterfeld", "Ziegenweide", "Oberfeld"]) {
          const tile = findTile(name);
          if (!tile) continue;
          const px = tile.tx * T;
          const py = tile.ty * T;
          ctx.fillStyle = `rgba(255,200,60,${a})`;
          ctx.fillRect(px, py, T, T);
          ctx.font = "14px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = `rgba(255,200,0,${0.5 + pulse * 0.4})`;
          ctx.fillText("✦", px + T / 2, py + T / 2 + 5);
        }
        break;
      }

      case "mine_collapse": {
        const tile = findTile("Erzstollen");
        if (!tile) break;
        const px = tile.tx * T;
        const py = tile.ty * T;
        ctx.fillStyle = "rgba(180,40,20,0.40)";
        ctx.fillRect(px, py, T, T);
        ctx.strokeStyle = "rgba(220,30,30,0.75)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px + 8, py + 8); ctx.lineTo(px + T - 8, py + T - 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px + T - 8, py + 8); ctx.lineTo(px + 8, py + T - 8);
        ctx.stroke();
        break;
      }

      case "caravan": {
        const spot = caravanSpot();
        if (!spot) break;
        const { cx, cy } = spot;

        // Merchant NPC sprite (Gipsy spritesheet: 800×400, 10×5 frames = 80×80 each)
        const sheet = loadSprite(SPRITES.merchantIdle, MERCHANT_FRAME, MERCHANT_FRAME);
        const animFrame = reduced ? 0 : Math.floor(frameIndex / 8) % 10;
        ctx.fillStyle = "rgba(0,0,0,0.38)";
        ctx.beginPath();
        ctx.ellipse(cx, cy + MERCHANT_DISPLAY / 2 - 6, 14, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        if (sheet) {
          drawSprite(ctx, sheet, animFrame, cx - MERCHANT_DISPLAY / 2, cy - MERCHANT_DISPLAY / 2, MERCHANT_DISPLAY, MERCHANT_DISPLAY);
        } else {
          ctx.fillStyle = "#d4a020";
          ctx.beginPath();
          ctx.arc(cx, cy, 14, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
  }
}

/** Map-wide tints, drawn after the darkness layer so they stay visible. */
function drawGlobalTints(ctx: CanvasRenderingContext2D, world: WorldState): void {
  const pulse = prefersReducedMotion() ? 0.5 : Math.sin(frameIndex * 0.05) * 0.5 + 0.5;
  for (const ev of world.active_events) {
    if (ev.type === "plague_rumor") {
      ctx.fillStyle = "rgba(90,30,110,0.14)";
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    } else if (ev.type === "bandit_threat") {
      ctx.fillStyle = `rgba(180,30,30,${0.07 + pulse * 0.05})`;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }
  }
}

// ─── Lights ───────────────────────────────────────────────────────────────

function buildLamps(
  world: WorldState | null,
  camera: Camera,
  selectedAgent: AgentName | null,
  hoveredLocation: string | null,
  canvasW: number,
  canvasH: number,
  tSec: number,
): Lamp[] {
  const lamps: Lamp[] = [];
  const z = camera.zoom;
  const toScreen = (wx: number, wy: number, wr: number, i: number, warm: number) => {
    lamps.push({
      x: (wx - camera.x) * z + canvasW / 2,
      y: (wy - camera.y) * z + canvasH / 2,
      r: wr * z, i, warm,
    });
  };

  let n = 0;
  const tiles = getActiveTiles();
  for (const [loc, bld] of Object.entries(getActiveBuildings())) {
    const tile = tiles[loc];
    if (!tile) continue;
    const bare = bareName(loc);
    const px = tile.tx * T, py = tile.ty * T;
    const f = flicker(tSec, n++ * 1.7);
    const hover = loc === hoveredLocation ? 1.22 : 1;
    if (bld.img) {
      let r = 95 + bld.w * 0.7;
      let warm = 1;
      if (bare === "Schmiede") { r *= 1.15; warm = 1.4; }
      if (bare === "Unterfeld" || bare === "Ziegenweide" || bare === "Oberfeld") r *= 0.85;
      toScreen(px + T / 2, py + T - 28, r * f * hover, 0.95, warm);
    } else if (bare === "Zechenplatz") {
      toScreen(px + T / 2, py + T / 2, 240 * f * hover, 1, 1.1);
    } else if (bare === "Köhlerwald") {
      toScreen(px + T / 2, py + T / 2, 110 * f * hover, 0.5, 1.3);
    } else {
      toScreen(px + T / 2, py + T / 2, 110 * f * hover, 0.65, 1);
    }
  }

  if (world?.active_events.some(e => e.type === "caravan")) {
    const spot = caravanSpot();
    if (spot) toScreen(spot.cx, spot.cy, 115 * flicker(tSec, 40), 1, 1.5);
  }

  agentDraws.forEach((a, i) => {
    const isSel = a.id === selectedAgent;
    const isPlayer = a.id === PLAYER_ID;
    const r = isPlayer ? 130 : isSel ? 115 : 58;
    toScreen(a.cx, a.cy - 6, r * flicker(tSec, i + 11), isSel || isPlayer ? 1 : 0.8, isPlayer ? 1.3 : 1);
  });

  return lamps;
}

// ─── Label & marker pass (after the darkness layer) ───────────────────────

function drawEllipseRing(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, rx: number, ry: number,
  color: string, lineW: number, glow: string | null, blur: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = blur; }
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawOverlayPass(
  ctx: CanvasRenderingContext2D,
  world: WorldState | null,
  camera: Camera,
  selectedAgent: AgentName | null,
  hoveredLocation: string | null,
  tSec: number,
): void {
  const px = 1 / camera.zoom;        // one screen pixel in world units
  const reduced = prefersReducedMotion();
  const tiles = getActiveTiles();

  // Hovered location: amber outline on the ground
  if (hoveredLocation) {
    const tile = tiles[hoveredLocation];
    if (tile) {
      ctx.fillStyle = "rgba(242,169,59,0.08)";
      ctx.strokeStyle = "rgba(242,169,59,0.55)";
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.ellipse(tile.tx * T + T / 2, tile.ty * T + T - 6, T * 0.8, T * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Selection / player rings (at the feet)
  const caravanSel = selectedAgent === "reinhart" && world?.active_events.some(e => e.type === "caravan");
  if (caravanSel) {
    const spot = caravanSpot();
    if (spot) drawEllipseRing(ctx, spot.cx, spot.cy + MERCHANT_DISPLAY / 2 - 8, 21, 10, "#ffc866", 2.8 * px, LAMP_PALETTE.amber, 12);
  }
  for (const a of agentDraws) {
    const fy = a.cy + FEET + 1;
    if (a.id === PLAYER_ID) {
      const pulse = reduced ? 0 : Math.sin(tSec * 3) * 1.4;
      drawEllipseRing(ctx, a.cx, fy, 24 + pulse, 12 + pulse * 0.5, LAMP_PALETTE.amber, 2.2 * px, LAMP_PALETTE.amber, 12);
      drawEllipseRing(ctx, a.cx, fy, 18, 9, "#fff4d8", 2 * px, "#fff4d8", 6);
    } else if (a.id === selectedAgent) {
      drawEllipseRing(ctx, a.cx, fy, 19, 10, "#ffc866", 2.8 * px, LAMP_PALETTE.amber, 12);
    }
  }

  // Building / location labels
  const fs = 11.5 * px;
  const fsSmall = 10.5 * px;
  const caravan = !!world?.active_events.some(e => e.type === "caravan");
  for (const [loc, bld] of Object.entries(getActiveBuildings())) {
    if (!bld.label) continue;
    const tile = tiles[loc];
    if (!tile) continue;
    if (caravan && bareName(loc) === "Schmugglerpfad") continue; // the merchant carries its own label
    const text = bareName(bld.label);
    const small = text.startsWith("Baracke");
    const size = small ? fsSmall : fs;
    lampLabel(ctx, text, tile.tx * T + T / 2, tile.ty * T + T + 2 + size * 0.6, size, 4 * px * 0.9, loc === hoveredLocation);
  }
  if (caravan) {
    const spot = caravanSpot();
    if (spot) {
      const sel = selectedAgent === "reinhart";
      lampLabel(ctx, AGENT_DISPLAY["reinhart"]!, spot.cx, spot.cy - MERCHANT_DISPLAY / 2 + 6, fs, 4 * px * 0.9, sel);
      lampLabel(ctx, "Händler", spot.cx, spot.cy + MERCHANT_DISPLAY / 2 + 4 + fs * 0.4, fsSmall, 4 * px * 0.9, false);
    }
  }

  // Agent labels (+ hunger / sickness badges)
  for (const a of agentDraws) {
    const isPlayer = a.id === PLAYER_ID;
    const sel = a.id === selectedAgent;
    const ly = a.cy - HEAD - 5 - a.row * (fs + 1);
    lampLabel(ctx, agentLabel(a.id), a.cx, ly, fs, 4 * px * 0.9, sel || isPlayer, isPlayer ? "#fff4d8" : undefined);
    if (a.hungry) lampLabel(ctx, "!", a.cx + 16, a.cy - HEAD + 6, fs, 3 * px, true, LAMP_PALETTE.bad);
    if (a.sick) lampLabel(ctx, "~", a.cx + 16, a.cy - HEAD + 18, fs, 3 * px, true, LAMP_PALETTE.good);
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, px: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.y -= 0.8;
    p.life -= p.decay;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = p.life;
    lampLabel(ctx, p.text, p.x, p.y, 13 * px, 3 * px, true, p.color);
    ctx.globalAlpha = 1;
  }
}

// ─── Main renderer ────────────────────────────────────────────────────────

export function renderVillage(
  ctx: CanvasRenderingContext2D,
  world: WorldState | null,
  camera: Camera,
  selectedAgent: AgentName | null,
  hoveredLocation: string | null,
  canvasW: number,
  canvasH: number,
  animations: Map<AgentName, ActiveAnimation> = new Map(),
  bubbles: readonly MapBubble[] = [],
): void {
  frameIndex++;
  const tSec = performance.now() / 1000;
  agentDraws.length = 0;

  const enterWorld = () => {
    ctx.save();
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
  };

  // ── Scene (world space) ──────────────────────────────────────
  enterWorld();
  ctx.drawImage(getGround(), 0, 0);
  drawBuildings(ctx);
  drawDecorations(ctx);
  if (world) drawEventOverlays(ctx, world);
  if (world) drawAgents(ctx, world, animations);
  ctx.restore();

  // ── Darkness + lamp light (screen space) ─────────────────────
  const hour = world ? getHourFromTime(world.current_time) : 20;
  const lamps = buildLamps(world, camera, selectedAgent, hoveredLocation, canvasW, canvasH, tSec);
  applyLampLight(ctx, lamps, canvasW, canvasH, darknessFor(hour), seasonTint(world?.season ?? ""));

  // ── Tints, markers, labels, particles (world space, unlit) ───
  enterWorld();
  if (world) drawGlobalTints(ctx, world);
  drawOverlayPass(ctx, world, camera, selectedAgent, hoveredLocation, tSec);
  drawParticles(ctx, 1 / camera.zoom);
  ctx.restore();

  // ── Speech / bark bubbles (screen space, over the colonists drawn above; 54 px keeps clear of the playback bar) ──
  drawBubbles(ctx, bubbles, agentDraws, camera, canvasW, canvasH, HEAD, FEET, 54);
}

// ─── Hit test: which location was clicked ─────────────────────────────────

export function hitTestLocation(
  worldX: number,
  worldY: number,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;

  for (const [loc, tile] of Object.entries(getActiveTiles())) {
    const cx = tile.tx * TILE_SIZE + TILE_SIZE / 2;
    const cy = tile.ty * TILE_SIZE + TILE_SIZE / 2;
    const dist = Math.hypot(worldX - cx, worldY - cy);
    if (dist < TILE_SIZE * 0.9 && dist < bestDist) {
      best = loc;
      bestDist = dist;
    }
  }
  return best;
}

// ─── Screen → world coords ────────────────────────────────────────────────

export function screenToWorld(
  sx: number, sy: number,
  camera: Camera,
  canvasW: number, canvasH: number,
): { x: number; y: number } {
  return {
    x: (sx - canvasW / 2) / camera.zoom + camera.x,
    y: (sy - canvasH / 2) / camera.zoom + camera.y,
  };
}
