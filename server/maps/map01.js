// server/maps/map01.js
// Training Hall (10 rooms)
//
// NOTE:
// This file is DATA ONLY.
// Because server/maps/index.js uses structuredClone(), functions do not survive.
// So we keep roadAreas here, and buildDerived() attaches derived.isRoad() at runtime.

const W = 2400;
const H = 1600;

// Team zones: corners (rectangles).
// Players on team T spawn ONLY inside teamSpawnZones[T].
const teamSpawnZones = [
  { id: 0, name: "NW", x: 80,      y: 80,      w: 320, h: 260 },
  { id: 1, name: "NE", x: W - 400, y: 80,      w: 320, h: 260 },
  { id: 2, name: "SW", x: 80,      y: H - 340, w: 320, h: 260 },
  { id: 3, name: "SE", x: W - 400, y: H - 340, w: 320, h: 260 },
];

// FFA spawns: scattered around the rectangle perimeter (circumference-ish).
function buildPerimeterSpawns(count) {
  const pts = [];
  const margin = 90;
  const x0 = margin, y0 = margin, x1 = W - margin, y1 = H - margin;

  const perim = 2 * ((x1 - x0) + (y1 - y0));
  for (let i = 0; i < count; i++) {
    const t = (i / count) * perim;
    let d = t;

    const topLen = x1 - x0;
    if (d <= topLen) { pts.push({ x: x0 + d, y: y0 }); continue; }
    d -= topLen;

    const rightLen = y1 - y0;
    if (d <= rightLen) { pts.push({ x: x1, y: y0 + d }); continue; }
    d -= rightLen;

    const botLen = x1 - x0;
    if (d <= botLen) { pts.push({ x: x1 - d, y: y1 }); continue; }
    d -= botLen;

    pts.push({ x: x0, y: y1 - d });
  }

  return pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

const ffaSpawnPoints = buildPerimeterSpawns(12);

module.exports = {
  id: "map01",
  name: "Training Hall (10 rooms)",
  world: { w: W, h: H },

  // Legacy spawns (kept for compatibility / fallback)
  spawns: [
    { x: 220, y: 220 },
    { x: 2180, y: 220 },
    { x: 220, y: 1380 },
    { x: 2180, y: 1380 },
  ],

  // NEW: spawn metadata
  teamSpawnZones,
  ffaSpawnPoints,

  // 10 rooms, each:
  // - exactly 1 machine
  // - at least 2 openings
  rooms: [
    // Row 1 (y ~ 140)
    {
      id: "r1",
      rect: { x: 140, y: 140, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      // old 1 -> new 8
      machines: [{ id: "m1", num: 8, x: 350, y: 270 }],
    },
    {
      id: "r2",
      rect: { x: 620, y: 140, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      // old 2 -> new 2
      machines: [{ id: "m2", num: 2, x: 830, y: 270 }],
    },
    {
      id: "r3",
      rect: { x: 1100, y: 140, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      // old 3 -> new 3
      machines: [{ id: "m3", num: 3, x: 1310, y: 270 }],
    },
    {
      id: "r4",
      rect: { x: 1580, y: 140, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      // old 4 -> new 5
      machines: [{ id: "m4", num: 5, x: 1790, y: 270 }],
    },

    // Row 2 (y ~ 500)
    {
      id: "r5",
      rect: { x: 140, y: 500, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      // old 5 -> new 6
      machines: [{ id: "m5", num: 6, x: 350, y: 630 }],
    },
    {
      id: "r6",
      rect: { x: 620, y: 500, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      // old 6 -> new 1
      machines: [{ id: "m6", num: 1, x: 830, y: 630 }],
    },
    {
      id: "r7",
      rect: { x: 1100, y: 500, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      // old 7 -> new 4
      machines: [{ id: "m7", num: 4, x: 1310, y: 630 }],
    },
    {
      id: "r8",
      rect: { x: 1580, y: 500, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      // old 8 -> new 7
      machines: [{ id: "m8", num: 7, x: 1790, y: 630 }],
    },

    // Row 3 (2 rooms centered)
    {
      id: "r9",
      rect: { x: 500, y: 980, w: 560, h: 360 },
      openings: [
        { side: "E", at: 180, size: 140 },
        { side: "S", at: 280, size: 140 },
      ],
      // old 9 -> new 10
      machines: [{ id: "m9", num: 10, x: 780, y: 1160 }],
    },
    {
      id: "r10",
      rect: { x: 1340, y: 980, w: 560, h: 360 },
      openings: [
        { side: "W", at: 180, size: 140 },
        { side: "S", at: 280, size: 140 },
      ],
      // old 10 -> new 9
      machines: [{ id: "m10", num: 9, x: 1620, y: 1160 }],
    },
  ],

  // Extra obstacle on roads (optional)
  walls: [{ x: 1120, y: 820, w: 160, h: 160 }],

  // =====================================================================
  // ROADS / SPACES ONLY (DATA)
  //
  // Money pickups must spawn on roads/spaces (NOT inside rooms).
  // We model roads as a set of rectangles that represent the corridors.
  // Tweak these rects if money spawns in an unexpected spot.
  // =====================================================================
  roadAreas: [
    // Vertical corridors between row 1 and row 2
    { x: 560, y: 400, w: 60, h: 100 },
    { x: 1040, y: 400, w: 60, h: 100 },
    { x: 1520, y: 400, w: 60, h: 100 },

    // Main horizontal corridor below row 2 / above row 3
    { x: 120, y: 780, w: 1140, h: 160 },
    { x: 1140, y: 780, w: 1140, h: 160 },

    // Vertical connector down between r9 & r10
    { x: 1140, y: 940, w: 120, h: 520 },

    // Bottom corridor
    { x: 120, y: 1380, w: 2160, h: 140 },

    // Outer edge corridors
    { x: 60, y: 120, w: 80, h: 1400 },
    { x: 2260, y: 120, w: 80, h: 1400 },
  ],
};
