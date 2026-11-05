const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { runAgent, runTool, prepare, retrieve, TOOLS, MODELS, FORMATS, PROMPT_LINES } = require('./agent');
const { createPool, init } = require('./db');
const { SESSION_KEY, encrypt, decrypt, safeEqual } = require('./secrets');

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const GROQ_BASE = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';

const pool = createPool();
// La cuenta de administración se crea (o se actualiza) al arrancar con las variables de entorno.
let adminReady = false;
async function ensureAdmin() {
  if (!ADMIN_USERNAME) { console.warn('[WARN] ADMIN_USERNAME no está definido: no hay cuenta de administración. Defínelo (y ADMIN_PASSWORD) en las variables del servicio web y vuelve a desplegar.'); return; }
  if (ADMIN_PASSWORD.length < 8) { console.warn(`[WARN] ADMIN_PASSWORD falta o tiene menos de 8 caracteres: no se creó la cuenta de administración (${ADMIN_USERNAME}).`); return; }
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [ADMIN_USERNAME]);
  if (rows[0]) await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, rows[0].id]);
  else await pool.query('INSERT INTO users (username, password_hash, progress, settings) VALUES ($1,$2,$3,$4)', [ADMIN_USERNAME, hash, {}, {}]);
  adminReady = true;
  console.log(`[INFO] Cuenta de administración lista: ${ADMIN_USERNAME}`);
}
const ready = init(pool).then(ensureAdmin);

/* Clave de Groq compartida: la guarda el administrador en la base (cifrada) o viene del entorno */
async function sharedKey() {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['shared_groq_key']);
  return (rows[0] && decrypt(rows[0].value)) || process.env.GROQ_API_KEY || null;
}

/* ---------- Groq ---------- */
const REASONING = /^(openai\/gpt-oss|qwen\/)/;        // modelos que "piensan" antes de responder
const strip = t => String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

function groqError(status, body, model) {
  let detail = '';
  try { const j = JSON.parse(body); detail = (j.error && (j.error.message || j.error.code)) || ''; } catch { /* sin JSON */ }
  console.error('[Groq]', status, model, String(body).slice(0, 300));
  if (status === 401) return Object.assign(new Error('Groq rechazó tu API key. Vuelve a guardarla en «Mi cuenta».'), { status: 400 });
  if (status === 429) return Object.assign(new Error('Llegaste al límite de tu cuenta de Groq. Espera un minuto e inténtalo de nuevo.'), { status: 429 });
  if (/decommission|no longer supported|model_not_found|does not exist|not found/i.test(detail + body)) return Object.assign(new Error(`El modelo «${model}» ya no está disponible en Groq. Elige otro en la sección 1 del Constructor.`), { status: 400 });
  if (/does not support tool|tool.{0,30}not supported|tools? .{0,20}unsupported/i.test(detail + body)) return Object.assign(new Error(`El modelo «${model}» no admite herramientas. Elige otro (por ejemplo gpt-oss) o desactiva las herramientas, las APIs y el RAG.`), { status: 400 });
  if (/context.{0,20}(length|window)|too many tokens|maximum context/i.test(detail + body)) return Object.assign(new Error(`El modelo «${model}» tiene un contexto muy corto para este agente. Reduce la memoria, el RAG o las instrucciones, o elige otro modelo.`), { status: 400 });
  if (/tool_use_failed|failed to call a function/i.test(detail + body)) return Object.assign(new Error('El modelo armó mal la llamada a una herramienta. Pregunta de nuevo o prueba con otro modelo.'), { status: 502 });
  return Object.assign(new Error(detail ? `Groq respondió: ${String(detail).slice(0, 200)}` : 'El modelo no pudo responder en este momento.'), { status: 502 });
}

/* ---------- Ollama del servidor: modelos locales que todos usan sin instalar nada ---------- */
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_TOKEN = process.env.OLLAMA_TOKEN || '';      // si Ollama está detrás del puente (túnel) hacia tu Mac
const ollamaHeaders = (extra = {}) => ({ ...(OLLAMA_TOKEN ? { Authorization: `Bearer ${OLLAMA_TOKEN}` } : {}), ...extra });
let ollamaCache = { t: 0, models: null };
async function serverOllama() {
  if (OLLAMA_URL === 'off') return null;
  if (Date.now() - ollamaCache.t < 30000) return ollamaCache.models;
  let models = null;
  try {
    const r = await fetch(OLLAMA_URL + '/api/tags', { headers: ollamaHeaders(), signal: AbortSignal.timeout(OLLAMA_TOKEN ? 4000 : 1500) });
    if (r.ok) {
      // Los más grandes primero (suelen usar mejor las herramientas) y sin repetir el mismo modelo con dos etiquetas.
      const all = ((await r.json()).models || []).slice().sort((a, b) => (b.size || 0) - (a.size || 0));
      const seen = new Map();
      for (const m of all) { const k = m.digest || m.name; if (!seen.has(k) || (/:latest$/.test(seen.get(k)) && !/:latest$/.test(m.name))) seen.set(k, m.name); }
      models = [...seen.values()];
      if (!models.length) models = null;
    }
  } catch { /* no hay Ollama en este servidor */ }
  ollamaCache = { t: Date.now(), models };
  return models;
}

// Traduce entre el formato del bucle (tipo OpenAI) y el de Ollama.
function makeOllamaLlm(model) {
  const parse = a => { try { return JSON.parse(a || '{}'); } catch { return {}; } };
  return async ({ temperature, maxTokens, messages, tools }) => {
    const names = new Map();
    const body = messages.map(m => {
      if (m.role === 'assistant' && m.tool_calls) {
        m.tool_calls.forEach(c => names.set(c.id, c.function.name));
        return { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls.map(c => ({ function: { name: c.function.name, arguments: parse(c.function.arguments) } })) };
      }
      if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: names.get(m.tool_call_id) };
      // Los modelos pequeños llaman peor a las herramientas cuando el prompt de sistema tiene saltos de línea
      // (qwen2.5:7b pasó de 2 de 4 a 4 de 4): para ellos el prompt va en una sola línea.
      return { role: m.role, content: m.role === 'system' ? String(m.content).replace(/\s*\n+\s*/g, ' ') : m.content };
    });
    // Ollama a veces devuelve una respuesta vacía cuando el modelo escribió una llamada a herramienta que no pudo
    // interpretar (sobre todo en modelos pequeños). Se reintenta con otra muestra y, al final, sin herramientas.
    const ask = async (temp, withTools) => {
      let res;
      try {
        res = await fetch(OLLAMA_URL + '/api/chat', { method: 'POST', headers: ollamaHeaders({ 'Content-Type': 'application/json' }), signal: AbortSignal.timeout(180000), body: JSON.stringify({ model, messages: body, tools: withTools ? tools : undefined, stream: false, options: { temperature: temp, num_predict: maxTokens || 700, num_ctx: 8192 } }) });
      } catch { throw Object.assign(new Error('El Ollama del servidor no respondió. Avísale al docente.'), { status: 502 }); }
      if (!res.ok) {
        const t = await res.text();
        console.error('[Ollama]', res.status, model, t.slice(0, 200));
        throw Object.assign(new Error(/does not support tools/i.test(t) ? 'Ese modelo no soporta herramientas. Elige otro o desactiva las herramientas.' : 'El Ollama del servidor no pudo responder.'), { status: 502 });
      }
      return (await res.json()).message || {};
    };
    const empty = m => !strip(m.content) && !(m.tool_calls || []).length;
    let msg = await ask(temperature, !!tools);
    for (const bump of [0.3, 0.6]) { if (!empty(msg) || !tools) break; msg = await ask(Math.min(1, temperature + bump), true); }
    if (empty(msg) && tools) msg = await ask(temperature, false);
    return { content: strip(msg.content), tool_calls: (msg.tool_calls || []).map((c, i) => ({ id: `call_${Date.now()}_${i}`, function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments || {}) } })) };
  };
}

function makeLlm(apiKey) {
  const call = body => fetch(`${GROQ_BASE}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return async ({ model, temperature, maxTokens, messages, tools }) => {
    const base = { model, temperature, messages, tools, max_completion_tokens: (maxTokens || 700) + (REASONING.test(model) ? 800 : 0) };
    const extra = /^openai\/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : /^qwen\//.test(model) ? { reasoning_format: 'hidden' } : null;
    let res = await call(extra ? { ...base, ...extra } : base);
    if (res.status === 400 && extra) {                 // por si el modelo no acepta ese parámetro, se reintenta sin él
      const t = await res.clone().text();
      if (/reasoning_(effort|format)/i.test(t)) res = await call(base);
    }
    if (!res.ok) throw groqError(res.status, await res.text(), model);
    const msg = (await res.json()).choices[0].message;
    return { ...msg, content: strip(msg.content) };
  };
}

async function keyIsValid(key) {
  try { return (await fetch(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${key}` } })).ok; }
  catch { return false; }
}

/* ---------- utilidades ---------- */
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function limiter(max, windowMs = 60000, keyOf = req => req.ip) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); hits.forEach((l, k) => { if (!l.some(t => now - t < windowMs)) hits.delete(k); }); }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now(), k = keyOf(req);
    const list = (hits.get(k) || []).filter(t => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'Demasiados intentos. Espera un momento.' });
    list.push(now); hits.set(k, list); next();
  };
}

const COOKIE = 'session';
function startSession(req, res, user) {
  const token = jwt.sign({ id: user.id, username: user.username }, SESSION_KEY, { expiresIn: '7d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 24 * 3600 * 1000 });
}
function auth(req, res, next) {
  const m = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie || '');
  try { req.user = jwt.verify(decodeURIComponent(m ? m[1] : ''), SESSION_KEY); next(); }
  catch { res.status(401).json({ error: 'Inicia sesión para continuar' }); }
}

const isAdmin = req => !!ADMIN_USERNAME && req.user.username === ADMIN_USERNAME;
function requireAdmin(req, res, next) { return isAdmin(req) ? next() : res.status(403).json({ error: 'Solo para el administrador' }); }
// El "usuario" es el nombre y apellido: con mayúsculas o minúsculas, tildes y espacios; se guarda normalizado.
const USERNAME = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{2,59}$/u;
const normName = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const hint = key => 'gsk_…' + key.slice(-4);
const clip = (o, max) => (o && typeof o === 'object' && !Array.isArray(o) && JSON.stringify(o).length <= max) ? o : null;

/* ---------- aplicación ---------- */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '400kb' }));

app.get('/api/info', wrap(async (req, res) => {
  res.json({
    needsCode: !!ACCESS_CODE, adminReady, sharedKey: !!(await sharedKey()), serverOllama: await serverOllama(), models: MODELS,
    formats: Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, v.label])), promptLines: PROMPT_LINES.map(([, l]) => l),
    tools: Object.entries(TOOLS).map(([id, t]) => ({ id, label: t.label, description: t.def.function.description }))
  });
}));

// El salón entero puede salir por una sola IP: el registro admite más tráfico y el login se limita por cuenta.
const registerLimit = limiter(60);
const loginLimit = limiter(10, 60000, req => req.ip + '|' + normName((req.body || {}).username));
app.post('/api/register', registerLimit, wrap(async (req, res) => {
  const { password, code } = req.body || {};
  const username = normName((req.body || {}).username);
  if (ACCESS_CODE && !safeEqual(code || '', ACCESS_CODE)) return res.status(403).json({ error: 'El código de clase no es correcto.' });
  if (username === ADMIN_USERNAME) return res.status(409).json({ error: 'Ese usuario ya existe. Elige otro.' });
  if (!USERNAME.test(username)) return res.status(400).json({ error: 'Escribe tu nombre y apellido (solo letras).' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if ((await pool.query('SELECT 1 FROM users WHERE username = $1', [username])).rows.length) return res.status(409).json({ error: 'Ese usuario ya existe. Elige otro.' });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query('INSERT INTO users (username, password_hash, progress, settings) VALUES ($1,$2,$3,$4) RETURNING id, username', [username, hash, {}, {}]);
  startSession(req, res, rows[0]);
  res.json({ username });
}));

app.post('/api/login', loginLimit, wrap(async (req, res) => {
  const username = normName((req.body || {}).username);
  const password = String((req.body || {}).password || '');
  const { rows } = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
  const ok = rows[0] && await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  startSession(req, res, rows[0]);
  res.json({ username });
}));

app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });

app.get('/api/me', auth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT username, groq_key, progress, settings FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'La cuenta ya no existe' });
  const key = rows[0].groq_key ? decrypt(rows[0].groq_key) : null;
  pool.query('UPDATE users SET last_seen = now() WHERE id = $1', [req.user.id]).catch(() => {});
  res.json({ username: rows[0].username, isAdmin: isAdmin(req), hasKey: !!key, keyHint: key ? hint(key) : null, progress: rows[0].progress, settings: rows[0].settings });
}));

app.put('/api/me/state', auth, wrap(async (req, res) => {
  const progress = clip(req.body && req.body.progress, 4000), settings = clip(req.body && req.body.settings, 2000);
  if (progress) await pool.query('UPDATE users SET progress = $1 WHERE id = $2', [progress, req.user.id]);
  if (settings) await pool.query('UPDATE users SET settings = $1 WHERE id = $2', [settings, req.user.id]);
  res.json({ ok: true });
}));

app.put('/api/me/groq-key', auth, limiter(10), wrap(async (req, res) => {
  const key = String((req.body || {}).key || '').trim();
  if (!/^gsk_[A-Za-z0-9]{20,}$/.test(key)) return res.status(400).json({ error: 'Esa clave no tiene el formato de Groq: empieza por gsk_.' });
  if (!(await keyIsValid(key))) return res.status(400).json({ error: 'Groq no aceptó esa clave. Revisa que la copiaste completa.' });
  await pool.query('UPDATE users SET groq_key = $1 WHERE id = $2', [encrypt(key), req.user.id]);
  res.json({ hasKey: true, keyHint: hint(key) });
}));

app.delete('/api/me/groq-key', auth, wrap(async (req, res) => {
  await pool.query('UPDATE users SET groq_key = NULL WHERE id = $1', [req.user.id]);
  res.json({ hasKey: false });
}));

/* Modelos disponibles hoy en Groq (la lista cambia: Groq retira modelos cada pocos meses) */
const modelCache = new Map();
app.get('/api/models', auth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT groq_key FROM users WHERE id = $1', [req.user.id]);
  const key = (rows[0] && rows[0].groq_key && decrypt(rows[0].groq_key)) || await sharedKey();
  if (!key) return res.json({ models: MODELS, source: 'respaldo' });
  const hit = modelCache.get(key);
  if (hit && Date.now() - hit.t < 600000) return res.json({ models: hit.models, source: 'groq' });
  try {
    const r = await fetch(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error('sin lista');
    // Se descartan los modelos de audio y moderación, los inactivos y los de contexto muy corto (por ejemplo ALLaM, 4K):
    // no caben el prompt, las herramientas y el historial de un agente.
    const ids = ((await r.json()).data || [])
      .filter(m => m && typeof m.id === 'string' && m.active !== false && !(m.context_window && m.context_window < 8000) && !/whisper|orpheus|guard|safeguard|tts|embed|compound|playai/i.test(m.id))
      .map(m => m.id);
    if (!ids.length) throw new Error('lista vacía');
    const models = [...MODELS.filter(m => ids.includes(m)), ...ids.filter(id => !MODELS.includes(id)).sort()];
    modelCache.set(key, { t: Date.now(), models });
    res.json({ models, source: 'groq' });
  } catch { res.json({ models: MODELS, source: 'respaldo' }); }
}));

app.put('/api/me/password', auth, limiter(10, 60000, req => 'pw' + req.user.id), wrap(async (req, res) => {
  const { current, password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres.' });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  if (req.user.username === ADMIN_USERNAME) return res.status(400).json({ error: 'La contraseña del administrador se cambia con la variable ADMIN_PASSWORD en Railway.' });
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 10), req.user.id]);
  res.json({ ok: true });
}));

/* Agentes guardados en la cuenta */
app.get('/api/agents', auth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT name, config FROM agents WHERE user_id = $1 ORDER BY updated_at DESC', [req.user.id]);
  res.json(rows);
}));

app.put('/api/agents/:name', auth, wrap(async (req, res) => {
  const name = String(req.params.name).trim().slice(0, 40);
  const config = clip(req.body && req.body.config, 100000);
  if (!name || !config) return res.status(400).json({ error: 'Falta el nombre o la configuración.' });
  const { rows: mine } = await pool.query('SELECT COUNT(*)::int AS n FROM agents WHERE user_id = $1', [req.user.id]);
  const upd = await pool.query('UPDATE agents SET config = $1, updated_at = now() WHERE user_id = $2 AND name = $3', [config, req.user.id, name]);
  if (!upd.rowCount) {
    if (mine[0].n >= 20) return res.status(400).json({ error: 'Llegaste al máximo de 20 agentes guardados.' });
    await pool.query('INSERT INTO agents (user_id, name, config) VALUES ($1,$2,$3)', [req.user.id, name, config]);
  }
  res.json({ ok: true });
}));

app.delete('/api/agents/:name', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM agents WHERE user_id = $1 AND name = $2', [req.user.id, req.params.name]);
  res.json({ ok: true });
}));

/* Agente con Groq: usa la API key de la persona (o la del servidor si existe) */
/* Cuenta lo que cada estudiante usa el agente (mensajes, herramientas y último modelo) para la consola del docente */
async function tracked(req, model, promise) {
  const out = await promise;
  const tools = Array.isArray(out && out.steps) ? out.steps.length : 0;
  pool.query('UPDATE users SET msgs = msgs + 1, tool_calls = tool_calls + $1, last_model = $2 WHERE id = $3', [tools, String(model || '').slice(0, 80), req.user.id]).catch(() => {});
  return out;
}
app.post('/api/agent', auth, limiter(20, 60000, req => 'u' + req.user.id), wrap(async (req, res) => {
  const { config, history, provider, ollamaModel, memoryState } = req.body || {};
  pool.query('UPDATE users SET last_seen = now() WHERE id = $1', [req.user.id]).catch(() => {});
  if (provider === 'server') {
    const models = await serverOllama();
    if (!models) return res.status(400).json({ error: 'Este servidor no tiene modelos locales (Ollama). Elige Groq.' });
    const model = models.includes(ollamaModel) ? ollamaModel : models[0];
    return res.json(await tracked(req, model, runAgent({ config, history, llm: makeOllamaLlm(model), memoryState, runtime: { provider: 'Ollama, en el servidor del curso', model } })));
  }
  const { rows } = await pool.query('SELECT groq_key FROM users WHERE id = $1', [req.user.id]);
  const key = (rows[0] && rows[0].groq_key && decrypt(rows[0].groq_key)) || await sharedKey();
  if (!key) return res.status(400).json({ error: 'No hay clave de Groq: guárdala en «Mi cuenta», pide al docente la del curso o elige el modelo local del servidor.' });
  res.json(await tracked(req, config && config.model, runAgent({ config, history, llm: makeLlm(key), memoryState, runtime: { provider: 'Groq' } })));
}));

/* Para el modo Ollama, el bucle corre en el navegador: estos dos puntos le dan lo que necesita */
app.post('/api/prepare', auth, (req, res) => res.json(prepare((req.body || {}).config, (req.body || {}).runtime, (req.body || {}).query)));

app.post('/api/tool', auth, limiter(60, 60000, req => 'u' + req.user.id), wrap(async (req, res) => {
  const { config, name, args } = req.body || {};
  res.json({ result: await runTool(config, name, args && typeof args === 'object' ? args : {}) });
}));

/* ---------- Administración ---------- */
const admin = express.Router();
admin.use(auth, requireAdmin);

admin.get('/users', wrap(async (req, res) => {
  const { rows: users } = await pool.query('SELECT id, username, groq_key, progress, created_at, last_seen, msgs, tool_calls, last_model FROM users ORDER BY created_at DESC');
  const { rows: counts } = await pool.query('SELECT user_id, COUNT(*)::int AS n FROM agents GROUP BY user_id');
  const n = new Map(counts.map(c => [c.user_id, c.n]));
  res.json(users.map(u => ({
    id: u.id, username: u.username, isAdmin: u.username === ADMIN_USERNAME, hasKey: !!(u.groq_key && decrypt(u.groq_key)),
    progress: u.progress, agents: n.get(u.id) || 0, createdAt: u.created_at, lastSeen: u.last_seen,
    msgs: u.msgs || 0, toolCalls: u.tool_calls || 0, lastModel: u.last_model || null
  })));
}));

admin.get('/users/:id/agents', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT name, config, updated_at FROM agents WHERE user_id = $1 ORDER BY updated_at DESC', [req.params.id]);
  res.json(rows);
}));

admin.post('/users/:id/password', wrap(async (req, res) => {
  const password = (req.body || {}).password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  const upd = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2 AND username <> $3', [await bcrypt.hash(password, 10), req.params.id, ADMIN_USERNAME]);
  if (!upd.rowCount) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true });
}));

admin.post('/users/delete', wrap(async (req, res) => {
  const ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
  let deleted = 0;
  for (const id of ids) {
    const { rows } = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
    if (!rows[0] || rows[0].username === ADMIN_USERNAME) continue;
    await pool.query('DELETE FROM agents WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    deleted++;
  }
  res.json({ deleted });
}));

admin.delete('/users/:id', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT username FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (rows[0].username === ADMIN_USERNAME) return res.status(400).json({ error: 'No puedes borrar la cuenta de administración.' });
  await pool.query('DELETE FROM agents WHERE user_id = $1', [req.params.id]);
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Clave de Groq del curso: la usan quienes aún no guardaron la suya.
admin.get('/shared-key', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['shared_groq_key']);
  const k = rows[0] && decrypt(rows[0].value);
  res.json({ hasKey: !!k, keyHint: k ? hint(k) : null, fromEnv: !k && !!process.env.GROQ_API_KEY });
}));
admin.put('/shared-key', wrap(async (req, res) => {
  const key = String((req.body || {}).key || '').trim();
  if (!/^gsk_[A-Za-z0-9]{20,}$/.test(key)) return res.status(400).json({ error: 'Esa clave no tiene el formato de Groq: empieza por gsk_.' });
  if (!(await keyIsValid(key))) return res.status(400).json({ error: 'Groq no aceptó esa clave. Revisa que la copiaste completa.' });
  await pool.query('DELETE FROM app_settings WHERE key = $1', ['shared_groq_key']);
  await pool.query('INSERT INTO app_settings (key, value) VALUES ($1,$2)', ['shared_groq_key', encrypt(key)]);
  res.json({ hasKey: true, keyHint: hint(key) });
}));
admin.delete('/shared-key', wrap(async (req, res) => {
  await pool.query('DELETE FROM app_settings WHERE key = $1', ['shared_groq_key']);
  res.json({ ok: true });
}));
app.use('/api/admin', admin);

// Siempre revalidar: así un despliegue nuevo se ve al recargar y no queda una versión vieja en caché.
/* Texto de un PDF para el RAG: el navegador lo envía tal cual y recibe el texto */
const pdfBody = express.raw({ type: () => true, limit: '10mb' });
app.post('/api/extract-text', auth, limiter(10, 60000, req => 'u' + req.user.id), pdfBody, wrap(async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(400).json({ error: 'El archivo no es un PDF válido.' });
  let text, pages;
  try {
    const { extractText } = await import('unpdf');
    const r = await extractText(new Uint8Array(buf), { mergePages: true });
    text = String(r.text || ''); pages = r.totalPages;
  } catch (e) { console.error('[PDF] no se pudo leer:', e && e.message, '· Node', process.version); return res.status(400).json({ error: 'No pude leer ese PDF. Puede estar dañado o protegido con contraseña.' }); }
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 20) return res.status(422).json({ error: 'Ese PDF no tiene texto seleccionable (parece una imagen escaneada). Prueba con otro o pega el texto.' });
  res.json({ text: text.slice(0, 60000), pages, truncated: text.length > 60000 });
}));

/* Prueba de recuperación (RAG): muestra qué fragmentos encontraría el agente */
app.post('/api/rag-test', auth, limiter(60, 60000, req => 'u' + req.user.id), (req, res) => {
  const { knowledge, query, k, chunk } = req.body || {};
  const n = x => Math.round(Number(x));
  res.json(retrieve(String(knowledge || '').slice(0, 60000), String(query || '').slice(0, 300), Math.min(5, Math.max(1, n(k) || 3)), Math.min(1000, Math.max(200, n(chunk) || 600))));
});

app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((req, res) => res.status(404).send('No encontrado'));
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error inesperado en el servidor.' });
});

if (require.main === module) {
  ready.then(() => app.listen(PORT, () => console.log(`[INFO] Taller de agentes en el puerto ${PORT}` + (ACCESS_CODE ? ' (registro con código de clase)' : ''))))
    .catch(e => { console.error('[ERROR] No se pudo iniciar la base de datos:', e); process.exit(1); });
}
module.exports = { app, ready };
