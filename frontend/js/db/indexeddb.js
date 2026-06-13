const DB_NAME = 'DaniMarvisPanel_DB';
const DB_VERSION = 1;

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new Error('No se pudo abrir IndexedDB'));
    request.onsuccess = (e) => resolve(e.target.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('providers')) {
        db.createObjectStore('providers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sales')) {
        const ss = db.createObjectStore('sales', { keyPath: 'id' });
        ss.createIndex('product_id', 'product_id', { unique: false });
        ss.createIndex('sale_date', 'sale_date', { unique: false });
      }
      if (!db.objectStoreNames.contains('cache_meta')) {
        db.createObjectStore('cache_meta', { keyPath: 'key' });
      }
    };
  });
}

export async function dbGetAll(storeName) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(`Error leyendo ${storeName}`));
  });
}

export async function dbPutAll(storeName, items) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    items.forEach(item => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Error escribiendo en ${storeName}`));
  });
}

export async function dbClear(storeName) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Error limpiando ${storeName}`));
  });
}

export async function getCacheTime(key) {
  const db = await initDB();
  return new Promise((resolve) => {
    const req = db.transaction('cache_meta', 'readonly').objectStore('cache_meta').get(key);
    req.onsuccess = () => resolve(req.result?.timestamp || 0);
    req.onerror = () => resolve(0);
  });
}

export async function setCacheTime(key, timestamp) {
  const db = await initDB();
  const tx = db.transaction('cache_meta', 'readwrite');
  tx.objectStore('cache_meta').put({ key, timestamp: timestamp ?? Date.now() });
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej();
  });
}
