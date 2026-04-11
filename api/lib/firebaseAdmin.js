/**
 * firebaseAdmin.js
 * Firebase Admin SDK for server-side token verification.
 * 
 * Uses the existing GOOGLE_CREDENTIALS service account or a dedicated
 * FIREBASE_SERVICE_ACCOUNT env var. Works with Vercel serverless.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin (only once — critical for serverless)
let adminApp;

function getAdminApp() {
  if (adminApp) return adminApp;
  if (getApps().length > 0) {
    adminApp = getApps()[0];
    return adminApp;
  }

  // Use FIREBASE_SERVICE_ACCOUNT if available, 
  // otherwise fall back to the existing GOOGLE_CREDENTIALS
  const credsJson = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_CREDENTIALS;
  
  if (credsJson) {
    try {
      const creds = JSON.parse(credsJson);
      adminApp = initializeApp({
        credential: cert(creds),
      });
      console.log('[FIREBASE ADMIN] Initialized with service account credentials.');
    } catch (err) {
      console.error('[FIREBASE ADMIN] Failed to parse credentials:', err.message);
      // Initialize without credentials (some features may not work)
      adminApp = initializeApp();
    }
  } else {
    // Initialize with default credentials (for local dev with gcloud CLI)
    adminApp = initializeApp();
    console.log('[FIREBASE ADMIN] Initialized with default credentials.');
  }

  return adminApp;
}

/**
 * Verify a Firebase ID Token from an Authorization: Bearer header.
 * @param {import('express').Request} req - Express request
 * @returns {object|null} Decoded token payload or null if invalid/missing
 */
export async function verifyFirebaseToken(req) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const idToken = authHeader.split('Bearer ')[1];
  if (!idToken || idToken === 'undefined' || idToken === 'null') {
    return null;
  }

  try {
    const app = getAdminApp();
    const decodedToken = await getAuth(app).verifyIdToken(idToken);
    return decodedToken;
  } catch (err) {
    console.warn('[FIREBASE AUTH] Token verification failed:', err.code || err.message);
    return null;
  }
}

/**
 * Express middleware that requires a valid Firebase token.
 * Attaches the decoded user info to req.firebaseUser.
 */
export function requireAuth(req, res, next) {
  verifyFirebaseToken(req)
    .then(user => {
      if (!user) {
        return res.status(401).json({ 
          error: 'No autorizado. Se requiere iniciar sesión.' 
        });
      }
      req.firebaseUser = user;
      next();
    })
    .catch(err => {
      console.error('[AUTH MIDDLEWARE ERROR]', err);
      return res.status(401).json({ 
        error: 'Error de autenticación' 
      });
    });
}
