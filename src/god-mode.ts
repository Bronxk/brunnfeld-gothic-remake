import type { ActiveEvent, AgentName, ItemType, WorldState } from "./types.js";
import { ITEM_LABELS } from "./types.js";
import { readAgentProfile, readAgentMemory } from "./memory.js";
import { getAgentNames, getDisplayName, getVillageElder, getVillageTownHall, getAgentVillage, getVillageAgents, DEFAULT_VILLAGE_ID, DEFAULT_VILLAGE_NAME } from "./world-registry.js";
import { HUB_LOCATION, MERCHANT_CAMP_LOCATION } from "./village-map.js";
import { queueMessage } from "./messages.js";
import { addToInventory, removeFromInventory, feedbackToAgent } from "./inventory.js";
import { callClaude } from "./llm.js";
import { emitSSE } from "./events.js";

// ─── Farm item set ────────────────────────────────────────────

export const FARM_ITEMS = new Set<ItemType>([
  "gerste", "rueben", "eier", "milch", "fleisch", "kraeuter",
]);

const FARMER_AGENTS: AgentName[] = ["brakel", "wenzel", "kasper", "ottmar", "wendel"];
const MINER_AGENTS: AgentName[] = ["mattis", "gisbert"];
const FARM_LOCATIONS = ["Unterfeld", "Ziegenweide", "Oberfeld"];
const MINE_LOCATION = "Erzstollen";

// ─── Production multiplier ────────────────────────────────────

export function getEventProductionMultiplier(
  item: ItemType,
  activeEvents: ActiveEvent[],
): number {
  let m = 1.0;
  for (const ev of activeEvents) {
    if (ev.type === "drought")        { if (FARM_ITEMS.has(item)) m *= 0.5; }
    if (ev.type === "mine_collapse")  { if (item === "eisenerz" || item === "kohle") return 0; }
    if (ev.type === "double_harvest") { if (FARM_ITEMS.has(item)) m *= 2.0; }
  }
  return m;
}

// ─── Caravan cleanup ──────────────────────────────────────────

function cleanupCaravanStock(state: WorldState): void {
  const elder = getVillageElder(DEFAULT_VILLAGE_ID);
  if (!elder) return;
  const elderEco = state.economics[elder];
  if (!elderEco) return;
  const elderInv = elderEco.inventory;
  const caravanItems: ItemType[] = ["gerste", "brot", "rueben", "arznei", "leinen"];
  for (const item of caravanItems) {
    const entry = elderInv.items.find(i => i.type === item);
    if (entry) {
      const unsold = entry.quantity - (entry.reserved ?? 0);
      if (unsold > 0) removeFromInventory(elderInv, item, unsold);
    }
  }
  // Cancel open sell orders from elder for caravan items
  // Clean up in all marketplaces
  const allMkts = state.marketplaces
    ? Object.values(state.marketplaces)
    : [state.marketplace];
  for (const mkt of allMkts) {
    mkt.orders = mkt.orders.filter(
      o => !(o.agentId === elder && caravanItems.includes(o.item)),
    );
  }
  // Move elder back to the hub
  state.agent_locations[elder] = HUB_LOCATION;
}

// ─── Bandit theft ─────────────────────────────────────────────

const lastBanditTheftTick: Record<AgentName, number> = {} as Record<AgentName, number>;

function applyBanditTheft(state: WorldState, time: { tick: number }): void {
  if (Math.random() > 0.05) return; // 5% chance per tick

  for (const agent of getAgentNames()) {
    const lastTick = lastBanditTheftTick[agent] ?? -999;
    if (time.tick - lastTick < 8) continue; // once per 8 ticks per agent

    const eco = state.economics[agent];
    const items = eco.inventory.items.filter(i => i.quantity > (i.reserved ?? 0));
    if (items.length === 0) continue;

    if (Math.random() < 0.15) { // 15% chance per agent when bandits are active
      const target = items[Math.floor(Math.random() * items.length)]!;
      const stolen = Math.max(1, Math.floor((target.quantity - (target.reserved ?? 0)) * 0.3));
      target.quantity -= stolen;
      if (target.quantity <= 0) eco.inventory.items = eco.inventory.items.filter(i => i !== target);

      lastBanditTheftTick[agent] = time.tick;
      state.action_feedback[agent] ??= [];
      state.action_feedback[agent]!.push(`Wegelagerer haben dir ${stolen} ${ITEM_LABELS[target.type] ?? target.type} gestohlen!`);
      break; // only one theft per tick total
    }
  }
}

// ─── Location-aware event feedback ───────────────────────────

function injectLocationEventFeedback(state: WorldState, time: { tick: number }): void {
  for (const ev of state.active_events) {
    if (ev.startTick !== time.tick) continue; // only on the first tick of the event

    const agentsAt = (loc: string): AgentName[] =>
      getAgentNames().filter(a => state.agent_locations[a] === loc);

    switch (ev.type) {
      case "drought":
        for (const farm of FARM_LOCATIONS) {
          for (const a of agentsAt(farm)) {
            feedbackToAgent(a, state, "Die Felder sind ausgedörrt — die Dürre hat die Erträge halbiert. Such dir andere Arbeit, bis sie vorbei ist.");
          }
        }
        break;
      case "double_harvest":
        for (const farm of FARM_LOCATIONS) {
          for (const a of agentsAt(farm)) {
            feedbackToAgent(a, state, "Die Felder strotzen vor Leben! Eine Reiche Ernte — deine Erträge sind heute verdoppelt.");
          }
        }
        break;
      case "mine_collapse":
        for (const a of agentsAt(MINE_LOCATION)) {
          feedbackToAgent(a, state, "Der Stollen ist gerade um dich herum eingebrochen! Raus hier, sofort, und such dir andere Arbeit, bis er abgestützt ist.");
        }
        break;
      case "caravan":
        for (const a of agentsAt(HUB_LOCATION)) {
          feedbackToAgent(a, state, `Ein Schmugglerzug ist gerade hier auf dem ${HUB_LOCATION} angekommen! Es gibt günstige Waren — sag es weiter.`);
        }
        break;
      // plague_rumor and bandit_threat already broadcast via queueMessage to all agents from trigger functions
    }
  }
}

// ─── Tick lifecycle ───────────────────────────────────────────

export function tickGodModeEvents(state: WorldState, time: { tick: number }): void {
  if (state.active_events.length === 0) return;
  const stillActive: ActiveEvent[] = [];
  for (const ev of state.active_events) {
    if (ev.endTick <= time.tick) {
      if (ev.type === "caravan") cleanupCaravanStock(state);
      emitSSE("event:expired", { eventType: ev.type });
    } else {
      stillActive.push(ev);
    }
  }
  state.active_events = stillActive;

  if (state.active_events.some(e => e.type === "bandit_threat")) {
    applyBanditTheft(state, time);
  }

  injectLocationEventFeedback(state, time);
}

// ─── Event triggers ───────────────────────────────────────────

export function triggerDrought(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "drought",
    description: `Eine schwere Dürre hat das ${DEFAULT_VILLAGE_NAME} getroffen. Die Erträge der Felder sind halbiert.`,
    startTick: tick,
    endTick: tick + 48,
  };
  state.active_events.push(ev);

  for (const a of FARMER_AGENTS) {
    const elder = getVillageElder(getAgentVillage(a));
    if (elder) queueMessage(state, elder, a, "Die Felder sind ausgedörrt. Die Dürre halbiert unsere Ernte für die nächsten drei Tage.", tick);
  }
  return ev;
}

export function triggerCaravan(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "caravan",
    description: "Ein Schmugglerzug ist über den Ziegenpfad ins Tal gekommen und verkauft einen Tag lang günstige Waren.",
    startTick: tick,
    endTick: tick + 16,
  };
  state.active_events.push(ev);

  const elderVillageId = DEFAULT_VILLAGE_ID;
  const elder = getVillageElder(elderVillageId);
  if (!elder) return ev;

  const elderMkt = state.marketplaces ? (state.marketplaces[elderVillageId] ?? state.marketplace) : state.marketplace;
  const priceIndex = elderMkt.priceIndex;
  const PRICE_FLOORS: Partial<Record<ItemType, number>> = {
    gerste: 3, brot: 5, rueben: 2, arznei: 8, leinen: 6,
  };

  const caravanGoods: { item: ItemType; qty: number }[] = [
    { item: "gerste",  qty: 8 },
    { item: "brot",    qty: 6 },
    { item: "rueben",  qty: 5 },
    { item: "arznei",  qty: 2 },
    { item: "leinen",  qty: 2 },
  ];

  const elderInv = state.economics[elder].inventory;

  for (const { item, qty } of caravanGoods) {
    addToInventory(elderInv, item, qty, tick);
    const basePrice = priceIndex[item] ?? PRICE_FLOORS[item] ?? 5;
    const price = Math.max(1, Math.floor(basePrice * 0.7));

    elderMkt.orders.push({
      id: `caravan_${item}_${tick}`,
      agentId: elder,
      type: "sell",
      item,
      quantity: qty,
      price,
      postedTick: tick,
      expiresAtTick: tick + 16,
    });
  }

  // Move elder to the merchant camp for the duration
  state.agent_locations[elder] = MERCHANT_CAMP_LOCATION;

  // Notify all village agents about the caravan
  for (const a of getVillageAgents(elderVillageId)) {
    if (a !== elder) feedbackToAgent(a, state, `Ein Schmugglerzug hat am ${MERCHANT_CAMP_LOCATION} sein Lager aufgeschlagen, nahe beim ${HUB_LOCATION}! Heute gibt es günstige Waren.`);
  }
  return ev;
}

export function triggerMineCollapse(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "mine_collapse",
    description: "Stolleneinbruch! Der Erzstollen ist teilweise eingestürzt. Die Erzförderung ist 2 Tage lang blockiert.",
    startTick: tick,
    endTick: tick + 32,
  };
  state.active_events.push(ev);

  for (const miner of MINER_AGENTS) {
    const elder = getVillageElder(getAgentVillage(miner));
    if (elder) queueMessage(state, elder, miner, "Der Stollen ist eingebrochen! Geh nicht hinein, bis er abgestützt ist. Zwei Tage lang wird kein Erz gefördert.", tick);
  }
  return ev;
}

export function triggerDoubleHarvest(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "double_harvest",
    description: "Reiche Ernte! Die Erträge der Felder sind heute verdoppelt.",
    startTick: tick,
    endTick: tick + 16,
  };
  state.active_events.push(ev);

  for (const a of FARMER_AGENTS) {
    const elder = getVillageElder(getAgentVillage(a));
    if (elder) queueMessage(state, elder, a, "Der Herrgott hat uns heute eine reiche Ernte geschenkt! Deine Erträge werden verdoppelt.", tick);
  }
  return ev;
}

export function triggerPlagueRumor(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "plague_rumor",
    description: "Fiebergerücht in der Kolonie: Es heißt, das Grubenfieber breite sich aus. Die Nachfrage nach Arznei ist stark gestiegen.",
    startTick: tick,
    endTick: tick + 32,
  };
  state.active_events.push(ev);

  for (const agent of getAgentNames()) {
    const elder = getVillageElder(getAgentVillage(agent));
    if (elder) queueMessage(state, elder, agent, "In der Kolonie geht ein Gerücht um: Das Grubenfieber soll sich ausbreiten. Leg dir Arznei zurück, wenn du kannst.", tick);
  }
  return ev;
}

export function triggerBanditThreat(state: WorldState, tick: number): ActiveEvent {
  const ev: ActiveEvent = {
    type: "bandit_threat",
    description: "Wegelagerer am Ziegenpfad! Es wurden Räuber in der Nähe gemeldet. 2 Tage lang droht Diebstahl.",
    startTick: tick,
    endTick: tick + 32,
  };
  state.active_events.push(ev);

  for (const agent of getAgentNames()) {
    const elder = getVillageElder(getAgentVillage(agent));
    if (elder) queueMessage(state, elder, agent, `Wegelagerer wurden auf dem Ziegenpfad nahe dem ${DEFAULT_VILLAGE_NAME} gesehen. Pass auf deine Wertsachen auf.`, tick);
  }
  return ev;
}

// ─── Location access blocking ─────────────────────────────────

export function isLocationBlockedByEvent(
  loc: string,
  activeEvents: ActiveEvent[],
): string | null {
  if (loc === MINE_LOCATION && activeEvents.some(e => e.type === "mine_collapse")) {
    return `[Dort geht's nicht hin] Der Erzstollen ist eingebrochen und zu gefährlich. Warte, bis er abgestützt ist.`;
  }
  if (loc === MERCHANT_CAMP_LOCATION && !activeEvents.some(e => e.type === "caravan")) {
    return `[Dort geht's nicht hin] Am ${MERCHANT_CAMP_LOCATION} ist gerade kein Schmugglerzug.`;
  }
  return null;
}

// ─── Dispatch by event type ───────────────────────────────────

export function triggerEvent(
  eventType: string,
  state: WorldState,
  tick: number,
): ActiveEvent | null {
  switch (eventType) {
    case "drought":        return triggerDrought(state, tick);
    case "caravan":        return triggerCaravan(state, tick);
    case "mine_collapse":  return triggerMineCollapse(state, tick);
    case "double_harvest": return triggerDoubleHarvest(state, tick);
    case "plague_rumor":   return triggerPlagueRumor(state, tick);
    case "bandit_threat":  return triggerBanditThreat(state, tick);
    default: return null;
  }
}

// ─── Meeting trigger ──────────────────────────────────────────

export function triggerMeeting(
  state: WorldState,
  tick: number,
  agendaType: "tax_change" | "marketplace_hours" | "banishment" | "general_rule",
  description: string,
  target?: AgentName,
  villageId: string = DEFAULT_VILLAGE_ID,
  delay: number = 2,
  teleport: boolean = true,
): void {
  const scheduledTick = tick + Math.max(2, delay);
  state.pending_meetings[villageId] = {
    villageId,
    scheduledTick,
    agendaType,
    description,
    target,
    calledAtTick: tick,
  };
  const townHall = getVillageTownHall(villageId);
  const villageAgents = getVillageAgents(villageId);
  if (teleport) {
    for (const a of villageAgents) {
      state.agent_locations[a] = townHall;
    }
  }
  const elder = getVillageElder(villageId);
  const elderName = elder ? getDisplayName(elder) : "Der Bergvogt";
  const noticeText = teleport
    ? `${elderName} hat einen Not-Appell einberufen: „${description}". Alle sofort zum Treffpunkt: ${townHall}!`
    : `${elderName} hat einen Appell einberufen: „${description}". Er findet in ${delay} Stunden statt, Treffpunkt: ${townHall}. Komm hin, wenn du mitreden willst.`;
  for (const a of villageAgents) feedbackToAgent(a, state, noticeText);
  console.log(`  🏛 [God Mode] Meeting scheduled for tick ${scheduledTick} (${delay} ticks from now).${teleport ? ` All ${villageId} agents teleported to ${townHall}.` : " No teleport — agents must walk."}`);
}

// ─── Interview ────────────────────────────────────────────────

export async function runInterview(
  agent: AgentName,
  question: string,
  state: WorldState,
  onChunk: (s: string) => void,
): Promise<void> {
  const profile = readAgentProfile(agent);
  const memory = readAgentMemory(agent);
  const eco = state.economics[agent];
  const body = state.body[agent];
  const name = getDisplayName(agent);

  const SEASON_DE: Record<string, string> = { spring: "Frühling", summer: "Sommer", autumn: "Herbst", winter: "Winter" };
  const prompt = `Du bist ${name}, ein Kolonist im Schlackental: einem abgelegenen Bergtal, in dem Häftlinge, Wachen und Siedler Eisenerz fördern. Ein Bergsturz hat den Kehlpass verschüttet, seitdem kommen keine Versorgungskarren mehr.
${profile}
${memory}
---
Aktuelle Lage: ${state.agent_locations[agent]}, Geldbeutel: ${eco.wallet} Groschen,
Hunger: ${body.hunger}/5, Jahreszeit: ${SEASON_DE[state.season] ?? state.season}, Tag ${state.day_of_season}/7.
Aktuelle Ereignisse in der Kolonie: ${state.active_events.map(e => e.description).join("; ") || "keine"}

Ein neugieriger Besucher fragt dich: „${question}"
Antworte auf Deutsch, in der Rolle von ${name} (2–4 Sätze). Falle nicht aus der Rolle.`;

  await callClaude(prompt, {
    model: process.env.INTERVIEW_MODEL ?? "haiku",
    onChunk,
  });
}
