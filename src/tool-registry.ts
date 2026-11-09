import type { AgentAction, AgentName, ItemType, ResolvedAction, WorldState, SimTime } from "./types.js";
import { resolveItemInput } from "./types.js";
import { HUB_LOCATION, isBaseLocation, resolveLocationName } from "./village-map.js";
import type { LocationContext, NegotiationOffer } from "./location-context.js";
import { readAgentMemory, getPeopleSection } from "./memory.js";
import { getInventoryQty, removeFromInventory, addToInventory, feedbackToAgent, itemLabel, skillLabel } from "./inventory.js";
import { getDisplayName, getAgentVillage, getVillages, getVillageElder, getVillageTownHall, getVillageLocations, getVillageForLocation, getLocationType, getRoads, getAllLocations, resolveAgentName } from "./world-registry.js";
import { computeVillageConcerns } from "./village-concerns.js";
import { getAgentMarketplace } from "./marketplace.js";
import { resolveAction, type ResolveContext } from "./tools.js";
import { getProducibleItems, MULTI_FARM_ITEMS } from "./production.js";
import { emitSSE } from "./events.js";
import { getSounds } from "./sounds.js";

// ─── Types ───────────────────────────────────────────────────

export interface ToolResult {
  text: string;
  isInteraction: boolean; // true → harness yields so co-located agents can react
  pendingMove?: string;
  executedAction?: ResolvedAction;
}

export interface HarnessToolConfig {
  agentId: AgentName;
  worldState: WorldState;
  locationCtx: LocationContext;
  time: SimTime;
  movedThisTick: Set<AgentName>;
  executedActions: ResolvedAction[]; // mutated by handlers
  lastTickActions: Record<AgentName, ResolvedAction[]>;
}

export interface ToolDef {
  name: string;
  description: string;
  argsHint: string; // shown in LLM prompt
}

// ─── Helpers ─────────────────────────────────────────────────

function currentLocation(config: HarnessToolConfig): string {
  return config.worldState.agent_locations[config.agentId] ?? "unknown";
}

function makeContext(config: HarnessToolConfig): ResolveContext {
  return {
    agent: config.agentId,
    agentLocation: currentLocation(config),
    state: config.worldState,
    time: config.time,
    movedThisTick: config.movedThisTick,
  };
}

// Order sides are engine-internal ("sell"/"buy"); agents read BIETE / SUCHE.
function sideLabel(side: string): string {
  return side === "sell" ? "BIETE" : "SUCHE";
}

// Object types are engine-internal ids; agents read the German word.
const OBJECT_TYPE_LABELS: Record<string, string> = {
  note: "Notiz", letter: "Brief", notice: "Aushang",
};

// ─── Observation tool handlers ────────────────────────────────

function handleLookAround(_args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const { agentId, worldState, locationCtx, lastTickActions } = config;
  const loc = currentLocation(config);

  const presentAgents = Object.entries(worldState.agent_locations)
    .filter(([a, l]) => a !== agentId && l === loc)
    .map(([a]) => `${getDisplayName(a)} (${skillLabel(worldState.economics[a]?.skill ?? "unbekannt")})`);

  const lines: string[] = [];
  lines.push(presentAgents.length > 0
    ? `Hier sind: ${presentAgents.join(", ")}`
    : "Du bist hier allein.");

  if (locationCtx.speechLog.length > 0) {
    lines.push("Zuletzt gesagt:");
    for (const entry of locationCtx.speechLog.slice(-6)) {
      lines.push(`  ${entry.name}: "${entry.text}"`);
    }
  }

  if (locationCtx.visibleActions.length > 0) {
    lines.push("Sichtbar:");
    for (const a of locationCtx.visibleActions.slice(-4)) {
      lines.push(`  ${a.name} ${a.summary}`);
    }
  }

  if (locationCtx.negotiationOffers.length > 0) {
    lines.push("Offene Angebote:");
    for (const o of locationCtx.negotiationOffers) {
      lines.push(`  ${o.fromName} bietet ${getDisplayName(o.to)} ${o.qty}x ${itemLabel(o.item)} für je ${o.price} Groschen an`);
    }
  }

  // Sounds from adjacent locations (last tick's actions)
  const sounds = getSounds(agentId, loc, lastTickActions, worldState.agent_locations);
  if (sounds.length > 0) lines.push("Geräusche: " + sounds.join(" "));

  // Objects at this location (notices, letters, notes)
  const objects = (worldState.objects ?? []).filter(o =>
    o.location === loc &&
    (o.visibility === "shared" || o.recipient === agentId || o.discovered_by.includes(agentId))
  );
  if (objects.length > 0) {
    lines.push("Gegenstände hier:");
    for (const obj of objects.slice(0, 3)) {
      lines.push(`  [${OBJECT_TYPE_LABELS[obj.type] ?? obj.type}] ${obj.label}: ${obj.content.slice(0, 60)}`);
    }
  }

  // Sell orders visible at marketplace locations
  const isMarket = isBaseLocation(loc, HUB_LOCATION) || loc === "Marketplace";
  if (isMarket) {
    const mkt = getAgentMarketplace(agentId, worldState);
    const topOrders = mkt.orders
      .filter(o => o.type === "sell" && o.agentId !== agentId)
      .sort((a, b) => a.price - b.price)
      .slice(0, 5);
    if (topOrders.length > 0) {
      lines.push("Tauschbrett, BIETE:");
      for (const o of topOrders) lines.push(`  ${o.quantity}x ${itemLabel(o.item)} für je ${o.price} Groschen`);
    }
    const buyOrders = mkt.orders
      .filter(o => o.type === "buy" && o.agentId !== agentId)
      .slice(0, 3);
    if (buyOrders.length > 0) {
      lines.push("Tauschbrett, SUCHE (das wollen die Leute):");
      for (const o of buyOrders) lines.push(`  ${o.quantity}x ${itemLabel(o.item)}, zahlen bis zu ${o.price} Groschen je Stück`);
    }
    const ownOrders = mkt.orders.filter(o => o.agentId === agentId);
    if (ownOrders.length > 0) {
      lines.push("Deine Angebote:");
      for (const o of ownOrders) {
        lines.push(`  ${sideLabel(o.type)} ${o.quantity}x ${itemLabel(o.item)} für je ${o.price} Groschen (ID: ${o.id})`);
      }
    }
  }

  return { text: lines.join("\n"), isInteraction: false };
}

function handleCheckInventory(_args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const eco = config.worldState.economics[config.agentId];
  if (!eco) return { text: "Keine Wirtschaftsdaten.", isInteraction: false };

  const lines = [`Geldbeutel: ${eco.wallet} Groschen`];
  if (eco.inventory.items.length === 0) {
    lines.push("Inventar: leer");
  } else {
    lines.push("Inventar:");
    for (const item of eco.inventory.items) {
      const avail = item.quantity - (item.reserved ?? 0);
      const res = (item.reserved ?? 0) > 0 ? ` (${item.reserved} reserviert)` : "";
      const spoil = item.spoilsAtTick ? ` [verdirbt Stunde ${item.spoilsAtTick}]` : "";
      lines.push(`  ${itemLabel(item.type)}: ${item.quantity} (${avail} frei)${res}${spoil}`);
    }
  }
  if (eco.tool) lines.push(`Werkzeug: ${itemLabel(eco.tool.type)} Zustand ${eco.tool.durability}%`);
  if (eco.hiredBy) lines.push(`Angeheuert von: ${getDisplayName(eco.hiredBy)} (bis Stunde ${eco.hiredUntilTick ?? "?"})`);

  return { text: lines.join("\n"), isInteraction: false };
}

function handleCheckPrices(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const item = resolveItemInput(args.item);
  if (!item) return { text: 'Gib eine Ware an. Beispiel: {"item": "mehl"}', isInteraction: false };

  const mkt = getAgentMarketplace(config.agentId, config.worldState);
  const acquaintances = config.worldState.acquaintances[config.agentId] ?? [];
  const priceIdx = mkt.priceIndex[item as ItemType];

  const lines = [`Preise für ${itemLabel(item)}:`];
  if (priceIdx) lines.push(`  Richtwert: ${priceIdx} Groschen`);

  const sells = mkt.orders
    .filter(o => o.type === "sell" && o.item === item && o.agentId !== config.agentId)
    .sort((a, b) => a.price - b.price);

  if (sells.length > 0) {
    lines.push("  Verkaufsangebote:");
    for (const o of sells.slice(0, 3)) {
      const name = acquaintances.includes(o.agentId) ? getDisplayName(o.agentId) : "jemand";
      lines.push(`    ${o.quantity}x für je ${o.price} Groschen (von ${name})`);
    }
  } else {
    lines.push("  Keine Verkaufsangebote.");
  }

  const recent = (mkt.history ?? []).filter(t => t.item === item).slice(-3);
  if (recent.length > 0) {
    const avg = Math.round(recent.reduce((s, t) => s + t.pricePerUnit, 0) / recent.length);
    lines.push(`  Zuletzt im Schnitt: ${avg} Groschen`);
  }

  return { text: lines.join("\n"), isInteraction: false };
}

function handleCheckBody(_args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const body = config.worldState.body[config.agentId];
  if (!body) return { text: "Keine Körperdaten.", isInteraction: false };

  const hungerLabels = ["satt", "zufrieden", "leicht hungrig", "hungrig", "sehr hungrig", "am Verhungern"];
  const energyLabel = body.energy >= 8 ? "großartig" : body.energy >= 5 ? "gut" : body.energy >= 3 ? "müde" : "erschöpft";
  const sleepLabels: Record<string, string> = { good: "gut", fair: "mäßig", poor: "schlecht" };

  const lines = [
    `Hunger: ${body.hunger}/5 — ${hungerLabels[body.hunger] ?? "unbekannt"}`,
    `Energie: ${body.energy}/10 — ${energyLabel}`,
    `Schlaf: ${sleepLabels[body.sleep_quality] ?? body.sleep_quality}`,
  ];
  if (body.sickness) lines.push(`Krank (Stärke ${body.sickness})`);
  if (body.injury) lines.push(`Verletzt (Stärke ${body.injury})`);

  return { text: lines.join("\n"), isInteraction: false };
}

function handleRecall(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const topic = ((args.topic as string) ?? "").toLowerCase().trim();
  if (!topic) return { text: 'Gib ein Thema an. Beispiel: {"topic": "gerste"}', isInteraction: false };

  let memory: string;
  try { memory = readAgentMemory(config.agentId); } catch {
    return { text: "Keine Erinnerungen gefunden.", isInteraction: false };
  }

  const relevant = memory.split("\n")
    .filter(l => l.toLowerCase().includes(topic))
    .slice(0, 8);

  if (relevant.length === 0) return { text: `Dazu hast du nichts in Erinnerung: "${topic}".`, isInteraction: false };
  return { text: `Erinnerung (${topic}):\n${relevant.join("\n")}`, isInteraction: false };
}

function handleAssessPerson(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const name = String(args.name ?? "").toLowerCase().trim();
  if (!name) return { text: 'Gib einen Namen an. Beispiel: {"name": "Bodo"}', isInteraction: false };

  const acquaintances = config.worldState.acquaintances[config.agentId] ?? [];
  const all = Object.keys(config.worldState.economics);
  const target = resolveAgentName(name, all);

  if (!target) return { text: `Du kennst niemanden namens "${String(args.name).trim()}".`, isInteraction: false };
  if (!acquaintances.includes(target)) {
    return { text: `Du bist ${getDisplayName(target)} noch nicht begegnet.`, isInteraction: false };
  }

  const eco = config.worldState.economics[target];
  const lines = [
    `${getDisplayName(target)}:`,
    `  Handwerk: ${skillLabel(eco?.skill ?? "unbekannt")} | Arbeitsort: ${eco?.workLocation ?? "unbekannt"}`,
  ];

  try {
    const mem = readAgentMemory(config.agentId);
    const peopleSection = getPeopleSection(mem);
    const personLines = peopleSection.split("\n")
      .filter(l => l.toLowerCase().includes(name) || l.toLowerCase().includes(getDisplayName(target).toLowerCase()))
      .slice(0, 3);
    if (personLines.length > 0) {
      lines.push("  Aus deiner Erinnerung:");
      personLines.forEach(l => lines.push(`  ${l.trim()}`));
    }
  } catch { /* no memory */ }

  return { text: lines.join("\n"), isInteraction: false };
}

// ─── Interaction tool handlers ────────────────────────────────

function handleSpeak(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const text = ((args.text as string) ?? "").trim();
  if (!text) return { text: "[Kann nicht sprechen] Kein Text angegeben.", isInteraction: false };

  const resolved = resolveAction({ type: "speak", text }, makeContext(config));

  if (resolved.visible) {
    // Update shared location context so co-located harnesses see this speech via look_around()
    config.locationCtx.speechLog.push({
      agentId: config.agentId,
      name: getDisplayName(config.agentId),
      text,
    });
    // SSE emission is handled post-tick by the engine (same as current behavior)
  }

  config.executedActions.push(resolved);
  return { text: resolved.result || "[Gesagt]", isInteraction: true, executedAction: resolved };
}

function handleNegotiate(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const rawTarget = String(args.agent ?? "");
  const item = resolveItemInput(args.item) ?? "";
  const price = Number(args.price ?? 0);
  const qty = Number(args.qty ?? args.quantity ?? 1);

  const all = Object.keys(config.worldState.economics);
  const target = resolveAgentName(rawTarget, all) as AgentName | null;

  if (!target) {
    return { text: `[Kann nicht verhandeln] Niemanden namens "${args.agent}" gefunden.`, isInteraction: false };
  }

  // Check if a matching counter-offer from target already exists — if so, execute the trade
  const matchIdx = config.locationCtx.negotiationOffers.findIndex(o =>
    o.from === target &&
    o.to === config.agentId &&
    o.item === item &&
    o.qty === qty
  );

  if (matchIdx !== -1) {
    const matched = config.locationCtx.negotiationOffers[matchIdx]!;
    const tradePrice = matched.price; // settle at original offer price
    const agentEco = config.worldState.economics[config.agentId];
    const targetEco = config.worldState.economics[target];
    const agentHas = getInventoryQty(agentEco.inventory, item as ItemType) >= qty;
    const targetHas = getInventoryQty(targetEco.inventory, item as ItemType) >= qty;

    let seller: AgentName, sellerEco: typeof agentEco, buyerEco: typeof agentEco;
    if (targetHas) {
      seller = target; sellerEco = targetEco; buyerEco = agentEco;
    } else if (agentHas) {
      seller = config.agentId; sellerEco = agentEco; buyerEco = targetEco;
    } else {
      config.locationCtx.negotiationOffers.splice(matchIdx, 1);
      return { text: `[Verhandlung] Einigung erzielt, aber keiner von beiden hat ${qty}x ${itemLabel(item)}.`, isInteraction: true };
    }
    const buyer = seller === target ? config.agentId : target;
    const totalCost = tradePrice * qty;

    if (buyerEco.wallet < totalCost) {
      config.locationCtx.negotiationOffers.splice(matchIdx, 1);
      return { text: `[Verhandlung] Einigung erzielt, aber ${getDisplayName(buyer)} kann ${totalCost} Groschen nicht zahlen.`, isInteraction: true };
    }

    removeFromInventory(sellerEco.inventory, item as ItemType, qty);
    addToInventory(buyerEco.inventory, item as ItemType, qty, config.time.tick);
    sellerEco.wallet += totalCost;
    buyerEco.wallet -= totalCost;
    config.locationCtx.negotiationOffers.splice(matchIdx, 1);

    feedbackToAgent(seller, config.worldState, `Verkauft: ${qty} ${itemLabel(item)} an ${getDisplayName(buyer)} für ${totalCost} Groschen (verhandelt).`);
    feedbackToAgent(buyer, config.worldState, `Gekauft: ${qty} ${itemLabel(item)} von ${getDisplayName(seller)} für ${totalCost} Groschen (verhandelt).`);

    const text = `Verkauft: ${getDisplayName(seller)} → ${qty}x ${itemLabel(item)} → ${getDisplayName(buyer)} für ${totalCost} Groschen (verhandelt).`;
    emitSSE("trade", { seller, buyer, item, qty, price: tradePrice, source: "negotiate" });
    const resolved: ResolvedAction = { type: "speak", text: `[Handel] ${qty}x ${itemLabel(item)} für je ${tradePrice} Groschen`, result: text, visible: true };
    config.executedActions.push(resolved);
    return { text, isInteraction: true, executedAction: resolved };
  }

  // No match yet — post the offer so the other party can see and respond
  const offer: NegotiationOffer = {
    from: config.agentId,
    fromName: getDisplayName(config.agentId),
    to: target,
    item,
    price,
    qty,
  };
  config.locationCtx.negotiationOffers.push(offer);
  config.locationCtx.visibleActions.push({
    agentId: config.agentId,
    name: getDisplayName(config.agentId),
    type: "negotiate",
    summary: `bietet ${getDisplayName(target)} ${qty}x ${itemLabel(item)} für je ${price} Groschen an`,
  });

  const resultText = `${getDisplayName(config.agentId)} bietet ${getDisplayName(target)} ${qty}x ${itemLabel(item)} für je ${price} Groschen an.`;
  emitSSE("agent:action", {
    agent: config.agentId,
    actionType: "negotiate",
    text: `${qty}x ${itemLabel(item)} für je ${price} Groschen → ${getDisplayName(target)}`,
    result: resultText,
    location: currentLocation(config),
  });

  const resolved: ResolvedAction = { type: "speak", text: `[Verhandlung] ${qty}x ${itemLabel(item)} für je ${price} Groschen an ${getDisplayName(target)}`, result: resultText, visible: true };
  config.executedActions.push(resolved);
  return { text: resultText, isInteraction: true, executedAction: resolved };
}

function handleProduce(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const item = resolveItemInput(args.item) ?? "";
  const eco = config.worldState.economics[config.agentId];
  const ownSkill = eco?.skill ?? "none";
  // Hired laborers borrow their employer's skill for production
  const employer = eco?.hiredBy ? config.worldState.economics[eco.hiredBy] : null;
  const skill = (ownSkill === "none" && employer) ? (employer.skill ?? "none") : ownSkill;

  // Block if already moved this tick — resolveProduction checks post-move location
  const alreadyMoved = config.executedActions.some(a => a.type === "move_to");
  if (alreadyMoved) {
    return { text: `[Kann nicht herstellen] Du bist diese Runde gegangen. Kehr nächste Runde an deinen Arbeitsort zurück.`, isInteraction: false };
  }

  // Block duplicate produce — one production per turn
  const alreadyProduced = config.executedActions.some(a => a.type === "produce");
  if (alreadyProduced) {
    return { text: `[Kann nicht herstellen] Diese Runde hast du schon etwas hergestellt. Pro Runde nur einmal.`, isInteraction: false };
  }

  // Validate item name against known recipes for this skill
  const producible = getProducibleItems(skill);
  if (producible.length === 0) {
    return { text: `[Kann nicht herstellen] Du hast kein Handwerk. Such dir einen Arbeitgeber: Bitte jemanden mit Handwerk, dich per hire_laborer anzuheuern.`, isInteraction: false };
  }
  const match = producible.find(p => p.item === item);
  if (!match) {
    const list = producible.map(p => {
      const inp = Object.entries(p.inputs).map(([k, v]) => `${v}x ${itemLabel(k)}`).join(", ");
      return inp ? `${itemLabel(p.item)} (braucht: ${inp})` : itemLabel(p.item);
    }).join(", ");
    return { text: `[Kann nicht herstellen] Kein Rezept für "${itemLabel(item)}". Das kannst du herstellen: ${list}`, isInteraction: false };
  }

  // Check ingredients are available before calling resolveAction
  for (const [inputItem, qty] of Object.entries(match.inputs)) {
    const have = getInventoryQty(eco.inventory, inputItem as ItemType);
    if (have < qty) {
      return {
        text: `[Kann nicht herstellen] Für ${itemLabel(item)} brauchst du ${qty}x ${itemLabel(inputItem)}, hast aber nur ${have}. Kauf oder sammle mehr.`,
        isInteraction: false,
      };
    }
  }

  // Check location is valid for this recipe
  const agentLoc = currentLocation(config);
  const validLocations = MULTI_FARM_ITEMS[item] ?? [match.location];
  const agentLocType = getLocationType(agentLoc);
  const atValidLocation = validLocations.includes(agentLoc) ||
    (agentLocType != null && validLocations.some(vl => getLocationType(vl) === agentLocType));
  if (!atValidLocation) {
    const where = validLocations.length === 1
      ? validLocations[0]!
      : `${validLocations.slice(0, -1).join(", ")} oder ${validLocations[validLocations.length - 1]}`;
    return {
      text: `[Kann nicht herstellen] ${itemLabel(item)} stellst du nur dort her: ${where}. Du bist gerade hier: ${agentLoc} — geh erst dorthin.`,
      isInteraction: false,
    };
  }

  const resolved = resolveAction({ type: "produce", item } as AgentAction, makeContext(config));

  if (resolved.visible) {
    config.locationCtx.visibleActions.push({
      agentId: config.agentId,
      name: getDisplayName(config.agentId),
      type: "produce",
      summary: `arbeitet an ${itemLabel(item)}`,
    });
  }

  config.executedActions.push(resolved);
  return { text: resolved.result || `[Arbeit an ${itemLabel(item)}]`, isInteraction: true, executedAction: resolved };
}

function handleMoveTo(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const rawLocation = (args.location as string) ?? "";
  // Normalize ("Muehle", "baderhütte" → exact name) before the cross-village guard looks it up.
  const location = resolveLocationName(rawLocation, getAllLocations()) ?? rawLocation;

  // Cross-village guard: block direct teleport across villages without using the road
  const currentLoc = currentLocation(config);
  const agentLocVillage = getVillageForLocation(currentLoc);
  const destVillage = getVillageForLocation(location);
  const destIsRoad = location.startsWith("Road:");
  const currentIsRoad = currentLoc.startsWith("Road:");
  if (!destIsRoad && !currentIsRoad && agentLocVillage && destVillage && agentLocVillage !== destVillage) {
    const agentVillageName = getVillages().find(v => v.id === agentLocVillage)?.name ?? "";
    const bareDest = location.includes(":") ? location.split(":").slice(1).join(":") : location;
    const localEquiv = agentVillageName ? `${agentVillageName}:${bareDest}` : bareDest;
    const localExists = !!getVillageForLocation(localEquiv);
    const hint = localExists
      ? ` Dein Gegenstück hier heißt "${localEquiv}" — geh lieber dorthin.`
      : ` Du bist in ${agentVillageName}.`;
    return {
      text: `[Dort geht's nicht hin] "${location}" liegt in einer anderen Siedlung.${hint}`,
      isInteraction: false,
    };
  }

  const preMoveLocation = currentLoc;
  const resolved = resolveAction({ type: "move_to", location }, makeContext(config));

  let pendingMove: string | undefined;
  if (resolved.visible) {
    pendingMove = resolved.location ?? location;
    // Emit immediately for map animation (engine skips move_to in post-tick emission)
    emitSSE("agent:action", {
      agent: config.agentId,
      actionType: "move_to",
      location: pendingMove,
      result: resolved.result,
    });
  }

  config.executedActions.push(resolved);

  // After a successful move, describe the new location — the environment speaks
  let moveText = resolved.result || `[Unterwegs] zum Ort ${location}`;
  if (pendingMove) {
    const dest = pendingMove;
    const othersAtDest = Object.entries(config.worldState.agent_locations)
      .filter(([a, l]) => a !== config.agentId && l === dest)
      .map(([a]) => {
        const skill = config.worldState.economics[a]?.skill;
        return skill && skill !== "none" ? `${getDisplayName(a)} (${skillLabel(skill)})` : getDisplayName(a);
      });
    if (othersAtDest.length > 0) {
      moveText += ` Hier sind: ${othersAtDest.join(", ")}.`;
    } else {
      moveText += " Du bist hier allein.";
    }
  }

  return { text: moveText, isInteraction: true, pendingMove, executedAction: resolved };
}

function handlePostOrder(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "post_order",
    side: args.side as "sell" | "buy",
    item: args.item as string,
    quantity: Number(args.qty ?? args.quantity ?? 1),
    price: Number(args.price ?? 0),
  } as AgentAction, makeContext(config));

  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: true, executedAction: resolved };
}

function handleBuyItem(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "buy_item",
    item: args.item as string,
    max_price: Number(args.max_price ?? 0),
    quantity: args.qty != null ? Number(args.qty) : undefined,
  } as AgentAction, makeContext(config));

  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: true, executedAction: resolved };
}

function handleEat(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "eat",
    item: args.item as string,
    quantity: Number(args.qty ?? args.quantity ?? 1),
  } as AgentAction, makeContext(config));

  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: false, executedAction: resolved };
}

// ─── Hire/labor tool handlers ────────────────────────────────

function handleHireLaborer(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const rawTarget = String(args.agent ?? "");
  const wage = Math.max(0, Number(args.wage ?? 5));

  const all = Object.keys(config.worldState.economics);
  const target = resolveAgentName(rawTarget, all) as AgentName | null;

  if (!target) return { text: `[Kann nicht anheuern] Niemanden namens "${args.agent}" gefunden.`, isInteraction: false };

  const loc = config.worldState.agent_locations[config.agentId];
  if (config.worldState.agent_locations[target] !== loc) {
    return { text: `[Kann nicht anheuern] ${getDisplayName(target)} ist nicht hier.`, isInteraction: false };
  }

  const eco = config.worldState.economics[config.agentId];
  if (eco.wallet < wage) {
    return { text: `[Kann nicht anheuern] Du brauchst ${wage} Groschen, hast aber nur ${eco.wallet}.`, isInteraction: false };
  }

  const targetEco = config.worldState.economics[target];
  if (targetEco.hiredBy) {
    return { text: `[Kann nicht anheuern] ${getDisplayName(target)} ist schon von ${getDisplayName(targetEco.hiredBy)} angeheuert.`, isInteraction: false };
  }

  eco.wallet -= wage;
  targetEco.wallet += wage;
  targetEco.hiredBy = config.agentId;
  targetEco.hiredUntilTick = config.time.tick + 16;

  feedbackToAgent(target, config.worldState, `${getDisplayName(config.agentId)} hat dich für den Tag angeheuert (${wage} Groschen). Geh mit und hilf bei der Arbeit.`);

  const text = `${getDisplayName(config.agentId)} hat ${getDisplayName(target)} für ${wage} Groschen angeheuert.`;
  const resolved: ResolvedAction = { type: "speak", text: `[Angeheuert] ${getDisplayName(target)} für ${wage} Groschen`, result: text, visible: true };
  config.executedActions.push(resolved);
  return { text, isInteraction: true, executedAction: resolved };
}

function handleQuitJob(_args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const eco = config.worldState.economics[config.agentId];
  if (!eco.hiredBy) return { text: "[Nicht angeheuert] Du hast gerade keinen Arbeitgeber.", isInteraction: false };
  const employerName = getDisplayName(eco.hiredBy);
  feedbackToAgent(eco.hiredBy, config.worldState, `${getDisplayName(config.agentId)} hat die Arbeit bei dir hingeworfen.`);
  eco.hiredBy = undefined;
  eco.hiredUntilTick = undefined;
  return { text: `Du hast bei ${employerName} gekündigt.`, isInteraction: false };
}

// ─── Planning tool handlers ───────────────────────────────────

function handleThink(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const text = ((args.text as string) ?? "").trim();
  const displayName = getDisplayName(config.agentId);

  // NOTE: `[Gedanke] ` is stripped by viewer/src/components/TownHallView.tsx — keep in sync.
  const resolved: ResolvedAction = { type: "think", text, result: `[Gedanke] ${text}`, visible: false };
  config.executedActions.push(resolved);

  // Stream the think text to viewer
  emitSSE("agent:thinking", { agent: config.agentId, name: displayName });
  emitSSE("agent:stream", { agent: config.agentId, name: displayName, chunk: text });
  emitSSE("agent:stream", { agent: config.agentId, name: displayName, chunk: "" });

  return { text: `[Gedanke] ${text}`, isInteraction: false, executedAction: resolved };
}

function handlePlan(args: Record<string, unknown>, _config: HarnessToolConfig): ToolResult {
  const steps = args.steps;
  const text = Array.isArray(steps) ? steps.join(" → ") : String(steps ?? "");
  return { text: `[Geplant] ${text}`, isInteraction: false };
}

// ─── Village info tool handler ───────────────────────────────

function handleCheckVillage(_args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const { agentId, worldState, time } = config;
  const villageId = getAgentVillage(agentId);
  const lines: string[] = [];

  // Laws
  for (const law of (worldState.active_laws ?? [])) {
    lines.push(`Ratsbeschluss: ${law.description}`);
  }

  // Concerns (elder only)
  const elder = getVillageElder(villageId);
  if (agentId === elder) {
    const concerns = computeVillageConcerns(worldState, time.tick);
    if (concerns.length > 0) lines.push(...concerns);
  }

  // Loans
  for (const loan of (worldState.loans ?? []).filter(l => !l.repaid)) {
    if (loan.creditor === agentId) lines.push(`Dir geschuldet: ${loan.amount} Groschen von ${getDisplayName(loan.debtor)}`);
    if (loan.debtor === agentId) lines.push(`Du schuldest: ${loan.amount} Groschen an ${getDisplayName(loan.creditor)}`);
  }

  // Locations + travel
  const locs = getVillageLocations(villageId);
  lines.push(`Orte: ${locs.join(", ")}`);
  for (const road of getRoads().filter(r => r.connectsVillages.includes(villageId))) {
    const destId = road.connectsVillages.find(v => v !== villageId);
    const destName = getVillages().find(v => v.id === destId)?.name ?? destId;
    lines.push(`Reise: ${road.name} → ${destName} (${road.transitTicks} Stunden)`);
  }

  return { text: lines.join("\n") || "Nichts Besonderes.", isInteraction: false };
}

// ─── Missing action tool handlers ────────────────────────────

function handleSendMessage(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "send_message",
    to: args.to as string,
    text: args.text as string,
  } as AgentAction, makeContext(config));
  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: false, executedAction: resolved };
}

function handleGiveCoin(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "give_coin",
    to: args.to as string,
    amount: Number(args.amount ?? 0),
  } as AgentAction, makeContext(config));
  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: true, executedAction: resolved };
}

function handleSteal(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "steal",
    target: args.target as string,
    item: args.item as string,
  } as AgentAction, makeContext(config));
  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: false, executedAction: resolved };
}

function handleCancelOrder(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const resolved = resolveAction({
    type: "cancel_order",
    order_id: args.order_id as string,
  } as AgentAction, makeContext(config));
  config.executedActions.push(resolved);
  return { text: resolved.result, isInteraction: false, executedAction: resolved };
}

// ─── Governance tool handlers (only available when granted by assembly) ───

function handleFineAgent(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const rawTarget = String(args.target ?? "");
  const amount = Math.max(0, Math.floor(Number(args.amount ?? 0)));
  const reason = (args.reason as string) ?? "kein Grund genannt";

  if (!amount) return { text: "[Kann nicht strafen] Gib einen Betrag an.", isInteraction: false };

  const all = Object.keys(config.worldState.economics);
  const target = resolveAgentName(rawTarget, all) as AgentName | null;
  if (!target) return { text: `[Kann nicht strafen] Niemanden namens "${args.target}" gefunden.`, isInteraction: false };

  const loc = config.worldState.agent_locations[config.agentId];
  if (config.worldState.agent_locations[target] !== loc) {
    return { text: `[Kann nicht strafen] ${getDisplayName(target)} ist nicht hier.`, isInteraction: false };
  }

  const targetEco = config.worldState.economics[target];
  const actual = Math.min(amount, targetEco.wallet);
  targetEco.wallet -= actual;

  // Fine goes to village elder's treasury
  const villageId = getAgentVillage(config.agentId);
  const elder = getVillageElder(villageId);
  if (elder && config.worldState.economics[elder]) {
    config.worldState.economics[elder].wallet += actual;
  }

  config.worldState.violations_log.push({
    tick: config.time.tick,
    agent: target,
    lawId: "fine",
    action: `${actual} Groschen Strafe: ${reason}`,
    blocked: false,
  });

  feedbackToAgent(target, config.worldState, `${getDisplayName(config.agentId)} hat dich mit ${actual} Groschen bestraft. Grund: ${reason}`);

  const text = `${getDisplayName(config.agentId)} bestraft ${getDisplayName(target)} mit ${actual} Groschen. Grund: ${reason}`;
  const resolved: ResolvedAction = { type: "fine_agent", target, text: reason, result: text, visible: true };
  config.executedActions.push(resolved);
  emitSSE("agent:action", { agent: config.agentId, actionType: "fine_agent", text: reason, result: text, location: loc });
  return { text, isInteraction: true, executedAction: resolved };
}

function handleSeizeGoods(args: Record<string, unknown>, config: HarnessToolConfig): ToolResult {
  const rawTarget = String(args.target ?? "");
  const item = resolveItemInput(args.item) ?? "";
  const qty = Math.max(1, Math.floor(Number(args.qty ?? args.quantity ?? 1)));
  const reason = (args.reason as string) ?? "kein Grund genannt";

  const all = Object.keys(config.worldState.economics);
  const target = resolveAgentName(rawTarget, all) as AgentName | null;
  if (!target) return { text: `[Kann nicht beschlagnahmen] Niemanden namens "${args.target}" gefunden.`, isInteraction: false };

  const loc = config.worldState.agent_locations[config.agentId];
  if (config.worldState.agent_locations[target] !== loc) {
    return { text: `[Kann nicht beschlagnahmen] ${getDisplayName(target)} ist nicht hier.`, isInteraction: false };
  }

  const targetEco = config.worldState.economics[target];
  const available = getInventoryQty(targetEco.inventory, item as ItemType);
  if (available <= 0) return { text: `[Kann nicht beschlagnahmen] ${getDisplayName(target)} hat nichts von dieser Ware: ${itemLabel(item)}.`, isInteraction: false };

  const actual = Math.min(qty, available);
  removeFromInventory(targetEco.inventory, item as ItemType, actual);
  addToInventory(config.worldState.economics[config.agentId].inventory, item as ItemType, actual);

  config.worldState.violations_log.push({
    tick: config.time.tick,
    agent: target,
    lawId: "seizure",
    action: `${actual}x ${itemLabel(item)} beschlagnahmt: ${reason}`,
    blocked: false,
  });

  feedbackToAgent(target, config.worldState, `${getDisplayName(config.agentId)} hat dir ${actual} ${itemLabel(item)} abgenommen. Grund: ${reason}`);

  const text = `${getDisplayName(config.agentId)} beschlagnahmt ${actual} ${itemLabel(item)} von ${getDisplayName(target)}. Grund: ${reason}`;
  const resolved: ResolvedAction = { type: "seize_goods", target, text: reason, result: text, visible: true };
  config.executedActions.push(resolved);
  emitSSE("agent:action", { agent: config.agentId, actionType: "seize_goods", text: reason, result: text, location: loc });
  return { text, isInteraction: true, executedAction: resolved };
}

// Governance tools — separate from ALL_TOOL_DEFS, injected dynamically by assembly vote
const GOVERNANCE_TOOL_DEFS: ToolDef[] = [
  { name: "fine_agent",  description: "Straf jemanden hier (zieht Groschen ab, sie gehen in die Kasse des Bergvogts)", argsHint: '{"target": "Kasper", "amount": 5, "reason": "Sperrstunde missachtet"}' },
  { name: "seize_goods", description: "Beschlagnahme Waren von jemandem hier",                                        argsHint: '{"target": "Kasper", "item": "gerste", "qty": 3, "reason": "unbezahlte Schulden"}' },
];

// ─── Tool registry ──────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>, config: HarnessToolConfig) => ToolResult;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  check_inventory: handleCheckInventory,
  recall:         handleRecall,
  assess_person:  handleAssessPerson,
  speak:          handleSpeak,
  negotiate:      handleNegotiate,
  produce:        handleProduce,
  move_to:        handleMoveTo,
  post_order:     handlePostOrder,
  buy_item:       handleBuyItem,
  eat:            handleEat,
  hire_laborer:   handleHireLaborer,
  quit_job:       handleQuitJob,
  send_message:   handleSendMessage,
  give_coin:      handleGiveCoin,
  steal:          handleSteal,
  cancel_order:   handleCancelOrder,
  fine_agent:     handleFineAgent,
  seize_goods:    handleSeizeGoods,
  done:           () => ({ text: "Runde beendet.", isInteraction: false }),
};

const ALL_TOOL_DEFS: ToolDef[] = [
  { name: "check_inventory",description: "Zeig dein Inventar und deinen Geldbeutel",                      argsHint: "{}" },
  { name: "recall",         description: "Durchsuche dein Gedächtnis nach einem Thema",                   argsHint: '{"topic": "gerste handel"}' },
  { name: "assess_person",  description: "Was du über jemanden weißt (nur Bekannte)",                     argsHint: '{"name": "Bodo"}' },
  { name: "speak",          description: "Sag etwas laut — max. 15 Wörter, nur wenn andere da sind",      argsHint: '{"text": "..."}' },
  { name: "negotiate",      description: "Mach jemandem hier ein festes Tauschangebot",                   argsHint: '{"agent": "Bodo", "item": "mehl", "price": 6, "qty": 3}' },
  { name: "produce",        description: "Stell etwas her (du musst an deinem Arbeitsort sein)",          argsHint: '{"item": "mehl"}' },
  { name: "move_to",        description: "Geh an einen Ort",                                              argsHint: `{"location": "${HUB_LOCATION}"}` },
  { name: "post_order",     description: "Schlag ein Kauf- oder Verkaufsgesuch am Tauschbrett an",        argsHint: '{"side": "sell", "item": "mehl", "qty": 3, "price": 6}' },
  { name: "buy_item",       description: `Kauf am Tauschbrett — nur auf dem ${HUB_LOCATION} möglich`,     argsHint: '{"item": "brot", "max_price": 5}' },
  { name: "eat",            description: "Iss etwas aus deinem Inventar",                                 argsHint: '{"item": "brot", "qty": 1}' },
  { name: "send_message",   description: "Schick jemandem eine schriftliche Nachricht (kommt nächste Runde an)", argsHint: '{"to": "Bodo", "text": "..."}' },
  { name: "give_coin",      description: "Gib jemandem hier Groschen",                                    argsHint: '{"to": "Bodo", "amount": 5}' },
  { name: "steal",          description: "Stiehl jemandem hier etwas — du kannst erwischt werden",        argsHint: '{"target": "Kasper", "item": "brot"}' },
  { name: "cancel_order",   description: "Zieh dein Angebot vom Tauschbrett zurück",                      argsHint: '{"order_id": "ord_123"}' },
  { name: "hire_laborer",   description: "Bezahl jemanden hier, heute für dich zu arbeiten (der Ertrag geht an dich)", argsHint: '{"agent": "Wendel", "wage": 5}' },
  { name: "quit_job",       description: "Kündige deine Anstellung und hör auf, für deinen Arbeitgeber zu arbeiten", argsHint: "{}" },
  { name: "done",           description: "Beende deine Runde",                                            argsHint: "{}" },
];

export function getToolsForAgent(
  agentId: AgentName,
  worldState: WorldState,
  locationCtx: LocationContext,
): ToolDef[] {
  const acquaintances = worldState.acquaintances[agentId] ?? [];
  const loc = worldState.agent_locations[agentId];
  const presentOthers = Object.entries(worldState.agent_locations)
    .filter(([a, l]) => a !== agentId && l === loc)
    .map(([a]) => a);

  const eco = worldState.economics[agentId];
  const isHired = !!eco?.hiredBy;

  const filtered = ALL_TOOL_DEFS.filter(t => {
    if (t.name === "assess_person" && acquaintances.length === 0) return false;
    if (t.name === "negotiate" && presentOthers.length === 0) return false;
    if (t.name === "speak" && presentOthers.length === 0) return false;
    if (t.name === "steal" && presentOthers.length === 0) return false;
    if (t.name === "hire_laborer" && presentOthers.length === 0) return false;
    if (t.name === "quit_job" && !isHired) return false;
    return true;
  });

  // Inject governance tools granted by assembly vote
  const grantedToolNames = new Set<string>();
  for (const law of worldState.active_laws ?? []) {
    if (law.type === "grant_tools" && law.grantedTo === agentId && law.grantedTools) {
      for (const t of law.grantedTools) grantedToolNames.add(t);
    }
  }
  if (grantedToolNames.size > 0 && presentOthers.length > 0) {
    const granted = GOVERNANCE_TOOL_DEFS.filter(t => grantedToolNames.has(t.name));
    return [...filtered, ...granted];
  }

  return filtered;
}

export function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  config: HarnessToolConfig,
): ToolResult {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) return { text: `[Unbekanntes Tool: ${toolName}]`, isInteraction: false };
  return handler(args, config);
}

export function formatToolsForPrompt(tools: ToolDef[]): string {
  const obs   = ["check_inventory", "recall", "assess_person"];
  const act   = ["speak", "negotiate", "produce", "move_to", "post_order", "buy_item", "eat", "send_message", "give_coin", "cancel_order", "hire_laborer", "quit_job"];
  const plan  = ["done"];

  const group = (label: string, names: string[]) => {
    const defs = tools.filter(t => names.includes(t.name));
    if (defs.length === 0) return "";
    return `${label}:\n${defs.map(t => `- ${t.name}: ${t.description}. Argumente: ${t.argsHint}`).join("\n")}`;
  };

  return [
    group("Beobachtung (nur lesen)", obs),
    group("Aktion (verändert die Welt)", act),
    group("Planung (intern)", plan),
  ].filter(Boolean).join("\n\n");
}

export function getToolSummary(toolName: string, args: Record<string, unknown>): string {
  const s: Record<string, (a: Record<string, unknown>) => string> = {
    check_inventory:() => "prüft das Inventar",
    recall:         a => `erinnert sich an ${String(a.topic ?? "früher")}`,
    assess_person:  a => `denkt über ${String(a.name ?? "jemanden")} nach`,
    speak:          () => "spricht",
    negotiate:      a => `macht ${String(a.agent ?? "jemandem")} ein Angebot`,
    produce:        a => `arbeitet an ${a.item ? itemLabel(String(a.item)) : "Waren"}`,
    move_to:        a => `geht Richtung ${String(a.location ?? "irgendwohin")}`,
    post_order:     a => `schlägt ein ${a.side ? sideLabel(String(a.side)) : ""}-Gesuch an`,
    buy_item:       a => `kauft ${a.item ? itemLabel(String(a.item)) : "etwas"}`,
    eat:            a => `isst ${a.item ? itemLabel(String(a.item)) : "etwas"}`,
    hire_laborer:   a => `heuert ${String(a.agent ?? "jemanden")} an`,
    quit_job:       () => "kündigt die Anstellung",
    send_message:   a => `schreibt ${String(a.to ?? "jemandem")}`,
    give_coin:      a => `gibt ${String(a.to ?? "jemandem")} ${String(a.amount ?? "?")} Groschen`,
    cancel_order:   a => `zieht Angebot ${String(a.order_id ?? "?")} zurück`,
    steal:          a => `stiehlt ${a.item ? itemLabel(String(a.item)) : "etwas"} von ${String(a.target ?? "jemandem")}`,
    fine_agent:     a => `bestraft ${String(a.target ?? "jemanden")} mit ${String(a.amount ?? "?")} Groschen`,
    seize_goods:    a => `beschlagnahmt ${a.item ? itemLabel(String(a.item)) : "Waren"} von ${String(a.target ?? "jemandem")}`,
    done:           () => "beendet die Runde",
  };
  return s[toolName]?.(args) ?? toolName;
}
