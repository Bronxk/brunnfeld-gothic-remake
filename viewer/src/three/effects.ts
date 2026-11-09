// Particles (smoke, sparks, fire), light pools and halos, sky dome, mist, lamp flicker system, war banners.

import * as THREE from "three";
import { rng, radialTexture, lerp, clamp } from "./util";
import type { HeightFn } from "./terrain";

const VS = `
  uniform float uTime, uSize, uRise, uSpread, uLife, uScale; uniform vec2 uDrift;
  attribute float aSeed; attribute vec3 aRand;
  varying float vAge;
  void main(){
    float age = fract(uTime / uLife + aSeed);
    vec3 p = vec3((aRand.x - .5) * uSpread * age + uDrift.x * age * uRise, age * uRise, (aRand.y - .5) * uSpread * age + uDrift.y * age * uRise);
    p.x += sin(uTime * .7 + aSeed * 20.) * .2 * age * uSpread;
    vAge = age;
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    gl_PointSize = uSize * (.45 + age * 1.9) * (.7 + aRand.z * .6) * uScale / max(.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FS = `
  uniform vec3 uColor; uniform float uOpacity, uFade;
  varying float vAge;
  void main(){
    float d = length(gl_PointCoord - .5);
    if (d > .5) discard;
    float a = smoothstep(.5, .05, d);
    a *= uOpacity * smoothstep(0., .12, vAge) * pow(1. - vAge, uFade);
    gl_FragColor = vec4(uColor, a);
  }`;

export interface ParticleOpts {
  count: number; size: number; rise: number; spread: number; life: number; color: number; opacity: number;
  additive?: boolean; drift?: [number, number]; fade?: number; x: number; y: number; z: number; seed?: number;
}

export function makeParticles(o: ParticleOpts): THREE.Points {
  const rnd = rng(o.seed ?? 7);
  const n = o.count;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  const seed = new Float32Array(n), r = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { seed[i] = i / n + rnd() * 0.02; r[i * 3] = rnd(); r[i * 3 + 1] = rnd(); r[i * 3 + 2] = rnd(); }
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  g.setAttribute("aRand", new THREE.BufferAttribute(r, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSize: { value: o.size }, uRise: { value: o.rise }, uSpread: { value: o.spread }, uLife: { value: o.life },
      uScale: { value: 600 }, uDrift: { value: new THREE.Vector2(o.drift ? o.drift[0] : 0.25, o.drift ? o.drift[1] : 0.1) },
      uColor: { value: new THREE.Color(o.color) }, uOpacity: { value: o.opacity }, uFade: { value: o.fade ?? 1 },
    },
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.position.set(o.x, o.y, o.z);
  pts.frustumCulled = false;
  pts.userData.baseOpacity = o.opacity;
  pts.userData.phase = rnd() * 100;
  return pts;
}

let poolTex: THREE.CanvasTexture | null = null;
let haloTex: THREE.CanvasTexture | null = null;

export function makeLightPool(x: number, y: number, z: number, radius: number, color: number): THREE.Mesh {
  poolTex = poolTex ?? radialTexture([[0, "rgba(255,255,255,0.95)"], [0.35, "rgba(255,255,255,0.4)"], [1, "rgba(255,255,255,0)"]], 128);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: poolTex, color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.renderOrder = 2;
  return m;
}

export function makeHalo(x: number, y: number, z: number, size: number, color: number): THREE.Sprite {
  haloTex = haloTex ?? radialTexture([[0, "rgba(255,255,255,1)"], [0.18, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]], 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.position.set(x, y, z);
  s.scale.set(size, size, 1);
  return s;
}

export interface SkyObj { group: THREE.Group; dome: THREE.Mesh; stars: THREE.Points; moon: THREE.Sprite }

export function makeSky(): SkyObj {
  const g = new THREE.SphereGeometry(900, 24, 14);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color("#07080f") }, uHor: { value: new THREE.Color("#1a1420") } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
    fragmentShader: "uniform vec3 uTop, uHor; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y, 0., 1.); gl_FragColor = vec4(mix(uHor, uTop, pow(h, .55)), 1.); }",
  });
  const dome = new THREE.Mesh(g, mat);
  dome.renderOrder = -10;
  const rnd = rng(99);
  const sp = new Float32Array(420 * 3);
  for (let i = 0; i < 420; i++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(0.12 + rnd() * 0.88);
    sp[i * 3] = Math.sin(ph) * Math.cos(th) * 820; sp[i * 3 + 1] = Math.cos(ph) * 820; sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 820;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false, depthWrite: false }));
  const moonTex = radialTexture([[0, "rgba(235,240,255,1)"], [0.22, "rgba(220,230,255,0.9)"], [0.3, "rgba(170,190,255,0.25)"], [1, "rgba(120,150,255,0)"]], 128);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false }));
  moon.scale.set(90, 90, 1);
  const group = new THREE.Group();
  group.add(dome, stars, moon);
  return { group, dome, stars, moon };
}

export interface Area { x0: number; x1: number; z0: number; z1: number }

export function makeMist(n: number, area: Area, y: number): THREE.Group {
  const tex = radialTexture([[0, "rgba(150,160,185,0.5)"], [0.55, "rgba(120,130,160,0.18)"], [1, "rgba(100,110,140,0)"]], 128);
  const grp = new THREE.Group();
  const rnd = rng(5);
  for (let i = 0; i < n; i++) {
    const w = 22 + rnd() * 22;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * (0.5 + rnd() * 0.3)),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.1 + rnd() * 0.06, depthWrite: false, fog: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rnd() * 3;
    m.position.set(area.x0 + rnd() * (area.x1 - area.x0), y + rnd() * 1.4, area.z0 + rnd() * (area.z1 - area.z0));
    m.userData = { vx: (rnd() - 0.3) * 0.5, base: (m.material as THREE.MeshBasicMaterial).opacity, area };
    m.renderOrder = 3;
    grp.add(m);
  }
  return grp;
}

/* ---------- daylight ---------- */

interface Stop { v: number; top: string; hor: string; fog: string; hemiS: string; hemiG: string; hemi: number; dir: string; dirI: number; fogD: number }
const STOPS: Stop[] = [
  { v: 0.0, top: "#06070e", hor: "#1c1522", fog: "#171320", hemiS: "#4d5c88", hemiG: "#33261a", hemi: 0.8, dir: "#9db0dc", dirI: 0.6, fogD: 0.0105 },
  { v: 0.4, top: "#1d1a38", hor: "#a4553a", fog: "#4a2f35", hemiS: "#6a6a84", hemiG: "#3a2a1e", hemi: 0.95, dir: "#ffb070", dirI: 0.7, fogD: 0.0085 },
  { v: 1.0, top: "#5a82a8", hor: "#cdc1a2", fog: "#a9b2b4", hemiS: "#a8bed4", hemiG: "#4a3d2c", hemi: 1.35, dir: "#fff0d6", dirI: 1.7, fogD: 0.0042 },
];

export interface DaylightTargets {
  top: THREE.Color; hor: THREE.Color; fog: THREE.Color; hemiS: THREE.Color; hemiG: THREE.Color; dir: THREE.Color;
  hemi: number; dirI: number; fogD: number;
}

export function mixStops(v: number): DaylightTargets {
  let a = STOPS[0]!, b = STOPS[1]!;
  if (v > b.v) { a = STOPS[1]!; b = STOPS[2]!; }
  const t = (v - a.v) / (b.v - a.v);
  const col = (k: "top" | "hor" | "fog" | "hemiS" | "hemiG" | "dir") => new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), t);
  return {
    top: col("top"), hor: col("hor"), fog: col("fog"), hemiS: col("hemiS"), hemiG: col("hemiG"), dir: col("dir"),
    hemi: lerp(a.hemi, b.hemi, t), dirI: lerp(a.dirI, b.dirI, t), fogD: lerp(a.fogD, b.fogD, t),
  };
}

/* ---------- lamps (flicker, pools, halos, nearest-N point lights) ---------- */

export interface LampDef {
  p: THREE.Vector3; color: number; power: number; radius: number; light: boolean; bulb?: THREE.Mesh; dist?: number; flicker?: number;
}
interface Lamp extends LampDef { base: number; ph: number; flick: number; pool: THREE.Mesh; halo: THREE.Sprite; cur: number }

export class LampSystem {
  readonly group = new THREE.Group();
  readonly lamps: Lamp[] = [];
  readonly pointLights: THREE.PointLight[] = [];
  lampMul = 1;
  /** Always-present light for transient events (raid fires); intensity 0 when idle, so the light count never changes. */
  readonly eventLight = new THREE.PointLight(0xff5a1c, 0, 44, 2);
  constructor(private H: HeightFn, maxPointLights: number, scene: THREE.Scene) {
    for (let i = 0; i < maxPointLights; i++) {
      const pl = new THREE.PointLight(0xffa040, 0, 20, 2);
      scene.add(pl);
      this.pointLights.push(pl);
    }
    scene.add(this.eventLight);
  }
  add(l: LampDef): void {
    const gy = this.H(l.p.x, l.p.z);
    const lamp: Lamp = { ...l, base: l.power, ph: Math.random() * 50, flick: l.flicker ?? 1, pool: makeLightPool(l.p.x, gy + 0.16, l.p.z, l.radius, l.color), halo: makeHalo(l.p.x, l.p.y, l.p.z, 0.8 + l.power * 1.1, l.color), cur: l.power };
    this.group.add(lamp.pool, lamp.halo);
    this.lamps.push(lamp);
  }
  update(t: number, reduced: boolean, focus: THREE.Vector3 | null): void {
    const key = this.lamps.filter((l) => l.light);
    if (focus) key.sort((a, b) => ((a.p.x - focus.x) ** 2 + (a.p.z - focus.z) ** 2) - ((b.p.x - focus.x) ** 2 + (b.p.z - focus.z) ** 2));
    this.pointLights.forEach((pl, i) => {
      const l = key[i];
      if (!l) { pl.intensity = 0; pl.userData.l = null; return; }
      pl.position.copy(l.p);
      pl.color.setHex(l.color);
      pl.distance = l.dist ?? 26;
      pl.userData.l = l;
    });
    for (const l of this.lamps) {
      const f = reduced ? 1 : 1 + l.flick * (Math.sin(t * (6 + (l.ph % 3)) + l.ph) * 0.05 + Math.sin(t * 13.7 + l.ph * 2) * 0.035 + (Math.sin(t * 2.1 + l.ph) > 0.97 ? -0.08 : 0));
      l.cur = l.base * this.lampMul * f;
      (l.pool.material as THREE.MeshBasicMaterial).opacity = Math.min(0.55, 0.3 * l.cur);
      (l.halo.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.9 * l.cur);
      if (l.bulb) l.bulb.visible = this.lampMul > 0.3;
    }
    for (const pl of this.pointLights) {
      const l = pl.userData.l as Lamp | null;
      pl.intensity = l ? l.cur * 38 : 0;
    }
  }
}

/* ---------- war: banners and torches at a village hub, fire burst after a raid ---------- */

export interface WarMarks {
  group: THREE.Group;
  setActive(on: boolean): void;
  update(t: number, reduced: boolean): void;
}

/** Red-amber banners and torches around a hub; hidden while at peace. */
export function makeWarMarks(cx: number, cz: number, H: HeightFn): WarMarks {
  const group = new THREE.Group();
  group.visible = false;
  const pole = new THREE.MeshLambertMaterial({ color: 0x2a1c12, flatShading: true });
  const cloth = new THREE.MeshLambertMaterial({ color: 0x8a1f14, side: THREE.DoubleSide, flatShading: true });
  const trim = new THREE.MeshLambertMaterial({ color: 0xc9831f, side: THREE.DoubleSide, flatShading: true });
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a24 });
  const flags: THREE.Group[] = [], flames: THREE.Mesh[] = [], halos: THREE.Sprite[] = [];
  const spots: [number, number][] = [[-3.6, -2.6], [3.6, -2.6], [-3.6, 2.8], [3.6, 2.8]];
  spots.forEach(([dx, dz], i) => {
    const x = cx + dx, z = cz + dz, y = H(x, z);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 5), pole);
    p.position.set(x, y + 2.1, z);
    group.add(p);
    const f = new THREE.Group();
    f.position.set(x + 0.05, y + 3.5, z);
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.8, 4, 1), cloth);
    cl.position.x = 0.6;
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.16), trim);
    tr.position.set(0.6, -0.2, 0.01);
    f.add(cl, tr);
    f.rotation.y = i % 2 ? Math.PI : 0;
    group.add(f);
    flags.push(f);
    /* torch on top of the pole */
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 5), fireMat);
    fl.position.set(x, y + 4.5, z);
    group.add(fl);
    flames.push(fl);
    const h = makeHalo(x, y + 4.55, z, 2.2, 0xff5a1c);
    group.add(h);
    halos.push(h);
  });
  const glow = makeLightPool(cx, H(cx, cz) + 0.2, cz, 7.5, 0xff3a18);
  group.add(glow);
  return {
    group,
    setActive(on) { group.visible = on; },
    update(t, reduced) {
      if (!group.visible) return;
      flags.forEach((f, i) => { f.rotation.y = (i % 2 ? Math.PI : 0) + (reduced ? 0 : Math.sin(t * 2.1 + i * 1.3) * 0.28); });
      flames.forEach((fl, i) => { const s = reduced ? 1 : 0.9 + Math.sin(t * 11 + i * 2) * 0.12 + Math.sin(t * 17 + i) * 0.08; fl.scale.set(1, s, 1); });
      halos.forEach((h, i) => { (h.material as THREE.SpriteMaterial).opacity = reduced ? 0.8 : 0.7 + Math.sin(t * 9 + i * 3) * 0.2; });
      (glow.material as THREE.MeshBasicMaterial).opacity = reduced ? 0.4 : 0.35 + Math.sin(t * 1.3) * 0.08;
    },
  };
}

/** Short fire + smoke burst (raid). Owns its particles and light; `update` returns false when finished. */
export class FireBurst {
  readonly group = new THREE.Group();
  private fire: THREE.Points;
  private smoke: THREE.Points;
  private age = 0;
  /** Current glow strength 0..1 and world position; the scene feeds them into the shared event light. */
  level = 0;
  readonly pos: THREE.Vector3;
  constructor(x: number, y: number, z: number, private duration = 11, private seedBase = 1) {
    this.fire = makeParticles({ count: 40, size: 1.5, rise: 5, spread: 5, life: 1.6, color: 0xff7a24, opacity: 1, additive: true, drift: [0.1, 0.05], fade: 1.3, x, y, z, seed: seedBase });
    this.smoke = makeParticles({ count: 34, size: 3.0, rise: 14, spread: 6, life: 6.5, color: 0x2e2a2e, opacity: 0.7, drift: [0.5, 0.2], fade: 1.1, x, y: y + 0.5, z, seed: seedBase + 3 });
    this.pos = new THREE.Vector3(x, y + 3, z);
    this.group.add(this.fire, this.smoke);
  }
  setScale(s: number): void {
    (this.fire.material as THREE.ShaderMaterial).uniforms.uScale!.value = s;
    (this.smoke.material as THREE.ShaderMaterial).uniforms.uScale!.value = s;
  }
  update(dt: number, t: number): boolean {
    this.age += dt;
    const k = this.age < 1 ? this.age : clamp(1 - (this.age - (this.duration - 4)) / 4, 0, 1);
    (this.fire.material as THREE.ShaderMaterial).uniforms.uTime!.value = t;
    (this.smoke.material as THREE.ShaderMaterial).uniforms.uTime!.value = t * 0.8 + this.seedBase;
    (this.fire.material as THREE.ShaderMaterial).uniforms.uOpacity!.value = k;
    (this.smoke.material as THREE.ShaderMaterial).uniforms.uOpacity!.value = 0.7 * Math.min(1, k * 1.4);
    this.level = k * (1 + Math.sin(t * 17) * 0.18 + Math.sin(t * 7.3) * 0.14);
    return this.age < this.duration;
  }
}
