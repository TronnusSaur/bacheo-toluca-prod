/**
 * apiFetch.ts
 * Wrapper para fetch que automáticamente adjunta el Supabase ID/Session Token
 * y dirige las solicitudes a la API de Vercel/Express.
 */

import { getIdToken, getDemoUser } from './supabase';

const VERCEL_API_BASE = 'https://bacheo-toluca-prod.vercel.app';

export async function apiFetch(
  url: string, 
  options: RequestInit = {}
): Promise<Response> {
  let token = await getIdToken();
  const demoUser = getDemoUser();
  
  const headers = new Headers(options.headers || {});
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else if (demoUser) {
    // If in demo/testing mode, attach demo bearer token
    headers.set('Authorization', `Bearer demo-admin-token`);
  }
  
  // Auto-add Content-Type for JSON string bodies if not set
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  
  // Resolve absolute URL:
  // If already full URL (http://...), use as is.
  // If running on Vercel (hostname includes vercel.app), use relative path /api/...
  // Otherwise (local dev, Supabase Studio tab 192.168.1.128:8000, or mobile app), direct to VERCEL_API_BASE.
  let absoluteUrl = url;
  if (url.startsWith('/')) {
    if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
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
