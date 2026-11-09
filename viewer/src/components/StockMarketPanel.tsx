import { useVillageStore, computeEconomy, colonistIds, playerVisible, AGENT_DISPLAY } from "../store";
import { gr, itemLabel } from "../types";
import { c } from "../theme";
import Icon from "./Icon";
import { LineChart } from "./Charts";

function Trend({ title, value, data, color, hint }: { title: string; value: string; data: number[]; color: string; hint?: string }) {
  return (
    <div className="sec">
      <div className="sec-h"><span>{title}</span><b style={{ color, fontSize: 15, letterSpacing: 0, textTransform: "none" }} className="mono">{value}</b></div>
      <div className="card" style={{ padding: "8px 10px" }}>
        {data.length >= 2
          ? <LineChart data={data} color={color} label={`${title}: Verlauf`} />
          : <span className="muted">Sammle Verlauf … (erste Messung nach dem nächsten Tag)</span>}
        {hint && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{hint}</div>}
      </div>
    </div>
  );
}

/** "Wirtschaft" tab: wealth, trade volume, inequality and who owns what. */
export default function StockMarketPanel() {
  const world = useVillageStore((s) => s.world);
  const latestEconomy = useVillageStore((s) => s.latestEconomy);

  if (!world) {
    return <div className="empty"><Icon name="hourglass" /><span>Wirtschaftsdaten werden geladen …</span></div>;
  }

  const live = computeEconomy(world);
  const snapshots = (world.economy_snapshots ?? []).slice(-100);
  const giniColor = live.gini > 0.5 ? c.bad : live.gini > 0.35 ? c.warn : c.good;

  // Distribution: prefer the latest snapshot (includes inventory value), fall back to live wallets.
  const dist = (latestEconomy?.wealthDistribution
    ?? colonistIds(world).map((agent) => ({ agent, wallet: world.economics[agent]!.wallet, inventoryValue: 0 })))
    .filter((e) => e.agent !== "player" || playerVisible(world))
    .map((e) => ({ ...e, total: e.wallet + e.inventoryValue }))
    .sort((a, b) => b.total - a.total);
  const maxTotal = dist.reduce((m, e) => Math.max(m, e.total), 1);
  const scarcity = latestEconomy?.scarcityAlerts ?? [];

  return (
    <div>
      <div className="kpis">
        <div className="kpi" title="Summe aller Geldbeutel"><span>Vermögen</span><b className="mono" style={{ color: c.accent }}>{live.totalWealth}</b><small>Groschen</small></div>
        <div className="kpi" title="Handelsvolumen der letzten 16 Stunden"><span>BIP</span><b className="mono" style={{ color: c.info }}>{latestEconomy?.gdp ?? live.gdp}</b><small>pro Tag</small></div>
        <div className="kpi" title="0 = alle gleich reich, 1 = einer hat alles"><span>Gini</span><b className="mono" style={{ color: giniColor }}>{live.gini.toFixed(2)}</b><small>{live.gini > 0.5 ? "sehr ungleich" : live.gini > 0.35 ? "ungleich" : "ausgeglichen"}</small></div>
      </div>

      {scarcity.length > 0 && (
        <div className="sec">
          <div className="sec-h"><span>Knappheit</span></div>
          <div className="chips">
            {scarcity.map((i) => <span key={i} className="chipx warn"><Icon name="warn" />{itemLabel(i)}</span>)}
          </div>
        </div>
      )}

      <Trend title="Vermögen" value={gr(live.totalWealth)} data={snapshots.map((s) => s.totalWealth)} color={c.accent} />
      <Trend title="BIP (letzter Tag)" value={gr(latestEconomy?.gdp ?? live.gdp)} data={snapshots.map((s) => s.gdp)} color={c.info} />
      <Trend title="Gini" value={live.gini.toFixed(2)} data={snapshots.map((s) => s.giniCoefficient)} color={giniColor} hint="Niedriger heißt gleichmäßiger verteilt." />

      <div className="sec">
        <div className="sec-h"><span>Vermögensverteilung</span><small>Geld + Waren</small></div>
        {dist.map((e) => (
          <div key={e.agent} className="wb" title={`${AGENT_DISPLAY[e.agent]}: ${gr(e.wallet)} Geld, ${gr(e.inventoryValue)} Waren`}>
            <span className="n">{AGENT_DISPLAY[e.agent]}</span>
            <span className="t"><b style={{ ["--p" as string]: `${(e.total / maxTotal) * 100}%` }} /></span>
            <span className="v mono">{e.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
