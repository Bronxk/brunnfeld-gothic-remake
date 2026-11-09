import type { AgentName, QueuedMessage, WorldState } from "./types.js";
import { getDisplayName } from "./world-registry.js";

export function queueMessage(
  state: WorldState,
  from: AgentName,
  to: AgentName,
  text: string,
  tick: number,
): void {
  if (!state.message_queue[to]) state.message_queue[to] = [];
  state.message_queue[to].push({ from, type: "message", text, sent_tick: tick });
}

export function deliverMessages(state: WorldState, agent: AgentName, currentTick: number): string {
  const queue = state.message_queue[agent];
  if (!queue || queue.length === 0) return "";

  const lines: string[] = [];

  for (const msg of queue) {
    const fromName = getDisplayName(msg.from);
    const ticksAgo = currentTick - msg.sent_tick;
    const timeAgo = ticksAgo <= 1 ? "gerade eben" : `vor ${ticksAgo} Stunden`;

    switch (msg.type) {
      case "message":
        lines.push(`Von ${fromName} (${timeAgo}): "${msg.text}"`);
        break;
      case "note":
        lines.push(`Zettel von ${fromName} (${timeAgo}): "${msg.text}"`);
        break;
    }
  }

  state.message_queue[agent] = [];
  return lines.join("\n");
}
