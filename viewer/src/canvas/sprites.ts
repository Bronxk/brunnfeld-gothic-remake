// ─── Sprite loader & animator ─────────────────────────────────────────────

export interface SpriteSheet {
  img: HTMLImageElement;
  frameW: number;
  frameH: number;
  frames: number;
}

const cache = new Map<string, SpriteSheet | "loading" | "error">();
const listeners = new Map<string, Array<(s: SpriteSheet) => void>>();

export function loadSprite(url: string, frameW: number, frameH: number): SpriteSheet | null {
  const hit = cache.get(url);
  if (hit && hit !== "loading" && hit !== "error") return hit;
  if (hit === "loading" || hit === "error") return null;

  cache.set(url, "loading");
  const img = new Image();
  img.onload = () => {
    const frames = Math.floor(img.width / frameW);
    const sheet: SpriteSheet = { img, frameW, frameH, frames };
    cache.set(url, sheet);
    const cbs = listeners.get(url) ?? [];
    cbs.forEach((cb) => cb(sheet));
    listeners.delete(url);
  };
  img.onerror = () => {
    cache.set(url, "error");
  };
  img.src = url;
  return null;
}

export function onSpriteLoad(url: string, cb: (s: SpriteSheet) => void): void {
  const existing = listeners.get(url) ?? [];
  listeners.set(url, [...existing, cb]);
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  frame: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const f = Math.floor(frame) % sheet.frames;
  ctx.drawImage(
    sheet.img,
    f * sheet.frameW, 0, sheet.frameW, sheet.frameH,
    dx, dy, dw, dh,
  );
}

/**
 * Unit frames are 192x192 but the figure only fills the middle (feet at ~y=128).
 * This draws just the central part (inset px cropped on every side) so the figure is large enough to see.
 * With inset 40 the feet end up at ~78.6 % of the destination height.
 */
export const UNIT_INSET = 40;
export const UNIT_FEET_FRAC = (128 - UNIT_INSET) / (192 - 2 * UNIT_INSET);

export function drawSpriteCrop(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  frame: number,
  inset: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const f = Math.floor(frame) % sheet.frames;
  ctx.drawImage(
    sheet.img,
    f * sheet.frameW + inset, inset, sheet.frameW - 2 * inset, sheet.frameH - 2 * inset,
    dx, dy, dw, dh,
  );
}

// ─── "Grubenlampe" lighting helpers (shared by map + Vogtei interior) ──────

/** Dusk palette used by all canvas views. */
export const LAMP_PALETTE = {
  ink: "#ecdcbc",
  amber: "#f2a93b",
  amberLight: "#ffd68a",
  label: "#f0c878",
  labelStroke: "rgba(8,6,4,0.9)",
  bad: "#e56a45",
  good: "#9cc46a",
  night: "#0c0a09",
} as const;

export const LABEL_FONT = '"Alegreya Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

const reducedQuery: MediaQueryList | null =
  typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/** True when the user asked for no motion: no flicker, frozen sprite frames. */
export function prefersReducedMotion(): boolean {
  return reducedQuery?.matches ?? false;
}

/** Lamp flicker factor around 1.0 (demo formula); exactly 1 with reduced motion. */
export function flicker(tSec: number, phase: number): number {
  if (prefersReducedMotion()) return 1;
  return 1
    + 0.05 * Math.sin(tSec * 8 + phase)
    + 0.045 * Math.sin(tSec * 21 + phase * 2.3)
    + 0.03 * Math.sin(tSec * 3.1 + phase);
}

/** One light source, in CSS pixels of the target canvas. */
export interface Lamp {
  x: number;
  y: number;
  r: number;
  /** 0..1 how much darkness is cut away */
  i: number;
  /** multiplier for the warm additive glow */
  warm: number;
}

interface LightSprites { cut: HTMLCanvasElement; glow: HTMLCanvasElement }
let lightSprites: LightSprites | null = null;

function getLightSprites(): LightSprites {
  if (lightSprites) return lightSprites;
  const N = 256;
  const make = (stops: [number, string][], inner: number): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(N / 2, N / 2, N / 2 * inner, N / 2, N / 2, N / 2);
    for (const [o, col] of stops) g.addColorStop(o, col);
    x.fillStyle = g;
    x.fillRect(0, 0, N, N);
    return c;
  };
  lightSprites = {
    cut: make([[0, "rgba(0,0,0,1)"], [0.45, "rgba(0,0,0,0.62)"], [1, "rgba(0,0,0,0)"]], 0.06),
    glow: make([[0, "rgba(255,150,50,1)"], [0.5, "rgba(255,120,30,0.35)"], [1, "rgba(255,100,20,0)"]], 0),
  };
  return lightSprites;
}

const overlays = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const OVERLAY_SCALE = 0.5; // darkness layer is soft anyway: half resolution is plenty

/**
 * Darkens the already drawn scene and cuts warm, flickering light pools into it.
 * `cssW/cssH` is the logical size of the canvas, lamps are in those units.
 * Pre-rendered gradient sprites are scaled per lamp, so no gradients are created per frame.
 */
export function applyLampLight(
  ctx: CanvasRenderingContext2D,
  lamps: Lamp[],
  cssW: number,
  cssH: number,
  darkness: number,
  tint = "6,8,20",
): void {
  const canvas = ctx.canvas;
  const sprites = getLightSprites();
  const ow = Math.max(1, Math.ceil(cssW * OVERLAY_SCALE));
  const oh = Math.max(1, Math.ceil(cssH * OVERLAY_SCALE));
  let ov = overlays.get(canvas);
  if (!ov) { ov = document.createElement("canvas"); overlays.set(canvas, ov); }
  if (ov.width !== ow || ov.height !== oh) { ov.width = ow; ov.height = oh; }
  const o = ov.getContext("2d");
  if (!o) return;

  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = "source-over";
  o.globalAlpha = 1;
  o.clearRect(0, 0, ow, oh);
  o.fillStyle = `rgba(${tint},${darkness})`;
  o.fillRect(0, 0, ow, oh);
  o.globalCompositeOperation = "destination-out";
  for (const l of lamps) {
    const r = l.r * OVERLAY_SCALE;
    const sx = l.x * OVERLAY_SCALE, sy = l.y * OVERLAY_SCALE;
    if (sx < -r || sy < -r || sx > ow + r || sy > oh + r) continue;
    o.globalAlpha = Math.min(1, l.i);
    o.drawImage(sprites.cut, sx - r, sy - r, r * 2, r * 2);
  }
  o.globalAlpha = 1;
  o.globalCompositeOperation = "source-over";

  const k = canvas.width / cssW; // device pixels per css pixel
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1;
  ctx.drawImage(ov, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "lighter";
  for (const l of lamps) {
    const r = l.r * 0.8 * k;
    const sx = l.x * k, sy = l.y * k;
    if (sx < -r || sy < -r || sx > canvas.width + r || sy > canvas.height + r) continue;
    ctx.globalAlpha = Math.min(1, 0.26 * l.i * l.warm);
    ctx.drawImage(sprites.glow, sx - r, sy - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Outlined amber text plate (readable on dark and lit ground). */
export function lampLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontPx: number,
  strokePx: number,
  strong = false,
  color?: string,
): void {
  ctx.font = `600 ${fontPx}px ${LABEL_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = strokePx;
  ctx.strokeStyle = LAMP_PALETTE.labelStroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color ?? (strong ? LAMP_PALETTE.amberLight : LAMP_PALETTE.label);
  ctx.fillText(text, x, y);
}

// ─── Item icon loader ─────────────────────────────────────────────────────

const ITEM_ICON_MAP: Record<string, string> = {
  brot: "/assets/items/food/Bread.png",
  fleisch: "/assets/items/food/Meat.png",
  milch: "/assets/items/food/Cheese.png",
  eier: "/assets/items/food/Green Apple.png",
  rueben: "/assets/items/food/Green Apple.png",
  kraeuter: "/assets/items/food/Mushroom.png",
  bier: "/assets/items/food/Beer.png",
  eintopf: "/assets/items/food/Ham.png",
  gerste: "/assets/items/material/Wood Log.png",
  mehl: "/assets/items/material/Paper.png",
  leinen: "/assets/items/material/Fabric.png",
  bauholz: "/assets/items/material/Wood Log.png",
  brennholz: "/assets/items/material/Wooden Plank.png",
  hausrat: "/assets/items/misc/Chest.png",
  eisenerz: "/assets/items/ore/Iron Sword.png",
  kohle: "/assets/items/ore/Coal.png",
  werkzeug: "/assets/items/tool/Pickaxe.png",
  arznei: "/assets/items/misc/Candle.png",
};

const iconCache = new Map<string, HTMLImageElement | "loading" | "error">();

export function getItemIcon(item: string): HTMLImageElement | null {
  const url = ITEM_ICON_MAP[item];
  if (!url) return null;
  const hit = iconCache.get(url);
  if (hit && hit !== "loading" && hit !== "error") return hit;
  if (hit === "loading" || hit === "error") return null;
  iconCache.set(url, "loading");
  const img = new Image();
  img.onload = () => iconCache.set(url, img);
  img.onerror = () => iconCache.set(url, "error");
  img.src = url;
  return null;
}

export function getItemIconUrl(item: string): string | null {
  return ITEM_ICON_MAP[item] ?? null;
}
