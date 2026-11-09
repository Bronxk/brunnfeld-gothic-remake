// 3D observer view (lazy-loaded by App). Bridges the zustand store to ColonyScene and renders the camera / time UI.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVillageStore, colonistIds, AGENT_DISPLAY } from "../store";
import { tickClock } from "../types";
import type { VillageInfo } from "../types";
import { buildLayout, ColonyScene, type ColonistInfo, type Layout } from "./scene";
import type { RoadInfo } from "./layout";
import type { BadgeTone } from "./figures";

const CSS = `
.t3-root{position:absolute;inset:0;overflow:hidden;background:var(--bg);user-select:none;-webkit-user-select:none}
.t3-root canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}
.t3-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.t3-label,.t3-tag,.t3-bubble{position:absolute;left:0;top:0;will-change:transform;white-space:nowrap}
.t3-label{font-family:var(--f-logo);font-size:22px;letter-spacing:.04em;color:var(--ink);text-shadow:0 2px 10px #000,0 0 3px #000;opacity:.9}
.t3-tag{padding:3px 9px;border-radius:var(--r);background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line2);color:var(--ink);font-size:12.5px;box-shadow:0 4px 14px rgba(0,0,0,.4)}
.t3-tag-sel{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--panel))}
.t3-bubble{white-space:normal;width:max-content;max-width:190px;padding:6px 10px;border-radius:10px;background:color-mix(in srgb,var(--panel2) 94%,transparent);border:1px solid color-mix(in srgb,var(--accent) 38%,var(--line2));color:var(--ink);font-size:13px;line-height:1.25;box-shadow:0 6px 20px rgba(0,0,0,.45)}
.t3-ui{position:absolute;z-index:6;display:flex;gap:6px}
.t3-ctl{top:8px;right:8px;flex-direction:column;flex-wrap:wrap-reverse;align-content:flex-start;max-height:calc(100% - 72px)}
.t3-btn{width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;background:color-mix(in srgb,var(--panel) 88%,transparent);border:1px solid var(--line2);color:var(--ink);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background .15s,transform .15s,border-color .15s;cursor:pointer;padding:0}
.t3-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.t3-btn:hover:not(:disabled){background:color-mix(in srgb,var(--accent) 12%,var(--panel));border-color:color-mix(in srgb,var(--accent) 45%,var(--line2))}
.t3-btn:active:not(:disabled){transform:scale(.94)}
.t3-btn[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 18%,var(--panel));border-color:var(--accent);color:var(--accent)}
.t3-btn:disabled{opacity:.4;cursor:default}
.t3-time{top:8px;left:8px;align-items:center;gap:8px;padding:5px 10px;max-width:calc(100% - 64px);border-radius:10px;background:color-mix(in srgb,var(--panel) 88%,transparent);border:1px solid var(--line2);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-size:12.5px;color:var(--ink2)}
.t3-time svg{width:17px;height:17px;flex:none;fill:none;stroke:var(--accent);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.t3-time .t3-lbl{display:none}
.t3-time output{min-width:38px;text-align:right;color:var(--ink);font-variant-numeric:tabular-nums}
.t3-time input[type=range]{width:min(150px,28vw);min-width:70px;accent-color:var(--accent);height:22px;margin:0}
.t3-time button{padding:2px 8px;border-radius:99px;font-size:11.5px;color:var(--ink2);background:transparent;border:1px solid var(--line2);cursor:pointer}
.t3-time button[aria-pressed=true]{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 55%,transparent);background:var(--accent-soft)}
.t3-tour{right:8px;bottom:8px}
.t3-tour .btn[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 18%,var(--panel));border-color:var(--accent);color:var(--accent)}
.t3-meet{top:56px;left:8px;max-width:calc(100% - 64px)}
.t3-cap{position:absolute;z-index:5;left:50%;bottom:54px;transform:translate(-50%,8px);max-width:calc(100% - 24px);opacity:0;pointer-events:none;transition:opacity .5s,transform .5s;text-align:center;padding:6px 14px;border-radius:10px;background:color-mix(in srgb,var(--panel) 88%,transparent);border:1px solid var(--line2);color:var(--ink);font-size:14px}
.t3-cap.on{opacity:1;transform:translate(-50%,0)}
.t3-cut{position:absolute;inset:0;z-index:7;background:#000;opacity:0;pointer-events:none;transition:opacity .22s ease}
.t3-cut.on{opacity:1;transition-duration:.14s}
.t3-fail{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;color:var(--ink2);padding:20px;text-align:center}
@media (max-width:719px){.t3-btn{width:44px;height:44px}.t3-label{font-size:17px}}
@media (prefers-reduced-motion:reduce){.t3-cap,.t3-cut,.t3-btn{transition:none}}
`;

const TIER_BADGE: Record<string, { letter: string; tone: BadgeTone }> = {
  haiku: { letter: "H", tone: "info" },
  sonnet: { letter: "S", tone: "accent" },
  opus: { letter: "O", tone: "bad" },
};

function parseHour(time: string | undefined, tick: number): number {
  const m = time?.match(/(\d{1,2}):(\d{2})/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const t = tickClock(tick).match(/(\d{1,2}):(\d{2})/);
  return t ? Number(t[1]) : 12;
}

const fmtHour = (h: number): string => {
  const x = ((h % 24) + 24) % 24;
  const hh = Math.floor(x), mm = Math.round((x - hh) * 60);
  return `${String(mm === 60 ? (hh + 1) % 24 : hh).padStart(2, "0")}:${String(mm === 60 ? 0 : mm).padStart(2, "0")}`;
};

function Ic({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}

async function fetchRoads(): Promise<RoadInfo[] | null> {
  try {
    const res = await fetch("/api/world/roads");
    if (!res.ok) {
      console.warn(`[3d] GET /api/world/roads -> HTTP ${res.status}; chaining villages instead`);
      return null;
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) { console.warn("[3d] /api/world/roads returned no list; chaining villages instead"); return null; }
    return (data as RoadInfo[]).filter((r) => r && Array.isArray(r.connectsVillages) && r.connectsVillages.length === 2);
  } catch (err) {
    console.warn("[3d] loading /api/world/roads failed; chaining villages instead", err);
    return null;
  }
}

export interface ThreeViewProps {
  /** Opens the Vogtei (council) view while an Appell runs. */
  onOpenMeeting: () => void;
}

export default function ThreeView({ onOpenMeeting }: ThreeViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ColonyScene | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [touring, setTouring] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [cut, setCut] = useState(false);
  const [override, setOverride] = useState<number | null>(null);
  const [roads, setRoads] = useState<RoadInfo[] | null | undefined>(undefined);

  const world = useVillageStore((s) => s.world);
  const villages = useVillageStore((s) => s.villages);
  const selected = useVillageStore((s) => s.selectedAgent);
  const agentModels = useVillageStore((s) => s.agentModels);
  const warRelations = useVillageStore((s) => s.warRelations);
  const warMarches = useVillageStore((s) => s.warMarches);
  const activeMeeting = useVillageStore((s) => s.activeMeeting);
  const setViewMode = useVillageStore((s) => s.setViewMode);
  const simHour = useVillageStore((s) => parseHour(s.world?.current_time, s.currentTick));

  /* scene lifetime */
  useEffect(() => {
    const canvas = canvasRef.current, overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const sc = new ColonyScene(canvas, overlay, {
        onSelect: (id) => useVillageStore.getState().selectAgent(id),
        onFollow: setFollowing,
        onTour: setTouring,
        onCaption: setCaption,
        onCut: () => { setCut(true); clearTimeout(cutTimer); cutTimer = setTimeout(() => setCut(false), 260); },
      }, reduced);
      sceneRef.current = sc;
      setReady(true);
    } catch (err) {
      console.error("[3d] could not start the 3D view", err);
      setFailed(err instanceof Error ? err.message : String(err));
    }
    return () => {
      clearTimeout(cutTimer);
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, []);

  /* roads (once; a 404 falls back to chaining the villages) */
  useEffect(() => {
    let alive = true;
    void fetchRoads().then((r) => { if (alive) setRoads(r); });
    return () => { alive = false; };
  }, []);

  /* layout */
  const layout: Layout | null = useMemo(() => {
    if (roads === undefined) return null;
    const vs: VillageInfo[] = villages;
    const l = buildLayout(vs, roads);
    if (l.roadsFallback) console.warn("[3d] no roads from the API, villages are chained in order");
    return l;
  }, [villages, roads]);
  useEffect(() => { if (ready && layout) sceneRef.current?.setLayout(layout); }, [ready, layout]);

  /* colonists */
  const colonists: ColonistInfo[] = useMemo(() => {
    if (!world) return [];
    const hour = parseHour(world.current_time, world.current_tick);
    return colonistIds(world).flatMap((id): ColonistInfo[] => {
      const loc = world.agent_locations[id];
      if (!loc) return [];
      const eco = world.economics[id];
      const body = world.body[id];
      const dead = (body?.starvation_ticks ?? 0) >= 999;
      const atHome = !!eco && loc === eco.homeLocation;
      // The sim has no sleep flag: at home during the night (or exhausted) counts as asleep.
      const asleep = !dead && atHome && (hour >= 21 || hour < 6 || (body?.energy ?? 10) <= 2);
      const model = agentModels?.models[id];
      const def = agentModels?.default;
      let badge: ColonistInfo["badge"] = null;
      if (model && def && model !== def) badge = TIER_BADGE[model] ?? { letter: model.charAt(0).toUpperCase() || "?", tone: "mute" };
      return [{
        id, name: AGENT_DISPLAY[id] ?? id, loc, craft: eco?.skill ?? "none",
        vitals: dead ? "dead" : asleep ? "sleep" : "alive",
        working: !!eco && !asleep && !dead && loc === eco.workLocation && loc !== eco.homeLocation,
        badge,
      }];
    });
  }, [world, agentModels]);
  useEffect(() => { if (ready) sceneRef.current?.setColonists(colonists); }, [ready, colonists, layout]);

  /* selection, time, war */
  useEffect(() => { if (ready) sceneRef.current?.setSelected(selected); }, [ready, selected, colonists.length]);
  useEffect(() => { if (ready) sceneRef.current?.setHour(simHour); }, [ready, simHour]);
  useEffect(() => { if (ready) sceneRef.current?.setOverride(override); }, [ready, override]);
  useEffect(() => { if (ready && layout) sceneRef.current?.setWar(warRelations); }, [ready, warRelations, layout]);
  useEffect(() => { if (ready) sceneRef.current?.setMarchers(Object.keys(warMarches)); }, [ready, warMarches, layout]);

  /* The 2D map is unmounted in 3D, so this view must take over its animation queue and commit the new locations. */
  const animCount = useVillageStore((s) => s.pendingAnimations.length);
  const commitTimers = useRef(new Map<ReturnType<typeof setTimeout>, { agent: string; loc: string }>());
  useEffect(() => {
    if (animCount === 0) return;
    const st = useVillageStore.getState();
    for (const a of st.consumeAnimations()) {
      const entry = { agent: a.agent, loc: a.toLoc };
      const h = setTimeout(() => {
        commitTimers.current.delete(h);
        useVillageStore.getState().commitAgentLocation(entry.agent, entry.loc);
      }, 250);
      commitTimers.current.set(h, entry);
    }
  }, [animCount]);
  useEffect(() => () => {
    for (const [h, e] of commitTimers.current) { clearTimeout(h); useVillageStore.getState().commitAgentLocation(e.agent, e.loc); }
    commitTimers.current.clear();
  }, []);

  /* speech / trade bubbles from the live feed (newest entries are first, ids increase) */
  const lastFeedId = useRef<number | null>(null);
  useEffect(() => {
    const unsub = useVillageStore.subscribe((s) => {
      const sc = sceneRef.current;
      if (!sc) return;
      const feed = s.feed;
      if (lastFeedId.current === null) { lastFeedId.current = feed[0]?.id ?? -1; return; }
      const fresh = [];
      for (const e of feed) { if (e.id <= lastFeedId.current) break; fresh.push(e); }
      if (fresh.length === 0) return;
      lastFeedId.current = fresh[0]!.id;
      for (const e of fresh.reverse()) {
        if (e.tick < s.currentTick - 1) continue; // history loaded after mount
        if (e.type === "speak") sc.say(e.agent, e.text);
        else if (e.type === "trade") sc.trade(e.agent, e.agent, e.text);
      }
    });
    return unsub;
  }, []);

  /* raids */
  const lastRaid = useRef<number | null>(null);
  useEffect(() => {
    const unsub = useVillageStore.subscribe((s) => {
      const sc = sceneRef.current;
      if (!sc) return;
      const raids = s.warRaids;
      if (lastRaid.current === null) { lastRaid.current = raids.at(-1)?.id ?? -1; return; }
      for (const r of raids) {
        if (r.id <= lastRaid.current) continue;
        lastRaid.current = r.id;
        sc.raid(r.attacker, r.target, !!r.success, r.text);
      }
    });
    return unsub;
  }, []);

  const sc = () => sceneRef.current;
  const shownHour = override ?? simHour;
  const night = shownHour < 6 || shownHour >= 19.5;

  return (
    <div className="t3-root" role="application" aria-label="3D-Ansicht der Kolonie">
      <style>{CSS}</style>
      <canvas ref={canvasRef} tabIndex={0} aria-label="3D-Karte: ziehen zum Drehen, Rad zum Zoomen" />
      <div className="t3-overlay" ref={overlayRef} />
      <div className={`t3-cut${cut ? " on" : ""}`} />
      <div className={`t3-cap${caption && touring ? " on" : ""}`} role="status">{caption}</div>

      {failed && (
        <div className="t3-fail">
          <span>3D nicht verfügbar ({failed}).</span>
          <button type="button" className="btn" onClick={() => setViewMode("2d")}>Zurück zu 2D</button>
        </div>
      )}

      {!failed && (
        <>
          <div className="t3-ui t3-time" title="Tageszeit der Ansicht (Auto = Simulationsuhr)">
            <Ic>{night ? <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z" /> : <><circle cx="12" cy="12" r="3.8" /><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7" /></>}</Ic>
            <input type="range" min={0} max={24} step={0.25} value={shownHour} aria-label="Tageszeit"
              onChange={(e) => setOverride(Number(e.target.value))} />
            <output>{fmtHour(shownHour)}</output>
            <button type="button" aria-pressed={override === null} onClick={() => setOverride(null)} title="Der Simulationsuhr folgen">Auto</button>
          </div>

          {activeMeeting && (
            <div className="t3-ui t3-meet">
              <button type="button" className="btn sm" onClick={onOpenMeeting}>Appell läuft – in 2D ansehen</button>
            </div>
          )}

          <div className="t3-ui t3-ctl">
            <button type="button" className="t3-btn" title="Heranzoomen" aria-label="Heranzoomen" onClick={() => sc()?.zoom(1)}>
              <Ic><path d="M12 5v14M5 12h14" /></Ic>
            </button>
            <button type="button" className="t3-btn" title="Herauszoomen" aria-label="Herauszoomen" onClick={() => sc()?.zoom(-1)}>
              <Ic><path d="M5 12h14" /></Ic>
            </button>
            <button type="button" className="t3-btn" title="Ansicht zurücksetzen" aria-label="Ansicht zurücksetzen" onClick={() => sc()?.resetView()}>
              <Ic><path d="M4 11l8-7 8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5z" /></Ic>
            </button>
            <button type="button" className="t3-btn" title="Kamera folgt der gewählten Figur" aria-label="Gewählter Figur folgen" aria-pressed={following}
              disabled={!selected} onClick={() => sc()?.setFollowEnabled(!following)}>
              <Ic><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></Ic>
            </button>
          </div>

          <div className="t3-ui t3-tour">
            <button type="button" className="btn" aria-pressed={touring} onClick={() => sc()?.setTour(!touring)}
              title="Die Kamera schneidet automatisch zu Gesprächen, Handel und Überfällen">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {touring ? <rect x="6" y="6" width="12" height="12" rx="1.5" /> : <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5l5-3v9l-5-3z" /></>}
              </svg>
              {touring ? "Tour beenden" : "Auto-Tour"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
