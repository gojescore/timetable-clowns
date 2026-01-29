const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { pickMap } = require("./maps");

// --------------------
// Economy + upgrades
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
const MAX_TEAMS = 6;

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
// In-memory game store
// --------------------
/**
 * games[gameCode] = {
 *   code,
 *   hostPlayerId,
 *   phase: "lobby" | "running",
 *   settings: { tableBase, teamCount, inputMode, mapChoice },
 *   map: { id, name, world:{w,h}, walls:[], machines:[] } | null,
 *   players: Map(playerId -> Player),
 *   pickups: Array<{id,type,x,y,amount,createdAt}>
 * }
 *
 * Player = {
 *   id, name, socketId, teamId,
 *   x, y, dirX, dirY,
 *   input: {up,down,left,right},
 *
 *   pendingPrompt: null | { id, machineId, machineNum, base, correct },
 *   lastCorrectMachineId: null | string,
 *
 *   // progress rules
 *   nextMachineNum: 1..10,
 *   clearedMachines: Set(machineId),
 *
 *   // economy
 *   money: number,
 *
 *   // upgrades scaffold
 *   upgrades: { permanent: string[], slots: Array<{id:string, usesLeft:number}> },
 *   pendingUpgradeOffer: null | { id: string, options: string[] }
 * }
 */
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

  // Machines are SOLID for everyone (no walking through machines)
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
    players: [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      x: p.x,
      y: p.y,
      dirX: p.dirX,
      dirY: p.dirY,
      nextMachineNum: p.nextMachineNum,
      money: typeof p.money === "number" ? p.money : 0,

      // upgrades snapshot
      upgrades: p.upgrades || { permanent: [], slots: [] },
    })),
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

    for (const p of game.players.values()) {
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
    }

    // economy: pickup collection + TTL cleanup
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
    const teamCount = clampInt(payload.teamCount, MIN_TEAMS, MAX_TEAMS, 2);

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
      settings: { tableBase, teamCount, inputMode, mapChoice },
      map: null,
      players: new Map(),
      pickups: [],
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
      input: { up: false, down: false, left: false, right: false },

      pendingPrompt: null,
      lastCorrectMachineId: null,

      nextMachineNum: 1,
      clearedMachines: new Set(),

      money: 100,

      upgrades: { permanent: [], slots: [] },
      pendingUpgradeOffer: null,
    };

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
      teams: Array.from({ length: teamCount }, (_, i) => ({
        teamId: i,
        name: `Team ${i + 1}`,
      })),
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
      input: { up: false, down: false, left: false, right: false },

      pendingPrompt: null,
      lastCorrectMachineId: null,

      nextMachineNum: 1,
      clearedMachines: new Set(),

      money: 100,

      upgrades: { permanent: [], slots: [] },
      pendingUpgradeOffer: null,
    };

    economy.ensurePlayerEconomy(joinPlayer);
    upgrades.ensureUpgradeState(joinPlayer);

    game.players.set(session.playerId, joinPlayer);

    session.gameCode = code;
    session.isHost = false;

    socket.join(code);

    socket.emit("JOIN_SUCCESS", {
      gameCode: code,
      players: lobbySummary(game).players,
      teams: Array.from({ length: game.settings.teamCount }, (_, i) => ({
        teamId: i,
        name: `Team ${i + 1}`,
      })),
    });

    emitLobbyUpdate(io, game);
  });

  socket.on("assignTeam", (payload = {}) => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game) return;

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

    for (const p of game.players.values()) {
      if (p.teamId === null || p.teamId === undefined) return;
    }

    const map = pickMap(game.settings.mapChoice);
    game.map = map;

    // Spawn
    if (Array.isArray(map.spawns) && map.spawns.length) {
      let i = 0;
      for (const p of game.players.values()) {
        const s = map.spawns[i % map.spawns.length];
        p.x = s.x;
        p.y = s.y;
        i++;

        economy.ensurePlayerEconomy(p);
        upgrades.ensureUpgradeState(p);
      }
    }

    game.pickups = [];
    game.phase = "running";

    io.to(code).emit("GAME_STARTED", {
      map: {
        id: map.id,
        name: map.name,
        world: map.world,
        walls: map.walls,
        machines: map.machines,
      },
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

    p.input = {
      up: !!payload.up,
      down: !!payload.down,
      left: !!payload.left,
      right: !!payload.right,
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

    if (p.pendingPrompt) return;

    const machine = findNearbyMachine(game, p.x, p.y, INTERACT_RADIUS);
    if (!machine) return;

    // Cannot interact with a machine already cleared
    if (p.clearedMachines.has(machine.id)) {
      socket.emit("INTERACT_DENIED", {
        reason: "already_cleared",
        nextMachineNum: p.nextMachineNum,
        tried: machine.num,
      });
      return;
    }

    // Must be in numeric order: nextMachineNum only
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

    const pending = p.pendingPrompt;
    if (!pending) return;

    const promptId = String(payload.promptId || "");
    if (promptId !== pending.id) return;

    const ans = Number(payload.answer);
    const ok = Number.isFinite(ans) && ans === pending.correct;

    // Clear prompt now (so they can’t submit twice)
    p.pendingPrompt = null;

    if (ok) {
      p.clearedMachines.add(pending.machineId);
      p.lastCorrectMachineId = pending.machineId;

      if (p.nextMachineNum === pending.machineNum) {
        p.nextMachineNum = Math.min(10, p.nextMachineNum + 1);
      }

      socket.emit("ANSWER_RESULT", { ok: true });

      // economy: spawn money pickups
      economy.awardCorrectAnswer(game, p.id);

      // upgrades: offer ALL upgrades (scaffold)
      upgrades.ensureUpgradeState(p);
      const offerId = makeOfferId();
      const options = upgrades.buildOfferOptions(); // array of objects for UI
      p.pendingUpgradeOffer = { id: offerId, options: options.map((o) => o.id) };
      socket.emit("UPGRADE_OFFER", { offerId, options });
    } else {
      socket.emit("ANSWER_RESULT", { ok: false, correct: pending.correct });
      economy.penalizeWrongAnswer(game, p.id);
    }
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
    if (!res.ok) {
      socket.emit("UPGRADE_RESULT", { ok: false, reason: res.reason });
      return;
    }

    // consume offer
    p.pendingUpgradeOffer = null;

    // IMPORTANT: send `chosen` so client can render real squares
    socket.emit("UPGRADE_RESULT", {
      ok: true,
      chosen: res.chosen,     // {id,name,kind,desc}
      applied: res.applied,
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
