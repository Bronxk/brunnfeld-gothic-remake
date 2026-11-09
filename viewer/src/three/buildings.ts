// Procedural low-poly buildings (ported from the approved demo). Local frame: origin = ground centre, door = +z.

import * as THREE from "three";
import type { LocSpec } from "./layout";
import type { HeightFn } from "./terrain";
import type { LampDef } from "./effects";
import { rng } from "./util";

export interface BuildingCtx {
  lamp(l: LampDef): void;
  smoke(s: { p: THREE.Vector3; kind: "chimney" | "forge" | "kiln" }): void;
  sparks(s: { p: THREE.Vector3 }): void;
}

export interface BuildingObj {
  group: THREE.Group;
  loc: string;
  /** Materials that take the hover emissive. */
  mats: THREE.MeshLambertMaterial[];
  /** Window-like materials dimmed by daylight. */
  wins: THREE.MeshBasicMaterial[];
  wheels: THREE.Object3D[];
  flags: THREE.Object3D[];
  flames: THREE.Object3D[];
  goats: THREE.Group[];
  hit: THREE.Mesh | null;
}

export function buildBuilding(spec: LocSpec, H: HeightFn, ctx: BuildingCtx): BuildingObj {
  const { name: loc, kind: type, w, d, rot } = spec;
  const g = new THREE.Group();
  g.position.set(spec.base.x, H(spec.base.x, spec.base.z), spec.base.z);
  g.rotation.y = rot;
  g.name = loc;
  g.updateMatrixWorld(true);

  const mats = new Map<number, THREE.MeshLambertMaterial>();
  const litMats: THREE.MeshLambertMaterial[] = [];
  const M = (hex: number): THREE.MeshLambertMaterial => {
    let m = mats.get(hex);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true }); mats.set(hex, m); litMats.push(m); }
    return m;
  };
  const wins: THREE.MeshBasicMaterial[] = [];
  const winMat = (hex = 0xffb04a): THREE.MeshBasicMaterial => {
    const m = new THREE.MeshBasicMaterial({ color: hex });
    m.userData.base = new THREE.Color(hex);
    wins.push(m);
    return m;
  };
  const W = (x: number, y: number, z: number): THREE.Vector3 => g.localToWorld(new THREE.Vector3(x, y, z));
  const out: BuildingObj = { group: g, loc, mats: litMats, wins, wheels: [], flags: [], flames: [], goats: [], hit: null };

  const box = (bw: number, bh: number, bd: number, col: number, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), M(col));
    m.position.set(x, y + bh / 2, z);
    (parent ?? g).add(m);
    return m;
  };
  const cyl = (r0: number, r1: number, h: number, seg: number, col: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), M(col));
    m.position.set(x, y + h / 2, z);
    g.add(m);
    return m;
  };
  const cone = (r: number, h: number, seg: number, col: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), M(col));
    m.position.set(x, y + h / 2, z);
    g.add(m);
    return m;
  };
  function gable(gw: number, gd: number, gh: number, col: number, ov: number, y: number, x = 0, z = 0): THREE.Mesh {
    const hw = gw / 2 + ov, hd = gd / 2 + ov;
    const A = [-hw, 0, hd], B = [hw, 0, hd], C = [hw, 0, -hd], D = [-hw, 0, -hd], R1 = [-hw, gh, 0], R2 = [hw, gh, 0];
    const tris = [A, B, R2, A, R2, R1, C, D, R1, C, R1, R2, D, A, R1, B, C, R2];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, M(col));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }
  function windows(list: number[], y: number, z: number, mat: THREE.Material, sw = 0.42, sh = 0.52): void {
    for (const x of list) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
      m.position.set(x, y, z + 0.02);
      g.add(m);
      box(sw + 0.14, sh + 0.14, 0.04, 0x1a130e, x, y - sh / 2 - 0.07, z - 0.005);
    }
  }
  const door = (x: number, z: number, h = 1.15, dw = 0.7) => box(dw, h, 0.08, 0x1a130e, x, 0, z + 0.02);
  const lantern = (x: number, y: number, z: number, opts: { color?: number; power?: number; radius?: number; light?: boolean; dist?: number; flicker?: number } = {}) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: opts.color ?? 0xffc060 }));
    b.position.set(x, y, z);
    g.add(b);
    box(0.04, 0.22, 0.04, 0x15100c, x, y + 0.08, z);
    ctx.lamp({ p: W(x, y, z), color: opts.color ?? 0xffb050, power: opts.power ?? 0.8, radius: opts.radius ?? 3.6, light: !!opts.light, bulb: b, dist: opts.dist, flicker: opts.flicker });
  };
  const chimney = (x: number, y: number, z: number, smokeKind: "chimney" | "forge" | "kiln" = "chimney", hgt = 1) => {
    box(0.46, hgt, 0.46, 0x3a3739, x, y, z);
    ctx.smoke({ p: W(x, y + hgt, z), kind: smokeKind });
  };
  const hitBox = (hw: number, hh: number, hd: number, y = 0): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(0, y + hh / 2, 0);
    m.userData.loc = loc;
    m.userData.hit = true;
    g.add(m);
    out.hit = m;
    return m;
  };

  const rr = rng(loc.length * 131 + loc.charCodeAt(loc.length - 1) + spec.villageId.length * 7);
  const roofCols = [0x363a47, 0x3b3e4b, 0x32353f, 0x403c49];
  const plank = [0x40342a, 0x3a2e25, 0x453829];

  if (type === "barracks") {
    const wm = winMat();
    box(w + 0.15, 0.5, d + 0.15, 0x4b4a4d, 0, 0, 0);
    box(w, 1.75, d, plank[Math.floor(rr() * 3)]!, 0, 0.5, 0);
    for (let i = -2; i <= 2; i++) box(0.09, 1.75, d + 0.04, 0x241b14, i * (w / 4.4), 0.5, 0);
    gable(w, d, 1.25, roofCols[Math.floor(rr() * 4)]!, 0.3, 2.25);
    door(-w / 2 + 0.95, d / 2);
    windows([-0.2, 0.9, 1.7].map((x) => x * (w / 4.4)), 1.55, d / 2, wm);
    lantern(-w / 2 + 1.5, 1.35, d / 2 + 0.2, { power: 0.7, radius: 3.2 });
    if (rr() < 0.75) chimney(w / 4, 2.7, -0.3, "chimney", 0.95);
    box(1.2, 0.5, 0.5, 0x4f3f2f, w / 2 - 0.5, 0, d / 2 + 0.55);
    hitBox(w + 0.8, 3.4, d + 0.8);
  } else if (type === "bakery") {
    const wm = winMat(0xffc06a);
    box(w + 0.15, 0.4, d + 0.15, 0x4d4b4e, 0, 0, 0);
    box(w, 1.9, d, 0x6f6450, 0, 0.4, 0);
    for (const x of [-w / 2 + 0.03, -0.4, w / 2 - 0.03]) box(0.12, 1.9, d + 0.06, 0x2b2018, x, 0.4, 0);
    box(w + 0.06, 0.1, d + 0.06, 0x2b2018, 0, 1.2, 0);
    gable(w, d, 1.3, 0x3a2b2a, 0.3, 2.3);
    door(-0.6, d / 2);
    windows([0.65, -1.05], 1.6, d / 2, wm);
    cyl(0.55, 0.62, 0.8, 8, 0x4a3f38, w / 2 + 0.6, 0, 0.2);
    const glMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
    glMat.userData.base = new THREE.Color(0xff7a2a);
    wins.push(glMat);
    const gl = new THREE.Mesh(new THREE.CircleGeometry(0.22, 8), glMat);
    gl.position.set(w / 2 + 0.6, 0.45, 0.2 + 0.64);
    g.add(gl);
    chimney(w / 2 - 0.55, 2.3, -0.4, "chimney", 1.4);
    box(0.5, 0.35, 0.05, 0x8a6a3a, -w / 2 - 0.2, 1.7, d / 2 - 0.1);
    lantern(0.35, 1.3, d / 2 + 0.2, { power: 0.8, radius: 3.4, light: false });
    hitBox(w + 1.8, 3.8, d + 0.8);
  } else if (type === "tavern") {
    const wm = winMat(0xffa63c);
    box(w + 0.15, 0.4, d + 0.15, 0x4d4b4e, 0, 0, 0);
    box(w, 1.7, d, 0x5b4a38, 0, 0.4, 0);
    box(w + 0.3, 1.5, d + 0.3, 0x40322a, 0, 2.1, 0);
    for (const x of [-w / 2, -w / 6, w / 6, w / 2]) box(0.1, 3.3, 0.06, 0x20160f, x, 0.4, d / 2 + 0.16);
    gable(w + 0.3, d + 0.3, 1.6, 0x2c2a32, 0.35, 3.6);
    door(0, d / 2);
    windows([-1.1, 1.1], 1.25, d / 2, wm, 0.5, 0.55);
    windows([-1.1, 0, 1.1], 2.8, d / 2 + 0.15, wm, 0.45, 0.5);
    box(0.06, 0.06, 0.8, 0x20160f, w / 2 - 0.4, 1.85, d / 2 + 0.5);
    box(0.7, 0.5, 0.06, 0x7a5a30, w / 2 - 0.4, 1.35, d / 2 + 0.9);
    cyl(0.3, 0.3, 0.55, 8, 0x5a4020, -w / 2 - 0.3, 0, d / 2 - 0.2);
    cyl(0.3, 0.3, 0.55, 8, 0x5a4020, -w / 2 - 0.3, 0, d / 2 + 0.45);
    chimney(-w / 4, 3.6, -0.5, "chimney", 1.1);
    lantern(1.2, 1.7, d / 2 + 0.3, { power: 1.0, radius: 4.4, light: true, color: 0xffa040 });
    lantern(-1.3, 1.7, d / 2 + 0.3, { power: 0.9, radius: 3.6 });
    hitBox(w + 1.2, 4.6, d + 1.2);
  } else if (type === "forge") {
    box(w + 0.1, 0.35, d + 0.1, 0x4d4b4e, 0, 0, 0);
    box(w, 2.0, 0.35, 0x3f3d40, 0, 0.35, -d / 2 + 0.17);
    for (const [x, z] of [[-w / 2 + 0.15, d / 2 - 0.15], [w / 2 - 0.15, d / 2 - 0.15], [-w / 2 + 0.15, -d / 2 + 0.2], [w / 2 - 0.15, -d / 2 + 0.2]] as [number, number][]) box(0.22, 2.1, 0.22, 0x2e2118, x, 0.35, z);
    gable(w, d, 0.9, 0x23252c, 0.35, 2.45);
    box(1.1, 1.2, 0.9, 0x4a4647, 0.2, 0.35, -d / 2 + 0.7);
    const fire = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.06), new THREE.MeshBasicMaterial({ color: 0xff6a1c }));
    fire.position.set(0.2, 0.95, -d / 2 + 1.17);
    g.add(fire);
    out.flames.push(fire);
    box(0.7, 0.35, 0.45, 0x1e1f23, -0.9, 0.35, 0.3);
    box(0.25, 0.15, 0.7, 0x1e1f23, -0.9, 0.7, 0.3);
    cone(0.35, 0.4, 5, 0x15130f, 1.2, 0, 0.8);
    box(0.5, 4.2, 0.5, 0x3a3739, 0.2, 0.35, -d / 2 + 0.1);
    ctx.smoke({ p: W(0.2, 4.6, -d / 2 + 0.1), kind: "forge" });
    ctx.sparks({ p: W(0.2, 1.4, -d / 2 + 1.2) });
    ctx.lamp({ p: W(0.2, 1.1, -d / 2 + 1.4), color: 0xff7a2a, power: 1.4, radius: 5.6, light: true, dist: 24, flicker: 2.0 });
    lantern(w / 2 - 0.3, 1.9, d / 2 + 0.1, { power: 0.5, radius: 3, color: 0xffa040 });
    hitBox(w + 1, 4.8, d + 0.8);
  } else if (type === "carpenter") {
    const wm = winMat();
    box(w + 0.15, 0.35, d + 0.15, 0x4d4b4e, 0, 0, 0);
    box(w, 1.6, d, 0x5f4a30, 0, 0.35, 0);
    for (let i = -3; i <= 3; i++) box(0.05, 1.6, d + 0.03, 0x2f2316, i * 0.42, 0.35, 0);
    gable(w, d, 1.0, 0x3a2f2a, 0.35, 1.95);
    box(1.2, 1.4, 0.08, 0x1a130e, -0.55, 0, d / 2 + 0.02);
    windows([0.9], 1.5, d / 2, wm);
    for (let i = 0; i < 5; i++) box(1.6, 0.1, 0.35, 0x8a6a3e, w / 2 + 0.7, 0.1 + i * 0.12, 0.4 + (i % 2) * 0.05);
    for (const x of [-0.3, 0.3]) box(0.08, 0.6, 0.08, 0x5a4026, x, 0, d / 2 + 0.9);
    box(0.9, 0.08, 0.14, 0x5a4026, 0, 0.55, d / 2 + 0.9);
    box(0.14, 1.4, 0.14, 0x6a4a28, -w / 2 - 0.4, 0, 0.2).rotation.z = 0.12;
    box(0.14, 1.4, 0.14, 0x6a4a28, -w / 2 - 0.65, 0, 0.5).rotation.z = 0.08;
    chimney(w / 3, 1.95, -0.3, "chimney", 0.8);
    lantern(-w / 2 + 0.3, 1.7, d / 2 + 0.2, { power: 0.7, radius: 3.2 });
    hitBox(w + 2, 3.0, d + 1.4);
  } else if (type === "mill") {
    const wm = winMat();
    cyl(1.35, 1.5, 0.45, 8, 0x4d4b4e, 0, 0, 0);
    cyl(1.15, 1.35, 2.5, 8, 0x58554f, 0, 0.45, 0);
    cone(1.6, 1.7, 8, 0x2b2830, 0, 2.95, 0);
    door(0, 1.3, 1.1, 0.7);
    windows([0], 2.1, 1.15, wm);
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.14, 12, 1, true), M(0x3b2e22)));
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.6, 12, 1, true), M(0x2a1f17)));
    for (let i = 0; i < 8; i++) {
      const p = box(0.12, 0.45, 0.65, 0x4b3828, 0, 0, 0, wheel);
      const a = (i / 8) * Math.PI * 2;
      p.position.set(0, Math.sin(a) * 1.05, Math.cos(a) * 1.05);
      p.rotation.x = -a;
    }
    wheel.rotation.z = Math.PI / 2;
    wheel.rotation.order = "ZYX";
    const holder = new THREE.Group();
    holder.position.set(-1.95, 1.0, 0);
    holder.add(wheel);
    g.add(holder);
    out.wheels.push(holder);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1.5, 10), new THREE.MeshLambertMaterial({ color: 0x1d2c36 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(-2.4, 0.05, 0.9);
    g.add(pond);
    box(0.6, 0.5, 0.6, 0xb9ae90, 1.0, 0, 1.4);
    box(0.6, 0.5, 0.6, 0xb9ae90, 1.2, 0, 1.0);
    lantern(0.8, 1.5, 1.45, { power: 0.7, radius: 3.4 });
    hitBox(5.2, 4.7, 4);
  } else if (type === "townhall") {
    const wm = winMat(0xffb85a);
    box(w + 0.2, 0.55, d + 0.2, 0x4d4b4e, 0, 0, 0);
    box(w, 1.9, d, 0x56555a, 0, 0.55, 0);
    box(w + 0.1, 1.2, d + 0.1, 0x4a3c2e, 0, 2.45, 0);
    for (const x of [-1.6, -0.55, 0.55, 1.6]) box(0.12, 1.2, d + 0.16, 0x1f160e, x, 2.45, 0);
    gable(w, d, 1.9, 0x2a2c35, 0.35, 3.65);
    door(0, d / 2, 1.5, 0.95);
    windows([-1.4, 1.4], 1.5, d / 2, wm, 0.5, 0.65);
    windows([-1.1, 1.1], 3.05, d / 2 + 0.05, wm, 0.46, 0.5);
    for (let i = 0; i < 3; i++) box(1.8 - i * 0.2, 0.15, 0.4, 0x5f5e63, 0, i * 0.17, d / 2 + 0.7 - i * 0.2);
    box(0.9, 1.0, 0.9, 0x40362c, 0, 5.4, -0.2);
    cone(0.85, 0.9, 4, 0x2a2c35, 0, 6.4, -0.2).rotation.y = Math.PI / 4;
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5, 0, Math.PI * 2, 0, Math.PI * 0.75), new THREE.MeshBasicMaterial({ color: 0xc89a46 }));
    bell.position.set(0, 5.75, -0.2);
    g.add(bell);
    box(0.07, 3.6, 0.07, 0x20160f, w / 2 - 0.1, 0, d / 2 + 0.8);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55, 4, 1), new THREE.MeshLambertMaterial({ color: 0x7a2e24, side: THREE.DoubleSide }));
    fl.position.set(w / 2 + 0.35, 3.2, d / 2 + 0.8);
    g.add(fl);
    out.flags.push(fl);
    lantern(-1.0, 1.9, d / 2 + 0.25, { power: 0.95, radius: 4.2, light: true });
    lantern(1.0, 1.9, d / 2 + 0.25, { power: 0.8, radius: 3.4 });
    hitBox(w + 1, 6.8, d + 1.6);
  } else if (type === "prison") {
    box(w + 0.2, 0.4, d + 0.2, 0x3e3d40, 0, 0, 0);
    box(w, 3.2, d, 0x4a4a4f, 0, 0.4, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      box(0.4, 0.5, 0.4, 0x404045, Math.cos(a) * (w / 2 - 0.1), 3.6, Math.sin(a) * (d / 2 - 0.1));
    }
    box(0.6, 1.0, 0.1, 0x111113, 0, 0, d / 2 + 0.03);
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.5), winMat(0xd2552b));
    slit.position.set(0, 2.2, d / 2 + 0.03);
    g.add(slit);
    lantern(0.8, 1.5, d / 2 + 0.2, { power: 0.5, radius: 3.0, color: 0xff6030 });
    hitBox(w + 0.8, 4.4, d + 0.8);
  } else if (type === "elder") {
    const wm = winMat(0xffb85a);
    box(w + 0.2, 0.5, d + 0.2, 0x4d4b4e, 0, 0, 0);
    box(w, 1.7, d, 0x5b5750, 0, 0.5, 0);
    box(w + 0.1, 1.2, d + 0.1, 0x4a3c2e, 0, 2.2, 0);
    for (let i = -3; i <= 3; i++) box(0.1, 1.2, d + 0.14, 0x1f160e, i * 0.7, 2.2, 0);
    gable(w, d, 1.6, 0x4a2d26, 0.35, 3.4);
    door(0, d / 2, 1.3, 0.85);
    windows([-1.7, -0.9, 0.9, 1.7], 1.5, d / 2, wm, 0.42, 0.55);
    windows([-1.3, 0, 1.3], 2.85, d / 2 + 0.05, wm, 0.42, 0.45);
    chimney(w / 2 - 0.7, 3.4, -0.5, "chimney", 1.5);
    chimney(-w / 2 + 0.7, 3.4, -0.5, "chimney", 1.3);
    for (const x of [-0.9, 0.9]) box(0.14, 1.5, 0.14, 0x2e2118, x, 0, d / 2 + 0.8);
    box(2.4, 0.12, 0.8, 0x3a2e26, 0, 1.5, d / 2 + 0.55);
    lantern(0, 1.35, d / 2 + 0.85, { power: 1.0, radius: 4.2, light: false });
    hitBox(w + 1, 5.0, d + 1.6);
  } else if (type === "seamstress") {
    const wm = winMat(0xffb0c4);
    box(w + 0.15, 0.4, d + 0.15, 0x4d4b4e, 0, 0, 0);
    box(w, 1.5, d, 0x645a4c, 0, 0.4, 0);
    gable(w, d, 1.1, 0x342a30, 0.3, 1.9);
    door(-0.6, d / 2);
    windows([0.7], 1.45, d / 2, wm);
    box(0.06, 1.6, 0.06, 0x2e2118, w / 2 + 0.5, 0, 0.8);
    box(0.06, 1.6, 0.06, 0x2e2118, w / 2 + 2.3, 0, 0.8);
    [0xb0597a, 0xc9bfa6, 0x6a7fa0, 0xa6823a].forEach((cc, i) => {
      const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.6), new THREE.MeshLambertMaterial({ color: cc, side: THREE.DoubleSide }));
      cl.position.set(w / 2 + 0.75 + i * 0.42, 1.25, 0.8);
      g.add(cl);
      out.flags.push(cl);
    });
    lantern(0.35, 1.3, d / 2 + 0.2, { power: 0.6, radius: 3, color: 0xffb888 });
    chimney(w / 3, 1.9, -0.2, "chimney", 0.7);
    hitBox(w + 2.8, 3.2, d + 1.4);
  } else if (type === "healer") {
    const wm = winMat(0xa8d878);
    box(w + 0.15, 0.35, d + 0.15, 0x4d4b4e, 0, 0, 0);
    box(w, 1.45, d, 0x5a4a38, 0, 0.35, 0);
    gable(w, d, 1.2, 0x2e3a30, 0.3, 1.8);
    door(0.5, d / 2);
    windows([-0.6], 1.4, d / 2, wm);
    for (let i = 0; i < 5; i++) {
      const hb = cone(0.1, 0.35, 5, 0x5f8a45, -1.0 + i * 0.25, 1.15 - (i % 2) * 0.12, d / 2 + 0.3);
      hb.rotation.x = Math.PI;
    }
    box(1.2, 0.04, 0.04, 0x2e2118, -0.5, 1.55, d / 2 + 0.3);
    lantern(-0.6, 1.3, d / 2 + 0.3, { power: 0.8, radius: 3.4, color: 0x9cd070 });
    chimney(-w / 3, 1.8, -0.2, "chimney", 0.7);
    hitBox(w + 0.8, 3.2, d + 0.8);
  } else if (type === "field") {
    const crop = spec.variant === 0 ? [0x8f8a3a, 0x7a7a34] : [0x3f6a3a, 0x4e7a3c];
    const rows = 12;
    for (let i = 0; i < rows; i++) {
      const z = -d / 2 + 0.3 + (i / (rows - 1)) * (d - 0.6);
      box(w - 0.6 - (i % 2) * 0.4, 0.14, 0.34, 0x3a2c1f, 0, 0, z);
      box(w - 0.9 - (i % 2) * 0.4, 0.2, 0.26, crop[i % 2]!, 0, 0.1, z);
    }
    for (let i = 0; i <= 6; i++) box(0.1, 0.6, 0.1, 0x3a2c1f, -w / 2 + (i / 6) * w, 0, d / 2 + 0.15);
    box(w, 0.06, 0.05, 0x3a2c1f, 0, 0.42, d / 2 + 0.15);
    const sx = spec.variant === 0 ? w / 2 - 1 : -w / 2 + 1;
    box(0.07, 1.3, 0.07, 0x3a2c1f, sx, 0, 0);
    box(0.9, 0.07, 0.07, 0x3a2c1f, sx, 1.0, 0);
    cone(0.2, 0.25, 6, 0x6a5a2a, sx, 1.32, 0);
    const shx = spec.variant === 0 ? -w / 2 + 0.2 : w / 2 - 0.2;
    box(1.1, 0.9, 0.9, 0x4a3a2a, shx, 0, -d / 2 - 0.7);
    gable(1.1, 0.9, 0.5, 0x2e2a30, 0.15, 0.9, shx, -d / 2 - 0.7);
    lantern(shx, 0.8, -d / 2 - 0.2, { power: 0.45, radius: 3.0 });
    hitBox(w + 0.5, 1.6, d + 0.5);
  } else if (type === "pasture") {
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color: 0x283a1f }));
    gm.rotation.x = -Math.PI / 2;
    gm.position.y = 0.09;
    g.add(gm);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) pts.push([-w / 2 + (i / 10) * w, -d / 2], [-w / 2 + (i / 10) * w, d / 2]);
    for (let i = 1; i < 5; i++) pts.push([-w / 2, -d / 2 + (i / 5) * d], [w / 2, -d / 2 + (i / 5) * d]);
    for (const [x, z] of pts) box(0.1, 0.7, 0.1, 0x4a382a, x, 0, z);
    for (const z of [-d / 2, d / 2]) { box(w, 0.06, 0.05, 0x4a382a, 0, 0.5, z); box(w, 0.06, 0.05, 0x4a382a, 0, 0.28, z); }
    for (const x of [-w / 2, w / 2]) { box(0.05, 0.06, d, 0x4a382a, x, 0.5, 0); box(0.05, 0.06, d, 0x4a382a, x, 0.28, 0); }
    box(1.6, 1.0, 1.2, 0x4f3d2c, w / 2 - 1.2, 0, -d / 2 + 0.9);
    gable(1.6, 1.2, 0.55, 0x2e2a30, 0.2, 1.0, w / 2 - 1.2, -d / 2 + 0.9);
    cone(0.55, 0.7, 6, 0x8a7a3a, -w / 2 + 1.0, 0, -d / 2 + 0.9);
    lantern(w / 2 - 1.2, 0.95, -d / 2 + 1.7, { power: 0.5, radius: 3.0 });
    for (let i = 0; i < 5; i++) {
      const gt = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.26), M(i % 2 ? 0xb7ae98 : 0x5a4a3a));
      body.position.y = 0.38;
      gt.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.16), M(i % 2 ? 0xb7ae98 : 0x5a4a3a));
      head.position.set(0.3, 0.52, 0);
      gt.add(head);
      for (const lz of [-0.1, 0.1]) for (const lx of [-0.18, 0.18]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.06), M(0x2a2018));
        l.position.set(lx, 0.13, lz);
        gt.add(l);
      }
      gt.userData = { cx: (i - 2) * 1.6, cz: ((i * 37) % 5) * 0.4 - 1, ph: i * 1.7, sp: 0.15 + (i % 3) * 0.06 };
      gt.position.set(gt.userData.cx as number, 0.1, gt.userData.cz as number);
      g.add(gt);
      out.goats.push(gt);
    }
    hitBox(w + 0.5, 1.4, d + 0.5);
  } else if (type === "forest") {
    for (const [kx, kz] of [[-3.2, 0.4], [3.6, -0.8]] as [number, number][]) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.35, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), M(0x241d18));
      dome.position.set(kx, 0, kz);
      g.add(dome);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.12, 4, 10), M(0x3a2c20));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(kx, 0.1, kz);
      g.add(ring);
      for (let i = 0; i < 4; i++) {
        const a = i * 1.57 + 0.4;
        const em = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
        em.position.set(kx + Math.cos(a) * 1.0, 0.6, kz + Math.sin(a) * 1.0);
        em.lookAt(kx, 0.6, kz);
        g.add(em);
        out.flames.push(em);
      }
      ctx.smoke({ p: W(kx, 1.4, kz), kind: "kiln" });
      ctx.lamp({ p: W(kx, 0.8, kz + 1.4), color: 0xff8a3a, power: 0.8, radius: 4.6, light: kx < 0, dist: 20, flicker: 1.5 });
    }
    for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) cyl(0.17, 0.17, 1.6, 6, 0x5a4026, -0.6 + i * 0.36, 0.1 + k * 0.28, 2.5).rotation.z = Math.PI / 2;
    box(1.4, 0.9, 1.1, 0x3f3226, 0.2, 0, -1.7);
    gable(1.4, 1.1, 0.5, 0x25232a, 0.15, 0.9, 0.2, -1.7);
    hitBox(w, 2.2, d);
  } else if (type === "mine") {
    const pz = -3.6;
    const jam = (x: number) => box(0.7, 3.0, 1.0, 0x3b3a3e, x, 0, pz);
    jam(-1.6); jam(1.6);
    box(4.0, 0.7, 1.1, 0x3b3a3e, 0, 3.0, pz);
    box(0.3, 3.0, 0.3, 0x4a3524, -1.15, 0, pz + 0.6);
    box(0.3, 3.0, 0.3, 0x4a3524, 1.15, 0, pz + 0.6);
    box(2.8, 0.3, 0.3, 0x4a3524, 0, 2.7, pz + 0.6);
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c });
    mouthMat.userData.base = new THREE.Color(0xff9a3c);
    wins.push(mouthMat);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.7), mouthMat);
    mouth.position.set(0, 1.35, pz + 0.25);
    g.add(mouth);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3), new THREE.MeshBasicMaterial({ color: 0x160d06 }));
    inner.position.set(0, 1.2, pz + 0.27);
    g.add(inner);
    ctx.lamp({ p: W(0, 1.4, pz + 1.4), color: 0xff8a2a, power: 1.5, radius: 7, light: true, dist: 36, flicker: 1.2 });
    for (const x of [-0.35, 0.35]) box(0.07, 0.06, 4.4, 0x5a5a60, x, 0.06, pz + 2.4);
    for (let i = 0; i < 9; i++) box(1.1, 0.06, 0.12, 0x3a2c1f, 0, 0.02, pz + 0.5 + i * 0.5);
    box(1.0, 0.5, 0.8, 0x4a3a2c, 0, 0.18, pz + 3.4);
    cone(0.45, 0.35, 6, 0x2a2a2e, 0, 0.68, pz + 3.4);
    for (const [wx, wz] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]] as [number, number][]) cyl(0.14, 0.14, 0.08, 6, 0x1c1c20, wx, 0.1, pz + 3.4 + wz).rotation.z = Math.PI / 2;
    for (const [x, z, s] of [[2.8, -2.0, 1], [3.3, -1.1, 0.7], [-3.0, -2.2, 0.8]] as [number, number, number][]) cone(0.9 * s, 0.9 * s, 5, 0x4c3a30, x, 0, z);
    for (const [x, z] of [[-3.4, -0.4], [-2.4, -0.4], [-3.4, 0.6], [-2.4, 0.6]] as [number, number][]) {
      const p = box(0.14, 3.2, 0.14, 0x4a3524, x * 0.55 - 1.5 + (x + 2.9) * 0.4, 0, z);
      p.rotation.z = (x + 2.9) * 0.15;
    }
    const hw = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.15, 8), M(0x2a2a2e));
    hw.rotation.z = Math.PI / 2;
    hw.position.set(-3.45, 3.4, 0.1);
    g.add(hw);
    out.wheels.push(hw);
    hitBox(7.2, 4.0, 8, 0).position.z = -0.5;
  } else if (type === "trail") {
    for (let i = 0; i < 9; i++) {
      const z = -2.2 - i * 1.15 - (i % 2) * 0.3, x = Math.sin(i * 0.9) * 1.1 + i * 0.12;
      const wx = g.position.x + x, wz = g.position.z + z;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), M(0x5d5a57));
      st.scale.set(1, 0.3, 1.2);
      st.position.set(x, H(wx, wz) - g.position.y + 0.04, z);
      g.add(st);
    }
    box(0.7, 0.55, 0.7, 0x4b3a29, 1.1, 0, -0.2);
    box(0.5, 0.4, 0.5, 0x55422d, 1.6, 0, 0.3);
    box(0.6, 0.4, 0.55, 0x4b3a29, 1.2, 0.55, -0.2);
    box(0.08, 1.6, 0.08, 0x2e2118, -0.9, 0, 0);
    lantern(-0.9, 1.6, 0, { power: 0.8, radius: 4.0, color: 0x9fd0c8, flicker: 0.5 });
    hitBox(w + 2, 3, 6, 0).position.z = -3;
  } else if (type === "hub") {
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.14, 12), M(0x5a5146));
    plaza.position.y = 0.07;
    g.add(plaza);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 3, 20), M(0x6d6354));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.16;
    g.add(ring);
    cyl(0.35, 0.22, 0.7, 6, 0x2a2a2e, 0, 0.1, 0);
    cyl(0.5, 0.3, 0.2, 7, 0x1d1d20, 0, 0.8, 0);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.65, 5), new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
    fl.position.set(0, 1.3, 0);
    g.add(fl);
    out.flames.push(fl);
    ctx.lamp({ p: W(0, 1.5, 0), color: 0xff9a3c, power: 1.5, radius: 8.5, light: true, dist: 38, flicker: 1.8 });
    ctx.sparks({ p: W(0, 1.5, 0) });
    box(0.14, 1.9, 0.14, 0x3a2c1f, -1.5, 0, -1.9);
    box(0.14, 1.9, 0.14, 0x3a2c1f, 1.5, 0, -1.9);
    box(3.4, 1.0, 0.1, 0x4a3a2a, 0, 0.8, -1.9);
    ([[-1.1, 0xc9bfa6], [-0.4, 0xb8ad8e], [0.5, 0xc9bfa6], [1.15, 0xaa9f80]] as [number, number][]).forEach(([x, cc], i) => box(0.5, 0.36 - (i % 2) * 0.06, 0.03, cc, x, 1.0, -1.83));
    for (const x of [-0.6, 0.6]) box(0.14, 2.2, 0.14, 0x3a2c1f, x + 2.0, 0, 1.5).rotation.z = x * -0.12;
    box(1.5, 0.14, 0.14, 0x3a2c1f, 2.0, 2.15, 1.5);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5, 0, Math.PI * 2, 0, Math.PI * 0.75), new THREE.MeshBasicMaterial({ color: 0xc89a46 }));
    bell.position.set(2.0, 1.8, 1.5);
    g.add(bell);
    box(1.2, 0.35, 0.35, 0x4a3a2a, -2.0, 0, 1.2).rotation.y = 0.4;
    box(1.2, 0.35, 0.35, 0x4a3a2a, -1.6, 0, -0.2);
    hitBox(5.6, 2.6, 5.6);
  }
  return out;
}
