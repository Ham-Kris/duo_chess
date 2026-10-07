import { Chess, SQUARES } from './vendor/chess.mjs';

const names = { k: '王', q: '后', r: '车', b: '象', n: '马', p: '兵' };
const initial = { q: 1, r: 2, b: 2, n: 2 };

export function positionPieces(chess) {
  return Object.fromEntries(SQUARES.flatMap(square => {
    const piece = chess.get(square);
    return piece ? [[square, { type: piece.type, color: piece.color }]] : [];
  }));
}

export function pieceCounts(pieces, color) {
  const counts = { k: 0, q: 0, r: 0, b: 0, n: 0, p: 0 };
  for (const piece of Object.values(pieces)) if (piece.color === color) counts[piece.type]++;
  return counts;
}

export function quantityError(pieces) {
  for (const color of ['w', 'b']) {
    const side = color === 'w' ? '白方' : '黑方';
    const counts = pieceCounts(pieces, color);
    for (const [type, limit] of Object.entries({ k: 1, p: 8, q: 9, r: 10, b: 10, n: 10 })) {
      if (counts[type] > limit) return `${side}${names[type]}最多 ${limit} 个`;
    }
    if (Object.values(counts).reduce((sum, count) => sum + count, 0) > 16) return `${side}棋子总数最多 16 个`;
    const promoted = Object.entries(initial).reduce((sum, [type, count]) => sum + Math.max(0, counts[type] - count), 0);
    if (promoted > 8 - counts.p) return `${side}升变额度不足：${counts.p} 个兵时，额外的后、车、象、马合计最多 ${8 - counts.p} 个`;
  }
  return '';
}

export function setupFen(pieces, turn) {
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '', empty = 0;
    for (const file of 'abcdefgh') {
      const piece = pieces[file + rank];
      if (!piece) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${turn} - - 0 1`;
}

export function validateSetup(pieces, turn) {
  const error = quantityError(pieces);
  if (error) return { error };
  if (!['w', 'b'].includes(turn)) return { error: '请选择先手方' };
  for (const color of ['w', 'b']) {
    if (pieceCounts(pieces, color).k !== 1) return { error: `${color === 'w' ? '白方' : '黑方'}必须有一个王` };
  }
  if (Object.entries(pieces).some(([square, piece]) => piece.type === 'p' && ['1', '8'].includes(square[1]))) {
    return { error: '兵不能放在第 1 或第 8 横线' };
  }
  const kings = ['w', 'b'].map(color => Object.keys(pieces).find(square => pieces[square].color === color && pieces[square].type === 'k'));
  if (Math.abs(kings[0].charCodeAt(0) - kings[1].charCodeAt(0)) <= 1 && Math.abs(Number(kings[0][1]) - Number(kings[1][1])) <= 1) {
    return { error: '双方的王不能相邻' };
  }
  const fen = setupFen(pieces, turn);
  const chess = new Chess(fen);
  const opponentKing = kings[turn === 'w' ? 1 : 0];
  if (chess.isAttacked(opponentKing, turn)) return { error: '非行棋方不能被将军，请调整摆子或先手方' };
  return { fen, error: '' };
}
