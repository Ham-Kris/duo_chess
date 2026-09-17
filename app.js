const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const pieceNames = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' };
const whiteFiles = {
  p: 'assets/pieces/white-pawn.svg', r: 'assets/pieces/white-rook.svg', n: 'assets/pieces/white-knight.svg',
  b: 'assets/pieces/white-bishop.svg', q: 'assets/pieces/white-queen.svg', k: 'assets/pieces/white-king.svg'
};
const blackFiles = {
  p: 'assets/pieces/black-pawn.svg', r: 'assets/pieces/black-rook.svg', n: 'assets/pieces/black-knight.svg',
  b: 'assets/pieces/black-bishop.svg', q: 'assets/pieces/black-queen.svg', k: 'assets/pieces/black-king.svg'
};
const checkedFiles = { w: 'assets/pieces/white-king-checked.svg', b: 'assets/pieces/black-king-checked.svg' };
const checkmatedFiles = { w: 'assets/pieces/white-king-checkmated.svg', b: 'assets/pieces/black-king-checkmated.svg' };

const initialBoard = () => [
  ['r','n','b','q','k','b','n','r'],
  Array(8).fill('p'), Array(8).fill(null), Array(8).fill(null), Array(8).fill(null), Array(8).fill(null),
  Array(8).fill('P'), ['R','N','B','Q','K','B','N','R']
];

let board = initialBoard();
let turn = 'w';
let perspective = 'w';
let selected = null;
let lastMove = null;
let perspectiveTimer = null;
let aiTimer = null;
let autoFlip = true;
let gameMode = 'human';
let aiBusy = false;
let aiError = '';
let halfmoveClock = 0;
let fullmoveNumber = 1;
let positionHistory = [];
let castling = { K: true, Q: true, k: true, q: true };
let undoStack = [];
let redoStack = [];
let aiGeneration = 0;
const moveSound = new Audio('assets/audio/move.mp3');
moveSound.preload = 'auto';

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const autoFlipEl = document.getElementById('autoFlip');
const flipViewEl = document.getElementById('flipView');
const undoMoveEl = document.getElementById('undoMove');
const redoMoveEl = document.getElementById('redoMove');
const modeInputs = [...document.querySelectorAll('input[name="gameMode"]')];
const aiStatusEl = document.getElementById('aiStatus');
const accountSetupEl = document.getElementById('accountSetup');
const accountActiveEl = document.getElementById('accountActive');
const accountUsernameEl = document.getElementById('accountUsername');
const accountPasswordEl = document.getElementById('accountPassword');
const saveAccountEl = document.getElementById('saveAccount');
const currentUsernameEl = document.getElementById('currentUsername');
const logoutEl = document.getElementById('logout');
const accountMessageEl = document.getElementById('accountMessage');
autoFlip = autoFlipEl.checked;
gameMode = modeInputs.find(input => input.checked)?.value || 'human';
perspective = gameMode === 'ai-white' ? 'b' : 'w';

async function loadAuthStatus() {
  try {
    const response = await fetch('/api/auth/status', { cache: 'no-store' });
    const data = await response.json();
    accountSetupEl.hidden = data.configured;
    accountActiveEl.hidden = !data.configured;
    currentUsernameEl.textContent = data.username || '';
    accountMessageEl.textContent = data.configured ? '密码访问已启用' : '尚未设置，当前可直接访问';
  } catch {
    accountMessageEl.textContent = '无法读取访问保护状态';
  }
}

accountSetupEl.addEventListener('submit', async event => {
  event.preventDefault();
  accountMessageEl.textContent = '';
  saveAccountEl.disabled = true;
  try {
    const response = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: accountUsernameEl.value, password: accountPasswordEl.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '设置失败');
    accountPasswordEl.value = '';
    await loadAuthStatus();
  } catch (error) {
    accountMessageEl.textContent = error.message;
  } finally {
    saveAccountEl.disabled = false;
  }
});

logoutEl.addEventListener('click', async () => {
  logoutEl.disabled = true;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    location.replace('/login');
  }
});

function colorOf(piece) { return piece && piece === piece.toUpperCase() ? 'w' : 'b'; }
function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function isAiTurn() { return gameMode === 'ai-black' && turn === 'b' || gameMode === 'ai-white' && turn === 'w'; }
function playerPerspective() { return gameMode === 'ai-white' ? 'b' : 'w'; }
function fenCastling(rights = castling) {
  const text = `${rights.K ? 'K' : ''}${rights.Q ? 'Q' : ''}${rights.k ? 'k' : ''}${rights.q ? 'q' : ''}`;
  return text || '-';
}
function positionKey(state = board, side = turn, rights = castling) {
  return state.map(row => row.map(piece => piece || '.').join('')).join('/') + ' ' + side + ' ' + fenCastling(rights);
}
function recordPosition() { positionHistory.push(positionKey()); }
function cloneMove(move) {
  if (!move) return null;
  return {
    from: move.from.slice(),
    to: move.to.slice(),
    rook: move.rook ? { from: move.rook.from.slice(), to: move.rook.to.slice() } : null
  };
}
function snapshotState() {
  return {
    board: board.map(row => row.slice()),
    turn,
    perspective,
    lastMove: cloneMove(lastMove),
    aiError,
    halfmoveClock,
    fullmoveNumber,
    positionHistory: positionHistory.slice(),
    castling: { ...castling }
  };
}
function restoreState(state) {
  board = state.board.map(row => row.slice());
  turn = state.turn;
  perspective = state.perspective;
  selected = null;
  lastMove = cloneMove(state.lastMove);
  aiBusy = false;
  aiError = state.aiError;
  halfmoveClock = state.halfmoveClock;
  fullmoveNumber = state.fullmoveNumber;
  positionHistory = state.positionHistory.slice();
  castling = { ...state.castling };
}
function cancelPendingAi() {
  clearTimeout(aiTimer);
  aiGeneration += 1;
  aiBusy = false;
}
function updateHistoryButtons() {
  undoMoveEl.disabled = undoStack.length === 0;
  redoMoveEl.disabled = redoStack.length === 0;
}
function playMoveSound() {
  const sound = moveSound.cloneNode();
  sound.play().catch(() => {});
}
function hasLegalMoves() {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (legalMoves(r, c).length) return true;
  return false;
}
function insufficientMaterial() {
  const pieces = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = board[r][c];
    if (piece && piece.toLowerCase() !== 'k') pieces.push({ type: piece.toLowerCase(), color: (r + c) % 2 });
  }
  if (!pieces.length) return true;
  if (pieces.length === 1 && (pieces[0].type === 'n' || pieces[0].type === 'b')) return true;
  return pieces.length === 2 && pieces.every(piece => piece.type === 'b') && pieces[0].color === pieces[1].color;
}
function getOutcome() {
  const check = inCheck(turn);
  const movable = hasLegalMoves();
  if (!movable) return { type: check ? 'checkmate' : 'stalemate', check, movable, winner: check ? (turn === 'w' ? 'b' : 'w') : null };
  if (insufficientMaterial()) return { type: 'insufficient', check, movable };
  if (positionHistory.filter(key => key === positionKey()).length >= 3) return { type: 'repetition', check, movable };
  if (halfmoveClock >= 100) return { type: 'fifty', check, movable };
  return { type: 'playing', check, movable };
}
function isGameOver(result = getOutcome()) { return result.type !== 'playing'; }
function statusText(result) {
  if (result.type === 'checkmate') return `${result.winner === 'w' ? '白方' : '黑方'}将死`;
  if (result.type === 'stalemate') return '和棋（逼和）';
  if (result.type === 'insufficient') return '和棋（子力不足）';
  if (result.type === 'repetition') return '和棋（三次重复）';
  if (result.type === 'fifty') return '和棋（五十步规则）';
  if (result.check) return `${turn === 'w' ? '白方' : '黑方'}被将军`;
  return `${turn === 'w' ? '白方' : '黑方'}回合`;
}

function pseudoMoves(r, c, state = board) {
  const piece = state[r][c]; if (!piece) return [];
  const type = piece.toLowerCase(); const color = colorOf(piece); const moves = [];
  const add = (rr, cc) => { if (!inBounds(rr, cc)) return false; const target = state[rr][cc]; if (!target) { moves.push([rr,cc]); return true; } if (colorOf(target) !== color) moves.push([rr,cc]); return false; };
  if (type === 'p') {
    const dir = color === 'w' ? -1 : 1; const start = color === 'w' ? 6 : 1;
    if (inBounds(r+dir,c) && !state[r+dir][c]) { moves.push([r+dir,c]); if (r === start && !state[r+2*dir][c]) moves.push([r+2*dir,c]); }
    for (const dc of [-1,1]) if (inBounds(r+dir,c+dc) && state[r+dir][c+dc] && colorOf(state[r+dir][c+dc]) !== color) moves.push([r+dir,c+dc]);
  } else if (type === 'n') {
    [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => { if (inBounds(r+dr,c+dc) && (!state[r+dr][c+dc] || colorOf(state[r+dr][c+dc]) !== color)) moves.push([r+dr,c+dc]); });
  } else if (type === 'k') {
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) if ((dr || dc) && inBounds(r+dr,c+dc) && (!state[r+dr][c+dc] || colorOf(state[r+dr][c+dc]) !== color)) moves.push([r+dr,c+dc]);
  } else {
    const dirs = type === 'b' ? [[-1,-1],[-1,1],[1,-1],[1,1]] : type === 'r' ? [[-1,0],[1,0],[0,-1],[0,1]] : [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
    dirs.forEach(([dr,dc]) => { let rr=r+dr, cc=c+dc; while (add(rr,cc)) { rr += dr; cc += dc; } });
  }
  return moves;
}

function attacked(r, c, byColor, state = board) {
  for (let rr=0; rr<8; rr++) for (let cc=0; cc<8; cc++) if (state[rr][cc] && colorOf(state[rr][cc]) === byColor) {
    const type = state[rr][cc].toLowerCase();
    if (type === 'p') { const dir = byColor === 'w' ? -1 : 1; if (r === rr+dir && Math.abs(c-cc) === 1) return true; }
    else if (type === 'k') { if (Math.max(Math.abs(r-rr), Math.abs(c-cc)) === 1) return true; }
    else if (pseudoMoves(rr,cc,state).some(([mr,mc]) => mr === r && mc === c)) return true;
  }
  return false;
}

function inCheck(color, state = board) {
  let king = null;
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) if (state[r][c] === (color === 'w' ? 'K' : 'k')) king = [r,c];
  return !king || attacked(king[0], king[1], color === 'w' ? 'b' : 'w', state);
}

function legalMoves(r, c) {
  const piece = board[r][c]; if (!piece || colorOf(piece) !== turn) return [];
  const moves = pseudoMoves(r,c).filter(([rr,cc]) => { const next = board.map(row => row.slice()); next[rr][cc] = next[r][c]; next[r][c] = null; return !inCheck(turn, next); });
  if (piece.toLowerCase() === 'k') {
    for (const [rr, cc] of castlingMoves(turn)) {
      if (!moves.some(([mr, mc]) => mr === rr && mc === cc)) moves.push([rr, cc]);
    }
  }
  return moves;
}

function castlingMoves(color) {
  const moves = [];
  if (inCheck(color)) return moves;
  const row = color === 'w' ? 7 : 0;
  const enemy = color === 'w' ? 'b' : 'w';
  const rook = color === 'w' ? 'R' : 'r';
  const kingSide = color === 'w' ? castling.K : castling.k;
  const queenSide = color === 'w' ? castling.Q : castling.q;
  if (kingSide && board[row][4] === (color === 'w' ? 'K' : 'k') && board[row][7] === rook && !board[row][5] && !board[row][6]) {
    if (!attacked(row, 5, enemy) && !attacked(row, 6, enemy)) moves.push([row, 6]);
  }
  if (queenSide && board[row][4] === (color === 'w' ? 'K' : 'k') && board[row][0] === rook && !board[row][1] && !board[row][2] && !board[row][3]) {
    if (!attacked(row, 3, enemy) && !attacked(row, 2, enemy)) moves.push([row, 2]);
  }
  return moves;
}

function updateCastlingRights(from, to, piece) {
  if (piece === 'K') { castling.K = false; castling.Q = false; }
  if (piece === 'k') { castling.k = false; castling.q = false; }
  if (from[0] === 7 && from[1] === 7) castling.K = false;
  if (from[0] === 7 && from[1] === 0) castling.Q = false;
  if (from[0] === 0 && from[1] === 7) castling.k = false;
  if (from[0] === 0 && from[1] === 0) castling.q = false;
  if (to[0] === 7 && to[1] === 7) castling.K = false;
  if (to[0] === 7 && to[1] === 0) castling.Q = false;
  if (to[0] === 0 && to[1] === 7) castling.k = false;
  if (to[0] === 0 && to[1] === 0) castling.q = false;
}

function boardToFen() {
  const rows = board.map(row => {
    let out = ''; let empty = 0;
    for (const piece of row) {
      if (!piece) empty++;
      else { if (empty) out += empty; empty = 0; out += piece; }
    }
    return out + (empty || '');
  });
  return `${rows.join('/')} ${turn} ${fenCastling()} - ${halfmoveClock} ${fullmoveNumber}`;
}

function parseUciMove(uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  const from = [8 - Number(uci[1]), files.indexOf(uci[0])];
  const to = [8 - Number(uci[3]), files.indexOf(uci[2])];
  return { from, to, promotion: uci[4] || null };
}

function applyMove(from, to, promotion = null, options = {}) {
  const piece = board[from[0]][from[1]];
  if (!piece) return false;
  if (options.trackHistory !== false) {
    undoStack.push(snapshotState());
    redoStack = [];
  }
  const captured = board[to[0]][to[1]];
  const isCastle = piece.toLowerCase() === 'k' && Math.abs(to[1] - from[1]) === 2;
  board[to[0]][to[1]] = piece;
  board[from[0]][from[1]] = null;
  let rookMove = null;
  if (isCastle) {
    const row = from[0];
    if (to[1] === 6) { rookMove = { from: [row, 7], to: [row, 5] }; }
    else if (to[1] === 2) { rookMove = { from: [row, 0], to: [row, 3] }; }
    if (rookMove) {
      board[rookMove.to[0]][rookMove.to[1]] = board[rookMove.from[0]][rookMove.from[1]];
      board[rookMove.from[0]][rookMove.from[1]] = null;
    }
  }
  if (piece.toLowerCase() === 'p' && (to[0] === 0 || to[0] === 7)) board[to[0]][to[1]] = colorOf(piece) === 'w' ? (promotion || 'q').toUpperCase() : (promotion || 'q');
  updateCastlingRights(from, to, piece);
  halfmoveClock = piece.toLowerCase() === 'p' || captured ? 0 : halfmoveClock + 1;
  if (turn === 'b') fullmoveNumber += 1;
  lastMove = { from, to, rook: rookMove };
  turn = turn === 'w' ? 'b' : 'w';
  selected = null;
  recordPosition();
  playMoveSound();
  render();
  if (isGameOver()) return true;
  schedulePerspective();
  scheduleAiMove();
  return true;
}

function move(from, to) { return applyMove(from, to); }

function schedulePerspective() {
  clearTimeout(perspectiveTimer);
  if (!autoFlip) return;
  const nextPerspective = turn;
  perspectiveTimer = setTimeout(() => { if (turn !== nextPerspective) return; perspective = nextPerspective; render(); }, 1000);
}

function render() {
  boardEl.innerHTML = '';
  const result = getOutcome();
  const legal = selected && result.type === 'playing' ? legalMoves(...selected) : [];
  const check = result.check;
  const checkmate = result.type === 'checkmate';
  const viewOrder = perspective === 'b' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  for (let viewR = 0; viewR < 8; viewR++) for (let viewC = 0; viewC < 8; viewC++) {
    const r = viewOrder[viewR];
    const c = viewOrder[viewC];
    const square = document.createElement('button'); square.className = `square ${(r+c)%2 ? 'light' : 'dark'}`; square.type = 'button'; square.setAttribute('role','gridcell');
    if (selected && selected[0] === r && selected[1] === c) square.classList.add('selected');
    if (lastMove && ((lastMove.from[0] === r && lastMove.from[1] === c) || (lastMove.to[0] === r && lastMove.to[1] === c))) square.classList.add('last-move');
    if (lastMove?.rook && ((lastMove.rook.from[0] === r && lastMove.rook.from[1] === c) || (lastMove.rook.to[0] === r && lastMove.rook.to[1] === c))) square.classList.add('last-move');
    const target = legal.find(([rr,cc]) => rr === r && cc === c); if (target) { square.classList.add('legal'); if (board[r][c]) square.classList.add('capture'); }
    const piece = board[r][c];
    if (piece) {
      const pieceColor = colorOf(piece);
      const isCheckedKing = piece.toLowerCase() === 'k' && pieceColor === turn && check;
      const img = document.createElement('img');
      img.className = `piece${isCheckedKing && !checkmate ? ' king-checked' : ''}`;
      img.alt = `${pieceColor === 'w' ? '白' : '黑'}${pieceNames[piece.toLowerCase()]}${isCheckedKing ? (checkmate ? ' 将死' : ' 被将军') : ''}`;
      img.src = isCheckedKing
        ? (checkmate ? checkmatedFiles[pieceColor] : checkedFiles[pieceColor])
        : (pieceColor === 'w' ? whiteFiles : blackFiles)[piece.toLowerCase()];
      square.append(img);
    }
    if (viewC === 0) { const label = document.createElement('span'); label.className = 'rank-label'; label.textContent = 8-r; square.append(label); }
    if (viewR === 7) { const label = document.createElement('span'); label.className = 'file-label'; label.textContent = files[c]; square.append(label); }
    square.addEventListener('click', () => onSquare(r,c)); boardEl.append(square);
  }
  statusEl.textContent = statusText(result);
  updateHistoryButtons();
  renderAiStatus();
}

function renderAiStatus() {
  if (gameMode === 'human') aiStatusEl.textContent = '双人对局';
  else if (aiBusy) aiStatusEl.textContent = 'AI 正在思考';
  else aiStatusEl.textContent = aiError || 'AI 待命（优先 Lc0）';
}

function onSquare(r,c) {
  if (isGameOver() || isAiTurn() || aiBusy) return;
  const piece = board[r][c];
  if (!selected) { if (piece && colorOf(piece) === turn) { selected = [r,c]; render(); } return; }
  const legal = legalMoves(...selected);
  if (legal.some(([rr,cc]) => rr === r && cc === c)) move(selected, [r,c]);
  else if (piece && colorOf(piece) === turn) { selected = [r,c]; render(); } else { selected = null; render(); }
}

async function scheduleAiMove() {
  clearTimeout(aiTimer);
  if (isGameOver() || !isAiTurn()) return;
  aiTimer = setTimeout(makeAiMove, 500);
}

async function makeAiMove() {
  if (isGameOver() || !isAiTurn() || aiBusy) return;
  const requestGeneration = aiGeneration;
  aiBusy = true; aiError = ''; selected = null; render();
  try {
    const response = await fetch('/api/bestmove', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fen: boardToFen(), movetime: 800 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI request failed');
    const parsed = parseUciMove(data.bestmove);
    if (requestGeneration !== aiGeneration) return;
    if (!parsed) throw new Error(`Invalid bestmove: ${data.bestmove}`);
    const legal = legalMoves(...parsed.from);
    if (!legal.some(([r,c]) => r === parsed.to[0] && c === parsed.to[1])) throw new Error(`Illegal bestmove: ${data.bestmove}`);
    aiBusy = false;
    applyMove(parsed.from, parsed.to, parsed.promotion);
  } catch (error) {
    if (requestGeneration !== aiGeneration) return;
    aiBusy = false;
    aiError = error.message;
    render();
  }
}

function resetGame() {
  clearTimeout(perspectiveTimer); cancelPendingAi();
  board = initialBoard(); turn = 'w'; perspective = autoFlip ? 'w' : playerPerspective(); selected = null; lastMove = null; aiBusy = false; aiError = '';
  halfmoveClock = 0; fullmoveNumber = 1; positionHistory = []; castling = { K: true, Q: true, k: true, q: true }; undoStack = []; redoStack = []; recordPosition();
  render(); scheduleAiMove();
}

function undoMove() {
  if (!undoStack.length) return;
  clearTimeout(perspectiveTimer); cancelPendingAi();
  redoStack.push(snapshotState());
  restoreState(undoStack.pop());
  render();
}

function redoMove() {
  if (!redoStack.length) return;
  clearTimeout(perspectiveTimer); cancelPendingAi();
  undoStack.push(snapshotState());
  restoreState(redoStack.pop());
  render();
}

function flipPerspective() {
  clearTimeout(perspectiveTimer);
  perspective = perspective === 'b' ? 'w' : 'b';
  render();
}

autoFlipEl.addEventListener('change', () => { autoFlip = autoFlipEl.checked; clearTimeout(perspectiveTimer); perspective = autoFlip ? turn : playerPerspective(); render(); });
flipViewEl.addEventListener('click', flipPerspective);
modeInputs.forEach(input => input.addEventListener('change', () => { cancelPendingAi(); gameMode = input.value; aiError = ''; selected = null; if (!autoFlip) perspective = playerPerspective(); render(); scheduleAiMove(); }));
document.getElementById('reset').addEventListener('click', resetGame);
undoMoveEl.addEventListener('click', undoMove);
redoMoveEl.addEventListener('click', redoMove);
recordPosition();
render();
scheduleAiMove();
loadAuthStatus();
