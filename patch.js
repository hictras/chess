const fs = require('fs');
const path = 'public/app.js';
let src = fs.readFileSync(path, 'utf8');

// Replace onSquareClick's renderBoard calls with updateBoardUI
src = src.replace(
  /if \(moves\.filter\(m => m\.promotion\)\.length\) \{[\s\S]*?state\.selected = null; state\.legalTargets = \[\];\s*renderBoard\(\);/,
  `if (moves.filter(m => m.promotion).length) {
                    state.pendingPromotion = { from: state.selected, to: square };
                    promotionDialog.showModal();
                } else {
                    socket.emit("move", { from: state.selected, to: square });
                    state.selected = null; state.legalTargets = []; updateBoardUI();`
);

src = src.replace(
  /if \(piece && piece\.color === state\.color\) \{[\s\S]*?renderBoard\(\);\s*\} else \{\s*state\.selected = null; state\.legalTargets = \[\];\s*renderBoard\(\);\s*\}/,
  `if (piece && piece.color === state.color) {
                state.selected = square;
                state.legalTargets = state.game.moves({ square, verbose: true }).map(m => m.to);
                updateBoardUI();
            } else {
                state.selected = null; state.legalTargets = []; updateBoardUI();
            }`
);

src = src.replace(
  /promotionDialog\.querySelector\("\.cancel-promo"\)\.addEventListener\("click", \(\) => \{\s*state\.pendingPromotion = null; state\.selected = null; state\.legalTargets = \[\];\s*renderBoard\(\);\s*\}\);/,
  `promotionDialog.querySelector(".cancel-promo").addEventListener("click", () => {
                state.pendingPromotion = null; state.selected = null; state.legalTargets = []; updateBoardUI();
            });`
);

fs.writeFileSync(path, src, 'utf8');
console.log("✅ patched:", path);
