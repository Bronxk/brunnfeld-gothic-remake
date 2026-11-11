/**
 * HTTP routes for the observer's "Regie": live roles, simulation control, roads and lore.
 * server.ts delegates to handleRegieRoute(); it returns true when it handled the request.
 *
 *   GET  /api/agents/<id>/role      → role + skills list
 *   POST /api/agents/<id>/role      → { skill?, council?, character? } → { ok, role }   (SSE agent:role)
 *   GET  /api/sim                   → status
 *   POST /api/sim/pause|resume|step → { ok, status }
 *   POST /api/sim/budget            → { ticks: number | null }
 *   POST /api/sim/speed             → { delayMs }
 *   POST /api/sim/barks             → { level: 0 | 1 | 2 }  (colonist barks off / normal / viel)
 *   POST /api/agents/<id>/bark      → { ok, agent, text, kind }   (click bark, no SSE)
 *   GET  /api/world/roads           → roads incl. village names
 *   GET  /api/world/villages-lore   → [{ id, name, description }]
 */

import type { IncomingMessage, ServerResponse } from "http";
import { emitSSE } from "./events.js";
import {
  PLAYER_ID, getNpcNames, getAgentRole, setAgentRole, getSkillOptions, getRoads, getVillages,
  getVillageDescription, getDisplayName,
} from "./world-registry.js";
import { readWorldState } from "./memory.js";
import { getLiveWorldState } from "./player.js";
import { isAgentDead } from "./body.js";
import { clickBark, setBarkLevel } from "./barks.js";
import type { RolePatch } from "./world-registry.js";
import {
  getSimControl, pauseSim, resumeSim, requestStep, setBudget, setTickDelay,
} from "./sim-control.js";

const MAX_BODY_BYTES = 64 * 1024;

type BodyResult = { ok: true; body: Record<string, unknown> } | { ok: false };

/** Reads a JSON object body; anything else (empty, invalid JSON, array, null, too large) is { ok: false }. */
function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise(resolve => {
    let raw = "";
    let tooLarge = false;
    req.on("data", chunk => {
      raw += chunk.toString();
      if (raw.length > MAX_BODY_BYTES) tooLarge = true;
    });
    req.on("error", err => {
      console.warn("[routes-regie] Request-Fehler beim Lesen des Bodys:", err);
      resolve({ ok: false });
    });
    req.on("end", () => {
      if (tooLarge) return resolve({ ok: false });
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          resolve({ ok: true, body: parsed as Record<string, unknown> });
        } else {
          resolve({ ok: false });
        }
      } catch {
        // Invalid JSON is a client error, answered with 400 by the caller.
        resolve({ ok: false });
      }
    });
  });
}

function sendJson(res: ServerResponse, headers: Record<string, string>, status: number, data: unknown): void {
  headers["Content-Type"] = "application/json";
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

const badBody = (res: ServerResponse, headers: Record<string, string>, expected: string) =>
  sendJson(res, headers, 400, { ok: false, error: `Ungültiger Body: erwartet ${expected}.` });

export async function handleRegieRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const method = req.method ?? "GET";

  // ─── Roles ──────────────────────────────────────────────
  const roleRoute = /^\/api\/agents\/([^/]+)\/role$/.exec(path);
  if (roleRoute && (method === "GET" || method === "POST")) {
    let agentId: string;
    try {
      agentId = decodeURIComponent(roleRoute[1]!);
    } catch {
      sendJson(res, headers, 404, { ok: false, error: `Unbekannter Kolonist: ${roleRoute[1]}` });
      return true;
    }
    if (agentId === PLAYER_ID || !getNpcNames().includes(agentId)) {
      sendJson(res, headers, 404, { ok: false, error: `Unbekannter Kolonist: ${agentId}` });
      return true;
    }

    if (method === "GET") {
      try {
        sendJson(res, headers, 200, { ...getAgentRole(agentId), skills: getSkillOptions() });
      } catch (err) {
        console.error(`[routes-regie] getAgentRole(${agentId}) fehlgeschlagen:`, err);
        sendJson(res, headers, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      badBody(res, headers, '{ "skill"?: string, "council"?: boolean, "character"?: string }');
      return true;
    }
    const patch: RolePatch = {};
    if ("skill" in parsed.body) patch.skill = parsed.body["skill"] as RolePatch["skill"];
    if ("council" in parsed.body) patch.council = parsed.body["council"] as boolean;
    if ("character" in parsed.body) patch.character = parsed.body["character"] as string;
    try {
      const role = setAgentRole(agentId, patch);
      emitSSE("agent:role", { agent: agentId, role });
      sendJson(res, headers, 200, { ok: true, role });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[routes-regie] setAgentRole(${agentId}) abgelehnt: ${msg}`);
      sendJson(res, headers, 400, { ok: false, error: msg });
    }
    return true;
  }

  // ─── Click bark (observer clicks a colonist) ────────────
  const barkRoute = /^\/api\/agents\/([^/]+)\/bark$/.exec(path);
  if (barkRoute && method === "POST") {
    let agentId: string;
    try {
      agentId = decodeURIComponent(barkRoute[1]!);
    } catch {
      sendJson(res, headers, 404, { ok: false, error: `Unbekannter Kolonist: ${barkRoute[1]}` });
      return true;
    }
    if (agentId === PLAYER_ID) {
      sendJson(res, headers, 400, { ok: false, error: "Der Beobachter hat keine Sprüche." });
      return true;
    }
    if (!getNpcNames().includes(agentId)) {
      sendJson(res, headers, 404, { ok: false, error: `Unbekannter Kolonist: ${agentId}` });
      return true;
    }
    try {
      // Read-only: the engine's in-memory state while a tick runs, else the saved world.
      const state = getLiveWorldState()?.state ?? readWorldState();
      const body = state.body[agentId];
      if (!body || isAgentDead(body)) {
        sendJson(res, headers, 409, { ok: false, error: `${getDisplayName(agentId)} sagt nichts mehr.` });
        return true;
      }
      const bark = clickBark(state, agentId);
      if (!bark) {
        sendJson(res, headers, 404, { ok: false, error: `${getDisplayName(agentId)} hat gerade nichts zu sagen.` });
        return true;
      }
      sendJson(res, headers, 200, { ok: true, agent: agentId, text: bark.text, kind: bark.kind });
    } catch (err) {
      console.error(`[routes-regie] clickBark(${agentId}) fehlgeschlagen:`, err);
      sendJson(res, headers, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // ─── Simulation control ─────────────────────────────────
  if (path === "/api/sim" && method === "GET") {
    sendJson(res, headers, 200, getSimControl());
    return true;
  }
  if (path.startsWith("/api/sim/") && method === "POST") {
    const action = path.slice("/api/sim/".length);
    const done = () => sendJson(res, headers, 200, { ok: true, status: getSimControl() });
    switch (action) {
      case "pause": pauseSim(); done(); return true;
      case "resume": resumeSim(); done(); return true;
      case "step": requestStep(); done(); return true;
      case "budget": {
        const parsed = await readJsonBody(req);
        if (!parsed.ok || !("ticks" in parsed.body)) {
          badBody(res, headers, '{ "ticks": Zahl | null }');
          return true;
        }
        try {
          setBudget(parsed.body["ticks"] as number | null);
        } catch (err) {
          sendJson(res, headers, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
          return true;
        }
        done();
        return true;
      }
      case "barks": {
        const parsed = await readJsonBody(req);
        const lvl = parsed.ok ? parsed.body["level"] : undefined;
        if (lvl !== 0 && lvl !== 1 && lvl !== 2) {
          sendJson(res, headers, 400, { ok: false, error: "Feld „level“ muss 0, 1 oder 2 sein." });
          return true;
        }
        setBarkLevel(lvl);
        done();
        return true;
      }
      case "speed": {
        const parsed = await readJsonBody(req);
        if (!parsed.ok || !("delayMs" in parsed.body)) {
          badBody(res, headers, '{ "delayMs": Zahl }');
          return true;
        }
        try {
          setTickDelay(parsed.body["delayMs"] as number);
        } catch (err) {
          sendJson(res, headers, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
          return true;
        }
        done();
        return true;
      }
      default:
        return false;
    }
  }

  // ─── World info ─────────────────────────────────────────
  if (path === "/api/world/roads" && method === "GET") {
    const names = new Map(getVillages().map(v => [v.id, v.name]));
    sendJson(res, headers, 200, getRoads().map(r => ({
      ...r,
      villages: r.connectsVillages.map(id => ({ id, name: names.get(id) ?? id })),
    })));
    return true;
  }
  if (path === "/api/world/villages-lore" && method === "GET") {
    sendJson(res, headers, 200, getVillages().map(v => ({
      id: v.id, name: v.name, description: getVillageDescription(v.id),
    })));
    return true;
  }

  return false;
}
