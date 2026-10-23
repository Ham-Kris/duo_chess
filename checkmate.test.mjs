import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from './assets/vendor/chess.mjs';
import { checkmateAttacks } from './assets/checkmate.mjs';

test('双方将杀都用完整射线覆盖王和周围八格，同向只留最远端箭头', () => {
  for (const fen of [
    '2rrr2k/8/8/8/3K4/3q4/8/8 w - - 0 1',
    '2RRR2K/8/8/8/3k4/3Q4/8/8 b - - 0 1'
  ]) {
    const game = new Chess(fen);
    assert.equal(game.isCheckmate(), true);
    const attacks = checkmateAttacks(game);
    assert.deepEqual(attacks.map(({ from, to }) => from + to).sort(),
      ['c8c3', 'd3c3', 'd3c4', 'd3d5', 'd3e3', 'd3e4', 'd8d3', 'e8e3']);
    const color = game.turn() === 'w' ? 'b' : 'w';
    assert.ok(!game.attackers('d3', color).includes('d8'));
    assert.ok(attacks.some(({ from, to }) => from === 'd8' && to === 'd3'));
  }
});

test('远程攻击保留双方其他棋子的遮挡', () => {
  for (const blocker of ['p', 'R']) {
    const game = new Chess(`2rrr2k/8/1b${blocker}5/8/3K4/3q4/8/8 w - - 0 1`);
    assert.equal(game.isCheckmate(), true);
    const attacks = checkmateAttacks(game);
    assert.ok(!attacks.some(({ from }) => from === 'c8'));
    assert.ok(attacks.some(({ from, to }) => from === 'b6' && to === 'e3'));
  }
});

test('周围格子的马、兵和王攻击同样显示', () => {
  const game = new Chess('2rrr3/8/8/5n2/1p1K4/3q4/1k6/8 w - - 0 1');
  assert.equal(game.isCheckmate(), true);
  const attacks = checkmateAttacks(game);
  for (const attack of [{ from: 'f5', to: 'd4' }, { from: 'f5', to: 'e3' }, { from: 'b4', to: 'c3' }, { from: 'b2', to: 'c3' }]) {
    assert.ok(attacks.some(({ from, to }) => from === attack.from && to === attack.to));
  }
});

test('边缘及角落只显示棋盘内的目标格', () => {
  for (const [fen, targets] of [
    ['7k/6Q1/5K2/8/8/8/8/8 b - - 0 1', ['g7', 'g8', 'h7', 'h8']],
    ['rr5k/8/8/8/K7/1q6/8/8 w - - 0 1', ['a3', 'a4', 'b3', 'b5']]
  ]) {
    const game = new Chess(fen);
    assert.equal(game.isCheckmate(), true);
    assert.deepEqual([...new Set(checkmateAttacks(game).map(attack => attack.to))].sort(), targets);
  }
});

test('被己方棋子堵住而未受攻击的格子不伪造攻击线', () => {
  const game = new Chess('k7/8/8/8/8/8/5nPP/6RK w - - 0 1');
  assert.equal(game.isCheckmate(), true);
  assert.deepEqual(checkmateAttacks(game), [{ from: 'f2', to: 'h1' }]);
});

test('普通局面、将军未将杀及逼和不显示将杀攻击线', () => {
  for (const fen of [
    new Chess().fen(),
    '7k/8/8/8/8/8/8/K6r w - - 0 1',
    '7k/5K2/6Q1/8/8/8/8/8 b - - 0 1'
  ]) {
    assert.deepEqual(checkmateAttacks(new Chess(fen)), []);
  }
});

test('绘制攻击线不改变对局，撤销及重做后按当前局面更新', () => {
  const game = new Chess();
  for (const move of ['f3', 'e5', 'g4', 'Qh4#']) game.move(move);
  const before = { fen: game.fen(), hash: game.hash(), history: game.history() };
  const attacks = checkmateAttacks(game);
  assert.ok(attacks.length > 0);
  assert.deepEqual(checkmateAttacks(game), attacks);
  assert.deepEqual({ fen: game.fen(), hash: game.hash(), history: game.history() }, before);
  const last = game.undo();
  assert.deepEqual(checkmateAttacks(game), []);
  game.move(last.san);
  assert.deepEqual(checkmateAttacks(game), attacks);
});
