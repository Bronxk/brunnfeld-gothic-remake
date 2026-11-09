import { useRef, useEffect } from "react";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import { tickClock, type FeedEntry } from "../types";
import Icon, { type IconName } from "./Icon";

/** Unused full-height feed (the chronicle in SceneChronicle replaced it); kept restyled for reuse. */
const ENTRY_ICON: Record<FeedEntry["type"], IconName> = {
  speak: "speech",
  do: "hammer",
  move: "feet",
  trade: "swap",
  production: "hammer",
  thought: "brain",
  system: "bell",
};

function FeedRow({ entry, onClick }: { entry: FeedEntry; onClick: () => void }) {
  return (
    <button type="button" className="ent" onClick={onClick}>
      <time>{tickClock(entry.tick)}</time>
      <span className="bd"><Icon name={ENTRY_ICON[entry.type]} /></span>
      <span className="tx">
        <b>{AGENT_DISPLAY[entry.agent]}</b>
        {entry.location ? <span className="muted"> · {entry.location}</span> : null}
        {": "}
        {entry.type === "speak" ? `„${entry.text}“` : entry.text}
      </span>
    </button>
  );
}

export default function ActionFeed() {
  const mode = useVillageStore((s) => s.mode);
  const liveFeed = useVillageStore((s) => s.feed);
  const historyFeed = useVillageStore((s) => s.historyFeed);
  const historyLoading = useVillageStore((s) => s.historyLoading);
  const selectAgent = useVillageStore((s) => s.selectAgent);

  const feed = mode === "history" ? historyFeed : liveFeed;
  const listRef = useRef<HTMLDivElement>(null);
  const newestId = liveFeed[0]?.id ?? null;

  useEffect(() => {
    if (mode === "live" && listRef.current) listRef.current.scrollTop = 0;
  }, [mode, newestId]);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: 0 }}>
      <div className="sec-h" style={{ padding: "8px 12px", margin: 0 }}>
        <span>{mode === "history" ? "Chronik (Rückblick)" : "Chronik des Tals"}</span>
        <small>{historyLoading ? "lädt …" : feed.length}</small>
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: "auto" }}>
        {historyLoading && <div className="empty"><Icon name="hourglass" /><span>Lade Stunde …</span></div>}
        {!historyLoading && feed.map((entry) => (
          <FeedRow key={entry.id} entry={entry} onClick={() => selectAgent(entry.agent)} />
        ))}
        {!historyLoading && feed.length === 0 && (
          <div className="empty">
            <Icon name="list" />
            <span>{mode === "live" ? "Noch nichts los im Tal …" : "Keine Einträge für diese Stunde."}</span>
          </div>
        )}
      </div>
    </div>
  );
}
