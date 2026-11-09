import { useState } from "react";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import { agentColor } from "../theme";
import ChronicleList, { ChronicleChips, type ChronicleFilter } from "./SceneChronicle";
import Icon from "./Icon";

/** "N Kolonisten denken nach …" indicator for agents currently streaming an answer. */
function Thinking() {
  const streaming = useVillageStore((s) => s.streaming);
  const entries = Object.values(streaming);
  if (entries.length === 0) return null;
  const label = entries.length === 1
    ? `${AGENT_DISPLAY[entries[0]!.agent].split(" ")[0]} denkt nach …`
    : `${entries.length} Kolonisten denken nach …`;
  return (
    <div className="think" title={entries.map((e) => `${AGENT_DISPLAY[e.agent]}: …${e.text.slice(-40)}`).join("\n")}>
      {entries.slice(0, 6).map((e) => (
        <span key={e.agent} className="dot" style={{ background: agentColor(e.agent), boxShadow: `0 0 5px ${agentColor(e.agent)}` }} />
      ))}
      <span>{label}</span>
    </div>
  );
}

function useChronicleTitle(): string {
  const mode = useVillageStore((s) => s.mode);
  const historyTickId = useVillageStore((s) => s.historyTickId);
  return mode === "history" && historyTickId
    ? `Chronik · Tick ${parseInt(historyTickId.replace("tick_", ""), 10)}`
    : "Chronik";
}

/** Desktop: collapsible chronicle strip below the map. */
export default function ActivityDrawer() {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<ChronicleFilter>("all");
  const title = useChronicleTitle();

  return (
    <section className="chronicle" data-open={open} aria-label="Chronik">
      <div className="chron-head">
        <button className="chron-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={open ? "Chronik einklappen" : "Chronik ausklappen"}>
          <Icon name="book" />
          <span>{title}</span>
          <Icon name="chev" className="chev" />
        </button>
        {open && <ChronicleChips filter={filter} onChange={setFilter} />}
        <Thinking />
      </div>
      {open && <ChronicleList filter={filter} />}
    </section>
  );
}

/** Phone: the chronicle lives in the bottom-sheet as its own tab (no collapse toggle). */
export function ChronikPane() {
  const [filter, setFilter] = useState<ChronicleFilter>("all");
  const title = useChronicleTitle();
  return (
    <div>
      <div className="sec-h"><span>{title}</span><Thinking /></div>
      <div style={{ marginBottom: 8 }}>
        <ChronicleChips filter={filter} onChange={setFilter} />
      </div>
      <ChronicleList filter={filter} className="chron-list-m" />
    </div>
  );
}
