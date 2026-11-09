// ─── Vogtei Interior Renderer ──────────────────────────────────────────

import type { AgentName } from "../types";
import type { MeetingState } from "../store";
import { AGENT_DISPLAY } from "../store";
import { loadSprite, drawSprite } from "./sprites";

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
  wendel: "#d8c060", minna: "#e878b8", gisbert: "#b0b0b0", player: "#ffd700",
};

const SPRITE_W = 192;
const SPRITE_H = 192;

// ─── Background loader ────────────────────────────────────────────────────

const imgCache = new Map<string, HTMLImageElement | "loading" | "error">();
function loadImg(url: string): HTMLImageElement | null {
  const hit = imgCache.get(url);
  if (hit && hit !== "loading" && hit !== "error") return hit as HTMLImageElement;
  if (hit === "loading" || hit === "error") return null;
  imgCache.set(url, "loading");
  const img = new Image();
  img.onload  = () => imgCache.set(url, img);
  img.onerror = () => imgCache.set(url, "error");
  img.src = url;
  return null;
}

// ─── Draw one agent at canvas position (cx, cy = feet) ───────────────────

function drawAgent(
  ctx: CanvasRenderingContext2D,
  agent: AgentName,
  cx: number, cy: number,
  size: number,
  frameIndex: number,
  vote?: "agree" | "disagree" | undefined,
  showVote = false,
): void {
  const spriteKey = AGENT_SPRITE[agent] ?? "pawnIdle";
  const url = SPRITES[spriteKey]!;
  const sheet = loadSprite(url, SPRITE_W, SPRITE_H);
  const frame = Math.floor(frameIndex / 8);

  if (sheet) {
    ctx.imageSmoothingEnabled = false;
    drawSprite(ctx, sheet, frame, cx - size / 2, cy - size, size, size);
  } else {
    // Colour circle fallback
    ctx.fillStyle = AGENT_COLORS[agent] ?? "#888";
    ctx.beginPath();
    ctx.arc(cx, cy - size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Name label
  const name = AGENT_DISPLAY[agent]?.split(" ")[0] ?? agent;
  ctx.font = `bold ${Math.round(size * 0.22)}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(name, cx + 1, cy + size * 0.12 + 1);
  ctx.fillStyle = "#f0e8c8";
  ctx.fillText(name, cx, cy + size * 0.12);

  // Vote badge
  if (showVote) {
    const bx = cx + size * 0.32;
    const by = cy - size * 0.78;
    const br = size * 0.18;
    if (vote === "agree") {
      ctx.fillStyle = "#22c55e";
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(br * 1.4)}px monospace`;
      ctx.fillText("✓", bx, by + br * 0.45);
    } else if (vote === "disagree") {
      ctx.fillStyle = "#ef4444";
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(br * 1.4)}px monospace`;
      ctx.fillText("✗", bx, by + br * 0.45);
    } else {
      ctx.fillStyle = "#4b5563";
      ctx.beginPath(); ctx.arc(bx, by, br * 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }
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

  const bg = loadImg("/assets/interior/TownHall.png");

  // ── 1. Background ──────────────────────────────────────────────
  ctx.fillStyle = "#12111e";
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
  // Otto: top center
  // Left col (inner→outer): two slots stacked vertically
  // Right col: mirror
  const AGENT_SIZE = Math.round(bgScale * 28); // ~56px at typical scale

  const OTTO_POS   = mc(100, 62);
  const LEFT_SEATS  = [mc(68, 105), mc(68, 145)];
  const RIGHT_SEATS = [mc(132, 105), mc(132, 145)];

  const showVote = meeting.phase === "vote" || meeting.phase === "result";
  const attendees = meeting.attendees;
  const nonChair = attendees.filter(a => a !== "reinhart");
  // Split: first half on left, second half on right (up to 2 each)
  const leftAgents  = nonChair.slice(0, 2);
  const rightAgents = nonChair.slice(2, 4);

  // ── 3. Draw left column ────────────────────────────────────────
  for (let i = 0; i < leftAgents.length; i++) {
    const agent = leftAgents[i]!;
    const pos = LEFT_SEATS[i]!;
    drawAgent(ctx, agent, pos.x, pos.y, AGENT_SIZE, frameIndex,
      showVote ? (meeting.votes[agent] ?? undefined) : undefined, showVote);
  }

  // ── 4. Draw right column ───────────────────────────────────────
  for (let i = 0; i < rightAgents.length; i++) {
    const agent = rightAgents[i]!;
    const pos = RIGHT_SEATS[i]!;
    drawAgent(ctx, agent, pos.x, pos.y, AGENT_SIZE, frameIndex,
      showVote ? (meeting.votes[agent] ?? undefined) : undefined, showVote);
  }

  // ── 5. Draw the chair, Vogt Reinhart (always, center top) ─────
  if (attendees.includes("reinhart")) {
    drawAgent(ctx, "reinhart", OTTO_POS.x, OTTO_POS.y, Math.round(AGENT_SIZE * 1.25),
      frameIndex, showVote ? (meeting.votes["reinhart"] ?? undefined) : undefined, showVote);
    // Crown label
    ctx.fillStyle = "#ffd700";
    ctx.font = `bold ${Math.round(AGENT_SIZE * 0.2)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("★ CHAIR ★", OTTO_POS.x, OTTO_POS.y - AGENT_SIZE * 1.35);
  }

  // ── 6. Vote tally bar ──────────────────────────────────────────
  if (showVote) {
    const agreeCount    = Object.values(meeting.votes).filter(v => v === "agree").length;
    const disagreeCount = Object.values(meeting.votes).filter(v => v === "disagree").length;
    const total = attendees.length;

    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fillRect(cx - 160, H - 44, 320, 32);
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#22c55e";
    ctx.fillText(`${agreeCount} agree`, cx - 70, H - 22);
    ctx.fillStyle = "#6b7280";
    ctx.fillText("|", cx, H - 22);
    ctx.fillStyle = "#ef4444";
    ctx.fillText(`${disagreeCount} disagree`, cx + 70, H - 22);
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px monospace";
    ctx.fillText(`of ${total} attendees`, cx, H - 8);
  }

  // ── 7. Result overlay ──────────────────────────────────────────
  if (meeting.phase === "result" && meeting.result) {
    const passed = meeting.result.passed;
    ctx.fillStyle = passed ? "rgba(0,70,0,0.90)" : "rgba(70,0,0,0.90)";
    ctx.fillRect(cx - 220, H / 2 - 60, 440, 120);
    ctx.strokeStyle = passed ? "#22c55e" : "#ef4444";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 220, H / 2 - 60, 440, 120);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px monospace";
    ctx.textAlign = "center";
    ctx.fillText(passed ? "⚖ LAW PASSED" : "✗ VOTE FAILED", cx, H / 2 - 24);

    ctx.font = "11px monospace";
    ctx.fillStyle = "#e5e7eb";
    const desc = meeting.proposal ?? meeting.description;
    const words = desc.split(" ");
    let line = "";
    let lineY = H / 2;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length > 52 && line) {
        ctx.fillText(line, cx, lineY);
        line = word; lineY += 16;
      } else { line = test; }
    }
    if (line) ctx.fillText(line, cx, lineY);

    ctx.fillStyle = passed ? "#86efac" : "#fca5a5";
    ctx.font = "11px monospace";
    ctx.fillText(`${meeting.result.agreeCount} agreed`, cx, H / 2 + 46);
  }
}
