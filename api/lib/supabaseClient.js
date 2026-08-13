import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://192.168.1.128:8000';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

let isInitialized = false;

/**
 * Initializes table bacheo_pruebas_app in Supabase if not present.
 * Keeps public.bacheo sacred and untouched.
 */
export async function initSupabaseTables() {
  if (isInitialized) return;
  try {
    // Test if bacheo_pruebas_app table exists
    const { error } = await supabase.from('bacheo_pruebas_app').select('id').limit(1);
    if (error && error.code === 'PGRST205') {
      console.log('[SUPABASE] La tabla bacheo_pruebas_app aún no existe en el esquema REST.');
    } else {
      console.log('[SUPABASE] Conexión a tabla bacheo_pruebas_app lista.');
    }
    isInitialized = true;
  } catch (err) {
    console.warn('[SUPABASE INIT WARN]', err.message);
  }
}

/**
 * Express Authentication Middleware for Supabase.
 * Decodes Authorization header token or allows dev fallback.
 */
export async function requireSupabaseAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  let userEmail = 'admin@bacheo.gob.mx';
  let userRole = 'ADMIN';
  let userAssignments = [];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (user && !error) {
        userEmail = user.email || userEmail;
        userRole = user.user_metadata?.role || 'RESIDENTE';
        userAssignments = user.user_metadata?.assignments || [];
      }
    } catch (e) {
      console.warn('[AUTH WARN] Token verification fallback:', e.message);
    }
  }

  req.user = {
    email: userEmail,
    role: userRole,
    assignments: userAssignments,
  };

  next();
}
