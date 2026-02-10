// server/index.js
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { pickMap } = require("./maps");

// --------------------
// economy + upgrades
// --------------------
const economy = require("./economy");
const upgrades = require("./upgrades/apply");

// --------------------
// Config
// --------------------
const PORT = process.env.PORT || 3000;

const CODE_LEN = 5;
const MAX_PLAYERS = 12;

const MIN_TEAMS = 1;
const MAX_TEAMS = 4;

// FFA / Teams
const GAME_MODE_FFA = "ffa";
const GAME_MODE_TEAMS = "teams";

// Table
const MIN_TABLE = 1;
const MAX_TABLE = 10;

// Tick + movement
const TICK_HZ = 20;
const TICK_MS = Math.floor(1000 / TICK_HZ);
const PLAYER_SPEED = 220;

// Collision sizes
const PLAYER_HALF = 14;
const INTERACT_RADIUS = 60;
const MACHINE_HALF = 10;

// Shooting / bullets
const BULLET_SPEED = 780;
const BULLET_TTL = 2.0;

// Separate radii for tuning
const BULLET_HIT_R_WALL = 4;
const BULLET_HIT_R_MACHINE = 6;

// Player hit radius tuning
const CAKE_HIT_R_PLAYER = 12;

const FIRE_COOLDOWN = 0.5;
const RESPAWN_INVULN = 0.6;
const CORNER_PAD = 80;

// Cakes (ammo)
const MAX_CAKES = 7;

// Timed session defaults
const SESSION_STANDARD = "standard";
const SESSION_TIMED = "timed";
const MIN_SESSION_MIN = 1;
const MAX_SESSION_MIN = 60;

// ✅ Win modes
const WIN_MODE_STANDARD = "standard";
const WIN_MODE_MONEY = "money";

// ✅ Mines
const MINE_STEP_ON_TRIGGER_R = 32;
const MINE_BLAST_R = 180;

// ✅ Dash attack (“Rubber chicken”) collision rules
const DASH_HIT_R_PLAYER = 18; // extra reach beyond player radius (we add PLAYER_HALF when checking)

// ✅ Big Nose (permanent, one-time lethal bullet save)
const BIG_NOSE_ID = "big_nose";
const BIG_NOSE_INVULN_MS = 250; // brief invuln after save
const BIG_NOSE_PUSH_DIST = 260; // tune later
const BIG_NOSE_PUSH_STEP = 12; // collision-safe stepping

// ✅ Banana Shot (consumable projectile)
const BANANA_KIND = "banana";
const BANANA_DEFAULT_BOUNCES = 5; // allowed bounces; disappears on the 6th wall hit
const BANANA_STICK_NUDGE = 0.5; // px nudge after bounce to avoid re-hitting same wall

// ✅ Jack in the Box (fog reveal object)
const JACK_BOX_HALF = 14; // used for optional collision, and debug sizing
const JACK_BOX_DEFAULT_TTL_SEC = 999999;
const JACK_BOX_DEFAULT_REVEAL_R = 260;
const JACK_BOX_DEFAULT_MAX_ACTIVE = 1;

// In-memory game store
const games = Object.create(null);

// --------------------
// Helpers
// --------------------
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function genCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < CODE_LEN; i++) code += alphabet[randInt(0, alphabet.length - 1)];
  return code;
}

function createUniqueCode() {
  let code = genCode();
  while (games[code]) code = genCode();
  return code;
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  const xi = Math.floor(x);
  return Math.max(min, Math.min(max, xi));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getWorldForGame(game) {
  const w = game?.map?.world?.w;
  const h = game?.map?.world?.h;
  if (Number.isFinite(w) && Number.isFinite(h)) return game.map.world;
  return { w: 2400, h: 1600 };
}

function lobbySummary(game) {
  return {
    players: [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
    })),
    settings: game.settings,
  };
}

function emitLobbyUpdate(io, game) {
  io.to(game.code).emit("LOBBY_UPDATE", lobbySummary(game));
}

function removePlayerFromGame(io, game, playerId) {
  game.players.delete(playerId);
  if (game.players.size === 0) {
    delete games[game.code];
    return;
  }
  emitLobbyUpdate(io, game);
}

// ✅ Movement speed uses server-side computed mods (XL shoes later, dash, etc.)
function getMoveSpeed(player, nowMs) {
  const base = PLAYER_SPEED;
  upgrades.ensureUpgradeState(player);
  upgrades.ensureEffectState(player);
  const mods = upgrades.computePlayerMods(player, nowMs);
  const mult = Number.isFinite(mods?.speedMult) ? mods.speedMult : 1.0;
  return base * mult;
}

// ✅ Dash helpers (SINGLE SOURCE: player.effects.dash)
function isDashing(player, nowMs) {
  const d = player?.effects?.dash;
  return !!(d && Number.isFinite(d.untilMs) && nowMs < d.untilMs);
}
function endDashNow(player, nowMs) {
  upgrades.ensureEffectState(player);
  if (player.effects.dash && Number.isFinite(player.effects.dash.untilMs)) {
    player.effects.dash.untilMs = nowMs;
  } else {
    player.effects.dash = null;
  }
}

// --- Collision helpers (AABB)
function aabbIntersects(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function collidesAt(game, cx, cy) {
  const map = game.map;
  if (!map) return false;

  const px = cx - PLAYER_HALF;
  const py = cy - PLAYER_HALF;
  const pw = PLAYER_HALF * 2;
  const ph = PLAYER_HALF * 2;

  if (Array.isArray(map.walls)) {
    for (const w of map.walls) {
      if (aabbIntersects(px, py, pw, ph, w.x, w.y, w.w, w.h)) return true;
    }
  }

  if (Array.isArray(map.machines)) {
    for (const m of map.machines) {
      const bx = m.x - MACHINE_HALF;
      const by = m.y - MACHINE_HALF;
      const bw = MACHINE_HALF * 2;
      const bh = MACHINE_HALF * 2;
      if (aabbIntersects(px, py, pw, ph, bx, by, bw, bh)) return true;
    }
  }

  return false;
}

// ✅ Big Nose helpers (uses permanent upgrades; does NOT affect mines/dash)
function hasBigNose(player) {
  upgrades.ensureUpgradeState(player);
  const perm = player?.upgrades?.permSlots;
  if (!Array.isArray(perm)) return false;
  return perm.some((s) => s && s.id === BIG_NOSE_ID && ((s.count | 0) > 0));
}

function consumeBigNose(player) {
  upgrades.ensureUpgradeState(player);
  const perm = player?.upgrades?.permSlots;
  if (!Array.isArray(perm)) return false;

  const idx = perm.findIndex((s) => s && s.id === BIG_NOSE_ID && ((s.count | 0) > 0));
  if (idx < 0) return false;

  const c = perm[idx].count | 0;
  if (c > 1) perm[idx].count = c - 1;
  else perm.splice(idx, 1);

  return true;
}

function pushVictimAwayFromShooter(game, victim, shooter, dist) {
  const world = getWorldForGame(game);

  let dx = 1,
    dy = 0;
  if (shooter && Number.isFinite(shooter.x) && Number.isFinite(shooter.y)) {
    dx = victim.x - shooter.x;
    dy = victim.y - shooter.y;
  } else if (Number.isFinite(victim.dirX) && Number.isFinite(victim.dirY)) {
    dx = victim.dirX;
    dy = victim.dirY;
  }

  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  const steps = Math.max(1, Math.ceil(dist / BIG_NOSE_PUSH_STEP));
  let x = victim.x;
  let y = victim.y;

  for (let k = 0; k < steps; k++) {
    const nx = clamp(x + dx * BIG_NOSE_PUSH_STEP, PLAYER_HALF, world.w - PLAYER_HALF);
    const ny = clamp(y + dy * BIG_NOSE_PUSH_STEP, PLAYER_HALF, world.h - PLAYER_HALF);

    if (collidesAt(game, nx, ny)) break;

    x = nx;
    y = ny;
  }

  victim.x = x;
  victim.y = y;

  victim.dirX = dx;
  victim.dirY = dy;
}

function snapshotForGame(game) {
  const world = getWorldForGame(game);
  const nowMs = Date.now();

  return {
    time: nowMs,
    world,
    phase: game.phase,
    endAt: Number.isFinite(game.endAt) ? game.endAt : null,
    pickups: Array.isArray(game.pickups) ? game.pickups : [],
    mines: Array.isArray(game.mines)
      ? game.mines.map((m) => ({
          id: m.id,
          ownerId: m.ownerId,
          ownerTeamId: m.ownerTeamId,
          x: m.x,
          y: m.y,
          armed: Number.isFinite(m.armedAt) ? nowMs >= m.armedAt : true,
          triggerR: Number.isFinite(m.triggerR) ? m.triggerR : MINE_STEP_ON_TRIGGER_R,
          blastR: Number.isFinite(m.blastR) ? m.blastR : MINE_BLAST_R,
          r: Number.isFinite(m.r) ? m.r : 26,
        }))
      : [],
    jackBoxes: Array.isArray(game.jackBoxes)
      ? game.jackBoxes.map((j) => ({
          id: j.id,
          ownerId: j.ownerId,
          ownerTeamId: j.ownerTeamId,
          x: j.x,
          y: j.y,
          revealR: Number.isFinite(j.revealR) ? j.revealR : JACK_BOX_DEFAULT_REVEAL_R,
          expiresAt: Number.isFinite(j.expiresAt) ? j.expiresAt : null,
        }))
      : [],
    bullets: Array.isArray(game.bullets)
      ? game.bullets.map((b) => ({
          id: b.id,
          ownerId: b.ownerId,
          ownerTeamId: b.ownerTeamId,
          kind: b.kind || "cake",
          x: b.x,
          y: b.y,
        }))
      : [],
    players: [...game.players.values()].map((p) => {
      upgrades.ensureUpgradeState(p);
      upgrades.ensureEffectState(p);

      const mods = upgrades.computePlayerMods(p, nowMs);

      const perm = (p.upgrades.permSlots || []).map((s) => ({
        id: s.id,
        count: Number.isFinite(s.count) ? s.count : 1,
        info: upgrades.getUpgradeInfo ? upgrades.getUpgradeInfo(s.id) : null,
      }));

      const cons = (p.upgrades.consSlots || []).map((s) => ({
        id: s.id,
        usesLeft: Number.isFinite(s.usesLeft) ? s.usesLeft : undefined,
        info: upgrades.getUpgradeInfo ? upgrades.getUpgradeInfo(s.id) : null,
      }));

      return {
        id: p.id,
        name: p.name,
        teamId: p.teamId,
        x: p.x,
        y: p.y,
        dirX: p.dirX,
        dirY: p.dirY,
        nextMachineNum: p.nextMachineNum,
        money: typeof p.money === "number" ? p.money : 0,
        upgrades: { permanent: perm, slots: cons },
        mods,
        cakes: Number.isFinite(p.cakes) ? p.cakes : MAX_CAKES,
        alive: !!p.alive,
        invulnUntil: Number.isFinite(p.invulnUntil) ? p.invulnUntil : 0,
        balloon: p.effects?.balloon
          ? {
              stage: p.effects.balloon.stage || null,
              untilMs: Number.isFinite(p.effects.balloon.untilMs) ? p.effects.balloon.untilMs : null,
            }
          : null,
        stats: {
          kills: p.stats?.kills || 0,
          deaths: p.stats?.deaths || 0,
          correct: p.stats?.correct || 0,
        },
      };
    }),
  };
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function findNearbyMachine(game, x, y, radius) {
  const map = game.map;
  if (!map || !Array.isArray(map.machines)) return null;

  const r2 = radius * radius;
  let best = null;
  let bestD2 = Infinity;

  for (const m of map.machines) {
    const d2 = dist2(x, y, m.x, m.y);
    if (d2 <= r2 && d2 < bestD2) {
      best = m;
      bestD2 = d2;
    }
  }
  return best;
}

// Sweep segment vs circle (player hits)
function segmentHitsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-9) return dist2(x1, y1, cx, cy) <= r * r;

  let t = ((cx - x1) * dx + (cy - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return dist2(px, py, cx, cy) <= r * r;
}

// ✅ Sweep segment vs AABB returning earliest hit t (0..1), slab method.
function segmentHitAABB(x1, y1, x2, y2, rx, ry, rw, rh) {
  const minX = rx,
    maxX = rx + rw;
  const minY = ry,
    maxY = ry + rh;

  const dx = x2 - x1;
  const dy = y2 - y1;

  let tmin = 0;
  let tmax = 1;

  const EPS = 1e-12;

  if (Math.abs(dx) < EPS) {
    if (x1 < minX || x1 > maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - x1) * inv;
    let t2 = (maxX - x1) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dy) < EPS) {
    if (y1 < minY || y1 > maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - y1) * inv;
    let t2 = (maxY - y1) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (tmin < 0 || tmin > 1) return null;
  return { t: tmin };
}

// ✅ Banana bounce reflection helper: flip vx or vy based on closest AABB face at hit point.
function reflectVelocityOnAABBHit(hitX, hitY, rx, ry, rw, rh, vx, vy) {
  const left = Math.abs(hitX - rx);
  const right = Math.abs(hitX - (rx + rw));
  const top = Math.abs(hitY - ry);
  const bottom = Math.abs(hitY - (ry + rh));
  const m = Math.min(left, right, top, bottom);

  if (m === left || m === right) return { vx: -vx, vy };
  return { vx, vy: -vy };
}

function makePromptId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
function makeOfferId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
function makeBulletId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
function makeMineId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
function makeJackBoxId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// --------------------
// Respawn options
// --------------------
function cornerSpawns(world) {
  return [
    { id: "c:NW", label: "Corner NW", x: CORNER_PAD, y: CORNER_PAD },
    { id: "c:NE", label: "Corner NE", x: world.w - CORNER_PAD, y: CORNER_PAD },
    { id: "c:SW", label: "Corner SW", x: CORNER_PAD, y: world.h - CORNER_PAD },
    { id: "c:SE", label: "Corner SE", x: world.w - CORNER_PAD, y: world.h - CORNER_PAD },
  ];
}

function buildRespawnOptions(game, player) {
  const world = getWorldForGame(game);
  const opts = [];

  for (const c of cornerSpawns(world)) {
    opts.push({ id: c.id, label: c.label, x: c.x, y: c.y, kind: "corner" });
  }

  const map = game.map;
  if (map && Array.isArray(map.machines) && player?.clearedMachines instanceof Set) {
    for (const mid of player.clearedMachines) {
      const m = map.machines.find((mm) => mm.id === mid);
      if (!m) continue;
      opts.push({
        id: "m:" + m.id,
        label: `Machine #${m.num}`,
        x: m.x,
        y: m.y,
        kind: "machine",
        machineId: m.id,
        machineNum: m.num,
      });
    }
  }

  const corners = opts.filter((o) => o.kind === "corner");
  const machines = opts
    .filter((o) => o.kind === "machine")
    .sort((a, b) => (a.machineNum || 0) - (b.machineNum || 0));

  return [...corners, ...machines];
}

function forceToValidPos(game, x, y) {
  const world = getWorldForGame(game);
  const minX = PLAYER_HALF;
  const minY = PLAYER_HALF;
  const maxX = world.w - PLAYER_HALF;
  const maxY = world.h - PLAYER_HALF;

  const baseX = clamp(x, minX, maxX);
  const baseY = clamp(y, minY, maxY);

  if (!collidesAt(game, baseX, baseY)) return { x: baseX, y: baseY };

  const steps = 16;
  const radius = 36;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const nx = clamp(baseX + Math.cos(a) * radius, minX, maxX);
    const ny = clamp(baseY + Math.sin(a) * radius, minY, maxY);
    if (!collidesAt(game, nx, ny)) return { x: nx, y: ny };
  }

  return { x: baseX, y: baseY };
}

// --------------------
// Leaderboard / End game
// --------------------
function getWinMode(game) {
  const raw = String(game?.settings?.winMode || WIN_MODE_STANDARD).toLowerCase();
  return raw === WIN_MODE_MONEY ? WIN_MODE_MONEY : WIN_MODE_STANDARD;
}

function compareRowsForGame(game, a, b) {
  const winMode = getWinMode(game);

  if (winMode === WIN_MODE_MONEY) {
    return (b.money - a.money) || (b.correct - a.correct) || (b.kills - a.kills) || (a.deaths - b.deaths);
  }

  return (b.correct - a.correct) || (b.kills - a.kills) || (b.money - a.money) || (a.deaths - b.deaths);
}

function buildLeaderboard(game) {
  return [...game.players.values()]
    .map((pl) => ({
      id: pl.id,
      name: pl.name,
      teamId: pl.teamId,
      money: Number.isFinite(pl.money) ? pl.money : 0,
      correct: pl.stats?.correct || 0,
      kills: pl.stats?.kills || 0,
      deaths: pl.stats?.deaths || 0,
    }))
    .sort((a, b) => compareRowsForGame(game, a, b));
}

function computeTeamWinner(game, leaderboard) {
  const byTeam = new Map();

  for (const row of leaderboard) {
    const tid = row.teamId;
    if (tid === null || tid === undefined) continue;
    if (!byTeam.has(tid)) byTeam.set(tid, { teamId: tid, correct: 0, kills: 0, money: 0, deaths: 0 });
    const agg = byTeam.get(tid);
    agg.correct += row.correct || 0;
    agg.kills += row.kills || 0;
    agg.money += row.money || 0;
    agg.deaths += row.deaths || 0;
  }

  const teams = [...byTeam.values()];
  if (!teams.length) {
    const top = leaderboard[0] || null;
    return { winnerTeamId: null, winnerId: top ? top.id : null, winnerName: top ? top.name : null };
  }

  teams.sort((a, b) => compareRowsForGame(game, a, b));

  const winnerTeamId = teams[0].teamId;
  const topPlayer = leaderboard.find((r) => r.teamId === winnerTeamId) || leaderboard[0] || null;

  return { winnerTeamId, winnerId: topPlayer ? topPlayer.id : null, winnerName: topPlayer ? topPlayer.name : null };
}

function computeWinners(game, extra = {}) {
  const leaderboard = buildLeaderboard(game);

  const forcedWinnerId = extra && typeof extra.winnerId === "string" ? extra.winnerId : null;
  const forcedWinnerName = extra && typeof extra.winnerName === "string" ? extra.winnerName : null;

  if (forcedWinnerId) {
    const pl = game.players.get(forcedWinnerId) || null;
    const winnerTeamId =
      game.settings?.mode === GAME_MODE_TEAMS ? (pl && Number.isFinite(pl.teamId) ? pl.teamId : null) : null;

    return {
      leaderboard,
      winnerId: forcedWinnerId,
      winnerName: forcedWinnerName || (pl ? pl.name : null),
      winnerTeamId,
    };
  }

  if (game.settings?.mode === GAME_MODE_TEAMS) {
    const t = computeTeamWinner(game, leaderboard);
    return { leaderboard, winnerId: t.winnerId, winnerName: t.winnerName, winnerTeamId: t.winnerTeamId };
  }

  const top = leaderboard[0] || null;
  return { leaderboard, winnerId: top ? top.id : null, winnerName: top ? top.name : null, winnerTeamId: null };
}

function endGame(io, game, reason, extra = {}) {
  if (!game || game.phase !== "running") return;

  game.phase = "ended";
  game.endedAt = Date.now();

  const winners = computeWinners(game, extra);

  const payload = {
    ...extra,
    reason,
    endedAt: game.endedAt,

    winnerId: winners.winnerId,
    winnerName: winners.winnerName,
    winnerTeamId: winners.winnerTeamId,

    leaderboard: winners.leaderboard,
    winMode: getWinMode(game),
  };

  io.to(game.code).emit("GAME_ENDED", payload);
  io.to(game.code).emit("STATE_SNAPSHOT", snapshotForGame(game));
}

// ✅ NEW: Return-to-lobby reset (server-authoritative)
function resetGameToLobby(game) {
  if (!game) return;

  game.phase = "lobby";
  game.map = null;

  // clear match runtime entities
  game.pickups = [];
  game.mines = [];
  game.bullets = [];
  game.jackBoxes = [];

  // clear match timers
  game.startedAt = null;
  game.endAt = null;
  game.endedAt = null;

  // keep settings + players + teams
  for (const p of game.players.values()) {
    p.nextMachineNum = 1;
    p.clearedMachines = new Set();
    p.lastCorrectMachineId = null;

    p.pendingPrompt = null;
    p.pendingUpgradeOffer = null;
    p.pendingRespawn = null;

    p.alive = true;
    p.invulnUntil = 0;
    p.fireCd = 0;
    p.cakes = MAX_CAKES;

    p.killedByName = null;
    p.killedById = null;

    // upgrades/effects reset (safest)
    p.upgrades = null;
    upgrades.ensureUpgradeState(p);
    upgrades.ensureEffectState(p);
    p.effects.dash = null;
    p.effects.balloon = null;

    // reset money + stats for a new match
    p.money = 100;
    p.stats = { kills: 0, deaths: 0, correct: 0 };

    // clear input (includes aim)
    p.input = { up: false, down: false, left: false, right: false, fire: false, aimX: 0, aimY: 0 };
  }
}

// --------------------
// Express + HTTP + Socket.IO
// --------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const CLIENT_PATH = path.resolve(__dirname, "..", "client");
app.use(express.static(CLIENT_PATH));
app.get("/health", (req, res) => res.json({ ok: true }));

// --------------------
// Server tick loop
// --------------------
let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  for (const code of Object.keys(games)) {
    const game = games[code];
    if (!game || game.phase !== "running") continue;

    if (game.settings?.sessionMode === SESSION_TIMED && Number.isFinite(game.endAt) && now >= game.endAt) {
      endGame(io, game, "time");
      continue;
    }

    const world = getWorldForGame(game);

    // ✅ Jack boxes TTL cleanup
    if (!Array.isArray(game.jackBoxes)) game.jackBoxes = [];
    for (let j = game.jackBoxes.length - 1; j >= 0; j--) {
      const box = game.jackBoxes[j];
      if (!box) {
        game.jackBoxes.splice(j, 1);
        continue;
      }
      if (Number.isFinite(box.expiresAt) && now >= box.expiresAt) {
        game.jackBoxes.splice(j, 1);
        continue;
      }
    }

    // ---- players move + shoot + dash-hit ----
    for (const p of game.players.values()) {
      if (!p.alive) continue;

      upgrades.ensureEffectState(p);

      // 🔒 Prompt/offer open blocks gameplay input (move + shoot) on server
      const uiBlocksGameplay = !!(p.pendingPrompt || p.pendingUpgradeOffer);

      // ✅ BALLOON enforcement
      let balloonStage = null;
      const bs = p.effects.balloon;
      if (
        bs &&
        Number.isFinite(bs.preUntilMs) &&
        Number.isFinite(bs.phaseUntilMs) &&
        Number.isFinite(bs.postUntilMs)
      ) {
        const prevStage = bs.stage || null;

        if (now < bs.preUntilMs) balloonStage = "pre";
        else if (now < bs.phaseUntilMs) balloonStage = "phase";
        else if (now < bs.postUntilMs) balloonStage = "post";
        else balloonStage = null;

        bs.stage = balloonStage;

        // Transition: phase -> post = check if ended inside wall/machine => die
        if (prevStage === "phase" && balloonStage === "post") {
          if (collidesAt(game, p.x, p.y)) {
            if (!p.stats) p.stats = { kills: 0, deaths: 0, correct: 0 };
            p.stats.deaths += 1;

            p.killedByName = "Wall";
            p.killedById = null;

            p.alive = false;
            p.input = { up: false, down: false, left: false, right: false, fire: false, aimX: 0, aimY: 0 };
            p.fireCd = 0;
            p.cakes = 0;
            p.pendingPrompt = null;
            p.pendingUpgradeOffer = null;

            const opts = buildRespawnOptions(game, p);
            p.pendingRespawn = { options: opts.map((o) => o.id), createdAt: now };

            const targetSocket = p.socketId || p.id;

            io.to(targetSocket).emit("RESPAWN_OPTIONS", {
              killedBy: p.killedByName || "Wall",
              options: opts.map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
            });

            io.to(code).emit("PLAYER_DIED", { playerId: p.id });
            continue;
          }
        }

        // End effect after post
        if (!balloonStage) {
          p.effects.balloon = null;
        }
      }

      const stunnedByBalloon = balloonStage === "pre" || balloonStage === "post";
      const phaseThroughWalls = balloonStage === "phase";

      // if stunned OR UI-blocked, kill any active dash right away
      if ((stunnedByBalloon || uiBlocksGameplay) && isDashing(p, now)) endDashNow(p, now);

      const dashing = !stunnedByBalloon && !uiBlocksGameplay && isDashing(p, now);

      // Store pre-move position for sweep hits
      const prevPX = p.x;
      const prevPY = p.y;

      // ✅ Aim presence (for KBM): if aimX/aimY present, use it for facing
      const hasAim =
        !stunnedByBalloon &&
        !uiBlocksGameplay &&
        !dashing &&
        Number.isFinite(p.input?.aimX) &&
        Number.isFinite(p.input?.aimY) &&
        Math.hypot(p.input.aimX, p.input.aimY) > 1e-6;

      // If dashing: force movement direction from dash.dirX/Y
      let vx = 0,
        vy = 0;

      if (stunnedByBalloon || uiBlocksGameplay) {
        vx = 0;
        vy = 0;

        // allow standing aim direction to update facing for KBM (optional, safe)
        if (hasAim) {
          p.dirX = p.input.aimX;
          p.dirY = p.input.aimY;
        }
      } else if (dashing) {
        const d = p.effects.dash || {};
        const dx = Number.isFinite(d.dirX) ? d.dirX : Number.isFinite(p.dirX) ? p.dirX : 1;
        const dy = Number.isFinite(d.dirY) ? d.dirY : Number.isFinite(p.dirY) ? p.dirY : 0;
        const dlen = Math.hypot(dx, dy) || 1;
        vx = dx / dlen;
        vy = dy / dlen;

        // Ensure facing matches dash direction
        p.dirX = vx;
        p.dirY = vy;
      } else {
        const up = !!p.input?.up;
        const down = !!p.input?.down;
        const left = !!p.input?.left;
        const right = !!p.input?.right;

        if (left) vx -= 1;
        if (right) vx += 1;
        if (up) vy -= 1;
        if (down) vy += 1;

        const len = Math.hypot(vx, vy);
        if (len > 1e-9) {
          vx /= len;
          vy /= len;

          if (hasAim) {
            p.dirX = p.input.aimX;
            p.dirY = p.input.aimY;
          } else {
            p.dirX = vx;
            p.dirY = vy;
          }
        } else {
          vx = 0;
          vy = 0;

          if (hasAim) {
            p.dirX = p.input.aimX;
            p.dirY = p.input.aimY;
          }
        }
      }

      const speed = getMoveSpeed(p, now);

      const rawNextX = p.x + vx * speed * dt;
      const rawNextY = p.y + vy * speed * dt;

      const minX = PLAYER_HALF;
      const minY = PLAYER_HALF;
      const maxX = world.w - PLAYER_HALF;
      const maxY = world.h - PLAYER_HALF;

      // Bounds clamp (dash ends if clamp happens)
      const clampedNextX = clamp(rawNextX, minX, maxX);
      const clampedNextY = clamp(rawNextY, minY, maxY);
      if (dashing && (clampedNextX !== rawNextX || clampedNextY !== rawNextY)) {
        endDashNow(p, now);
      }

      // ✅ Movement with/without collision
      if (phaseThroughWalls) {
        p.x = clampedNextX;
        p.y = clampedNextY;
      } else {
        let blockedX = false;
        let blockedY = false;

        let cx = clampedNextX;
        let cy = clamp(p.y, minY, maxY);
        if (!collidesAt(game, cx, cy)) p.x = cx;
        else blockedX = true;

        cx = clamp(p.x, minX, maxX);
        cy = clampedNextY;
        if (!collidesAt(game, cx, cy)) p.y = cy;
        else blockedY = true;

        if (dashing && (blockedX || blockedY)) {
          endDashNow(p, now);
        }
      }

      // ✅ DASH HIT (segment sweep)
      if (!stunnedByBalloon && !uiBlocksGameplay && isDashing(p, now)) {
        const hitR = PLAYER_HALF + DASH_HIT_R_PLAYER;
        let victim = null;

        for (const other of game.players.values()) {
          if (!other || !other.alive) continue;
          if (other.id === p.id) continue;

          if (game.settings?.mode === GAME_MODE_TEAMS) {
            const friendlyFire = !!game.settings?.friendlyFire;
            if (!friendlyFire) {
              const pt = p.teamId;
              if (pt !== null && pt !== undefined && other.teamId === pt) continue;
            }
          }

          if (Number.isFinite(other.invulnUntil) && now < other.invulnUntil) continue;

          if (segmentHitsCircle(prevPX, prevPY, p.x, p.y, other.x, other.y, hitR)) {
            victim = other;
            break;
          }
        }

        if (victim) {
          endDashNow(p, now);

          upgrades.ensureEffectState(victim);
          if ((victim.effects.shield | 0) > 0) {
            victim.effects.shield = (victim.effects.shield | 0) - 1;
            victim.invulnUntil = now + 250;

            io.to(code).emit("PLAYER_SHIELDED", {
              playerId: victim.id,
              by: p.id,
              shieldLeft: victim.effects.shield | 0,
            });
          } else {
            if (!p.stats) p.stats = { kills: 0, deaths: 0, correct: 0 };
            p.stats.kills += 1;

            if (!victim.stats) victim.stats = { kills: 0, deaths: 0, correct: 0 };
            victim.stats.deaths += 1;

            victim.killedByName = p.name || "Unknown";
            victim.killedById = p.id;

            victim.alive = false;
            victim.input = { up: false, down: false, left: false, right: false, fire: false, aimX: 0, aimY: 0 };
            victim.fireCd = 0;
            victim.cakes = 0;
            victim.pendingPrompt = null;
            victim.pendingUpgradeOffer = null;

            const opts = buildRespawnOptions(game, victim);
            victim.pendingRespawn = { options: opts.map((o) => o.id), createdAt: now };

            const targetSocket = victim.socketId || victim.id;

            io.to(targetSocket).emit("RESPAWN_OPTIONS", {
              killedBy: victim.killedByName || "Unknown",
              options: opts.map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
            });

            io.to(code).emit("PLAYER_DIED", { playerId: victim.id });
          }
        }
      }

      // ---- shooting ----
      p.fireCd = Math.max(0, (p.fireCd || 0) - dt);

      // ✅ balloon pre/post OR UI-block = no shooting
      const wantsFire = !stunnedByBalloon && !uiBlocksGameplay && !!p.input?.fire;

      if (wantsFire && p.fireCd <= 0) {
        if (!Number.isFinite(p.cakes)) p.cakes = MAX_CAKES;
        if (p.cakes <= 0) {
          p.fireCd = FIRE_COOLDOWN;
          continue;
        }

        const dx = typeof p.dirX === "number" ? p.dirX : 1;
        const dy = typeof p.dirY === "number" ? p.dirY : 0;
        const dlen = Math.hypot(dx, dy) || 1;

        const ndx = dx / dlen;
        const ndy = dy / dlen;

        let spawnX = p.x + ndx * (PLAYER_HALF + 6);
        let spawnY = p.y + ndy * (PLAYER_HALF + 6);

        const pushSteps = 6;
        const pushStepLen = 6;
        let okSpawn = true;

        function pointHitsExpandedWalls(x, y) {
          if (Array.isArray(game.map?.walls)) {
            for (const w of game.map.walls) {
              const rx = w.x - BULLET_HIT_R_WALL;
              const ry = w.y - BULLET_HIT_R_WALL;
              const rw = w.w + BULLET_HIT_R_WALL * 2;
              const rh = w.h + BULLET_HIT_R_WALL * 2;
              if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return true;
            }
          }
          return false;
        }

        function pointHitsExpandedMachines(x, y) {
          if (Array.isArray(game.map?.machines)) {
            for (const m of game.map.machines) {
              const bx = m.x - MACHINE_HALF;
              const by = m.y - MACHINE_HALF;
              const bw = MACHINE_HALF * 2;
              const bh = MACHINE_HALF * 2;

              const rx = bx - BULLET_HIT_R_MACHINE;
              const ry = by - BULLET_HIT_R_MACHINE;
              const rw = bw + BULLET_HIT_R_MACHINE * 2;
              const rh = bh + BULLET_HIT_R_MACHINE * 2;

              if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return true;
            }
          }
          return false;
        }

        for (let k = 0; k < pushSteps; k++) {
          const bad = pointHitsExpandedWalls(spawnX, spawnY) || pointHitsExpandedMachines(spawnX, spawnY);
          if (!bad) break;
          spawnX += ndx * pushStepLen;
          spawnY += ndy * pushStepLen;
          if (k === pushSteps - 1) okSpawn = false;
        }

        if (!okSpawn) {
          p.fireCd = FIRE_COOLDOWN;
          continue;
        }

        const b = {
          id: makeBulletId(),
          ownerId: p.id,
          ownerTeamId: p.teamId,
          kind: "cake",
          x: spawnX,
          y: spawnY,
          vx: ndx * BULLET_SPEED,
          vy: ndy * BULLET_SPEED,
          ttl: BULLET_TTL,
        };

        if (!Array.isArray(game.bullets)) game.bullets = [];
        game.bullets.push(b);

        p.cakes -= 1;
        p.fireCd = FIRE_COOLDOWN;
      }
    }

    // ---- bullets (cakes + banana) ----
    if (!Array.isArray(game.bullets)) game.bullets = [];

    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const b = game.bullets[i];
      if (!b) {
        game.bullets.splice(i, 1);
        continue;
      }

      const isBanana = b.kind === BANANA_KIND;

      b.ttl -= dt;
      if (b.ttl <= 0) {
        game.bullets.splice(i, 1);
        continue;
      }

      const bSpeed = Math.hypot(b.vx || 0, b.vy || 0) || (isBanana ? 820 : BULLET_SPEED);
      const travel = bSpeed * dt;

      const maxStep = 10;
      const steps = Math.max(1, Math.ceil(travel / maxStep));
      const stepDt = dt / steps;

      let removed = false;

      for (let s = 0; s < steps; s++) {
        const prevX = b.x;
        const prevY = b.y;

        let nextX = prevX + b.vx * stepDt;
        let nextY = prevY + b.vy * stepDt;

        // ✅ Arena bounds:
        if (nextX < 0 || nextX > world.w || nextY < 0 || nextY > world.h) {
          if (!isBanana) {
            game.bullets.splice(i, 1);
            removed = true;
            break;
          }

          b.bouncesLeft = (Number.isFinite(b.bouncesLeft) ? (b.bouncesLeft | 0) : BANANA_DEFAULT_BOUNCES) - 1;
          if (b.bouncesLeft < 0) {
            game.bullets.splice(i, 1);
            removed = true;
            break;
          }

          if (nextX < 0 || nextX > world.w) b.vx = -b.vx;
          if (nextY < 0 || nextY > world.h) b.vy = -b.vy;

          b.x = clamp(nextX, 0, world.w);
          b.y = clamp(nextY, 0, world.h);

          const nlen = Math.hypot(b.vx, b.vy) || 1;
          b.x += (b.vx / nlen) * BANANA_STICK_NUDGE;
          b.y += (b.vy / nlen) * BANANA_STICK_NUDGE;

          continue;
        }

        // Track earliest AABB hit and WHAT it hit (wall vs machine)
        let bestHit = null; // { t, kind, rx, ry, rw, rh }

        if (Array.isArray(game.map?.walls)) {
          for (const w of game.map.walls) {
            const rx = w.x - BULLET_HIT_R_WALL;
            const ry = w.y - BULLET_HIT_R_WALL;
            const rw = w.w + BULLET_HIT_R_WALL * 2;
            const rh = w.h + BULLET_HIT_R_WALL * 2;

            const hit = segmentHitAABB(prevX, prevY, nextX, nextY, rx, ry, rw, rh);
            if (hit && (!bestHit || hit.t < bestHit.t)) bestHit = { t: hit.t, kind: "wall", rx, ry, rw, rh };
          }
        }

        if (Array.isArray(game.map?.machines)) {
          for (const m of game.map.machines) {
            const bx = m.x - MACHINE_HALF;
            const by = m.y - MACHINE_HALF;
            const bw = MACHINE_HALF * 2;
            const bh = MACHINE_HALF * 2;

            const rx = bx - BULLET_HIT_R_MACHINE;
            const ry = by - BULLET_HIT_R_MACHINE;
            const rw = bw + BULLET_HIT_R_MACHINE * 2;
            const rh = bh + BULLET_HIT_R_MACHINE * 2;

            const hit = segmentHitAABB(prevX, prevY, nextX, nextY, rx, ry, rw, rh);
            if (hit && (!bestHit || hit.t < bestHit.t)) bestHit = { t: hit.t, kind: "machine", rx, ry, rw, rh };
          }
        }

        if (bestHit) {
          const bestT = bestHit.t;
          const hitX = prevX + (nextX - prevX) * bestT;
          const hitY = prevY + (nextY - prevY) * bestT;

          b.x = hitX;
          b.y = hitY;

          if (!isBanana) {
            game.bullets.splice(i, 1);
            removed = true;
            break;
          }

          if (bestHit.kind !== "wall") {
            game.bullets.splice(i, 1);
            removed = true;
            break;
          }

          b.bouncesLeft = (Number.isFinite(b.bouncesLeft) ? (b.bouncesLeft | 0) : BANANA_DEFAULT_BOUNCES) - 1;
          if (b.bouncesLeft < 0) {
            game.bullets.splice(i, 1);
            removed = true;
            break;
          }

          const refl = reflectVelocityOnAABBHit(
            hitX,
            hitY,
            bestHit.rx,
            bestHit.ry,
            bestHit.rw,
            bestHit.rh,
            b.vx,
            b.vy
          );
          b.vx = refl.vx;
          b.vy = refl.vy;

          const nlen = Math.hypot(b.vx, b.vy) || 1;
          b.x += (b.vx / nlen) * BANANA_STICK_NUDGE;
          b.y += (b.vy / nlen) * BANANA_STICK_NUDGE;

          continue;
        }

        // no wall/machine hit -> move
        b.x = nextX;
        b.y = nextY;

        // player hit check
        let hitPlayer = null;

        for (const p of game.players.values()) {
          if (!p.alive) continue;
          if (p.id === b.ownerId) continue;

          if (game.settings?.mode === GAME_MODE_TEAMS) {
            const friendlyFire = !!game.settings?.friendlyFire;
            if (!friendlyFire) {
              let shooterTeam = b.ownerTeamId;
              if (shooterTeam === undefined || shooterTeam === null) {
                const shooter = game.players.get(b.ownerId);
                shooterTeam = shooter ? shooter.teamId : shooterTeam;
              }
              if (shooterTeam !== undefined && shooterTeam !== null && p.teamId === shooterTeam) {
                continue;
              }
            }
          }

          if (Number.isFinite(p.invulnUntil) && now < p.invulnUntil) continue;

          const extra = isBanana && Number.isFinite(b.hitRadiusPlayer) ? Number(b.hitRadiusPlayer) : CAKE_HIT_R_PLAYER;
          const r = PLAYER_HALF + extra;

          if (segmentHitsCircle(prevX, prevY, nextX, nextY, p.x, p.y, r)) {
            hitPlayer = p;
            break;
          }
        }

        if (hitPlayer) {
          game.bullets.splice(i, 1);
          removed = true;

          const shooter = game.players.get(b.ownerId) || null;

          upgrades.ensureEffectState(hitPlayer);
          if ((hitPlayer.effects.shield | 0) > 0) {
            hitPlayer.effects.shield = (hitPlayer.effects.shield | 0) - 1;
            hitPlayer.invulnUntil = now + 250;

            io.to(code).emit("PLAYER_SHIELDED", {
              playerId: hitPlayer.id,
              by: shooter ? shooter.id : null,
              shieldLeft: hitPlayer.effects.shield | 0,
            });
            break;
          }

          // ✅ BIG NOSE: bullets-only lethal save
          if (hasBigNose(hitPlayer)) {
            consumeBigNose(hitPlayer);

            hitPlayer.invulnUntil = Math.max(hitPlayer.invulnUntil || 0, now + BIG_NOSE_INVULN_MS);
            pushVictimAwayFromShooter(game, hitPlayer, shooter, BIG_NOSE_PUSH_DIST);

            io.to(code).emit("BIG_NOSE_USED", {
              playerId: hitPlayer.id,
              by: shooter ? shooter.id : null,
            });

            break;
          }

          if (shooter) {
            if (!shooter.stats) shooter.stats = { kills: 0, deaths: 0, correct: 0 };
            shooter.stats.kills += 1;
          }
          if (!hitPlayer.stats) hitPlayer.stats = { kills: 0, deaths: 0, correct: 0 };
          hitPlayer.stats.deaths += 1;

          hitPlayer.killedByName = shooter ? shooter.name : "Unknown";
          hitPlayer.killedById = shooter ? shooter.id : null;

          hitPlayer.alive = false;
          hitPlayer.input = { up: false, down: false, left: false, right: false, fire: false, aimX: 0, aimY: 0 };
          hitPlayer.fireCd = 0;
          hitPlayer.cakes = 0;
          hitPlayer.pendingPrompt = null;
          hitPlayer.pendingUpgradeOffer = null;

          const opts = buildRespawnOptions(game, hitPlayer);
          hitPlayer.pendingRespawn = {
            options: opts.map((o) => o.id),
            createdAt: now,
          };

          const targetSocket = hitPlayer.socketId || hitPlayer.id;

          io.to(targetSocket).emit("RESPAWN_OPTIONS", {
            killedBy: hitPlayer.killedByName || "Unknown",
            options: opts.map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
          });

          io.to(code).emit("PLAYER_DIED", { playerId: hitPlayer.id });
          break;
        }
      }

      if (removed) continue;
    }

    // ---- mines ----
    if (!Array.isArray(game.mines)) game.mines = [];

    for (let i = game.mines.length - 1; i >= 0; i--) {
      const m = game.mines[i];
      if (!m) {
        game.mines.splice(i, 1);
        continue;
      }

      if (Number.isFinite(m.expiresAt) && now >= m.expiresAt) {
        game.mines.splice(i, 1);
        continue;
      }

      if (Number.isFinite(m.armedAt) && now < m.armedAt) continue;

      const triggerR = Number.isFinite(m.triggerR) ? m.triggerR : MINE_STEP_ON_TRIGGER_R;
      const blastR = Number.isFinite(m.blastR) ? m.blastR : MINE_BLAST_R;

      const triggerR2 = triggerR * triggerR;
      const blastR2 = blastR * blastR;

      let triggeredBy = null;

      for (const p of game.players.values()) {
        if (!p || !p.alive) continue;
        if (p.id === m.ownerId) continue;

        if (game.settings?.mode === GAME_MODE_TEAMS) {
          const pt = p.teamId;
          const ot = m.ownerTeamId;
          if (ot !== null && ot !== undefined && pt === ot) continue;
        }

        if (dist2(p.x, p.y, m.x, m.y) <= triggerR2) {
          triggeredBy = p;
          break;
        }
      }

      if (!triggeredBy) continue;

      const deaths = [];

      for (const p of game.players.values()) {
        if (!p || !p.alive) continue;
        if (Number.isFinite(p.invulnUntil) && now < p.invulnUntil) continue;

        if (dist2(p.x, p.y, m.x, m.y) <= blastR2) {
          deaths.push(p);
        }
      }

      game.mines.splice(i, 1);

      for (const victim of deaths) {
        if (!victim || !victim.alive) continue;

        victim.alive = false;
        victim.input = { up: false, down: false, left: false, right: false, fire: false, aimX: 0, aimY: 0 };
        victim.fireCd = 0;
        victim.cakes = 0;
        victim.pendingPrompt = null;
        victim.pendingUpgradeOffer = null;

        if (!victim.stats) victim.stats = { kills: 0, deaths: 0, correct: 0 };
        victim.stats.deaths += 1;

        const owner = game.players.get(m.ownerId) || null;
        victim.killedByName = owner ? owner.name : "Mine";
        victim.killedById = owner ? owner.id : null;

        const opts = buildRespawnOptions(game, victim);
        victim.pendingRespawn = {
          options: opts.map((o) => o.id),
          createdAt: now,
        };

        const targetSocket = victim.socketId || victim.id;

        io.to(targetSocket).emit("RESPAWN_OPTIONS", {
          killedBy: victim.killedByName || "Mine",
          options: opts.map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
        });

        io.to(code).emit("PLAYER_DIED", { playerId: victim.id });
      }
    }

    economy.tryCollectPickups(game);
    io.to(code).emit("STATE_SNAPSHOT", snapshotForGame(game));
  }
}, TICK_MS);

// --------------------
// Socket.IO logic
// --------------------
io.on("connection", (socket) => {
  const session = {
    playerId: socket.id,
    name: "Anonymous",
    gameCode: null,
    isHost: false,
  };

  socket.emit("WELCOME", { playerId: session.playerId });

  socket.on("hello", (payload = {}) => {
    const nameRaw = String(payload.name || "").trim();
    session.name = nameRaw.length ? nameRaw.slice(0, 24) : "Anonymous";
  });

  socket.on("createGame", (payload = {}) => {
    const tableBase = clampInt(payload.tableBase, MIN_TABLE, MAX_TABLE, 4);

    const modeRaw = String(payload.mode || GAME_MODE_FFA).toLowerCase();
    const mode = modeRaw === GAME_MODE_TEAMS ? GAME_MODE_TEAMS : GAME_MODE_FFA;

    const teamCount = mode === GAME_MODE_TEAMS ? clampInt(payload.teamCount, MIN_TEAMS, MAX_TEAMS, 2) : 0;

    const inputMode =
      payload.inputMode === "kb" || payload.inputMode === "kbm" || payload.inputMode === "kbm_gamepad"
        ? payload.inputMode
        : "kbm";

    const mapChoice = String(payload.mapChoice || "map01");
    const friendlyFire = mode === GAME_MODE_TEAMS ? !!payload.friendlyFire : false;

    const sessionModeRaw = String(payload.sessionMode || SESSION_STANDARD).toLowerCase();
    const sessionMode = sessionModeRaw === SESSION_TIMED ? SESSION_TIMED : SESSION_STANDARD;
    const sessionMinutes = clampInt(payload.sessionMinutes, MIN_SESSION_MIN, MAX_SESSION_MIN, 5);

    const winModeRaw = String(payload.winMode || WIN_MODE_STANDARD).toLowerCase();
    const winMode = winModeRaw === WIN_MODE_MONEY ? WIN_MODE_MONEY : WIN_MODE_STANDARD;

    const code = createUniqueCode();

    const game = {
      code,
      hostPlayerId: session.playerId,
      phase: "lobby",
      settings: {
        tableBase,
        mode,
        teamCount,
        inputMode,
        mapChoice,
        friendlyFire,
        sessionMode,
        sessionMinutes,
        winMode,
      },
      map: null,
      players: new Map(),
      pickups: [],
      mines: [],
      bullets: [],
      jackBoxes: [],
      upgradePool: null,

      startedAt: null,
      endAt: null,
      endedAt: null,
    };

    const hostPlayer = {
      id: session.playerId,
      name: session.name,
      socketId: socket.id,
      teamId: 0,
      x: randInt(200, 500),
      y: randInt(200, 500),
      dirX: 1,
      dirY: 0,
      input: { up: false, down: false, left: false, right: false, fire: false, aimX: 0, aimY: 0 },

      pendingPrompt: null,
      lastCorrectMachineId: null,

      nextMachineNum: 1,
      clearedMachines: new Set(),

      money: 100,

      upgrades: null,
      pendingUpgradeOffer: null,

      alive: true,
      invulnUntil: 0,
      fireCd: 0,
      pendingRespawn: null,

      cakes: MAX_CAKES,

      stats: { kills: 0, deaths: 0, correct: 0 },

      killedByName: null,
      killedById: null,
    };

    if (game.settings.mode === GAME_MODE_FFA) hostPlayer.teamId = 0;

    economy.ensurePlayerEconomy(hostPlayer);
    upgrades.ensureUpgradeState(hostPlayer);
    upgrades.ensureEffectState(hostPlayer);
    hostPlayer.effects.dash = null;
    hostPlayer.effects.balloon = null;

    game.players.set(session.playerId, hostPlayer);
    games[code] = game;

    session.gameCode = code;
    session.isHost = true;

    socket.join(code);

    socket.emit("GAME_CREATED", { gameCode: code });
    socket.emit("JOIN_SUCCESS", {
      gameCode: code,
      players: lobbySummary(game).players,
      settings: game.settings,
    });

    emitLobbyUpdate(io, game);
  });

  socket.on("joinGame", (payload = {}) => {
    const code = String(payload.gameCode || "").trim().toUpperCase();
    const game = games[code];

    if (!game) return socket.emit("JOIN_FAILED", { reason: "invalid_code" });
    if (game.phase !== "lobby") return socket.emit("JOIN_FAILED", { reason: "game_started" });
    if (game.players.size >= MAX_PLAYERS) return socket.emit("JOIN_FAILED", { reason: "full" });

    const joinPlayer = {
      id: session.playerId,
      name: session.name,
      socketId: socket.id,
      teamId: null,
      x: randInt(200, 500),
      y: randInt(200, 500),
      dirX: 1,
      dirY: 0,
      input: { up: false, down: false, left: false, right: false, fire: false, aimX: 0, aimY: 0 },

      pendingPrompt: null,
      lastCorrectMachineId: null,

      nextMachineNum: 1,
      clearedMachines: new Set(),

      money: 100,

      upgrades: null,
      pendingUpgradeOffer: null,

      alive: true,
      invulnUntil: 0,
      fireCd: 0,
      pendingRespawn: null,

      cakes: MAX_CAKES,

      stats: { kills: 0, deaths: 0, correct: 0 },

      killedByName: null,
      killedById: null,
    };

    if (game.settings.mode === GAME_MODE_FFA) {
      const used = new Set([...game.players.values()].map((p) => p.teamId).filter((x) => Number.isFinite(x)));
      let tid = 0;
      while (used.has(tid)) tid++;
      joinPlayer.teamId = tid;
    }

    economy.ensurePlayerEconomy(joinPlayer);
    upgrades.ensureUpgradeState(joinPlayer);
    upgrades.ensureEffectState(joinPlayer);
    joinPlayer.effects.dash = null;
    joinPlayer.effects.balloon = null;

    game.players.set(session.playerId, joinPlayer);

    session.gameCode = code;
    session.isHost = false;

    socket.join(code);

    socket.emit("JOIN_SUCCESS", {
      gameCode: code,
      players: lobbySummary(game).players,
      settings: game.settings,
    });

    emitLobbyUpdate(io, game);
  });

  socket.on("assignTeam", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;
    const game = games[code];
    if (!game) return;

    if (game.settings.mode !== GAME_MODE_TEAMS) return;
    if (session.playerId !== game.hostPlayerId) return;

    const targetId = String(payload.playerId || "");
    const teamId = clampInt(payload.teamId, 0, game.settings.teamCount - 1, 0);

    const target = game.players.get(targetId);
    if (!target) return;

    target.teamId = teamId;
    emitLobbyUpdate(io, game);
  });

  socket.on("startGame", () => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game) return;

    if (session.playerId !== game.hostPlayerId) return;
    if (game.players.size < 2) return;

    if (game.settings.mode === GAME_MODE_TEAMS) {
      for (const p of game.players.values()) {
        if (p.teamId === null || p.teamId === undefined) return;
      }
    } else {
      let idx = 0;
      for (const p of game.players.values()) {
        if (!Number.isFinite(p.teamId)) p.teamId = idx;
        idx++;
      }
    }

    const map = pickMap(game.settings.mapChoice);
    game.map = map;

    game.upgradePool = upgrades.pickRandomUpgradePool ? upgrades.pickRandomUpgradePool(9) : null;

    const world = getWorldForGame(game);
    const corners = cornerSpawns(world);

    let i = 0;
    for (const p of game.players.values()) {
      const c = corners[i % corners.length];
      const pos = forceToValidPos(game, c.x, c.y);
      p.x = pos.x;
      p.y = pos.y;
      i++;

      p.alive = true;
      p.invulnUntil = Date.now() + RESPAWN_INVULN * 1000;
      p.pendingRespawn = null;

      p.pendingUpgradeOffer = null;
      p.pendingPrompt = null;

      p.cakes = MAX_CAKES;

      p.killedByName = null;
      p.killedById = null;

      economy.ensurePlayerEconomy(p);
      upgrades.ensureUpgradeState(p);
      upgrades.ensureEffectState(p);
      p.effects.dash = null;
      p.effects.balloon = null;
      if (!p.stats) p.stats = { kills: 0, deaths: 0, correct: 0 };
    }

    game.pickups = [];
    game.mines = [];
    game.bullets = [];
    game.jackBoxes = [];

    game.phase = "running";
    game.startedAt = Date.now();

    if (game.settings.sessionMode === SESSION_TIMED) {
      game.endAt = game.startedAt + game.settings.sessionMinutes * 60 * 1000;
    } else {
      game.endAt = null;
    }

    io.to(code).emit("GAME_STARTED", {
      map: {
        id: map.id,
        name: map.name,
        world: map.world,
        walls: map.walls,
        machines: map.machines,
      },
      settings: game.settings,
      endAt: Number.isFinite(game.endAt) ? game.endAt : null,
    });

    io.to(code).emit("STATE_SNAPSHOT", snapshotForGame(game));
  });

  socket.on("input", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;

    if (!p.alive) {
      p.input = { up: false, down: false, left: false, right: false, fire: false, aimX: 0, aimY: 0 };
      return;
    }

    // ✅ Accept mouse aim direction for KBM.
    let ax = Number(payload.aimX);
    let ay = Number(payload.aimY);

    if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
      ax = 0;
      ay = 0;
    } else {
      const alen = Math.hypot(ax, ay);
      if (alen > 1e-9) {
        ax /= alen;
        ay /= alen;
      } else {
        ax = 0;
        ay = 0;
      }
    }

    p.input = {
      up: !!payload.up,
      down: !!payload.down,
      left: !!payload.left,
      right: !!payload.right,
      fire: !!payload.fire,
      aimX: ax,
      aimY: ay,
    };
  });

  socket.on("tryInteract", () => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p || !p.alive) return;
    if (p.pendingPrompt) return;

    const machine = findNearbyMachine(game, p.x, p.y, INTERACT_RADIUS);
    if (!machine) return;

    if (p.clearedMachines.has(machine.id)) {
      socket.emit("INTERACT_DENIED", {
        reason: "already_cleared",
        nextMachineNum: p.nextMachineNum,
        tried: machine.num,
      });
      return;
    }

    if (machine.num !== p.nextMachineNum) {
      socket.emit("INTERACT_DENIED", {
        reason: "wrong_order",
        nextMachineNum: p.nextMachineNum,
        tried: machine.num,
      });
      return;
    }

    const base = game.settings.tableBase;
    const correct = base * machine.num;
    const promptId = makePromptId();

    p.pendingPrompt = {
      id: promptId,
      machineId: machine.id,
      machineNum: machine.num,
      base,
      correct,
    };

    socket.emit("MATH_PROMPT", { promptId, base, machineNum: machine.num });
  });

  socket.on("submitAnswer", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p || !p.alive) return;

    const pending = p.pendingPrompt;
    if (!pending) return;

    const promptId = String(payload.promptId || "");
    if (promptId !== pending.id) return;

    const ans = Number(payload.answer);
    const ok = Number.isFinite(ans) && ans === pending.correct;

    p.pendingPrompt = null;

    if (ok) {
      if (!p.stats) p.stats = { kills: 0, deaths: 0, correct: 0 };
      p.stats.correct += 1;

      p.clearedMachines.add(pending.machineId);
      p.lastCorrectMachineId = pending.machineId;

      if (p.nextMachineNum === pending.machineNum) {
        p.nextMachineNum = Math.min(10, p.nextMachineNum + 1);
      }

      p.cakes = MAX_CAKES;

      socket.emit("ANSWER_RESULT", { ok: true });

      economy.awardCorrectAnswer(game, p.id);

      if (pending.machineNum === 10) {
        endGame(io, game, "machine10", { winnerId: p.id, winnerName: p.name });
        return;
      }

      upgrades.ensureUpgradeState(p);

      const offerId = makeOfferId();
      const options = upgrades.buildOfferOptions ? upgrades.buildOfferOptions(game.upgradePool) : [];

      p.pendingUpgradeOffer = { id: offerId, options: options.map((o) => o.id) };
      socket.emit("UPGRADE_OFFER", { offerId, options });
    } else {
      socket.emit("ANSWER_RESULT", { ok: false, correct: pending.correct });
      economy.penalizeWrongAnswer(game, p.id);
    }
  });

  socket.on("declineUpgrade", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;
    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;

    const offer = p.pendingUpgradeOffer;
    if (!offer) return socket.emit("UPGRADE_DECLINED", { ok: false, reason: "no_offer" });

    const offerId = String(payload.offerId || "");
    if (offerId && offerId !== offer.id) {
      return socket.emit("UPGRADE_DECLINED", { ok: false, reason: "bad_offer_id" });
    }

    p.pendingUpgradeOffer = null;
    socket.emit("UPGRADE_DECLINED", { ok: true, offerId: offer.id });
  });

  socket.on("chooseUpgrade", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;
    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;

    const offer = p.pendingUpgradeOffer;
    if (!offer) return socket.emit("UPGRADE_RESULT", { ok: false, reason: "no_offer" });

    const offerId = String(payload.offerId || "");
    if (offerId !== offer.id) return socket.emit("UPGRADE_RESULT", { ok: false, reason: "bad_offer_id" });

    const upgradeId = String(payload.upgradeId || "");
    if (!offer.options.includes(upgradeId)) {
      return socket.emit("UPGRADE_RESULT", { ok: false, reason: "not_in_offer" });
    }

    upgrades.ensureUpgradeState(p);

    const info = upgrades.getUpgradeInfo ? upgrades.getUpgradeInfo(upgradeId) : null;
    if (!info) return socket.emit("UPGRADE_RESULT", { ok: false, reason: "invalid_upgrade" });

    if (!Number.isFinite(p.money)) p.money = 0;

    // charge permanent acquireCost (refund on failure)
    let charged = 0;
    if (info.kind === "permanent") {
      const cost = Number.isFinite(info.acquireCost) ? info.acquireCost : 0;
      if (p.money < cost) {
        return socket.emit("UPGRADE_RESULT", {
          ok: false,
          reason: "not_enough_money",
          need: cost,
          money: p.money,
          requested: info,
        });
      }
      p.money -= cost;
      charged = cost;
    }

    const res = upgrades.applyUpgradeSelection ? upgrades.applyUpgradeSelection(p, upgradeId) : { ok: false };
    if (!res.ok) {
      if (charged) p.money += charged;

      if (res.reason === "slots_full") {
        const slots = (p.upgrades?.consSlots || []).map((s) => ({
          id: s.id,
          usesLeft: s.usesLeft,
          info: upgrades.getUpgradeInfo ? upgrades.getUpgradeInfo(s.id) : null,
        }));
        return socket.emit("UPGRADE_RESULT", {
          ok: false,
          reason: "slots_full",
          requested: info,
          slots,
          money: p.money,
        });
      }

      return socket.emit("UPGRADE_RESULT", { ok: false, reason: res.reason });
    }

    p.pendingUpgradeOffer = null;

    socket.emit("UPGRADE_RESULT", {
      ok: true,
      applied: res.applied,
      chosen: info,
      upgrades: p.upgrades,
      money: p.money,
    });
  });

  socket.on("chooseUpgradeReplace", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;
    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;

    const offer = p.pendingUpgradeOffer;
    if (!offer) return socket.emit("UPGRADE_RESULT", { ok: false, reason: "no_offer" });

    const offerId = String(payload.offerId || "");
    if (offerId !== offer.id) return socket.emit("UPGRADE_RESULT", { ok: false, reason: "bad_offer_id" });

    const upgradeId = String(payload.upgradeId || "");
    if (!offer.options.includes(upgradeId)) {
      return socket.emit("UPGRADE_RESULT", { ok: false, reason: "not_in_offer" });
    }

    const dropId = String(payload.dropId || "");
    upgrades.ensureUpgradeState(p);

    const info = upgrades.getUpgradeInfo ? upgrades.getUpgradeInfo(upgradeId) : null;
    if (!info || info.kind !== "consumable") {
      return socket.emit("UPGRADE_RESULT", { ok: false, reason: "not_consumable" });
    }

    const res = upgrades.applyConsumableReplace ? upgrades.applyConsumableReplace(p, upgradeId, dropId) : { ok: false };
    if (!res.ok) return socket.emit("UPGRADE_RESULT", { ok: false, reason: res.reason });

    p.pendingUpgradeOffer = null;

    socket.emit("UPGRADE_RESULT", {
      ok: true,
      applied: res.applied,
      chosen: upgrades.getUpgradeInfo ? upgrades.getUpgradeInfo(upgradeId) : null,
      upgrades: p.upgrades,
      dropped: upgrades.getUpgradeInfo ? upgrades.getUpgradeInfo(dropId) : null,
      money: Number.isFinite(p.money) ? p.money : 0,
    });
  });

  // ✅ Consumable use: charge money + apply effect actions (shield/dash/etc.)
  socket.on("useUpgradeSlot", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;
    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;

    if (!p.alive) return socket.emit("UPGRADE_USED", { ok: false, reason: "dead" });
    if (p.pendingPrompt) return socket.emit("UPGRADE_USED", { ok: false, reason: "prompt_open" });
    if (p.pendingUpgradeOffer) return socket.emit("UPGRADE_USED", { ok: false, reason: "offer_open" });

    upgrades.ensureUpgradeState(p);
    upgrades.ensureEffectState(p);

    const slotIndex = Number(payload.slotIndex);
    if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex > 2) {
      return socket.emit("UPGRADE_USED", { ok: false, reason: "bad_slot_index" });
    }

    const slots = p.upgrades.consSlots;
    if (!Array.isArray(slots) || slotIndex >= slots.length) {
      return socket.emit("UPGRADE_USED", { ok: false, reason: "empty_slot" });
    }

    const s = slots[slotIndex];
    if (!s || !s.id) return socket.emit("UPGRADE_USED", { ok: false, reason: "empty_slot" });

    const info = upgrades.getUpgradeInfo ? upgrades.getUpgradeInfo(s.id) : null;
    if (!info || info.kind !== "consumable") {
      return socket.emit("UPGRADE_USED", { ok: false, reason: "unknown_upgrade" });
    }

    const useCost = Number.isFinite(info.useCost) ? info.useCost : 0;
    if (!Number.isFinite(p.money)) p.money = 0;

    if (p.money < useCost) {
      return socket.emit("UPGRADE_USED", { ok: false, reason: "not_enough_money", need: useCost });
    }

    p.money -= useCost;

    const nowMs = Date.now();
    const res = upgrades.applyConsumableUse ? upgrades.applyConsumableUse(p, s.id, { nowMs }) : { ok: false };

    if (!res.ok) {
      p.money += useCost;
      return socket.emit("UPGRADE_USED", { ok: false, reason: res.reason || "use_failed" });
    }

    if (Array.isArray(res.actions)) {
      for (const a of res.actions) {
        if (!a || typeof a.type !== "string") continue;

        if (a.type === "set_invuln_until") {
          const untilMs = Number(a.untilMs);
          if (Number.isFinite(untilMs)) p.invulnUntil = Math.max(p.invulnUntil || 0, untilMs);
        }

        if (a.type === "spawn_mine_at_player") {
          if (!Array.isArray(game.mines)) game.mines = [];

          const params = a.params || {};
          const armDelaySec = Number.isFinite(params.armDelaySec) ? params.armDelaySec : 0.6;
          const ttlSec = Number.isFinite(params.ttlSec) ? params.ttlSec : 25;

          const mine = {
            id: makeMineId(),
            ownerId: p.id,
            ownerTeamId: p.teamId,
            x: p.x,
            y: p.y,

            r: Number.isFinite(params.radius) ? params.radius : 26,

            triggerR: Number.isFinite(params.triggerRadius) ? params.triggerRadius : MINE_STEP_ON_TRIGGER_R,
            blastR: Number.isFinite(params.blastRadius) ? params.blastRadius : MINE_BLAST_R,

            armedAt: nowMs + Math.floor(armDelaySec * 1000),
            expiresAt: nowMs + Math.floor(ttlSec * 1000),
          };

          game.mines.push(mine);
        }

        // ✅ Banana shot spawn (server-authoritative)
        if (a.type === "spawn_banana_shot") {
          if (!Array.isArray(game.bullets)) game.bullets = [];

          const params = a.params || {};
          const speed = Number.isFinite(params.speed) ? params.speed : 820;
          const ttlSec = Number.isFinite(params.ttlSec) ? params.ttlSec : 1.4;

          const bounces = Number.isFinite(params.bounces) ? Math.floor(params.bounces) : BANANA_DEFAULT_BOUNCES;
          const hitRadiusPlayer = Number.isFinite(params.hitRadiusPlayer) ? params.hitRadiusPlayer : CAKE_HIT_R_PLAYER;

          const dx = Number.isFinite(p.dirX) ? p.dirX : 1;
          const dy = Number.isFinite(p.dirY) ? p.dirY : 0;
          const dlen = Math.hypot(dx, dy) || 1;
          const ndx = dx / dlen;
          const ndy = dy / dlen;

          let spawnX = p.x + ndx * (PLAYER_HALF + 8);
          let spawnY = p.y + ndy * (PLAYER_HALF + 8);

          const pushSteps = 6;
          const pushStepLen = 6;

          function pointHitsExpandedWalls(x, y) {
            if (Array.isArray(game.map?.walls)) {
              for (const w of game.map.walls) {
                const rx = w.x - BULLET_HIT_R_WALL;
                const ry = w.y - BULLET_HIT_R_WALL;
                const rw = w.w + BULLET_HIT_R_WALL * 2;
                const rh = w.h + BULLET_HIT_R_WALL * 2;
                if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return true;
              }
            }
            return false;
          }
          function pointHitsExpandedMachines(x, y) {
            if (Array.isArray(game.map?.machines)) {
              for (const m of game.map.machines) {
                const bx = m.x - MACHINE_HALF;
                const by = m.y - MACHINE_HALF;
                const bw = MACHINE_HALF * 2;
                const bh = MACHINE_HALF * 2;
                const rx = bx - BULLET_HIT_R_MACHINE;
                const ry = by - BULLET_HIT_R_MACHINE;
                const rw = bw + BULLET_HIT_R_MACHINE * 2;
                const rh = bh + BULLET_HIT_R_MACHINE * 2;
                if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return true;
              }
            }
            return false;
          }

          for (let k = 0; k < pushSteps; k++) {
            const bad = pointHitsExpandedWalls(spawnX, spawnY) || pointHitsExpandedMachines(spawnX, spawnY);
            if (!bad) break;
            spawnX += ndx * pushStepLen;
            spawnY += ndy * pushStepLen;
          }

          game.bullets.push({
            id: makeBulletId(),
            ownerId: p.id,
            ownerTeamId: p.teamId,
            kind: BANANA_KIND,
            x: spawnX,
            y: spawnY,
            vx: ndx * speed,
            vy: ndy * speed,
            ttl: ttlSec,
            bouncesLeft: Math.max(0, bounces),
            hitRadiusPlayer,
          });
        }

        // ✅ Jack in the Box spawn (server-authoritative world object)
        if (a.type === "spawn_jack_box_at_player") {
          if (!Array.isArray(game.jackBoxes)) game.jackBoxes = [];

          const params = a.params || {};
          const revealR = Number.isFinite(params.revealRadius) ? params.revealRadius : JACK_BOX_DEFAULT_REVEAL_R;
          const ttlSec = Number.isFinite(params.ttlSec) ? params.ttlSec : JACK_BOX_DEFAULT_TTL_SEC;
          const maxActive =
            Number.isFinite(params.maxActivePerPlayer) ? Math.floor(params.maxActivePerPlayer) : JACK_BOX_DEFAULT_MAX_ACTIVE;

          // enforce per-player cap: remove oldest first
          if (maxActive > 0) {
            const owned = game.jackBoxes.filter((jb) => jb && jb.ownerId === p.id);
            if (owned.length >= maxActive) {
              owned.sort((a1, b1) => (a1.createdAt || 0) - (b1.createdAt || 0));
              const toRemove = owned.length - (maxActive - 1);
              for (let r = 0; r < toRemove; r++) {
                const killId = owned[r].id;
                const idx = game.jackBoxes.findIndex((x) => x && x.id === killId);
                if (idx >= 0) game.jackBoxes.splice(idx, 1);
              }
            }
          }

          game.jackBoxes.push({
            id: makeJackBoxId(),
            ownerId: p.id,
            ownerTeamId: p.teamId,
            x: p.x,
            y: p.y,
            revealR,
            createdAt: nowMs,
            expiresAt: nowMs + Math.floor(ttlSec * 1000),
          });
        }

        if (a.type === "start_balloon_phase") {
          // no-op (state already stored in player.effects.balloon)
        }
      }
    }

    socket.emit("UPGRADE_USED", {
      ok: true,
      used: info,
      upgrades: p.upgrades,
      money: p.money,
      paid: useCost,
      changed: res.changed || null,
    });
  });

  socket.on("chooseRespawn", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;
    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;

    if (p.alive) {
      socket.emit("RESPAWN_RESULT", { ok: false, reason: "already_alive" });
      return;
    }

    const pending = p.pendingRespawn;
    if (!pending || !Array.isArray(pending.options)) {
      socket.emit("RESPAWN_RESULT", { ok: false, reason: "no_pending" });
      return;
    }

    const opts = buildRespawnOptions(game, p);
    const spawnId = String(payload.spawnId || "");
    const chosen = opts.find((o) => o.id === spawnId) || null;

    if (!chosen || !pending.options.includes(chosen.id)) {
      socket.emit("RESPAWN_RESULT", { ok: false, reason: "invalid_spawn" });
      return;
    }

    const pos = forceToValidPos(game, chosen.x, chosen.y);

    p.x = pos.x;
    p.y = pos.y;
    p.alive = true;
    p.invulnUntil = Date.now() + RESPAWN_INVULN * 1000;

    p.input = { up: false, down: false, left: false, right: false, fire: false, aimX: 0, aimY: 0 };
    p.fireCd = 0;
    p.cakes = MAX_CAKES;

    p.pendingPrompt = null;
    p.pendingUpgradeOffer = null;
    p.pendingRespawn = null;

    p.killedByName = null;
    p.killedById = null;

    upgrades.ensureEffectState(p);
    p.effects.dash = null;
    p.effects.balloon = null;

    socket.emit("RESPAWN_RESULT", { ok: true });
  });

  // ✅ NEW: ONLY option after game ends → host can send everyone back to lobby
  socket.on("backToLobby", () => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game) return;

    // host only
    if (session.playerId !== game.hostPlayerId) return;

    // only when ended
    if (game.phase !== "ended") return;

    resetGameToLobby(game);

    emitLobbyUpdate(io, game);
    io.to(code).emit("RETURNED_TO_LOBBY", { ok: true });
  });

  socket.on("disconnect", () => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game) return;

    removePlayerFromGame(io, game, session.playerId);
  });
});

// --------------------
// Start server
// --------------------
server.listen(PORT, () => {
  console.log(`timetable-clowns server running on http://localhost:${PORT}`);
});
