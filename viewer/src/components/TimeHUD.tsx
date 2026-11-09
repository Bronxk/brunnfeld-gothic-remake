import { useVillageStore, colonistIds } from "../store";
import { SEASON_LABELS, EVENT_LABELS, DAYS_PER_SEASON } from "../types";
import Icon from "./Icon";

export default function TimeHUD() {
  const world = useVillageStore((s) => s.world);
  const connected = useVillageStore((s) => s.connected);
  const openCreation = useVillageStore((s) => s.openCreation);

  const tick = world?.current_tick ?? 0;
  const season = world?.season ? SEASON_LABELS[world.season] : "";
  // current_time arrives as "Montag, 09:00" (German, from the backend); tick 0 is a status text.
  const timeText = world?.current_time?.replace(/,\s*/, " ") ?? "—";
  const clock = tick > 0 ? `${season}, ${timeText} · Tag ${world?.day_of_season ?? 1}/${DAYS_PER_SEASON}` : timeText;
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
        <span>{clock}</span>
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

      {world && world.player?.created !== true && (
        <button type="button" className="btn sm tb-play" onClick={openCreation} title="Eine eigene Figur ins Schlackental schicken">
          <Icon name="flag" />Mitspielen
        </button>
      )}

      <div className="tb-item tb-pop">
        <Icon name="user" />
        <span>{colonists} Kolonisten</span>
      </div>

      <div className={`tb-live${connected ? "" : " off"}`} title={connected ? "Verbunden mit der Simulation" : "Keine Verbindung zum Server"}>
        <i />
        {connected ? "live" : "offline"}
      </div>
    </header>
  );
}
