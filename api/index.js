import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import * as turf from '@turf/turf';

// Production & Supabase Libraries
import pool, { initDb, saveTokens } from './lib/db.js';
import { getAuthUrl, getTokensFromCode, setClientTokens } from './lib/auth.js';
import { uploadFile, getOrCreateFolder } from './lib/drive.js';
import { appendReportToSheet, updateReportInSheet, getAllReportsFromSheet, ensureSheetHeaders } from './lib/sheets.js';
import { supabase, initSupabaseTables, requireSupabaseAuth } from './lib/supabaseClient.js';

const app = express();
const upload = multer({ dest: '/tmp/' });

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.options('*', cors());
app.use(express.json());

// --- VALIDATION HELPERS ---
const VALID_STATUSES = ['DETECTADO', 'EN PROCESO', 'TERMINADO'];
const MAX_STRING_LEN = 500;

function sanitizeString(val, maxLen = MAX_STRING_LEN) {
  if (typeof val !== 'string') return String(val || '');
  return val.trim().slice(0, maxLen);
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

// Cache for reports reads (SP REGIS architecture for 0ms Bitácora latency)
let reportsCache = [];
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30s cache TTL

// Warm up cache on server start
async function refreshCacheFromSheets() {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) return;
  try {
    const sheetReports = await getAllReportsFromSheet(sheetId);
    if (sheetReports && sheetReports.length > 0) {
      reportsCache = sheetReports;
      lastCacheTime = Date.now();
      console.log(`[CACHE] Cache de Bitácora actualizado desde Google Sheets (${reportsCache.length} registros).`);
    }
  } catch (err) {
    console.warn('[CACHE WARN] No se pudo refrescar cache desde Sheets:', err.message);
  }
}

// Background initial cache warm-up
refreshCacheFromSheets();

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
    res.send('<h1>Login Exitoso en Google Drive & Sheets</h1><p>Las credenciales de usuario han sido guardadas. Ya puedes volver a la app.</p>');
  } catch (err) {
    res.status(500).send('Falló el login en Google: ' + err.message);
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

// --- REPORTS API (INSTANT 0ms SP REGIS CACHE READ) ---
app.get('/api/reports', requireSupabaseAuth, async (req, res) => {
  try {
    // 1. Instant response from memory cache (0ms latency)
    if (reportsCache.length > 0) {
      res.json(reportsCache);
      // Trigger background refresh if TTL expired
      if (Date.now() - lastCacheTime > CACHE_TTL) {
        refreshCacheFromSheets();
      }
      return;
    }

    // 2. Initial load if cache empty: Read from Sheets directly
    const sheetId = process.env.SHEET_ID;
    if (sheetId) {
      const sheetReports = await getAllReportsFromSheet(sheetId);
      if (sheetReports.length > 0) {
        reportsCache = sheetReports;
        lastCacheTime = Date.now();
        return res.json(sheetReports);
      }
    }

    res.json([]);
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
 * SP REGIS Architecture: Validates, updates cache, returns 201 immediately,
 * and streams Drive Upload + Sheets Append + Supabase sync in parallel.
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

    const safeContractId = sanitizeString(contractId || 'CONTRATO-01', 50);
    const safeEmpresaName = sanitizeString(empresaName || 'Empresa Bacheo', 200);

    let folio = manualFolio;
    if (folio && folio !== 'undefined') {
      folio = sanitizeString(folio, 10);
    } else {
      const contractNum = (safeContractId.match(/\d+/)?.[0] || '0').slice(-2).padStart(2, '0');
      const randomSeq = Math.floor(1000 + Math.random() * 9000);
      folio = `${contractNum}${randomSeq}`;
    }

    if (dedupeKey) {
      recentOfflineIds.set(dedupeKey, folio);
    }

    const safeLocationDesc = sanitizeString(locationDesc);
    const safeDelegacion = sanitizeString(delegacion || 'TOLUCA', 100);
    const safeColonia = sanitizeString(colonia || 'CENTRO', 100);
    const safeTipoBache = sanitizeString(tipoBache || 'SUPERFICIAL', 50);
    const safeCalle1 = sanitizeString(calle1, 200);
    const safeCalle2 = sanitizeString(calle2, 200);
    const safeUserEmail = req.user.email || 'admin@bacheo.gob.mx';

    let photoBuffer = null;
    if (req.file) {
      try {
        photoBuffer = fs.readFileSync(req.file.path);
      } catch (readErr) {
        console.error('[PHOTO READ ERROR]', readErr.message);
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
      photoUrl: '',
      photoCaja: '',
      photoFinal: '',
      created_by: safeUserEmail,
      updated_by: safeUserEmail,
      created_at: new Date().toISOString()
    };

    // 1. INSTANT UI FEEDBACK: Update memory cache immediately
    reportsCache = [reportObj, ...reportsCache.filter(r => r.folio !== folio)];
    lastCacheTime = Date.now();

    // 2. FAST HTTP RESPONSE (Client does not wait for cloud latencies)
    res.status(201).json({
      folio: reportObj.folio,
      status: reportObj.status,
      success: true
    });

    // 3. BACKGROUND ASYNC EXECUTION (Drive + Sheets + Supabase)
    (async () => {
      let driveLink = '';
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
          driveLink = driveData.webViewLink || '';
          reportObj.photoUrl = driveLink;
          console.log(`[DRIVE SUCCESS] ✅ Foto subida a Drive para folio ${folio}: ${driveLink}`);
        } catch (driveErr) {
          console.error(`[DRIVE ERROR] Falló subida a Drive para folio ${folio}:`, driveErr.message);
        }
      }

      // Append to Google Sheets
      if (process.env.SHEET_ID) {
        try {
          await appendReportToSheet(process.env.SHEET_ID, reportObj);
          console.log(`[SHEETS SUCCESS] ✅ Folio ${folio} registrado en Google Sheets.`);
        } catch (sheetsErr) {
          console.error(`[SHEETS ERROR] Falló appendReportToSheet para folio ${folio}:`, sheetsErr.message);
        }
      }

      // Upsert into Supabase bacheo_pruebas_app
      try {
        const { error: supaErr } = await supabase
          .from('bacheo_pruebas_app')
          .upsert([reportObj], { onConflict: 'folio' });

        if (!supaErr) {
          console.log(`[SUPABASE SUCCESS] ✅ Folio ${folio} resguardado en bacheo_pruebas_app (Supabase local).`);
        }
      } catch (supaEx) {
        // ignore
      }
    })();

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
    cleanupTempFile(req.file);

    const safeUserEmail = req.user.email || 'admin@bacheo.gob.mx';
    const updates = {
      status: nextStatus,
      updated_by: safeUserEmail
    };

    if (phase === 'caja') {
      if (largo) updates.largo = parseFloat(largo) || 0;
      if (ancho) updates.ancho = parseFloat(ancho) || 0;
      if (profundidad) updates.profundidad = parseFloat(profundidad) || 0;
      if (m2) updates.m2 = parseFloat(m2) || 0;
      if (tipoBache) updates.tipoBache = sanitizeString(tipoBache, 50);
    }

    // INSTANT UI FEEDBACK: Update cache immediately
    reportsCache = reportsCache.map(r => r.folio === folio ? { ...r, ...updates } : r);
    lastCacheTime = Date.now();

    res.json({ success: true, status: nextStatus });

    // BACKGROUND ASYNC EXECUTION
    (async () => {
      let driveLink = '';
      if (photoBuffer) {
        try {
          const rootFolder = process.env.DRIVE_PARENT_FOLDER_ID;
          let folioFolderId = null;
          if (rootFolder) {
            folioFolderId = await getOrCreateFolder(folio, rootFolder);
          }

          const photoName = `${folio}_${phase}.jpg`;
          const driveData = await uploadFile(photoName, 'image/jpeg', photoBuffer, folioFolderId || rootFolder);
          driveLink = driveData.webViewLink || '';
          if (phase === 'caja') updates.photoCaja = driveLink;
          else updates.photoFinal = driveLink;
        } catch (driveErr) {
          console.error(`[DRIVE UPDATE ERROR] Folio ${folio}:`, driveErr.message);
        }
      }

      if (process.env.SHEET_ID) {
        try {
          await updateReportInSheet(process.env.SHEET_ID, folio, {
            ...updates,
            usuario: safeUserEmail,
            photocaja: updates.photoCaja,
            photofinal: updates.photoFinal
          });
        } catch (sheetsErr) {
          console.error(`[SHEETS UPDATE ERROR] Folio ${folio}:`, sheetsErr.message);
        }
      }

      try {
        await supabase
          .from('bacheo_pruebas_app')
          .update(updates)
          .eq('folio', folio);
      } catch (supaEx) {
        // ignore
      }
    })();

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
    reportsCache = reportsCache.map(r => r.folio === folio ? { ...r, status } : r);
    lastCacheTime = Date.now();

    res.json({ folio, status, success: true });

    (async () => {
      if (process.env.SHEET_ID) {
        await updateReportInSheet(process.env.SHEET_ID, folio, { status, usuario: req.user.email });
      }

      await supabase
        .from('bacheo_pruebas_app')
        .update({ status, updated_by: req.user.email })
        .eq('folio', folio);
    })();

  } catch (err) {
    console.error('[STATUS PATCH ERROR]', err);
    res.status(500).json({ error: 'Fallo al actualizar estatus' });
  }
});

export default app;
