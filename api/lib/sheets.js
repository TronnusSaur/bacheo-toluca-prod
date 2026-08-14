import { google } from 'googleapis';
import { getGoogleClient } from './googleClient.js';

function logSheets(msg, data = null) {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}][SHEETS-AUDIT] ${msg}`;
  if (data) line += ` | Data/Error: ${JSON.stringify(data, null, 2)}`;
  console.log(line);
}

export const SHEET_HEADERS = [
  'FOLIO',
  'FECHA',
  'CONTRATO',
  'EMPRESA',
  'UBICACIÓN / REFERENCIA',
  'DELEGACIÓN',
  'COLONIA',
  'COORDENADAS (LAT, LNG)',
  'LARGO (M)',
  'ANCHO (M)',
  'PROFUNDIDAD (M)',
  'ÁREA (M²)',
  'TIPO DE BACHE',
  'ESTATUS',
  'FOTO INICIAL',
  'FOTO CAJA',
  'FOTO FINAL',
  'CALLE 1',
  'CALLE 2',
  'RESPONSABLE'
];

/**
 * Maps the report object to the exact array structure required by the Google Sheet.
 * Column Order: Folio, Fecha, Contrato, Empresa, Ubicación (Ref), Delegación, Colonia, 
 * Coordenadas (Lat,Lng), Largo (M), Ancho (M), Profundidad (M), M2, Tipo Bache, Estatus, 
 * Foto Inicial (Link), Photo Caja, Photo Final, Calle 1, Calle 2, Responsable (T)
 */
function mapReportToRow(report) {
  const fecha = report.created_at ? new Date(report.created_at).toLocaleString('es-MX', { 
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }) : new Date().toLocaleString('es-MX', { 
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  const rawTipo = report.tipobache || report.tipoBache || '';
  const tipoBache = rawTipo.replace(/^CAJA\s+/i, '').trim();
  const responsable = report.usuario || report.updated_by || report.created_by || '';

  const folioStr = String(report.folio || '').trim();
  // Force text format in Google Sheets with single quote so leading zero (010003) is preserved
  const sheetFolio = /^\d+$/.test(folioStr) ? `'${folioStr}` : folioStr;

  return [
    sheetFolio,
    fecha,
    report.contractid || report.contractId || '',
    report.empresaname || report.empresaName || '',
    report.locationdesc || report.locationDesc || '',
    report.delegacion || '',
    report.colonia || '',
    `${report.lat || 0}, ${report.lng || 0}`,
    report.largo || '0',
    report.ancho || '0',
    report.profundidad || '0',
    report.m2 || '0',
    tipoBache,
    report.status || 'DETECTADO',
    report.photourl || report.photoUrl || '',
    report.photocaja || report.photoCaja || '', 
    report.photofinal || report.photoFinal || '',
    report.calle_1 || report.calle1 || '', 
    report.calle_2 || report.calle2 || '',
    responsable
  ];
}

/**
 * Ensures header row exists in Google Sheets (Hoja 1!A1:T1)
 */
export async function ensureSheetHeaders(sheetId) {
  if (!sheetId) return;
  try {
    const auth = await getGoogleClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Hoja 1!A1:T1',
    });

    const firstRow = getRes.data.values?.[0] || [];
    const firstCell = String(firstRow[0] || '').trim().toUpperCase();

    if (firstCell !== 'FOLIO') {
      console.log('[SHEETS] Encabezados no detectados en A1. Insertando encabezados en Hoja 1...');
      
      if (firstCell.length > 0) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
        const numericSheetId = meta.data.sheets?.[0]?.properties?.sheetId || 0;

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [
              {
                insertDimension: {
                  range: {
                    sheetId: numericSheetId,
                    dimension: 'ROWS',
                    startIndex: 0,
                    endIndex: 1,
                  },
                  inheritFromBefore: false,
                },
              },
            ],
          },
        });
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'Hoja 1!A1:T1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [SHEET_HEADERS] },
      });
      console.log('[SHEETS SUCCESS] ✅ Encabezados de tabla insertados en Fila 1.');
    }
  } catch (err) {
    console.error('[SHEETS WARN] Error al asegurar encabezados:', err.message);
  }
}

export async function appendReportToSheet(sheetId, report) {
  if (!sheetId) return;
  try {
    await ensureSheetHeaders(sheetId);

    const auth = await getGoogleClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const rowValues = mapReportToRow(report);

    console.log(`[SHEETS] Intentando append en ${sheetId} (Folio: ${report.folio})...`);
    logSheets(`Attempting append in ${sheetId}`, { rowValues });

    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Hoja 1!A:T',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowValues] },
    });
    
    console.log(`[SHEETS SUCCESS] ✅ Append finalizado en Google Sheets: ${res.statusText}`);
    logSheets(`Append SUCCESS: ${res.statusText}`);
  } catch (err) {
    const errorData = err.response ? err.response.data : err.message;
    console.error('[SHEETS ERROR] appendReportToSheet failed:', errorData);
    logSheets(`Append FAILED`, errorData);
    throw err;
  }
}

export async function updateReportInSheet(sheetId, folio, updates) {
  if (!sheetId) return;
  try {
    const auth = await getGoogleClient();
    const sheets = google.sheets({ version: 'v4', auth });

    logSheets(`Attempting update for folio ${folio}`, { updates });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Hoja 1!A:A',
    });

    const rows = readRes.data.values || [];
    const normalize = (f) => String(f || '').trim().replace(/^0+/, '');
    const normalizedFolio = normalize(folio);

    const rowIndex = rows.findIndex(r => normalize(r[0]) === normalizedFolio);
    
    if (rowIndex === -1) {
      console.warn(`[SHEETS WARN] Folio ${folio} no encontrado en Google Sheets.`);
      return;
    }

    const sheetRow = rowIndex + 1;

    const { largo, ancho, profundidad, m2, status, usuario } = updates;
    const photoUrl = updates.photoUrl || updates.photourl;
    const photoCaja = updates.photocaja || updates.photoCaja;
    const photoFinal = updates.photofinal || updates.photoFinal;
    const rawTipo = updates.tipobache || updates.tipoBache || '';
    const tipoBache = rawTipo.replace(/^CAJA\s+/i, '').trim() || null;

    const batchData = [];

    if (measurementsExist(largo, ancho, profundidad)) {
      batchData.push({
        range: `Hoja 1!I${sheetRow}:L${sheetRow}`,
        values: [[largo, ancho, profundidad, m2]]
      });
    }

    if (photoUrl) batchData.push({ range: `Hoja 1!O${sheetRow}`, values: [[photoUrl]] });
    if (photoCaja) batchData.push({ range: `Hoja 1!P${sheetRow}`, values: [[photoCaja]] });
    if (photoFinal) batchData.push({ range: `Hoja 1!Q${sheetRow}`, values: [[photoFinal]] });
    if (status) batchData.push({ range: `Hoja 1!N${sheetRow}`, values: [[status]] });
    if (tipoBache) batchData.push({ range: `Hoja 1!M${sheetRow}`, values: [[tipoBache]] });
    if (usuario) batchData.push({ range: `Hoja 1!T${sheetRow}`, values: [[usuario]] });

    if (batchData.length === 0) return;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batchData,
      },
    });
    
    logSheets(`Update SUCCESS for ${folio}`);
  } catch (err) {
    const errorData = err.response ? err.response.data : err.message;
    console.error('[SHEETS ERROR] updateReportInSheet failed:', errorData);
  }
}

/**
 * Reads all reports directly from Google Sheets (Hoja 1!A:T).
 * Matches SP REGIS behavior for instant data fetching.
 */
export async function getAllReportsFromSheet(sheetId) {
  if (!sheetId) return [];
  try {
    const auth = await getGoogleClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Hoja 1!A:T',
    });

    const rows = readRes.data.values || [];
    if (rows.length <= 1) return [];

    const dataRows = rows[0]?.[0]?.toLowerCase().includes('folio') ? rows.slice(1) : rows;

    return dataRows.map((r, idx) => {
      let rawFolio = String(r[0] || '').trim().replace(/^'/, '');
      if (/^\d{1,5}$/.test(rawFolio)) {
        rawFolio = rawFolio.padStart(6, '0');
      }

      const coords = (r[7] || '').split(',').map(c => parseFloat(c.trim()));
      const lat = coords[0] && !isNaN(coords[0]) ? coords[0] : 0;
      const lng = coords[1] && !isNaN(coords[1]) ? coords[1] : 0;

      return {
        id: idx + 1,
        folio: rawFolio,
        created_at: r[1] || new Date().toISOString(),
        contractId: r[2] || '',
        contractid: r[2] || '',
        empresaName: r[3] || '',
        empresaname: r[3] || '',
        locationDesc: r[4] || '',
        locationdesc: r[4] || '',
        delegacion: r[5] || '',
        colonia: r[6] || '',
        lat,
        lng,
        largo: parseFloat(r[8] || '0') || 0,
        ancho: parseFloat(r[9] || '0') || 0,
        profundidad: parseFloat(r[10] || '0') || 0,
        m2: parseFloat(r[11] || '0') || 0,
        tipoBache: r[12] || '',
        tipobache: r[12] || '',
        status: r[13] || 'DETECTADO',
        photoUrl: r[14] || '',
        photourl: r[14] || '',
        photoCaja: r[15] || '',
        photocaja: r[15] || '',
        photoFinal: r[16] || '',
        photofinal: r[16] || '',
        calle_1: r[17] || '',
        calle1: r[17] || '',
        calle_2: r[18] || '',
        calle2: r[18] || '',
        created_by: r[19] || '',
        updated_by: r[19] || ''
      };
    }).reverse();
  } catch (err) {
    console.error('[SHEETS ERROR] getAllReportsFromSheet failed:', err.message);
    return [];
  }
}

function measurementsExist(l, a, p) {
  return l !== undefined || a !== undefined || p !== undefined;
}
