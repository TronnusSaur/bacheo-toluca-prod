/**
 * syncService.ts
 * Servicio de sincronización automática robusto (v3 — Supabase + Drive + Sheets + offlineId).
 * 
 * Flujo:
 * 1. Lee transacciones guardadas localmente en robustStore.
 * 2. Construye FormData multipart con la foto local.
 * 3. Envia solicitud directa a /api/reports o /api/reports/:folio/photo (1 solo salto).
 * 4. El servidor Vercel / Express procesa:
 *    - Paso 1 (Primordial): Subida a Google Drive (Carpeta por contrato/folio).
 *    - Paso 2 (Primordial): Append/Update en Google Sheets (Hoja Master A-T).
 *    - Paso 3 (Persistencia Supabase): Upsert en tabla bacheo_pruebas_app en Supabase local (192.168.1.128:8000).
 * 5. Limpia archivos locales tras confirmación HTTP 200 o 409.
 */

import { getPendingItems, getReportJSON, getReportPhoto, clearReportFiles } from './robustStore';
import { getIdToken } from './supabase';
import { apiFetch } from './apiFetch';

/** Determina si la conexión actual es suficientemente buena para sincronizar */
function hasGoodConnection(): boolean {
  const conn = (navigator as any).connection;
  if (!conn) return navigator.onLine;

  if (conn.saveData) return false;
  const slowTypes = ['slow-2g', '2g'];
  if (slowTypes.includes(conn.effectiveType)) return false;

  return navigator.onLine;
}

type SyncCallback = (result: { synced: number; failed: number }) => void;

let isSyncing = false;
const activeSyncKeys = new Set<string>();

/**
 * Sube todos los reportes pendientes al servidor.
 * Sube la foto directamente como multipart (sin Firebase Storage intermedio).
 */
export async function syncPendingReports(onComplete?: SyncCallback): Promise<void> {
  if (isSyncing) {
    console.log('[SYNC] Sincronización en curso. Ignorando llamada concurrente.');
    return;
  }
  isSyncing = true;
  
  if (!hasGoodConnection()) {
    console.log('[SYNC] Conexión insuficiente o inestable, posponiendo.');
    isSyncing = false;
    onComplete?.({ synced: 0, failed: 0 });
    return;
  }

  const token = await getIdToken();
  if (!token) {
    console.log('[SYNC] Sin sesión de autenticación activa. Posponiendo.');
    isSyncing = false;
    onComplete?.({ synced: 0, failed: 0 });
    return;
  }

  const pendingItems = await getPendingItems();
  if (pendingItems.length === 0) {
    isSyncing = false;
    onComplete?.({ synced: 0, failed: 0 });
    return;
  }

  console.log(`[SYNC] Iniciando sincronización de ${pendingItems.length} transaccion(es) pendiente(s)...`);

  let synced = 0;
  let failed = 0;

  for (const itemKey of pendingItems) {
    if (activeSyncKeys.has(itemKey)) {
      console.log(`[SYNC] Transacción ${itemKey} ya está en proceso. Omitiendo duplicado.`);
      continue;
    }
    activeSyncKeys.add(itemKey);

    const parts = itemKey.split('_');
    const folio = parts[0];
    const phase = parts.slice(1).join('_');

    // Emitir evento para feedback visual en la UI
    window.dispatchEvent(new CustomEvent('sync-item-start', { detail: { folio, phase, itemKey } }));

    let isSuccess = false;
    try {
      const report = await getReportJSON(folio, phase);
      if (!report) {
        console.warn(`[SYNC] Limpiando transacción corrupta o inexistente: ${itemKey}`);
        await clearReportFiles(folio, phase);
        isSuccess = true;
        continue;
      }

      // 1. Construir FormData con foto multipart directa
      const fd = new FormData();
      const f = report.fields;
      fd.append('folio', f.folio);
      fd.append('offlineId', `${folio}_${phase}`); // Identificador único para deduplicación en servidor
      fd.append('contractId', f.contractId || '');
      fd.append('empresaName', f.empresaName || '');
      fd.append('phase', phase);
      fd.append('lat', (f.lat || 0).toString());
      fd.append('lng', (f.lng || 0).toString());
      fd.append('largo', f.largo || '0');
      fd.append('ancho', f.ancho || '0');
      fd.append('profundidad', f.profundidad || '0');
      fd.append('m2', f.m2 || '0');
      fd.append('locationDesc', f.locationDesc || '');
      fd.append('calle1', f.calle1 || '');
      fd.append('calle2', f.calle2 || '');
      fd.append('delegacion', f.delegacion || '');
      fd.append('colonia', f.colonia || '');
      fd.append('tipoBache', f.tipoBache || '');

      // 2. Cargar foto local y adjuntarla directamente
      const photoBlob = await getReportPhoto(folio, phase);
      if (photoBlob) {
        fd.append('photo', photoBlob, `${folio}_${phase}.jpg`);
        console.log(`[SYNC] Foto adjunta para ${folio} (${phase}): ${(photoBlob.size / 1024).toFixed(1)} KB`);
      }

      // 3. Enviar solicitud al Backend
      let response;
      if (report.type === 'UPDATE') {
        response = await apiFetch(`/api/reports/${folio}/photo`, {
          method: 'POST',
          body: fd
        });
      } else {
        response = await apiFetch('/api/reports', {
          method: 'POST',
          body: fd
        });
      }

      if (response.ok || response.status === 409) {
        await clearReportFiles(folio, phase);
        synced++;
        isSuccess = true;
        const msg = response.status === 409 ? 'ya existía' : 'sincronizado';
        console.log(`[SYNC] ✅ Reporte ${folio} (${phase}) ${msg}.`);
      } else {
        failed++;
        console.warn(`[SYNC] ❌ Servidor rechazó reporte ${folio} (${phase}) con status ${response.status}.`);
      }
    } catch (err) {
      failed++;
      console.warn(`[SYNC] ❌ Error al procesar transacción ${itemKey}:`, err);
    } finally {
      activeSyncKeys.delete(itemKey);
      window.dispatchEvent(new CustomEvent('sync-item-end', { detail: { folio, phase, itemKey, success: isSuccess } }));
    }
  }

  console.log(`[SYNC] Completado. Sincronizados: ${synced}, Fallidos: ${failed}`);
  isSyncing = false;
  onComplete?.({ synced, failed });
}

/**
 * Registra listeners globales para sincronización automática.
 */
export function registerAutoSync(onComplete?: SyncCallback): void {
  window.addEventListener('online', () => {
    console.log('[SYNC] Conexión detectada. Intentando sincronizar...');
    syncPendingReports(onComplete);
  });

  const conn = (navigator as any).connection;
  if (conn) {
    conn.addEventListener('change', () => {
      if (hasGoodConnection()) {
        console.log('[SYNC] Mejora de red detectada. Sincronizando...');
        syncPendingReports(onComplete);
      }
    });
  }

  syncPendingReports(onComplete);
}
