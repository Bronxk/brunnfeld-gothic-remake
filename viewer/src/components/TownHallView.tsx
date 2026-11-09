import { useEffect, useRef } from "react";
import { useVillageStore } from "../store";
import { drawInterior } from "../canvas/interior-renderer";
import type { MeetingState } from "../store";
import type { AgentName } from "../types";

// ─── Meeting Header ───────────────────────────────────────────────────────

function MeetingHeader({ meeting }: { meeting: MeetingState }) {
  const phaseLabel =
    meeting.phase === "discussion" ? "DISCUSSION"
    : meeting.phase === "vote" ? "VOTE IN PROGRESS"
    : meeting.result?.passed ? "LAW PASSED"
    : "VOTE FAILED";

  const phaseBg =
    meeting.phase === "result"
      ? meeting.result?.passed ? "#16a34a" : "#dc2626"
      : "#1e3a5f";

  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0,
      background: "rgba(0,0,0,0.82)",
      borderBottom: "2px solid #6b4c1e",
      padding: "8px 16px",
      display: "flex", alignItems: "center", gap: "12px",
      fontFamily: "monospace",
    }}>
      <span style={{
        background: phaseBg, color: "#fff",
        padding: "3px 10px", borderRadius: "4px",
        fontSize: "11px", fontWeight: "bold", letterSpacing: "1px",
      }}>
        {phaseLabel}
      </span>
      <span style={{ color: "#e8d5a0", fontSize: "13px", flex: 1 }}>
        {meeting.description}
      </span>
      <span style={{ color: "#9ca3af", fontSize: "11px" }}>
        {meeting.attendees.length} attendees
      </span>
    </div>
  );
}

// ─── Discussion Feed ──────────────────────────────────────────────────────

const COUNCIL_COLOR: Partial<Record<AgentName, string>> = {
  reinhart: "#f0c870", irmel: "#93c5fd", eckhart: "#86efac",
  bodo: "#fca5a5", brakel: "#d8b4fe",
};

function DiscussionFeed({ meeting }: { meeting: MeetingState }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [meeting.discussion.length]);

  return (
    <div style={{
      position: "absolute", top: 52, left: 0, bottom: 0,
      width: "300px",
      background: "rgba(10,8,4,0.92)",
      borderRight: "1px solid #3d2810",
      overflowY: "auto",
      padding: "10px 12px",
      fontFamily: "monospace",
      display: "flex", flexDirection: "column", gap: "8px",
    }}>
      {meeting.discussion.length === 0 && (
        <div style={{ color: "#4a3820", fontSize: "11px", fontStyle: "italic", marginTop: "8px", textAlign: "center" }}>
          Waiting for discussion…
        </div>
      )}
      {meeting.discussion.map((line, i) => (
        <div key={i} style={{ fontSize: "12px", lineHeight: "1.5" }}>
          <span style={{
            color: COUNCIL_COLOR[line.agent] ?? "#e8d5a0",
            fontWeight: "bold",
            marginRight: "5px",
            display: "block",
            marginBottom: "2px",
          }}>
            {line.name}
          </span>
          <span style={{ color: "#c8b898", wordBreak: "break-word" }}>
            {line.text.replace(/^.*says: "/, "").replace(/"$/, "").replace(/^\[Thought\] /, "")}
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
      width: "220px",
      background: "rgba(10,8,4,0.88)",
      borderLeft: "1px solid #3d2810",
      overflowY: "auto",
      padding: "8px",
      fontFamily: "monospace",
    }}>
      {meeting.proposal && (
        <div style={{
          background: "#1e3a5f", borderRadius: "4px",
          padding: "6px 8px", marginBottom: "8px",
          fontSize: "11px", color: "#93c5fd",
        }}>
          <div style={{ color: "#6b7280", marginBottom: "3px", fontSize: "10px" }}>PROPOSAL</div>
          {meeting.proposal}
        </div>
      )}

      {voteEntries.length > 0 && (
        <div>
          <div style={{ color: "#6b7280", fontSize: "10px", marginBottom: "4px" }}>VOTES</div>
          {voteEntries.map(([agent, side]) => (
            <div key={agent} style={{
              display: "flex", justifyContent: "space-between",
              fontSize: "11px", color: "#e8d5a0", marginBottom: "2px",
            }}>
              <span>{agent}</span>
              <span style={{ color: side === "agree" ? "#22c55e" : "#ef4444" }}>
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
  description: "Preview — no meeting in progress",
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
      style={{ position: "relative", width: "100%", height: "100%", background: "#0e0904" }}
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
          background: "rgba(0,0,0,0.7)",
          borderBottom: "1px solid #4a3010",
          padding: "6px 14px",
          fontFamily: "monospace", fontSize: "11px",
          color: "#6b5030", letterSpacing: "1px",
        }}>
          TOWN HALL — preview (no meeting active)
        </div>
      )}
    </div>
  );
}
