import { useEffect, useRef } from "react";
import { useVillageStore } from "../store";
import { drawInterior } from "../canvas/interior-renderer";
import { LABEL_FONT } from "../canvas/sprites";
import type { MeetingState } from "../store";
import type { AgentName } from "../types";

// Dusk / lamp palette (same tokens as the map)
const C = {
  bg: "#0c0a09",
  panel: "rgba(20,16,13,0.94)",
  panelSolid: "#14100d",
  line: "#3a2e21",
  line2: "#52422e",
  ink: "#ecdcbc",
  ink2: "#a2916f",
  ink3: "#6f6249",
  amber: "#f2a93b",
  good: "#9cc46a",
  bad: "#e56a45",
  info: "#7fb0c4",
} as const;

// ─── Meeting Header ───────────────────────────────────────────────────────

function MeetingHeader({ meeting }: { meeting: MeetingState }) {
  const phaseLabel =
    meeting.phase === "discussion" ? "AUSSPRACHE"
    : meeting.phase === "vote" ? "ABSTIMMUNG LÄUFT"
    : meeting.result?.passed ? "BESCHLUSS ANGENOMMEN"
    : "ABGELEHNT";

  const phaseColor =
    meeting.phase === "result"
      ? meeting.result?.passed ? C.good : C.bad
      : meeting.phase === "vote" ? C.amber : C.info;

  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0,
      background: C.panel,
      borderBottom: `1px solid ${C.line}`,
      padding: "8px 14px",
      display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
      fontFamily: LABEL_FONT,
    }}>
      <span style={{
        color: phaseColor,
        background: `color-mix(in srgb, ${phaseColor} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${phaseColor} 50%, transparent)`,
        padding: "2px 10px", borderRadius: "7px",
        fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em",
      }}>
        {phaseLabel}
      </span>
      <span style={{ color: C.ink, fontSize: "14px", flex: 1, minWidth: 140 }}>
        {meeting.description}
      </span>
      <span style={{ color: C.ink2, fontSize: "12px" }}>
        {meeting.attendees.length} Anwesende
      </span>
    </div>
  );
}

// ─── Discussion Feed ──────────────────────────────────────────────────────

const COUNCIL_COLOR: Partial<Record<AgentName, string>> = {
  reinhart: "#ffd68a", irmel: "#9fc4d4", eckhart: "#b4d48a",
  bodo: "#e8a58c", brakel: "#d4b4d8",
};

function DiscussionFeed({ meeting }: { meeting: MeetingState }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [meeting.discussion.length]);

  return (
    <div style={{
      position: "absolute", top: 52, left: 0, bottom: 0,
      width: "min(300px, 46%)",
      background: C.panel,
      borderRight: `1px solid ${C.line}`,
      overflowY: "auto",
      padding: "10px 12px",
      fontFamily: LABEL_FONT,
      display: "flex", flexDirection: "column", gap: "8px",
    }}>
      {meeting.discussion.length === 0 && (
        <div style={{ color: C.ink3, fontSize: "12px", fontStyle: "italic", marginTop: "8px", textAlign: "center" }}>
          Warte auf die Aussprache…
        </div>
      )}
      {meeting.discussion.map((line, i) => (
        <div key={i} style={{ fontSize: "13px", lineHeight: "1.45" }}>
          <span style={{
            color: COUNCIL_COLOR[line.agent] ?? C.ink,
            fontWeight: 600,
            marginRight: "5px",
            display: "block",
            marginBottom: "2px",
          }}>
            {line.name}
          </span>
          <span style={{ color: C.ink2, wordBreak: "break-word" }}>
            {line.text.replace(/^.*(says|sagt): "/, "").replace(/"$/, "").replace(/^\[(Thought|Gedanke)\] /, "")}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Meeting Log ──────────────────────────────────────────────────────────

function MeetingLog({ meeting }: { meeting: MeetingState }) {
  if (meeting.phase === "result") return null;

  const voteEntries = Object.entries(meeting.votes);

  return (
    <div style={{
      position: "absolute", top: 52, right: 0, bottom: 0,
      width: "min(220px, 36%)",
      background: C.panel,
      borderLeft: `1px solid ${C.line}`,
      overflowY: "auto",
      padding: "8px",
      fontFamily: LABEL_FONT,
    }}>
      {meeting.proposal && (
        <div style={{
          background: "rgba(127,176,196,0.10)",
          border: "1px solid rgba(127,176,196,0.4)",
          borderRadius: "8px",
          padding: "6px 8px", marginBottom: "8px",
          fontSize: "12px", color: C.ink,
        }}>
          <div style={{ color: C.ink3, marginBottom: "3px", fontSize: "10px", letterSpacing: "0.12em" }}>ANTRAG</div>
          {meeting.proposal}
        </div>
      )}

      {voteEntries.length > 0 && (
        <div>
          <div style={{ color: C.ink3, fontSize: "10px", marginBottom: "4px", letterSpacing: "0.12em" }}>STIMMEN</div>
          {voteEntries.map(([agent, side]) => (
            <div key={agent} style={{
              display: "flex", justifyContent: "space-between",
              fontSize: "12px", color: C.ink, marginBottom: "2px",
            }}>
              <span>{agent}</span>
              <span style={{ color: side === "agree" ? C.good : C.bad }}>
                {side === "agree" ? "✓" : "✗"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PREVIEW_MEETING: MeetingState = {
  phase: "discussion",
  agendaType: "general_rule",
  description: "Vorschau – kein Appell im Gange",
  attendees: [],
  votes: {},
  proposal: null,
  result: null,
  discussion: [],
};

// ─── Main Component ───────────────────────────────────────────────────────

export default function TownHallView({ preview = false }: { preview?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeMeeting = useVillageStore(s => s.activeMeeting);
  const meeting = activeMeeting ?? (preview ? PREVIEW_MEETING : null);
  const frameRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !meeting) return;

    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const loop = () => {
      const ctx = canvas.getContext("2d");
      if (ctx && meeting) {
        drawInterior(ctx, meeting, frameRef.current++);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [meeting]);

  if (!meeting) return null;

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", background: C.bg }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
      {!preview && <MeetingHeader meeting={meeting} />}
      {!preview && <DiscussionFeed meeting={meeting} />}
      {!preview && <MeetingLog meeting={meeting} />}
      {preview && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          background: C.panel,
          borderBottom: `1px solid ${C.line}`,
          padding: "7px 14px",
          fontFamily: LABEL_FONT, fontSize: "12px",
          color: C.ink2, letterSpacing: "0.12em",
        }}>
          VOGTEI – Vorschau (kein Appell aktiv)
        </div>
      )}
    </div>
  );
}
