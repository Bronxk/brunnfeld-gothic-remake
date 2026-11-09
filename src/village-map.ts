export const LOCATIONS = [
  "Zechenplatz",
  "Backstube", "Schenke", "Schmiede", "Zimmerei", "Mühle",
  "Vogtei", "Karzer", "Vogtshaus",
  "Baracke 1", "Baracke 2", "Baracke 3", "Baracke 4", "Baracke 5",
  "Baracke 6", "Baracke 7", "Baracke 8", "Baracke 9",
  "Flickstube",
  "Baderhütte",
  "Unterfeld", "Ziegenweide", "Oberfeld",
  "Köhlerwald", "Erzstollen",
  "Schmugglerpfad",
] as const;

export type Location = (typeof LOCATIONS)[number];

// Well-known locations the engine logic depends on. Use these instead of string literals.
export const HUB_LOCATION = "Zechenplatz";
export const PRISON_LOCATION = "Karzer";
export const TOWNHALL_LOCATION = "Vogtei";
export const ELDER_HOME_LOCATION = "Vogtshaus";
export const MERCHANT_CAMP_LOCATION = "Schmugglerpfad";

/** True if `loc` is `base` itself or its multi-village prefixed form ("Prefix:base"). */
export function isBaseLocation(loc: string, base: string): boolean {
  return loc === base || loc.endsWith(`:${base}`);
}

// Adjacency: locations you can hear and move to directly in 1 tick.
// Move to non-adjacent location costs 2 ticks (routed through the hub, Zechenplatz).
export const ADJACENCY: Record<string, string[]> = {
  "Zechenplatz":    ["Backstube", "Schenke", "Vogtei", "Mühle", "Schmiede", "Zimmerei", "Vogtshaus", "Baracke 1", "Unterfeld", "Schmugglerpfad"],
  "Schmugglerpfad": ["Zechenplatz"],
  "Backstube":      ["Zechenplatz", "Mühle"],
  "Schenke":        ["Zechenplatz", "Vogtshaus"],
  "Vogtei":         ["Zechenplatz", "Vogtshaus", "Karzer"],
  "Karzer":         ["Vogtei"],
  "Vogtshaus":      ["Vogtei", "Schenke", "Zechenplatz"],
  "Mühle":          ["Zechenplatz", "Backstube", "Unterfeld"],
  "Schmiede":       ["Zechenplatz", "Zimmerei"],
  "Zimmerei":       ["Zechenplatz", "Schmiede"],
  "Baracke 1":      ["Zechenplatz", "Baracke 2"],
  "Baracke 2":      ["Baracke 1", "Baracke 3"],
  "Baracke 3":      ["Baracke 2", "Baracke 4"],
  "Baracke 4":      ["Baracke 3", "Baracke 5"],
  "Baracke 5":      ["Baracke 4", "Baracke 6"],
  "Baracke 6":      ["Baracke 5", "Baracke 7"],
  "Baracke 7":      ["Baracke 6", "Baracke 8", "Baderhütte"],
  "Baracke 8":      ["Baracke 7", "Baracke 9"],
  "Baracke 9":      ["Baracke 8", "Flickstube"],
  "Flickstube":     ["Baracke 9"],
  "Baderhütte":     ["Baracke 7"],
  "Unterfeld":      ["Zechenplatz", "Mühle", "Ziegenweide"],
  "Ziegenweide":    ["Unterfeld", "Oberfeld"],
  "Oberfeld":       ["Ziegenweide", "Köhlerwald"],
  "Köhlerwald":     ["Oberfeld", "Erzstollen"],
  "Erzstollen":     ["Köhlerwald"],
};

// Opening hours: tick index within day (0 = 06:00, 15 = 21:00)
// Absent = always open.
export const OPENING_HOURS: Partial<Record<string, { open: number; close: number }>> = {
  "Schenke":    { open: 4, close: 15 },   // 10:00–21:00
  "Backstube":  { open: 0, close: 8 },    // 06:00–14:00
  "Schmiede":   { open: 1, close: 10 },   // 07:00–16:00
  "Zimmerei":   { open: 1, close: 10 },
  "Mühle":      { open: 1, close: 10 },
  "Baderhütte": { open: 1, close: 11 },   // 07:00–17:00
};

export function isLocationOpen(location: string, hourIndex: number): boolean {
  const hours = OPENING_HOURS[location];
  if (!hours) return true;
  return hourIndex >= hours.open && hourIndex < hours.close;
}

export function isValidLocation(loc: string): boolean {
  return (LOCATIONS as readonly string[]).includes(loc);
}

export function getAdjacentLocations(location: string): string[] {
  return ADJACENCY[location] ?? [];
}

/**
 * Normalize free-form input (LLM/player) to a comparison key:
 * lowercase, trimmed, umlauts transliterated (ä→ae ö→oe ü→ue ß→ss),
 * whitespace and hyphens collapsed to "_".
 */
export function normalizeKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[\s-]+/g, "_");
}

/**
 * Resolve a location name typed by an LLM/player against a candidate list.
 * Exact match wins; otherwise match by normalizeKey ("Muehle", "mühle" → "Mühle").
 * Village-prefixed input ("Prefix:Name") is matched as a whole first, then by its
 * name part against prefixed or bare candidates.
 */
export function resolveLocationName(input: string, candidates: readonly string[]): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (candidates.includes(trimmed)) return trimmed;

  const key = normalizeKey(trimmed);
  const byKey = candidates.find(c => normalizeKey(c) === key);
  if (byKey) return byKey;

  // Prefixed input ("Prefix:Name"): try the name part against candidates (bare or any prefix).
  const colon = trimmed.indexOf(":");
  if (colon >= 0) {
    const bare = normalizeKey(trimmed.slice(colon + 1));
    const byBare = candidates.find(c => normalizeKey(c) === bare);
    if (byBare) return byBare;
  }
  return null;
}

// Tile coordinates for the village renderer (32×26 tile grid, tile size = 16px × 3x scale)
export const LOCATION_TILES: Record<string, { tx: number; ty: number }> = {
  "Zechenplatz":    { tx: 16, ty: 8  },
  "Backstube":      { tx: 13, ty: 9  },
  "Schenke":        { tx: 15, ty: 9  },
  "Schmiede":       { tx: 20, ty: 9  },
  "Zimmerei":       { tx: 22, ty: 9  },
  "Mühle":          { tx: 8,  ty: 8  },
  "Vogtei":         { tx: 24, ty: 8  },
  "Karzer":         { tx: 25, ty: 9  },
  "Vogtshaus":      { tx: 27, ty: 8  },
  "Baracke 1":      { tx: 2,  ty: 11 },
  "Baracke 2":      { tx: 5,  ty: 11 },
  "Baracke 3":      { tx: 8,  ty: 11 },
  "Baracke 4":      { tx: 13, ty: 11 },
  "Baracke 5":      { tx: 17, ty: 11 },
  "Baracke 6":      { tx: 2,  ty: 13 },
  "Baracke 7":      { tx: 5,  ty: 13 },
  "Baracke 8":      { tx: 9,  ty: 13 },
  "Baracke 9":      { tx: 13, ty: 13 },
  "Flickstube":     { tx: 20, ty: 13 },
  "Baderhütte":     { tx: 24, ty: 14 },
  "Unterfeld":      { tx: 4,  ty: 4  },
  "Ziegenweide":    { tx: 13, ty: 4  },
  "Oberfeld":       { tx: 21, ty: 4  },
  "Köhlerwald":     { tx: 6,  ty: 1  },
  "Erzstollen":     { tx: 28, ty: 1  },
  "Schmugglerpfad": { tx: 16, ty: 5  },
};
