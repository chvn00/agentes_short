// Base de datos: PostgreSQL en producción (DATABASE_URL); en memoria para desarrollo y pruebas.
function createPool() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    return new Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
  }
  console.warn('[WARN] DATABASE_URL no está definido: se usa una base EN MEMORIA y las cuentas se pierden al reiniciar. Agrega PostgreSQL en Railway y enlaza DATABASE_URL.');
  const { newDb } = require('pg-mem');
  const mem = newDb();
  mem.public.registerFunction({ name: 'now', returns: 'timestamp', implementation: () => new Date() });
  const { Pool } = mem.adapters.createPg();
  return new Pool();
}

async function init(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    groq_key TEXT,
    progress JSONB NOT NULL DEFAULT '{}',
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    config JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

module.exports = { createPool, init };
