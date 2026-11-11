import { palette } from "../theme";
import type { MapBubble } from "../store";
import { LABEL_FONT, prefersReducedMotion } from "./sprites";
import type { Camera } from "./renderer";

/** Where a colonist was drawn this frame (world px; cx/cy = sprite centre). */
export interface BubbleAnchor {
  id: string;
  cx: number;
  cy: number;
}

const PAD_X = 8;
const PAD_Y = 6;
const RADIUS = 9;
const TAIL_W = 5;
const TAIL_H = 6;
const MARGIN = 4;
const FADE_IN_MS = 140;
const FADE_OUT_MS = 450;

/** Greedy word wrap; words longer than the line are broken by character. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (s: string) => { if (s) lines.push(s); };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxW) { line = candidate; continue; }
    push(line);
    line = "";
    if (ctx.measureText(word).width <= maxW) { line = word; continue; }
    let chunk = "";
    for (const ch of word) {
      if (ctx.measureText(chunk + ch).width > maxW) { push(chunk); chunk = ch; } else chunk += ch;
    }
    line = chunk;
  }
  push(line);
  return lines;
}

/** Rounded rect with a small tail (pointing down below the box, or up above it when `up`), one closed path. */
function bubblePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tx: number, up: boolean): void {
  const r = RADIUS;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  if (up) { ctx.lineTo(tx - TAIL_W, y); ctx.lineTo(tx, y - TAIL_H); ctx.lineTo(tx + TAIL_W, y); }
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  if (!up) { ctx.lineTo(tx + TAIL_W, y + h); ctx.lineTo(tx, y + h + TAIL_H); ctx.lineTo(tx - TAIL_W, y + h); }
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

interface Placed { x: number; y: number; w: number; h: number }

/**
 * Draws the speech / bark bubbles in screen space (CSS px; the caller has the DPR transform set).
 * Only colonists that were drawn this frame (= visible in the current village) get a bubble.
 * `bottomInset` keeps bubbles clear of the playback bar at the bottom of the map.
 */
export function drawBubbles(
  ctx: CanvasRenderingContext2D,
  bubbles: readonly MapBubble[],
  anchors: readonly BubbleAnchor[],
  camera: Camera,
  w: number,
  h: number,
  headWorld: number, // sprite centre → top of the head (world px, positive = up)
  feetWorld: number, // sprite centre → ground contact (world px, positive = down)
  bottomInset: number,
): void {
  if (bubbles.length === 0) return;
  const now = performance.now();
  const narrow = w < 420;
  const maxW = narrow ? 140 : 180;
  const fontPx = narrow ? 12 : 13;
  const lineH = Math.round(fontPx * 1.3);
  const reduced = prefersReducedMotion();
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const placed: Placed[] = [];

  ctx.save();
  ctx.font = `500 ${fontPx}px ${LABEL_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // Oldest first: they keep their spot, newer ones stack around them.
  for (const b of [...bubbles].sort((p, q) => p.at - q.at)) {
    const remaining = b.until - now;
    if (remaining <= 0) continue;
    const a = byId.get(b.agent);
    if (!a) continue;

    const sx = (a.cx - camera.x) * camera.zoom + w / 2;
    const syHead = (a.cy - headWorld - camera.y) * camera.zoom + h / 2;
    const syFeet = (a.cy + feetWorld - camera.y) * camera.zoom + h / 2;
    if (sx < -20 || sx > w + 20 || syHead < -40 || syFeet > h + 60) continue;

    const lines = wrapText(ctx, b.text, maxW - PAD_X * 2);
    if (lines.length === 0) continue;
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const bw = Math.min(maxW, Math.ceil(textW) + PAD_X * 2);
    const bh = lines.length * lineH + PAD_Y * 2;

    const age = now - b.at;
    const alpha = Math.min(1, age / FADE_IN_MS) * Math.min(1, remaining / FADE_OUT_MS);
    const rise = reduced ? 0 : (1 - Math.min(1, age / 160)) * 6;

    const x = Math.max(MARGIN, Math.min(w - bw - MARGIN, sx - bw / 2));
    const overlapping = (yy: number) =>
      placed.find((p) => x < p.x + p.w + 3 && x + bw + 3 > p.x && yy < p.y + p.h + TAIL_H + 3 && yy + bh + TAIL_H + 3 > p.y);
    // up = tail on the top edge, bubble sits below the colonist. Stack away from placed bubbles, then clamp
    // into the map; the clamp can push it back onto another bubble (small phone maps), so that spot fails.
    const place = (up: boolean): number | null => {
      let yy = up ? syFeet + 4 + TAIL_H : syHead - 4 - TAIL_H - bh + rise;
      for (let i = 0; i < 6; i++) {
        const hit = overlapping(yy);
        if (!hit) break;
        yy = up ? hit.y + hit.h + TAIL_H + 4 : hit.y - bh - TAIL_H - 4;
      }
      yy = Math.max(MARGIN + (up ? TAIL_H : 0), Math.min(h - bottomInset - bh - (up ? 0 : TAIL_H), yy));
      return overlapping(yy) ? null : yy;
    };
    let up = syHead - 4 - TAIL_H - bh + rise < MARGIN;
    let y = place(up);
    if (y === null) { up = !up; y = place(up); }
    if (y === null) continue; // no free spot: skip it this frame (the line is still in the chronicle)
    placed.push({ x, y, w: bw, h: bh });

    const tx = Math.max(x + RADIUS + TAIL_W, Math.min(x + bw - RADIUS - TAIL_W, sx));
    const bark = b.kind === "bark";

    ctx.globalAlpha = alpha;
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    bubblePath(ctx, x, y, bw, bh, tx, up);
    ctx.fillStyle = palette.panel2;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    if (bark) {
      // warm amber-tinted surface
      ctx.globalAlpha = alpha * 0.16;
      ctx.fillStyle = palette.accent;
      ctx.fill();
    }
    ctx.globalAlpha = alpha * (bark ? 0.75 : 1);
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.strokeStyle = bark ? palette.accent : palette.line2;
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette.ink;
    lines.forEach((l, i) => ctx.fillText(l, x + PAD_X, y + PAD_Y + lineH * (i + 0.5)));
  }
  ctx.restore();
}
