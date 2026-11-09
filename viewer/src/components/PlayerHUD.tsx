import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useVillageStore } from "../store";
import { useIsMobile } from "../theme";
import { itemLabel, SLEEP_LABELS, type PlayerView } from "../types";
import Icon, { ItemIcon, skillIcon, type IconName } from "./Icon";
import Avatar from "./Avatar";
import PlayerActions from "./PlayerActions";
import { Bar, STATUS_META, energyFill, energyTone, getStatusBucket, hungerFill, hungerTone } from "./AgentPanel";

// ─── pieces ───────────────────────────────────────────────────

/** Budgeted actions per in-game hour (the backend sends budget + budgetLeft). */
function Pips({ left, total }: { left: number; total: number }) {
  return (
    <div className="pips-row" title="Aktionen, die du in dieser Stunde noch hast">
      <span className="pips-l">Aktionen</span>
      <span className="pips" role="img" aria-label={`${left} von ${total} Aktionen übrig`}>
        {Array.from({ length: total }, (_, i) => <i key={i} data-on={i < left} />)}
      </span>
      <span className={`pips-v mono${left <= 0 ? " out" : ""}`}>{left <= 0 ? "erschöpft" : `${left}/${total}`}</span>
    </div>
  );
}

function Collapse({ title, icon, count, open, onToggle, children }: {
  title: string; icon: IconName; count?: number; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="hud-coll" data-open={open}>
      <button type="button" className="hud-coll-h" aria-expanded={open} onClick={onToggle}>
        <Icon name={icon} />
        <span>{title}</span>
        {count != null && count > 0 && <small className="mono">{count}</small>}
        <Icon name="chev" className="chev-i" />
      </button>
      {open && <div className="hud-coll-b">{children}</div>}
    </div>
  );
}

const DIARY_ICON: Record<string, IconName> = { result: "check", fail: "warn", heard: "speech" };

function Diary() {
  const diary = useVillageStore((s) => s.diary);
  if (diary.length === 0) return <div className="muted hud-empty">Noch nichts passiert. Dein Tagebuch füllt sich mit dem, was du tust und hörst.</div>;
  return (
    <ul className="diary">
      {diary.map((d) => (
        <li key={d.id} data-k={d.kind}>
          <Icon name={DIARY_ICON[d.kind] ?? "check"} />
          <span>{d.text}</span>
          {d.time && <time>{d.time}</time>}
        </li>
      ))}
    </ul>
  );
}

function Inventory({ player }: { player: PlayerView }) {
  const items = player.inventory.filter((i) => i.quantity > 0);
  const tool = player.tool;
  if (items.length === 0 && !tool) return <div className="hud-inv"><div className="hud-slot empty">Nichts dabei</div></div>;
  return (
    <div className="hud-inv">
      {items.map((i) => {
        const avail = i.quantity - (i.reserved ?? 0);
        return (
          <div key={i.type} className="hud-slot" title={`${itemLabel(i.type)}: ${avail} verfügbar${i.reserved ? `, ${i.reserved} reserviert` : ""}`}>
            <ItemIcon item={i.type} size={22} />
            <span>{i.quantity}× {itemLabel(i.type)}</span>
          </div>
        );
      })}
      {tool && (
        <div className="hud-slot tool" title={`Werkzeug: ${tool.durability} % Zustand`}>
          <ItemIcon item={tool.type} size={22} />
          <span>
            {itemLabel(tool.type)}
            <span className="dur" role="meter" aria-label="Zustand des Werkzeugs" aria-valuenow={tool.durability} aria-valuemin={0} aria-valuemax={100}>
              <b style={{ ["--p" as string]: `${Math.max(0, Math.min(100, tool.durability))}%`, ["--c" as string]: tool.durability > 50 ? "var(--good)" : tool.durability > 20 ? "var(--warn)" : "var(--bad)" }} />
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// ─── card body (shared by desktop card and mobile sheet) ──────

function HudBody({ player, seeOpen }: { player: PlayerView; seeOpen: boolean }) {
  const focusPlayer = useVillageStore((s) => s.focusPlayer);
  const diary = useVillageStore((s) => s.diary);
  const [see, setSee] = useState(seeOpen);
  const [book, setBook] = useState(false);
  const body = player.body;
  const bucket = body ? getStatusBucket(body) : "ok";

  return (
    <>
      <div className="hud-head">
        <button type="button" className="hud-avatar-btn" onClick={focusPlayer} aria-label="Auf der Karte zeigen" title="Auf der Karte zeigen">
          <Avatar agent="player" skill={player.skill} size={46} />
        </button>
        <div className="hud-id">
          <div className="hud-kicker">Du spielst</div>
          <div className="hud-name">{player.name}</div>
        </div>
        <div className="hud-purse" title="Geldbeutel"><Icon name="coin" />{player.wallet}<small>Gr.</small></div>
      </div>

      <div className="hud-meta">
        <span className="chipx"><Icon name={skillIcon(player.skill)} />{player.skillLabel ?? player.skill}</span>
        <span className="chipx" title="Dein Ort"><Icon name="pin" />{player.location ?? "—"}</span>
        {player.time && <span className="chipx" title="Uhrzeit"><Icon name="clock" />{player.time}</span>}
        {bucket !== "ok" && (
          <span className={`chipx ${STATUS_META[bucket].tone === "dead" ? "" : STATUS_META[bucket].tone}`}>
            <Icon name={STATUS_META[bucket].icon} />{STATUS_META[bucket].label}
          </span>
        )}
      </div>

      {body && (
        <div className="hud-bars">
          <Bar label="Hunger" pct={hungerFill(body.hunger)} color={hungerTone(body.hunger)} value={body.hunger}
            title={`Hunger ${body.hunger} von 5 (Balken zeigt Sättigung)`} />
          <Bar label="Kraft" pct={energyFill(body.energy)} color={energyTone(body.energy)} value={body.energy}
            title={`Kraft ${body.energy} von 10, Schlaf: ${SLEEP_LABELS[body.sleep_quality] ?? body.sleep_quality}`} />
        </div>
      )}

      <Pips left={player.budgetLeft} total={player.budget} />
      <Inventory player={player} />
      <PlayerActions />

      <Collapse title="Was du siehst" icon="eye" open={see} onToggle={() => setSee((v) => !v)}>
        {player.perception
          ? <div className="see">{player.perception}</div>
          : <div className="muted hud-empty">Wird geladen …</div>}
      </Collapse>
      <Collapse title="Tagebuch" icon="book" count={diary.length} open={book} onToggle={() => setBook((v) => !v)}>
        <Diary />
      </Collapse>
    </>
  );
}

// ─── mounts ───────────────────────────────────────────────────

function MobileHud({ player }: { player: PlayerView }) {
  const [open, setOpen] = useState(false);
  const body = player.body;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="hud-m" aria-expanded={open} aria-label="Deine Figur öffnen" onClick={() => setOpen(true)}>
        <Avatar agent="player" skill={player.skill} size={34} />
        <span className="hud-m-id">
          <b>{player.name}</b>
          <small>{player.location ?? "—"}</small>
        </span>
        {body && (
          <span className="minibars" aria-hidden="true">
            <span className="mb"><b style={{ ["--p" as string]: `${hungerFill(body.hunger)}%`, ["--c" as string]: hungerTone(body.hunger) }} /></span>
            <span className="mb"><b style={{ ["--p" as string]: `${energyFill(body.energy)}%`, ["--c" as string]: energyTone(body.energy) }} /></span>
          </span>
        )}
        <span className="pips" role="img" aria-label={`${player.budgetLeft} von ${player.budget} Aktionen übrig`}>
          {Array.from({ length: player.budget }, (_, i) => <i key={i} data-on={i < player.budgetLeft} />)}
        </span>
        <span className="hud-m-gr mono"><Icon name="coin" />{player.wallet}</span>
        <Icon name="chev" className="hud-m-chev" />
      </button>

      {open && createPortal(
        <>
          <div className="hud-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="hud-sheet" role="dialog" aria-modal="true" aria-label="Deine Figur">
            <div className="hud-sheet-bar">
              <i />
              <button type="button" className="iconbtn" onClick={() => setOpen(false)} aria-label="Schließen"><Icon name="x" /></button>
            </div>
            <div className="hud-sheet-body">
              <HudBody player={player} seeOpen />
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function DesktopHud({ player }: { player: PlayerView }) {
  const [folded, setFolded] = useState(false);
  return (
    <section className="hud" data-folded={folded} aria-label="Deine Figur">
      <button type="button" className="hud-fold" aria-expanded={!folded} onClick={() => setFolded((v) => !v)}
        aria-label={folded ? "Figur ausklappen" : "Figur einklappen"} title={folded ? "Ausklappen" : "Einklappen"}>
        <Icon name="chev" />
      </button>
      {folded ? (
        <div className="hud-folded">
          <b>{player.name}</b>
          <span className="muted">{player.location ?? "—"}</span>
          <span className="hud-purse"><Icon name="coin" />{player.wallet}<small>Gr.</small></span>
        </div>
      ) : (
        <div className="hud-scroll"><HudBody player={player} seeOpen={false} /></div>
      )}
    </section>
  );
}

/** Player card for the human colonist. Renders into #player-hud-slot (see App). */
export default function PlayerHUD() {
  const player = useVillageStore((s) => s.player);
  const created = useVillageStore((s) => s.world?.player?.created === true);
  const isMobile = useIsMobile();
  if (!created || !player?.created) return null;
  return isMobile ? <MobileHud player={player} /> : <DesktopHud player={player} />;
}
