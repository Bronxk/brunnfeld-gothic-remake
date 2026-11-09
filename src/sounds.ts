import type { AgentName, ResolvedAction } from "./types.js";
import { getVillageAdjacency, getVillageForLocation, DEFAULT_VILLAGE_ID } from "./world-registry.js";

// Keywords are matched against free-text actions; German (agent output) and legacy English both count.
const LOUD_KEYWORDS = [
  "hammer", "hämmer", "schmiede", "amboss", "klirr", "klang", "krach", "forge", "clang", "clank", "bang",
  "hack", "axt", "spalt", "säg", "chop", "axe", "splitting", "sawing",
  "schrei", "brüll", "ruf", "scream", "yell", "shout", "cry", "crying",
  "musik", "sing", "gebet", "glocke", "music", "singing", "prayer", "bell",
  "explosion", "feuer", "brand", "brenn", "fire", "burning",
];

function isLoudAction(text: string): boolean {
  const lower = text.toLowerCase();
  return LOUD_KEYWORDS.some(k => lower.includes(k));
}

function describeLoudAction(text: string, location: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("hammer") || lower.includes("hämmer") || lower.includes("amboss") || lower.includes("clang") || lower.includes("forge")) return `Hämmern aus der Richtung von ${location}.`;
  if (lower.includes("hack") || lower.includes("axt") || lower.includes("spalt") || lower.includes("chop") || lower.includes("axe") || lower.includes("split")) return `Hackgeräusche aus der Richtung von ${location}.`;
  if (lower.includes("schrei") || lower.includes("brüll") || lower.includes("scream") || lower.includes("yell")) return `Jemand schreit in der Nähe von ${location}.`;
  if (lower.includes("gebet") || lower.includes("sing") || lower.includes("glocke") || lower.includes("prayer") || lower.includes("bell")) return `Glocken und Stimmen aus der Richtung von ${location}.`;
  if (lower.includes("feuer") || lower.includes("brenn") || lower.includes("fire") || lower.includes("burning")) return `Feuerknistern aus der Richtung von ${location}.`;
  return `Lärm aus der Richtung von ${location}.`;
}

export function getSounds(
  agent: AgentName,
  agentLocation: string,
  allActions: Record<AgentName, ResolvedAction[]>,
  agentLocations: Record<AgentName, string>,
): string[] {
  const sounds: string[] = [];
  const villageId = getVillageForLocation(agentLocation) ?? DEFAULT_VILLAGE_ID;
  const hearable = getVillageAdjacency(villageId)[agentLocation] ?? [];

  for (const [otherAgent, actions] of Object.entries(allActions) as [AgentName, ResolvedAction[]][]) {
    if (otherAgent === agent) continue;
    const otherLocation = agentLocations[otherAgent];
    if (!otherLocation || !hearable.includes(otherLocation)) continue;

    let hasVoice = false;
    for (const action of actions) {
      if (action.type === "speak" && !hasVoice) hasVoice = true;
    }
    if (hasVoice) sounds.push(`Stimmen aus der Richtung von ${otherLocation}.`);
  }

  return sounds;
}
