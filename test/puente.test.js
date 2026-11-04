const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createBridge } = require('../puente-ollama');

const TOKEN = 'una-contrasena-larga-1234';
const seen = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => { seen.push(`${req.method} ${req.url} ${body}`); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, eco: body })); });
});
let bridge, base;
test.before(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  bridge = createBridge({ token: TOKEN, target: `http://127.0.0.1:${fake.address().port}` });
  await new Promise(r => bridge.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${bridge.address().port}`;
});
test.after(() => { bridge.close(); fake.close(); });

const call = (method, path, { token = TOKEN, body } = {}) => fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body });

test('sin la contraseña correcta no pasa nada', async () => {
  assert.strictEqual((await call('GET', '/api/tags', { token: null })).status, 401);
  assert.strictEqual((await call('GET', '/api/tags', { token: 'otra-contrasena-larga-0000' })).status, 401);
  assert.strictEqual(seen.length, 0);
});

test('solo se permite listar modelos y conversar', async () => {
  for (const [m, p] of [['POST', '/api/pull'], ['DELETE', '/api/delete'], ['POST', '/api/generate'], ['POST', '/api/create'], ['GET', '/api/ps'], ['POST', '/api/tags'], ['GET', '/api/chat']]) {
    assert.strictEqual((await call(m, p, { body: m === 'GET' ? undefined : '{}' })).status, 403, `${m} ${p}`);
  }
  assert.strictEqual(seen.length, 0);
});

test('con la contraseña, tags y chat llegan a Ollama con su cuerpo', async () => {
  assert.strictEqual((await call('GET', '/api/tags')).status, 200);
  const r = await call('POST', '/api/chat?x=1', { body: '{"model":"m"}' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).eco, '{"model":"m"}');
  assert.deepStrictEqual(seen, ['GET /api/tags ', 'POST /api/chat {"model":"m"}']);
});

test('exige una contraseña larga', () => {
  assert.throws(() => createBridge({ token: 'corta' }), /16 caracteres/);
});
