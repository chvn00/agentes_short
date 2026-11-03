const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { runAgent, runTool, prepare, TOOLS, MODELS } = require('./agent');
const { createPool, init } = require('./db');
const { SESSION_KEY, encrypt, decrypt, safeEqual } = require('./secrets');

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const GROQ_BASE = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';

const pool = createPool();
const ready = init(pool);

/* ---------- Groq ---------- */
function makeLlm(apiKey) {
  return async ({ model, temperature, messages, tools }) => {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature, messages, tools, max_tokens: 1000 })
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[Groq]', res.status, body.slice(0, 300));
      const msg = res.status === 401 ? 'Groq rechazó tu API key. Vuelve a pegarla en el paso 2 del módulo 0.'
        : res.status === 429 ? 'Llegaste al límite de tu cuenta de Groq. Espera un minuto e inténtalo de nuevo.'
        : /tool_use_failed/.test(body) ? 'El modelo armó mal la llamada a una herramienta. Pregunta de nuevo o prueba con el modelo 70B.'
        : 'El modelo no pudo responder en este momento.';
      throw Object.assign(new Error(msg), { status: res.status === 401 ? 400 : res.status === 429 ? 429 : 502 });
    }
    return (await res.json()).choices[0].message;
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

const USERNAME = /^[a-z0-9_.-]{3,30}$/;
const hint = key => 'gsk_…' + key.slice(-4);
const clip = (o, max) => (o && typeof o === 'object' && !Array.isArray(o) && JSON.stringify(o).length <= max) ? o : null;

/* ---------- aplicación ---------- */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

app.get('/api/info', (req, res) => {
  res.json({
    needsCode: !!ACCESS_CODE, sharedKey: !!process.env.GROQ_API_KEY, models: MODELS,
    tools: Object.entries(TOOLS).map(([id, t]) => ({ id, label: t.label, description: t.def.function.description }))
  });
});

// El salón entero puede salir por una sola IP: el registro admite más tráfico y el login se limita por cuenta.
const registerLimit = limiter(60);
const loginLimit = limiter(10, 60000, req => req.ip + '|' + String((req.body || {}).username || '').toLowerCase());
app.post('/api/register', registerLimit, wrap(async (req, res) => {
  const { password, code } = req.body || {};
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  if (ACCESS_CODE && !safeEqual(code || '', ACCESS_CODE)) return res.status(403).json({ error: 'El código de clase no es correcto.' });
  if (!USERNAME.test(username)) return res.status(400).json({ error: 'El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if ((await pool.query('SELECT 1 FROM users WHERE username = $1', [username])).rows.length) return res.status(409).json({ error: 'Ese usuario ya existe. Elige otro.' });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query('INSERT INTO users (username, password_hash, progress, settings) VALUES ($1,$2,$3,$4) RETURNING id, username', [username, hash, {}, {}]);
  startSession(req, res, rows[0]);
  res.json({ username });
}));

app.post('/api/login', loginLimit, wrap(async (req, res) => {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
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
  res.json({ username: rows[0].username, hasKey: !!key, keyHint: key ? hint(key) : null, progress: rows[0].progress, settings: rows[0].settings });
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

/* Agentes guardados en la cuenta */
app.get('/api/agents', auth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT name, config FROM agents WHERE user_id = $1 ORDER BY updated_at DESC', [req.user.id]);
  res.json(rows);
}));

app.put('/api/agents/:name', auth, wrap(async (req, res) => {
  const name = String(req.params.name).trim().slice(0, 40);
  const config = clip(req.body && req.body.config, 30000);
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
app.post('/api/agent', auth, limiter(20, 60000, req => 'u' + req.user.id), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT groq_key FROM users WHERE id = $1', [req.user.id]);
  const key = (rows[0] && rows[0].groq_key && decrypt(rows[0].groq_key)) || process.env.GROQ_API_KEY;
  if (!key) return res.status(400).json({ error: 'Primero guarda tu API key de Groq (módulo 0, paso 2) o usa un modelo local con Ollama.' });
  const { config, history } = req.body || {};
  res.json(await runAgent({ config, history, llm: makeLlm(key) }));
}));

/* Para el modo Ollama, el bucle corre en el navegador: estos dos puntos le dan lo que necesita */
app.post('/api/prepare', auth, (req, res) => res.json(prepare((req.body || {}).config)));

app.post('/api/tool', auth, limiter(60, 60000, req => 'u' + req.user.id), wrap(async (req, res) => {
  const { config, name, args } = req.body || {};
  res.json({ result: await runTool(config, name, args && typeof args === 'object' ? args : {}) });
}));

app.use(express.static(path.join(__dirname, 'public')));
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
