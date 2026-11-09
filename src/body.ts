import type { AgentName, BodyState, ItemType, SimTime, WorldState } from "./types.js";
import { ITEM_LABELS } from "./types.js";
import { getAgentNames, getDisplayName } from "./world-registry.js";
import { getInventoryQty, removeFromInventory, feedbackToAgent } from "./inventory.js";

// How much each food item reduces hunger
export const SATIATION: Partial<Record<ItemType, number>> = {
  brot:       2,
  eintopf:    3,
  fleisch:    2,
  rueben:     1,
  eier:       1,
  milch:      1,
  bier:       0,  // thirst only, no hunger reduction
};

export function updateBodyState(state: BodyState, time: SimTime): void {
  // Hunger increases every 4 hours
  if (time.hour % 4 === 0) {
    state.hunger = Math.min(5, state.hunger + 1);
  }

  // Energy decreases in the afternoon/evening
  if (time.hour >= 14) {
    state.energy = Math.max(0, Math.round((state.energy - 0.5) * 10) / 10);
  }

  // Sickness slowly heals if ≥ 1 (1 point per day)
  if (time.isFirstTickOfDay && state.sickness && state.sickness > 0) {
    state.sickness = Math.max(0, state.sickness - 1);
  }

  // Injury heals slowly too
  if (time.isFirstTickOfDay && state.injury && state.injury > 0) {
    state.injury = Math.max(0, state.injury - 1);
  }

  // Reset at dawn
  if (time.isFirstTickOfDay) {
    const roll = Math.random();
    const sick = state.sickness ?? 0;
    // Sickness degrades sleep quality
    if (sick >= 2) {
      state.sleep_quality = "poor";
      state.energy = 4;
    } else {
      state.sleep_quality = roll < 0.5 ? "good" : roll < 0.85 ? "fair" : "poor";
      state.energy = state.sleep_quality === "good" ? 9 : state.sleep_quality === "fair" ? 7 : 5;
    }
    state.hunger = Math.max(0, state.hunger - 1);  // slight overnight reduction
  }
}

// Called from tools.ts when agent uses eat action
export function resolveEat(
  agent: AgentName,
  item: ItemType,
  quantity: number,
  state: WorldState,
): string {
  const eco = state.economics[agent];
  const available = getInventoryQty(eco.inventory, item);
  const total = eco.inventory.items.find(i => i.type === item)?.quantity ?? 0;
  const reserved = total - available;

  const label = ITEM_LABELS[item] ?? item;

  if (available < quantity) {
    if (reserved > 0 && total >= quantity) {
      return `[Nicht essbar] Dein ${label} ist in einem Verkaufsangebot reserviert (${reserved} reserviert, ${available} frei). Zieh das Angebot erst mit cancel_order zurück, dann iss.`;
    }
    return `[Nicht essbar] Du hast nur ${available} ${label}.`;
  }

  const satiation = SATIATION[item];
  if (satiation === undefined) {
    const PROCESSING_HINTS: Partial<Record<ItemType, string>> = {
      gerste: "Gerste muss in der Mühle zu Mehl gemahlen und in der Backstube zu Brot gebacken werden. Kauf lieber Brot.",
      mehl: "Mehl muss in der Backstube zu Brot gebacken werden, bevor man es essen kann. Kauf lieber Brot.",
      eisenerz: "Eisenerz ist kein Essen.",
      kohle: "Kohle ist kein Essen.",
      bauholz: "Bauholz ist kein Essen.",
      brennholz: "Brennholz ist kein Essen.",
      werkzeug: "Werkzeug ist kein Essen.",
      leinen: "Leinen ist kein Essen.",
      hausrat: "Hausrat ist kein Essen.",
      kraeuter: "Kräuter sind nicht direkt essbar — sie müssen zu Arznei verarbeitet werden.",
    };
    const hint = PROCESSING_HINTS[item];
    return hint ? `[Nicht essbar] ${hint}` : `[Nicht essbar] ${label} ist nicht essbar.`;
  }

  removeFromInventory(eco.inventory, item, quantity);
  state.body[agent].hunger = Math.max(0, state.body[agent].hunger - satiation * quantity);

  const h = state.body[agent].hunger;
  const hungerDesc = h === 0 ? "satt" : h <= 1 ? "zufrieden" : h <= 2 ? "leicht hungrig" : h <= 3 ? "hungrig" : "sehr hungrig";
  return `Du hast ${quantity} ${label} gegessen. Hunger: ${h}/5 — ${hungerDesc}.`;
}

// Dawn auto-eat: if starving and has food, consume cheapest item
export function applyDawnAutoEat(state: WorldState): void {
  for (const agent of getAgentNames()) {
    const body = state.body[agent];
    if (body.hunger < 4) continue;

    const eco = state.economics[agent];
    const edibles = eco.inventory.items
      .filter(i => {
        const sat = SATIATION[i.type];
        return sat !== undefined && sat > 0 && (i.quantity - (i.reserved ?? 0)) > 0;
      })
      .sort((a, b) => (state.marketplace.priceIndex[a.type] ?? 99) - (state.marketplace.priceIndex[b.type] ?? 99));

    if (edibles.length === 0) continue;

    const food = edibles[0]!;
    removeFromInventory(eco.inventory, food.type, 1);
    body.hunger = Math.max(0, body.hunger - (SATIATION[food.type] ?? 1));
  }
}

// Starvation: hunger === 5 for 3+ consecutive ticks → death (remove from sim)
export function checkStarvation(state: WorldState, time: SimTime): void {
  for (const agent of getAgentNames()) {
    const body = state.body[agent];
    if (isAgentDead(body)) continue;
    if (body.hunger < 5) {
      body.starvation_ticks = 0;
      continue;
    }
    body.starvation_ticks = (body.starvation_ticks ?? 0) + 1;
    if (body.starvation_ticks >= 3) {
      feedbackToAgent(agent, state, `${getDisplayName(agent)} ist verhungert.`);
      console.log(`  ☠  ${agent} starved to death at tick ${time.tick}.`);
      // Move to a "dead" state by pinning hunger and removing from active logic
      // (Engine will skip agents with hunger >= 5 for 3+ ticks from LLM calls)
      body.starvation_ticks = 999;  // permanent death marker
    }
  }
}

export function isAgentDead(body: BodyState): boolean {
  return (body.starvation_ticks ?? 0) >= 999;
}

export function bodyPerception(body: BodyState): string {
  const parts: string[] = [];

  if (body.hunger >= 4) parts.push("Du hast großen Hunger.");
  else if (body.hunger >= 2) parts.push("Du hast Hunger.");

  if (body.energy <= 3) parts.push("Du bist erschöpft.");
  else if (body.energy <= 5) parts.push("Du bist müde.");

  if (body.sleep_quality === "poor") parts.push("Du hast schlecht geschlafen.");

  const sickness = body.sickness ?? 0;
  if (sickness >= 2) parts.push("Du bist schwer krank.");
  else if (sickness === 1) parts.push("Dir ist nicht wohl.");

  const injury = body.injury ?? 0;
  if (injury >= 2) parts.push("Du bist schwer verletzt.");
  else if (injury === 1) parts.push("Du bist leicht verletzt.");

  return parts.length > 0 ? `(${parts.join(" ")})` : "";
}
