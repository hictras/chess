const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 20000
});
const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, rooms: rooms.size }));
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

io.on("connection", socket => {
  socket.on("createRoom", ({ name, token } = {}) => {
    const code = makeCode();
    const room = {
      code, game: new Chess(), drawOffer: null, rematch: { w: false, b: false },
      players: { w: null, b: null }, createdAt: Date.now(),
      timeLeft: { w: 600, b: 600 },        // 600s = 10 minutes
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
      // Keep the room temporarily so a dropped player can reconnect.
      setTimeout(() => {
        const current = rooms.get(room.code);
        if (!current) return;
        const p = current.players[color];
        if (p && !p.connected && p.token === room.players[color].token) {
          // Room remains available for the other player; stale disconnected seat can reconnect.
        }
      }, 120000);
    }
  });
});

// Periodically remove empty rooms older than 6 hours.
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    const occupied = ["w", "b"].some(c => room.players[c] && room.players[c].connected);
    if (!occupied && room.createdAt < cutoff) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();


// Global clock: ticks every second for every active room
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
    } else {
      // Lightweight clock-only update — no board re-render on the client
      io.to(room.code).emit("clock", { timeLeft: room.timeLeft, turn });
    }
  }
}, 1000);

server.listen(PORT, "0.0.0.0", () => console.log(`Chess Online listening on ${PORT}`));
