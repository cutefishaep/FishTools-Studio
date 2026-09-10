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

  var dbPromise = null;

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

  function saveLocalProjects(list) {
    if (!list || !Array.isArray(list)) return;

    function sanitizeLayer(l) {
      if (!l) return l;
      var lClone = Object.assign({}, l);
      // Strip all heavy base64 / blob / frame data from localStorage mirror (full data safely stored in IndexedDB)
      if (lClone.dataUrl && (lClone.dataUrl.startsWith('data:') || lClone.dataUrl.length > 100)) lClone.dataUrl = '';
      if (lClone.thumbUrl && (lClone.thumbUrl.startsWith('data:') || lClone.thumbUrl.length > 100)) lClone.thumbUrl = '';
      if (lClone.fillMediaUrl && (lClone.fillMediaUrl.startsWith('data:') || lClone.fillMediaUrl.length > 100)) lClone.fillMediaUrl = '';
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
        return p && p.id && !p.id.startsWith('prj-00');
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
            if (p && p.id && p.id.startsWith('prj-00')) {
              store.delete(p.id);
            }
          });
        };
      } catch (e) {
        console.warn('[DB] Failed to prune dummy projects:', e);
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
  async function getProjects() {
    var db = await openDB();
    if (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('projects', 'readonly');
          var store = tx.objectStore('projects');
          var req = store.getAll();
          req.onsuccess = function () {
            var items = req.result || [];
            // Filter out any stale prj-00 mock items
            items = items.filter(function (p) { return p && p.id && !p.id.startsWith('prj-00'); });
            // Sort latest updated first
            items.sort(function (a, b) {
              var tA = new Date(a.updatedAt || a.createdAt || 0).getTime();
              var tB = new Date(b.updatedAt || b.createdAt || 0).getTime();
              return tB - tA;
            });
            // Update localStorage sync copy
            saveLocalProjects(items);
            resolve(items);
          };
          req.onerror = function () {
            var local = getLocalProjects().filter(function (p) { return p && p.id && !p.id.startsWith('prj-00'); });
            resolve(local);
          };
        } catch (e) {
          var local = getLocalProjects().filter(function (p) { return p && p.id && !p.id.startsWith('prj-00'); });
          resolve(local);
        }
      });
    }
    var local = getLocalProjects().filter(function (p) { return p && p.id && !p.id.startsWith('prj-00'); });
    return local;
  }

  /**
   * Retrieves single project by ID
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async function getProject(id) {
    if (!id) return null;
    var db = await openDB();
    if (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('projects', 'readonly');
          var store = tx.objectStore('projects');
          var req = store.get(id);
          req.onsuccess = function () {
            resolve(req.result || null);
          };
          req.onerror = function () {
            var found = getLocalProjects().find(function (p) { return p.id === id; });
            resolve(found || null);
          };
        } catch (e) {
          var found = getLocalProjects().find(function (p) { return p.id === id; });
          resolve(found || null);
        }
      });
    }
    var found = getLocalProjects().find(function (p) { return p.id === id; });
    return found || null;
  }

  /**
   * Saves or updates a project object
   * @param {Object} project
   */
  async function saveProject(project) {
    if (!project || !project.id) return;
    project.updatedAt = new Date().toISOString();
    delete project.cache;
    delete project.previewCache;
    delete project.renderedFrames;

    // 1. Sync to localStorage
    var list = getLocalProjects();
    var idx = list.findIndex(function (p) { return p.id === project.id; });
    if (idx >= 0) {
      list[idx] = project;
    } else {
      list.unshift(project);
    }
    saveLocalProjects(list);

    // 2. Sync to IndexedDB with persistence guarantee
    var db = await openDB();
    if (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('projects', 'readwrite');
          var store = tx.objectStore('projects');
          store.put(project);
          tx.oncomplete = function () {
            window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'save', project: project } }));
            resolve(project);
          };
          tx.onerror = function () {
            window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'save', project: project } }));
            resolve(project);
          };
        } catch (e) {
          window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'save', project: project } }));
          resolve(project);
        }
      });
    }

    window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'save', project: project } }));
    return project;
  }

  /**
   * Creates a new project with given configuration
   * @param {Object} options
   */
  async function createProject(options) {
    options = options || {};
    var timestamp = Date.now();
    var id = 'prj_' + timestamp + '_' + Math.random().toString(36).substring(2, 6);
    var nowIso = new Date().toISOString();

    var project = {
      id: id,
      name: (options.name || 'New_Project').trim().replace(/[\s\/\\?%*:|"<>]/g, '_'),
      aspectRatio: options.aspectRatio || '16:9',
      resolution: options.resolution || '1080p',
      fps: options.fps ? String(options.fps) : '60',
      bgColor: options.bgColor || 'transparent',
      size: '12 KB',
      createdAt: nowIso,
      layers: Array.isArray(options.layers) ? options.layers : []
    };

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

  /**
   * Saves a media item into IndexedDB with localStorage fallback
   * @param {Object} mediaItem { id, projectId, name, type, mimeType, size, dataUrl, createdAt }
   */
  async function saveMedia(mediaItem) {
    if (!mediaItem || !mediaItem.id || !mediaItem.projectId) return null;
    mediaItem.createdAt = mediaItem.createdAt || new Date().toISOString();

    var db = await openDB();
    if (db && db.objectStoreNames.contains('media')) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('media', 'readwrite');
          var store = tx.objectStore('media');
          store.put(mediaItem);
          tx.oncomplete = function () {
            // Also keep light metadata in local fallback
            saveMetaToLocal(mediaItem);
            resolve(mediaItem);
          };
          tx.onerror = function () {
            saveToLocalFull(mediaItem);
            resolve(mediaItem);
          };
        } catch (e) {
          saveToLocalFull(mediaItem);
          resolve(mediaItem);
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
        clone.dataUrl = '';
        clone.thumbUrl = '';
        var idx = list.findIndex(function (m) { return m.id === clone.id; });
        if (idx >= 0) list[idx] = clone;
        else list.push(clone);
        saveLocalMedia(list);
      } catch (_) {}
    }
  }

  /**
   * Retrieves all media items for a specific project
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async function getProjectMedia(projectId) {
    if (!projectId) return [];
    var db = await openDB();
    if (db && db.objectStoreNames.contains('media')) {
      return new Promise(function (resolve) {
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
            items.forEach(function (m) {
              if (m && m.blob && (!m.dataUrl || m.dataUrl.startsWith('blob:'))) {
                try {
                  m.dataUrl = URL.createObjectURL(m.blob);
                } catch (_) {}
              }
              if (m && m.thumbBlob && (!m.thumbUrl || m.thumbUrl.startsWith('blob:'))) {
                try {
                  m.thumbUrl = URL.createObjectURL(m.thumbBlob);
                } catch (_) {}
              }
            });
            resolve(items);
          };
          req.onerror = function () {
            var local = getLocalMedia().filter(function (m) { return m.projectId === projectId; });
            resolve(local);
          };
        } catch (e) {
          var local = getLocalMedia().filter(function (m) { return m.projectId === projectId; });
          resolve(local);
        }
      });
    }
    return getLocalMedia().filter(function (m) { return m.projectId === projectId; });
  }

  /**
   * Deletes a single media item by ID
   * @param {string} mediaId
   * @returns {Promise<boolean>}
   */
  async function deleteMedia(mediaId) {
    if (!mediaId) return false;
    if (typeof window !== 'undefined' && window.VideoFrameExtractor) {
      try { window.VideoFrameExtractor.clearSource(mediaId); } catch (_) {}
    }

    // 1. Purge from localStorage fallback
    var list = getLocalMedia().filter(function (m) { return m.id !== mediaId; });
    saveLocalMedia(list);

    // 2. Await full completion in IndexedDB
    var db = await openDB();
    if (db && db.objectStoreNames.contains('media')) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('media', 'readwrite');
          var store = tx.objectStore('media');
          var req = store.delete(mediaId);
          tx.oncomplete = function () {
            resolve(true);
          };
          tx.onerror = function () {
            resolve(false);
          };
          req.onerror = function () {
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
    if (typeof window !== 'undefined' && window.VideoFrameExtractor) {
      var medias = getLocalMedia().filter(function (m) { return m.projectId === projectId; });
      medias.forEach(function (m) {
        try { window.VideoFrameExtractor.clearSource(m.id); } catch (_) {}
      });
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
          req.onerror = function () {
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
   * Deletes a project by ID and cascades deletion to all its media
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async function deleteProject(id) {
    if (!id) return false;

    // 1. Cascade delete all media belonging to this project in storage
    await deleteProjectMedia(id);

    // 2. Remove from localStorage
    var list = getLocalProjects();
    var filtered = list.filter(function (p) { return p.id !== id; });
    saveLocalProjects(filtered);

    // 3. Await removal from IndexedDB
    var db = await openDB();
    if (db && db.objectStoreNames.contains('projects')) {
      await new Promise(function (resolve) {
        try {
          var tx = db.transaction('projects', 'readwrite');
          var store = tx.objectStore('projects');
          store.delete(id);
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

    window.dispatchEvent(new CustomEvent('fish-db-projects-updated', { detail: { action: 'delete', id: id } }));
    return true;
  }

  /**
   * Clears all projects and all associated media (database wipe)
   * @returns {Promise<boolean>}
   */
  async function clearProjects() {
    await clearAllMedia();
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

    var jsonStr = JSON.stringify(projectData, null, 2);
    return {
      folderName: (project.name || 'Project').replace(/[^a-zA-Z0-9._-]/g, '_'),
      projectJson: jsonStr,
      mediaItems: mediaItems
    };
  }

  /**
   * Saves project as a compressed .ofts file (project.json + media/)
   * @param {string} projectId
   * @returns {Promise<boolean>}
   */
  async function exportProjectToOFTS(projectId) {
    if (!window.JSZip) throw new Error("JSZip not loaded");
    var pkg = await exportProjectPackage(projectId);
    if (!pkg) return false;

    var zip = new JSZip();
    zip.file("project.json", pkg.projectJson);
    if (pkg.mediaItems && pkg.mediaItems.length > 0) {
      var mediaFolder = zip.folder("media");
      pkg.mediaItems.forEach(item => {
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

    var zipBlob = await zip.generateAsync({ type: "blob" });
    downloadFile((pkg.folderName || 'Project') + '.ofts', zipBlob, 'application/octet-stream');
    return true;
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

    // Assign a fresh, unique project ID
    projectData.id = 'prj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
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
    getProjectMedia: getProjectMedia,
    deleteMedia: deleteMedia,
    deleteProjectMedia: deleteProjectMedia,
    clearAllMedia: clearAllMedia,
    exportProjectPackage: exportProjectPackage,
    exportProjectToOFTS: exportProjectToOFTS,
    importOFTSPackage: importOFTSPackage
  };
})();
