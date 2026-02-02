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
const MAX_TEAMS = 4; // ✅ max 4 teams (plus FFA)

// FFA / Teams
const GAME_MODE_FFA = "ffa";
const GAME_MODE_TEAMS = "teams";

// Table
const MIN_TABLE = 1;
const MAX_TABLE = 10;

// Tick + movement
const TICK_HZ = 20;
const TICK_MS = Math.floor(1000 / TICK_HZ);
const PLAYER_SPEED = 220; // px/sec

// Player collision size (must match client draw size: 28x28)
const PLAYER_HALF = 14;

// Interaction
const INTERACT_RADIUS = 60; // must match client highlight
const MACHINE_HALF = 10; // machine is drawn as 20x20 in client

// --------------------
// Shooting / bullets (later: cakes)
// --------------------
const BULLET_SPEED = 780; // px/sec
const BULLET_TTL = 1.2; // seconds
const BULLET_HIT_R = 4; // hit radius around bullet point
const FIRE_COOLDOWN = 0.5; // seconds between shots (hold Space)
const RESPAWN_INVULN = 0.6; // seconds after respawn
const CORNER_PAD = 80; // how far inside the corner spawn area

// ✅ Ammo / Cakes
const MAX_CAKES = 7;

// --------------------
// In-memory game store
// --------------------
const games = Object.create(null);

// --------------------
// Helpers
// --------------------
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function genCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // avoid 0/O, 1/I
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

  // Player AABB
  const px = cx - PLAYER_HALF;
  const py = cy - PLAYER_HALF;
  const pw = PLAYER_HALF * 2;
  const ph = PLAYER_HALF * 2;

  // Walls
  if (Array.isArray(map.walls)) {
    for (const w of map.walls) {
      if (aabbIntersects(px, py, pw, ph, w.x, w.y, w.w, w.h)) return true;
    }
  }

  // Machines are SOLID
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
          ownerTeamId: b.ownerTeamId, // ✅ optional (debug / client use)
          x: b.x,
          y: b.y,
        }))
      : [],
    // ✅ dead players disappear from snapshot until respawn
    players: [...game.players.values()]
      .filter((p) => p.alive)
      .map((p) => {
        const up = p.upgrades || { permanent: [], slots: [] };

        const permanent = Array.isArray(up.permanent)
          ? up.permanent.map((id) => ({
              id,
              info: upgrades.getUpgradeInfo(id),
            }))
          : [];

        const slots = Array.isArray(up.slots)
          ? up.slots.map((s) => ({
              id: s.id,
              usesLeft: s.usesLeft,
              info: upgrades.getUpgradeInfo(s.id),
            }))
          : [];

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
          upgrades: { permanent, slots },

          // ✅ Ammo (cakes)
          cakes: Number.isFinite(p.cakes) ? p.cakes : MAX_CAKES,

          // death/respawn state (alive always true here, but keep fields for client logic)
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

  // corners always available
  for (const c of cornerSpawns(world)) {
    opts.push({ id: c.id, label: c.label, x: c.x, y: c.y, kind: "corner" });
  }

  // cleared machines
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

  // Sort so corners first, then machines by number
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
  // if the exact spawn is inside something, nudge around a small ring
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

  // last resort: keep base
  return { x: baseX, y: baseY };
}

// --------------------
// Express + HTTP + Socket.IO
// --------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve client folder (local dev)
const CLIENT_PATH = path.resolve(__dirname, "..", "client");
console.log("SERVING CLIENT FROM:", CLIENT_PATH);
console.log("Server folder is:", __dirname);
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

    // --------------------
    // Movement + fire cooldown
    // --------------------
    for (const p of game.players.values()) {
      if (!p.alive) continue;

      // Ensure cakes is always a number
      if (!Number.isFinite(p.cakes)) p.cakes = MAX_CAKES;

      const up = !!p.input?.up;
      const down = !!p.input?.down;
      const left = !!p.input?.left;
      const right = !!p.input?.right;

      let vx = 0,
        vy = 0;
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

      // Clamp to world bounds taking player size into account
      const minX = PLAYER_HALF;
      const minY = PLAYER_HALF;
      const maxX = world.w - PLAYER_HALF;
      const maxY = world.h - PLAYER_HALF;

      // X then Y (slide)
      let cx = clamp(nextX, minX, maxX);
      let cy = clamp(p.y, minY, maxY);
      if (!collidesAt(game, cx, cy)) p.x = cx;

      cx = clamp(p.x, minX, maxX);
      cy = clamp(nextY, minY, maxY);
      if (!collidesAt(game, cx, cy)) p.y = cy;

      // ---- shooting ----
      p.fireCd = Math.max(0, (p.fireCd || 0) - dt);

      const wantsFire = !!p.input?.fire;
      if (wantsFire && p.fireCd <= 0) {
        // Don’t allow firing while prompts/offers open (server safety)
        if (p.pendingPrompt) continue;
        if (p.pendingUpgradeOffer) continue;

        // ✅ Require ammo
        if (!Number.isFinite(p.cakes) || p.cakes <= 0) continue;

        // Require a facing direction
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
          ownerTeamId: p.teamId, // ✅ for no-friendly-fire
          x: spawnX,
          y: spawnY,
          vx: ndx * BULLET_SPEED,
          vy: ndy * BULLET_SPEED,
          ttl: BULLET_TTL,
        };

        if (!Array.isArray(game.bullets)) game.bullets = [];
        game.bullets.push(b);

        // ✅ spend 1 cake
        p.cakes = Math.max(0, (p.cakes || 0) - 1);

        p.fireCd = FIRE_COOLDOWN;
      }
    }

    // --------------------
    // Bullets update + collisions + deaths
    // --------------------
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

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // outside world
      if (b.x < 0 || b.x > world.w || b.y < 0 || b.y > world.h) {
        game.bullets.splice(i, 1);
        continue;
      }

      // bullet vs walls (point-in-rect with radius)
      let hitWall = false;
      if (Array.isArray(game.map?.walls)) {
        for (const w of game.map.walls) {
          if (
            b.x >= w.x - BULLET_HIT_R &&
            b.x <= w.x + w.w + BULLET_HIT_R &&
            b.y >= w.y - BULLET_HIT_R &&
            b.y <= w.y + w.h + BULLET_HIT_R
          ) {
            hitWall = true;
            break;
          }
        }
      }
      if (hitWall) {
        game.bullets.splice(i, 1);
        continue;
      }

      // bullet vs machines
      let hitMachine = false;
      if (Array.isArray(game.map?.machines)) {
        for (const m of game.map.machines) {
          const bx = m.x - MACHINE_HALF;
          const by = m.y - MACHINE_HALF;
          const bw = MACHINE_HALF * 2;
          const bh = MACHINE_HALF * 2;

          if (
            b.x >= bx - BULLET_HIT_R &&
            b.x <= bx + bw + BULLET_HIT_R &&
            b.y >= by - BULLET_HIT_R &&
            b.y <= by + bh + BULLET_HIT_R
          ) {
            hitMachine = true;
            break;
          }
        }
      }
      if (hitMachine) {
        game.bullets.splice(i, 1);
        continue;
      }

      // bullet vs players
      let hitPlayer = null;
      for (const p of game.players.values()) {
        if (!p.alive) continue;
        if (p.id === b.ownerId) continue;

        // ✅ No friendly fire in TEAMS mode
        if (game.settings?.mode === GAME_MODE_TEAMS) {
          let shooterTeam = b.ownerTeamId;
          if (shooterTeam === undefined || shooterTeam === null) {
            const shooter = game.players.get(b.ownerId);
            shooterTeam = shooter ? shooter.teamId : shooterTeam;
          }
          if (shooterTeam !== undefined && shooterTeam !== null && p.teamId === shooterTeam) continue;
        }

        // invulnerability (invulnUntil is ms timestamp)
        if (Number.isFinite(p.invulnUntil) && now < p.invulnUntil) continue;

        const d2 = dist2(b.x, b.y, p.x, p.y);
        const rr = PLAYER_HALF + BULLET_HIT_R;
        if (d2 <= rr * rr) {
          hitPlayer = p;
          break;
        }
      }

      if (hitPlayer) {
        // remove bullet
        game.bullets.splice(i, 1);

        // kill player
        hitPlayer.alive = false;
        hitPlayer.input = { up: false, down: false, left: false, right: false, fire: false };
        hitPlayer.fireCd = 0;

        // ✅ show 0 cakes while dead
        hitPlayer.cakes = 0;

        // clear any open prompt (you died)
        hitPlayer.pendingPrompt = null;

        // Send respawn picker to that player only
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

        // Optional: broadcast death event
        io.to(code).emit("PLAYER_DIED", { playerId: hitPlayer.id });

        continue;
      }
    }

    // economy: pickup collection
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
      payload.inputMode === "kb" ||
      payload.inputMode === "kbm" ||
      payload.inputMode === "kbm_gamepad"
        ? payload.inputMode
        : "kbm";

    const mapChoice = String(payload.mapChoice || "map01");
    const code = createUniqueCode();

    const game = {
      code,
      hostPlayerId: session.playerId,
      phase: "lobby",
      settings: { tableBase, mode, teamCount, inputMode, mapChoice },
      map: null,
      players: new Map(),
      pickups: [],
      bullets: [],
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

      upgrades: { permanent: [], slots: [] },
      pendingUpgradeOffer: null,

      // ✅ death state
      alive: true,
      invulnUntil: 0,
      fireCd: 0,
      pendingRespawn: null,

      // ✅ cakes (ammo)
      cakes: MAX_CAKES,
    };

    // FFA
    if (game.settings.mode === GAME_MODE_FFA) {
      hostPlayer.teamId = 0;
    }

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
      teams:
        game.settings.mode === GAME_MODE_TEAMS
          ? Array.from({ length: teamCount }, (_, i) => ({ teamId: i, name: `Team ${i + 1}` }))
          : [],
      settings: game.settings,
    });

    emitLobbyUpdate(io, game);
  });

  socket.on("joinGame", (payload = {}) => {
    const code = String(payload.gameCode || "").trim().toUpperCase();
    const game = games[code];

    if (!game) {
      socket.emit("JOIN_FAILED", { reason: "invalid_code" });
      return;
    }
    if (game.phase !== "lobby") {
      socket.emit("JOIN_FAILED", { reason: "game_started" });
      return;
    }
    if (game.players.size >= MAX_PLAYERS) {
      socket.emit("JOIN_FAILED", { reason: "full" });
      return;
    }

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

      upgrades: { permanent: [], slots: [] },
      pendingUpgradeOffer: null,

      // ✅ death state
      alive: true,
      invulnUntil: 0,
      fireCd: 0,
      pendingRespawn: null,

      // ✅ cakes (ammo)
      cakes: MAX_CAKES,
    };

    // FFA: auto-assign unique teamId
    if (game.settings.mode === GAME_MODE_FFA) {
      const used = new Set([...game.players.values()].map((p) => p.teamId).filter((x) => Number.isFinite(x)));
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
      teams:
        game.settings.mode === GAME_MODE_TEAMS
          ? Array.from({ length: game.settings.teamCount }, (_, i) => ({
              teamId: i,
              name: `Team ${i + 1}`,
            }))
          : [],
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

    io.to(code).emit("TEAM_ASSIGNED", { playerId: targetId, teamId });
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
      // FFA: ensure everyone has teamId
      let idx = 0;
      for (const p of game.players.values()) {
        if (!Number.isFinite(p.teamId)) p.teamId = idx;
        idx++;
      }
    }

    const map = pickMap(game.settings.mapChoice);
    game.map = map;

    const world = getWorldForGame(game);
    const corners = cornerSpawns(world);

    // Spawn players: rotate corners
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

      // ✅ refill cakes on game start spawn
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

    // dead players don't move or shoot
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

  // -------- Machine interaction (ORDERED) --------
  socket.on("tryInteract", () => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;
    if (!p.alive) return;

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

    socket.emit("MATH_PROMPT", {
      promptId,
      base,
      machineNum: machine.num,
    });
  });

  socket.on("submitAnswer", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;
    if (!p.alive) return;

    const pending = p.pendingPrompt;
    if (!pending) return;

    const promptId = String(payload.promptId || "");
    if (promptId !== pending.id) return;

    const ans = Number(payload.answer);
    const ok = Number.isFinite(ans) && ans === pending.correct;

    // Clear prompt now
    p.pendingPrompt = null;

    if (ok) {
      p.clearedMachines.add(pending.machineId);
      p.lastCorrectMachineId = pending.machineId;

      if (p.nextMachineNum === pending.machineNum) {
        p.nextMachineNum = Math.min(10, p.nextMachineNum + 1);
      }

      // ✅ refill cakes on correct answer
      p.cakes = MAX_CAKES;

      socket.emit("ANSWER_RESULT", { ok: true });

      economy.awardCorrectAnswer(game, p.id);

      upgrades.ensureUpgradeState(p);
      const offerId = makeOfferId();
      const options = upgrades.buildOfferOptions();
      p.pendingUpgradeOffer = { id: offerId, options: options.map((o) => o.id) };
      socket.emit("UPGRADE_OFFER", { offerId, options });
    } else {
      socket.emit("ANSWER_RESULT", { ok: false, correct: pending.correct });
      economy.penalizeWrongAnswer(game, p.id);
    }
  });

  // -------- Respawn selection --------
  socket.on("chooseRespawn", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;

    if (p.alive) {
      socket.emit("RESPAWN_RESULT", { ok: false, reason: "not_dead" });
      return;
    }

    const spawnId = String(payload.spawnId || "");
    if (!spawnId) {
      socket.emit("RESPAWN_RESULT", { ok: false, reason: "bad_spawn_id" });
      return;
    }

    const opts = buildRespawnOptions(game, p);
    const allowedIds = new Set(opts.map((o) => o.id));

    if (!allowedIds.has(spawnId)) {
      socket.emit("RESPAWN_RESULT", { ok: false, reason: "not_allowed" });
      return;
    }

    const chosen = findRespawnById(opts, spawnId);
    if (!chosen) {
      socket.emit("RESPAWN_RESULT", { ok: false, reason: "not_found" });
      return;
    }

    const pos = forceToValidPos(game, chosen.x, chosen.y);

    p.x = pos.x;
    p.y = pos.y;
    p.alive = true;
    p.invulnUntil = Date.now() + RESPAWN_INVULN * 1000;
    p.pendingRespawn = null;

    p.input = { up: false, down: false, left: false, right: false, fire: false };
    p.fireCd = 0;

    // ✅ refill cakes on respawn
    p.cakes = MAX_CAKES;

    socket.emit("RESPAWN_RESULT", { ok: true, spawnId });
  });

  // -------- Upgrade selection --------
  socket.on("chooseUpgrade", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;

    const offer = p.pendingUpgradeOffer;
    if (!offer) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: "no_offer" });
      return;
    }

    const offerId = String(payload.offerId || "");
    if (offerId !== offer.id) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: "bad_offer_id" });
      return;
    }

    const upgradeId = String(payload.upgradeId || "");
    if (!offer.options.includes(upgradeId)) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: "not_in_offer" });
      return;
    }

    const res = upgrades.applyUpgradeSelection(p, upgradeId);

    if (!res.ok && res.reason === "slots_full") {
      const slots = (p.upgrades?.slots || []).map((s) => ({
        id: s.id,
        usesLeft: s.usesLeft,
        info: upgrades.getUpgradeInfo(s.id),
      }));
      socket.emit("UPGRADE_RESULT", {
        ok: false,
        reason: "slots_full",
        requested: upgrades.getUpgradeInfo(upgradeId),
        slots,
      });
      return;
    }

    if (!res.ok) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: res.reason });
      return;
    }

    p.pendingUpgradeOffer = null;

    const chosen = upgrades.getUpgradeInfo(upgradeId);

    socket.emit("UPGRADE_RESULT", {
      ok: true,
      applied: res.applied,
      chosen,
      upgrades: p.upgrades,
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
    if (!offer) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: "no_offer" });
      return;
    }

    const offerId = String(payload.offerId || "");
    if (offerId !== offer.id) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: "bad_offer_id" });
      return;
    }

    const upgradeId = String(payload.upgradeId || "");
    if (!offer.options.includes(upgradeId)) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: "not_in_offer" });
      return;
    }

    const dropId = String(payload.dropId || "");
    upgrades.ensureUpgradeState(p);

    const idx = p.upgrades.slots.findIndex((s) => s.id === dropId);
    if (idx < 0) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: "bad_drop_id" });
      return;
    }

    p.upgrades.slots.splice(idx, 1);

    const res = upgrades.applyUpgradeSelection(p, upgradeId);

    if (!res.ok) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: res.reason });
      return;
    }

    p.pendingUpgradeOffer = null;

    socket.emit("UPGRADE_RESULT", {
      ok: true,
      applied: res.applied,
      chosen: upgrades.getUpgradeInfo(upgradeId),
      upgrades: p.upgrades,
      dropped: upgrades.getUpgradeInfo(dropId),
    });
  });

  // -------------------------
  // HOTKEY USE: 8 / 9 / 0
  // -------------------------
  socket.on("useUpgradeSlot", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game || game.phase !== "running") return;

    const p = game.players.get(session.playerId);
    if (!p) return;

    if (!p.alive) {
      socket.emit("UPGRADE_USED", { ok: false, reason: "dead" });
      return;
    }

    if (p.pendingPrompt) {
      socket.emit("UPGRADE_USED", { ok: false, reason: "prompt_open" });
      return;
    }

    if (p.pendingUpgradeOffer) {
      socket.emit("UPGRADE_USED", { ok: false, reason: "offer_open" });
      return;
    }

    upgrades.ensureUpgradeState(p);

    const slotIndex = Number(payload.slotIndex);
    if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex > 2) {
      socket.emit("UPGRADE_USED", { ok: false, reason: "bad_slot_index" });
      return;
    }

    const slots = p.upgrades.slots;
    if (!Array.isArray(slots) || slotIndex >= slots.length) {
      socket.emit("UPGRADE_USED", { ok: false, reason: "empty_slot" });
      return;
    }

    const s = slots[slotIndex];
    if (!s || !s.id) {
      socket.emit("UPGRADE_USED", { ok: false, reason: "empty_slot" });
      return;
    }

    if (!Number.isFinite(s.usesLeft) || s.usesLeft <= 0) {
      slots.splice(slotIndex, 1);
      socket.emit("UPGRADE_USED", { ok: false, reason: "no_uses_left" });
      return;
    }

    s.usesLeft -= 1;

    let removed = null;
    if (s.usesLeft <= 0) {
      removed = s.id;
      slots.splice(slotIndex, 1);
    }

    socket.emit("UPGRADE_USED", {
      ok: true,
      used: upgrades.getUpgradeInfo(s.id),
      removed: removed ? upgrades.getUpgradeInfo(removed) : null,
      upgrades: p.upgrades,
    });
  });

  socket.on("disconnect", () => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game) return;

    if (game.hostPlayerId === session.playerId) {
      io.to(code).emit("GAME_ENDED", { reason: "host_left" });
      delete games[code];
      return;
    }

    removePlayerFromGame(io, game, session.playerId);
  });
});

server.listen(PORT, () => {
  console.log(`timetable-clowns server running on http://localhost:${PORT}`);
});
