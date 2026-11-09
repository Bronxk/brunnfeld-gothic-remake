import { useVillageStore, computeEconomy } from "../store";
import { itemLabel } from "../types";
import { ItemIcon } from "./Icon";
import { c } from "../theme";

const STRIP_ITEMS = [
  "gerste", "mehl", "brot", "fleisch", "bauholz", "kohle", "werkzeug", "bier", "leinen", "arznei",
] as const;

export default function EconomyStrip() {
  const world = useVillageStore((s) => s.world);
  const latestEconomy = useVillageStore((s) => s.latestEconomy);

  const prices = world?.marketplace.priceIndex ?? {};
  const history = world?.marketplace.priceHistory ?? {};
  const live = world ? computeEconomy(world) : null;

  return (
    <footer className="strip" aria-label="Preise und Wirtschaftslage">
      {STRIP_ITEMS.map((item) => {
        const price = prices[item] ?? 0;
        const hist = (history[item] ?? []).slice(-3);
        const prev = hist.length >= 2 ? hist[hist.length - 2]?.price : null;
        const dir = prev == null ? null : price > prev ? "up" : price < prev ? "down" : null;
        return (
          <div key={item} className="st" title={`${itemLabel(item)}: ${price > 0 ? `${price} Gr.` : "kein Preis"}`}>
            <ItemIcon item={item} size={18} />
            <b className="mono" style={{ color: c.ink }}>{price > 0 ? price : "—"}</b>
            {dir && <span className={`d ${dir}`} aria-label={dir === "up" ? "steigend" : "fallend"}>{dir === "up" ? "▲" : "▼"}</span>}
          </div>
        );
      })}

      <div className="st-sum">
        <div className="st" title="Summe aller Geldbeutel">
          Vermögen <b className="mono">{live ? `${live.totalWealth} Gr.` : "—"}</b>
        </div>
        <div className="st" title="Gini-Koeffizient: 0 = alle gleich reich, 1 = einer hat alles">
          Gini <b className="mono">{(live?.gini ?? latestEconomy?.giniCoefficient ?? 0).toFixed(2)}</b>
        </div>
        <div className="st" title="Geschäfte seit 06:00">
          Handel heute <b className="mono">{live?.tradesToday ?? 0}</b>
        </div>
        <div className="st" title="Handelsvolumen der letzten 16 Stunden">
          BIP <b className="mono">{latestEconomy?.gdp ?? live?.gdp ?? 0}</b>
        </div>
      </div>
    </footer>
  );
}
