import type { AgentName, SimTime } from "./types.js";
import { AGENT_WORK_LOCATIONS } from "./types.js";

// Medieval work schedules: dawn to dusk, 6 days a week (Sunday rest)
// isAway() returns true when agent should be forced to their work location
// (unlike Hauswelt, agents still get LLM calls — they work and socialize at their location)
export function isWorkTime(agent: AgentName, time: SimTime): boolean {
  if (time.dayOfWeek === "Sunday") return false;

  switch (agent) {
    // Farmers: work during daylight, earlier schedule in summer
    case "brakel":
    case "wendel":
    case "kasper":
    case "wenzel":
      return time.hour >= 6 && time.hour <= 16;

    // Goatherd: dawn chores + afternoon
    case "ottmar":
      return time.hour >= 6 && time.hour <= 15;

    // Miller: when bakery is buying (mornings and afternoons)
    case "irmel":
      return time.hour >= 7 && time.hour <= 16;

    // Baker: very early, done by early afternoon
    case "bodo":
      return time.hour >= 6 && time.hour <= 13;

    // Blacksmith: full day
    case "eckhart":
      return time.hour >= 7 && time.hour <= 16;

    // Carpenter: full day
    case "lenz":
      return time.hour >= 7 && time.hour <= 16;

    // Tavern keeper: afternoon and evening only
    case "grete":
      return time.hour >= 10 && time.hour <= 21;

    // Healer: mornings and when needed
    case "walburga":
      return time.hour >= 7 && time.hour <= 17;

    // Woodcutters: daylight hours
    case "jost":
      return time.hour >= 6 && time.hour <= 17;

    // Miners: full working day
    case "mattis":
    case "gisbert":
      return time.hour >= 7 && time.hour <= 17;

    // Seamstress: morning and afternoon
    case "minna":
      return time.hour >= 7 && time.hour <= 16;

    // Elder, chaplain, unspecialized: no forced location
    case "reinhart":
    case "bruder_anno":
    case "rike":
    case "vroni":
      return false;

    default:
      return false;
  }
}

export function getWorkLocation(agent: AgentName): string {
  return AGENT_WORK_LOCATIONS[agent];
}

export function workMemorySummary(agent: AgentName): string {
  const loc = AGENT_WORK_LOCATIONS[agent];
  return `Work at ${loc}. Normal day, nothing unusual.`;
}
