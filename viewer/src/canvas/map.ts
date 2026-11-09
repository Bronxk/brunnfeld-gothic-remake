// ─── Schlackental map layout constants ──────────────────────────────────────────
// Matches backend LOCATION_TILES (tx, ty on 32×26 grid, tile=48px)

export const TILE_SIZE = 48;

export const LOCATION_TILES: Record<string, { tx: number; ty: number }> = {
  "Zechenplatz":        { tx: 16, ty: 8  },
  "Backstube":          { tx: 13, ty: 9  },
  "Schenke":            { tx: 15, ty: 9  },
  "Schmiede":           { tx: 20, ty: 9  },
  "Zimmerei":           { tx: 22, ty: 9  },
  "Mühle":              { tx: 8,  ty: 8  },
  "Vogtei":             { tx: 24, ty: 8  },
  "Karzer":             { tx: 25, ty: 9  },
  "Vogtshaus":          { tx: 27, ty: 8  },
  "Baracke 1":          { tx: 2,  ty: 11 },
  "Baracke 2":          { tx: 5,  ty: 11 },
  "Baracke 3":          { tx: 8,  ty: 11 },
  "Baracke 4":          { tx: 13, ty: 11 },
  "Baracke 5":          { tx: 17, ty: 11 },
  "Baracke 6":          { tx: 2,  ty: 13 },
  "Baracke 7":          { tx: 5,  ty: 13 },
  "Baracke 8":          { tx: 9,  ty: 13 },
  "Baracke 9":          { tx: 13, ty: 13 },
  "Flickstube":         { tx: 20, ty: 13 },
  "Baderhütte":         { tx: 24, ty: 14 },
  "Unterfeld":          { tx: 4,  ty: 4  },
  "Ziegenweide":        { tx: 13, ty: 4  },
  "Oberfeld":           { tx: 21, ty: 4  },
  "Köhlerwald":         { tx: 6,  ty: 1  },
  "Erzstollen":         { tx: 28, ty: 1  },
  "Schmugglerpfad":     { tx: 16, ty: 5  },
};

export const ADJACENCY: [string, string][] = [
  ["Zechenplatz", "Schmugglerpfad"],
  ["Zechenplatz", "Backstube"],
  ["Zechenplatz", "Schenke"],
  ["Zechenplatz", "Vogtei"],
  ["Zechenplatz", "Mühle"],
  ["Zechenplatz", "Schmiede"],
  ["Zechenplatz", "Zimmerei"],
  ["Zechenplatz", "Vogtshaus"],
  ["Zechenplatz", "Baracke 1"],
  ["Zechenplatz", "Unterfeld"],
  ["Backstube", "Mühle"],
  ["Schenke", "Vogtshaus"],
  ["Vogtei", "Vogtshaus"],
  ["Vogtei", "Karzer"],
  ["Mühle", "Unterfeld"],
  ["Schmiede", "Zimmerei"],
  ["Baracke 1", "Baracke 2"],
  ["Baracke 2", "Baracke 3"],
  ["Baracke 3", "Baracke 4"],
  ["Baracke 4", "Baracke 5"],
  ["Baracke 5", "Baracke 6"],
  ["Baracke 6", "Baracke 7"],
  ["Baracke 7", "Baracke 8"],
  ["Baracke 7", "Baderhütte"],
  ["Baracke 8", "Baracke 9"],
  ["Baracke 9", "Flickstube"],
  ["Unterfeld", "Ziegenweide"],
  ["Ziegenweide", "Oberfeld"],
  ["Oberfeld", "Köhlerwald"],
  ["Köhlerwald", "Erzstollen"],
];

// Building image path and display size for each location
export const LOCATION_BUILDINGS: Record<string, { img: string; w: number; h: number; label?: string }> = {
  "Zechenplatz":        { img: "", w: 0, h: 0, label: "Zechenplatz" },  // open area, no building
  "Backstube":          { img: "/assets/buildings/House2.png", w: 80, h: 120, label: "Backstube" },
  "Schenke":            { img: "/assets/buildings/House3.png", w: 80, h: 120, label: "Schenke" },
  "Schmiede":           { img: "/assets/buildings/Barracks.png", w: 100, h: 133, label: "Schmiede" },
  "Zimmerei":           { img: "/assets/buildings/Barracks.png", w: 100, h: 133, label: "Zimmerei" },
  "Mühle":              { img: "/assets/buildings/Tower.png", w: 72, h: 144, label: "Mühle" },
  "Vogtei":             { img: "/assets/buildings/Monastery.png", w: 110, h: 183, label: "Vogtei" },
  "Karzer":             { img: "/assets/buildings/Tower.png", w: 64, h: 128, label: "Karzer" },
  "Vogtshaus":          { img: "/assets/buildings/Castle.png", w: 130, h: 104, label: "Vogtshaus" },
  "Baracke 1":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Baracke 1" },
  "Baracke 2":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Baracke 2" },
  "Baracke 3":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Baracke 3" },
  "Baracke 4":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Baracke 4" },
  "Baracke 5":          { img: "/assets/buildings/House2.png", w: 64, h: 96, label: "Baracke 5" },
  "Baracke 6":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Baracke 6" },
  "Baracke 7":          { img: "/assets/buildings/House2.png", w: 64, h: 96, label: "Baracke 7" },
  "Baracke 8":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Baracke 8" },
  "Baracke 9":          { img: "/assets/buildings/House1.png", w: 64, h: 96, label: "Baracke 9" },
  "Flickstube":         { img: "/assets/buildings/House3.png", w: 64, h: 96, label: "Flickstube" },
  "Baderhütte":         { img: "/assets/buildings/House2.png", w: 64, h: 96, label: "Baderhütte" },
  "Unterfeld":          { img: "/assets/buildings/Archery.png", w: 100, h: 133, label: "Unterfeld" },
  "Ziegenweide":        { img: "/assets/buildings/Archery.png", w: 100, h: 133, label: "Ziegenweide" },
  "Oberfeld":           { img: "/assets/buildings/Archery.png", w: 100, h: 133, label: "Oberfeld" },
  "Köhlerwald":         { img: "", w: 0, h: 0, label: "Köhlerwald" },
  "Erzstollen":         { img: "/assets/buildings/Tower.png", w: 64, h: 128, label: "Erzstollen" },
  "Schmugglerpfad":     { img: "", w: 0, h: 0, label: "Schmugglerpfad" },
};

export function tilePx(tile: { tx: number; ty: number }): { x: number; y: number } {
  return { x: tile.tx * TILE_SIZE, y: tile.ty * TILE_SIZE };
}

// ─── Dynamic tile/building overrides for multi-village support ────────────

let _activeTiles: Record<string, { tx: number; ty: number }> | null = null;
let _activeBuildings: Record<string, { img: string; w: number; h: number; label?: string }> | null = null;

export function setActiveTiles(tiles: Record<string, { tx: number; ty: number }> | null): void {
  _activeTiles = tiles;
}
export function setActiveBuildings(b: Record<string, { img: string; w: number; h: number; label?: string }> | null): void {
  _activeBuildings = b;
}
export function getActiveTiles(): Record<string, { tx: number; ty: number }> {
  return _activeTiles ?? LOCATION_TILES;
}
export function getActiveBuildings(): Record<string, { img: string; w: number; h: number; label?: string }> {
  return _activeBuildings ?? LOCATION_BUILDINGS;
}

/** Derive LOCATION_BUILDINGS-compatible data from world_config locationTiles + locationTypes. */
export function buildingsFromVillage(
  locationTiles: Record<string, { tx: number; ty: number }>,
  locationTypes: Record<string, string>,
): Record<string, { img: string; w: number; h: number; label?: string }> {
  const result: Record<string, { img: string; w: number; h: number; label?: string }> = {};
  for (const name of Object.keys(locationTiles)) {
    const type = locationTypes[name] ?? inferLocationType(name);
    result[name] = typeToBuilding(type, name);
  }
  return result;
}

function inferLocationType(name: string): string {
  // Strip village prefix (e.g. "Rabenstollen:Unterfeld" → "Unterfeld")
  const bare = name.includes(":") ? name.split(":").slice(1).join(":") : name;
  const l = bare.toLowerCase();
  if (l.startsWith("baracke")) return "cottage";
  if (l === "unterfeld" || l === "ziegenweide" || l === "oberfeld") return "farm";
  if (l === "köhlerwald") return "forest";
  if (l === "erzstollen") return "mine";
  if (l === "zechenplatz") return "square";
  if (l === "vogtei") return "townhall";
  if (l === "vogtshaus") return "elder";
  if (l === "karzer") return "prison";
  if (l === "mühle") return "mill";
  if (l === "schmiede") return "forge";
  if (l === "backstube") return "bakery";
  if (l === "schenke") return "tavern";
  if (l === "zimmerei") return "carpenter";
  if (l === "baderhütte") return "healer";
  if (l === "flickstube") return "seamstress";
  if (l === "schmugglerpfad") return "merchant";
  return "cottage";
}

function typeToBuilding(type: string, label: string): { img: string; w: number; h: number; label: string } {
  switch (type) {
    case "farm":       return { img: "/assets/buildings/Archery.png",   w: 100, h: 133, label };
    case "forge":
    case "carpenter":  return { img: "/assets/buildings/Barracks.png",  w: 100, h: 133, label };
    case "mill":
    case "mine":
    case "prison":     return { img: "/assets/buildings/Tower.png",     w: 64,  h: 128, label };
    case "townhall":   return { img: "/assets/buildings/Monastery.png", w: 110, h: 183, label };
    case "elder":      return { img: "/assets/buildings/Castle.png",    w: 130, h: 104, label };
    case "tavern":
    case "seamstress": return { img: "/assets/buildings/House3.png",    w: 80,  h: 120, label };
    case "bakery":     return { img: "/assets/buildings/House2.png",    w: 80,  h: 120, label };
    case "healer":     return { img: "/assets/buildings/House2.png",    w: 64,  h: 96,  label };
    case "square":
    case "forest":
    case "merchant":   return { img: "", w: 0, h: 0, label };
    case "cottage":
    default:           return { img: "/assets/buildings/House1.png",    w: 64,  h: 96,  label };
  }
}

export function locationPx(name: string): { x: number; y: number } {
  const tile = getActiveTiles()[name];
  if (!tile) return { x: 0, y: 0 };
  return tilePx(tile);
}

/** Find tile by bare location name (e.g. "Unterfeld" matches "Rabenstollen:Unterfeld"). */
export function findTile(bareName: string): { tx: number; ty: number } | undefined {
  const tiles = getActiveTiles();
  return tiles[bareName] ?? Object.entries(tiles).find(([k]) => k.endsWith(`:${bareName}`))?.[1];
}

// Canvas world size
export const WORLD_W = 32 * TILE_SIZE;  // 1536
export const WORLD_H = 26 * TILE_SIZE;  // 1248
