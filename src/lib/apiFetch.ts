/**
 * apiFetch.ts
 * Wrapper para fetch que automáticamente adjunta el Firebase ID Token.
 * Si no hay token (no autenticado o offline), la petición se hace sin él.
 * 
 * Uso:
 *   import { apiFetch } from '../lib/apiFetch';
 *   const data = await apiFetch('/api/reports');
 *   // POST con body:
 *   await apiFetch('/api/reports', { method: 'POST', body: formData });
 */

import { getIdToken } from './firebase';

export async function apiFetch(
  url: string, 
  options: RequestInit = {}
): Promise<Response> {
  const token = await getIdToken();
  
  const headers = new Headers(options.headers || {});
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  return fetch(url, {
    ...options,
    headers,
  });
}
