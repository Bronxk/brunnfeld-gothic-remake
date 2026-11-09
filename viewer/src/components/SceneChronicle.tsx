import { useEffect, useRef, useState } from "react";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import { tickClock, type FeedEntry } from "../types";
import Icon, { type IconName } from "./Icon";

// ─── Categories ──────────────────────────────────────────────────────────────

export type ChronicleFilter = "all" | "trade" | "work" | "talk" | "council";

export const CHRONICLE_FILTERS: { key: ChronicleFilter; label: string; title: string }[] = [
  { key: "all", label: "Alle", title: "Alles anzeigen" },
  { key: "trade", label: "Handel", title: "Käufe und Verkäufe" },
  { key: "work", label: "Arbeit", title: "Arbeit, Herstellung und Wege" },
  { key: "talk", label: "Reden", title: "Gespräche" },
  { key: "council", label: "Rat", title: "Appell und Ereignisse im Tal" },
];

type Category = Exclude<ChronicleFilter, "all">;

/** Maps a feed entry onto a chip category. Thoughts are not part of the chronicle (see Kolonist tab). */
export function categoryOf(entry: FeedEntry): Category | null {
  switch (entry.type) {
    case "trade": return "trade";
    case "production":
    case "do":
    case "move": return "work";
    case "speak": return entry.council ? "council" : "talk";
    case "system": return "council";
    default: return null;
  }
}

const CAT_ICON: Record<Category, IconName> = {
  trade: "swap", work: "hammer", talk: "speech", council: "gavel",
};

// ─── Filter chips ────────────────────────────────────────────────────────────

export function ChronicleChips({ filter, onChange }: { filter: ChronicleFilter; onChange: (f: ChronicleFilter) => void }) {
  return (
    <div className="chips" role="group" aria-label="Chronik filtern">
      {CHRONICLE_FILTERS.map((f) => (
        <button key={f.key} className="chip" aria-pressed={filter === f.key} title={f.title} onClick={() => onChange(f.key)}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

// ─── List ────────────────────────────────────────────────────────────────────

/** Many backend results already start with the actor ("Ansgar isst …"); the row prefixes the name itself. */
function withoutLeadingName(text: string, fullName: string, shortName: string): string {
  for (const n of [fullName, shortName]) {
    if (n && text.startsWith(`${n} `)) return text.slice(n.length + 1);
  }
  return text;
}

function Entry({ entry, fresh: freshProp, onSelect }: { entry: FeedEntry; fresh: boolean; onSelect: (a: string) => void }) {
  const [fresh] = useState(freshProp); // decided once, so re-renders never cancel the enter animation
  const cat = categoryOf(entry)!;
  const name = AGENT_DISPLAY[entry.agent]?.split(" ")[0] ?? entry.agent;
  const nameBtn = (
    <button className="linkish" onClick={() => onSelect(entry.agent)} title={`${AGENT_DISPLAY[entry.agent]} ansehen`}>{name}</button>
  );
  // trade / production / move / system texts already name the actors; speech and actions get the speaker prefixed.
  let body: React.ReactNode;
  if (entry.type === "speak") body = <>{nameBtn}: „{entry.text}“</>;
  else if (entry.type === "do") body = <>{nameBtn} {withoutLeadingName(entry.text, AGENT_DISPLAY[entry.agent] ?? entry.agent, name)}</>;
  else body = entry.text;

  return (
    <li className={`ent${fresh ? " enter" : ""}`} data-t={cat} title={entry.location ? `${entry.location}` : undefined}>
      <time>{tickClock(entry.tick)}</time>
      <span className="bd"><Icon name={entry.type === "move" ? "feet" : CAT_ICON[cat]} /></span>
      <span className="tx">{body}</span>
    </li>
  );
}

export default function ChronicleList({ filter, className = "" }: { filter: ChronicleFilter; className?: string }) {
  const liveFeed = useVillageStore((s) => s.feed);
  const historyFeed = useVillageStore((s) => s.historyFeed);
  const historyLoading = useVillageStore((s) => s.historyLoading);
  const mode = useVillageStore((s) => s.mode);
  const selectAgent = useVillageStore((s) => s.selectAgent);

  // Only genuinely new live entries animate in; bulk loads (history, first paint) don't.
  const seenMax = useRef(-1);
  const raw = mode === "history" ? historyFeed : liveFeed;
  const prevMax = seenMax.current;
  const newCount = raw.filter((e) => e.id > prevMax).length;
  useEffect(() => {
    seenMax.current = raw.reduce((m, e) => Math.max(m, e.id), seenMax.current);
  });

  const feed = raw
    .filter((e) => {
      const cat = categoryOf(e);
      return cat !== null && (filter === "all" || cat === filter);
    })
    .slice(0, 80);

  if (historyLoading) {
    return <div className="chron-empty">Lade Tick …</div>;
  }
  if (feed.length === 0) {
    return (
      <div className="chron-empty">
        {mode === "live"
          ? filter === "all" ? "Noch nichts passiert. Die Chronik füllt sich, sobald die Kolonisten handeln." : "Dazu gibt es noch keine Einträge."
          : "Keine Einträge für diesen Tick."}
      </div>
    );
  }
  return (
    <ol className={`chron-list ${className}`.trim()} aria-live="polite" aria-label="Chronik">
      {feed.map((e) => (
        <Entry key={e.id} entry={e} fresh={mode === "live" && newCount <= 3 && e.id > prevMax} onSelect={selectAgent} />
      ))}
    </ol>
  );
}
