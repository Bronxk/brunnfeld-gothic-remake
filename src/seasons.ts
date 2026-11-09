import type { AgentName, ItemType, Season, WorldState } from "./types.js";
import { getAgentNames } from "./world-registry.js";
import { getInventoryQty, removeFromInventory, feedbackToAgent } from "./inventory.js";

export const SEASON_MULTIPLIERS: Record<ItemType, Record<Season, number>> = {
  // ─── Field / animal — strongly seasonal ──────────────────
  gerste:     { spring: 1.2, summer: 1.5, autumn: 1.0, winter: 0.0 },
  rueben:     { spring: 1.2, summer: 1.5, autumn: 1.0, winter: 0.0 },
  kraeuter:   { spring: 1.5, summer: 1.2, autumn: 0.8, winter: 0.0 },
  eier:       { spring: 1.5, summer: 1.0, autumn: 0.8, winter: 0.5 },
  milch:      { spring: 1.2, summer: 1.0, autumn: 0.8, winter: 0.6 },
  fleisch:    { spring: 1.0, summer: 1.0, autumn: 1.2, winter: 0.8 },
  // ─── Forest / mine — mildly seasonal ─────────────────────
  bauholz:    { spring: 1.0, summer: 1.0, autumn: 1.2, winter: 0.8 },
  brennholz:  { spring: 0.8, summer: 0.8, autumn: 1.2, winter: 1.5 },
  eisenerz:   { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 0.8 },
  kohle:      { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.2 },
  // ─── Processed / indoor — unaffected ─────────────────────
  mehl:       { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  brot:       { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  werkzeug:   { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  hausrat:    { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  arznei:     { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
  leinen:     { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.2 },
  bier:       { spring: 1.0, summer: 1.2, autumn: 1.5, winter: 1.0 },
  eintopf:    { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.0 },
};

export function getSeasonMultiplier(item: ItemType, season: Season): number {
  return SEASON_MULTIPLIERS[item]?.[season] ?? 1.0;
}

// Called at dawn when first tick of a new season — logs a weather/season update
export function getSeasonDescription(season: Season): string {
  switch (season) {
    case "spring": return "Spring has arrived. Fields are ready. Animal produce is plentiful.";
    case "summer": return "Summer is here. Crops grow at peak rate. Hot and dry days.";
    case "autumn": return "Autumn harvest season. Bier brewing peaks. Prepare brennholz for winter.";
    case "winter": return "Winter has come. Farming is impossible. Brennholz keeps away the cold.";
  }
}

// Apply winter heating at dawn: costs 1 brennholz per agent or suffer energy/sickness penalty
export function applyWinterHeating(state: WorldState): void {
  if (state.season !== "winter") return;

  for (const agent of getAgentNames()) {
    const eco = state.economics[agent];
    const hasFirewood = getInventoryQty(eco.inventory, "brennholz") > 0;

    if (hasFirewood) {
      removeFromInventory(eco.inventory, "brennholz", 1);
      // Cozy night — normal sleep quality already handled
    } else {
      // Cold night
      state.body[agent].energy = Math.max(0, state.body[agent].energy - 1);
      const currentSickness = state.body[agent].sickness ?? 0;
      if (currentSickness < 3) {
        state.body[agent].sickness = currentSickness + 1;
      }
      feedbackToAgent(agent, state, "You had no brennholz last night. You feel cold and unwell.");
    }
  }
}
