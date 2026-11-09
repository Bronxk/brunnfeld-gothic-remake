import type { AgentName, WorldState } from "./types.js";
import { getDisplayName, getAgentHomeLocation, resolveAgentName } from "./world-registry.js";

export function lockDoor(state: WorldState, agent: AgentName): string {
  const home = getAgentHomeLocation(agent);
  state.doors[home] = "locked";
  return "Du verriegelst die Tür.";
}

export function unlockDoor(state: WorldState, agent: AgentName): string {
  const home = getAgentHomeLocation(agent);
  state.doors[home] = "unlocked";
  return "Du entriegelst die Tür.";
}

export function resolveKnock(
  state: WorldState,
  knocker: AgentName,
  targetName: string,
): { result: string; targetHome: boolean; doorOpen: boolean } {
  // Find agent whose display name matches
  const target = (resolveAgentName(targetName, Object.keys(state.agent_locations)) ?? undefined) as AgentName | undefined;

  if (!target) {
    return { result: `Hier wohnt niemand namens ${targetName}.`, targetHome: false, doorOpen: false };
  }

  const targetHome = getAgentHomeLocation(target);
  const currentLocation = state.agent_locations[target];
  const isHome = currentLocation === targetHome;

  if (!isHome) {
    return { result: "Niemand öffnet.", targetHome: false, doorOpen: false };
  }

  const doorState = state.doors[targetHome] ?? "unlocked";
  if (doorState === "locked") {
    return { result: "Niemand öffnet.", targetHome: true, doorOpen: false };
  }

  return {
    result: `${getDisplayName(target)} öffnet die Tür.`,
    targetHome: true,
    doorOpen: true,
  };
}
