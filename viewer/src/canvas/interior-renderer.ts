// ─── Vogtei Interior Renderer (Appell scene, "Grubenlampe" look) ──────────

import type { AgentName } from "../types";
import type { MeetingState } from "../store";
import { AGENT_DISPLAY } from "../store";
import {
  loadSprite, drawSpriteCrop, UNIT_INSET, UNIT_FEET_FRAC, applyLampLight, flicker, lampLabel, prefersReducedMotion,
  LABEL_FONT, LAMP_PALETTE, type Lamp,
} from "./sprites";

// ─── Sprite map (mirrors renderer.ts) ────────────────────────────────────

const SPRITES: Record<string, string> = {
  pawnIdle:    "/assets/units/Pawn/Pawn_Idle.png",
  pawnAxe:     "/assets/units/Pawn/Pawn_Idle Axe.png",
  pawnHammer:  "/assets/units/Pawn/Pawn_Idle Hammer.png",
  pawnPickaxe: "/assets/units/Pawn/Pawn_Idle Pickaxe.png",
  pawnWood:    "/assets/units/Pawn/Pawn_Idle Wood.png",
  monkIdle:    "/assets/units/Monk/Idle.png",
  warriorIdle: "/assets/units/Warrior/Warrior_Idle.png",
};

const AGENT_SPRITE: Partial<Record<AgentName, string>> = {
  brakel: "pawnAxe", rike: "pawnIdle", ottmar: "pawnIdle", wenzel: "pawnAxe",
  kasper: "pawnAxe", irmel: "pawnHammer", bodo: "pawnHammer",
  eckhart: "pawnHammer", lenz: "pawnHammer", grete: "pawnIdle",
  walburga: "pawnIdle", jost: "pawnWood",
  reinhart: "warriorIdle", bruder_anno: "monkIdle",
  mattis: "pawnPickaxe", vroni: "pawnIdle", wendel: "pawnAxe",
  minna: "pawnIdle", gisbert: "pawnPickaxe", player: "pawnIdle",
};

const AGENT_COLORS: Partial<Record<AgentName, string>> = {
  brakel: "#e8c87a", rike: "#f4b8d4", ottmar: "#a8d48a", wenzel: "#c8a84a",
  kasper: "#d4a870", irmel: "#d4d4a0", bodo: "#f0d890", eckhart: "#c84c4c",
  lenz: "#a07040", grete: "#d878a8", walburga: "#80c8d8", jost: "#80a850",
  reinhart: "#a8a0c8", bruder_anno: "#c8c8e8", mattis: "#909090", vroni: "#e8b090",
  wendel: "#d8c060", minna: "#e878b8", gisbert: "#b0b0b0", player: "#ffd68a",
};

const SPRITE_W = 192;
const SPRITE_H = 192;

const AGREE = LAMP_PALETTE.good;
const DISAGREE = LAMP_PALETTE.bad;

// ─── Background loader ────────────────────────────────────────────────────

const imgCache = new Map<string, HTMLImageElement | "loading" | "error">();
function loadImg(url: string): HTMLImageElement | null {
  const hit = imgCache.get(url);
  if (hit && hit !== "loading" && hit !== "error") return hit as HTMLImageElement;
  if (hit === "loading" || hit === "error") return null;
  imgCache.set(url, "loading");
  const img = new Image();
  img.onload  = () => imgCache.set(url, img);
  img.onerror = () => {
    imgCache.set(url, "error");
    console.warn(`[interior] image failed to load: ${url}`);
  };
  img.src = url;
  return null;
}

// ─── Seats ────────────────────────────────────────────────────────────────

interface Seat {
  agent: AgentName;
  x: number;      // feet position (canvas px)
  y: number;
  size: number;
}

function agentName(agent: AgentName): string {
  return agent === "player" ? "Du" : (AGENT_DISPLAY[agent]?.split(" ").pop() ?? agent);
}

/** Sprite only (drawn before the darkness layer so lamps light it). */
function drawSeatSprite(
  ctx: CanvasRenderingContext2D,
  seat: Seat,
  frameIndex: number,
): void {
  const { agent, x: cx, y: cy, size } = seat;
  const spriteKey = AGENT_SPRITE[agent] ?? "pawnIdle";
  const url = SPRITES[spriteKey]!;
  const sheet = loadSprite(url, SPRITE_W, SPRITE_H);
  const frame = prefersReducedMotion() ? 0 : Math.floor(frameIndex / 8);

  if (sheet) {
    ctx.imageSmoothingEnabled = false;
    // cropped frame: feet land on (cx, cy)
    drawSpriteCrop(ctx, sheet, frame, UNIT_INSET, cx - size / 2, cy - size * UNIT_FEET_FRAC, size, size);
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, cy - size * 0.1, size * 0.26, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // Colour circle fallback
    ctx.fillStyle = AGENT_COLORS[agent] ?? "#888";
    ctx.beginPath();
    ctx.arc(cx, cy - size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Name label + vote badge (drawn after the darkness layer, stays readable). */
function drawSeatOverlay(
  ctx: CanvasRenderingContext2D,
  seat: Seat,
  vote: "agree" | "disagree" | undefined,
  showVote: boolean,
): void {
  const { agent, x: cx, y: cy, size } = seat;
  const fs = Math.min(17, Math.max(10, Math.round(size * 0.17)));
  lampLabel(ctx, agentName(agent), cx, cy + size * 0.2, fs, 3.5, agent === "player",
    agent === "player" ? "#fff4d8" : undefined);

  if (showVote) {
    const bx = cx + size * 0.32;
    const by = cy - size * 0.78;
    const br = size * 0.18;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
    if (vote === "agree" || vote === "disagree") {
      ctx.fillStyle = vote === "agree" ? AGREE : DISAGREE;
      ctx.fill();
      ctx.strokeStyle = "rgba(8,6,4,0.8)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#14100d";
      ctx.font = `bold ${Math.round(br * 1.4)}px ${LABEL_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(vote === "agree" ? "✓" : "✗", bx, by + br * 0.05);
    } else {
      ctx.arc(bx, by, br * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = "#52422e";
      ctx.fill();
    }
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── Main draw ────────────────────────────────────────────────────────────

export function drawInterior(
  ctx: CanvasRenderingContext2D,
  meeting: MeetingState,
  frameIndex: number,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cx = W / 2;
  const tSec = performance.now() / 1000;

  const bg = loadImg("/assets/interior/TownHall.png");

  // ── 1. Background ──────────────────────────────────────────────
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = LAMP_PALETTE.night;
  ctx.fillRect(0, 0, W, H);

  const BG_SIZE = 200;
  const bgScale = Math.min(W / BG_SIZE, H / BG_SIZE) * 1.2;
  const bgW = BG_SIZE * bgScale;
  const bgH = BG_SIZE * bgScale;
  const bgX = (W - bgW) / 2;
  const bgY = Math.max(0, (H - bgH) / 2);

  if (bg) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bg, bgX, bgY, bgW, bgH);
  }

  // Helper: mockup-space (0–200) → canvas coords (feet position)
  const mc = (mx: number, my: number) => ({
    x: bgX + mx * bgScale,
    y: bgY + my * bgScale,
  });

  // ── 2. Seat layout ─────────────────────────────────────────────
  // Chair (Vogt): top center
  // Left col (inner→outer): two slots stacked vertically
  // Right col: mirror
  const AGENT_SIZE = Math.round(bgScale * 28);

  const CHAIR_POS   = mc(100, 62);
  const LEFT_SEATS  = [mc(68, 105), mc(68, 145)];
  const RIGHT_SEATS = [mc(132, 105), mc(132, 145)];

  const showVote = meeting.phase === "vote" || meeting.phase === "result";
  const attendees = meeting.attendees;
  const nonChair = attendees.filter(a => a !== "reinhart");
  // Split: first half on left, second half on right (up to 2 each)
  const leftAgents  = nonChair.slice(0, 2);
  const rightAgents = nonChair.slice(2, 4);

  const seats: Seat[] = [];
  leftAgents.forEach((agent, i) => seats.push({ agent, x: LEFT_SEATS[i]!.x, y: LEFT_SEATS[i]!.y, size: AGENT_SIZE }));
  rightAgents.forEach((agent, i) => seats.push({ agent, x: RIGHT_SEATS[i]!.x, y: RIGHT_SEATS[i]!.y, size: AGENT_SIZE }));
  const chairSize = Math.round(AGENT_SIZE * 1.25);
  const chairPresent = attendees.includes("reinhart");
  if (chairPresent) seats.push({ agent: "reinhart", x: CHAIR_POS.x, y: CHAIR_POS.y, size: chairSize });

  // ── 3. Sprites ─────────────────────────────────────────────────
  for (const s of seats) drawSeatSprite(ctx, s, frameIndex);

  // ── 4. Darkness + lamp pools ───────────────────────────────────
  const lamps: Lamp[] = [];
  const room = mc(100, 100);
  lamps.push({ x: room.x, y: room.y, r: bgScale * 78 * flicker(tSec, 1), i: 0.8, warm: 0.9 });
  // wall lamps beside the dais
  const wallL = mc(58, 62), wallR = mc(142, 62);
  lamps.push({ x: wallL.x, y: wallL.y, r: bgScale * 38 * flicker(tSec, 2), i: 0.7, warm: 1.1 });
  lamps.push({ x: wallR.x, y: wallR.y, r: bgScale * 38 * flicker(tSec, 3), i: 0.7, warm: 1.1 });
  seats.forEach((s, i) => {
    const isChair = s.agent === "reinhart";
    lamps.push({
      x: s.x, y: s.y - s.size * 0.5,
      r: s.size * (isChair ? 1.9 : 1.5) * flicker(tSec, i + 5),
      i: 1, warm: isChair ? 1.3 : 1,
    });
  });
  applyLampLight(ctx, lamps, W, H, 0.8);

  // ── 5. Labels, badges, crown (unlit) ───────────────────────────
  for (const s of seats) {
    const vote = showVote ? (meeting.votes[s.agent] ?? undefined) : undefined;
    drawSeatOverlay(ctx, s, vote, showVote);
  }
  if (chairPresent) {
    lampLabel(ctx, "★ VORSITZ ★", CHAIR_POS.x, CHAIR_POS.y - chairSize * 1.08,
      Math.min(17, Math.max(10, Math.round(AGENT_SIZE * 0.17))), 3.5, true);
  }

  // ── 6. Vote tally bar ──────────────────────────────────────────
  if (showVote) {
    const agreeCount    = Object.values(meeting.votes).filter(v => v === "agree").length;
    const disagreeCount = Object.values(meeting.votes).filter(v => v === "disagree").length;
    const total = attendees.length;

    ctx.fillStyle = "rgba(20,16,13,0.92)";
    roundRectPath(ctx, cx - 160, H - 48, 320, 38, 9);
    ctx.fill();
    ctx.strokeStyle = "#3a2e21";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = "alphabetic";
    ctx.font = `600 13px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.fillStyle = AGREE;
    ctx.fillText(`${agreeCount} dafür`, cx - 76, H - 29);
    ctx.fillStyle = "#6f6249";
    ctx.fillText("|", cx, H - 29);
    ctx.fillStyle = DISAGREE;
    ctx.fillText(`${disagreeCount} dagegen`, cx + 76, H - 29);
    ctx.fillStyle = "#a2916f";
    ctx.font = `11px ${LABEL_FONT}`;
    ctx.fillText(`von ${total} Anwesenden`, cx, H - 15);
  }

  // ── 7. Result overlay ──────────────────────────────────────────
  if (meeting.phase === "result" && meeting.result) {
    const passed = meeting.result.passed;
    const bw = Math.min(440, W - 24);
    const bx = cx - bw / 2;
    ctx.fillStyle = passed ? "rgba(26,32,16,0.94)" : "rgba(40,18,12,0.94)";
    roundRectPath(ctx, bx, H / 2 - 62, bw, 132, 12);
    ctx.fill();
    ctx.strokeStyle = passed ? AGREE : DISAGREE;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = LAMP_PALETTE.ink;
    ctx.font = `700 19px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(passed ? "⚖ BESCHLUSS ANGENOMMEN" : "✗ ABGELEHNT", cx, H / 2 - 26);

    ctx.font = `13px ${LABEL_FONT}`;
    ctx.fillStyle = "#cdbd9c";
    const desc = meeting.proposal ?? meeting.description;
    const maxChars = Math.max(20, Math.floor(bw / 7.4));
    const words = desc.split(" ");
    let line = "";
    let lineY = H / 2 - 2;
    let lines = 0;
    let cut = false;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length > maxChars && line) {
        if (lines === 2) { ctx.fillText(`${line} …`, cx, lineY); cut = true; break; }
        ctx.fillText(line, cx, lineY);
        line = word; lineY += 17; lines++;
      } else { line = test; }
    }
    if (line && !cut) ctx.fillText(line, cx, lineY);

    ctx.fillStyle = passed ? "#b9d98a" : "#f0a088";
    ctx.font = `600 12px ${LABEL_FONT}`;
    ctx.fillText(`${meeting.result.agreeCount} dafür`, cx, H / 2 + 54);
  }
}
