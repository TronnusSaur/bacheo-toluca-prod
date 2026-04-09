import { google } from 'googleapis';
import { oauth2Client } from './auth.js';
import { loadTokens, saveTokens } from './db.js';

/**
 * PRODUCTION GOOGLE CLIENT: Loads tokens from Postgres.
 * Auto-refreshes when the access_token expires using the stored refresh_token.
 */
export async function getGoogleClient() {
  // Priority 1: User OAuth2 (Loads from DB, auto-refreshes)
  try {
    const tokens = await loadTokens();
    
    if (tokens) {
      console.log('[GS-CLIENT] Cargando tokens desde DB...');
      oauth2Client.setCredentials(tokens);

      // Auto-refresh if the access_token is expired or about to expire
      const expiryDate = tokens.expiry_date || 0;
      const isExpired = Date.now() >= expiryDate - 60000; // 1 min buffer

      if (isExpired && tokens.refresh_token) {
        console.log('[GS-CLIENT] Token expirado, refrescando automáticamente...');
        const { credentials } = await oauth2Client.refreshAccessToken();
        // Merge refresh_token since refreshAccessToken may not return it
        const newTokens = { ...credentials, refresh_token: tokens.refresh_token };
        await saveTokens(newTokens);
        oauth2Client.setCredentials(newTokens);
        console.log('[GS-CLIENT] Token refrescado y guardado en DB.');
      }

      return oauth2Client;
    }
  } catch (err) {
    console.error('[GS-CLIENT ERROR] Error al cargar/refrescar tokens desde DB:', err.message);
  }

  // Priority 2: Service Account (Fallback) 
  if (process.env.GOOGLE_CREDENTIALS) {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
    });
    return await auth.getClient();
  }

  throw new Error('NO AUTH CONFIGURED. Provide GOOGLE_TOKENS in DB or GOOGLE_CREDENTIALS.');
}
