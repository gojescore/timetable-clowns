// server/maps/map01.js
// Training Hall (10 rooms)
// Added: roadAreas + isRoad(x,y) for MONEY pickup spawning on roads/spaces only.
// NOTE: This keeps ALL your existing map content unchanged.

module.exports = {
  id: "map01",
  name: "Training Hall (10 rooms)",
  world: { w: 2400, h: 1600 },

  spawns: [
    { x: 140, y: 140 },
    { x: 2260, y: 140 },
    { x: 140, y: 1460 },
    { x: 2260, y: 1460 },
  ],

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
      machines: [{ id: "m1", num: 1, x: 350, y: 270 }],
    },
    {
      id: "r2",
      rect: { x: 620, y: 140, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      machines: [{ id: "m2", num: 2, x: 830, y: 270 }],
    },
    {
      id: "r3",
      rect: { x: 1100, y: 140, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      machines: [{ id: "m3", num: 3, x: 1310, y: 270 }],
    },
    {
      id: "r4",
      rect: { x: 1580, y: 140, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      machines: [{ id: "m4", num: 4, x: 1790, y: 270 }],
    },

    // Row 2 (y ~ 500)
    {
      id: "r5",
      rect: { x: 140, y: 500, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      machines: [{ id: "m5", num: 5, x: 350, y: 630 }],
    },
    {
      id: "r6",
      rect: { x: 620, y: 500, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      machines: [{ id: "m6", num: 6, x: 830, y: 630 }],
    },
    {
      id: "r7",
      rect: { x: 1100, y: 500, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      machines: [{ id: "m7", num: 7, x: 1310, y: 630 }],
    },
    {
      id: "r8",
      rect: { x: 1580, y: 500, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      machines: [{ id: "m8", num: 8, x: 1790, y: 630 }],
    },

    // Row 3 (2 rooms centered)
    {
      id: "r9",
      rect: { x: 500, y: 980, w: 560, h: 360 },
      openings: [
        { side: "E", at: 180, size: 140 },
        { side: "S", at: 280, size: 140 },
      ],
      machines: [{ id: "m9", num: 9, x: 780, y: 1160 }],
    },
    {
      id: "r10",
      rect: { x: 1340, y: 980, w: 560, h: 360 },
      openings: [
        { side: "W", at: 180, size: 140 },
        { side: "S", at: 280, size: 140 },
      ],
      machines: [{ id: "m10", num: 10, x: 1620, y: 1160 }],
    },
  ],

  // Extra obstacle on roads (optional)
  walls: [{ x: 1120, y: 820, w: 160, h: 160 }],

  // =====================================================================
  // NEW: ROADS / SPACES ONLY
  //
  // Money pickups must spawn on roads/spaces (NOT inside rooms).
  // We model roads as a set of rectangles that represent the corridors.
  //
  // These are conservative, "corridor-like" rectangles based on your room
  // layout. If money ever spawns in a wrong place, tweak these rects only.
  // =====================================================================

  // Rects: {x,y,w,h}
  roadAreas: [
    // --- Vertical corridors between the 4 rooms in row 1 and row 2 ---
    // (gap between row1 bottom=400 and row2 top=500 => corridor height ~100)
    { x: 560, y: 400, w: 60, h: 100 },
    { x: 1040, y: 400, w: 60, h: 100 },
    { x: 1520, y: 400, w: 60, h: 100 },

    // --- Main horizontal corridor below row 2 / above row 3 ---
    // (row2 bottom=760, row3 top=980 => big open space)
    // Left side (under row2, reaching toward r9)
    { x: 120, y: 780, w: 1140, h: 160 },
    // Right side (under row2, reaching toward r10)
    { x: 1140, y: 780, w: 1140, h: 160 },

    // --- Vertical connectors down to row 3 rooms (r9 and r10) ---
    // Corridor going down near the middle between r9 & r10
    { x: 1140, y: 940, w: 120, h: 520 },

    // --- Bottom corridor under r9 & r10 (so roads exist near the bottom) ---
    { x: 120, y: 1380, w: 2160, h: 140 },

    // --- Left & right outer edge corridors (optional roaming space) ---
    { x: 60, y: 120, w: 80, h: 1400 },
    { x: 2260, y: 120, w: 80, h: 1400 },
  ],

  // Helper used by economy to ensure road-only spawning.
  // (Point-based check, good enough for pickups.)
  isRoad(x, y) {
    // outside world is never road
    if (x < 0 || y < 0 || x > this.world.w || y > this.world.h) return false;

    for (const r of this.roadAreas) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        // Ensure we don't accidentally consider inside a room as road
        // (If a roadArea overlaps a room by mistake, rooms win.)
        if (this.isInsideAnyRoom(x, y)) return false;
        if (this.isInsideAnyWall(x, y)) return false;
        return true;
      }
    }
    return false;
  },

  // ---- helpers (kept inside map object for convenience) ----
  isInsideAnyRoom(x, y) {
    for (const room of this.rooms) {
      const rr = room.rect;
      if (x >= rr.x && x <= rr.x + rr.w && y >= rr.y && y <= rr.y + rr.h) {
        return true;
      }
    }
    return false;
  },

  isInsideAnyWall(x, y) {
    for (const w of this.walls) {
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) {
        return true;
      }
    }
    return false;
  },
};
