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

// You confirmed 2.0 works for you (range ≈ 1560px at 780px/s)
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

// --------------------
// Mines / special projectiles (NEW)
// --------------------
const MINE_TRIGGER_R = 28;      // proximity trigger radius
const MINE_BLOCK_R = 16;        // don't place mines inside walls/machines
const MINE_HIT_INVULN = 0.25;   // prevent rapid multi-trigger
const BANANA_BOUNCE_LOSS = 0.88; // speed scale on bounce (feel)

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

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function snapshotForGame(game) {
  const world = getWorldForGame(game);

  return {
    time: Date.now(),
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
          armed: !!m.armed,
        }))
      : [],
    bullets: Array.isArray(game.bullets)
      ? game.bullets.map((b) => ({
          id: b.id,
          kind: b.kind || "cake",
          ownerId: b.ownerId,
          ownerTeamId: b.ownerTeamId,
          x: b.x,
          y: b.y,
        }))
      : [],
    players: [...game.players.values()].map((p) => {
      upgrades.ensureUpgradeState(p);
      upgrades.ensureEffectState?.(p);

      const perm = (p.upgrades.permSlots || []).map((s) => ({
        id: s.id,
        count: Number.isFinite(s.count) ? s.count : 1,
        info: upgrades.getUpgradeInfo(s.id),
      }));

      const cons = (p.upgrades.consSlots || []).map((s) => ({
        id: s.id,
        usesLeft: Number.isFinite(s.usesLeft) ? s.usesLeft : undefined,
        info: upgrades.getUpgradeInfo(s.id),
      }));

      const mods = typeof upgrades.computePlayerMods === "function"
        ? upgrades.computePlayerMods(p, Date.now())
        : null;

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
        cakes: Number.isFinite(p.cakes) ? p.cakes : MAX_CAKES,
        alive: !!p.alive,
        invulnUntil: Number.isFinite(p.invulnUntil) ? p.invulnUntil : 0,

        // NEW: expose computed mods (client can ignore for now)
        mods: mods || undefined,

        // stats (for leaderboard)
        stats: {
          kills: p.stats?.kills || 0,
          deaths: p.stats?.deaths || 0,
          correct: p.stats?.correct || 0,
        },
      };
    }),
  };
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
  const minX = rx, maxX = rx + rw;
  const minY = ry, maxY = ry + rh;

  const dx = x2 - x1;
  const dy = y2 - y1;

  let tmin = 0;
  let tmax = 1;

  const EPS = 1e-12;

  // X slab
  if (Math.abs(dx) < EPS) {
    if (x1 < minX || x1 > maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - x1) * inv;
    let t2 = (maxX - x1) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  // Y slab
  if (Math.abs(dy) < EPS) {
    if (y1 < minY || y1 > maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - y1) * inv;
    let t2 = (maxY - y1) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (tmin < 0 || tmin > 1) return null;
  return { t: tmin };
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
    return (
      (b.money - a.money) ||
      (b.correct - a.correct) ||
      (b.kills - a.kills) ||
      (a.deaths - b.deaths)
    );
  }

  return (
    (b.correct - a.correct) ||
    (b.kills - a.kills) ||
    (b.money - a.money) ||
    (a.deaths - b.deaths)
  );
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
    return {
      winnerTeamId: null,
      winnerId: top ? top.id : null,
      winnerName: top ? top.name : null,
    };
  }

  teams.sort((a, b) => compareRowsForGame(game, a, b));

  const winnerTeamId = teams[0].teamId;
  const topPlayer = leaderboard.find((r) => r.teamId === winnerTeamId) || leaderboard[0] || null;

  return {
    winnerTeamId,
    winnerId: topPlayer ? topPlayer.id : null,
    winnerName: topPlayer ? topPlayer.name : null,
  };
}

function computeWinners(game, extra = {}) {
  const leaderboard = buildLeaderboard(game);

  const forcedWinnerId = extra && typeof extra.winnerId === "string" ? extra.winnerId : null;
  const forcedWinnerName = extra && typeof extra.winnerName === "string" ? extra.winnerName : null;

  if (forcedWinnerId) {
    const pl = game.players.get(forcedWinnerId) || null;
    const winnerTeamId =
      game.settings?.mode === GAME_MODE_TEAMS
        ? (pl && Number.isFinite(pl.teamId) ? pl.teamId : null)
        : null;

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
  return {
    leaderboard,
    winnerId: top ? top.id : null,
    winnerName: top ? top.name : null,
    winnerTeamId: null,
  };
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

// --------------------
// NEW: helpers for mine placement / explosions / shield
// --------------------
function pointHitsExpandedWalls(game, x, y, r) {
  if (Array.isArray(game.map?.walls)) {
    for (const w of game.map.walls) {
      const rx = w.x - r;
      const ry = w.y - r;
      const rw = w.w + r * 2;
      const rh = w.h + r * 2;
      if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return true;
    }
  }
  return false;
}

function pointHitsExpandedMachines(game, x, y, r) {
  if (Array.isArray(game.map?.machines)) {
    for (const m of game.map.machines) {
      const bx = m.x - MACHINE_HALF;
      const by = m.y - MACHINE_HALF;
      const bw = MACHINE_HALF * 2;
      const bh = MACHINE_HALF * 2;

      const rx = bx - r;
      const ry = by - r;
      const rw = bw + r * 2;
      const rh = bh + r * 2;

      if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return true;
    }
  }
  return false;
}

function trySpawnMine(game, player, params) {
  const world = getWorldForGame(game);

  // place at player's feet (slightly behind to avoid instant overlap)
  const x = clamp(player.x, 0, world.w);
  const y = clamp(player.y, 0, world.h);

  // avoid placing inside walls/machines
  const bad = pointHitsExpandedWalls(game, x, y, MINE_BLOCK_R) || pointHitsExpandedMachines(game, x, y, MINE_BLOCK_R);
  if (bad) return { ok: false, reason: "blocked" };

  if (!Array.isArray(game.mines)) game.mines = [];

  const ttlSec = Number.isFinite(params?.ttlSec) ? params.ttlSec : 20;
  const armDelaySec = Number.isFinite(params?.armDelaySec) ? params.armDelaySec : 0.6;

  const mine = {
    id: makeMineId(),
    ownerId: player.id,
    ownerTeamId: player.teamId,
    x,
    y,
    createdAt: Date.now(),
    armAt: Date.now() + Math.floor(armDelaySec * 1000),
    expireAt: Date.now() + Math.floor(ttlSec * 1000),
    armed: false,
    radius: Number.isFinite(params?.radius) ? params.radius : 24,
    damage: Number.isFinite(params?.damage) ? params.damage : 1,
  };

  game.mines.push(mine);
  return { ok: true, mineId: mine.id };
}

// Returns true if a hit should be ignored because of friendly fire rules.
function isFriendlyFireBlocked(game, shooterTeamId, targetPlayer) {
  if (game.settings?.mode !== GAME_MODE_TEAMS) return false;
  const friendlyFire = !!game.settings?.friendlyFire;
  if (friendlyFire) return false;
  if (shooterTeamId === undefined || shooterTeamId === null) return false;
  return targetPlayer.teamId === shooterTeamId;
}

// NEW: shield handling (Big Nose)
function tryConsumeShieldOnHit(player) {
  upgrades.ensureEffectState?.(player);
  if (!player.effects) return false;
  const s = player.effects.shield | 0;
  if (s > 0) {
    player.effects.shield = s - 1;
    // tiny invuln so you don’t die instantly after shield pop
    const now = Date.now();
    player.invulnUntil = Math.max(player.invulnUntil || 0, now + Math.floor(MINE_HIT_INVULN * 1000));
    return true; // blocked
  }
  return false;
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

    // ✅ timed end check
    if (
      game.settings?.sessionMode === SESSION_TIMED &&
      Number.isFinite(game.endAt) &&
      now >= game.endAt
    ) {
      endGame(io, game, "time");
      continue;
    }

    const world = getWorldForGame(game);

    // ---- players move + shoot ----
    for (const p of game.players.values()) {
      if (!p.alive) continue;

      upgrades.ensureUpgradeState(p);
      upgrades.ensureEffectState?.(p);

      const up = !!p.input?.up;
      const down = !!p.input?.down;
      const left = !!p.input?.left;
      const right = !!p.input?.right;

      let vx = 0, vy = 0;
      if (left) vx -= 1;
      if (right) vx += 1;
      if (up) vy -= 1;
      if (down) vy += 1;

      const len = Math.hypot(vx, vy);
      if (len > 0) {
        vx /= len;
        vy /= len;
        p.dirX = vx;
        p.dirY = vy;
      }

      // NEW: speed modifiers from permanents / dash
      const mods = typeof upgrades.computePlayerMods === "function"
        ? upgrades.computePlayerMods(p, now)
        : { speedMult: 1 };

      const speed = PLAYER_SPEED * (Number.isFinite(mods.speedMult) ? mods.speedMult : 1);

      const nextX = p.x + vx * speed * dt;
      const nextY = p.y + vy * speed * dt;

      const minX = PLAYER_HALF;
      const minY = PLAYER_HALF;
      const maxX = world.w - PLAYER_HALF;
      const maxY = world.h - PLAYER_HALF;

      // slide: X then Y
      let cx = clamp(nextX, minX, maxX);
      let cy = clamp(p.y, minY, maxY);
      if (!collidesAt(game, cx, cy)) p.x = cx;

      cx = clamp(p.x, minX, maxX);
      cy = clamp(nextY, minY, maxY);
      if (!collidesAt(game, cx, cy)) p.y = cy;

      p.fireCd = Math.max(0, (p.fireCd || 0) - dt);

      const wantsFire = !!p.input?.fire;
      if (wantsFire && p.fireCd <= 0) {
        if (p.pendingPrompt) continue;
        if (p.pendingUpgradeOffer) continue;

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

        // Spawn slightly outside player
        let spawnX = p.x + ndx * (PLAYER_HALF + 6);
        let spawnY = p.y + ndy * (PLAYER_HALF + 6);

        // Spawn safety: push forward if inside wall/machine
        const pushSteps = 6;
        const pushStepLen = 6;
        let okSpawn = true;

        for (let k = 0; k < pushSteps; k++) {
          const bad = pointHitsExpandedWalls(game, spawnX, spawnY, BULLET_HIT_R_WALL) ||
                      pointHitsExpandedMachines(game, spawnX, spawnY, BULLET_HIT_R_MACHINE);
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
          kind: "cake",
          ownerId: p.id,
          ownerTeamId: p.teamId,
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

    // ---- mines (NEW) ----
    if (!Array.isArray(game.mines)) game.mines = [];
    for (let i = game.mines.length - 1; i >= 0; i--) {
      const m = game.mines[i];
      if (!m) { game.mines.splice(i, 1); continue; }

      if (!m.armed && now >= m.armAt) m.armed = true;
      if (now >= m.expireAt) { game.mines.splice(i, 1); continue; }
      if (!m.armed) continue;

      // trigger when any valid enemy enters radius
      let triggeredBy = null;
      for (const p of game.players.values()) {
        if (!p.alive) continue;
        if (p.id === m.ownerId) continue;

        if (isFriendlyFireBlocked(game, m.ownerTeamId, p)) continue;
        if (Number.isFinite(p.invulnUntil) && now < p.invulnUntil) continue;

        const r = Math.max(MINE_TRIGGER_R, Number.isFinite(m.radius) ? m.radius : MINE_TRIGGER_R);
        if (dist2(p.x, p.y, m.x, m.y) <= r * r) {
          triggeredBy = p;
          break;
        }
      }

      if (triggeredBy) {
        // Mine hit: shield can block it
        const blocked = tryConsumeShieldOnHit(triggeredBy);
        if (!blocked) {
          // kill the target (same handling style as bullets)
          const shooter = game.players.get(m.ownerId) || null;

          if (shooter) {
            if (!shooter.stats) shooter.stats = { kills: 0, deaths: 0, correct: 0 };
            shooter.stats.kills += 1;
          }
          if (!triggeredBy.stats) triggeredBy.stats = { kills: 0, deaths: 0, correct: 0 };
          triggeredBy.stats.deaths += 1;

          triggeredBy.killedByName = shooter ? shooter.name : "Unknown";
          triggeredBy.killedById = shooter ? shooter.id : null;

          triggeredBy.alive = false;
          triggeredBy.input = { up: false, down: false, left: false, right: false, fire: false };
          triggeredBy.fireCd = 0;
          triggeredBy.cakes = 0;
          triggeredBy.pendingPrompt = null;
          triggeredBy.pendingUpgradeOffer = null;

          const opts = buildRespawnOptions(game, triggeredBy);
          triggeredBy.pendingRespawn = {
            options: opts.map((o) => o.id),
            createdAt: now,
          };

          io.to(triggeredBy.socketId).emit("RESPAWN_OPTIONS", {
            killedBy: triggeredBy.killedByName || "Unknown",
            options: opts.map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
          });

          io.to(code).emit("PLAYER_DIED", { playerId: triggeredBy.id });
        }

        // mine is consumed either way
        game.mines.splice(i, 1);
      }
    }

    // ---- bullets ----
    if (!Array.isArray(game.bullets)) game.bullets = [];

    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const b = game.bullets[i];
      if (!b) {
        game.bullets.splice(i, 1);
        continue;
      }

      b.ttl -= dt;
      if (b.ttl <= 0) {
        game.bullets.splice(i, 1);
        continue;
      }

      const speed = Math.hypot(b.vx, b.vy) || BULLET_SPEED;
      const travel = speed * dt;

      const maxStep = 10;
      const steps = Math.max(1, Math.ceil(travel / maxStep));
      const stepDt = dt / steps;

      let removed = false;

      for (let s = 0; s < steps; s++) {
        const prevX = b.x;
        const prevY = b.y;

        const nextX = prevX + b.vx * stepDt;
        const nextY = prevY + b.vy * stepDt;

        if (nextX < 0 || nextX > world.w || nextY < 0 || nextY > world.h) {
          game.bullets.splice(i, 1);
          removed = true;
          break;
        }

        // earliest wall/machine hit t
        let bestT = null;
        let hitKind = null;

        if (Array.isArray(game.map?.walls)) {
          for (const w of game.map.walls) {
            const rx = w.x - BULLET_HIT_R_WALL;
            const ry = w.y - BULLET_HIT_R_WALL;
            const rw = w.w + BULLET_HIT_R_WALL * 2;
            const rh = w.h + BULLET_HIT_R_WALL * 2;

            const hit = segmentHitAABB(prevX, prevY, nextX, nextY, rx, ry, rw, rh);
            if (hit && (bestT === null || hit.t < bestT)) { bestT = hit.t; hitKind = "wall"; }
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
            if (hit && (bestT === null || hit.t < bestT)) { bestT = hit.t; hitKind = "machine"; }
          }
        }

        if (bestT !== null) {
          // impact point
          const ix = prevX + (nextX - prevX) * bestT;
          const iy = prevY + (nextY - prevY) * bestT;

          // banana can bounce; cake always disappears
          if ((b.kind || "cake") === "banana" && Number.isFinite(b.bouncesLeft) && b.bouncesLeft > 0) {
            // simple bounce: flip vx or vy depending on which axis likely caused hit
            // we approximate by checking which move is "more blocked" using tiny probe
            const probe = 0.01;
            const axX = ix + (b.vx * probe);
            const axY = iy;
            const ayX = ix;
            const ayY = iy + (b.vy * probe);

            const hitX = (hitKind === "wall")
              ? pointHitsExpandedWalls(game, axX, axY, BULLET_HIT_R_WALL)
              : pointHitsExpandedMachines(game, axX, axY, BULLET_HIT_R_MACHINE);

            const hitY = (hitKind === "wall")
              ? pointHitsExpandedWalls(game, ayX, ayY, BULLET_HIT_R_WALL)
              : pointHitsExpandedMachines(game, ayX, ayY, BULLET_HIT_R_MACHINE);

            if (hitX && !hitY) b.vx *= -1;
            else if (hitY && !hitX) b.vy *= -1;
            else {
              // ambiguous corner -> flip both
              b.vx *= -1; b.vy *= -1;
            }

            b.vx *= BANANA_BOUNCE_LOSS;
            b.vy *= BANANA_BOUNCE_LOSS;

            b.bouncesLeft -= 1;
            b.x = ix;
            b.y = iy;

            // continue stepping after bounce
            continue;
          }

          game.bullets.splice(i, 1);
          removed = true;
          break;
        }

        // move if no wall/machine hit
        b.x = nextX;
        b.y = nextY;

        // player hit (segment sweep)
        let hitPlayer = null;

        for (const p of game.players.values()) {
          if (!p.alive) continue;
          if (p.id === b.ownerId) continue;

          if (isFriendlyFireBlocked(game, b.ownerTeamId, p)) continue;
          if (Number.isFinite(p.invulnUntil) && now < p.invulnUntil) continue;

          const r = PLAYER_HALF + CAKE_HIT_R_PLAYER;
          if (segmentHitsCircle(prevX, prevY, nextX, nextY, p.x, p.y, r)) {
            hitPlayer = p;
            break;
          }
        }

        if (hitPlayer) {
          // shield can block death
          const blocked = tryConsumeShieldOnHit(hitPlayer);

          game.bullets.splice(i, 1);
          removed = true;

          if (blocked) break;

          const shooter = game.players.get(b.ownerId) || null;

          if (shooter) {
            if (!shooter.stats) shooter.stats = { kills: 0, deaths: 0, correct: 0 };
            shooter.stats.kills += 1;
          }
          if (!hitPlayer.stats) hitPlayer.stats = { kills: 0, deaths: 0, correct: 0 };
          hitPlayer.stats.deaths += 1;

          hitPlayer.killedByName = shooter ? shooter.name : "Unknown";
          hitPlayer.killedById = shooter ? shooter.id : null;

          hitPlayer.alive = false;
          hitPlayer.input = { up: false, down: false, left: false, right: false, fire: false };
          hitPlayer.fireCd = 0;
          hitPlayer.cakes = 0;
          hitPlayer.pendingPrompt = null;
          hitPlayer.pendingUpgradeOffer = null;

          const opts = buildRespawnOptions(game, hitPlayer);
          hitPlayer.pendingRespawn = {
            options: opts.map((o) => o.id),
            createdAt: now,
          };

          io.to(hitPlayer.socketId).emit("RESPAWN_OPTIONS", {
            killedBy: hitPlayer.killedByName || "Unknown",
            options: opts.map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
          });

          io.to(code).emit("PLAYER_DIED", { playerId: hitPlayer.id });
          break;
        }
      }

      if (removed) continue;
    }

    // economy + broadcast
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

    const teamCount =
      mode === GAME_MODE_TEAMS ? clampInt(payload.teamCount, MIN_TEAMS, MAX_TEAMS, 2) : 0;

    const inputMode =
      payload.inputMode === "kb" ||
      payload.inputMode === "kbm" ||
      payload.inputMode === "kbm_gamepad"
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
      bullets: [],
      mines: [], // NEW
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
      input: { up: false, down: false, left: false, right: false, fire: false },

      pendingPrompt: null,
      lastCorrectMachineId: null,

      nextMachineNum: 1,
      clearedMachines: new Set(),

      money: 100,

      upgrades: null,
      pendingUpgradeOffer: null,

      effects: null, // NEW

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
    upgrades.ensureEffectState?.(hostPlayer);

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
      input: { up: false, down: false, left: false, right: false, fire: false },

      pendingPrompt: null,
      lastCorrectMachineId: null,

      nextMachineNum: 1,
      clearedMachines: new Set(),

      money: 100,

      upgrades: null,
      pendingUpgradeOffer: null,

      effects: null, // NEW

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
      const used = new Set(
        [...game.players.values()].map((p) => p.teamId).filter((x) => Number.isFinite(x))
      );
      let tid = 0;
      while (used.has(tid)) tid++;
      joinPlayer.teamId = tid;
    }

    economy.ensurePlayerEconomy(joinPlayer);
    upgrades.ensureUpgradeState(joinPlayer);
    upgrades.ensureEffectState?.(joinPlayer);

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

    game.upgradePool = upgrades.pickRandomUpgradePool(9);

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
      upgrades.ensureEffectState?.(p);

      if (!p.stats) p.stats = { kills: 0, deaths: 0, correct: 0 };
    }

    game.pickups = [];
    game.bullets = [];
    game.mines = [];

    game.phase = "running";
    game.startedAt = Date.now();

    if (game.settings.sessionMode === SESSION_TIMED) {
      game.endAt = game.startedAt + (game.settings.sessionMinutes * 60 * 1000);
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
      p.input = { up: false, down: false, left: false, right: false, fire: false };
      return;
    }

    p.input = {
      up: !!payload.up,
      down: !!payload.down,
      left: !!payload.left,
      right: !!payload.right,
      fire: !!payload.fire,
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
      const options = upgrades.buildOfferOptions(game.upgradePool);

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
    socket.emit("UPGRADE_DECLINED", { ok: true });
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
    upgrades.ensureEffectState?.(p);

    const info = upgrades.getUpgradeInfo(upgradeId);
    if (!info) return socket.emit("UPGRADE_RESULT", { ok: false, reason: "invalid_upgrade" });

    if (!Number.isFinite(p.money)) p.money = 0;

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
    }

    const res = upgrades.applyUpgradeSelection(p, upgradeId);

    if (!res.ok && res.reason === "slots_full") {
      const slots = (p.upgrades?.consSlots || []).map((s) => ({
        id: s.id,
        usesLeft: s.usesLeft,
        info: upgrades.getUpgradeInfo(s.id),
      }));
      return socket.emit("UPGRADE_RESULT", {
        ok: false,
        reason: "slots_full",
        requested: info,
        slots,
        money: p.money,
      });
    }

    if (!res.ok) return socket.emit("UPGRADE_RESULT", { ok: false, reason: res.reason });

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

    const info = upgrades.getUpgradeInfo(upgradeId);
    if (!info || info.kind !== "consumable") {
      return socket.emit("UPGRADE_RESULT", { ok: false, reason: "not_consumable" });
    }

    const res = upgrades.applyConsumableReplace(p, upgradeId, dropId);
    if (!res.ok) return socket.emit("UPGRADE_RESULT", { ok: false, reason: res.reason });

    p.pendingUpgradeOffer = null;

    socket.emit("UPGRADE_RESULT", {
      ok: true,
      applied: res.applied,
      chosen: upgrades.getUpgradeInfo(upgradeId),
      upgrades: p.upgrades,
      dropped: upgrades.getUpgradeInfo(dropId),
      money: Number.isFinite(p.money) ? p.money : 0,
    });
  });

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
    upgrades.ensureEffectState?.(p);

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

    const info = upgrades.getUpgradeInfo(s.id);
    if (!info || info.kind !== "consumable") {
      return socket.emit("UPGRADE_USED", { ok: false, reason: "unknown_upgrade" });
    }

    const useCost = Number.isFinite(info.useCost) ? info.useCost : 0;
    if (!Number.isFinite(p.money)) p.money = 0;

    if (p.money < useCost) {
      return socket.emit("UPGRADE_USED", { ok: false, reason: "not_enough_money", need: useCost });
    }

    // pay
    p.money -= useCost;

    // apply effect actions
    if (typeof upgrades.applyConsumableUse === "function") {
      const effRes = upgrades.applyConsumableUse(p, info.id, { nowMs: Date.now() });
      if (!effRes.ok) {
        // refund if effect refused (cooldown etc.)
        p.money += useCost;
        return socket.emit("UPGRADE_USED", { ok: false, reason: effRes.reason || "effect_failed" });
      }

      // apply actions to world
      if (Array.isArray(effRes.actions)) {
        for (const a of effRes.actions) {
          if (!a || !a.type) continue;

          if (a.type === "set_invuln_until" && Number.isFinite(a.untilMs)) {
            p.invulnUntil = Math.max(p.invulnUntil || 0, a.untilMs);
          }

          if (a.type === "spawn_mine_at_player") {
            trySpawnMine(game, p, a.params || {});
          }

          if (a.type === "spawn_banana_shot") {
            // spawn banana projectile in current direction
            const dx = typeof p.dirX === "number" ? p.dirX : 1;
            const dy = typeof p.dirY === "number" ? p.dirY : 0;
            const dlen = Math.hypot(dx, dy) || 1;
            const ndx = dx / dlen;
            const ndy = dy / dlen;

            const speed = Number.isFinite(a.params?.speed) ? a.params.speed : 860;
            const ttlSec = Number.isFinite(a.params?.ttlSec) ? a.params.ttlSec : 1.6;
            const bounces = Number.isFinite(a.params?.bounces) ? a.params.bounces : 3;

            let spawnX = p.x + ndx * (PLAYER_HALF + 6);
            let spawnY = p.y + ndy * (PLAYER_HALF + 6);

            // push out of walls/machines (reuse logic)
            const pushSteps = 6;
            const pushStepLen = 6;
            let okSpawn = true;
            for (let k = 0; k < pushSteps; k++) {
              const bad = pointHitsExpandedWalls(game, spawnX, spawnY, BULLET_HIT_R_WALL) ||
                          pointHitsExpandedMachines(game, spawnX, spawnY, BULLET_HIT_R_MACHINE);
              if (!bad) break;
              spawnX += ndx * pushStepLen;
              spawnY += ndy * pushStepLen;
              if (k === pushSteps - 1) okSpawn = false;
            }
            if (okSpawn) {
              const b = {
                id: makeBulletId(),
                kind: "banana",
                ownerId: p.id,
                ownerTeamId: p.teamId,
                x: spawnX,
                y: spawnY,
                vx: ndx * speed,
                vy: ndy * speed,
                ttl: ttlSec,
                bouncesLeft: bounces,
              };
              if (!Array.isArray(game.bullets)) game.bullets = [];
              game.bullets.push(b);
            }
          }
        }
      }
    }

    // IMPORTANT: do NOT remove the consumable from slot (matches your current semantics)

    socket.emit("UPGRADE_USED", {
      ok: true,
      used: info,
      upgrades: p.upgrades,
      money: p.money,
      paid: useCost,
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

    p.input = { up: false, down: false, left: false, right: false, fire: false };
    p.fireCd = 0;
    p.cakes = MAX_CAKES;

    p.pendingPrompt = null;
    p.pendingUpgradeOffer = null;
    p.pendingRespawn = null;

    p.killedByName = null;
    p.killedById = null;

    socket.emit("RESPAWN_RESULT", { ok: true });
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
