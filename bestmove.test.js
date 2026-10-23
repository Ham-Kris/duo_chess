const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const childProcess = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('争和推荐与实际推荐走法的概率保持一致', async t => {
  const { Chess } = await import('./assets/vendor/chess.mjs');
  const previousEnv = { PORT: process.env.PORT, HOST: process.env.HOST, AUTH_FILE: process.env.AUTH_FILE };
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  process.env.AUTH_FILE = path.join(os.tmpdir(), `duo-chess-draw-${randomUUID()}.json`);
  let server;
  let entries;
  let commands;
  t.after(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (server) {
      const closed = new Promise(resolve => server.close(resolve));
      server.closeIdleConnections();
      await closed;
    }
  });

  const createServer = http.createServer;
  t.mock.method(http, 'createServer', (...args) => {
    server = createServer(...args);
    return server;
  });
  t.mock.method(childProcess, 'spawn', () => {
    const engine = new EventEmitter();
    engine.stdout = new EventEmitter();
    engine.stderr = new EventEmitter();
    let killed = false;
    engine.kill = () => { killed = true; };
    engine.stdin = {
      write(command) {
        command = command.trim();
        commands.push(command);
        queueMicrotask(() => {
          if (killed) return;
          let output;
          if (command === 'uci') output = 'option name UCI_ShowWDL type check default false\nuciok\n';
          else if (command === 'isready') output = 'readyok\n';
          else if (command.startsWith('go ')) {
            output = entries.map(({ move, wdl }, index) =>
              `info depth 12 multipv ${index + 1} score cp 0${wdl ? ` wdl ${wdl.join(' ')}` : ''} pv ${move}\n`
            ).join('') + `bestmove ${entries[0].move}\n`;
          }
          if (output) engine.stdout.emit('data', Buffer.from(output));
        });
      }
    };
    return engine;
  });

  require('./server.js');
  if (!server.listening) await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/bestmove`;
  const startingFen = new Chess().fen();
  async function analyze(candidates, payload = {}) {
    entries = candidates;
    commands = [];
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fen: startingFen, preferDraw: true, ...payload })
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }

  await t.test('和棋率超过 50%、胜率超过 20% 的劣势局面仍启用争和', async () => {
    const data = await analyze([
      { move: 'e2e4', wdl: [220, 510, 270] },
      { move: 'd2d4', wdl: [50, 900, 50] }
    ]);
    assert.equal(data.drawMode, true);
    assert.equal(data.bestmove, 'd2d4');
    assert.deepEqual(data.wdl, { win: 0.05, draw: 0.9, loss: 0.05 });
    assert.ok(commands.includes('setoption name MultiPV value 8'));
  });

  await t.test('允许牺牲超过 2 个百分点胜率以降低负率、提高和棋率', async () => {
    const data = await analyze([
      { move: 'e2e4', wdl: [100, 600, 300] },
      { move: 'd2d4', wdl: [50, 750, 200] }
    ]);
    assert.equal(data.bestmove, 'd2d4');
    assert.deepEqual(data.wdl, { win: 0.05, draw: 0.75, loss: 0.2 });
  });

  await t.test('立即和棋不受原走法胜率限制', async () => {
    const fen = '7k/8/8/8/8/8/q7/1K6 w - - 0 1';
    const data = await analyze([{ move: 'b1c1', wdl: [100, 600, 300] }], { fen });
    assert.equal(data.bestmove, 'b1a2');
    assert.deepEqual(data.wdl, { win: 0, draw: 1, loss: 0 });
    const chess = new Chess(fen);
    chess.move({ from: 'b1', to: 'a2' });
    assert.equal(chess.isInsufficientMaterial(), true);
  });

  await t.test('返回争和首选的概率，页面不会继续显示原走法概率', async () => {
    const data = await analyze([
      { move: 'e2e4', wdl: [100, 600, 300] },
      { move: 'd2d4', wdl: [90, 710, 200] }
    ]);
    assert.equal(data.bestmove, 'd2d4');
    assert.deepEqual(data.wdl, { win: 0.09, draw: 0.71, loss: 0.2 });
    assert.deepEqual(data.wdl, data.suggestions[0].wdl);
  });

  await t.test('和棋率更高但负率也更高时保留原推荐', async () => {
    const data = await analyze([
      { move: 'e2e4', wdl: [220, 510, 270] },
      { move: 'd2d4', wdl: [0, 600, 400] }
    ]);
    assert.equal(data.drawMode, true);
    assert.equal(data.bestmove, 'e2e4');
    assert.deepEqual(data.wdl, { win: 0.22, draw: 0.51, loss: 0.27 });
  });

  await t.test('关闭选项或处于优势时保留常规推荐', async () => {
    const candidates = [
      { move: 'e2e4', wdl: [220, 510, 270] },
      { move: 'd2d4', wdl: [50, 900, 50] }
    ];
    let data = await analyze(candidates, { preferDraw: false });
    assert.equal(data.drawMode, false);
    assert.equal(data.bestmove, 'e2e4');
    assert.ok(commands.includes('setoption name MultiPV value 2'));
    candidates[0].wdl = [550, 400, 50];
    data = await analyze(candidates);
    assert.equal(data.drawMode, false);
    assert.equal(data.bestmove, 'e2e4');
  });

  await t.test('黑方争和按行棋方筛选，返回概率换算到白方视角', async () => {
    const data = await analyze([
      { move: 'e7e5', wdl: [220, 510, 270] },
      { move: 'd7d5', wdl: [40, 900, 60] }
    ], { fen: startingFen.replace(' w ', ' b ') });
    assert.equal(data.drawMode, true);
    assert.equal(data.bestmove, 'd7d5');
    assert.deepEqual(data.wdl, { win: 0.06, draw: 0.9, loss: 0.04 });
  });

  await t.test('真实历史中的三次重复和棋优先', async () => {
    const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'];
    const chess = new Chess();
    for (const move of moves) chess.move({ from: move.slice(0, 2), to: move.slice(2, 4) });
    const data = await analyze([{ move: 'e7e5', wdl: [100, 600, 300] }], {
      fen: chess.fen(), history: { startFen: startingFen, moves }
    });
    assert.equal(data.bestmove, 'f6g8');
    assert.deepEqual(data.wdl, { win: 0, draw: 1, loss: 0 });
    chess.move({ from: 'f6', to: 'g8' });
    assert.equal(chess.isThreefoldRepetition(), true);
    assert.ok(commands.includes(`position fen ${startingFen} moves ${moves.join(' ')}`));
  });

  await t.test('立即将死获胜优先于求和', async () => {
    const fen = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1';
    const data = await analyze([{ move: 'g6g5', wdl: [100, 600, 300] }], { fen });
    const chess = new Chess(fen);
    chess.move({ from: data.bestmove.slice(0, 2), to: data.bestmove.slice(2, 4) });
    assert.equal(chess.isCheckmate(), true);
    assert.equal(data.drawMode, false);
    assert.deepEqual(data.wdl, { win: 1, draw: 0, loss: 0 });
  });

  await t.test('缺少原生概率时保留常规推荐', async () => {
    const data = await analyze([
      { move: 'e2e4' },
      { move: 'd2d4', wdl: [0, 900, 100] }
    ]);
    assert.equal(data.drawMode, false);
    assert.equal(data.bestmove, 'e2e4');
    assert.equal(data.wdl, null);
  });

  await t.test('求和仍遵守 searchmoves 候选限制', async () => {
    const data = await analyze([{ move: 'b1c1', wdl: [100, 600, 300] }], {
      fen: '7k/8/8/8/8/8/q7/1K6 w - - 0 1', searchmoves: ['b1c1']
    });
    assert.equal(data.bestmove, 'b1c1');
    assert.ok(commands.some(command => command.endsWith(' searchmoves b1c1')));
  });
});
