/**
 * provision-users.js
 * Script para crear usuarios de prueba en Firebase Auth y registrarlos en Postgres.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import pool from './api/lib/db.js';
import fs from 'fs';
import path from 'path';

// --- CONFIGURACIÓN FIREBASE ADMIN ---
const credsJson = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_CREDENTIALS;
if (!credsJson) {
  console.error('Falta FIREBASE_SERVICE_ACCOUNT o GOOGLE_CREDENTIALS');
  process.exit(1);
}

const adminApp = initializeApp({
  credential: cert(JSON.parse(credsJson)),
});
const auth = getAuth(adminApp);

// --- UTILIDADES ---
function normalizeName(name) {
  return name.split(' ')[0]
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

// --- PROCESAMIENTO CSV ---
const CSV_PATH = path.join(process.cwd(), 'CATALOGOS', 'RESUMEN DE CONTRATOS - SUPERVISORES 2026 - Registros Contratos Reales.csv');
const content = fs.readFileSync(CSV_PATH, 'utf8');
const lines = content.split('\n').filter(l => l.trim() !== '');

const supervisorsMap = new Map(); // name -> { email, contracts, password }
const residentsList = []; // Array of { name, email, contract, password }

lines.slice(1).forEach((line, index) => {
  const row = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(item => item.trim().replace(/^"|"$/g, ''));
  if (row.length < 13) return;

  const contractId = row[1];
  const supervisorName = row[9];
  const residentName = row[11];

  // Logic for Supervisors
  const sKey = normalizeName(supervisorName);
  if (!supervisorsMap.has(sKey)) {
    supervisorsMap.set(sKey, {
      fullName: supervisorName,
      email: `${sKey}-bacheo@gob.mx`,
      role: 'SUPERVISOR',
      contracts: [contractId],
      password: 'BacheoDGOP'
    });
  } else {
    supervisorsMap.get(sKey).contracts.push(contractId);
  }

  // Logic for Residents (First 3)
  if (residentsList.length < 3) {
    const rKey = normalizeName(residentName);
    // Avoid duplicates in the 3 residents if they appear in multiple rows (unlikely but safe)
    if (!residentsList.find(r => r.email.startsWith(rKey))) {
      residentsList.push({
        fullName: residentName,
        email: `${rKey}-bacheo@gob.mx`,
        role: 'RESIDENTE',
        contracts: [contractId],
        password: `CONTRATO${contractId.match(/\d+/)?.[0] || '000'}`
      });
    }
  }
});

async function provision() {
  const allUsers = [...supervisorsMap.values(), ...residentsList];
  
  console.log(`\n🚀 Iniciando aprovisionamiento de ${allUsers.length} usuarios...\n`);

  for (const user of allUsers) {
    try {
      // 1. Crear/Actualizar en Firebase Auth
      let firebaseUser;
      try {
        firebaseUser = await auth.getUserByEmail(user.email);
        await auth.updateUser(firebaseUser.uid, { password: user.password });
        console.log(`[FIREBASE] Actualizado: ${user.email}`);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          firebaseUser = await auth.createUser({
            email: user.email,
            password: user.password,
            displayName: user.fullName
          });
          console.log(`[FIREBASE] Creado: ${user.email}`);
        } else {
          throw e;
        }
      }

      // 2. Registrar en Postgres
      await pool.query(
        `INSERT INTO app_users (email, role, assigned_contracts) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, assigned_contracts = EXCLUDED.assigned_contracts`,
        [user.email, user.role, user.contracts]
      );
      console.log(`[POSTGRES] Sincronizado: ${user.email} (${user.role}) -> [${user.contracts.join(', ')}]`);
      
    } catch (err) {
      console.error(`[ERROR] Falló usuario ${user.email}:`, err.message);
    }
  }

  console.log('\n✅ Proceso finalizado.');
  process.exit(0);
}

provision();
