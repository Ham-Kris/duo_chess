const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const lc0Path = process.env.LC0_PATH || 'lc0';
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg'
};

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

function bestMove(fen, movetime = 800) {
  return new Promise((resolve, reject) => {
    const engine = spawn(lc0Path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      engine.kill('SIGKILL');
      reject(new Error('Lc0 timed out'));
    }, Math.max(5000, movetime + 7000));

    engine.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/(?:^|\n)bestmove\s+(\S+)/);
      if (match) {
        clearTimeout(timeout);
        engine.kill();
        resolve(match[1]);
      }
    });
    engine.stderr.on('data', chunk => { stderr += chunk.toString(); });
    engine.on('error', error => {
      clearTimeout(timeout);
      reject(new Error(error.code === 'ENOENT' ? `未找到 Lc0，可设置 LC0_PATH 或把 lc0 加入 PATH` : error.message));
    });
    engine.on('close', code => {
      if (!output.includes('bestmove')) {
        clearTimeout(timeout);
        reject(new Error(stderr.trim() || `Lc0 exited with code ${code}`));
      }
    });

    engine.stdin.write('uci\n');
    engine.stdin.write('isready\n');
    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write(`go movetime ${Math.max(100, Math.min(5000, Number(movetime) || 800))}\n`);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const relative = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/bestmove') {
    try {
      const { fen, movetime } = await readJson(req);
      if (typeof fen !== 'string' || !fen.includes(' ')) return sendJson(res, 400, { error: 'Invalid FEN' });
      const move = await bestMove(fen, movetime);
      return sendJson(res, 200, { bestmove: move });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
  serveStatic(req, res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`duo_chess running at http://127.0.0.1:${port}/`);
  console.log(`Lc0 command: ${lc0Path}`);
});
