import { useEffect, useState } from "react";
import { useVillageStore } from "../store";
import Icon from "./Icon";

interface Props {
  onWorldGenerated?: () => void;
  /** When given, the dialog can be dismissed (Escape, backdrop, "Abbrechen"). */
  onClose?: () => void;
  /** Before the first tick: offer to start the world that is already on disk, without regenerating. */
  canStartExisting?: boolean;
}

const VILLAGE_OPTIONS = [1, 2, 3, 5];
/** Schlackental always keeps its 19 hand-written colonists; this sizes each neighbour colony. */
const NEIGHBOUR_OPTIONS = [6, 8, 12, 20];
const SCHLACKENTAL_CAST = 19;

function readSaved(key: string, fallback: number): number {
  try {
    const saved = localStorage.getItem(key);
    return saved ? Number(saved) : fallback;
  } catch {
    return fallback; // storage can be blocked (private mode)
  }
}

function save(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch (err) {
    console.warn("[viewer] could not persist world settings", err);
  }
}

export default function ScaleSelector({ onWorldGenerated, onClose, canStartExisting }: Props) {
  const setVillages = useVillageStore((s) => s.setVillages);
  const setActiveVillageId = useVillageStore((s) => s.setActiveVillageId);
  const setWorld = useVillageStore((s) => s.setWorld);
  const existing = useVillageStore((s) => s.villages);
  const existingAgents = existing.reduce((n, v) => n + v.agentCount, 0);

  // The world on disk wins over an old browser choice, so "Welt erzeugen" never shrinks it by surprise.
  const [numVillages, setNumVillages] = useState(() =>
    existing.length > 0 ? existing.length : readSaved("schlackental:numVillages", 3));
  // The village list can arrive after the dialog opened.
  useEffect(() => { if (existing.length > 0) setNumVillages(existing.length); }, [existing.length]);
  const [neighbourAgents, setNeighbourAgents] = useState(() => readSaved("schlackental:neighbourAgents", 8));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartExisting = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/start", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onWorldGenerated?.();
    } catch (e) {
      console.error("[viewer] starting the existing world failed", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !generating) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, generating]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    save("schlackental:numVillages", numVillages);
    save("schlackental:neighbourAgents", neighbourAgents);
    try {
      const res = await fetch("/api/generate-world", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ villages: numVillages, neighbourAgents }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Unbekannter Fehler");

      // Reload world state + village list with the newly generated data
      const [stateRes, villagesRes] = await Promise.all([fetch("/api/state"), fetch("/api/villages")]);
      const newState = await stateRes.json();
      const villages = await villagesRes.json();
      setWorld(newState);
      setVillages(villages);
      setActiveVillageId(villages[0]?.id ?? "schlackental");

      // Start the simulation
      await fetch("/api/start", { method: "POST" });
      onWorldGenerated?.();
    } catch (e) {
      console.error("[viewer] world generation failed", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const total = SCHLACKENTAL_CAST + (numVillages - 1) * neighbourAgents;
  const showExisting = !!canStartExisting && existing.length > 0;

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget && onClose && !generating) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="world-title">
        <h2 id="world-title">{showExisting ? "Das Tal wartet" : "Neue Welt"}</h2>
        {showExisting ? (
          <>
            <p className="lead">
              Bereit: {existing.map((v) => v.name).join(", ")} mit {existingAgents} Kolonisten. Start, oder vorher eine andere Welt erzeugen.
            </p>
            <button className="btn primary" style={{ width: "100%", marginBottom: 18 }} disabled={generating} onClick={() => void handleStartExisting()}>
              <Icon name="next" />Diese Welt starten
            </button>
            <label>Oder neu erzeugen</label>
          </>
        ) : (
          <p className="lead">Lege fest, wie groß das Tal wird, bevor die Simulation startet.</p>
        )}

        <label>Kolonien</label>
        <div className="opts" role="group" aria-label="Anzahl Kolonien">
          {VILLAGE_OPTIONS.map((n) => (
            <button key={n} className="chip" aria-pressed={numVillages === n} onClick={() => setNumVillages(n)} autoFocus={n === numVillages}>
              {n === 1 ? "Nur Schlackental" : `${n} Kolonien`}
            </button>
          ))}
        </div>

        {numVillages > 1 && (
          <>
            <label>Kolonisten pro Nachbarkolonie</label>
            <div className="opts" role="group" aria-label="Kolonisten pro Nachbarkolonie">
              {NEIGHBOUR_OPTIONS.map((n) => (
                <button key={n} className="chip" aria-pressed={neighbourAgents === n} onClick={() => setNeighbourAgents(n)}>{n}</button>
              ))}
            </div>
          </>
        )}

        <div className="muted" style={{ marginBottom: 14 }}>Kolonisten insgesamt: {total} · mit Haiku ≈ {Math.max(1, Math.round(total * 0.2))} ct pro Tick (geschätzt)</div>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className={showExisting ? "btn" : "btn primary"} style={{ flex: 1, minWidth: 160 }} disabled={generating} onClick={() => void handleGenerate()}>
            <Icon name="globe" />{generating ? "Erzeuge …" : "Welt erzeugen"}
          </button>
          {onClose && (
            <button className="btn" disabled={generating} onClick={onClose}>Abbrechen</button>
          )}
        </div>

        {error && <div className="note bad" role="alert"><Icon name="warn" />{error}</div>}
      </div>
    </div>
  );
}
