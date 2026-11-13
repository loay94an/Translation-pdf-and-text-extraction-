/**
 * IndexedDB storage utility for large PDF documents, pages, and translated blocks.
 * Prevents memory loss and storage limits of localStorage when dealing with 50MB+ PDFs.
 */

const DB_NAME = 'LensPDFTranslatorDB';
const DB_VERSION = 1;
const STORE_TRANSLATIONS = 'translations';
const STORE_DOCUMENTS = 'documents';

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_TRANSLATIONS)) {
        db.createObjectStore(STORE_TRANSLATIONS, { keyPath: 'id' }); // id = docId_pageNumber
      }
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' });
      }
    };
  });
}

export async function saveTranslationToIDB(
  docKey: string,
  pageNumber: number,
  data: any
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRANSLATIONS, 'readwrite');
    const store = transaction.objectStore(STORE_TRANSLATIONS);
    const id = `${docKey}_p_${pageNumber}`;
    const record = { id, docKey, pageNumber, data, updatedAt: Date.now() };

    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getTranslationFromIDB(docKey: string, pageNumber: number): Promise<any | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRANSLATIONS, 'readonly');
    const store = transaction.objectStore(STORE_TRANSLATIONS);
    const id = `${docKey}_p_${pageNumber}`;

    const request = store.get(id);
    request.onsuccess = () => resolve(request.result ? request.result.data : null);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllTranslationsForDoc(docKey: string): Promise<Record<number, any>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TRANSLATIONS, 'readonly');
    const store = transaction.objectStore(STORE_TRANSLATIONS);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result || [];
      const map: Record<number, any> = {};
      for (const item of results) {
        if (item.docKey === docKey) {
          map[item.pageNumber] = item.data;
        }
      }
      resolve(map);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveDocumentBufferToIDB(docKey: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_DOCUMENTS, 'readwrite');
    const store = transaction.objectStore(STORE_DOCUMENTS);
    const request = store.put({ id: docKey, buffer, updatedAt: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getDocumentBufferFromIDB(docKey: string): Promise<ArrayBuffer | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_DOCUMENTS, 'readonly');
    const store = transaction.objectStore(STORE_DOCUMENTS);
    const request = store.get(docKey);
    request.onsuccess = () => resolve(request.result ? request.result.buffer : null);
    request.onerror = () => reject(request.error);
  });
}
