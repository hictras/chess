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
        
        try {
            // 1. Delete from memory
            if (typeof games !== 'undefined') delete games[code];
            if (typeof rooms !== 'undefined') delete rooms[code];
            if (typeof activeRooms !== 'undefined') delete activeRooms[code];

            // 2. Disconnect sockets
            const activeGame = typeof games !== 'undefined' ? games[code] : (typeof rooms !== 'undefined' ? rooms[code] : null);
            if (activeGame && activeGame.players) {
                Object.values(activeGame.players).forEach(p => {
                    if (p && p.socketId) {
                        io.to(p.socketId).emit("gameError", "Game was forcefully finished by admin.");
                        const socket = io.sockets.sockets.get(p.socketId);
                        if (socket) {
                            socket.leave(code);
                            socket.disconnect(true);
                        }
                    }
                });
            }

            // 3. CRITICAL: Delete or update in Turso Database
            // This ensures it vanishes from the live list.
            if (typeof db !== 'undefined' && db) {
                // Update the status so it no longer shows as 'live'
                await db.execute({
                    sql: "UPDATE games SET status = 'finished', result = 'aborted' WHERE code = ?",
                    args: [code]
                });
            }

            res.json({ success: true, message: 'Game force finished' });
        } catch (e) {
            console.error("Delete error:", e);
            res.status(500).json({ error: e.message });
        }
    });
};
