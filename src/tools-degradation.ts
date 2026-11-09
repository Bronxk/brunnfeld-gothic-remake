import type { AgentName, WorldState } from "./types.js";
import { getAgentNames } from "./world-registry.js";
import { getInventoryQty, removeFromInventory, feedbackToAgent } from "./inventory.js";

// Called at dawn: break tools that hit 0, inject feedback
export function degradeTools(state: WorldState): void {
  for (const agent of getAgentNames()) {
    const eco = state.economics[agent];
    if (!eco.tool) continue;
    if (eco.tool.durability <= 0) {
      eco.tool = null;
      feedbackToAgent(agent, state, "Dein Werkzeug ist kaputtgegangen. Du brauchst ein neues, um ordentlich zu arbeiten.");
    }
  }
}

// Called after degradeTools: equip from inventory if tool is missing and stock available
export function autoEquipTools(state: WorldState): void {
  for (const agent of getAgentNames()) {
    const eco = state.economics[agent];
    if (eco.tool && eco.tool.durability > 0) continue;
    const hasStock = getInventoryQty(eco.inventory, "werkzeug") > 0;
    if (!hasStock) continue;
    removeFromInventory(eco.inventory, "werkzeug", 1);
    eco.tool = { type: "werkzeug", durability: 100 };
    feedbackToAgent(agent, state, "Du hast ein frisches Werkzeug aus deinem Vorrat eingesetzt.");
  }
}

export function getToolPerception(agent: AgentName, state: WorldState): string {
  const eco = state.economics[agent];
  // Rendered by agent-runner as "Werkzeug: <this>", so no leading "Werkzeug" here.
  if (!eco.tool) return "keins (Arbeit, die Werkzeug braucht, ist nicht möglich)";
  if (eco.tool.durability <= 20) return `Zustand ${eco.tool.durability}/100 — fast kaputt!`;
  return `Zustand ${eco.tool.durability}/100`;
}
