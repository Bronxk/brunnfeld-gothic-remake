import { useState } from "react";
import { getItemIconUrl } from "../canvas/sprites";
import { itemLabel } from "../types";

/** Line icons (24×24, stroke = currentColor). Ported from the approved design demo. */
const ICONS = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cloud: '<path d="M7 18h10.5a3.8 3.8 0 0 0 .3-7.6A5.5 5.5 0 0 0 7.3 9.3 4.4 4.4 0 0 0 7 18z"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.4-3.8 3.2-6 7-6s6.6 2.2 7 6"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><circle cx="17" cy="9.5" r="2.4"/><path d="M3 19c.3-3.3 2.7-5 6-5s5.7 1.7 6 5M16 14.2c2.6 0 4.7 1.4 5 4.3"/>',
  pin: '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.2"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  chart: '<path d="M4 4v16h16"/><path d="M8 15l3.5-4 3 2.5L19 7"/>',
  bell: '<path d="M6 17v-5.5a6 6 0 0 1 12 0V17l1.8 2H4.2z"/><path d="M10 21h4"/>',
  book: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
  speech: '<path d="M4 5h16v11H10.5L6 20v-4H4z"/>',
  hammer: '<path d="M13.5 4.5l6 6-3 3-6-6z"/><path d="M11.8 9.2L4 17l3 3 7.8-7.8"/>',
  feet: '<path d="M8.5 3.5c1.8 0 2.8 1.8 2.8 3.9S10 11 8.5 11 5.7 9.3 5.7 7.4 6.7 3.5 8.5 3.5z"/><path d="M15.5 12.5c1.8 0 2.8 1.8 2.8 3.9s-1.3 3.6-2.8 3.6-2.8-1.7-2.8-3.6 1-3.9 2.8-3.9z"/>',
  chev: '<path d="M6 15l6-6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  coin: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/>',
  scale: '<path d="M12 4v16M7 20h10M5 7h14"/><path d="M5 7l-3 6.5a3 3 0 0 0 6 0zM19 7l-3 6.5a3 3 0 0 0 6 0z"/>',
  rock: '<path d="M3 20l6-12 4 6 3-4 5 10z"/><path d="M12 3v2.5M6.5 4.5L8 6.5M17.5 4.5L16 6.5"/>',
  cart: '<path d="M3 5.5h3l2.2 9.5h9.8l2-7.5H7"/><circle cx="10" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  brain: '<path d="M9 5a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 3 4 3 3 0 0 0 4 1V5.5A2.5 2.5 0 0 0 9 5zM15 5a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-3 4 3 3 0 0 1-4 1V5.5A2.5 2.5 0 0 1 15 5z"/>',
  send: '<path d="M4 12l16-7-6 15-2.5-6z"/>',
  // additions for status / events
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  skull: '<path d="M12 3.5c-4 0-7 2.7-7 6.5 0 2.2 1 3.6 2.5 4.6V18h9v-3.4c1.5-1 2.5-2.4 2.5-4.6 0-3.8-3-6.5-7-6.5z"/><circle cx="9.3" cy="10.5" r="1.3"/><circle cx="14.7" cy="10.5" r="1.3"/><path d="M10.5 18v2.5M13.5 18v2.5"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7"/>',
  wheat: '<path d="M12 21V8M12 8c-2.4 0-3.5-1.6-3.5-3.5C10.4 4.5 12 5.8 12 8zM12 8c2.4 0 3.5-1.6 3.5-3.5C13.6 4.5 12 5.8 12 8zM12 13c-2.4 0-3.7-1.6-3.7-3.5 2 0 3.7 1.3 3.7 3.5zM12 13c2.4 0 3.7-1.6 3.7-3.5-2 0-3.7 1.3-3.7 3.5zM12 18c-2.4 0-3.7-1.6-3.7-3.5 2 0 3.7 1.3 3.7 3.5zM12 18c2.4 0 3.7-1.6 3.7-3.5-2 0-3.7 1.3-3.7 3.5z"/>',
  dagger: '<path d="M14 3l6 1 1 6-9.5 9.5-7-7z"/><path d="M5.5 14.5L3 17M8.5 17.5L6 20"/>',
  flame: '<path d="M12 3c.5 3.3-3.6 4.8-3.6 9 0 2.3 1.5 4 3.6 4s3.6-1.7 3.6-4c0-1.2-.5-2.3-1.2-3.2-.2 1.2-.9 1.9-1.6 2 .8-2.6-.2-5.4-.8-7.8z"/><path d="M8.5 20h7"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  bandage: '<path d="M5 15.5l10.5-10.5 3.5 3.5L8.5 19z"/><path d="M11 9.5l3.5 3.5M9.5 11l.01 0M12 13.5l.01 0"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.2 3.6 8.5s-1 6.1-3.6 8.5c-2.6-2.4-3.6-5.2-3.6-8.5S9.4 5.9 12 3.5z"/>',
  gavel: '<path d="M13 4.5l6 6-3 3-6-6z"/><path d="M11.5 9L4 16.5 7.5 20 15 12.5"/><path d="M4 21h8"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4 4.5 5 4.5 8.5s-4.5 4.5-4.5 8.5M16.5 3.5c0 4-4.5 5-4.5 8.5s4.5 4.5 4.5 8.5"/>',
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  mine: '<path d="M13.5 4.5l6 6M5 20l9-9M4 7c3-3.5 8-4.5 12-2.5-1 .5-2 1.2-2.8 2L9 11.2"/>',
} as const;

export type IconName = keyof typeof ICONS;

export default function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <span
      className={`ic ${className}`.trim()}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>` }}
    />
  );
}

/** Pixel item icon from the sprite pack, with a generic box icon as fallback. */
export function ItemIcon({ item, size = 22 }: { item: string; size?: number }) {
  const url = getItemIconUrl(item);
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <span className="ic ph" style={{ width: size, height: size, fontSize: size * 0.8 }} aria-hidden="true">
        <Icon name="box" />
      </span>
    );
  }
  return <img className="itemimg" src={url} alt={itemLabel(item)} width={size} height={size} loading="lazy" onError={() => setBroken(true)} />;
}
