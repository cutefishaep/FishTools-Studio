/**
 * OpenFishTools Studio - Google Drive Cloud Sync Engine (FishGDriveSync)
 * 
 * Architecture: Per-project folder structure
 *   OpenFishTools Projects/
 *   └── [project-id]/         ← Drive subfolder (ID = project's Drive ID)
 *       ├── project.json      ← layer data only, minified JSON
 *       └── media/            ← individual media files
 *           ├── media_xxx.mp4
 *           └── media_yyy.png
 *
 * Sync rules:
 *   - Layer edits   → PATCH project.json only (fast, small)
 *   - Add media     → upload file to media/ subfolder
 *   - Delete media  → delete file from media/ subfolder
 *   - Open project  → check local IDB for each mediaId, download missing ones
 */

(function(global) {
  'use strict';

  const STORAGE_KEY_TOKEN  = 'fishtools_gdrive_token';
  const STORAGE_KEY_USER   = 'fishtools_gdrive_user';
  const STORAGE_KEY_FOLDER = 'fishtools_gdrive_folder_id';

  let tokenClient    = null;
  let cachedToken    = null;
  let tokenExpiryTime = 0;
  let cachedUser     = null;
  let appFolderId    = null;

  // In-memory cache: projectId → { projectJsonFileId, mediaFolderId }
  const _projectFolderCache = {};

  // Restore stored session if valid
  try {
    const rawTok = sessionStorage.getItem(STORAGE_KEY_TOKEN);
    if (rawTok) {
      const parsed = JSON.parse(rawTok);
      if (parsed.access_token && parsed.expires_at > Date.now()) {
        cachedToken    = parsed.access_token;
        tokenExpiryTime = parsed.expires_at;
      }
    }
    const rawUser = localStorage.getItem(STORAGE_KEY_USER);
    if (rawUser) cachedUser = JSON.parse(rawUser);
    appFolderId = localStorage.getItem(STORAGE_KEY_FOLDER) || null;
  } catch (_) {}

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function driveRequest(url, options = {}) {
    const token = await FishGDriveSync.getAccessToken();
    const headers = Object.assign({ Authorization: `Bearer ${token}` }, options.headers || {});
    const res = await fetch(url, Object.assign({}, options, { headers }));
    if (res.status === 401) {
      FishGDriveSync.logout();
      throw new Error('Google session expired. Please sign in again.');
    }
    return res;
  }

  async function createDriveFolder(name, parentId) {
    const res = await driveRequest('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    if (!res.ok) throw new Error(`Failed to create Drive folder "${name}": ${res.statusText}`);
    return (await res.json()).id;
  }

  async function findDriveItem(name, parentId, mimeFilter) {
    const mimeQ  = mimeFilter ? ` and mimeType='${mimeFilter}'` : '';
    const q      = encodeURIComponent(`name='${name}' and '${parentId}' in parents and trashed=false${mimeQ}`);
    const res    = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&spaces=drive`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.files && data.files.length > 0) ? data.files[0] : null;
  }

  async function listDriveFolder(folderId, fields) {
    const f   = encodeURIComponent(fields || 'files(id,name,mimeType,size,modifiedTime)');
    const q   = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${f}&spaces=drive`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.files || [];
  }

  // ── Main API ──────────────────────────────────────────────────────────────

  const FishGDriveSync = {

    isAuthenticated() {
      return Boolean(cachedToken && Date.now() < tokenExpiryTime);
    },

    getUser() {
      return cachedUser;
    },

    async getAccessToken() {
      if (this.isAuthenticated()) return cachedToken;
      return new Promise((resolve, reject) => {
        if (!tokenClient) this.initTokenClient();
        if (!tokenClient) {
          reject(new Error('Google session expired. Please return to the dashboard and sign in again.'));
          return;
        }
        const handleAuth = () => {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error', handleError);
          if (cachedToken) resolve(cachedToken);
          else reject(new Error('Google session expired. Please return to the dashboard and sign in again.'));
        };
        const handleError = () => {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error', handleError);
          reject(new Error('Google session expired. Please return to the dashboard and sign in again.'));
        };
        window.addEventListener('gdrive-auth-changed', handleAuth, { once: true });
        window.addEventListener('gdrive-auth-error',   handleError, { once: true });
        try {
          tokenClient.requestAccessToken({ prompt: '' });
        } catch (err) {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error',   handleError);
          reject(new Error('Google session expired. Please return to the dashboard and sign in again.'));
        }
      });
    },

    initTokenClient() {
      if (tokenClient || typeof window.google === 'undefined' ||
          !window.google.accounts || !window.google.accounts.oauth2) return;

      const clientId = (global.FishGDriveConfig && typeof global.FishGDriveConfig.getClientId === 'function')
        ? global.FishGDriveConfig.getClientId() : '';
      if (!clientId) return;

      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: global.FishGDriveConfig
          ? global.FishGDriveConfig.getScope()
          : 'https://www.googleapis.com/auth/drive.file',
        callback: (response) => {
          if (response.error) {
            window.dispatchEvent(new CustomEvent('gdrive-auth-error', { detail: response }));
            return;
          }
          if (response.access_token) {
            cachedToken    = response.access_token;
            const expiresInSec = parseInt(response.expires_in, 10) || 3500;
            tokenExpiryTime = Date.now() + (expiresInSec - 60) * 1000;
            try {
              sessionStorage.setItem(STORAGE_KEY_TOKEN, JSON.stringify({
                access_token: cachedToken,
                expires_at: tokenExpiryTime
              }));
            } catch (_) {}
            this.fetchUserProfile().then(() => {
              window.dispatchEvent(new CustomEvent('gdrive-auth-changed', {
                detail: { isAuthenticated: true, user: cachedUser }
              }));
            });
          }
        }
      });
    },

    async login(promptNone = false) {
      const clientId = global.FishGDriveConfig ? global.FishGDriveConfig.getClientId() : '';
      if (!clientId) throw new Error('Google Client ID is not configured.');
      if (!tokenClient) this.initTokenClient();
      if (!tokenClient) throw new Error('Google Identity Services client is not loaded. Please check internet connection.');

      return new Promise((resolve, reject) => {
        const handleAuth  = () => { window.removeEventListener('gdrive-auth-changed', handleAuth); window.removeEventListener('gdrive-auth-error', handleError); resolve(cachedToken); };
        const handleError = (e) => { window.removeEventListener('gdrive-auth-changed', handleAuth); window.removeEventListener('gdrive-auth-error', handleError); reject(e.detail || new Error('Google sign-in was cancelled or failed.')); };
        window.addEventListener('gdrive-auth-changed', handleAuth,  { once: true });
        window.addEventListener('gdrive-auth-error',   handleError, { once: true });
        try {
          tokenClient.requestAccessToken({ prompt: promptNone ? '' : 'consent' });
        } catch (err) {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error',   handleError);
          reject(err);
        }
      });
    },

    logout() {
      if (cachedToken && window.google && window.google.accounts && window.google.accounts.oauth2) {
        try { window.google.accounts.oauth2.revoke(cachedToken, () => {}); } catch (_) {}
      }
      cachedToken = null; tokenExpiryTime = 0; cachedUser = null; appFolderId = null;
      try {
        sessionStorage.removeItem(STORAGE_KEY_TOKEN);
        localStorage.removeItem(STORAGE_KEY_USER);
        localStorage.removeItem(STORAGE_KEY_FOLDER);
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('gdrive-auth-changed', { detail: { isAuthenticated: false, user: null } }));
    },

    async fetchUserProfile() {
      if (!cachedToken) return null;
      let driveUser = null;
      try {
        const driveRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
          headers: { Authorization: `Bearer ${cachedToken}` }
        });
        if (driveRes.ok) {
          const d = (await driveRes.json()).user;
          if (d) driveUser = { name: d.displayName || (d.emailAddress || 'User').split('@')[0], email: d.emailAddress || '', picture: '' };
        }
      } catch (_) {}
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${cachedToken}` } });
        if (res.ok) {
          const info = await res.json();
          cachedUser = {
            email:   (driveUser && driveUser.email)   || info.email || '',
            name:    (driveUser && driveUser.name)    || info.name  || info.given_name || ((info.email || '').split('@')[0] || 'User'),
            picture: info.picture || ''
          };
          try { localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(cachedUser)); } catch (_) {}
          return cachedUser;
        }
      } catch (_) {}
      if (driveUser) {
        cachedUser = driveUser;
        try { localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(cachedUser)); } catch (_) {}
      }
      return cachedUser;
    },

    // ── Folder management ────────────────────────────────────────────────────

    /**
     * Ensure root "OpenFishTools Projects" folder exists in Drive
     * @returns {Promise<string>} folderId
     */
    async ensureAppFolder() {
      if (appFolderId) return appFolderId;
      const folderName = global.FishGDriveConfig ? global.FishGDriveConfig.getFolderName() : 'OpenFishTools Projects';
      const existing   = await findDriveItem(folderName, 'root', 'application/vnd.google-apps.folder');
      if (existing) {
        appFolderId = existing.id;
        try { localStorage.setItem(STORAGE_KEY_FOLDER, appFolderId); } catch (_) {}
        return appFolderId;
      }
      appFolderId = await createDriveFolder(folderName, 'root');
      try { localStorage.setItem(STORAGE_KEY_FOLDER, appFolderId); } catch (_) {}
      return appFolderId;
    },

    /**
     * Ensure per-project subfolder [projectId] exists inside app folder
     * @param {string} projectId — local project ID (used as folder name)
     * @param {string} [existingFolderId] — if already known, skip search
     * @returns {Promise<string>} Drive subfolder ID
     */
    async ensureProjectFolder(projectId, existingFolderId) {
      if (existingFolderId) return existingFolderId;
      if (_projectFolderCache[projectId] && _projectFolderCache[projectId].folderId) {
        return _projectFolderCache[projectId].folderId;
      }
      const rootId   = await this.ensureAppFolder();
      const existing = await findDriveItem(projectId, rootId, 'application/vnd.google-apps.folder');
      const folderId = existing ? existing.id : await createDriveFolder(projectId, rootId);
      _projectFolderCache[projectId] = _projectFolderCache[projectId] || {};
      _projectFolderCache[projectId].folderId = folderId;
      return folderId;
    },

    /**
     * Ensure "media" subfolder inside project folder
     * @param {string} projectFolderId
     * @returns {Promise<string>} media folder Drive ID
     */
    async ensureMediaFolder(projectFolderId) {
      // Check cache
      const cached = Object.values(_projectFolderCache).find(c => c.folderId === projectFolderId);
      if (cached && cached.mediaFolderId) return cached.mediaFolderId;

      const existing    = await findDriveItem('media', projectFolderId, 'application/vnd.google-apps.folder');
      const mediaFolderId = existing ? existing.id : await createDriveFolder('media', projectFolderId);

      // Store in cache entry
      for (const key of Object.keys(_projectFolderCache)) {
        if (_projectFolderCache[key].folderId === projectFolderId) {
          _projectFolderCache[key].mediaFolderId = mediaFolderId;
        }
      }
      return mediaFolderId;
    },

    /**
     * Find the project.json file ID inside a project folder
     * @param {string} projectFolderId
     * @returns {Promise<string|null>}
     */
    async findProjectJsonFileId(projectFolderId) {
      const item = await findDriveItem('project.json', projectFolderId);
      return item ? item.id : null;
    },

    // ── Project CRUD ─────────────────────────────────────────────────────────

    /**
     * List all cloud projects (subfolders in app folder)
     * @returns {Promise<Array>}
     */
    async listProjects() {
      const rootId = await this.ensureAppFolder();
      const items  = await listDriveFolder(rootId, 'files(id,name,mimeType,modifiedTime)');

      const projects = [];
      for (const item of items) {
        // Support both: new folder-per-project AND legacy single .ofts files
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          // New format: fetch project.json metadata for display name
          try {
            const jsonFile = await findDriveItem('project.json', item.id);
            if (jsonFile) {
              // Download only first 512 bytes to get name (small read)
              const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${jsonFile.id}?alt=media`);
              if (res.ok) {
                const text = await res.text();
                const data = JSON.parse(text);
                projects.push({
                  id:         item.id,      // Drive folder ID
                  name:       data.name || item.name,
                  updatedAt:  item.modifiedTime,
                  isCloud:    true,
                  isNewFormat: true
                });
              }
            }
          } catch (_) {
            // Folder exists but project.json missing or corrupt — show by folder name
            projects.push({ id: item.id, name: item.name, updatedAt: item.modifiedTime, isCloud: true, isNewFormat: true });
          }
        } else if (item.name && item.name.endsWith('.ofts')) {
          // Legacy single-file format
          projects.push({
            id:          item.id,
            name:        item.name.replace(/\.ofts$/i, ''),
            updatedAt:   item.modifiedTime,
            isCloud:     true,
            isLegacy:    true
          });
        }
      }

      return projects;
    },

    /**
     * Create a new project: creates Drive subfolder + project.json
     * @param {Object} projectData
     * @returns {Promise<Object>} { id (Drive folder ID), name, updatedAt }
     */
    async createProject(projectData) {
      const localId  = projectData.id || ('prj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
      const rawName  = (projectData.name || 'New_Project').trim();

      // Create [localId] subfolder inside app folder
      const rootId      = await this.ensureAppFolder();
      const folderId    = await createDriveFolder(localId, rootId);
      _projectFolderCache[localId] = { folderId };

      // Build project.json payload (no media blobs)
      const payload = {
        id:              localId,
        name:            rawName,
        aspectRatio:     projectData.aspectRatio || '16:9',
        resolution:      projectData.resolution  || '1080p',
        fps:             String(projectData.fps  || '60'),
        bgColor:         projectData.bgColor     || 'transparent',
        defaultDuration: projectData.defaultDuration || 5,
        layers:          [],
        createdAt:       new Date().toISOString(),
        updatedAt:       new Date().toISOString()
      };

      const jsonFileId = await this._uploadProjectJson(folderId, null, payload);
      _projectFolderCache[localId].projectJsonFileId = jsonFileId;

      window.dispatchEvent(new CustomEvent('gdrive-projects-updated'));
      return { id: folderId, localId, name: rawName, updatedAt: payload.updatedAt };
    },

    /**
     * Save/update project.json in Drive (layer sync only — no media)
     * @param {string} projectFolderId — Drive folder ID of the project
     * @param {Object} projectData
     * @returns {Promise<{ id, modifiedTime }>}
     */
    async saveProject(projectFolderId, projectData) {
      if (!projectFolderId) throw new Error('Project folder ID is required to save');

      // Lookup or find project.json file ID
      let jsonFileId = null;
      const cacheEntry = Object.values(_projectFolderCache).find(c => c.folderId === projectFolderId);
      if (cacheEntry && cacheEntry.projectJsonFileId) {
        jsonFileId = cacheEntry.projectJsonFileId;
      } else {
        jsonFileId = await this.findProjectJsonFileId(projectFolderId);
      }

      const updatedPayload = Object.assign({}, projectData, { updatedAt: new Date().toISOString() });
      const newJsonFileId  = await this._uploadProjectJson(projectFolderId, jsonFileId, updatedPayload);

      // Update cache
      if (cacheEntry) cacheEntry.projectJsonFileId = newJsonFileId;

      // Fetch modifiedTime from Drive
      try {
        const metaRes = await driveRequest(`https://www.googleapis.com/drive/v3/files/${newJsonFileId}?fields=id,modifiedTime`);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          return { id: projectFolderId, modifiedTime: meta.modifiedTime || new Date().toISOString() };
        }
      } catch (_) {}
      return { id: projectFolderId, modifiedTime: new Date().toISOString() };
    },

    /**
     * Internal: upload or update project.json in a Drive folder
     * @param {string} folderId
     * @param {string|null} existingFileId — null to create new
     * @param {Object} payload
     * @returns {Promise<string>} file ID
     */
    async _uploadProjectJson(folderId, existingFileId, payload) {
      const token   = await this.getAccessToken();
      const body    = JSON.stringify(payload);
      const blob    = new Blob([body], { type: 'application/json' });

      if (existingFileId) {
        // Update existing file content
        const res = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media&fields=id`,
          { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body }
        );
        if (!res.ok) throw new Error(`Failed to update project.json on Drive: ${res.statusText}`);
        const d = await res.json();
        return d.id;
      }

      // Create new project.json via multipart upload
      const boundary = '----FishToolsDriveBoundary' + Date.now();
      const meta     = JSON.stringify({ name: 'project.json', mimeType: 'application/json', parents: [folderId] });
      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart }
      );
      if (!res.ok) throw new Error(`Failed to create project.json on Drive: ${res.statusText}`);
      const d = await res.json();
      return d.id;
    },

    /**
     * Open/load a project from Drive.
     * Handles both new folder format and legacy .ofts single-file format.
     * Downloads missing media to local IDB.
     * @param {string} projectFolderId — Drive folder ID (new) or file ID (legacy .ofts)
     * @returns {Promise<Object>} project data
     */
    async getProject(projectFolderId) {
      if (!projectFolderId) throw new Error('Project folder ID is required');

      // ── Legacy .ofts single-file detection ──────────────────────────────
      // Check if it's a file (not a folder) → legacy mode
      try {
        const metaRes = await driveRequest(`https://www.googleapis.com/drive/v3/files/${projectFolderId}?fields=id,name,mimeType,modifiedTime`);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta.mimeType !== 'application/vnd.google-apps.folder') {
            // Legacy single .ofts file — parse as JSON (old format was plain JSON)
            const mediaRes = await driveRequest(`https://www.googleapis.com/drive/v3/files/${projectFolderId}?alt=media`);
            if (!mediaRes.ok) throw new Error(`Failed to download project: ${mediaRes.statusText}`);
            const text = await mediaRes.text();
            let projectData;
            try { projectData = JSON.parse(text); } catch (_) { throw new Error('Corrupted project file on Google Drive'); }
            projectData.id                  = projectFolderId;
            projectData._cloudFileId        = projectFolderId;
            projectData._cloudModifiedTime  = meta.modifiedTime || new Date().toISOString();
            projectData.isCloud             = true;
            projectData._isLegacyFormat     = true;
            return projectData;
          }
        }
      } catch (err) {
        if (err.message && err.message.includes('session expired')) throw err;
      }

      // ── New folder format ────────────────────────────────────────────────
      const jsonFileId = await this.findProjectJsonFileId(projectFolderId);
      if (!jsonFileId) throw new Error('project.json not found in Drive project folder');

      const [metaRes, jsonRes] = await Promise.all([
        driveRequest(`https://www.googleapis.com/drive/v3/files/${projectFolderId}?fields=id,name,modifiedTime`),
        driveRequest(`https://www.googleapis.com/drive/v3/files/${jsonFileId}?alt=media`)
      ]);

      if (!jsonRes.ok) throw new Error(`Failed to download project.json: ${jsonRes.statusText}`);

      const text = await jsonRes.text();
      let projectData;
      try { projectData = JSON.parse(text); } catch (_) { throw new Error('Corrupted project.json on Google Drive'); }

      const meta = metaRes.ok ? await metaRes.json() : {};
      projectData.id                 = projectFolderId; // Drive folder = project ID
      projectData._cloudFileId       = projectFolderId;
      projectData._cloudModifiedTime = meta.modifiedTime || new Date().toISOString();
      projectData.isCloud            = true;

      // Cache the jsonFileId for faster future saves
      if (!_projectFolderCache[projectData.id]) _projectFolderCache[projectData.id] = {};
      _projectFolderCache[projectData.id].folderId         = projectFolderId;
      _projectFolderCache[projectData.id].projectJsonFileId = jsonFileId;

      // ── Sync missing media from Drive to local IDB ────────────────────────
      await this._syncMissingMedia(projectFolderId, projectData);

      return projectData;
    },

    /**
     * For each mediaId referenced in project layers, check local IDB.
     * Download from Drive media/ subfolder if missing.
     * @param {string} projectFolderId
     * @param {Object} projectData
     */
    async _syncMissingMedia(projectFolderId, projectData) {
      if (!window.FishDatabase) return;

      // Collect all mediaIds referenced in layers
      const mediaIds = new Set();
      function collectMediaIds(layers) {
        if (!Array.isArray(layers)) return;
        for (const l of layers) {
          if (l.mediaId) mediaIds.add(l.mediaId);
          if (l.fillMediaId) mediaIds.add(l.fillMediaId);
          if (Array.isArray(l.layers)) collectMediaIds(l.layers);
        }
      }
      collectMediaIds(projectData.layers || []);
      if (mediaIds.size === 0) return;

      // List all files in media/ subfolder once
      let driveMediaFiles = [];
      try {
        const mediaFolder = await findDriveItem('media', projectFolderId, 'application/vnd.google-apps.folder');
        if (mediaFolder) {
          driveMediaFiles = await listDriveFolder(mediaFolder.id, 'files(id,name,mimeType,size)');
          // Cache the media folder ID
          for (const key of Object.keys(_projectFolderCache)) {
            if (_projectFolderCache[key].folderId === projectFolderId) {
              _projectFolderCache[key].mediaFolderId = mediaFolder.id;
            }
          }
        }
      } catch (_) {}

      // Build a lookup: mediaId → Drive file
      const driveMediaMap = {};
      for (const f of driveMediaFiles) {
        // filename pattern: media_[id]_[originalname]
        const match = f.name.match(/^media_([^_]+(?:_[^_]+)*)_/);
        if (match) driveMediaMap[match[1]] = f;
        // Also try exact prefix
        for (const mid of mediaIds) {
          if (f.name.startsWith('media_' + mid + '_') || f.name === mid) {
            driveMediaMap[mid] = f;
          }
        }
      }

      // Also check project.json's media manifest
      const mediaManifest = {};
      if (Array.isArray(projectData.media)) {
        for (const m of projectData.media) {
          if (m.id && m.filename) mediaManifest[m.id] = m;
        }
      }

      // For each referenced mediaId, check IDB → download if missing
      const downloads = [];
      for (const mediaId of mediaIds) {
        downloads.push((async () => {
          try {
            const existing = await window.FishDatabase.getProjectMedia(projectData.id, false)
              .then(list => list.find(m => m.id === mediaId));
            if (existing) return; // Already in IDB — skip

            // Not in IDB → find in Drive
            const driveFile = driveMediaMap[mediaId];
            if (!driveFile) return; // Not on Drive either — skip

            const mediaRes = await driveRequest(`https://www.googleapis.com/drive/v3/files/${driveFile.id}?alt=media`);
            if (!mediaRes.ok) return;

            const blob     = await mediaRes.blob();
            const manifest = mediaManifest[mediaId] || {};
            const mediaItem = {
              id:         mediaId,
              projectId:  projectData.id,
              name:       manifest.name || driveFile.name,
              type:       manifest.type || (blob.type.startsWith('video') ? 'video' : blob.type.startsWith('audio') ? 'audio' : 'image'),
              mimeType:   manifest.mimeType || blob.type || driveFile.mimeType || '',
              size:       blob.size || parseInt(driveFile.size || '0', 10),
              width:      manifest.width  || null,
              height:     manifest.height || null,
              duration:   manifest.duration || null,
              blob,
              dataUrl:    '',
              thumbUrl:   '',
              createdAt:  manifest.createdAt || new Date().toISOString()
            };
            await window.FishDatabase.saveMedia(mediaItem);
          } catch (_) {}
        })());
      }

      await Promise.allSettled(downloads);
    },

    /**
     * Upload a single media file to the project's media/ subfolder on Drive.
     * Called when user adds a new media asset to a gdrive project.
     * @param {string} projectFolderId
     * @param {Object} mediaItem — { id, name, blob, mimeType, type, size, ... }
     * @returns {Promise<string>} Drive file ID of the uploaded media
     */
    async uploadMedia(projectFolderId, mediaItem) {
      if (!projectFolderId || !mediaItem || !mediaItem.blob) return null;

      const mediaFolderId  = await this.ensureMediaFolder(projectFolderId);
      const token          = await this.getAccessToken();
      const safeName       = `media_${mediaItem.id}_${(mediaItem.name || 'asset').replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      // Check if file already exists on Drive → update instead of create
      const existing = await findDriveItem(safeName, mediaFolderId);

      if (existing) {
        // Update existing file
        const res = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&fields=id`,
          { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mediaItem.mimeType || 'application/octet-stream' }, body: mediaItem.blob }
        );
        if (!res.ok) throw new Error(`Failed to update media on Drive: ${res.statusText}`);
        return existing.id;
      }

      // Create new media file
      const boundary = '----FishToolsMediaBoundary' + Date.now();
      const meta     = JSON.stringify({ name: safeName, parents: [mediaFolderId] });
      const formData = new FormData();
      formData.append('metadata', new Blob([meta], { type: 'application/json' }));
      formData.append('file',     mediaItem.blob);

      // Use resumable upload for large files (> 5MB)
      if (mediaItem.blob.size > 5 * 1024 * 1024) {
        return await this._resumableUpload(mediaFolderId, safeName, mediaItem.blob, mediaItem.mimeType || 'application/octet-stream');
      }

      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mediaItem.mimeType || 'application/octet-stream'}\r\n\r\n`;
      const endBoundary = `\r\n--${boundary}--`;

      // Combine metadata + blob + boundary
      const parts  = [new Blob([multipart]), mediaItem.blob, new Blob([endBoundary])];
      const body   = new Blob(parts, { type: `multipart/related; boundary=${boundary}` });

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
      );
      if (!res.ok) throw new Error(`Failed to upload media to Drive: ${res.statusText}`);
      const d = await res.json();
      return d.id;
    },

    /**
     * Resumable upload for large files (> 5MB)
     */
    async _resumableUpload(folderId, name, blob, mimeType) {
      const token = await this.getAccessToken();
      const meta  = JSON.stringify({ name, parents: [folderId] });

      // 1. Initiate resumable upload
      const initRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': blob.size },
          body: meta
        }
      );
      if (!initRes.ok) throw new Error(`Failed to initiate resumable upload: ${initRes.statusText}`);
      const uploadUrl = initRes.headers.get('Location');
      if (!uploadUrl) throw new Error('No upload URL returned for resumable upload');

      // 2. Upload the actual file
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType, 'Content-Length': blob.size },
        body: blob
      });
      if (!uploadRes.ok) throw new Error(`Resumable upload failed: ${uploadRes.statusText}`);
      const d = await uploadRes.json();
      return d.id;
    },

    /**
     * Delete a media file from Drive project's media/ subfolder.
     * Called when user removes a media asset from a gdrive project.
     * @param {string} projectFolderId
     * @param {string} mediaId — the mediaItem.id
     */
    async deleteMedia(projectFolderId, mediaId) {
      if (!projectFolderId || !mediaId) return;

      // Find media folder
      const mediaFolder = await findDriveItem('media', projectFolderId, 'application/vnd.google-apps.folder');
      if (!mediaFolder) return;

      // List and find matching file
      const files = await listDriveFolder(mediaFolder.id, 'files(id,name)');
      const target = files.find(f => f.name.startsWith(`media_${mediaId}_`) || f.name === mediaId);
      if (!target) return;

      const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${target.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to delete media from Drive: ${res.statusText}`);
      }
    },

    /**
     * Delete a project folder (and all its contents) from Drive
     * @param {string} projectFolderId
     */
    async deleteProject(projectFolderId) {
      if (!projectFolderId) return;
      const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${projectFolderId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`Failed to delete project on Drive: ${res.statusText}`);
      // Clear cache
      for (const key of Object.keys(_projectFolderCache)) {
        if (_projectFolderCache[key].folderId === projectFolderId) delete _projectFolderCache[key];
      }
      window.dispatchEvent(new CustomEvent('gdrive-projects-updated'));
    },

    /**
     * Rename a project (updates project.json name field + Drive folder description)
     * @param {string} projectFolderId
     * @param {string} newName
     */
    async renameProject(projectFolderId, newName) {
      if (!projectFolderId || !newName) return;
      const rawName = newName.trim();

      // Update project.json with new name
      try {
        const jsonFileId = await this.findProjectJsonFileId(projectFolderId);
        if (jsonFileId) {
          const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${jsonFileId}?alt=media`);
          if (res.ok) {
            const data  = await res.json();
            data.name   = rawName;
            data.updatedAt = new Date().toISOString();
            await this._uploadProjectJson(projectFolderId, jsonFileId, data);
          }
        }
      } catch (_) {}

      window.dispatchEvent(new CustomEvent('gdrive-projects-updated'));
    },

    /**
     * Check if project.json on Drive was modified by another session
     * Compares Drive folder modifiedTime vs local lastKnownTime
     * @param {string} projectFolderId
     * @param {string} lastKnownTime — ISO timestamp
     * @returns {Promise<{ hasChanged: boolean, modifiedTime: string }>}
     */
    async checkFileModified(projectFolderId, lastKnownTime) {
      if (!projectFolderId || !this.isAuthenticated()) return { hasChanged: false };
      try {
        const jsonFileId = await this.findProjectJsonFileId(projectFolderId);
        if (!jsonFileId) return { hasChanged: false };
        const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${jsonFileId}?fields=modifiedTime,version`);
        if (!res.ok) return { hasChanged: false };
        const meta = await res.json();
        if (meta.modifiedTime && lastKnownTime) {
          const remoteTime = new Date(meta.modifiedTime).getTime();
          const localTime  = new Date(lastKnownTime).getTime();
          if (remoteTime > localTime + 10000) {
            return { hasChanged: true, modifiedTime: meta.modifiedTime, version: meta.version };
          }
        }
        return { hasChanged: false, modifiedTime: meta.modifiedTime };
      } catch (_) {
        return { hasChanged: false };
      }
    }
  };

  // ── GIS Init: poll until google.accounts.oauth2 is available ─────────────
  function tryInitTokenClient() {
    if (typeof window.google !== 'undefined' && window.google.accounts && window.google.accounts.oauth2) {
      FishGDriveSync.initTokenClient();
    }
  }

  if (typeof window !== 'undefined') {
    tryInitTokenClient();
    window.addEventListener('load', tryInitTokenClient);
    window.addEventListener('gdrive-config-loaded', tryInitTokenClient);
    let _gisInitPoll = setInterval(() => {
      if (typeof window.google !== 'undefined' && window.google.accounts && window.google.accounts.oauth2) {
        clearInterval(_gisInitPoll);
        FishGDriveSync.initTokenClient();
      }
    }, 100);
    setTimeout(() => clearInterval(_gisInitPoll), 10000);
  }

  global.FishGDriveSync = FishGDriveSync;
})(typeof window !== 'undefined' ? window : this);
