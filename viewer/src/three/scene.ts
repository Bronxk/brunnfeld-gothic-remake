// ColonyScene: the 3D observer (diorama valleys, figures, camera, day/night, war visuals, auto-tour).
// Plain three.js; owned by ThreeView.tsx. Everything created here is disposed in dispose().

import * as THREE from "three";
import { buildLayout, standPosition, routeBetween, type Layout, type V2, type VillageSlot } from "./layout";
import { makeTerrainFns, buildTerrain, buildRoads, buildRoadGlow, buildTrees, buildRockslide, type HeightFn } from "./terrain";
import { buildBuilding, type BuildingObj } from "./buildings";
import { makeFigure, type Figure, type BadgeTone } from "./figures";
import {
  LampSystem, FireBurst, makeParticles, makeSky, makeMist, mixStops, makeWarMarks, type SkyObj, type WarMarks, type LampDef,
} from "./effects";
import { CameraRig } from "./camera";
import { lerp, smooth, disposeObject } from "./util";

export { buildLayout };
export type { Layout };

export interface ColonistInfo {
  id: string;
  name: string;
  loc: string;
  craft: string;
  vitals: "alive" | "sleep" | "dead";
  working: boolean;
  badge: { letter: string; tone: BadgeTone } | null;
}

export interface SceneCallbacks {
  onSelect(id: string | null): void;
  onFollow(on: boolean): void;
  onTour(on: boolean): void;
  onCaption(text: string | null): void;
  onCut(): void;
}

export interface WarRel { a: string; b: string; stance: string }

interface Walker {
  fig: Figure;
  info: ColonistInfo;
  pos: V2;
  yaw: number;
  route: V2[];
  speed: number;
  phase: number;
  loc: string;
}

interface Bubble { el: HTMLElement; id: string; until: number }
interface Hotspot { id: number; kind: "raid" | "trade" | "speech"; at: number; caption: string; agent?: string; village?: string }

const DAY_KEYS: [number, number][] = [[0, 0.02], [5, 0.04], [6.5, 0.4], [8, 0.85], [10, 1], [16, 1], [18, 0.85], [19.5, 0.4], [21, 0.08], [24, 0.02]];
/** Sim hour (0..24) → daylight 0..1 (night..day). */
export function hourToDaylight(h: number): number {
  const x = ((h % 24) + 24) % 24;
  for (let i = 1; i < DAY_KEYS.length; i++) {
    const a = DAY_KEYS[i - 1]!, b = DAY_KEYS[i]!;
    if (x <= b[0]) return lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
  }
  return 0.02;
}

const TOUR_DUR = 8.5;

export class ColonyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  private hemi = new THREE.HemisphereLight(0x2a3560, 0x1b120c, 0.8);
  private dir = new THREE.DirectionalLight(0x7a92d0, 0.55);
  private sky: SkyObj = makeSky();
  private fog = new THREE.FogExp2(0x171320, 0.0045);
  private worldGroup: THREE.Group | null = null;
  private layout: Layout | null = null;
  private H: HeightFn = () => 0;
  private lamps: LampSystem | null = null;
  private buildings = new Map<string, BuildingObj>();
  private buildingHits: THREE.Mesh[] = [];
  private particles: THREE.Points[] = [];
  private wheels: THREE.Object3D[] = [];
  private flags: THREE.Object3D[] = [];
  private flames: THREE.Object3D[] = [];
  private goats: THREE.Group[] = [];
  private mist: THREE.Group | null = null;
  private marks = new Map<string, WarMarks>();
  private glow = new Map<string, THREE.Mesh>();
  private glowing = new Set<string>();
  private bursts: FireBurst[] = [];
  private labels: { el: HTMLElement; pos: THREE.Vector3 }[] = [];
  private walkers = new Map<string, Walker>();
  private rings: { sel: THREE.Mesh; hov: THREE.Mesh };
  private selected: string | null = null;
  private hoverFig: string | null = null;
  private hoverLoc: string | null = null;
  private tagSel: HTMLElement;
  private tagHov: HTMLElement;
  private bubbles: Bubble[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private ptr = { x: 0, y: 0, dirty: false, down: null as null | { x: number; y: number; t: number } };

  private hourTarget = 12;
  private override: number | null = null;
  private day = 0.5;
  private dayApplied = -1;

  private followId: string | null = null;
  private touring = false;
  private tourTimer = 0;
  private tourDur = TOUR_DUR;
  private recent: number[] = [];
  private hot: Hotspot[] = [];
  private hotId = 0;

  private raf = 0;
  private lastT = 0;
  private clock = 0;
  private disposed = false;
  private portrait = false;
  private ro: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private tmpV = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLElement, private cb: SceneCallbacks, private reduced: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(26, 1, 2, 1600);
    this.camera.position.set(0, 60, 120);
    this.scene.fog = this.fog;
    this.scene.add(this.sky.group, this.hemi, this.dir);
    this.rig = new CameraRig(this.camera, canvas, reduced, () => this.H);
    this.rig.onUserInput = (k) => {
      if (this.touring) this.setTour(false);
      if (k === "pan" || k === "key") this.setFollowEnabled(false);
    };
    const mkRing = (a: number, b: number, color: number, op: number) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(a, b, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 4;
      this.scene.add(m);
      return m;
    };
    this.rings = { sel: mkRing(0.62, 0.86, 0xf2a93b, 0.95), hov: mkRing(0.5, 0.62, 0xffe6b0, 0.75) };
    this.tagSel = this.mkEl("t3-tag t3-tag-sel");
    this.tagHov = this.mkEl("t3-tag");

    const on = <T extends Event>(el: EventTarget, ev: string, fn: (e: T) => void) => {
      el.addEventListener(ev, fn as EventListener);
      this.cleanups.push(() => el.removeEventListener(ev, fn as EventListener));
    };
    on<PointerEvent>(canvas, "pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.ptr.x = e.clientX - r.left; this.ptr.y = e.clientY - r.top; this.ptr.dirty = true;
    });
    on<PointerEvent>(canvas, "pointerleave", () => { this.ptr.dirty = false; this.setHover(null, null); });
    on<PointerEvent>(canvas, "pointerdown", (e) => { this.ptr.down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    on<PointerEvent>(canvas, "pointerup", (e) => {
      const d = this.ptr.down;
      this.ptr.down = null;
      if (!d || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return;
      const r = canvas.getBoundingClientRect();
      const hit = this.pick(e.clientX - r.left, e.clientY - r.top);
      this.cb.onSelect(hit.fig);
    });
    on<Event>(document, "visibilitychange", () => { this.lastT = 0; });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.applyDaylight(this.day, true);
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ───────────── DOM helpers ───────────── */

  private mkEl(cls: string): HTMLElement {
    const el = document.createElement("div");
    el.className = cls;
    el.style.display = "none";
    this.overlay.appendChild(el);
    return el;
  }

  private project(p: THREE.Vector3, el: HTMLElement, w: number, h: number): boolean {
    this.tmpV.copy(p).project(this.camera);
    const vis = this.tmpV.z < 1 && Math.abs(this.tmpV.x) < 1.15 && Math.abs(this.tmpV.y) < 1.15;
    if (!vis) { el.style.display = "none"; return false; }
    el.style.display = "";
    el.style.transform = `translate(${((this.tmpV.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.tmpV.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
    return true;
  }

  /* ───────────── layout ───────────── */

  setLayout(layout: Layout): void {
    if (this.layout && this.layout.signature === layout.signature) return;
    this.teardownWorld();
    this.layout = layout;
    const cap = 11;
    const fns = makeTerrainFns(layout, cap);
    this.H = fns.H;
    const H = fns.H;
    const wg = new THREE.Group();
    this.worldGroup = wg;
    this.scene.add(wg);

    const terrain = buildTerrain(layout, fns, cap, 5);
    if (!Array.isArray(terrain.material)) terrain.material.side = THREE.DoubleSide;
    wg.add(terrain);
    const roads = buildRoads(layout, H);
    wg.add(roads.group);
    this.glow = buildRoadGlow(layout, H);
    for (const g of this.glow.values()) wg.add(g);

    this.lamps?.pointLights.forEach((l) => this.scene.remove(l));
    if (this.lamps) this.scene.remove(this.lamps.eventLight);
    const lamps = new LampSystem(H, 8, this.scene);
    this.lamps = lamps;
    wg.add(lamps.group);
    const smokeKinds: Record<string, Parameters<typeof makeParticles>[0] extends infer O ? Partial<O> : never> = {
      forge: { count: 22, size: 1.5, rise: 8, spread: 2.2, life: 5.2, color: 0x3d3a42, opacity: 0.55, drift: [0.5, 0.2], fade: 1.1 },
      kiln: { count: 26, size: 2.2, rise: 11, spread: 3.2, life: 7, color: 0x56535b, opacity: 0.45, drift: [0.7, 0.3], fade: 1.2 },
      chimney: { count: 9, size: 0.85, rise: 4.2, spread: 1.0, life: 4.8, color: 0x56525b, opacity: 0.38, drift: [0.45, 0.2], fade: 1.2 },
    };
    const ctx = {
      lamp: (l: LampDef) => lamps.add(l),
      smoke: (s: { p: THREE.Vector3; kind: "chimney" | "forge" | "kiln" }) => {
        const o = smokeKinds[s.kind]!;
        const pts = makeParticles({ count: 9, size: 1, rise: 4, spread: 1, life: 5, color: 0x555555, opacity: 0.4, ...o, x: s.p.x, y: s.p.y, z: s.p.z, seed: Math.floor(s.p.x * 13 + s.p.z * 7) });
        lamps.group.add(pts);
        this.particles.push(pts);
      },
      sparks: (s: { p: THREE.Vector3 }) => {
        const pts = makeParticles({ count: 12, size: 0.14, rise: 3.2, spread: 1.6, life: 1.7, color: 0xff9a3a, opacity: 1, additive: true, drift: [0.2, 0.1], fade: 1.6, x: s.p.x, y: s.p.y, z: s.p.z, seed: Math.floor(s.p.x * 5 + 3) });
        lamps.group.add(pts);
        this.particles.push(pts);
      },
    };

    const avoid: { x: number; z: number; r: number }[] = [];
    for (const v of layout.villages) {
      for (const spec of v.locations) {
        const b = buildBuilding(spec, H, ctx);
        wg.add(b.group);
        b.group.traverse((o) => { if (o.userData.hit) o.userData.loc = b.loc; });
        this.buildings.set(spec.name, b);
        if (b.hit) this.buildingHits.push(b.hit);
        this.wheels.push(...b.wheels); this.flags.push(...b.flags); this.flames.push(...b.flames); this.goats.push(...b.goats);
        const k = spec.kind;
        avoid.push({ x: b.group.position.x, z: b.group.position.z, r: k === "field" ? 9 : k === "pasture" ? 7 : k === "mine" ? 6 : k === "forest" ? 0.1 : k === "hub" ? 4.5 : k === "trail" ? 3 : 4.2 });
      }
      if (v.isDefault) {
        wg.add(buildRockslide(v.ox, v.oz, H));
        const dust = makeParticles({ count: 16, size: 6, rise: 4, spread: 8, life: 9, color: 0x6a655f, opacity: 0.18, drift: [0.3, 0.1], fade: 1, x: v.ox + 6, y: H(v.ox + 6, v.oz + 14.5) + 0.5, z: v.oz + 13.5 });
        wg.add(dust);
        this.particles.push(dust);
        avoid.push({ x: v.ox + 6, z: v.oz + 12.5, r: 7 }, { x: v.ox + 24, z: v.oz - 25.6, r: 5 });
      }
      const marks = makeWarMarks(v.hub.x, v.hub.z, H);
      wg.add(marks.group);
      this.marks.set(v.id, marks);
    }
    for (const s of roads.samples) avoid.push({ x: s.x, z: s.z, r: 1.7 });
    wg.add(buildTrees(layout, H, fns.sd, avoid).group);

    const b = layout.bounds;
    this.mist = makeMist(4 + layout.villages.length * 2, { x0: b.x0 + 8, x1: b.x1 - 8, z0: b.z0 + 10, z1: b.z1 - 14 }, 0.5);
    wg.add(this.mist);

    /* plinth + plate */
    const bx = b.x1 - b.x0 + 5, bz = b.z1 - b.z0 + 5, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(bx, 3.2, bz), new THREE.MeshLambertMaterial({ color: 0x2a2620, flatShading: true }));
    base.position.set(cx, -6.6, cz);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(bx + 2.4, 0.7, bz + 2.4), new THREE.MeshLambertMaterial({ color: 0x1b1814, flatShading: true }));
    lip.position.set(cx, -8.55, cz);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: 0x0f0d0b }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -9;
    wg.add(base, lip, table);
    const plate = this.makePlate(layout.villages.map((v) => v.name.toUpperCase()).join("  ·  "));
    if (plate) { plate.position.set(cx, -6.2, b.z1 + 2.55); wg.add(plate); }

    /* village labels */
    for (const v of layout.villages) {
      const el = this.mkEl("t3-label");
      el.textContent = v.name;
      this.labels.push({ el, pos: new THREE.Vector3(v.ox, 13, v.oz - 4) });
    }

    this.syncParticleScale();
    this.applyHome();
    this.rig.intro();
    this.applyDaylight(this.day, true);
    /* re-place colonists into the new world */
    for (const w of this.walkers.values()) { this.placeWalker(w, w.info.loc, true); }
  }

  /** Default camera: the whole row on wide screens; on portrait screens only the main valley (pan to see the rest). */
  private applyHome(): void {
    const l = this.layout;
    if (!l) return;
    const main = l.villages.find((v) => v.isDefault) ?? l.villages[0];
    if (this.portrait && main && l.villages.length > 1) {
      const b = { x0: main.ox - 46, x1: main.ox + 46, z0: l.bounds.z0, z1: l.bounds.z1 };
      this.rig.setHome({ x: main.ox, z: l.center.z }, l.radius, this.camera.aspect, b, l.bounds);
    } else this.rig.setHome(l.center, l.radius, this.camera.aspect, l.bounds);
  }

  private makePlate(text: string): THREE.Mesh | null {
    const cv = document.createElement("canvas");
    cv.width = 1024; cv.height = 128;
    const g = cv.getContext("2d");
    if (!g) { console.warn("[3d] plate: no 2D canvas context"); return null; }
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "#b8903f"); grad.addColorStop(1, "#7a5a22");
    g.fillStyle = grad; g.fillRect(0, 0, 1024, 128);
    g.strokeStyle = "rgba(30,20,8,0.7)"; g.lineWidth = 4; g.strokeRect(8, 8, 1008, 112);
    g.fillStyle = "#2a1c08"; g.textAlign = "center"; g.textBaseline = "middle";
    let size = 64;
    g.font = `${size}px 'Pirata One', Georgia, serif`;
    while (g.measureText(text).width > 960 && size > 20) { size -= 4; g.font = `${size}px 'Pirata One', Georgia, serif`; }
    g.fillText(text, 512, 66);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const w = Math.min(60, 24 * Math.max(1, text.length / 14));
    return new THREE.Mesh(new THREE.PlaneGeometry(w, w / 8), new THREE.MeshBasicMaterial({ map: tex }));
  }

  private teardownWorld(): void {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    for (const b of this.bursts) { this.worldGroup?.remove(b.group); disposeObject(b.group); }
    this.bursts = [];
    if (this.lamps) {
      this.lamps.pointLights.forEach((l) => this.scene.remove(l));
      this.scene.remove(this.lamps.eventLight);
      this.lamps = null;
    }
    if (this.worldGroup) { this.scene.remove(this.worldGroup); disposeObject(this.worldGroup); this.worldGroup = null; }
    this.buildings.clear(); this.buildingHits = []; this.particles = []; this.wheels = []; this.flags = []; this.flames = []; this.goats = [];
    this.marks.clear(); this.glow.clear(); this.glowing.clear(); this.mist = null;
    this.hoverLoc = null;
  }

  /* ───────────── colonists ───────────── */

  setColonists(list: ColonistInfo[]): void {
    const seen = new Set<string>();
    for (const info of list) {
      seen.add(info.id);
      let w = this.walkers.get(info.id);
      if (!w) {
        const fig = makeFigure(info.id, info.craft);
        fig.group.userData.figure = info.id;
        this.scene.add(fig.group);
        w = { fig, info, pos: { x: 0, z: 0 }, yaw: 0, route: [], speed: 5.5, phase: Math.random() * 6.28, loc: "" };
        this.walkers.set(info.id, w);
        w.info = info;
        this.placeWalker(w, info.loc, true);
      }
      const prev = w.info;
      w.info = info;
      if (prev.craft !== info.craft || w.fig.craft !== info.craft) w.fig.setCraft(info.craft);
      w.fig.setBadge(info.badge);
      w.fig.setVitals(info.vitals);
      if (w.loc !== info.loc && this.layout) {
        if (info.vitals === "dead") this.placeWalker(w, info.loc, true);
        else this.walkTo(w, info.loc);
      }
    }
    for (const [id, w] of this.walkers) {
      if (seen.has(id)) continue;
      this.scene.remove(w.fig.group);
      w.fig.dispose();
      this.walkers.delete(id);
      if (this.selected === id) this.cb.onSelect(null);
    }
  }

  private fallbackPos(): V2 {
    const v = this.layout?.villages[0];
    return v ? { x: v.hub.x, z: v.hub.z } : { x: 0, z: 0 };
  }

  private placeWalker(w: Walker, loc: string, snap: boolean): void {
    if (!this.layout) return;
    const p = standPosition(this.layout, loc, w.info.id) ?? this.fallbackPos();
    w.loc = loc;
    if (snap) { w.pos = { ...p }; w.route = []; }
  }

  private walkTo(w: Walker, loc: string): void {
    if (!this.layout) return;
    const to = standPosition(this.layout, loc, w.info.id);
    if (!to) { console.warn("[3d] no stand position for location", loc); w.loc = loc; return; }
    const route = routeBetween(this.layout, w.loc, loc, to, w.info.id);
    let len = 0, last = w.pos;
    for (const p of route) { len += Math.hypot(p.x - last.x, p.z - last.z); last = p; }
    w.route = route.length ? route : [to];
    w.speed = Math.max(5.5, len / 16);
    w.loc = loc;
    if (this.reduced) { w.pos = { ...to }; w.route = []; }
  }

  setSelected(id: string | null): void {
    this.selected = id && this.walkers.has(id) ? id : null;
    this.rig.autoAllowed = !this.selected && !this.touring;
    if (this.selected) {
      if (this.touring) this.setTour(false);
      this.setFollowEnabled(true);
      const w = this.walkers.get(this.selected)!;
      this.rig.flyTo(new THREE.Vector3(w.pos.x, this.H(w.pos.x, w.pos.z) + 0.9, w.pos.z), { dist: Math.min(this.rig.dist(), 32), pol: 1.0, dur: 1.3 });
    } else this.setFollowEnabled(false);
  }

  /** Follow toggle (also called by the on-screen button). */
  setFollowEnabled(on: boolean): void {
    const id = this.selected;
    if (on && id) {
      this.followId = id;
      this.rig.setFollow(() => this.figPos(id));
      this.cb.onFollow(true);
    } else {
      if (this.rig.isFollowing()) this.rig.stopFollow();
      this.followId = null;
      this.cb.onFollow(false);
    }
  }
  isFollowing(): boolean { return this.followId !== null; }

  private figPos(id: string): THREE.Vector3 | null {
    const w = this.walkers.get(id);
    return w ? w.fig.group.position : null;
  }

  /* ───────────── speech / events / hotspots ───────────── */

  say(id: string, text: string): void {
    const w = this.walkers.get(id);
    if (!w) return;
    const t = text.length > 110 ? `${text.slice(0, 107)}…` : text;
    for (const b of this.bubbles.filter((x) => x.id === id)) { b.el.remove(); }
    this.bubbles = this.bubbles.filter((x) => x.id !== id);
    const el = this.mkEl("t3-bubble");
    el.textContent = t;
    this.bubbles.push({ el, id, until: this.clock + 4.5 + t.length * 0.05 });
    if (this.bubbles.length > 8) this.bubbles.shift()?.el.remove();
    this.pushHot({ kind: "speech", caption: `${w.info.name}: „${t}“`, agent: id });
  }

  trade(buyer: string, seller: string, text: string): void {
    const a = this.walkers.has(buyer) ? buyer : this.walkers.has(seller) ? seller : null;
    if (a) this.pushHot({ kind: "trade", caption: text, agent: a });
  }

  private resolveVillage(ref: string): VillageSlot | undefined {
    const l = this.layout;
    if (!l) return undefined;
    const q = ref.toLowerCase();
    return l.villages.find((v) => v.id === ref) ?? l.villages.find((v) => v.name.toLowerCase() === q);
  }

  raid(attacker: string, target: string, success: boolean, text?: string): void {
    const t = this.resolveVillage(target);
    const a = this.resolveVillage(attacker);
    if (!t || !this.worldGroup) { console.warn("[3d] raid: unknown target village", target); return; }
    const burst = new FireBurst(t.hub.x + 1, this.H(t.hub.x, t.hub.z), t.hub.z, success ? 12 : 6, this.bursts.length + 1);
    this.worldGroup.add(burst.group);
    burst.setScale(this.viewportScale());
    this.bursts.push(burst);
    this.pushHot({ kind: "raid", caption: text ?? `${a?.name ?? attacker} überfällt ${t.name}`, village: t.id });
  }

  private pushHot(h: Omit<Hotspot, "id" | "at">): void {
    this.hot.push({ ...h, id: this.hotId++, at: performance.now() });
    if (this.hot.length > 40) this.hot.shift();
  }

  /* ───────────── war ───────────── */

  setWar(rels: WarRel[]): void {
    if (!this.layout) return;
    const atWar = new Set<string>();
    const glowing = new Set<string>();
    for (const r of rels) {
      if (r.stance !== "krieg") continue;
      const a = this.resolveVillage(r.a), b = this.resolveVillage(r.b);
      if (a) atWar.add(a.id);
      if (b) atWar.add(b.id);
      if (a && b) for (const road of this.layout.roads) if ((road.a === a.id && road.b === b.id) || (road.a === b.id && road.b === a.id)) glowing.add(road.id);
    }
    for (const [id, m] of this.marks) m.setActive(atWar.has(id));
    this.glowing = glowing;
    for (const [id, g] of this.glow) g.visible = glowing.has(id);
  }

  /* ───────────── time ───────────── */

  setHour(h: number): void { this.hourTarget = h; }
  /** Override the sim hour (0..24); null = follow the sim clock. */
  setOverride(h: number | null): void { this.override = h; }
  getHourShown(): number { return this.override ?? this.hourTarget; }

  private applyDaylight(v: number, force = false): void {
    if (!force && Math.abs(v - this.dayApplied) < 0.002) return;
    this.dayApplied = v;
    this.day = v;
    const s = mixStops(v);
    const u = (this.sky.dome.material as THREE.ShaderMaterial).uniforms;
    (u.uTop!.value as THREE.Color).copy(s.top);
    (u.uHor!.value as THREE.Color).copy(s.hor);
    this.fog.color.copy(s.fog);
    this.fog.density = s.fogD * 0.45;
    this.hemi.color.copy(s.hemiS); this.hemi.groundColor.copy(s.hemiG); this.hemi.intensity = s.hemi * Math.PI * 1.1;
    this.dir.color.copy(s.dir); this.dir.intensity = s.dirI * Math.PI * 1.1;
    const ang = lerp(2.5, 0.95, smooth(0, 1, v));
    const ld = new THREE.Vector3(Math.cos(ang) * 0.9, Math.sin(ang), 0.35).normalize();
    this.dir.position.copy(ld).multiplyScalar(100);
    (this.sky.stars.material as THREE.PointsMaterial).opacity = 0.85 * (1 - smooth(0.15, 0.5, v));
    this.sky.moon.position.set(-300, 330 + 120 * Math.sin(ang), -380);
    (this.sky.moon.material as THREE.SpriteMaterial).opacity = 1 - smooth(0.2, 0.6, v);
    if (this.lamps) this.lamps.lampMul = 1 - smooth(0.35, 0.95, v) * 0.88;
    for (const b of this.buildings.values()) for (const w of b.wins) w.color.copy(w.userData.base as THREE.Color).multiplyScalar(lerp(1, 0.3, smooth(0.5, 1, v)));
    if (this.mist) for (const m of this.mist.children) (m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = (m.userData.base as number) * lerp(1, 0.55, smooth(0.3, 1, v));
  }

  /* ───────────── camera commands ───────────── */

  zoom(sign: number): void { this.rig.zoom(sign); }
  resetView(): void {
    if (this.touring) this.setTour(false);
    this.setFollowEnabled(false);
    this.rig.reset();
  }

  setTour(on: boolean): void {
    if (on === this.touring) return;
    this.touring = on;
    this.rig.autoAllowed = !on && !this.selected;
    if (on) {
      this.setFollowEnabled(false);
      this.tourTimer = 99;
      this.tourDur = this.reduced ? 12 : TOUR_DUR;
    } else {
      this.rig.stopFollow();
      this.cb.onCaption(null);
    }
    this.cb.onTour(on);
  }
  isTouring(): boolean { return this.touring; }

  private tourShot(): void {
    const now = performance.now();
    const fresh = this.hot.filter((h) => now - h.at < 30000 && !this.recent.includes(h.id));
    const rank = (h: Hotspot) => (h.kind === "raid" ? 3 : h.kind === "trade" ? 2 : 1);
    fresh.sort((a, b) => rank(b) - rank(a) || b.at - a.at);
    let h: Hotspot | undefined = fresh[0];
    let caption: string | null = null;
    const go = () => {
      this.tourTimer = 0;
      if (h) {
        this.recent.push(h.id);
        if (this.recent.length > 8) this.recent.shift();
        caption = h.caption;
        if (h.agent && this.walkers.has(h.agent)) {
          const id = h.agent;
          this.rig.setFollow(() => this.figPos(id));
          const w = this.walkers.get(id)!;
          this.rig.flyTo(new THREE.Vector3(w.pos.x, this.H(w.pos.x, w.pos.z) + 0.9, w.pos.z), { az: Math.random() * 6.28, pol: 0.95, dist: 24, dur: 1.2 });
          this.rig.setFollow(() => this.figPos(id));
        } else if (h.village) {
          const v = this.layout?.villages.find((x) => x.id === h!.village);
          if (v) {
            this.rig.stopFollow();
            this.rig.flyTo(new THREE.Vector3(v.hub.x, this.H(v.hub.x, v.hub.z) + 2, v.hub.z), { az: Math.random() * 6.28, pol: 0.85, dist: 46, dur: 1.6 });
          }
        }
      } else {
        const ids = [...this.walkers.values()].filter((w) => w.info.vitals !== "dead").map((w) => w.info.id);
        const id = ids[Math.floor(Math.random() * ids.length)];
        if (id) {
          const w = this.walkers.get(id)!;
          caption = `${w.info.name}`;
          this.rig.flyTo(new THREE.Vector3(w.pos.x, this.H(w.pos.x, w.pos.z) + 0.9, w.pos.z), { az: Math.random() * 6.28, pol: 1.0, dist: 28, dur: 1.4 });
          this.rig.setFollow(() => this.figPos(id));
        }
      }
      this.cb.onCaption(caption);
    };
    if (this.reduced) go();
    else { this.cb.onCut(); setTimeout(() => { if (this.touring && !this.disposed) go(); }, 170); this.tourTimer = 0; }
  }

  /* ───────────── picking / hover ───────────── */

  private pick(px: number, py: number): { fig: string | null; loc: string | null } {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return { fig: null, loc: null };
    this.ndc.set((px / w) * 2 - 1, -(py / h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const figHits = [...this.walkers.values()].map((x) => x.fig.hit);
    const fh = this.raycaster.intersectObjects(figHits, false)[0];
    const bh = this.raycaster.intersectObjects(this.buildingHits, false)[0];
    if (fh && (!bh || fh.distance < bh.distance + 3)) return { fig: fh.object.userData.figure as string, loc: null };
    if (bh) return { fig: null, loc: (bh.object.userData.loc as string | undefined) ?? null };
    return { fig: null, loc: null };
  }

  private setHover(fig: string | null, loc: string | null): void {
    if (fig !== this.hoverFig) {
      if (this.hoverFig) this.walkers.get(this.hoverFig)?.fig.setEmissive(0);
      this.hoverFig = fig;
      if (fig) this.walkers.get(fig)?.fig.setEmissive(0x3c2608);
    }
    if (loc !== this.hoverLoc) {
      if (this.hoverLoc) for (const m of this.buildings.get(this.hoverLoc)?.mats ?? []) m.emissive.setHex(0);
      this.hoverLoc = loc;
      if (loc) for (const m of this.buildings.get(loc)?.mats ?? []) m.emissive.setHex(0x3c2608);
    }
    this.canvas.style.cursor = fig || loc ? "pointer" : "";
  }

  /* ───────────── frame loop ───────────── */

  private viewportScale(): number {
    return this.canvas.clientHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }
  private syncParticleScale(): void {
    const s = this.viewportScale();
    for (const p of this.particles) (p.material as THREE.ShaderMaterial).uniforms.uScale!.value = s;
    for (const b of this.bursts) b.setScale(s);
  }

  private resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.syncParticleScale();
    const portrait = w < h * 0.9;
    const flipped = portrait !== this.portrait;
    this.portrait = portrait;
    this.applyHome();
    if (flipped && this.layout) this.rig.reset();
  }

  private frame = (ms: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) { this.lastT = 0; return; }
    const t = ms / 1000;
    const dt = this.lastT ? Math.min(0.1, t - this.lastT) : 0.016;
    this.lastT = t;
    this.clock += dt;
    try {
      this.update(dt, this.clock);
      this.renderer.render(this.scene, this.camera);
    } catch (err) {
      console.error("[3d] frame failed", err);
      this.disposed = true;
      cancelAnimationFrame(this.raf);
    }
  };

  private update(dt: number, t: number): void {
    const rm = this.reduced;
    /* daylight follows the clock (smoothed) */
    const target = hourToDaylight(this.override ?? this.hourTarget);
    this.applyDaylight(rm || Math.abs(target - this.day) < 0.002 ? target : lerp(this.day, target, 1 - Math.exp(-dt * 1.6)));

    /* figures */
    const hot = this.walkers;
    for (const w of hot.values()) {
      let state: "stand" | "walk" | "work" = w.info.working ? "work" : "stand";
      if (w.route.length) {
        state = "walk";
        let step = w.speed * dt;
        while (step > 0 && w.route.length) {
          const n = w.route[0]!;
          const dx = n.x - w.pos.x, dz = n.z - w.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.001) { w.route.shift(); continue; }
          const m = Math.min(step, d);
          w.pos.x += (dx / d) * m; w.pos.z += (dz / d) * m;
          const want = Math.atan2(dx, dz);
          w.yaw += Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw)) * Math.min(1, dt * 10);
          step -= m;
          if (m >= d) w.route.shift();
        }
      }
      const gy = this.H(w.pos.x, w.pos.z);
      w.fig.group.position.set(w.pos.x, gy, w.pos.z);
      w.fig.group.rotation.y = w.yaw;
      w.fig.anim(state, t, w.phase);
    }

    /* world animation */
    if (this.lamps) {
      this.lamps.update(t, rm, this.rig.focus);
      let lv = 0; let lp: THREE.Vector3 | null = null;
      for (const b of this.bursts) if (b.level > lv) { lv = b.level; lp = b.pos; }
      this.lamps.eventLight.intensity = lv * 70;
      if (lp) this.lamps.eventLight.position.copy(lp);
    }
    const ps = rm ? 3 : t;
    for (const p of this.particles) (p.material as THREE.ShaderMaterial).uniforms.uTime!.value = ps + (p.userData.phase as number);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      if (!b.update(dt, t)) { this.worldGroup?.remove(b.group); disposeObject(b.group); this.bursts.splice(i, 1); }
    }
    for (const m of this.marks.values()) m.update(t, rm);
    for (const id of this.glowing) {
      const g = this.glow.get(id);
      if (g) (g.material as THREE.MeshBasicMaterial).opacity = rm ? 0.55 : 0.45 + Math.sin(t * 1.7) * 0.15;
    }
    if (!rm) {
      for (const w of this.wheels) w.rotation.x = t * 0.5;
      for (const f of this.flags) f.rotation.y = Math.sin(t * 1.7 + f.position.x) * 0.25;
      for (const fl of this.flames) fl.scale.set(1, 0.9 + Math.sin(t * 11 + fl.position.x * 5) * 0.1 + Math.sin(t * 17 + fl.position.z * 3) * 0.08, 1);
      for (const gt of this.goats) {
        const u = gt.userData as { cx: number; cz: number; sp: number; ph: number };
        gt.position.x = u.cx + Math.sin(t * u.sp + u.ph) * 1.1;
        gt.position.z = u.cz + Math.cos(t * u.sp * 0.8 + u.ph) * 0.7;
        gt.rotation.y = Math.atan2(-Math.cos(t * u.sp * 0.8 + u.ph) * 0.8 * u.sp * 0.7, Math.cos(t * u.sp + u.ph) * u.sp * 1.1);
        gt.position.y = 0.1 + Math.abs(Math.sin(t * 5 + u.ph)) * 0.02;
      }
      if (this.mist) for (const m of this.mist.children) {
        const a = m.userData.area as { x0: number; x1: number };
        m.position.x += (m.userData.vx as number) * dt;
        if (m.position.x > a.x1 + 20) m.position.x = a.x0 - 20;
        if (m.position.x < a.x0 - 20) m.position.x = a.x1 + 20;
      }
    }

    /* tour */
    if (this.touring) {
      this.tourTimer += dt;
      if (this.tourTimer > this.tourDur) this.tourShot();
    }

    /* camera + sky follow */
    this.rig.update(dt);
    this.sky.group.position.copy(this.camera.position);

    /* hover under the cursor */
    if (this.ptr.dirty && !this.ptr.down) {
      this.ptr.dirty = false;
      const h = this.pick(this.ptr.x, this.ptr.y);
      this.setHover(h.fig, h.fig ? null : h.loc);
    }

    /* rings, tags, bubbles, labels */
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const ring = (m: THREE.Mesh, id: string | null) => {
      const wk = id ? this.walkers.get(id) : null;
      if (!wk) { m.visible = false; return; }
      m.visible = true;
      m.position.set(wk.pos.x, this.H(wk.pos.x, wk.pos.z) + 0.12, wk.pos.z);
      m.scale.setScalar(1 + (rm ? 0 : Math.sin(t * 4) * 0.05));
    };
    ring(this.rings.sel, this.selected);
    ring(this.rings.hov, this.hoverFig && this.hoverFig !== this.selected ? this.hoverFig : null);
    const tag = (el: HTMLElement, id: string | null) => {
      const wk = id ? this.walkers.get(id) : null;
      if (!wk) { el.style.display = "none"; return; }
      if (el.textContent !== wk.info.name) el.textContent = wk.info.name;
      this.project(this.tmpV2(wk.fig.group.position, wk.fig.lying ? 1.1 : 2.3), el, w, h);
    };
    tag(this.tagSel, this.selected);
    tag(this.tagHov, this.hoverFig && this.hoverFig !== this.selected ? this.hoverFig : null);
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]!;
      const wk = this.walkers.get(b.id);
      if (!wk || this.clock > b.until) { b.el.remove(); this.bubbles.splice(i, 1); continue; }
      this.project(this.tmpV2(wk.fig.group.position, wk.fig.lying ? 1.5 : 2.7), b.el, w, h);
    }
    for (const l of this.labels) this.project(l.pos, l.el, w, h);
  }

  private tmpP = new THREE.Vector3();
  private tmpV2(p: THREE.Vector3, up: number): THREE.Vector3 { return this.tmpP.set(p.x, p.y + up, p.z); }

  /* ───────────── teardown ───────────── */

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.rig.dispose();
    for (const b of this.bubbles) b.el.remove();
    this.tagSel.remove(); this.tagHov.remove();
    for (const w of this.walkers.values()) { this.scene.remove(w.fig.group); w.fig.dispose(); }
    this.walkers.clear();
    this.teardownWorld();
    for (const r of Object.values(this.rings)) { this.scene.remove(r); disposeObject(r); }
    this.scene.remove(this.sky.group);
    disposeObject(this.sky.group);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
