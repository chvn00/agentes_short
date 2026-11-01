const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { runAgent, TOOLS, MODELS } = require('./agent');

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const GROQ_URL = process.env.GROQ_URL || 'https://api.groq.com/openai/v1/chat/completions';

async function groq({ model, temperature, messages, tools }) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature, messages, tools, max_tokens: 1000 })
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[Groq]', res.status, body.slice(0, 300));
    const status = res.status === 429 ? 429 : 502;
    const msg = res.status === 429 ? 'Se alcanzó el límite de Groq. Espera un minuto e inténtalo de nuevo.'
      : /tool_use_failed/.test(body) ? 'El modelo armó mal la llamada a una herramienta. Pregunta de nuevo o prueba con el modelo 70B.'
      : 'El modelo no pudo responder en este momento.';
    throw Object.assign(new Error(msg), { status });
  }
  const data = await res.json();
  return data.choices[0].message;
}

// Límite simple por IP: 20 peticiones por minuto
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now(), key = req.ip;
  const list = (hits.get(key) || []).filter(t => now - t < 60000);
  if (list.length >= 20) return res.status(429).json({ error: 'Demasiadas peticiones. Espera un momento.' });
  list.push(now); hits.set(key, list); next();
}
setInterval(() => { const now = Date.now(); hits.forEach((l, k) => { if (!l.some(t => now - t < 60000)) hits.delete(k); }); }, 60000).unref();

function checkCode(req, res, next) {
  if (!ACCESS_CODE) return next();
  const a = Buffer.from(String(req.get('x-access-code') || '')), b = Buffer.from(ACCESS_CODE);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: 'Código de clase incorrecto', needsCode: true });
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

app.get('/api/info', (req, res) => {
  res.json({ needsCode: !!ACCESS_CODE, ready: !!process.env.GROQ_API_KEY, models: MODELS, tools: Object.entries(TOOLS).map(([id, t]) => ({ id, label: t.label, description: t.def.function.description })) });
});

app.post('/api/agent', rateLimit, checkCode, async (req, res) => {
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'Falta configurar GROQ_API_KEY en el servidor.' });
  try {
    const { config, history } = req.body || {};
    res.json(await runAgent({ config, history, llm: groq }));
  } catch (err) {
    if (!err.status) console.error('[agent]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error inesperado en el agente.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.status(404).send('No encontrado'));

if (require.main === module) {
  app.listen(PORT, () => console.log(`[INFO] Taller de agentes escuchando en el puerto ${PORT}` + (ACCESS_CODE ? ' (con código de clase)' : '')));
}
module.exports = app;
