import { useEffect, useMemo, useState } from "react";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { WarMarchInfo, WarRelation, WarStance } from "../types";
import Icon, { type IconName } from "./Icon";
import GodModePanel from "./GodModePanel";

/** Transport glyphs (the shared icon set has no play / pause / step). Same stroke style as `Icon`. */
export function SimGlyph({ kind }: { kind: "play" | "pause" | "step" }) {
  const d = kind === "play" ? "M8 5.5v13l11-6.5z" : kind === "pause" ? "M8.5 5.5v13M15.5 5.5v13" : "M5.5 5.5v13l9-6.5zM18.5 5.5v13";
  return (
    <span className="ic" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d={d} /></svg>
    </span>
  );
}

// ─── Cost estimate ────────────────────────────────────────────

/** Measured per colonist per tick (Claude API, harness mode): ~8.7k input + ~1.2k output tokens (same basis as the model picker). */
const TOKENS_IN_PER_TICK = 8700;
const TOKENS_OUT_PER_TICK = 1200;

const deNum = (n: number, digits: number) => n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "0,8 ct" below one dollar, "12,40 $" above. Input in USD. */
function fmtCost(usd: number): string {
  if (usd < 1) {
    const ct = usd * 100;
    return `${deNum(ct, ct < 10 ? 1 : 0)} ct`;
  }
  return `${deNum(usd, 2)} $`;
}

function useCostEstimate() {
  const info = useVillageStore((s) => s.agentModels);
  return useMemo(() => {
    if (!info) return null;
    const counts: Record<string, number> = {};
    let usdPerTick = 0;
    let unknown = 0;
    for (const model of Object.values(info.models)) {
      counts[model] = (counts[model] ?? 0) + 1;
      const opt = info.options.find((o) => o.id === model);
      if (opt) usdPerTick += (TOKENS_IN_PER_TICK * opt.inPerMTok + TOKENS_OUT_PER_TICK * opt.outPerMTok) / 1_000_000;
      else unknown++;
    }
    const perModel = info.options.map((o) => ({ id: o.id, label: o.label.split(" ")[0]!, n: counts[o.id] ?? 0 }));
    return { usdPerTick, perModel, unknown, total: Object.keys(info.models).length };
  }, [info]);
}

// ─── Simulation ───────────────────────────────────────────────

const BUDGET_CHIPS: { ticks: number | null; label: string; title: string }[] = [
  { ticks: 1, label: "1", title: "1 Tick, dann Pause" },
  { ticks: 5, label: "5", title: "5 Ticks, dann Pause" },
  { ticks: 10, label: "10", title: "10 Ticks, dann Pause" },
  { ticks: 25, label: "25", title: "25 Ticks, dann Pause" },
  { ticks: null, label: "∞", title: "Kein Limit" },
];

const SPEED_CHIPS: { ms: number; label: string; title: string }[] = [
  { ms: 0, label: "sofort", title: "Ohne Pause zwischen den Ticks" },
  { ms: 5000, label: "5 s", title: "5 Sekunden zwischen den Ticks" },
  { ms: 15000, label: "15 s", title: "15 Sekunden zwischen den Ticks" },
  { ms: 60000, label: "60 s", title: "60 Sekunden zwischen den Ticks" },
];

const fmtDelay = (ms: number) => (ms === 0 ? "sofort" : ms % 1000 === 0 ? `${ms / 1000} s` : `${deNum(ms / 1000, 1)} s`);

function SimSection() {
  const sim = useVillageStore((s) => s.sim);
  const simCommand = useVillageStore((s) => s.simCommand);
  const cost = useCostEstimate();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  // A finite budget means "run this many ticks": it also starts a paused sim (an unlimited one only lifts the cap).
  async function setBudget(ticks: number | null) {
    const ok = await simCommand("budget", { ticks });
    if (ok && ticks !== null && useVillageStore.getState().sim?.paused) await simCommand("resume");
  }

  const paused = sim?.paused ?? false;
  const tone = !sim ? "plain" : paused ? "warn" : "good";
  const budgetCost = sim?.budget != null && cost ? sim.budget * cost.usdPerTick : null;

  return (
    <div className="sec">
      <div className="sec-h"><span>Simulation</span><small>Takt und Kosten</small></div>

      <div className="evc" data-tone={tone}>
        <span className="eico">{sim ? <SimGlyph kind={paused ? "pause" : "play"} /> : <Icon name="hourglass" />}</span>
        <div>
          <h3>{!sim ? "Status unbekannt" : paused ? "Pausiert" : "Läuft"}</h3>
          <p>
            {!sim ? "Keine Verbindung zur Sim-Steuerung."
              : paused ? (sim.pausedReason ?? "Die Simulation wartet.")
              : "Die Kolonisten leben ihren Tag."}
          </p>
          {sim && (
            <div className="meta">
              <span><Icon name="hourglass" />Tempo: {fmtDelay(sim.tickDelayMs)}</span>
              <span><Icon name="list" />Budget: {sim.budget === null ? "unbegrenzt" : `${sim.budget} ${sim.budget === 1 ? "Tick" : "Ticks"} übrig`}</span>
            </div>
          )}
        </div>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button
          className={`btn${paused ? " primary" : ""}`}
          style={{ flex: 1 }}
          disabled={!sim || busy !== null}
          onClick={() => void run("toggle", () => simCommand(paused ? "resume" : "pause"))}
        >
          <SimGlyph kind={paused ? "play" : "pause"} />{paused ? "Weiter" : "Pause"}
        </button>
        <button
          className="btn"
          style={{ flex: 1 }}
          disabled={!sim || !paused || busy !== null}
          title={paused ? "Genau einen Tick ausführen" : "Nur bei Pause"}
          onClick={() => void run("step", () => simCommand("step"))}
        >
          <SimGlyph kind="step" />1 Tick
        </button>
      </div>

      <div className="fld" style={{ marginTop: 10 }}>
        <span className="fld-l">Budget <small className="muted">Ticks, dann Pause</small></span>
        <div className="chips">
          {BUDGET_CHIPS.map((b) => (
            <button
              key={b.label}
              className="chip"
              title={b.title}
              aria-pressed={sim?.budget === b.ticks}
              disabled={!sim || busy !== null}
              onClick={() => void run(`budget${b.label}`, () => setBudget(b.ticks))}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fld" style={{ marginTop: 8 }}>
        <span className="fld-l">Tempo <small className="muted">Pause zwischen den Ticks</small></span>
        <div className="chips">
          {SPEED_CHIPS.map((s) => (
            <button
              key={s.ms}
              className="chip"
              title={s.title}
              aria-pressed={sim?.tickDelayMs === s.ms}
              disabled={!sim || busy !== null}
              onClick={() => void run(`speed${s.ms}`, () => simCommand("speed", { delayMs: s.ms }))}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="costbox">
        {cost ? (
          <>
            <div className="cost-l">
              <Icon name="coin" />
              <span>
                <b>≈ {fmtCost(cost.usdPerTick)}</b> pro Tick <small className="muted">(geschätzt)</small>
              </span>
            </div>
            {budgetCost !== null && (
              <div className="cost-l">
                <Icon name="list" />
                <span>
                  Rest-Budget {sim!.budget} {sim!.budget === 1 ? "Tick" : "Ticks"}: <b>≈ {fmtCost(budgetCost)}</b> <small className="muted">(geschätzt)</small>
                </span>
              </div>
            )}
            <div className="cost-m">
              Kolonisten je Modell: {cost.perModel.map((m) => `${m.label} ${m.n}`).join(" · ")}{cost.unknown > 0 ? ` · Sonstige ${cost.unknown}` : ""}
            </div>
            <div className="cost-m">
              Annahme: ca. {deNum(TOKENS_IN_PER_TICK / 1000, 1)}k Token ein und {deNum(TOKENS_OUT_PER_TICK / 1000, 1)}k aus je Kolonist und Tick, alle Kolonisten. Obergrenze, kein Abrechnungswert.
            </div>
          </>
        ) : (
          <div className="cost-m">Modelle werden geladen …</div>
        )}
      </div>
    </div>
  );
}

// ─── War & diplomacy ──────────────────────────────────────────

const STANCE: Record<WarStance, { label: string; icon: IconName; tone: "good" | "warn" | "bad" }> = {
  frieden: { label: "Frieden", icon: "heart", tone: "good" },
  spannung: { label: "Spannung", icon: "warn", tone: "warn" },
  krieg: { label: "Krieg", icon: "dagger", tone: "bad" },
};

const MARCH_PHASE: Record<WarMarchInfo["phase"], { label: string; icon: IconName }> = {
  hin: { label: "marschiert", icon: "feet" },
  kampf: { label: "kämpft", icon: "dagger" },
  zurueck: { label: "kehrt zurück", icon: "back" },
};

const LOG_ICON: Record<string, IconName> = {
  provocation: "flame", tension: "warn", declared: "dagger", raid: "dagger", guard: "eye", peace: "heart", peace_offer: "heart", tribute: "coin",
};

/** The 85 tension threshold at which the council convenes a war session on its own (server rule). */
const COUNCIL_AT = 85;

type Mode = "provoke" | "declare" | "tribute" | "raid";

const RAID_SIZES = [2, 3, 5];

const MODE_LABEL: Record<Mode, { dir: string; go: string }> = {
  raid: { dir: "Angreifer → Ziel", go: "Kriegszug losschicken" },
  provoke: { dir: "Von → nach", go: "Provozieren" },
  declare: { dir: "Angreifer → Ziel", go: "Krieg erklären" },
  tribute: { dir: "Zahler → Empfänger", go: "Tribut zahlen" },
};

function WarPair({ a, b, rel }: { a: { id: string; name: string }; b: { id: string; name: string }; rel: WarRelation | undefined }) {
  const warCommand = useVillageStore((s) => s.warCommand);
  const kinds = useVillageStore((s) => s.warProvokeKinds);
  const [mode, setMode] = useState<Mode | null>(null);
  const [dir, setDir] = useState<"ab" | "ba">("ab");
  const [kind, setKind] = useState("");
  const [amount, setAmount] = useState("");
  const [size, setSize] = useState(3);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const stance: WarStance = rel?.stance ?? "frieden";
  const tension = Math.max(0, Math.min(100, rel?.tension ?? 0));
  const meta = STANCE[stance];
  const from = dir === "ab" ? a : b;
  const to = dir === "ab" ? b : a;
  const kindId = kind || kinds[0]?.id || "";

  // "Wirklich?" lapses after a few seconds.
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  const open = (m: Mode) => {
    setConfirm(false);
    setMode((cur) => (cur === m ? null : m));
  };

  async function send(action: "provoke" | "declare" | "peace" | "tribute" | "raid", body: Record<string, unknown>, okText: string) {
    setBusy(true);
    try {
      if (await warCommand(action, body, okText)) { setMode(null); setConfirm(false); setAmount(""); }
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (mode === "provoke") {
      if (!kindId) return;
      const label = kinds.find((k) => k.id === kindId)?.label ?? kindId;
      void send("provoke", { from: from.id, to: to.id, kind: kindId }, `${from.name} provoziert ${to.name}: ${label}.`);
    } else if (mode === "declare") {
      if (!confirm) { setConfirm(true); return; }
      void send("declare", { aggressor: from.id, target: to.id }, `${from.name} erklärt ${to.name} den Krieg.`);
    } else if (mode === "tribute") {
      const n = Number.parseInt(amount, 10);
      void send(
        "tribute",
        { payer: from.id, receiver: to.id, ...(Number.isFinite(n) && n > 0 ? { amount: n } : {}) },
        `${from.name} zahlt ${to.name} Tribut.`,
      );
    } else if (mode === "raid") {
      void send("raid", { from: from.id, to: to.id, size }, `Kriegszug von ${from.name} nach ${to.name} bricht auf.`);
    }
  }

  return (
    <div className="evc wp" data-tone={meta.tone}>
      <span className="eico"><Icon name={meta.icon} /></span>
      <div style={{ minWidth: 0 }}>
        <h3>{a.name} ⇄ {b.name} <span className="st">{meta.label}</span></h3>

        <div className="tbar" role="meter" aria-label={`Spannung ${a.name} und ${b.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={tension}>
          <b style={{ width: `${tension}%` }} />
          <i className="tmark" style={{ left: `${COUNCIL_AT}%` }} title={`Ab ${COUNCIL_AT} beruft der Rat eine Kriegssitzung ein`} />
        </div>
        <div className="tlbl">
          <span>Spannung {tension}/100</span>
          <span title={`Ab ${COUNCIL_AT} beruft der Rat automatisch eine Kriegssitzung ein`}>Ratssitzung ab {COUNCIL_AT}</span>
        </div>

        <div className="wacts">
          <button className="btn sm" aria-expanded={mode === "provoke"} disabled={busy} onClick={() => open("provoke")}>
            <Icon name="flame" />Provozieren
          </button>
          <button className="btn sm" aria-expanded={mode === "declare"} disabled={busy || stance === "krieg"} onClick={() => open("declare")}
            title={stance === "krieg" ? "Es herrscht schon Krieg" : "Krieg erklären"}>
            <Icon name="dagger" />Krieg erklären
          </button>
          <button className="btn sm" disabled={busy || stance === "frieden"} title={stance === "frieden" ? "Es herrscht schon Frieden" : "Frieden schließen"}
            onClick={() => void send("peace", { a: a.id, b: b.id }, `${a.name} und ${b.name} schließen Frieden.`)}>
            <Icon name="heart" />Frieden
          </button>
          <button className="btn sm" aria-expanded={mode === "tribute"} disabled={busy || stance === "frieden"} onClick={() => open("tribute")}
            title={stance === "frieden" ? "Im Frieden gibt es keinen Tribut" : "Tribut zahlen"}>
            <Icon name="coin" />Tribut
          </button>
          <button className="btn sm" aria-expanded={mode === "raid"} disabled={busy || stance !== "krieg"} onClick={() => open("raid")}
            title={stance !== "krieg" ? "Erst Krieg erklären" : "Kriegszug losschicken"}>
            <Icon name="feet" />Kriegszug losschicken
          </button>
        </div>
        {stance !== "krieg" && <div className="muted" style={{ fontSize: 12, marginTop: 5 }}>Kriegszug: erst Krieg erklären.</div>}

        {mode && (
          <div className="wform">
            <label className="fld">
              <span className="fld-l">{MODE_LABEL[mode].dir}</span>
              <select className="inp" value={dir} onChange={(e) => { setDir(e.target.value as "ab" | "ba"); setConfirm(false); }}>
                <option value="ab">{a.name} → {b.name}</option>
                <option value="ba">{b.name} → {a.name}</option>
              </select>
            </label>
            {mode === "provoke" && (
              <label className="fld">
                <span className="fld-l">Art</span>
                <select className="inp" value={kindId} onChange={(e) => setKind(e.target.value)}>
                  {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </label>
            )}
            {mode === "tribute" && (
              <label className="fld">
                <span className="fld-l">Betrag <small className="muted">leer = Tribut, der den Krieg beendet</small></span>
                <input className="inp" type="number" inputMode="numeric" min={1} step={1} value={amount} placeholder="Groschen"
                  onChange={(e) => setAmount(e.target.value)} />
              </label>
            )}
            {mode === "raid" && (
              <div className="fld">
                <span className="fld-l">Stärke <small className="muted">Kämpfer im Zug</small></span>
                <div className="chips">
                  {RAID_SIZES.map((n) => (
                    <button key={n} type="button" className="chip" aria-pressed={size === n} onClick={() => setSize(n)}>{n}</button>
                  ))}
                </div>
              </div>
            )}
            <button
              className={`btn block${mode === "declare" ? " danger" : " primary"}`}
              disabled={busy || (mode === "provoke" && !kindId) || (mode === "raid" && stance !== "krieg")}
              onClick={submit}
            >
              <Icon name={busy ? "hourglass" : mode === "tribute" ? "coin" : mode === "declare" ? "dagger" : mode === "raid" ? "feet" : "flame"} className={busy ? "spin" : ""} />
              {busy ? "Sendet …" : mode === "declare" && confirm ? "Wirklich?" : MODE_LABEL[mode].go}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MarchRow({ agent, m }: { agent: string; m: WarMarchInfo }) {
  const villages = useVillageStore((s) => s.warVillages);
  const target = villages.find((v) => v.id === m.target)?.name ?? m.target;
  const ph = MARCH_PHASE[m.phase] ?? { label: m.phase, icon: "feet" as IconName };
  return (
    <li className="mrow">
      <span className="sico bad"><Icon name={ph.icon} /></span>
      <span style={{ minWidth: 0 }}>
        <b className="nm">{AGENT_DISPLAY[agent] ?? agent} → {target}</b>
        <span className="lc">{ph.label} · Ankunft Tick {m.arriveTick}</span>
      </span>
    </li>
  );
}

function WarSection() {
  const villages = useVillageStore((s) => s.warVillages);
  const relations = useVillageStore((s) => s.warRelations);
  const marches = useVillageStore((s) => s.warMarches);
  const log = useVillageStore((s) => s.warLog);

  const pairs = useMemo(() => {
    const out: { a: { id: string; name: string }; b: { id: string; name: string }; rel: WarRelation | undefined }[] = [];
    for (let i = 0; i < villages.length; i++) {
      for (let j = i + 1; j < villages.length; j++) {
        const a = villages[i]!, b = villages[j]!;
        const rel = relations.find((r) => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id));
        out.push({ a, b, rel });
      }
    }
    return out;
  }, [villages, relations]);

  const marching = Object.entries(marches);
  const nameOf = (id: string) => villages.find((v) => v.id === id)?.name ?? id;
  const recent = log.slice(-10).reverse();

  return (
    <div className="sec">
      <div className="sec-h"><span>Krieg &amp; Diplomatie</span><small>zwischen den Siedlungen</small></div>

      {pairs.length === 0 ? (
        <div className="empty"><Icon name="globe" /><span>Keine Siedlungen geladen.</span><small>Sobald der Server Siedlungen meldet, erscheinen hier die Beziehungen.</small></div>
      ) : (
        <div className="evs">
          {pairs.map((p) => <WarPair key={`${p.a.id}:${p.b.id}`} a={p.a} b={p.b} rel={p.rel} />)}
        </div>
      )}

      <div className="sec-h sub"><span>Kriegszüge</span><small>{marching.length} unterwegs</small></div>
      {marching.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>Niemand ist auf einem Kriegszug.</div>
      ) : (
        <ul className="mlist">{marching.map(([agent, m]) => <MarchRow key={agent} agent={agent} m={m} />)}</ul>
      )}

      <div className="sec-h sub"><span>Kriegschronik</span><small>letzte {recent.length || 10}</small></div>
      {recent.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>Noch nichts vorgefallen.</div>
      ) : (
        <ul className="wlog">
          {recent.map((e, i) => (
            <li key={`${e.tick}-${i}-${e.text.slice(0, 12)}`} data-ok={e.success === undefined ? undefined : e.success ? "yes" : "no"}>
              <span className="ic-w"><Icon name={LOG_ICON[e.kind] ?? "book"} /></span>
              <span style={{ minWidth: 0 }}>
                <span>{e.text}</span>
                <small className="muted">
                  Tick {e.tick}{e.villages?.[0] ? ` · ${nameOf(e.villages[0])} ⇄ ${nameOf(e.villages[1])}` : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────

/** "Regie" tab: run the simulation, stir up the settlements, and trigger fate. */
export default function RegiePanel() {
  return (
    <div>
      <SimSection />
      <WarSection />
      <div className="reg-h"><Icon name="scale" /><span>Schicksal</span></div>
      <GodModePanel />
    </div>
  );
}
