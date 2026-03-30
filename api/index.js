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

const app = express();
const upload = multer({ dest: '/tmp/' }); // Vercel has /tmp/ writable

app.use(cors());
app.use(express.json());

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
      utbDataCache = JSON.parse(content);
      console.log('[API] UTB REAL.geojson cargado en memoria.');
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
app.get('/api/catalogs/contracts', (req, res) => {
  const CONTRACTS_FILE = path.join(process.cwd(), 'CATALOGOS', 'RESUMEN DE CONTRATOS - SUPERVISORES 2026 - Registros Contratos Reales.csv');
  
  if (!fs.existsSync(CONTRACTS_FILE)) {
    return res.status(404).json({ error: 'Catálogo de contratos no encontrado en ' + CONTRACTS_FILE });
  }

  try {
    const content = fs.readFileSync(CONTRACTS_FILE, 'utf8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    
    const contracts = lines.slice(1).map((line, idx) => {
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

    res.json(contracts);
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar catálogo' });
  }
});

// --- RADAR API ---
app.post('/api/radar', (req, res) => {
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

// --- REPORTS API ---
app.get('/api/reports', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al leer baches' });
  }
});

app.post('/api/reports', upload.single('photo'), async (req, res) => {
  try {
    const { folio, contractId, empresaName, lat, lng, largo, ancho, profundidad, m2, locationDesc, delegacion, colonia, tipoBache } = req.body;
    
    // 1. Initial Insert into Postgres
    const result = await pool.query(
      `INSERT INTO reports (folio, contractId, empresaName, lat, lng, largo, ancho, profundidad, m2, locationDesc, delegacion, colonia, tipoBache, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'DETECTADO') RETURNING *`,
      [folio, contractId, empresaName, lat, lng, largo, ancho, profundidad, m2, locationDesc, delegacion, colonia, tipoBache]
    );

    const newReport = result.rows[0];
    let driveLink = null;

    // 2. Drive Photo Upload
    if (req.file) {
      try {
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
        
        // Update DB with photo URL
        await pool.query('UPDATE reports SET photoUrl = $1 WHERE id = $2', [driveLink, newReport.id]);
        newReport.photoUrl = driveLink;
      } catch (err) {
        console.error('[DRIVE ERROR]', err.message);
      }
    }

    // 3. Sheets Sync
    if (process.env.SHEET_ID) {
      try {
        await appendReportToSheet(process.env.SHEET_ID, newReport);
      } catch (err) {
        console.error('[SHEETS ERROR]', err.message);
      }
    }

    res.status(201).json({ ...newReport, driveLink });
  } catch (err) {
    console.error('[REPORTS POST ERROR]', err);
    res.status(500).json({ error: 'Fallo al procesar bache' });
  }
});

// Photo Update (Caja/Final)
app.post('/api/reports/:folio/photo', upload.single('photo'), async (req, res) => {
  const { folio } = req.params;
  const { phase } = req.body; // 'caja' o 'terminado'

  try {
    const reportRes = await pool.query('SELECT * FROM reports WHERE folio = $1', [folio]);
    if (reportRes.rowCount === 0) return res.status(404).json({ error: 'Reporte no encontrado' });
    const report = reportRes.rows[0];

    if (req.file) {
      const compressedBuffer = await sharp(req.file.path).resize(1200).jpeg({ quality: 60 }).toBuffer();
      const rootFolder = process.env.DRIVE_PARENT_FOLDER_ID;
      const contractNum = (report.contractId.match(/\d+/)?.[0] || '0').padStart(3, '0');
      const contractFolderName = `${contractNum} ${report.empresaName}`;
      
      const contractFolderId = await getOrCreateFolder(contractFolderName, rootFolder);
      const folioFolderId = await getOrCreateFolder(folio, contractFolderId);
      
      const photoName = `${folio}_${phase}.jpg`;
      const driveData = await uploadFile(photoName, 'image/jpeg', compressedBuffer, folioFolderId);
      const driveLink = driveData.webViewLink;

      // Update DB and Sheets
      const colName = phase === 'caja' ? 'photoCaja' : 'photoFinal';
      await pool.query(`UPDATE reports SET ${colName} = $1 WHERE folio = $2`, [driveLink, folio]);
      
      // Update Sheets
      await updateReportInSheet(process.env.SHEET_ID, folio, { [colName]: driveLink });

      res.json({ success: true, link: driveLink });
    }
  } catch (err) {
    res.status(500).json({ error: 'Error al subir foto secundaria' });
  }
});

// Update Status
app.patch('/api/reports/:folio/status', async (req, res) => {
  const { folio } = req.params;
  const { status } = req.body;
  try {
    await pool.query('UPDATE reports SET status = $1 WHERE folio = $2', [status, folio]);
    await updateReportInSheet(process.env.SHEET_ID, folio, { status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fallo al actualizar estatus' });
  }
});

// Export as Vercel Function
export default app;
