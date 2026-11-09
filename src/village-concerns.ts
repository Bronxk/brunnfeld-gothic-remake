import type { AgentName, WorldState } from "./types.js";
import { getAgentNames, getDisplayName, getVillages, getVillageElder } from "./world-registry.js";
import { isAgentDead } from "./body.js";

const _elderSet: Set<string> | null = null;
function getElderSet(): Set<string> {
  if (_elderSet) return _elderSet;
  return new Set(getVillages().map(v => getVillageElder(v.id)).filter(Boolean) as string[]);
}

const FOOD_ITEMS = new Set(["brot", "eintopf", "fleisch", "rueben", "eier", "milch"]);

export function computeVillageConcerns(state: WorldState, currentTick: number): string[] {
  const concerns: string[] = [];
  const alive = getAgentNames().filter(a => !isAgentDead(state.body[a]));

  // ── Broken tools ──────────────────────────────────────────
  const brokenTools = alive.filter(a => state.economics[a].tool?.durability === 0);
  if (brokenTools.length >= 2) {
    const names = brokenTools.map(a => getDisplayName(a)).join(", ");
    concerns.push(`[Sorge der Kolonie] ${brokenTools.length} Kolonisten haben kaputtes Werkzeug und können nichts herstellen: ${names}.`);
  }

  // ── Critical tools ────────────────────────────────────────
  const criticalTools = alive.filter(a => {
    const t = state.economics[a].tool;
    return t && t.durability > 0 && t.durability <= 20;
  });
  if (criticalTools.length >= 3) {
    concerns.push(`[Sorge der Kolonie] ${criticalTools.length} Kolonisten haben Werkzeug mit höchstens 20 % Zustand und müssen bald aufhören zu arbeiten.`);
  }

  // ── Hunger ───────────────────────────────────────────────
  const veryHungry = alive.filter(a => state.body[a].hunger >= 4);
  const hungry = alive.filter(a => state.body[a].hunger >= 3);
  if (veryHungry.length >= 2) {
    const names = veryHungry.map(a => getDisplayName(a)).slice(0, 5).join(", ");
    concerns.push(`[Sorge der Kolonie] ${veryHungry.length} Kolonisten hungern gefährlich und drohen zu verhungern: ${names}.`);
  } else if (hungry.length >= 3) {
    concerns.push(`[Sorge der Kolonie] ${hungry.length} Kolonisten haben Hunger.`);
  }

  // ── No food on market ────────────────────────────────────
  const foodOrders = state.marketplace.orders.filter(o => o.type === "sell" && FOOD_ITEMS.has(o.item) && o.quantity > 0);
  if (foodOrders.length === 0 && hungry.length >= 2) {
    concerns.push(`[Sorge der Kolonie] Auf dem Tauschbrett wird kein Essen angeboten — ${hungry.length} hungrige Kolonisten können nirgends kaufen.`);
  }

  // ── Poverty ──────────────────────────────────────────────
  const elders = getElderSet();
  const poor = alive.filter(a => !elders.has(a) && state.economics[a].wallet < 3);
  if (poor.length >= 3) {
    concerns.push(`[Sorge der Kolonie] ${poor.length} Kolonisten haben weniger als 3 Groschen und können sich das Nötigste nicht leisten.`);
  }

  // ── Wealth concentration ─────────────────────────────────
  const nonElder = alive.filter(a => !elders.has(a));
  const totalWealth = nonElder.reduce((s, a) => s + state.economics[a].wallet, 0);
  if (totalWealth > 30 && nonElder.length > 0) {
    const richest = [...nonElder].sort((a, b) => state.economics[b].wallet - state.economics[a].wallet)[0]!;
    const richestWallet = state.economics[richest].wallet;
    const pct = Math.round((richestWallet / totalWealth) * 100);
    if (pct >= 30) {
      concerns.push(`[Sorge der Kolonie] ${getDisplayName(richest)} besitzt ${pct} % aller Groschen der Kolonie (${richestWallet} von ${totalWealth} Groschen).`);
    }
  }

  // ── Theft incidents ──────────────────────────────────────
  const recentThefts = (state.violations_log ?? [])
    .filter(v => v.lawId === "theft" && currentTick - v.tick <= 32);
  if (recentThefts.length > 0) {
    const theftLines = recentThefts.slice(-3).map(v =>
      `${getDisplayName(v.agent)}: ${v.action}`
    ).join("; ");
    concerns.push(`[Sorge der Kolonie] Diebstahl gemeldet: ${theftLines}. Erwäge, Befugnisse zum Strafen und Beschlagnahmen zu vergeben oder einen Appell einzuberufen.`);
  }

  // ── Recent petitions (past 1 in-game day = 16 ticks) ────
  const recentPetitions = (state.pending_petitions ?? []).filter(p => currentTick - p.tick <= 16);
  for (const p of recentPetitions) {
    concerns.push(`[Gesuch] ${getDisplayName(p.agent)}: „${p.topic}"`);
  }

  return concerns;
}
