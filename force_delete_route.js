module.exports = function(app, io) {
    app.delete('/api/games/live/:code', async (req, res) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).send('Unauthorized');

        const b64auth = (authHeader || '').split(' ')[1] || '';
        const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

        if (login !== (process.env.ADMIN_USERNAME || "admin") || password !== (process.env.ADMIN_PASSWORD || "Hictrapass@1")) {
            return res.status(401).send('Unauthorized');
        }

        const code = req.params.code.toUpperCase();
        const lowerCode = code.toLowerCase();
        
        try {
            // 1. Clear from ALL possible global in-memory maps/objects
            const globalMaps = ['games', 'rooms', 'activeRooms', 'activeGames', 'liveGames', 'roomsMap'];
            globalMaps.forEach(mapName => {
                if (global[mapName] && typeof global[mapName].delete === 'function') {
                    global[mapName].delete(code);
                    global[mapName].delete(lowerCode);
                }
                if (global[mapName] && typeof global[mapName] === 'object') {
                    delete global[mapName][code];
                    delete global[mapName][lowerCode];
                }
            });

            // Also check app-level settings if attached
            const appMaps = ['activeGames', 'rooms', 'games'];
            appMaps.forEach(mapName => {
                const m = app.get(mapName);
                if (m) {
                    if (typeof m.delete === 'function') {
                        m.delete(code);
                        m.delete(lowerCode);
                    } else if (typeof m === 'object') {
                        delete m[code];
                        delete m[lowerCode];
                    }
                }
            });

            // 2. Disconnect any active sockets in this room
            if (io && io.sockets && io.sockets.adapter && io.sockets.adapter.rooms) {
                const room = io.sockets.adapter.rooms.get(code) || io.sockets.adapter.rooms.get(lowerCode);
                if (room) {
                    for (const socketId of room) {
                        const socket = io.sockets.sockets.get(socketId);
                        if (socket) {
                            socket.emit("gameError", "Game was forcefully finished by admin.");
                            socket.leave(code);
                            socket.leave(lowerCode);
                            socket.disconnect(true);
                        }
                    }
                }
            }

            // 3. Update Turso Database (try both uppercase and lowercase code formats)
            if (typeof db !== 'undefined' && db) {
                await db.execute({
                    sql: "UPDATE games SET status = 'finished', result = 'aborted' WHERE code = ? OR code = ?",
                    args: [code, lowerCode]
                });
            }

            return res.json({ success: true, message: 'Game force finished and cleaned from memory/DB' });
        } catch (e) {
            console.error("Delete error:", e);
            return res.status(500).json({ error: e.message });
        }
    });
};
