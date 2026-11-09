import { useVillageStore, type Toast } from "../store";
import Icon, { type IconName } from "./Icon";

const TONE_ICON: Record<Toast["tone"], IconName> = { good: "check", warn: "warn", bad: "warn", info: "bell" };

/** Result toasts for the human player's actions (stacked at the top, announced politely to screen readers). */
export default function Toasts() {
  const toasts = useVillageStore((s) => s.toasts);
  const dismiss = useVillageStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone}>
          <Icon name={TONE_ICON[t.tone]} />
          <span className="toast-t">{t.text}</span>
          <button type="button" className="iconbtn" onClick={() => dismiss(t.id)} aria-label="Meldung schließen"><Icon name="x" /></button>
        </div>
      ))}
    </div>
  );
}
