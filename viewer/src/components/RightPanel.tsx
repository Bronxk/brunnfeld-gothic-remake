import { useState, useEffect } from "react";
import { useVillageStore } from "../store";
import { useIsMobile } from "../theme";
import AgentPanel from "./AgentPanel";
import MarketPanel from "./MarketPanel";
import StockMarketPanel from "./StockMarketPanel";
import RegiePanel from "./RegiePanel";
import { ChronikPane } from "./ActivityDrawer";
import Icon, { type IconName } from "./Icon";

type TabId = "kolonist" | "tausch" | "wirtschaft" | "regie" | "chronik";
type Sheet = "closed" | "half" | "full";

const TABS: { id: TabId; label: string; icon: IconName; mobileOnly?: boolean }[] = [
  { id: "kolonist", label: "Kolonist", icon: "user" },
  { id: "tausch", label: "Tauschbrett", icon: "swap" },
  { id: "wirtschaft", label: "Wirtschaft", icon: "chart" },
  { id: "regie", label: "Regie", icon: "gavel" },
  { id: "chronik", label: "Chronik", icon: "book", mobileOnly: true },
];

const NEXT_SHEET: Record<Sheet, Sheet> = { closed: "half", half: "full", full: "closed" };
const SHEET_LABEL: Record<Sheet, string> = {
  closed: "Seitenleiste öffnen", half: "Seitenleiste vergrößern", full: "Seitenleiste schließen",
};

/**
 * Right-hand panel. Desktop: fixed 348px column with tabs on top.
 * Phone (<720px): bottom sheet under the map, tabs at the bottom, drag-handle cycles closed / half / full.
 */
export default function RightPanel() {
  const [tab, setTab] = useState<TabId>("kolonist");
  const [sheet, setSheet] = useState<Sheet>("half");
  const isMobile = useIsMobile();
  const selectedAgent = useVillageStore((s) => s.selectedAgent);
  const selectedAgentVersion = useVillageStore((s) => s.selectedAgentVersion);

  // Selecting a colonist (map click, chronicle name…) jumps to the Kolonist tab, even for a re-click.
  useEffect(() => {
    if (selectedAgent !== null) {
      setTab("kolonist");
      setSheet((s) => (s === "closed" ? "half" : s));
    }
  }, [selectedAgent, selectedAgentVersion]);

  const activeTab: TabId = !isMobile && tab === "chronik" ? "kolonist" : tab;

  const onTab = (id: TabId) => {
    if (isMobile && id === activeTab) {
      setSheet((s) => (s === "closed" ? "half" : "closed"));
      return;
    }
    setTab(id);
    if (sheet === "closed") setSheet("half");
  };

  return (
    <aside className="panel" data-sheet={sheet} aria-label="Seitenleiste">
      <div className="tabs" role="tablist" aria-label="Bereiche">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls="pane"
            className={t.mobileOnly ? "only-mobile" : undefined}
            onClick={() => onTab(t.id)}
          >
            <Icon name={t.icon} />
            <span className="tl">{t.label}</span>
          </button>
        ))}
      </div>

      <button className="sheet-handle only-mobile" aria-label={SHEET_LABEL[sheet]} onClick={() => setSheet(NEXT_SHEET[sheet])}>
        <i />
      </button>

      <div className="panes">
        {/* keyed so every tab switch replays the enter transition */}
        <section key={activeTab} id="pane" className="pane" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
          {activeTab === "kolonist" && <AgentPanel />}
          {activeTab === "tausch" && <MarketPanel />}
          {activeTab === "wirtschaft" && <StockMarketPanel />}
          {activeTab === "regie" && <RegiePanel />}
          {activeTab === "chronik" && <ChronikPane />}
        </section>
      </div>
    </aside>
  );
}
