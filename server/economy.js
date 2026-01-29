const C = require("./shared/constants");

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function ensurePlayerEconomy(player) {
  if (typeof player.money !== "number") player.money = C.MONEY_START;
  if (player.money < 0) player.money = 0;
}

function penalizeWrongAnswer(game, playerId) {
  const p = game.players.get(playerId);
  if (!p) return;
  ensurePlayerEconomy(p);
  p.money = Math.max(0, p.money - C.MONEY_WRONG_PENALTY);
}

function awardCorrectAnswer(game, playerId) {
  const p = game.players.get(playerId);
  if (!p) return;
  ensurePlayerEconomy(p);

  if (!Array.isArray(game.pickups)) game.pickups = [];
  const map = game.map;
  if (!map) return;

  for (let i = 0; i < C.MONEY_PICKUPS_PER_CORRECT; i++) {
    const spot = findRoadSpot(game);
    if (!spot) continue;

    game.pickups.push({
      id: uid(),
      type: "money",
      x: spot.x,
      y: spot.y,
      amount: C.MONEY_PICKUP_AMOUNT,
      createdAt: Date.now(),
    });
  }
}

function tryCollectPickups(game) {
  if (!Array.isArray(game.pickups) || game.pickups.length === 0) return;

  const now = Date.now();

  // TTL cleanup first
  game.pickups = game.pickups.filter((pk) => (now - pk.createdAt) <= C.MONEY_PICKUP_TTL_MS);
  if (game.pickups.length === 0) return;

  const r = C.MONEY_PICKUP_RADIUS;
  const r2 = r * r;

  const toRemove = new Set();

  for (const p of game.players.values()) {
    ensurePlayerEconomy(p);

    for (const pk of game.pickups) {
      if (toRemove.has(pk.id)) continue;
      if (pk.type !== "money") continue;

      const dx = p.x - pk.x;
      const dy = p.y - pk.y;
      if ((dx * dx + dy * dy) <= r2) {
        p.money += pk.amount;
        toRemove.add(pk.id);
      }
    }
  }

  if (toRemove.size > 0) {
    game.pickups = game.pickups.filter((pk) => !toRemove.has(pk.id));
  }
}

function spendMoney(game, playerId, amount) {
  const p = game.players.get(playerId);
  if (!p) return false;
  ensurePlayerEconomy(p);
  if (p.money < amount) return false;
  p.money -= amount;
  return true;
}

function findRoadSpot(game) {
  const map = game.map;
  if (!map) return null;

  // Your derived map has isRoad() (we added it in server/maps/index.js buildDerived)
  const hasIsRoad = typeof map.isRoad === "function";
  const areas = Array.isArray(map.roadAreas) ? map.roadAreas : [];

  // Prefer roadAreas rectangles if present
  if (areas.length) {
    for (let t = 0; t < C.MONEY_ROAD_SPAWN_TRIES; t++) {
      const r = areas[(Math.random() * areas.length) | 0];
      const x = r.x + Math.random() * r.w;
      const y = r.y + Math.random() * r.h;

      if (hasIsRoad && !map.isRoad(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  // Fallback: sample random points in world until isRoad says yes
  if (hasIsRoad && map.world) {
    for (let t = 0; t < C.MONEY_ROAD_SPAWN_TRIES; t++) {
      const x = Math.random() * map.world.w;
      const y = Math.random() * map.world.h;
      if (map.isRoad(x, y)) return { x, y };
    }
  }

  return null;
}

module.exports = {
  ensurePlayerEconomy,
  penalizeWrongAnswer,
  awardCorrectAnswer,
  tryCollectPickups,
  spendMoney, // for later upgrades
};
