// Pool lint: `npm run test:barks`. Counts, duplicates, word limit, placeholders, blocklist.
import { BARK_POOL } from "../src/barks-pool.ts";
import { BARK_KINDS, BARK_ROLES } from "../src/barks-types.ts";

const errors: string[] = [];
const warnings: string[] = [];
const pool = BARK_POOL as Record<string, Record<string, readonly string[]>>;

const CRAFTS = ["bauer", "hirte", "knappe", "holzfaeller", "mueller", "baecker", "schmied", "zimmermann", "wirt", "bader", "haendler", "naeherin"];
const GEGNER_KINDS = new Set(["fremder", "spannung", "krieg_marsch", "krieg_angriff", "krieg_verteidigung", "krieg_sieg", "krieg_niederlage"]);
const BLOCK = [
  "altes lager", "neues lager", "sumpflager", "buddler", "schürfer", "schatten", "gardist", "erzbaron", "sumpfkraut",
  "barriere", "schläfer", "magier", "templer", "söldner", "novize", "bandit", "ork", "khorinis", "minental", "innos",
  "beliar", "adanos", "myrtana", "xardas", "gomez", "diego",
  "hey, du bist neu hier", "mach, dass du wegkommst", "ich kenne dich nicht",
];
const CONTENT_BLOCK = ["krüppel", "missgeburt", "hurensohn", "hure", "weibsbild", "zigeuner", "schwul", "spast", "behindert", "nazi"];

const minRole = (kind: string, roles: string[], n: number) => {
  for (const r of roles) {
    const len = pool[kind]?.[r]?.length ?? 0;
    if (len < n) errors.push(`${kind}.${r}: ${len} lines, need >= ${n}`);
  }
};

for (const k of Object.keys(pool)) if (!(BARK_KINDS as readonly string[]).includes(k)) errors.push(`unknown kind key: ${k}`);

const seen = new Map<string, string>();
let total = 0;
const counts: string[] = [];
for (const kind of BARK_KINDS) {
  const entry = pool[kind];
  if (!entry) { errors.push(`missing kind: ${kind}`); continue; }
  if ((entry.any?.length ?? 0) < 8) errors.push(`${kind}.any: ${entry.any?.length ?? 0} lines, need >= 8`);
  let kindTotal = 0;
  let withPh = 0;
  for (const [role, lines] of Object.entries(entry)) {
    if (!(BARK_ROLES as readonly string[]).includes(role)) errors.push(`${kind}: unknown role key ${role}`);
    for (const raw of lines) {
      kindTotal++;
      const where = `${kind}.${role}: "${raw}"`;
      const line = raw.trim();
      if (!line) { errors.push(`empty line in ${kind}.${role}`); continue; }
      const key = line.toLowerCase();
      if (seen.has(key)) errors.push(`duplicate: ${where} (also ${seen.get(key)})`);
      else seen.set(key, `${kind}.${role}`);
      const words = line.split(/\s+/).filter(Boolean).length;
      if (words > 12) errors.push(`too long (${words} words): ${where}`);
      const phs = line.match(/\{[^}]*\}/g) ?? [];
      if (phs.length) withPh++;
      for (const ph of phs) {
        if (ph !== "{dorf}" && ph !== "{gegner}") errors.push(`unknown placeholder ${ph}: ${where}`);
        if (ph === "{gegner}" && !GEGNER_KINDS.has(kind)) errors.push(`{gegner} not allowed in ${kind}: ${where}`);
      }
      if (/[{}]/.test(line.replace(/\{(dorf|gegner)\}/g, ""))) errors.push(`stray brace: ${where}`);
      for (const b of BLOCK) if (key.includes(b)) errors.push(`blocklist term "${b}": ${where}`);
      for (const b of CONTENT_BLOCK) if (key.includes(b)) errors.push(`content-limit term "${b}": ${where}`);
    }
  }
  const share = kindTotal ? withPh / kindTotal : 0;
  if (share > 0.4) errors.push(`${kind}: placeholder share ${(share * 100).toFixed(0)}% > 40%`);
  else if (share > 1 / 3 + 1e-9) warnings.push(`${kind}: placeholder share ${(share * 100).toFixed(0)}% > 1/3`);
  total += kindTotal;
  counts.push(`${kind}=${kindTotal}`);
}

minRole("arbeit", [...CRAFTS, "rottmeister", "vogt"], 3);
minRole("markt", ["haendler", "wirt", "baecker"], 3);
for (const k of ["gruss", "abweisen"]) minRole(k, ["vogt", "rottmeister", "wirt", "bader", "knappe", "schmied"], 3);
for (const k of BARK_KINDS.filter((k) => k.startsWith("krieg_"))) minRole(k, ["rottmeister", "vogt"], 3);
// karzer means "I am locked up", so the Vogt has no karzer lines; his Karzer threats live in abweisen.
minRole("appell", ["vogt"], 3);

console.log(counts.join(" "));
console.log(`total=${total}`);
if (total < 300 || total > 380) warnings.push(`total ${total} outside 300-380`);
for (const w of warnings) console.warn(`WARN ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  console.error(`${errors.length} error(s)`);
  process.exit(1);
}
console.log("bark pool lint: OK");
