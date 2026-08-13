/**
 * apiFetch.ts
 * Wrapper para fetch que automáticamente adjunta el Supabase ID/Session Token.
 */

import { getIdToken } from './supabase';

const VERCEL_API_BASE = 'https://bacheo-toluca-prod.vercel.app';

export async function apiFetch(
  url: string, 
  options: RequestInit = {}
): Promise<Response> {
  const token = await getIdToken();
  
  const headers = new Headers(options.headers || {});
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  // Auto-add Content-Type for JSON string bodies if not set
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  
  // Resolve absolute URL: relative URLs go to window.location.origin in browser or Vercel base in native
  let absoluteUrl = url;
  if (url.startsWith('/')) {
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1')) {
      absoluteUrl = url;
    } else {
      absoluteUrl = `${VERCEL_API_BASE}${url}`;
    }
  }
  
  return fetch(absoluteUrl, {
    ...options,
    headers,
  });
}
