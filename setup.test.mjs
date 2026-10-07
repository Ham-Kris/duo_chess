import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess, SQUARES } from './assets/vendor/chess.mjs';
import { positionPieces, quantityError, validateSetup } from './assets/setup.mjs';

function material(types) {
  return Object.fromEntries([...types].map((type, index) => [SQUARES[index], { type, color: 'w' }]));
}

test('数量限制包含共用升变额度，双方独立计算', () => {
  for (const types of ['kqqppppppp', 'krrrppppppp', 'kbbbppppppp', 'knnnppppppp', 'kqqqqqqqqq', 'krrrrrrrrrr', 'kbbbbbbbbbb', 'knnnnnnnnn']) {
    assert.equal(quantityError(material(types)), '', types);
  }
  for (const types of ['kk', 'ppppppppp', 'qqqqqqqqqq', 'rrrrrrrrrrr', 'bbbbbbbbbbb', 'nnnnnnnnnnn', 'kqqpppppppp', 'kqqrrrppppppp', 'kqrrbbnnppppppppq']) {
    assert.notEqual(quantityError(material(types)), '', types);
  }
  const standard = positionPieces(new Chess());
  assert.equal(quantityError(standard), '');
  standard.a8 = { type: 'q', color: 'b' };
  assert.match(quantityError(standard), /黑方/);
});

test('黑方先手写入 FEN，历史回放与撤销保留自定义起点', () => {
  const result = validateSetup(positionPieces(new Chess()), 'b');
  assert.equal(result.error, '');
  assert.match(result.fen, / b - - 0 1$/);
  const game = new Chess(result.fen);
  const move = game.move('e5');
  assert.equal(move.color, 'b');
  assert.equal(move.before, result.fen);
  const replay = new Chess(move.before);
  replay.move({ from: move.from, to: move.to });
  assert.equal(replay.fen(), game.fen());
  game.undo();
  assert.equal(game.fen(), result.fen);
  assert.equal(game.undo(), null);
});

test('开始前验证王、兵位置和先手方，允许合法将军与终局', () => {
  const pieces = { a1: { type: 'k', color: 'w' }, h8: { type: 'k', color: 'b' }, h1: { type: 'r', color: 'w' } };
  assert.match(validateSetup({}, 'w').error, /必须有一个王/);
  assert.match(validateSetup({ a1: pieces.a1, b2: { type: 'k', color: 'b' } }, 'w').error, /不能相邻/);
  assert.match(validateSetup({ ...pieces, a8: { type: 'p', color: 'w' } }, 'b').error, /兵不能/);
  assert.match(validateSetup(pieces, 'w').error, /非行棋方/);
  assert.equal(validateSetup(pieces, 'b').error, '');
  for (const fen of ['7k/6Q1/5K2/8/8/8/8/8 b - - 0 1', '7k/5K2/6Q1/8/8/8/8/8 b - - 0 1', '7k/8/8/8/8/8/8/K7 w - - 0 1']) {
    const game = new Chess(fen);
    assert.equal(validateSetup(positionPieces(game), game.turn()).error, '');
    assert.equal(game.isGameOver(), true);
  }
});
