import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { FeedEntry } from "../types";
import Icon, { type IconName } from "./Icon";

const TICKER_TYPES: FeedEntry["type"][] = ["speak", "trade", "move", "production", "system"];

const TYPE_ICON: Record<string, IconName> = {
  speak: "speech", trade: "swap", move: "feet", production: "hammer", system: "bell",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Items({ entries }: { entries: FeedEntry[] }) {
  return (
    <>
      {entries.map((e) => {
        const name = AGENT_DISPLAY[e.agent]?.split(" ")[0] ?? e.agent;
        return (
          <span key={e.id} className="tk">
            <Icon name={TYPE_ICON[e.type] ?? "bell"} />
            {e.type === "speak" ? (
              <span><b>{name}</b>: „{clip(e.text, 60)}“</span>
            ) : (
              <span>{clip(e.text, 80)}</span>
            )}
          </span>
        );
      })}
    </>
  );
}

export default function TickerStrip() {
  const feed = useVillageStore((s) => s.feed);
  const entries = feed.filter((e) => TICKER_TYPES.includes(e.type)).slice(0, 24);

  // ~7 chars/second reading-friendly scroll speed
  const chars = entries.reduce((n, e) => n + Math.min(e.text.length, 80) + 12, 0);
  const duration = Math.max(30, Math.round(chars / 6.5));

  return (
    <div className="ticker" role="marquee" aria-label="Aushang: neueste Ereignisse">
      <span className="ticker-tag">Aushang</span>
      {entries.length === 0 ? (
        <span className="ticker-idle">Noch nichts los im Tal …</span>
      ) : (
        <div className="ticker-view">
          {/* keyed by newest entry so the scroll restarts smoothly when news arrives */}
          <div key={entries[0]!.id} className="ticker-track" style={{ ["--dur" as string]: `${duration}s` }}>
            <Items entries={entries} />
            <Items entries={entries} />
          </div>
        </div>
      )}
    </div>
  );
}
