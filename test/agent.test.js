const test = require('node:test');
const assert = require('node:assert');
const { calc, searchKnowledge, sanitizeConfig, runAgent } = require('../agent');

test('calculadora respeta precedencia, potencias y funciones', () => {
  assert.strictEqual(calc('2+3*4'), 14);
  assert.strictEqual(calc('2^3^2'), 512);
  assert.strictEqual(calc('0,17*2350000'), 399500);
  assert.strictEqual(calc('sqrt(16)+abs(-2)'), 6);
  assert.strictEqual(calc('-(2+3)*2'), -10);
});

test('calculadora rechaza código y entradas inválidas', () => {
  for (const bad of ['process.exit()', '2+', '(1+2', '1/0', 'alert(1)', '']) assert.throws(() => calc(bad), bad);
});

test('búsqueda en notas ordena por coincidencias e ignora tildes', () => {
  const t = 'La matrícula cierra el lunes.\n\nEl horario de tutorías es a las 6:30 pm.\n\nEl café es gratis.';
  assert.match(searchKnowledge(t, 'horario tutorias')[0], /6:30/);
  assert.deepStrictEqual(searchKnowledge(t, 'xyz'), []);
});

test('sanitizeConfig limita valores y descarta herramientas desconocidas', () => {
  const c = sanitizeConfig({ name: 'x'.repeat(99), model: 'otro', temperature: 9, tools: ['calculadora', 'calculadora', 'rm -rf'] });
  assert.strictEqual(c.name.length, 40);
  assert.strictEqual(c.model, 'llama-3.3-70b-versatile');
  assert.strictEqual(c.temperature, 1.5);
  assert.deepStrictEqual(c.tools, ['calculadora']);
});

test('el bucle ejecuta la herramienta y devuelve la respuesta final', async () => {
  let turn = 0;
  const llm = async ({ messages, tools }) => {
    if (turn++ === 0) {
      assert.strictEqual(tools.length, 1);
      return { content: '', tool_calls: [{ id: 'c1', function: { name: 'calculadora', arguments: '{"expresion":"6*7"}' } }] };
    }
    assert.strictEqual(messages[messages.length - 1].role, 'tool');
    return { content: 'Son 42.' };
  };
  const r = await runAgent({ config: { tools: ['calculadora'] }, history: [{ role: 'user', content: '¿6 por 7?' }], llm });
  assert.strictEqual(r.reply, 'Son 42.');
  assert.deepStrictEqual(r.steps, [{ tool: 'calculadora', args: { expresion: '6*7' }, result: '42' }]);
});

test('una herramienta no activada no se ejecuta y el bucle termina', async () => {
  const llm = async () => ({ content: '', tool_calls: [{ id: 'c', function: { name: 'clima', arguments: '{"ciudad":"Cali"}' } }] });
  const r = await runAgent({ config: { tools: [] }, history: [{ role: 'user', content: 'hola' }], llm });
  assert.match(r.steps[0].result, /no está activada/);
  assert.strictEqual(r.steps.length, 5);
});

test('exige que el último mensaje sea del usuario', async () => {
  await assert.rejects(runAgent({ config: {}, history: [], llm: async () => ({}) }), /mensaje/);
});

const { isPrivateIp, safeGet, apiParams, retrieve, historyLimit, prepare } = require('../agent');

test('isPrivateIp reconoce direcciones internas en IPv4 e IPv6', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.1.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
});

test('safeGet solo permite https hacia direcciones públicas y no sigue redirecciones', async () => {
  const pub = async () => [{ address: '93.184.216.34' }];
  const ok = async url => ({ ok: true, status: 200, text: async () => '{"a": 1, "b": [2]}', url });
  assert.strictEqual(await safeGet('https://api.example.com/x', { fetchImpl: ok, lookup: pub }), '{"a":1,"b":[2]}');
  await assert.rejects(safeGet('http://api.example.com/x', { fetchImpl: ok, lookup: pub }), /https/);
  await assert.rejects(safeGet('https://localhost/x', { fetchImpl: ok, lookup: pub }), /no está permitida/);
  await assert.rejects(safeGet('https://db.railway.internal/x', { fetchImpl: ok, lookup: pub }), /no está permitida/);
  await assert.rejects(safeGet('https://[::1]/x', { fetchImpl: ok, lookup: pub }), /no está permitida/);
  await assert.rejects(safeGet('https://10.0.0.5/x', { fetchImpl: ok, lookup: pub }), /no está permitida/);
  await assert.rejects(safeGet('https://evil.example.com/x', { fetchImpl: ok, lookup: async () => [{ address: '10.0.0.9' }] }), /no está permitida/);
  await assert.rejects(safeGet('https://u:p@api.example.com/x', { fetchImpl: ok, lookup: pub }), /usuario/);
  const redirTo = loc => async () => ({ ok: false, status: 302, headers: { get: () => loc } });
  await assert.rejects(safeGet('https://api.example.com/x', { fetchImpl: async () => ({ ok: false, status: 302, headers: { get: () => null } }), lookup: pub }), /sin destino/);
  await assert.rejects(safeGet('https://api.example.com/x', { fetchImpl: redirTo('https://10.0.0.1/y'), lookup: pub }), /no está permitida/);
  await assert.rejects(safeGet('https://api.example.com/x', { fetchImpl: redirTo('/otra'), lookup: pub }), /demasiadas veces/);
  let n = 0;
  const once = async url => (n++ === 0 ? { ok: false, status: 301, headers: { get: () => '/final' } } : { ok: true, status: 200, text: async () => 'listo ' + url });
  assert.strictEqual(await safeGet('https://api.example.com/x', { fetchImpl: once, lookup: pub }), 'listo https://api.example.com/final');
  await assert.rejects(safeGet('https://api.example.com/x', { fetchImpl: async () => ({ ok: false, status: 500 }), lookup: pub }), /500/);
});

test('una API propia se convierte en herramienta con sus parámetros y codifica los valores', async () => {
  assert.deepStrictEqual(apiParams('https://x.com/{pais}/{ciudad}?q={pais}'), ['pais', 'ciudad']);
  const cfg = { apis: [{ name: 'Países!', description: 'datos', url: 'https://restcountries.com/v3.1/name/{pais}' }, { name: 'mala', url: 'http://x.com' }] };
  const p = prepare(cfg);
  assert.strictEqual(p.tools.length, 1);
  assert.strictEqual(p.tools[0].function.name, 'api_pa_ses');
  assert.deepStrictEqual(p.tools[0].function.parameters.required, ['pais']);
  let called;
  const r = await runAgent({
    config: cfg, history: [{ role: 'user', content: 'x' }],
    lookup: async () => [{ address: '93.184.216.34' }],
    fetchImpl: async url => { called = url; return { ok: true, status: 200, text: async () => '[{"capital":["Bogotá"]}]' }; },
    llm: (() => { let n = 0; return async () => n++ ? { content: 'Bogotá' } : { content: '', tool_calls: [{ id: 'a', function: { name: 'api_pa_ses', arguments: '{"pais":"Costa Rica/../x"}' } }] }; })()
  });
  assert.strictEqual(called, 'https://restcountries.com/v3.1/name/Costa%20Rica%2F..%2Fx');
  assert.strictEqual(r.reply, 'Bogotá');
});

test('la memoria define cuántos mensajes recuerda el agente', async () => {
  assert.strictEqual(historyLimit(sanitizeConfig({ memory: { mode: 'none' } })), 1);
  assert.strictEqual(historyLimit(sanitizeConfig({ memory: { mode: 'window', size: 4 } })), 4);
  assert.strictEqual(historyLimit(sanitizeConfig({ memory: { mode: 'full' } })), 20);
  assert.strictEqual(historyLimit(sanitizeConfig({})), 6);
  const hist = [1, 2, 3, 4, 5].map(i => ({ role: i % 2 ? 'user' : 'assistant', content: 'm' + i }));
  let seen;
  await runAgent({ config: { memory: { mode: 'window', size: 3 } }, history: hist, llm: async ({ messages }) => { seen = messages; return { content: 'ok' }; } });
  assert.deepStrictEqual(seen.map(m => m.content).slice(1), ['m3', 'm4', 'm5']);
  await runAgent({ config: { memory: { mode: 'none' } }, history: hist, llm: async ({ messages }) => { seen = messages; return { content: 'ok' }; } });
  assert.strictEqual(seen.length, 2);
});

test('el interruptor de RAG controla la herramienta de búsqueda y respeta k y el tamaño de fragmento', () => {
  assert.ok(sanitizeConfig({ rag: { enabled: true }, tools: [] }).tools.includes('buscar_conocimiento'));
  assert.ok(!sanitizeConfig({ rag: { enabled: false }, tools: ['buscar_conocimiento'] }).tools.includes('buscar_conocimiento'));
  assert.ok(sanitizeConfig({ tools: ['buscar_conocimiento'] }).rag.enabled);
  const text = 'gato negro\n\ngato blanco\n\ngato gris\n\nperro marrón';
  assert.strictEqual(retrieve(text, 'gato', 2).chunks.length, 2);
  assert.strictEqual(retrieve(text, 'gato', 5).total, 4);
  assert.deepStrictEqual(retrieve('x'.repeat(1000) + ' sol', 'sol', 3, 300).chunks.length, 1);
});
