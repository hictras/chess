const fs = require('fs');
const path = 'public/app.js';
let src = fs.readFileSync(path, 'utf8');

const startIdx = src.indexOf('function updateBoardUI(');
if (startIdx === -1) { console.error('❌ not found'); process.exit(1); }
const braceStart = src.indexOf('{', startIdx);
let depth = 0, endIdx = -1;
for (let i = braceStart; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
}

const newFn = `function updateBoardUI() {
            if (!state.game) return;
            const boardMap = {};
            const fenRows = state.game.board();
            fenRows.forEach((row, ri) => row.forEach((p, fi) => {
                if (p) boardMap["abcdefgh"[fi] + (8 - ri)] = p;
            }));

            Array.from(boardEl.children).forEach(btn => {
                const sq = btn.dataset.square;
                if (!sq) return;
                const piece = boardMap[sq];

                // 1. Toggle CSS classes safely (this doesn't touch the pieces)
                btn.classList.toggle("selected", state.selected === sq);
                btn.classList.toggle(
                    "last-move",
                    !!(state.lastMove && (state.lastMove.from === sq || state.lastMove.to === sq))
                );
                btn.classList.toggle("checked-king", sq === state.checkedKingSquare);

                // 2. Handle the piece image ONLY if it actually changed
                const existingPiece = btn.querySelector(".piece");
                const currentKey = existingPiece ? existingPiece.dataset.key : null;
                const desiredKey = piece ? (piece.color + piece.type) : null;

                if (currentKey !== desiredKey) {
                    if (existingPiece) existingPiece.remove();
                    if (piece) {
                        const span = document.createElement("span");
                        span.className = "piece " + (piece.color === "w" ? "white" : "black");
                        span.dataset.key = desiredKey; 
                        span.innerHTML = \`<img src="\${PIECES[piece.color + piece.type]}" alt="" style="width:100%;height:100%;object-fit:contain;pointer-events:none" />\`;
                        
                        // Insert before the coordinate spans (if any)
                        const coord = btn.querySelector(".coord");
                        if (coord) btn.insertBefore(span, coord);
                        else btn.appendChild(span);
                    }
                }

                // 3. Handle the legal move dots/rings safely
                let dot = btn.querySelector(".dot");
                let ring = btn.querySelector(".capture-ring");
                const isTarget = state.legalTargets.includes(sq);

                if (isTarget && piece && !ring) {
                    if (dot) dot.remove();
                    const r = document.createElement("span");
                    r.className = "capture-ring";
                    btn.appendChild(r);
                } else if (isTarget && !piece && !dot) {
                    if (ring) ring.remove();
                    const d = document.createElement("span");
                    d.className = "dot";
                    btn.appendChild(d);
                } else if (!isTarget) {
                    if (dot) dot.remove();
                    if (ring) ring.remove();
                }
            });
        }`;

src = src.slice(0, startIdx) + newFn + src.slice(endIdx);
fs.writeFileSync(path, src, 'utf8');
console.log('✅ updateBoardUI fixed to NEVER destroy existing piece images.');
