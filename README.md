# Chess Online — Render deployment

A responsive, real-time chess game for two devices. Node.js + Express + Socket.IO + chess.js.

## Features
- Create a private room or join with a room code
- Real-time moves synchronized between both players
- Server validates all moves with chess.js
- White/Black assignment, player names, move list, captured pieces
- Legal move highlighting, check/checkmate/stalemate/draw handling
- Flip board for Black, resign, offer draw, rematch request
- Reconnection to the same room using a browser-stored player token (while the server process/room remains alive)
- Render health endpoint at `/health`

## Run locally
Requires Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:3000 in two browsers/devices. For two devices outside your local network, deploy it to Render.

## Deploy to Render
1. Create a GitHub repository and upload all files in this folder.
2. In Render, choose **New + → Blueprint** and select the repository (it reads `render.yaml`), or create a **Web Service** manually.
3. For manual setup:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
4. Deploy and open the `https://your-service-name.onrender.com` address.
5. Share the deployed URL with the other player. Create a room, then share its room code.

## Important limitations
- This starter uses in-memory rooms. Rooms and games are lost if the service restarts or sleeps; a free service may have cold starts.
- It is intended for casual private games, not rated or money games.
- Browser refresh reconnection works while the room still exists and the player token is retained. For persistent rooms across restarts or multiple server instances, add Redis/database storage and a Socket.IO adapter.
- The website can be embedded in another site using an iframe pointing to the deployed URL, subject to the host site's iframe/CSP rules.
