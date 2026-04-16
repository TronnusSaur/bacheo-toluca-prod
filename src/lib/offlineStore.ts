/**
 * offlineStore.ts
 * Wrapper sencillo alrededor de IndexedDB para guardar reportes pendientes de
 * sincronización cuando no hay conexión a internet.
 */

const DB_NAME = 'bacheo-offline';
const STORE_NAME = 'pending-reports';
const DB_VERSION = 1;

/** Abre (o crea) la base de datos IndexedDB */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB no está disponible en este navegador.');
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('Error al abrir base de datos local.'));
    } catch (e) {
      reject(e);
    }
  });
}

export interface PendingReport {
  id?: number;
  /** 'APERTURA' para nuevos baches, 'UPDATE' para fotos de Caja/Final */
  type: 'APERTURA' | 'UPDATE';
  /** La fase de la foto: inicial, caja, terminado */
  phase: 'inicial' | 'caja' | 'terminado';
  /** Los campos del formulario como objeto plano */
  fields: {
    folio: string;
    contractId: string;
    empresaName: string;
    lat: number;
    lng: number;
    largo: string;
    ancho: string;
    profundidad: string;
    m2: string;
    locationDesc: string;
    calle1: string;
    calle2: string;
    delegacion: string;
    colonia: string;
    tipoBache: string;
  };
  /** La foto comprimida como ArrayBuffer (nullable si no se tomó) */
  photoBuffer: ArrayBuffer | null;
  savedAt: string; // ISO date string
  /** Indica si el servidor falló con 404 (para iconografía especial) */
  serverMissing?: boolean;
}

/** Guarda un reporte pendiente en IndexedDB */
export async function savePendingReport(report: PendingReport): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(report);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

/** Obtiene todos los reportes pendientes */
export async function getPendingReports(): Promise<PendingReport[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as PendingReport[]);
    req.onerror = () => reject(req.error);
  });
}

/** Elimina un reporte pendiente por su id (tras sincronizar con éxito) */
export async function clearPendingReport(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Cuenta cuántos reportes están pendientes */
export async function countPendingReports(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
