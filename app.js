import { Chess, SQUARES } from './assets/vendor/chess.mjs';

const files = 'abcdefgh';
const pieceNames = { p: '兵', r: '车', n: '马', b: '象', q: '后', k: '王' };
const pieceImage = (color, type) => `assets/pieces/${color === 'w' ? 'white' : 'black'}-${{ p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' }[type]}.svg`;
const game = new Chess();
let perspective = 'w';
let selected = null;
let hovered = null;
let analysisTimer;
let controller;
let generation = 0;
let suggestions = [];
let aiBusy = false;
let aiError = '';
let evaluation = null;
let drawMode = false;
let pendingPromotion = null;
let promotionRecommendation = null;
let promotionController = null;
const redoStack = [];
const moveSound = new Audio('assets/audio/move.mp3');
moveSound.preload = 'auto';
const $ = id => document.getElementById(id);
const boardEl = $('board');
const overlayEl = $('boardOverlay');
const promotionPopover = $('promotionPopover');
const undoMoveEl = $('undoMove');
const redoMoveEl = $('redoMove');
const winRateEl = $('winRate');
const preferDrawEl = $('preferDraw');
const preferDrawLabelEl = $('preferDrawLabel');
const accountSetupEl = $('accountSetup');
const accountActiveEl = $('accountActive');
const accountUsernameEl = $('accountUsername');
const accountPasswordEl = $('accountPassword');
const saveAccountEl = $('saveAccount');
const currentUsernameEl = $('currentUsername');
const logoutEl = $('logout');
const accountMessageEl = $('accountMessage');

async function loadAuthStatus() {
  try {
    const response = await fetch('/api/auth/status', { cache: 'no-store' });
    const data = await response.json();
    accountSetupEl.hidden = data.configured;
    accountActiveEl.hidden = !data.configured;
    currentUsernameEl.textContent = data.username || '';
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
  try { await fetch('/api/auth/logout', { method: 'POST' }); }
  finally { location.replace('/login'); }
});

function statusText() {
  const side = game.turn() === 'w' ? '白方' : '黑方';
  if (game.isCheckmate()) return `${game.turn() === 'w' ? '黑方' : '白方'}将死`;
  if (game.isStalemate()) return '和棋（逼和）';
  if (game.isInsufficientMaterial()) return '和棋（子力不足）';
  if (game.isThreefoldRepetition()) return '和棋（三次重复）';
  if (game.isDrawByFiftyMoves()) return '和棋（五十步规则）';
  return side + (game.inCheck() ? '被将军' : '回合');
}

function render() {
  const focusedSquare = document.activeElement?.dataset.square;
  const legal = selected && !game.isGameOver() ? game.moves({ square: selected, verbose: true }) : [];
  const last = game.history({ verbose: true }).at(-1);
  const lastSquares = last ? [last.from, last.to] : [];
  if (last?.isKingsideCastle()) lastSquares.push(last.color === 'w' ? 'h1' : 'h8', last.color === 'w' ? 'f1' : 'f8');
  if (last?.isQueensideCastle()) lastSquares.push(last.color === 'w' ? 'a1' : 'a8', last.color === 'w' ? 'd1' : 'd8');
  const order = perspective === 'w' ? [...SQUARES] : [...SQUARES].reverse();
  boardEl.replaceChildren();
  order.forEach((squareName, index) => {
    const piece = game.get(squareName);
    const square = document.createElement('button');
    const rank = Number(squareName[1]);
    square.className = `square ${(files.indexOf(squareName[0]) + rank) % 2 ? 'light' : 'dark'}`;
    square.type = 'button';
    square.dataset.square = squareName;
    square.setAttribute('role', 'gridcell');
    square.setAttribute('aria-label', squareName + (piece ? ` ${piece.color === 'w' ? '白' : '黑'}${pieceNames[piece.type]}` : ' 空格'));
    square.classList.toggle('selected', selected === squareName);
    square.setAttribute('aria-selected', String(selected === squareName));
    square.classList.toggle('last-move', lastSquares.includes(squareName));
    const target = legal.find(move => move.to === squareName);
    if (target) {
      square.classList.add('legal');
      square.classList.toggle('capture', target.isCapture() || target.isEnPassant());
    }
    if (piece) {
      const checked = piece.type === 'k' && piece.color === game.turn() && game.inCheck();
      const img = document.createElement('img');
      img.className = 'piece' + (checked && !game.isCheckmate() ? ' king-checked' : '');
      img.alt = '';
      img.src = checked ? `assets/pieces/${piece.color === 'w' ? 'white' : 'black'}-king-${game.isCheckmate() ? 'checkmated' : 'checked'}.svg` : pieceImage(piece.color, piece.type);
      square.append(img);
    }
    if (index % 8 === 0) {
      const label = document.createElement('span');
      label.className = 'rank-label';
      label.textContent = squareName[1];
      square.append(label);
    }
    if (index >= 56) {
      const label = document.createElement('span');
      label.className = 'file-label';
      label.textContent = squareName[0];
      square.append(label);
    }
    square.addEventListener('click', () => onSquare(squareName));
    square.addEventListener('pointerenter', () => { hovered = piece ? squareName : null; renderOverlay(); });
    square.addEventListener('pointerleave', () => { hovered = null; renderOverlay(); });
    square.addEventListener('focus', () => { hovered = piece ? squareName : null; renderOverlay(); });
    square.addEventListener('blur', () => { hovered = null; renderOverlay(); });
    boardEl.append(square);
  });
  if (focusedSquare) boardEl.querySelector(`[data-square="${focusedSquare}"]`)?.focus({ preventScroll: true });
  $('status').textContent = statusText();
  undoMoveEl.disabled = game.history().length === 0;
  redoMoveEl.disabled = redoStack.length === 0;
  renderAnalysis();
  renderOverlay();
}

function svgElement(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
function center(square) {
  const column = files.indexOf(square[0]);
  const row = 8 - Number(square[1]);
  return perspective === 'w' ? [(column + .5) * 100, (row + .5) * 100] : [(7.5 - column) * 100, (7.5 - row) * 100];
}
function renderOverlay() {
  overlayEl.replaceChildren();
  const focus = hovered || selected;
  const stalemateColor = game.isStalemate() ? (game.turn() === 'w' ? 'b' : 'w') : null;
  // Stalemate has no legal moves, so use chess.js's pseudo-legal targets to explain the blocked options.
  const stalemateTargets = stalemateColor
    ? new Set(game._moves({ legal: false }).map(move => `${files[move.to & 7]}${8 - (move.to >> 4)}`))
    : null;
  for (const color of ['w', 'b']) {
    if (stalemateColor) continue;
    if (!$(color === 'w' ? 'whiteAttacks' : 'blackAttacks').checked) continue;
    const group = svgElement('g', { class: `attack-group attack-${color}`, 'aria-hidden': 'true' });
    for (const to of SQUARES) {
      const isProtect = game.get(to)?.color === color;
      for (const from of game.attackers(to, color)) {
        const [x1, y1] = center(from);
        const [x2, y2] = center(to);
        const tone = focus === from || focus === to || (!focus && isProtect) ? ' highlighted' : focus ? ' dimmed' : '';
        group.append(svgElement('line', {
          x1, y1, x2, y2, 'data-from': from, 'data-to': to,
          class: `attack-line${tone}`
        }));
        group.append(svgElement('circle', { cx: x2, cy: y2, r: 5, class: `attack-point${tone}` }));
      }
    }
    overlayEl.append(group);
  }
  const defs = svgElement('defs', {});
  const stalemateMarker = svgElement('marker', { id: 'stalemate-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 3.5, markerHeight: 3.5, orient: 'auto' });
  stalemateMarker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'stalemate-fill' }));
  defs.append(stalemateMarker);
  for (const rank of [1, 2]) {
    const marker = svgElement('marker', { id: `recommend-arrow-${rank}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 3, markerHeight: 3, orient: 'auto-start-reverse' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: `recommend-fill recommend-${rank}` }));
    defs.append(marker);
  }
  overlayEl.append(defs);
  if (stalemateColor) {
    const group = svgElement('g', { class: 'stalemate-attacks', 'aria-hidden': 'true' });
    const arrows = [];
    for (const to of stalemateTargets) for (const from of game.attackers(to, stalemateColor)) {
      const [x1, y1] = center(from);
      const [x2, y2] = center(to);
      arrows.push({ from, to, x1, y1, x2, y2 });
    }
    for (const { from, to, x1, y1, x2, y2 } of arrows) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      // Same source and ray: keep only the farthest endpoint.
      if (arrows.some(other => {
        const ox = other.x2 - x1;
        const oy = other.y2 - y1;
        return other.from === from && dx * oy === dy * ox && dx * ox + dy * oy > dx * dx + dy * dy;
      })) continue;
      group.append(svgElement('line', {
        x1, y1, x2, y2, 'data-from': from, 'data-to': to,
        class: 'stalemate-line', 'marker-end': 'url(#stalemate-arrow)'
      }));
    }
    overlayEl.append(group);
  }
  suggestions.forEach(({ rank, move }) => {
    const [x1, y1] = center(move.slice(0, 2));
    const [x2, y2] = center(move.slice(2, 4));
    const sameDestination = suggestions.length === 2 && suggestions[0].move.slice(2, 4) === suggestions[1].move.slice(2, 4);
    let badgeX = sameDestination ? x2 + (rank === 1 ? -22 : 22) : x2 + 27;
    let badgeY = y2 - 27;
    if (badgeX > 782) badgeX = x2 - 27;
    if (badgeX < 18) badgeX = x2 + 27;
    if (badgeY < 18) badgeY = y2 + 27;
    if (badgeY > 782) badgeY = y2 - 27;
    overlayEl.append(svgElement('line', { x1, y1, x2, y2, class: `recommend-line recommend-${rank}`, 'marker-end': `url(#recommend-arrow-${rank})` }));
    const badge = svgElement('g', {
      class: `recommend-badge recommend-${rank}`,
      role: 'button',
      tabindex: '0',
      'aria-label': `应用${drawMode ? (rank === 1 ? '求和首选' : '求和备选') : (rank === 1 ? '最优' : '次优')} ${move.slice(0, 2)} → ${move.slice(2, 4)}${move[4] ? `，升${pieceNames[move[4]]}` : ''}`
    });
    badge.append(svgElement('circle', { class: 'recommend-badge-hit', cx: badgeX, cy: badgeY, r: 22 }));
    badge.append(svgElement('circle', { cx: badgeX, cy: badgeY, r: 14 }));
    const label = svgElement('text', { x: badgeX, y: badgeY, 'dominant-baseline': 'central', 'text-anchor': 'middle' });
    label.textContent = rank;
    badge.append(label);
    const apply = event => { event.preventDefault(); event.stopPropagation(); applyUci(move); };
    badge.addEventListener('click', apply);
    badge.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') apply(event);
    });
    overlayEl.append(badge);
  });
}

function renderAnalysis() {
  preferDrawLabelEl.textContent = `${perspective === 'w' ? '白方' : '黑方'}劣势时优先争取和棋`;
  $('retryAnalysis').hidden = !aiError;
  let probabilities = evaluation;
  if (game.isCheckmate()) probabilities = { win: game.turn() === 'b' ? 1 : 0, draw: 0, loss: game.turn() === 'w' ? 1 : 0 };
  else if (game.isDraw()) probabilities = { win: 0, draw: 1, loss: 0 };
  if (!probabilities) winRateEl.textContent = aiBusy ? '胜率估计：分析中' : '胜率估计：暂无概率';
  else {
    const pct = value => `${(value * 100).toFixed(1)}%`;
    winRateEl.textContent = `白胜 ${pct(probabilities.win)} · 和棋 ${pct(probabilities.draw)} · 黑胜 ${pct(probabilities.loss)}`;
  }
  const list = $('suggestions');
  list.replaceChildren();
  for (const rank of [1, 2]) {
    const candidate = suggestions.find(item => item.rank === rank);
    const row = document.createElement('div');
    row.className = `suggestion suggestion-${rank}`;
    const title = document.createElement('strong');
    title.textContent = drawMode ? (rank === 1 ? '1 求和首选' : '2 求和备选') : (rank === 1 ? '1 最优' : '2 次优');
    const text = document.createElement('span');
    text.textContent = candidate ? `${candidate.move.slice(0, 2)} → ${candidate.move.slice(2, 4)}${candidate.move[4] ? `，升${pieceNames[candidate.move[4]]}` : ''}` : aiBusy ? '分析中' : '不可用';
    row.append(title, text);
    if (candidate) {
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'text-button apply-suggestion';
      apply.textContent = '应用';
      apply.setAttribute('aria-label', `应用${rank === 1 ? '最优' : '次优'}推荐 ${candidate.move.slice(0, 2)} 到 ${candidate.move.slice(2, 4)}`);
      apply.disabled = game.isGameOver();
      apply.addEventListener('click', () => applyUci(candidate.move));
      row.append(apply);
    }
    list.append(row);
  }
}

function cancelAnalysis() {
  clearTimeout(analysisTimer);
  generation++;
  controller?.abort();
  controller = null;
  aiBusy = false;
  aiError = '';
  suggestions = [];
  evaluation = null;
  drawMode = false;
}
function scheduleAnalysis() {
  cancelAnalysis();
  if (!game.isGameOver()) {
    aiBusy = true;
    analysisTimer = setTimeout(analyze, 150);
  }
  renderAnalysis();
  renderOverlay();
}
function analysisPayload(extra = {}) {
  const moves = game.history({ verbose: true });
  return {
    fen: game.fen(), movetime: 800, preferDraw: preferDrawEl.checked && perspective === game.turn(),
    history: {
      startFen: moves[0]?.before || game.fen(),
      moves: moves.map(move => move.from + move.to + (move.promotion || ''))
    },
    ...extra
  };
}
async function analyze() {
  const requestGeneration = generation;
  const fen = game.fen();
  const requestController = new AbortController();
  controller = requestController;
  try {
    const response = await fetch('/api/bestmove', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(analysisPayload()), signal: requestController.signal
    });
    const data = await response.json();
    if (requestGeneration !== generation || fen !== game.fen()) return;
    if (!response.ok) throw new Error(data.error || '分析失败');
    const legal = new Set(game.moves({ verbose: true }).map(move => move.from + move.to + (move.promotion || '')));
    const seen = new Set();
    const ranks = new Set();
    suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).filter(item => {
      if (!item || ![1, 2].includes(item.rank) || !legal.has(item.move) || seen.has(item.move) || ranks.has(item.rank)) return false;
      seen.add(item.move);
      ranks.add(item.rank);
      return true;
    }).sort((a, b) => a.rank - b.rank);
    if (!suggestions.some(item => item.rank === 1) && legal.has(data.bestmove)) suggestions = [{ rank: 1, move: data.bestmove }];
    if (!suggestions.some(item => item.rank === 1)) throw new Error('引擎没有返回合法推荐');
    evaluation = data.wdl || null;
    drawMode = data.drawMode === true;
  } catch (error) {
    if (requestGeneration !== generation || error.name === 'AbortError') return;
    aiError = error.message;
  } finally {
    if (requestGeneration === generation) {
      aiBusy = false;
      controller = null;
      renderAnalysis();
      renderOverlay();
    }
  }
}

function applyUci(uci) {
  if (!uci || game.isGameOver() || pendingPromotion) return;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci[4];
  const legal = game.moves({ verbose: true }).find(move =>
    move.from === from && move.to === to && (move.promotion || '') === (promotion || '')
  );
  if (!legal) return;
  commitMove(promotion ? { from, to, promotion } : { from, to });
}
function commitMove(move) {
  game.move(move);
  redoStack.length = 0;
  selected = hovered = null;
  moveSound.cloneNode().play().catch(() => {});
  scheduleAnalysis();
  render();
}
function onSquare(square) {
  if (game.isGameOver() || pendingPromotion) return;
  const piece = game.get(square);
  const candidates = selected ? game.moves({ square: selected, verbose: true }).filter(move => move.to === square) : [];
  if (candidates.length) {
    if (candidates.some(move => move.promotion)) openPromotion(selected, square);
    else commitMove({ from: selected, to: square });
  } else {
    selected = piece?.color === game.turn() && selected !== square ? square : null;
    render();
  }
}
function openPromotion(from, to) {
  pendingPromotion = { from, to };
  promotionRecommendation = null;
  const choices = $('promotionChoices');
  choices.replaceChildren();
  for (const type of ['q', 'r', 'b', 'n']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'promotion-choice';
    button.dataset.promotion = type;
    button.setAttribute('aria-label', `升变为${pieceNames[type]}`);
    const image = document.createElement('img');
    image.src = pieceImage(game.turn(), type);
    image.alt = '';
    button.append(image);
    button.addEventListener('click', () => choosePromotion(type));
    choices.append(button);
  }
  const target = boardEl.querySelector(`[data-square="${to}"]`);
  const rect = target?.getBoundingClientRect();
  if (rect) {
    const width = 248;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    const top = rect.bottom + 8 + 96 < window.innerHeight ? rect.bottom + 8 : rect.top - 104;
    promotionPopover.style.left = `${left}px`;
    promotionPopover.style.top = `${Math.max(8, top)}px`;
  }
  promotionPopover.showPopover();
  choices.firstElementChild.focus();
  analyzePromotion(from, to);
}
function cancelPromotion() {
  pendingPromotion = null;
  promotionController?.abort();
  promotionController = null;
  promotionRecommendation = null;
  if (promotionPopover.matches(':popover-open')) promotionPopover.hidePopover();
  render();
  if (selected) boardEl.querySelector(`[data-square="${selected}"]`)?.focus();
}
function choosePromotion(promotion) {
  if (!pendingPromotion) return;
  const move = { ...pendingPromotion, promotion };
  pendingPromotion = null;
  promotionController?.abort();
  promotionController = null;
  if (promotionPopover.matches(':popover-open')) promotionPopover.hidePopover();
  commitMove(move);
}
async function analyzePromotion(from, to) {
  const moves = game.moves({ square: from, verbose: true })
    .filter(move => move.to === to && move.promotion)
    .map(move => `${move.from}${move.to}${move.promotion}`);
  if (!moves.length) return;
  promotionController?.abort();
  const requestController = new AbortController();
  promotionController = requestController;
  try {
    const response = await fetch('/api/bestmove', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(analysisPayload({ searchmoves: moves })),
      signal: requestController.signal
    });
    const data = await response.json();
    if (!pendingPromotion || pendingPromotion.from !== from || pendingPromotion.to !== to) return;
    if (!response.ok) throw new Error(data.error || '升变分析失败');
    const best = data.suggestions?.find(item => item.rank === 1)?.move || data.bestmove;
    promotionRecommendation = moves.includes(best) ? best[4] : null;
    renderPromotionChoices();
  } catch (error) {
    if (error.name !== 'AbortError') promotionRecommendation = null;
  } finally {
    if (promotionController === requestController) promotionController = null;
  }
}
function renderPromotionChoices() {
  for (const button of $('promotionChoices').children) {
    button.classList.toggle('recommended', button.dataset.promotion === promotionRecommendation);
    button.setAttribute('aria-label', button.dataset.promotion === promotionRecommendation
      ? `AI推荐升变为${pieceNames[button.dataset.promotion]}`
      : `升变为${pieceNames[button.dataset.promotion]}`);
  }
}
promotionPopover.addEventListener('toggle', event => {
  if (event.newState === 'closed' && pendingPromotion) {
    pendingPromotion = null;
    promotionController?.abort();
    promotionController = null;
    promotionRecommendation = null;
    render();
  }
});
promotionPopover.addEventListener('keydown', event => {
  const buttons = [...$('promotionChoices').children];
  const index = buttons.indexOf(document.activeElement);
  if (['q', 'r', 'b', 'n'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    choosePromotion(event.key.toLowerCase());
    return;
  }
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4;
    buttons[next].focus();
  }
});
undoMoveEl.addEventListener('click', () => {
  if (pendingPromotion) cancelPromotion();
  const move = game.undo();
  if (!move) return;
  redoStack.push({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
  selected = hovered = null;
  scheduleAnalysis();
  render();
});
redoMoveEl.addEventListener('click', () => {
  const move = redoStack.pop();
  if (!move) return;
  game.move(move);
  selected = hovered = null;
  scheduleAnalysis();
  render();
});
$('reset').addEventListener('click', () => {
  cancelPromotion();
  game.reset();
  selected = hovered = null;
  redoStack.length = 0;
  perspective = 'w';
  scheduleAnalysis();
  render();
});
$('flipView').addEventListener('click', () => {
  perspective = perspective === 'w' ? 'b' : 'w';
  hovered = null;
  if (preferDrawEl.checked) scheduleAnalysis();
  render();
});
preferDrawEl.addEventListener('change', () => {
  scheduleAnalysis();
  if (pendingPromotion) analyzePromotion(pendingPromotion.from, pendingPromotion.to);
});
for (const id of ['whiteAttacks', 'blackAttacks']) $(id).addEventListener('change', renderOverlay);
$('retryAnalysis').addEventListener('click', scheduleAnalysis);
window.addEventListener('pagehide', cancelAnalysis);
render();
scheduleAnalysis();
loadAuthStatus();
