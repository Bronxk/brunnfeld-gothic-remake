/**
 * HTTP routes for the war / diplomacy mechanic ("Krieg anzetteln").
 *
 *   GET  /api/war            → { villages, relations (every pair), log (last 30), provokeKinds }
 *   POST /api/war/provoke    { from, to, kind }
 *   POST /api/war/declare    { aggressor, target }
 *   POST /api/war/peace      { a, b }
 *   POST /api/war/tribute    { payer, receiver, amount }
 *
 * Concurrency: while a tick runs the engine owns the state in memory, so mutations are applied to
 * that live object (it persists them itself at the end of the tick). Between ticks the state is
 * read, changed and written synchronously (no await between read and write), so it cannot
 * interleave with the engine either.
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { WorldState, VillageRelation } from "./types.js";
import { readWorldState, writeWorldState } from "./memory.js";
import { getLiveWorldState } from "./player.js";
import { getVillages } from "./world-registry.js";
import {
  PROVOKE_KINDS, resolveVillageId, relationOrDefault, provoke, declareWar, makePeace, payTribute,
  type WarResult,
} from "./war.js";

const MAX_BODY_BYTES = 64 * 1024;

type Json = Record<string, unknown>;

function send(res: ServerResponse, headers: Record<string, string>, status: number, body: unknown): void {
  res.writeHead(status, { ...headers, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const TOO_BIG = Symbol("too-big");

/**
 * Parsed JSON object, null for an empty/invalid/non-object body, TOO_BIG for an oversized one
 * (resolved as soon as the limit is crossed; nothing is buffered beyond it).
 */
function readJsonBody(req: IncomingMessage): Promise<Json | null | typeof TOO_BIG> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    req.on("data", (c: Buffer | string) => {
      if (done) return;
      const buf = typeof c === "string" ? Buffer.from(c) : c;
      bytes += buf.length;
      if (bytes > MAX_BODY_BYTES) {
        done = true;
        chunks.length = 0;
        resolve(TOO_BIG);
        return;
      }
      chunks.push(buf);
    });
    req.on("error", err => {
      if (done) return;
      done = true;
      console.error(`[routes-war] request stream error: ${err}`);
      resolve(null);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        const parsed: unknown = JSON.parse(raw);
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : null);
      } catch (err) {
        console.warn(`[routes-war] invalid JSON body: ${(err as Error).message}`);
        resolve(null);
      }
    });
  });
}

/** Live (mid-tick) or freshly read state, plus how to persist a change to it. */
function acquire(): { state: WorldState; tick: number; persist: () => void } {
  const live = getLiveWorldState();
  if (live) return { state: live.state, tick: live.tick, persist: () => {} };
  const state = readWorldState();
  return { state, tick: state.current_tick, persist: () => writeWorldState(state) };
}

function allRelations(state: WorldState): VillageRelation[] {
  const vs = getVillages();
  const out: VillageRelation[] = [];
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) out.push(relationOrDefault(state, vs[i]!.id, vs[j]!.id));
  }
  return out;
}

/** Resolve a village field; sends 400/404 itself and returns null on failure. */
function village(
  body: Json, field: string, res: ServerResponse, headers: Record<string, string>,
): string | null {
  const raw = body[field];
  if (typeof raw !== "string" || !raw.trim()) {
    send(res, headers, 400, { ok: false, error: `Feld „${field}“ fehlt (Name oder ID einer Siedlung).` });
    return null;
  }
  const id = resolveVillageId(raw);
  if (!id) {
    send(res, headers, 404, { ok: false, error: `Unbekannte Siedlung: „${raw}“.` });
    return null;
  }
  return id;
}

function finish(
  res: ServerResponse, headers: Record<string, string>, r: WarResult, persist: () => void,
): void {
  if (!r.ok) return send(res, headers, 400, { ok: false, error: r.error });
  persist();
  send(res, headers, 200, { ok: true, relation: r.relation, event: r.event ?? null, warEnded: r.warEnded ?? false });
}

export async function handleWarRoute(
  req: IncomingMessage, res: ServerResponse, path: string, headers: Record<string, string>,
): Promise<boolean> {
  if (path !== "/api/war" && !path.startsWith("/api/war/")) return false;
  const method = req.method ?? "GET";

  try {
    if (path === "/api/war") {
      if (method !== "GET") { send(res, headers, 405, { ok: false, error: "Nur GET erlaubt." }); return true; }
      const { state } = acquire();
      send(res, headers, 200, {
        villages: getVillages().map(v => ({ id: v.id, name: v.name })),
        relations: allRelations(state),
        log: (state.war_log ?? []).slice(-30),
        provokeKinds: PROVOKE_KINDS.map(k => ({ id: k.id, label: k.label })),
      });
      return true;
    }

    const action = path.slice("/api/war/".length);
    if (!["provoke", "declare", "peace", "tribute"].includes(action)) return false;
    if (method !== "POST") { send(res, headers, 405, { ok: false, error: "Nur POST erlaubt." }); return true; }

    const body = await readJsonBody(req);
    if (body === TOO_BIG) {
      // Answer 413 and drop the connection once the answer is out; never keep buffering the upload.
      res.writeHead(413, { ...headers, "Content-Type": "application/json", Connection: "close" });
      res.end(JSON.stringify({ ok: false, error: `Request-Body zu groß (max. ${MAX_BODY_BYTES} Bytes).` }), () => req.destroy());
      return true;
    }
    if (!body) {
      send(res, headers, 400, { ok: false, error: "Ungültiger oder leerer Request-Body (JSON-Objekt erwartet)." });
      return true;
    }

    if (action === "provoke") {
      const from = village(body, "from", res, headers); if (!from) return true;
      const to = village(body, "to", res, headers); if (!to) return true;
      if (typeof body["kind"] !== "string") {
        send(res, headers, 400, { ok: false, error: `Feld „kind“ fehlt. Möglich: ${PROVOKE_KINDS.map(k => k.id).join(", ")}.` });
        return true;
      }
      const { state, tick, persist } = acquire();
      finish(res, headers, provoke(state, tick, from, to, body["kind"]), persist);
    } else if (action === "declare") {
      const aggressor = village(body, "aggressor", res, headers); if (!aggressor) return true;
      const target = village(body, "target", res, headers); if (!target) return true;
      const { state, tick, persist } = acquire();
      finish(res, headers, declareWar(state, tick, aggressor, target), persist);
    } else if (action === "peace") {
      const a = village(body, "a", res, headers); if (!a) return true;
      const b = village(body, "b", res, headers); if (!b) return true;
      const { state, tick, persist } = acquire();
      finish(res, headers, makePeace(state, tick, a, b), persist);
    } else {
      const payer = village(body, "payer", res, headers); if (!payer) return true;
      const receiver = village(body, "receiver", res, headers); if (!receiver) return true;
      // Missing amount = the tribute that ends a war (war.requiredTribute); a given one must be a positive number.
      const rawAmount = body["amount"];
      const amount = rawAmount == null ? NaN : Number(rawAmount);
      if (rawAmount != null && (!Number.isFinite(amount) || amount < 1)) {
        send(res, headers, 400, { ok: false, error: "Feld „amount“ muss eine Zahl ≥ 1 (Groschen) sein; ohne Angabe gilt der Tribut, der einen Krieg beendet." });
        return true;
      }
      const { state, tick, persist } = acquire();
      finish(res, headers, payTribute(state, tick, payer, receiver, amount), persist);
    }
    return true;
  } catch (err) {
    console.error(`[routes-war] ${method} ${path} failed: ${(err as Error).stack ?? err}`);
    if (!res.headersSent) send(res, headers, 500, { ok: false, error: "Interner Fehler im Kriegsmodul." });
    return true;
  }
}
