import { Fragment, useState, useEffect, type KeyboardEvent } from "react";
import { useVillageStore, AGENT_DISPLAY, type OrderFeedEntry } from "../store";
import { ALL_ITEM_IDS, gr, itemLabel, type Order } from "../types";
import Icon, { ItemIcon, type IconName } from "./Icon";
import { Sparkline } from "./Charts";

type View = "preise" | "angebote" | "verlauf";

const VIEWS: { id: View; label: string }[] = [
  { id: "preise", label: "Preise" },
  { id: "angebote", label: "Aushang" },
  { id: "verlauf", label: "Verlauf" },
];

const SIDE_LABEL = { sell: "Biete", buy: "Suche" } as const;
const SIDE_CLASS = { sell: "ang", buy: "ges" } as const;

function Side({ side }: { side: "sell" | "buy" | undefined }) {
  if (!side) return <span className="side neutral">—</span>;
  return <span className={`side ${SIDE_CLASS[side]}`}>{SIDE_LABEL[side]}</span>;
}

// ─── Order book of one item (expanded price row) ─────────────────────────────

function OrderBook({ item }: { item: string }) {
  const world = useVillageStore((s) => s.world);
  if (!world) return null;

  const asks = world.marketplace.orders.filter((o) => o.type === "sell" && o.item === item).sort((a, b) => a.price - b.price);
  const bids = world.marketplace.orders.filter((o) => o.type === "buy" && o.item === item).sort((a, b) => b.price - a.price);
  const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : null;
  const history = (world.marketplace.priceHistory[item] ?? []).slice(-50).map((h) => h.price);

  const list = (orders: Order[], empty: string) =>
    orders.length === 0 ? <p>{empty}</p> : orders.slice(0, 5).map((o) => (
      <div key={o.id} className="ln">
        <span><b className="pr">{gr(o.price)}</b> · {o.quantity}×</span>
        <span className="muted">{AGENT_DISPLAY[o.agentId]}</span>
      </div>
    ));

  return (
    <>
      <div className="book">
        <div>
          <h4>Angebote (Biete)</h4>
          {list(asks, "Niemand bietet an.")}
        </div>
        <div>
          <h4>Gesuche (Suche)</h4>
          {list(bids, "Niemand sucht.")}
        </div>
      </div>
      <div className="book" style={{ gridTemplateColumns: "1fr", paddingTop: 0 }}>
        <div className="ln" style={{ color: "var(--ink2)" }}>
          <span>{history.length > 1 ? `Verlauf (${history.length} Ticks)` : "Noch kein Verlauf"}</span>
          {spread != null && <span>Spanne: {gr(spread)}</span>}
        </div>
        {history.length > 1 && (
          <>
            <Sparkline data={history} width={280} height={40} />
            <div className="ln" style={{ color: "var(--ink2)" }}>
              <span>Min <b className="down">{gr(Math.min(...history))}</b></span>
              <span>Max <b className="up">{gr(Math.max(...history))}</b></span>
              <span>Jetzt <b className="pr">{gr(history[history.length - 1]!)}</b></span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Price table ─────────────────────────────────────────────────────────────

function PriceTable() {
  const world = useVillageStore((s) => s.world);
  const priceFlashes = useVillageStore((s) => s.priceFlashes);
  const [open, setOpen] = useState<string | null>(null);
  if (!world) return null;

  const prices = world.marketplace.priceIndex;
  const onKey = (e: KeyboardEvent, item: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => (o === item ? null : item));
    }
  };

  return (
    <table className="ledger">
      <thead>
        <tr><th>Ware</th><th className="r">Preis</th><th>Verlauf</th><th className="r">Trend</th></tr>
      </thead>
      <tbody>
        {ALL_ITEM_IDS.map((item) => {
          const price = prices[item] ?? 0;
          const data = (world.marketplace.priceHistory[item] ?? []).slice(-20).map((h) => h.price);
          const prev = data.length >= 2 ? data[data.length - 2]! : null;
          const dir = prev == null ? "flat" : price > prev ? "up" : price < prev ? "down" : "flat";
          const flash = priceFlashes[item];
          const isOpen = open === item;
          return (
            <Fragment key={item}>
              <tr
                key={flash ? flash.at : 0}
                className={`prow${isOpen ? " open" : ""}${flash && Date.now() - flash.at < 1400 ? " flash" : ""}`}
                tabIndex={0}
                aria-expanded={isOpen}
                title={isOpen ? "Einklappen" : "Aushänge und Verlauf anzeigen"}
                onClick={() => setOpen(isOpen ? null : item)}
                onKeyDown={(e) => onKey(e, item)}
              >
                <td><span className="it"><ItemIcon item={item} size={20} />{itemLabel(item)}</span></td>
                <td className="r pr mono">{price > 0 ? gr(price) : "—"}</td>
                <td><Sparkline data={data} width={56} height={18} color={dir === "up" ? "var(--bad)" : dir === "down" ? "var(--good)" : undefined} /></td>
                <td className={`r ${dir}`}>{dir === "up" ? "▲" : dir === "down" ? "▼" : "–"}</td>
              </tr>
              {isOpen && (
                <tr><td colSpan={4} style={{ padding: 0, background: "var(--panel2)" }}><OrderBook item={item} /></td></tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Open orders ("Aushang") ─────────────────────────────────────────────────

function OpenOrders() {
  const world = useVillageStore((s) => s.world);
  const [side, setSide] = useState<"all" | "sell" | "buy">("all");
  if (!world) return null;

  const orders = world.marketplace.orders
    .filter((o) => side === "all" || o.type === side)
    .slice()
    .sort((a, b) => itemLabel(a.item).localeCompare(itemLabel(b.item), "de") || a.price - b.price);

  return (
    <>
      <div className="seg" role="group" aria-label="Aushang filtern">
        {([["all", "Alle"], ["sell", "Biete"], ["buy", "Suche"]] as const).map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={side === k} onClick={() => setSide(k)}>{l}</button>
        ))}
      </div>
      {orders.length === 0 ? (
        <div className="empty"><Icon name="list" /><span>Am Tauschbrett hängt nichts.</span><small>Neue Angebote erscheinen hier.</small></div>
      ) : (
        <table className="ledger">
          <thead><tr><th>Art</th><th>Ware</th><th className="r">Menge</th><th className="r">Preis</th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} title={`${AGENT_DISPLAY[o.agentId]} · läuft ab in ${Math.max(0, o.expiresAtTick - world.current_tick)} Stunden`}>
                <td><Side side={o.type} /></td>
                <td><span className="it"><ItemIcon item={o.item} size={20} />{itemLabel(o.item)}</span><div className="muted" style={{ fontSize: 12 }}>{AGENT_DISPLAY[o.agentId]}</div></td>
                <td className="r mono">{o.quantity}×</td>
                <td className="r pr mono">{gr(o.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ─── Activity ("Verlauf") ────────────────────────────────────────────────────

const KIND_ICON: Record<OrderFeedEntry["kind"], IconName> = {
  posted: "list", filled: "swap", cancelled: "x", expired: "hourglass",
};

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  return `vor ${Math.round(s / 3600)} h`;
}

function Activity() {
  const orderFeed = useVillageStore((s) => s.orderFeed);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (orderFeed.length === 0) {
    return <div className="empty"><Icon name="swap" /><span>Noch keine Geschäfte.</span><small>Sobald am Tauschbrett gehandelt wird, steht es hier.</small></div>;
  }
  return (
    <ul className="fills" aria-live="polite">
      {orderFeed.slice(0, 60).map((e) => (
        <li key={e.id} className={`fill ${e.kind}`}>
          <Icon name={KIND_ICON[e.kind]} />
          <span className="tx">
            {e.kind === "posted" && <><Side side={e.side} /> {e.quantity}× {itemLabel(e.item)} für {gr(e.price ?? 0)} · {AGENT_DISPLAY[e.agent]}</>}
            {e.kind === "filled" && <>{e.quantity}× {itemLabel(e.item)} für {gr(e.price ?? 0)} · {AGENT_DISPLAY[e.agent]} von {AGENT_DISPLAY[e.counterAgent ?? ""]}</>}
            {e.kind === "cancelled" && <>Zurückgezogen: {e.quantity}× {itemLabel(e.item)} · {AGENT_DISPLAY[e.agent]}</>}
            {e.kind === "expired" && <>Abgelaufen: {e.quantity}× {itemLabel(e.item)} · {AGENT_DISPLAY[e.agent]}</>}
          </span>
          <time>{ago(e.at, now)}</time>
        </li>
      ))}
    </ul>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function MarketPanel() {
  const world = useVillageStore((s) => s.world);
  const [view, setView] = useState<View>("preise");

  if (!world) {
    return <div className="empty"><Icon name="hourglass" /><span>Tauschbrett wird geladen …</span></div>;
  }
  const orderCount = world.marketplace.orders.length;

  return (
    <div>
      <div className="sec-h">
        <span>Tauschbrett</span>
        <small>{orderCount} {orderCount === 1 ? "Aushang" : "Aushänge"} · Zechenplatz</small>
      </div>
      <div className="seg" role="group" aria-label="Ansicht">
        {VIEWS.map((v) => (
          <button key={v.id} className="chip" aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
        ))}
      </div>
      {view === "preise" && <PriceTable />}
      {view === "angebote" && <OpenOrders />}
      {view === "verlauf" && <Activity />}
    </div>
  );
}
