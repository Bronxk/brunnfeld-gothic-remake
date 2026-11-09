import { useSyncExternalStore } from "react";

/**
 * Design tokens for the Schlackental viewer chrome (variant "A – Grubenlampe").
 *
 * Single source of truth: `palette` holds the real values, `injectTheme()` writes them as CSS custom
 * properties plus the global stylesheet (`globalCss`). Components use `c.*` (= `var(--token)`) in inline
 * styles and class names for anything interactive (hover / focus-visible / media queries need real CSS).
 * Rule: no hex literals in components, no coloured accent stripes (no border-left/::before bars) — status is
 * icon + tinted surface + thin border all around.
 */

export const palette = {
  bg: "#0c0a09",
  panel: "#14100d",
  panel2: "#1b1612",
  panel3: "#241d16",
  ink: "#ecdcbc",
  ink2: "#a2916f",
  ink3: "#8a7a58",
  line: "#3a2e21",
  line2: "#52422e",
  accent: "#f2a93b",
  accentInk: "#1a1108",
  good: "#9cc46a",
  warn: "#e8b04a",
  bad: "#e56a45",
  info: "#7fb0c4",
} as const;

export type ColorToken = keyof typeof palette;

const cssName = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** Colour tokens as CSS variable references, usable in inline styles: `style={{ color: c.ink2 }}`. */
export const c = Object.fromEntries(
  (Object.keys(palette) as ColorToken[]).map((k) => [k, `var(--${cssName(k)})`]),
) as Record<ColorToken, string>;

/** Semi-transparent tint of a token, e.g. `tint("good", 12)` → 12 % good over transparent. */
export function tint(token: ColorToken, pct: number): string {
  return `color-mix(in srgb, var(--${cssName(token)}) ${pct}%, transparent)`;
}

export const font = {
  body: '"Alegreya Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  head: '"Alegreya Sans", system-ui, sans-serif',
  logo: '"Pirata One", "Alegreya Sans", serif',
} as const;

export const radius = { sm: 5, md: 7, lg: 9, pill: 99 } as const;
export const space = { xs: 4, sm: 6, md: 8, lg: 12, xl: 16 } as const;

/** Viewport width below which the phone layout (map on top, bottom sheet) is used. */
export const MOBILE_MAX = 719;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX}px)`;

/** Per-agent accent colours (dots / avatars only; never used for stripes). */
export const AGENT_COLORS: Record<string, string> = {
  brakel: "#e8c87a", rike: "#f4b8d4", ottmar: "#a8d48a", wenzel: "#c8a84a",
  kasper: "#d4a870", irmel: "#d4d4a0", bodo: "#f0d890", eckhart: "#c84c4c",
  lenz: "#a07040", grete: "#d878a8", walburga: "#80c8d8", jost: "#80a850",
  reinhart: "#a8a0c8", bruder_anno: "#c8c8e8", mattis: "#909090", vroni: "#e8b090",
  wendel: "#d8c060", minna: "#e878b8", gisbert: "#b0b0b0", player: "#ffd700",
};
export function agentColor(id: string): string {
  return AGENT_COLORS[id] ?? palette.ink2;
}

/** Season → tint token for the clock chip. */
export const SEASON_TONE: Record<string, ColorToken> = {
  spring: "good", summer: "warn", autumn: "accent", winter: "info",
};

/** true below MOBILE_MAX px viewport width (reactive). */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

const rootVars = (Object.entries(palette) as [ColorToken, string][])
  .map(([k, v]) => `--${cssName(k)}:${v};`)
  .join("");

export const globalCss = `
:root{${rootVars}--accent-soft:color-mix(in srgb,var(--accent) 12%,transparent);
  --r:${radius.md}px;--f-body:${font.body};--f-head:${font.head};--f-logo:${font.logo};color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:var(--bg)}
body{color:var(--ink);font-family:var(--f-body);font-size:14px;line-height:1.35;-webkit-text-size-adjust:100%;overscroll-behavior:none}
button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
input,textarea,select{font:inherit;color:inherit}
:focus{outline:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mono{font-variant-numeric:tabular-nums}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.scroll{overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--line2) transparent}

/* icons */
.ic{display:inline-flex;flex:none;align-items:center;justify-content:center}
.ic svg{width:1.15em;height:1.15em;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.itemimg{image-rendering:pixelated;flex:none}

/* app shell */
.app{display:flex;flex-direction:column;width:100%;height:100vh;height:100dvh;overflow:hidden;background:var(--bg)}
.main{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 348px;min-height:0;min-width:0}
.mapwrap{position:relative;min-width:0;min-height:0;overflow:hidden;background:var(--bg);border-right:1px solid var(--line)}
.mapwrap>.mapfill{position:absolute;inset:0}
.map-tools{position:absolute;top:8px;right:8px;z-index:5;display:flex;gap:6px}
.hud-slot-root{position:absolute;left:12px;bottom:54px;z-index:4;pointer-events:none}
.hud-slot-root>*{pointer-events:auto}

/* top bar */
.topbar{display:flex;align-items:center;gap:6px 18px;padding:0 14px;height:50px;background:linear-gradient(var(--panel2),var(--panel));border-bottom:1px solid var(--line);min-width:0;flex:none}
.logo{display:flex;align-items:center;gap:9px;color:var(--accent);flex:none}
.logo-mark{width:24px;height:24px}
.logo-text{font-family:var(--f-logo);font-size:30px;line-height:1;letter-spacing:.01em;text-shadow:0 0 14px color-mix(in srgb,var(--accent) 55%,transparent);animation:lampLogo 4.6s infinite}
@keyframes lampLogo{0%,100%{text-shadow:0 0 14px color-mix(in srgb,var(--accent) 55%,transparent)}47%{text-shadow:0 0 10px color-mix(in srgb,var(--accent) 35%,transparent)}52%{text-shadow:0 0 18px color-mix(in srgb,var(--accent) 70%,transparent)}}
.tb-item{display:flex;align-items:center;gap:7px;color:var(--ink);white-space:nowrap;min-width:0}
.tb-item .ic{color:var(--ink2);font-size:16px}
.tb-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink2)}
.tb-spacer{flex:1}
.tb-live{display:flex;align-items:center;gap:6px;font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--ink2);flex:none}
.tb-live i{width:7px;height:7px;border-radius:50%;background:var(--good);animation:livePulse 2.2s infinite}
.tb-live.off i{background:var(--bad);animation:none}
@keyframes livePulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--good) 55%,transparent)}70%,100%{box-shadow:0 0 0 7px transparent}}
.tb-events{display:flex;gap:6px;min-width:0}
.tick-flash{animation:tickFlash .8s ease-out}
@keyframes tickFlash{0%{color:var(--accent)}100%{color:inherit}}

/* ticker */
.ticker{display:flex;align-items:center;height:30px;background:var(--panel2);border-bottom:1px solid var(--line);min-width:0;overflow:hidden;flex:none}
.ticker-tag{flex:none;margin:0 10px 0 12px;padding:1px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);border-radius:var(--r)}
.ticker-view{flex:1;min-width:0;overflow:hidden;position:relative;height:100%;mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 28px),transparent)}
.ticker-track{position:absolute;left:0;top:0;height:100%;display:flex;align-items:center;white-space:nowrap;will-change:transform;animation:tkScroll var(--dur,60s) linear infinite}
.ticker-view:hover .ticker-track{animation-play-state:paused}
@keyframes tkScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.tk{display:inline-flex;align-items:center;gap:7px;padding-right:34px;color:var(--ink);font-size:13.5px}
.tk .ic{color:var(--ink2)}
.tk b{font-weight:700}
.ticker-idle{color:var(--ink3);font-size:13px;padding-left:12px}

/* buttons / inputs / chips */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:7px 12px;min-height:34px;background:var(--panel2);border:1px solid var(--line2);border-radius:var(--r);color:var(--ink);font-size:13.5px;transition:background .15s,border-color .15s,transform .08s,box-shadow .2s}
.btn .ic{color:var(--accent)}
.btn:hover:not(:disabled){background:var(--panel3);border-color:var(--accent);box-shadow:0 0 14px color-mix(in srgb,var(--accent) 18%,transparent)}
.btn:active:not(:disabled){transform:translateY(1px) scale(.99);background:var(--accent-soft)}
.btn:disabled{opacity:.45;cursor:default}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:700}
.btn.primary .ic{color:var(--accent-ink)}
.btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--accent) 88%,#fff)}
.btn.block{width:100%}
.btn.sm{min-height:28px;padding:3px 9px;font-size:12.5px}
.iconbtn{display:inline-grid;place-items:center;width:32px;height:32px;flex:none;background:transparent;border:1px solid transparent;border-radius:var(--r);color:var(--ink2);transition:background .15s,color .15s,border-color .15s}
.iconbtn:hover{border-color:var(--line2);background:var(--panel2);color:var(--ink)}
.chip{display:inline-flex;align-items:center;gap:5px;padding:3px 11px;min-height:28px;background:transparent;border:1px solid var(--line2);border-radius:99px;color:var(--ink2);font-size:13px;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.chip:hover{color:var(--ink);border-color:var(--ink3);background:var(--panel2)}
.chip:active{transform:translateY(1px)}
.chip[aria-pressed=true]{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 55%,transparent)}
.chips{display:flex;gap:5px;flex-wrap:wrap;min-width:0}
.chipx{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:99px;border:1px solid var(--line2);background:var(--panel2);color:var(--ink);font-size:12.5px;white-space:nowrap;max-width:100%}
.chipx .ic{font-size:13px;color:var(--accent)}
.chipx.warn{border-color:color-mix(in srgb,var(--warn) 55%,transparent);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.chipx.warn .ic{color:var(--warn)}
.chipx.bad{border-color:color-mix(in srgb,var(--bad) 55%,transparent);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.chipx.bad .ic{color:var(--bad)}
.chipx.good{border-color:color-mix(in srgb,var(--good) 55%,transparent);background:color-mix(in srgb,var(--good) 12%,transparent)}
.chipx.good .ic{color:var(--good)}
.chipx.info{border-color:color-mix(in srgb,var(--info) 55%,transparent);background:color-mix(in srgb,var(--info) 12%,transparent)}
.chipx.info .ic{color:var(--info)}
.linkish{background:none;border:0;padding:0;color:inherit;font:inherit;text-decoration:underline;text-decoration-color:color-mix(in srgb,currentColor 35%,transparent);text-underline-offset:2px;cursor:pointer}
.linkish:hover{text-decoration-color:currentColor;color:var(--accent)}
.inp{width:100%;min-width:0;padding:7px 10px;background:var(--panel2);border:1px solid var(--line2);border-radius:var(--r);color:var(--ink);transition:border-color .15s,box-shadow .15s}
.inp::placeholder{color:var(--ink3)}
.inp:hover{border-color:var(--ink3)}
.inp:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
textarea.inp{resize:vertical;line-height:1.35}
select.inp{appearance:none;padding-right:28px;background-image:linear-gradient(45deg,transparent 50%,var(--ink2) 50%),linear-gradient(135deg,var(--ink2) 50%,transparent 50%);background-position:calc(100% - 15px) 55%,calc(100% - 10px) 55%;background-size:5px 5px;background-repeat:no-repeat}
select.inp option{background:var(--panel2);color:var(--ink)}
.row{display:flex;gap:6px;align-items:center}

/* side panel + tabs */
.panel{display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--panel)}
.tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:8px 8px 0;flex:none}
.tabs button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:0;min-height:48px;padding:6px 2px 5px;background:transparent;border:1px solid transparent;border-radius:var(--r);color:var(--ink2);font-family:var(--f-head);font-size:13px;transition:background .15s,color .15s,border-color .15s}
.tabs button .ic{font-size:17px}
.tabs button .tl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tabs button:hover{color:var(--ink);background:var(--panel2)}
.tabs button[aria-selected=true]{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 50%,transparent)}
.only-mobile{display:none!important}
.panes{flex:1;min-height:0;position:relative}
.pane{position:absolute;inset:0;overflow-y:auto;padding:12px 12px 18px;animation:paneIn .28s cubic-bezier(.2,.7,.2,1) both;scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
@keyframes paneIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.sheet-handle{display:none}

.sec{margin-bottom:15px}
.sec-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 7px;font-family:var(--f-head);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:var(--accent);opacity:.9}
.sec-h small{font-size:11px;letter-spacing:.04em;text-transform:none;font-weight:400;color:var(--ink3)}
.card{background:var(--panel2);border:1px solid var(--line);border-radius:calc(var(--r) + 2px);padding:10px 11px}
.muted{color:var(--ink3)}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:26px 12px;text-align:center;color:var(--ink3);font-size:14px;border:1px dashed var(--line2);border-radius:calc(var(--r) + 2px)}
.empty .ic{font-size:22px;color:var(--ink3)}
.empty small{font-size:12.5px;color:var(--ink3)}
.seg{display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap}

/* kolonisten list */
.klist{display:grid;gap:5px}
.krow{display:grid;grid-template-columns:34px minmax(0,1fr) 54px auto;gap:9px;align-items:center;width:100%;min-height:48px;padding:5px 9px;text-align:left;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);transition:background .15s,border-color .15s,transform .15s}
.krow:hover:not(:disabled){background:var(--panel3);border-color:var(--line2);transform:translateY(-1px)}
.krow:disabled{opacity:.5;cursor:default}
.krow[data-st=hungry]{background:color-mix(in srgb,var(--warn) 9%,var(--panel2));border-color:color-mix(in srgb,var(--warn) 45%,transparent)}
.krow[data-st=sick]{background:color-mix(in srgb,var(--bad) 8%,var(--panel2));border-color:color-mix(in srgb,var(--bad) 40%,transparent)}
.krow[data-st=starving]{background:color-mix(in srgb,var(--bad) 13%,var(--panel2));border-color:color-mix(in srgb,var(--bad) 60%,transparent)}
.krow .nm{font-size:15px;font-weight:700;line-height:1.15;display:flex;align-items:center;gap:6px;min-width:0}
.krow .nm .ic{color:var(--ink2);font-size:13px}
.krow .lc{font-size:12.5px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.krow .minibars{display:grid;gap:4px}
.krow .mb{height:5px;border-radius:99px;background:var(--panel3);border:1px solid var(--line);overflow:hidden}
.krow .mb b{display:block;height:100%;width:var(--p);background:var(--c)}
.krow .wl{font-size:13px;color:var(--accent);text-align:right;min-width:42px;white-space:nowrap}
.sico{display:grid;place-items:center;width:30px;height:30px;border-radius:var(--r);border:1px solid var(--line2);background:var(--panel3);color:var(--ink2);font-size:16px}
.sico.good{border-color:color-mix(in srgb,var(--good) 50%,transparent);background:color-mix(in srgb,var(--good) 11%,transparent);color:var(--good)}
.sico.warn{border-color:color-mix(in srgb,var(--warn) 55%,transparent);background:color-mix(in srgb,var(--warn) 13%,transparent);color:var(--warn)}
.sico.bad{border-color:color-mix(in srgb,var(--bad) 55%,transparent);background:color-mix(in srgb,var(--bad) 13%,transparent);color:var(--bad)}
.sico.dead{opacity:.6}

/* kolonist detail */
.kol-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:10px}
.kol-avatar{width:68px;height:68px;flex:none;image-rendering:pixelated;background:var(--panel3);border:1px solid var(--line2);border-radius:calc(var(--r) + 2px);box-shadow:0 0 22px color-mix(in srgb,var(--accent) 16%,transparent)}
.kol-id{flex:1;min-width:0}
.kol-name{margin:0;font-family:var(--f-head);font-size:23px;line-height:1.05;font-weight:600;color:var(--ink)}
.kol-chips{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 5px}
.kol-loc{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink2)}
.kol-loc .ic{color:var(--accent)}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 12px}
.kv div{padding:6px 9px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);min-width:0}
.kv dt{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.kv dd{margin:0;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.purse{display:flex;align-items:center;gap:8px;margin-bottom:9px;font-size:22px;font-weight:700;color:var(--accent);font-family:var(--f-head)}
.purse small{font-size:12px;font-weight:500;color:var(--ink2);font-family:var(--f-body)}
.bars{display:grid;gap:7px}
.bar{display:grid;grid-template-columns:52px 1fr 22px;align-items:center;gap:8px;font-size:12.5px}
.bar-l{color:var(--ink2);text-transform:uppercase;letter-spacing:.08em;font-size:10.5px}
.bar-t{position:relative;height:9px;border-radius:99px;background:var(--panel3);border:1px solid var(--line);overflow:hidden}
.bar-t b{position:absolute;left:0;top:0;bottom:0;width:var(--p,0%);background:var(--c,var(--good));box-shadow:0 0 8px color-mix(in srgb,var(--c,var(--good)) 70%,transparent);transition:width .6s cubic-bezier(.2,.7,.2,1),background .3s}
.bar-v{text-align:right;color:var(--ink)}
.inv{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px}
.slot{display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 3px 5px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);text-align:center;transition:border-color .15s,transform .15s,background .15s}
.slot:hover{border-color:var(--accent);transform:translateY(-2px);background:var(--panel3)}
.slot.res{border-color:color-mix(in srgb,var(--accent) 50%,transparent)}
.slot img,.slot .ph{width:30px;height:30px}
.slot b{font-size:14px;line-height:1.1}
.slot span{font-size:11px;color:var(--ink2);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slot small{font-size:10.5px;color:var(--accent)}
.thoughts{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.th{display:grid;grid-template-columns:auto 1fr;gap:9px;align-items:start;padding:8px 10px;background:var(--panel2);border:1px solid var(--line);border-radius:calc(var(--r) + 2px);animation:rise .4s both}
.th .tt{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);padding:1px 6px;border:1px solid var(--line2);border-radius:99px;margin-top:1px;white-space:nowrap}
.th .tt .ic{font-size:12px;color:var(--accent)}
.th p{margin:0;font-size:14px;color:var(--ink);overflow-wrap:anywhere}
.th time{display:block;font-size:11px;color:var(--ink3);margin-top:2px}
.talk{display:grid;gap:6px}
.answer{max-height:160px;overflow-y:auto;padding:8px 10px;background:var(--panel2);border:1px solid var(--line2);border-radius:var(--r);font-style:italic;font-size:14px;white-space:pre-wrap}
.loan{display:flex;align-items:center;gap:8px;padding:6px 9px;margin-bottom:5px;border:1px solid var(--line2);border-radius:var(--r);background:var(--panel2);font-size:13px}
.loan.bad{border-color:color-mix(in srgb,var(--bad) 55%,transparent);background:color-mix(in srgb,var(--bad) 11%,transparent)}
.loan.info{border-color:color-mix(in srgb,var(--info) 50%,transparent);background:color-mix(in srgb,var(--info) 10%,transparent)}
.loan .ic{font-size:15px}
.loan.bad .ic{color:var(--bad)}.loan.info .ic{color:var(--info)}
.smuggler{border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);background:color-mix(in srgb,var(--accent) 9%,var(--panel2));border-radius:calc(var(--r) + 2px);padding:9px 10px}
.ware{display:flex;align-items:center;gap:8px;padding:5px 8px;margin-top:5px;background:var(--panel2);border:1px solid var(--line2);border-radius:var(--r);font-size:13.5px}
.ware .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* tauschbrett */
table.ledger{width:100%;border-collapse:collapse;font-size:13.5px}
table.ledger th{font-family:var(--f-head);font-weight:700;font-size:10.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--ink3);text-align:left;padding:4px 6px;border-bottom:1px solid var(--line2)}
table.ledger td{padding:6px 6px;border-bottom:1px solid var(--line);vertical-align:middle}
table.ledger .r{text-align:right}
table.ledger tr.prow{cursor:pointer;transition:background .12s}
table.ledger tr.prow:hover,table.ledger tr.prow.open{background:var(--panel2)}
table.ledger tr.prow:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
table.ledger td.r{white-space:nowrap}
table.ledger tr.flash td{animation:flashRow 1.4s ease-out}
@keyframes flashRow{0%{background:var(--accent-soft)}100%{background:transparent}}
.it{display:inline-flex;align-items:center;gap:6px;min-width:0}
.it img,.it .ph{width:20px;height:20px}
.pr{font-weight:700;color:var(--accent)}
.up{color:var(--bad)}.down{color:var(--good)}.flat{color:var(--ink3)}
.spark{display:block;overflow:visible}
.spark polyline{fill:none;stroke:var(--chart,var(--accent));stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.spark polygon{fill:var(--chart,var(--accent));opacity:.12}
.spark circle{fill:var(--chart,var(--accent))}
.book{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:6px 6px 10px;font-size:12.5px}
.book h4{margin:0 0 3px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.book p{margin:0;color:var(--ink2)}
.book .ln{display:flex;justify-content:space-between;gap:6px}
.side{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:99px;border:1px solid;font-size:11.5px;white-space:nowrap}
.side.ang{color:var(--good);border-color:color-mix(in srgb,var(--good) 55%,transparent);background:color-mix(in srgb,var(--good) 11%,transparent)}
.side.ges{color:var(--info);border-color:color-mix(in srgb,var(--info) 55%,transparent);background:color-mix(in srgb,var(--info) 11%,transparent)}
.side.neutral{color:var(--ink2);border-color:var(--line2);background:var(--panel2)}
.fills{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.fill{display:flex;align-items:center;gap:7px;padding:4px 9px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);font-size:13px;min-width:0}
.fill .ic{font-size:14px;color:var(--ink2)}
.fill.filled .ic{color:var(--good)}
.fill .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fill time{font-size:11.5px;color:var(--ink3)}

/* wirtschaft */
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}
.kpi{padding:8px 9px;background:var(--panel2);border:1px solid var(--line);border-radius:calc(var(--r) + 2px);min-width:0}
.kpi span{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.kpi b{display:block;font-family:var(--f-head);font-size:22px;line-height:1.15;white-space:nowrap}
.kpi small{font-size:11.5px;color:var(--ink2)}
.wb{display:grid;grid-template-columns:78px 1fr 40px;gap:8px;align-items:center;font-size:13px;padding:2px 0}
.wb .t{height:10px;border-radius:99px;background:var(--panel3);border:1px solid var(--line);overflow:hidden}
.wb .t b{display:block;height:100%;width:var(--p);background:var(--accent);transition:width .6s}
.wb .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wb .v{text-align:right}

/* ereignisse */
.evs{display:grid;gap:8px}
.evc{display:grid;grid-template-columns:auto 1fr;gap:11px;width:100%;text-align:left;padding:11px 12px;border-radius:calc(var(--r) + 3px);border:1px solid var(--tb);background:var(--tbg);color:var(--ink);transition:transform .15s,box-shadow .2s;animation:rise .45s both;position:relative}
button.evc:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 0 18px color-mix(in srgb,var(--tb) 40%,transparent)}
button.evc:active:not(:disabled){transform:translateY(0) scale(.995)}
button.evc:disabled{cursor:default}
.evc[data-tone=info]{--tb:color-mix(in srgb,var(--info) 55%,transparent);--tbg:color-mix(in srgb,var(--info) 11%,var(--panel))}
.evc[data-tone=warn]{--tb:color-mix(in srgb,var(--warn) 55%,transparent);--tbg:color-mix(in srgb,var(--warn) 12%,var(--panel))}
.evc[data-tone=bad]{--tb:color-mix(in srgb,var(--bad) 55%,transparent);--tbg:color-mix(in srgb,var(--bad) 12%,var(--panel))}
.evc[data-tone=good]{--tb:color-mix(in srgb,var(--good) 55%,transparent);--tbg:color-mix(in srgb,var(--good) 11%,var(--panel))}
.evc[data-tone=plain]{--tb:var(--line2);--tbg:var(--panel2)}
.evc .eico{display:grid;place-items:center;width:38px;height:38px;border-radius:var(--r);border:1px solid var(--tb);background:color-mix(in srgb,var(--tb) 22%,transparent);font-size:21px;color:var(--ink)}
.evc h3{margin:0;font-family:var(--f-head);font-size:17px;line-height:1.15;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.evc p{margin:3px 0 0;font-size:13.5px;color:var(--ink2)}
.evc .st{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:1px 7px;border-radius:99px;border:1px solid var(--tb);color:var(--ink)}
.evc .meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px;font-size:12px;color:var(--ink2)}
.evc .meta span{display:inline-flex;align-items:center;gap:4px}
.note{margin-top:6px;padding:6px 9px;font-size:13px;border-radius:var(--r);border:1px solid var(--line2);background:var(--panel2);display:flex;gap:7px;align-items:flex-start}
.note.good{border-color:color-mix(in srgb,var(--good) 55%,transparent);background:color-mix(in srgb,var(--good) 11%,transparent)}
.note.bad{border-color:color-mix(in srgb,var(--bad) 55%,transparent);background:color-mix(in srgb,var(--bad) 11%,transparent)}
.note .ic{margin-top:1px}
.spin{animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* chronicle */
.chronicle{display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--panel);border-top:1px solid var(--line);height:176px;flex:none;transition:height .3s cubic-bezier(.2,.7,.2,1)}
.chronicle[data-open=false]{height:44px}
.chron-head{display:flex;align-items:center;gap:12px;padding:6px 12px;flex:none;min-width:0;flex-wrap:wrap}
.chron-toggle{display:flex;align-items:center;gap:7px;padding:3px 9px;min-height:30px;background:transparent;border:1px solid transparent;border-radius:var(--r);font-family:var(--f-head);font-size:15px;color:var(--ink);transition:background .15s,border-color .15s}
.chron-toggle:hover{background:var(--panel2);border-color:var(--line2)}
.chron-toggle>.ic:first-child{color:var(--accent)}
.chev svg{transition:transform .2s;transform:rotate(0)}
.chronicle[data-open=false] .chev svg{transform:rotate(180deg)}
.think{display:flex;align-items:center;gap:5px;margin-left:auto;color:var(--ink2);font-size:12.5px;min-width:0}
.think .dot{width:7px;height:7px;border-radius:50%;flex:none;animation:dotPulse .9s infinite}
@keyframes dotPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.85)}}
.chron-list{list-style:none;margin:0;padding:0 12px 10px;overflow-y:auto;flex:1;min-height:0;display:grid;grid-auto-rows:min-content;gap:5px;scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
.ent{display:grid;grid-template-columns:auto auto 1fr;gap:10px;align-items:center;padding:5px 10px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);font-size:14px;min-width:0}
.ent.enter{animation:entIn .55s cubic-bezier(.2,.8,.2,1) both}
@keyframes entIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:none}}
.ent time{font-size:12.5px;color:var(--ink3);white-space:nowrap}
.ent .bd{display:grid;place-items:center;width:24px;height:24px;border-radius:var(--r);border:1px solid var(--line2);background:var(--panel3);color:var(--accent);font-size:14px}
.ent[data-t=trade] .bd{color:var(--good);border-color:color-mix(in srgb,var(--good) 50%,transparent);background:color-mix(in srgb,var(--good) 12%,transparent)}
.ent[data-t=work] .bd{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 50%,transparent);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.ent[data-t=talk] .bd{color:var(--info);border-color:color-mix(in srgb,var(--info) 50%,transparent);background:color-mix(in srgb,var(--info) 12%,transparent)}
.ent[data-t=council] .bd{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 50%,transparent);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.ent .tx{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ent .tx .linkish{font-weight:700}
.ent.thought .tx{font-style:italic;color:var(--ink2)}
.chron-empty{padding:14px 12px;color:var(--ink3);text-align:center}

/* strip */
.strip{display:flex;align-items:stretch;height:34px;background:var(--panel2);border-top:1px solid var(--line);font-size:13px;overflow-x:auto;overflow-y:hidden;min-width:0;flex:none;scrollbar-width:none}
.strip::-webkit-scrollbar{display:none}
.st{display:flex;align-items:center;gap:5px;padding:0 11px;white-space:nowrap;border-right:1px solid var(--line);flex:none}
.st .itemimg{width:18px;height:18px}
.st .d{font-size:11px}
.st-sum{margin-left:auto;display:flex;align-items:stretch;flex:none}
.st-sum .st{border-right:0;border-left:1px solid var(--line);color:var(--ink2);gap:6px}
.st-sum .st b{color:var(--ink)}

/* modal */
.scrim{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,6,5,.82);backdrop-filter:blur(3px);animation:fadeIn .2s both}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.modal{width:100%;max-width:460px;max-height:100%;overflow-y:auto;padding:22px 24px;background:var(--panel);border:1px solid var(--line2);border-radius:calc(var(--r) + 4px);box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 44px color-mix(in srgb,var(--accent) 10%,transparent);animation:rise .3s both}
.modal h2{margin:0 0 4px;font-family:var(--f-logo);font-size:30px;font-weight:400;color:var(--accent)}
.modal .lead{margin:0 0 18px;color:var(--ink2);font-size:14.5px}
.modal label{display:block;margin:0 0 7px;font-size:11.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--ink2)}
.modal .opts{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px}

/* history navigator + streaming (secondary components) */
.tnav{display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--panel2);border-top:1px solid var(--line);flex:none}
.tnav input[type=range]{flex:1;min-width:0;accent-color:var(--accent)}
.stream{display:grid;gap:5px}
.stream-i{display:block;width:100%;text-align:left;padding:7px 10px;background:var(--panel2);border:1px solid var(--line2);border-radius:var(--r)}
.stream-i:hover{background:var(--panel3)}
.stream-i .h{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700}
.stream-i .t{margin-top:3px;font-size:13px;color:var(--ink2);overflow-wrap:anywhere}
.caret{display:inline-block;width:6px;height:12px;margin-left:2px;vertical-align:text-bottom;background:var(--ink2);animation:blink .8s step-end infinite}
@keyframes blink{50%{opacity:0}}

/* ===== human player: creation overlay ===== */
.modal.create{max-width:560px}
.create-intro{margin:0 0 16px;color:var(--ink2);font-size:14.5px;line-height:1.45}
.create-hint{margin:5px 0 14px;font-size:12px;color:var(--ink3)}
.skills{border:0;padding:0;margin:0 0 12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;min-width:0}
.skills legend{padding:0;margin:0 0 7px;font-size:11.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--ink2)}
.modal .skill{position:relative;display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;margin:0;padding:10px;text-transform:none;letter-spacing:0;font-size:inherit;color:var(--ink);background:var(--panel2);border:1px solid var(--line2);border-radius:calc(var(--r) + 2px);cursor:pointer;transition:border-color .15s,background .15s,box-shadow .2s,transform .1s}
.skill input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.skill:hover{border-color:var(--ink3)}
.skill:active{transform:scale(.99)}
.skill:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.skill[data-on=true]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--panel2));box-shadow:0 0 18px color-mix(in srgb,var(--accent) 16%,transparent)}
.skill-ico{display:grid;place-items:center;width:34px;height:34px;border-radius:var(--r);border:1px solid var(--line2);background:var(--panel3);color:var(--accent);font-size:19px;transition:border-color .15s,background .15s}
.skill[data-on=true] .skill-ico{border-color:var(--accent);background:var(--accent-soft)}
.skill-tx{display:grid;gap:2px;min-width:0}
.skill-tx b{font-family:var(--f-head);font-size:17px;line-height:1.1}
.skill-pl{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--accent)}
.skill-tx small{font-size:12.5px;color:var(--ink2);line-height:1.35}
.create-kit{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:8px 10px;margin-bottom:14px;border:1px solid var(--line2);border-radius:var(--r);background:var(--panel2);font-size:13.5px}
.kit-l{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink2)}
.kit-v{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.kit-v>.ic{color:var(--accent)}
.kit-items{display:inline-flex;gap:4px;margin-left:2px}
.create-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.create-actions .btn.primary{flex:1 1 150px}
.create-actions .btn{min-height:40px}
.tb-play{flex:none}
.tb-time{overflow:hidden}
.tb-weather,.tb-tick{flex:none}
.tb-time span{overflow:hidden;text-overflow:ellipsis}
@media (max-width:1000px){.tb-pop{display:none}}
.tb-view{display:inline-flex;flex:none;padding:2px;gap:2px;background:var(--panel);border:1px solid var(--line2);border-radius:var(--r)}
.tb-view button{min-width:38px;padding:3px 9px;border-radius:calc(var(--r) - 2px);border:1px solid transparent;background:transparent;color:var(--ink2);font-size:12.5px;letter-spacing:.06em;cursor:pointer;transition:background .15s,color .15s}
.tb-view button:hover{color:var(--ink)}
.tb-view button[aria-pressed=true]{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 50%,transparent)}
.tb-pp{flex:none;width:32px;height:32px;border-color:var(--line2);background:var(--panel2);color:var(--accent)}
.tb-pp:hover:not(:disabled){border-color:var(--accent);background:var(--panel3);color:var(--accent)}
.tb-pp:disabled{opacity:.45;cursor:default}
.tb-pp[data-paused=true]{border-color:color-mix(in srgb,var(--warn) 60%,transparent);background:color-mix(in srgb,var(--warn) 14%,transparent);color:var(--warn)}
.tb-pp .ic svg{width:17px;height:17px}
@media (min-width:${MOBILE_MAX + 1}px) and (max-width:1100px){
  .topbar{column-gap:12px}
  .tb-day{display:none}
  .tb-weather span{max-width:110px;overflow:hidden;text-overflow:ellipsis}
}
@media (min-width:${MOBILE_MAX + 1}px) and (max-width:900px){
  .topbar{column-gap:10px;padding:0 10px}
  .logo-text{font-size:24px}
  .tb-weather span{display:none}
  .tb-play{padding:3px 8px}
  .tb-play-l{display:none}
}

/* ===== Regie (roles, sim control, war) ===== */
.fld{display:grid;gap:4px;min-width:0}
.fld-l{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2)}
.fld-l small{text-transform:none;letter-spacing:0;font-size:11.5px}
.togrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid var(--line2);background:var(--panel2);border-radius:var(--r)}
.togrow>span{display:grid;gap:1px;min-width:0}
.togrow small{font-size:12px}
.sw{position:relative;flex:none;width:40px;height:24px;border-radius:99px;border:1px solid var(--line2);background:var(--panel3);transition:background .15s,border-color .15s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--ink3);transition:transform .15s,background .15s}
.sw[aria-checked=true]{background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 55%,transparent)}
.sw[aria-checked=true]::after{transform:translateX(16px);background:var(--accent)}
.sw:disabled{opacity:.5;cursor:default}
.btn.danger{border-color:color-mix(in srgb,var(--bad) 60%,transparent);background:color-mix(in srgb,var(--bad) 16%,var(--panel2))}
.btn.danger .ic{color:var(--bad)}
.btn.danger:hover:not(:disabled){border-color:var(--bad);background:color-mix(in srgb,var(--bad) 26%,var(--panel2));box-shadow:0 0 14px color-mix(in srgb,var(--bad) 22%,transparent)}
.costbox{display:grid;gap:5px;margin-top:10px;padding:9px 11px;border:1px solid var(--line2);background:var(--panel2);border-radius:calc(var(--r) + 2px);font-size:13.5px}
.cost-l{display:flex;gap:8px;align-items:flex-start}
.cost-l .ic{color:var(--accent);margin-top:2px}
.cost-m{font-size:12.5px;color:var(--ink2);line-height:1.35}
.sec-h.sub{margin-top:16px}
.wp[data-tone=good]{--tc:var(--good)}
.wp[data-tone=warn]{--tc:var(--warn)}
.wp[data-tone=bad]{--tc:var(--bad)}
.tbar{position:relative;height:9px;margin-top:9px;border-radius:99px;background:var(--panel3);border:1px solid var(--line)}
.tbar b{position:absolute;left:0;top:0;bottom:0;max-width:100%;border-radius:99px;background:var(--tc,var(--good));box-shadow:0 0 8px color-mix(in srgb,var(--tc,var(--good)) 60%,transparent);transition:width .6s cubic-bezier(.2,.7,.2,1)}
.tmark{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:2px;background:var(--ink);opacity:.75}
.tlbl{display:flex;justify-content:space-between;flex-wrap:wrap;gap:2px 8px;margin-top:4px;font-size:12px;color:var(--ink2)}
.wacts{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.wacts .btn{flex:1 1 auto}
.wform{display:grid;gap:7px;margin-top:9px;padding-top:9px;border-top:1px solid var(--tb)}
.mlist,.wlog{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.mrow{display:grid;grid-template-columns:30px minmax(0,1fr);gap:9px;align-items:center;padding:6px 9px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r)}
.mrow .nm{display:block;font-size:14.5px;line-height:1.2}
.mrow .lc{display:block;font-size:12.5px;color:var(--ink2)}
.wlog li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:8px;padding:6px 9px;font-size:13.5px;line-height:1.35;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r)}
.wlog li small{display:block;font-size:12px}
.wlog .ic-w{color:var(--ink2);margin-top:2px}
.wlog li[data-ok=yes]{border-color:color-mix(in srgb,var(--good) 45%,transparent);background:color-mix(in srgb,var(--good) 8%,var(--panel2))}
.wlog li[data-ok=yes] .ic-w{color:var(--good)}
.wlog li[data-ok=no]{border-color:color-mix(in srgb,var(--warn) 45%,transparent);background:color-mix(in srgb,var(--warn) 8%,var(--panel2))}
.wlog li[data-ok=no] .ic-w{color:var(--warn)}
.reg-h{display:flex;align-items:center;gap:8px;margin:20px 0 12px;padding-top:14px;border-top:1px solid var(--line2);font-family:var(--f-head);font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}

/* ===== human player: HUD card ===== */
.hud{position:relative;width:324px;max-width:calc(100vw - 24px);padding:10px 12px 12px;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 96%,transparent),color-mix(in srgb,var(--panel) 96%,transparent));border:1px solid var(--line2);border-radius:calc(var(--r) + 3px);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 8%,transparent),0 10px 34px rgba(0,0,0,.6),0 0 44px color-mix(in srgb,var(--accent) 10%,transparent);animation:rise .5s cubic-bezier(.2,.7,.2,1) both}
.hud-scroll{overflow-y:auto;max-height:calc(min(580px,100dvh - 340px) - 24px);margin-right:-4px;padding-right:4px;scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
.hud-fold{position:absolute;top:6px;right:6px;z-index:1;display:grid;place-items:center;width:26px;height:26px;background:transparent;border:1px solid transparent;border-radius:var(--r);color:var(--ink2);transition:background .15s,color .15s,border-color .15s}
.hud-fold:hover{background:var(--panel2);border-color:var(--line2);color:var(--ink)}
.hud-fold svg{transition:transform .2s}
.hud[data-folded=true] .hud-fold svg{transform:rotate(180deg)}
.hud-folded{display:flex;align-items:center;gap:10px;min-height:32px;padding-right:28px}
.hud-folded b{font-family:var(--f-head);font-size:18px;font-weight:600}
.hud-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;padding-right:22px}
.hud-avatar-btn{flex:none;padding:0;line-height:0;background:var(--panel3);border:1px solid var(--line2);border-radius:calc(var(--r) + 2px);overflow:hidden;transition:border-color .15s,box-shadow .2s,transform .1s}
.hud-avatar-btn:hover{border-color:var(--accent);box-shadow:0 0 16px color-mix(in srgb,var(--accent) 30%,transparent)}
.hud-avatar-btn:active{transform:scale(.96)}
.hud-avatar-btn .kol-avatar{display:block;border:0;box-shadow:none;border-radius:0!important}
.hud-id{flex:1;min-width:0}
.hud-kicker{font-size:10.5px;text-transform:uppercase;letter-spacing:.14em;color:var(--ink2)}
.hud-name{font-family:var(--f-head);font-size:20px;line-height:1.1;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hud-purse{display:inline-flex;align-items:center;gap:4px;flex:none;padding:3px 8px 3px 5px;border:1px solid var(--line2);border-radius:var(--r);background:var(--panel2);font-size:15px;font-weight:700;color:var(--accent)}
.hud-purse small{font-size:10.5px;font-weight:500;color:var(--ink2)}
.hud-meta{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px}
.hud-meta .chipx{min-width:0;overflow:hidden;text-overflow:ellipsis}
.hud-bars{display:grid;gap:6px;margin-bottom:9px}
.pips-row{display:flex;align-items:center;gap:8px;margin-bottom:9px;font-size:12.5px}
.pips-l{width:52px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2)}
.pips{display:inline-flex;gap:5px}
.pips i{width:14px;height:14px;border-radius:50%;background:var(--panel3);border:1px solid var(--line2);transition:background .25s,border-color .25s,box-shadow .25s}
.pips i[data-on=true]{background:var(--accent);border-color:var(--accent);box-shadow:0 0 8px color-mix(in srgb,var(--accent) 55%,transparent)}
.pips-v{color:var(--ink)}
.pips-v.out{color:var(--warn)}
.hud-inv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:9px}
.hud-slot{display:flex;align-items:center;gap:7px;min-width:0;min-height:36px;padding:4px 7px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel2);font-size:12.5px;color:var(--ink);transition:border-color .15s,background .15s}
.hud-slot:hover{border-color:var(--line2);background:var(--panel3)}
.hud-slot img,.hud-slot .ph{width:22px;height:22px}
.hud-slot>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hud-slot.empty{grid-column:1/-1;justify-content:center;color:var(--ink3);border-style:dashed}
.hud-slot .dur{display:block;height:4px;margin-top:3px;border-radius:99px;background:var(--panel3);border:1px solid var(--line);overflow:hidden}
.hud-slot .dur b{display:block;height:100%;width:var(--p);background:var(--c);transition:width .5s}
.hud-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:9px}
.hud-actions-wrap{margin-bottom:2px}
.act{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:0;min-height:56px;padding:6px 4px;background:var(--panel2);border:1px solid var(--line2);border-radius:var(--r);color:var(--ink);font-size:13px;transition:background .15s,border-color .15s,box-shadow .2s,transform .1s}
.act .ic{font-size:19px;color:var(--accent)}
.act:hover:not(:disabled){background:var(--panel3);border-color:var(--accent);box-shadow:0 0 14px color-mix(in srgb,var(--accent) 18%,transparent);transform:translateY(-1px)}
.act:active:not(:disabled){transform:translateY(1px) scale(.98);background:var(--accent-soft)}
.act:disabled{opacity:.6;cursor:default;border-style:dashed}
.act:disabled .ic{color:var(--ink3)}
.act-s{font-size:10.5px;line-height:1.1;text-align:center;color:var(--ink3)}
.hud-form{display:grid;gap:8px;margin-bottom:9px;padding:9px;background:var(--panel2);border:1px solid var(--line2);border-radius:calc(var(--r) + 2px);animation:rise .25s both}
.hud-form .hud-form{padding:0;border:0;background:transparent;margin:0}
.hud-lock{display:grid;gap:8px;margin:0;padding:0;border:0;min-width:0;opacity:.55}
.hud-form-h{display:flex;align-items:center;gap:7px;font-family:var(--f-head);font-size:16px}
.hud-form-h .iconbtn{width:28px;height:28px}
.hud-form-h>.ic{color:var(--accent)}
.hud-note{margin:0;font-size:12.5px;line-height:1.4;color:var(--ink2)}
.fld-grid{display:grid;gap:8px}
.fld{display:grid;gap:3px;min-width:0}
.fld-l{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
.fld small{font-size:11.5px;color:var(--ink3)}
.fld-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.opt-h{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.opts-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.opts-col{display:grid;gap:5px}
.opt{display:flex;align-items:center;gap:7px;min-width:0;min-height:38px;padding:5px 9px;text-align:left;background:var(--panel);border:1px solid var(--line2);border-radius:var(--r);transition:background .15s,border-color .15s,transform .1s}
.opt>.ic{color:var(--accent);font-size:15px}
.opt:hover:not(:disabled){background:var(--panel3);border-color:var(--accent)}
.opt:active:not(:disabled){transform:translateY(1px);background:var(--accent-soft)}
.opt:disabled{opacity:.55;cursor:default}
.opt-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
.opt small{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--ink3)}
.opt .opt-n small{display:block;white-space:normal;line-height:1.25}
.opt-go{font-size:12px;color:var(--accent);flex:none}
.opt-why{max-width:48%;text-align:right;white-space:normal;line-height:1.25}
.hud-coll{margin-top:2px;border-top:1px solid var(--line)}
.hud-coll-h{display:flex;align-items:center;gap:7px;width:100%;min-height:36px;padding:4px 2px;background:transparent;border:0;border-radius:var(--r);color:var(--ink);font-family:var(--f-head);font-size:14.5px;text-align:left;transition:color .15s,background .15s}
.hud-coll-h>.ic{color:var(--accent)}
.hud-coll-h:hover{color:var(--accent)}
.hud-coll-h small{margin-left:auto;font-family:var(--f-body);font-size:11.5px;color:var(--ink3)}
.hud-coll-h .chev-i{margin-left:auto}
.hud-coll-h small+.chev-i{margin-left:6px}
.hud-coll-h .chev-i svg{transition:transform .2s}
.hud-coll[data-open=false] .chev-i svg{transform:rotate(180deg)}
.hud-coll-b{padding:2px 0 6px;animation:rise .25s both}
.see{max-height:210px;overflow-y:auto;padding:8px 10px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);font-size:13px;line-height:1.45;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
.hud-empty{padding:6px 2px;font-size:13px}
.diary{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.diary li{display:grid;grid-template-columns:auto 1fr auto;gap:7px;align-items:start;padding:6px 8px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r);font-size:13px;line-height:1.35}
.diary li .ic{margin-top:1px;color:var(--good)}
.diary li span{min-width:0;overflow-wrap:anywhere}
.diary li time{font-size:11px;color:var(--ink3);white-space:nowrap}
.diary li[data-k=fail]{border-color:color-mix(in srgb,var(--warn) 45%,transparent);background:color-mix(in srgb,var(--warn) 8%,var(--panel2))}
.diary li[data-k=fail] .ic{color:var(--warn)}
.diary li[data-k=heard] .ic{color:var(--info)}

/* compact bar + sheet (phones) */
.hud-m{display:flex;align-items:center;gap:9px;width:100%;min-height:54px;padding:6px 10px;text-align:left;background:linear-gradient(180deg,color-mix(in srgb,var(--panel2) 96%,transparent),color-mix(in srgb,var(--panel) 96%,transparent));border:1px solid var(--line2);border-radius:calc(var(--r) + 3px);box-shadow:0 8px 26px rgba(0,0,0,.55),0 0 30px color-mix(in srgb,var(--accent) 9%,transparent);transition:border-color .15s,transform .1s}
.hud-m:hover{border-color:var(--accent)}
.hud-m:active{transform:scale(.99)}
.hud-m .kol-avatar{flex:none;border:1px solid var(--line2);border-radius:var(--r)!important;box-shadow:none}
.hud-m-id{flex:1;min-width:0;display:grid}
.hud-m-id b{font-family:var(--f-head);font-size:16px;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hud-m-id small{font-size:12px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hud-m .minibars{display:grid;gap:4px;width:30px;flex:none}
.hud-m .mb{height:5px;border-radius:99px;background:var(--panel3);border:1px solid var(--line);overflow:hidden}
.hud-m .mb b{display:block;height:100%;width:var(--p);background:var(--c)}
.hud-m .pips{gap:3px;flex:none}
.hud-m .pips i{width:8px;height:8px}
.hud-m-gr{display:inline-flex;align-items:center;gap:3px;flex:none;font-size:14px;font-weight:700;color:var(--accent)}
.hud-m-chev{flex:none;color:var(--ink2)}
.hud-scrim{position:fixed;inset:0;z-index:900;background:rgba(8,6,5,.62);animation:fadeIn .2s both}
.hud-sheet{position:fixed;left:0;right:0;bottom:0;z-index:901;display:flex;flex-direction:column;max-height:88dvh;background:var(--panel);border:1px solid var(--line2);border-bottom:0;border-radius:calc(var(--r) + 7px) calc(var(--r) + 7px) 0 0;box-shadow:0 -12px 40px rgba(0,0,0,.6);animation:sheetUp .3s cubic-bezier(.2,.7,.2,1) both}
@keyframes sheetUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}
.hud-sheet-bar{position:relative;display:flex;align-items:center;justify-content:center;height:42px;flex:none}
.hud-sheet-bar i{width:40px;height:4px;border-radius:9px;background:var(--line2)}
.hud-sheet-bar .iconbtn{position:absolute;right:6px;top:1px}
.hud-sheet-body{overflow-y:auto;padding:0 12px calc(18px + env(safe-area-inset-bottom));scrollbar-width:thin;scrollbar-color:var(--line2) transparent}

/* toasts */
.toasts{position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:1100;display:grid;gap:6px;width:min(460px,calc(100vw - 24px));pointer-events:none}
.toast{pointer-events:auto;display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:start;padding:9px 6px 9px 12px;background:color-mix(in srgb,var(--tb) 14%,var(--panel));border:1px solid color-mix(in srgb,var(--tb) 60%,transparent);border-radius:calc(var(--r) + 2px);box-shadow:0 8px 26px rgba(0,0,0,.55);font-size:14px;line-height:1.35;animation:toastIn .3s cubic-bezier(.2,.8,.2,1) both}
.toast[data-tone=good]{--tb:var(--good)}
.toast[data-tone=warn]{--tb:var(--warn)}
.toast[data-tone=bad]{--tb:var(--bad)}
.toast[data-tone=info]{--tb:var(--info)}
.toast>.ic{margin-top:2px;color:var(--tb);font-size:16px}
.toast-t{min-width:0;max-height:34dvh;overflow-y:auto;white-space:pre-line;overflow-wrap:anywhere}
.toast .iconbtn{width:28px;height:28px}
@keyframes toastIn{from{opacity:0;transform:translateY(-10px) scale(.98)}to{opacity:1;transform:none}}

/* ===== phone layout ===== */
@media (max-width:${MOBILE_MAX}px){
  /* row 1: logo, Mitspielen, play/pause, live · row 2: time, 2D/3D · row 3: weather, tick · row 4: events */
  .topbar{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;height:auto;padding:7px 12px 6px;row-gap:3px;column-gap:8px}
  .logo{grid-column:1;grid-row:1}
  .logo-text{font-size:25px}
  .tb-play{grid-column:2;grid-row:1}
  .tb-pp{grid-column:3;grid-row:1;width:34px;height:34px}
  .tb-live{grid-column:4;grid-row:1;justify-self:end}
  .tb-time{grid-column:1/4;grid-row:2;font-size:13px}
  .tb-time span{overflow:hidden;text-overflow:ellipsis}
  .tb-view{grid-column:4;grid-row:2;justify-self:end}
  .tb-view button{min-width:34px;padding:2px 7px}
  .tb-weather{grid-column:1/4;grid-row:3;font-size:13px;color:var(--ink2)}
  .tb-weather span{overflow:hidden;text-overflow:ellipsis}
  .tb-tick{grid-column:4;grid-row:3;justify-self:end;font-size:13px}
  .tb-pop,.tb-spacer{display:none}
  .tb-events{grid-column:1/-1;grid-row:4;overflow-x:auto;scrollbar-width:none}
  .tb-item .ic{font-size:14px}
  .ticker{height:28px}
  .ticker-tag{display:none}
  .ticker-view{mask-image:none}
  .main{display:flex;flex-direction:column}
  .mapwrap{flex:1 1 0;min-height:120px;border-right:0}
  .panel{flex:none;border-top:1px solid var(--line)}
  .sheet-handle{display:flex;align-items:center;justify-content:center;width:100%;order:0;height:40px;background:transparent;border:0;padding:0}
  .sheet-handle i{width:40px;height:4px;border-radius:9px;background:var(--line2);transition:background .15s}
  .sheet-handle:hover i{background:var(--ink3)}
  .panes{order:1;flex:none;height:var(--sheet);transition:height .3s cubic-bezier(.2,.7,.2,1);min-height:0}
  .panel[data-sheet=closed]{--sheet:0px}
  .panel[data-sheet=half]{--sheet:clamp(200px,36dvh,320px)}
  .panel[data-sheet=full]{--sheet:max(240px,calc(100dvh - 400px))}
  .panel[data-sheet=closed] .panes{visibility:hidden}
  .tabs{order:2;grid-template-columns:repeat(5,1fr);gap:2px;padding:4px 4px 6px;border-top:1px solid var(--line)}
  .tabs button{flex-direction:column;gap:1px;padding:5px 0 4px;min-height:48px;font-size:11.5px}
  .tabs button .ic{font-size:18px}
  .only-mobile{display:inline-flex!important}
  .pane{padding:10px 10px 16px}
  .strip{height:40px}
  .ent{grid-template-columns:auto auto 1fr}
  .ent .tx{white-space:normal}
  .chron-list-m{padding:0}
  .kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
  .kpi b{font-size:18px}
  .btn,.chip,.iconbtn,button.chipx{min-height:40px}
  .iconbtn{width:40px;height:40px}
  .btn.sm{min-height:40px}
  .krow{min-height:52px}
  .modal{padding:18px 16px}
  .map-tools{top:6px;right:6px}
  .inp{min-height:40px}
  .hud-slot-root{left:8px;right:8px;bottom:54px}
  .tb-play{min-height:34px;padding:3px 10px}
  .toasts{top:8px}
  .modal.create{padding:16px 14px}
  .modal.create h2{font-size:26px}
  .skills{grid-template-columns:1fr}
  .create-intro{font-size:14px;margin-bottom:12px}
  .hud-form .iconbtn{width:36px;height:36px}
  .opt{min-height:44px}
  .act{min-height:58px}
  .hud-coll-h{min-height:44px}
}
@media (max-width:420px){
  .tb-play-l{display:none}
  .tb-play{padding:3px 9px}
  .hud-m{gap:7px;padding:6px 8px}
  .hud-m .minibars{width:22px}
  .opts-grid{grid-template-columns:1fr 1fr}
}
@media (max-width:380px){
  .logo-text{font-size:23px}
  .krow{grid-template-columns:30px minmax(0,1fr) 44px auto;gap:7px}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
  .ticker-view{overflow-x:auto;scrollbar-width:none}
  .ticker-track{animation:none!important;position:static;width:max-content}
}
`;

let injected = false;

/** Writes the design tokens + global stylesheet into <head> (idempotent). Call once before rendering. */
export function injectTheme(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.id = "sl-theme";
  el.textContent = globalCss;
  document.head.appendChild(el);
}
