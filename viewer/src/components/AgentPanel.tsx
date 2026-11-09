import { useState, useEffect, useRef, useMemo } from "react";
import { useVillageStore, AGENT_DISPLAY, colonistIds } from "../store";
import { gr, itemLabel, skillLabel, tickClock, SLEEP_LABELS, TICKS_PER_DAY, type AgentName, type BodyState, type FeedEntry, type Loan } from "../types";
import { c } from "../theme";
import Icon, { ItemIcon, type IconName } from "./Icon";
import Avatar from "./Avatar";

// ─── Status helpers ───────────────────────────────────────────

type Bucket = "dead" | "starving" | "sick" | "hungry" | "ok";

function getStatusBucket(body: BodyState): Bucket {
  if ((body.starvation_ticks ?? 0) >= 999) return "dead";
  if ((body.starvation_ticks ?? 0) > 0) return "starving";
  if ((body.sickness ?? 0) >= 1 || (body.injury ?? 0) >= 1) return "sick";
  if (body.hunger >= 2) return "hungry";
  return "ok";
}

const STATUS_ORDER: Record<Bucket, number> = { starving: 0, sick: 1, hungry: 2, ok: 3, dead: 4 };

const STATUS_META: Record<Bucket, { icon: IconName; tone: string; label: string }> = {
  ok: { icon: "check", tone: "good", label: "Wohlauf" },
  hungry: { icon: "wheat", tone: "warn", label: "Hungrig" },
  sick: { icon: "bandage", tone: "bad", label: "Krank oder verletzt" },
  starving: { icon: "warn", tone: "bad", label: "Hungert stark" },
  dead: { icon: "skull", tone: "dead", label: "Tot" },
};

const SKILL_ICON: Record<string, IconName> = {
  bauer: "wheat", hirte: "user", knappe: "mine", holzfaeller: "hammer",
  mueller: "scale", baecker: "flame", schmied: "hammer", zimmermann: "hammer",
  wirt: "coin", bader: "heart", haendler: "cart", naeherin: "user", none: "user",
};

/** Hunger bar keeps the old semantics: fill = satiation (hunger 0 = full bar). */
const hungerFill = (hunger: number) => Math.max(0, Math.min(100, ((5 - hunger) / 5) * 100));
const hungerTone = (hunger: number) => (hunger <= 1 ? c.good : hunger <= 3 ? c.warn : c.bad);
const energyFill = (energy: number) => Math.max(0, Math.min(100, (energy / 10) * 100));
const energyTone = (energy: number) => (energy >= 7 ? c.good : energy >= 4 ? c.warn : c.bad);

function Bar({ label, pct, color, value, title }: { label: string; pct: number; color: string; value: number; title: string }) {
  return (
    <div className="bar" title={title}>
      <span className="bar-l">{label}</span>
      <div className="bar-t" role="meter" aria-label={label} aria-valuenow={value}>
        <b style={{ ["--p" as string]: `${pct}%`, ["--c" as string]: color }} />
      </div>
      <span className="bar-v mono">{value}</span>
    </div>
  );
}

// ─── Kolonisten list (no colonist selected) ───────────────────

function AgentList() {
  const world = useVillageStore((s) => s.world);
  const selectAgent = useVillageStore((s) => s.selectAgent);
  const activeVillageId = useVillageStore((s) => s.activeVillageId);
  const villages = useVillageStore((s) => s.villages);
  const setActiveVillage = useVillageStore((s) => s.setActiveVillageId);
  const [search, setSearch] = useState("");

  const agents = useMemo(() => {
    if (!world) return [];
    const q = search.trim().toLowerCase();
    return colonistIds(world)
      .filter((a) => {
        const vid = (world.economics[a] as { villageId?: string }).villageId ?? "schlackental";
        if (vid !== activeVillageId) return false;
        return !q || AGENT_DISPLAY[a].toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => {
        const bodyA = world.body[a];
        const bodyB = world.body[b];
        const sa = bodyA ? STATUS_ORDER[getStatusBucket(bodyA)] : 5;
        const sb = bodyB ? STATUS_ORDER[getStatusBucket(bodyB)] : 5;
        return sa !== sb ? sa - sb : AGENT_DISPLAY[a].localeCompare(AGENT_DISPLAY[b], "de");
      });
  }, [world?.economics, world?.body, activeVillageId, search]);

  if (!world) {
    return (
      <div className="empty">
        <Icon name="hourglass" />
        <span>Warte auf die Simulation …</span>
        <small>Server starten, dann erscheinen hier die Kolonisten.</small>
      </div>
    );
  }

  const activeVillageName = villages.find((v) => v.id === activeVillageId)?.name ?? "Schlackental";

  return (
    <div>
      <div className="sec-h">
        <span>{activeVillageName}</span>
        <small>{agents.length} Kolonisten</small>
      </div>

      {villages.length > 1 && (
        <select className="inp" aria-label="Kolonie wählen" value={activeVillageId} onChange={(e) => setActiveVillage(e.target.value)} style={{ marginBottom: 8 }}>
          {villages.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}

      {(agents.length > 12 || search) && (
        <input
          type="search"
          className="inp"
          placeholder="Kolonist suchen …"
          aria-label="Kolonist suchen"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 8 }}
        />
      )}

      {agents.length === 0 && (
        <div className="empty"><Icon name="users" /><span>Niemand gefunden.</span></div>
      )}

      <div className="klist">
        {agents.map((a) => {
          const body = world.body[a];
          const eco = world.economics[a];
          const loc = world.agent_locations[a];
          if (!body || !eco) return null;
          const bucket = getStatusBucket(body);
          const meta = STATUS_META[bucket];
          const isDead = bucket === "dead";
          return (
            <button key={a} className="krow" data-st={bucket} disabled={isDead} onClick={() => selectAgent(a)} title={`${AGENT_DISPLAY[a]} – ${meta.label}`}>
              <span className={`sico ${meta.tone}`}><Icon name={meta.icon} /></span>
              <span style={{ minWidth: 0 }}>
                <span className="nm">
                  {AGENT_DISPLAY[a]}
                  <Icon name={SKILL_ICON[eco.skill] ?? "user"} />
                </span>
                <span className="lc">{skillLabel(eco.skill)} · {loc}</span>
              </span>
              {isDead ? <span /> : (
                <span className="minibars" aria-hidden="true">
                  <span className="mb"><b style={{ ["--p" as string]: `${hungerFill(body.hunger)}%`, ["--c" as string]: hungerTone(body.hunger) }} /></span>
                  <span className="mb"><b style={{ ["--p" as string]: `${energyFill(body.energy)}%`, ["--c" as string]: energyTone(body.energy) }} /></span>
                </span>
              )}
              <span className="wl mono">{isDead ? "†" : gr(eco.wallet)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Colonist detail ──────────────────────────────────────────

const THOUGHT_META: Record<string, { label: string; icon: IconName }> = {
  thought: { label: "Gedanke", icon: "brain" },
  speak: { label: "Sagt", icon: "speech" },
  do: { label: "Tut", icon: "hammer" },
};

function RecentThoughts({ agent }: { agent: AgentName }) {
  const feed = useVillageStore((s) => s.feed);
  const items = useMemo(
    () => feed.filter((e: FeedEntry) => e.agent === agent && (e.type === "thought" || e.type === "speak" || e.type === "do")).slice(0, 5),
    [feed, agent],
  );
  if (items.length === 0) return null;
  return (
    <div className="sec">
      <div className="sec-h"><span>Letzte Gedanken</span><small>und Aussagen</small></div>
      <ul className="thoughts">
        {items.map((e) => {
          const m = THOUGHT_META[e.type]!;
          return (
            <li key={e.id} className="th">
              <span className="tt"><Icon name={m.icon} />{m.label}</span>
              <div>
                <p>{e.type === "speak" ? `„${e.text}“` : e.text}</p>
                <time>{tickClock(e.tick)}</time>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AgentPanel() {
  const selectedAgent = useVillageStore((s) => s.selectedAgent);
  const world = useVillageStore((s) => s.world);
  const selectAgent = useVillageStore((s) => s.selectAgent);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [interviewing, setInterviewing] = useState(false);
  const [whisper, setWhisper] = useState("");
  const [whispering, setWhispering] = useState(false);
  const [whisperNote, setWhisperNote] = useState<{ ok: boolean; text: string } | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuestion("");
    setAnswer("");
    setWhisper("");
    setWhisperNote(null);
  }, [selectedAgent]);

  useEffect(() => {
    if (answerRef.current) answerRef.current.scrollTop = answerRef.current.scrollHeight;
  }, [answer]);

  async function askAgent() {
    if (!selectedAgent || !question.trim()) return;
    setInterviewing(true);
    setAnswer("");
    try {
      const res = await fetch(`/api/interview/${selectedAgent}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setAnswer((prev) => prev + dec.decode(value, { stream: true }));
      }
    } catch (err) {
      console.error("[viewer] interview failed", err);
      setAnswer("(Keine Antwort: Die Anfrage ist fehlgeschlagen.)");
    } finally {
      setInterviewing(false);
    }
  }

  async function whisperRumor() {
    if (!selectedAgent || !whisper.trim()) return;
    setWhispering(true);
    setWhisperNote(null);
    try {
      const res = await fetch(`/api/whisper/${selectedAgent}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: whisper }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWhisper("");
      setWhisperNote({ ok: true, text: "Gerücht geflüstert." });
    } catch (err) {
      console.error("[viewer] whisper failed", err);
      setWhisperNote({ ok: false, text: "Flüstern fehlgeschlagen." });
    } finally {
      setWhispering(false);
    }
  }

  if (!selectedAgent || !world) return <AgentList />;

  const eco = world.economics[selectedAgent];
  const body = world.body[selectedAgent];
  const loc = world.agent_locations[selectedAgent];
  const first = AGENT_DISPLAY[selectedAgent].split(" ")[0];
  const caravanActive = world.active_events.some((e) => e.type === "caravan");
  // During a Schmugglerzug the Vogt's stall at the Schmugglerpfad is the smuggler's stall (engine behaviour).
  const isSmuggler = selectedAgent === "reinhart" && caravanActive;
  const wares = isSmuggler ? world.marketplace.orders.filter((o) => o.agentId === "reinhart" && o.type === "sell") : [];
  const bucket = body ? getStatusBucket(body) : "ok";

  const loans = (world.loans ?? []).filter((l: Loan) => !l.repaid);
  const owed = loans.filter((l) => l.creditor === selectedAgent);
  const owes = loans.filter((l) => l.debtor === selectedAgent);
  const dueDay = (l: Loan) => Math.ceil(l.dueTick / TICKS_PER_DAY);
  const known = world.acquaintances[selectedAgent] ?? [];

  return (
    <div>
      <div className="kol-head">
        <Avatar agent={selectedAgent} skill={eco?.skill} />
        <div className="kol-id">
          <h2 className="kol-name">{AGENT_DISPLAY[selectedAgent]}</h2>
          <div className="kol-chips">
            <span className="chipx">
              <Icon name={isSmuggler ? "cart" : SKILL_ICON[eco?.skill ?? "none"] ?? "user"} />
              {isSmuggler ? "Schmuggler am Ziegenpfad" : skillLabel(eco?.skill)}
            </span>
            {bucket !== "ok" && (
              <span className={`chipx ${STATUS_META[bucket].tone === "dead" ? "" : STATUS_META[bucket].tone}`}>
                <Icon name={STATUS_META[bucket].icon} />{STATUS_META[bucket].label}
              </span>
            )}
          </div>
          <div className="kol-loc"><Icon name="pin" />{loc ?? "—"}</div>
        </div>
        <button className="iconbtn" onClick={() => selectAgent(null)} aria-label="Zurück zur Kolonistenliste" title="Zurück zur Liste">
          <Icon name="x" />
        </button>
      </div>

      {isSmuggler && (
        <div className="sec smuggler">
          <div className="sec-h"><span>Waren zum Verkauf</span><small>Schmugglerzug</small></div>
          {wares.length > 0 ? wares.map((o) => (
            <div key={o.id} className="ware">
              <ItemIcon item={o.item} size={22} />
              <span className="n">{itemLabel(o.item)}</span>
              <span className="muted">×{o.quantity}</span>
              <b style={{ color: c.accent }}>{gr(o.price)}</b>
            </div>
          )) : <span className="muted">Alles verkauft.</span>}
        </div>
      )}

      <dl className="kv">
        <div><dt>Handwerk</dt><dd>{skillLabel(eco?.skill)}</dd></div>
        <div><dt>Ort</dt><dd title={loc}>{loc ?? "—"}</dd></div>
        <div><dt>Zuhause</dt><dd title={eco?.homeLocation}>{eco?.homeLocation ?? "—"}</dd></div>
        <div><dt>Arbeit</dt><dd title={eco?.workLocation}>{eco?.workLocation ?? "—"}</dd></div>
      </dl>

      <div className="sec">
        <div className="sec-h"><span>Zustand</span></div>
        <div className="purse" title="Geldbeutel">
          <Icon name="coin" />{eco?.wallet ?? 0} <small>Groschen</small>
        </div>
        {eco?.tool && (
          <div className="muted" style={{ marginBottom: 8, color: c.ink2 }}>
            <Icon name="hammer" /> Werkzeug: {eco.tool.durability} % Zustand
          </div>
        )}
        {body && (
          <div className="bars">
            <Bar label="Hunger" pct={hungerFill(body.hunger)} color={hungerTone(body.hunger)} value={body.hunger}
              title={`Hunger ${body.hunger} von 5 (Balken zeigt Sättigung)`} />
            <Bar label="Kraft" pct={energyFill(body.energy)} color={energyTone(body.energy)} value={body.energy}
              title={`Kraft ${body.energy} von 10`} />
            <div className="kol-chips" style={{ margin: "2px 0 0" }}>
              {(body.sickness ?? 0) > 0 && <span className="chipx bad"><Icon name="bandage" />Krank (Stufe {body.sickness})</span>}
              {(body.injury ?? 0) > 0 && <span className="chipx warn"><Icon name="bandage" />Verletzt (Stufe {body.injury})</span>}
              <span className="chipx"><Icon name="moon" />Schlaf: {SLEEP_LABELS[body.sleep_quality] ?? body.sleep_quality}</span>
            </div>
          </div>
        )}
      </div>

      <div className="sec">
        <div className="sec-h">
          <span>Inventar</span>
          <small>{eco?.inventory?.items?.length ? `${eco.inventory.items.reduce((n, i) => n + i.quantity, 0)} Stück` : ""}</small>
        </div>
        {eco?.inventory?.items?.length ? (
          <div className="inv">
            {eco.inventory.items.map((item, idx) => {
              const avail = item.quantity - (item.reserved ?? 0);
              const reserved = item.reserved ?? 0;
              return (
                <div key={`${item.type}-${idx}`} className={`slot${reserved > 0 ? " res" : ""}`}
                  title={`${itemLabel(item.type)}: ${avail} verfügbar${reserved ? `, ${reserved} reserviert` : ""}`}>
                  <ItemIcon item={item.type} size={30} />
                  <b className="mono">{avail}</b>
                  <span>{itemLabel(item.type)}</span>
                  {reserved > 0 && <small>+{reserved} reserviert</small>}
                </div>
              );
            })}
          </div>
        ) : <div className="empty" style={{ padding: 14 }}>Nichts dabei.</div>}
      </div>

      {(owed.length > 0 || owes.length > 0) && (
        <div className="sec">
          <div className="sec-h"><span>Schulden</span></div>
          {owed.map((l) => (
            <div key={l.id} className="loan info">
              <Icon name="coin" />
              <span>Fordert {gr(l.amount)} von {AGENT_DISPLAY[l.debtor]} (fällig Tag {dueDay(l)})</span>
            </div>
          ))}
          {owes.map((l) => {
            const overdue = world.current_tick >= l.dueTick;
            return (
              <div key={l.id} className={`loan${overdue ? " bad" : ""}`}>
                <Icon name={overdue ? "warn" : "coin"} />
                <span>Schuldet {AGENT_DISPLAY[l.creditor]} {gr(l.amount)} (fällig Tag {dueDay(l)}){overdue ? " – überfällig" : ""}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="sec">
        <div className="sec-h"><span>Kennt</span></div>
        <div className="chips">
          {known.length ? known.map((a) => (
            <button key={a} className="chipx" onClick={() => selectAgent(a)} title={`${AGENT_DISPLAY[a]} ansehen`}>
              <Icon name="user" />{AGENT_DISPLAY[a]}
            </button>
          )) : <span className="muted">Kennt noch niemanden.</span>}
        </div>
      </div>

      <RecentThoughts agent={selectedAgent} />

      <div className="sec">
        <div className="sec-h"><span>{first} befragen</span></div>
        <div className="talk">
          <textarea
            className="inp"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void askAgent(); } }}
            placeholder="Frag etwas …"
            aria-label={`Frage an ${first}`}
          />
          <button className="btn block" onClick={() => void askAgent()} disabled={interviewing || !question.trim()}>
            <Icon name="send" />{interviewing ? "Antwort kommt …" : "Fragen"}
          </button>
          {answer && <div ref={answerRef} className="answer">{answer}</div>}
        </div>
      </div>

      <div className="sec">
        <div className="sec-h"><span>Gerücht zuflüstern</span><small>Wird in der nächsten Stunde gehört</small></div>
        <div className="row">
          <input
            type="text"
            className="inp"
            value={whisper}
            onChange={(e) => setWhisper(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void whisperRumor(); }}
            placeholder="Gerücht streuen …"
            aria-label={`Gerücht für ${first}`}
          />
          <button className="btn" onClick={() => void whisperRumor()} disabled={whispering || !whisper.trim()}>
            {whispering ? "…" : "Flüstern"}
          </button>
        </div>
        {whisperNote && <div className={`note ${whisperNote.ok ? "good" : "bad"}`}><Icon name={whisperNote.ok ? "check" : "warn"} />{whisperNote.text}</div>}
      </div>
    </div>
  );
}
