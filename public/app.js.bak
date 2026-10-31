(() => {
    const $ = id => document.getElementById(id);
    const socket = io();

    /* ==========================================
       UTILITIES & MODALS
       ========================================== */
    function cModal({ title, message, okText, cancelText, danger = false }) {
        const isAr = document.cookie.split('; ').some(c => c === 'lang=ar');
        const bg = document.createElement("div");
        bg.className = "chess-modal-backdrop open";
        bg.innerHTML = '<div class="chess-modal" dir="' + (isAr ? 'rtl' : 'ltr') + '">' +
            '<h3>' + (title || (isAr ? 'تأكيد' : 'Confirm')) + '</h3>' +
            '<p>' + (message || '') + '</p>' +
            '<div class="chess-modal-actions">' +
            '<button class="chess-modal-btn" data-action="cancel">' + (cancelText || (isAr ? 'إلغاء' : 'Cancel')) + '</button>' +
            '<button class="chess-modal-btn ' + (danger ? 'danger' : 'primary') + '" data-action="ok">' + (okText || (isAr ? 'موافق' : 'OK')) + '</button>' +
            '</div></div>';
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
            state.noticeTimer = setTimeout(() => {
                if (el.textContent === message) {
                    el.style.display = "none";
                    el.textContent = "";
                }
            }, 4000);
        }
    }

    function lobbyError(message) { if ($("lobbyError")) $("lobbyError").textContent = message || ""; }

    /* ==========================================
       STATE & CONSTANTS
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
        const createRoom = () => {
            if (!socket.connected) return lobbyError("Connecting to server... try again.");
            lobbyError("");
            state.token = sessionStorage.getItem("chessPlayerToken") || null;
            socket.emit("createRoom", { name: $("playerName").value.trim() || "Player", token: state.token });
        };

        const joinRoom = () => {
            if (!socket.connected) return lobbyError("Connecting to server... try again.");
            const code = $("roomCode").value.trim().toUpperCase();
            if (!/^[A-Z0-9]{6}$/.test(code)) return lobbyError("Enter the 6-character code.");
            lobbyError("");
            socket.emit("joinRoom", { code, name: $("playerName").value.trim() || "Player", token: sessionStorage.getItem("chessPlayerToken") || null });
        };

        $("createBtn").addEventListener("click", createRoom);
        $("joinBtn").addEventListener("click", joinRoom);
        $("roomCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); });
        $("roomCode").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom(); });
        $("playerName").addEventListener("keydown", e => { if (e.key === "Enter") createRoom(); });

        const savedName = localStorage.getItem("chessPlayerName");
        if (savedName) $("playerName").value = savedName;
        $("playerName").addEventListener("change", () => localStorage.setItem("chessPlayerName", $("playerName").value.trim()));
    }

    /* ==========================================
       GAME LOGIC (game.html)
       ========================================== */
    if (isGame) {
        function copyCode() {
            if (!state.code) return;
            const text = state.code;
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(() => showNotice("Room code copied.")).catch(() => {});
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
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        const sq = board[r][c];
                        if (sq && sq.type === "k" && sq.color === turn) return "abcdefgh"[c] + (8 - r);
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
            fenRows.forEach((row, ri) => row.forEach((p, fi) => {
                if (p) boardMap["abcdefgh"[fi] + (8 - ri)] = p;
            }));

            for (let r = 0; r < 8; r++) {
                for (let f = 0; f < 8; f++) {
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
                    if (state.lastMove && (state.lastMove.from === square || state.lastMove.to === square)) btn.classList.add("last-move");
                    if (square === checkedKingSquare) btn.classList.add("checked-king");
                    if (piece) {
                        const span = document.createElement("span");
                        span.className = "piece " + (piece.color === "w" ? "white" : "black");
                        span.innerHTML = `<img src="${PIECES[piece.color + piece.type]}" alt="" style="width:100%;height:100%;object-fit:contain;pointer-events:none" />`;
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
                    btn.addEventListener("click", () => onSquareClick(square));
                    boardEl.appendChild(btn);
                }
            }
        }

        function onSquareClick(square) {
            if (!state.game || !state.latestState || state.latestState.status === "checkmate" ||
                    ["stalemate", "threefold", "insufficient", "draw"].includes(state.latestState.status)) return;
            if (state.latestState.turn !== state.color) return showNotice("It is not your turn.", true);
            const piece = state.game.get(square);
            if (state.selected && state.legalTargets.includes(square)) {
                const moves = state.game.moves({ square: state.selected, verbose: true }).filter(m => m.to === square);
                if (moves.filter(m => m.promotion).length) {
                    state.pendingPromotion = { from: state.selected, to: square };
                    promotionDialog.showModal();
                } else {
                    socket.emit("move", { from: state.selected, to: square });
                    state.selected = null; state.legalTargets = []; renderBoard();
                }
                return;
            }
            if (piece && piece.color === state.color) {
                state.selected = square;
                state.legalTargets = state.game.moves({ square, verbose: true }).map(m => m.to);
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
                list.innerHTML = '<div class="empty-moves">Your opening move will appear here.</div>';
            } else {
                for (let i = 0; i < history.length; i += 2) {
                    const pair = document.createElement("div");
                    pair.className = "move-pair";
                    pair.innerHTML = `<span class="move-no">${Math.floor(i/2)+1}.</span>
                                      <span class="move-san">${history[i].san}</span>
                                      <span class="move-san">${history[i+1] ? history[i+1].san : ''}</span>`;
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

            const isMyTurn = s.turn === state.color && s.status === "playing";
            const isTheirTurn = s.turn === other && s.status === "playing";

            const fmt = (sec) => {
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
            if ($("turnIndicator")) $("turnIndicator").innerHTML = `<i class="turn-dot"></i> ${isMyTurn ? "Your Turn" : "Opponent's Turn"}`;

            if ($("drawBtn")) $("drawBtn").disabled = !opponent || s.status !== "playing";
            if ($("resignBtn")) $("resignBtn").disabled = !opponent || s.status !== "playing";

            renderHistory(s.history);
            renderBoard();
        }

        /* --- CHAT LOGIC (Game Page Only) --- */
        const chatForm = $("chatForm"), chatInput = $("chatInput"), chatMessages = $("chatMessages");

        if (chatForm && chatInput) {
            chatForm.addEventListener("submit", function (e) {
                e.preventDefault();
                const message = chatInput.value.trim();
                if (!message || !state.code) return;
                socket.emit("chatMessage", { code: state.code, message: message });
                chatInput.value = "";
            });

            socket.on("chatHistory", (history) => {
                if (!chatMessages) return;
                chatMessages.innerHTML = "";
                history.forEach(data => {
                    const div = document.createElement("div");
                    div.className = "chat-msg";
                    div.innerHTML = `<span class="chat-user">${data.name}:</span> ${data.message}`;
                    chatMessages.appendChild(div);
                });
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });

            socket.on("chatMessage", function (data) {
                if (!chatMessages || !data) return;
                const div = document.createElement("div");
                div.className = "chat-msg";
                div.innerHTML = `<span class="chat-user">${data.name}:</span> ${data.message}`;
                chatMessages.appendChild(div);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
        }

        /* --- GAME EVENT LISTENERS --- */
        if ($("copyCodeBtn")) $("copyCodeBtn").addEventListener("click", copyCode);
        if ($("copyInviteBtn")) $("copyInviteBtn").addEventListener("click", copyCode);
        if ($("flipBtn")) $("flipBtn").addEventListener("click", () => { state.flipped = !state.flipped; renderBoard(); });
        if ($("drawBtn")) $("drawBtn").addEventListener("click", () => socket.emit("offerDraw"));
        if ($("rematchBtn")) $("rematchBtn").addEventListener("click", () => socket.emit("rematch"));

        if ($("leaveBtn")) {
            $("leaveBtn").addEventListener("click", async () => {
                const ok = await cModal({ title: 'Leave Game', message: 'Are you sure?', okText: 'Leave', danger: true });
                if (ok) {
                    sessionStorage.removeItem("chessRoomCode");
                    sessionStorage.removeItem("chessPlayerToken");
                    window.location.href = "/index.html";
                }
            });
        }

        if ($("resignBtn")) {
            $("resignBtn").addEventListener("click", async () => {
                const ok = await cModal({ title: 'Resign', message: 'Are you sure you want to resign?', okText: 'Resign', danger: true });
                if (ok) socket.emit("resign");
            });
        }

        if (promotionDialog) {
            promotionDialog.querySelectorAll(".promo-piece").forEach(button => {
                button.addEventListener("click", event => {
                    event.preventDefault();
                    const promotion = button.value;
                    const move = state.pendingPromotion;
                    promotionDialog.close();
                    if (move) socket.emit("move", { from: move.from, to: move.to, promotion });
                    state.selected = null; state.legalTargets = []; renderBoard();
                });
            });
            promotionDialog.querySelector(".cancel-promo").addEventListener("click", () => {
                state.pendingPromotion = null; state.selected = null; state.legalTargets = []; renderBoard();
            });
        }
    }

    /* ==========================================
       SOCKET GLOBAL EVENTS
       ========================================== */
    socket.on("connect", () => {
        if ($("connectionText")) $("connectionText").textContent = "Connected";
        if (document.querySelector(".live-dot")) document.querySelector(".live-dot").classList.add("connected");

        if (isGame) {
            const savedCode = sessionStorage.getItem("chessRoomCode");
            const token = sessionStorage.getItem("chessPlayerToken");
            if (savedCode && token && !state.code) {
                socket.emit("reconnectRoom", { code: savedCode, token });
            } else if (!savedCode) {
                window.location.href = "/index.html";
            }
        }
    });

    socket.on("disconnect", () => {
        if ($("connectionText")) $("connectionText").textContent = "Reconnecting";
        if (document.querySelector(".live-dot")) document.querySelector(".live-dot").classList.remove("connected");
    });

    socket.on("joined", data => {
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

    socket.on("state", s => {
        if (state.code && s.code === state.code && isGame) {
            renderState(s);
        }
    });

    socket.on("clock", ({ timeLeft, turn }) => {
        if (!state.color || !isGame) return;
        const other = state.color === "w" ? "b" : "w";
        const fmt = (sec) => typeof sec !== "number" ? "10:00" : Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");

        if ($("selfClock")) {
            $("selfClock").textContent = fmt(timeLeft[state.color]);
            $("selfClock").classList.toggle("active-clock", turn === state.color);
        }
        if ($("opponentClock")) {
            $("opponentClock").textContent = fmt(timeLeft[other]);
            $("opponentClock").classList.toggle("active-clock", turn === other);
        }
    });

    socket.on("gameError", message => {
        if (!isGame) lobbyError(message);
        else showNotice(message, true);
    });

    // SVG PRELOADER
    Object.values(PIECES).forEach(src => { const img = new Image(); img.src = src; });

})();