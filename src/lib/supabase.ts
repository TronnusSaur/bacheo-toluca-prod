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

const DEMO_SESSION_KEY = 'bacheo_demo_user_email';

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
  localStorage.removeItem(DEMO_SESSION_KEY);
  return data.user;
}

/**
 * Registrar un nuevo usuario en Supabase Auth.
 */
export async function signUp(email: string, password: string): Promise<User | null> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: 'ADMIN'
      }
    }
  });
  if (error) throw error;
  return data.user;
}

/**
 * Habilita sesión de modo de pruebas local sin requerir confirmación por email.
 */
export function setDemoSession(email: string): User {
  const demoEmail = email.trim() || 'juanpablobumblebee@gmail.com';
  localStorage.setItem(DEMO_SESSION_KEY, demoEmail);
  const mockUser: any = {
    id: 'demo-user-' + Date.now(),
    email: demoEmail,
    role: 'authenticated',
    aud: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: { role: 'ADMIN', assignments: [] },
    created_at: new Date().toISOString()
  };
  return mockUser;
}

export function getDemoUser(): User | null {
  const savedEmail = localStorage.getItem(DEMO_SESSION_KEY);
  if (!savedEmail) return null;
  return {
    id: 'demo-user-session',
    email: savedEmail,
    role: 'authenticated',
    aud: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: { role: 'ADMIN', assignments: [] },
    created_at: new Date().toISOString()
  } as User;
}

/**
 * Cerrar sesión en Supabase y limpiar demo session.
 */
export async function signOut(): Promise<void> {
  localStorage.removeItem(DEMO_SESSION_KEY);
  const { error } = await supabase.auth.signOut();
  if (error) console.error('[SUPABASE AUTH] Error al cerrar sesión:', error);
}

/**
 * Suscribirse a cambios en el estado de autenticación.
 */
export function onAuthChange(callback: (user: User | null, session: Session | null) => void): () => void {
  const demoUser = getDemoUser();
  if (demoUser) {
    callback(demoUser, null);
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    const activeDemo = getDemoUser();
    if (activeDemo) {
      callback(activeDemo, null);
    } else {
      callback(session?.user || null, session);
    }
  });

  return () => {
    subscription.unsubscribe();
  };
}
