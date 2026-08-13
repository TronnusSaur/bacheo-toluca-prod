/**
 * supabase.ts
 * Configuración de Supabase Client para Bacheo Toluca.
 * Conectado a la instancia local en http://192.168.1.128:8000
 */

import { createClient, User, Session } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://192.168.1.128:8000';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

/**
 * Obtiene el JWT access_token de la sesión activa de Supabase.
 */
export async function getIdToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch (err) {
    console.warn('[SUPABASE AUTH] No se pudo obtener sesión token:', err);
    return null;
  }
}

/**
 * Iniciar sesión con Email y Contraseña.
 */
export async function signIn(email: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  if (!data.user) throw new Error('Usuario no devuelto por Supabase');
  return data.user;
}

/**
 * Cerrar sesión en Supabase.
 */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('[SUPABASE AUTH] Error al cerrar sesión:', error);
}

/**
 * Suscribirse a cambios en el estado de autenticación.
 */
export function onAuthChange(callback: (user: User | null, session: Session | null) => void): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null, session);
  });

  return () => {
    subscription.unsubscribe();
  };
}
