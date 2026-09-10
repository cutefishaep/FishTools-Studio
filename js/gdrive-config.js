/**
 * OpenFishTools Studio - Google Drive Configuration & Settings
 * Modular OAuth2 Client ID and Drive App Folder configuration.
 */

(function(global) {
  'use strict';

  const STORAGE_KEY_CLIENT_ID = 'fishtools_gdrive_client_id';
  const DEFAULT_FOLDER_NAME = 'OpenFishTools Projects';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file email profile';

  // Default client ID fallback (empty by default, loaded securely from .env or user input)
  const DEFAULT_CLIENT_ID = '';
  let serverEnvClientId = '';

  // Fetch /__config from backend server if running
  if (typeof fetch === 'function') {
    fetch('/__config')
      .then(res => res.json())
      .then(cfg => {
        if (cfg && cfg.googleClientId) {
          serverEnvClientId = cfg.googleClientId.trim();
          if (global.FishGDriveSync && typeof global.FishGDriveSync.initTokenClient === 'function') {
            global.FishGDriveSync.initTokenClient();
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gdrive-config-loaded', { detail: { clientId: serverEnvClientId } }));
          }
        }
      })
      .catch(() => {});
  }

  const FishGDriveConfig = {
    /**
     * Retrieves active Google OAuth 2.0 Client ID (localStorage, .env, or default fallback)
     * @returns {string}
     */
    getClientId() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY_CLIENT_ID);
        if (stored && stored.trim()) return stored.trim();
      } catch (_) {}
      return serverEnvClientId || DEFAULT_CLIENT_ID;
    },

    /**
     * Saves user-configured Client ID to localStorage
     * @param {string} clientId
     */
    setClientId(clientId) {
      try {
        if (clientId && clientId.trim()) {
          localStorage.setItem(STORAGE_KEY_CLIENT_ID, clientId.trim());
        } else {
          localStorage.removeItem(STORAGE_KEY_CLIENT_ID);
        }
      } catch (_) {}
    },

    /**
     * Checks if a valid Client ID format is configured
     * @returns {boolean}
     */
    hasClientId() {
      const id = this.getClientId();
      return Boolean(id && id.length > 10 && id.includes('.apps.googleusercontent.com'));
    },

    /**
     * Checks if Client ID was supplied via server environment (.env)
     * @returns {boolean}
     */
    isEnvConfigured() {
      return Boolean(serverEnvClientId);
    },

    getFolderName() {
      return DEFAULT_FOLDER_NAME;
    },

    getScope() {
      return SCOPE;
    }
  };

  global.FishGDriveConfig = FishGDriveConfig;
})(typeof window !== 'undefined' ? window : this);
