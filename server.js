const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const chessModule = import('./assets/vendor/chess.mjs');

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const authFile = path.resolve(process.env.AUTH_FILE || path.join(root, 'auth.json'));
const lc0Path = process.env.LC0_PATH || 'lc0';
const stockfishPath = process.env.STOCKFISH_PATH || 'stockfish';
const sessionCookie = 'duo_chess_session';
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const passwordIterations = 210_000;
const sessions = new Map();
const engineCandidates = [
  { name: 'Lc0', command: lc0Path, missingHint: '未找到 Lc0，可设置 LC0_PATH 或把 lc0 加入 PATH' },
  { name: 'Stockfish', command: stockfishPath, missingHint: '未找到 Stockfish，可设置 STOCKFISH_PATH 或把 stockfish 加入 PATH' }
];
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg'
};
const publicFiles = new Set(['index.html', 'app.js', 'styles.css']);

function loadAuthConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const password = config && config.password;
    if (!config || config.version !== 1 || typeof config.username !== 'string' ||
        !password || password.algorithm !== 'pbkdf2-sha256' ||
        !Number.isInteger(password.iterations) || typeof password.salt !== 'string' ||
        typeof password.hash !== 'string') {
      throw new Error('认证配置格式无效');
    }
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`无法读取认证配置 ${authFile}: ${error.message}`);
  }
}

let authConfig = loadAuthConfig();

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 32_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').flatMap(part => {
    const index = part.indexOf('=');
    if (index < 0) return [];
    return [[part.slice(0, index).trim(), part.slice(index + 1).trim()]];
  }));
}

function sessionToken(req) {
  return parseCookies(req)[sessionCookie];
}

function isAuthenticated(req) {
  if (!authConfig) return true;
  const token = sessionToken(req);
  const expiresAt = token && sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function setSessionCookie(req, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + sessionLifetimeSeconds * 1000);
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('set-cookie', `${sessionCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetimeSeconds}${secure}`);
}

function clearSession(req, res) {
  const token = sessionToken(req);
  if (token) sessions.delete(token);
  res.setHeader('set-cookie', `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function derivePassword(password, salt, iterations) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, 'sha256', (error, hash) => {
      if (error) reject(error);
      else resolve(hash);
    });
  });
}

async function verifyPassword(password) {
  const stored = Buffer.from(authConfig.password.hash, 'hex');
  const candidate = await derivePassword(password, authConfig.password.salt, authConfig.password.iterations);
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

async function saveAuthConfig(username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await derivePassword(password, salt, passwordIterations);
  const config = {
    version: 1,
    username,
    password: {
      algorithm: 'pbkdf2-sha256',
      iterations: passwordIterations,
      salt,
      hash: hash.toString('hex')
    }
  };
  const tempFile = `${authFile}.tmp-${process.pid}`;
  await fs.promises.mkdir(path.dirname(authFile), { recursive: true });
  await fs.promises.writeFile(tempFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.rename(tempFile, authFile);
  authConfig = config;
}

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

function normalizeMovetime(movetime) {
  return Math.max(100, Math.min(5000, Number(movetime) || 800));
}

function normalizeWdl(values) {
  if (!values || values.length !== 3 || values.some(value => !Number.isFinite(value) || value < 0)) return null;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!total) return null;
  return { win: Math.max(0, values[0]) / total, draw: Math.max(0, values[1]) / total, loss: Math.max(0, values[2]) / total };
}

function parseWdl(line) {
  const match = line.match(/\bwdl\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i);
  return match ? normalizeWdl(match.slice(1).map(Number)) : null;
}

function parseMate(line) {
  const match = line.match(/\bscore\s+mate\s+(-?\d+)/i);
  return match ? Number(match[1]) : null;
}

function wdlForMate(mate) {
  return mate > 0 ? { win: 1, draw: 0, loss: 0 } : { win: 0, draw: 0, loss: 1 };
}

function whitePerspectiveWdl(fen, wdl) {
  if (!wdl || fen.split(/\s+/)[1] !== 'b') return wdl;
  return { win: wdl.loss, draw: wdl.draw, loss: wdl.win };
}

function runUciEngine(candidate, position, movetime, signal, searchMoves = [], candidateCount = 2) {
  return new Promise((resolve, reject) => {
    const engine = spawn(candidate.command, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    let settled = false;
    const linesByDepth = new Map();
    const options = new Set();
    const multiPv = Math.min(candidateCount, searchMoves.length || candidateCount);
    const safeMovetime = normalizeMovetime(movetime);
    const timeout = setTimeout(() => {
      fail(new Error(`${candidate.name} timed out`));
    }, Math.max(5000, safeMovetime + 7000));

    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      engine.kill();
    }

    function onAbort() {
      fail(new Error('分析请求已取消'));
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function succeed(bestmove) {
      if (settled) return;
      settled = true;
      cleanup();
      // Match WDL to the actual bestmove, never to a stale root PV.
      const snapshots = [...linesByDepth.entries()].sort(([a], [b]) => b - a);
      const complete = snapshots.find(([, moves]) => moves.get(1)?.move === bestmove)?.[1];
      const primary = complete?.get(1) || { move: bestmove, wdl: null };
      const suggestions = [{ rank: 1, ...primary }];
      if (complete) {
        for (const [rank, entry] of [...complete.entries()].sort(([a], [b]) => a - b)) {
          if (rank !== 1 && !suggestions.some(item => item.move === entry.move)) {
            suggestions.push({ rank, ...entry });
          }
        }
      }
      resolve({ move: bestmove, suggestions, wdl: primary.wdl });
    }

    function send(command) {
      engine.stdin.write(`${command}\n`);
    }

    function readLine(line) {
      if (line.startsWith('option name ')) {
        const name = line.match(/^option name (.+?) type /)?.[1];
        if (name) options.add(name);
      } else if (line === 'uciok') {
        send(`setoption name MultiPV value ${multiPv}`);
        if (options.has('UCI_ShowWDL')) send('setoption name UCI_ShowWDL value true');
        send('isready');
      } else if (line === 'readyok') {
        send('ucinewgame');
        send(position);
        const restriction = searchMoves.length ? ` searchmoves ${searchMoves.join(' ')}` : '';
        send(`go movetime ${safeMovetime}${restriction}`);
      } else if (line.startsWith('info ')) {
        const depth = line.match(/\bdepth\s+(\d+)/);
        const multipv = line.match(/\bmultipv\s+(\d+)\b/);
        const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)\b/);
        if (depth && pv && !/\b(?:lowerbound|upperbound)\b/.test(line)) {
          const level = Number(depth[1]);
          if (!linesByDepth.has(level)) linesByDepth.set(level, new Map());
          const mate = parseMate(line);
          linesByDepth.get(level).set(multipv ? Number(multipv[1]) : 1, {
            move: pv[1], mate, wdl: mate === null ? parseWdl(line) : wdlForMate(mate)
          });
        }
      } else if (line.startsWith('bestmove ')) {
        const move = line.match(/^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
        if (move) succeed(move);
        else fail(new Error(`${candidate.name} returned an invalid bestmove`));
      }
    }

    engine.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let newline;
      while (!settled && (newline = buffer.indexOf('\n')) !== -1) {
        readLine(buffer.slice(0, newline).trim());
        buffer = buffer.slice(newline + 1);
      }
    });
    engine.stderr.on('data', chunk => { stderr += chunk.toString(); });
    engine.on('error', error => {
      fail(new Error(error.code === 'ENOENT' ? candidate.missingHint : error.message));
    });
    engine.on('close', code => {
      if (!settled) {
        fail(new Error(stderr.trim() || `${candidate.name} exited with code ${code}`));
      }
    });

    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    send('uci');
  });
}

function terminalWdl(chess, color) {
  if (chess.isCheckmate()) return chess.turn() === color
    ? { win: 0, draw: 0, loss: 1 } : { win: 1, draw: 0, loss: 0 };
  if (chess.isDraw()) return { win: 0, draw: 1, loss: 0 };
  return null;
}

async function bestMove(chess, position, movetime = 800, signal, searchMoves = [], preferDraw = false) {
  const errors = [];
  for (const candidate of engineCandidates) {
    try {
      const result = await runUciEngine(candidate, position, movetime, signal, searchMoves, preferDraw ? 8 : 2);
      const legalMoves = chess.moves({ verbose: true });
      const allowed = new Set(searchMoves.length ? searchMoves : legalMoves.map(move => move.from + move.to + (move.promotion || '')));
      if (!allowed.has(result.move)) throw new Error(`${candidate.name} returned an illegal bestmove`);
      const candidates = result.suggestions.filter(item => allowed.has(item.move));
      const color = chess.turn();
      // Check all immediate endings, including repetition with the real history.
      for (const move of legalMoves) {
        const uci = move.from + move.to + (move.promotion || '');
        if (!allowed.has(uci)) continue;
        chess.move(move);
        const outcome = terminalWdl(chess, color);
        const mate = chess.isCheckmate() ? 1 : null;
        chess.undo();
        if (outcome) {
          const existing = candidates.find(item => item.move === uci);
          if (existing) Object.assign(existing, { wdl: outcome, mate });
          else candidates.push({ rank: candidates.length + 1, move: uci, wdl: outcome, mate });
        }
      }
      const baseline = candidates.find(item => item.move === result.move);
      const wdl = baseline?.wdl || null;
      const drawMode = preferDraw && !!wdl && wdl.win < 0.2 && wdl.loss > wdl.win;
      const immediateWin = candidates.find(item => item.mate > 0);
      let ranked = candidates;
      if (immediateWin) {
        ranked = [immediateWin, ...candidates.filter(item => item !== immediateWin)];
      } else if (drawMode) {
        // Prefer draws without increasing loss risk or sacrificing more than 2% wins.
        const safe = candidates.filter(item => item.wdl && item.wdl.loss <= wdl.loss && item.wdl.win >= wdl.win - 0.02)
          .sort((a, b) => b.wdl.draw - a.wdl.draw || a.wdl.loss - b.wdl.loss || a.rank - b.rank);
        ranked = [...safe, ...candidates.filter(item => !safe.includes(item))];
      }
      const suggestions = ranked.slice(0, 2).map((item, index) => ({ ...item, rank: index + 1 }));
      return { move: suggestions[0].move, suggestions, wdl: immediateWin?.wdl || wdl, drawMode: drawMode && !immediateWin, engine: candidate.name };
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`${candidate.name}: ${error.message}`);
    }
  }
  throw new Error(`没有可用的 UCI 引擎。${errors.join('；')}`);
}

function serveFile(req, res, relative) {
  const normalized = path.normalize(relative);
  const allowed = publicFiles.has(normalized) || normalized.startsWith(`assets${path.sep}`);
  if (!allowed || path.isAbsolute(normalized) || normalized.startsWith('..')) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const filePath = path.resolve(root, normalized);
  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': normalized === 'index.html' ? 'no-store' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') res.end();
    else res.end(data);
  });
}

function serveStatic(req, res, urlPath) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  serveFile(req, res, relative);
}

const server = http.createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }

  if (req.method === 'GET' && urlPath === '/api/auth/status') {
    return sendJson(res, 200, {
      configured: Boolean(authConfig),
      authenticated: isAuthenticated(req),
      username: isAuthenticated(req) && authConfig ? authConfig.username : null
    });
  }

  if (req.method === 'POST' && urlPath === '/api/auth/setup') {
    if (authConfig) return sendJson(res, 409, { error: '访问账号已设置' });
    try {
      const { username, password } = await readJson(req);
      const safeUsername = typeof username === 'string' ? username.trim() : '';
      if (!safeUsername || safeUsername.length > 64) return sendJson(res, 400, { error: '账号长度必须为 1 到 64 个字符' });
      if (typeof password !== 'string' || password.length < 8 || password.length > 256) return sendJson(res, 400, { error: '密码长度必须为 8 到 256 个字符' });
      await saveAuthConfig(safeUsername, password);
      setSessionCookie(req, res);
      return sendJson(res, 201, { username: safeUsername });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && urlPath === '/api/auth/login') {
    if (!authConfig) return sendJson(res, 409, { error: '尚未设置访问账号' });
    try {
      const { username, password } = await readJson(req);
      const passwordMatches = typeof password === 'string' && await verifyPassword(password);
      if (username !== authConfig.username || !passwordMatches) return sendJson(res, 401, { error: '账号或密码错误' });
      setSessionCookie(req, res);
      return sendJson(res, 200, { username: authConfig.username });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && urlPath === '/api/auth/logout') {
    clearSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && urlPath === '/login') {
    if (!authConfig || isAuthenticated(req)) return redirect(res, '/');
    return fs.readFile(path.join(root, 'login.html'), (error, data) => {
      if (error) { res.writeHead(500); res.end('Login page unavailable'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(data);
    });
  }

  if (authConfig && !isAuthenticated(req)) {
    if (urlPath.startsWith('/api/')) return sendJson(res, 401, { error: '需要登录' });
    if (req.method === 'GET' || req.method === 'HEAD') return redirect(res, '/login');
    return sendJson(res, 401, { error: '需要登录' });
  }

  if (req.method === 'POST' && urlPath === '/api/bestmove') {
    const abortController = new AbortController();
    req.on('aborted', () => abortController.abort());
    res.on('close', () => { if (!res.writableEnded) abortController.abort(); });
    try {
      const { fen, movetime, searchmoves, preferDraw, history } = await readJson(req);
      if (typeof fen !== 'string') return sendJson(res, 400, { error: 'Invalid FEN' });
      let chess;
      try { chess = new (await chessModule).Chess(fen); }
      catch { return sendJson(res, 400, { error: 'Invalid FEN' }); }
      if (preferDraw !== undefined && typeof preferDraw !== 'boolean') return sendJson(res, 400, { error: 'preferDraw 必须是布尔值' });
      let position = `position fen ${chess.fen()}`;
      if (history !== undefined) {
        if (!history || typeof history.startFen !== 'string' || !Array.isArray(history.moves) || history.moves.length > 2000) {
          return sendJson(res, 400, { error: 'Invalid history' });
        }
        try {
          const replay = new (await chessModule).Chess(history.startFen);
          for (const move of history.moves) {
            if (typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw new Error();
            replay.move({ from: move.slice(0, 2), to: move.slice(2, 4), ...(move[4] ? { promotion: move[4] } : {}) });
          }
          if (replay.fen() !== chess.fen()) throw new Error();
          chess = replay;
          position = `position fen ${new (await chessModule).Chess(history.startFen).fen()}${history.moves.length ? ` moves ${history.moves.join(' ')}` : ''}`;
        } catch { return sendJson(res, 400, { error: 'Invalid history' }); }
      }
      const terminal = terminalWdl(chess, chess.turn());
      if (terminal) return sendJson(res, 200, { bestmove: null, suggestions: [], engine: null, drawMode: false, wdl: whitePerspectiveWdl(chess.fen(), terminal) });
      const legalMoves = new Set(chess.moves({ verbose: true }).map(move => `${move.from}${move.to}${move.promotion || ''}`));
      const restrictedMoves = Array.isArray(searchmoves)
        ? [...new Set(searchmoves.filter(move => typeof move === 'string' && legalMoves.has(move)))]
        : [];
      if (Array.isArray(searchmoves) && restrictedMoves.length === 0) return sendJson(res, 400, { error: '没有合法的候选着法' });
      const { move, suggestions, engine, wdl, drawMode } = await bestMove(chess, position, movetime, abortController.signal, restrictedMoves, preferDraw === true);
      if (abortController.signal.aborted) return;
      return sendJson(res, 200, { bestmove: move, suggestions, engine, drawMode, wdl: whitePerspectiveWdl(chess.fen(), wdl) });
    } catch (error) {
      if (abortController.signal.aborted) return;
      return sendJson(res, 500, { error: error.message });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
  serveStatic(req, res, urlPath);
});

server.listen(port, host, () => {
  const actualPort = server.address().port;
  console.log(`duo_chess running at http://${host}:${actualPort}/`);
  console.log(`Access protection: ${authConfig ? `enabled (${authConfig.username})` : 'disabled'}`);
  console.log(`UCI engine order: ${engineCandidates.map(engine => `${engine.name} (${engine.command})`).join(' -> ')}`);
});
