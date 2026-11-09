import type { AgentName, AgentTurnResult, ItemType, Skill, WorldState, SimTime } from "./types.js";
import { resolveItemId, SKILL_LABELS } from "./types.js";
import { getAgentNames, getDisplayName, getLocationType } from "./world-registry.js";
import { getInventoryQty, removeFromInventory, addToInventory, feedbackToAgent, itemLabel } from "./inventory.js";
import { getSeasonMultiplier } from "./seasons.js";
import { getEventProductionMultiplier } from "./god-mode.js";

export interface Recipe {
  skill: Skill;
  inputs: Partial<Record<ItemType, number>>;
  output: Partial<Record<ItemType, number>>;
  tool: boolean;
  location: string;
}

export const RECIPES: Record<string, Recipe> = {
  gerste:    { skill: "bauer",       inputs: {},                          output: { gerste: 4 },    tool: true,  location: "Unterfeld" },
  milch:     { skill: "hirte",       inputs: {},                          output: { milch: 3 },     tool: false, location: "Ziegenweide" },
  fleisch:   { skill: "hirte",       inputs: {},                          output: { fleisch: 2 },   tool: true,  location: "Ziegenweide" },
  eier:      { skill: "bauer",       inputs: {},                          output: { eier: 2 },      tool: false, location: "Oberfeld" },
  rueben:    { skill: "bauer",       inputs: {},                          output: { rueben: 3 },    tool: true,  location: "Oberfeld" },
  mehl:      { skill: "mueller",     inputs: { gerste: 3 },               output: { mehl: 2 },      tool: false, location: "Mühle" },
  brot:      { skill: "baecker",     inputs: { mehl: 1 },                 output: { brot: 4 },      tool: false, location: "Backstube" },
  werkzeug:  { skill: "schmied",     inputs: { eisenerz: 2, kohle: 1 },   output: { werkzeug: 1 },  tool: false, location: "Schmiede" },
  hausrat:   { skill: "zimmermann",  inputs: { bauholz: 3 },              output: { hausrat: 1 },   tool: true,  location: "Zimmerei" },
  arznei:    { skill: "bader",       inputs: { kraeuter: 3 },             output: { arznei: 1 },    tool: false, location: "Baderhütte" },
  bier:      { skill: "wirt",        inputs: { gerste: 2 },               output: { bier: 4 },      tool: false, location: "Schenke" },
  eintopf:   { skill: "wirt",        inputs: { fleisch: 1, rueben: 1 },   output: { eintopf: 3 },   tool: false, location: "Schenke" },
  leinen:    { skill: "naeherin",    inputs: {},                          output: { leinen: 1 },    tool: false, location: "Flickstube" },
  bauholz:   { skill: "holzfaeller", inputs: {},                          output: { bauholz: 3 },   tool: true,  location: "Köhlerwald" },
  brennholz: { skill: "holzfaeller", inputs: {},                          output: { brennholz: 4 }, tool: true,  location: "Köhlerwald" },
  kraeuter:  { skill: "bader",       inputs: {},                          output: { kraeuter: 2 },  tool: false, location: "Köhlerwald" },
  eisenerz:  { skill: "knappe",      inputs: {},                          output: { eisenerz: 3 },  tool: true,  location: "Erzstollen" },
  kohle:     { skill: "knappe",      inputs: {},                          output: { kohle: 2 },     tool: true,  location: "Erzstollen" },
};

// Farm workers can work on Unterfeld, Ziegenweide or Oberfeld for general farm produce
export const MULTI_FARM_ITEMS: Partial<Record<string, string[]>> = {
  gerste:    ["Unterfeld", "Ziegenweide", "Oberfeld"],
  rueben:    ["Unterfeld", "Ziegenweide", "Oberfeld"],
  eier:      ["Unterfeld", "Ziegenweide", "Oberfeld"],
  kraeuter:  ["Köhlerwald"],
};

/** Returns all producible items for a given skill with their input requirements and required location. */
export function getProducibleItems(skill: string): { item: string; inputs: Record<string, number>; location: string }[] {
  return Object.entries(RECIPES)
    .filter(([, r]) => r.skill === skill)
    .map(([item, r]) => ({ item, inputs: r.inputs as Record<string, number>, location: r.location }));
}

// Season ids are engine-internal (English); agents read the German name.
const SEASON_LABELS: Record<string, string> = {
  spring: "Frühling", summer: "Sommer", autumn: "Herbst", winter: "Winter",
};

function getHiredLaborer(employer: AgentName, state: WorldState): AgentName | null {
  for (const a of getAgentNames()) {
    if (state.economics[a].hiredBy === employer) return a;
  }
  return null;
}

export function resolveProduction(
  results: AgentTurnResult[],
  state: WorldState,
  time: SimTime,
): void {
  const producedThisTick = new Set<AgentName>();
  for (const result of results) {
    for (const action of result.actions) {
      if (action.type !== "produce") continue;

      const agent = result.agent;

      if (producedThisTick.has(agent)) {
        feedbackToAgent(agent, state, `[Kann nicht herstellen] Du hast diese Stunde schon etwas hergestellt. Pro Stunde nur einmal.`);
        continue;
      }
      const eco = state.economics[agent];
      const rawItem = action.item as string;
      const itemKey = resolveItemId(rawItem) ?? rawItem;
      const recipe = RECIPES[itemKey];

      if (!recipe) {
        feedbackToAgent(agent, state, `[Geht nicht] Kein Rezept für "${itemLabel(itemKey)}".`);
        continue;
      }

      if (eco.skill !== recipe.skill) {
        // Allow hired laborers to produce using their employer's skill
        const employer = eco.hiredBy ? state.economics[eco.hiredBy] : null;
        if (!employer || employer.skill !== recipe.skill) {
          feedbackToAgent(agent, state, `[Geht nicht] Dafür fehlt dir das Handwerk ${SKILL_LABELS[recipe.skill] ?? recipe.skill}.`);
          continue;
        }
      }

      // Use location stamped at produce-time (survives if agent moved after producing)
      const prodLocation = action.location ?? state.agent_locations[agent];
      const validLocations = MULTI_FARM_ITEMS[itemKey] ?? [recipe.location];
      const prodLocType = getLocationType(prodLocation);
      const atValidLocation = validLocations.includes(prodLocation) ||
        (prodLocType != null &&
         validLocations.some(vl => getLocationType(vl) === prodLocType));
      if (!atValidLocation) {
        feedbackToAgent(agent, state, `[Geht nicht] ${itemLabel(itemKey)} stellst du nur dort her: ${recipe.location}.`);
        continue;
      }

      if (recipe.tool && (!eco.tool || eco.tool.durability <= 0)) {
        feedbackToAgent(agent, state, `[Geht nicht] Für ${itemLabel(itemKey)} brauchst du brauchbares Werkzeug.`);
        continue;
      }

      let inputsFailed = false;
      for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
        const have = getInventoryQty(eco.inventory, inputItem as ItemType);
        if (have < qty) {
          feedbackToAgent(agent, state, `[Geht nicht] Du brauchst ${qty} ${itemLabel(inputItem)}, hast aber nur ${have}.`);
          inputsFailed = true;
          break;
        }
      }
      if (inputsFailed) continue;

      // Consume inputs
      for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
        removeFromInventory(eco.inventory, inputItem as ItemType, qty);
      }

      // Tool degradation on use
      if (recipe.tool && eco.tool) {
        eco.tool.durability = Math.max(0, eco.tool.durability - 3);
      }

      // Season multiplier
      const outputItem = Object.keys(recipe.output)[0] as ItemType;
      const baseQty = Object.values(recipe.output)[0]!;
      const multiplier = getSeasonMultiplier(outputItem, state.season);
      const eventMultiplier = getEventProductionMultiplier(outputItem, state.active_events);

      if (multiplier === 0 || eventMultiplier === 0) {
        const reason = eventMultiplier === 0
          ? `[Kann nicht herstellen] ${itemLabel(outputItem)} lässt sich wegen eines Ereignisses in der Kolonie gerade nicht herstellen.`
          : `[Geht nicht] ${itemLabel(outputItem)} lässt sich im ${SEASON_LABELS[state.season] ?? state.season} nicht herstellen.`;
        feedbackToAgent(agent, state, reason);
        // Restore consumed inputs
        for (const [inputItem, qty] of Object.entries(recipe.inputs)) {
          addToInventory(eco.inventory, inputItem as ItemType, qty);
        }
        continue;
      }

      // Laborer routing
      const isLaborer = !!eco.hiredBy;
      const laborerWorking = !isLaborer ? getHiredLaborer(agent, state) : null;
      const laborBonus = laborerWorking ? 1.5 : 1.0;
      const outputTarget = isLaborer ? eco.hiredBy! : agent;

      const qty = Math.floor(baseQty * multiplier * laborBonus * eventMultiplier);
      addToInventory(state.economics[outputTarget].inventory, outputItem, qty, time.tick);
      producedThisTick.add(agent);

      // Track for economy snapshots
      state.production_log.push({ tick: time.tick, agent, item: outputItem, qty });

      feedbackToAgent(agent, state, `Hergestellt: ${qty} ${itemLabel(outputItem)}${isLaborer ? ` (an ${getDisplayName(outputTarget)} abgeliefert)` : ""}.`);
      if (isLaborer) {
        feedbackToAgent(outputTarget as AgentName, state, `${getDisplayName(agent)} hat ${qty} ${itemLabel(outputItem)} in dein Inventar geliefert.`);
      }
    }
  }
}
