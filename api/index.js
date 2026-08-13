import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import * as turf from '@turf/turf';
import https from 'https';

// Production & Supabase Libraries
import pool, { initDb, saveTokens } from './lib/db.js';
import { getAuthUrl, getTokensFromCode, setClientTokens } from './lib/auth.js';
import { uploadFile, getOrCreateFolder } from './lib/drive.js';
import { appendReportToSheet, updateReportInSheet } from './lib/sheets.js';
import { supabase, initSupabaseTables, requireSupabaseAuth } from './lib/supabaseClient.js';

const app = express();
const upload = multer({ dest: '/tmp/' });

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

function cleanupTempFile(file) {
  if (file?.path) {
    try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
  }
}

// --- INITIALIZE TABLES & CACHE ---
app.use(async (req, res, next) => {
  try {
    await initDb();
    await initSupabaseTables();
    next();
  } catch (err) {
    console.error('[CRITICAL INIT ERROR]', err);
    next();
  }
});

// Cache for reports reads
let reportsCache = [];
let lastCacheTime = 0;
const CACHE_TTL = 10000; // 10s

// Deduplication map for offline retries
const recentOfflineIds = new Map();

// --- GEOGRAPHIC DATA CACHE ---
let utbDataCache = null;
let delegationsDataCache = null;
const GEOJSON_FILE = path.join(process.cwd(), 'UTB REAL.geojson');

function loadGeoJSON() {
  if (!utbDataCache) {
    if (fs.existsSync(GEOJSON_FILE)) {
      const content = fs.readFileSync(GEOJSON_FILE, 'utf8');
      const data = JSON.parse(content);
      data.features = data.features.map(f => ({
        ...f,
        properties: {
          ...f.properties,
          NOMDEL: f.properties.NOMDEL?.toUpperCase(),
          NOMUT: f.properties.NOMUT?.toUpperCase()
        }
      }));
      utbDataCache = data;
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
    await saveTokens(tokens);
    setClientTokens(tokens);
    res.send('<h1>Login Exitoso en la Nube</h1><p>Ya puedes cerrar esta ventana y volver a usar la app.</p>');
  } catch (err) {
    res.status(500).send('Falló el login en la nube: ' + err.message);
  }
});

// --- CATALOG DATA ---
app.get('/api/catalogs/contracts', requireSupabaseAuth, (req, res) => {
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

    if (req.user.role !== 'ADMIN') {
      const allowed = req.user.assignments || [];
      if (allowed.length > 0) {
        contracts = contracts.filter(c => allowed.includes(c.id));
      }
    }

    res.json(contracts);
  } catch (err) {
    console.error('[CATALOG ERROR]', err);
    res.status(500).json({ error: 'Error al procesar catálogo' });
  }
});

// --- RADAR API ---
app.post('/api/radar', requireSupabaseAuth, (req, res) => {
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

// --- GEOJSON ENDPOINTS ---
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

// --- REPORTS API ---
app.get('/api/reports', requireSupabaseAuth, async (req, res) => {
  try {
    if (Date.now() - lastCacheTime < CACHE_TTL && reportsCache.length > 0) {
      return res.json(reportsCache);
    }

    // Target bacheo_pruebas_app table in Supabase
    const { data: supaReports, error } = await supabase
      .from('bacheo_pruebas_app')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(supaReports)) {
      reportsCache = supaReports;
      lastCacheTime = Date.now();
      return res.json(supaReports);
    }

    // Fallback to local Postgres pool if Supabase table is empty
    const { rows } = await pool.query('SELECT * FROM reports ORDER BY created_at DESC');
    reportsCache = rows;
    lastCacheTime = Date.now();
    res.json(rows);
  } catch (err) {
    console.error('[REPORTS GET ERROR]', err);
    res.json(reportsCache);
  }
});

app.get('/api/profile', requireSupabaseAuth, async (req, res) => {
  res.json({
    email: req.user.email,
    role: req.user.role,
    assignments: req.user.assignments || []
  });
});

/**
 * POST /api/reports (Apertura Inicial)
 * Pipeline:
 * 1. Multer temp file read into memory buffer
 * 2. Upload to Google Drive (folder per contract/folio)
 * 3. Append row to Google Sheets (Hoja Master A-T)
 * 4. Upsert/Insert record into bacheo_pruebas_app in Supabase (192.168.1.128:8000)
 */
app.post('/api/reports', requireSupabaseAuth, upload.single('photo'), async (req, res) => {
  try {
    const { 
      folio: manualFolio, offlineId: reqOfflineId, contractId, empresaName, lat, lng, 
      locationDesc, delegacion, colonia, tipoBache, 
      calle1, calle2
    } = req.body;

    const dedupeKey = reqOfflineId || (manualFolio && manualFolio.startsWith('OFFLINE-') ? manualFolio : null);
    if (dedupeKey && recentOfflineIds.has(dedupeKey)) {
      const assignedFolio = recentOfflineIds.get(dedupeKey);
      console.log(`[DEDUPE] Omitiendo envio duplicado para ${dedupeKey} -> ${assignedFolio}`);
      cleanupTempFile(req.file);
      return res.json({ ok: true, folio: assignedFolio, duplicate: true });
    }

    // Validate inputs
    if (!contractId || !empresaName) {
      cleanupTempFile(req.file);
      return res.status(400).json({ error: 'contractId y empresaName son requeridos' });
    }

    let folio = manualFolio;
    if (folio && folio !== 'undefined') {
      folio = sanitizeString(folio, 10);
    } else {
      const contractNum = (contractId.match(/\d+/)?.[0] || '0').slice(-2).padStart(2, '0');
      const randomSeq = Math.floor(1000 + Math.random() * 9000);
      folio = `${contractNum}${randomSeq}`;
    }

    if (dedupeKey) {
      recentOfflineIds.set(dedupeKey, folio);
    }

    const safeLocationDesc = sanitizeString(locationDesc);
    const safeDelegacion = sanitizeString(delegacion, 100);
    const safeColonia = sanitizeString(colonia, 100);
    const safeTipoBache = sanitizeString(tipoBache, 50);
    const safeCalle1 = sanitizeString(calle1, 200);
    const safeCalle2 = sanitizeString(calle2, 200);
    const safeEmpresaName = sanitizeString(empresaName, 200);
    const safeContractId = sanitizeString(contractId, 50);
    const safeUserEmail = req.user.email || 'admin@bacheo.gob.mx';

    let photoBuffer = null;
    if (req.file) {
      try {
        photoBuffer = fs.readFileSync(req.file.path);
      } catch (readErr) {
        console.error('[PHOTO READ ERROR]', readErr.message);
      }
    }

    let driveLink = '';

    // =========================================================================
    // PASO 1 (PRIMORDIAL - EVIDENCIA FÍSICA): Upload to Google Drive
    // =========================================================================
    if (photoBuffer) {
      try {
        const rootFolder = process.env.DRIVE_PARENT_FOLDER_ID;
        const contractNumForFolder = (safeContractId.match(/\d+/)?.[0] || '0').padStart(3, '0');
        const contractFolderName = `${contractNumForFolder} ${safeEmpresaName}`;
        
        let folioFolderId = null;
        if (rootFolder) {
          const contractFolderId = await getOrCreateFolder(contractFolderName, rootFolder);
          folioFolderId = await getOrCreateFolder(folio, contractFolderId);
        }

        const photoName = `${folio}_inicial.jpg`;
        const driveData = await uploadFile(photoName, 'image/jpeg', photoBuffer, folioFolderId || rootFolder);
        driveLink = driveData.webViewLink;
        console.log(`[DRIVE SUCCESS] ✅ Foto subida a Drive para folio ${folio}: ${driveLink}`);
      } catch (driveErr) {
        console.error(`[DRIVE ERROR] Falló subida a Drive para folio ${folio}:`, driveErr.message);
      }
    }

    cleanupTempFile(req.file);

    const reportObj = {
      folio,
      contractId: safeContractId,
      empresaName: safeEmpresaName,
      lat: parseFloat(lat) || 0,
      lng: parseFloat(lng) || 0,
      locationDesc: safeLocationDesc,
      delegacion: safeDelegacion,
      colonia: safeColonia,
      tipoBache: safeTipoBache,
      calle_1: safeCalle1,
      calle_2: safeCalle2,
      largo: 0,
      ancho: 0,
      profundidad: 0,
      m2: 0,
      status: 'DETECTADO',
      photoUrl: driveLink,
      photoCaja: '',
      photoFinal: '',
      created_by: safeUserEmail,
      updated_by: safeUserEmail,
      created_at: new Date().toISOString()
    };

    // =========================================================================
    // PASO 2 (PRIMORDIAL - REGISTRO TABULAR): Google Sheets Master Append
    // =========================================================================
    if (process.env.SHEET_ID) {
      try {
        await appendReportToSheet(process.env.SHEET_ID, reportObj);
        console.log(`[SHEETS SUCCESS] ✅ Folio ${folio} registrado en Google Sheets.`);
      } catch (sheetsErr) {
        console.error(`[SHEETS ERROR] Falló appendReportToSheet para folio ${folio}:`, sheetsErr.message);
      }
    }

    // =========================================================================
    // PASO 3 (PERSISTENCIA SUPABASE - bacheo_pruebas_app):
    // La tabla sagrada public.bacheo NUNCA SE TOCA.
    // =========================================================================
    try {
      const { error: supaErr } = await supabase
        .from('bacheo_pruebas_app')
        .upsert([reportObj], { onConflict: 'folio' });

      if (supaErr) {
        console.warn(`[SUPABASE UPSERT WARN] bacheo_pruebas_app:`, supaErr.message);
      } else {
        console.log(`[SUPABASE SUCCESS] ✅ Folio ${folio} resguardado en bacheo_pruebas_app (192.168.1.128:8000)`);
      }
    } catch (supaEx) {
      console.warn('[SUPABASE EXCEPTION]', supaEx.message);
    }

    // Non-blocking local Postgres backup attempt
    try {
      await pool.query(
        `INSERT INTO reports (folio, contractId, empresaName, lat, lng, locationDesc, delegacion, colonia, tipoBache, calle_1, calle_2, photoUrl, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'DETECTADO', $13)
         ON CONFLICT (folio) DO UPDATE SET photoUrl = EXCLUDED.photoUrl`,
        [folio, safeContractId, safeEmpresaName, lat, lng, safeLocationDesc, safeDelegacion, safeColonia, safeTipoBache, safeCalle1, safeCalle2, driveLink, safeUserEmail]
      );
    } catch (dbErr) {
      // Ignore DB pool errors
    }

    // Invalidate local read cache
    reportsCache.unshift(reportObj);

    res.status(201).json({
      folio: reportObj.folio,
      status: reportObj.status,
      success: true
    });

  } catch (err) {
    console.error('[REPORTS POST ERROR]', err);
    cleanupTempFile(req.file);
    res.status(500).json({ error: 'Fallo al procesar reporte: ' + err.message });
  }
});

/**
 * POST /api/reports/:folio/photo (Actualización de Foto Caja / Final)
 */
app.post('/api/reports/:folio/photo', requireSupabaseAuth, upload.single('photo'), async (req, res) => {
  const { folio } = req.params;
  const { phase, largo, ancho, profundidad, m2, tipoBache } = req.body;

  if (!phase) {
    cleanupTempFile(req.file);
    return res.status(400).json({ error: 'Falta especificar la fase del reporte (caja/terminado)' });
  }

  try {
    const nextStatus = phase === 'caja' ? 'EN PROCESO' : 'TERMINADO';
    const colName = phase === 'caja' ? 'photoCaja' : 'photoFinal';

    let photoBuffer = null;
    if (req.file) {
      try {
        photoBuffer = await sharp(req.file.path)
          .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 60 })
          .toBuffer();
      } catch (e) {
        photoBuffer = fs.readFileSync(req.file.path);
      }
    }

    let driveLink = '';

    // 1. Google Drive Upload
    if (photoBuffer) {
      try {
        const rootFolder = process.env.DRIVE_PARENT_FOLDER_ID;
        let folioFolderId = null;
        if (rootFolder) {
          folioFolderId = await getOrCreateFolder(folio, rootFolder);
        }

        const photoName = `${folio}_${phase}.jpg`;
        const driveData = await uploadFile(photoName, 'image/jpeg', photoBuffer, folioFolderId || rootFolder);
        driveLink = driveData.webViewLink;
        console.log(`[DRIVE UPDATE] ✅ Foto ${phase} subida a Drive para ${folio}: ${driveLink}`);
      } catch (driveErr) {
        console.error(`[DRIVE UPDATE ERROR] Folio ${folio}:`, driveErr.message);
      }
    }

    cleanupTempFile(req.file);

    const safeUserEmail = req.user.email || 'admin@bacheo.gob.mx';
    const updates = {
      status: nextStatus,
      updated_by: safeUserEmail
    };

    if (driveLink) {
      if (phase === 'caja') updates.photoCaja = driveLink;
      else updates.photoFinal = driveLink;
    }

    if (phase === 'caja') {
      if (largo) updates.largo = parseFloat(largo) || 0;
      if (ancho) updates.ancho = parseFloat(ancho) || 0;
      if (profundidad) updates.profundidad = parseFloat(profundidad) || 0;
      if (m2) updates.m2 = parseFloat(m2) || 0;
      if (tipoBache) updates.tipoBache = sanitizeString(tipoBache, 50);
    }

    // 2. Google Sheets Update
    if (process.env.SHEET_ID) {
      try {
        await updateReportInSheet(process.env.SHEET_ID, folio, {
          ...updates,
          usuario: safeUserEmail,
          photocaja: updates.photoCaja,
          photofinal: updates.photoFinal
        });
        console.log(`[SHEETS UPDATE] ✅ Folio ${folio} (${phase}) actualizado en Google Sheets.`);
      } catch (sheetsErr) {
        console.error(`[SHEETS UPDATE ERROR] Folio ${folio}:`, sheetsErr.message);
      }
    }

    // 3. Supabase Update in bacheo_pruebas_app
    try {
      const { error: supaErr } = await supabase
        .from('bacheo_pruebas_app')
        .update(updates)
        .eq('folio', folio);

      if (supaErr) {
        console.warn(`[SUPABASE UPDATE WARN] bacheo_pruebas_app:`, supaErr.message);
      } else {
        console.log(`[SUPABASE UPDATE SUCCESS] ✅ Folio ${folio} actualizado en bacheo_pruebas_app`);
      }
    } catch (supaEx) {
      console.warn('[SUPABASE UPDATE EXCEPTION]', supaEx.message);
    }

    res.json({ success: true, link: driveLink, status: nextStatus });

  } catch (err) {
    console.error('[PHOTO UPDATE ERROR]', err);
    cleanupTempFile(req.file);
    res.status(500).json({ error: 'Error al actualizar foto: ' + err.message });
  }
});

// Update Status
app.patch('/api/reports/:folio/status', requireSupabaseAuth, async (req, res) => {
  const { folio } = req.params;
  const { status } = req.body;

  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Estatus inválido: "${status}"` });
  }

  try {
    if (process.env.SHEET_ID) {
      await updateReportInSheet(process.env.SHEET_ID, folio, { status, usuario: req.user.email });
    }

    await supabase
      .from('bacheo_pruebas_app')
      .update({ status, updated_by: req.user.email })
      .eq('folio', folio);

    res.json({ folio, status, success: true });
  } catch (err) {
    console.error('[STATUS PATCH ERROR]', err);
    res.status(500).json({ error: 'Fallo al actualizar estatus' });
  }
});

export default app;
