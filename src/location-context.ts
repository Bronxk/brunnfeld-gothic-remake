import type { AgentName } from "./types.js";

export interface SpeechEntry {
  agentId: AgentName;
  name: string;
  text: string;
}

export interface VisibleAction {
  agentId: AgentName;
  name: string;
  type: string;
  summary: string;
}

export interface NegotiationOffer {
  from: AgentName;
  fromName: string;
  to: AgentName;
  item: string;
  price: number;
  qty: number;
}

export interface LocationContext {
  location: string;
  speechLog: SpeechEntry[];
  visibleActions: VisibleAction[];
  negotiationOffers: NegotiationOffer[];
}

export function createLocationContext(location: string): LocationContext {
  return {
    location,
    speechLog: [],
    visibleActions: [],
    negotiationOffers: [],
  };
}

// Contexts of the harness runs that are in flight right now (one per location), so the
// human player can talk into the same speech log the NPCs at that location are reading.
const liveContexts = new Map<string, LocationContext>();

export function registerLiveContext(ctx: LocationContext): void {
  liveContexts.set(ctx.location, ctx);
}

export function unregisterLiveContext(ctx: LocationContext): void {
  if (liveContexts.get(ctx.location) === ctx) liveContexts.delete(ctx.location);
}

export function getLiveContext(location: string): LocationContext | undefined {
  return liveContexts.get(location);
}
