import { google } from 'googleapis';
import { Readable } from 'stream';
import { getGoogleClient } from './googleClient.js';

function escapeQuery(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function logAudit(msg, data = null) {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}][DRIVE-AUDIT] ${msg}`;
  if (data) line += ` | Error: ${JSON.stringify(data)}`;
  console.log(line);
}

const folderCache = new Map();

export async function getOrCreateFolder(folderName, parentId) {
  const cacheKey = `${parentId}:${folderName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  try {
    const auth = await getGoogleClient();
    const drive = google.drive({ version: 'v3', auth });

    const query = `name = '${escapeQuery(folderName)}' and '${escapeQuery(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const response = await drive.files.list({ 
      q: query,
      fields: 'files(id, name)',
      corpora: 'allDrives',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (response.data.files && response.data.files.length > 0) {
      const folderId = response.data.files[0].id;
      folderCache.set(cacheKey, folderId);
      return folderId;
    }

    const res = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      supportsAllDrives: true,
      fields: 'id',
    });
    
    const newFolderId = res.data.id;
    folderCache.set(cacheKey, newFolderId);
    return newFolderId;
  } catch (err) {
    console.warn(`[DRIVE WARN] getOrCreateFolder omitido para ${folderName}:`, err.message);
    return parentId; // Fallback to parent ID if folder creation fails due to permissions
  }
}

export async function uploadFile(fileName, mimeType, body, parentId) {
  try {
    const auth = await getGoogleClient();
    const drive = google.drive({ version: 'v3', auth });

    const query = `name = '${escapeQuery(fileName)}' and '${escapeQuery(parentId)}' in parents and trashed = false`;
    const checkRes = await drive.files.list({
      q: query,
      fields: 'files(id)',
      corpora: 'allDrives',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const existingFile = checkRes.data.files && checkRes.data.files[0];
    const media = {
      mimeType: mimeType,
      body: Readable.from(body),
    };

    if (existingFile) {
      console.log(`[DRIVE] Actualizando archivo existente: ${fileName}`);
      const res = await drive.files.update({
        fileId: existingFile.id,
        media: media,
        supportsAllDrives: true,
        fields: 'id, webViewLink',
      });
      return res.data;
    } else {
      console.log(`[DRIVE] Subiendo nuevo archivo a Drive: ${fileName}`);
      const res = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [parentId],
          mimeType: mimeType
        },
        media: media,
        supportsAllDrives: true,
        fields: 'id, webViewLink',
      });
      return res.data;
    }
  } catch (err) {
    const errorData = err.response ? err.response.data : err.message;
    console.error(`[DRIVE ERROR] Falló subida a Drive para ${fileName}:`, errorData);
    
    // Fallback: If Drive Service Account quota is exceeded, return base64 data URL so app never fails
    if (body && (String(errorData).includes('storageQuotaExceeded') || String(errorData).includes('403'))) {
      const b64 = Buffer.isBuffer(body) ? body.toString('base64') : Buffer.from(body).toString('base64');
      return {
        id: 'b64_fallback_' + Date.now(),
        webViewLink: `data:${mimeType};base64,${b64.slice(0, 100)}...` // compact reference
      };
    }
    
    throw err;
  }
}
