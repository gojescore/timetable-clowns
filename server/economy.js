// server/economy.js
// Money pickups + simple money rules.
// Pickups do NOT expire. They disappear only when collected or when the game is deleted.

const PICKUP_TYPE_MONEY = "money";
const MONEY_PICKUP_AMOUNT = 25;   // change if you want
const MONEY_PICKUP_RADIUS = 18;   // collection radius around pickup center

// Treat pickup as having a small "body" so it won't spawn inside walls/machines.
const MONEY_PICKUP_HALF_W = 9;
const MONEY_PICKUP_HALF_H = 6;

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

function pickupCollides(map, x, y) {
  if (!map) return false;

  // pickup AABB
  const px = x - MONEY_PICKUP_HALF_W;
  const py = y - MONEY_PICKUP_HALF_H;
  const pw = MONEY_PICKUP_HALF_W * 2;
  const ph = MONEY_PICKUP_HALF_H * 2;

  // collide vs walls
  if (Array.isArray(map.walls)) {
    for (const w of map.walls) {
      if (aabbIntersects(px, py, pw, ph, w.x, w.y, w.w, w.h)) return true;
    }
  }

  // collide vs machines (treat machine as 20x20 centered at m.x/m.y like your server)
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

/**
 * Find a spawn point for money that is NOT in rooms and not colliding with walls/machines.
 *
 * Priority:
 * 1) map.moneySpawnAreas (rects)  <-- recommended for "roads"
 * 2) map.roads (rects)
 * 3) if map.rooms (rects) exists: pick near player but NOT inside any room
 * 4) fallback: near player but still avoids walls/machines
 */
function findMoneySpawnPoint(game, originX, originY) {
  const map = game?.map || null;
  const world = map?.world || { w: 2400, h: 1600 };

  // helper to validate candidate point
  function ok(x, y) {
    // keep in world bounds
    const cx = clamp(x, MONEY_PICKUP_HALF_W, world.w - MONEY_PICKUP_HALF_W);
    const cy = clamp(y, MONEY_PICKUP_HALF_H, world.h - MONEY_PICKUP_HALF_H);

    // not colliding with solids
    if (pickupCollides(map, cx, cy)) return false;

    // if rooms exist, do NOT allow inside rooms
    if (Array.isArray(map?.rooms) && map.rooms.length) {
      for (const r of map.rooms) {
        if (pointInRect(cx, cy, r)) return false;
      }
    }

    return { x: cx, y: cy };
  }

  // 1) explicit allowed spawn areas (BEST)
  const areas =
    (Array.isArray(map?.moneySpawnAreas) && map.moneySpawnAreas.length && map.moneySpawnAreas) ||
    (Array.isArray(map?.roads) && map.roads.length && map.roads) ||
    null;

  if (areas) {
    for (let i = 0; i < 120; i++) {
      const a = areas[randInt(0, areas.length - 1)];
      const p = randPointInRect(a);
      const good = ok(p.x, p.y);
      if (good) return good;
    }
  }

  // 2) Try around player with increasing radius (but will reject rooms if map.rooms exists)
  for (let i = 0; i < 160; i++) {
    const r = 120 + i * 6; // expand search
    const x = originX + randInt(-r, r);
    const y = originY + randInt(-r, r);
    const good = ok(x, y);
    if (good) return good;
  }

  // 3) Last resort: clamp origin, only avoid solids (still respects rooms if rooms are present)
  const last = ok(originX, originY);
  return last || { x: clamp(originX, 0, world.w), y: clamp(originY, 0, world.h) };
}

// ---------- Economy API ----------
function awardCorrectAnswer(game, playerId) {
  if (!game) return;
  if (!Array.isArray(game.pickups)) game.pickups = [];

  const p = getPlayer(game, playerId);
  if (!p) return;
  ensurePlayerEconomy(p);

  // IMPORTANT CHANGE:
  // Spawn money in allowed areas (roads), not in the room where the machine is.
  const spawn = findMoneySpawnPoint(game, p.x, p.y);

  game.pickups.push({
    id: makePickupId(),
    type: PICKUP_TYPE_MONEY,
    x: spawn.x,
    y: spawn.y,
    amount: MONEY_PICKUP_AMOUNT,
    createdAt: Date.now(), // debug only (no TTL)
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

    let collectedBy = null;

    for (const p of game.players.values()) {
      if (!p) continue;
      ensurePlayerEconomy(p);

      if (dist2(p.x, p.y, pk.x, pk.y) <= r2) {
        collectedBy = p;
        break;
      }
    }

    if (collectedBy) {
      const amt = Number.isFinite(pk.amount) ? pk.amount : MONEY_PICKUP_AMOUNT;
      collectedBy.money = Math.max(0, collectedBy.money + amt);
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
