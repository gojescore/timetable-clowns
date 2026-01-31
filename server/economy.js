// server/economy.js
// Money pickups + simple money rules.
// IMPORTANT: Pickups should NOT expire. They only disappear when collected
// or when the game is deleted (game end).

// Tune these as needed
const PICKUP_TYPE_MONEY = "money";
const MONEY_PICKUP_AMOUNT = 25;     // how much each pickup is worth (you can change)
const MONEY_PICKUP_RADIUS = 18;     // collection radius around pickup center

function ensurePlayerEconomy(player) {
  if (!player) return;
  if (!Number.isFinite(player.money)) player.money = 0;
}

function getPlayer(game, playerId) {
  if (!game || !game.players) return null;
  return game.players.get(playerId) || null;
}

// Small helper: distance squared
function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

// Create a reasonably unique id (good enough for in-memory game)
function makePickupId() {
  return (
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}

/**
 * Spawns 1 money pickup near the player (you can change how many / where).
 * Called after a correct answer.
 */
function awardCorrectAnswer(game, playerId) {
  if (!game) return;
  if (!Array.isArray(game.pickups)) game.pickups = [];

  const p = getPlayer(game, playerId);
  if (!p) return;
  ensurePlayerEconomy(p);

  // spawn near player with small random offset so it doesn't overlap player exactly
  const ox = randRange(-30, 30);
  const oy = randRange(-30, 30);

  game.pickups.push({
    id: makePickupId(),
    type: PICKUP_TYPE_MONEY,
    x: p.x + ox,
    y: p.y + oy,
    amount: MONEY_PICKUP_AMOUNT,
    createdAt: Date.now(), // kept for debugging, NOT used for expiry
  });
}

/**
 * Wrong answer penalty. Floor at 0.
 */
function penalizeWrongAnswer(game, playerId) {
  const p = getPlayer(game, playerId);
  if (!p) return;
  ensurePlayerEconomy(p);

  // You mentioned "wrong answer -100" earlier. Keep that rule.
  p.money = Math.max(0, p.money - 100);
}

/**
 * Called each tick.
 * - Removes money pickups ONLY when a player is close enough (runs over it)
 * - Does NOT remove pickups by age.
 */
function tryCollectPickups(game) {
  if (!game || !Array.isArray(game.pickups) || !game.players) return;

  if (game.pickups.length === 0) return;

  const r2 = MONEY_PICKUP_RADIUS * MONEY_PICKUP_RADIUS;

  // We'll remove collected pickups by iterating backwards
  for (let i = game.pickups.length - 1; i >= 0; i--) {
    const pk = game.pickups[i];
    if (!pk || pk.type !== PICKUP_TYPE_MONEY) continue;

    // Check every player against this pickup
    let collectedBy = null;

    for (const p of game.players.values()) {
      if (!p) continue;
      ensurePlayerEconomy(p);

      // simple circle collection check
      if (dist2(p.x, p.y, pk.x, pk.y) <= r2) {
        collectedBy = p;
        break;
      }
    }

    if (collectedBy) {
      const amt = Number.isFinite(pk.amount) ? pk.amount : MONEY_PICKUP_AMOUNT;
      collectedBy.money = Math.max(0, collectedBy.money + amt);

      // remove pickup from world
      game.pickups.splice(i, 1);
    }
  }
}

// Helpers
function randRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  ensurePlayerEconomy,
  awardCorrectAnswer,
  penalizeWrongAnswer,
  tryCollectPickups,
};
