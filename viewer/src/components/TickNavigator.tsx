import { useCallback } from "react";
import { useVillageStore } from "../store";
import Icon from "./Icon";

/** Unused history scrubber (live / rückblick); kept restyled for reuse. */
export default function TickNavigator() {
  const mode = useVillageStore((s) => s.mode);
  const setMode = useVillageStore((s) => s.setMode);
  const availableTicks = useVillageStore((s) => s.availableTicks);
  const historyTickId = useVillageStore((s) => s.historyTickId);
  const stepHistory = useVillageStore((s) => s.stepHistory);
  const loadHistoryTick = useVillageStore((s) => s.loadHistoryTick);
  const currentTick = useVillageStore((s) => s.currentTick);
  const historyLoading = useVillageStore((s) => s.historyLoading);
  const world = useVillageStore((s) => s.world);

  const tickCount = availableTicks.length;
  const historyIdx = historyTickId ? availableTicks.indexOf(historyTickId) : -1;
  const isLive = mode === "live";

  const goLive = useCallback(() => setMode("live"), [setMode]);

  const goHistory = useCallback(() => {
    if (availableTicks.length === 0) return;
    const last = availableTicks[availableTicks.length - 1]!;
    loadHistoryTick(last);
    setMode("history");
  }, [availableTicks, loadHistoryTick, setMode]);

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const tickId = availableTicks[parseInt(e.target.value, 10)];
    if (tickId) loadHistoryTick(tickId);
    if (mode !== "history") setMode("history");
  }, [availableTicks, loadHistoryTick, mode, setMode]);

  const displayTick = historyTickId ? parseInt(historyTickId.replace("tick_", ""), 10) : null;

  return (
    <div className="tnav">
      <button className="chip" aria-pressed={isLive} onClick={isLive ? undefined : goLive}>
<Icon name="eye" />Live
      </button>
      <button className="chip" aria-pressed={!isLive} onClick={isLive ? goHistory : undefined} disabled={tickCount === 0}>
        Rückblick
      </button>

      <button className="iconbtn" aria-label="Eine Stunde zurück" onClick={() => stepHistory(-1)} disabled={historyLoading || tickCount === 0}>
        <Icon name="prev" />
      </button>
      {tickCount > 1 && (
        <input
          type="range"
          aria-label="Stunde wählen"
          min={0}
          max={tickCount - 1}
          value={historyIdx >= 0 ? historyIdx : tickCount - 1}
          onChange={handleSlider}
        />
      )}
      <span className="mono" style={{ minWidth: 70, textAlign: "center" }}>
        Tick {!isLive && displayTick != null ? displayTick : currentTick}
        {!isLive && historyTickId && <small className="muted"> /{tickCount}</small>}
      </span>
      <button className="iconbtn" aria-label="Eine Stunde vor" onClick={() => stepHistory(1)} disabled={historyLoading || tickCount === 0}>
        <Icon name="next" />
      </button>

      <span style={{ flex: 1 }} />
      <span className="muted">{world?.current_time ?? ""}</span>
    </div>
  );
}
