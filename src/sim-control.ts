/**
 * In-memory controller for the simulation tick loop (pause / step / budget / speed).
 *
 * The loop in engine.ts `runSimulation` calls `await gateBeforeTick(tick)` before every tick.
 * Every state change emits the SSE event `sim:control` with the status from getSimControl().
 * Env SIM_START_PAUSED=true starts the simulation paused.
 */

import { emitSSE, eventBus } from "./events.js";
import { clearPendingRoleSync } from "./world-registry.js";

export interface SimControlStatus {
  paused: boolean;
  /** Remaining ticks before the auto-pause, null = unlimited. */
  budget: number | null;
  tickDelayMs: number;
  pausedReason?: string;
  /** Fresh world: the loop has not started yet; resume/step start it. */
  awaitingStart?: boolean;
}

/** True while index.ts waits for "sim:start" before the very first tick. */
let awaitingStart = false;

export function setAwaitingStart(value: boolean): void {
  awaitingStart = value;
  emit();
}

/** Fires "sim:start" once if the loop is still waiting for it (same as POST /api/start). */
function startIfWaiting(): void {
  if (!awaitingStart) return;
  awaitingStart = false;
  eventBus.emit("sim:start");
}

const MAX_DELAY_MS = 600_000;

let paused = process.env.SIM_START_PAUSED === "true";
let pausedReason: string | undefined = paused ? "Simulation pausiert gestartet." : undefined;
let budget: number | null = null;
let tickDelayMs = 0;
let stepRequested = false;
let ticksGated = 0;
/** Resolvers of gateBeforeTick calls currently waiting for resume/step. */
let waiters: (() => void)[] = [];

function wake(): void {
  const w = waiters;
  waiters = [];
  for (const resolve of w) resolve();
}

function emit(): void {
  emitSSE("sim:control", getSimControl());
}

export function getSimControl(): SimControlStatus {
  if (awaitingStart) {
    return { paused: true, budget, tickDelayMs, pausedReason: "Wartet auf den Start.", awaitingStart: true };
  }
  const status: SimControlStatus = { paused, budget, tickDelayMs };
  if (paused && pausedReason) status.pausedReason = pausedReason;
  return status;
}

export function pauseSim(reason?: string): void {
  paused = true;
  pausedReason = reason ?? "Vom Beobachter pausiert.";
  cutDelayShort?.(); // a pause during the delay must hold the next tick right away
  emit();
}

export function resumeSim(): void {
  paused = false;
  pausedReason = undefined;
  stepRequested = false;
  if (budget === 0) budget = null; // resuming after an exhausted budget means "no cap" until a new one is set
  startIfWaiting();
  wake();
  emit();
}

/** Run exactly one tick while paused (no effect on a running simulation). */
export function requestStep(): void {
  if (awaitingStart) {
    // Start the loop held: exactly the first tick runs, then it waits for the observer.
    paused = true;
    pausedReason = "Vom Beobachter pausiert.";
    stepRequested = true;
    startIfWaiting();
    emit();
    return;
  }
  if (!paused) return;
  stepRequested = true;
  wake();
  emit();
}

/** Auto-pause after `ticks` more ticks; null = unlimited. Rejects negative / non-integer values. */
export function setBudget(ticks: number | null): void {
  if (ticks !== null && (typeof ticks !== "number" || !Number.isInteger(ticks) || ticks < 0)) {
    throw new Error("Ungültiges Tick-Budget: erwartet eine ganze Zahl ab 0 oder null.");
  }
  budget = ticks;
  if (ticks === 0) {
    paused = true;
    pausedReason = "Tick-Budget aufgebraucht";
  } else if (ticks !== null && paused && pausedReason === "Tick-Budget aufgebraucht") {
    // A fresh budget after an exhausted one resumes the simulation.
    paused = false;
    pausedReason = undefined;
    wake();
  }
  emit();
}

/** Delay between ticks in ms, clamped to 0..600000. */
export function setTickDelay(ms: number): void {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    throw new Error("Ungültige Tick-Pause: erwartet eine Zahl in Millisekunden.");
  }
  tickDelayMs = Math.min(MAX_DELAY_MS, Math.max(0, Math.round(ms)));
  cutDelayShort?.(); // a changed speed takes effect now instead of after a possibly 10-minute wait
  emit();
}

/** Ends the inter-tick delay that is currently being awaited (if any) early. */
let cutDelayShort: (() => void) | null = null;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      cutDelayShort = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    cutDelayShort = done;
  });
}

/**
 * Await before running a tick: applies the tick delay, blocks while paused (unless a step was
 * requested), and counts the budget down (auto-pausing after the last budgeted tick).
 */
export async function gateBeforeTick(_tick: number): Promise<void> {
  // The delay separates ticks, so it is skipped before the very first one.
  if (ticksGated > 0 && tickDelayMs > 0 && !paused) await delay(tickDelayMs);
  ticksGated++;

  let stepped = false;
  while (paused && !stepRequested) {
    await new Promise<void>(resolve => waiters.push(resolve));
  }
  if (paused && stepRequested) {
    stepRequested = false;
    stepped = true;
  }

  // From here on the tick reads role changes from disk; stop re-applying them.
  clearPendingRoleSync();

  if (!stepped && budget !== null) {
    budget = Math.max(0, budget - 1);
    if (budget === 0) {
      paused = true;
      pausedReason = "Tick-Budget aufgebraucht";
      emit();
      return; // this was the last budgeted tick; the next gate blocks
    }
    emit();
  } else if (stepped) {
    emit();
  }
}
