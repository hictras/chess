(() => {
    const $ = id => document.getElementById(id);
    const socket = io();

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
    const PIECES = {
        wk: "/pieces/cburnett/wK.svg",
        wq: "/pieces/cburnett/wQ.svg",
        wr: "/pieces/cburnett/wR.svg",
        wb: "/pieces/cburnett/wB.svg",
        wn: "/pieces/cburnett/wN.svg",
        wp: "/pieces/cburnett/wP.svg",
        bk: "/pieces/cburnett/bK.svg",
        bq: "/pieces/cburnett/bQ.svg",
        br: "/pieces/cburnett/bR.svg",
        bb: "/pieces/cburnett/bB.svg",
        bn: "/pieces/cburnett/bN.svg",
        bp: "/pieces/cburnett/bP.svg",
    };
    const state = {
        code: null, color: null, token: sessionStorage.getItem("chessPlayerToken") || null,
        game: null, flipped: false, selected: null, legalTargets: [], lastMove: null,
        latestState: null, pendingPromotion: null, noticeTimer: null
    };
    const boardEl = $("board");
    const promotionDialog = $("promotionDialog");
    

    function showNotice(message, error = false) {
        const el = $("gameNotice");
        el.textContent = message || "";
        el.classList.toggle("error-toast", error);
        clearTimeout(state.noticeTimer);
        if (message) state.noticeTimer = setTimeout(() => { if (el.textContent === message) el.textContent = ""; }, 5000);
    }
    function lobbyError(message) { $("lobbyError").textContent = message || ""; }
    function displayGame() {
        $("lobby").classList.add("hidden");
        $("game").classList.remove("hidden");
        $("roomCodeLabel").textContent = state.code;
        $("inviteCode").textContent = state.code;
    }
    function showLobby() {
        $("game").classList.add("hidden");
        $("lobby").classList.remove("hidden");
        state.code = null; state.color = null; state.game = null;
        state.selected = null; state.legalTargets = []; state.latestState = null;
    }
    function copyCode() {
        if (!state.code) return;
        const text = state.code;
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => showNotice("Room code copied.")).catch(() => fallbackCopy(text));
        } else fallbackCopy(text);
    }
    function fallbackCopy(text) {
        const el = document.createElement("textarea");
        el.value = text; document.body.appendChild(el); el.select();
        try { document.execCommand("copy"); showNotice("Room code copied."); }
        catch (_) { showNotice("Your room code is " + text); }
        el.remove();
    }
    function safeName() { return $("playerName").value.trim().slice(0, 24) || "Player"; }
    function persistSession() {
        if (state.code && state.token) {
            sessionStorage.setItem("chessRoomCode", state.code);
            sessionStorage.setItem("chessPlayerToken", state.token);
        }
    }
    function createRoom() {
        if (!socket.connected) return lobbyError("Connecting to the game server. Please try again in a moment.");
        lobbyError("");
        state.token = sessionStorage.getItem("chessPlayerToken") || null;
        socket.emit("createRoom", { name: safeName(), token: state.token });
    }
    function joinRoom() {
        if (!socket.connected) return lobbyError("Connecting to the game server. Please try again in a moment.");
        const code = $("roomCode").value.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) return lobbyError("Enter the 6-character room code.");
        lobbyError("");
        socket.emit("joinRoom", { code, name: safeName(), token: sessionStorage.getItem("chessPlayerToken") || null });
    }
    function getLegalTargets(square) {
        if (!state.game) return [];
        return state.game.moves({ square, verbose: true }).map(m => m.to);
    }
    function pieceAt(square) {
        const piece = state.game && state.game.get(square);
        return piece ? PIECES[piece.color + piece.type] : "";
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
                    if (sq && sq.type === "k" && sq.color === turn) {
                        return "abcdefgh"[c] + (8 - r);
                    }
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
            const promotionMoves = moves.filter(m => m.promotion);
            if (promotionMoves.length) {
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
            state.legalTargets = getLegalTargets(square);
            renderBoard();
        } else {
            state.selected = null; state.legalTargets = []; renderBoard();
        }
    }
    function renderHistory(history) {
        const list = $("moveList");
        list.innerHTML = "";
        if (!history.length) {
            const empty = document.createElement("div");
            empty.className = "empty-moves"; empty.textContent = "Your opening move will appear here.";
            list.appendChild(empty);
        } else {
            for (let i = 0; i < history.length; i += 2) {
                const pair = document.createElement("div");
                pair.className = "move-pair";
                const no = document.createElement("span"); no.className = "move-no"; no.textContent = (Math.floor(i / 2) + 1) + ".";
                const white = document.createElement("span"); white.className = "move-san"; white.textContent = history[i].san;
                const black = document.createElement("span"); black.className = "move-san";
                if (history[i + 1]) black.textContent = history[i + 1].san;
                if (i + (history[i + 1] ? 1 : 0) === history.length - 1) (history[i + 1] || history[i]).san && (history[i + 1] ? black : white).classList.add("latest");
                pair.append(no, white, black); list.appendChild(pair);
            }
            list.scrollTop = list.scrollHeight;
        }
        $("moveCount").textContent = history.length + (history.length === 1 ? " move" : " moves");
    }

    function capturedPieces(history, capturedColor) {
        const captured = history.filter(m => m.captured && m.color !== capturedColor);
        if (!captured.length) return document.createTextNode("—");
        const container = document.createElement("div");
        container.style.display = "flex";
        container.style.gap = "2px";
        container.style.alignItems = "center";
        container.style.flexWrap = "wrap";
        captured.forEach(m => {
            const img = document.createElement("img");
            img.src = PIECES[capturedColor + m.captured];
            img.alt = m.captured;
            img.style.width = "18px";
            img.style.height = "18px";
            img.style.objectFit = "contain";
            container.appendChild(img);
        });
        return container;
    }

    function renderState(s) {
        state.latestState = s;
        try { state.game = new Chess(s.fen); } catch (_) { return showNotice("Could not read the latest board position.", true); }
        if (state.selected && !state.game.get(state.selected)) { state.selected = null; state.legalTargets = []; }
        const other = state.color === "w" ? "b" : "w";
        const me = s.players[state.color];
        const opponent = s.players[other];
        $("selfName").textContent = me ? me.name + " (You)" : "You";
        $("selfCaption").textContent = state.color === "w" ? "Playing White" : "Playing Black";
        $("opponentName").textContent = opponent ? opponent.name : "Waiting for opponent";
        $("opponentCaption").textContent = opponent ? (opponent.connected ? "Connected" : "Reconnecting…") : "Share the room code to invite them";
        const isMyTurn = s.turn === state.color && s.status === "playing";
        const isTheirTurn = s.turn === other && s.status === "playing";
        const fmt = (sec) => {
            if (typeof sec !== "number") return "10:00";
            const m = Math.floor(sec / 60);
            const r = sec % 60;
            return m + ":" + String(r).padStart(2, "0");
        };
        $("selfClock").textContent = fmt(s.timeLeft ? s.timeLeft[state.color] : 600);
        $("opponentClock").textContent = fmt(s.timeLeft ? s.timeLeft[other] : 600);
        $("selfClock").classList.toggle("active-clock", isMyTurn);
        $("opponentClock").classList.toggle("active-clock", isTheirTurn);
        $("turnIndicator").innerHTML = '<i class="turn-dot"></i> ' + statusLine(s);
        const badge = $("statusBadge");
        badge.textContent = badgeText(s);
        $("statusTitle").textContent = titleText(s);
        $("statusDescription").textContent = descriptionText(s);
        $("drawBtn").disabled = !opponent || s.status !== "playing";
        $("resignBtn").disabled = !opponent || s.status !== "playing";
        $("rematchBtn").classList.toggle("hidden", !["checkmate", "stalemate", "threefold", "insufficient", "draw"].includes(s.status));
        $("rematchBtn").textContent = s.rematch && s.rematch[state.color] ? "✓ Rematch requested" : "↻ Request rematch";

        const capturedYouEl = $("capturedByYou");
        capturedYouEl.innerHTML = "";
        capturedYouEl.appendChild(capturedPieces(s.history, state.color));

        const capturedOppEl = $("capturedByOpponent");
        capturedOppEl.innerHTML = "";
        capturedOppEl.appendChild(capturedPieces(s.history, other));

        renderHistory(s.history);
        renderBoard();
    }
    function statusLine(s) {
        if (!s.players.b) return "Waiting for opponent";
        if (!s.players.w?.connected || !s.players.b?.connected) return "Player reconnecting";
        if (s.status === "checkmate") return "Checkmate";
        if (["stalemate", "threefold", "insufficient", "draw", "resigned"].includes(s.status)) return "Game drawn";
        if (s.status === "check") return (s.turn === state.color ? "Your king is in check" : "Opponent is in check");
        return s.turn === state.color ? "Your turn to move" : "Opponent's turn";
    }
    function badgeText(s) {
        if (!s.players.b) return "WAITING";
        if (s.status === "checkmate" || s.status === "resigned") return "GAME OVER";
        if (["stalemate", "threefold", "insufficient", "draw", "resigned"].includes(s.status)) return "DRAW";
        if (s.status === "check") return "CHECK";
        return "IN PROGRESS";
    }
    function titleText(s) {
        if (!s.players.b) return "Waiting for a challenger";
        if (s.status === "resigned") return s.winner === state.color ? "Victory by resignation!" : "You resigned";
        if (s.status === "checkmate") return (s.winner === state.color ? "Victory!" : "Game over") ;
        if (s.status === "stalemate") return "Draw by stalemate";
        if (s.status === "threefold") return "Draw by repetition";
        if (s.status === "insufficient") return "Draw — insufficient material";
        if (s.status === "draw") return "Game drawn";
        if (s.status === "check") return "King in check";
        return s.turn === state.color ? "Your move" : "Opponent is thinking";
    }
    function descriptionText(s) {
        if (!s.players.b) return "Send your room code to a friend. The game starts when they join.";
        if (s.status === "checkmate") return (s.winner === state.color ? "You won this game. Well played." : "Your opponent has won this game.") + " Request a rematch to play again.";
        if (["stalemate", "threefold", "insufficient", "draw", "resigned"].includes(s.status)) return "The game ended in a draw. You can request a rematch.";
        if (s.drawOffer && s.drawOffer !== state.color) return "Your opponent offered a draw. Press Offer draw to accept.";
        if (s.drawOffer === state.color) return "Draw offered. Waiting for your opponent.";
        if (!s.players[state.color]?.connected || !s.players[state.color === "w" ? "b" : "w"]?.connected) return "A player has disconnected. The same room can be rejoined using the saved browser session.";
        return s.turn === state.color ? "Take your time and find the strongest move." : "Waiting for your opponent to make a move.";
    }
    function joinSuccess(data) {
        state.code = data.code; state.color = data.color; state.token = data.token;
        persistSession();
        displayGame();
        renderState(data.state);
        showNotice("You are playing " + (state.color === "w" ? "White" : "Black") + ".");
    }

    $("createBtn").addEventListener("click", createRoom);
    $("joinBtn").addEventListener("click", joinRoom);
    $("roomCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); });
    $("roomCode").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom(); });
    $("playerName").addEventListener("keydown", e => { if (e.key === "Enter") createRoom(); });
    $("copyCodeBtn").addEventListener("click", copyCode);
    $("copyInviteBtn").addEventListener("click", copyCode);
    $("flipBtn").addEventListener("click", () => { state.flipped = !state.flipped; renderBoard(); });
    $("leaveBtn").addEventListener("click", async () => {
        const isAr = document.cookie.split('; ').some(c => c === 'lang=ar');
        const ok = await cModal({
            title: isAr ? 'مغادرة المباراة' : 'Leave Game',
            message: isAr ? 'مغادرة هذه المباراة؟ يمكنك العودة بالرمز.' : 'Leave this match? You can rejoin with the room code while the room is available.',
            okText: isAr ? 'مغادرة' : 'Leave',
            danger: true
        });
        if (ok) {
            sessionStorage.removeItem("chessRoomCode");
            showLobby();
        }
    });
    $("drawBtn").addEventListener("click", () => socket.emit("offerDraw"));
    $("resignBtn").addEventListener("click", async () => {
        const isAr = document.cookie.split('; ').some(c => c === 'lang=ar');
        const ok = await cModal({
            title: isAr ? 'الاستسلام' : 'Resign',
            message: isAr ? 'هل تريد الاستسلام؟ ستفقد هذه المباراة.' : 'Are you sure you want to resign this game?',
            okText: isAr ? 'استسلم' : 'Resign',
            danger: true
        });
        if (ok) socket.emit("resign");
    });
    $("rematchBtn").addEventListener("click", () => socket.emit("rematch"));
    promotionDialog.querySelectorAll(".promo-piece").forEach(button => {
        button.addEventListener("click", event => {
            event.preventDefault();
            const promotion = button.value;
            const move = state.pendingPromotion;
            promotionDialog.close();
            state.pendingPromotion = null;
            if (move) socket.emit("move", { from: move.from, to: move.to, promotion });
            state.selected = null; state.legalTargets = []; renderBoard();
        });
    });
    promotionDialog.querySelector(".cancel-promo").addEventListener("click", () => {
        state.pendingPromotion = null; state.selected = null; state.legalTargets = []; renderBoard();
    });
    socket.on("connect", () => {
        $("connectionText").textContent = "Connected";
        document.querySelector(".live-dot").classList.add("connected");
        const savedCode = sessionStorage.getItem("chessRoomCode");
        const token = sessionStorage.getItem("chessPlayerToken");
        if (savedCode && token && !state.code) socket.emit("reconnectRoom", { code: savedCode, token });
    });
    socket.on("disconnect", () => {
        $("connectionText").textContent = "Reconnecting";
        document.querySelector(".live-dot").classList.remove("connected");
        if (!document.querySelector("#game").classList.contains("hidden")) showNotice("Connection lost. Reconnecting…", true);
    });
    socket.on("joined", joinSuccess);
    socket.on("state", s => {
        if (!state.code || s.code !== state.code) return;
        renderState(s);
    });

    socket.on("clock", ({ timeLeft, turn }) => {
        if (!state.code || !state.color) return;
        const other = state.color === "w" ? "b" : "w";
        const fmt = (sec) => {
            if (typeof sec !== "number") return "10:00";
            const m = Math.floor(sec / 60);
            const r = sec % 60;
            return m + ":" + String(r).padStart(2, "0");
        };
        $("selfClock").textContent = fmt(timeLeft[state.color]);
        $("opponentClock").textContent = fmt(timeLeft[other]);
        $("selfClock").classList.toggle("active-clock", turn === state.color);
        $("opponentClock").classList.toggle("active-clock", turn === other);
    });
    socket.on("lastMove", move => { state.lastMove = move; state.selected = null; state.legalTargets = []; if (state.latestState) renderBoard(); });
    socket.on("gameError", message => {
        if ($("game").classList.contains("hidden")) lobbyError(message);
        else showNotice(message, true);
    });
    socket.on("notice", message => showNotice(message));
    const savedName = localStorage.getItem("chessPlayerName");
    if (savedName) $("playerName").value = savedName;
    $("playerName").addEventListener("change", () => localStorage.setItem("chessPlayerName", safeName()));
    const savedCode = sessionStorage.getItem("chessRoomCode");
    if (savedCode) $("roomCode").value = savedCode;

    // Chat feature logic
    const chatForm = $("chatForm");
    const chatInput = $("chatInput");
    const chatMessages = $("chatMessages");

    if (chatForm && chatInput && !window._chatInitialized) {
        window._chatInitialized = true;

        let lastSendTime = 0;

        chatForm.addEventListener("submit", function (e) {
            e.preventDefault();

            const message = chatInput.value.trim();
            if (!message || !state.code) return;

            const now = Date.now();
            if (now - lastSendTime < 500) return;

            lastSendTime = now;
            socket.emit("chatMessage", {
                code: state.code,
                message: message
            });

            chatInput.value = "";
            chatInput.focus();
        });

        socket.on("chatMessage", function (data) {
            if (!chatMessages || !data) return;

            const div = document.createElement("div");
            div.className = "chat-msg";

            const userSpan = document.createElement("span");
            userSpan.className = "chat-user";
            userSpan.textContent = (data.name || "Player") + ":";

            div.append(userSpan, document.createTextNode(" " + data.message));
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    }
    

    // SVG PIECE PRELOADER (Stops mobile blinking)
    Object.values(PIECES).forEach(src => {
        const img = new Image();
        img.src = src;
    });
})();
