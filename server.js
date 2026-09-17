const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = __dirname;
const port = Number(process.env.PORT || 4173);
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

function runUciEngine(candidate, fen, movetime) {
  return new Promise((resolve, reject) => {
    const engine = spawn(candidate.command, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let stderr = '';
    let settled = false;
    let uciOk = false;
    let searchStarted = false;
    const safeMovetime = normalizeMovetime(movetime);
    const timeout = setTimeout(() => {
      fail(new Error(`${candidate.name} timed out`));
    }, Math.max(5000, safeMovetime + 7000));

    function cleanup() {
      clearTimeout(timeout);
      engine.kill();
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
      resolve(bestmove);
    }

    function send(command) {
      engine.stdin.write(`${command}\n`);
    }

    engine.stdout.on('data', chunk => {
      output += chunk.toString();
      if (!uciOk && /(?:^|\n)uciok(?:\r?\n|$)/.test(output)) {
        uciOk = true;
        send('isready');
      }
      if (!searchStarted && /(?:^|\n)readyok(?:\r?\n|$)/.test(output)) {
        searchStarted = true;
        send('ucinewgame');
        send(`position fen ${fen}`);
        send(`go movetime ${safeMovetime}`);
      }
      const match = output.match(/(?:^|\n)bestmove\s+(\S+)/);
      if (match) {
        succeed(match[1]);
      }
    });
    engine.stderr.on('data', chunk => { stderr += chunk.toString(); });
    engine.on('error', error => {
      fail(new Error(error.code === 'ENOENT' ? candidate.missingHint : error.message));
    });
    engine.on('close', code => {
      if (!settled && !output.includes('bestmove')) {
        fail(new Error(stderr.trim() || `${candidate.name} exited with code ${code}`));
      }
    });

    send('uci');
  });
}

async function bestMove(fen, movetime = 800) {
  const errors = [];
  for (const candidate of engineCandidates) {
    try {
      const move = await runUciEngine(candidate, fen, movetime);
      return { move, engine: candidate.name };
    } catch (error) {
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
    try {
      const { fen, movetime } = await readJson(req);
      if (typeof fen !== 'string' || !fen.includes(' ')) return sendJson(res, 400, { error: 'Invalid FEN' });
      const { move, engine } = await bestMove(fen, movetime);
      return sendJson(res, 200, { bestmove: move, engine });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
  serveStatic(req, res, urlPath);
});

server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address().port;
  console.log(`duo_chess running at http://127.0.0.1:${actualPort}/`);
  console.log(`Access protection: ${authConfig ? `enabled (${authConfig.username})` : 'disabled'}`);
  console.log(`UCI engine order: ${engineCandidates.map(engine => `${engine.name} (${engine.command})`).join(' -> ')}`);
});
