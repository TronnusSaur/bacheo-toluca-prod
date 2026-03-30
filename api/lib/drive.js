import { google } from 'googleapis';
import path from 'path';
import { Readable } from 'stream';
import fs from 'fs';
import { getGoogleClient } from './googleClient.js';

const AUDIT_LOG = path.join(process.cwd(), 'drive_audit.log');

function logAudit(msg, data = null) {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] ${msg}`;
  if (data) line += ` | Error: ${JSON.stringify(data, null, 2)}`;
  fs.appendFileSync(AUDIT_LOG, line + '\n');
}

export async function getOrCreateFolder(folderName, parentId) {
  try {
    const auth = await getGoogleClient();
    const drive = google.drive({ version: 'v3', auth });

    const query = `name = '${folderName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
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

    console.log(`[DRIVE] Attempting upload of ${fileName} via OAuth2/ServiceAccount...`);

    const media = {
      mimeType: mimeType,
      body: Readable.from(body),
    };

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

    console.log(`[DRIVE] Upload SUCCESS for ${fileName}`);
    return res.data;
  } catch (err) {
    const errorData = err.response ? err.response.data : err.message;
    logAudit(`uploadFile FAILED for ${fileName}`, errorData);
    throw err;
  }
}
