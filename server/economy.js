// server/economy.js
// Money pickups + simple money rules.
// Pickups do NOT expire. They disappear only when collected or when the game is deleted.

const PICKUP_TYPE_MONEY = "money";
const MONEY_PICKUP_AMOUNT = 100;   // tweak as desired
const MONEY_PICKUP_RADIUS = 32;   // collection radius

// Treat pickup as having a small "body" so it won't spawn inside walls/machines.
const MONEY_PICKUP_HALF_W = 18;
const MONEY_PICKUP_HALF_H = 12;

function ensurePlayerEconomy(player) {
  if (!player) return;
  if (!Number.isFinite(player.money)) player.money = 0;
}

function getPlayer(game, playerId) {
  if (!game || !game.players) return null;
  return game.players.get(playerId) || null;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function makePickupId() {
  return (
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}

// ---------- Geometry helpers ----------
function aabbIntersects(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randPointInRect(r) {
  return {
    x: randInt(r.x, r.x + r.w),
    y: randInt(r.y, r.y + r.h),
  };
}

function getWorld(map) {
  const w = map?.world?.w;
  const h = map?.world?.h;
  if (Number.isFinite(w) && Number.isFinite(h)) return map.world;
  return { w: 2400, h: 1600 };
}

// map.rooms is [{ rect:{x,y,w,h}, ... }]
function getRoomRects(map) {
  if (!map || !Array.isArray(map.rooms)) return [];
  const out = [];
  for (const r of map.rooms) {
    if (r && r.rect && Number.isFinite(r.rect.x) && Number.isFinite(r.rect.y)) {
      out.push(r.rect);
    }
  }
  return out;
}

// Collide pickup AABB vs walls and machines
function pickupCollides(map, x, y) {
  if (!map) return false;

  const px = x - MONEY_PICKUP_HALF_W;
  const py = y - MONEY_PICKUP_HALF_H;
  const pw = MONEY_PICKUP_HALF_W * 2;
  const ph = MONEY_PICKUP_HALF_H * 2;

  if (Array.isArray(map.walls)) {
    for (const w of map.walls) {
      if (aabbIntersects(px, py, pw, ph, w.x, w.y, w.w, w.h)) return true;
    }
  }

  // machines are 20x20 centered at m.x/m.y in your server collision model
  if (Array.isArray(map.machines)) {
    for (const m of map.machines) {
      const bx = m.x - 10;
      const by = m.y - 10;
      const bw = 20;
      const bh = 20;
      if (aabbIntersects(px, py, pw, ph, bx, by, bw, bh)) return true;
    }
  }

  return false;
}

/**
 * Find a spawn point for money that MUST be on allowed road rectangles.
 *
 * Priority:
 * 1) map.moneySpawnAreas (if you add later)
 * 2) map.roadAreas (your current map01)
 * 3) map.roads (compat)
 *
 * If no areas exist, falls back to "not in rooms" search (still avoids solids).
 */
function findMoneySpawnPoint(game, originX, originY) {
  const map = game?.map || null;
  const world = getWorld(map);
  const roomRects = getRoomRects(map);

  // Validate candidate
  function ok(x, y, requireOnRoad) {
    const cx = clamp(x, MONEY_PICKUP_HALF_W, world.w - MONEY_PICKUP_HALF_W);
    const cy = clamp(y, MONEY_PICKUP_HALF_H, world.h - MONEY_PICKUP_HALF_H);

    if (pickupCollides(map, cx, cy)) return false;

    // never inside rooms (extra safety, even though roads should already avoid them)
    for (const rr of roomRects) {
      if (pointInRect(cx, cy, rr)) return false;
    }

    if (requireOnRoad) {
      const areas = getRoadAreas(map);
      let onRoad = false;
      for (const a of areas) {
        if (pointInRect(cx, cy, a)) { onRoad = true; break; }
      }
      if (!onRoad) return false;
    }

    return { x: cx, y: cy };
  }

  function getRoadAreas(map) {
    const moneySpawnAreas =
      Array.isArray(map?.moneySpawnAreas) && map.moneySpawnAreas.length ? map.moneySpawnAreas : null;

    const roadAreas =
      Array.isArray(map?.roadAreas) && map.roadAreas.length ? map.roadAreas : null;

    const roads =
      Array.isArray(map?.roads) && map.roads.length ? map.roads : null;

    return moneySpawnAreas || roadAreas || roads || [];
  }

  // 1) Preferred: explicit road areas
  const areas = getRoadAreas(map);
  if (areas.length) {
    for (let i = 0; i < 220; i++) {
      const a = areas[randInt(0, areas.length - 1)];
      const p = randPointInRect(a);
      const good = ok(p.x, p.y, true);
      if (good) return good;
    }

    // If areas exist but we failed due to collisions, try many more points
    for (let i = 0; i < 600; i++) {
      const a = areas[randInt(0, areas.length - 1)];
      const p = randPointInRect(a);
      const good = ok(p.x, p.y, true);
      if (good) return good;
    }
  }

  // 2) Fallback: search around origin (still rejects rooms & solids)
  for (let i = 0; i < 240; i++) {
    const r = 200 + i * 8;
    const x = originX + randInt(-r, r);
    const y = originY + randInt(-r, r);
    const good = ok(x, y, false);
    if (good) return good;
  }

  // 3) Last resort: clamp origin (still avoids rooms/solids if possible)
  const last = ok(originX, originY, false);
  return last || { x: clamp(originX, 0, world.w), y: clamp(originY, 0, world.h) };
}

// ---------- Economy API ----------
function awardCorrectAnswer(game, playerId) {
  if (!game) return;
  if (!Array.isArray(game.pickups)) game.pickups = [];

  const p = getPlayer(game, playerId);
  if (!p) return;
  ensurePlayerEconomy(p);

  // IMPORTANT: spawn ONLY on roadAreas (and never inside rooms)
  const spawn = findMoneySpawnPoint(game, p.x, p.y);

  game.pickups.push({
    id: makePickupId(),
    type: PICKUP_TYPE_MONEY,
    x: spawn.x,
    y: spawn.y,
    amount: MONEY_PICKUP_AMOUNT,
    createdAt: Date.now(), // debug only (NO TTL)
  });
}

function penalizeWrongAnswer(game, playerId) {
  const p = getPlayer(game, playerId);
  if (!p) return;
  ensurePlayerEconomy(p);

  p.money = Math.max(0, p.money - 100);
}

function tryCollectPickups(game) {
  if (!game || !Array.isArray(game.pickups) || !game.players) return;
  if (game.pickups.length === 0) return;

  const r2 = MONEY_PICKUP_RADIUS * MONEY_PICKUP_RADIUS;

  for (let i = game.pickups.length - 1; i >= 0; i--) {
    const pk = game.pickups[i];
    if (!pk || pk.type !== PICKUP_TYPE_MONEY) continue;

    let collector = null;

    for (const p of game.players.values()) {
      if (!p) continue;
      ensurePlayerEconomy(p);

      if (dist2(p.x, p.y, pk.x, pk.y) <= r2) {
        collector = p;
        break;
      }
    }

    if (collector) {
      const amt = Number.isFinite(pk.amount) ? pk.amount : MONEY_PICKUP_AMOUNT;
      collector.money = Math.max(0, collector.money + amt);
      game.pickups.splice(i, 1);
    }
  }
}

module.exports = {
  ensurePlayerEconomy,
  awardCorrectAnswer,
  penalizeWrongAnswer,
  tryCollectPickups,
};
