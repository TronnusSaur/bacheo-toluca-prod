import { google } from 'googleapis';
import { oauth2Client } from './auth.js';
import { loadTokens, saveTokens } from './db.js';

let cachedClient = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes

export async function getGoogleClient() {
  if (cachedClient && Date.now() < cacheExpiry) {
    return cachedClient;
  }

  // Priority 1: User OAuth2 (Loads from DB, auto-refreshes)
  try {
    const tokens = await loadTokens();
    
    if (tokens) {
      console.log('[GS-CLIENT] Cargando tokens desde DB...');
      oauth2Client.setCredentials(tokens);

      const expiryDate = tokens.expiry_date || 0;
      const isExpired = Date.now() >= expiryDate - 60000;

      if (isExpired && tokens.refresh_token) {
        console.log('[GS-CLIENT] Token expirado, refrescando automáticamente...');
        const { credentials } = await oauth2Client.refreshAccessToken();
        const newTokens = { ...credentials, refresh_token: tokens.refresh_token };
        await saveTokens(newTokens);
        oauth2Client.setCredentials(newTokens);
        console.log('[GS-CLIENT] Token refrescado y guardado en DB.');
      }

      cachedClient = oauth2Client;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      return cachedClient;
    }
  } catch (err) {
    console.error('[GS-CLIENT ERROR] Error al cargar/refrescar tokens desde DB:', err.message);
  }

  // Priority 2: Service Account (Fallback) 
  if (process.env.GOOGLE_CREDENTIALS) {
    try {
      let rawCreds = process.env.GOOGLE_CREDENTIALS.trim();
      let creds;
      if (typeof rawCreds === 'string') {
        try {
          creds = JSON.parse(rawCreds);
        } catch (e) {
          creds = JSON.parse(rawCreds.replace(/\\n/g, '\n'));
        }
      } else {
        creds = rawCreds;
      }

      const auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
      });
      const client = await auth.getClient();
      cachedClient = client;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      return cachedClient;
    } catch (svcErr) {
      console.error('[GS-CLIENT SERVICE ACCOUNT ERROR]:', svcErr.message);
    }
  }

  throw new Error('NO AUTH CONFIGURED. Provide GOOGLE_TOKENS in DB or GOOGLE_CREDENTIALS.');
}
