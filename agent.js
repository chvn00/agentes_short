// Lógica del agente: validación de la configuración, herramientas y bucle de razonamiento.
// El modelo se inyecta (llm) para poder probar el bucle sin llamar a Groq.

// Groq retiró los Llama 3.x el 16/08/2026 para cuentas gratuitas. La lista real se pide a Groq (/api/models);
// esta es solo la lista de respaldo.
const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
const DEFAULT_MODEL = MODELS[0];
const RENAMED = {
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b', 'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
  'qwen/qwen3-32b': 'openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct': 'openai/gpt-oss-120b', 'qwen/qwen3.6-27b': 'qwen/qwen3.8-27b'
};
const MODEL_ID = /^[a-z0-9][a-z0-9._\/-]{2,79}$/i;

// Formas de estructurar la respuesta, elegibles por el estudiante.
const FORMATS = {
  libre: { label: 'Libre (sin formato fijo)', text: '' },
  vinetas: { label: 'Viñetas cortas', text: 'Responde con una lista de viñetas cortas (máximo 5), una idea por viñeta.' },
  pasos: { label: 'Pasos numerados', text: 'Responde con pasos numerados y claros: 1., 2., 3.' },
  resumen: { label: 'Resumen y detalle', text: 'Empieza con un resumen de una sola línea y después da el detalle en pocas líneas.' },
  json: { label: 'JSON', text: 'Responde únicamente con un objeto JSON válido, sin texto antes ni después ni bloques de código.' },
  personalizado: { label: 'Personalizado', text: '' }
};
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

function chunk(text, size = 600) {
  const out = [];
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    for (let k = 0; k < p.length; k += size) out.push(p.slice(k, k + size));
  }
  return out;
}

// Devuelve los fragmentos más parecidos a la consulta, con su puntaje (palabras en común).
function retrieve(text, query, k = 3, size = 600) {
  const q = new Set(words(query));
  const all = chunk(text, size);
  if (!q.size) return { total: all.length, chunks: [] };
  const chunks = all
    .map(c => { const w = new Set(words(c)); let hit = 0; q.forEach(x => { if (w.has(x)) hit++; }); return { text: c, score: hit, of: q.size }; })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return { total: all.length, chunks };
}
const searchKnowledge = (text, query, k = 3, size = 600) => retrieve(text, query, k, size).chunks.map(x => x.text);

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
const DEFAULT_TZ = 'America/Bogota';
const ZONES = {
  colombia: 'America/Bogota', bogota: 'America/Bogota', bucaramanga: 'America/Bogota', medellin: 'America/Bogota', cali: 'America/Bogota',
  mexico: 'America/Mexico_City', 'ciudad de mexico': 'America/Mexico_City', peru: 'America/Lima', lima: 'America/Lima', ecuador: 'America/Guayaquil', quito: 'America/Guayaquil',
  venezuela: 'America/Caracas', caracas: 'America/Caracas', chile: 'America/Santiago', santiago: 'America/Santiago', argentina: 'America/Argentina/Buenos_Aires', 'buenos aires': 'America/Argentina/Buenos_Aires',
  brasil: 'America/Sao_Paulo', 'sao paulo': 'America/Sao_Paulo', 'nueva york': 'America/New_York', 'new york': 'America/New_York', miami: 'America/New_York', 'los angeles': 'America/Los_Angeles', california: 'America/Los_Angeles',
  espana: 'Europe/Madrid', madrid: 'Europe/Madrid', barcelona: 'Europe/Madrid', londres: 'Europe/London', london: 'Europe/London', paris: 'Europe/Paris', francia: 'Europe/Paris', alemania: 'Europe/Berlin', berlin: 'Europe/Berlin',
  italia: 'Europe/Rome', roma: 'Europe/Rome', japon: 'Asia/Tokyo', tokio: 'Asia/Tokyo', tokyo: 'Asia/Tokyo', china: 'Asia/Shanghai', india: 'Asia/Kolkata', utc: 'UTC', gmt: 'UTC'
};
function resolveZone(asked) {
  if (!asked) return { tz: DEFAULT_TZ, ok: true };
  const key = asked.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const cand = ZONES[key] || asked.replace(/\s+/g, '_');
  try { new Intl.DateTimeFormat('es-CO', { timeZone: cand }); return { tz: cand, ok: true }; } catch { return { tz: DEFAULT_TZ, ok: false }; }
}
const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

const TOOLS = {
  calculadora: {
    label: 'Calculadora',
    def: fn('calculadora', 'Evalúa una expresión matemática con + - * / % ^, paréntesis, sqrt, sin, cos, tan, log, ln, abs, round, pi y e. Úsala siempre que haya que calcular.', { expresion: { type: 'string', description: 'Ejemplo: 0.17 * 2350000' } }, ['expresion']),
    run: async ({ expresion }) => {
      try { return String(calc(expresion)); }
      catch (e) { throw new Error(`${e.message}. Envía solo la expresión matemática como texto, por ejemplo 0.17*2350000`); }
    }
  },
  fecha_hora: {
    label: 'Fecha y hora',
    def: fn('fecha_hora', 'Devuelve la fecha y la hora actuales en la zona horaria indicada (por defecto Bogotá).', { zona: { type: 'string', description: 'Zona IANA, por ejemplo America/Bogota o Europe/Madrid' } }, []),
    run: async ({ zona }, ctx) => {
      const asked = String(zona || '').trim();
      let { tz, ok } = resolveZone(asked);
      let place = '';
      if (!ok) { // ciudad o lugar que no está en la lista: el geocodificador devuelve su zona horaria
        try {
          const f = (ctx && ctx.fetch) || fetch;
          const g = await (await f(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(asked)}&count=1&language=es`)).json();
          const p = g.results && g.results[0];
          if (p && p.timezone) { tz = p.timezone; ok = true; place = [p.name, p.country].filter(Boolean).join(', '); }
        } catch { /* sin red: queda el aviso de abajo */ }
      }
      const now = new Date();
      const text = now.toLocaleString('es-CO', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
      const iso = now.toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
      const note = !ok ? ` No pude ubicar «${asked}»; use la hora de Bogotá. Si necesitas otra, pide la ciudad o la zona IANA, por ejemplo Europe/Madrid.` : '';
      return `${place ? place + ': ' : ''}${text} (${tz}). ISO: ${iso}.${note}`;
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
      const r = searchKnowledge(ctx.knowledge, String(consulta || ''), (ctx.rag && ctx.rag.k) || 3, (ctx.rag && ctx.rag.chunk) || 600);
      return r.length ? r.map((x, n) => `[${n + 1}] ${x}`).join('\n\n') : 'No hay fragmentos relacionados en las notas.';
    }
  }
};

// ---------- APIs propias (GET público con parámetros) ----------
const net = require('net');
const dns = require('dns').promises;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (m) return isPrivateIp(m[1]);
  return /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

// Solo https, nunca hacia direcciones internas (por ejemplo la base de datos de Railway).
// Las redirecciones se siguen a mano (hasta 3) y cada destino se valida de nuevo.
async function safeGet(rawUrl, { fetchImpl = fetch, lookup = dns.lookup } = {}) {
  let url = rawUrl;
  for (let hop = 0; hop <= 3; hop++) {
    let u;
    try { u = new URL(url); } catch { throw new Error('La URL no es válida'); }
    if (u.protocol !== 'https:') throw new Error('Solo se permiten URLs https://');
    if (u.username || u.password) throw new Error('La URL no puede llevar usuario ni contraseña');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('Esa dirección no está permitida');
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('Esa dirección no está permitida');
    const res = await fetchImpl(u.href, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'taller-agentes' } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers && res.headers.get && res.headers.get('location');
      if (!loc) throw new Error('La API respondió con una redirección sin destino');
      url = new URL(loc, u).href; continue;
    }
    if (!res.ok) throw new Error(`La API respondió con error ${res.status}`);
    const text = (await res.text()).slice(0, 60000);
    try { return JSON.stringify(JSON.parse(text)); } catch { return text; }
  }
  throw new Error('La API redirige demasiadas veces');
}

const PARAM = /\{([a-z_][a-z0-9_]{0,19})\}/gi;
const apiParams = url => [...new Set([...url.matchAll(PARAM)].map(m => m[1]))].slice(0, 4);

function apiTool(a) {
  const params = apiParams(a.url);
  return {
    label: a.name,
    def: fn('api_' + a.name, a.description || `Consulta la API ${a.name}.`, Object.fromEntries(params.map(p => [p, { type: 'string', description: `Valor para {${p}}` }])), params),
    run: async (args, ctx) => {
      const url = a.url.replace(PARAM, (_, p) => encodeURIComponent(String(args[p] ?? '')));
      return safeGet(url, { fetchImpl: ctx.fetch, lookup: ctx.lookup });
    }
  };
}

const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);

const modelOf = m => { const id = RENAMED[m] || m; return typeof id === 'string' && MODEL_ID.test(id) ? id : DEFAULT_MODEL; };
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const MEMORY_MODES = ['none', 'window', 'summary', 'full', 'unlimited'];
const UNLIMITED_MSGS = 200; // tope de seguridad de la memoria indefinida

function sanitizeConfig(raw = {}) {
  const t = Number(raw.temperature);
  const rg = raw.rag && typeof raw.rag === 'object' ? raw.rag : {};
  const tools = Array.isArray(raw.tools) ? [...new Set(raw.tools.filter(n => n in TOOLS))] : [];
  // El RAG se enciende con su interruptor; la herramienta de búsqueda lo sigue.
  const ragOn = rg.enabled !== undefined ? !!rg.enabled : tools.includes('buscar_conocimiento');
  const apis = (Array.isArray(raw.apis) ? raw.apis : []).slice(0, 3).map(a => ({
    name: str(a && a.name, 30).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''),
    description: str(a && a.description, 300),
    url: str(a && a.url, 500).trim()
  })).filter((a, i, all) => a.name && /^https:\/\//i.test(a.url) && all.findIndex(b => b.name === a.name) === i);
  const mem = raw.memory && typeof raw.memory === 'object' ? raw.memory : {};
  return {
    name: str(raw.name, 40) || 'Mi agente',
    system: str(raw.system, 3000),
    model: modelOf(raw.model),
    persona: str(raw.persona, 600), style: str(raw.style, 200), rules: str(raw.rules, 800),
    format: raw.format in FORMATS ? raw.format : 'libre', formatCustom: str(raw.formatCustom, 600),
    temperature: Number.isFinite(t) ? Math.min(1.5, Math.max(0, t)) : 0.4,
    maxTokens: clampInt(raw.maxTokens, 100, 1500, 700),
    tools: tools.filter(n => n !== 'buscar_conocimiento').concat(ragOn ? ['buscar_conocimiento'] : []),
    knowledge: str(raw.knowledge, 60000),
    rag: { enabled: ragOn, k: clampInt(rg.k, 1, 5, 3), chunk: clampInt(rg.chunk, 200, 1000, 600) },
    memory: { mode: MEMORY_MODES.includes(mem.mode) ? mem.mode : 'window', size: clampInt(mem.size, 1, 20, 6) },
    apis
  };
}

// Cuántos mensajes recuerda el agente según su memoria.
const historyLimit = cfg => cfg.memory.mode === 'none' ? 1 : cfg.memory.mode === 'full' ? 20 : cfg.memory.mode === 'unlimited' ? UNLIMITED_MSGS : cfg.memory.size;

// Memoria de resumen: lo reciente va completo y lo anterior se condensa en un resumen que se va actualizando.
const SUMMARY_MAX = 1500;
function sanitizeMemoryState(ms) {
  const o = ms && typeof ms === 'object' ? ms : {};
  return { summary: str(o.summary, SUMMARY_MAX), upto: clampInt(o.upto, 0, UNLIMITED_MSGS, 0) };
}
async function summarize({ llm, cfg, previous, messages }) {
  const transcript = messages.map(m => `${m.role === 'user' ? 'Usuario' : 'Agente'}: ${m.content.slice(0, 800)}`).join('\n');
  const msg = await llm({
    model: cfg.model, temperature: 0.2, maxTokens: 400,
    messages: [
      { role: 'system', content: 'Eres un asistente que mantiene la memoria de una conversación. Escribe un resumen breve en español (máximo 8 líneas) con los datos importantes: nombres, preferencias, cifras, decisiones y temas pendientes. Responde solo con el resumen.' },
      { role: 'user', content: `${previous ? `Resumen anterior:\n${previous}\n\n` : ''}Mensajes nuevos para incorporar:\n${transcript}\n\nEscribe el resumen actualizado.` }
    ]
  });
  return str(msg && msg.content, SUMMARY_MAX).trim();
}

function sanitizeHistory(h, limit = 12) {
  return (Array.isArray(h) ? h : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-limit)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

// Herramientas disponibles para una configuración: las integradas activas y las APIs propias.
function toolsFor(cfg) {
  const out = {};
  cfg.tools.forEach(n => { out[n] = TOOLS[n]; });
  cfg.apis.forEach(a => { out['api_' + a.name] = apiTool(a); });
  return out;
}

// Ejecuta el bucle del agente: modelo → herramienta → observación → modelo…
async function runAgent({ config, history, llm, fetchImpl = fetch, lookup, runtime, memoryState }) {
  const cfg = sanitizeConfig(config);
  let system = buildSystem(cfg, runtime), memOut;
  let past;
  if (cfg.memory.mode === 'summary') {
    const all = sanitizeHistory(history, UNLIMITED_MSGS), keep = Math.max(1, cfg.memory.size);
    past = all.slice(-keep);
    const older = all.slice(0, Math.max(0, all.length - keep));
    let ms = sanitizeMemoryState(memoryState);
    if (ms.upto > older.length) ms = { summary: '', upto: 0 };
    const fresh = older.slice(ms.upto);
    if (fresh.length) {
      try { ms = { summary: await summarize({ llm, cfg, previous: ms.summary, messages: fresh }) || ms.summary, upto: older.length }; }
      catch { /* sin resumen nuevo: se sigue con el anterior */ }
    }
    memOut = ms;
    if (ms.summary) system += `\n\nResumen de la conversación anterior (ya no está completa):\n${ms.summary}`;
  } else past = sanitizeHistory(history, historyLimit(cfg));
  const messages = [{ role: 'system', content: system }, ...past];
  if (messages.length < 2 || messages[messages.length - 1].role !== 'user') throw Object.assign(new Error('Falta el mensaje del usuario'), { status: 400 });
  const avail = toolsFor(cfg);
  const tools = Object.values(avail).map(t => t.def);
  const steps = [];

  for (let n = 0; n < MAX_STEPS; n++) {
    const msg = await llm({ model: cfg.model, temperature: cfg.temperature, maxTokens: cfg.maxTokens, messages, tools: tools.length ? tools : undefined });
    const calls = msg.tool_calls || [];
    if (!calls.length) return { reply: msg.content || 'No pude generar una respuesta, intenta de nuevo.', steps, memoryState: memOut };
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const call of calls) {
      const name = call.function && call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* argumentos mal formados */ }
      const result = await execTool(avail, cfg, name, args, { fetch: fetchImpl, lookup });
      steps.push({ tool: name, args, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  return { reply: 'Usé demasiadas herramientas sin llegar a una respuesta. Reformula la pregunta o simplifica las instrucciones del agente.', steps, memoryState: memOut };
}

async function execTool(avail, cfg, name, args, ctx) {
  try {
    if (!avail[name]) throw new Error(`La herramienta "${name}" no está activada`);
    return String(await avail[name].run(args || {}, { ...ctx, knowledge: cfg.knowledge, rag: cfg.rag })).slice(0, 2000);
  } catch (err) { return `Error: ${err.message}`; }
}

// Texto del formato elegido (o el que escribió el estudiante).
const formatText = cfg => {
  if (cfg.format === 'personalizado') return cfg.formatCustom.trim();
  if (cfg.format === 'json' && cfg.formatCustom.trim()) return `${FORMATS.json.text} Claves del objeto: ${cfg.formatCustom.trim()}.`;
  return FORMATS[cfg.format].text;
};

// Plantilla del prompt de sistema (la misma idea que un ChatPromptTemplate de LangChain):
// cada línea usa una variable y solo se incluye si la persona la llenó.
const PROMPT_LINES = [
  ['nombre', 'Te llamas {nombre}.'],
  ['modelo', 'Dato técnico: el modelo de lenguaje que te da vida es {modelo}. Si te preguntan qué modelo, IA o empresa está detrás de ti, responde con ese dato (nombre del modelo, quién lo creó y dónde se ejecuta) y no digas que eres GPT-4, ChatGPT ni otro modelo distinto.'],
  ['personalidad', 'Personalidad: {personalidad}'],
  ['estilo', 'Estilo y tono: {estilo}'],
  ['formato', 'Formato de las respuestas: {formato}'],
  ['reglas', 'Reglas que siempre cumples: {reglas}'],
  ['instrucciones', '{instrucciones}'],
  ['extras', '{extras}']
];

const modelLabel = (id, provider) => `${id}${makerOf(id) ? ', creado por ' + makerOf(id) : ''} (ejecutado en ${provider})`;
// Quién creó cada familia de modelos: los modelos no lo saben con certeza y suelen decir «OpenAI».
const MAKERS = [[/gpt-oss/i, 'OpenAI'], [/llama/i, 'Meta'], [/qwen/i, 'Alibaba'], [/mistral|mixtral/i, 'Mistral AI'], [/gemma/i, 'Google'], [/phi/i, 'Microsoft'], [/deepseek/i, 'DeepSeek'], [/granite/i, 'IBM'], [/kimi/i, 'Moonshot AI'], [/allam/i, 'SDAIA (Arabia Saudita)'], [/minimax/i, 'MiniMax']];
const makerOf = id => (MAKERS.find(([re]) => re.test(id)) || [])[1];

function promptVars(cfg, runtime) {
  const extra = [];
  if (cfg.tools.length || cfg.apis.length) extra.push('Cuando una herramienta pueda dar el dato exacto, úsala en vez de adivinar.');
  if (cfg.rag.enabled) extra.push('Para preguntas sobre las notas del usuario, consulta primero la herramienta buscar_conocimiento y responde solo con lo que encuentres.');
  else if (cfg.knowledge) extra.push('Notas del usuario:\n' + cfg.knowledge.slice(0, 6000));
  const instr = cfg.system.trim();
  const any = cfg.persona.trim() || cfg.style.trim() || formatText(cfg) || cfg.rules.trim() || instr;
  return {
    nombre: cfg.name.trim(), modelo: runtime ? modelLabel(runtime.model || cfg.model, runtime.provider) : '', personalidad: cfg.persona.trim(), estilo: cfg.style.trim(), formato: formatText(cfg), reglas: cfg.rules.trim(),
    instrucciones: instr || (any ? '' : 'Eres un asistente útil. Responde en español, de forma clara y breve.'), extras: extra.join('\n\n')
  };
}

function buildSystem(cfg, runtime) {
  const v = promptVars(cfg, runtime);
  return PROMPT_LINES.filter(([k]) => v[k]).map(([k, line]) => line.replace(`{${k}}`, () => v[k])).join('\n');
}

// Ejecuta una herramienta fuera del bucle (lo usa el modo Ollama, cuyo bucle corre en el navegador).
async function runTool(rawConfig, name, args, fetchImpl = fetch, lookup) {
  const cfg = sanitizeConfig(rawConfig);
  return execTool(toolsFor(cfg), cfg, name, args, { fetch: fetchImpl, lookup });
}

// Lo que un cliente necesita para dirigir el modelo por su cuenta.
function prepare(rawConfig, rawRuntime) {
  const cfg = sanitizeConfig(rawConfig);
  const rt = rawRuntime && typeof rawRuntime === 'object' ? { provider: str(rawRuntime.provider, 80), model: str(rawRuntime.model, 80) } : null;
  const runtime = rt && rt.provider ? rt : null;
  return { system: buildSystem(cfg, runtime), vars: promptVars(cfg, runtime), tools: Object.values(toolsFor(cfg)).map(t => t.def), temperature: cfg.temperature, maxTokens: cfg.maxTokens, historyLimit: historyLimit(cfg) };
}

module.exports = { runTool, prepare, buildSystem, promptVars, PROMPT_LINES, FORMATS, DEFAULT_MODEL, retrieve, safeGet, isPrivateIp, apiParams, historyLimit, calc, searchKnowledge, sanitizeConfig, sanitizeHistory, runAgent, TOOLS, MODELS, MAX_STEPS };
