import { useVillageStore } from "../store";
import { LABEL_FONT } from "../canvas/sprites";

interface Props {
  agentLocations?: Record<string, string>;
}

export default function WorldMapView({ agentLocations }: Props) {
  const villages = useVillageStore((s) => s.villages);
  const activeVillageId = useVillageStore((s) => s.activeVillageId);
  const setActiveVillageId = useVillageStore((s) => s.setActiveVillageId);

  if (villages.length <= 1) return null;

  // Count agents per village from live locations
  const agentCounts: Record<string, number> = {};
  if (agentLocations) {
    for (const [, loc] of Object.entries(agentLocations)) {
      for (const v of villages) {
        if (v.id === "schlackental" && !loc.includes(":")) {
          agentCounts[v.id] = (agentCounts[v.id] ?? 0) + 1;
          break;
        }
        if (v.id !== "schlackental" && loc.startsWith(`${v.name}:`)) {
          agentCounts[v.id] = (agentCounts[v.id] ?? 0) + 1;
          break;
        }
      }
    }
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "4px 10px", flexShrink: 0,
      background: "#0c0a09",
      borderBottom: "1px solid #3a2e21",
      overflowX: "auto",
      fontFamily: LABEL_FONT,
    }}>
      <span style={{ fontSize: 11, color: "#6f6249", letterSpacing: 1.4, marginRight: 2, flexShrink: 0 }}>
        WELT
      </span>
      {villages.map((v, i) => {
        const isActive = v.id === activeVillageId;
        const count = agentCounts[v.id] ?? v.agentCount;
        return (
          <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {i > 0 && (
              <span style={{ color: "#52422e", fontSize: 11 }}>›</span>
            )}
            <button
              onClick={() => setActiveVillageId(v.id)}
              style={{
                padding: "2px 11px",
                borderRadius: 10,
                background: isActive ? "rgba(242,169,59,0.14)" : "rgba(27,22,18,0.8)",
                border: `1px solid ${isActive ? "rgba(242,169,59,0.55)" : "#3a2e21"}`,
                color: isActive ? "#f2a93b" : "#a2916f",
                fontSize: 12,
                fontFamily: LABEL_FONT,
                fontWeight: 600,
                cursor: isActive ? "default" : "pointer",
                letterSpacing: 0.3,
                whiteSpace: "nowrap",
                transition: "all 0.15s",
              }}
            >
              {v.name}
              <span style={{ marginLeft: 5, opacity: 0.7, fontSize: 10 }}>
                {count}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
