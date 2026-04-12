import { google } from 'googleapis';
import { getGoogleClient } from './googleClient.js';
import fs from 'fs';
import path from 'path';

function logSheets(msg, data = null) {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}][SHEETS-AUDIT] ${msg}`;
  if (data) line += ` | Data/Error: ${JSON.stringify(data, null, 2)}`;
  console.log(line);
}

/**
 * Maps the report object to the exact array structure required by the Google Sheet.
 * Column Order: Folio, Fecha, Contrato, Empresa, Ubicación (Ref), Delegación, Colonia, 
 * Column Order: Folio, Fecha, Contrato, Empresa, Ubicación (Ref), Delegación, Colonia, 
 * Coordenadas (Lat,Lng), Largo (M), Ancho (M), Profundidad (M), M2, Tipo Bache, Estatus, 
 * Foto Inicial (Link), Photo Caja, Photo Final, Calle 1, Calle 2, Responsable (T)
 */
function mapReportToRow(report) {
  const fecha = new Date().toLocaleString('es-MX', { 
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  // Strip 'CAJA ' prefix — only store SUPERFICIAL or PROFUNDO
  const rawTipo = report.tipobache || report.tipoBache || '';
  const tipoBache = rawTipo.replace(/^CAJA\s+/i, '').trim();

  // Responsable: prefer explicit 'usuario' field, then updated_by (photo uploads), then created_by
  const responsable = report.usuario || report.updated_by || report.created_by || '';

  return [
    report.folio || '',
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
    responsable // Column T
  ];
}

export async function appendReportToSheet(sheetId, report) {
  try {
    const auth = await getGoogleClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // CRITICAL: Convert Object to Array of Values
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
    
    console.log(`[SHEETS SUCCESS] Append finalizado: ${res.statusText}`);
    logSheets(`Append SUCCESS: ${res.statusText}`);
  } catch (err) {
    const errorData = err.response ? err.response.data : err.message;
    console.error('[SHEETS ERROR] appendReportToSheet failed:', errorData);
    logSheets(`Append FAILED`, errorData);
    throw err;
  }
}

export async function updateReportInSheet(sheetId, folio, updates) {
  try {
    const auth = await getGoogleClient();
    const sheets = google.sheets({ version: 'v4', auth });

    logSheets(`Attempting update for folio ${folio}`, { updates });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Hoja 1!A:A',
    });

    const rows = readRes.data.values || [];
    
    // Normalize folio for lookup
    const normalize = (f) => String(f || '').trim().replace(/^0+/, '');
    const normalizedFolio = normalize(folio);

    const rowIndex = rows.findIndex(r => normalize(r[0]) === normalizedFolio);
    
    if (rowIndex === -1) {
      console.warn(`[SHEETS ERROR] Folio ${folio} no encontrado.`);
      return;
    }

    const sheetRow = rowIndex + 1;

    // Columna N: status, P: photoCaja, Q: photoFinal, M: tipoBache, I-L: measurements, T: Responsable
    const { largo, ancho, profundidad, m2, status, usuario } = updates;
    const photoCaja = updates.photocaja || updates.photoCaja;
    const photoFinal = updates.photofinal || updates.photoFinal;
    // Normalize and strip 'CAJA ' from tipoBache
    const rawTipo = updates.tipobache || updates.tipoBache || '';
    const tipoBache = rawTipo.replace(/^CAJA\s+/i, '').trim() || null;

    const batchUpdates = [];

    if (measurementsExist(largo, ancho, profundidad)) {
      batchUpdates.push({
        range: `Hoja 1!I${sheetRow}:L${sheetRow}`,
        values: [[largo, ancho, profundidad, m2]]
      });
    }

    if (photoCaja) batchUpdates.push({ range: `Hoja 1!P${sheetRow}`, values: [[photoCaja]] });
    if (photoFinal) batchUpdates.push({ range: `Hoja 1!Q${sheetRow}`, values: [[photoFinal]] });
    if (status) batchUpdates.push({ range: `Hoja 1!N${sheetRow}`, values: [[status]] });
    if (tipoBache) batchUpdates.push({ range: `Hoja 1!M${sheetRow}`, values: [[tipoBache]] });
    if (usuario) batchUpdates.push({ range: `Hoja 1!T${sheetRow}`, values: [[usuario]] });

    for (const update of batchUpdates) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: update.range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: update.values },
      });
    }
    
    logSheets(`Update SUCCESS for ${folio}`);
  } catch (err) {
    const errorData = err.response ? err.response.data : err.message;
    console.error('[SHEETS ERROR] updateReportInSheet failed:', errorData);
  }
}

function measurementsExist(l, a, p) {
  return l !== undefined || a !== undefined || p !== undefined;
}
