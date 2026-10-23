import { Chess, SQUARES } from './vendor/chess.mjs';

export function checkmateAttacks(game) {
  if (!game.isCheckmate()) return [];
  const color = game.turn();
  const king = SQUARES.find(square => {
    const piece = game.get(square);
    return piece?.type === 'k' && piece.color === color;
  });
  const position = new Chess(game.fen());
  // The king's old square must not hide sliding attacks on its escape squares.
  position.remove(king);
  const targets = SQUARES.filter(square =>
    Math.abs(square.charCodeAt(0) - king.charCodeAt(0)) <= 1 &&
    Math.abs(Number(square[1]) - Number(king[1])) <= 1
  );
  const attacks = targets.flatMap(to => position.attackers(to, color === 'w' ? 'b' : 'w').map(from => ({ from, to })));
  // Keep one arrowhead per source and ray, at the farthest attacked square.
  return attacks.filter(({ from, to }) => {
    const dx = to.charCodeAt(0) - from.charCodeAt(0);
    const dy = Number(to[1]) - Number(from[1]);
    return !attacks.some(other => {
      if (other.from !== from) return false;
      const ox = other.to.charCodeAt(0) - from.charCodeAt(0);
      const oy = Number(other.to[1]) - Number(from[1]);
      return dx * oy === dy * ox && dx * ox + dy * oy > dx * dx + dy * dy;
    });
  });
}
