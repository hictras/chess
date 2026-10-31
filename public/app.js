(() =&gt; {
    const $ = id =&gt; document.getElementById(id);
    const socket = io();

    /* ==========================================
       UTILITIES &amp; MODALS
       ========================================== */
    function cModal({ title, message, okText, cancelText, danger = false }) {
        const isAr = document.cookie.split('; ').some(c =&gt; c === 'lang=ar');
        const bg = document.createElement("div");
        bg.className = "chess-modal-backdrop open";
        bg.innerHTML = '&lt;div class="chess-modal" dir="' + (isAr ? 'rtl' : 'ltr') + '"&gt;' +
            '&lt;h3&gt;' + (title || (isAr ? 'تأكيد' : 'Confirm')) + '&lt;/h3&gt;' +
            '&lt;p&gt;' + (message || '') + '&lt;/p&gt;' +
            '&lt;div class="chess-modal-actions"&gt;' +
            '&lt;button class="chess-modal-btn" data-action="cancel"&gt;' + (cancelText || (isAr ? 'إلغاء' : 'Cancel')) + '&lt;/button&gt;' +
            '&lt;button class="chess-modal-btn ' + (danger ? 'danger' : 'primary') + '" data-action="ok"&gt;' + (okText || (isAr ? 'موافق' : 'OK')) + '&lt;/button&gt;' +
            '&lt;/div&gt;&lt;/div&gt;';
        document.body.appendChild(bg);
        return new Promise(function(resolve) {
            bg.addEventListener('click', function(e) {
                var btn = e.target.closest('[data-action]');
                if (btn) { bg.remove(); resolve(btn.dataset.action === 'ok'); }
                else if (e.target === bg) { bg.remove(); resolve(false); }
            });
        });
    }

    function showNotice(message, error = false) {
        const el = $("gameNotice");
        if (!el) return;
        el.textContent = message || "";
        el.style.display = message ? "block" : "none";
        el.style.background = error ? "#ef4444" : "#22c55e";

        clearTimeout(state.noticeTimer);
        if (message) {
            state.noticeTimer = setTimeout(() =&gt; {
                if (el.textContent === message) {
                    el.style.display = "none";
                    el.textContent = "";
                }
            }, 4000);
        }
    }

    function lobbyError(message) { if ($("lobbyError")) $("lobbyError").textContent = message || ""; }

    /* ==========================================
       STATE &amp; CONSTANTS
       ========================================== */
    const PIECES = {
        wk: "/pieces/cburnett/wK.svg", wq: "/pieces/cburnett/wQ.svg", wr: "/pieces/cburnett/wR.svg",
        wb: "/pieces/cburnett/wB.svg", wn: "/pieces/cburnett/wN.svg", wp: "/pieces/cburnett/wP.svg",
        bk: "/pieces/cburnett/bK.svg", bq: "/pieces/cburnett/bQ.svg", br: "/pieces/cburnett/bR.svg",
        bb: "/pieces/cburnett/bB.svg", bn: "/pieces/cburnett/bN.svg", bp: "/pieces/cburnett/bP.svg",
    };

    const state = {
        code: null, color: null, token: sessionStorage.getItem("chessPlayerToken") || null,
        game: null, flipped: false, selected: null, legalTargets: [], lastMove: null,
        latestState: null, pendingPromotion: null, noticeTimer: null
    };

    const isLobby = !!$("createBtn");
    const isGame = !!$("board");
    const boardEl = $("board");
    const promotionDialog = $("promotionDialog");

    /* ==========================================
       LOBBY LOGIC (index.html)
       ========================================== */
    if (isLobby) {
        const createRoom = () =&gt; {
            if (!socket.connected) return lobbyError("Connecting to server... try again.");
            lobbyError("");
            state.token = sessionStorage.getItem("chessPlayerToken") || null;
            socket.emit("createRoom", { name: $("playerName").value.trim() || "Player", token: state.token });
        };

        const joinRoom = () =&gt; {
            if (!socket.connected) return lobbyError("Connecting to server... try again.");
            const code = $("roomCode").value.trim().toUpperCase();
            if (!/^[A-Z0-9]{6}$/.test(code)) return lobbyError("Enter the 6-character code.");
            lobbyError("");
            socket.emit("joinRoom", { code, name: $("playerName").value.trim() || "Player", token: sessionStorage.getItem("chessPlayerToken") || null });
        };

        $("createBtn").addEventListener("click", createRoom);
        $("joinBtn").addEventListener("click", joinRoom);
        $("roomCode").addEventListener("input", e =&gt; { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); });
        $("roomCode").addEventListener("keydown", e =&gt; { if (e.key === "Enter") joinRoom(); });
        $("playerName").addEventListener("keydown", e =&gt; { if (e.key === "Enter") createRoom(); });

        const savedName = localStorage.getItem("chessPlayerName");
        if (savedName) $("playerName").value = savedName;
        $("playerName").addEventListener("change", () =&gt; localStorage.setItem("chessPlayerName", $("playerName").value.trim()));
    }

    /* ==========================================
       GAME LOGIC (game.html)
       ========================================== */
    if (isGame) {
        function copyCode() {
            if (!state.code) return;
            const text = state.code;
            if (navigator.clipboard &amp;&amp; window.isSecureContext) {
                navigator.clipboard.writeText(text).then(() =&gt; showNotice("Room code copied.")).catch(() =&gt; {});
            } else {
                const el = document.createElement("textarea");
                el.value = text; document.body.appendChild(el); el.select();
                document.execCommand("copy"); el.remove(); showNotice("Room code copied.");
            }
        }

        function findCheckedKingSquare(game) {
            try {
                if (!game) return null;
                var inChk = (typeof game.inCheck === "function") ? game.inCheck() : (game.in_check ? game.in_check() : false);
                if (!inChk) return null;
                const turn = game.turn();
                const board = game.board();
                for (let r = 0; r &lt; 8; r++) {
                    for (let c = 0; c &lt; 8; c++) {
                        const sq = board[r][c];
                        if (sq &amp;&amp; sq.type === "k" &amp;&amp; sq.color === turn) return "abcdefgh"[c] + (8 - r);
                    }
                }
            } catch (e) {}
            return null;
        }

        function renderBoard() {
            if (!state.game) return;
            const checkedKingSquare = findCheckedKingSquare(state.game);
            boardEl.innerHTML = "";
            const files = state.flipped ? "hgfedcba" : "abcdefgh";
            const ranks = state.flipped ? "12345678" : "87654321";
            const fenRows = state.game.board();
            const boardMap = {};
            fenRows.forEach((row, ri) =&gt; row.forEach((p, fi) =&gt; {
                if (p) boardMap["abcdefgh"[fi] + (8 - ri)] = p;
            }));

            for (let r = 0; r &lt; 8; r++) {
                for (let f = 0; f &lt; 8; f++) {
                    const square = files[f] + ranks[r];
                    const piece = boardMap[square];
                    const fileIndex = "abcdefgh".indexOf(square[0]);
                    const rank = Number(square[1]);
                    const light = (fileIndex + rank) % 2 === 0;
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "square " + (light ? "light" : "dark");
                    btn.dataset.square = square;
                    btn.setAttribute("aria-label", square + (piece ? " " + piece.color + " " + piece.type : ""));
                    if (state.selected === square) btn.classList.add("selected");
                    if (state.lastMove &amp;&amp; (state.lastMove.from === square || state.lastMove.to === square)) btn.classList.add("last-move");
                    if (square === checkedKingSquare) btn.classList.add("checked-king");
                    if (piece) {
                        const span = document.createElement("span");
                        span.className = "piece " + (piece.color === "w" ? "white" : "black");
                        span.innerHTML = `&lt;img src="${PIECES[piece.color + piece.type]}" alt="" style="width:100%;height:100%;object-fit:contain;pointer-events:none" /&gt;`;
                        btn.appendChild(span);
                    }
                    if (state.legalTargets.includes(square)) {
                        const mark = document.createElement("span");
                        mark.className = piece ? "capture-ring" : "dot";
                        btn.appendChild(mark);
                    }
                    if (f === 0) {
                        const coord = document.createElement("span");
                        coord.className = "coord rank"; coord.textContent = square[1]; btn.appendChild(coord);
                    }
                    if (r === 7) {
                        const coord = document.createElement("span");
                        coord.className = "coord file"; coord.textContent = square[0]; btn.appendChild(coord);
                    }
                    btn.addEventListener("click", () =&gt; onSquareClick(square));
                    boardEl.appendChild(btn);
                }
            }
        }

        function onSquareClick(square) {
            if (!state.game || !state.latestState || state.latestState.status === "checkmate" ||
                    ["stalemate", "threefold", "insufficient", "draw"].includes(state.latestState.status)) return;
            if (state.latestState.turn !== state.color) return showNotice("It is not your turn.", true);
            const piece = state.game.get(square);
            if (state.selected &amp;&amp; state.legalTargets.includes(square)) {
                const moves = state.game.moves({ square: state.selected, verbose: true }).filter(m =&gt; m.to === square);
                if (moves.filter(m =&gt; m.promotion).length) {
                    state.pendingPromotion = { from: state.selected, to: square };
                    promotionDialog.showModal();
                } else {
                    socket.emit("move", { from: state.selected, to: square });
                    state.selected = null; state.legalTargets = []; renderBoard();
                }
                return;
            }
            if (piece &amp;&amp; piece.color === state.color) {
                state.selected = square;
                state.legalTargets = state.game.moves({ square, verbose: true }).map(m =&gt; m.to);
                renderBoard();
            } else {
                state.selected = null; state.legalTargets = []; renderBoard();
            }
        }

        function renderHistory(history) {
            const list = $("moveList");
            if (!list) return;
            list.innerHTML = "";
            if (!history.length) {
                list.innerHTML = '&lt;div class="empty-moves"&gt;Your opening move will appear here.&lt;/div&gt;';
            } else {
                for (let i = 0; i &lt; history.length; i += 2) {
                    const pair = document.createElement("div");
                    pair.className = "move-pair";
                    pair.innerHTML = `&lt;span class="move-no"&gt;${Math.floor(i/2)+1}.&lt;/span&gt;
                                      &lt;span class="move-san"&gt;${history[i].san}&lt;/span&gt;
                                      &lt;span class="move-san"&gt;${history[i+1] ? history[i+1].san : ''}&lt;/span&gt;`;
                    list.appendChild(pair);
                }
                list.scrollTop = list.scrollHeight;
            }
            if ($("moveCount")) $("moveCount").textContent = history.length + " moves";
        }

        function renderState(s) {
            state.latestState = s;
            try { state.game = new Chess(s.fen); } catch (_) { return showNotice("Error reading board.", true); }

            const other = state.color === "w" ? "b" : "w";
            const me = s.players[state.color];
            const opponent = s.players[other];

            if ($("selfName")) $("selfName").textContent = me ? me.name + " (You)" : "You";
            if ($("selfCaption")) $("selfCaption").textContent = state.color === "w" ? "Playing White" : "Playing Black";
            if ($("opponentName")) $("opponentName").textContent = opponent ? opponent.name : "Waiting for opponent";
            if ($("opponentCaption")) $("opponentCaption").textContent = opponent ? (opponent.connected ? "Connected" : "Reconnecting…") : "Share code";

            const isMyTurn = s.turn === state.color &amp;&amp; s.status === "playing";
            const isTheirTurn = s.turn === other &amp;&amp; s.status === "playing";

            const fmt = (sec) =&gt; {
                if (typeof sec !== "number") return "10:00";
                return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
            };

            if ($("selfClock")) {
                $("selfClock").textContent = fmt(s.timeLeft ? s.timeLeft[state.color] : 600);
                $("selfClock").classList.toggle("active-clock", isMyTurn);
            }
            if ($("opponentClock")) {
                $("opponentClock").textContent = fmt(s.timeLeft ? s.timeLeft[other] : 600);
                $("opponentClock").classList.toggle("active-clock", isTheirTurn);
            }

            if ($("statusBadge")) $("statusBadge").textContent = s.status.toUpperCase();
            if ($("statusTitle")) $("statusTitle").textContent = s.turn === state.color ? "Your Turn" : "Opponent's Turn";
            if ($("statusDescription")) $("statusDescription").textContent = "Waiting for a move...";

            if ($("drawBtn")) $("drawBtn").disabled = !opponent || s.status !== "playing";
            if ($("resignBtn")) $("resignBtn").disabled = !opponent || s.status !== "playing";

            renderHistory(s.history);
            renderBoard();
        }

        /* --- CHAT LOGIC (Game Page Only) --- */
        const chatForm = $("chatForm"), chatInput = $("chatInput"), chatMessages = $("chatMessages");

        if (chatForm &amp;&amp; chatInput) {
            chatForm.addEventListener("submit", function (e) {
                e.preventDefault();
                const message = chatInput.value.trim();
                if (!message || !state.code) return;
                socket.emit("chatMessage", { code: state.code, message: message });
                chatInput.value = "";
            });

            socket.on("chatHistory", (history) =&gt; {
                if (!chatMessages) return;
                chatMessages.innerHTML = "";
                history.forEach(data =&gt; {
                    const div = document.createElement("div");
                    div.className = "chat-msg";
                    div.innerHTML = `&lt;span class="chat-user"&gt;${data.name}:&lt;/span&gt; ${data.message}`;
                    chatMessages.appendChild(div);
                });
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });

            socket.on("chatMessage", function (data) {
                if (!chatMessages || !data) return;
                const div = document.createElement("div");
                div.className = "chat-msg";
                div.innerHTML = `&lt;span class="chat-user"&gt;${data.name}:&lt;/span&gt; ${data.message}`;
                chatMessages.appendChild(div);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
        }

        /* --- GAME EVENT LISTENERS --- */
        if ($("copyCodeBtn")) $("copyCodeBtn").addEventListener("click", copyCode);
        if ($("copyInviteBtn")) $("copyInviteBtn").addEventListener("click", copyCode);
        if ($("flipBtn")) $("flipBtn").addEventListener("click", () =&gt; { state.flipped = !state.flipped; renderBoard(); });
        if ($("drawBtn")) $("drawBtn").addEventListener("click", () =&gt; socket.emit("offerDraw"));
        if ($("rematchBtn")) $("rematchBtn").addEventListener("click", () =&gt; socket.emit("rematch"));

        if ($("leaveBtn")) {
            $("leaveBtn").addEventListener("click", async () =&gt; {
                const ok = await cModal({ title: 'Leave Game', message: 'Are you sure?', okText: 'Leave', danger: true });
                if (ok) {
                    sessionStorage.removeItem("chessRoomCode");
                    sessionStorage.removeItem("chessPlayerToken");
                    window.location.href = "/index.html";
                }
            });
        }

        if ($("resignBtn")) {
            $("resignBtn").addEventListener("click", async () =&gt; {
                const ok = await cModal({ title: 'Resign', message: 'Are you sure you want to resign?', okText: 'Resign', danger: true });
                if (ok) socket.emit("resign");
            });
        }

        if (promotionDialog) {
            promotionDialog.querySelectorAll(".promo-piece").forEach(button =&gt; {
                button.addEventListener("click", event =&gt; {
                    event.preventDefault();
                    const promotion = button.value;
                    const move = state.pendingPromotion;
                    promotionDialog.close();
                    if (move) socket.emit("move", { from: move.from, to: move.to, promotion });
                    state.selected = null; state.legalTargets = []; renderBoard();
                });
            });
            promotionDialog.querySelector(".cancel-promo").addEventListener("click", () =&gt; {
                state.pendingPromotion = null; state.selected = null; state.legalTargets = []; renderBoard();
            });
        }
    }

    /* ==========================================
       SOCKET GLOBAL EVENTS
       ========================================== */
    socket.on("connect", () =&gt; {
        if ($("connectionText")) $("connectionText").textContent = "Connected";
        if (document.querySelector(".live-dot")) document.querySelector(".live-dot").classList.add("connected");

        if (isGame) {
            const savedCode = sessionStorage.getItem("chessRoomCode");
            const token = sessionStorage.getItem("chessPlayerToken");
            if (savedCode &amp;&amp; token &amp;&amp; !state.code) {
                socket.emit("reconnectRoom", { code: savedCode, token });
            } else if (!savedCode) {
                window.location.href = "/index.html";
            }
        }
    });

    socket.on("disconnect", () =&gt; {
        if ($("connectionText")) $("connectionText").textContent = "Reconnecting";
        if (document.querySelector(".live-dot")) document.querySelector(".live-dot").classList.remove("connected");
    });

    socket.on("joined", data =&gt; {
        state.code = data.code; state.color = data.color; state.token = data.token;
        if (isGame) {
            sessionStorage.setItem("chessRoomCode", state.code);
            sessionStorage.setItem("chessPlayerToken", state.token);
            if ($("roomCodeLabel")) $("roomCodeLabel").textContent = state.code;
            if ($("inviteCode")) $("inviteCode").textContent = state.code;
            renderState(data.state);
            showNotice("You are playing " + (state.color === "w" ? "White" : "Black") + ".");
        } else {
            sessionStorage.setItem("chessRoomCode", data.code);
            sessionStorage.setItem("chessPlayerToken", data.token);
            window.location.href = "/game.html";
        }
    });

    socket.on("state", s =&gt; {
        if (state.code &amp;&amp; s.code === state.code &amp;&amp; isGame) {
            renderState(s);
        }
    });

    socket.on("clock", ({ timeLeft, turn }) =&gt; {
        if (!state.color || !isGame) return;
        const other = state.color === "w" ? "b" : "w";
        const fmt = (sec) =&gt; typeof sec !== "number" ? "10:00" : Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");

        if ($("selfClock")) {
            $("selfClock").textContent = fmt(timeLeft[state.color]);
            $("selfClock").classList.toggle("active-clock", turn === state.color);
        }
        if ($("opponentClock")) {
            $("opponentClock").textContent = fmt(timeLeft[other]);
            $("opponentClock").classList.toggle("active-clock", turn === other);
        }
    });

    socket.on("gameError", message =&gt; {
        if (!isGame) lobbyError(message);
        else showNotice(message, true);
    });

    // SVG PRELOADER
    Object.values(PIECES).forEach(src =&gt; { const img = new Image(); img.src = src; });

})();
/* ==========================================================================
   CHESS — Compact Olive-Green Theme
   1. Tokens         2. Reset/Base       3. Header
   4. Layout         5. Lobby            6. Buttons / Inputs
   7. Game shell     8. Board            9. Side panels
  10. Chat          11. Modals          12. Replay / Board-with-players
  13. Embedded      14. Responsive
   ========================================================================== */

/* ---------- 1. TOKENS ---------- */
:root {
  color-scheme: dark;
  --bg: #141810;
  --bg-2: #1a2013;
  --surface: #1f2716;
  --surface-2: #262f1c;
  --line: #2f3a24;
  --line-2: #3d4b2e;
  --ink: #f1f4e8;
  --ink-soft: #b8c0a8;
  --muted: #8a9478;
  --olive: #9bc96c;
  --olive-bright: #b9e08a;
  --olive-dark: #5f9136;
  --olive-deep: #3d5f22;
  --cream: #eeeed2;
  --brown: #769656;
  --danger: #e0684f;
  --radius: 14px;
  --radius-lg: 20px;
  --font: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

/* ---------- 2. RESET / BASE ---------- */
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { min-height: 100%; }

body {
  background:
    radial-gradient(ellipse at 50% -30%, rgba(155, 201, 108, 0.10), transparent 55%),
    radial-gradient(ellipse at 100% 100%, rgba(118, 150, 86, 0.06), transparent 50%),
    var(--bg);
  color: var(--ink);
  font-family: var(--font);
  font-size: 14px;
  line-height: 1.5;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

.hidden { display: none !important; }

/* ---------- 3. HEADER ---------- */
.topbar {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: rgba(20, 24, 16, 0.85);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--ink);
}

.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--olive);
  color: #14200a;
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
}

.brand-name {
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 2px;
}

.top-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-soft);
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d99a55;
  transition: all .3s;
}

.live-dot.connected {
  background: var(--olive);
  box-shadow: 0 0 10px var(--olive);
}

/* ---------- 4. LAYOUT ---------- */
.layout {
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px 20px 40px;
}

/* ---------- 5. LOBBY ---------- */
.lobby { max-width: 440px; margin: 0 auto; }

.hero { text-align: center; margin-bottom: 28px; }

.eyebrow {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--olive);
  padding: 6px 12px;
  border: 1px solid rgba(155, 201, 108, 0.35);
  border-radius: 999px;
  margin-bottom: 16px;
}

.hero h1 {
  font-size: clamp(32px, 6vw, 48px);
  font-weight: 800;
  letter-spacing: -1.5px;
  line-height: 1.05;
  margin-bottom: 12px;
  color: var(--ink);
}

.hero h1 em {
  font-style: italic;
  font-weight: 500;
  color: var(--olive);
}

.hero p {
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.6;
  max-width: 340px;
  margin: 0 auto;
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 22px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.card-head .label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--muted);
}

.card-head .icon {
  font-size: 26px;
  color: var(--olive);
  opacity: 0.85;
}

.field-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--muted);
  margin: 16px 0 8px;
}

/* ---------- 6. BUTTONS / INPUTS ---------- */
.text-input {
  width: 100%;
  height: 46px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 14px;
  color: var(--ink);
  font: 500 15px var(--font);
  outline: none;
  transition: all .15s;
}

.text-input:focus {
  border-color: var(--olive);
  box-shadow: 0 0 0 3px rgba(155, 201, 108, 0.18);
}

.text-input::placeholder { color: #5a6650; }

.code-input {
  letter-spacing: 4px;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 16px;
  text-align: center;
  text-transform: uppercase;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 46px;
  padding: 0 18px;
  border: none;
  border-radius: 10px;
  font: 700 14px var(--font);
  cursor: pointer;
  transition: all .15s;
  text-decoration: none;
}

.btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
.btn:active { transform: translateY(0); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
.btn:focus-visible { outline: 2px solid var(--olive-bright); outline-offset: 2px; }

.btn-primary { background: var(--olive); color: #14200a; }

.btn-create {
  width: 100%;
  margin-top: 16px;
  justify-content: space-between;
  padding: 0 18px;
}

.btn-create .arrow { font-size: 18px; }

.btn-secondary {
  background: var(--surface-2);
  color: var(--ink);
  border: 1px solid var(--line-2);
}

.btn-danger {
  background: rgba(224, 104, 79, 0.12);
  color: var(--danger);
  border: 1px solid rgba(224, 104, 79, 0.35);
}

.btn-ghost {
  background: transparent;
  color: var(--ink-soft);
  border: 1px solid var(--line);
}

.btn-ghost-sm {
  background: transparent;
  color: var(--ink-soft);
  border: 1px solid var(--line);
  padding: 6px 12px;
  margin-right: 2px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all .15s;
  text-decoration: none;
}

.btn-ghost-sm:hover {
  color: var(--ink);
  border-color: var(--line-2);
}

.btn-ghost-back {
  background: transparent;
  color: var(--ink-soft);
  border: 1px solid var(--line);
  padding: 6px 12px;
  margin-right: 75px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all .15s;
  text-decoration: none;
}

.btn-ghost-back:hover {
  color: var(--ink);
  border-color: var(--line-2);
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0 4px;
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}

.join-row { display: flex; gap: 8px; }
.join-row .text-input { flex: 1; min-width: 0; }
.join-row .btn { padding: 0 18px; flex-shrink: 0; }

.error-text {
  color: var(--danger);
  font-size: 12px;
  margin-top: 10px;
  min-height: 14px;
}

.privacy-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  background: rgba(155, 201, 108, 0.04);
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
}

/* ---------- 7. GAME SHELL ---------- */
.game-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.game-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.game-topline .label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--muted);
  display: block;
  margin-bottom: 2px;
}

.room-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
}

.room-line strong {
  font-family: var(--font-mono);
  font-weight: 800;
  letter-spacing: 3px;
  color: var(--olive);
}

.copy-btn {
  background: transparent;
  border: none;
  color: var(--olive);
  font: 700 11px var(--font);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background .15s;
}

.copy-btn:hover { background: rgba(155, 201, 108, 0.12); }

.game-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 12px;
  align-items: start;
}

/* ---------- 8. BOARD ---------- */
.board-panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 8px;
  min-width: 0;
}

.player-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px 6px;
}

.self-strip { padding: 6px 2px 4px; }

.avatar {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 15px;
  background: var(--surface-2);
  color: var(--ink-soft);
  border: 1px solid var(--line);
}

.self-avatar {
  background: var(--olive);
  color: #14200a;
  border-color: var(--olive);
}

.player-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.player-info strong {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-info span {
  font-size: 9px;
  color: var(--muted);
}

.clock {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--bg-2);
  color: var(--ink-soft);
  border: 1px solid var(--line);
  min-width: 56px;
  text-align: center;
  letter-spacing: 0.5px;
}

.clock.active-clock {
  background: var(--olive-bright);
  color: #14200a;
  border-color: var(--olive-bright);
}

.board-frame {
  border-radius: 4px;
  overflow: hidden;
  border: 3px solid var(--line-2);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}

.board {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  width: 100%;
  aspect-ratio: 1 / 1;
  touch-action: manipulation;
  user-select: none;
}

.board-frame, .board {
  touch-action: none !important;
  -webkit-user-select: none !important;
  user-select: none !important;
  -webkit-touch-callout: none !important;
}

.square {
  position: relative;
  border: none;
  padding: 0;
  aspect-ratio: 1 / 1;
  display: grid;
  place-items: center;
  cursor: pointer;
  min-width: 0;
  transition: background .1s;
}

.square.light { background: #eeeed2; }
.square.dark  { background: #769656; }

.square.selected { box-shadow: inset 0 0 0 3px var(--olive-bright); }

.square.light.last-move,
.square.dark.last-move,
.square.light.replay-last-move,
.square.dark.replay-last-move {
  background-color: #f6f669 !important;
  box-shadow: inset 0 0 0 1px #60600c36 !important;
}

.square.replay-last-move .piece { z-index: 3; }

.square.checked-king {
  background-color: #d44a3f !important;
  box-shadow: inset 0 0 0 3px #f2665d !important;
}

.square.checked-king .piece {
  color: #fffdf4 !important;
  text-shadow:
    0 1px 2px rgba(0,0,0,0.7),
    1px 0 rgba(0,0,0,0.7),
   -1px 0 rgba(0,0,0,0.7),
    0 -1px rgba(0,0,0,0.7) !important;
}

.piece {
  width: 90%;
  height: 90%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0;
  text-shadow: none;
  filter: none;
  position: relative;
  z-index: 2;
}

.piece img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.square .dot {
  position: absolute;
  width: 22%;
  height: 22%;
  border-radius: 50%;
  background: rgba(32, 45, 30, 0.4);
  z-index: 3;
}

.square .capture-ring {
  position: absolute;
  inset: 5%;
  border-radius: 50%;
  border: 3px solid rgba(32, 45, 30, 0.45);
  z-index: 3;
}

.square .coord {
  position: absolute;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
  z-index: 4;
}

.square .coord.rank { top: 3px; left: 3px; }
.square .coord.file { bottom: 3px; right: 3px; }
.square.light .coord { color: #7a6549; }
.square.dark  .coord { color: #eeeed2; }

.board-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  gap: 10px;
}

.board-footer &gt; span {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--ink-soft);
}

.turn-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--olive);
}

/* ---------- 9. SIDE PANELS ---------- */
.side-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 12px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.panel-head .label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--muted);
}

.status-badge {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--olive);
  background: rgba(155, 201, 108, 0.12);
  border: 1px solid rgba(155, 201, 108, 0.3);
  padding: 4px 8px;
  border-radius: 5px;
}

.status-panel { padding: 8px 12px; }

.status-panel h3 {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 2px;
  color: var(--ink);
}

.status-panel &gt; p {
  font-size: 10px;
  line-height: 1.3;
  color: var(--muted);
}

.invite-box {
  margin-top: 6px;
  padding: 6px 10px;
  background: var(--bg-2);
  border: 1px dashed var(--line-2);
  border-radius: 9px;
}

.invite-box &gt; span {
  display: block;
  font-size: 9px;
  letter-spacing: 1.5px;
  color: var(--muted);
  margin-bottom: 2px;
}

.invite-box &gt; div {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.invite-box strong {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 4px;
  color: var(--olive);
}

.moves-panel .panel-head h3 { font-size: 13px; font-weight: 700; }
.moves-panel .panel-head &gt; span { font-size: 10px; color: var(--muted); }

.move-list {
  max-height: 100px;
  overflow-y: auto;
  margin: 0 -4px;
}

.empty-moves {
  text-align: center;
  padding: 16px 8px;
  color: var(--muted);
  font-size: 11px;
  font-style: italic;
}

.move-pair {
  display: grid;
  grid-template-columns: 24px 1fr 1fr;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 11px;
}

.move-pair:nth-child(even) {
  background: rgba(155, 201, 108, 0.03);
}

.move-no {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.move-san {
  font-weight: 600;
  color: var(--ink-soft);
  font-family: var(--font-mono);
}

.move-san.latest { color: var(--olive); }

.captured-panel .label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--muted);
  margin-bottom: 10px;
}

.captured-row {
  display: grid;
  grid-template-columns: 65px 1fr;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
}

.captured-row &gt; span {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--muted);
}

.captured-pieces {
  font-size: 18px;
  letter-spacing: -2px;
  min-height: 20px;
  color: var(--cream);
  overflow-wrap: anywhere;
}

.action-row {
  display: flex;
  flex-direction: row;
  gap: 8px;
}

.action-row .btn {
  flex: 1;
  min-height: 34px;
  font-size: 11px;
}

.rematch-btn {
  width: 100%;
  min-height: 42px;
  font-size: 12px;
}

.game-notice {
  min-height: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--olive);
  margin-top: 6px;
}

.error-toast { color: var(--danger) !important; }

/* ---------- 10. CHAT ---------- */
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 180px;
  min-height: 180px;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 8px;
  margin-bottom: 6px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-msg {
  word-break: break-word;
  line-height: 1.4;
}

.chat-msg span.chat-user {
  font-weight: 700;
  color: var(--olive);
  margin-right: 4px;
}

.chat-form { display: flex; gap: 6px; }

.chat-form .text-input {
  height: 30px;
  font-size: 12px;
  padding: 0 8px;
}

.chat-form .btn {
  min-height: 30px;
  padding: 0 12px;
  font-size: 12px;
}

/* ---------- 11. MODALS ---------- */
.promotion-dialog {
  border: 1px solid var(--line-2);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--ink);
  padding: 24px;
  width: min(340px, calc(100% - 32px));
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7);
}

.promotion-dialog::backdrop {
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.promotion-dialog h3 {
  font-size: 18px;
  font-weight: 800;
  margin-bottom: 4px;
}

.promotion-dialog p {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 16px;
}

.promotion-options {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.promo-piece {
  font-family: 'Segoe UI Symbol', serif;
  font-size: 32px;
  aspect-ratio: 1;
  background: var(--surface-2);
  border: 1px solid var(--line-2);
  border-radius: 10px;
  color: var(--cream);
  cursor: pointer;
  transition: all .15s;
}

.promo-piece:hover {
  background: var(--olive);
  color: #14200a;
  border-color: var(--olive);
}

.cancel-promo { width: 100%; }

.chess-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.chess-modal-backdrop.open { display: flex; }

.chess-modal {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  max-width: 380px;
  width: 100%;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  animation: chessModalIn 0.2s ease;
}

@keyframes chessModalIn {
  from { transform: scale(0.95); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

.chess-modal h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 800;
  color: var(--ink);
}

.chess-modal p {
  margin: 0 0 20px;
  font-size: 14px;
  color: var(--ink-soft);
  line-height: 1.5;
}

.chess-modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.chess-modal-btn {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink);
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  min-width: 80px;
}

.chess-modal-btn:hover { filter: brightness(1.15); }

.chess-modal-btn.primary {
  background: var(--olive);
  color: #14200a;
  border-color: var(--olive);
}

.chess-modal-btn.danger {
  background: rgba(224, 104, 79, 0.15);
  color: var(--danger);
  border-color: rgba(224, 104, 79, 0.4);
}

.chess-modal-btn.danger:hover { background: rgba(224, 104, 79, 0.25); }

.chess-modal[dir="rtl"] .chess-modal-actions { justify-content: flex-start; }

/* ---------- 12. REPLAY / BOARD-WITH-PLAYERS ---------- */
.replay-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
  margin: 16px 0;
  flex-wrap: wrap;
}

.replay-bar button {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  font-weight: 700;
  cursor: pointer;
}

.replay-bar button:disabled { opacity: .4; cursor: not-allowed; }

.replay-bar button.primary {
  background: var(--olive);
  color: #14200a;
  border-color: var(--olive);
}

.replay-info {
  text-align: center;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--muted);
}

.replay-info strong { color: var(--ink); font-size: 15px; }

.move-time {
  font-size: 10px;
  color: var(--muted);
  margin-left: 6px;
  font-weight: 400;
}

.mode-row {
  text-align: center;
  margin: 8px 0;
  font-size: 12px;
  color: var(--muted);
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
}

.mode-btn {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-soft);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.mode-btn.active {
  background: var(--olive);
  color: #14200a;
  border-color: var(--olive);
}

.board-with-players {
  display: grid;
  grid-template-columns: 140px 1fr 140px;
  gap: 12px;
  align-items: center;
  max-width: 820px;
  margin: 0 auto;
}

.player-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
}

.player-side .avatar {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--surface-2);
  color: var(--ink-soft);
  display: grid;
  place-items: center;
  font-size: 22px;
  border: 1px solid var(--line);
}

.player-side.white .avatar {
  background: #eeeed2;
  color: #1a1410;
  border-color: #ddd5b8;
}

.player-side.black .avatar {
  background: #3a3834;
  color: #eeeed2;
  border-color: #555;
}

.player-side .name {
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  word-break: break-word;
  max-width: 100%;
}

.player-side .clock {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  background: var(--bg-2);
  color: var(--ink-soft);
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
}

/* ---------- 13. EMBEDDED ---------- */
body.embedded .topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 90px;
}

body.embedded .brand { flex-shrink: 0; }

body.embedded .top-status {
  order: 0;
  margin-left: 4px;
}

body.embedded .top-status #connectionText { display: none; }
body.embedded .top-status .live-dot { margin: 0; }

/* ---------- 14. RESPONSIVE ---------- */
@media (max-width: 1024px) {
  .layout {
    padding: 12px 10px 22px;
    overflow-x: hidden;
  }

  .game-grid {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
  }

  .game-topline {
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px;
    width: 100%;
    box-sizing: border-box;
  }

  .room-line { flex-wrap: wrap; }

  .board-panel {
    width: 100%;
    box-sizing: border-box;
    padding: 6px;
  }

  .side-panel {
    width: 100%;
    display: flex;
    flex-direction: column;
  }

  .chat-panel {
    height: 200px;
    min-height: 200px;
  }
}

@media (max-width: 760px) {
  .topbar { height: 54px; padding: 0 14px; }
  .brand-name { font-size: 12px; letter-spacing: 1.5px; }
  .brand-mark { width: 28px; height: 28px; font-size: 18px; }
  .top-status { font-size: 11px; }

  .layout { padding: 16px 12px 24px; }

  .hero { margin-bottom: 20px; }
  .hero h1 { font-size: 34px; }
  .hero p { font-size: 13px; }
  .eyebrow { font-size: 9px; padding: 4px 10px; margin-bottom: 12px; }

  .card { padding: 18px; }

  .game-topline { padding: 10px 14px; }
  .room-line { font-size: 16px; }
  .room-line strong { letter-spacing: 2px; }

  .board-panel { padding: 6px; }

  .player-strip { gap: 8px; padding: 4px 2px 6px; }
  .self-strip { padding: 6px 2px 4px; }
  .avatar { width: 26px; height: 26px; font-size: 15px; }
  .player-info strong { font-size: 11px; }
  .player-info span { font-size: 9px; }
  .clock { font-size: 12px; padding: 3px 8px; min-width: 56px; }

  .move-list { max-height: 140px; }
  .move-pair { font-size: 10px; padding: 4px 6px; }

  .captured-pieces { font-size: 16px; }

  .board-with-players {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .player-side {
    flex-direction: row;
    justify-content: space-between;
    padding: 8px 12px;
  }

  .player-side .name {
    text-align: left;
    font-size: 12px;
  }
}

@media (max-width: 380px) {
  .layout { padding: 12px 8px 20px; }
  .hero h1 { font-size: 28px; }
  .card { padding: 16px; }
  .join-row { flex-direction: column; }
  .join-row .btn { width: 100%; }
  .side-panel { grid-template-columns: 1fr; }
  .captured-panel, .action-row { grid-column: 1; }
}

@media (min-width: 1000px) {
  .board-panel { padding: 16px; }
  .board-frame { border-width: 4px; }
  .side-panel { position: sticky; top: 76px; }
}