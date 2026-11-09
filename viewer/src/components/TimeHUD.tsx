import { useState } from "react";
import { useVillageStore, colonistIds } from "../store";
import { SEASON_LABELS, EVENT_LABELS, DAYS_PER_SEASON } from "../types";
import Icon from "./Icon";
import { SimGlyph } from "./RegiePanel";

export default function TimeHUD() {
  const world = useVillageStore((s) => s.world);
  const connected = useVillageStore((s) => s.connected);
  const openCreation = useVillageStore((s) => s.openCreation);
  const viewMode = useVillageStore((s) => s.viewMode);
  const setViewMode = useVillageStore((s) => s.setViewMode);
  const sim = useVillageStore((s) => s.sim);
  const simCommand = useVillageStore((s) => s.simCommand);
  const [ppBusy, setPpBusy] = useState(false);

  const tick = world?.current_tick ?? 0;
  const season = world?.season ? SEASON_LABELS[world.season] : "";
  // current_time arrives as "Montag, 09:00" (German, from the backend); tick 0 is a status text.
  const timeText = world?.current_time?.replace(/,\s*/, " ") ?? "—";
  const clock = tick > 0 ? `${season}, ${timeText}` : timeText;
  const dayText = tick > 0 ? ` · Tag ${world?.day_of_season ?? 1}/${DAYS_PER_SEASON}` : "";
  const paused = sim?.paused ?? false;

  async function togglePause() {
    setPpBusy(true);
    try {
      await simCommand(paused ? "resume" : "pause");
    } finally {
      setPpBusy(false);
    }
  }
  const colonists = world ? colonistIds(world).length : 0;

  return (
    <header className="topbar">
      <div className="logo" aria-label="Schlackental">
        <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M3 27 12 9l5 8 4-6 8 16z" fill="currentColor" opacity=".9" />
          <circle cx="23" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="logo-text">Schlackental</span>
      </div>

      <div className="tb-item tb-time" title="Spielzeit">
        <Icon name="clock" />
        <span>{clock}<span className="tb-day">{dayText}</span></span>
      </div>

      <div className="tb-item tb-weather" title="Wetter">
        <Icon name="cloud" />
        <span>{world?.weather ?? "—"}</span>
      </div>

      <div className="tb-item tb-tick" title="Simulationsschritt (1 Tick = 1 Stunde)">
        <span className="tb-lbl">Tick</span>
        <span key={tick} className="mono tick-flash">{tick}</span>
      </div>

      {world?.active_events?.length ? (
        <div className="tb-events" aria-label="Aktive Ereignisse">
          {world.active_events.map((ev, i) => (
            <span key={`${ev.type}-${i}`} className="chipx warn" title={ev.description}>
              <Icon name="warn" />
              {EVENT_LABELS[ev.type] ?? ev.type}
            </span>
          ))}
        </div>
      ) : null}

      <div className="tb-spacer" />

      <div className="tb-view" role="group" aria-label="Ansicht">
        {(["2d", "3d"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={viewMode === m} onClick={() => setViewMode(m)}
            title={m === "2d" ? "Klassische 2D-Karte" : "3D-Ansicht der Kolonie"}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      {world && world.player?.created !== true && (
        <button type="button" className="btn sm tb-play" onClick={openCreation} title="Eine eigene Figur ins Schlackental schicken">
          <Icon name="flag" /><span className="tb-play-l">Mitspielen</span>
        </button>
      )}

      <div className="tb-item tb-pop">
        <Icon name="user" />
        <span>{colonists} Kolonisten</span>
      </div>

      <button
        type="button"
        className="iconbtn tb-pp"
        data-paused={paused}
        disabled={!sim || ppBusy}
        onClick={() => void togglePause()}
        aria-label={paused ? "Simulation fortsetzen" : "Simulation pausieren"}
        title={!sim ? "Sim-Steuerung nicht erreichbar" : sim.awaitingStart ? "Bereit – klicken zum Starten" : paused ? `Pausiert${sim.pausedReason ? `: ${sim.pausedReason}` : ""} – klicken zum Fortsetzen` : "Läuft – klicken zum Pausieren"}
      >
        <SimGlyph kind={paused ? "play" : "pause"} />
      </button>

      <div className={`tb-live${connected ? "" : " off"}`} title={connected ? "Verbunden mit der Simulation" : "Keine Verbindung zum Server"}>
        <i />
        {connected ? "live" : "offline"}
      </div>
    </header>
  );
}
