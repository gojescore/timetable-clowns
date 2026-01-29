// server/maps/index.js
const map01 = require("./map01");

const MAPS = {
  [map01.id]: map01,
};

function listMaps() {
  return Object.values(MAPS).map((m) => ({ id: m.id, name: m.name }));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function assertRoomOpenings(map) {
  if (!Array.isArray(map.rooms)) return;
  for (const r of map.rooms) {
    const count = Array.isArray(r.openings) ? r.openings.length : 0;
    if (count < 2) {
      throw new Error(`Map ${map.id}: room ${r.id || "(no id)"} has < 2 openings`);
    }
  }
}

// Convert a room rect + openings into wall rectangles.
// We make thin walls around the perimeter, leaving gaps at openings.
function roomToWalls(room, wallT = 30) {
  const { x, y, w, h } = room.rect;

  const doorsN = (room.openings || []).filter(o => o.side === "N");
  const doorsS = (room.openings || []).filter(o => o.side === "S");
  const doorsW = (room.openings || []).filter(o => o.side === "W");
  const doorsE = (room.openings || []).filter(o => o.side === "E");

  const walls = [];

  // Helper: build edge segments with gaps
  function edgeSegments(totalLen, gaps) {
    // gaps: [{start,end}] along edge
    const norm = gaps
      .map(g => ({ start: clamp(g.start, 0, totalLen), end: clamp(g.end, 0, totalLen) }))
      .filter(g => g.end > g.start)
      .sort((a,b) => a.start - b.start);

    const segs = [];
    let cur = 0;
    for (const g of norm) {
      if (g.start > cur) segs.push({ start: cur, end: g.start });
      cur = Math.max(cur, g.end);
    }
    if (cur < totalLen) segs.push({ start: cur, end: totalLen });
    return segs;
  }

  // Top edge (N): x..x+w at y
  {
    const gaps = doorsN.map(d => ({ start: d.at - d.size/2, end: d.at + d.size/2 }));
    const segs = edgeSegments(w, gaps);
    for (const s of segs) walls.push({ x: x + s.start, y: y, w: (s.end - s.start), h: wallT });
  }

  // Bottom edge (S): at y+h-wallT
  {
    const gaps = doorsS.map(d => ({ start: d.at - d.size/2, end: d.at + d.size/2 }));
    const segs = edgeSegments(w, gaps);
    for (const s of segs) walls.push({ x: x + s.start, y: y + h - wallT, w: (s.end - s.start), h: wallT });
  }

  // Left edge (W): y..y+h at x
  {
    const gaps = doorsW.map(d => ({ start: d.at - d.size/2, end: d.at + d.size/2 }));
    const segs = edgeSegments(h, gaps);
    for (const s of segs) walls.push({ x: x, y: y + s.start, w: wallT, h: (s.end - s.start) });
  }

  // Right edge (E): at x+w-wallT
  {
    const gaps = doorsE.map(d => ({ start: d.at - d.size/2, end: d.at + d.size/2 }));
    const segs = edgeSegments(h, gaps);
    for (const s of segs) walls.push({ x: x + w - wallT, y: y + s.start, w: wallT, h: (s.end - s.start) });
  }

  return walls;
}

function buildDerived(map) {
  const derived = structuredClone(map);

  assertRoomOpenings(derived);

  // Start with any pre-defined walls
  const walls = Array.isArray(derived.walls) ? [...derived.walls] : [];

  // Add room perimeter walls (with openings)
  if (Array.isArray(derived.rooms)) {
    for (const r of derived.rooms) {
      walls.push(...roomToWalls(r, 30));
    }
  }

  derived.walls = walls;

  // Flatten machines for easy gameplay later
  const machines = [];
  if (Array.isArray(derived.rooms)) {
    for (const r of derived.rooms) {
      for (const m of (r.machines || [])) {
        machines.push({ ...m, roomId: r.id });
      }
    }
  }
  derived.machines = machines;

  // ============================================================
  // NEW: Attach runtime helpers that structuredClone() would drop
  // ============================================================

  // Road-only check (for money spawning)
  derived.isRoad = function isRoad(x, y) {
    // outside world is never road
    if (!derived.world) return false;
    if (x < 0 || y < 0 || x > derived.world.w || y > derived.world.h) return false;

    const roadAreas = Array.isArray(derived.roadAreas) ? derived.roadAreas : [];
    let inRoad = false;

    for (const r of roadAreas) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        inRoad = true;
        break;
      }
    }
    if (!inRoad) return false;

    // Rooms win: never spawn inside a room rectangle
    if (Array.isArray(derived.rooms)) {
      for (const room of derived.rooms) {
        const rr = room.rect;
        if (!rr) continue;
        if (x >= rr.x && x <= rr.x + rr.w && y >= rr.y && y <= rr.y + rr.h) {
          return false;
        }
      }
    }

    // Walls win: never spawn in any wall rect (includes generated room walls)
    if (Array.isArray(derived.walls)) {
      for (const w of derived.walls) {
        if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) {
          return false;
        }
      }
    }

    return true;
  };

  return derived;
}

function pickMap(mapChoice) {
  const maps = Object.values(MAPS);
  if (!maps.length) throw new Error("No maps registered");

  let base;
  if (!mapChoice || mapChoice === "random") {
    base = maps[Math.floor(Math.random() * maps.length)];
  } else {
    base = MAPS[mapChoice] || maps[0];
  }

  return buildDerived(base);
}

module.exports = { MAPS, listMaps, pickMap };
