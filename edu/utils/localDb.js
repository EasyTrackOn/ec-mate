// localDb.js
const DB_NAME = 'EliteCampusERP';
const DB_VERSION = 1;

export const CacheEngine = {
  db: null,

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('collections')) {
          db.createObjectStore('collections', { keyPath: 'path' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'queueId', autoIncrement: true });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async setCache(path, dataArray) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['collections'], 'readwrite');
      tx.objectStore('collections').put({ path, data: dataArray, lastSync: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  async getCache(path) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['collections'], 'readonly');
      const req = tx.objectStore('collections').get(path);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = (e) => reject(e.target.error);
    });
  },

  async queueOperation(operation, path, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['syncQueue'], 'readwrite');
      tx.objectStore('syncQueue').add({ operation, path, data, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
};