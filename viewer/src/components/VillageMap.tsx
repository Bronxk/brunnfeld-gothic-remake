import { useRef, useEffect, useCallback, useState } from "react";
import { renderVillage, hitTestLocation, screenToWorld, spawnParticle, type Camera, type ActiveAnimation } from "../canvas/renderer";
import { locationPx, setActiveTiles, setActiveBuildings, buildingsFromVillage, TILE_SIZE, WORLD_W, WORLD_H } from "../canvas/map";
import { LABEL_FONT } from "../canvas/sprites";
import { useVillageStore, AGENT_DISPLAY } from "../store";
import type { AgentName } from "../types";

// Centred on the colony (fields in the north to the Baracken in the south), not the empty river bank
const INITIAL_CAMERA: Camera = { x: 768, y: 440, zoom: 0.72 };

export default function VillageMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const cameraRef = useRef<Camera>({ ...INITIAL_CAMERA });
  const cameraInitRef = useRef(false);
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const touchRef = useRef<
    | { mode: "pan"; sx: number; sy: number; cx: number; cy: number; moved: boolean }
    | { mode: "pinch"; dist: number; zoom: number }
    | null
  >(null);
  const animationsRef = useRef<Map<AgentName, ActiveAnimation>>(new Map());
  const [hoveredLoc, setHoveredLoc] = useState<string | null>(null);

  const world = useVillageStore((s) => s.world);
  const activeVillageId = useVillageStore((s) => s.activeVillageId);
  const villages = useVillageStore((s) => s.villages);
  const selectedAgent = useVillageStore((s) => s.selectedAgent);
  const selectAgent = useVillageStore((s) => s.selectAgent);
  const feed = useVillageStore((s) => s.feed);

  // Tick nav state for overlay
  const mode = useVillageStore((s) => s.mode);
  const setMode = useVillageStore((s) => s.setMode);
  const availableTicks = useVillageStore((s) => s.availableTicks);
  const historyTickId = useVillageStore((s) => s.historyTickId);
  const stepHistory = useVillageStore((s) => s.stepHistory);
  const loadHistoryTick = useVillageStore((s) => s.loadHistoryTick);
  const currentTick = useVillageStore((s) => s.currentTick);
  const historyLoading = useVillageStore((s) => s.historyLoading);

  const tickCount = availableTicks.length;
  const historyIdx = historyTickId ? availableTicks.indexOf(historyTickId) : -1;
  const isLive = mode === "live";
  const displayTick = !isLive && historyTickId
    ? parseInt(historyTickId.replace("tick_", ""))
    : currentTick;

  // Spawn particles for recent feed entries
  const lastFeedRef = useRef(0);
  useEffect(() => {
    const latest = feed[0];
    if (!latest || latest.id <= lastFeedRef.current) return;
    lastFeedRef.current = latest.id;
    if (latest.type === "trade" || latest.type === "production") {
      const loc = world?.agent_locations[latest.agent];
      if (loc) {
        const { x, y } = locationPx(loc);
        spawnParticle(x + 24, y, latest.type === "trade" ? "💰" : "⚒");
      }
    }
  }, [feed, world]);

  // Apply village-specific tile/building data when active village changes
  useEffect(() => {
    const v = villages.find(v => v.id === activeVillageId);
    if (v?.locationTiles && Object.keys(v.locationTiles).length > 0) {
      setActiveTiles(v.locationTiles);
      setActiveBuildings(buildingsFromVillage(v.locationTiles, v.locationTypes ?? {}));
    } else {
      setActiveTiles(null);     // fall back to hardcoded Schlackental defaults
      setActiveBuildings(null);
    }
  }, [activeVillageId, villages]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function frame() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) { animRef.current = requestAnimationFrame(frame); return; }
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      if (w === 0 || h === 0) { animRef.current = requestAnimationFrame(frame); return; }
      // Crisp text/sprites on HiDPI screens; capped so the lighting pass stays cheap.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas!.width !== bw || canvas!.height !== bh) {
        canvas!.width = bw;
        canvas!.height = bh;
      }
      // Small screens: start zoomed out a bit, centred on the colony
      if (!cameraInitRef.current) {
        cameraInitRef.current = true;
        if (w < 600) cameraRef.current.zoom = 0.5;
        clampCamera(cameraRef.current, w, h);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bw, bh);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Drain pending animations from store — only track agents of the active village
      const store = useVillageStore.getState();
      const currentWorld = store.world;
      const currentVillageId = store.activeVillageId;
      const newAnims = store.consumeAnimations();
      for (const anim of newAnims) {
        const agentVid = (currentWorld?.economics[anim.agent] as { villageId?: string } | undefined)?.villageId ?? "schlackental";
        if (agentVid !== currentVillageId) continue;
        const from = locationPx(anim.fromLoc);
        const to = locationPx(anim.toLoc);
        const toX = to.x + TILE_SIZE / 2;
        const toY = to.y + TILE_SIZE / 2;
        const existing = animationsRef.current.get(anim.agent);
        let startX = from.x + TILE_SIZE / 2;
        let startY = from.y + TILE_SIZE / 2;
        if (existing) {
          const elapsed = anim.startMs - existing.startMs;
          const t = Math.min(1, elapsed / existing.durationMs);
          const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          startX = existing.fromX + (existing.toX - existing.fromX) * ease;
          startY = existing.fromY + (existing.toY - existing.fromY) * ease;
        }
        animationsRef.current.set(anim.agent, {
          fromX: startX, fromY: startY, toX, toY,
          toLoc: anim.toLoc, startMs: anim.startMs, durationMs: anim.durationMs,
        });
      }

      // Filter world to active village's agents only
      const filteredWorld = currentWorld ? {
        ...currentWorld,
        agent_locations: Object.fromEntries(
          Object.entries(currentWorld.agent_locations).filter(([a]) =>
            ((currentWorld.economics[a] as { villageId?: string })?.villageId ?? "schlackental") === currentVillageId
          )
        ),
      } : null;

      renderVillage(ctx, filteredWorld, cameraRef.current, selectedAgent, hoveredLoc, w, h, animationsRef.current);

      const now = performance.now();
      for (const [agent, anim] of animationsRef.current) {
        if (now - anim.startMs >= anim.durationMs) {
          animationsRef.current.delete(agent);
          store.commitAgentLocation(agent, anim.toLoc);
        }
      }

      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [world, selectedAgent, hoveredLoc]);

  const ZOOM_MIN = 0.35;
  const ZOOM_MAX = 2.0;

  const clampCamera = useCallback((cam: Camera, canvasW: number, canvasH: number) => {
    // Keep the map covering the view; if the view is larger than the map, centre it
    const halfW = (canvasW / 2) / cam.zoom;
    const halfH = (canvasH / 2) / cam.zoom;
    cam.x = halfW * 2 >= WORLD_W ? WORLD_W / 2 : Math.max(halfW, Math.min(WORLD_W - halfW, cam.x));
    cam.y = halfH * 2 >= WORLD_H ? WORLD_H / 2 : Math.max(halfH, Math.min(WORLD_H - halfH, cam.y));
  }, []);

  /** Zoom toward a screen point (canvas-relative px): the world point under it stays fixed. */
  const zoomAt = useCallback((mx: number, my: number, newZoomRaw: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cam = cameraRef.current;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoomRaw));
    if (newZoom === cam.zoom) return;
    const wx = cam.x + (mx - canvas.clientWidth  / 2) / cam.zoom;
    const wy = cam.y + (my - canvas.clientHeight / 2) / cam.zoom;
    cam.zoom = newZoom;
    cam.x = wx - (mx - canvas.clientWidth  / 2) / newZoom;
    cam.y = wy - (my - canvas.clientHeight / 2) / newZoom;
    clampCamera(cam, canvas.clientWidth, canvas.clientHeight);
  }, [clampCamera]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Zoom proportional to deltaY — feels smooth on both trackpad and mouse wheel
    const delta = e.deltaY * (e.deltaMode === 1 ? 30 : 1); // normalise line-mode
    const factor = Math.exp(-delta * 0.001);
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, cameraRef.current.zoom * factor);
  }, [zoomAt]);

  // Touch: one finger pans, two fingers pinch-zoom (taps still arrive as emulated mouse clicks)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches;
    if (t.length === 1) {
      touchRef.current = { mode: "pan", sx: t[0]!.clientX, sy: t[0]!.clientY, cx: cameraRef.current.x, cy: cameraRef.current.y, moved: false };
    } else if (t.length >= 2) {
      const d = Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
      touchRef.current = { mode: "pinch", dist: d || 1, zoom: cameraRef.current.zoom };
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const canvas = canvasRef.current;
    const st = touchRef.current;
    if (!canvas || !st) return;
    const t = e.touches;
    const cam = cameraRef.current;
    if (st.mode === "pan" && t.length === 1) {
      const dx = t[0]!.clientX - st.sx;
      const dy = t[0]!.clientY - st.sy;
      if (!st.moved && Math.abs(dx) + Math.abs(dy) > 6) st.moved = true;
      if (st.moved) {
        cam.x = st.cx - dx / cam.zoom;
        cam.y = st.cy - dy / cam.zoom;
        clampCamera(cam, canvas.clientWidth, canvas.clientHeight);
      }
    } else if (st.mode === "pinch" && t.length >= 2) {
      const d = Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
      const rect = canvas.getBoundingClientRect();
      const mx = (t[0]!.clientX + t[1]!.clientX) / 2 - rect.left;
      const my = (t[0]!.clientY + t[1]!.clientY) / 2 - rect.top;
      zoomAt(mx, my, st.zoom * (d / st.dist));
    }
  }, [clampCamera, zoomAt]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0) touchRef.current = null;
    else if (e.touches.length === 1) {
      const t = e.touches[0]!;
      touchRef.current = { mode: "pan", sx: t.clientX, sy: t.clientY, cx: cameraRef.current.x, cy: cameraRef.current.y, moved: true };
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      dragRef.current = { sx: e.clientX, sy: e.clientY, cx: cameraRef.current.x, cy: cameraRef.current.y };
    }
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const wx = e.clientX - rect.left;
    const wy = e.clientY - rect.top;
    const world_ = screenToWorld(wx, wy, cameraRef.current, canvas.clientWidth, canvas.clientHeight);
    const loc = hitTestLocation(world_.x, world_.y);
    setHoveredLoc(loc);
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.sx;
      const dy = e.clientY - dragRef.current.sy;
      cameraRef.current.x = dragRef.current.cx - dx / cameraRef.current.zoom;
      cameraRef.current.y = dragRef.current.cy - dy / cameraRef.current.zoom;
      clampCamera(cameraRef.current, canvas.clientWidth, canvas.clientHeight);
    }
  }, [clampCamera]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const wasDrag = dragRef.current &&
      (Math.abs(e.clientX - dragRef.current.sx) > 4 || Math.abs(e.clientY - dragRef.current.sy) > 4);
    dragRef.current = null;
    if (wasDrag) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const wx = e.clientX - rect.left;
    const wy = e.clientY - rect.top;
    const wc = screenToWorld(wx, wy, cameraRef.current, canvas.clientWidth, canvas.clientHeight);
    const loc = hitTestLocation(wc.x, wc.y);
    if (loc && world) {
      const agents = Object.entries(world.agent_locations)
        .filter(([a, l]) => l === loc && ((world.economics[a] as { villageId?: string })?.villageId ?? "schlackental") === activeVillageId)
        .map(([a]) => a as AgentName);
      // When caravan is active, the Gipsy sprite at Schmugglerpfad IS Vogt Reinhart —
      // select him regardless of where the frontend thinks he is
      if (loc === "Schmugglerpfad" && world.active_events?.some(e => e.type === "caravan")) {
        if (!agents.includes("reinhart")) agents.push("reinhart");
      }
      if (agents.length > 0) {
        const idx = selectedAgent ? agents.indexOf(selectedAgent) : -1;
        selectAgent(agents[(idx + 1) % agents.length]!);
      } else {
        selectAgent(null);
      }
    } else {
      selectAgent(null);
    }
  }, [world, selectedAgent, selectAgent]);

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value);
    const tickId = availableTicks[idx];
    if (tickId) loadHistoryTick(tickId);
    if (mode !== "history") setMode("history");
  }, [availableTicks, loadHistoryTick, mode, setMode]);

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "2px 10px", border: `1px solid ${active ? "rgba(242,169,59,0.55)" : "#3a2e21"}`,
    borderRadius: 7, background: active ? "rgba(242,169,59,0.12)" : "rgba(27,22,18,0.8)",
    color: active ? "#f2a93b" : "#a2916f", cursor: active ? "default" : "pointer",
    fontSize: 11, fontFamily: LABEL_FONT, fontWeight: 600, letterSpacing: 1.2,
    display: "flex", alignItems: "center", gap: 6, flexShrink: 0, height: 24,
  });

  const stepStyle: React.CSSProperties = {
    width: 26, height: 24, border: "1px solid #3a2e21", borderRadius: 7,
    background: "rgba(27,22,18,0.8)", color: "#ecdcbc", cursor: "pointer",
    fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
    opacity: historyLoading ? 0.4 : 1, flexShrink: 0, padding: 0,
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#0c0a09" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: hoveredLoc ? "pointer" : "grab" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { dragRef.current = null; setHoveredLoc(null); }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      />

      {/* Location tooltip */}
      {hoveredLoc && (
        <div style={{
          position: "absolute", top: 8, left: 8, maxWidth: "calc(100% - 16px)",
          background: "rgba(20,16,13,0.9)", border: "1px solid #52422e",
          color: "#ecdcbc", padding: "4px 11px", borderRadius: 8,
          fontSize: 13, fontFamily: LABEL_FONT, pointerEvents: "none",
        }}>
          {hoveredLoc}
          {world && (() => {
            const here = Object.entries(world.agent_locations)
              .filter(([a, l]) => l === hoveredLoc && ((world.economics[a] as { villageId?: string })?.villageId ?? "schlackental") === activeVillageId)
              .map(([a]) => (a === "player" ? "Du" : AGENT_DISPLAY[a as AgentName]));
            return here.length > 0 ? ` — ${here.join(", ")}` : "";
          })()}
        </div>
      )}

      {/* Playback controls overlay */}
      <div style={{
        position: "absolute", bottom: 8, left: 8, right: 8,
        height: 38,
        background: "rgba(20,16,13,0.9)",
        border: "1px solid #3a2e21",
        borderRadius: 10,
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 10px",
        fontFamily: LABEL_FONT,
      }}>
        {/* LIVE */}
        <button
          onClick={isLive ? undefined : () => setMode("live")}
          style={btnStyle(isLive)}
          title={isLive ? "Live-Ansicht aktiv" : "Zurück zur Live-Ansicht"}
        >
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: isLive ? "#9cc46a" : "#6f6249",
            boxShadow: isLive ? "0 0 6px #9cc46a" : "none",
          }} />
          LIVE
        </button>

        <button
          onClick={() => stepHistory(-1)}
          disabled={historyLoading || tickCount === 0}
          style={stepStyle}
          title="Vorheriger Tick"
          aria-label="Vorheriger Tick"
        >‹</button>

        {tickCount > 1 ? (
          <input
            type="range" min={0} max={tickCount - 1}
            value={historyIdx >= 0 ? historyIdx : tickCount - 1}
            onChange={handleSlider}
            style={{ flex: 1, accentColor: "#f2a93b", cursor: "pointer", minWidth: 0, height: 3 }}
            aria-label="Tick wählen"
          />
        ) : (
          <div style={{ flex: 1 }} />
        )}

        <button
          onClick={() => stepHistory(1)}
          disabled={historyLoading || tickCount === 0}
          style={stepStyle}
          title="Nächster Tick"
          aria-label="Nächster Tick"
        >›</button>

        <span style={{ fontSize: 12, color: "#ecdcbc", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
          {historyLoading ? "…" : `Tick ${displayTick}`}
          {tickCount > 0 && <span style={{ color: "#6f6249" }}> / {tickCount}</span>}
        </span>

        {world && (
          <span style={{
            fontSize: 12, color: "#a2916f", minWidth: 0, flexShrink: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {world.current_time}
          </span>
        )}
      </div>
    </div>
  );
}
