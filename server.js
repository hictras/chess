const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");
require("dotenv").config({ path: ".env.local" });

let db = null;
try {
  const { createClient } = require("@libsql/client");
  const dbUrl = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  const dbToken = process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;
  if (dbUrl) {
    db = createClient({ url: dbUrl, authToken: dbToken });
    console.log("✅ Turso DB client ready");
    db.execute(`
      CREATE TABLE IF NOT EXISTS chess_games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        player_white TEXT NOT NULL,
        player_black TEXT,
        winner TEXT,
        result TEXT,
        moves TEXT,
        duration_seconds INTEGER,
        time_white INTEGER,
        time_black INTEGER,
        started_at TEXT,
        ended_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
      .then(() => console.log("✅ chess_games table ready"))
      .catch(err => console.log("chess_games auto-create:", err.message));
  } else {
    console.log("⚠️  No TURSO_DATABASE_URL set — history disabled");
  }
} catch (e) {
  console.log("⚠️  DB init failed:", e.message);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 20000
});
const PORT = process.env.PORT || 3000;
const rooms = new Map();
global.rooms = rooms;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => res.status(200).json({ ok: true, rooms: rooms.size }));

app.get("/api/games", async (req, res) => {
  if (!db) return res.json({ games: [], note: "DB not configured" });
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await db.execute({
      sql: "SELECT * FROM chess_games ORDER BY id DESC LIMIT ?",
      args: [limit]
    });
    res.json({ games: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/games/live", (_req, res) => {
  try {
    const active = [];
    for (const room of rooms.values()) {
      if (!room.players.w || !room.players.b) continue;
      if (room.game.isGameOver()) continue;
      active.push({
        code: room.code,
        white: room.players.w.name,
        black: room.players.b.name,
        turn: room.game.turn(),
        moves: room.game.history().length,
        timeWhite: room.timeLeft.w,
        timeBlack: room.timeLeft.b,
        lastMove: room.game.history({ verbose: true }).slice(-1)[0]?.san || null
      });
    }
    res.json({ live: active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

function cleanName(value) {
  return String(value || "Player").trim().replace(/[<>]/g, "").slice(0, 24) || "Player";
}
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}
function publicState(room) {
  const game = room.game;
  const history = game.history({ verbose: true }).map(m => ({
    color: m.color, from: m.from, to: m.to, san: m.san, piece: m.piece,
    captured: m.captured || null, promotion: m.promotion || null
  }));
  return {
    code: room.code,
    fen: game.fen(),
    pgn: game.pgn(),
    turn: game.turn(),
    history,
    players: {
      w: room.players.w ? { name: room.players.w.name, connected: room.players.w.connected } : null,
      b: room.players.b ? { name: room.players.b.name, connected: room.players.b.connected } : null
    },
    status: room.resigned || room.drawAgreed ? (room.drawAgreed ? "draw" : "resigned") :
      game.isCheckmate() ? "checkmate" :
      game.isStalemate() ? "stalemate" :
      game.isThreefoldRepetition() ? "threefold" :
      game.isInsufficientMaterial() ? "insufficient" :
      game.isDraw() ? "draw" : game.isCheck() ? "check" : "playing",
    winner: room.resigned ? (room.resigned === "w" ? "b" : "w") : game.isCheckmate() ? (game.turn() === "w" ? "b" : "w") : null,
    drawOffer: room.drawOffer,
    rematch: room.rematch,
    timeLeft: room.timeLeft,
    running: !!(room.players.w?.connected && room.players.b?.connected) && !room.game.isGameOver()
  };
}
function emitState(room) {
  io.to(room.code).emit("state", publicState(room));
}
function getPlayer(room, socket) {
  if (!room) return null;
  for (const color of ["w", "b"]) {
    const player = room.players[color];
    if (player && player.socketId === socket.id) return color;
  }
  return null;
}
function joinSocket(socket, room, color, token) {
  const player = room.players[color];
  player.socketId = socket.id;
  player.connected = true;
  player.token = token || player.token || crypto.randomUUID();
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerToken = player.token;
  socket.emit("joined", { code: room.code, color, token: player.token, state: publicState(room) });
  emitState(room);
}
function sendError(socket, message) {
  socket.emit("gameError", message);
}

async function saveGameRecord(room) {
  if (!db) return;
  try {
    const startedAt = room.createdAt ? new Date(room.createdAt).toISOString() : null;
    const history = room.game.history({ verbose: true }).map(m => m.san).join(" ");
    const duration = room.createdAt ? Math.floor((Date.now() - room.createdAt) / 1000) : 0;

    let result = "unknown";
    let winner = null;
    if (room.drawAgreed) { result = "draw"; }
    else if (room.resigned) { result = "resigned"; winner = room.resigned === "w" ? "black" : "white"; }
    else if (room.game.isCheckmate()) { result = "checkmate"; winner = room.game.turn() === "w" ? "black" : "white"; }
    else if (room.game.isStalemate()) { result = "stalemate"; }
    else if (room.game.isDraw()) { result = "draw"; }

    await db.execute({
      sql: "INSERT INTO chess_games (code, player_white, player_black, winner, result, moves, duration_seconds, time_white, time_black, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        room.code,
        room.players.w?.name || "White",
        room.players.b?.name || "Black",
        winner,
        result,
        history,
        duration,
        room.timeLeft?.w ?? 0,
        room.timeLeft?.b ?? 0,
        startedAt
      ]
    });
    console.log("Game saved:", room.code, result);
  } catch (err) {
    console.error("Failed to save game:", err.message);
  }
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name, token } = {}) => {
    const code = makeCode();
    const room = {
      code, game: new Chess(), drawOffer: null, rematch: { w: false, b: false },
      players: { w: null, b: null }, createdAt: Date.now(),
      timeLeft: { w: 600, b: 600 },
      lastTick: Date.now()
    };
    room.players.w = {
      name: cleanName(name), token: token || crypto.randomUUID(),
      socketId: socket.id, connected: true
    };
    rooms.set(code, room);
    joinSocket(socket, room, "w", token);
  });

  socket.on("joinRoom", ({ code, name, token } = {}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return sendError(socket, "Room not found. Check the code or create a new room.");
    let existingColor = null;
    for (const color of ["w", "b"]) {
      if (room.players[color] && token && room.players[color].token === token) existingColor = color;
    }
    if (existingColor) return joinSocket(socket, room, existingColor, token);
    if (!room.players.w) return joinSocket(socket, room, "w", token);
    if (!room.players.b) {
      room.players.b = {
        name: cleanName(name),
        token: token || crypto.randomUUID(),
        socketId: null,
        connected: false
      };
      return joinSocket(socket, room, "b", token);
    }
    return sendError(socket, "This room already has two players.");
  });

  socket.on("reconnectRoom", ({ code, token } = {}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || !token) return sendError(socket, "That game session is no longer available. Create a new room.");
    for (const color of ["w", "b"]) {
      if (room.players[color] && room.players[color].token === token) {
        return joinSocket(socket, room, color, token);
      }
    }
    sendError(socket, "This player session was not found in that room.");
  });

  socket.on("spectate", ({ code } = {}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return sendError(socket, "Room not found.");
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.isSpectator = true;
    socket.emit("spectating", { code: room.code, state: publicState(room) });
  });

  socket.on("move", ({ from, to, promotion } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    const color = getPlayer(room, socket);
    if (!room || !color) return sendError(socket, "Join a room before moving.");
    if (!room.players.w || !room.players.b) return sendError(socket, "Waiting for an opponent to join.");
    if (room.game.isGameOver()) return sendError(socket, "This game has ended.");
    if (room.game.turn() !== color) return sendError(socket, "It is not your turn.");
    try {
      const move = room.game.move({ from, to, promotion: promotion || "q" });
      room.drawOffer = null;
      room.rematch = { w: false, b: false };
      io.to(room.code).emit("lastMove", { from: move.from, to: move.to, san: move.san });
      emitState(room);
      if (room.game.isGameOver()) saveGameRecord(room);
    } catch (_err) {
      sendError(socket, "Illegal move. Choose a legal destination.");
    }
  });

  socket.on("offerDraw", () => {
    const room = rooms.get(socket.data.roomCode);
    const color = getPlayer(room, socket);
    if (!room || !color || room.game.isGameOver()) return;
    if (room.drawOffer && room.drawOffer !== color) {
      room.drawOffer = null;
      room.drawAgreed = true;
      room.game.header("Result", "1/2-1/2");
      emitState(room);
      io.to(room.code).emit("notice", "Draw agreed.");
      saveGameRecord(room);
    } else {
      room.drawOffer = color;
      emitState(room);
      io.to(room.code).emit("notice", `${color === "w" ? "White" : "Black"} offered a draw.`);
    }
  });

  socket.on("resign", () => {
    const room = rooms.get(socket.data.roomCode);
    const color = getPlayer(room, socket);
    if (!room || !color || room.game.isGameOver()) return;
    room.resigned = color;
    room.game.header("Result", color === "w" ? "0-1" : "1-0");
    emitState(room);
    io.to(room.code).emit("notice", `${color === "w" ? "White" : "Black"} resigned.`);
    saveGameRecord(room);
  });

  socket.on("rematch", () => {
    const room = rooms.get(socket.data.roomCode);
    const color = getPlayer(room, socket);
    if (!room || !color) return;
    room.rematch[color] = true;
    if (room.rematch.w && room.rematch.b) {
      room.game = new Chess();
      room.drawOffer = null;
      room.rematch = { w: false, b: false };
      room.resigned = null;
      room.drawAgreed = false;
      room.timeLeft = { w: 600, b: 600 };
      room.lastTick = Date.now();
      room.createdAt = Date.now();
      emitState(room);
      io.to(room.code).emit("notice", "New game started.");
    } else {
      emitState(room);
      io.to(room.code).emit("notice", "Rematch requested. Waiting for the other player.");
    }
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    const color = getPlayer(room, socket);
    if (room && color && room.players[color]) {
      room.players[color].connected = false;
      room.players[color].socketId = null;
      emitState(room);
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    const occupied = ["w", "b"].some(c => room.players[c] && room.players[c].connected);
    if (!occupied && room.createdAt < cutoff) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.players.w || !room.players.b || !room.players.w.connected || !room.players.b.connected) {
      room.lastTick = now;
      continue;
    }
    if (room.game.isGameOver()) {
      room.lastTick = now;
      continue;
    }
    const dt = Math.max(0, Math.round((now - room.lastTick) / 1000));
    if (dt <= 0) continue;
    room.lastTick = now;

    const turn = room.game.turn();
    room.timeLeft[turn] = Math.max(0, room.timeLeft[turn] - dt);

    if (room.timeLeft[turn] === 0) {
      room.resigned = turn;
      room.game.header("Result", turn === "w" ? "0-1" : "1-0");
      emitState(room);
      io.to(room.code).emit("notice", (turn === "w" ? "White" : "Black") + " ran out of time.");
      saveGameRecord(room);
    } else {
      io.to(room.code).emit("clock", { timeLeft: room.timeLeft, turn });
    }
  }
}, 1000);

server.listen(PORT, "0.0.0.0", () => console.log(`Chess Online listening on ${PORT}`));
