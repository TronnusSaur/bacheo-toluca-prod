import { google } from 'googleapis';
import { getGoogleClient } from './googleClient.js';
import fs from 'fs';
import path from 'path';

const SHEETS_LOG = path.join(process.cwd(), 'sheets_audit.log');

function logSheets(msg, data = null) {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] ${msg}`;
  if (data) line += ` | Error: ${JSON.stringify(data, null, 2)}`;
  fs.appendFileSync(SHEETS_LOG, line + '\n');
}

/**
 * Maps the report object to the exact array structure required by the Google Sheet.
 * Column Order: Folio, Fecha, Contrato, Empresa, Ubicación (Ref), Delegación, Colonia, 
 * Coordenadas (Lat,Lng), Largo (M), Ancho (M), Profundidad (M), M2, Tipo Bache, Estatus, Foto Inicial (Link)
 */
function mapReportToRow(report) {
  const fecha = new Date().toLocaleString('es-MX', { 
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  return [
    report.folio || '',
    fecha,
    report.contractId || '',
    report.empresaName || '',
    report.locationDesc || '',
    report.delegacion || '',
    report.colonia || '',
    `${report.lat || 0}, ${report.lng || 0}`,
    report.largo || '0',
    report.ancho || '0',
    report.profundidad || '0',
    report.m2 || '0',
    report.tipoBache || '',
    report.status || 'DETECTADO',
    report.photoUrl || ''
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
      range: 'Hoja 1!A:O',
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
    const rowIndex = rows.findIndex(r => r[0] == folio);
    
    if (rowIndex === -1) {
      console.warn(`[SHEETS ERROR] Folio ${folio} no encontrado.`);
      logSheets(`Folio ${folio} NOT FOUND`);
      return;
    }

    const sheetRow = rowIndex + 1;

    // Photos and Status columns: P (photoCaja), Q (photoFinal), N (status)
    if (updates.photoCaja) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Hoja 1!P${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[updates.photoCaja]] },
      });
    }
    if (updates.photoFinal) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Hoja 1!Q${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[updates.photoFinal]] },
      });
    }
    if (updates.status) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Hoja 1!N${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[updates.status]] },
      });
    }
    
    console.log(`[SHEETS SUCCESS] Update exitosa para Folio ${folio}`);
    logSheets(`Update SUCCESS for ${folio}`);
  } catch (err) {
    const errorData = err.response ? err.response.data : err.message;
    console.error('[SHEETS ERROR] updateReportInSheet failed:', errorData);
    logSheets(`Update FAILED for ${folio}`, errorData);
  }
}
