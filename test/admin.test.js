const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.ACCESS_CODE = 'clase2026';
process.env.APP_SECRET = 'secreto-de-prueba';
process.env.ADMIN_USERNAME = 'Profe';
process.env.ADMIN_PASSWORD = 'clave-del-profe-1';
delete process.env.DATABASE_URL;
delete process.env.GROQ_API_KEY;

const seen = [];
const groq = http.createServer((req, res) => {
  const key = (req.headers.authorization || '').replace('Bearer ', '');
  req.on('data', () => {});
  req.on('end', () => {
    seen.push(key);
    res.setHeader('content-type', 'application/json');
    if (!key.startsWith('gsk_good')) { res.statusCode = 401; return res.end('{}'); }
    if (req.url.endsWith('/models')) return res.end('{"data":[]}');
    res.end(JSON.stringify({ choices: [{ message: { content: 'hola' } }] }));
  });
});

let base, server;
test.before(async () => {
  await new Promise(r => groq.listen(0, r));
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${groq.address().port}`;
  const { app, ready } = require('../server');
  await ready;
  server = app.listen(0);
  await new Promise(r => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); groq.close(); });

async function call(method, path, body, cookie) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body)
  });
  const set = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: set ? set.split(';')[0] : null };
}
const GOOD = 'gsk_good' + 'C'.repeat(24);

test('el administrador entra con las variables de entorno y su nombre queda reservado', async () => {
  const l = await call('POST', '/api/login', { username: 'profe', password: 'clave-del-profe-1' });
  assert.strictEqual(l.status, 200);
  assert.strictEqual((await call('GET', '/api/me', undefined, l.cookie)).data.isAdmin, true);
  assert.strictEqual((await call('POST', '/api/register', { username: 'profe', password: 'otra-clave-1', code: 'clase2026' })).status, 409);
});

test('un estudiante no ve nada de administración', async () => {
  const r = await call('POST', '/api/register', { username: 'luis', password: 'password1', code: 'clase2026' });
  assert.strictEqual((await call('GET', '/api/me', undefined, r.cookie)).data.isAdmin, false);
  for (const [m, p] of [['GET', '/api/admin/users'], ['GET', '/api/admin/shared-key'], ['PUT', '/api/admin/shared-key']]) {
    assert.strictEqual((await call(m, p, {}, r.cookie)).status, 403, p);
    assert.strictEqual((await call(m, p, {})).status, 401, p);
  }
});

test('el administrador ve a todos con su estado, pero nunca las API keys', async () => {
  const adm = (await call('POST', '/api/login', { username: 'profe', password: 'clave-del-profe-1' })).cookie;
  const luis = (await call('POST', '/api/login', { username: 'luis', password: 'password1' })).cookie;
  await call('PUT', '/api/me/groq-key', { key: GOOD }, luis);
  await call('PUT', '/api/me/state', { progress: { 'm1.0': true, 'm1.1': true }, settings: { ollamaOk: true, ollamaModel: 'llama3.2' } }, luis);
  await call('PUT', '/api/agents/Mio', { config: { name: 'Mio', system: 'hola' } }, luis);
  const list = (await call('GET', '/api/admin/users', undefined, adm)).data;
  const u = list.find(x => x.username === 'luis');
  assert.strictEqual(u.hasKey, true);
  assert.strictEqual(u.ollamaOk, true);
  assert.strictEqual(u.agents, 1);
  assert.deepStrictEqual(u.progress, { 'm1.0': true, 'm1.1': true });
  assert.ok(!JSON.stringify(list).includes(GOOD));
  assert.ok(list.some(x => x.isAdmin));
  const ag = (await call('GET', `/api/admin/users/${u.id}/agents`, undefined, adm)).data;
  assert.strictEqual(ag[0].config.system, 'hola');
});

test('restablecer contraseña y borrar usuarios; la cuenta de administración está protegida', async () => {
  const adm = (await call('POST', '/api/login', { username: 'profe', password: 'clave-del-profe-1' })).cookie;
  const list = (await call('GET', '/api/admin/users', undefined, adm)).data;
  const luis = list.find(x => x.username === 'luis'), profe = list.find(x => x.username === 'profe');
  assert.strictEqual((await call('POST', `/api/admin/users/${luis.id}/password`, { password: 'corta' }, adm)).status, 400);
  assert.strictEqual((await call('POST', `/api/admin/users/${luis.id}/password`, { password: 'nueva-clave-9' }, adm)).status, 200);
  assert.strictEqual((await call('POST', '/api/login', { username: 'luis', password: 'password1' })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { username: 'luis', password: 'nueva-clave-9' })).status, 200);
  assert.strictEqual((await call('DELETE', `/api/admin/users/${profe.id}`, undefined, adm)).status, 400);
  assert.strictEqual((await call('DELETE', `/api/admin/users/${luis.id}`, undefined, adm)).status, 200);
  assert.ok(!(await call('GET', '/api/admin/users', undefined, adm)).data.some(x => x.username === 'luis'));
});

test('la clave de Groq del curso se valida y la usa quien no tiene la suya', async () => {
  const adm = (await call('POST', '/api/login', { username: 'profe', password: 'clave-del-profe-1' })).cookie;
  const ana = (await call('POST', '/api/register', { username: 'ana', password: 'password1', code: 'clase2026' })).cookie;
  const hist = [{ role: 'user', content: 'hola' }];
  assert.strictEqual((await call('POST', '/api/agent', { config: {}, history: hist }, ana)).status, 400);
  assert.strictEqual((await call('PUT', '/api/admin/shared-key', { key: 'gsk_bad' + 'D'.repeat(24) }, adm)).status, 400);
  const ok = await call('PUT', '/api/admin/shared-key', { key: GOOD }, adm);
  assert.strictEqual(ok.status, 200);
  assert.ok(!JSON.stringify((await call('GET', '/api/admin/shared-key', undefined, adm)).data).includes(GOOD));
  assert.strictEqual((await call('GET', '/api/info')).data.sharedKey, true);
  seen.length = 0;
  assert.strictEqual((await call('POST', '/api/agent', { config: {}, history: hist }, ana)).data.reply, 'hola');
  assert.deepStrictEqual(seen, [GOOD]);
  await call('DELETE', '/api/admin/shared-key', undefined, adm);
  assert.strictEqual((await call('POST', '/api/agent', { config: {}, history: hist }, ana)).status, 400);
});
