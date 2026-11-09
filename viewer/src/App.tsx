import { useState } from "react";
import { useSSE } from "./hooks/useSSE";
import { useVillageStore } from "./store";
import TimeHUD from "./components/TimeHUD";
import TickerStrip from "./components/TickerStrip";
import VillageMap from "./components/VillageMap";
import RightPanel from "./components/RightPanel";
import ActivityDrawer from "./components/ActivityDrawer";
import EconomyStrip from "./components/EconomyStrip";
import TownHallView from "./components/TownHallView";
import WorldMapView from "./components/WorldMapView";
import ScaleSelector from "./components/ScaleSelector";

export default function App() {
  useSSE();
  const activeMeeting = useVillageStore(s => s.activeMeeting);
  const world = useVillageStore(s => s.world);
  const needsWorldConfig = useVillageStore(s => s.needsWorldConfig);
  const setNeedsWorldConfig = useVillageStore(s => s.setNeedsWorldConfig);
  const [previewTownHall, setPreviewTownHall] = useState(false);

  const showTownHall = !!activeMeeting || previewTownHall;

  return (
    <div style={{
      width: "100vw", height: "100vh",
      display: "flex", flexDirection: "column",
      background: "#0e0904",
      overflow: "hidden",
    }}>
      {/* World config overlay — shown on fresh start, hidden on resume */}
      {needsWorldConfig && <ScaleSelector onWorldGenerated={() => setNeedsWorldConfig(false)} />}

      {/* Top bar */}
      <TimeHUD />

      {/* Scrolling event ticker */}
      <TickerStrip />

      {/* Main content: Map + Right panel */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div style={{ flex: 1, position: "relative", overflow: "hidden", margin: "6px 0 0 6px", display: "flex", flexDirection: "column" }}>
          <WorldMapView agentLocations={world?.agent_locations} />
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {showTownHall ? <TownHallView preview={!activeMeeting} /> : <VillageMap />}

          {/* Vogtei (town hall) preview toggle — bottom-left of map */}
          {!activeMeeting && (
            <button
              onClick={() => setPreviewTownHall(v => !v)}
              style={{
                position: "absolute", bottom: 10, left: 10,
                background: previewTownHall ? "#3d2810" : "rgba(20,14,6,0.82)",
                border: `1px solid ${previewTownHall ? "#a06830" : "#4a3010"}`,
                color: previewTownHall ? "#f0c870" : "#a08050",
                fontFamily: "monospace", fontSize: "11px",
                padding: "5px 10px", borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              🏛 {previewTownHall ? "Back to colony" : "Vogtei"}
            </button>
          )}
          </div>
        </div>

        <RightPanel />
      </div>

      {/* Collapsible scene chronicle */}
      <ActivityDrawer />

      {/* Always-visible economy strip */}
      <EconomyStrip />
    </div>
  );
}
