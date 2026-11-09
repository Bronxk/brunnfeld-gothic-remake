import { useState } from "react";
import { useVillageStore, AGENT_DISPLAY, colonistIds } from "../store";
import { AGENDA_LABELS, EVENT_LABELS } from "../types";
import Icon, { type IconName } from "./Icon";
import ScaleSelector from "./ScaleSelector";

type Tone = "info" | "warn" | "bad" | "good";

interface EventDef {
  id: string;
  icon: IconName;
  tone: Tone;
  desc: string;
}

/** Events the "Schicksal" section can fire (ids are the backend EventType ids; names per world bible). */
const EVENTS: EventDef[] = [
  { id: "drought", icon: "sun", tone: "warn", desc: "Halbiert die Ernte auf den Feldern für 3 Tage." },
  { id: "caravan", icon: "cart", tone: "good", desc: "Schmuggler bringen billige Waren aufs Tauschbrett (1 Tag)." },
  { id: "mine_collapse", icon: "rock", tone: "bad", desc: "Die Erzförderung ist blockiert (2 Tage)." },
  { id: "double_harvest", icon: "wheat", tone: "good", desc: "Der Ernteertrag ist heute doppelt so hoch." },
  { id: "plague_rumor", icon: "skull", tone: "warn", desc: "Gerüchte um das Grubenfieber: Panikkäufe bei Arznei." },
  { id: "bandit_threat", icon: "dagger", tone: "bad", desc: "Erhöhtes Diebstahlrisiko für 2 Tage." },
];

const EXTRA_ICONS: Record<string, { icon: IconName; tone: Tone }> = {
  plague: { icon: "skull", tone: "bad" },
  tax_day: { icon: "scale", tone: "info" },
};

const PHASE_LABEL = { discussion: "Beratung", vote: "Abstimmung", result: "Ergebnis" } as const;

export default function GodModePanel() {
  const world = useVillageStore((s) => s.world);
  const activeMeeting = useVillageStore((s) => s.activeMeeting);
  const [firing, setFiring] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [showScaleSelector, setShowScaleSelector] = useState(false);
  const [agendaType, setAgendaType] = useState("general_rule");
  const [agendaDesc, setAgendaDesc] = useState("");
  const [target, setTarget] = useState("");
  const [meetingStatus, setMeetingStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [callingMeeting, setCallingMeeting] = useState(false);

  const activeEvents = world?.active_events ?? [];
  const currentTick = world?.current_tick ?? 0;
  const colonists = world ? colonistIds(world) : [];

  async function callMeeting() {
    if (!agendaDesc.trim()) { setMeetingStatus({ ok: false, text: "Bitte eine Tagesordnung eingeben." }); return; }
    if (agendaType === "banishment" && !target) { setMeetingStatus({ ok: false, text: "Bitte wählen, wer in den Karzer soll." }); return; }
    setCallingMeeting(true);
    setMeetingStatus(null);
    try {
      const res = await fetch("/api/events/trigger-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agendaType,
          description: agendaDesc.trim(),
          ...(agendaType === "banishment" && target ? { target } : {}),
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      setMeetingStatus(data.ok
        ? { ok: true, text: "Appell einberufen. Die Grubenglocke läutet." }
        : { ok: false, text: data.error ?? "Das hat nicht geklappt." });
      if (data.ok) setAgendaDesc("");
    } catch (err) {
      console.error("[viewer] trigger-meeting failed", err);
      setMeetingStatus({ ok: false, text: "Anfrage fehlgeschlagen." });
    } finally {
      setCallingMeeting(false);
    }
  }

  async function fireEvent(id: string) {
    setFiring(id);
    setEventError(null);
    try {
      const res = await fetch("/api/events/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("[viewer] trigger event failed", err);
      setEventError(`${EVENT_LABELS[id] ?? id} konnte nicht ausgelöst werden.`);
    } finally {
      setFiring(null);
    }
  }

  const canCall = !callingMeeting && !!agendaDesc.trim();

  return (
    <div>
      {/* Lage im Tal */}
      <div className="sec">
        <div className="sec-h">
          <span>Lage im Tal</span>
          <small>{activeEvents.length + (activeMeeting ? 1 : 0)} Meldungen</small>
        </div>
        <div className="evs">
          {activeMeeting && (
            <div className="evc" data-tone="info">
              <span className="eico"><Icon name="bell" /></span>
              <div>
                <h3>Appell <span className="st">{PHASE_LABEL[activeMeeting.phase]}</span></h3>
                <p>{activeMeeting.description}</p>
                <div className="meta">
                  <span><Icon name="users" />{activeMeeting.attendees.length} geladen</span>
                  <span><Icon name="pin" />Vogtei</span>
                </div>
              </div>
            </div>
          )}
          {activeEvents.map((ev, i) => {
            const def = EVENTS.find((e) => e.id === ev.type);
            const extra = EXTRA_ICONS[ev.type];
            const left = Math.max(0, ev.endTick - currentTick);
            return (
              <div key={`${ev.type}-${i}`} className="evc" data-tone={def?.tone ?? extra?.tone ?? "warn"}>
                <span className="eico"><Icon name={def?.icon ?? extra?.icon ?? "warn"} /></span>
                <div>
                  <h3>{EVENT_LABELS[ev.type] ?? ev.type} <span className="st">aktiv</span></h3>
                  <p>{ev.description}</p>
                  <div className="meta">
                    <span><Icon name="hourglass" />noch {left} {left === 1 ? "Stunde" : "Stunden"}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {activeEvents.length === 0 && !activeMeeting && (
            <div className="empty"><Icon name="check" /><span>Im Tal ist es ruhig.</span><small>Aktive Ereignisse erscheinen hier.</small></div>
          )}
        </div>
      </div>

      {/* Schicksal auslösen */}
      <div className="sec">
        <div className="sec-h"><span>Schicksal auslösen</span><small>greift sofort ein</small></div>
        <div className="evs">
          {EVENTS.map((ev) => {
            const isActive = activeEvents.some((a) => a.type === ev.id);
            const isFiring = firing === ev.id;
            return (
              <button key={ev.id} className="evc" data-tone={isActive ? "plain" : ev.tone} disabled={isFiring || isActive} onClick={() => void fireEvent(ev.id)}
                title={isActive ? "Läuft bereits" : `${EVENT_LABELS[ev.id]} auslösen`}>
                <span className="eico">{isFiring ? <Icon name="hourglass" className="spin" /> : <Icon name={ev.icon} />}</span>
                <div>
                  <h3>{EVENT_LABELS[ev.id]} {isActive && <span className="st">läuft</span>}</h3>
                  <p>{ev.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
        {eventError && <div className="note bad" role="alert"><Icon name="warn" />{eventError}</div>}
      </div>

      {/* Appell */}
      <div className="sec">
        <div className="sec-h"><span>Appell einberufen</span><small>Grubenglocke</small></div>
        <div className="talk">
          <select className="inp" aria-label="Thema des Appells" value={agendaType}
            onChange={(e) => { setAgendaType(e.target.value); setTarget(""); setMeetingStatus(null); }}>
            {Object.entries(AGENDA_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <textarea className="inp" rows={2} value={agendaDesc} placeholder="Worüber soll beraten werden?" aria-label="Tagesordnung"
            onChange={(e) => { setAgendaDesc(e.target.value); setMeetingStatus(null); }} />
          {agendaType === "banishment" && (
            <select className="inp" aria-label="Wer kommt in den Karzer?" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Wer kommt in den Karzer?</option>
              {colonists.map((a) => <option key={a} value={a}>{AGENT_DISPLAY[a]}</option>)}
            </select>
          )}
          <button className="btn primary block" onClick={() => void callMeeting()} disabled={!canCall}>
            <Icon name="bell" />{callingMeeting ? "Läutet …" : "Appell jetzt einberufen"}
          </button>
          {meetingStatus && (
            <div className={`note ${meetingStatus.ok ? "good" : "bad"}`} role="status">
              <Icon name={meetingStatus.ok ? "check" : "warn"} />{meetingStatus.text}
            </div>
          )}
        </div>
      </div>

      {/* Welt */}
      <div className="sec">
        <div className="sec-h"><span>Welt</span></div>
        <button className="btn block" onClick={() => setShowScaleSelector(true)}>
          <Icon name="globe" />Neue Welt erzeugen …
        </button>
      </div>

      {showScaleSelector && (
        <ScaleSelector onWorldGenerated={() => setShowScaleSelector(false)} onClose={() => setShowScaleSelector(false)} />
      )}
    </div>
  );
}
