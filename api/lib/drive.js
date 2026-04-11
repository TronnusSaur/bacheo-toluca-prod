import { google } from 'googleapis';
import { Readable } from 'stream';
import { getGoogleClient } from './googleClient.js';

/** Escape single quotes for Google Drive API query strings */
function escapeQuery(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function logAudit(msg, data = null) {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}][DRIVE-AUDIT] ${msg}`;
  if (data) line += ` | Error: ${JSON.stringify(data)}`;
  console.log(line); // Use console.log - Vercel filesystem is read-only
}

export async function getOrCreateFolder(folderName, parentId) {
  try {
    const auth = await getGoogleClient();
    const drive = google.drive({ version: 'v3', auth });

    const query = `name = '${escapeQuery(folderName)}' and '${escapeQuery(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const response = await drive.files.list({ 
      q: query,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
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
    return res.data.id;
  } catch (err) {
    logAudit(`getOrCreateFolder FAILED for ${folderName}`, err.response ? err.response.data : err.message);
    throw err;
  }
}

export async function uploadFile(fileName, mimeType, body, parentId) {
  try {
    const auth = await getGoogleClient();
    const drive = google.drive({ version: 'v3', auth });

    // 1. Search for existing file to avoid duplicates
    const query = `name = '${escapeQuery(fileName)}' and '${escapeQuery(parentId)}' in parents and trashed = false`;
    const checkRes = await drive.files.list({
      q: query,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const existingFile = checkRes.data.files && checkRes.data.files[0];
    const media = {
      mimeType: mimeType,
      body: Readable.from(body),
    };

    if (existingFile) {
      console.log(`[DRIVE] Updating existing file: ${fileName} (${existingFile.id})`);
      const res = await drive.files.update({
        fileId: existingFile.id,
        media: media,
        supportsAllDrives: true,
        fields: 'id, webViewLink',
      });
      return res.data;
    } else {
      console.log(`[DRIVE] Creating new file: ${fileName}`);
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
    logAudit(`uploadFile FAILED for ${fileName}`, errorData);
    throw err;
  }
}
