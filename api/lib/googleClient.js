import { google } from 'googleapis';
import { oauth2Client } from './auth.js';
import { loadTokens } from './db.js';

/**
 * PRODUCTION GOOGLE CLIENT: Loads tokens from Postgres instead of disk.
 * Allows persistent 2TB user quota in serverless environments.
 */
export async function getGoogleClient() {
  // Priority 1: User OAuth2 (Loads from DB)
  try {
    const tokens = await loadTokens();
    
    if (tokens) {
      console.log('[GS-CLIENT] Cargando tokens desde DB...');
      oauth2Client.setCredentials(tokens);
      return oauth2Client;
    }
  } catch (err) {
    console.error('[GS-CLIENT ERROR] Error al cargar tokens desde DB:', err.message);
  }

  // Priority 2: Service Account (Fallback) 
  // Should return a client with no quota (0 bytes limit)
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
