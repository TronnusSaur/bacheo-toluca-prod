/**
 * robustStore.ts
 * Gestor robusto de almacenamiento local offline.
 * - Soporta transacciones aisladas por Folio y Fase (inicial, caja, terminado).
 * - Guarda archivos JSON y fotos (.jpg) físicamente en disco usando Capacitor (Android nativo).
 * - Mantiene IndexedDB como fallback en Web.
 * - Mantiene la cola de transacciones pendientes en orden cronológico en Preferences.
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

// Directorio físico en disco nativo
const REPORTS_DIR = 'reports';

// Configuración de IndexedDB Fallback (para Web convencional)
const DB_NAME = 'bacheo-robust-offline';
const STORE_DATA_NAME = 'reports-json';
const STORE_PHOTOS_NAME = 'reports-photos';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB no disponible'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DATA_NAME)) {
        db.createObjectStore(STORE_DATA_NAME, { keyPath: 'id' }); // id: "folio_phase"
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS_NAME)) {
        db.createObjectStore(STORE_PHOTOS_NAME, { keyPath: 'id' }); // id: "folio_phase"
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Convertidor utilitario: Blob a Base64 string (para Capacitor Filesystem)
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Convertidor utilitario: Base64 string a Blob
export const base64ToBlob = (base64: string, mimeType = 'image/jpeg'): Blob => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
};

// Inicializa directorios en Capacitor si es nativo
async function initNatarDirs() {
  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.mkdir({
        path: REPORTS_DIR,
        directory: Directory.Data,
        recursive: true
      });
    } catch (e) {
      // Si ya existe, no hay problema
    }
  }
}

initNatarDirs();

/**
 * 1. Cola de transacciones pendientes (folios_fase) ordenados cronológicamente
 */
export async function getPendingItems(): Promise<string[]> {
  const { value } = await Preferences.get({ key: 'pending_sync_items' });
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export async function addPendingItem(itemKey: string): Promise<void> {
  const list = await getPendingItems();
  if (!list.includes(itemKey)) {
    list.push(itemKey);
    await Preferences.set({ key: 'pending_sync_items', value: JSON.stringify(list) });
  }
}

export async function removePendingItem(itemKey: string): Promise<void> {
  const list = await getPendingItems();
  const updated = list.filter(item => item !== itemKey);
  await Preferences.set({ key: 'pending_sync_items', value: JSON.stringify(updated) });
}

/**
 * 2. Guarda los datos JSON de un reporte por Folio y Fase (ej. "010606", "caja")
 */
export async function saveReportJSON(folio: string, phase: string, data: any): Promise<void> {
  const itemKey = `${folio}_${phase}`;
  if (Capacitor.isNativePlatform()) {
    // Android Nativo: Escribir archivo físico reports/folio_phase.json
    await Filesystem.writeFile({
      path: `${REPORTS_DIR}/${itemKey}.json`,
      data: JSON.stringify(data),
      directory: Directory.Data,
      encoding: Encoding.UTF8
    });
  } else {
    // Web Fallback: Guardar en IndexedDB
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATA_NAME, 'readwrite');
      const store = tx.objectStore(STORE_DATA_NAME);
      const req = store.put({ id: itemKey, data });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

/**
 * Obtiene los datos JSON guardados para un Folio y Fase específicos
 */
export async function getReportJSON(folio: string, phase: string): Promise<any | null> {
  const itemKey = `${folio}_${phase}`;
  if (Capacitor.isNativePlatform()) {
    try {
      const { data } = await Filesystem.readFile({
        path: `${REPORTS_DIR}/${itemKey}.json`,
        directory: Directory.Data,
        encoding: Encoding.UTF8
      });
      return JSON.parse(data as string);
    } catch {
      return null;
    }
  } else {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATA_NAME, 'readonly');
      const store = tx.objectStore(STORE_DATA_NAME);
      const req = store.get(itemKey);
      req.onsuccess = () => {
        resolve(req.result ? req.result.data : null);
      };
      req.onerror = () => reject(req.error);
    });
  }
}

/**
 * 3. Guarda una Foto localmente por Folio y Fase
 */
export async function saveReportPhoto(folio: string, phase: string, blob: Blob): Promise<string> {
  const itemKey = `${folio}_${phase}`;
  if (Capacitor.isNativePlatform()) {
    const base64 = await blobToBase64(blob);
    const fileName = `${REPORTS_DIR}/${itemKey}.jpg`;
    
    // Guardar archivo binario de la imagen
    await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Data
    });

    const uriResult = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Data
    });
    return uriResult.uri;
  } else {
    // Web Fallback: Guardar en IndexedDB
    const arrayBuffer = await blob.arrayBuffer();
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PHOTOS_NAME, 'readwrite');
      const store = tx.objectStore(STORE_PHOTOS_NAME);
      const req = store.put({ id: itemKey, arrayBuffer, type: blob.type });
      req.onsuccess = () => resolve(`indexeddb://${itemKey}`);
      req.onerror = () => reject(req.error);
    });
  }
}

/**
 * Obtiene el Blob de una foto guardada
 */
export async function getReportPhoto(folio: string, phase: string): Promise<Blob | null> {
  const itemKey = `${folio}_${phase}`;
  if (Capacitor.isNativePlatform()) {
    try {
      const fileName = `${REPORTS_DIR}/${itemKey}.jpg`;
      const { data } = await Filesystem.readFile({
        path: fileName,
        directory: Directory.Data
      });
      return base64ToBlob(data as string);
    } catch {
      return null;
    }
  } else {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PHOTOS_NAME, 'readonly');
      const store = tx.objectStore(STORE_PHOTOS_NAME);
      const req = store.get(itemKey);
      req.onsuccess = () => {
        if (!req.result) return resolve(null);
        const blob = new Blob([req.result.arrayBuffer], { type: req.result.type || 'image/jpeg' });
        resolve(blob);
      };
      req.onerror = () => reject(req.error);
    });
  }
}

/**
 * 4. Limpia los archivos vinculados a un Folio y Fase específica una vez sincronizados
 */
export async function clearReportFiles(folio: string, phase: string): Promise<void> {
  const itemKey = `${folio}_${phase}`;
  
  // Remover de la cola de transacciones
  await removePendingItem(itemKey);

  if (Capacitor.isNativePlatform()) {
    // Eliminar el JSON y JPG específico de esta fase
    const files = [
      `${REPORTS_DIR}/${itemKey}.json`,
      `${REPORTS_DIR}/${itemKey}.jpg`
    ];
    for (const file of files) {
      try {
        await Filesystem.deleteFile({
          path: file,
          directory: Directory.Data
        });
        console.log(`[ROBUST STORE] Eliminado archivo de transacción: ${file}`);
      } catch {
        // Ignorar si el archivo no existe
      }
    }
  } else {
    // Web Fallback: Eliminar de IndexedDB
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_DATA_NAME, STORE_PHOTOS_NAME], 'readwrite');
      
      tx.objectStore(STORE_DATA_NAME).delete(itemKey);
      tx.objectStore(STORE_PHOTOS_NAME).delete(itemKey);

      tx.oncomplete = () => {
        console.log(`[ROBUST STORE] Datos e imágenes de la transacción ${itemKey} eliminados.`);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Limpia por completo la cola y el almacenamiento offline (útil para reinicios y pruebas).
 */
export async function clearAllOfflineStorage(): Promise<void> {
  await Preferences.remove({ key: 'pending_sync_items' });
  await Preferences.remove({ key: 'cached_reports_list' });
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_DATA_NAME, STORE_PHOTOS_NAME], 'readwrite');
      tx.objectStore(STORE_DATA_NAME).clear();
      tx.objectStore(STORE_PHOTOS_NAME).clear();
      console.log('[ROBUST STORE] Almacenamiento offline purgado al 100%.');
    } catch (e) {
      console.warn('[ROBUST STORE] Error al purgar IndexedDB:', e);
    }
  }
}

