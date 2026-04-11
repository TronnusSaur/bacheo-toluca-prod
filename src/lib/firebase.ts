/**
 * firebase.ts
 * Configuración de Firebase Authentication para Bacheo Toluca.
 * 
 * Este módulo:
 * - Inicializa Firebase con el proyecto configurado
 * - Provee helpers para login/logout
 * - Provee getIdToken() para adjuntar a cada request API
 * - Cachea la sesión localmente (funciona offline)
 */

import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User 
} from 'firebase/auth';

// Firebase project: bacheo-toluca-prod
const firebaseConfig = {
  apiKey: "AIzaSyAEJ8FcrfXgk7f1KfHpZ7k-GiACWHZi7D8",
  authDomain: "bacheo-toluca-prod.firebaseapp.com",
  projectId: "bacheo-toluca-prod",
  storageBucket: "bacheo-toluca-prod.firebasestorage.app",
  messagingSenderId: "447464323171",
  appId: "1:447464323171:web:c3098d348572c31db46056",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/**
 * Obtiene el ID Token actual del usuario autenticado.
 * Firebase auto-refresca el token si está expirado y hay conexión.
 * Si no hay conexión, devuelve el último token cacheado.
 * @returns ID token string o null si no hay sesión
 */
export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(/* forceRefresh */ false);
  } catch (err) {
    console.warn('[AUTH] No se pudo obtener token (posible offline):', err);
    return null;
  }
}

/**
 * Login con email y password.
 * Firebase cachea la sesión en IndexedDB automáticamente.
 */
export async function signIn(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/**
 * Cerrar sesión.
 */
export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

/**
 * Observador de estado de autenticación.
 * Se ejecuta al inicio y cada vez que cambia el estado (login/logout).
 */
export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}
