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
