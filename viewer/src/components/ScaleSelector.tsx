import { useEffect, useState } from "react";
import { useVillageStore } from "../store";
import Icon from "./Icon";

interface Props {
  onWorldGenerated?: () => void;
  /** When given, the dialog can be dismissed (Escape, backdrop, "Abbrechen"). */
  onClose?: () => void;
}

const VILLAGE_OPTIONS = [1, 2, 3, 5];
const AGENT_OPTIONS = [19, 30, 50, 100, 200];

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

export default function ScaleSelector({ onWorldGenerated, onClose }: Props) {
  const setVillages = useVillageStore((s) => s.setVillages);
  const setActiveVillageId = useVillageStore((s) => s.setActiveVillageId);
  const setWorld = useVillageStore((s) => s.setWorld);

  const [numVillages, setNumVillages] = useState(() => readSaved("schlackental:numVillages", 1));
  const [agentsPerVillage, setAgentsPerVillage] = useState(() => readSaved("schlackental:agentsPerVillage", 19));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    save("schlackental:agentsPerVillage", agentsPerVillage);
    try {
      const res = await fetch("/api/generate-world", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ villages: numVillages, agentsPerVillage }),
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

  const total = numVillages === 1 ? 19 : numVillages * agentsPerVillage;

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget && onClose && !generating) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="world-title">
        <h2 id="world-title">Neue Welt</h2>
        <p className="lead">Lege fest, wie groß das Tal wird, bevor die Simulation startet.</p>

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
            <label>Kolonisten pro Kolonie</label>
            <div className="opts" role="group" aria-label="Kolonisten pro Kolonie">
              {AGENT_OPTIONS.map((n) => (
                <button key={n} className="chip" aria-pressed={agentsPerVillage === n} onClick={() => setAgentsPerVillage(n)}>{n}</button>
              ))}
            </div>
          </>
        )}

        <div className="muted" style={{ marginBottom: 14 }}>Kolonisten insgesamt: {total}</div>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn primary" style={{ flex: 1, minWidth: 160 }} disabled={generating} onClick={() => void handleGenerate()}>
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
