import { useId, useMemo, useState } from "react";
import { useVillageStore, AGENT_DISPLAY, colonistIds } from "../store";
import { ITEM_LABELS, itemLabel, gr, type PlayerTool } from "../types";
import { LOCATION_TILES, ADJACENCY } from "../canvas/map";
import Icon, { ItemIcon, type IconName } from "./Icon";

type ActionId = "speak" | "move" | "work" | "eat" | "trade" | "more";

/** Tools with their own button/form; everything else lives under "Mehr". */
const DEDICATED_TOOLS = new Set(["speak", "move_to", "produce", "eat", "post_order", "buy_item"]);

/** Food the engine accepts for `eat` (src/body.ts SATIATION), with the hunger each portion removes. */
const FOOD: Record<string, string> = {
  brot: "−2 Hunger", eintopf: "−3 Hunger", fleisch: "−2 Hunger", rueben: "−1 Hunger",
  eier: "−1 Hunger", milch: "−1 Hunger", bier: "nur Durst",
};

const TOOL_LABELS: Record<string, string> = {
  check_inventory: "Inventar prüfen",
  assess_person: "Person einschätzen",
  negotiate: "Tauschangebot machen",
  send_message: "Nachricht schicken",
  give_coin: "Groschen geben",
  steal: "Stehlen",
  cancel_order: "Angebot zurückziehen",
  hire_laborer: "Anheuern",
  quit_job: "Kündigen",
};

const ARG_LABELS: Record<string, string> = {
  item: "Ware", qty: "Menge", quantity: "Menge", price: "Preis", max_price: "Höchstpreis", to: "An",
  text: "Text", amount: "Betrag", agent: "Person", name: "Name", target: "Ziel", order_id: "Angebots-Nr.",
  wage: "Lohn", topic: "Thema", location: "Ort", side: "Art",
};

/** Arg keys that name a person (offer the colonist names as suggestions). */
const PERSON_KEYS = new Set(["to", "agent", "name", "target"]);

const toolLabel = (t: PlayerTool) => TOOL_LABELS[t.name] ?? t.name.replace(/_/g, " ");

/** Reasons shown next to disabled actions. */
const REASON_BUDGET = "Du bist für diese Stunde erschöpft — warte auf die nächste Stunde.";
const REASON_NO_TOOLS = "Einen Moment, die Möglichkeiten laden noch.";

// ─── shared gate: what the backend currently allows ───────────

function useGate() {
  const player = useVillageStore((s) => s.player);
  const tools = useVillageStore((s) => s.playerTools);
  const busy = useVillageStore((s) => s.playerBusy);
  const budgetBlocked = useVillageStore((s) => s.budgetBlocked);
  const playerAction = useVillageStore((s) => s.playerAction);

  const outOfBudget = budgetBlocked || (player?.budgetLeft ?? 0) <= 0;
  const find = (name: string) => tools.find((t) => t.name === name);
  /** null = allowed, otherwise the German reason. `missing` is shown when the backend does not offer the tool. */
  const gate = (name: string, missing: string): string | null => {
    if (tools.length === 0) return REASON_NO_TOOLS;
    const t = find(name);
    if (!t) return missing;
    if (!t.free && outOfBudget) return REASON_BUDGET;
    return null;
  };
  /** Run a tool; resolves true when it worked (the form may close). */
  const run = async (tool: string, args: Record<string, unknown>) => (await playerAction(tool, args)).ok;
  return { player, tools, busy, outOfBudget, find, gate, run };
}

// ─── small building blocks ────────────────────────────────────

function ActBtn(props: {
  icon: IconName; label: string; sub?: string; reason?: string | null; active?: boolean; onClick: () => void;
}) {
  const { icon, label, sub, reason, active, onClick } = props;
  const disabled = !!reason;
  return (
    <button
      type="button"
      className="act"
      disabled={disabled}
      aria-pressed={active}
      title={reason ?? undefined}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="act-l">{label}</span>
      {disabled && sub && <span className="act-s">{sub}</span>}
    </button>
  );
}

function FormShell({ title, icon, onBack, free, children }: { title: string; icon: IconName; onBack: () => void; free?: boolean; children: React.ReactNode }) {
  const { outOfBudget } = useGate();
  const locked = outOfBudget && !free;
  return (
    <div className="hud-form" role="group" aria-label={title}>
      <div className="hud-form-h">
        <button type="button" className="iconbtn" onClick={onBack} aria-label="Zurück zu den Aktionen" title="Zurück">
          <Icon name="back" />
        </button>
        <Icon name={icon} />
        <b>{title}</b>
      </div>
      {locked && <div className="note" role="status"><Icon name="warn" />{REASON_BUDGET}</div>}
      {locked ? <fieldset className="hud-lock" disabled>{children}</fieldset> : children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="fld">
      <span className="fld-l">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** Item dropdown: items from the inventory first, then everything else. */
function ItemSelect({ value, onChange, inventoryFirst = true, allowEmpty = false }: {
  value: string; onChange: (v: string) => void; inventoryFirst?: boolean; allowEmpty?: boolean;
}) {
  const inventory = useVillageStore((s) => s.player?.inventory ?? []);
  const own = inventoryFirst ? inventory.filter((i) => i.quantity > 0).map((i) => i.type) : [];
  const rest = Object.keys(ITEM_LABELS).filter((id) => !own.includes(id));
  return (
    <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">— wählen —</option>}
      {own.length > 0 && (
        <optgroup label="Im Inventar">
          {own.map((id) => <option key={id} value={id}>{itemLabel(id)}</option>)}
        </optgroup>
      )}
      <optgroup label={own.length > 0 ? "Alle Waren" : "Waren"}>
        {rest.map((id) => <option key={id} value={id}>{itemLabel(id)}</option>)}
      </optgroup>
    </select>
  );
}

// ─── Reden ────────────────────────────────────────────────────

function SpeakForm({ onBack }: { onBack: () => void }) {
  const { busy, run } = useGate();
  const [text, setText] = useState("");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (
    <FormShell title="Reden" icon="speech" onBack={onBack}>
      <form
        className="fld-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          if (await run("speak", { text: text.trim() })) { setText(""); onBack(); }
        }}
      >
        <Field label="Was sagst du?" hint={`${words} von 15 Wörtern. Alle hier hören dich.`}>
          <input
            className="inp" value={text} maxLength={200} autoFocus autoComplete="off"
            onChange={(e) => setText(e.target.value)} placeholder="Guten Morgen, wo gibt es Arbeit?"
          />
        </Field>
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
          <Icon name="send" />Sagen
        </button>
      </form>
    </FormShell>
  );
}

// ─── Gehen ────────────────────────────────────────────────────

const bare = (loc: string) => (loc.includes(":") ? loc.split(":").slice(1).join(":") : loc);

function MoveForm({ onBack }: { onBack: () => void }) {
  const { player, busy, run } = useGate();
  const world = useVillageStore((s) => s.world);
  const villages = useVillageStore((s) => s.villages);
  const here = player?.location ?? "";

  const { near, far } = useMemo(() => {
    const village = villages.find((v) => v.locationTiles && here in v.locationTiles);
    const keys = village?.locationTiles ? Object.keys(village.locationTiles) : Object.keys(LOCATION_TILES);
    const neighbours = new Set<string>();
    for (const [a, b] of ADJACENCY) {
      if (a === bare(here)) neighbours.add(b);
      if (b === bare(here)) neighbours.add(a);
    }
    const options = keys.filter((k) => k !== here).map((k) => ({ key: k, name: bare(k), adjacent: neighbours.has(bare(k)) }));
    const byName = (x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name, "de");
    return { near: options.filter((o) => o.adjacent).sort(byName), far: options.filter((o) => !o.adjacent).sort(byName) };
  }, [villages, here]);

  const caravan = world?.active_events.some((e) => e.type === "caravan") ?? false;
  const collapsed = world?.active_events.some((e) => e.type === "mine_collapse") ?? false;
  const blocked = (name: string): string | null =>
    name === "Schmugglerpfad" && !caravan ? "gerade kein Schmugglerzug"
    : name === "Erzstollen" && collapsed ? "eingebrochen" : null;

  const peopleAt = (key: string) =>
    world ? colonistIds(world).filter((a) => world.agent_locations[a] === key && a !== "player").length : 0;

  const row = (o: { key: string; name: string }) => {
    const why = blocked(o.name);
    const n = peopleAt(o.key);
    return (
      <button
        key={o.key} type="button" className="opt" disabled={busy || !!why} title={why ?? `Nach ${o.name} gehen`}
        onClick={async () => { if (await run("move_to", { location: o.key })) onBack(); }}
      >
        <Icon name="pin" />
        <span className="opt-n">{o.name}</span>
        {why ? <small>{why}</small> : n > 0 ? <small><Icon name="users" />{n}</small> : null}
      </button>
    );
  };

  return (
    <FormShell title="Gehen" icon="feet" onBack={onBack}>
      <p className="hud-note">Du bist am Ort <b>{bare(here) || "—"}</b>. Pro Stunde kannst du einmal gehen.</p>
      {near.length > 0 && (
        <>
          <div className="opt-h">Nebenan</div>
          <div className="opts-grid">{near.map(row)}</div>
        </>
      )}
      {far.length > 0 && (
        <>
          <div className="opt-h">Weiter weg</div>
          <div className="opts-grid">{far.map(row)}</div>
        </>
      )}
    </FormShell>
  );
}

// ─── Arbeiten ─────────────────────────────────────────────────

function WorkForm({ onBack }: { onBack: () => void }) {
  const { player, busy, run } = useGate();
  const list = player?.producible ?? [];
  return (
    <FormShell title="Arbeiten" icon="hammer" onBack={onBack}>
      <p className="hud-note">Pro Stunde kannst du einmal etwas herstellen, das Ergebnis kommt mit der nächsten Stunde.</p>
      <div className="opts-col">
        {list.map((p) => (
          <button
            key={p.item} type="button" className="opt wide" disabled={busy || !p.ready}
            title={p.ready ? `${p.label} herstellen` : p.reason}
            onClick={async () => { if (await run("produce", { item: p.item })) onBack(); }}
          >
            <ItemIcon item={p.item} size={26} />
            <span className="opt-n">{p.label}<small>ergibt {p.output}</small></span>
            {p.ready ? <b className="opt-go">Herstellen</b> : <small className="opt-why">{p.reason}</small>}
          </button>
        ))}
      </div>
    </FormShell>
  );
}

// ─── Essen ────────────────────────────────────────────────────

function EatForm({ onBack }: { onBack: () => void }) {
  const { player, busy, run } = useGate();
  const food = (player?.inventory ?? []).filter((i) => FOOD[i.type] && i.quantity - (i.reserved ?? 0) > 0);
  return (
    <FormShell title="Essen" icon="bowl" onBack={onBack}>
      <div className="opts-col">
        {food.map((i) => (
          <button
            key={i.type} type="button" className="opt wide" disabled={busy}
            onClick={async () => { if (await run("eat", { item: i.type, qty: 1 })) onBack(); }}
          >
            <ItemIcon item={i.type} size={26} />
            <span className="opt-n">{itemLabel(i.type)}<small>{i.quantity - (i.reserved ?? 0)}× da, {FOOD[i.type]}</small></span>
            <b className="opt-go">Essen</b>
          </button>
        ))}
      </div>
    </FormShell>
  );
}

// ─── Handeln ──────────────────────────────────────────────────

type TradeMode = "sell" | "buy" | "take";
const TRADE_MODES: { id: TradeMode; label: string }[] = [
  { id: "sell", label: "Anbieten" },
  { id: "buy", label: "Suchen" },
  { id: "take", label: "Kaufen" },
];

function TradeForm({ onBack }: { onBack: () => void }) {
  const { player, busy, run, find } = useGate();
  const world = useVillageStore((s) => s.world);
  const [mode, setMode] = useState<TradeMode>("sell");
  const firstOwn = player?.inventory.find((i) => i.quantity > 0)?.type;
  const [item, setItem] = useState<string>(firstOwn ?? "brot");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const onSquare = (player?.location ?? "").endsWith("Zechenplatz");
  const ref = world?.marketplace.priceIndex[item];
  const toolFor = mode === "take" ? "buy_item" : "post_order";
  const offered = !!find(toolFor);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(qty);
    const p = Number(price);
    if (mode !== "take" && (!Number.isFinite(q) || q < 1)) { setErr("Die Menge muss mindestens 1 sein."); return; }
    if (!Number.isFinite(p) || p <= 0) { setErr(mode === "take" ? "Gib einen Höchstpreis an." : "Gib einen Preis pro Stück an."); return; }
    setErr(null);
    const ok = mode === "take"
      ? await run("buy_item", { item, max_price: p })
      : await run("post_order", { side: mode, item, qty: q, price: p });
    if (ok) onBack();
  }

  return (
    <FormShell title="Handeln" icon="swap" onBack={onBack}>
      <div className="seg" role="tablist" aria-label="Art des Handels">
        {TRADE_MODES.map((m) => (
          <button key={m.id} type="button" role="tab" className="chip" aria-selected={mode === m.id} aria-pressed={mode === m.id}
            onClick={() => { setMode(m.id); setErr(null); }}>
            {m.label}
          </button>
        ))}
      </div>
      {!onSquare && (
        <div className="note"><Icon name="warn" />Das Tauschbrett hängt auf dem Zechenplatz. Von hier aus wird das vermutlich nichts.</div>
      )}
      {!offered && <div className="note"><Icon name="warn" />Das geht gerade nicht.</div>}
      <form className="fld-grid" onSubmit={submit}>
        <Field label={mode === "sell" ? "Was bietest du an?" : mode === "buy" ? "Was suchst du?" : "Was kaufst du?"}>
          <ItemSelect value={item} onChange={setItem} inventoryFirst={mode === "sell"} />
        </Field>
        <div className="fld-row">
          {mode !== "take" && (
            <Field label="Menge">
              <input className="inp" type="number" inputMode="numeric" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
          )}
          <Field
            label={mode === "take" ? "Höchstpreis" : mode === "sell" ? "Preis je Stück" : "Zahlst bis zu"}
            hint={ref != null ? `Richtpreis ${gr(ref)}` : undefined}
          >
            <input className="inp" type="number" inputMode="decimal" min={1} step="any" value={price}
              placeholder={ref != null ? String(ref) : ""} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        {err && <div className="note bad" role="alert"><Icon name="warn" />{err}</div>}
        <button type="submit" className="btn primary" disabled={busy}>
          <Icon name={mode === "take" ? "cart" : "swap"} />
          {mode === "sell" ? "Anbieten" : mode === "buy" ? "Gesuch anschlagen" : "Kaufen"}
        </button>
      </form>
    </FormShell>
  );
}

// ─── Mehr: every other tool, built from argsHint ──────────────

function parseHint(hint: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(hint);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch (err) {
    console.warn("[viewer] unparsable argsHint, falling back to raw JSON input:", hint, err);
    return null;
  }
}

function GenericForm({ tool, onDone }: { tool: PlayerTool; onDone: () => void }) {
  const { busy, run } = useGate();
  const world = useVillageStore((s) => s.world);
  const hint = useMemo(() => parseHint(tool.argsHint), [tool.argsHint]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState(tool.argsHint);
  const [err, setErr] = useState<string | null>(null);
  const listId = useId();
  const names = useMemo(
    () => (world ? colonistIds(world).filter((a) => a !== "player").map((a) => AGENT_DISPLAY[a]!).sort((a, b) => a.localeCompare(b, "de")) : []),
    [world],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let args: Record<string, unknown> = {};
    if (hint) {
      for (const [k, example] of Object.entries(hint)) {
        const v = (values[k] ?? "").trim();
        if (v === "") continue;
        if (typeof example === "number") {
          const n = Number(v);
          if (!Number.isFinite(n)) { setErr(`„${ARG_LABELS[k] ?? k}“ muss eine Zahl sein.`); return; }
          args[k] = n;
        } else args[k] = v;
      }
    } else {
      try {
        args = JSON.parse(raw) as Record<string, unknown>;
      } catch (parseErr) {
        console.warn("[viewer] invalid JSON for generic tool args", parseErr);
        setErr("Das ist kein gültiges JSON.");
        return;
      }
    }
    setErr(null);
    if (await run(tool.name, args)) onDone();
  }

  const entries = hint ? Object.entries(hint) : [];
  return (
    <form className="fld-grid" onSubmit={submit}>
      <p className="hud-note">{tool.description}{tool.free ? " Das kostet keine Aktion." : ""}</p>
      {hint ? entries.map(([k, example]) => (
        <Field key={k} label={ARG_LABELS[k] ?? k}>
          {k === "item" ? (
            <ItemSelect value={values[k] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [k]: v }))} allowEmpty />
          ) : (
            <input
              className="inp" value={values[k] ?? ""} autoComplete="off"
              type={typeof example === "number" ? "number" : "text"}
              inputMode={typeof example === "number" ? "decimal" : undefined}
              step={typeof example === "number" ? "any" : undefined}
              list={PERSON_KEYS.has(k) ? listId : undefined}
              placeholder={String(example)}
              onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
            />
          )}
        </Field>
      )) : (
        <Field label="Angaben (JSON)">
          <textarea className="inp" rows={3} value={raw} onChange={(e) => setRaw(e.target.value)} />
        </Field>
      )}
      <datalist id={listId}>{names.map((n) => <option key={n} value={n} />)}</datalist>
      {err && <div className="note bad" role="alert"><Icon name="warn" />{err}</div>}
      <button type="submit" className="btn primary" disabled={busy}><Icon name="check" />{toolLabel(tool)}</button>
    </form>
  );
}

function MoreForm({ onBack }: { onBack: () => void }) {
  const { tools, outOfBudget } = useGate();
  const [picked, setPicked] = useState<string | null>(null);
  const others = tools.filter((t) => !DEDICATED_TOOLS.has(t.name));
  const tool = others.find((t) => t.name === picked);
  if (tool) {
    return (
      <FormShell title={toolLabel(tool)} icon="list" free={tool.free} onBack={() => setPicked(null)}>
        <GenericForm tool={tool} onDone={onBack} />
      </FormShell>
    );
  }
  return (
    <FormShell title="Mehr" icon="list" free onBack={onBack}>
      <div className="opts-col">
        {others.map((t) => {
          const off = !t.free && outOfBudget;
          return (
            <button key={t.name} type="button" className="opt wide" disabled={off} title={off ? REASON_BUDGET : t.description}
              onClick={() => setPicked(t.name)}>
              <Icon name="list" />
              <span className="opt-n">{toolLabel(t)}<small>{t.description}</small></span>
              {t.free ? <small className="opt-why">gratis</small> : off ? <small className="opt-why">erschöpft</small> : null}
            </button>
          );
        })}
        {others.length === 0 && <div className="empty" style={{ padding: 14 }}>Gerade gibt es nichts weiter zu tun.</div>}
      </div>
    </FormShell>
  );
}

// ─── The action grid ──────────────────────────────────────────

export default function PlayerActions() {
  const { player, tools, gate } = useGate();
  const [open, setOpen] = useState<ActionId | null>(null);
  if (!player?.created) return null;

  const close = () => setOpen(null);
  const edible = player.inventory.some((i) => FOOD[i.type] && i.quantity - (i.reserved ?? 0) > 0);
  const produce = player.producible ?? [];
  const hasMore = tools.some((t) => !DEDICATED_TOOLS.has(t.name));

  const speak = gate("speak", "Hier ist gerade niemand, mit dem du reden könntest.");
  const move = gate("move_to", "Gehen ist gerade nicht möglich.");
  const work = gate("produce", "Arbeiten ist gerade nicht möglich.")
    ?? (produce.length === 0
      ? (player.skill === "none"
        ? "Ohne Handwerk kannst du nichts herstellen. Bitte jemanden hier, dich anzuheuern (Mehr)."
        : `Hier kannst du nichts herstellen. Dein Arbeitsort ist ${player.work ?? "woanders"}.`)
      : null);
  const eat = gate("eat", "Essen ist gerade nicht möglich.")
    ?? (edible ? null : "Du hast nichts Essbares dabei.");
  const NO_TRADE = "Handeln ist gerade nicht möglich.";
  const tradeSell = gate("post_order", NO_TRADE);
  const tradeBuy = gate("buy_item", NO_TRADE);
  const trade = tradeSell === null || tradeBuy === null ? null : tradeSell;
  const more = tools.length === 0 ? REASON_NO_TOOLS : hasMore ? null : "Gerade gibt es nichts weiter zu tun.";

  const sub = (r: string | null, short: string) => (r === REASON_BUDGET ? "erschöpft" : short);

  return (
    <div className="hud-actions-wrap">
      {open === null && (
        <div className="hud-actions" role="group" aria-label="Aktionen">
          <ActBtn icon="speech" label="Reden" reason={speak} sub={sub(speak, "niemand hier")} onClick={() => setOpen("speak")} />
          <ActBtn icon="feet" label="Gehen" reason={move} sub={sub(move, "nicht möglich")} onClick={() => setOpen("move")} />
          <ActBtn icon="hammer" label="Arbeiten" reason={work}
            sub={sub(work, player.skill === "none" ? "kein Handwerk" : "nicht hier")} onClick={() => setOpen("work")} />
          <ActBtn icon="bowl" label="Essen" reason={eat} sub={sub(eat, "nichts da")} onClick={() => setOpen("eat")} />
          <ActBtn icon="swap" label="Handeln" reason={trade} sub={sub(trade, "nicht möglich")} onClick={() => setOpen("trade")} />
          <ActBtn icon="list" label="Mehr" reason={more} sub={sub(more, "nichts weiter")} onClick={() => setOpen("more")} />
        </div>
      )}
      {open === "speak" && <SpeakForm onBack={close} />}
      {open === "move" && <MoveForm onBack={close} />}
      {open === "work" && <WorkForm onBack={close} />}
      {open === "eat" && <EatForm onBack={close} />}
      {open === "trade" && <TradeForm onBack={close} />}
      {open === "more" && <MoreForm onBack={close} />}
    </div>
  );
}
