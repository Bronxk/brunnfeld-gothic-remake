import { useEffect, useId, useRef, useState } from "react";
import { useVillageStore, type PlayerSkillChoice } from "../store";
import Icon, { ItemIcon, skillIcon } from "./Icon";

interface SkillCard {
  id: PlayerSkillChoice;
  label: string;
  place: string;
  flavor: string;
  /** Whether the start kit includes a Werkzeug (mirrors src/player.ts createPlayer: skills with tool recipes). */
  tool: boolean;
}

const SKILLS: SkillCard[] = [
  {
    id: "bauer", label: "Feldarbeiter", place: "Unterfeld", tool: true,
    flavor: "Du kennst Furchen, Gerste und Rüben. Auf dem Unterfeld wirst du gebraucht.",
  },
  {
    id: "knappe", label: "Knappe", place: "Erzstollen", tool: true,
    flavor: "Staub in der Lunge, Eisenerz in den Händen. Der Stollen hungert nach Leuten.",
  },
  {
    id: "holzfaeller", label: "Holzfäller", place: "Köhlerwald", tool: true,
    flavor: "Axt, Stamm und Köhlerrauch. Ohne Holz brennt keine Esse.",
  },
  {
    id: "none", label: "ohne Handwerk", place: "Zechenplatz", tool: false,
    flavor: "Keine Zunft, keine Pflichten. Du nimmst, was der Tag bringt, und handelst auf dem Platz.",
  },
];

const NAME_MIN = 2;
const NAME_MAX = 20;

/**
 * Full-screen overlay: pick a name and a trade, then POST /api/player/create.
 * "Nur zuschauen" remembers the choice (localStorage, see store.setSpectating).
 */
export default function CharacterCreation() {
  const createPlayer = useVillageStore((s) => s.createPlayer);
  const setSpectating = useVillageStore((s) => s.setSpectating);
  const [name, setName] = useState("");
  const [skill, setSkill] = useState<PlayerSkillChoice>("bauer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const errId = useId();

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setSpectating(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, setSpectating]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      setError(`Der Name muss zwischen ${NAME_MIN} und ${NAME_MAX} Zeichen lang sein.`);
      nameRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    const res = await createPlayer(trimmed, skill);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Das hat nicht geklappt.");
      nameRef.current?.focus();
    }
    // On success the store flips world.player.created and App unmounts this overlay.
  }

  const chosen = SKILLS.find((s) => s.id === skill)!;

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form className="modal create" onSubmit={submit} noValidate>
        <h2 id={titleId}>Der Neue im Tal</h2>
        <p className="create-intro">
          Du bist der Letzte, den die Wachen ins Schlackental gebracht haben. Kurz danach hat der Bergsturz den Kehlpass
          verschüttet. Keine Karren kommen mehr, und Erz ist plötzlich weniger wert als Brot.
          Wer bist du, und was kannst du?
        </p>

        <label htmlFor="pc-name">Dein Name</label>
        <input
          id="pc-name"
          ref={nameRef}
          className="inp"
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
          maxLength={NAME_MAX}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          placeholder="z. B. Ansgar"
          aria-describedby={error ? errId : undefined}
          aria-invalid={error ? true : undefined}
          disabled={busy}
        />
        <div className="create-hint">{NAME_MIN} bis {NAME_MAX} Zeichen, nur Buchstaben.</div>

        <fieldset className="skills" disabled={busy}>
          <legend>Dein Handwerk</legend>
          {SKILLS.map((s) => (
            <label key={s.id} className="skill" data-on={skill === s.id}>
              <input
                type="radio"
                name="pc-skill"
                value={s.id}
                checked={skill === s.id}
                onChange={() => setSkill(s.id)}
              />
              <span className="skill-ico"><Icon name={skillIcon(s.id)} /></span>
              <span className="skill-tx">
                <b>{s.label}</b>
                <span className="skill-pl"><Icon name="pin" />{s.place}</span>
                <small>{s.flavor}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="create-kit" aria-live="polite">
          <span className="kit-l">Du startest mit</span>
          <span className="kit-v">
            <Icon name="coin" />15 Groschen, 2× Brot{chosen.tool ? ", Werkzeug" : ""}
            <span className="kit-items" aria-hidden="true">
              <ItemIcon item="brot" size={20} />
              {chosen.tool && <ItemIcon item="werkzeug" size={20} />}
            </span>
          </span>
        </div>

        {error && (
          <div id={errId} className="note bad" role="alert">
            <Icon name="warn" />{error}
          </div>
        )}

        <div className="create-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name={busy ? "hourglass" : "feet"} className={busy ? "spin" : ""} />
            {busy ? "Du wirst ins Tal gebracht …" : "Ins Tal"}
          </button>
          <button type="button" className="btn" onClick={() => setSpectating(true)} disabled={busy}>
            <Icon name="eye" />Nur zuschauen
          </button>
        </div>
      </form>
    </div>
  );
}
