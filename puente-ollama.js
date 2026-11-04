// Puente seguro hacia el Ollama de este equipo.
//
// Sirve para que el taller publicado en Railway use los modelos de tu Mac: un túnel (cloudflared o ngrok) apunta a
// este puente y el puente deja pasar SOLO lo que el taller necesita, y solo con la contraseña correcta.
//   - GET  /api/tags   (lista de modelos)
//   - POST /api/chat   (conversar con un modelo)
// Todo lo demás (descargar o borrar modelos, generar, etc.) se rechaza.
const http = require('http');
const crypto = require('crypto');

function createBridge({ token, target = 'http://127.0.0.1:11434' }) {
  if (!token || token.length < 16) throw new Error('PUENTE_TOKEN debe tener al menos 16 caracteres');
  const dest = new URL(target);
  const expected = Buffer.from(`Bearer ${token}`);
  const ALLOWED = new Set(['GET /api/tags', 'POST /api/chat']);

  return http.createServer((req, res) => {
    const reject = (code, msg) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: msg })); };
    const got = Buffer.from(String(req.headers.authorization || ''));
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return reject(401, 'No autorizado');
    const path = (req.url || '').split('?')[0];
    if (!ALLOWED.has(`${req.method} ${path}`)) return reject(403, 'Ruta no permitida');
    if (Number(req.headers['content-length'] || 0) > 2 * 1024 * 1024) return reject(413, 'Petición demasiado grande');

    const up = http.request({ hostname: dest.hostname, port: dest.port || 80, path, method: req.method, headers: { 'Content-Type': req.headers['content-type'] || 'application/json' } }, r => {
      res.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'application/json' });
      r.pipe(res);
    });
    up.on('error', () => reject(502, 'Ollama no responde en este equipo'));
    req.pipe(up);
  });
}

module.exports = { createBridge };

if (require.main === module) {
  const token = process.env.PUENTE_TOKEN || '';
  if (token.length < 16) { console.error('Define PUENTE_TOKEN con al menos 16 caracteres (usa ./puente.sh, que lo genera).'); process.exit(1); }
  const port = Number(process.env.PUENTE_PORT || 11435);
  createBridge({ token, target: process.env.OLLAMA_LOCAL || 'http://127.0.0.1:11434' }).listen(port, '127.0.0.1', () => console.log(`[puente] escuchando en 127.0.0.1:${port} → Ollama`));
}
