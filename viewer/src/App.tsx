import { lazy, Suspense, useEffect, useState } from "react";
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
import PlayerHUD from "./components/PlayerHUD";
import CharacterCreation from "./components/CharacterCreation";
import Toasts from "./components/Toasts";

// The 3D view (three.js) is its own chunk, only fetched when somebody switches to 3D.
const ThreeView = lazy(() => import("./three/ThreeView"));

export default function App() {
  useSSE();
  const viewMode = useVillageStore((s) => s.viewMode);
  const [meetingView, setMeetingView] = useState(false);
  const activeMeeting = useVillageStore((s) => s.activeMeeting);
  const world = useVillageStore((s) => s.world);
  const spectating = useVillageStore((s) => s.spectating);
  const creationForced = useVillageStore((s) => s.creationForced);
  const needsWorldConfig = useVillageStore((s) => s.needsWorldConfig);
  const setNeedsWorldConfig = useVillageStore((s) => s.setNeedsWorldConfig);
  const [previewTownHall, setPreviewTownHall] = useState(false);
  const isMobile = useIsMobile();

  const is3d = viewMode === "3d";
  useEffect(() => { if (!activeMeeting) setMeetingView(false); }, [activeMeeting]);
  // In 3D an Appell stays in the 3D scene until the user asks for the Vogtei view.
  const showTownHall = is3d ? previewTownHall || (!!activeMeeting && meetingView) : !!activeMeeting || previewTownHall;
  // Character creation: until a human created a character, unless they chose "Nur zuschauen"
  // (then only the "Mitspielen" button in the top bar reopens it). The world config dialog goes first.
  const showCreation = !!world && world.player?.created !== true && !needsWorldConfig && (!spectating || creationForced);

  return (
    <div className="app">
      {/* World config dialog: shown on fresh start (no ticks yet); can be dismissed and reopened via Ereignisse → Welt */}
      {needsWorldConfig && (
        <ScaleSelector canStartExisting onWorldGenerated={() => setNeedsWorldConfig(false)} onClose={() => setNeedsWorldConfig(false)} />
      )}
      {showCreation && <CharacterCreation />}
      <Toasts />

      <TimeHUD />
      <TickerStrip />

      {/* Main: map (flex) + right panel. On phones the panel becomes a bottom sheet under the map. */}
      <main className="main">
        <section className="mapwrap" aria-label="Karte des Schlackentals">
          <div className="mapfill" style={{ display: "flex", flexDirection: "column" }}>
            {!is3d && <WorldMapView agentLocations={world?.agent_locations} />}
            <div style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
              {showTownHall ? <TownHallView preview={!activeMeeting} /> : is3d ? (
                <Suspense fallback={<div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--ink2)" }}>3D wird geladen …</div>}>
                  <ThreeView onOpenMeeting={() => setMeetingView(true)} />
                </Suspense>
              ) : <VillageMap />}
            </div>
          </div>

          {/* Map tools (top-right): Vogtei preview toggle. In 3D only as the way back from the Vogtei view. */}
          {(is3d ? showTownHall : !activeMeeting) && (
            <div className="map-tools">
              <button className="btn sm" onClick={() => { setPreviewTownHall((v) => (is3d ? false : !v)); if (is3d) setMeetingView(false); }}
                aria-pressed={previewTownHall}
                title={is3d ? "Zurück zur 3D-Ansicht" : previewTownHall ? "Zurück zur Karte der Kolonie" : "Blick in die Vogtei"}>
                <Icon name={previewTownHall || is3d ? "back" : "gavel"} />
                {is3d ? "Zurück zu 3D" : previewTownHall ? "Zurück zur Kolonie" : "Vogtei"}
              </button>
            </div>
          )}

          {/*
            Player HUD slot (bottom-left of the map): the human player's card (desktop) or compact bar (phone).
            .hud-slot-root is absolutely positioned and lets pointer events through except on its children.
          */}
          <div className="hud-slot-root" id="player-hud-slot">
            <PlayerHUD />
          </div>
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
