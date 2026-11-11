/**
 * Contract for colonist barks: short, rough one-liners that colonists shout on their own
 * (situational, engine-triggered) or when the observer clicks them. Hand-written, zero tokens,
 * viewer-only flavour: barks never enter agent memory or perception.
 *
 * Content lives in barks-pool.ts, selection and triggers in barks.ts.
 */

/** Situation a bark fits. Every kind has at least the "any" role in BARK_POOL. */
export const BARK_KINDS = [
  "gruss",              // addressed, neutral or grumpy mood
  "abweisen",           // bad mood: hungry, poor, tired — wants to be left alone
  "fremder",            // a colonist from another settlement stands in their settlement ({gegner} = the stranger's settlement)
  "hunger",
  "erschoepft",
  "verletzt",
  "krank",
  "arbeit",             // at their workplace, working (role-specific lines matter here)
  "markt",              // at the Tauschbrett, haggling
  "dieb",               // a theft happened here (victim or witness)
  "arm",                // almost no Groschen
  "reich",              // much more Groschen than the others
  "spannung",           // their settlement is in tension with {gegner}
  "krieg_marsch",       // on the road in a war party against {gegner}
  "krieg_angriff",      // raiding {gegner} right now
  "krieg_verteidigung", // their settlement is raided by {gegner}
  "krieg_sieg",         // the raid / defence against {gegner} was won
  "krieg_niederlage",   // the raid / defence against {gegner} was lost
  "appell",             // the Appell bell rang, they stand at the Vogtei
  "karzer",             // locked up in the Karzer
  "wetter",             // bad weather (rain, cold, ash, storm) while outside
  "nacht",              // awake late at night
] as const;
export type BarkKind = (typeof BARK_KINDS)[number];

/** Who says it. The 12 crafts (Skill without "none"), plus council seat and village elder. */
export const BARK_ROLES = [
  "any",
  "bauer", "hirte", "knappe", "holzfaeller",
  "mueller", "baecker", "schmied", "zimmermann",
  "wirt", "bader", "haendler", "naeherin",
  "rottmeister", // council member (Rat der Rottmeister)
  "vogt",        // the village elder
] as const;
export type BarkRole = (typeof BARK_ROLES)[number];

/**
 * Placeholders a line may use. A line whose placeholder cannot be filled is skipped.
 * - {dorf}:   the speaker's own settlement name
 * - {gegner}: the other settlement involved (only in fremder, spannung, krieg_*)
 */
export const BARK_PLACEHOLDERS = ["{dorf}", "{gegner}"] as const;

/** Pool shape: kind → role → lines. "any" is required for every kind; role lines are preferred when they exist. */
export type BarkPool = Record<BarkKind, { any: readonly string[] } & Partial<Record<Exclude<BarkRole, "any">, readonly string[]>>>;

/** Observer setting: 0 = off, 1 = normal, 2 = viel. Click barks work at every level. */
export type BarkLevel = 0 | 1 | 2;

/** SSE "agent:bark" payload (ambient barks only; click barks come back in the HTTP response). */
export interface BarkEvent {
  agent: string;
  text: string;
  kind: BarkKind;
  location: string;
  tick: number;
}
