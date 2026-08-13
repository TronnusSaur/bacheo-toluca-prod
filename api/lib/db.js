import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('vercel-storage.com') ? { rejectUnauthorized: false } : false
});

export default pool;

let dbInitialized = false;

/**
 * Initialize Tables including bacheo_pruebas_app in Postgres.
 * public.bacheo remains sacred and untouched.
 */
export async function initDb() {
  if (dbInitialized) return;
  
  try {
    const client = await pool.connect();
    try {
      console.log('[DB] Inicializando tablas...');
      
      // Isolated table for app testing
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.bacheo_pruebas_app (
          id SERIAL PRIMARY KEY,
          folio TEXT UNIQUE NOT NULL,
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
          calle_1 TEXT,
          calle_2 TEXT,
          created_by TEXT,
          updated_by TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // System Settings Table
      await client.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Table for Reports (legacy)
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
          created_by TEXT,
          updated_by TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      dbInitialized = true;
      console.log('[DB] Base de datos e hilado bacheo_pruebas_app inicializados OK.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[DB ERROR] Fallo al inicializar tablas:', err.message);
  }
}

export async function saveTokens(tokens) {
  try {
    await pool.query(
      'INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      ['google_tokens', tokens]
    );
  } catch (e) {
    console.warn('[DB TOKENS WARN]', e.message);
  }
}

export async function loadTokens() {
  try {
    const res = await pool.query('SELECT value FROM system_settings WHERE key = $1', ['google_tokens']);
    return res.rows[0]?.value || null;
  } catch (e) {
    return null;
  }
}
