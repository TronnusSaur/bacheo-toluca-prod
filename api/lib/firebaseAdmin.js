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

import pool, { initDb } from './db.js';

/**
 * Express middleware that requires a valid Firebase token.
 * Attaches decoded user info AND database role/assignments to req.user.
 */
export async function requireAuth(req, res, next) {
  try {
    const firebaseUser = await verifyFirebaseToken(req);
    
    if (!firebaseUser) {
      return res.status(401).json({ 
        error: 'No autorizado. Se requiere iniciar sesión.' 
      });
    }

    // Ensure tables exist before querying (handles cold starts)
    await initDb();

    // Lookup user in our DB for role and assignments
    // Wrapped in its own try/catch so a DB error doesn't block all authenticated users
    let dbUser = { role: 'RESIDENTE', assigned_contracts: [] };
    try {
      const { rows } = await pool.query(
        'SELECT role, assigned_contracts FROM app_users WHERE email = $1',
        [firebaseUser.email]
      );
      if (rows[0]) dbUser = rows[0];
    } catch (dbErr) {
      // Log but don't fail auth — table may be mid-migration
      console.warn('[AUTH] app_users query failed, using restricted defaults:', dbErr.message);
    }

    // Attach combined user object
    req.user = {
      ...firebaseUser,
      role: dbUser.role,
      assignments: dbUser.assigned_contracts || []
    };

    next();
  } catch (err) {
    console.error('[AUTH MIDDLEWARE ERROR]', err);
    return res.status(401).json({ 
      error: 'Error de autenticación' 
    });
  }
}
