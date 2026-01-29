const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// --------------------
// Config (tweakable)
// --------------------
const PORT = process.env.PORT || 3000;

const CODE_LEN = 5;
const MAX_PLAYERS = 12;

const MIN_TEAMS = 1;
const MAX_TEAMS = 6;

const MIN_TABLE = 1;
const MAX_TABLE = 10;

// --------------------
// In-memory game store
// --------------------
/**
 * games[gameCode] = {
 *   code,
 *   hostPlayerId,
 *   phase: "lobby" | "running",
 *   settings: { tableBase, teamCount, inputMode },
 *   players: Map(playerId -> { id, name, socketId, teamId|null })
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
  // Avoid ambiguous chars: 0/O, 1/I
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

// --------------------
// Express + HTTP + Socket.IO
// --------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve the client folder (easy local dev)
app.use(express.static(path.join(__dirname, "..", "client")));

app.get("/health", (req, res) => res.json({ ok: true }));

// --------------------
// Socket.IO logic
// --------------------
io.on("connection", (socket) => {
  const session = {
    playerId: socket.id, // v0 id
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
    // sanitize host settings
    const tableBase = clampInt(payload.tableBase, MIN_TABLE, MAX_TABLE, 4);
    const teamCount = clampInt(payload.teamCount, MIN_TEAMS, MAX_TEAMS, 2);
    const inputMode =
      payload.inputMode === "kb" ||
      payload.inputMode === "kbm" ||
      payload.inputMode === "kbm_gamepad"
        ? payload.inputMode
        : "kbm";

    const code = createUniqueCode();

    const game = {
      code,
      hostPlayerId: session.playerId,
      phase: "lobby",
      settings: { tableBase, teamCount, inputMode },
      players: new Map(),
    };

    // add host
    game.players.set(session.playerId, {
      id: session.playerId,
      name: session.name,
      socketId: socket.id,
      teamId: 0, // default (host can reassign)
    });

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

    // join
    game.players.set(session.playerId, {
      id: session.playerId,
      name: session.name,
      socketId: socket.id,
      teamId: null,
    });

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

    // only host can assign
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

    // only host
    if (session.playerId !== game.hostPlayerId) return;

    // require at least 2 players
    if (game.players.size < 2) return;

    // require all assigned
    for (const p of game.players.values()) {
      if (p.teamId === null || p.teamId === undefined) return;
    }

    game.phase = "running";

    io.to(code).emit("GAME_STARTED", {
      map: { stub: true },
      players: [...game.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        teamId: p.teamId,
      })),
      machineMappings: [],
    });
  });

  socket.on("disconnect", () => {
    const code = session.gameCode;
    if (!code) return;

    const game = games[code];
    if (!game) return;

    // host leaves → end game (v0 policy)
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
