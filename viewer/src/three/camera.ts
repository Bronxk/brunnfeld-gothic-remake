// Camera rig: diorama orbit (drag), pan (right-drag / shift-drag / WASD), zoom (wheel / pinch / buttons),
// smooth fly-to, follow mode. Iframe-safe: no pointer lock, no fullscreen.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { clamp, lerp } from "./util";
import type { HeightFn } from "./terrain";

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface FlyOpts { az?: number; pol?: number; dist?: number; dur?: number; instant?: boolean }
interface Anim { t: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3; from: { az: number; pol: number; dist: number }; to: { az: number; pol: number; dist: number } }

export class CameraRig {
  readonly controls: OrbitControls;
  private sph = new THREE.Spherical();
  private off = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private flat = new THREE.Vector3();
  private delta = new THREE.Vector3();
  private anim: Anim | null = null;
  private followFn: (() => THREE.Vector3 | null) | null = null;
  private idle = 0;
  private keys = new Set<string>();
  private home = { target: new THREE.Vector3(0, -2, -6), az: 0.62, pol: 0.92, dist: 150 };
  private bounds = { x0: -34, x1: 34, z0: -24, z1: 12 };
  private minDist = 12;
  private maxDist = 300;
  /** Idle auto-rotation allowed (set false while selected / touring). */
  autoAllowed = true;
  onUserInput: (kind: "pan" | "orbit" | "zoom" | "key") => void = () => {};
  readonly focus = new THREE.Vector3();
  private disposers: (() => void)[] = [];

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, private reduced: boolean, private H: () => HeightFn) {
    const c = new OrbitControls(camera, dom);
    this.controls = c;
    c.enableDamping = true; c.dampingFactor = 0.09; c.rotateSpeed = 0.7; c.zoomSpeed = 0.9; c.panSpeed = 0.9;
    c.screenSpacePanning = false; c.maxPolarAngle = 1.45; c.minPolarAngle = 0.12;
    c.autoRotateSpeed = 0.45;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K | string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn, opts);
      this.disposers.push(() => el.removeEventListener(ev, fn, opts));
    };
    on(dom, "pointerdown", (e) => {
      this.anim = null; this.idle = 0;
      const pe = e as PointerEvent;
      this.onUserInput(pe.button === 2 || pe.shiftKey ? "pan" : "orbit");
    });
    on(dom, "wheel", () => { this.anim = null; this.idle = 0; this.onUserInput("zoom"); }, { passive: true });
    on(dom, "contextmenu", (e) => e.preventDefault());
    on(window, "keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (/INPUT|TEXTAREA|SELECT/.test((ke.target as HTMLElement | null)?.tagName ?? "")) return;
      if (ke.ctrlKey || ke.metaKey || ke.altKey) return;
      const k = ke.key.toLowerCase();
      if ("wasdqe".includes(k) && k.length === 1) this.keys.add(k);
    });
    on(window, "keyup", (e) => { this.keys.delete((e as KeyboardEvent).key.toLowerCase()); });
    on(window, "blur", () => this.keys.clear());
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.controls.dispose();
  }

  /** Configure the default view for a layout (scene centre + radius). */
  setHome(center: { x: number; z: number }, _radius: number, aspect: number, fit: { x0: number; x1: number; z0: number; z1: number }, bounds: { x0: number; x1: number; z0: number; z1: number } = fit): void {
    /* fit ~80 % of the width into view (the camera looks obliquely, the outer edges may be cropped a bit) */
    const tanH = Math.tan((this.camera.fov * Math.PI) / 360);
    const distW = ((fit.x1 - fit.x0) * 0.4) / (tanH * Math.max(0.3, aspect));
    const dist = Math.max(150, distW);
    this.home = { target: new THREE.Vector3(center.x, -2, center.z - 2), az: 0.62, pol: 0.92, dist };
    this.bounds = { x0: bounds.x0 + 12, x1: bounds.x1 - 12, z0: bounds.z0 + 12, z1: bounds.z1 - 12 };
    this.minDist = 12;
    this.maxDist = Math.max(280, dist * 1.9);
    this.controls.minDistance = this.minDist;
    this.controls.maxDistance = this.maxDist;
  }

  private place(target: THREE.Vector3, az: number, pol: number, dist: number): void {
    this.controls.target.copy(target);
    this.sph.set(dist, pol, az);
    this.off.setFromSpherical(this.sph);
    this.camera.position.copy(target).add(this.off);
  }
  current(): { az: number; pol: number; dist: number } {
    this.off.copy(this.camera.position).sub(this.controls.target);
    this.sph.setFromVector3(this.off);
    return { az: this.sph.theta, pol: this.sph.phi, dist: this.sph.radius };
  }

  /** Initial placement (call once after setHome): slow fly-in unless reduced motion. */
  intro(): void {
    const h = this.home;
    if (this.reduced) this.place(h.target, h.az, h.pol, h.dist);
    else { this.place(h.target, h.az - 0.9, 0.55, h.dist * 1.55); this.flyTo(h.target, { az: h.az, pol: h.pol, dist: h.dist, dur: 3.2 }); }
  }

  flyTo(target: THREE.Vector3, o: FlyOpts = {}): void {
    const c = this.current();
    const to = {
      az: o.az != null ? c.az + Math.atan2(Math.sin(o.az - c.az), Math.cos(o.az - c.az)) : c.az,
      pol: o.pol ?? c.pol,
      dist: clamp(o.dist ?? c.dist, this.minDist, this.maxDist),
    };
    if (this.reduced || o.instant) { this.place(target, to.az, to.pol, to.dist); this.anim = null; return; }
    this.anim = { t: 0, dur: o.dur ?? 1.4, fromT: this.controls.target.clone(), toT: target.clone(), from: c, to };
  }

  reset(): void { this.followFn = null; this.flyTo(this.home.target.clone(), { az: this.home.az, pol: this.home.pol, dist: this.home.dist }); }
  zoom(sign: number): void {
    const c = this.current();
    this.flyTo(this.controls.target.clone(), { dist: clamp(c.dist * (sign > 0 ? 0.68 : 1.45), this.minDist, this.maxDist), dur: 0.45 });
  }
  setFollow(fn: (() => THREE.Vector3 | null) | null): void {
    this.followFn = fn;
    if (fn) {
      this.anim = null;
      const c = this.current();
      if (c.dist > 46) this.flyTo(this.controls.target.clone(), { dist: 30, dur: 1.2 });
    }
  }
  isFollowing(): boolean { return this.followFn !== null; }
  /** User moved the camera target (pan / keys): a follow stops. */
  stopFollow(): boolean { const was = this.followFn !== null; this.followFn = null; return was; }
  dist(): number { return this.current().dist; }
  getHome() { return this.home; }
  /** True while the user is dragging / animating (suppresses idle rotation). */
  poke(): void { this.idle = 0; }

  update(dt: number): void {
    const { camera, controls, tmp, flat, delta } = this;
    /* WASD: move on the ground, Q/E: rotate */
    let mx = 0, mz = 0, rot = 0;
    if (this.keys.has("w")) mz -= 1; if (this.keys.has("s")) mz += 1;
    if (this.keys.has("a")) mx -= 1; if (this.keys.has("d")) mx += 1;
    if (this.keys.has("q")) rot -= 1; if (this.keys.has("e")) rot += 1;
    if (mx || mz) {
      this.anim = null; this.idle = 0;
      if (this.stopFollow()) this.onUserInput("key");
      flat.set(controls.target.x - camera.position.x, 0, controls.target.z - camera.position.z).normalize();
      delta.set(0, 0, 0).addScaledVector(flat, -mz).addScaledVector(tmp.set(-flat.z, 0, flat.x), mx).multiplyScalar(dt * this.current().dist * 0.55);
      controls.target.add(delta);
      camera.position.add(delta);
    }
    if (rot) {
      this.anim = null; this.idle = 0;
      const c = this.current();
      this.place(controls.target.clone(), c.az + rot * dt * 1.1, c.pol, c.dist);
    }
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = ease(clamp(a.t / a.dur, 0, 1));
      this.place(tmp.lerpVectors(a.fromT, a.toT, k).clone(), lerp(a.from.az, a.to.az, k), lerp(a.from.pol, a.to.pol, k), lerp(a.from.dist, a.to.dist, k));
      if (a.t >= a.dur) this.anim = null;
    }
    if (this.followFn && !this.anim) {
      const p = this.followFn();
      if (p) {
        tmp.set(p.x, p.y + 0.9, p.z);
        delta.copy(tmp).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 3.4));
        controls.target.add(delta);
        camera.position.add(delta);
      }
    }
    this.idle += dt;
    controls.autoRotate = !this.reduced && this.autoAllowed && this.idle > 4 && !this.followFn;
    /* keep the target inside the scene */
    const b = this.bounds;
    const nx = clamp(controls.target.x, b.x0, b.x1), nz = clamp(controls.target.z, b.z0, b.z1);
    if (nx !== controls.target.x || nz !== controls.target.z) {
      camera.position.x += nx - controls.target.x;
      camera.position.z += nz - controls.target.z;
      controls.target.x = nx;
      controls.target.z = nz;
    }
    controls.update(dt);
    /* ground clearance: lift the camera over cliffs */
    const gy = this.H()(camera.position.x, camera.position.z) + 2.2;
    if (camera.position.y < gy) {
      camera.position.y = lerp(camera.position.y, gy, Math.min(1, dt * 14));
      camera.lookAt(controls.target);
    }
    this.focus.copy(controls.target);
  }
}
