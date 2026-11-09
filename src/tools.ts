import type { AgentAction, AgentName, ItemType, Loan, ResolvedAction, WorldState, SimTime, StealRecord } from "./types.js";
import { resolveItemInput } from "./types.js";
import { HUB_LOCATION, TOWNHALL_LOCATION, isBaseLocation, normalizeKey } from "./village-map.js";
import { getAgentNames, getDisplayName, getAgentVillage, getVillageElder, getVillageTownHall, getVillageMembers, isValidLocation, getLocationHours, isLocationOpenByRegistry, getVillageLocations, getVillages, resolveAgentLocation, resolveAgentName, isRoadLocation, getRoads, getVillageForLocation } from "./world-registry.js";
import { getAgentMarketplace } from "./marketplace.js";
import { getHourIndex } from "./time.js";
import { lockDoor, unlockDoor, resolveKnock } from "./doors.js";
import { queueMessage } from "./messages.js";
import { resolveEat } from "./body.js";
import { feedbackToAgent, addToInventory, removeFromInventory, getInventoryQty, reserveInventory, unreserveInventory, itemLabel } from "./inventory.js";
import { executeTrade, removeOrder, addOrder, generateOrderId } from "./marketplace.js";
import { emitSSE } from "./events.js";
import { isLocationBlockedByEvent } from "./god-mode.js";
import { registerWarAction, warTradeBlock, resolveVillageId, villageName, isWarAgenda, warAgendaBlock, validTributeAmount, type WarOffers } from "./war.js";

const NO_WAR: WarOffers = { active: false, raid: false, guard: false, agendas: [] };

const RAID_LINE = `\n- ueberfallen: Kriegszug gegen eine feindliche Siedlung (nur im Krieg): startet den Marsch von daheim, Ankunft und Überfall automatisch. Felder: target_village (Name).`;
const GUARD_LINE = `\n- wache_halten: Halte in deinem Ort Wache (bei Spannung/Krieg); Wachen zählen doppelt, wenn Angreifer kommen.`;

const BASE_AGENDA_TYPES = ["tax_change", "marketplace_hours", "banishment", "general_rule", "grant_tools", "curfew", "trade_restriction", "repeal"];

const CORE_ACTION_SCHEMA = `WICHTIG: Dein Geldbeutel und dein Inventar oben stimmen genau. Behaupte nicht, Groschen oder Waren zu haben, die du nicht bekommen hast. Mündliche Absprachen übertragen keine Waren — nur post_order und buy_item erzeugen echte Geschäfte.

Antworte NUR mit einem JSON-Objekt:
{
  "actions": [
    { "type": "think", "text": "..." },
    { "type": "speak", "text": "..." }
  ]
}

Verfügbare Aktionen:
- think: Innerer Gedanke. Felder: text. Max. 10 Wörter. Niemand sonst hört ihn.
- speak: Sag etwas laut. Felder: text. Max. 1 Satz, 15 Wörter. Nur wenn andere anwesend sind.
- move_to: Geh an einen Ort. Felder: location. Nutze die exakten Ortsnamen.
- produce: Stell etwas her oder sammle es. Felder: item. Du musst am richtigen Ort sein und Handwerk und Zutaten haben. Einmal pro Runde.
- eat: Iss etwas aus deinem Inventar. Felder: item, quantity.
- post_order: Schlag ein Kauf- oder Verkaufsgesuch am Tauschbrett an. Felder: side ("sell"|"buy"), item, quantity, price (pro Stück, in Groschen).
- buy_item: Kauf am Tauschbrett. Felder: item, max_price, quantity (optional, Standard: die volle Menge des Angebots). Nimmt das billigste passende Verkaufsangebot, egal von wem. Um mit einer bestimmten Person zu handeln, muss sie ein Verkaufsangebot anschlagen und dein Preis muss passen. Nur auf dem ${HUB_LOCATION} möglich.
- cancel_order: Zieh dein Angebot vom Tauschbrett zurück. Felder: order_id.
- send_message: Schick eine schriftliche Nachricht. Felder: to (Name), text.
- give_coin: Gib Groschen (Zahlung, Rückzahlung, Geschenk). Felder: to (Name), amount.
- steal: Stiehl etwas von jemandem hier. Felder: target (Name), item. Du kannst erwischt werden.

Nutze nur Aktionen, die zu deiner Lage passen. Beziehe dich nur auf Dinge, die du wahrgenommen hast oder an die du dich erinnerst.`;

export function buildActionSchema(
  agent: AgentName,
  hasConcerns: boolean,
  atMeeting = false,
  war: WarOffers = NO_WAR,
): string {
  const warActive = war.active;
  let schema = CORE_ACTION_SCHEMA;
  if (!atMeeting) {
    if (war.raid) schema += RAID_LINE;
    if (war.guard) schema += GUARD_LINE;
  }
  if (atMeeting) {
    schema += `\n- propose_rule: Schlag eine Regel zur Abstimmung vor. Felder: text (die Regel), value? (Zahl: Zehnt in Prozent, z. B. 15; Sperrstunde 0–10; bei Tribut ganze Groschen, z. B. 40).`;
    schema += `\n- propose_repeal: Beantrage, einen bestehenden Ratsbeschluss aufzuheben. Felder: law_id (der Beschluss), text (Begründung).`;
    schema += `\n- vote: Gib deine Stimme ab. Felder: side ("agree"|"disagree").`;
  } else if (agent === getVillageElder(getAgentVillage(agent)) && (hasConcerns || warActive)) {
    schema += `\n- call_meeting: Berufe für den nächsten Morgen einen Appell ein. Felder: agenda_type (${[...BASE_AGENDA_TYPES, ...war.agendas].map(t => `"${t}"`).join("|")}), text (die Tagesordnung), target? (Name, bei banishment/grant_tools)${war.agendas.length > 0 ? `, target_village? (Siedlung, bei ${war.agendas.join("/")})${war.agendas.includes("pay_tribute") ? ", value? (Tribut in ganzen Groschen, bei pay_tribute)" : ""}` : ""}.`;
  } else if (agent !== getVillageElder(getAgentVillage(agent)) && (hasConcerns || warActive)) {
    schema += `\n- petition_meeting: Bitte ${getDisplayName(getVillageElder(getAgentVillage(agent)) ?? "den Bergvogt")}, einen Appell einzuberufen. Felder: text (worum es gehen soll).`;
  }
  return schema;
}

// Keep exporting a static version for meeting perception (propose_rule / vote injected separately)
export const ACTION_SCHEMA_PROMPT = CORE_ACTION_SCHEMA;

// ─── Resolve Context ──────────────────────────────────────────

export interface ResolveContext {
  agent: AgentName;
  agentLocation: string;
  state: WorldState;
  time: SimTime;
  movedThisTick?: Set<AgentName>;
}

const VOTE_AGREE = new Set(["agree", "yes", "aye", "ja", "jawohl", "dafuer", "zustimmen", "einverstanden", "pro"]);
const VOTE_DISAGREE = new Set(["disagree", "no", "nein", "dagegen", "ablehnen", "contra"]);

/** Normalize a (German or English) vote answer to "agree"/"disagree"; null if unrecognised. */
function parseVoteSide(raw: unknown): "agree" | "disagree" | null {
  if (typeof raw !== "string") return null;
  const key = normalizeKey(raw);
  if (VOTE_AGREE.has(key)) return "agree";
  if (VOTE_DISAGREE.has(key)) return "disagree";
  return null;
}

// Order sides are engine-internal ("sell"/"buy"); agents read BIETE / SUCHE.
function sideLabel(side: string): string {
  return side === "sell" ? "BIETE" : "SUCHE";
}

// ─── Resolve Action ───────────────────────────────────────────

export function resolveAction(
  action: AgentAction,
  context: ResolveContext,
): ResolvedAction {
  const { agent, agentLocation, state, time } = context;
  const name = getDisplayName(agent);

  switch (action.type) {
    case "speak": {
      const othersHere = Object.keys(state.agent_locations).filter(
        a => a !== agent && state.agent_locations[a] === agentLocation
      );
      if (othersHere.length === 0) {
        feedbackToAgent(agent, state, `[Kann nicht sprechen] Niemand sonst ist hier, der dich hören könnte. Nutze think.`);
        return { ...action, result: "", visible: false };
      }
      // NOTE: `sagt: "` is parsed by viewer/src/components/TownHallView.tsx (strips the prefix) — keep in sync.
      return { ...action, result: `${name} sagt: "${action.text}"`, visible: true };
    }

    case "think":
      // NOTE: `[Gedanke] ` is stripped by viewer/src/components/TownHallView.tsx — keep in sync.
      return { ...action, result: action.text ? `[Gedanke] ${action.text}` : "", visible: false };

    case "wait":
      return { ...action, result: "", visible: false };

    case "move_to": {
      const rawLoc = action.location || action.text || "";
      // Resolve bare location names using the agent's current village, not home village
      const currentVid = isRoadLocation(agentLocation)
        ? undefined
        : getVillageForLocation(agentLocation);
      const targetLoc = resolveAgentLocation(agent, rawLoc, currentVid);
      const valid = isValidLocation(targetLoc);
      if (!valid) {
        const vid = currentVid ?? getAgentVillage(agent);
        const vName = getVillages().find(v => v.id === vid)?.name ?? "";
        const localLocs = getVillageLocations(vid).map(l =>
          vName && l.startsWith(`${vName}:`) ? l.slice(vName.length + 1) : l
        );
        return { ...action, result: `[Geht nicht] "${rawLoc}" ist kein gültiger Ort. Probier: ${localLocs.join(", ")}`, visible: false };
      }
      const eventBlock = isLocationBlockedByEvent(targetLoc, state.active_events);
      if (eventBlock) {
        return { ...action, result: eventBlock, visible: false };
      }
      const hourIdx = getHourIndex(time);
      if (!isLocationOpenByRegistry(targetLoc, hourIdx)) {
        const hrs = getLocationHours(targetLoc);
        const opensStr = hrs != null ? ` (öffnet um ${String(6 + hrs.open).padStart(2, "0")}:00)` : "";
        const msg = `[Kann nicht gehen] ${targetLoc} ist gerade geschlossen${opensStr}.`;
        feedbackToAgent(agent, state, msg);
        return { ...action, result: msg, visible: false };
      }
      if (context.movedThisTick?.has(agent)) {
        return { ...action, result: `[Kann nicht gehen] Du bist diese Stunde schon gegangen.`, visible: false };
      }
      const wasOnRoad = isRoadLocation(agentLocation);
      state.agent_locations[agent] = targetLoc;
      context.movedThisTick?.add(agent);

      // Arriving at a road: apply hunger cost + travel feedback
      if (isRoadLocation(targetLoc)) {
        state.body[agent].hunger = Math.min(5, (state.body[agent].hunger ?? 0) + 1);
        const road = getRoads().find(r => r.name === targetLoc);
        const destVid = road?.connectsVillages.find(v => v !== currentVid);
        const destName = getVillages().find(v => v.id === destVid)?.name ?? destVid ?? "der nächsten Siedlung";
        feedbackToAgent(agent, state, `[Unterwegs] Du bist auf dem Weg nach ${destName}. Nächste Runde kommst du an. (+1 Hunger)`);
        return { ...action, location: targetLoc, result: `${name} macht sich auf den Weg nach ${destName}.`, visible: true };
      }

      // Arriving at a village from a road
      if (wasOnRoad) {
        const arrivedVid = getVillageForLocation(targetLoc);
        const arrivedName = getVillages().find(v => v.id === arrivedVid)?.name ?? targetLoc;
        feedbackToAgent(agent, state, `[Angekommen] Du bist in ${arrivedName} angekommen.`);
      }

      return { ...action, location: targetLoc, result: `${name} begibt sich zum Ort ${targetLoc}.`, visible: true };
    }

    case "knock_door": {
      const knockResult = resolveKnock(state, agent, action.target ?? "");
      return { ...action, result: knockResult.result, visible: true };
    }

    case "lock_door":
      return { ...action, result: lockDoor(state, agent), visible: false };

    case "unlock_door":
      return { ...action, result: unlockDoor(state, agent), visible: false };

    case "send_message": {
      const rawTarget = String(action.to ?? action.target ?? "");
      const targetAgent = resolveAgentName(rawTarget, getAgentNames()) as AgentName | null;
      if (!targetAgent) {
        return { ...action, result: `[Geht nicht] Niemand namens "${rawTarget}" lebt in der Kolonie.`, visible: false };
      }
      const msgText = action.text ?? "(keine Nachricht)";
      queueMessage(state, agent, targetAgent, msgText, time.tick);
      return { ...action, result: `Nachricht an ${getDisplayName(targetAgent)} abgeschickt.`, visible: false };
    }

    case "leave_note": {
      const noteLocation = action.location ?? agentLocation;
      state.objects.push({
        id: `note_${agent}_${time.tick}`,
        type: "note",
        label: `Notiz von ${name}: "${(action.text ?? "").substring(0, 50)}..."`,
        location: noteLocation,
        content: action.text ?? "",
        placed_day: time.dayNumber,
        discovered_by: [],
        read_by: [agent],
        visibility: "shared",
        duration_days: 3,
      });
      return { ...action, result: `Notiz hinterlassen: ${noteLocation}.`, visible: true };
    }

    case "read": {
      const obj = state.objects.find(o => o.id === action.object_id);
      if (!obj) return { ...action, result: "Dieses Objekt gibt es nicht.", visible: false };
      if (!obj.read_by.includes(agent)) obj.read_by.push(agent);
      return { ...action, result: obj.content || obj.label, visible: false };
    }

    // produce passes through to dedicated resolver — stamp location so tick-end resolution works even if agent moves after
    case "produce":
      return { ...action, location: agentLocation, result: `${name} beginnt mit der Arbeit an ${action.item ? itemLabel(String(action.item)) : "Waren"}. Das Ergebnis kommt am Ende der Runde — schlag dafür noch kein Verkaufsangebot an.`, visible: true };

    case "post_order": {
      const warBlock = warTradeBlock(state, agent);
      if (warBlock) return { ...action, result: warBlock, visible: false };
      const side = action.side;
      const item = resolveItemInput(action.item);
      const quantity = action.quantity != null ? Number(action.quantity) : undefined;
      const price = action.price != null ? Number(action.price) : undefined;

      // Check trade restriction laws
      if (item) {
        const hourIdx = getHourIndex(time);
        const tradeBlock = (state.active_laws ?? []).find(l =>
          l.type === "trade_restriction" &&
          (!l.restrictedItem || l.restrictedItem === item) &&
          (!l.restrictedHours || (hourIdx >= l.restrictedHours[0] && hourIdx <= l.restrictedHours[1]))
        );
        if (tradeBlock) {
          state.violations_log.push({ tick: time.tick, agent, lawId: tradeBlock.id, action: "post_order", blocked: true });
          return { ...action, result: `[Verboten per Ratsbeschluss] ${tradeBlock.description}`, visible: false };
        }
      }

      if (!side || (side !== "sell" && side !== "buy") || !item || !quantity || !price || quantity <= 0 || price <= 0) {
        feedbackToAgent(agent, state, `[Geht nicht] post_order braucht side ("sell" oder "buy"), item, quantity, price.`);
        return { ...action, result: `[Geht nicht] post_order braucht side ("sell" oder "buy"), item, quantity, price.`, visible: false };
      }

      const orderSide = side as "sell" | "buy";

      if (orderSide === "sell") {
        const inv = state.economics[agent].inventory;
        const invItem = inv.items.find(i => i.type === item);
        const totalQty = invItem?.quantity ?? 0;
        const alreadyReserved = invItem?.reserved ?? 0;
        const available = Math.max(0, totalQty - alreadyReserved);
        if (quantity > available) {
          feedbackToAgent(agent, state, `[Kann nicht anschlagen] Du hast nur ${available} ${itemLabel(item)} verfügbar (${alreadyReserved} in anderen Angeboten reserviert).`);
          return { ...action, result: `[Kann nicht anschlagen] Du hast nur ${available} ${itemLabel(item)} verfügbar (${alreadyReserved} in anderen Angeboten reserviert).`, visible: false };
        }
        reserveInventory(agent, item, quantity, state);
      }

      if (orderSide === "buy") {
        const needed = price * quantity;
        if (state.economics[agent].wallet < needed) {
          feedbackToAgent(agent, state, `[Zu teuer] Für dieses Kaufgesuch musst du ${needed} Groschen zurücklegen, hast aber nur ${state.economics[agent].wallet}.`);
          return { ...action, result: `[Zu teuer] Für dieses Kaufgesuch musst du ${needed} Groschen zurücklegen, hast aber nur ${state.economics[agent].wallet}.`, visible: false };
        }
      }

      const newOrder = {
        id: generateOrderId(),
        agentId: agent,
        type: orderSide,
        item,
        quantity,
        price,
        postedTick: time.tick,
        expiresAtTick: time.tick + 16,
      };
      addOrder(getAgentMarketplace(agent, state), newOrder);
      emitSSE("order:posted", { orderId: newOrder.id, agentId: agent, orderType: orderSide, item, quantity, price });
      feedbackToAgent(agent, state, `Angeschlagen: ${sideLabel(orderSide)} ${quantity} ${itemLabel(item)} für je ${price} Groschen. Angebots-ID: ${newOrder.id} (läuft in 16 Stunden ab). Mit cancel_order und dieser ID ziehst du es zurück.`);
      return { ...action, result: `Angeschlagen: ${sideLabel(orderSide)} ${quantity} ${itemLabel(item)} für je ${price} Groschen. Angebots-ID: ${newOrder.id}.`, visible: false };
    }

    case "cancel_order": {
      const orderId = action.order_id;
      if (!orderId) {
        feedbackToAgent(agent, state, "[Geht nicht] cancel_order braucht order_id.");
        return { ...action, result: "[Geht nicht] cancel_order braucht order_id.", visible: false };
      }

      const agentMkt = getAgentMarketplace(agent, state);
      const order = agentMkt.orders.find(o => o.id === orderId && o.agentId === agent);
      if (!order) {
        feedbackToAgent(agent, state, `[Geht nicht] Kein Angebot ${orderId} von dir gefunden.`);
        return { ...action, result: `[Geht nicht] Kein Angebot ${orderId} von dir gefunden.`, visible: false };
      }

      if (order.type === "sell") {
        const inv = state.economics[agent].inventory;
        const found = inv.items.find(i => i.type === order.item);
        if (found) found.reserved = Math.max(0, (found.reserved ?? 0) - order.quantity);
      }

      removeOrder(agentMkt, orderId);
      emitSSE("order:cancelled", { orderId, agentId: agent, orderType: order.type, item: order.item, quantity: order.quantity, price: order.price });
      feedbackToAgent(agent, state, `Angebot zurückgezogen: ${sideLabel(order.type)} ${itemLabel(order.item)} x${order.quantity} für je ${order.price} Groschen (ID: ${orderId}).`);
      return { ...action, result: `Angebot zurückgezogen: ${sideLabel(order.type)} ${itemLabel(order.item)} x${order.quantity} für je ${order.price} Groschen.`, visible: false };
    }

    // buy_item resolves immediately so the agent can eat in the same turn
    case "buy_item": {
      const warBlock = warTradeBlock(state, agent);
      if (warBlock) return { ...action, result: warBlock, visible: false };
      const item = resolveItemInput(action.item);
      const maxPrice = action.max_price != null ? Number(action.max_price) : undefined;
      if (!item || maxPrice == null) {
        return { ...action, result: "[Geht nicht] buy_item braucht item und max_price.", visible: false };
      }
      // Check trade restriction laws
      {
        const hourIdx = getHourIndex(time);
        const tradeBlock = (state.active_laws ?? []).find(l =>
          l.type === "trade_restriction" &&
          (!l.restrictedItem || l.restrictedItem === item) &&
          (!l.restrictedHours || (hourIdx >= l.restrictedHours[0] && hourIdx <= l.restrictedHours[1]))
        );
        if (tradeBlock) {
          state.violations_log.push({ tick: time.tick, agent, lawId: tradeBlock.id, action: "buy_item", blocked: true });
          return { ...action, result: `[Verboten per Ratsbeschluss] ${tradeBlock.description}`, visible: false };
        }
      }
      const currentLoc = state.agent_locations[agent];
      // Allow buying at any "square"-type location (covers "Zechenplatz", "Rabenstollen:Zechenplatz", etc.)
      const atSquare = isBaseLocation(currentLoc, HUB_LOCATION) || currentLoc === "Marketplace";
      if (!atSquare) {
        return { ...action, result: `[Geht nicht] Zum Kaufen musst du auf dem ${HUB_LOCATION} sein.`, visible: false };
      }
      const buyMkt = getAgentMarketplace(agent, state);
      const matches = buyMkt.orders
        .filter(o => o.type === "sell" && o.item === item && o.price <= maxPrice && o.agentId !== agent)
        .sort((a, b) => a.price - b.price);
      if (matches.length === 0) {
        const allOrders = buyMkt.orders
          .filter(o => o.type === "sell" && o.item === item && o.agentId !== agent)
          .sort((a, b) => a.price - b.price);
        const cheapestNote = allOrders.length > 0
          ? ` Billigstes Angebot: ${allOrders[0]!.price} Groschen von ${getDisplayName(allOrders[0]!.agentId)}. Erhöhe dein max_price.`
          : " Für diese Ware gibt es kein Verkaufsangebot.";
        return { ...action, result: `[Kein Angebot] Kein Verkaufsangebot für ${itemLabel(item)} bis ${maxPrice} Groschen.${cheapestNote}`, visible: false };
      }
      const order = matches[0]!;
      const buyQuantity = Math.min(action.quantity ?? order.quantity, order.quantity);
      const cost = order.price * buyQuantity;
      if (state.economics[agent].wallet < cost) {
        return { ...action, result: `[Zu teuer] Du brauchst ${cost} Groschen, hast aber ${state.economics[agent].wallet}.`, visible: false };
      }
      const trade = executeTrade(agent, order.agentId, item, buyQuantity, order.price, state, time);
      if (buyQuantity < order.quantity) {
        order.quantity -= buyQuantity;
      } else {
        removeOrder(buyMkt, order.id);
      }
      feedbackToAgent(order.agentId, state, `Verkauft: ${trade.quantity} ${itemLabel(trade.item)} an ${name} für ${trade.total} Groschen.`);
      return { ...action, result: `Gekauft: ${name} kauft ${trade.quantity} ${itemLabel(trade.item)} für ${trade.total} Groschen.`, visible: true };
    }

    case "eat": {
      const item = resolveItemInput(action.item);
      const qty = action.quantity ?? 1;
      if (!item) return { ...action, result: "[Nicht essbar] Kein Gegenstand angegeben.", visible: false };
      const result = resolveEat(agent, item, qty, state);
      return { ...action, result, visible: result.startsWith("[") ? false : true };
    }

    case "hire": {
      const rawTarget = String(action.target ?? "");
      const targetAgent = resolveAgentName(rawTarget, getAgentNames()) as AgentName | null;
      if (!targetAgent) {
        return { ...action, result: `[Geht nicht] Niemand namens "${rawTarget}" ist verfügbar.`, visible: false };
      }
      const wage = action.wage ?? 5;
      const eco = state.economics[agent];
      if (eco.wallet < wage) {
        return { ...action, result: `[Zu teuer] Du brauchst ${wage} Groschen, hast aber ${eco.wallet}.`, visible: false };
      }
      const targetEco = state.economics[targetAgent];
      if (targetEco.hiredBy) {
        return { ...action, result: `[Geht nicht] ${getDisplayName(targetAgent)} ist schon bei jemandem angeheuert.`, visible: false };
      }
      targetEco.hiredBy = agent;
      targetEco.hiredUntilTick = time.tick + 16;
      // Wage paid at end of day in engine
      feedbackToAgent(targetAgent, state, `${name} hat dich für den Tag angeheuert (${wage} Groschen). Aufgabe: ${action.task ?? "bei der Arbeit helfen"}.`);
      return { ...action, result: `${name} hat ${getDisplayName(targetAgent)} für ${wage} Groschen angeheuert.`, visible: true };
    }

    case "lend_coin": {
      const rawTarget = String(action.to ?? "");
      const targetAgent = resolveAgentName(rawTarget, getAgentNames()) as AgentName | null;
      if (!targetAgent) {
        return { ...action, result: `[Geht nicht] Niemand namens "${rawTarget}" in der Kolonie.`, visible: false };
      }
      const amount = action.amount ?? 0;
      if (amount <= 0) {
        return { ...action, result: `[Geht nicht] Der Betrag muss positiv sein.`, visible: false };
      }
      const eco = state.economics[agent];
      if (eco.wallet < amount) {
        return { ...action, result: `[Zu teuer] Du hast ${eco.wallet} Groschen, brauchst aber ${amount}.`, visible: false };
      }
      eco.wallet -= amount;
      state.economics[targetAgent].wallet += amount;
      const loan: Loan = {
        id: `loan_${agent}_${targetAgent}_${time.tick}`,
        creditor: agent,
        debtor: targetAgent,
        amount,
        issuedTick: time.tick,
        dueTick: time.tick + 112,
        description: action.description ?? action.text ?? "",
        repaid: false,
      };
      state.loans.push(loan);
      feedbackToAgent(targetAgent, state, `${name} hat dir ${amount} Groschen geliehen (Kredit-ID: ${loan.id}, fällig in 7 Tagen).`);
      return { ...action, result: `${name} hat ${getDisplayName(targetAgent)} ${amount} Groschen geliehen. Kredit vermerkt (ID: ${loan.id}).`, visible: true };
    }

    case "give_coin": {
      const rawTarget = String(action.to ?? "");
      const targetAgent = resolveAgentName(rawTarget, getAgentNames()) as AgentName | null;
      if (!targetAgent) {
        return { ...action, result: `[Geht nicht] Niemand namens "${rawTarget}" in der Kolonie.`, visible: false };
      }
      const amount = action.amount ?? 0;
      if (amount <= 0) {
        return { ...action, result: `[Geht nicht] Der Betrag muss positiv sein.`, visible: false };
      }
      const eco = state.economics[agent];
      if (eco.wallet < amount) {
        return { ...action, result: `[Zu teuer] Du hast ${eco.wallet} Groschen, brauchst aber ${amount}.`, visible: false };
      }
      eco.wallet -= amount;
      state.economics[targetAgent].wallet += amount;
      feedbackToAgent(targetAgent, state, `${name} hat dir ${amount} Groschen gegeben.`);
      return { ...action, result: `${name} hat ${getDisplayName(targetAgent)} ${amount} Groschen gegeben.`, visible: true };
    }

    case "steal": {
      const rawTarget = String(action.target ?? "");
      const targetAgent = resolveAgentName(rawTarget, getAgentNames()) as AgentName | null;
      if (!targetAgent) {
        return { ...action, result: `[Geht nicht] Niemand namens "${rawTarget}" ist hier.`, visible: false };
      }
      if (state.agent_locations[targetAgent] !== agentLocation) {
        return { ...action, result: `[Geht nicht] ${getDisplayName(targetAgent)} ist nicht hier.`, visible: false };
      }
      const stealItem = resolveItemInput(action.item);
      if (!stealItem) {
        return { ...action, result: `[Geht nicht] steal braucht das Feld item.`, visible: false };
      }
      const victimInv = state.economics[targetAgent].inventory;
      const available = getInventoryQty(victimInv, stealItem);
      if (available < 1) {
        return { ...action, result: `[Geht nicht] ${getDisplayName(targetAgent)} hat nichts von dieser Ware: ${itemLabel(stealItem)}.`, visible: false };
      }

      // Count witnesses (everyone at location except thief and target)
      const witnesses = Object.keys(state.agent_locations).filter(
        a => a !== agent && a !== targetAgent && state.agent_locations[a] === agentLocation
      ).length;

      // 50% base, each witness multiplies remaining chance by 0.6
      let successChance = 0.5;
      for (let i = 0; i < witnesses; i++) successChance *= 0.6;
      const success = Math.random() < successChance;

      if (!state.caughtStealing) state.caughtStealing = {};

      const victimDisplayName = getDisplayName(targetAgent);

      if (success) {
        unreserveInventory(targetAgent, stealItem, 1, state);
        removeFromInventory(victimInv, stealItem, 1);
        addToInventory(state.economics[agent].inventory, stealItem, 1, time.tick);
        feedbackToAgent(
          targetAgent, state,
          `Dir fehlt etwas: ${itemLabel(stealItem)}. Jemand muss zugegriffen haben, als du nicht hingesehen hast.`
        );
        return { ...action, result: `${name} lässt ${itemLabel(stealItem)} von ${victimDisplayName} unbemerkt mitgehen.`, visible: false };
      } else {
        if (!state.caughtStealing[agent]) state.caughtStealing[agent] = [];
        state.caughtStealing[agent]!.push({ from: targetAgent, item: stealItem });
        state.violations_log.push({
          tick: time.tick, agent, lawId: "theft",
          action: `beim Stehlen von ${itemLabel(stealItem)} bei ${victimDisplayName} erwischt`,
          blocked: false,
        });
        feedbackToAgent(
          targetAgent, state,
          `Du erwischst ${name} dabei, dir ${itemLabel(stealItem)} stehlen zu wollen!`
        );
        return { ...action, result: `${name} wollte ${itemLabel(stealItem)} von ${victimDisplayName} stehlen, wurde aber auf frischer Tat ertappt.`, visible: false };
      }
    }

    case "call_meeting": {
      if (agent !== getVillageElder(getAgentVillage(agent))) {
        return { ...action, result: `[Geht nicht] Nur der Bergvogt kann einen Appell einberufen.`, visible: false };
      }
      const pendingHere = state.pending_meetings[getAgentVillage(agent)];
      // The routine auto-scheduled Appell (general_rule) makes way for a war agenda.
      const replacesRoutine = pendingHere?.agendaType === "general_rule" && !!action.agenda_type && isWarAgenda(action.agenda_type);
      if (pendingHere && !replacesRoutine) {
        return { ...action, result: `[Geht nicht] Ein Appell ist schon für Stunde ${pendingHere.scheduledTick} angesetzt.`, visible: false };
      }
      const agendaType = action.agenda_type;
      if (!agendaType) {
        return { ...action, result: `[Geht nicht] call_meeting braucht agenda_type.`, visible: false };
      }
      const ticksIntoCurrent = (time.tick - 1) % 16;
      const nextDawnTick = ticksIntoCurrent === 0
        ? time.tick + 16
        : time.tick + (16 - ticksIntoCurrent);
      const agendaDesc = action.text ?? action.description ?? agendaType.replace("_", " ");
      const villageId = getAgentVillage(agent);
      let targetVillage: string | undefined;
      if (isWarAgenda(agendaType)) {
        const tv = resolveVillageId(action.target_village ?? action.target);
        if (!tv || tv === villageId) {
          const others = getVillages().filter(v => v.id !== villageId).map(v => v.name).join(", ");
          return { ...action, result: `[Geht nicht] ${agendaType} braucht target_village — eine andere Siedlung (${others || "keine bekannt"}).`, visible: false };
        }
        const blockedWhy = warAgendaBlock(state, villageId, agendaType, tv, time.tick);
        if (blockedWhy) return { ...action, result: blockedWhy, visible: false };
        targetVillage = tv;
      }
      state.pending_meetings[villageId] = {
        villageId,
        scheduledTick: nextDawnTick,
        agendaType,
        description: agendaDesc,
        target: isWarAgenda(agendaType) ? undefined : action.target as AgentName | undefined,
        ...(targetVillage ? { targetVillage } : {}),
        ...(agendaType === "pay_tribute" && validTributeAmount(action.value) != null ? { value: validTributeAmount(action.value)! } : {}),
        calledAtTick: time.tick,
      };
      const townHall = getVillageTownHall(villageId);
      const noticeText = `${getDisplayName(agent)} hat einen Appell einberufen: "${agendaDesc}". Treffpunkt: ${townHall}, bei Tagesanbruch an Tag ${Math.ceil(nextDawnTick / 16)}. Komm hin, wenn du mitreden willst.`;
      for (const a of getVillageMembers(villageId)) {
        feedbackToAgent(a, state, noticeText);
      }
      return { ...action, result: `${getDisplayName(agent)} ruft einen Appell aus: "${agendaDesc}" — angesetzt für den Morgen von Tag ${Math.ceil(nextDawnTick / 16)}, Treffpunkt: ${townHall}.`, visible: true };
    }

    case "petition_meeting": {
      if (agent === getVillageElder(getAgentVillage(agent))) {
        return { ...action, result: `[Geht nicht] Der Bergvogt beruft Appelle direkt mit call_meeting ein.`, visible: false };
      }
      const topic = action.text;
      if (!topic) {
        return { ...action, result: `[Geht nicht] petition_meeting braucht text mit dem Thema.`, visible: false };
      }
      state.pending_petitions ??= [];
      // Replace any existing petition from this agent (one petition per agent at a time)
      state.pending_petitions = state.pending_petitions.filter(p => p.agent !== agent);
      state.pending_petitions.push({ agent, topic, tick: time.tick, villageId: getAgentVillage(agent) });
      return { ...action, result: `${name} bittet ${getDisplayName(getVillageElder(getAgentVillage(agent)) ?? "den Bergvogt")}, einen Appell einzuberufen: "${topic.substring(0, 80)}"`, visible: true };
    }

    case "propose_rule": {
      if (agentLocation !== getVillageTownHall(getAgentVillage(agent))) {
        return { ...action, result: `[Geht nicht] propose_rule geht nur in der ${TOWNHALL_LOCATION} während eines Appells.`, visible: false };
      }
      if (!state.pending_meetings[getAgentVillage(agent)]) {
        return { ...action, result: `[Geht nicht] Es läuft gerade kein Appell.`, visible: false };
      }
      if (!action.text) {
        return { ...action, result: `[Geht nicht] propose_rule braucht text mit der Regel.`, visible: false };
      }
      return { ...action, result: `${name} schlägt vor: "${action.text}"`, visible: true };
    }

    case "propose_repeal": {
      if (agentLocation !== getVillageTownHall(getAgentVillage(agent))) {
        return { ...action, result: `[Geht nicht] propose_repeal geht nur in der ${TOWNHALL_LOCATION} während eines Appells.`, visible: false };
      }
      if (!state.pending_meetings[getAgentVillage(agent)]) {
        return { ...action, result: `[Geht nicht] Es läuft gerade kein Appell.`, visible: false };
      }
      const lawId = action.target ?? action.order_id;
      if (!lawId) {
        return { ...action, result: `[Geht nicht] propose_repeal braucht law_id.`, visible: false };
      }
      const targetLaw = state.active_laws.find(l => l.id === lawId);
      if (!targetLaw) {
        const lawList = state.active_laws.map(l => `${l.id}: "${l.description}"`).join("; ");
        return { ...action, result: `[Geht nicht] Kein Ratsbeschluss mit der ID "${lawId}". Gültig sind: ${lawList || "keine"}`, visible: false };
      }
      return { ...action, result: `${name} beantragt die Aufhebung: "${targetLaw.description}" (${lawId})`, visible: true };
    }

    case "vote": {
      if (agentLocation !== getVillageTownHall(getAgentVillage(agent))) {
        return { ...action, result: `[Geht nicht] vote geht nur in der ${TOWNHALL_LOCATION} während eines Appells.`, visible: false };
      }
      if (!state.pending_meetings[getAgentVillage(agent)]) {
        return { ...action, result: `[Geht nicht] Es läuft gerade keine Abstimmung.`, visible: false };
      }
      const voteSide = parseVoteSide(action.side);
      if (!voteSide) {
        return { ...action, result: `[Geht nicht] vote braucht side: "agree" oder "disagree".`, visible: false };
      }
      return { ...action, result: `${name} stimmt ${voteSide === "agree" ? "dafür" : "dagegen"}.`, visible: true };
    }

    case "ueberfallen": {
      const raw = action.target_village ?? action.target ?? action.location ?? action.text;
      const r = registerWarAction(state, time.tick, agent, "raid", raw);
      if (!r.ok) {
        feedbackToAgent(agent, state, r.error);
        return { ...action, result: r.error, visible: false };
      }
      const tName = villageName(resolveVillageId(raw) ?? String(raw));
      if (r.march) feedbackToAgent(agent, state, `Du ${r.text}`);
      return { ...action, result: `${name} ${r.text}`, visible: true, text: action.text ?? tName };
    }

    case "wache_halten": {
      const r = registerWarAction(state, time.tick, agent, "guard");
      if (!r.ok) {
        feedbackToAgent(agent, state, r.error);
        return { ...action, result: r.error, visible: false };
      }
      return { ...action, result: `${name} ${r.text}`, visible: true };
    }

    default:
      return { ...action, result: `Unbekannte Aktion.`, visible: false };
  }
}
