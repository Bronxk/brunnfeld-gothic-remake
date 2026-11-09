import { useVillageStore, AGENT_DISPLAY } from "../store";

/** Unused live "thinking" stream (the chronicle shows a compact indicator instead); kept restyled for reuse. */
export default function StreamingFeed() {
  const streaming = useVillageStore((s) => s.streaming);
  const selectAgent = useVillageStore((s) => s.selectAgent);
  const entries = Object.values(streaming);

  if (entries.length === 0) return null;

  return (
    <div className="stream" aria-live="polite">
      {entries.map((entry) => (
        <button key={entry.agent} type="button" className="stream-i" onClick={() => selectAgent(entry.agent)}>
          <span className="h">
            <span className="dot think-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />
            {AGENT_DISPLAY[entry.agent]}
            <small className="muted">denkt nach …</small>
          </span>
          {entry.text && (
            <span className="t">
              {entry.text.length > 200 ? `…${entry.text.slice(-200)}` : entry.text}
              <i className="caret" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
