/**
 * syncService.ts
 * Servicio de sincronización automática.
 * - Escucha el evento `online` del navegador.
 * - Verifica la calidad de la conexión con `navigator.connection`.
 * - Sube los reportes pendientes de IndexedDB uno a uno.
 */

import {
  getPendingReports,
  clearPendingReport,
  PendingReport,
} from './offlineStore';
import { getIdToken } from './firebase';
import { apiFetch } from './apiFetch';

/** Convierte un ArrayBuffer de vuelta a un Blob (para el FormData) */
function bufferToBlob(buffer: ArrayBuffer, type = 'image/jpeg'): Blob {
  return new Blob([buffer], { type });
}

/** Construye el FormData de un reporte pendiente para enviarlo al API */
function buildFormData(report: PendingReport): FormData {
  const fd = new FormData();
  const f = report.fields;
  fd.append('folio', f.folio);
  fd.append('contractId', f.contractId);
  fd.append('empresaName', f.empresaName);
  fd.append('lat', f.lat.toString());
  fd.append('lng', f.lng.toString());
  fd.append('largo', f.largo);
  fd.append('ancho', f.ancho);
  fd.append('profundidad', f.profundidad);
  fd.append('m2', f.m2);
  fd.append('locationDesc', f.locationDesc);
  fd.append('calle1', f.calle1);
  fd.append('calle2', f.calle2);
  fd.append('delegacion', f.delegacion);
  fd.append('colonia', f.colonia);
  fd.append('tipoBache', f.tipoBache);
  if (report.photoBuffer) {
    fd.append('photo', bufferToBlob(report.photoBuffer), 'upload.jpg');
  }
  return fd;
}

/** Determina si la conexión actual es suficientemente buena para sincronizar */
function hasGoodConnection(): boolean {
  // navigator.connection es experimental pero ampliamente compatible en Android Chrome
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = (navigator as any).connection;
  if (!conn) return navigator.onLine; // Fallback: si no hay info, usamos onLine

  // Excluimos conexiones lentas o con ahorro de datos activo
  if (conn.saveData) return false;
  const slowTypes = ['slow-2g', '2g'];
  if (slowTypes.includes(conn.effectiveType)) return false;

  return navigator.onLine;
}

type SyncCallback = (result: { synced: number; failed: number }) => void;

/**
 * Sube todos los reportes pendientes de IndexedDB al servidor.
 * @param onComplete - Callback informado al terminar con el conteo de éxitos/fallos.
 */
export async function syncPendingReports(onComplete?: SyncCallback): Promise<void> {
  if (!hasGoodConnection()) {
    console.log('[SYNC] Conexión insuficiente, posponiendo sincronización.');
    return;
  }

  // Check for auth token before attempting sync
  const token = await getIdToken();
  if (!token) {
    console.log('[SYNC] Sin sesión activa, posponiendo sincronización.');
    return;
  }

  const pending = await getPendingReports();
  if (pending.length === 0) return;

  console.log(`[SYNC] Iniciando sincronización de ${pending.length} reporte(s) pendiente(s)...`);

  let synced = 0;
  let failed = 0;

  for (const report of pending) {
    try {
      let response;
      if (report.type === 'UPDATE') {
        const fd = new FormData();
        // IMPORTANTE: Incluir la fase (caja o terminado)
        if (report.phase) fd.append('phase', report.phase);
        
        if (report.photoBuffer) {
          fd.append('photo', bufferToBlob(report.photoBuffer), 'upload.jpg');
        }
        if (report.phase === 'caja') {
          fd.append('largo', report.fields.largo || '0');
          fd.append('ancho', report.fields.ancho || '0');
          fd.append('profundidad', report.fields.profundidad || '0');
          fd.append('m2', report.fields.m2 || '0');
          if (report.fields.tipoBache) {
            fd.append('tipoBache', report.fields.tipoBache);
          }
        }
        response = await apiFetch(`/api/reports/${report.fields.folio}/photo`, { 
          method: 'POST', 
          body: fd 
        });
      } else {
        const fd = buildFormData(report);
        response = await apiFetch('/api/reports', { method: 'POST', body: fd });
      }

      if (response.ok || response.status === 409) {
        await clearPendingReport(report.id!);
        synced++;
        const msg = response.status === 409 ? 'ya existía' : 'sincronizado';
        console.log(`[SYNC] ✅ Reporte ${report.fields.folio} ${msg}.`);
      } else {
        failed++;
        console.warn(`[SYNC] ❌ Servidor rechazó reporte ${report.fields.folio} con status ${response.status}.`);
      }
    } catch (err) {
      failed++;
      console.warn(`[SYNC] ❌ Error de red al subir reporte ${report.fields.folio}.`, err);
    }
  }

  console.log(`[SYNC] Completado. Sincronizados: ${synced}, Fallidos: ${failed}`);
  onComplete?.({ synced, failed });
}

/**
 * Registra los listeners globales para sincronización automática.
 * Llama a esta función UNA sola vez al inicio de la app.
 * @param onComplete - Callback informado cada vez que se completa una sincronización.
 */
export function registerAutoSync(onComplete?: SyncCallback): void {
  // 1. Sincronizar cuando el navegador detecte conexión
  window.addEventListener('online', () => {
    console.log('[SYNC] Conexión detectada. Intentando sincronizar...');
    syncPendingReports(onComplete);
  });

  // 2. Sincronizar cuando cambie el tipo de conexión (ej. de 2G a 4G)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = (navigator as any).connection;
  if (conn) {
    conn.addEventListener('change', () => {
      if (hasGoodConnection()) {
        console.log('[SYNC] Mejora de red detectada. Intentando sincronizar...');
        syncPendingReports(onComplete);
      }
    });
  }

  // 3. Intentar sincronizar al cargar la app por si había pendientes
  syncPendingReports(onComplete);
}
