/**
 * OpenFishTools Studio - Google Drive Cloud Sync Engine (FishGDriveSync)
 * Handles Google OAuth2 (GIS), Drive v3 REST API, cloud project CRUD,
 * auto-sync debouncing, and multi-device polling awareness.
 */

(function(global) {
  'use strict';

  const STORAGE_KEY_TOKEN = 'fishtools_gdrive_token';
  const STORAGE_KEY_USER = 'fishtools_gdrive_user';
  const STORAGE_KEY_FOLDER = 'fishtools_gdrive_folder_id';

  let tokenClient = null;
  let cachedToken = null;
  let tokenExpiryTime = 0;
  let cachedUser = null;
  let appFolderId = null;

  // Restore stored session if valid
  try {
    const rawTok = sessionStorage.getItem(STORAGE_KEY_TOKEN);
    if (rawTok) {
      const parsed = JSON.parse(rawTok);
      if (parsed.access_token && parsed.expires_at > Date.now()) {
        cachedToken = parsed.access_token;
        tokenExpiryTime = parsed.expires_at;
      }
    }
    const rawUser = localStorage.getItem(STORAGE_KEY_USER);
    if (rawUser) {
      cachedUser = JSON.parse(rawUser);
    }
    appFolderId = localStorage.getItem(STORAGE_KEY_FOLDER) || null;
  } catch (_) {}

  const FishGDriveSync = {
    /**
     * Check if user is currently authenticated with a non-expired token
     * @returns {boolean}
     */
    isAuthenticated() {
      return Boolean(cachedToken && Date.now() < tokenExpiryTime);
    },

    /**
     * Get current user profile (email, name, picture)
     * @returns {Object|null}
     */
    getUser() {
      return cachedUser;
    },

    /**
     * Get active access token, requesting fresh token if expired
     * @returns {Promise<string>}
     */
    async getAccessToken() {
      if (this.isAuthenticated()) {
        return cachedToken;
      }
      // Token expired or missing — try to refresh silently via GIS (no popup)
      // If tokenClient is not ready or prompt fails, throw a friendly error
      return new Promise((resolve, reject) => {
        if (!tokenClient) {
          this.initTokenClient();
        }
        if (!tokenClient) {
          reject(new Error('Google session expired. Please return to the dashboard and sign in again.'));
          return;
        }
        const handleAuth = (e) => {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error', handleError);
          if (cachedToken) resolve(cachedToken);
          else reject(new Error('Google session expired. Please return to the dashboard and sign in again.'));
        };
        const handleError = (e) => {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error', handleError);
          reject(new Error('Google session expired. Please return to the dashboard and sign in again.'));
        };
        window.addEventListener('gdrive-auth-changed', handleAuth, { once: true });
        window.addEventListener('gdrive-auth-error', handleError, { once: true });
        try {
          // prompt='' = no popup, silent attempt only
          tokenClient.requestAccessToken({ prompt: '' });
        } catch (err) {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error', handleError);
          reject(new Error('Google session expired. Please return to the dashboard and sign in again.'));
        }
      });
    },

    /**
     * Initialize Google Identity Services token client
     */
    initTokenClient() {
      if (tokenClient || typeof window.google === 'undefined' || !window.google.accounts || !window.google.accounts.oauth2) {
        return;
      }
      const clientId = (global.FishGDriveConfig && typeof global.FishGDriveConfig.getClientId === 'function')
        ? global.FishGDriveConfig.getClientId()
        : '';

      if (!clientId) return;

      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: global.FishGDriveConfig ? global.FishGDriveConfig.getScope() : 'https://www.googleapis.com/auth/drive.file',
        callback: (response) => {
          if (response.error) {
            console.error('[GDriveSync] OAuth error:', response);
            window.dispatchEvent(new CustomEvent('gdrive-auth-error', { detail: response }));
            return;
          }
          if (response.access_token) {
            cachedToken = response.access_token;
            // expires_in is in seconds
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

    /**
     * Trigger Google OAuth login popup
     * @param {boolean} promptNone - If true, tries silent auth without popup if possible
     * @returns {Promise<string>}
     */
    async login(promptNone = false) {
      const clientId = global.FishGDriveConfig ? global.FishGDriveConfig.getClientId() : '';
      if (!clientId) {
        throw new Error('Google Client ID is not configured.');
      }

      if (!tokenClient) {
        this.initTokenClient();
      }

      if (!tokenClient) {
        throw new Error('Google Identity Services client is not loaded. Please check internet connection.');
      }

      return new Promise((resolve, reject) => {
        const handleAuth = (e) => {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error', handleError);
          resolve(cachedToken);
        };
        const handleError = (e) => {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error', handleError);
          reject(e.detail || new Error('Google sign-in was cancelled or failed.'));
        };

        window.addEventListener('gdrive-auth-changed', handleAuth, { once: true });
        window.addEventListener('gdrive-auth-error', handleError, { once: true });

        try {
          tokenClient.requestAccessToken({ prompt: promptNone ? '' : 'consent' });
        } catch (err) {
          window.removeEventListener('gdrive-auth-changed', handleAuth);
          window.removeEventListener('gdrive-auth-error', handleError);
          reject(err);
        }
      });
    },

    /**
     * Sign out and clear cached tokens
     */
    logout() {
      if (cachedToken && window.google && window.google.accounts && window.google.accounts.oauth2) {
        try {
          window.google.accounts.oauth2.revoke(cachedToken, () => {});
        } catch (_) {}
      }
      cachedToken = null;
      tokenExpiryTime = 0;
      cachedUser = null;
      appFolderId = null;

      try {
        sessionStorage.removeItem(STORAGE_KEY_TOKEN);
        localStorage.removeItem(STORAGE_KEY_USER);
        localStorage.removeItem(STORAGE_KEY_FOLDER);
      } catch (_) {}

      window.dispatchEvent(new CustomEvent('gdrive-auth-changed', {
        detail: { isAuthenticated: false, user: null }
      }));
    },

    /**
     * Fetches user profile from Google Drive API about endpoint or userinfo
     */
    async fetchUserProfile() {
      if (!cachedToken) return null;

      let driveUser = null;

      // 1. Try Google Drive v3 about endpoint for name + email (works under drive.file scope)
      try {
        const driveRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
          headers: { Authorization: `Bearer ${cachedToken}` }
        });
        if (driveRes.ok) {
          const driveData = await driveRes.json();
          if (driveData && driveData.user) {
            const u = driveData.user;
            driveUser = {
              name: u.displayName || (u.emailAddress ? u.emailAddress.split('@')[0] : 'User'),
              email: u.emailAddress || '',
              picture: '' // will be filled from userinfo
            };
          }
        }
      } catch (err) {
        console.warn('[GDriveSync] Drive about query error:', err);
      }

      // 2. Always try oauth2 userinfo for picture URL (CORS-safe from Google's CDN)
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${cachedToken}` }
        });
        if (res.ok) {
          const info = await res.json();
          cachedUser = {
            email: (driveUser && driveUser.email) || info.email || '',
            name: (driveUser && driveUser.name) || info.name || info.given_name || (info.email ? info.email.split('@')[0] : 'User'),
            picture: info.picture || ''
          };
          try {
            localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(cachedUser));
          } catch (_) {}
          return cachedUser;
        }
      } catch (e) {
        console.warn('[GDriveSync] Failed to fetch user info:', e);
      }

      // 3. Fall back to Drive-only data if userinfo failed
      if (driveUser) {
        cachedUser = driveUser;
        try { localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(cachedUser)); } catch (_) {}
      }

      return cachedUser;
    },

    /**
     * Ensure the dedicated folder "OpenFishTools Projects" exists in user's Google Drive root
     * @returns {Promise<string>} folderId
     */
    async ensureAppFolder() {
      if (appFolderId) return appFolderId;
      const token = await this.getAccessToken();
      const folderName = global.FishGDriveConfig ? global.FishGDriveConfig.getFolderName() : 'OpenFishTools Projects';

      // 1. Search existing folder
      const query = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`);
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!searchRes.ok) {
        throw new Error(`Failed to query Google Drive folder: ${searchRes.statusText}`);
      }

      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        appFolderId = searchData.files[0].id;
        try { localStorage.setItem(STORAGE_KEY_FOLDER, appFolderId); } catch (_) {}
        return appFolderId;
      }

      // 2. Create folder if not found
      const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder'
        })
      });

      if (!createRes.ok) {
        throw new Error(`Failed to create Google Drive folder: ${createRes.statusText}`);
      }

      const createData = await createRes.json();
      appFolderId = createData.id;
      try { localStorage.setItem(STORAGE_KEY_FOLDER, appFolderId); } catch (_) {}
      return appFolderId;
    },

    /**
     * Lists all .ofts / json project files inside OpenFishTools folder
     * @returns {Promise<Array>} Array of project descriptor objects
     */
    async listProjects() {
      const token = await this.getAccessToken();
      const folderId = await this.ensureAppFolder();

      const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const fields = encodeURIComponent('files(id, name, modifiedTime, size, mimeType, description, appProperties)');
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime desc`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        if (res.status === 401) {
          this.logout();
          throw new Error('Google session expired. Please sign in again.');
        }
        throw new Error(`Drive list error: ${res.statusText}`);
      }

      const data = await res.json();
      const list = (data.files || []).map(f => {
        let cleanName = (f.name || 'Untitled_Project').replace(/\.ofts$/i, '');
        let formattedSize = '12 KB';
        if (f.size) {
          const b = parseInt(f.size, 10);
          if (b >= 1048576) formattedSize = (b / 1048576).toFixed(1) + ' MB';
          else formattedSize = Math.max(1, Math.round(b / 1024)) + ' KB';
        }
        return {
          id: f.id,
          name: cleanName,
          fileName: f.name,
          updatedAt: f.modifiedTime,
          size: formattedSize,
          sizeBytes: parseInt(f.size || '0', 10),
          isCloud: true
        };
      });

      return list;
    },

    /**
     * Download and parse project JSON from Google Drive
     * @param {string} fileId
     * @returns {Promise<Object>} parsed project object
     */
    async getProject(fileId) {
      if (!fileId) throw new Error('File ID is required');
      const token = await this.getAccessToken();

      // Fetch metadata and media in parallel
      const [metaRes, mediaRes] = await Promise.all([
        fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,modifiedTime,version`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      if (!mediaRes.ok) {
        throw new Error(`Failed to download project from Drive: ${mediaRes.statusText}`);
      }

      const text = await mediaRes.text();
      let projectData;
      try {
        projectData = JSON.parse(text);
      } catch (e) {
        throw new Error('Corrupted or invalid .ofts project JSON on Google Drive');
      }

      const meta = metaRes.ok ? await metaRes.json() : {};
      projectData.id = fileId;
      projectData._cloudFileId = fileId;
      projectData._cloudModifiedTime = meta.modifiedTime || new Date().toISOString();
      projectData._cloudVersion = meta.version || 1;
      projectData.isCloud = true;

      return projectData;
    },

    /**
     * Create a new project in Google Drive
     * @param {Object} projectData
     * @returns {Promise<Object>} created file metadata
     */
    async createProject(projectData) {
      const token = await this.getAccessToken();
      const folderId = await this.ensureAppFolder();

      const rawName = (projectData.name || 'New_Project').trim();
      const fileName = rawName.endsWith('.ofts') ? rawName : `${rawName}.ofts`;

      const initialPayload = Object.assign({
        name: rawName,
        aspectRatio: projectData.aspectRatio || '16:9',
        resolution: projectData.resolution || '1080p',
        fps: String(projectData.fps || '60'),
        bgColor: projectData.bgColor || 'transparent',
        defaultDuration: projectData.defaultDuration || 5,
        layers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, projectData);

      const metadata = {
        name: fileName,
        mimeType: 'application/json',
        parents: [folderId]
      };

      const boundary = '-------OpenFishToolsDriveBoundary' + Date.now();
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody = delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(initialPayload) +
        closeDelimiter;

      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });

      if (!res.ok) {
        throw new Error(`Failed to create project on Google Drive: ${res.statusText}`);
      }

      const created = await res.json();
      window.dispatchEvent(new CustomEvent('gdrive-projects-updated'));
      return {
        id: created.id,
        name: rawName,
        fileName: fileName,
        updatedAt: new Date().toISOString()
      };
    },

    /**
     * Save / Update project JSON content in Google Drive
     * @param {string} fileId
     * @param {Object} projectData
     * @returns {Promise<Object>}
     */
    async saveProject(fileId, projectData) {
      if (!fileId) throw new Error('File ID is required to save');
      const token = await this.getAccessToken();

      const payloadString = JSON.stringify(projectData, null, 2);

      const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: payloadString
      });

      if (!res.ok) {
        throw new Error(`Failed to save to Google Drive: ${res.statusText}`);
      }

      const updated = await res.json();
      // Return server-side modifiedTime so caller can sync timestamp accurately
      return { id: updated.id, modifiedTime: updated.modifiedTime || new Date().toISOString() };
    },

    /**
     * Delete a project file from Google Drive
     * @param {string} fileId
     */
    async deleteProject(fileId) {
      if (!fileId) return;
      const token = await this.getAccessToken();

      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to delete project on Google Drive: ${res.statusText}`);
      }

      window.dispatchEvent(new CustomEvent('gdrive-projects-updated'));
    },

    /**
     * Rename a project file on Google Drive
     * @param {string} fileId
     * @param {string} newName
     */
    async renameProject(fileId, newName) {
      if (!fileId || !newName) return;
      const token = await this.getAccessToken();
      const rawName = newName.trim();
      const fileName = rawName.endsWith('.ofts') ? rawName : `${rawName}.ofts`;

      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: fileName })
      });

      if (!res.ok) {
        throw new Error(`Failed to rename project on Google Drive: ${res.statusText}`);
      }

      window.dispatchEvent(new CustomEvent('gdrive-projects-updated'));
    },

    /**
     * Check if a remote project file on Drive has been updated by another session / device
     * @param {string} fileId
     * @param {string} lastKnownTime - ISO timestamp of current device's last sync
     * @returns {Promise<{ hasChanged: boolean, modifiedTime: string }>}
     */
    async checkFileModified(fileId, lastKnownTime) {
      if (!fileId || !this.isAuthenticated()) return { hasChanged: false };
      try {
        const token = cachedToken;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime,version`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return { hasChanged: false };
        const meta = await res.json();
        if (meta.modifiedTime && lastKnownTime) {
          const remoteTime = new Date(meta.modifiedTime).getTime();
          const localTime = new Date(lastKnownTime).getTime();
          // 10 second grace buffer — covers Drive server clock skew + upload latency
          if (remoteTime > localTime + 10000) {
            return { hasChanged: true, modifiedTime: meta.modifiedTime, version: meta.version };
          }
        }
        return { hasChanged: false, modifiedTime: meta.modifiedTime };
      } catch (e) {
        return { hasChanged: false };
      }
    }
  };

  // ── GIS Init: poll until google.accounts.oauth2 is available, then init ──
  function tryInitTokenClient() {
    if (
      typeof window.google !== 'undefined' &&
      window.google.accounts &&
      window.google.accounts.oauth2
    ) {
      FishGDriveSync.initTokenClient();
    }
  }

  if (typeof window !== 'undefined') {
    // Fire immediately in case GIS already loaded (e.g., script tag before us)
    tryInitTokenClient();

    // Also fire when GIS finishes loading (async defer)
    window.addEventListener('load', tryInitTokenClient);

    // Also fire when our config is ready (in case GIS was already loaded but config wasn't)
    window.addEventListener('gdrive-config-loaded', tryInitTokenClient);

    // Fallback poll — handles race between GIS async and our script
    let _gisInitPoll = setInterval(() => {
      if (
        typeof window.google !== 'undefined' &&
        window.google.accounts &&
        window.google.accounts.oauth2
      ) {
        clearInterval(_gisInitPoll);
        FishGDriveSync.initTokenClient();
      }
    }, 100);
    // Stop polling after 10s regardless
    setTimeout(() => clearInterval(_gisInitPoll), 10000);
  }

  global.FishGDriveSync = FishGDriveSync;
})(typeof window !== 'undefined' ? window : this);
