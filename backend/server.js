import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import * as turf from '@turf/turf';

import multer from 'multer';
import sharp from 'sharp';
import { getOrCreateFolder, uploadFile } from './lib/drive.js';
import { appendReportToSheet, updateReportInSheet } from './lib/sheets.js';
import { getAuthUrl, getTokensFromCode, setClientTokens, oauth2Client } from './lib/auth.js';

dotenv.config();

// Load persistent tokens if exist
const TOKENS_FILE = path.join(process.cwd(), 'google_tokens.json');
if (fs.existsSync(TOKENS_FILE)) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  setClientTokens(tokens);
  console.log('[AUTH] Tokens persistentes cargados.');
}

const app = express();
const port = process.env.PORT || 3005;

// Multer setup for temporary file handling
const upload = multer({ dest: 'uploads/' });

app.use(cors({
  origin: '*', // For testing, allow all
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simulation State (In-memory + File)
const REPORTS_FILE = path.join(process.cwd(), 'simulation_reports.json');
const GEOJSON_FILE = path.join(process.cwd(), '..', 'UTB REAL.geojson');

let simulatedReports = [];
if (fs.existsSync(REPORTS_FILE)) {
  simulatedReports = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
}

let territorialData = null;
try {
  territorialData = JSON.parse(fs.readFileSync(GEOJSON_FILE, 'utf8'));
  console.log('[SIMULACIÓN] Datos geográficos cargados:', territorialData.features.length, 'zonas.');
} catch (err) {
  console.error('[CRITICO] No se encontró UTB REAL.geojson para la simulación.');
}

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ACTIVE (SIMULATION MODE)', 
    timestamp: new Date().toISOString(),
    geofencing: territorialData ? 'READY' : 'OFFLINE'
  });
});

// Radar Logic: Find zone by point (SIMULATED with Turf.js)
app.post('/api/radar', (req, res) => {
  const { lat, lng } = req.body;
  if (!territorialData) return res.status(500).json({ error: 'Datos geográficos no cargados' });

  const point = turf.point([lng, lat]);
  let foundZone = null;

  for (const feature of territorialData.features) {
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
    console.log(`[SIMULACIÓN] Radar detectó: ${foundZone.name}`);
    res.json(foundZone);
  } else {
    res.status(404).json({ error: 'Ubicación fuera de la zona de cobertura de Toluca' });
  }
});

// OAuth2 Auth endpoints
app.get('/api/auth/login', (req, res) => {
  const url = getAuthUrl();
  console.log('[AUTH] Redirigiendo a:', url);
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const tokens = await getTokensFromCode(code);
    setClientTokens(tokens);
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    console.log('[AUTH] Login exitoso. Tokens guardados.');
    res.send('<h1>Login Exitoso</h1><p>Ya puedes cerrar esta ventana y volver a usar la app.</p>');
  } catch (err) {
    console.error('[AUTH ERROR] Callback failed:', err.message);
    res.status(500).send('Falló el login: ' + err.message);
  }
});

app.post('/api/reports', upload.single('photo'), async (req, res) => {
  console.log('[PRUEBA] Petición /api/reports recibida.');
  try {
    const { contractId, empresaName, phase, lat, lng, largo, ancho, profundidad, m2, locationDesc, delegacion, colonia, tipoBache } = req.body;
    console.log('[PRUEBA] Datos recibidos:', { contractId, folio: 'calculando...', hasPhoto: !!req.file });
    
    // Logic for Folio CCFFFF (e.g., 470001)
    const contractNumber = (contractId.match(/\d+/) || ['00'])[0].slice(-2).padStart(2, '0');
    const countPerContract = simulatedReports.filter(r => r.contractId === contractId).length + 1;
    const sequence = countPerContract.toString().padStart(4, '0');
    const folio = `${contractNumber}${sequence}`;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const createdAt = new Date().toISOString();

    const newReport = {
      id: simulatedReports.length + 1,
      folio,
      contractId,
      empresaName,
      lat,
      lng,
      largo,
      ancho,
      profundidad,
      m2,
      locationDesc,
      delegacion,
      colonia,
      tipoBache,
      status: 'DETECTADO',
      created_at: createdAt
    };

    // 1. Sync LOCAL JSON
    simulatedReports.push(newReport);
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(simulatedReports, null, 2));
    
    const OUTPUT_DIR = path.join(process.cwd(), 'OUTPUTS SUBIDA DATOS');
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${timestamp}_${folio}.json`), JSON.stringify(newReport, null, 2));

    // 2. Cloud Sync (DECOUPLED)
    let driveLink = null;
    
    // 2a. Drive Sync (Photo)
    if (req.file) {
      try {
        console.log(`[CLOUD] Comprimiendo foto para Folio ${folio}...`);
        const compressedBuffer = await sharp(req.file.path)
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 60 })
          .toBuffer();

        const rootFolder = process.env.DRIVE_PARENT_FOLDER_ID;
        const contractNum = (contractId.match(/\d+/)?.[0] || '0').padStart(3, '0');
        const contractFolderName = `${contractNum} ${empresaName}`;
        
        const contractFolderId = await getOrCreateFolder(contractFolderName, rootFolder);
        const folioFolderId = await getOrCreateFolder(folio, contractFolderId);
        
        const photoName = `${folio}_inicial.jpg`;
        const driveData = await uploadFile(photoName, 'image/jpeg', compressedBuffer, folioFolderId);
        
        driveLink = driveData.webViewLink;
        newReport.photoUrl = driveLink;
        console.log(`[CLOUD] Foto inicial OK: ${driveLink}`);
      } catch (err) {
        console.error('[CLOUD ERROR] Drive failed:', err.message);
      }
    }

    // 2b. Sheets Sync (ALWAYS TRY)
    if (process.env.SHEET_ID) {
      try {
        console.log(`[CLOUD] Sincronizando datos a Sheets para ${folio}...`);
        await appendReportToSheet(process.env.SHEET_ID, newReport);
        console.log(`[CLOUD] Sheets OK para Folio ${folio}.`);
      } catch (err) {
        console.error('[CLOUD ERROR] Sheets failed:', err.message);
      }
    }

    console.log(`[SIMULACIÓN PRUEBA] Reporte creado: ${folio}. Sincronizado: ${driveLink ? 'CLOUD+JSON' : 'SOLO JSON'}`);
    res.status(201).json({ ...newReport, driveLink });

  } catch (err) {
    console.error('[SIMULACIÓN ERROR]', err);
    res.status(500).json({ error: 'Error interno al procesar el reporte' });
  }
});

// Update Report GPS (SIMULATED)
app.patch('/api/reports/:folio/location', (req, res) => {
  const { folio } = req.params;
  const { lat, lng } = req.body;
  
  const reportIndex = simulatedReports.findIndex(r => r.folio === folio);
  if (reportIndex === -1) return res.status(404).json({ error: 'Reporte no encontrado' });

  simulatedReports[reportIndex].lat = lat;
  simulatedReports[reportIndex].lng = lng;
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(simulatedReports, null, 2));

  console.log(`[SIMULACIÓN] GPS Actualizado para ${folio}: ${lat}, ${lng}`);
  res.json(simulatedReports[reportIndex]);
});

// Upload Second Photo (Caja)
app.post('/api/reports/:folio/photo', upload.single('photo'), async (req, res) => {
  const { folio } = req.params;
  const { phase } = req.body;

  const reportIndex = simulatedReports.findIndex(r => r.folio === folio);
  if (reportIndex === -1) return res.status(404).json({ error: 'Reporte no encontrado' });

  const report = simulatedReports[reportIndex];

  // Cloud Sync (Caja/Final Photo)
  try {
    if (req.file) {
      console.log(`[CLOUD] Comprimiendo foto secundaria (${phase}) para ${folio}...`);
      const compressedBuffer = await sharp(req.file.path)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();

      const rootFolder = process.env.DRIVE_PARENT_FOLDER_ID;
      const contractNum = (report.contractId.match(/\d+/)?.[0] || '0').padStart(3, '0');
      const contractFolderName = `${contractNum} ${report.empresaName}`;
      
      const contractFolderId = await getOrCreateFolder(contractFolderName, rootFolder);
      const folioFolderId = await getOrCreateFolder(folio, contractFolderId);
      
      const photoName = `${folio}_${phase}.jpg`;
      const driveData = await uploadFile(photoName, 'image/jpeg', compressedBuffer, folioFolderId);
      
      // SYNC TO SHEETS
      if (process.env.SHEET_ID) {
        const updateData = {};
        if (phase === 'caja') updateData.photoCaja = driveData.webViewLink;
        if (phase === 'terminado') updateData.photoFinal = driveData.webViewLink;
        
        await updateReportInSheet(process.env.SHEET_ID, folio, updateData);
        console.log(`[CLOUD] Sync Sheets OK. Foto ${phase} guardada.`);
      }
    }
  } catch (e) {
    console.error('[CLOUD ERROR] Secondary Photo failed:', e.message);
  }

  fs.writeFileSync(REPORTS_FILE, JSON.stringify(simulatedReports, null, 2));
  console.log(`[SIMULACIÓN] Foto ${phase} añadida para ${folio}. Estatus: ${report.status}`);
  res.json(report);
});

// Get All Reports (SIMULATED)
app.get('/api/reports', (req, res) => {
  res.json(simulatedReports);
});

// GeoJSON Data
let utbDataCache = null;
let delegationsDataCache = null;

app.get('/api/geojson', (req, res) => {
  try {
    if (!utbDataCache) {
      const content = fs.readFileSync(GEOJSON_FILE, 'utf8');
      utbDataCache = JSON.parse(content);
    }
    res.json(utbDataCache);
  } catch (err) {
    res.status(500).json({ error: 'Error al cargar GeoJSON' });
  }
});

app.get('/api/geojson/delegations', (req, res) => {
  try {
    if (!delegationsDataCache) {
      if (!utbDataCache) {
        const content = fs.readFileSync(GEOJSON_FILE, 'utf8');
        utbDataCache = JSON.parse(content);
      }
      // Group features by 'NOMDEL' and dissolve them into a single polygon per delegation
      delegationsDataCache = turf.dissolve(utbDataCache, { propertyName: 'NOMDEL' });
    }
    res.json(delegationsDataCache);
  } catch (err) {
    console.error('[PRUEBA ERROR] Error al disolver delegaciones:', err);
    res.status(500).json({ error: 'Error al procesar delegaciones' });
  }
});

// Contracts Catalog (SIMULATED from CSV)
app.get('/api/catalogs/contracts', (req, res) => {
  const CONTRACTS_FILE = path.join(process.cwd(), '..', 'CATALOGOS', 'RESUMEN DE CONTRATOS - SUPERVISORES 2026 - Registros Contratos Reales.csv');
  
  if (!fs.existsSync(CONTRACTS_FILE)) {
    console.log(`[PRUEBA ERROR] Archivo no encontrado en: ${CONTRACTS_FILE}`);
    return res.status(404).json({ error: 'Catálogo de contratos no encontrado' });
  }

  try {
    const content = fs.readFileSync(CONTRACTS_FILE, 'utf8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    const headers = lines[0].split(',');

    const contracts = lines.slice(1).map((line, idx) => {
      // Smart split that respects quotes (Reliable version)
      const row = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(item => item.trim().replace(/^"|"$/g, ''));
      
      if (row.length < 10) {
        console.log(`[PRUEBA ERROR] Línea ${idx+1} mal formada (Solo ${row.length} columnas)`);
        return null;
      }
      
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

    console.log(`[SIMULACIÓN] Catálogo: ${contracts.length} contratos cargados correctamente.`);
    res.json(contracts);
  } catch (err) {
    console.error('[SIMULACIÓN ERROR]', err);
    res.status(500).json({ error: 'Error al procesar catálogo de contratos' });
  }
});

// Update Report Status (Explicit)
app.patch('/api/reports/:folio/status', (req, res) => {
  const { folio } = req.params;
  const { status } = req.body;
  
  const reportIndex = simulatedReports.findIndex(r => r.folio === folio);
  if (reportIndex === -1) return res.status(404).json({ error: 'Reporte no encontrado' });

  simulatedReports[reportIndex].status = status;
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(simulatedReports, null, 2));

  // Sync to Sheets
  if (process.env.SHEET_ID) {
    updateReportInSheet(process.env.SHEET_ID, folio, { status })
      .catch(e => console.error('[SHEETS ERROR] Status update failed:', e.message));
  }

  console.log(`[SIMULACIÓN] Estatus Actualizado para ${reportIndex}: ${status}`);
  res.json(simulatedReports[reportIndex]);
});

app.listen(port, () => {
  console.log('--------------------------------------------------');
  console.log(`[PRUEBA] SERVIDOR DE SIMULACIÓN CORRIENDO EN PUERTO ${port}`);
  console.log(`[PRUEBA] USANDO GEOJSON: ${GEOJSON_FILE}`);
  console.log('--------------------------------------------------');
});
