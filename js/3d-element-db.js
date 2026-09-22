/**
 * OpenFishTools Studio - 3D Element Model Database (ThreeDB)
 * IndexedDB persistence layer for storing 3D models (GLTF/GLB assets).
 */
(function (window) {
  'use strict';

  var DB_NAME = 'FishTools3DModels';
  var DB_VERSION = 1;
  var STORE_NAME = 'models';

  var dbInstance = null;
  var initPromise = null;

  /**
   * Generates a UUID v4 string with cryptographic security and fallback.
   * @returns {string} RFC4122 compliant UUID
   */
  function generateUUID() {
    if (typeof crypto !== 'undefined') {
      if (typeof crypto.randomUUID === 'function') {
        try {
          return crypto.randomUUID();
        } catch (_) {}
      }
      if (typeof crypto.getRandomValues === 'function') {
        try {
          return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, function (c) {
            return (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16);
          });
        } catch (_) {}
      }
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Converts a File, Blob, or ArrayBuffer into an ArrayBuffer.
   * @param {File|Blob|ArrayBuffer} input
   * @returns {Promise<ArrayBuffer>}
   */
  function toArrayBuffer(input) {
    if (input instanceof ArrayBuffer) {
      return Promise.resolve(input);
    }
    if (ArrayBuffer.isView(input)) {
      return Promise.resolve(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    }
    if (input && typeof input.arrayBuffer === 'function') {
      return input.arrayBuffer();
    }
    if (input instanceof Blob) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve(reader.result);
        };
        reader.onerror = function () {
          reject(reader.error || new Error('Failed to read Blob as ArrayBuffer'));
        };
        reader.readAsArrayBuffer(input);
      });
    }
    return Promise.reject(new TypeError('Invalid file/blob provided to toArrayBuffer'));
  }

  var ThreeDB = {
    /**
     * Initializes or retrieves the existing IndexedDB connection.
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
      if (dbInstance) {
        return dbInstance;
      }
      if (initPromise) {
        return initPromise;
      }

      initPromise = new Promise(function (resolve, reject) {
        var idb = (typeof window !== 'undefined' && (window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB)) ||
                  (typeof indexedDB !== 'undefined' ? indexedDB : null);

        if (!idb) {
          initPromise = null;
          return reject(new Error('IndexedDB is not supported in this environment'));
        }

        var request = idb.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = function (event) {
          var db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };

        request.onsuccess = function (event) {
          dbInstance = event.target.result;

          dbInstance.onversionchange = function () {
            if (dbInstance) {
              dbInstance.close();
              dbInstance = null;
              initPromise = null;
            }
          };

          dbInstance.onclose = function () {
            dbInstance = null;
            initPromise = null;
          };

          resolve(dbInstance);
        };

        request.onerror = function () {
          initPromise = null;
          reject(request.error || new Error('Failed to open IndexedDB ' + DB_NAME));
        };

        request.onblocked = function () {
          console.warn('[ThreeDB] Database open request is blocked by an open connection');
        };
      });

      return initPromise;
    },

    /**
     * Saves a 3D model File or Blob into IndexedDB.
     * @param {File|Blob} file - The file/blob to store.
     * @returns {Promise<{id: string, name: string, size: number, type: string, createdAt: number}>}
     */
    async saveModel(file) {
      if (!file) {
        throw new Error('No file or blob provided to saveModel');
      }

      var db = await this.init();
      var dataBuffer = await toArrayBuffer(file);

      var id = generateUUID();
      var name = (file && file.name) ? file.name : ('model_' + Date.now() + '.glb');
      var size = (file && typeof file.size === 'number' && file.size > 0) ? file.size : dataBuffer.byteLength;
      var type = (file && file.type) ? file.type : 'model/gltf-binary';
      var createdAt = Date.now();

      var record = {
        id: id,
        name: name,
        data: dataBuffer,
        size: size,
        type: type,
        createdAt: createdAt
      };

      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.add(record);

        req.onsuccess = function () {
          resolve({
            id: record.id,
            name: record.name,
            size: record.size,
            type: record.type,
            createdAt: record.createdAt
          });
        };

        req.onerror = function () {
          reject(req.error || new Error('Failed to save model: ' + id));
        };

        tx.onerror = function () {
          reject(tx.error || new Error('Transaction error while saving model: ' + id));
        };
      });
    },

    /**
     * Retrieves a model by its ID, including full binary data.
     * @param {string} id - UUID of the model
     * @returns {Promise<{id: string, name: string, data: ArrayBuffer, size: number, type: string, createdAt: number}|null>}
     */
    async getModel(id) {
      if (!id) {
        throw new Error('Model ID must be provided to getModel');
      }

      var db = await this.init();

      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.get(id);

        req.onsuccess = function () {
          resolve(req.result || null);
        };

        req.onerror = function () {
          reject(req.error || new Error('Failed to retrieve model: ' + id));
        };

        tx.onerror = function () {
          reject(tx.error || new Error('Transaction error while reading model: ' + id));
        };
      });
    },

    /**
     * Deletes a model by its ID.
     * @param {string} id - UUID of the model to delete
     * @returns {Promise<boolean>}
     */
    async deleteModel(id) {
      if (!id) {
        throw new Error('Model ID must be provided to deleteModel');
      }

      var db = await this.init();

      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.delete(id);

        req.onsuccess = function () {
          resolve(true);
        };

        req.onerror = function () {
          reject(req.error || new Error('Failed to delete model: ' + id));
        };

        tx.onerror = function () {
          reject(tx.error || new Error('Transaction error while deleting model: ' + id));
        };
      });
    },

    /**
     * Lists all models without loading their ArrayBuffer payloads into memory.
     * @returns {Promise<Array<{id: string, name: string, size: number, type: string, createdAt: number}>>}
     */
    async listModels() {
      var db = await this.init();

      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.openCursor();
        var models = [];

        req.onsuccess = function (event) {
          var cursor = event.target.result;
          if (cursor) {
            var val = cursor.value;
            models.push({
              id: val.id,
              name: val.name,
              size: val.size,
              type: val.type,
              createdAt: val.createdAt
            });
            cursor.continue();
          } else {
            resolve(models);
          }
        };

        req.onerror = function () {
          reject(req.error || new Error('Failed to list models'));
        };

        tx.onerror = function () {
          reject(tx.error || new Error('Transaction error while listing models'));
        };
      });
    },

    /**
     * Clears all stored models.
     * @returns {Promise<boolean>}
     */
    async clear() {
      var db = await this.init();

      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.clear();

        req.onsuccess = function () {
          resolve(true);
        };

        req.onerror = function () {
          reject(req.error || new Error('Failed to clear models store'));
        };

        tx.onerror = function () {
          reject(tx.error || new Error('Transaction error while clearing models store'));
        };
      });
    }
  };

  if (typeof window !== 'undefined') {
    window.ThreeDB = ThreeDB;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreeDB;
  }
})(typeof window !== 'undefined' ? window : this);
