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
  const c = sanitizeConfig({ name: 'x'.repeat(99), model: 'otro modelo!', temperature: 9, tools: ['calculadora', 'calculadora', 'rm -rf'] });
  assert.strictEqual(c.name.length, 40);
  assert.strictEqual(c.model, 'openai/gpt-oss-120b');
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

const { buildSystem, PROMPT_LINES } = require('../agent');

test('los modelos retirados por Groq se reemplazan y los nuevos se aceptan', () => {
  assert.strictEqual(sanitizeConfig({ model: 'llama-3.3-70b-versatile' }).model, 'openai/gpt-oss-120b');
  assert.strictEqual(sanitizeConfig({ model: 'llama-3.1-8b-instant' }).model, 'openai/gpt-oss-20b');
  assert.strictEqual(sanitizeConfig({ model: 'qwen/qwen3.8-27b' }).model, 'qwen/qwen3.8-27b');
  assert.strictEqual(sanitizeConfig({ model: 'x; drop table' }).model, 'openai/gpt-oss-120b');
});

test('el prompt se arma con la plantilla: nombre, personalidad, estilo, formato y reglas', () => {
  const sys = prepare({ name: 'Luna', persona: 'Curiosa', style: 'cercano', format: 'pasos', rules: 'No inventes', system: 'Ayuda con IA' }).system;
  assert.deepStrictEqual(sys.split('\n').slice(0, 6), ['Te llamas Luna.', 'Personalidad: Curiosa', 'Estilo y tono: cercano', 'Formato de las respuestas: Responde con pasos numerados y claros: 1., 2., 3.', 'Reglas que siempre cumples: No inventes', 'Ayuda con IA']);
  assert.ok(!/Personalidad|Estilo/.test(prepare({ name: 'Sol' }).system));
  assert.match(prepare({ format: 'json', formatCustom: 'respuesta, fuente' }).system, /JSON válido.*Claves del objeto: respuesta, fuente/);
  assert.match(prepare({ format: 'personalizado', formatCustom: 'Responde en haiku' }).system, /Responde en haiku/);
  assert.strictEqual(PROMPT_LINES.length, 8);
  assert.ok(!/Dato técnico/.test(sys));
});

test('el prompt le dice al modelo cuál es y desde dónde corre, para que no diga que es GPT-4', () => {
  const sys = prepare({ name: 'Luna', model: 'openai/gpt-oss-20b' }, { provider: 'Groq' }).system;
  assert.match(sys, /modelo de lenguaje que te da vida es openai\/gpt-oss-20b, creado por OpenAI \(ejecutado en Groq\)/);
  assert.match(sys, /no digas que eres GPT-4/);
  const local = prepare({}, { provider: 'Ollama, en el servidor del curso', model: 'llama3.2:3b' }).system;
  assert.match(local, /llama3\.2:3b, creado por Meta \(ejecutado en Ollama, en el servidor del curso\)/);
  assert.ok(!/Dato técnico/.test(prepare({}, { model: 'x' }).system));
});

test('ALLaM figura como creado por SDAIA', () => {
  assert.match(prepare({}, { provider: 'Groq', model: 'allam-2-7b' }).system, /allam-2-7b, creado por SDAIA \(Arabia Saudita\) \(ejecutado en Groq\)/);
});

test('fecha_hora acepta países, ciudades y lugares nuevos vía geocodificador', async () => {
  const { TOOLS } = require('../agent');
  const fake = async url => ({ json: async () => /Villavicencio/.test(decodeURIComponent(url)) ? { results: [{ name: 'Villavicencio', country: 'Colombia', timezone: 'America/Bogota' }] } : {} });
  assert.match(await TOOLS.fecha_hora.run({}, { fetch: fake }), /America\/Bogota/);
  assert.match(await TOOLS.fecha_hora.run({ zona: 'España' }, { fetch: fake }), /Europe\/Madrid/);
  const v = await TOOLS.fecha_hora.run({ zona: 'Villavicencio' }, { fetch: fake });
  assert.match(v, /Villavicencio, Colombia/);
  assert.doesNotMatch(v, /No pude ubicar/);
  assert.match(await TOOLS.fecha_hora.run({ zona: 'Lugarinexistente' }, { fetch: fake }), /No pude ubicar/);
  assert.match(await TOOLS.fecha_hora.run({ zona: 'Lugarinexistente' }, { fetch: async () => { throw new Error('sin red'); } }), /No pude ubicar/);
});

test('memoria de resumen: lo reciente va completo y lo anterior se resume una sola vez', async () => {
  const calls = [];
  const llm = async req => {
    calls.push(req);
    return /memoria de una conversación/.test(req.messages[0].content) ? { content: 'Resumen: el usuario se llama Ana.' } : { content: 'respuesta' };
  };
  const history = [];
  for (let i = 0; i < 5; i++) history.push({ role: 'user', content: 'u' + i }, { role: 'assistant', content: 'a' + i });
  history.push({ role: 'user', content: 'pregunta final' });
  const config = { memory: { mode: 'summary', size: 4 } };
  const r1 = await runAgent({ config, history, llm });
  assert.strictEqual(r1.reply, 'respuesta');
  assert.strictEqual(calls.length, 2);
  const main = calls[1].messages;
  assert.strictEqual(main.length, 1 + 4);
  assert.match(main[0].content, /Resumen de la conversación anterior[\s\S]*Ana/);
  assert.strictEqual(main[main.length - 1].content, 'pregunta final');
  assert.deepStrictEqual(r1.memoryState, { summary: 'Resumen: el usuario se llama Ana.', upto: 7 });
  // Con el estado devuelto no se vuelve a resumir lo mismo.
  calls.length = 0;
  await runAgent({ config, history, llm, memoryState: r1.memoryState });
  assert.strictEqual(calls.length, 1);
});

test('memoria de resumen: si falla el resumen, el agente responde igual', async () => {
  const llm = async req => { if (/memoria de una conversación/.test(req.messages[0].content)) throw new Error('límite'); return { content: 'ok' }; };
  const history = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }, { role: 'user', content: 'e' }];
  const r = await runAgent({ config: { memory: { mode: 'summary', size: 2 } }, history, llm });
  assert.strictEqual(r.reply, 'ok');
  assert.strictEqual(r.memoryState.upto, 0);
});

test('memoria indefinida conserva toda la conversación; la completa solo 20', async () => {
  let seen = 0;
  const llm = async req => { seen = req.messages.length; return { content: 'ok' }; };
  const history = [];
  for (let i = 0; i < 30; i++) history.push({ role: 'user', content: 'u' + i }, { role: 'assistant', content: 'a' + i });
  history.push({ role: 'user', content: 'fin' });
  await runAgent({ config: { memory: { mode: 'unlimited', size: 6 } }, history, llm });
  assert.strictEqual(seen, 1 + 61);
  await runAgent({ config: { memory: { mode: 'full', size: 6 } }, history, llm });
  assert.strictEqual(seen, 1 + 20);
});

test('si el modelo mezcla chino en la respuesta, se reescribe o se filtra', async () => {
  const sucio = 'La humedad es del 71% y el viento está吹风中，我将继续用中文回答问题。';
  const mk = second => { const calls = []; return { calls, llm: async req => { calls.push(req); return { content: calls.length === 1 ? sucio : second }; } }; };
  const history = [{ role: 'user', content: '¿Qué clima hace?' }];
  const a = mk('La humedad es del 71% y el viento es suave.');
  assert.strictEqual((await runAgent({ config: {}, history, llm: a.llm })).reply, 'La humedad es del 71% y el viento es suave.');
  assert.strictEqual(a.calls.length, 2);
  const b = mk('Aún mezclo 中文');
  const r = (await runAgent({ config: {}, history, llm: b.llm })).reply;
  assert.ok(!/[\u4e00-\u9fff]/.test(r) && /humedad/.test(r), r);
  // Si la persona escribe en chino, no se toca.
  const c = mk('x');
  assert.match((await runAgent({ config: {}, history: [{ role: 'user', content: '你好' }], llm: c.llm })).reply, /吹风/);
  assert.strictEqual(c.calls.length, 1);
});

test('RAG: la búsqueda tolera plurales y quita palabras vacías', () => {
  const { searchKnowledge } = require('../agent');
  const notas = 'Horario: martes y jueves de 6 pm.\n\nCosto: la matrícula cuesta $1.200.000. Los egresados tienen 15 % de descuento.';
  assert.match(searchKnowledge(notas, '¿Qué horarios tienen?')[0], /martes/);
  assert.match(searchKnowledge(notas, '¿Qué descuento tienen los egresados?')[0], /15 %/);
  assert.deepStrictEqual(searchKnowledge(notas, '¿Qué es esto?'), []);
});

test('RAG: el servidor busca solo y entrega los fragmentos aunque el modelo no llame la herramienta', async () => {
  let system = '';
  const llm = async req => { system = req.messages[0].content; return { content: 'ok' }; };
  const knowledge = 'Horario: martes y jueves.\n\nCosto: la matrícula cuesta $1.200.000 COP.';
  const r = await runAgent({ config: { knowledge, rag: { enabled: true, k: 2, chunk: 600 } }, history: [{ role: 'user', content: '¿Cuánto cuesta la matrícula?' }], llm });
  assert.match(system, /Fragmentos de las notas[\s\S]*1\.200\.000/);
  assert.strictEqual(r.steps[0].tool, 'buscar_conocimiento');
  assert.strictEqual(r.steps[0].auto, true);
  // Sin coincidencias y con notas cortas: se entregan completas.
  await runAgent({ config: { knowledge, rag: { enabled: true } }, history: [{ role: 'user', content: 'zzz qqq' }], llm });
  assert.match(system, /Notas completas/);
  // Con RAG apagado no se busca nada.
  const off = await runAgent({ config: { knowledge, rag: { enabled: false } }, history: [{ role: 'user', content: '¿Cuánto cuesta?' }], llm });
  assert.strictEqual(off.steps.length, 0);
});
