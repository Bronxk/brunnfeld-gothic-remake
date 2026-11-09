// Terrain heightfield, roads and trees (ported from the approved demo, generalised to several valleys).

import * as THREE from "three";
import { VALLEY, PASS, MINE_PORTAL, polyAt, type Layout, type V2 } from "./layout";
import { fbm, hash2, rng, smooth, radialTexture } from "./util";

export type HeightFn = (x: number, z: number) => number;

export interface TerrainFns {
  H: HeightFn;
  /** Signed distance to the nearest valley / road corridor (negative = inside). */
  sd: (x: number, z: number) => number;
}

function sdValley(x: number, z: number): number {
  const V = VALLEY;
  const cx = (V.x0 + V.x1) / 2, cz = (V.z0 + V.z1) / 2, hx = (V.x1 - V.x0) / 2, hz = (V.z1 - V.z0) / 2;
  const qx = Math.abs(x - cx) - (hx - V.r), qz = Math.abs(z - cz) - (hz - V.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - V.r;
}

function distSeg(px: number, pz: number, a: V2, b: V2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

/** Height function: flat valley floors, walls rising outside, corridors carved along the inter-village roads. */
export function makeTerrainFns(layout: Layout, cap: number): TerrainFns {
  const slots = layout.villages;
  const segs: [V2, V2][] = [];
  for (const r of layout.roads) for (let i = 1; i < r.pts.length; i++) segs.push([r.pts[i - 1]!, r.pts[i]!]);
  const def = slots.find((s) => s.isDefault);
  const sd = (x: number, z: number): number => {
    let d = 1e9;
    for (const s of slots) d = Math.min(d, sdValley(x - s.ox, z - s.oz));
    for (const [a, b] of segs) d = Math.min(d, distSeg(x, z, a, b) - 3.2);
    return d;
  };
  const H: HeightFn = (x, z) => {
    const d = sd(x, z);
    const floor = (fbm(x * 0.09, z * 0.09) - 0.5) * 0.32 * (1 - smooth(0, 3, d));
    if (d <= 0) return floor;
    let wall = 2.7 * d * (1 - Math.exp(-d / 2.4));
    if (def) {
      const lx = x - def.ox, lz = z - def.oz;
      const notch = Math.exp(-(((lx - PASS.x) ** 2) / 70 + ((lz - PASS.z) ** 2) / 90));
      wall *= 1 - 0.72 * notch;
      const mine = Math.exp(-(((lx - MINE_PORTAL.x) ** 2) + ((lz - MINE_PORTAL.z - 1.2) ** 2)) / 30);
      wall *= 1 - 0.62 * mine;
    }
    wall = cap * Math.tanh(wall / cap);
    const rough = (fbm(x * 0.06 + 20, z * 0.06 - 11) - 0.5) * (cap * 0.55) * smooth(0.5, 9, d);
    return floor + wall + rough * 0.8;
  };
  return { H, sd };
}

export function buildTerrain(layout: Layout, fns: TerrainFns, cap: number, skirt: number): THREE.Mesh {
  const { x0, x1, z0, z1 } = layout.bounds;
  const { H, sd } = fns;
  const step = layout.villages.length > 2 ? 1.5 : layout.villages.length > 1 ? 1.25 : 1.0;
  const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
  const hs = new Float32Array((nx + 1) * (nz + 1));
  const px = (i: number) => x0 + i * ((x1 - x0) / nx), pz = (j: number) => z0 + j * ((z1 - z0) / nz);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) hs[j * (nx + 1) + i] = H(px(i), pz(j));
  const pos: number[] = [], col: number[] = [];
  const c = new THREE.Color();
  const frostCol = new THREE.Color(0.3, 0.33, 0.4), grassCol = new THREE.Color(0.16, 0.17, 0.11);

  function faceColor(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nxn = uy * vz - uz * vy, nyn0 = uz * vx - ux * vz, nzn = ux * vy - uy * vx;
    const nl = Math.hypot(nxn, nyn0, nzn) || 1, nyn = Math.abs(nyn0 / nl);
    const d = sd(mx, mz);
    const n = fbm(mx * 0.35, mz * 0.35);
    if (d <= -0.6 && nyn > 0.85) {
      const moss = smooth(0.45, 0.8, fbm(mx * 0.12 + 40, mz * 0.12));
      c.setRGB(0.1 + n * 0.05, 0.088 + n * 0.04 + moss * 0.035, 0.06 + n * 0.02);
    } else {
      const rock = 0.2 + n * 0.12 + (1 - nyn) * -0.06 + nyn * 0.04;
      const warm = smooth(0, 6, d) < 0.5 ? 0.03 : 0;
      c.setRGB(rock * 0.98 + warm, rock * 0.97 + warm * 0.6, rock * 1.07);
      const frost = smooth(cap * 0.52, cap * 0.85, my) * nyn;
      c.lerp(frostCol, frost * 0.5);
      if (nyn > 0.82 && d > 0 && d < 9) c.lerp(grassCol, 0.5 * (1 - d / 9));
    }
  }
  function tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    faceColor(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const h00 = hs[j * (nx + 1) + i]!, h10 = hs[j * (nx + 1) + i + 1]!, h01 = hs[(j + 1) * (nx + 1) + i]!, h11 = hs[(j + 1) * (nx + 1) + i + 1]!;
      const xa = px(i), xb = px(i + 1), za = pz(j), zb = pz(j + 1);
      if ((i + j) & 1) {
        tri(xa, h00, za, xa, h01, zb, xb, h10, za);
        tri(xb, h10, za, xa, h01, zb, xb, h11, zb);
      } else {
        tri(xa, h00, za, xa, h01, zb, xb, h11, zb);
        tri(xa, h00, za, xb, h11, zb, xb, h10, za);
      }
    }
  }
  /* diorama skirt: cut-away geology below the rim */
  function pushQuad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, rgb: [number, number, number]): void {
    const nn = (hash2(Math.round(ax * 3), Math.round(az * 3)) - 0.5) * 0.04;
    c.setRGB(rgb[0] + nn, rgb[1] + nn, rgb[2] + nn);
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  function wall(ax: number, az: number, bx: number, bz: number, ha: number, hb: number): void {
    pushQuad(ax, ha, az, bx, hb, bz, bx, 0, bz, ax, 0, az, [0.22, 0.19, 0.15]);
    pushQuad(ax, 0, az, bx, 0, bz, bx, -2.2, bz, ax, -2.2, az, [0.16, 0.14, 0.13]);
    pushQuad(ax, -2.2, az, bx, -2.2, bz, bx, -skirt, bz, ax, -skirt, az, [0.1, 0.09, 0.09]);
  }
  for (let i = 0; i < nx; i++) {
    wall(px(i + 1), z0, px(i), z0, hs[i + 1]!, hs[i]!);
    wall(px(i), z1, px(i + 1), z1, hs[nz * (nx + 1) + i]!, hs[nz * (nx + 1) + i + 1]!);
  }
  for (let j = 0; j < nz; j++) {
    wall(x0, pz(j), x0, pz(j + 1), hs[j * (nx + 1)]!, hs[(j + 1) * (nx + 1)]!);
    wall(x1, pz(j + 1), x1, pz(j), hs[(j + 1) * (nx + 1) + nx]!, hs[j * (nx + 1) + nx]!);
  }
  pos.push(x0, -skirt, z0, x1, -skirt, z1, x1, -skirt, z0, x0, -skirt, z0, x0, -skirt, z1, x1, -skirt, z1);
  for (let k = 0; k < 6; k++) col.push(0.08, 0.07, 0.07);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  mesh.name = "terrain";
  return mesh;
}

export interface RoadMeshes {
  group: THREE.Group;
  /** Inter-village road meshes by road id (their material emissive is animated for war). */
  inter: Map<string, THREE.InstancedMesh>;
  samples: V2[];
}

function roadInstances(pts: V2[], width: number, H: HeightFn, out: { x: number; z: number; yaw: number; l: number; w: number }[]): void {
  for (let k = 0; k < pts.length - 1; k++) {
    const p = pts[k]!, q = pts[k + 1]!;
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const n = Math.max(1, Math.round(len / 0.8));
    const yaw = Math.atan2(q.x - p.x, q.z - p.z);
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      const x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
      out.push({ x, z, yaw, l: (len / n) * 1.25, w: width });
    }
  }
  void H;
}

function instancedRoad(items: { x: number; z: number; yaw: number; l: number; w: number }[], H: HeightFn, tone: number): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(1, 0.16, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), p = new THREE.Vector3(), cc = new THREE.Color();
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.yaw);
    s.set(it.w * (0.9 + hash2(i, 3) * 0.2), 1, it.l);
    p.set(it.x, H(it.x, it.z) + 0.03, it.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    const v = tone + hash2(i, 9) * 0.06;
    cc.setRGB(v * 1.15, v * 0.98, v * 0.78);
    mesh.setColorAt(i, cc);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

export function buildRoads(layout: Layout, H: HeightFn): RoadMeshes {
  const group = new THREE.Group();
  group.name = "roads";
  const samples: V2[] = [];
  /* village road graph */
  const items: { x: number; z: number; yaw: number; l: number; w: number }[] = [];
  for (const v of layout.villages) {
    const seen = new Set<string>();
    for (const [a, set] of v.adj) {
      for (const b of set) {
        const key = [a, b].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const pts = [v.nodes.get(a)!, ...(v.via.get(`${a}|${b}`) ?? []), v.nodes.get(b)!];
        roadInstances(pts, a.startsWith("Baracke") && b.startsWith("Baracke") ? 1.9 : 1.35, H, items);
      }
    }
  }
  const village = instancedRoad(items, H, 0.3);
  village.name = "village-roads";
  group.add(village);
  for (const it of items) samples.push({ x: it.x, z: it.z });
  /* inter-village roads */
  const inter = new Map<string, THREE.InstancedMesh>();
  for (const r of layout.roads) {
    const ri: typeof items = [];
    roadInstances(r.pts, 1.6, H, ri);
    const mesh = instancedRoad(ri, H, 0.3);
    mesh.name = `road:${r.id}`;
    group.add(mesh);
    inter.set(r.id, mesh);
    for (const it of ri) samples.push({ x: it.x, z: it.z });
  }
  return { group, inter, samples };
}

/** Small ember glow strips laid over a road (visible only while at war). */
export function buildRoadGlow(layout: Layout, H: HeightFn): Map<string, THREE.Mesh> {
  const tex = radialTexture([[0, "rgba(255,255,255,0.9)"], [0.5, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]], 64);
  const out = new Map<string, THREE.Mesh>();
  for (const r of layout.roads) {
    const n = Math.max(2, Math.round(r.length / 5));
    const geo = new THREE.PlaneGeometry(4.2, 4.2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xff4a1c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const { p: pt } = polyAt(r.pts, r.cum, (r.length * (i + 0.5)) / n);
      p.set(pt.x, H(pt.x, pt.z) + 0.2, pt.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 3;
    mesh.visible = false;
    mesh.frustumCulled = false;
    out.set(r.id, mesh);
  }
  return out;
}

export interface TreeResult { group: THREE.Group }

/** Instanced pines: charcoal-burner wood around each Köhlerwald plus a fringe on the valley walls. */
export function buildTrees(layout: Layout, H: HeightFn, sd: TerrainFns["sd"], avoid: { x: number; z: number; r: number }[]): TreeResult {
  const rnd = rng(1337);
  const list: { x: number; z: number; s: number }[] = [];
  const tooClose = (x: number, z: number) => avoid.some((a) => (a.x - x) ** 2 + (a.z - z) ** 2 < a.r * a.r);
  for (const v of layout.villages) {
    const kw = v.locations.find((l) => l.kind === "forest");
    if (!kw) continue;
    for (let i = 0, guard = 0; i < 70 && guard < 600; guard++) {
      const x = kw.base.x + (rnd() - 0.5) * 22, z = kw.base.z + (rnd() - 0.45) * 12 - 1.5;
      if (sd(x, z) > 9 || tooClose(x, z)) continue;
      list.push({ x, z, s: 0.9 + rnd() * 1.1 });
      i++;
    }
  }
  const { x0, x1, z0, z1 } = layout.bounds;
  const fringe = 90 * layout.villages.length;
  for (let i = 0, guard = 0; i < fringe && guard < 6000 * layout.villages.length; guard++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    const d = sd(x, z);
    if (d < -7 || d > 7) continue;
    if (d < -0.5 && rnd() < 0.6) continue;
    if (tooClose(x, z) || H(x, z) > 9) continue;
    list.push({ x, z, s: 0.8 + rnd() * 1.5 });
    i++;
  }
  const trunkG = new THREE.CylinderGeometry(0.12, 0.2, 1, 5); trunkG.translate(0, 0.5, 0);
  const c1G = new THREE.ConeGeometry(0.95, 1.7, 6); c1G.translate(0, 1.55, 0);
  const c2G = new THREE.ConeGeometry(0.7, 1.4, 6); c2G.translate(0, 2.45, 0);
  const mk = (g: THREE.BufferGeometry) => new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), Math.max(1, list.length));
  const tr = mk(trunkG), a = mk(c1G), b = mk(c2G);
  for (const mesh of [tr, a, b]) mesh.count = list.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), cc = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((t, i) => {
    q.setFromAxisAngle(up, rnd() * 6.28);
    p.set(t.x, H(t.x, t.z) - 0.1, t.z);
    s.set(t.s, t.s * (0.9 + rnd() * 0.4), t.s);
    m.compose(p, q, s);
    tr.setMatrixAt(i, m); a.setMatrixAt(i, m); b.setMatrixAt(i, m);
    cc.setRGB(0.16, 0.1, 0.07); tr.setColorAt(i, cc);
    const gcol = 0.1 + rnd() * 0.06;
    cc.setRGB(gcol * 0.55, gcol * 1.15, gcol * 0.7); a.setColorAt(i, cc);
    cc.setRGB(gcol * 0.6, gcol * 1.3, gcol * 0.75); b.setColorAt(i, cc);
  });
  const grp = new THREE.Group();
  grp.add(tr, a, b);
  grp.name = "trees";
  return { group: grp };
}

/** Rockslide that buried the Kehlpass (default village only). */
export function buildRockslide(ox: number, oz: number, H: HeightFn): THREE.Group {
  const rnd = rng(2024);
  const mat = new THREE.MeshLambertMaterial({ color: 0x57544f, flatShading: true });
  const mat2 = new THREE.MeshLambertMaterial({ color: 0x3f3d3c, flatShading: true });
  const g = new THREE.Group();
  g.name = "Kehlpass";
  const bx = PASS.x + ox, bz = PASS.z + oz;
  for (let i = 0; i < 46; i++) {
    const r = 0.8 + rnd() * 2.1;
    const x = bx + (rnd() - 0.5) * 15, z = bz + (rnd() - 0.5) * 9 + 0.5;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), rnd() < 0.5 ? mat : mat2);
    m.position.set(x, H(x, z) + r * 0.35, z);
    m.scale.set(1, 0.6 + rnd() * 0.5, 1);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(m);
  }
  const beamMat = new THREE.MeshLambertMaterial({ color: 0x4b3624 });
  for (let i = 0; i < 5; i++) {
    const bm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 4 + rnd() * 2, 0.28), beamMat);
    const x = bx + (rnd() - 0.5) * 8, z = bz - 3.5 + rnd() * 2;
    bm.position.set(x, H(x, z) + 1.2, z);
    bm.rotation.set(rnd() - 0.5, rnd() * 3, rnd() - 0.2);
    g.add(bm);
  }
  return g;
}
