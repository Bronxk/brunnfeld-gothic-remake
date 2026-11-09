import { useState } from "react";
import { useSSE } from "./hooks/useSSE";
import { useVillageStore } from "./store";
import { useIsMobile } from "./theme";
import TimeHUD from "./components/TimeHUD";
import TickerStrip from "./components/TickerStrip";
import VillageMap from "./components/VillageMap";
import RightPanel from "./components/RightPanel";
import ActivityDrawer from "./components/ActivityDrawer";
import EconomyStrip from "./components/EconomyStrip";
import TownHallView from "./components/TownHallView";
import WorldMapView from "./components/WorldMapView";
import ScaleSelector from "./components/ScaleSelector";
import Icon from "./components/Icon";

export default function App() {
  useSSE();
  const activeMeeting = useVillageStore((s) => s.activeMeeting);
  const world = useVillageStore((s) => s.world);
  const needsWorldConfig = useVillageStore((s) => s.needsWorldConfig);
  const setNeedsWorldConfig = useVillageStore((s) => s.setNeedsWorldConfig);
  const [previewTownHall, setPreviewTownHall] = useState(false);
  const isMobile = useIsMobile();

  const showTownHall = !!activeMeeting || previewTownHall;

  return (
    <div className="app">
      {/* World config dialog: shown on fresh start (no ticks yet); can be dismissed and reopened via Ereignisse → Welt */}
      {needsWorldConfig && (
        <ScaleSelector onWorldGenerated={() => setNeedsWorldConfig(false)} onClose={() => setNeedsWorldConfig(false)} />
      )}

      <TimeHUD />
      <TickerStrip />

      {/* Main: map (flex) + right panel. On phones the panel becomes a bottom sheet under the map. */}
      <main className="main">
        <section className="mapwrap" aria-label="Karte des Schlackentals">
          <div className="mapfill" style={{ display: "flex", flexDirection: "column" }}>
            <WorldMapView agentLocations={world?.agent_locations} />
            <div style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
              {showTownHall ? <TownHallView preview={!activeMeeting} /> : <VillageMap />}
            </div>
          </div>

          {/* Map tools (top-right): Vogtei preview toggle. */}
          {!activeMeeting && (
            <div className="map-tools">
              <button className="btn sm" onClick={() => setPreviewTownHall((v) => !v)} aria-pressed={previewTownHall}
                title={previewTownHall ? "Zurück zur Karte der Kolonie" : "Blick in die Vogtei"}>
                <Icon name={previewTownHall ? "back" : "gavel"} />
                {previewTownHall ? "Zurück zur Kolonie" : "Vogtei"}
              </button>
            </div>
          )}

          {/*
            Player HUD slot (bottom-left of the map). Intentionally empty: a future <PlayerHud /> component
            ("Du spielst: Der Neue", Hunger/Kraft, inventory, actions Reden/Handeln/Arbeiten/Gehen) mounts here.
            .hud-slot-root is absolutely positioned and lets pointer events through except on its children.
          */}
          <div className="hud-slot-root" id="player-hud-slot" />
        </section>

        <RightPanel />
      </main>

      {/* Chronicle: collapsible strip on desktop; on phones it is a tab in the bottom sheet. */}
      {!isMobile && <ActivityDrawer />}

      {/* Prices + economy, scrolls horizontally inside itself on small screens */}
      <EconomyStrip />
    </div>
  );
}
