import type { AgentName, AgentTurnResult, ItemType, WorldState, SimTime } from "./types.js";
import { getInventoryQty, removeFromInventory, addToInventory, feedbackToAgent, unreserveInventory, itemLabel } from "./inventory.js";
import { updatePriceIndex, getAgentMarketplace } from "./marketplace.js";

interface BarterOffer {
  offerer: AgentName;
  receiver: AgentName;
  offerItems: { item: ItemType; quantity: number }[];
  requestItems: { item: ItemType; quantity: number }[];
  text: string;
}

// Agents speak German now, so the speech scanner matches German phrases.
const BARTER_KEYWORDS = ["tausch", "handel", "deal", "gegen", "gebe dir", "geb dir", "gib dir", "biete dir", "biete", "überlasse dir", "ueberlasse dir"];
const ACCEPT_KEYWORDS = ["abgemacht", "einverstanden", "angenommen", "in ordnung", "topp", "deal", "okay", "gern", "geht klar", "passt", "ja gut", "ja,", "ja."];

const ITEM_WORDS: Record<string, ItemType> = {
  gerste: "gerste", mehl: "mehl", brot: "brot", fleisch: "fleisch", milch: "milch",
  ziegenmilch: "milch", eier: "eier", rueben: "rueben", "rüben": "rueben",
  kraeuter: "kraeuter", "kräuter": "kraeuter", arznei: "arznei",
  eisenerz: "eisenerz", kohle: "kohle",
  werkzeug: "werkzeug",
  bauholz: "bauholz", brennholz: "brennholz",
  hausrat: "hausrat", bier: "bier", "dünnbier": "bier", duennbier: "bier",
  eintopf: "eintopf", leinen: "leinen",
};

function parseItemsFromText(text: string): { item: ItemType; quantity: number }[] {
  const lower = text.toLowerCase();
  const results: { item: ItemType; quantity: number }[] = [];

  for (const [word, itemType] of Object.entries(ITEM_WORDS)) {
    const pattern = new RegExp(`(\\d+)\\s+${word}|${word}\\s+(\\d+)|(ein|eine|einen|einem|etwas)\\s+${word}`, "i");
    const match = pattern.exec(lower);
    if (match) {
      const qtyStr = match[1] || match[2];
      const qty = qtyStr ? parseInt(qtyStr) : 1;
      if (!results.find(r => r.item === itemType)) {
        results.push({ item: itemType, quantity: qty });
      }
    }
  }

  return results;
}

function isBarterOffer(text: string): boolean {
  const lower = text.toLowerCase();
  return BARTER_KEYWORDS.some(k => lower.includes(k));
}

function isAcceptance(text: string): boolean {
  const lower = text.toLowerCase();
  return ACCEPT_KEYWORDS.some(k => lower.includes(k));
}

export function resolveBarter(
  results: AgentTurnResult[],
  state: WorldState,
  time: SimTime,
): void {
  // Collect all speech this tick by location
  const speechByAgent: Record<AgentName, string[]> = {} as Record<AgentName, string[]>;
  for (const result of results) {
    speechByAgent[result.agent] = result.actions
      .filter(a => a.type === "speak" && a.text)
      .map(a => a.text!);
  }

  // Look for barter offers + same-tick acceptances
  for (const result of results) {
    const offerer = result.agent;
    const offererLocation = state.agent_locations[offerer];

    for (const speech of speechByAgent[offerer] ?? []) {
      if (!isBarterOffer(speech)) continue;

      const offerItems = parseItemsFromText(speech);
      if (offerItems.length === 0) continue;

      // Find who they might be offering to: agents at same location
      const nearby = results
        .filter(r => r.agent !== offerer && state.agent_locations[r.agent] === offererLocation)
        .map(r => r.agent);

      for (const receiver of nearby) {
        // Check if receiver accepted
        const receiverSpeech = (speechByAgent[receiver] ?? []).join(" ");
        if (!isAcceptance(receiverSpeech)) continue;

        const requestItems = parseItemsFromText(receiverSpeech);
        if (requestItems.length === 0) continue;

        // Validate both have the items
        let valid = true;
        for (const { item, quantity } of offerItems) {
          if (getInventoryQty(state.economics[offerer].inventory, item) < quantity) {
            feedbackToAgent(offerer, state, `[Tausch gescheitert] Du hast nicht genug ${itemLabel(item)}.`);
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        for (const { item, quantity } of requestItems) {
          if (getInventoryQty(state.economics[receiver].inventory, item) < quantity) {
            feedbackToAgent(receiver, state, `[Tausch gescheitert] Du hast nicht genug ${itemLabel(item)}.`);
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        // Execute swap — unreserve first so sell orders don't leave ghost reservations
        for (const { item, quantity } of offerItems) {
          unreserveInventory(offerer, item, quantity, state);
          removeFromInventory(state.economics[offerer].inventory, item, quantity);
          addToInventory(state.economics[receiver].inventory, item, quantity, time.tick);
        }
        for (const { item, quantity } of requestItems) {
          unreserveInventory(receiver, item, quantity, state);
          removeFromInventory(state.economics[receiver].inventory, item, quantity);
          addToInventory(state.economics[offerer].inventory, item, quantity, time.tick);
        }

        const offerStr = offerItems.map(i => `${i.quantity} ${itemLabel(i.item)}`).join(", ");
        const requestStr = requestItems.map(i => `${i.quantity} ${itemLabel(i.item)}`).join(", ");
        feedbackToAgent(offerer, state, `Tausch abgeschlossen: Du gibst ${offerStr} und bekommst ${requestStr}.`);
        feedbackToAgent(receiver, state, `Tausch abgeschlossen: Du gibst ${requestStr} und bekommst ${offerStr}.`);

        // Update price index for both sides (use offerer's village marketplace)
        const offererMkt = getAgentMarketplace(offerer, state);
        for (const { item } of [...offerItems, ...requestItems]) {
          updatePriceIndex(offererMkt, item, offererMkt.priceIndex[item] ?? 1);
        }

        // Push to trade history
        offererMkt.history.push({
          id: `barter_${time.tick}_${offerer}_${receiver}`,
          tick: time.tick,
          buyer: receiver,
          seller: offerer,
          item: offerItems[0]!.item,
          quantity: offerItems[0]!.quantity,
          pricePerUnit: 0,
          total: 0,
        });
      }
    }
  }
}
