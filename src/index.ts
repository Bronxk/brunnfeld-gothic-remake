import "dotenv/config";
import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, unlinkSync, copyFileSync, mkdirSync,
} from "fs";
import { join } from "path";
import { readWorldState } from "./memory.js";
import { runSimulation } from "./engine.js";
import type { WorldState } from "./types.js";
import { ALL_ITEMS } from "./types.js";
import { PRISON_LOCATION, TOWNHALL_LOCATION, ELDER_HOME_LOCATION } from "./village-map.js";
import { eventBus } from "./events.js";
import { setAwaitingStart } from "./sim-control.js";
import { llmBackendLabel } from "./llm.js";

const DATA_DIR = join(process.cwd(), "data");
const INITIAL_MEMORIES_DIR = join(DATA_DIR, "memory_initial");

// ─── Initial World State ─────────────────────────────────────

function initWorldState(): WorldState {
  return {
    current_tick: 0,
    current_time: "Simulation nicht gestartet",
    season: "spring",
    day_of_season: 1,
    weather: "Mild, 12 °C, teils bewölkt",
    active_events: [],

    agent_locations: {
      brakel: "Baracke 1", rike: "Baracke 2", ottmar: "Ziegenweide",
      wenzel: "Baracke 4", kasper: "Baracke 5", irmel: "Mühle",
      bodo: "Backstube", eckhart: "Schmiede", lenz: "Zimmerei",
      grete: "Schenke", walburga: "Baderhütte", jost: "Baracke 7",
      reinhart: "Vogtshaus", bruder_anno: "Vogtei",
      mattis: "Baracke 8", vroni: "Baracke 8", wendel: "Baracke 1", minna: "Flickstube", gisbert: "Baracke 3",
    },

    body: {
      brakel:      { hunger: 1, energy: 9, sleep_quality: "good" },
      rike:        { hunger: 1, energy: 8, sleep_quality: "fair" },
      ottmar:      { hunger: 2, energy: 8, sleep_quality: "good" },
      wenzel:      { hunger: 1, energy: 9, sleep_quality: "good" },
      kasper:      { hunger: 2, energy: 7, sleep_quality: "fair" },
      irmel:       { hunger: 1, energy: 9, sleep_quality: "good" },
      bodo:        { hunger: 0, energy: 8, sleep_quality: "good" },
      eckhart:     { hunger: 2, energy: 9, sleep_quality: "good" },
      lenz:        { hunger: 1, energy: 8, sleep_quality: "fair" },
      grete:       { hunger: 1, energy: 7, sleep_quality: "fair" },
      walburga:    { hunger: 1, energy: 9, sleep_quality: "good" },
      jost:        { hunger: 2, energy: 9, sleep_quality: "good" },
      reinhart:    { hunger: 1, energy: 7, sleep_quality: "fair" },
      bruder_anno: { hunger: 1, energy: 8, sleep_quality: "good" },
      mattis:      { hunger: 2, energy: 8, sleep_quality: "fair" },
      vroni:       { hunger: 1, energy: 8, sleep_quality: "good" },
      wendel:      { hunger: 1, energy: 9, sleep_quality: "good" },
      minna:       { hunger: 1, energy: 8, sleep_quality: "fair" },
      gisbert:     { hunger: 2, energy: 9, sleep_quality: "good" },
    },

    economics: {
      brakel:      { wallet: 30, inventory: { items: [{ type: "gerste", quantity: 8 }] }, tool: { type: "werkzeug", durability: 80 }, skill: "bauer", homeLocation: "Baracke 1", workLocation: "Unterfeld", workSchedule: { open: 6, close: 16 } },
      rike:        { wallet: 12, inventory: { items: [{ type: "leinen", quantity: 2 }] }, tool: null, skill: "none", homeLocation: "Baracke 2", workLocation: "Baracke 2", workSchedule: { open: 6, close: 21 } },
      ottmar:      { wallet: 40, inventory: { items: [{ type: "milch", quantity: 3 }, { type: "fleisch", quantity: 2 }] }, tool: { type: "werkzeug", durability: 90 }, skill: "hirte", homeLocation: "Ziegenweide", workLocation: "Ziegenweide", workSchedule: { open: 6, close: 15 } },
      wenzel:      { wallet: 20, inventory: { items: [{ type: "rueben", quantity: 4 }] }, tool: { type: "werkzeug", durability: 70 }, skill: "bauer", homeLocation: "Baracke 4", workLocation: "Oberfeld", workSchedule: { open: 6, close: 16 } },
      kasper:      { wallet: 15, inventory: { items: [{ type: "gerste", quantity: 5 }] }, tool: { type: "werkzeug", durability: 60 }, skill: "bauer", homeLocation: "Baracke 5", workLocation: "Unterfeld", workSchedule: { open: 6, close: 16 } },
      irmel:       { wallet: 45, inventory: { items: [{ type: "mehl", quantity: 4 }] }, tool: null, skill: "mueller", homeLocation: "Mühle", workLocation: "Mühle", workSchedule: { open: 7, close: 16 } },
      bodo:        { wallet: 32, inventory: { items: [{ type: "brot", quantity: 6 }, { type: "mehl", quantity: 2 }] }, tool: null, skill: "baecker", homeLocation: "Backstube", workLocation: "Backstube", workSchedule: { open: 6, close: 13 } },
      eckhart:     { wallet: 60, inventory: { items: [{ type: "eisenerz", quantity: 4 }, { type: "kohle", quantity: 3 }] }, tool: null, skill: "schmied", homeLocation: "Schmiede", workLocation: "Schmiede", workSchedule: { open: 7, close: 16 } },
      lenz:        { wallet: 35, inventory: { items: [{ type: "bauholz", quantity: 5 }] }, tool: { type: "werkzeug", durability: 75 }, skill: "zimmermann", homeLocation: "Zimmerei", workLocation: "Zimmerei", workSchedule: { open: 7, close: 16 } },
      grete:       { wallet: 55, inventory: { items: [{ type: "bier", quantity: 6 }, { type: "gerste", quantity: 4 }] }, tool: null, skill: "wirt", homeLocation: "Schenke", workLocation: "Schenke", workSchedule: { open: 10, close: 21 } },
      walburga:    { wallet: 28, inventory: { items: [{ type: "kraeuter", quantity: 5 }, { type: "arznei", quantity: 2 }] }, tool: null, skill: "bader", homeLocation: "Baderhütte", workLocation: "Baderhütte", workSchedule: { open: 7, close: 17 } },
      jost:        { wallet: 22, inventory: { items: [{ type: "bauholz", quantity: 3 }, { type: "brennholz", quantity: 6 }] }, tool: { type: "werkzeug", durability: 85 }, skill: "holzfaeller", homeLocation: "Baracke 7", workLocation: "Köhlerwald", workSchedule: { open: 6, close: 17 } },
      reinhart:    { wallet: 120, inventory: { items: [] }, tool: null, skill: "none", homeLocation: "Vogtshaus", workLocation: "Vogtshaus", workSchedule: { open: 6, close: 21 } },
      bruder_anno: { wallet: 25, inventory: { items: [] }, tool: null, skill: "none", homeLocation: "Vogtei", workLocation: "Vogtei", workSchedule: { open: 6, close: 21 } },
      mattis:      { wallet: 18, inventory: { items: [{ type: "eisenerz", quantity: 2 }, { type: "kohle", quantity: 1 }] }, tool: { type: "werkzeug", durability: 65 }, skill: "knappe", homeLocation: "Baracke 8", workLocation: "Erzstollen", workSchedule: { open: 7, close: 17 } },
      vroni:       { wallet: 10, inventory: { items: [{ type: "brot", quantity: 2 }] }, tool: null, skill: "none", homeLocation: "Baracke 8", workLocation: "Zechenplatz", workSchedule: { open: 6, close: 21 } },
      wendel:      { wallet: 25, inventory: { items: [{ type: "gerste", quantity: 6 }, { type: "eier", quantity: 3 }] }, tool: { type: "werkzeug", durability: 55 }, skill: "bauer", homeLocation: "Baracke 1", workLocation: "Unterfeld", workSchedule: { open: 6, close: 16 } },
      minna:       { wallet: 30, inventory: { items: [{ type: "leinen", quantity: 3 }] }, tool: null, skill: "naeherin", homeLocation: "Flickstube", workLocation: "Flickstube", workSchedule: { open: 7, close: 16 } },
      gisbert:     { wallet: 20, inventory: { items: [{ type: "eisenerz", quantity: 3 }, { type: "kohle", quantity: 2 }] }, tool: { type: "werkzeug", durability: 80 }, skill: "knappe", homeLocation: "Baracke 3", workLocation: "Erzstollen", workSchedule: { open: 7, close: 17 } },
    },

    marketplace: {
      orders: [],
      history: [],
      priceIndex: {
        gerste: 2, mehl: 5, brot: 3, fleisch: 8, milch: 2,
        werkzeug: 15, kohle: 3, eisenerz: 4, bauholz: 3, brennholz: 2,
        kraeuter: 1, arznei: 10, bier: 3, eintopf: 6, leinen: 5,
        hausrat: 12, eier: 1, rueben: 2,
      },
      priceHistory: Object.fromEntries(ALL_ITEMS.map(i => [i, []])) as Record<string, []>,
    },

    doors: {
      "Baracke 1": "unlocked", "Baracke 2": "unlocked", "Baracke 3": "unlocked",
      "Baracke 4": "unlocked", "Baracke 5": "unlocked", "Baracke 6": "unlocked",
      "Baracke 7": "unlocked", "Baracke 8": "unlocked", "Baracke 9": "unlocked",
      "Flickstube": "unlocked", "Baderhütte": "unlocked",
      "Backstube": "unlocked", "Schenke": "unlocked", "Schmiede": "unlocked",
      "Zimmerei": "unlocked", "Mühle": "unlocked",
      [TOWNHALL_LOCATION]: "unlocked", [PRISON_LOCATION]: "unlocked",
      [ELDER_HOME_LOCATION]: "unlocked",
      "Unterfeld": "unlocked", "Ziegenweide": "unlocked", "Oberfeld": "unlocked",
    },

    message_queue: {
      brakel: [], rike: [], ottmar: [], wenzel: [], kasper: [],
      irmel: [], bodo: [], eckhart: [], lenz: [],
      grete: [], walburga: [], jost: [],
      reinhart: [], bruder_anno: [],
      mattis: [], vroni: [], wendel: [], minna: [], gisbert: [],
    },

    objects: [],
    action_feedback: {
      brakel: [], rike: [], ottmar: [], wenzel: [], kasper: [],
      irmel: [], bodo: [], eckhart: [], lenz: [],
      grete: [], walburga: [], jost: [],
      reinhart: [], bruder_anno: [],
      mattis: [], vroni: [], wendel: [], minna: [], gisbert: [],
    },

    acquaintances: {
      brakel: ["wendel"],    // bunkmates
      rike: [],
      ottmar: [],
      wenzel: [],
      kasper: [],
      irmel: ["bodo"],       // miller + baker working relationship
      bodo: ["irmel"],
      eckhart: ["lenz"],     // forge + carpenter side by side
      lenz: ["eckhart"],
      grete: ["reinhart", "bruder_anno"],   // tavern keeper knows community leaders
      walburga: [],
      jost: ["gisbert"],     // woodsy type + old miner
      reinhart: ["bruder_anno", "grete"],
      bruder_anno: ["reinhart"],
      mattis: ["gisbert"],   // mine workers
      vroni: ["mattis"],     // bunkmates
      wendel: ["brakel"],    // bunkmates
      minna: [],
      gisbert: ["mattis", "jost"],
    },

    economy_snapshots: [],
    total_tax_collected: 0,
    production_log: [],
    loans: [],
    caughtStealing: {},
    violations_log: [],
    // Governance
    pending_meetings: {},
    active_laws: [],
    banned: {},
    tax_rate: 0.10,
  };
}

// ─── Reset ────────────────────────────────────────────────────

function resetSimulation(): void {
  console.log("Resetting Schlackental to initial state...\n");

  // Restore initial memories — clear first so stale files from old worlds don't linger
  if (existsSync(INITIAL_MEMORIES_DIR)) {
    const memDir = join(DATA_DIR, "memory");
    mkdirSync(memDir, { recursive: true });
    // Delete all existing memory files
    for (const file of readdirSync(memDir)) {
      if (file.endsWith(".md")) unlinkSync(join(memDir, file));
    }
    // Restore blank stubs
    for (const file of readdirSync(INITIAL_MEMORIES_DIR)) {
      copyFileSync(join(INITIAL_MEMORIES_DIR, file), join(memDir, file));
    }
    console.log("  Restored initial memory files.");
  }

  writeFileSync(join(DATA_DIR, "world_state.json"), JSON.stringify(initWorldState(), null, 2));
  console.log("  Reset world state.");

  // Clear logs
  const logsDir = join(DATA_DIR, "logs");
  if (existsSync(logsDir)) {
    for (const file of readdirSync(logsDir)) {
      if (file.endsWith(".json")) unlinkSync(join(logsDir, file));
    }
    console.log("  Cleared tick logs.");
  }

  console.log("\nReset complete. Run `npm start` to begin.\n");
}

// ─── Backup initial memories ──────────────────────────────────

function backupInitialMemories(): void {
  if (existsSync(INITIAL_MEMORIES_DIR)) return;
  mkdirSync(INITIAL_MEMORIES_DIR, { recursive: true });
  const memDir = join(DATA_DIR, "memory");
  for (const file of readdirSync(memDir)) {
    if (file.endsWith(".md")) copyFileSync(join(memDir, file), join(INITIAL_MEMORIES_DIR, file));
  }
}

// ─── Viewer (in-process server so SSE events are shared) ─────

/** Starts the viewer server when the viewer is checked out; returns whether it runs. */
async function startViewer(): Promise<boolean> {
  const viewerPkg = join(process.cwd(), "viewer", "package.json");
  if (!existsSync(viewerPkg)) return false;
  // Import server so it starts in the same process as the engine,
  // sharing the eventBus for live SSE streaming.
  await import("./server.js");
  return true;
}

// ─── Graceful shutdown ────────────────────────────────────────

function setupShutdown(): void {
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n\nShutting down. Resume with: npm run resume");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ─── First run: write initial state if none exists ────────────

function ensureInitialState(): void {
  const statePath = join(DATA_DIR, "world_state.json");
  if (!existsSync(statePath)) {
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(join(DATA_DIR, "memory"), { recursive: true });
    mkdirSync(join(DATA_DIR, "profiles"), { recursive: true });
    writeFileSync(statePath, JSON.stringify(initWorldState(), null, 2));
    console.log("  Created initial world state.");
  }
}

// ─── CLI ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--reset")) {
    resetSimulation();
    return;
  }

  setupShutdown();
  console.log(`  LLM backend: ${llmBackendLabel()}`);
  ensureInitialState();
  backupInitialMemories();

  const viewerRunning = await startViewer();

  if (args.includes("--resume")) {
    const state = readWorldState();
    console.log(`Resuming from tick ${state.current_tick + 1}...`);
    await runSimulation(state.current_tick + 1);
    return;
  }

  if (args.includes("--tick-once")) {
    const state = readWorldState();
    await runSimulation(state.current_tick + 1, true);
    return;
  }

  const fromIdx = args.indexOf("--from");
  if (fromIdx >= 0 && args[fromIdx + 1]) {
    await runSimulation(parseInt(args[fromIdx + 1]!));
    return;
  }

  const state = readWorldState();
  if (state.current_tick > 0) {
    console.log(`Simulation in progress (tick ${state.current_tick}).`);
    if (!viewerRunning) {
      console.log("Use --resume to continue or --reset to start over.");
      return;
    }
    // With the viewer, a saved world waits like a fresh one: "Starten" in the Regie tab continues it.
    console.log("  Press Starten in the viewer to continue (or run with --resume / --reset).");
  } else {
    console.log("  Waiting for world configuration… Open http://localhost:3333");
  }
  setAwaitingStart(true);
  await new Promise<void>(resolve => eventBus.once("sim:start", resolve));
  setAwaitingStart(false);

  await runSimulation();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
