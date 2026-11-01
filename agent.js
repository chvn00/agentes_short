// Lógica del agente: validación de la configuración, herramientas y bucle de razonamiento.
// El modelo se inyecta (llm) para poder probar el bucle sin llamar a Groq.

const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const MAX_STEPS = 5;

// ---------- Calculadora segura (sin eval) ----------
const FUNCS = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs,
  log: Math.log10, ln: Math.log, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp
};
const CONSTS = { pi: Math.PI, e: Math.E };

function calc(src) {
  const s = String(src).toLowerCase().replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!s || s.length > 200) throw new Error('Expresión vacía o demasiado larga');
  let i = 0;
  const peek = () => s[i];
  function num() {
    const m = /^\d*\.?\d+(e[+-]?\d+)?/.exec(s.slice(i));
    if (!m) throw new Error(`Carácter inesperado en la posición ${i + 1}`);
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function primary() {
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('Falta cerrar paréntesis'); i++; return v; }
    const w = /^[a-z]+/.exec(s.slice(i));
    if (w) {
      i += w[0].length;
      if (w[0] in CONSTS) return CONSTS[w[0]];
      if (w[0] in FUNCS) {
        if (peek() !== '(') throw new Error(`Falta "(" después de ${w[0]}`);
        i++; const v = expr(); if (peek() !== ')') throw new Error('Falta cerrar paréntesis'); i++;
        return FUNCS[w[0]](v);
      }
      throw new Error(`Nombre desconocido: ${w[0]}`);
    }
    return num();
  }
  function unary() { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return primary(); }
  function pow() { const b = unary(); if (peek() === '^') { i++; return Math.pow(b, pow()); } return b; }
  function term() {
    let v = pow();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[i++]; const r = pow();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  const out = expr();
  if (i < s.length) throw new Error(`Carácter inesperado en la posición ${i + 1}`);
  if (!Number.isFinite(out)) throw new Error('El resultado no es un número finito');
  return Math.round(out * 1e10) / 1e10;
}

// ---------- Búsqueda simple en las notas del estudiante (mini-RAG) ----------
const norm = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = t => norm(t).split(/[^a-z0-9ñ]+/).filter(w => w.length > 2);

function chunk(text) {
  const out = [];
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    for (let k = 0; k < p.length; k += 600) out.push(p.slice(k, k + 600));
  }
  return out;
}

function searchKnowledge(text, query, k = 3) {
  const q = new Set(words(query));
  if (!q.size) return [];
  return chunk(text)
    .map(c => { const w = new Set(words(c)); let hit = 0; q.forEach(x => { if (w.has(x)) hit++; }); return { c, hit }; })
    .filter(x => x.hit > 0)
    .sort((a, b) => b.hit - a.hit)
    .slice(0, k)
    .map(x => x.c);
}

// ---------- Clima (Open-Meteo, sin API key) ----------
const WMO = {
  0: 'despejado', 1: 'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado', 45: 'niebla', 48: 'niebla con escarcha',
  51: 'llovizna ligera', 53: 'llovizna', 55: 'llovizna intensa', 61: 'lluvia ligera', 63: 'lluvia', 65: 'lluvia fuerte',
  71: 'nieve ligera', 73: 'nieve', 75: 'nieve fuerte', 80: 'chubascos', 81: 'chubascos fuertes', 82: 'chubascos violentos',
  95: 'tormenta', 96: 'tormenta con granizo', 99: 'tormenta fuerte con granizo'
};

async function clima(ciudad, fetchImpl) {
  const g = await (await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ciudad)}&count=1&language=es`)).json();
  const p = g.results && g.results[0];
  if (!p) return `No encontré la ciudad "${ciudad}".`;
  const w = await (await fetchImpl(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`)).json();
  const c = w.current;
  if (!c) return 'El servicio del clima no respondió.';
  return `${p.name}, ${p.country}: ${c.temperature_2m} °C, ${WMO[c.weather_code] || 'sin descripción'}, humedad ${c.relative_humidity_2m} %, viento ${c.wind_speed_10m} km/h.`;
}

// ---------- Catálogo de herramientas ----------
const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

const TOOLS = {
  calculadora: {
    label: 'Calculadora',
    def: fn('calculadora', 'Evalúa una expresión matemática con + - * / % ^, paréntesis, sqrt, sin, cos, tan, log, ln, abs, round, pi y e. Úsala siempre que haya que calcular.', { expresion: { type: 'string', description: 'Ejemplo: 0.17 * 2350000' } }, ['expresion']),
    run: async ({ expresion }) => String(calc(expresion))
  },
  fecha_hora: {
    label: 'Fecha y hora',
    def: fn('fecha_hora', 'Devuelve la fecha y la hora actuales en la zona horaria indicada (por defecto Bogotá).', { zona: { type: 'string', description: 'Zona IANA, por ejemplo America/Bogota o Europe/Madrid' } }, []),
    run: async ({ zona }) => {
      const tz = zona || 'America/Bogota';
      try { return new Date().toLocaleString('es-CO', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }) + ` (${tz})`; }
      catch { return `Zona horaria desconocida: ${tz}`; }
    }
  },
  clima: {
    label: 'Clima actual',
    def: fn('clima', 'Consulta el clima actual de una ciudad (temperatura, humedad, viento).', { ciudad: { type: 'string', description: 'Nombre de la ciudad, por ejemplo Bucaramanga' } }, ['ciudad']),
    run: async ({ ciudad }, ctx) => clima(String(ciudad || ''), ctx.fetch)
  },
  buscar_conocimiento: {
    label: 'Buscar en mis notas',
    def: fn('buscar_conocimiento', 'Busca fragmentos relevantes en las notas o documentos que cargó el usuario. Úsala antes de responder preguntas sobre ese material.', { consulta: { type: 'string', description: 'Palabras clave de lo que se busca' } }, ['consulta']),
    run: async ({ consulta }, ctx) => {
      if (!ctx.knowledge) return 'El usuario no ha cargado notas.';
      const r = searchKnowledge(ctx.knowledge, String(consulta || ''));
      return r.length ? r.map((x, n) => `[${n + 1}] ${x}`).join('\n\n') : 'No hay fragmentos relacionados en las notas.';
    }
  }
};

const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);

function sanitizeConfig(raw = {}) {
  const t = Number(raw.temperature);
  return {
    name: str(raw.name, 40) || 'Mi agente',
    system: str(raw.system, 3000),
    model: MODELS.includes(raw.model) ? raw.model : MODELS[0],
    temperature: Number.isFinite(t) ? Math.min(1.5, Math.max(0, t)) : 0.4,
    tools: Array.isArray(raw.tools) ? [...new Set(raw.tools.filter(n => n in TOOLS))] : [],
    knowledge: str(raw.knowledge, 20000)
  };
}

function sanitizeHistory(h) {
  return (Array.isArray(h) ? h : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

// Ejecuta el bucle del agente: modelo → herramienta → observación → modelo…
async function runAgent({ config, history, llm, fetchImpl = fetch }) {
  const cfg = sanitizeConfig(config);
  const messages = [{ role: 'system', content: buildSystem(cfg) }, ...sanitizeHistory(history)];
  if (messages.length < 2 || messages[messages.length - 1].role !== 'user') throw Object.assign(new Error('Falta el mensaje del usuario'), { status: 400 });
  const tools = cfg.tools.map(n => TOOLS[n].def);
  const steps = [];

  for (let n = 0; n < MAX_STEPS; n++) {
    const msg = await llm({ model: cfg.model, temperature: cfg.temperature, messages, tools: tools.length ? tools : undefined });
    const calls = msg.tool_calls || [];
    if (!calls.length) return { reply: msg.content || 'No pude generar una respuesta, intenta de nuevo.', steps };
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const call of calls) {
      const name = call.function && call.function.name;
      let args = {}, result;
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* argumentos mal formados */ }
      try {
        if (!TOOLS[name] || !cfg.tools.includes(name)) throw new Error(`La herramienta "${name}" no está activada`);
        result = String(await TOOLS[name].run(args, { fetch: fetchImpl, knowledge: cfg.knowledge })).slice(0, 2000);
      } catch (err) { result = `Error: ${err.message}`; }
      steps.push({ tool: name, args, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  return { reply: 'Usé demasiadas herramientas sin llegar a una respuesta. Reformula la pregunta o simplifica las instrucciones del agente.', steps };
}

function buildSystem(cfg) {
  const base = cfg.system.trim() || 'Eres un asistente útil. Responde en español, de forma clara y breve.';
  const extra = [];
  if (cfg.tools.length) extra.push('Cuando una herramienta pueda dar el dato exacto, úsala en vez de adivinar.');
  if (cfg.knowledge && !cfg.tools.includes('buscar_conocimiento')) extra.push('Notas del usuario:\n' + cfg.knowledge.slice(0, 6000));
  return extra.length ? `${base}\n\n${extra.join('\n\n')}` : base;
}

module.exports = { calc, searchKnowledge, sanitizeConfig, sanitizeHistory, runAgent, TOOLS, MODELS, MAX_STEPS };
