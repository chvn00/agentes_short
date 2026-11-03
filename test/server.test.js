const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.ACCESS_CODE = 'clase2026';
process.env.APP_SECRET = 'secreto-de-prueba';
delete process.env.DATABASE_URL;
delete process.env.GROQ_API_KEY;

// Groq simulado: acepta solo claves que empiezan por gsk_good y guarda con qué clave le hablaron
const seenKeys = [];
const groq = http.createServer((req, res) => {
  const key = (req.headers.authorization || '').replace('Bearer ', '');
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    seenKeys.push(key);
    res.setHeader('content-type', 'application/json');
    if (!key.startsWith('gsk_good')) { res.statusCode = 401; return res.end('{}'); }
    if (req.url.endsWith('/models')) return res.end('{"data":[{"id":"openai/gpt-oss-20b"},{"id":"whisper-large-v3"},{"id":"openai/gpt-oss-120b"},{"id":"meta-llama/llama-guard-4-12b"},{"id":"zeta/modelo-nuevo"}]}');
    if (/retirado/.test(body)) { res.statusCode = 400; return res.end('{"error":{"message":"The model `retirado` has been decommissioned and is no longer supported.","code":"model_decommissioned"}}'); }
    res.end(JSON.stringify({ choices: [{ message: { content: 'hola desde groq' } }] }));
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
const GOOD = 'gsk_good' + 'A'.repeat(24);

test('el registro exige el código de clase, un usuario válido y contraseña de 8+', async () => {
  assert.strictEqual((await call('POST', '/api/register', { username: 'ana', password: 'password1', code: 'mal' })).status, 403);
  assert.strictEqual((await call('POST', '/api/register', { username: 'A b', password: 'password1', code: 'clase2026' })).status, 400);
  assert.strictEqual((await call('POST', '/api/register', { username: 'ana', password: 'corta', code: 'clase2026' })).status, 400);
});

test('registrar, repetir usuario, cerrar y volver a entrar', async () => {
  const r = await call('POST', '/api/register', { username: 'Ana', password: 'password1', code: 'clase2026' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.cookie.startsWith('session='));
  assert.strictEqual((await call('POST', '/api/register', { username: 'ana', password: 'password1', code: 'clase2026' })).status, 409);
  assert.strictEqual((await call('POST', '/api/login', { username: 'ana', password: 'otra-clave' })).status, 401);
  const l = await call('POST', '/api/login', { username: 'ana', password: 'password1' });
  assert.strictEqual(l.status, 200);
  assert.strictEqual((await call('GET', '/api/me', undefined, l.cookie)).data.username, 'ana');
});

test('sin sesión no se puede usar nada', async () => {
  for (const [m, p] of [['GET', '/api/me'], ['POST', '/api/agent'], ['GET', '/api/agents'], ['POST', '/api/tool'], ['PUT', '/api/me/groq-key']]) {
    assert.strictEqual((await call(m, p, {})).status, 401, p);
  }
});

test('la API key se valida, se guarda cifrada y nunca se devuelve completa', async () => {
  const { cookie } = await call('POST', '/api/login', { username: 'ana', password: 'password1' });
  assert.strictEqual((await call('PUT', '/api/me/groq-key', { key: 'hola' }, cookie)).status, 400);
  assert.strictEqual((await call('PUT', '/api/me/groq-key', { key: 'gsk_bad' + 'B'.repeat(24) }, cookie)).status, 400);
  const ok = await call('PUT', '/api/me/groq-key', { key: GOOD }, cookie);
  assert.strictEqual(ok.status, 200);
  const me = await call('GET', '/api/me', undefined, cookie);
  assert.strictEqual(me.data.hasKey, true);
  assert.ok(!JSON.stringify(me.data).includes(GOOD));
});

test('el agente habla con Groq usando la clave de cada persona', async () => {
  await call('POST', '/api/register', { username: 'beto', password: 'password2', code: 'clase2026' });
  const ana = (await call('POST', '/api/login', { username: 'ana', password: 'password1' })).cookie;
  const beto = (await call('POST', '/api/login', { username: 'beto', password: 'password2' })).cookie;
  const hist = [{ role: 'user', content: 'hola' }];
  seenKeys.length = 0;
  const r = await call('POST', '/api/agent', { config: {}, history: hist }, ana);
  assert.strictEqual(r.data.reply, 'hola desde groq');
  assert.deepStrictEqual(seenKeys, [GOOD]);
  const sin = await call('POST', '/api/agent', { config: {}, history: hist }, beto);
  assert.strictEqual(sin.status, 400);
  assert.match(sin.data.error, /API key/);
});

test('cada persona ve solo sus agentes guardados y su progreso', async () => {
  const ana = (await call('POST', '/api/login', { username: 'ana', password: 'password1' })).cookie;
  const beto = (await call('POST', '/api/login', { username: 'beto', password: 'password2' })).cookie;
  await call('PUT', '/api/agents/Tutor', { config: { name: 'Tutor', system: 'v1' } }, ana);
  await call('PUT', '/api/agents/Tutor', { config: { name: 'Tutor', system: 'v2' } }, ana);
  const lista = (await call('GET', '/api/agents', undefined, ana)).data;
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].config.system, 'v2');
  assert.deepStrictEqual((await call('GET', '/api/agents', undefined, beto)).data, []);
  await call('PUT', '/api/me/state', { progress: { 'm1.0': true }, settings: { provider: 'ollama' } }, ana);
  const me = (await call('GET', '/api/me', undefined, ana)).data;
  assert.deepStrictEqual(me.progress, { 'm1.0': true });
  assert.strictEqual(me.settings.provider, 'ollama');
  assert.deepStrictEqual((await call('GET', '/api/me', undefined, beto)).data.progress, {});
  await call('DELETE', '/api/agents/Tutor', undefined, ana);
  assert.deepStrictEqual((await call('GET', '/api/agents', undefined, ana)).data, []);
});

test('el modo Ollama obtiene el prompt y ejecuta herramientas por el servidor', async () => {
  const ana = (await call('POST', '/api/login', { username: 'ana', password: 'password1' })).cookie;
  const cfg = { system: 'Eres X', tools: ['calculadora'] };
  const p = (await call('POST', '/api/prepare', { config: cfg }, ana)).data;
  assert.match(p.system, /Eres X/);
  assert.strictEqual(p.tools[0].function.name, 'calculadora');
  assert.strictEqual((await call('POST', '/api/tool', { config: cfg, name: 'calculadora', args: { expresion: '2*21' } }, ana)).data.result, '42');
  assert.match((await call('POST', '/api/tool', { config: cfg, name: 'clima', args: { ciudad: 'Cali' } }, ana)).data.result, /no está activada/);
});

test('el RAG extrae el texto de un PDF y rechaza lo que no es PDF', async () => {
  const fs = require('node:fs');
  const ana = (await call('POST', '/api/login', { username: 'ana', password: 'password1' })).cookie;
  const send = (body, cookie) => fetch(base + '/api/extract-text', { method: 'POST', headers: { 'Content-Type': 'application/pdf', ...(cookie ? { Cookie: cookie } : {}) }, body });
  assert.strictEqual((await send(fs.readFileSync(__dirname + '/fixtures/reglamento.pdf'))).status, 401);
  const ok = await send(fs.readFileSync(__dirname + '/fixtures/reglamento.pdf'), ana);
  const data = await ok.json();
  assert.strictEqual(ok.status, 200);
  assert.match(data.text, /matrícula cuesta 1\.200\.000/);
  assert.match(data.text, /Segunda página/);
  assert.strictEqual(data.pages, 2);
  assert.strictEqual((await send(Buffer.from('esto no es un pdf'), ana)).status, 400);
  const rag = await call('POST', '/api/rag-test', { knowledge: data.text, query: 'matrícula cuesta', k: 2, chunk: 300 }, ana);
  assert.match(rag.data.chunks[0].text, /matrícula/);
});

test('la lista de modelos viene de Groq, sin audio ni moderación, y los retirados dan un mensaje claro', async () => {
  const ana = (await call('POST', '/api/login', { username: 'ana', password: 'password1' })).cookie;
  const m = (await call('GET', '/api/models', undefined, ana)).data;
  assert.strictEqual(m.source, 'groq');
  assert.deepStrictEqual(m.models, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'].filter(x => m.models.includes(x)).concat(['zeta/modelo-nuevo']));
  const r = await call('POST', '/api/agent', { config: { model: 'retirado' }, history: [{ role: 'user', content: 'hola' }] }, ana);
  assert.strictEqual(r.status, 400);
  assert.match(r.data.error, /«retirado» ya no está disponible/);
});

test('cada persona cambia su propia contraseña y su API key', async () => {
  await call('POST', '/api/register', { username: 'mia', password: 'password3', code: 'clase2026' });
  const c = (await call('POST', '/api/login', { username: 'mia', password: 'password3' })).cookie;
  assert.strictEqual((await call('PUT', '/api/me/password', { current: 'mal', password: 'nueva-clave-1' }, c)).status, 400);
  assert.strictEqual((await call('PUT', '/api/me/password', { current: 'password3', password: 'corta' }, c)).status, 400);
  assert.strictEqual((await call('PUT', '/api/me/password', { current: 'password3', password: 'nueva-clave-1' }, c)).status, 200);
  assert.strictEqual((await call('POST', '/api/login', { username: 'mia', password: 'password3' })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { username: 'mia', password: 'nueva-clave-1' })).status, 200);
  const first = 'gsk_good' + 'A'.repeat(24), second = 'gsk_good' + 'Z'.repeat(24);
  await call('PUT', '/api/me/groq-key', { key: first }, c);
  const r = await call('PUT', '/api/me/groq-key', { key: second }, c);
  assert.strictEqual(r.data.keyHint, 'gsk_…ZZZZ');
  assert.strictEqual((await call('GET', '/api/me', undefined, c)).data.keyHint, 'gsk_…ZZZZ');
});
