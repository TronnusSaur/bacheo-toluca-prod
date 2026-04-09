import pg from 'pg';
const { Pool } = pg;

// Use Vercel Postgres URL or Local
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('vercel-storage.com') ? { rejectUnauthorized: false } : false
});

export default pool;

let dbInitialized = false;

/**
 * Initialize Tables (Equivalent to schema.sql)
 */
export async function initDb() {
  if (dbInitialized) return;
  
  const client = await pool.connect();
  try {
    console.log('[DB] Inicializando tablas...');
    // PostGIS (Only if needed, some free tiers don't support it)
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    } catch (e) {
      console.warn('[DB] skip postgis extension (not supported or not needed)');
    }

    // Table for System Settings (Tokens, etc)
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Table for Reports (Matching schema.sql)
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        folio TEXT UNIQUE,
        contractId TEXT,
        empresaName TEXT,
        lat FLOAT,
        lng FLOAT,
        largo FLOAT,
        ancho FLOAT,
        profundidad FLOAT,
        m2 FLOAT,
        locationDesc TEXT,
        delegacion TEXT,
        colonia TEXT,
        tipoBache TEXT,
        status TEXT DEFAULT 'DETECTADO',
        photoUrl TEXT,
        photoCaja TEXT,
        photoFinal TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add columns if missing (Simple migration)
    await client.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS photoCaja TEXT;");
    await client.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS photoFinal TEXT;");
    await client.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;");

    // DATA FIX: Resynchronize status for reports stuck due to the previous bug
    console.log('[DB] Ejecutando sincronización de estatus...');
    await client.query("UPDATE reports SET status = 'EN PROCESO' WHERE status = 'DETECTADO' AND photoCaja IS NOT NULL;");
    await client.query("UPDATE reports SET status = 'TERMINADO' WHERE status = 'EN PROCESO' AND photoFinal IS NOT NULL;");

    dbInitialized = true;
    console.log('[DB] Base de datos inicializada correctamente.');
  } catch (err) {
    console.error('[DB ERROR] Fallo al inicializar tablas:', err.message);
  } finally {
    client.release();
  }
}

export async function saveTokens(tokens) {
  await pool.query(
    'INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
    ['google_tokens', tokens]
  );
}

export async function loadTokens() {
  const res = await pool.query('SELECT value FROM system_settings WHERE key = $1', ['google_tokens']);
  return res.rows[0]?.value || null;
}
