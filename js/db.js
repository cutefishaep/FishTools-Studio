/**
 * OpenFishTools Studio - Database Persistence Layer (FishDatabase)
 * Manages Settings & Projects using IndexedDB with fallback to localStorage
 * and seamless project CRUD operations (Create, Read, Update, Delete, Duplicate).
 */

window.FishDatabase = (function () {
  var DB_NAME = 'FishStudioDB';
  var DB_VERSION = 3;
  var SETTINGS_KEY = 'fishtools_save';
  var SETTINGS_KEY_ALT = 'fishToolsFileStore';
  var PROJECTS_KEY = 'fishtools_projects';
  var MEDIA_KEY = 'fishtools_media';
  var DELETED_IDS_KEY = 'fishtools_deleted_ids';

  var dbPromise = null;
  var _deletedIds = new Set();
  try {
    var _storedDeleted = localStorage.getItem(DELETED_IDS_KEY);
    if (_storedDeleted) {
      var _parsedDeleted = JSON.parse(_storedDeleted);
      if (Array.isArray(_parsedDeleted)) {
        _parsedDeleted.forEach(function (delId) {
          if (delId) {
            _deletedIds.add(delId);
            _deletedIds.add(String(delId).trim());
          }
        });
      }
    }
  } catch (_) {}

  function _saveDeletedIds() {
    try {
      localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(_deletedIds)));
    } catch (_) {}
  }

  function getDefaultSettings() {
    return {
      config: {
        version: 'Latest',
        theme: 'dark',
        uiStyle: 'simple',
        animEnabled: true,
        snapScroll: false,
        tipsEnabled: false,
        lastTab: 'main'
      },
      customPalettes: [],
      toolboxPresets: {},
      customEasingPresets: [],
      recentColors: []
    };
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      var isResolved = false;
      function done(val) {
        if (isResolved) return;
        isResolved = true;
        resolve(val);
      }

      // Safety timeout: Never hang app if indexedDB is blocked or stalled
      var safetyTimer = setTimeout(function () {
        console.warn('FishDatabase openDB timeout, falling back to localStorage');
        done(null);
      }, 1500);

      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('projects')) {
            db.createObjectStore('projects', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('media')) {
            var mediaStore = db.createObjectStore('media', { keyPath: 'id' });
            mediaStore.createIndex('projectId', 'projectId', { unique: false });
          } else {
            var tx = e.target.transaction;
            if (tx) {
              var mediaStore = tx.objectStore('media');
              if (mediaStore && !mediaStore.indexNames.contains('projectId')) {
                mediaStore.createIndex('projectId', 'projectId', { unique: false });
              }
            }
          }
        };
        req.onsuccess = function (e) {
          clearTimeout(safetyTimer);
          var db = e.target.result;
          db.onversionchange = function () {
            try { db.close(); } catch (_) {}
            dbPromise = null;
          };
          db.onclose = function () {
            dbPromise = null;
          };
          done(db);
        };
        req.onerror = function (e) {
          clearTimeout(safetyTimer);
          console.warn('FishDatabase IndexedDB open error, using localStorage fallback:', e);
          done(null);
        };
        req.onblocked = function (e) {
          clearTimeout(safetyTimer);
          console.warn('FishDatabase open blocked by another connection, using localStorage fallback');
          done(null);
        };
      } catch (err) {
        clearTimeout(safetyTimer);
        done(null);
      }
    });
    return dbPromise;
  }
  async function requestPersistentStorage() {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
      try {
        var isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          await navigator.storage.persist();
        }
      } catch (_) {}
    }
  }

  async function init() {
    await requestPersistentStorage();
    await cleanupLegacyData();
    await openDB();
  }

  // Synchronous localStorage project helpers
  function getLocalProjects() {
    try {
      var raw = localStorage.getItem(PROJECTS_KEY);
      if (!raw) return [];
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function stripDeadBlobUrls(proj) {
    if (!proj) return proj;
    function cleanLayer(l) {
      if (!l) return;
      if (l.dataUrl && typeof l.dataUrl === 'string' && l.dataUrl.startsWith('blob:')) l.dataUrl = '';
      if (l.thumbUrl && typeof l.thumbUrl === 'string' && l.thumbUrl.startsWith('blob:')) l.thumbUrl = '';
      if (l.fillMediaUrl && typeof l.fillMediaUrl === 'string' && l.fillMediaUrl.startsWith('blob:')) l.fillMediaUrl = '';
      if (Array.isArray(l.layers)) l.layers.forEach(cleanLayer);
    }
    if (proj.previewUrl && typeof proj.previewUrl === 'string' && proj.previewUrl.startsWith('blob:')) proj.previewUrl = '';
    if (proj.thumbnail && typeof proj.thumbnail === 'string' && proj.thumbnail.startsWith('blob:')) proj.thumbnail = '';
    if (Array.isArray(proj.layers)) proj.layers.forEach(cleanLayer);
    return proj;
  }

  function saveLocalProjects(list) {
    if (!list || !Array.isArray(list)) return;

    function sanitizeLayer(l) {
      if (!l) return l;
      var lClone = Object.assign({}, l);
      // Strip all heavy base64 / blob / frame data from localStorage mirror (full data safely stored in IndexedDB)
      if (lClone.dataUrl && (lClone.dataUrl.startsWith('blob:') || lClone.dataUrl.startsWith('data:') || lClone.dataUrl.length > 100)) lClone.dataUrl = '';
      if (lClone.thumbUrl && (lClone.thumbUrl.startsWith('blob:') || lClone.thumbUrl.startsWith('data:') || lClone.thumbUrl.length > 100)) lClone.thumbUrl = '';
      if (lClone.fillMediaUrl && (lClone.fillMediaUrl.startsWith('blob:') || lClone.fillMediaUrl.startsWith('data:') || lClone.fillMediaUrl.length > 100)) lClone.fillMediaUrl = '';
      if (Array.isArray(lClone.videoFrames)) lClone.videoFrames = [];
      delete lClone._shapeBufferCanvas;
      delete lClone._precompBufferCanvas;
      delete lClone._fillBufferCanvas;
      delete lClone._textBufferCanvas;
      delete lClone._fillMediaImg;
      delete lClone._alphaHitCanvas;
      delete lClone._alphaHitCtx;
      delete lClone._canvasBounds;
      if (Array.isArray(lClone.layers)) {
        lClone.layers = lClone.layers.map(sanitizeLayer);
      }
      return lClone;
    }

    function sanitizeProject(p) {
      if (!p) return p;
      var pClone = Object.assign({}, p);
      if (pClone.previewUrl && (pClone.previewUrl.startsWith('data:') || pClone.previewUrl.length > 200)) {
        pClone.previewUrl = '';
      }
      if (pClone.thumbnail && (pClone.thumbnail.startsWith('data:') || pClone.thumbnail.length > 200)) {
        pClone.thumbnail = '';
      }
      if (Array.isArray(p.layers)) {
        pClone.layers = p.layers.map(sanitizeLayer);
      }
      return pClone;
    }

    try {
      var sanitized = list.map(sanitizeProject);
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(sanitized));
      return;
    } catch (e1) {
      // Stage 2 fallback: If localStorage quota is exceeded, keep full layers on the newest project and strip heavy layers on older projects
      try {
        var partialSanitized = list.map(function (p, idx) {
          if (!p) return p;
          if (idx === 0) {
            return sanitizeProject(p);
          }
          return {
            id: p.id,
            name: p.name,
            aspectRatio: p.aspectRatio,
            fps: p.fps,
            width: p.width,
            height: p.height,
            duration: p.duration,
            updatedAt: p.updatedAt,
            createdAt: p.createdAt,
            layers: Array.isArray(p.layers) ? p.layers.map(function (l) { return { id: l.id, name: l.name, type: l.type }; }) : [],
            layerCount: Array.isArray(p.layers) ? p.layers.length : 0
          };
        });
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(partialSanitized));
        return;
      } catch (e2) {
        // Stage 3 fallback: Purge redundant media key from localStorage to reclaim space
        try {
          localStorage.removeItem(MEDIA_KEY);
          var metadataOnly2 = list.map(function (p) {
            if (!p) return p;
            return {
              id: p.id,
              name: p.name,
              aspectRatio: p.aspectRatio,
              fps: p.fps,
              width: p.width,
              height: p.height,
              duration: p.duration,
              updatedAt: p.updatedAt,
              createdAt: p.createdAt
            };
          });
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(metadataOnly2));
        } catch (_) {
          // IndexedDB has already persisted full project data with 100% fidelity; safe to ignore
        }
      }
    }
  }

  /**
   * Cleans legacy dummy mock data and legacy IndexedDB database instances
   */
  async function cleanupLegacyData() {
    if (typeof window !== 'undefined' && window.indexedDB && typeof window.indexedDB.deleteDatabase === 'function') {
      var legacyDbs = [
        'FishTool_Studio_DB',
        'FishTool_MediaStorage_DB',
        'FishTool_Projects_DB',
        'fishTool_media_db',
        'fishTool_projects_db'
      ];
      legacyDbs.forEach(function (name) {
        try {
          window.indexedDB.deleteDatabase(name);
        } catch (_) {}
      });
    }

    // Immediate localStorage Quota Recovery: Purge bloated base64 from stale localStorage items
    try {
      var localMedia = getLocalMedia();
      if (Array.isArray(localMedia) && localMedia.length > 0) {
        saveLocalMedia(localMedia);
      }
      var localList = getLocalProjects();
      var filtered = localList.filter(function (p) {
        return p && p.id && !p.id.startsWith('prj-00') && !_deletedIds.has(p.id) && !_deletedIds.has(String(p.id).trim());
      });
      saveLocalProjects(filtered);
    } catch (_) {}

    var db = await openDB();
    if (db) {
      try {
        var tx = db.transaction('projects', 'readwrite');
        var store = tx.objectStore('projects');
        var req = store.getAll();
        req.onsuccess = function () {
          var all = req.result || [];
          all.forEach(function (p) {
            if (p && p.id && (p.id.startsWith('prj-00') || _deletedIds.has(p.id) || _deletedIds.has(String(p.id).trim()))) {
              try { store.delete(p.id); } catch (_) {}
            }
          });
        };
      } catch (e) {
        console.warn('[DB] Failed to prune dummy/deleted projects:', e);
      }
    }
  }

  async function init() {
    var db = await openDB();
    var localRaw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(SETTINGS_KEY_ALT);
    if (!localRaw) {
      var seed = getDefaultSettings();
      await saveSettings(seed);
    } else if (db) {
      try {
        var parsed = JSON.parse(localRaw);
        if (!parsed.config) parsed = getDefaultSettings();
        await saveSettings(parsed);
      } catch (e) {
        await saveSettings(getDefaultSettings());
      }
    }

    // Execute cleanup of legacy mock data on init
    await cleanupLegacyData();
  }

  // --- Settings APIs ---
  function getSyncSettings() {
    var raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(SETTINGS_KEY_ALT);
    if (!raw) {
      var defaultSettings = getDefaultSettings();
      raw = JSON.stringify(defaultSettings);
      localStorage.setItem(SETTINGS_KEY, raw);
      localStorage.setItem(SETTINGS_KEY_ALT, raw);
    }
    return raw;
  }

  function saveSyncSettings(rawString) {
    if (typeof rawString !== 'string') {
      try { rawString = JSON.stringify(rawString); } catch (e) { return; }
    }
    localStorage.setItem(SETTINGS_KEY, rawString);
    localStorage.setItem(SETTINGS_KEY_ALT, rawString);
    try {
      var dataObj = JSON.parse(rawString);
      saveSettings(dataObj).catch(function (err) {
        console.warn('[DB] saveSettings promise rejected:', err);
      });
    } catch (e) {
      console.warn('[DB] Failed to parse settings JSON:', e);
    }
  }

  async function getSettings() {
    var db = await openDB();
    if (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('settings', 'readonly');
          var store = tx.objectStore('settings');
          var req = store.get('current');
          req.onsuccess = function () {
            if (req.result && req.result.data) {
              resolve(req.result.data);
            } else {
              resolve(JSON.parse(getSyncSettings()));
            }
          };
          req.onerror = function () { resolve(JSON.parse(getSyncSettings())); };
        } catch (e) {
          resolve(JSON.parse(getSyncSettings()));
        }
      });
    }
    return JSON.parse(getSyncSettings());
  }

  async function saveSettings(settingsObj) {
    if (!settingsObj) return;
    var rawString = JSON.stringify(settingsObj);
    localStorage.setItem(SETTINGS_KEY, rawString);
    localStorage.setItem(SETTINGS_KEY_ALT, rawString);

    var db = await openDB();
    if (db) {
      try {
        var tx = db.transaction('settings', 'readwrite');
        var store = tx.objectStore('settings');
        store.put({ key: 'current', data: settingsObj, updatedAt: new Date().toISOString() });
      } catch (e) {
        console.warn('[DB] Failed to persist settings to IndexedDB:', e);
      }
    }

    window.dispatchEvent(new CustomEvent('fish-db-settings-updated', { detail: settingsObj }));
  }

  // --- Project CRUD Operations ---

  /**
   * Retrieves all projects from DB sorted by last updated descending
   * @returns {Promise<Array>}
   */
  /**
   * Strips all heavy layer/media data from a project object.
   * Returns only lightweight metadata fields needed for dashboard listing.
   * This prevents Safari (and all browsers) from spiking memory when
   * getAll() dumps full project blobs into the main thread at once.
   */
  function _projectToListMeta(p) {
    if (!p) return p;
    return {
      id: p.id,
      name: p.name,
      aspectRatio: p.aspectRatio,
      resolution: p.resolution,
      fps: p.fps,
      width: p.width,
      height: p.height,
      duration: p.duration,
      size: p.size,
      sizeBytes: p.sizeBytes,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
      layerCount: Array.isArray(p.layers) ? p.layers.length : (p.layerCount || 0)
    };
  }

  async function getProjects() {
    var db = await openDB();
    if (db) {
      return new Promise(function (resolve) {
        var safetyTimer = setTimeout(function () {
          var local = getLocalProjects().filter(function (p) {
            return p && p.id && !p.id.startsWith('prj-00') && !_deletedIds.has(p.id) && !_deletedIds.has(String(p.id).trim());
          });
          resolve(local.map(_projectToListMeta));
        }, 1500);

        try {
          var tx = db.transaction('projects', 'readonly');
          var store = tx.objectStore('projects');
          var req = store.getAll();
          req.onsuccess = function () {
            clearTimeout(safetyTimer);
            var items = req.result || [];
            // Filter out any stale prj-00 mock items and deleted projects
            items = items.filter(function (p) {
              return p && p.id && !p.id.startsWith('prj-00') && !_deletedIds.has(p.id) && !_deletedIds.has(String(p.id).trim());
            });
            // Sort latest updated first
            items.sort(function (a, b) {
              var tA = new Date(a.updatedAt || a.createdAt || 0).getTime();
              var tB = new Date(b.updatedAt || b.createdAt || 0).getTime();
              return tB - tA;
            });
            // Update localStorage sync copy with full data (strip heavy for storage limits)
            saveLocalProjects(items);
            // Return only lightweight metadata — avoids memory spike on Safari
            resolve(items.map(_projectToListMeta));
          };
          req.onerror = function () {
            clearTimeout(safetyTimer);
            var local = getLocalProjects().filter(function (p) {
              return p && p.id && !p.id.startsWith('prj-00') && !_deletedIds.has(p.id) && !_deletedIds.has(String(p.id).trim());
            });
            resolve(local.map(_projectToListMeta));
          };
        } catch (e) {
          clearTimeout(safetyTimer);
          var local = getLocalProjects().filter(function (p) {
            return p && p.id && !p.id.startsWith('prj-00') && !_deletedIds.has(p.id) && !_deletedIds.has(String(p.id).trim());
          });
          resolve(local.map(_projectToListMeta));
        }
      });
    }
    var local = getLocalProjects().filter(function (p) {
      return p && p.id && !p.id.startsWith('prj-00') && !_deletedIds.has(p.id) && !_deletedIds.has(String(p.id).trim());
    });
    return local.map(_projectToListMeta);
  }

  /**
   * Retrieves single project by ID
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async function getProject(id) {
    if (!id || _deletedIds.has(id) || _deletedIds.has(String(id).trim())) return null;
    var db = await openDB();
    if (db) {
      return new Promise(function (resolve) {
        var safetyTimer = setTimeout(function () {
          var found = getLocalProjects().find(function (p) { return p.id === id; });
          resolve(found || null);
        }, 1500);

        try {
          var tx = db.transaction('projects', 'readonly');
          var store = tx.objectStore('projects');
          var req = store.get(id);
          req.onsuccess = function () {
            clearTimeout(safetyTimer);
            if (_deletedIds.has(id) || _deletedIds.has(String(id).trim())) {
              resolve(null);
              return;
            }
            if (req.result) {
              resolve(stripDeadBlobUrls(req.result));
            } else {
              var found = getLocalProjects().find(function (p) { return p.id === id; });
              resolve(stripDeadBlobUrls(found) || null);
            }
          };
          req.onerror = function () {
            clearTimeout(safetyTimer);
            var found = getLocalProjects().find(function (p) { return p.id === id; });
            resolve(stripDeadBlobUrls(found) || null);
          };
        } catch (e) {
          clearTimeout(safetyTimer);
          var found = getLocalProjects().find(function (p) { return p.id === id; });
          resolve(stripDeadBlobUrls(found) || null);
        }
      });
    }
    var found = getLocalProjects().find(function (p) { return p.id === id; });
    return stripDeadBlobUrls(found) || null;
  }

  /**
   * Helper: formats bytes into human-readable string (B, KB, MB, GB)
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var k = 1024;
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i >= units.length) i = units.length - 1;
    if (i === 0) return bytes + ' B';
    var val = bytes / Math.pow(k, i);
    var formatted = val >= 100 ? Math.round(val) : parseFloat(val.toFixed(1));
    return formatted + ' ' + units[i];
  }

  function prepareProjectForStorage(p) {
    if (!p) return p;
    var pClone = Object.assign({}, p);
    delete pClone.cache;
    delete pClone.previewCache;
    delete pClone.renderedFrames;
    if (pClone.previewUrl && typeof pClone.previewUrl === 'string' && pClone.previewUrl.startsWith('blob:')) pClone.previewUrl = '';
    if (pClone.thumbnail && typeof pClone.thumbnail === 'string' && pClone.thumbnail.startsWith('blob:')) pClone.thumbnail = '';
    if (Array.isArray(p.layers)) {
      pClone.layers = p.layers.map(function (l) {
        if (!l) return l;
        var lClone = Object.assign({}, l);
        if (lClone.dataUrl && typeof lClone.dataUrl === 'string' && lClone.dataUrl.startsWith('blob:')) lClone.dataUrl = '';
        if (lClone.thumbUrl && typeof lClone.thumbUrl === 'string' && lClone.thumbUrl.startsWith('blob:')) lClone.thumbUrl = '';
        if (lClone.fillMediaUrl && typeof lClone.fillMediaUrl === 'string' && lClone.fillMediaUrl.startsWith('blob:')) lClone.fillMediaUrl = '';
        delete lClone._shapeBufferCanvas;
        delete lClone._precompBufferCanvas;
        delete lClone._fillBufferCanvas;
        delete lClone._textBufferCanvas;
        delete lClone._fillMediaImg;
        delete lClone._alphaHitCanvas;
        delete lClone._alphaHitCtx;
        delete lClone._canvasBounds;
        return lClone;
      });
    }
    return pClone;
  }

  /**
   * Saves or updates a project object
   * @param {Object} project
   */
  async function saveProject(project) {
    if (!project || !project.id) return;
    _deletedIds.delete(project.id);
    _deletedIds.delete(String(project.id).trim());
    _saveDeletedIds();
    project.updatedAt = new Date().toISOString();

    // Prepare non-mutating copy for persistence (live project retains active blob: in memory)
    var storageProject = prepareProjectForStorage(project);

    // Default or update JSON size if missing or legacy '12 KB'
    if (!project.size || project.size === '12 KB') {
      try {
        var str = JSON.stringify(storageProject);
        var b = (typeof Blob !== 'undefined') ? new Blob([str]).size : str.length;
        project.size = formatBytes(b);
        project.sizeBytes = b;
        storageProject.size = project.size;
        storageProject.sizeBytes = b;
      } catch (_) {}
    }

    // 1. Sync to localStorage
    var list = getLocalProjects();
    var idx = list.findIndex(function (p) { return p.id === project.id; });
    if (idx >= 0) {
      list[idx] = storageProject;
    } else {
      list.unshift(storageProject);
    }
    saveLocalProjects(list);

    // 2. Sync to IndexedDB with persistence guarantee
    var db = await openDB();
    if (db) {
      await new Promise(function (resolve) {
        var safetyTimer = setTimeout(function () {
          resolve(project);
        }, 800);
        try {
          var tx = db.transaction('projects', 'readwrite');
          var store = tx.objectStore('projects');
          store.put(storageProject);
          tx.oncomplete = function () {
            clearTimeout(safetyTimer);
            window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'save', project: project } }));
            resolve(project);
          };
          tx.onerror = function (e) {
            clearTimeout(safetyTimer);
            try { e.preventDefault(); } catch (_) {}
            window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'save', project: project } }));
            resolve(project);
          };
          tx.onabort = function () {
            clearTimeout(safetyTimer);
            resolve(project);
          };
        } catch (e) {
          clearTimeout(safetyTimer);
          window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'save', project: project } }));
          resolve(project);
        }
      });
    } else {
      window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'save', project: project } }));
    }

    // Asynchronously refresh and persist true total storage size (JSON + media + frame caches)
    setTimeout(function () {
      getProjectTotalSize(project.id).then(function (res) {
        if (res && res.formatted) {
          updateProjectSize(project.id, res.formatted, res.bytes);
        }
      }).catch(function () {});
    }, 60);

    return project;
  }

  /**
   * Updates only the size attributes of a project silently without re-firing update events
   * @param {string} projectId
   * @param {string} formatted
   * @param {number} bytes
   * @returns {Promise<boolean>}
   */
  async function updateProjectSize(projectId, formatted, bytes) {
    if (!projectId || !formatted || _deletedIds.has(projectId) || _deletedIds.has(String(projectId).trim())) return false;

    // 1. Update in-memory / localStorage
    var list = getLocalProjects();
    var found = list.find(function (p) { return p.id === projectId; });
    if (!found) return false; // Project was deleted, never re-insert!

    found.size = formatted;
    if (typeof bytes === 'number') found.sizeBytes = bytes;
    saveLocalProjects(list);

    // 2. Update in IndexedDB
    var db = await openDB();
    if (db && db.objectStoreNames.contains('projects')) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('projects', 'readwrite');
          var store = tx.objectStore('projects');
          var req = store.get(projectId);
          req.onsuccess = function () {
            if (_deletedIds.has(projectId) || _deletedIds.has(String(projectId).trim())) {
              resolve(false);
              return;
            }
            var prj = req.result;
            if (prj) {
              prj.size = formatted;
              if (typeof bytes === 'number') prj.sizeBytes = bytes;
              store.put(prj);
            }
            tx.oncomplete = function () { resolve(true); };
            tx.onerror = function () { resolve(false); };
          };
          req.onerror = function () { resolve(false); };
        } catch (_) {
          resolve(false);
        }
      });
    }
    return true;
  }

  /**
   * Computes the true total storage footprint of a project
   * including project JSON metadata, media blobs in FishStudioDB,
   * and extracted video frame caches in FishFrameCacheDB.
   * @param {string} projectId
   * @returns {Promise<{ bytes: number, formatted: string, breakdown: { jsonBytes: number, mediaBytes: number, cacheBytes: number, jsonFormatted: string, mediaFormatted: string, cacheFormatted: string } }>}
   */
  async function getProjectTotalSize(projectId) {
    var emptyResult = {
      bytes: 0,
      formatted: '0 B',
      breakdown: {
        jsonBytes: 0,
        mediaBytes: 0,
        cacheBytes: 0,
        jsonFormatted: '0 B',
        mediaFormatted: '0 B',
        cacheFormatted: '0 B'
      }
    };
    if (!projectId) return emptyResult;

    var project = await getProject(projectId);
    if (!project) return emptyResult;

    // 1. Base Project JSON footprint
    var jsonBytes = 0;
    try {
      var jsonStr = JSON.stringify(project);
      jsonBytes = (typeof Blob !== 'undefined')
        ? new Blob([jsonStr]).size
        : (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(jsonStr).length : jsonStr.length);
    } catch (_) {}

    // 2. Media items footprint in FishStudioDB (avoiding unnecessary blob URL hydration)
    var mediaList = [];
    try {
      mediaList = await getProjectMedia(projectId, false);
    } catch (_) {}

    var mediaBytes = 0;
    var sourceKeys = new Set();

    if (Array.isArray(mediaList)) {
      for (var i = 0; i < mediaList.length; i++) {
        var m = mediaList[i];
        if (!m) continue;
        if (m.id) sourceKeys.add(m.id);

        var itemSize = 0;
        if (m.blob && typeof m.blob.size === 'number') {
          itemSize += m.blob.size;
        } else if (typeof m.size === 'number' && m.size > 0) {
          itemSize += m.size;
        } else if (typeof m.dataUrl === 'string' && m.dataUrl.startsWith('data:')) {
          var commaIdx = m.dataUrl.indexOf(',');
          var b64Data = commaIdx >= 0 ? m.dataUrl.substring(commaIdx + 1) : m.dataUrl;
          itemSize += Math.round((b64Data.length * 3) / 4);
        }

        if (m.thumbBlob && typeof m.thumbBlob.size === 'number') {
          itemSize += m.thumbBlob.size;
        }

        // Add media metadata JSON overhead
        try {
          var mMeta = Object.assign({}, m);
          delete mMeta.blob;
          delete mMeta.thumbBlob;
          if (mMeta.dataUrl && mMeta.dataUrl.length > 200) mMeta.dataUrl = '';
          var metaStr = JSON.stringify(mMeta);
          itemSize += (typeof Blob !== 'undefined') ? new Blob([metaStr]).size : metaStr.length;
        } catch (_) {}

        mediaBytes += itemSize;
      }
    }

    // Collect layer-specific sourceKeys from project layers
    if (project && Array.isArray(project.layers)) {
      project.layers.forEach(function (layer) {
        if (!layer) return;
        if (layer.mediaId) sourceKeys.add(layer.mediaId);
        if (layer.id) {
          sourceKeys.add(layer.id);
          sourceKeys.add('src_' + layer.id);
        }
        if (layer.name) {
          sourceKeys.add(layer.name);
        }
        if (layer.dataUrl && typeof layer.dataUrl === 'string' && !layer.dataUrl.startsWith('blob:') && layer.dataUrl.length < 500) {
          sourceKeys.add(layer.dataUrl);
        }
      });
    }

    // 3. Extracted frame cache footprint in FishFrameCacheDB
    var cacheBytes = 0;
    if (sourceKeys.size > 0 && typeof indexedDB !== 'undefined') {
      var shouldCheckCache = true;
      if (typeof indexedDB.databases === 'function') {
        try {
          var dbs = await indexedDB.databases();
          var hasFrameDb = dbs && dbs.some(function (d) { return d && d.name === 'FishFrameCacheDB'; });
          if (!hasFrameDb) shouldCheckCache = false;
        } catch (_) {}
      }

      if (shouldCheckCache) {
        cacheBytes = await new Promise(function (resolve) {
          try {
            var req = indexedDB.open('FishFrameCacheDB');
            var isFinished = false;
            function finish(val) {
              if (isFinished) return;
              isFinished = true;
              resolve(val);
            }

            req.onsuccess = function (e) {
              var frameDb = e.target.result;
              if (!frameDb || !frameDb.objectStoreNames.contains('frames')) {
                if (frameDb) {
                  try { frameDb.close(); } catch (_) {}
                }
                finish(0);
                return;
              }

              try {
                var tx = frameDb.transaction('frames', 'readonly');
                var store = tx.objectStore('frames');
                var totalFrameBytes = 0;
                var visitedPrimaryKeys = new Set();

                if (store.indexNames && store.indexNames.contains('sourceKey')) {
                  var idx = store.index('sourceKey');
                  var keysArr = Array.from(sourceKeys);
                  var pending = keysArr.length;

                  if (pending === 0) {
                    try { frameDb.close(); } catch (_) {}
                    finish(0);
                    return;
                  }

                  keysArr.forEach(function (sKey) {
                    try {
                      var cursorReq = idx.openCursor(IDBKeyRange.only(sKey));
                      cursorReq.onsuccess = function (ce) {
                        var cursor = ce.target.result;
                        if (cursor) {
                          var rec = cursor.value;
                          var pKey = cursor.primaryKey || (rec && rec.key);
                          if (pKey && !visitedPrimaryKeys.has(pKey)) {
                            visitedPrimaryKeys.add(pKey);
                            if (rec && rec.blob && typeof rec.blob.size === 'number') {
                              totalFrameBytes += rec.blob.size;
                            } else if (rec && typeof rec.size === 'number') {
                              totalFrameBytes += rec.size;
                            } else if (rec && rec.dataUrl && typeof rec.dataUrl === 'string') {
                              totalFrameBytes += rec.dataUrl.length;
                            }
                          }
                          cursor.continue();
                        } else {
                          pending--;
                          if (pending <= 0) {
                            try { frameDb.close(); } catch (_) {}
                            finish(totalFrameBytes);
                          }
                        }
                      };
                      cursorReq.onerror = function () {
                        pending--;
                        if (pending <= 0) {
                          try { frameDb.close(); } catch (_) {}
                          finish(totalFrameBytes);
                        }
                      };
                    } catch (_) {
                      pending--;
                      if (pending <= 0) {
                        try { frameDb.close(); } catch (_) {}
                        finish(totalFrameBytes);
                      }
                    }
                  });
                } else {
                  // Fallback: iterate all records
                  var curReq = store.openCursor();
                  curReq.onsuccess = function (ce) {
                    var cursor = ce.target.result;
                    if (cursor) {
                      var rec = cursor.value;
                      if (rec && rec.sourceKey && sourceKeys.has(rec.sourceKey)) {
                        var pKey = cursor.primaryKey || rec.key;
                        if (pKey && !visitedPrimaryKeys.has(pKey)) {
                          visitedPrimaryKeys.add(pKey);
                          if (rec && rec.blob && typeof rec.blob.size === 'number') {
                            totalFrameBytes += rec.blob.size;
                          } else if (rec && typeof rec.size === 'number') {
                            totalFrameBytes += rec.size;
                          } else if (rec && rec.dataUrl && typeof rec.dataUrl === 'string') {
                            totalFrameBytes += rec.dataUrl.length;
                          }
                        }
                      }
                      cursor.continue();
                    } else {
                      try { frameDb.close(); } catch (_) {}
                      finish(totalFrameBytes);
                    }
                  };
                  curReq.onerror = function () {
                    try { frameDb.close(); } catch (_) {}
                    finish(totalFrameBytes);
                  };
                }
              } catch (err) {
                try { frameDb.close(); } catch (_) {}
                finish(0);
              }
            };
            req.onerror = function () { finish(0); };
            req.onblocked = function () { finish(0); };
          } catch (_) {
            resolve(0);
          }
        });
      }
    }

    var totalBytes = jsonBytes + mediaBytes + cacheBytes;
    var formatted = formatBytes(totalBytes);

    return {
      bytes: totalBytes,
      formatted: formatted,
      breakdown: {
        jsonBytes: jsonBytes,
        mediaBytes: mediaBytes,
        cacheBytes: cacheBytes,
        jsonFormatted: formatBytes(jsonBytes),
        mediaFormatted: formatBytes(mediaBytes),
        cacheFormatted: formatBytes(cacheBytes)
      }
    };
  }

  /**
   * Purges frame cache records belonging to specific source keys from FishFrameCacheDB
   * @param {Array<string>} keys
   * @returns {Promise<void>}
   */
  async function deleteProjectFrameCaches(keys) {
    if (!keys || keys.length === 0 || typeof indexedDB === 'undefined') return;
    return new Promise(function (resolve) {
      var settled = false;
      var done = function () {
        if (!settled) {
          settled = true;
          clearTimeout(safetyTimer);
          resolve();
        }
      };
      var safetyTimer = setTimeout(done, 800);

      try {
        var req = indexedDB.open('FishFrameCacheDB');
        req.onsuccess = function (e) {
          var db = e.target.result;
          if (!db || !db.objectStoreNames.contains('frames')) {
            if (db) try { db.close(); } catch (_) {}
            done();
            return;
          }
          try {
            var tx = db.transaction('frames', 'readwrite');
            var store = tx.objectStore('frames');
            var pending = keys.length;
            if (store.indexNames && store.indexNames.contains('sourceKey')) {
              var idx = store.index('sourceKey');
              keys.forEach(function (sKey) {
                try {
                  var curReq = idx.openKeyCursor(IDBKeyRange.only(sKey));
                  curReq.onsuccess = function (ce) {
                    var cursor = ce.target.result;
                    if (cursor) {
                      store.delete(cursor.primaryKey);
                      cursor.continue();
                    } else {
                      pending--;
                      if (pending <= 0) {
                        try { db.close(); } catch (_) {}
                        done();
                      }
                    }
                  };
                  curReq.onerror = function () {
                    pending--;
                    if (pending <= 0) {
                      try { db.close(); } catch (_) {}
                      done();
                    }
                  };
                } catch (_) {
                  pending--;
                  if (pending <= 0) {
                    try { db.close(); } catch (_) {}
                    done();
                  }
                }
              });
            } else {
              try { db.close(); } catch (_) {}
              done();
            }
          } catch (_) {
            try { db.close(); } catch (_) {}
            done();
          }
        };
        req.onerror = function () { done(); };
        req.onblocked = function () { done(); };
      } catch (_) {
        done();
      }
    });
  }

  /**
   * Creates a new project with given configuration
   * @param {Object} options
   */
  async function createProject(options) {
    options = options || {};
    var timestamp = Date.now();
    var id = options.id || ('prj_' + timestamp + '_' + Math.random().toString(36).substring(2, 6));
    var nowIso = new Date().toISOString();

    var project = {
      id: id,
      name: (options.name || 'New Project').trim().replace(/[\/\\?%*:|"<>]/g, '_'),
      aspectRatio: options.aspectRatio || '16:9',
      resolution: options.resolution || '1080p',
      fps: options.fps ? String(options.fps) : '60',
      bgColor: options.bgColor || 'transparent',
      size: '1.2 KB',
      createdAt: nowIso,
      layers: Array.isArray(options.layers) ? options.layers : []
    };

    try {
      var str = JSON.stringify(project);
      var b = (typeof Blob !== 'undefined') ? new Blob([str]).size : str.length;
      project.size = formatBytes(b);
      project.sizeBytes = b;
    } catch (_) {}

    await saveProject(project);
    return project;
  }

  /**
   * Clones an existing project
   * @param {string} id
   */
  async function duplicateProject(id) {
    var source = await getProject(id);
    if (!source) return null;

    var timestamp = Date.now();
    var newId = 'prj_' + timestamp + '_' + Math.random().toString(36).substring(2, 6);
    var nowIso = new Date().toISOString();

    var clone = JSON.parse(JSON.stringify(source));
    clone.id = newId;
    clone.name = source.name + '_Copy';
    clone.createdAt = nowIso;
    clone.updatedAt = nowIso;

    await saveProject(clone);
    return clone;
  }

  /**
   * Renames an existing project
   * @param {string} id
   * @param {string} newName
   */
  async function renameProject(id, newName) {
    var target = await getProject(id);
    if (!target) return null;

    var sanitized = (newName || '').trim().replace(/[\s\/\\?%*:|"<>]/g, '_');
    if (!sanitized) sanitized = 'Project_' + Date.now();

    target.name = sanitized;
    target.updatedAt = new Date().toISOString();

    await saveProject(target);
    return target;
  }

  // ==========================================================================
  // MEDIA STORAGE METHODS (Per-Project Local Storage & Lifecycle)
  // ==========================================================================
  function getLocalMedia() {
    try {
      var raw = localStorage.getItem(MEDIA_KEY);
      if (!raw) return [];
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalMedia(list) {
    if (!list || !Array.isArray(list)) return;
    try {
      var sanitized = list.map(function (m) {
        if (!m) return m;
        var clone = Object.assign({}, m);
        if (clone.dataUrl && (clone.dataUrl.startsWith('data:') || clone.dataUrl.length > 200)) {
          clone.dataUrl = ''; // Keep binary data strictly in IndexedDB
        }
        return clone;
      });
      localStorage.setItem(MEDIA_KEY, JSON.stringify(sanitized));
    } catch (e) {
      try {
        localStorage.removeItem(MEDIA_KEY);
      } catch (_) {}
    }
  }

  function hydrateMediaItemBlobs(m) {
    if (!m) return m;
    if (m.buffer) {
      try {
        m.blob = new Blob([m.buffer], { type: m.mimeType || '' });
        m.dataUrl = URL.createObjectURL(m.blob);
      } catch (_) {}
    } else if (m.blob) {
      try {
        m.dataUrl = URL.createObjectURL(m.blob);
      } catch (_) {}
    } else if (m.dataUrl && typeof m.dataUrl === 'string' && m.dataUrl.startsWith('blob:')) {
      m.dataUrl = '';
    }

    if (m.thumbBuffer) {
      try {
        m.thumbBlob = new Blob([m.thumbBuffer], { type: 'image/jpeg' });
        m.thumbUrl = URL.createObjectURL(m.thumbBlob);
      } catch (_) {}
    } else if (m.thumbBlob) {
      try {
        m.thumbUrl = URL.createObjectURL(m.thumbBlob);
      } catch (_) {}
    } else if (m.thumbUrl && typeof m.thumbUrl === 'string' && m.thumbUrl.startsWith('blob:')) {
      m.thumbUrl = '';
    }
    return m;
  }

  /**
   * Saves a media item into IndexedDB with localStorage fallback
   * @param {Object} mediaItem { id, projectId, name, type, mimeType, size, dataUrl, createdAt }
   */
  async function saveMedia(mediaItem) {
    if (!mediaItem || !mediaItem.id || !mediaItem.projectId) return null;
    mediaItem.createdAt = mediaItem.createdAt || new Date().toISOString();

    // 1. Convert binary blobs to ArrayBuffer for durable storage across reloads.
    // Safari WebKit has a critical bug where Blobs stored directly in IndexedDB
    // become detached/corrupted upon page reload, causing WebKitBlobResource error 1.
    // Raw ArrayBuffer is structured-cloned directly into SQLite without relying on WebKit's fragile temp file sandbox.
    var buffer = mediaItem.buffer || null;
    if (!buffer && mediaItem.blob && typeof mediaItem.blob.arrayBuffer === 'function') {
      try {
        buffer = await mediaItem.blob.arrayBuffer();
        mediaItem.buffer = buffer;
      } catch (_) {}
    }
    var thumbBuffer = mediaItem.thumbBuffer || null;
    if (!thumbBuffer && mediaItem.thumbBlob && typeof mediaItem.thumbBlob.arrayBuffer === 'function') {
      try {
        thumbBuffer = await mediaItem.thumbBlob.arrayBuffer();
        mediaItem.thumbBuffer = thumbBuffer;
      } catch (_) {}
    }

    var db = await openDB();
    if (db && db.objectStoreNames.contains('media')) {
      return new Promise(function (resolve) {
        var isDone = false;
        var saveTimer = setTimeout(function () {
          if (isDone) return;
          isDone = true;
          console.warn('[FishDatabase] saveMedia transaction timeout, resolving optimistic');
          saveToLocalFull(mediaItem);
          resolve(mediaItem);
        }, 30000);

        function finish(item) {
          if (isDone) return;
          isDone = true;
          clearTimeout(saveTimer);
          resolve(item);
        }

        try {
          var tx = db.transaction('media', 'readwrite');
          var store = tx.objectStore('media');
          var itemToStore = Object.assign({}, mediaItem);

          if (buffer) {
            itemToStore.buffer = buffer;
            delete itemToStore.blob;
          } else if (itemToStore.blob && typeof itemToStore.blob.slice === 'function') {
            try {
              itemToStore.blob = itemToStore.blob.slice(0, itemToStore.blob.size, itemToStore.mimeType || itemToStore.blob.type || '');
            } catch (_) {}
          }

          if (thumbBuffer) {
            itemToStore.thumbBuffer = thumbBuffer;
            delete itemToStore.thumbBlob;
          }

          if (itemToStore.dataUrl && typeof itemToStore.dataUrl === 'string' && itemToStore.dataUrl.startsWith('blob:')) {
            itemToStore.dataUrl = '';
          }
          if (itemToStore.thumbUrl && typeof itemToStore.thumbUrl === 'string' && itemToStore.thumbUrl.startsWith('blob:')) {
            itemToStore.thumbUrl = '';
          }

          store.put(itemToStore);

          tx.oncomplete = function () {
            _invalidateProjectMediaCache(mediaItem.projectId);
            // Also keep light metadata in local fallback
            saveMetaToLocal(mediaItem);
            finish(mediaItem);
          };
          tx.onerror = function (err) {
            console.warn('[FishDatabase] saveMedia tx error:', err);
            saveToLocalFull(mediaItem);
            finish(mediaItem);
          };
          tx.onabort = function (err) {
            console.warn('[FishDatabase] saveMedia tx aborted:', err);
            saveToLocalFull(mediaItem);
            finish(mediaItem);
          };
        } catch (e) {
          console.warn('[FishDatabase] saveMedia store.put error:', e);
          saveToLocalFull(mediaItem);
          finish(mediaItem);
        }
      });
    }

    saveToLocalFull(mediaItem);
    return mediaItem;

    function saveMetaToLocal(item) {
      try {
        var list = getLocalMedia();
        var clone = Object.assign({}, item);
        delete clone.blob; // Never keep binary blob in localStorage copy!
        delete clone.thumbBlob;
        delete clone.buffer;
        delete clone.thumbBuffer;
        clone.dataUrl = ''; // Full data kept safely in IndexedDB
        clone.thumbUrl = '';
        var idx = list.findIndex(function (m) { return m.id === clone.id; });
        if (idx >= 0) list[idx] = clone;
        else list.push(clone);
        saveLocalMedia(list);
      } catch (_) {}
    }

    function saveToLocalFull(item) {
      try {
        var list = getLocalMedia();
        var clone = Object.assign({}, item);
        delete clone.blob;
        delete clone.thumbBlob;
        delete clone.buffer;
        delete clone.thumbBuffer;
        clone.dataUrl = '';
        clone.thumbUrl = '';
        var idx = list.findIndex(function (m) { return m.id === clone.id; });
        if (idx >= 0) list[idx] = clone;
        else list.push(clone);
        saveLocalMedia(list);
      } catch (_) {}
    }
  }

  var _inFlightProjectMedia = new Map();

  function _invalidateProjectMediaCache(projectId) {
    if (projectId) {
      _inFlightProjectMedia.delete(projectId + '_1');
      _inFlightProjectMedia.delete(projectId + '_0');
    } else {
      _inFlightProjectMedia.clear();
    }
  }

  /**
   * Retrieves all media items for a specific project
   * Includes in-flight request deduplication to prevent saturated I/O on parallel loads.
   * @param {string} projectId
   * @param {boolean} [hydrateBlobs=true]
   * @returns {Promise<Array>}
   */
  async function getProjectMedia(projectId, hydrateBlobs) {
    if (hydrateBlobs === undefined) hydrateBlobs = true;
    if (!projectId) return [];

    var cacheKey = projectId + '_' + (hydrateBlobs ? '1' : '0');
    if (_inFlightProjectMedia.has(cacheKey)) {
      return _inFlightProjectMedia.get(cacheKey);
    }

    var queryPromise = (async function () {
      var db = await openDB();
      if (db && db.objectStoreNames.contains('media')) {
        return new Promise(function (resolve) {
          var isDone = false;
          var timer = setTimeout(function () {
            if (isDone) return;
            isDone = true;
            console.warn('[FishDatabase] getProjectMedia transaction timeout, returning fallback');
            var local = getLocalMedia().filter(function (m) { return m.projectId === projectId; });
            resolve(local);
          }, 25000);

          function finish(items) {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            resolve(items);
          }

          try {
            var tx = db.transaction('media', 'readonly');
            var store = tx.objectStore('media');
            var req;
            if (store.indexNames && store.indexNames.contains('projectId')) {
              var index = store.index('projectId');
              req = index.getAll(projectId);
            } else {
              req = store.getAll();
            }
            req.onsuccess = function () {
              var items = req.result || [];
              if (!store.indexNames || !store.indexNames.contains('projectId')) {
                items = items.filter(function (m) { return m && m.projectId === projectId; });
              }
              if (hydrateBlobs) {
                items.forEach(hydrateMediaItemBlobs);
              }
              finish(items);
            };
            req.onerror = function () {
              var local = getLocalMedia().filter(function (m) { return m.projectId === projectId; });
              finish(local);
            };
            tx.onerror = function () {
              var local = getLocalMedia().filter(function (m) { return m.projectId === projectId; });
              finish(local);
            };
            tx.onabort = function () {
              var local = getLocalMedia().filter(function (m) { return m.projectId === projectId; });
              finish(local);
            };
          } catch (e) {
            var local = getLocalMedia().filter(function (m) { return m.projectId === projectId; });
            finish(local);
          }
        });
      }
      return getLocalMedia().filter(function (m) { return m.projectId === projectId; });
    })();

    _inFlightProjectMedia.set(cacheKey, queryPromise);

    try {
      return await queryPromise;
    } finally {
      setTimeout(function () {
        if (_inFlightProjectMedia.get(cacheKey) === queryPromise) {
          _inFlightProjectMedia.delete(cacheKey);
        }
      }, 500);
    }
  }

  /**
   * Retrieves a single media item by ID
   * @param {string} id
   * @param {boolean} [hydrateBlobs=true]
   * @returns {Promise<Object|null>}
   */
  async function getMedia(id, hydrateBlobs) {
    if (hydrateBlobs === undefined) hydrateBlobs = true;
    if (!id) return null;
    var db = await openDB();
    if (db && db.objectStoreNames.contains('media')) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('media', 'readonly');
          var store = tx.objectStore('media');
          var req = store.get(id);
          req.onsuccess = function () {
            var m = req.result || null;
            if (m && hydrateBlobs) {
              hydrateMediaItemBlobs(m);
            }
            resolve(m);
          };
          req.onerror = function () {
            var found = getLocalMedia().find(function (item) { return item.id === id; });
            resolve(found || null);
          };
        } catch (_) {
          var found = getLocalMedia().find(function (item) { return item.id === id; });
          resolve(found || null);
        }
      });
    }
    var found = getLocalMedia().find(function (item) { return item.id === id; });
    return found || null;
  }

  /**
   * Returns ALL media items from IDB (no projectId filter).
   * Used for orphan detection / cloud project recovery.
   * @returns {Promise<Object[]>}
   */
  async function getAllMedia() {
    var db = await openDB();
    if (db && db.objectStoreNames.contains('media')) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('media', 'readonly');
          var store = tx.objectStore('media');
          var req = store.getAll();
          req.onsuccess = function () {
            var items = req.result || [];
            items.forEach(hydrateMediaItemBlobs);
            resolve(items);
          };
          req.onerror  = function () { resolve(getLocalMedia()); };
        } catch (_) { resolve(getLocalMedia()); }
      });
    }
    return getLocalMedia();
  }

  /**
   * Deletes a single media item by ID
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async function deleteMedia(id) {
    if (!id) return false;
    if (typeof window !== 'undefined' && window.VideoFrameExtractor) {
      try { window.VideoFrameExtractor.clearSource(id); } catch (_) {}
    }
    try { await deleteProjectFrameCaches([id]); } catch (_) {}

    // 1. Remove from local copy
    var list = getLocalMedia().filter(function (m) { return m.id !== id; });
    saveLocalMedia(list);

    // 2. Remove from IndexedDB
    var db = await openDB();
    if (db && db.objectStoreNames.contains('media')) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('media', 'readwrite');
          var store = tx.objectStore('media');
          store.delete(id);
          tx.oncomplete = function () {
            _invalidateProjectMediaCache();
            resolve(true);
          };
          tx.onerror = function () {
            resolve(false);
          };
        } catch (e) {
          resolve(false);
        }
      });
    }
    return true;
  }

  /**
   * Deletes all media belonging to a specific project
   * @param {string} projectId
   * @returns {Promise<boolean>}
   */
  async function deleteProjectMedia(projectId) {
    if (!projectId) return false;
    var medias = getLocalMedia().filter(function (m) { return m.projectId === projectId; });
    if (typeof window !== 'undefined' && window.VideoFrameExtractor) {
      medias.forEach(function (m) {
        try { window.VideoFrameExtractor.clearSource(m.id); } catch (_) {}
      });
    }

    var mediaIds = medias.map(function (m) { return m.id; }).filter(Boolean);
    if (mediaIds.length > 0) {
      try {
        await deleteProjectFrameCaches(mediaIds);
      } catch (_) {}
    }

    // 1. Purge from localStorage fallback
    var list = getLocalMedia().filter(function (m) { return m.projectId !== projectId; });
    saveLocalMedia(list);

    // 2. Await full completion in IndexedDB
    var db = await openDB();
    if (db && db.objectStoreNames.contains('media')) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('media', 'readwrite');
          var store = tx.objectStore('media');
          if (store.indexNames && store.indexNames.contains('projectId')) {
            var index = store.index('projectId');
            var req = index.openCursor(IDBKeyRange.only(projectId));
            req.onsuccess = function (e) {
              var cursor = e.target.result;
              if (cursor) {
                cursor.delete();
                cursor.continue();
              }
            };
          } else {
            var req = store.openCursor();
            req.onsuccess = function (e) {
              var cursor = e.target.result;
              if (cursor) {
                if (cursor.value && cursor.value.projectId === projectId) {
                  cursor.delete();
                }
                cursor.continue();
              }
            };
          }
          tx.oncomplete = function () {
            resolve(true);
          };
          tx.onerror = function () {
            resolve(false);
          };
        } catch (e) {
          resolve(false);
        }
      });
    }
    return true;
  }

  /**
   * Clears all media across all projects
   * @returns {Promise<boolean>}
   */
  async function clearAllMedia() {
    saveLocalMedia([]);
    var db = await openDB();
    if (db && db.objectStoreNames.contains('media')) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('media', 'readwrite');
          var store = tx.objectStore('media');
          store.clear();
          tx.oncomplete = function () {
            resolve(true);
          };
          tx.onerror = function () {
            resolve(false);
          };
        } catch (e) {
          resolve(false);
        }
      });
    }
    return true;
  }

  /**
   * Deletes a project by ID and cascades deletion to all its media and frame caches
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async function deleteProject(id) {
    if (!id) return false;
    var targetId = String(id).trim();
    _deletedIds.add(id);
    _deletedIds.add(targetId);
    _saveDeletedIds();

    // 1. Immediately remove from localStorage for instant UI response
    var list = getLocalProjects();
    var filtered = list.filter(function (p) {
      return p && p.id !== id && String(p.id).trim() !== targetId;
    });
    saveLocalProjects(filtered);

    // Also purge emergency layers snapshot if it belonged to this project
    try {
      var emergencyRaw = localStorage.getItem('fishtool_emergency_layers');
      if (emergencyRaw) {
        var emergencyParsed = JSON.parse(emergencyRaw);
        if (emergencyParsed && (emergencyParsed.projectId === id || emergencyParsed.projectId === targetId)) {
          localStorage.removeItem('fishtool_emergency_layers');
        }
      }
    } catch (_) {}

    // Collect layer source keys to clear any cached frames (protected against hanging)
    var prj = null;
    try {
      prj = await Promise.race([
        getProject(id),
        new Promise(function (res) { setTimeout(function () { res(null); }, 350); })
      ]);
    } catch (_) {}

    var sourceKeys = [];
    if (prj && Array.isArray(prj.layers)) {
      prj.layers.forEach(function (l) {
        if (!l) return;
        if (l.mediaId) sourceKeys.push(l.mediaId);
        if (l.id) {
          sourceKeys.push(l.id);
          sourceKeys.push('src_' + l.id);
        }
        if (l.name) sourceKeys.push(l.name);
      });
    }

    // 2. Remove from IndexedDB directly and cleanly without cursor conflict
    try {
      var db = await openDB();
      if (db && db.objectStoreNames.contains('projects')) {
        await new Promise(function (resolve) {
          var safetyTimer = setTimeout(function () { resolve(false); }, 1500);
          try {
            var tx = db.transaction('projects', 'readwrite');
            var store = tx.objectStore('projects');

            // Direct delete by id and targetId
            try { store.delete(id); } catch (_) {}
            if (targetId !== id) {
              try { store.delete(targetId); } catch (_) {}
            }

            // Also delete if numeric key
            var numId = Number(targetId);
            if (!isNaN(numId)) {
              try { store.delete(numId); } catch (_) {}
            }

            tx.oncomplete = function () {
              clearTimeout(safetyTimer);
              resolve(true);
            };
            tx.onerror = function (e) {
              clearTimeout(safetyTimer);
              try { e.preventDefault(); } catch (_) {}
              resolve(false);
            };
            tx.onabort = function () {
              clearTimeout(safetyTimer);
              resolve(false);
            };
          } catch (e) {
            clearTimeout(safetyTimer);
            resolve(false);
          }
        });
      }
    } catch (_) {}

    // Dispatch update event immediately so UI re-renders without delay
    try {
      window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'delete', id: id } }));
    } catch (_) {}

    // 3. Cascade delete all media and frame caches in background
    Promise.allSettled([
      deleteProjectMedia(id),
      sourceKeys.length > 0 ? deleteProjectFrameCaches(sourceKeys) : Promise.resolve()
    ]).catch(function (_) {});

    return true;
  }

  /**
   * Clears all projects, all associated media, and frame caches (database wipe)
   * @returns {Promise<boolean>}
   */
  async function clearProjects() {
    await clearAllMedia();
    if (typeof indexedDB !== 'undefined') {
      try {
        var req = indexedDB.open('FishFrameCacheDB');
        req.onsuccess = function (e) {
          var db = e.target.result;
          if (db && db.objectStoreNames.contains('frames')) {
            try {
              var tx = db.transaction('frames', 'readwrite');
              tx.objectStore('frames').clear();
              tx.oncomplete = function () { try { db.close(); } catch (_) {} };
            } catch (_) {
              try { db.close(); } catch (_) {}
            }
          } else if (db) {
            try { db.close(); } catch (_) {}
          }
        };
      } catch (_) {}
    }
    saveLocalProjects([]);
    var db = await openDB();
    if (db && db.objectStoreNames.contains('projects')) {
      await new Promise(function (resolve) {
        try {
          var tx = db.transaction('projects', 'readwrite');
          var store = tx.objectStore('projects');
          store.clear();
          tx.oncomplete = function () {
            resolve(true);
          };
          tx.onerror = function () {
            resolve(false);
          };
        } catch (e) {
          resolve(false);
        }
      });
    }
    window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'clear' } }));
    return true;
  }

  /**
   * Helper: converts data URL string to Blob
   */
  function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return new Blob([]);
    }
    try {
      var parts = dataUrl.split(',');
      var mime = parts[0].match(/:(.*?);/)[1] || 'application/octet-stream';
      var bstr = atob(parts[1]);
      var n = bstr.length;
      var u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch (_) {
      return new Blob([]);
    }
  }

  /**
   * Helper: triggers native file download
   */
  function downloadFile(filename, content, type) {
    var blob = new Blob([content], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /**
   * Sanitizes a project object specifically for .ofts export, stripping all runtime caches,
   * frame buffers, temporary canvas instances, and bloated base64 data URLs.
   */
  function sanitizeProjectForExport(project, mediaItems) {
    if (!project) return null;
    var projectData = JSON.parse(JSON.stringify(project));

    // Strip project-level runtime caches and preview screenshots
    projectData.previewUrl = '';
    projectData.thumbnail = '';
    delete projectData.isImported;
    delete projectData.cache;
    delete projectData.previewCache;
    delete projectData.renderedFrames;
    delete projectData.videoFrames;
    delete projectData.extractedFrames;

    // Remove any internal _... keys from project root
    Object.keys(projectData).forEach(function (k) {
      if (k.startsWith('_')) delete projectData[k];
    });

    var mediaMap = new Map();
    if (Array.isArray(mediaItems)) {
      mediaItems.forEach(function (m) {
        if (m && m.id) mediaMap.set(m.id, m);
      });
    }

    function cleanLayer(l) {
      if (!l) return l;

      // 1. Strip all frame extraction caches, preview caches, and temporary canvas buffers
      delete l.cache;
      delete l.previewCache;
      delete l.renderedFrames;
      delete l.videoFrames;
      delete l.extractedFrames;
      delete l._cachedFrames;
      delete l._shapeBufferCanvas;
      delete l._precompBufferCanvas;
      delete l._fillBufferCanvas;
      delete l._textBufferCanvas;
      delete l._fillMediaImg;
      delete l._alphaHitCanvas;
      delete l._alphaHitCtx;
      delete l._canvasBounds;
      delete l._extractComplete;
      delete l._cachedStartSec;
      delete l._cachedEndSec;
      delete l._lastRenderedFrame;
      delete l._interpCache;
      delete l._precompCacheProgress;
      delete l._precompCacheComplete;
      delete l._extractProgress;
      delete l._previewCache;

      // 2. Strip transient _... properties
      Object.keys(l).forEach(function (k) {
        if (k.startsWith('_') && k !== '_userResized') delete l[k];
      });

      // 3. Thumbnails are transient - strip them to avoid base64 bloat
      l.thumbUrl = '';

      // 4. Handle layer.dataUrl
      if (l.mediaId && mediaMap.has(l.mediaId)) {
        // Media already preserved in media/ folder; strip redundant base64 / blob URL
        l.dataUrl = '';
      } else if (l.dataUrl && (l.dataUrl.startsWith('data:') || l.dataUrl.startsWith('blob:'))) {
        if (l.dataUrl.startsWith('data:')) {
          // Embedded base64 asset without mediaId: extract into project media package so project.json stays tiny
          var newId = 'media_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          var blob = dataUrlToBlob(l.dataUrl);
          var ext = l.type === 'video' ? 'mp4' : l.type === 'audio' ? 'mp3' : 'png';
          var safeName = (l.name || 'embedded_layer').replace(/[^a-zA-Z0-9._-]/g, '_') + '.' + ext;
          var extractedItem = {
            id: newId,
            projectId: project.id,
            name: safeName,
            type: l.type || 'image',
            mimeType: blob.type || (l.type === 'video' ? 'video/mp4' : 'image/png'),
            size: blob.size || 0,
            blob: blob,
            dataUrl: '',
            createdAt: new Date().toISOString()
          };
          mediaItems.push(extractedItem);
          mediaMap.set(newId, extractedItem);
          l.mediaId = newId;
        }
        l.dataUrl = '';
      }

      // 5. Handle fillMediaUrl
      if (l.fillMediaId && mediaMap.has(l.fillMediaId)) {
        l.fillMediaUrl = '';
      } else if (l.fillMediaUrl && (l.fillMediaUrl.startsWith('data:') || l.fillMediaUrl.startsWith('blob:'))) {
        if (l.fillMediaUrl.startsWith('data:')) {
          var fillId = 'media_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          var fillBlob = dataUrlToBlob(l.fillMediaUrl);
          var fillName = (l.fillMediaName || 'fill_media').replace(/[^a-zA-Z0-9._-]/g, '_') + '.png';
          var fillItem = {
            id: fillId,
            projectId: project.id,
            name: fillName,
            type: 'image',
            mimeType: fillBlob.type || 'image/png',
            size: fillBlob.size || 0,
            blob: fillBlob,
            dataUrl: '',
            createdAt: new Date().toISOString()
          };
          mediaItems.push(fillItem);
          mediaMap.set(fillId, fillItem);
          l.fillMediaId = fillId;
        }
        l.fillMediaUrl = '';
      }

      // 6. Recursively clean precomp children
      if (Array.isArray(l.layers)) {
        l.layers = l.layers.map(cleanLayer).filter(Boolean);
      }

      return l;
    }

    if (Array.isArray(projectData.layers)) {
      projectData.layers = projectData.layers.map(cleanLayer).filter(Boolean);
    }

    return projectData;
  }

  /**
   * Exports a project package metadata and media files list
   * @param {string} projectId
   * @returns {Promise<{folderName: string, projectJson: string, mediaItems: Array}>}
   */
  async function exportProjectPackage(projectId) {
    if (!projectId) return null;
    var project = await getProject(projectId);
    if (!project) return null;
    var mediaItems = (await getProjectMedia(projectId)) || [];

    // Sanitize project metadata & layers, extracting embedded base64 layers if any
    var projectData = sanitizeProjectForExport(project, mediaItems);
    projectData.isTemplate = true;

    // Assign safe, collision-free filenames for the media archive and manifest
    projectData.media = mediaItems.map(function (m, idx) {
      var safeName = (m.name || ('media_' + (m.id || idx))).replace(/[^a-zA-Z0-9._-]/g, '_');
      var uniqueFilename = 'media_' + m.id + '_' + safeName;
      m.archiveFilename = uniqueFilename;
      return {
        id: m.id,
        name: m.name,
        type: m.type,
        mimeType: m.mimeType || '',
        size: m.size || 0,
        width: m.width || null,
        height: m.height || null,
        duration: m.duration || null,
        createdAt: m.createdAt,
        filename: uniqueFilename
      };
    });

    var jsonStr = JSON.stringify(projectData);
    return {
      folderName: (project.name || 'Project').replace(/[^a-zA-Z0-9._-]/g, '_'),
      projectJson: jsonStr,
      mediaItems: mediaItems
    };
  }

  /* --- OFTS Export Progress Modal Helpers --- */
  function showOFTSProgressModal(title, percent, stage) {
    if (typeof document === 'undefined') return;
    var modal = document.getElementById('modal-ofts-progress');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-backdrop';
      modal.id = 'modal-ofts-progress';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Export OFTS Progress');
      modal.innerHTML = '<div class="modal-card modal-progress-card" onclick="event.stopPropagation()">' +
        '<h3 class="modal-title modal-progress-title" id="ofts-progress-title">Exporting .ofts</h3>' +
        '<div class="modal-progress-track">' +
          '<div class="modal-progress-fill" id="ofts-progress-fill" style="width: 0%;"></div>' +
        '</div>' +
        '<div class="modal-progress-details">' +
          '<span class="modal-progress-percent" id="ofts-progress-percent">0%</span>' +
          '<span class="modal-progress-status" id="ofts-progress-status">Preparing...</span>' +
        '</div>' +
      '</div>';
      document.body.appendChild(modal);
    }

    var titleEl = document.getElementById('ofts-progress-title');
    var fillEl = document.getElementById('ofts-progress-fill');
    var percentEl = document.getElementById('ofts-progress-percent');
    var statusEl = document.getElementById('ofts-progress-status');

    if (titleEl) titleEl.textContent = title || 'Exporting .ofts';
    var clamped = Math.min(100, Math.max(0, percent || 0));
    if (fillEl) fillEl.style.width = clamped + '%';
    if (percentEl) percentEl.textContent = Math.round(clamped) + '%';
    if (statusEl) statusEl.textContent = stage || 'Preparing...';

    if (window.Modal && typeof window.Modal.open === 'function') {
      window.Modal.open(modal);
    } else {
      modal.classList.add('is-active');
    }
  }

  function updateOFTSProgress(percent, stage) {
    if (typeof document === 'undefined') return;
    var fillEl = document.getElementById('ofts-progress-fill');
    var percentEl = document.getElementById('ofts-progress-percent');
    var statusEl = document.getElementById('ofts-progress-status');

    var clamped = Math.min(100, Math.max(0, percent));
    if (fillEl) fillEl.style.width = clamped + '%';
    if (percentEl) percentEl.textContent = Math.round(clamped) + '%';
    if (stage && statusEl) statusEl.textContent = stage;
  }

  function hideOFTSProgressModal() {
    if (typeof document === 'undefined') return;
    var modal = document.getElementById('modal-ofts-progress');
    if (!modal) return;
    if (window.Modal && window.Modal.activeModal === modal && typeof window.Modal.close === 'function') {
      window.Modal.close();
    } else {
      modal.classList.remove('is-active');
    }
  }

  /**
   * Saves project as a compressed .ofts file (project.json + media/)
   * Includes DEFLATE level 9 compression and live progress modal.
   * @param {string} projectId
   * @param {Object|Function} [options]
   * @returns {Promise<boolean>}
   */
  async function exportProjectToOFTS(projectId, options) {
    if (!window.JSZip) throw new Error("JSZip not loaded");

    var onProgress = typeof options === 'function' ? options : (options && options.onProgress);
    var reportProgress = function (pct, stage) {
      updateOFTSProgress(pct, stage);
      if (typeof onProgress === 'function') {
        try { onProgress(pct, stage); } catch (_) {}
      }
    };

    showOFTSProgressModal('Exporting .ofts', 0, 'Packing project...');
    reportProgress(5, 'Sanitizing project layers & manifest...');

    try {
      var pkg = await exportProjectPackage(projectId);
      if (!pkg) {
        hideOFTSProgressModal();
        return false;
      }

      reportProgress(15, 'Preparing media archive...');

      var zip = new JSZip();
      zip.file("project.json", pkg.projectJson);
      if (pkg.mediaItems && pkg.mediaItems.length > 0) {
        var mediaFolder = zip.folder("media");
        pkg.mediaItems.forEach(function (item) {
          var blobData = null;
          if (item.blob instanceof Blob) {
            blobData = item.blob;
          } else if (item.dataUrl) {
            blobData = dataUrlToBlob(item.dataUrl);
          }
          if (blobData) {
            var targetName = item.archiveFilename || ('media_' + item.id + '_' + (item.name || 'asset').replace(/[^a-zA-Z0-9._-]/g, '_'));
            mediaFolder.file(targetName, blobData);
          }
        });
      }

      reportProgress(20, 'Compressing archive (DEFLATE 9)...');

      // Maximum compression level (DEFLATE level 9) with live progress tracking
      var zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: {
          level: 9
        }
      }, function (metadata) {
        var pct = Math.min(96, 20 + Math.round((metadata.percent || 0) * 0.76));
        reportProgress(pct, 'Compressing (' + Math.round(metadata.percent || 0) + '%)...');
      });

      reportProgress(100, 'Complete!');
      downloadFile((pkg.folderName || 'Project') + '.ofts', zipBlob, 'application/octet-stream');

      await new Promise(function (r) { setTimeout(r, 400); });
      hideOFTSProgressModal();
      return true;
    } catch (err) {
      hideOFTSProgressModal();
      throw err;
    }
  }

  /**
   * Imports a project from an .ofts zip file
   * @param {File} file
   * @returns {Promise<Object>} The imported project record
   */
  async function importOFTSPackage(file) {
    if (!window.JSZip) throw new Error("JSZip not loaded");
    if (!file || !file.name.endsWith('.ofts')) return null;

    var zip = await JSZip.loadAsync(file);
    var jsonFile = zip.file("project.json");
    if (!jsonFile) throw new Error("project.json not found in .ofts");

    var text = await jsonFile.async("string");
    var projectData = null;
    try {
      projectData = JSON.parse(text);
    } catch (_) {}

    var fallbackName = file.name.replace(/\.[^/.]+$/, '');
    if (!projectData || typeof projectData !== 'object') {
      projectData = { name: fallbackName, aspectRatio: '16:9', resolution: '1080p', fps: 60, bgColor: 'transparent' };
    }

    // Clean any legacy caches if present in imported project.json
    projectData.previewUrl = '';
    projectData.thumbnail = '';
    delete projectData.cache;
    delete projectData.previewCache;
    delete projectData.renderedFrames;
    delete projectData.videoFrames;
    delete projectData.extractedFrames;
    delete projectData.isImported;
    Object.keys(projectData).forEach(function (k) {
      if (k.startsWith('_')) delete projectData[k];
    });

    function sanitizeImportedLayer(l) {
      if (!l) return l;
      delete l.cache;
      delete l.previewCache;
      delete l.renderedFrames;
      delete l.videoFrames;
      delete l.extractedFrames;
      delete l._cachedFrames;
      delete l._shapeBufferCanvas;
      delete l._precompBufferCanvas;
      delete l._fillBufferCanvas;
      delete l._textBufferCanvas;
      delete l._fillMediaImg;
      delete l._alphaHitCanvas;
      delete l._alphaHitCtx;
      delete l._canvasBounds;
      delete l._extractComplete;
      delete l._cachedStartSec;
      delete l._cachedEndSec;
      delete l._lastRenderedFrame;
      delete l._interpCache;
      delete l._precompCacheProgress;
      delete l._precompCacheComplete;
      delete l._extractProgress;
      delete l._previewCache;

      // Strip all internal transient _... keys
      Object.keys(l).forEach(function (k) {
        if (k.startsWith('_') && k !== '_userResized') delete l[k];
      });

      // Clean invalid blob URLs from previous session
      if (l.dataUrl && (l.dataUrl.startsWith('blob:') || (l.mediaId && l.dataUrl.startsWith('data:')))) {
        l.dataUrl = '';
      }
      l.thumbUrl = '';
      if (l.fillMediaUrl && (l.fillMediaUrl.startsWith('blob:') || (l.fillMediaId && l.fillMediaUrl.startsWith('data:')))) {
        l.fillMediaUrl = '';
      }

      if (Array.isArray(l.layers)) {
        l.layers = l.layers.map(sanitizeImportedLayer).filter(Boolean);
      }
      return l;
    }

    if (Array.isArray(projectData.layers)) {
      projectData.layers = projectData.layers.map(sanitizeImportedLayer).filter(Boolean);
    }

    // Assign a fresh, unique project ID and mark as customizable template
    projectData.id = 'prj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    projectData.isTemplate = true;
    projectData.updatedAt = new Date().toISOString();
    projectData.createdAt = projectData.createdAt || new Date().toISOString();

    // Save base project record first
    var savedProject = await saveProject(projectData);

    var declaredMedia = Array.isArray(projectData.media) ? projectData.media : [];
    var mediaFolder = zip.folder("media");

    if (mediaFolder) {
      var mediaEntries = [];
      mediaFolder.forEach(function (relativePath, zipEntry) {
        if (!zipEntry.dir) {
          mediaEntries.push({ relativePath: relativePath, zipEntry: zipEntry });
        }
      });

      // Sequential processing: process one file at a time to prevent heap spikes & OOM browser crash
      for (var i = 0; i < mediaEntries.length; i++) {
        var entry = mediaEntries[i];
        var zipEntry = entry.zipEntry;
        var relativePath = entry.relativePath;
        var rawFileName = relativePath.split('/').pop() || zipEntry.name;

        // Try exact match with manifest filename or original name or media id prefix
        var matchDesc = declaredMedia.find(function (m) {
          return m && (
            m.filename === rawFileName ||
            m.name === rawFileName ||
            rawFileName.startsWith('media_' + m.id + '_') ||
            rawFileName === ('media_' + m.id)
          );
        }) || {};

        var mediaId = matchDesc.id || (rawFileName.startsWith('media_') ? rawFileName.split('_')[1] : null) || ('media_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));
        var displayName = matchDesc.name || rawFileName.replace(/^media_[^_]+_/, '');

        // Extract raw binary Blob directly
        var blob = await zipEntry.async("blob");
        var type = matchDesc.type || (blob.type.startsWith('video/') ? 'video' : blob.type.startsWith('audio/') ? 'audio' : 'image');

        // Store directly as native Blob in IndexedDB with ZERO memory-waste base64 string
        var mediaItem = {
          id: mediaId,
          projectId: savedProject.id,
          name: displayName,
          type: type,
          mimeType: blob.type || matchDesc.mimeType || '',
          size: blob.size || matchDesc.size || 0,
          width: matchDesc.width || null,
          height: matchDesc.height || null,
          duration: matchDesc.duration || null,
          dataUrl: '', // Zero base64 string! Hydrated on-demand via URL.createObjectURL(blob)
          blob: blob,
          createdAt: new Date().toISOString()
        };

        await saveMedia(mediaItem);
        // Explicitly dereference to assist GC
        blob = null;
        mediaItem = null;
      }
    }

    // Compute and persist the true total size of the imported package
    try {
      var totalSize = await getProjectTotalSize(savedProject.id);
      if (totalSize && totalSize.formatted) {
        savedProject.size = totalSize.formatted;
        savedProject.sizeBytes = totalSize.bytes;
        await updateProjectSize(savedProject.id, totalSize.formatted, totalSize.bytes);
      }
    } catch (_) {}

    return savedProject;
  }

  if (typeof window !== 'undefined') {
    init().catch(function () {});
  }

  async function getCustomEasingPresets() {
    try {
      const s = await getSettings();
      if (s && Array.isArray(s.customEasingPresets) && s.customEasingPresets.length > 0) {
        return s.customEasingPresets;
      }
      const raw = localStorage.getItem('fishtool_custom_easing_presets');
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  async function saveCustomEasingPresets(list) {
    if (!Array.isArray(list)) return;
    try {
      localStorage.setItem('fishtool_custom_easing_presets', JSON.stringify(list));
      const s = await getSettings();
      s.customEasingPresets = list;
      await saveSettings(s);
    } catch (_) {}
  }

  /**
   * Purges extracted video frames from FishFrameCacheDB.
   * Leaves user projects and user media 100% untouched.
   */
  async function clearFrameCacheDB() {
    if (typeof indexedDB === 'undefined') return true;
    return new Promise(function(resolve) {
      try {
        var req = indexedDB.open('FishFrameCacheDB');
        req.onsuccess = function (e) {
          var db = e.target.result;
          if (db && db.objectStoreNames.contains('frames')) {
            try {
              var tx = db.transaction('frames', 'readwrite');
              tx.objectStore('frames').clear();
              tx.oncomplete = function () { try { db.close(); } catch (_) {} resolve(true); };
              tx.onerror = function () { try { db.close(); } catch (_) {} resolve(false); };
            } catch (_) {
              try { db.close(); } catch (_) {}
              resolve(false);
            }
          } else {
            if (db) try { db.close(); } catch (_) {}
            resolve(true);
          }
        };
        req.onerror = function() { resolve(false); };
        req.onblocked = function() { resolve(false); };
      } catch (_) {
        resolve(false);
      }
    });
  }

  /**
   * Universal studio-wide cache cleanup helper.
   * Purges RAM preview cache, video frame cache, layer media freeze canvases,
   * export canvas/temp buffers, while keeping user projects and media completely safe.
   */
  var _cleanupInFlight = null;
  async function cleanupAllStudioCaches(triggerReason) {
    if (_cleanupInFlight) return _cleanupInFlight;
    var reason = triggerReason || 'manual';
    console.info('[FishStudio] 🧹 Purging all non-essential caches (trigger=' + reason + ')...');

    _cleanupInFlight = (async function() {
      try {

    // 1. Timeline RAM preview frame cache
    if (typeof window !== 'undefined' && window.PreviewCacheManager) {
      try {
        window.PreviewCacheManager.clearAll('all');
        if (typeof window.PreviewCacheManager.stopIdleWorker === 'function') {
          window.PreviewCacheManager.stopIdleWorker();
        }
        if (typeof window.PreviewCacheManager.updateRulerUI === 'function') {
          window.PreviewCacheManager.updateRulerUI();
        }
      } catch (_) {}
    }

    // 2. Extracted video frames in-memory and in IndexedDB
    if (typeof window !== 'undefined' && window.VideoFrameExtractor && typeof window.VideoFrameExtractor.clearAllCache === 'function') {
      try {
        await window.VideoFrameExtractor.clearAllCache();
      } catch (_) {}
    } else {
      await clearFrameCacheDB();
    }

    // 3. Layer media freeze canvases
    if (typeof window !== 'undefined' && window.layerMediaCache) {
      try {
        window.layerMediaCache.forEach(function(entry) {
          if (entry) {
            if (entry.freezeCanvas) {
              entry.freezeCanvas.width = 1;
              entry.freezeCanvas.height = 1;
              entry.freezeCanvas = null;
              entry.hasFreezeFrame = false;
            }
          }
        });
      } catch (_) {}
    }

    // 4. Export engine state, offscreen canvas, and virtual FS temp files
    if (typeof window !== 'undefined' && window.FishExportEngine && typeof window.FishExportEngine.cleanup === 'function') {
      try {
        window.FishExportEngine.cleanup();
      } catch (_) {}
    }

    // 5. Redraw composition if in editor
    if (typeof window !== 'undefined' && typeof window.redrawComposition === 'function') {
      try {
        window.redrawComposition('cache-cleaned');
      } catch (_) {}
    }

        console.info('[FishStudio] ✅ Cache purge finished. Projects & media preserved.');
        return true;
      } finally {
        setTimeout(function() { _cleanupInFlight = null; }, 150);
      }
    })();
    return _cleanupInFlight;
  }

  if (typeof window !== 'undefined') {
    window.cleanupAllStudioCaches = cleanupAllStudioCaches;
  }

  return {
    init: init,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getCustomEasingPresets: getCustomEasingPresets,
    saveCustomEasingPresets: saveCustomEasingPresets,
    getSyncSettings: getSyncSettings,
    saveSyncSettings: saveSyncSettings,
    getProjects: getProjects,
    getProject: getProject,
    saveProject: saveProject,
    createProject: createProject,
    duplicateProject: duplicateProject,
    renameProject: renameProject,
    deleteProject: deleteProject,
    clearProjects: clearProjects,
    cleanupLegacyData: cleanupLegacyData,
    saveMedia: saveMedia,
    getMedia: getMedia,
    getProjectMedia: getProjectMedia,
    getAllMedia: getAllMedia,
    deleteMedia: deleteMedia,
    deleteProjectMedia: deleteProjectMedia,
    clearAllMedia: clearAllMedia,
    exportProjectPackage: exportProjectPackage,
    exportProjectToOFTS: exportProjectToOFTS,
    importOFTSPackage: importOFTSPackage,
    formatBytes: formatBytes,
    getProjectTotalSize: getProjectTotalSize,
    updateProjectSize: updateProjectSize,
    deleteProjectFrameCaches: deleteProjectFrameCaches,
    clearFrameCacheDB: clearFrameCacheDB,
    cleanupAllStudioCaches: cleanupAllStudioCaches
  };
})();
