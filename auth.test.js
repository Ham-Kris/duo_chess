const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

function startServer(authFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: '0', AUTH_FILE: authFile },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`server start timed out: ${output}`)), 5000);
    const onData = chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (!match) return;
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      resolve({ child, baseUrl: `http://127.0.0.1:${match[1]}` });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => {
      if (code && !output.includes('http://127.0.0.1:')) {
        clearTimeout(timeout);
        reject(new Error(`server exited with ${code}: ${output}`));
      }
    });
  });
}

test('optional access protection gates pages and APIs after setup', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-chess-auth-'));
  const authFile = path.join(tempDir, 'auth.json');
  const { child, baseUrl } = await startServer(authFile);
  t.after(() => {
    child.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  let response = await fetch(`${baseUrl}/`, { redirect: 'manual' });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'secret123' })
  });
  assert.equal(response.status, 201);
  const setupCookie = response.headers.get('set-cookie');
  assert.match(setupCookie, /^duo_chess_session=/);

  const saved = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  assert.equal(saved.username, 'admin');
  assert.equal(saved.password.algorithm, 'pbkdf2-sha256');
  assert.notEqual(saved.password.hash, 'secret123');
  assert.equal(saved.password.hash.length, 64);

  response = await fetch(`${baseUrl}/`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');

  response = await fetch(`${baseUrl}/server.js`, { headers: { cookie: setupCookie } });
  assert.equal(response.status, 404);

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
  });
  assert.equal(response.status, 401);

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'secret123' })
  });
  assert.equal(response.status, 200);
  const loginCookie = response.headers.get('set-cookie');

  response = await fetch(`${baseUrl}/`, { headers: { cookie: loginCookie }, redirect: 'manual' });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie: loginCookie } });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/bestmove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: loginCookie },
    body: JSON.stringify({ fen: 'invalid' })
  });
  assert.equal(response.status, 401);
});
