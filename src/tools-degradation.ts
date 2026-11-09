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
      feedbackToAgent(agent, state, "Your Werkzeug broke. You need a new one to work efficiently.");
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
    feedbackToAgent(agent, state, "You equipped a fresh Werkzeug from your stock.");
  }
}

export function getToolPerception(agent: AgentName, state: WorldState): string {
  const eco = state.economics[agent];
  if (!eco.tool) return "(no tools — tool-requiring production halved)";
  if (eco.tool.durability <= 20) return `Werkzeug (${eco.tool.durability}/100) — nearly broken!`;
  return `Werkzeug (${eco.tool.durability}/100)`;
}
