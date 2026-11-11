/**
 * Bark backend test: `npm run test:barks` (from the repo root).
 * Works on a throwaway copy of data/ in a temp dir; the repo's data/ is never written.
 */
import { readFileSync, writeFileSync, copyFileSync, cpSync, mkdtempSync } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
{
  const tmp = mkdtempSync(join(tmpdir(), "schlackental-barks-"));
  cpSync(join(REPO, "data"), join(tmp, "data"), { recursive: true });
  process.chdir(tmp); // modules resolve data/ from the cwd at import time, so this runs before the imports below
}

// Invalid env must warn and fall back to 1 (getBarkLevel reads lazily, so this is the first call).
process.env.BARK_LEVEL = "banana";
const warnings: string[] = [];
const origWarn = console.warn;
console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };

const B = await import(`${REPO}/src/barks.ts`);
const { BARK_POOL } = await import(`${REPO}/src/barks-pool.ts`);
const { BARK_KINDS } = await import(`${REPO}/src/barks-types.ts`);
const { eventBus } = await import(`${REPO}/src/events.ts`);
const W = await import(`${REPO}/src/world-registry.ts`);
const WAR = await import(`${REPO}/src/war.ts`);
const SC = await import(`${REPO}/src/sim-control.ts`);
const { handleRegieRoute } = await import(`${REPO}/src/routes-regie.ts`);

let passed = 0;
let failed = 0;
function ok(cond: unknown, msg: string): void {
  if (cond) { passed++; } else { failed++; console.log(`  FAIL: ${msg}`); }
}
function eq(a: unknown, b: unknown, msg: string): void {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  ok(sa === sb, `${msg} (got ${sa}, expected ${sb})`);
}
const section = (s: string) => console.log(`\n# ${s}`);

const DATA = join(process.cwd(), "data");
const baseState = JSON.parse(readFileSync(join(DATA, "world_state.json"), "utf-8"));
const fresh = (tick = 1): any => {
  const s = JSON.parse(JSON.stringify(baseState));
  s.current_tick = tick;
  s.banned ??= {};
  s.production_log ??= [];
  return s;
};
const constRng = (v: number) => () => v;
function seq(seed: number): () => number { // tiny LCG for test-side randomness
  let a = seed >>> 0;
  return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
}

const NPCS: string[] = W.getNpcNames();
const villageOf = (a: string) => W.getAgentVillage(a);

// ─── 0. env / level ──────────────────────────────────────────
section("level + env");
ok(B.getBarkLevel() === 1, "invalid BARK_LEVEL falls back to 1");
ok(warnings.some(w => w.includes("BARK_LEVEL")), "invalid BARK_LEVEL warns");
ok(SC.getSimControl().barkLevel === 1, "sim status carries barkLevel");
let thrown = "";
try { B.setBarkLevel(5); } catch (e) { thrown = (e as Error).message; }
eq(thrown, "Ungültige Sprüche-Stufe: erwartet 0, 1 oder 2.", "setBarkLevel(5) message");
ok(B.getBarkLevel() === 1, "level unchanged after invalid set");
{
  const seen: any[] = [];
  const on = (s: any) => seen.push(s);
  eventBus.on("sim:control", on);
  B.setBarkLevel(2);
  eventBus.off("sim:control", on);
  ok(seen.length === 1 && seen[0].barkLevel === 2, "setBarkLevel emits sim:control with the new level");
  B.setBarkLevel(1);
}

// ─── 1. barkRole / pickBark ──────────────────────────────────
section("barkRole + pickBark");
{
  const s = fresh();
  const elder = W.getVillageElder("schlackental");
  const r = B.barkRole(s, elder);
  eq(r.slice(0, 2), ["vogt", "rottmeister"], "elder: vogt before rottmeister");
  ok(!r.includes("any"), "barkRole never includes any");
  const council2 = W.getCouncilMembers("schlackental")[1];
  eq(B.barkRole(s, council2)[0], "rottmeister", "council member: rottmeister first");
  const plain = NPCS.find(a => s.economics[a].skill !== "none" && !W.getCouncilMembers(villageOf(a)).includes(a))!;
  eq(B.barkRole(s, plain), [s.economics[plain].skill], "plain craftsman: only skill");
  const nobody = NPCS.find(a => s.economics[a].skill === "none" && !W.getCouncilMembers(villageOf(a)).includes(a))!;
  eq(B.barkRole(s, nobody), [], "skill none + no seat: no roles");

  // role preference: find any (kind, craft) with dedicated lines in the current pool
  let found: { kind: string; role: string } | null = null;
  for (const kind of BARK_KINDS) {
    for (const [role, lines] of Object.entries(BARK_POOL[kind] as Record<string, string[]>)) {
      if (role === "any" || role === "vogt" || role === "rottmeister" || !lines?.length) continue;
      if (NPCS.some(a => s.economics[a].skill === role && B.barkRole(s, a)[0] === role) && !lines.some(l => l.includes("{"))) {
        found ??= { kind, role };
      }
    }
  }
  if (!found) {
    console.log("  (no craft-specific placeholder-free lines in pool: role preference check skipped)");
  } else {
    const agent = NPCS.find(a => s.economics[a].skill === found!.role && B.barkRole(s, a)[0] === found!.role)!;
    const roleLines: string[] = BARK_POOL[found.kind][found.role];
    let hits = 0;
    const rng = seq(7);
    for (let i = 0; i < 400; i++) {
      B.resetBarkState();
      const t = B.pickBark(s, agent, found.kind, rng);
      if (t && roleLines.includes(t)) hits++;
    }
    ok(hits / 400 > 0.5, `role lines preferred for ${found.role}/${found.kind} (${hits}/400)`);
    ok(hits / 400 < 0.95 || BARK_POOL[found.kind].any.length === 0, "…but not always (any lines still appear)");
  }

  // placeholders: never leak "{", {gegner} lines skipped without gegner, {gegner}/{dorf} filled
  const rng = seq(11);
  let leaks = 0;
  let nulls = 0;
  for (const kind of BARK_KINDS) {
    for (const agent of NPCS) {
      for (const g of [undefined, "Kehlhof"]) {
        B.resetBarkState();
        const t = B.pickBark(s, agent, kind, rng, g);
        if (t === null) { nulls++; continue; }
        if (/\{(dorf|gegner)\}/.test(t)) leaks++;
        if (g === undefined && t.includes("Kehlhof") && !t.includes(W.getDisplayName(agent))) {
          // could legitimately be {dorf} = own village Kehlhof: only count if agent is not from Kehlhof
          if (villageOf(agent) !== "kehlhof") leaks++;
        }
      }
    }
  }
  eq(leaks, 0, "no unfilled placeholders / no stray gegner without one");
  ok(nulls === 0, `every kind has a usable line for everybody (nulls=${nulls})`);

  const gLines = (BARK_KINDS as string[]).flatMap(k => BARK_POOL[k].any.filter((l: string) => l.includes("{gegner}")).map((l: string) => [k, l]));
  if (gLines.length) {
    const [k, l] = gLines[0]!;
    const agent = NPCS[0]!;
    const only = { ...BARK_POOL[k], any: [l] };
    // direct check through the real pool is not possible without editing it; use kinds with only-{gegner} filtering instead
    let sawFilled = false;
    for (let i = 0; i < 200; i++) {
      B.resetBarkState();
      const t = B.pickBark(s, agent, k, rng, "Rabenstollen");
      if (t?.includes("Rabenstollen")) sawFilled = true;
    }
    ok(sawFilled, `{gegner} gets filled (${k})`);
    void only;
  }
  const dLines = (BARK_KINDS as string[]).flatMap(k => BARK_POOL[k].any.filter((l: string) => l.includes("{dorf}")).map((l: string) => [k, l]));
  if (dLines.length) {
    const [k] = dLines[0]!;
    const agent = NPCS.find(a => villageOf(a) === "rabenstollen")!;
    let sawFilled = false;
    for (let i = 0; i < 300; i++) {
      B.resetBarkState();
      const t = B.pickBark(s, agent, k, rng, "Kehlhof");
      if (t?.includes("Rabenstollen")) sawFilled = true;
    }
    ok(sawFilled, `{dorf} gets filled with the speaker's settlement (${k})`);
  }

  // no immediate repeats
  const agent = NPCS[3]!;
  for (const kind of ["gruss", "hunger", "arbeit"]) {
    B.resetBarkState();
    const usable = new Set<string>();
    const probe = seq(5);
    for (let i = 0; i < 300; i++) { B.resetBarkState(); const t = B.pickBark(s, agent, kind, probe); if (t) usable.add(t); }
    B.resetBarkState();
    let prev: string | null = null;
    let repeats = 0;
    for (let i = 0; i < 60; i++) {
      const t = B.pickBark(s, agent, kind, rng);
      if (usable.size >= 2 && t !== null && t === prev) repeats++;
      prev = t;
    }
    eq(repeats, 0, `no immediate repeats for ${kind} (${usable.size} usable lines)`);
  }
  // last-3 avoidance when the pool is big enough
  {
    B.resetBarkState();
    const big = [...new Set((() => { const out: string[] = []; const p = seq(9); for (let i = 0; i < 400; i++) { B.resetBarkState(); const t = B.pickBark(s, agent, "gruss", p); if (t) out.push(t); } return out; })())];
    if (big.length >= 6) {
      B.resetBarkState();
      const got: string[] = [];
      for (let i = 0; i < 40; i++) got.push(B.pickBark(s, agent, "gruss", rng)!);
      let bad = 0;
      for (let i = 3; i < got.length; i++) if (got.slice(i - 3, i).includes(got[i]!)) bad++;
      eq(bad, 0, "no repeat within the last 3 barks (gruss pool big enough)");
    } else console.log(`  (gruss pool has only ${big.length} usable lines for this agent: last-3 check skipped)`);
  }
}

// ─── 2. clickBark ────────────────────────────────────────────
section("clickBark");
{
  const a = NPCS.find(x => villageOf(x) === "schlackental" && fresh().economics[x].skill === "bauer")!;
  const plainState = (): any => {
    const s = fresh(10);
    const b = s.body[a];
    b.hunger = 0; b.energy = 9; delete b.injury; delete b.sickness;
    s.economics[a].wallet = 50;
    s.agent_locations[a] = s.economics[a].homeLocation;
    s.banned = {}; delete s.war_marches; delete s.diplomacy;
    return s;
  };
  const NO_FALL = constRng(0.99);
  const kindOf = (s: any, rng = NO_FALL) => { B.resetBarkState(); return B.clickBark(s, a, rng); };

  let s = plainState();
  let r = kindOf(s);
  ok(r && (r.kind === "gruss" || r.kind === "abweisen"), `plain agent → gruss/abweisen (${r?.kind})`);
  ok(r && typeof r.text === "string" && r.text.length > 0 && !r.text.includes("{"), "text is filled");

  s = plainState(); s.body[a].hunger = 4; eq(kindOf(s)?.kind, "hunger", "hungry agent → hunger");
  s = plainState(); s.body[a].energy = 1; eq(kindOf(s)?.kind, "erschoepft", "exhausted → erschoepft");
  s = plainState(); s.body[a].sickness = 2; eq(kindOf(s)?.kind, "krank", "sick → krank");
  s = plainState(); s.body[a].injury = 2; s.body[a].sickness = 2; eq(kindOf(s)?.kind, "verletzt", "injured beats sick");
  s = plainState(); s.economics[a].wallet = 1; eq(kindOf(s)?.kind, "arm", "poor → arm");
  s = plainState(); s.agent_locations[a] = s.economics[a].workLocation; eq(kindOf(s)?.kind, "arbeit", "at workplace → arbeit");
  s = plainState(); s.agent_locations[a] = "Zechenplatz"; eq(kindOf(s)?.kind, "markt", "at the hub → markt");
  s = plainState(); s.economics[a].wallet = 400; eq(kindOf(s)?.kind, "reich", "much richer than median → reich");
  s = plainState(); s.economics[a].wallet = 8; s.body[a].hunger = 2; eq(kindOf(s)?.kind, "abweisen", "hunger 2 / purse <= 10 → abweisen");

  s = plainState();
  s.diplomacy = { "kehlhof|schlackental": { a: "kehlhof", b: "schlackental", stance: "krieg", tension: 90, since: 1, raidsWon: {} } };
  r = kindOf(s);
  eq(r?.kind, "krieg_verteidigung", "settlement at war → krieg_verteidigung");
  ok(r && !r.text.includes("{"), "war text filled");
  s.diplomacy["kehlhof|schlackental"].stance = "spannung";
  eq(kindOf(s)?.kind, "spannung", "settlement in tension → spannung");

  s = plainState();
  s.war_marches = { [a]: { target: "kehlhof", phase: "hin", road: "Road: Schlackental→Kehlhof", departTick: 9, arriveTick: 11 } };
  s.body[a].hunger = 4;
  eq(kindOf(s)?.kind, "krieg_marsch", "marching agent → krieg_marsch (beats hunger)");

  s = plainState();
  s.banned[a] = 99; s.body[a].hunger = 5; s.body[a].injury = 3;
  s.war_marches = { [a]: { target: "kehlhof", phase: "hin", road: "x", departTick: 9, arriveTick: 11 } };
  eq(kindOf(s)?.kind, "karzer", "karzer beats everything");
  eq(kindOf(s, constRng(0))?.kind, "karzer", "karzer never falls through to small talk");
  s.banned[a] = 5; // expired (tick 10)
  ok(kindOf(s)?.kind !== "karzer", "expired Karzer no longer counts");

  // fall-through: with rng < 0.25 the first match is skipped for gruss/abweisen
  s = plainState(); s.body[a].injury = 2;
  const ft = kindOf(s, constRng(0));
  ok(ft && (ft.kind === "gruss" || ft.kind === "abweisen"), `fall-through gives small talk (${ft?.kind})`);
  let falls = 0;
  const rr = seq(3);
  for (let i = 0; i < 400; i++) { B.resetBarkState(); if (B.clickBark(s, a, rr)?.kind !== "verletzt") falls++; }
  ok(falls / 400 > 0.12 && falls / 400 < 0.4, `~25% fall-through (${falls}/400)`);

  // no cooldown / works at every level incl. 0
  B.setBarkLevel(0);
  ok(B.clickBark(plainState(), a, NO_FALL) !== null, "click bark works at level 0");
  B.setBarkLevel(1);

  // dead / player / unknown
  s = plainState(); s.body[a].starvation_ticks = 999;
  eq(B.clickBark(s, a), null, "dead agent → null");
  eq(B.clickBark(plainState(), "player"), null, "player → null");
  eq(B.clickBark(plainState(), "nobody_here"), null, "unknown → null");
}

// ─── 3. collectTickBarks ─────────────────────────────────────
section("collectTickBarks");
const makeBusy = (): any => {
  const s = fresh(1);
  // a player
  const pl = NPCS[0]!;
  W.setPlayerIdentity({ name: "Der Neue", skill: "none" });
  s.player = { created: true, name: "Der Neue", skill: "none" };
  s.agent_locations.player = s.agent_locations[pl];
  s.body.player = { hunger: 5, energy: 1, sleep_quality: "good", injury: 3 };
  s.economics.player = JSON.parse(JSON.stringify(s.economics[pl])); s.economics.player.wallet = 0;
  const rr = seq(21);
  s.diplomacy = { "kehlhof|schlackental": { a: "kehlhof", b: "schlackental", stance: "spannung", tension: 60, since: 1, raidsWon: {} } };
  NPCS.forEach((a, i) => {
    const b = s.body[a];
    if (i % 3 === 0) b.hunger = 5;
    if (i % 4 === 0) b.injury = 2;
    if (i % 5 === 0) b.sickness = 1;
    if (i % 6 === 0) b.energy = 1;
    if (i % 7 === 0) s.economics[a].wallet = 0;
    if (i % 9 === 0) s.agent_locations[a] = villageOf(a) === "schlackental" ? "Zechenplatz" : `${villageOf(a)}:Zechenplatz`;
  });
  // dead, jailed, marching agents
  s.body[NPCS[1]!].starvation_ticks = 999; s.body[NPCS[1]!].hunger = 5;
  s.body[NPCS[2]!].starvation_ticks = 999; s.body[NPCS[2]!].injury = 3;
  s.banned[NPCS[4]!] = 999; s.agent_locations[NPCS[4]!] = villageOf(NPCS[4]!) === "schlackental" ? "Karzer" : `${villageOf(NPCS[4]!)}:Karzer`;
  s.war_marches = {};
  for (const a of [NPCS[6]!, NPCS[8]!, NPCS[10]!]) {
    s.war_marches[a] = { target: villageOf(a) === "kehlhof" ? "schlackental" : "kehlhof", phase: "hin", road: "r", departTick: 0, arriveTick: 99 };
    s.agent_locations[a] = "Road: Schlackental→Kehlhof";
    s.body[a].hunger = 5; s.body[a].injury = 2;
  }
  void rr;
  return s;
};
const stranger = (s: any): void => {
  // a Kehlhof colonist visiting Schlackental's square next to a local
  const loc = "Zechenplatz";
  const visitor = NPCS.find(a => villageOf(a) === "kehlhof" && !s.war_marches?.[a])!;
  const local = NPCS.find(a => villageOf(a) === "schlackental" && !s.war_marches?.[a] && s.body[a].starvation_ticks !== 999)!;
  s.agent_locations[visitor] = loc;
  s.agent_locations[local] = loc;
};

const ctxFor = (tick: number, rich = true): any => {
  const c = B.emptyTickBarkContext(8 + (tick % 14), tick % 2 ? "Regen, 6 °C" : "Mild, 12 °C, sonnig");
  if (rich) {
    c.producers = NPCS.slice(10, 24);
    c.traders = NPCS.slice(24, 30);
    c.appellVillages = tick % 5 === 0 ? ["schlackental"] : [];
  }
  return c;
};

for (const lvl of [1, 2] as const) {
  B.setBarkLevel(lvl);
  const cap = lvl === 1 ? 3 : 8;
  const cd = lvl === 1 ? 4 : 2;
  const run = (): any[][] => {
    B.resetBarkState();
    const s = makeBusy();
    stranger(s);
    const out: any[][] = [];
    for (let t = 1; t <= 20; t++) {
      s.current_tick = t;
      const before = JSON.stringify(s);
      out.push(B.collectTickBarks(s, t, ctxFor(t)));
      if (JSON.stringify(s) !== before) { ok(false, `collectTickBarks mutated the state at tick ${t}`); }
    }
    return out;
  };
  const first = run();
  const total = first.reduce((n, e) => n + e.length, 0);
  ok(total > 0, `level ${lvl}: some barks happen (${total} in 20 ticks)`);
  ok(first.some(e => e.length === cap), `level ${lvl}: cap ${cap} is reached at least once (max ${Math.max(...first.map(e => e.length))})`);
  ok(first.every(e => e.length <= cap), `level ${lvl}: never more than ${cap} per tick`);

  const s = makeBusy(); stranger(s);
  const lastTick = new Map<string, number>();
  let marcherOk = true, listenerOk = true, playerOk = true, deadOk = true, oneOk = true, cooldownOk = true, fieldsOk = true;
  const kindsSeen = new Set<string>();
  first.forEach((events, i) => {
    const tick = i + 1;
    const seenAgents = new Set<string>();
    for (const ev of events) {
      kindsSeen.add(ev.kind);
      if (seenAgents.has(ev.agent)) oneOk = false;
      seenAgents.add(ev.agent);
      if (ev.agent === "player") playerOk = false;
      if (s.body[ev.agent].starvation_ticks === 999) deadOk = false;
      if (s.war_marches[ev.agent] && !ev.kind.startsWith("krieg_")) marcherOk = false;
      if (ev.kind === "gruss" || ev.kind === "abweisen") {
        const others = Object.keys(s.agent_locations).filter(a => a !== ev.agent && s.agent_locations[a] === ev.location && s.body[a].starvation_ticks !== 999);
        if (others.length === 0) listenerOk = false;
      }
      const prev = lastTick.get(ev.agent);
      if (prev !== undefined && tick - prev < cd) cooldownOk = false;
      lastTick.set(ev.agent, tick);
      if (ev.tick !== tick || s.agent_locations[ev.agent] !== ev.location || typeof ev.text !== "string" || !ev.text || ev.text.includes("{")) fieldsOk = false;
    }
  });
  ok(oneOk, `level ${lvl}: at most one bark per agent per tick`);
  ok(playerOk, `level ${lvl}: never the player`);
  ok(deadOk, `level ${lvl}: never a dead agent`);
  ok(marcherOk, `level ${lvl}: marchers only krieg_*`);
  ok(listenerOk, `level ${lvl}: gruss/abweisen only with a listener`);
  ok(cooldownOk, `level ${lvl}: per-agent cooldown ${cd} respected`);
  ok(fieldsOk, `level ${lvl}: event fields filled (tick, location, text)`);
  console.log(`  kinds at level ${lvl}: ${[...kindsSeen].sort().join(", ")}`);

  const second = run();
  eq(second, first, `level ${lvl}: same ticks + state → same barks (determinism)`);

  // re-running the very same tick without reset gives the same result
  B.resetBarkState();
  const s2 = makeBusy(); stranger(s2);
  for (let t = 1; t <= 6; t++) {
    s2.current_tick = t;
    const a1 = B.collectTickBarks(s2, t, ctxFor(t));
    const a2 = B.collectTickBarks(s2, t, ctxFor(t));
    if (JSON.stringify(a1) !== JSON.stringify(a2)) { ok(false, `level ${lvl}: re-run of tick ${t} differs`); }
  }
  ok(true, `level ${lvl}: re-running a tick in place checked`);
  W.setPlayerIdentity(null);
}

// alone vs listener: lone agents only shout the alone-ok kinds
{
  B.setBarkLevel(2);
  B.resetBarkState();
  const s = fresh(5);
  const ALONE = new Set(["karzer", "verletzt", "krank", "hunger", "erschoepft", "wetter", "nacht", "krieg_marsch", "krieg_angriff", "krieg_verteidigung", "krieg_sieg", "krieg_niederlage", "dieb"]);
  // spread everyone out alone in distinct locations (own bunk) with all sorts of states
  NPCS.forEach((a, i) => {
    s.body[a].hunger = i % 2 ? 5 : 0; s.economics[a].wallet = i % 3 ? 0 : 500;
    s.agent_locations[a] = s.economics[a].homeLocation;
  });
  // everybody has own home? make them unique by moving duplicates to their work location
  const used = new Set<string>();
  for (const a of NPCS) {
    let l = s.agent_locations[a];
    if (used.has(l)) l = s.economics[a].workLocation;
    s.agent_locations[a] = l; used.add(l);
  }
  const counts = new Map<string, number>();
  for (const a of NPCS) counts.set(s.agent_locations[a], (counts.get(s.agent_locations[a]) ?? 0) + 1);
  let bad = 0, n = 0;
  for (let t = 5; t < 25; t++) {
    s.current_tick = t;
    for (const ev of B.collectTickBarks(s, t, B.emptyTickBarkContext(21, "Sturm, 3 °C"))) {
      n++;
      if ((counts.get(ev.location) ?? 0) === 1 && !ALONE.has(ev.kind)) bad++;
    }
  }
  ok(n > 0, `lone agents still bark (${n})`);
  eq(bad, 0, "lone agents only shout alone-ok kinds");
  B.setBarkLevel(1);
}

// war events: raid cries now, outcome next tick (cooldown does not swallow them)
{
  B.setBarkLevel(2);
  B.resetBarkState();
  const s = fresh(10);
  const raiders = NPCS.filter(a => villageOf(a) === "schlackental").slice(0, 2);
  const defenders = NPCS.filter(a => villageOf(a) === "kehlhof").slice(0, 2);
  for (const a of NPCS) { s.body[a].hunger = 0; s.body[a].energy = 9; s.economics[a].wallet = 30; }
  const c = B.emptyTickBarkContext(12, "Mild");
  c.raids = [{ attackerVillage: "schlackental", targetVillage: "kehlhof", raiders, defenders, success: true }];
  // earlier bark within the cooldown window must not block war moments
  const ev0 = B.collectTickBarks(s, 10, c);
  const byAgent = new Map(ev0.map((e: any) => [e.agent, e.kind]));
  ok(raiders.every(a => byAgent.get(a) === "krieg_angriff"), "raiders: krieg_angriff");
  ok(defenders.every(a => byAgent.get(a) === "krieg_verteidigung"), "defenders: krieg_verteidigung");
  const ev1 = B.collectTickBarks(s, 11, B.emptyTickBarkContext(13, "Mild"));
  const k1 = new Map(ev1.map((e: any) => [e.agent, e.kind]));
  ok(raiders.every(a => k1.get(a) === "krieg_sieg"), "winners: krieg_sieg in the next tick");
  ok(defenders.every(a => k1.get(a) === "krieg_niederlage"), "losers: krieg_niederlage in the next tick");
  const ev2 = B.collectTickBarks(s, 12, B.emptyTickBarkContext(14, "Mild"));
  ok(![...raiders, ...defenders].some(a => ev2.some((e: any) => e.agent === a && e.kind.startsWith("krieg_s"))), "outcome is shouted only once");
  B.setBarkLevel(1);
}

// theft / appell / weather / fremder at level 2 (single targeted checks)
{
  B.setBarkLevel(2);
  const s = fresh(10);
  for (const a of NPCS) { s.body[a].hunger = 0; s.body[a].energy = 9; s.economics[a].wallet = 30; s.agent_locations[a] = s.economics[a].homeLocation; }
  const [thief, victim, witness] = NPCS.filter(a => villageOf(a) === "schlackental");
  for (const a of [thief!, victim!, witness!]) s.agent_locations[a] = "Zechenplatz";
  const c = B.emptyTickBarkContext(12, "Mild");
  c.thefts = [{ thief, victim, location: "Zechenplatz", caught: true }];
  let kinds = new Map<string, string>();
  for (let i = 0; i < 12 && !(kinds.has(victim!)); i++) {
    B.resetBarkState();
    kinds = new Map(B.collectTickBarks(s, 10 + i, c).map((e: any) => [e.agent, e.kind]));
  }
  eq(kinds.get(victim!), "dieb", "theft victim shouts dieb");
  ok(!kinds.has(thief!) || kinds.get(thief!) !== "dieb", "thief does not shout dieb");

  // fremder
  const loc = "Zechenplatz";
  const visitor = NPCS.find(a => villageOf(a) === "kehlhof")!;
  const local = NPCS.find(a => villageOf(a) === "schlackental" && ![thief, victim, witness].includes(a))!;
  for (const a of [thief!, victim!, witness!]) s.agent_locations[a] = s.economics[a].homeLocation;
  s.agent_locations[visitor] = loc; s.agent_locations[local] = loc;
  let sawFremder = false;
  for (let i = 0; i < 30 && !sawFremder; i++) {
    B.resetBarkState();
    sawFremder = B.collectTickBarks(s, 20 + i, B.emptyTickBarkContext(12, "Mild")).some((e: any) => e.agent === local && e.kind === "fremder");
  }
  ok(sawFremder, "stranger from another settlement → local shouts fremder");

  // appell: at the Vogtei when the bell rang
  const vogtei = W.getVillageTownHall("schlackental");
  const att = NPCS.filter(a => villageOf(a) === "schlackental").slice(0, 3);
  for (const a of att) s.agent_locations[a] = vogtei;
  const c2 = B.emptyTickBarkContext(12, "Mild"); c2.appellVillages = ["schlackental"];
  let sawAppell = false;
  for (let i = 0; i < 30 && !sawAppell; i++) {
    B.resetBarkState();
    sawAppell = B.collectTickBarks(s, 40 + i, c2).some((e: any) => e.kind === "appell" && att.includes(e.agent));
  }
  ok(sawAppell, "Appell bell → attendees at the Vogtei shout appell");

  // wetter: outside only
  for (const a of NPCS) s.agent_locations[a] = villageOf(a) === "schlackental" ? "Baracke 1" : `${villageOf(a)}:Baracke 1`; // cottages = inside
  const out = NPCS.find(a => villageOf(a) === "schlackental")!;
  s.agent_locations[out] = "Oberfeld";
  let sawWetter = false, wetterInside = false;
  for (let i = 0; i < 40; i++) {
    B.resetBarkState();
    for (const e of B.collectTickBarks(s, 60 + i, B.emptyTickBarkContext(12, "Schneesturm, -8 °C"))) {
      if (e.kind === "wetter") { if (e.agent === out) sawWetter = true; else wetterInside = true; }
    }
  }
  ok(sawWetter, "bad weather outside → wetter");
  ok(!wetterInside, "bad weather: nobody indoors shouts wetter");
  B.setBarkLevel(1);
}

// ─── 4. emitTickBarks ────────────────────────────────────────
section("emitTickBarks");
{
  const logs: string[] = [];
  const origLog = console.log;
  const seen: any[] = [];
  const on = (e: any) => seen.push(e);
  eventBus.on("agent:bark", on);

  B.setBarkLevel(0);
  B.resetBarkState();
  const s = makeBusy();
  console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
  for (let t = 1; t <= 10; t++) B.emitTickBarks(s, t, ctxFor(t));
  console.log = origLog;
  eq(seen.length, 0, "level 0: nothing emitted");
  eq(logs.filter(l => l.includes("💬")).length, 0, "level 0: nothing logged");

  B.setBarkLevel(1);
  B.resetBarkState();
  console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
  for (let t = 1; t <= 10; t++) B.emitTickBarks(s, t, ctxFor(t));
  console.log = origLog;
  ok(seen.length > 0, `level 1: agent:bark emitted (${seen.length})`);
  ok(seen.every(e => e.agent && e.text && e.kind && e.location && typeof e.tick === "number"), "payload shape {agent,text,kind,location,tick}");
  ok(logs.some(l => /💬 .+ \(\w+\): „.+“/.test(l)), "console line format");
  eventBus.off("agent:bark", on);
  W.setPlayerIdentity(null);
  B.setBarkLevel(1);
}

// ─── 5. war integration: captureRaidSetup → resolveWar → buildRaids ───
section("raid capture (real war.ts)");
{
  const s = fresh(10);
  s.diplomacy = { "kehlhof|schlackental": { a: "kehlhof", b: "schlackental", stance: "krieg", tension: 90, since: 1, raidsWon: {} } };
  const raiders = NPCS.filter(a => villageOf(a) === "schlackental").slice(0, 3);
  const defenders = NPCS.filter(a => villageOf(a) === "kehlhof");
  for (const a of NPCS) { s.body[a].energy = 9; s.body[a].hunger = 0; }
  s.war_actions = {};
  s.war_marches = {};
  for (const a of raiders) {
    s.agent_locations[a] = "Kehlhof:Zechenplatz";
    s.war_actions[a] = { kind: "raid", target: "kehlhof", tick: 10 };
    s.war_marches[a] = { target: "kehlhof", phase: "kampf", road: "r", departTick: 8, arriveTick: 10 };
  }
  for (const a of defenders) s.agent_locations[a] = "Kehlhof:Zechenplatz";
  const setup = B.captureRaidSetup(s, 10);
  eq(setup.length, 1, "one raid group captured");
  eq(setup[0].raiders, raiders, "raiders captured");
  eq(setup[0].defenders.sort(), [...defenders].sort(), "defenders captured (before wounds)");
  const events = WAR.resolveWar(s, 10, () => 0.5);
  const raids = B.buildRaids(setup, events);
  eq(raids.length, 1, "raid joined with its event");
  ok(raids[0].success === (events[0].success === true), "success flag taken from the event");
  eq(raids[0].attackerVillage, "schlackental", "attacker village");
  eq(raids[0].targetVillage, "kehlhof", "target village");
  // peace in between → no event → no bark raid
  const s2 = JSON.parse(JSON.stringify(s)); s2.diplomacy["kehlhof|schlackental"].stance = "frieden";
  s2.war_actions = {}; for (const a of raiders) s2.war_actions[a] = { kind: "raid", target: "kehlhof", tick: 10 };
  const setup2 = B.captureRaidSetup(s2, 10);
  eq(B.buildRaids(setup2, WAR.resolveWar(s2, 10, () => 0.5)).length, 0, "no event (peace) → no raid barks");
}

// ─── 6. theftsFromResults ────────────────────────────────────
section("theftsFromResults");
{
  const s = fresh(10);
  const [t1, v1] = NPCS.filter(a => villageOf(a) === "schlackental");
  s.agent_locations[t1!] = "Zechenplatz"; s.agent_locations[v1!] = "Zechenplatz";
  const name = W.getDisplayName(v1!);
  const res = [
    { agent: t1!, actions: [{ type: "steal", target: name, result: `X lässt Brot von ${name} unbemerkt mitgehen.` }] },
    { agent: t1!, actions: [{ type: "steal", target: v1!, result: `X wollte Brot von ${name} stehlen, wurde aber auf frischer Tat ertappt.` }] },
    { agent: t1!, actions: [{ type: "steal", target: v1!, result: "[Geht nicht] nix" }, { type: "speak", result: "ertappt" }] },
  ];
  const th = B.theftsFromResults(s, res, { [t1!]: "Backstube" });
  eq(th.length, 2, "two thefts recognised, failed steal ignored");
  eq(th.map((x: any) => x.caught), [false, true], "caught flag from result text");
  eq(th[0].victim, v1, "victim resolved");
  eq(th[0].location, "Backstube", "location = thief's location before the move");
}

// ─── 7. no leakage into memory/feedback ──────────────────────
section("isolation");
{
  const src = readFileSync(`${REPO}/src/barks.ts`, "utf-8");
  const imports = src.split("\n").filter(l => l.startsWith("import") || l.startsWith("} from"));
  ok(!imports.some(l => /memory|inventory|agent-runner|messages|perception/.test(l)), "barks.ts imports no memory/feedback/perception module");
  ok(!/feedbackToAgent|action_feedback|appendFileSync|writeFileSync/.test(src), "barks.ts never writes feedback or files");
}

// ─── 8. routes ───────────────────────────────────────────────
section("routes");
{
  const call = async (method: string, path: string, body?: unknown) => {
    const req: any = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    let status = 0; let payload: any = null;
    const res: any = { writeHead: (s: number) => { status = s; }, end: (d: string) => { payload = JSON.parse(d); } };
    const handled = await handleRegieRoute(req, res, path, {});
    return { handled, status, payload };
  };

  const statePath = join(DATA, "world_state.json");
  const backup = join(DATA, "world_state.json.bark-test-backup");
  copyFileSync(statePath, backup);
  try {
    const npc = NPCS[0]!;
    let r = await call("POST", `/api/agents/${npc}/bark`);
    ok(r.handled && r.status === 200 && r.payload.ok === true && r.payload.agent === npc, "200 for a living colonist");
    ok(typeof r.payload.text === "string" && r.payload.text && (BARK_KINDS as string[]).includes(r.payload.kind), "text + kind in response");

    r = await call("POST", "/api/agents/gibtsnicht/bark");
    ok(r.status === 404 && r.payload.error === "Unbekannter Kolonist: gibtsnicht", "404 unknown colonist");
    r = await call("POST", "/api/agents/player/bark");
    ok(r.status === 400 && r.payload.error === "Der Beobachter hat keine Sprüche.", "400 for the observer");

    const dead = JSON.parse(readFileSync(statePath, "utf-8"));
    dead.body[npc].starvation_ticks = 999;
    writeFileSync(statePath, JSON.stringify(dead));
    r = await call("POST", `/api/agents/${npc}/bark`);
    ok(r.status === 409 && r.payload.error === `${W.getDisplayName(npc)} sagt nichts mehr.`, `409 for a dead colonist (${r.payload?.error})`);
    copyFileSync(backup, statePath);

    // the bark route emits no SSE
    const seen: any[] = [];
    const on = (e: any) => seen.push(e);
    eventBus.on("agent:bark", on);
    await call("POST", `/api/agents/${npc}/bark`);
    eventBus.off("agent:bark", on);
    eq(seen.length, 0, "click bark route emits no agent:bark SSE");

    // level route
    const controls: any[] = [];
    const onc = (e: any) => controls.push(e);
    eventBus.on("sim:control", onc);
    r = await call("POST", "/api/sim/barks", { level: 2 });
    ok(r.status === 200 && r.payload.ok && r.payload.status.barkLevel === 2, "level 2 accepted, status.barkLevel = 2");
    ok(controls.some(c => c.barkLevel === 2), "sim:control SSE carries the new level");
    r = await call("POST", "/api/sim/barks", { level: 0 });
    ok(r.status === 200 && r.payload.status.barkLevel === 0, "level 0 accepted");
    eventBus.off("sim:control", onc);
    for (const bad of [{ level: 3 }, { level: "1" }, { level: null }, { level: 1.5 }, {}, { foo: 1 }]) {
      r = await call("POST", "/api/sim/barks", bad);
      ok(r.status === 400 && r.payload.error === "Feld „level“ muss 0, 1 oder 2 sein.", `400 for ${JSON.stringify(bad)}`);
    }
    r = await call("POST", "/api/sim/barks");
    ok(r.status === 400 && r.payload.error === "Feld „level“ muss 0, 1 oder 2 sein.", "400 without body");
    ok(B.getBarkLevel() === 0, "invalid requests keep the level");
    r = await call("POST", `/api/agents/${npc}/bark`);
    ok(r.status === 200, "click bark route works at level 0");
    r = await call("GET", "/api/sim");
    ok(r.payload.barkLevel === 0, "GET /api/sim reports barkLevel");
  } finally {
    copyFileSync(backup, statePath);
  }
}

console.warn = origWarn;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
