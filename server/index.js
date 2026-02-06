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
const BULLET_TTL = 1.2;
const BULLET_HIT_R_WALL = 4;
const CAKE_HIT_R_PLAYER = 12;

const FIRE_COOLDOWN = 0.5;
const RESPAWN_INVULN = 0.6;
const CORNER_PAD = 80;

// Cakes (ammo)
const MAX_CAKES = 7;

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

function snapshotForGame(game) {
  const world = getWorldForGame(game);

  return {
    time: Date.now(),
    world,
    pickups: Array.isArray(game.pickups) ? game.pickups : [],
    bullets: Array.isArray(game.bullets)
      ? game.bullets.map((b) => ({
          id: b.id,
          ownerId: b.ownerId,
          ownerTeamId: b.ownerTeamId,
          x: b.x,
          y: b.y,
        }))
      : [],
    players: [...game.players.values()].map((p) => {
      upgrades.ensureUpgradeState(p);

      const perm = (p.upgrades.permSlots || []).map((s) => ({
        id: s.id,
        count: Number.isFinite(s.count) ? s.count : 1,
        info: upgrades.getUpgradeInfo(s.id),
      }));

      // ✅ include usesLeft (client UI needs it)
      const cons = (p.upgrades.consSlots || []).map((s) => ({
        id: s.id,
        usesLeft: Number.isFinite(s.usesLeft) ? s.usesLeft : undefined,
        info: upgrades.getUpgradeInfo(s.id),
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

        // Keep client shape: permanent + slots
        upgrades: { permanent: perm, slots: cons },

        cakes: Number.isFinite(p.cakes) ? p.cakes : MAX_CAKES,
        alive: !!p.alive,
        invulnUntil: Number.isFinite(p.invulnUntil) ? p.invulnUntil : 0,
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

function makePromptId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
function makeOfferId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
function makeBulletId() {
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

function findRespawnById(options, spawnId) {
  return options.find((o) => o.id === spawnId) || null;
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
// Express + HTTP + Socket.IO (✅ only once)
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

    const world = getWorldForGame(game);

    // ---- players move + shoot ----
    for (const p of game.players.values()) {
      if (!p.alive) continue;

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

      const nextX = p.x + vx * PLAYER_SPEED * dt;
      const nextY = p.y + vy * PLAYER_SPEED * dt;

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

        const spawnX = p.x + ndx * (PLAYER_HALF + 6);
        const spawnY = p.y + ndy * (PLAYER_HALF + 6);

        const b = {
          id: makeBulletId(),
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

      const travel = BULLET_SPEED * dt;
      const maxStep = 10;
      const steps = Math.max(1, Math.ceil(travel / maxStep));
      const stepDt = dt / steps;

      let removed = false;

      for (let s = 0; s < steps; s++) {
        const prevX = b.x;
        const prevY = b.y;

        const nextX = prevX + b.vx * stepDt;
        const nextY = prevY + b.vy * stepDt;

        b.x = nextX;
        b.y = nextY;

        if (b.x < 0 || b.x > world.w || b.y < 0 || b.y > world.h) {
          game.bullets.splice(i, 1);
          removed = true;
          break;
        }

        // wall hit
        let hitWall = false;
        if (Array.isArray(game.map?.walls)) {
          for (const w of game.map.walls) {
            if (
              b.x >= w.x - BULLET_HIT_R_WALL &&
              b.x <= w.x + w.w + BULLET_HIT_R_WALL &&
              b.y >= w.y - BULLET_HIT_R_WALL &&
              b.y <= w.y + w.h + BULLET_HIT_R_WALL
            ) {
              hitWall = true;
              break;
            }
          }
        }
        if (hitWall) {
          game.bullets.splice(i, 1);
          removed = true;
          break;
        }

        // machine hit
        let hitMachine = false;
        if (Array.isArray(game.map?.machines)) {
          for (const m of game.map.machines) {
            const bx = m.x - MACHINE_HALF;
            const by = m.y - MACHINE_HALF;
            const bw = MACHINE_HALF * 2;
            const bh = MACHINE_HALF * 2;

            if (
              b.x >= bx - BULLET_HIT_R_WALL &&
              b.x <= bx + bw + BULLET_HIT_R_WALL &&
              b.y >= by - BULLET_HIT_R_WALL &&
              b.y <= by + bh + BULLET_HIT_R_WALL
            ) {
              hitMachine = true;
              break;
            }
          }
        }
        if (hitMachine) {
          game.bullets.splice(i, 1);
          removed = true;
          break;
        }

        // player hit (segment sweep)
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
              if (
                shooterTeam !== undefined &&
                shooterTeam !== null &&
                p.teamId === shooterTeam
              ) {
                continue;
              }
            }
          }

          if (Number.isFinite(p.invulnUntil) && now < p.invulnUntil) continue;

          const r = PLAYER_HALF + CAKE_HIT_R_PLAYER;
          if (segmentHitsCircle(prevX, prevY, nextX, nextY, p.x, p.y, r)) {
            hitPlayer = p;
            break;
          }
        }

        if (hitPlayer) {
          game.bullets.splice(i, 1);
          removed = true;

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
            options: opts.map((o) => ({
              id: o.id,
              label: o.label,
              kind: o.kind,
            })),
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

    const code = createUniqueCode();

    const game = {
      code,
      hostPlayerId: session.playerId,
      phase: "lobby",
      settings: { tableBase, mode, teamCount, inputMode, mapChoice, friendlyFire },
      map: null,
      players: new Map(),
      pickups: [],
      bullets: [],
      upgradePool: null,
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

      alive: true,
      invulnUntil: 0,
      fireCd: 0,
      pendingRespawn: null,

      cakes: MAX_CAKES,
    };

    if (game.settings.mode === GAME_MODE_FFA) hostPlayer.teamId = 0;

    economy.ensurePlayerEconomy(hostPlayer);
    upgrades.ensureUpgradeState(hostPlayer);

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

      alive: true,
      invulnUntil: 0,
      fireCd: 0,
      pendingRespawn: null,

      cakes: MAX_CAKES,
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

      economy.ensurePlayerEconomy(p);
      upgrades.ensureUpgradeState(p);
    }

    game.pickups = [];
    game.bullets = [];
    game.phase = "running";

    io.to(code).emit("GAME_STARTED", {
      map: {
        id: map.id,
        name: map.name,
        world: map.world,
        walls: map.walls,
        machines: map.machines,
      },
      settings: game.settings,
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
      p.clearedMachines.add(pending.machineId);
      p.lastCorrectMachineId = pending.machineId;

      if (p.nextMachineNum === pending.machineNum) {
        p.nextMachineNum = Math.min(10, p.nextMachineNum + 1);
      }

      p.cakes = MAX_CAKES;

      socket.emit("ANSWER_RESULT", { ok: true });

      economy.awardCorrectAnswer(game, p.id);

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

    p.money -= useCost;

    socket.emit("UPGRADE_USED", {
      ok: true,
      used: info,
      upgrades: p.upgrades,
      money: p.money,
      paid: useCost,
    });
  });

  // ✅ Respawn handler (was missing in your pasted end)
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
    const chosen = findRespawnById(opts, spawnId);

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
// Start server (✅ only once)
// --------------------
server.listen(PORT, () => {
  console.log(`timetable-clowns server running on http://localhost:${PORT}`);
});
