import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// In Vercel, the app URL is determined dynamically. 
// User should set GOOGLE_REDIRECT_URI in Vercel settings.
// Example: https://tu-app.vercel.app/api/auth/callback
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/callback';

export const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

export function getAuthUrl() {
  const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // CRITICAL: Get refresh token
    scope: scopes,
    prompt: 'consent', // Ensure refresh token is sent every time if needed
  });
}

export async function getTokensFromCode(code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export function setClientTokens(tokens) {
  oauth2Client.setCredentials(tokens);
}
