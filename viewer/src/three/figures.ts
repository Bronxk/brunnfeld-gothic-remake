// Low-poly colonist figures and model badge sprites (ported from the approved demo).

import * as THREE from "three";

export type BadgeTone = "info" | "accent" | "bad" | "mute";
const TONE: Record<BadgeTone, string> = { info: "#7fb0c4", accent: "#f2a93b", bad: "#e56a45", mute: "#a2916f" };
const SKINS = [0xd9b08c, 0xc49a76, 0xe3c0a0, 0xb88a66, 0xcfa07a];
const badgeCache = new Map<string, THREE.CanvasTexture>();

export function badgeTexture(letter: string, tone: BadgeTone): THREE.CanvasTexture {
  const key = letter + tone;
  const cached = badgeCache.get(key);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas context unavailable");
  g.fillStyle = "rgba(14,11,9,0.92)";
  g.beginPath(); g.arc(48, 48, 40, 0, 7); g.fill();
  g.lineWidth = 7; g.strokeStyle = TONE[tone];
  g.beginPath(); g.arc(48, 48, 40, 0, 7); g.stroke();
  g.fillStyle = TONE[tone];
  g.font = "700 52px 'Alegreya Sans', system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(letter, 48, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  badgeCache.set(key, t);
  return t;
}

/** Body colour / hat / apron per craft (skill id). */
const CRAFT_LOOK: Record<string, { body: number; hat: string; apron?: number }> = {
  bauer: { body: 0x8a7a4a, hat: "straw" }, hirte: { body: 0x6f8a52, hat: "cap" }, knappe: { body: 0x6a6f78, hat: "lamp" },
  holzfaeller: { body: 0x8a4a34, hat: "beanie" }, mueller: { body: 0xc9bfa6, hat: "flour" }, baecker: { body: 0xe0d6b8, hat: "toque" },
  schmied: { body: 0x4a4a52, hat: "none", apron: 0x2a2420 }, zimmermann: { body: 0x9a6a3a, hat: "flat" },
  wirt: { body: 0xa35a3c, hat: "none", apron: 0xe7dcc0 }, bader: { body: 0x4e7a78, hat: "scarf" },
  haendler: { body: 0x7a4a7a, hat: "wide" }, naeherin: { body: 0xb0597a, hat: "scarf" }, none: { body: 0x7b7466, hat: "none" },
};

type MatFn = (hex: number) => THREE.MeshLambertMaterial;

function hatMesh(kind: string, M: MatFn, accent: number): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, col: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, M(col));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (kind) {
    case "straw": add(new THREE.ConeGeometry(0.42, 0.14, 8), 0xc9aa5a, 0, 0.04, 0); add(new THREE.CylinderGeometry(0.15, 0.17, 0.14, 6), 0xb08f45, 0, 0.14, 0); break;
    case "cap": add(new THREE.SphereGeometry(0.21, 6, 4, 0, 6.3, 0, 1.45), 0x5a6f48, 0, 0.0, 0); add(new THREE.BoxGeometry(0.22, 0.03, 0.14), 0x4a5c3a, 0, 0.0, 0.2); break;
    case "lamp": {
      add(new THREE.SphereGeometry(0.23, 6, 4, 0, 6.3, 0, 1.5), 0x34343a, 0, 0.0, 0);
      const l = add(new THREE.BoxGeometry(0.1, 0.07, 0.06), 0xffd070, 0, 0.1, 0.22);
      l.material = new THREE.MeshBasicMaterial({ color: 0xffd070 });
      break;
    }
    case "beanie": add(new THREE.SphereGeometry(0.21, 6, 4, 0, 6.3, 0, 1.6), 0x9a3b2a, 0, 0.0, 0); add(new THREE.SphereGeometry(0.06, 4, 3), 0x9a3b2a, 0, 0.22, 0); break;
    case "flour": add(new THREE.SphereGeometry(0.22, 6, 4, 0, 6.3, 0, 1.5), 0xe9e2cc, 0, 0.0, 0).scale.set(1.1, 0.8, 1.1); break;
    case "toque": add(new THREE.CylinderGeometry(0.17, 0.2, 0.3, 7), 0xf0ead6, 0, 0.17, 0); add(new THREE.SphereGeometry(0.2, 6, 4), 0xf0ead6, 0, 0.36, 0).scale.set(1, 0.6, 1); break;
    case "flat": add(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 7), 0x6a4a2a, 0, 0.04, 0); add(new THREE.BoxGeometry(0.24, 0.03, 0.12), 0x6a4a2a, 0, 0.02, 0.2); break;
    case "scarf": add(new THREE.SphereGeometry(0.235, 6, 4, 0, 6.3, 0, 1.75), accent, 0, 0.0, -0.02); add(new THREE.BoxGeometry(0.1, 0.26, 0.1), accent, 0.0, -0.18, -0.2).rotation.x = 0.2; break;
    case "wide": add(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 8), 0x3a2a3c, 0, 0.04, 0); add(new THREE.CylinderGeometry(0.17, 0.2, 0.22, 6), 0x3a2a3c, 0, 0.16, 0); add(new THREE.BoxGeometry(0.4, 0.04, 0.04), 0xb8883a, 0, 0.12, 0.19); break;
    case "vogt": add(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 8), 0x1a1618, 0, 0.04, 0); add(new THREE.CylinderGeometry(0.17, 0.22, 0.42, 7), 0x1a1618, 0, 0.26, 0); add(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 7), 0xa8802f, 0, 0.14, 0); break;
    case "hood": { const h = add(new THREE.ConeGeometry(0.3, 0.45, 7), 0x5a4a38, 0, 0.1, -0.04); h.rotation.x = -0.15; break; }
    default: break;
  }
  return g;
}

export type FigureAnim = "stand" | "walk" | "work";

export interface Figure {
  id: string;
  group: THREE.Group;
  hit: THREE.Mesh;
  badge: THREE.Sprite;
  craft: string;
  lying: boolean;
  setCraft(craft: string): void;
  /** Badge letter/tone, or null for the default model (badge hidden). */
  setBadge(b: { letter: string; tone: BadgeTone } | null): void;
  /** "alive" normal, "sleep" lying + dimmed, "dead" lying + very dark. */
  setVitals(v: "alive" | "sleep" | "dead"): void;
  setEmissive(hex: number): void;
  anim(state: FigureAnim, t: number, phase: number): void;
  dispose(): void;
}

export function makeFigure(id: string, craft: string): Figure {
  const mats = new Map<number, THREE.MeshLambertMaterial>();
  const litMats: THREE.MeshLambertMaterial[] = [];
  const M: MatFn = (hex) => {
    let m = mats.get(hex);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true }); m.userData.base = new THREE.Color(hex); mats.set(hex, m); litMats.push(m); }
    return m;
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.scale.setScalar(1.3);
  const skin = SKINS[(id.length + id.charCodeAt(0)) % SKINS.length]!;
  const isVogt = id === "reinhart", isMonk = id === "bruder_anno";

  const torsoGeo = new THREE.CylinderGeometry(0.19, 0.27, 0.62, 6);
  torsoGeo.translate(0, 0.31, 0);
  const torso = new THREE.Mesh(torsoGeo, M(0x888888));
  torso.position.y = 0.3;
  body.add(torso);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.46, 0.06), M(0x222222));
  apron.position.set(0, 0.55, 0.2);
  body.add(apron);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), M(skin));
  head.position.y = 1.14;
  body.add(head);
  const hatSlot = new THREE.Group();
  hatSlot.position.set(0, 1.28, 0);
  body.add(hatSlot);
  const mkLimb = (w: number, h: number, x: number, y: number, col: number) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), M(col));
    m.position.y = -h / 2;
    p.add(m);
    body.add(p);
    return { p, m };
  };
  const legL = mkLimb(0.12, 0.34, -0.1, 0.34, 0x2a2420), legR = mkLimb(0.12, 0.34, 0.1, 0.34, 0x2a2420);
  const armL = mkLimb(0.1, 0.42, -0.25, 0.9, 0x888888), armR = mkLimb(0.1, 0.42, 0.25, 0.9, 0x888888);

  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.9;
  hit.userData.figure = id;
  root.add(hit);

  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
  badge.renderOrder = 20;
  badge.position.y = 2.0;
  badge.visible = false;
  root.add(badge);

  const fig: Figure = {
    id, group: root, hit, badge, craft, lying: false,
    setCraft(c) {
      fig.craft = c;
      const look = CRAFT_LOOK[c] ?? CRAFT_LOOK.none!;
      let bodyCol = look.body, hat = look.hat;
      let accent = id === "rike" ? 0xf4b8d4 : id === "vroni" ? 0xe8b090 : 0xb0597a;
      if (c === "bader") accent = 0x4e7a78;
      if (isVogt) { bodyCol = 0x4a2428; hat = "vogt"; }
      if (isMonk) { bodyCol = 0x6a5a44; hat = "hood"; }
      if (c === "none" && !isVogt && !isMonk) { hat = id === "rike" || id === "vroni" ? "scarf" : "none"; bodyCol = id === "rike" ? 0x7b6a5a : look.body; }
      if (id === "wendel") hat = "cap";
      torso.material = M(bodyCol); armL.m.material = M(bodyCol); armR.m.material = M(bodyCol);
      if (isMonk) { legL.m.visible = legR.m.visible = false; torso.scale.set(1.15, 1.1, 1.15); } else { legL.m.visible = legR.m.visible = true; torso.scale.set(1, 1, 1); }
      apron.visible = !!look.apron && !isVogt && !isMonk;
      if (look.apron) apron.material = M(look.apron);
      while (hatSlot.children.length) {
        const old = hatSlot.children[0]!;
        hatSlot.remove(old);
        old.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); });
      }
      hatSlot.add(hatMesh(hat, M, accent));
    },
    setBadge(b) {
      if (!b) { badge.visible = false; return; }
      const mat = badge.material as THREE.SpriteMaterial;
      mat.map = badgeTexture(b.letter, b.tone);
      mat.needsUpdate = true;
      badge.visible = true;
    },
    setVitals(v) {
      const k = v === "alive" ? 1 : v === "sleep" ? 0.55 : 0.28;
      for (const m of litMats) m.color.copy(m.userData.base as THREE.Color).multiplyScalar(k);
      if (v === "alive") { body.rotation.set(0, 0, 0); body.position.y = 0; }
      else { body.rotation.set(-Math.PI / 2, 0, 0); body.position.y = 0.26; }
      fig.lying = v !== "alive";
    },
    setEmissive(hex) { for (const m of litMats) m.emissive.setHex(hex); },
    anim(state, t, ph) {
      if (fig.lying) { legL.p.rotation.x = legR.p.rotation.x = armL.p.rotation.x = armR.p.rotation.x = 0; return; }
      const w = state === "walk";
      const s = Math.sin(t * 9 + ph), s2 = Math.sin(t * 4.2 + ph);
      legL.p.rotation.x = w ? s * 0.8 : 0; legR.p.rotation.x = w ? -s * 0.8 : 0;
      armL.p.rotation.x = w ? -s * 0.7 : state === "work" ? s2 * 0.9 - 0.5 : 0.02;
      armR.p.rotation.x = w ? s * 0.7 : state === "work" ? -s2 * 0.9 - 0.5 : 0.02;
      body.position.y = w ? Math.abs(s) * 0.07 : Math.sin(t * 1.6 + ph) * 0.012;
      body.rotation.x = w ? 0.08 : state === "work" ? 0.14 + s2 * 0.08 : 0;
    },
    dispose() {
      root.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); });
      for (const m of mats.values()) m.dispose();
      (badge.material as THREE.SpriteMaterial).dispose();
    },
  };
  fig.setCraft(craft);
  return fig;
}
