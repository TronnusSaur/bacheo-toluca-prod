import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import * as turf from '@turf/turf';

// Production Libraries
import pool, { initDb, saveTokens } from './lib/db.js';
import { getAuthUrl, getTokensFromCode, setClientTokens } from './lib/auth.js';
import { uploadFile, getOrCreateFolder } from './lib/drive.js';
import { appendReportToSheet, updateReportInSheet } from './lib/sheets.js';
import { requireAuth, verifyFirebaseToken } from './lib/firebaseAdmin.js';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const app = express();
const upload = multer({ dest: '/tmp/' }); // Vercel has /tmp/ writable

app.use(cors());
app.use(express.json());

// --- VALIDATION HELPERS ---
const VALID_STATUSES = ['DETECTADO', 'EN PROCESO', 'TERMINADO'];
const FOLIO_REGEX = /^\d{6}$/;
const MAX_STRING_LEN = 500;

function sanitizeString(val, maxLen = MAX_STRING_LEN) {
  if (typeof val !== 'string') return String(val || '');
  return val.trim().slice(0, maxLen);
}

function isValidCoord(val) {
  const n = parseFloat(val);
  return !isNaN(n) && isFinite(n);
}

/** Safely remove multer temp file */
function cleanupTempFile(file) {
  if (file?.path) {
    try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
  }
}

// --- INICIALIZACIÓN DB (Middleware para asegurar que las tablas existan) ---
app.use(async (req, res, next) => {
  try {
    await initDb();
    next();
  } catch (err) {
    console.error('[CRITICAL DB ERROR]', err);
    res.status(500).json({ error: 'Fallo al inicializar base de datos' });
  }
});

// --- CACHE PARA DATOS GEOGRÁFICOS ---
let utbDataCache = null;
let delegationsDataCache = null;
const GEOJSON_FILE = path.join(process.cwd(), 'UTB REAL.geojson');

function loadGeoJSON() {
  if (!utbDataCache) {
    if (fs.existsSync(GEOJSON_FILE)) {
      const content = fs.readFileSync(GEOJSON_FILE, 'utf8');
      const data = JSON.parse(content);
      
      // NORMALIZE TO UPPERCASE
      data.features = data.features.map(f => ({
        ...f,
        properties: {
          ...f.properties,
          NOMDEL: f.properties.NOMDEL?.toUpperCase(),
          NOMUT: f.properties.NOMUT?.toUpperCase()
        }
      }));

      utbDataCache = data;
      console.log('[API] UTB REAL.geojson cargado y normalizado.');
    } else {
      console.error('[API ERROR] UTB REAL.geojson no encontrado en:', GEOJSON_FILE);
    }
  }
  return utbDataCache;
}

// --- AUTH ROUTES ---
app.get('/api/auth/login', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const tokens = await getTokensFromCode(code);
    await saveTokens(tokens); // Persistent in Postgres
    setClientTokens(tokens);
    res.send('<h1>Login Exitoso en la Nube</h1><p>Ya puedes cerrar esta ventana y volver a usar la app.</p>');
  } catch (err) {
    res.status(500).send('Falló el login en la nube: ' + err.message);
  }
});

// --- CATALOG DATA (DYNAMIC) ---
app.get('/api/catalogs/contracts', requireAuth, (req, res) => {
  const CONTRACTS_FILE = path.join(process.cwd(), 'CATALOGOS', 'RESUMEN DE CONTRATOS - SUPERVISORES 2026 - Registros Contratos Reales.csv');
  
  if (!fs.existsSync(CONTRACTS_FILE)) {
    return res.status(404).json({ error: 'Catálogo de contratos no encontrado' });
  }

  try {
    const content = fs.readFileSync(CONTRACTS_FILE, 'utf8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    
    let contracts = lines.slice(1).map((line) => {
      const row = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(item => item.trim().replace(/^"|"$/g, ''));
      if (row.length < 10) return null;
      return {
        id_real: row[0],
        id: row[1],
        delegacion: row[2],
        empresa: row[3],
        supervisor: row[9],
        supervisor_tel: row[10],
        residente: row[11],
        residente_tel: row[12],
      };
    }).filter(c => c && c.id && c.id !== '#REF!');

    // RBAC: Filter contracts if not ADMIN
    if (req.user.role !== 'ADMIN') {
      const allowed = req.user.assignments || [];
      contracts = contracts.filter(c => allowed.includes(c.id));
    }

    res.json(contracts);
  } catch (err) {
    console.error('[CATALOG ERROR]', err);
    res.status(500).json({ error: 'Error al procesar catálogo' });
  }
});

// --- RADAR API ---
app.post('/api/radar', requireAuth, (req, res) => {
  const { lat, lng } = req.body;
  const data = loadGeoJSON();
  if (!data) return res.status(500).json({ error: 'Datos geográficos no disponibles en el servidor' });

  try {
    const point = turf.point([lng, lat]);
    let foundZone = null;

    for (const feature of data.features) {
      if (turf.booleanPointInPolygon(point, feature)) {
        foundZone = {
          name: feature.properties.NOMUT || feature.properties.NOMDEL,
          type: feature.properties.NOMUT ? 'COLONIA' : 'DELEGACION',
          delegacion: feature.properties.NOMDEL
        };
        break;
      }
    }

    if (foundZone) {
      res.json(foundZone);
    } else {
      res.status(404).json({ error: 'Ubicación fuera de la zona de cobertura de Toluca' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Error en procesamiento radar: ' + err.message });
  }
});

// --- GEOJSON ENDPOINTS (MAP) ---
app.get('/api/geojson', (req, res) => {
  const data = loadGeoJSON();
  if (data) res.json(data);
  else res.status(500).json({ error: 'GeoJSON no disponible' });
});

app.get('/api/geojson/delegations', (req, res) => {
  if (delegationsDataCache) return res.json(delegationsDataCache);
  
  const data = loadGeoJSON();
  if (!data) return res.status(500).json({ error: 'GeoJSON no disponible' });

  try {
    delegationsDataCache = turf.dissolve(data, { propertyName: 'NOMDEL' });
    res.json(delegationsDataCache);
  } catch (err) {
    res.status(500).json({ error: 'Error al disolver delegaciones' });
  }
});

// --- REPORTS API (PROTECTED) ---
app.get('/api/reports', requireAuth, async (req, res) => {
  try {
    let query = 'SELECT * FROM reports';
    let params = [];

    // RBAC: Filter by contract assignment if not ADMIN
    if (req.user.role !== 'ADMIN') {
      const allowed = req.user.assignments || [];
      if (allowed.length === 0) return res.json([]); // No assignments = no data
      query += ' WHERE contractId = ANY($1)';
      params.push(allowed);
    }

    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[REPORTS GET ERROR]', err);
    res.status(500).json({ error: 'Error al leer baches' });
  }
});

app.post('/api/reports', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { 
      folio: manualFolio, contractId, empresaName, lat, lng, 
      locationDesc, delegacion, colonia, tipoBache, 
      calle1, calle2 
    } = req.body;

    // --- RBAC VALIDATION ---
    if (req.user.role !== 'ADMIN') {
      const allowed = req.user.assignments || [];
      if (!allowed.includes(contractId)) {
        cleanupTempFile(req.file);
        return res.status(403).json({ error: 'No tienes permiso para reportar en este contrato' });
      }
    }

    // --- INPUT VALIDATION ---
    if (!contractId || !empresaName) {
      cleanupTempFile(req.file);
      return res.status(400).json({ error: 'contractId y empresaName son requeridos' });
    }
    if (lat && !isValidCoord(lat)) {
      cleanupTempFile(req.file);
      return res.status(400).json({ error: 'Latitud inválida' });
    }
    if (lng && !isValidCoord(lng)) {
      cleanupTempFile(req.file);
      return res.status(400).json({ error: 'Longitud inválida' });
    }

    let folio = manualFolio;
    
    // --- FOLIO VALIDATION ---
    if (folio && folio !== 'undefined') {
      folio = sanitizeString(folio, 10);
      if (!FOLIO_REGEX.test(folio)) {
        cleanupTempFile(req.file);
        return res.status(400).json({ error: `Folio inválido: "${folio}". Debe ser exactamente 6 dígitos (ej: 470001)` });
      }
    }
    
    // --- FOLIO GENERATION (CCFFFF) ---
    if (!folio || folio === 'undefined') {
      const contractNum = (contractId.match(/\d+/)?.[0] || '0').slice(-2).padStart(2, '0');
      const prefix = contractNum;
      
      const { rows } = await pool.query(
        "SELECT MAX(folio) as last_folio FROM reports WHERE folio LIKE $1",
        [`${prefix}%`]
      );
      
      let nextNum = 1;
      if (rows[0]?.last_folio) {
        const lastNum = parseInt(rows[0].last_folio.slice(prefix.length)) || 0;
        nextNum = lastNum + 1;
      }
      folio = `${prefix}${nextNum.toString().padStart(4, '0')}`;
    }

    // Check for duplicate folio before insert
    const existing = await pool.query('SELECT folio FROM reports WHERE folio = $1', [folio]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: `El folio ${folio} ya existe en la base de datos. Usa un número diferente.` });
    }

    // Sanitize string fields
    const safeLocationDesc = sanitizeString(locationDesc);
    const safeDelegacion = sanitizeString(delegacion, 100);
    const safeColonia = sanitizeString(colonia, 100);
    const safeTipoBache = sanitizeString(tipoBache, 50);
    const safeCalle1 = sanitizeString(calle1, 200);
    const safeCalle2 = sanitizeString(calle2, 200);
    const safeEmpresaName = sanitizeString(empresaName, 200);
    const safeContractId = sanitizeString(contractId, 50);

    // 1. Initial Insert into Postgres
    const result = await pool.query(
      `INSERT INTO reports (folio, contractId, empresaName, lat, lng, locationDesc, delegacion, colonia, tipoBache, calle_1, calle_2, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DETECTADO', $12) RETURNING *`,
      [folio, safeContractId, safeEmpresaName, lat, lng, safeLocationDesc, safeDelegacion, safeColonia, safeTipoBache, safeCalle1, safeCalle2, req.user.email]
    );

    const newReport = result.rows[0];
    let driveLink = null;
    let driveOk = false;
    let sheetsOk = false;
    let driveError = null;
    let sheetsError = null;

    // 2. Drive Photo Upload
    if (req.file) {
      try {
        const compressedBuffer = await sharp(req.file.path)
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 60 })
          .toBuffer();

        const rootFolder = process.env.DRIVE_PARENT_FOLDER_ID;
        const contractNumForFolder = (contractId.match(/\d+/)?.[0] || '0').padStart(3, '0');
        const contractFolderName = `${contractNumForFolder} ${empresaName}`;
        
        const contractFolderId = await getOrCreateFolder(contractFolderName, rootFolder);
        const folioFolderId = await getOrCreateFolder(folio, contractFolderId);
        
        const photoName = `${folio}_inicial.jpg`;
        const driveData = await uploadFile(photoName, 'image/jpeg', compressedBuffer, folioFolderId);
        
        driveLink = driveData.webViewLink;
        driveOk = true;
        
        // Update DB with photo URL
        await pool.query('UPDATE reports SET photoUrl = $1 WHERE id = $2', [driveLink, newReport.id]);
        newReport.photourl = driveLink;
        newReport.photoUrl = driveLink;
      } catch (err) {
        driveError = err.message;
        console.error('[DRIVE ERROR]', err.message);
      }
    } else {
      driveOk = true; // No photo to upload, not an error
    }

    // 3. Sheets Sync
    if (process.env.SHEET_ID) {
      try {
        await appendReportToSheet(process.env.SHEET_ID, newReport);
        sheetsOk = true;
      } catch (err) {
        sheetsError = err.message;
        console.error('[SHEETS ERROR]', err.message);
      }
    }

    res.status(201).json({ 
      ...newReport, 
      driveLink,
      sync: {
        postgres: true,
        drive: driveOk,
        sheets: sheetsOk,
        driveError,
        sheetsError
      }
    });
  } catch (err) {
    console.error('[REPORTS POST ERROR]', err);
    res.status(500).json({ error: 'Fallo al procesar bache', detail: err.message });
  } finally {
    cleanupTempFile(req.file);
  }
});

// Photo Update (Caja/Final)
app.post('/api/reports/:folio/photo', requireAuth, upload.single('photo'), async (req, res) => {
  const { folio } = req.params;
  const { phase } = req.body; // 'caja' o 'terminado'

  if (!phase) {
    console.error(`[PHOTO ERROR] Folio ${folio} intentó subir foto sin phase.`);
    return res.status(400).json({ error: 'Falta especificar la fase (phase) del reporte (caja/terminado)' });
  }

  try {
    const reportRes = await pool.query('SELECT * FROM reports WHERE folio = $1', [folio]);
    if (reportRes.rowCount === 0) return res.status(404).json({ error: 'Reporte no encontrado' });
    const report = reportRes.rows[0];

    // RBAC: Verify ownership
    if (req.user.role !== 'ADMIN') {
      const allowed = req.user.assignments || [];
      const reportCid = report.contractid || report.contractId;
      if (!allowed.includes(reportCid)) {
        cleanupTempFile(req.file);
        return res.status(403).json({ error: 'No tienes permiso para actualizar este reporte' });
      }
    }

    // PHASE VALIDATION (ROBUSTNESS)
    // If we receive 'caja' but it's already 'EN PROCESO' or 'TERMINADO', it's likely a late retry or error.
    const currentStatus = report.status;
    if (phase === 'caja' && currentStatus !== 'DETECTADO') {
       return res.status(409).json({ error: `Conflicto de fase: el reporte ya está en estatus ${currentStatus}` });
    }
    if (phase === 'terminado' && currentStatus !== 'EN PROCESO') {
       // Allow re-uploading 'terminado' if it's already 'TERMINADO' (retry case) but not if it's 'DETECTADO'
       if (currentStatus === 'DETECTADO') {
          return res.status(400).json({ error: 'No se puede subir foto FINAL si aún no ha pasado por CAJA' });
       }
    }

    if (req.file) {
      // Use efficient compression on server (800px is enough for records)
      const compressedBuffer = await sharp(req.file.path)
        .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();
      const rootFolder = process.env.DRIVE_PARENT_FOLDER_ID;
      
      const cid = report.contractid || report.contractId || '0';
      const ename = report.empresaname || report.empresaName || 'Empresa';
      
      const contractNum = (cid.match(/\d+/)?.[0] || '0').padStart(3, '0');
      const contractFolderName = `${contractNum} ${ename}`;
      
      const contractFolderId = await getOrCreateFolder(contractFolderName, rootFolder);
      const folioFolderId = await getOrCreateFolder(folio, contractFolderId);
      
      const photoName = `${folio}_${phase}.jpg`;
      const driveData = await uploadFile(photoName, 'image/jpeg', compressedBuffer, folioFolderId);
      const driveLink = driveData.webViewLink;

      // Update DB and Sheets
      const colName = phase === 'caja' ? 'photoCaja' : 'photoFinal';
      const nextStatus = phase === 'caja' ? 'EN PROCESO' : 'TERMINADO';

      if (phase === 'caja') {
        const { largo, ancho, profundidad, m2, tipoBache } = req.body;
        await pool.query(
          `UPDATE reports SET ${colName} = $1, status = $2, largo = $3, ancho = $4, profundidad = $5, m2 = $6, tipobache = $7, updated_by = $8 WHERE folio = $9`, 
          [driveLink, nextStatus, largo, ancho, profundidad, m2, tipoBache, req.user.email, folio]
        );
        
        await updateReportInSheet(process.env.SHEET_ID, folio, { 
          photocaja: driveLink, 
          status: nextStatus,
          largo, ancho, profundidad, m2,
          tipobache: tipoBache,
          usuario: req.user.email // Record responsible user in Sheets
        });
      } else {
        await pool.query(
          `UPDATE reports SET ${colName} = $1, status = $2, updated_by = $3 WHERE folio = $4`, 
          [driveLink, nextStatus, req.user.email, folio]
        );
        
        await updateReportInSheet(process.env.SHEET_ID, folio, { 
          photofinal: driveLink, 
          status: nextStatus,
          usuario: req.user.email
        });
      }

      res.json({ success: true, link: driveLink, status: nextStatus });
    } else {
      res.status(400).json({ error: 'No se recibió ninguna foto' });
    }
  } catch (err) {
    console.error('[PHOTO UPDATE ERROR]', err);
    res.status(500).json({ error: 'Error al subir foto secundaria: ' + err.message });
  } finally {
    cleanupTempFile(req.file);
  }
});

// Update Status
app.patch('/api/reports/:folio/status', requireAuth, async (req, res) => {
  const { folio } = req.params;
  const { status } = req.body;

  // C-6: Validate status against whitelist
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ 
      error: `Estatus inválido: "${status}". Valores permitidos: ${VALID_STATUSES.join(', ')}` 
    });
  }

  try {
    const reportRes = await pool.query('SELECT contractId FROM reports WHERE folio = $1', [folio]);
    if (reportRes.rowCount === 0) return res.status(404).json({ error: 'Reporte no encontrado' });

    // RBAC: Verify ownership
    if (req.user.role !== 'ADMIN') {
      const allowed = req.user.assignments || [];
      const reportCid = reportRes.rows[0].contractid || reportRes.rows[0].contractId;
      if (!allowed.includes(reportCid)) {
        return res.status(403).json({ error: 'No tienes permiso para actualizar este reporte' });
      }
    }

    await pool.query('UPDATE reports SET status = $1, updated_by = $2 WHERE folio = $3', [status, req.user.email, folio]);
    if (process.env.SHEET_ID) {
      await updateReportInSheet(process.env.SHEET_ID, folio, { status, usuario: req.user.email });
    }
    
    // Return the updated report
    const { rows } = await pool.query('SELECT * FROM reports WHERE folio = $1', [folio]);
    if (rows.length === 0) {
      return res.status(404).json({ error: `Folio ${folio} no encontrado` });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[STATUS PATCH ERROR]', err);
    res.status(500).json({ error: 'Fallo al actualizar estatus' });
  }
});


// TEMP: One-time fix for collision residents
app.get('/api/maintenance/provision-missing', async (req, res) => {
  if ((req.query.secret || req.headers['x-maintenance-secret']) !== 'BACHEO2026') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const missingResidents = [
    { fullName: 'JOSE MANUEL GONZALEZ GOMEZ',     email: 'manuel-bacheo@gob.mx',    contracts: ['Contrato 012'], password: 'CONTRATO012' },
    { fullName: 'JORGE DE LA VEGA GONZALEZ',       email: 'jorge2-bacheo@gob.mx',    contracts: ['Contrato 021'], password: 'CONTRATO021' },
    { fullName: 'LUIS DANIEL FLORES LOPEZ',        email: 'daniel-bacheo@gob.mx',    contracts: ['Contrato 022'], password: 'CONTRATO022' },
    { fullName: 'LUIS EDUARDO URIBE VALLE',        email: 'eduardo2-bacheo@gob.mx',  contracts: ['Contrato 026'], password: 'CONTRATO026' },
    { fullName: 'SERGIO VELAZQUEZ RENDON',         email: 'velazquez-bacheo@gob.mx', contracts: ['Contrato 030'], password: 'CONTRATO030' },
    { fullName: 'SERGIO FRANCISCO BERNAL ESPINOSA',email: 'francisco-bacheo@gob.mx', contracts: ['Contrato 032'], password: 'CONTRATO032' },
    { fullName: 'ALAN TELLEZ GONZALEZ',            email: 'alan2-bacheo@gob.mx',     contracts: ['Contrato 039'], password: 'CONTRATO039' },
    { fullName: 'ALEXIS OLIVER JUAREZ LOPEZ',      email: 'oliver-bacheo@gob.mx',    contracts: ['Contrato 044'], password: 'CONTRATO044' },
    { fullName: 'ALEXIS GONZALES FLORES',          email: 'alexis2-bacheo@gob.mx',   contracts: ['Contrato 045'], password: 'CONTRATO045' },
    { fullName: 'LUIS FERNANDO AMARO MIRELES',     email: 'fernando-bacheo@gob.mx',  contracts: ['Contrato 046'], password: 'CONTRATO046' },
  ];

  const results = { created: [], updated: [], errors: [] };
  try {
    await initDb();
    const credsJson = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_CREDENTIALS;
    const creds = JSON.parse(credsJson);
    const adminApp = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(creds) }, 'provision-missing');
    const adminAuth = getAdminAuth(adminApp);

    for (const user of missingResidents) {
      try {
        let fbUser;
        try {
          fbUser = await adminAuth.getUserByEmail(user.email);
          await adminAuth.updateUser(fbUser.uid, { password: user.password, displayName: user.fullName });
          results.updated.push(user.email);
        } catch (e) {
          if (e.code === 'auth/user-not-found') {
            await adminAuth.createUser({ email: user.email, password: user.password, displayName: user.fullName });
            results.created.push(user.email);
          } else throw e;
        }
        await pool.query(
          `INSERT INTO app_users (email, role, assigned_contracts)
           VALUES ($1, 'RESIDENTE', $2)
           ON CONFLICT (email) DO UPDATE SET role='RESIDENTE', assigned_contracts=EXCLUDED.assigned_contracts`,
          [user.email, user.contracts]
        );
      } catch (err) {
        results.errors.push({ email: user.email, error: err.message });
      }
    }
    res.json({ success: true, summary: `Creados: ${results.created.length}, Actualizados: ${results.updated.length}, Errores: ${results.errors.length}`, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export as Vercel Function
export default app;
