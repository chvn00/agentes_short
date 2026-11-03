// Secreto de la aplicación: firma las sesiones y cifra las API keys guardadas.
const crypto = require('crypto');

let SECRET = process.env.APP_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[WARN] APP_SECRET no está definido: se generó uno temporal. Las sesiones y las API keys guardadas dejarán de funcionar cada vez que el servidor se reinicie. Define APP_SECRET en las variables de entorno.');
}
const derive = label => crypto.createHmac('sha256', SECRET).update(label).digest();
const SESSION_KEY = derive('session').toString('hex');
const ENC_KEY = derive('encrypt');

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

// Devuelve null si el dato está corrupto o se cifró con otro secreto.
function decrypt(b64) {
  try {
    const b = Buffer.from(b64, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; }
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { SESSION_KEY, encrypt, decrypt, safeEqual };
