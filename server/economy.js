// server/economy.js
const {
  MONEY_START,
  MONEY_WRONG_PENALTY,
  MONEY_PICKUP_AMOUNT,
  MONEY_PICKUPS_PER_CORRECT,
  MONEY_PICKUP_RADIUS,
  MONEY_PICKUP_TTL_MS,
  MONEY_ROAD_SPAWN_TRIES,
} = require("./shared/constants");

// Simple id helper (good enough for now)
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function ensurePlayerEconomy(player) {
  if (typeof player.money !== "number") player.money = MONEY_START;
  if (typeof player.lastCheckpoint !== "object") player.lastCheckpoint = null; // used later for respawn
}

function clamp0(n) {
  return n < 0 ? 0 : n;
}

function penalizeWrongAnswer(game, playerId) {
  const p = game.players[playerId];
  if (!p) return;
  ensurePlayerEconomy(p);
  p.money = clamp0(p.money - MONEY_WRONG_PENALTY);
  game.dirty = true;
}

function awardCorrectAnswer(game, playerId) {
  const p = game.players[playerId];
  if (!p) return;
  ensurePlayerEconomy(p);

  if (!Array.isArray(game.pickups)) game.pickups = [];

  for (let i = 0; i < MONEY_PICKUPS_PER_CORRECT; i++) {
    const spot = findRoadSpawnSpot(game);
    if (!spot) continue;

    game.pickups.push({
      id: uid(),
      type: "money",
      x: spot.x,
      y: spot.y,
      amount: MONEY_PICKUP_AMOUNT,
      createdAt: Date.now(),
    });
  }

  game.dirty = true;
}

function spendMoney(game, playerId, amount) {
  const p = game.players[playerId];
  if (!p) return false;
  ensurePlayerEconomy(p);

  if (p.money < amount) return false;
  p.money -= amount;
  game.dirty = true;
  return true;
}

function tryCollectPickups(game) {
  if (!Array.isArray(game.pickups) || game.pickups.length === 0) return;

  const now = Date.now();

  // TTL cleanup
  game.pickups = game.pickups.filter(pk => (now - pk.createdAt) <= MONEY_PICKUP_TTL_MS);

  const r = MONEY_PICKUP_RADIUS;
  const r2 = r * r;

  const players = game.players;
  const pickups = game.pickups;

  // Collect
  const toRemove = new Set();

  for (const pid of Object.keys(players)) {
    const p = players[pid];
    if (!p) continue;
    ensurePlayerEconomy(p);

    for (let i = 0; i < pickups.length; i++) {
      const pk = pickups[i];
      if (!pk || toRemove.has(pk.id)) continue;
      if (pk.type !== "money") continue;

      const dx = (p.x - pk.x);
      const dy = (p.y - pk.y);
      if ((dx*dx + dy*dy) <= r2) {
        p.money += pk.amount;
        toRemove.add(pk.id);
        game.dirty = true;
      }
    }
  }

  if (toRemove.size > 0) {
    game.pickups = pickups.filter(pk => !toRemove.has(pk.id));
  }
}

function findRoadSpawnSpot(game) {
  // We rely on map01.js providing either:
  // - map.roadAreas (array of rects), OR
  // - map.isRoad(x,y) function
  const map = game.map;
  if (!map) return null;

  // Preferred: rects
  if (Array.isArray(map.roadAreas) && map.roadAreas.length) {
    for (let t = 0; t < MONEY_ROAD_SPAWN_TRIES; t++) {
      const rect = map.roadAreas[(Math.random() * map.roadAreas.length) | 0];
      const x = rect.x + Math.random() * rect.w;
      const y = rect.y + Math.random() * rect.h;

      if (map.isWall && map.isWall(x, y)) continue; // if you have this
      if (map.isRoad && !map.isRoad(x, y)) continue; // if you also have this
      return { x, y };
    }
    return null;
  }

  // Fallback: isRoad() sampling
  if (typeof map.isRoad === "function") {
    for (let t = 0; t < MONEY_ROAD_SPAWN_TRIES; t++) {
      const x = Math.random() * map.width;
      const y = Math.random() * map.height;
      if (map.isRoad(x, y)) return { x, y };
    }
  }

  return null;
}

module.exports = {
  ensurePlayerEconomy,
  penalizeWrongAnswer,
  awardCorrectAnswer,
  spendMoney,
  tryCollectPickups,
};
