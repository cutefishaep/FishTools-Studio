/**
 * OpenFishTools Studio - Main JavaScript
 * Handles data fetching from FishDatabase, New Project creation,
 * Your Project listing, ContextMenu integration, and package version.
 */

// Fallback empty projects list
const FALLBACK_PROJECTS = [];

document.addEventListener('DOMContentLoaded', () => {
  initUIProtections();
  initVersionFetcher();
  initProjectsFetcher();
  initGDriveDashboard();
  initWelcomeModal();

  // Handle redirect errors from editor (ghost project guard)
  const _urlErr = new URLSearchParams(window.location.search).get('error');
  if (_urlErr) {
    const _errMessages = {
      login_required: 'Login dulu untuk buka cloud project.',
      project_not_found: 'Project tidak ditemukan atau sudah dihapus.'
    };
    setTimeout(() => showDashboardToast(_errMessages[_urlErr] || 'Project tidak valid.', 4000), 600);
    // Clean the ?error= from URL bar without reload
    history.replaceState(null, '', window.location.pathname);
  }
});

/**
 * Disables browser context menu (right click), zoom, and text selection
 */
function initUIProtections() {
  // Disable text selection drag
  document.addEventListener('selectstart', (e) => {
    // Allow input and textarea elements to be selected
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
  });

  // Disable Ctrl + Wheel Zoom
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  }, { passive: false });

  // Disable Ctrl/Cmd + (+, -, 0, =) Zoom keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', '_'].includes(e.key)) {
      e.preventDefault();
    }
  });

  // Disable Safari/iOS Multi-touch Gestures (Pinch to zoom)
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend', (e) => e.preventDefault());
}

/**
 * Formats raw package version into clean short form:
 * e.g., "0.1.0-pre-alpha" -> "0.1.0 PA"
 */
function formatAppVersion(raw) {
  if (!raw) return '0.4.6';
  let str = String(raw).trim().replace(/^v\.?/i, '');
  
  let tag = '';
  if (/[-_.\s]pre[-_.\s]?alpha$/i.test(str)) {
    tag = 'Pre-Alpha';
    str = str.replace(/[-_.\s]pre[-_.\s]?alpha$/i, '');
  } else if (/[-_.\s]alpha$/i.test(str)) {
    tag = 'Alpha';
    str = str.replace(/[-_.\s]alpha$/i, '');
  } else if (/[-_.\s]beta$/i.test(str)) {
    tag = 'Beta';
    str = str.replace(/[-_.\s]beta$/i, '');
  }
  
  const numPart = str.replace(/[-_]/g, '.');
  return tag ? `${numPart} ${tag}` : numPart;
}

/**
 * Formats relative timestamp for project card
 */
function formatRelativeTime(isoString) {
  if (!isoString) return 'Just now';
  const timestamp = new Date(isoString).getTime();
  if (isNaN(timestamp)) return 'Just now';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Dynamically detects latest version tag and synchronizes version pills/badges
 * across Studio navbar and Welcome changelog modal without hardcoding tag literals.
 */
function syncWelcomeVersionTags(pkgVersion) {
  let detected = pkgVersion;
  if (!detected) {
    const firstPill = document.querySelector('.welcome-changelog-feed .welcome-version-pill');
    if (firstPill && firstPill.textContent) {
      detected = firstPill.textContent.trim();
    }
  }
  if (!detected) {
    detected = '0.4.6';
  }

  const cleanNum = String(detected).trim().replace(/^v\.?/i, '');
  const displayTag = `v${cleanNum}`;

  // 1. Sync Studio top navbar badge
  const badgeEl = document.getElementById('studio-version-badge');
  if (badgeEl) {
    badgeEl.textContent = formatAppVersion(cleanNum);
  }

  // 2. Sync Welcome modal header badge
  const welcomeBadge = document.querySelector('.welcome-header-title-box .welcome-badge');
  if (welcomeBadge) {
    welcomeBadge.textContent = displayTag;
  }

  // 3. Dynamically assign Latest badge only to the first version block
  const blocks = document.querySelectorAll('.welcome-changelog-feed .welcome-version-block');
  blocks.forEach((block, index) => {
    const header = block.querySelector('.welcome-version-header');
    let latestBadge = block.querySelector('.welcome-version-badge-latest');
    if (index === 0) {
      if (!latestBadge && header) {
        latestBadge = document.createElement('span');
        latestBadge.className = 'welcome-version-badge-latest';
        latestBadge.textContent = 'Latest';
        const pill = header.querySelector('.welcome-version-pill');
        if (pill && pill.nextSibling) {
          header.insertBefore(latestBadge, pill.nextSibling);
        } else {
          header.appendChild(latestBadge);
        }
      }
      const pill = block.querySelector('.welcome-version-pill');
      if (pill && !pill.textContent.trim()) {
        pill.textContent = displayTag;
      }
    } else {
      if (latestBadge) {
        latestBadge.remove();
      }
    }
  });
}

/**
 * Fetches package.json and updates the badges dynamically
 */
async function initVersionFetcher() {
  if (window.location.protocol === 'file:') {
    syncWelcomeVersionTags();
    return;
  }

  try {
    const response = await fetch('./package.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const pkg = await response.json();
    if (pkg && pkg.version) {
      syncWelcomeVersionTags(pkg.version);
      return;
    }
  } catch (err) {
    // fallback
  }
  syncWelcomeVersionTags();
}

/**
 * Loads projects from FishDatabase and populates the "Your Project" list
 */
async function initProjectsFetcher() {
  const listContainer = document.getElementById('projects-container');
  const countBadge = document.getElementById('project-count-badge');
  if (!listContainer) return;

  async function loadAndRender() {
    let projects = [];
    if (window.FishDatabase && typeof window.FishDatabase.getProjects === 'function') {
      try {
        projects = await window.FishDatabase.getProjects();
      } catch (e) {
        projects = [];
      }
    }
    renderProjects(projects, listContainer, countBadge);
  }

  // Initial load
  await loadAndRender();

  // Listen to custom DB project update events
  window.addEventListener('fish-db-projects-updated', () => {
    loadAndRender();
  });

  // Project item left-click navigation (delegated)
  listContainer.addEventListener('click', (e) => {
    const swipeBox = e.target.closest('.project-swipe-container');
    if (swipeBox && swipeBox._hasSwiped) {
      return;
    }
    const item = e.target.closest('.project-item');
    if (!item) return;
    const projectId = item.dataset.id;
    if (projectId) {
      window.location.href = `editor.html?id=${encodeURIComponent(projectId)}`;
    }
  });

  // Attach Right-Click & Press-Hold ContextMenu
  if (window.ContextMenu && typeof window.ContextMenu.bindTrigger === 'function') {
    window.ContextMenu.bindTrigger(listContainer, '.project-item', (target) => {
      const projectId = target.dataset.id;
      const projectName = target.querySelector('.project-name')?.textContent || 'Project';
      return [
        {
          label: 'Save as .ofts',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
          action: () => exportProjectAction(projectId, projectName)
        },
        {
          label: 'Project Settings',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
          action: () => openProjectSettingsModal(projectId)
        },
        {
          label: 'Duplicate',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
          action: async () => {
            if (window.FishDatabase) {
              await window.FishDatabase.duplicateProject(projectId);
              await loadAndRender();
            }
          }
        },
        { divider: true },
        {
          label: 'Remove project',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
          danger: true,
          action: () => openDeleteModal(projectId, projectName)
        }
      ];
    });
  }
}

let activeProjectsTab = 'local'; // 'local' | 'cloud'

/**
 * Initializes Google Drive Cloud Sync dashboard, dual tabs, auth, and cloud projects list
 */
function initGDriveDashboard() {
  const tabLocal = document.getElementById('tab-local-projects');
  const tabCloud = document.getElementById('tab-cloud-projects');
  const panelLocal = document.getElementById('panel-local-projects');
  const panelCloud = document.getElementById('panel-cloud-projects');
  const cloudContainer = document.getElementById('cloud-projects-container');
  const cloudBadge = document.getElementById('cloud-count-badge');
  const loginBox = document.getElementById('gdrive-login-box');
  const userBar = document.getElementById('gdrive-user-bar');
  const btnLogin = document.getElementById('btn-gdrive-login');
  const btnLogout = document.getElementById('btn-gdrive-logout');
  const btnRefresh = document.getElementById('btn-gdrive-refresh');
  const btnSaveConfig = document.getElementById('btn-save-gdrive-config');
  const inputClientId = document.getElementById('input-gdrive-client-id');

  if (!tabLocal || !tabCloud) return;

  // Manage Client ID config presentation securely
  function updateClientIdInput() {
    if (!inputClientId || !window.FishGDriveConfig) return;
    const hintEl = document.getElementById('gdrive-config-hint');
    let stored = '';
    try {
      stored = localStorage.getItem('fishtools_gdrive_client_id') || '';
    } catch (_) {}

    if (stored) {
      inputClientId.value = stored;
      if (hintEl) hintEl.textContent = 'Custom Client ID saved in browser storage (masked). Clear and save to use .env.';
    } else if (window.FishGDriveConfig.isEnvConfigured()) {
      inputClientId.value = '';
      inputClientId.placeholder = 'Configured via server (.env)';
      if (hintEl) hintEl.textContent = 'OAuth Client ID active from .env (hidden for privacy). Leave blank to keep using .env.';
    } else {
      inputClientId.value = '';
      inputClientId.placeholder = 'Enter Client ID (.apps.googleusercontent.com)';
      if (hintEl) hintEl.textContent = 'Enter your Google Cloud OAuth 2.0 Client ID.';
    }
  }

  updateClientIdInput();
  window.addEventListener('gdrive-config-loaded', updateClientIdInput);

  if (btnSaveConfig && inputClientId) {
    btnSaveConfig.addEventListener('click', () => {
      const val = inputClientId.value.trim();
      if (window.FishGDriveConfig) {
        window.FishGDriveConfig.setClientId(val);
      }
      if (window.FishGDriveSync) {
        window.FishGDriveSync.initTokenClient();
      }
      if (window.Modal) {
        window.Modal.close('modal-gdrive-config');
      }
      updateClientIdInput();
      showDashboardToast(val ? 'Custom Google Client ID saved' : 'Using server .env configuration');
    });
  }

  // Switch to Local Tab
  function switchToLocal() {
    activeProjectsTab = 'local';
    tabLocal.classList.add('is-active');
    tabLocal.setAttribute('aria-selected', 'true');
    tabCloud.classList.remove('is-active');
    tabCloud.setAttribute('aria-selected', 'false');
    if (panelLocal) panelLocal.style.display = '';
    if (panelCloud) panelCloud.style.display = 'none';
  }

  // Switch to Cloud Tab
  function switchToCloud() {
    activeProjectsTab = 'cloud';
    tabCloud.classList.add('is-active');
    tabCloud.setAttribute('aria-selected', 'true');
    tabLocal.classList.remove('is-active');
    tabLocal.setAttribute('aria-selected', 'false');
    if (panelCloud) panelCloud.style.display = '';
    if (panelLocal) panelLocal.style.display = 'none';
    if (cloudBadge) cloudBadge.style.display = '';

    syncGDriveUI();
  }

  tabLocal.addEventListener('click', switchToLocal);
  tabCloud.addEventListener('click', switchToCloud);

  // Sync Google Drive Auth State & UI
  async function syncGDriveUI() {
    const isAuthed = window.FishGDriveSync && window.FishGDriveSync.isAuthenticated();
    if (!isAuthed) {
      if (loginBox) loginBox.style.display = '';
      if (userBar) userBar.style.display = 'none';
      if (cloudContainer) cloudContainer.style.display = 'none';
      if (cloudBadge) cloudBadge.style.display = 'none';
      return;
    }

    if (loginBox) loginBox.style.display = 'none';
    if (userBar) userBar.style.display = 'flex';
    if (cloudContainer) cloudContainer.style.display = 'flex';
    if (cloudBadge) cloudBadge.style.display = '';

    const user = window.FishGDriveSync.getUser();
    const nameEl = document.getElementById('gdrive-user-name');
    const emailEl = document.getElementById('gdrive-user-email');
    const avatarEl = document.getElementById('gdrive-user-avatar');
    const fallbackAvatar = document.getElementById('gdrive-user-avatar-fallback');

    function applyUserDetails(u) {
      if (!u) return;
      if (nameEl) nameEl.textContent = u.name || (u.email ? u.email.split('@')[0] : 'User');
      if (emailEl) emailEl.textContent = u.email || '';
      if (avatarEl && u.picture) {
        avatarEl.onerror = () => {
          // Photo blocked by CORS/ORB — fall back to initials avatar silently
          avatarEl.style.display = 'none';
          avatarEl.onerror = null;
          if (fallbackAvatar) fallbackAvatar.style.display = 'flex';
        };
        avatarEl.src = u.picture;
        avatarEl.style.display = '';
        if (fallbackAvatar) fallbackAvatar.style.display = 'none';
      } else {
        if (avatarEl) avatarEl.style.display = 'none';
        if (fallbackAvatar) fallbackAvatar.style.display = 'flex';
      }
    }

    if (user) {
      applyUserDetails(user);
    }

    // If user info is not loaded yet or default fallback, fetch live from Drive API
    if (!user || user.name === 'Google User' || !user.email) {
      if (window.FishGDriveSync && typeof window.FishGDriveSync.fetchUserProfile === 'function') {
        window.FishGDriveSync.fetchUserProfile().then(freshUser => {
          if (freshUser) applyUserDetails(freshUser);
        }).catch(() => {});
      }
    }

    await loadAndRenderCloudProjects();
  }

  // Load and render cloud projects from Google Drive
  async function loadAndRenderCloudProjects() {
    if (!cloudContainer || !window.FishGDriveSync || !window.FishGDriveSync.isAuthenticated()) return;

    cloudContainer.innerHTML = `
      <div class="projects-empty">
        <span style="opacity: 0.7;">Loading cloud projects from Google Drive...</span>
      </div>
    `;

    const attemptLoad = async (attempt = 1) => {
      try {
        const projects = await window.FishGDriveSync.listProjects();
        renderCloudProjectsList(projects);
        // After listing, recover any orphaned cloud media into local projects
        recoverOrphanedCloudMedia(projects).catch(() => {});
      } catch (err) {
        // NetworkError on first attempt = transient (page load timing, token init race) — retry once
        if (attempt === 1 && err instanceof TypeError && err.message && err.message.includes('NetworkError')) {
          setTimeout(() => attemptLoad(2), 1500);
          return;
        }
        console.warn('Failed to list cloud projects:', err);
        cloudContainer.innerHTML = `
          <div class="projects-empty">
            <span style="color: var(--color-danger, #ef4444);">${escapeHtml(err.message || 'Error loading cloud projects')}</span>
          </div>
        `;
      }
    };
    await attemptLoad();
  }

  // Detect IDB media whose projectId references a deleted Drive folder.
  // For each orphaned cloud project ID, create a local recovery project so data isn't lost.
  async function recoverOrphanedCloudMedia(driveProjects) {
    if (!window.FishDatabase) return;
    const driveIds = new Set((driveProjects || []).map(p => p.id).filter(Boolean));

    // Get all local DB projects to avoid creating duplicate recovery entries
    let localProjects = [];
    try { localProjects = await window.FishDatabase.getProjects(); } catch (_) {}
    const recoveredIds = new Set(
      localProjects.filter(p => p._recoveredFromDrive).map(p => p._recoveredFromDrive)
    );

    // Get all media in IDB — check which projectIds look like Drive folder IDs (not local prj_*)
    let allMedia = [];
    try {
      allMedia = await window.FishDatabase.getAllMedia();
    } catch (_) {}

    if (!allMedia.length) return;

    // Group by projectId — only those that look like Drive folder IDs (not local prj_* format)
    const orphanGroups = {};
    for (const m of allMedia) {
      const pid = m.projectId;
      if (!pid) continue;
      if (pid.startsWith('prj_')) continue;   // local project ID format → skip
      if (driveIds.has(pid)) continue;         // still exists on Drive → skip
      if (recoveredIds.has(pid)) continue;     // already recovered → skip
      if (!orphanGroups[pid]) orphanGroups[pid] = [];
      orphanGroups[pid].push(m);
    }

    const orphanedDriveIds = Object.keys(orphanGroups);
    if (!orphanedDriveIds.length) return;

    console.info(`[GDriveSync] Found ${orphanedDriveIds.length} orphaned cloud project(s) — recovering as local.`);

    for (const driveId of orphanedDriveIds) {
      const mediaItems = orphanGroups[driveId];
      // Infer project name from media projectId or first media name
      const inferredName = 'Recovered_' + driveId.slice(0, 8);
      try {
        // Create a new local project
        const recovered = await window.FishDatabase.createProject({
          name: inferredName,
          aspectRatio: '16:9',
          resolution: '1080p',
          fps: 60
        });
        // Tag it so we don't recover twice
        recovered._recoveredFromDrive = driveId;
        recovered.updatedAt = new Date().toISOString();
        await window.FishDatabase.saveProject(recovered);

        // Re-assign orphan media to the new local project
        for (const m of mediaItems) {
          m.projectId = recovered.id;
          try { await window.FishDatabase.saveMedia(m); } catch (_) {}
        }

        console.info(`[GDriveSync] Recovered cloud project "${driveId}" → local "${recovered.id}" with ${mediaItems.length} media item(s).`);
        showDashboardToast(`Recovered deleted cloud project as local: "${inferredName}"`);
        window.dispatchEvent(new CustomEvent('fish-db-projects-updated'));
      } catch (err) {
        console.warn('[GDriveSync] Recovery failed for', driveId, err);
      }
    }
  }

  // Render cloud projects list markup
  function renderCloudProjectsList(projects) {
    if (cloudBadge) {
      cloudBadge.textContent = String(projects ? projects.length : 0);
      cloudBadge.setAttribute('title', `${projects ? projects.length : 0} Cloud Projects`);
    }

    if (!cloudContainer) return;

    if (!projects || projects.length === 0) {
      cloudContainer.innerHTML = `
        <div class="projects-empty">
          <div class="projects-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
            </svg>
          </div>
          <span>No cloud projects found on Google Drive</span>
        </div>
      `;
      return;
    }

    cloudContainer.innerHTML = projects.map(project => {
      const name = project.name || 'Untitled Project';
      const size = project.size || (project.isNewFormat ? '' : '');
      const savedTime = formatRelativeTime(project.updatedAt);
      const specs = project.isLegacy ? `Google Drive • .ofts (legacy)` : `Google Drive • Cloud`;

      return `
        <div class="project-swipe-container" data-id="${escapeHtml(project.id)}" data-name="${escapeHtml(name)}" data-is-cloud="true">
          <!-- Slide RIGHT reveals Delete (Left side) -->
          <div class="project-swipe-action action-delete" aria-hidden="true" title="Slide right to delete">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
            <span>Delete</span>
          </div>

          <!-- Slide LEFT reveals Export to .ofts (Right side) -->
          <div class="project-swipe-action action-export" aria-hidden="true" title="Slide left to export">
            <span>Export .ofts</span>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
          </div>

          <!-- Top Layer Project Item Card -->
          <article class="project-item" data-id="${escapeHtml(project.id)}" data-is-cloud="true" tabindex="0" role="button" aria-label="Cloud Project: ${escapeHtml(name)}">
            <div class="project-row-main">
              <span class="project-name" style="display: inline-flex; align-items: center; gap: 6px;">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style="opacity: 0.8; flex-shrink: 0;">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
                </svg>
                ${escapeHtml(name)}
              </span>
              <span class="project-size">${escapeHtml(size)}</span>
            </div>
            <div class="project-row-sub">
              <span class="project-saved">${escapeHtml(savedTime)}</span>
              <span class="project-specs">${specs}</span>
            </div>
          </article>
        </div>
      `;
    }).join('');

    bindProjectSwipeGestures(cloudContainer);
  }

  // Cloud project click navigation (delegated)
  cloudContainer.addEventListener('click', (e) => {
    const swipeBox = e.target.closest('.project-swipe-container');
    if (swipeBox && swipeBox._hasSwiped) return;
    const item = e.target.closest('.project-item');
    if (!item) return;
    const projectId = item.dataset.id;
    const projectName = item.querySelector('.project-name')?.textContent?.trim() || 'Project';
    if (projectId) {
      window.location.href = `editor.html?id=${encodeURIComponent(projectId)}&source=gdrive&name=${encodeURIComponent(projectName)}`;
    }
  });

  // Attach Right-Click Context Menu to Cloud Projects
  if (window.ContextMenu && typeof window.ContextMenu.bindTrigger === 'function') {
    window.ContextMenu.bindTrigger(cloudContainer, '.project-item', (target) => {
      const projectId = target.dataset.id;
      const projectName = target.querySelector('.project-name')?.textContent?.trim() || 'Project';
      return [
        {
          label: 'Export .ofts',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
          action: () => exportProjectAction(projectId, projectName, true)
        },
        { divider: true },
        {
          label: 'Delete from Drive',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
          danger: true,
          action: () => openDeleteModal(projectId, projectName, true)
        }
      ];
    });
  }

  // Sign In Click
  if (btnLogin) {
    btnLogin.addEventListener('click', async () => {
      try {
        btnLogin.disabled = true;
        btnLogin.style.opacity = '0.7';
        if (window.FishGDriveSync) {
          await window.FishGDriveSync.login();
          await syncGDriveUI();
        }
      } catch (err) {
        console.warn('Google Drive login failed:', err);
        const clientId = window.FishGDriveConfig ? window.FishGDriveConfig.getClientId() : '';
        if (!clientId) {
          if (window.Modal) window.Modal.open('modal-gdrive-config');
          showDashboardToast('Please configure your Google Client ID first');
        } else {
          showDashboardToast('Login failed: ' + (err.message || 'Check connection or origin'));
        }
      } finally {
        btnLogin.disabled = false;
        btnLogin.style.opacity = '';
      }
    });
  }

  // Sign Out Click
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (window.FishGDriveSync) {
        window.FishGDriveSync.logout();
        syncGDriveUI();
        showDashboardToast('Signed out of Google Drive');
      }
    });
  }

  // Refresh Click
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      showDashboardToast('Refreshing cloud projects...');
      await loadAndRenderCloudProjects();
    });
  }

  // Window event listeners
  window.addEventListener('gdrive-auth-changed', () => {
    syncGDriveUI();
  });

  window.addEventListener('gdrive-projects-updated', () => {
    if (activeProjectsTab === 'cloud') {
      loadAndRenderCloudProjects();
    }
  });

  // Pre-sync UI if already logged in from prior session
  if (window.FishGDriveSync && window.FishGDriveSync.isAuthenticated()) {
    window.FishGDriveSync.fetchUserProfile().then(() => {
      syncGDriveUI();
    });
  }
}


/**
 * Renders project cards inside the Your Project list with swipe actions
 */
function renderProjects(projects, container, countBadge) {
  if (countBadge) {
    countBadge.textContent = String(projects ? projects.length : 0);
    countBadge.setAttribute('title', `${projects ? projects.length : 0} Total Projects`);
  }

  if (!container) return;

  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div class="projects-empty">
        <div class="projects-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M10 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8L10 4zM12 7.2c-1.5 0-2.8 1.3-2.8 2.8h1.4c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4c0 .8-.6 1.4-1.3 2-.7.6-.8 1.2-.8 2.5h1.4v-.3c0-.8.4-1.3 1.1-1.9.7-.6 1-1.3 1-2.3 0-1.5-1.3-2.8-2.8-2.8zM12 17.6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
          </svg>
        </div>
        <span>No projects found in database</span>
      </div>
    `;
    return;
  }

  container.innerHTML = projects.map(project => {
    const name = project.name || 'Untitled Project';
    const size = project.size || '12 KB';
    const savedTime = formatRelativeTime(project.updatedAt || project.createdAt);
    const specs = `${escapeHtml(project.resolution || '1080p')} • ${escapeHtml(project.fps || '60')} fps`;

    return `
      <div class="project-swipe-container" data-id="${escapeHtml(project.id)}" data-name="${escapeHtml(name)}">
        <!-- Slide RIGHT reveals Delete (Left side) -->
        <div class="project-swipe-action action-delete" aria-hidden="true" title="Slide right to delete">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          <span>Delete</span>
        </div>

        <!-- Slide LEFT reveals Export to .ofts (Right side) -->
        <div class="project-swipe-action action-export" aria-hidden="true" title="Slide left to export">
          <span>Export .ofts</span>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
        </div>

        <!-- Top Layer Project Item Card -->
        <article class="project-item" data-id="${escapeHtml(project.id)}" tabindex="0" role="button" aria-label="Project: ${escapeHtml(name)}">
          <div class="project-row-main">
            <span class="project-name">${escapeHtml(name)}</span>
            <span class="project-size" data-project-size-id="${escapeHtml(project.id)}">${escapeHtml(size)}</span>
          </div>
          <div class="project-row-sub">
            <span class="project-saved">${escapeHtml(savedTime)}</span>
            <span class="project-specs">${specs}</span>
          </div>
        </article>
      </div>
    `;
  }).join('');

  bindProjectSwipeGestures(container);

  // Asynchronously compute and hydrate true total project size (JSON + Media + Frame Caches)
  if (window.FishDatabase && typeof window.FishDatabase.getProjectTotalSize === 'function') {
    (projects || []).forEach(project => {
      if (!project || !project.id) return;
      window.FishDatabase.getProjectTotalSize(project.id).then(res => {
        if (!res || !res.formatted) return;
        const selector = (window.CSS && typeof window.CSS.escape === 'function')
          ? `.project-size[data-project-size-id="${window.CSS.escape(project.id)}"]`
          : `.project-size[data-project-size-id="${project.id}"]`;
        const sizeBadge = container.querySelector(selector);
        if (sizeBadge) {
          sizeBadge.textContent = res.formatted;
          const tooltip = `${res.formatted} (${res.bytes.toLocaleString()} bytes)\n• Project: ${res.breakdown.jsonFormatted}\n• Media: ${res.breakdown.mediaFormatted}\n• Cache: ${res.breakdown.cacheFormatted}`;
          sizeBadge.setAttribute('title', tooltip);
        }
        if (project.size !== res.formatted) {
          project.size = res.formatted;
          project.sizeBytes = res.bytes;
          if (typeof window.FishDatabase.updateProjectSize === 'function') {
            window.FishDatabase.updateProjectSize(project.id, res.formatted, res.bytes);
          }
        }
      }).catch(() => {});
    });
  }
}

/**
 * Binds touch & pointer swipe gestures for project cards:
 * Slide RIGHT -> Delete project
 * Slide LEFT  -> Export project to .ofts
 */
function bindProjectSwipeGestures(container) {
  const swipeContainers = container.querySelectorAll('.project-swipe-container');

  swipeContainers.forEach(swipeBox => {
    const itemEl = swipeBox.querySelector('.project-item');
    const deleteAction = swipeBox.querySelector('.action-delete');
    const exportAction = swipeBox.querySelector('.action-export');
    if (!itemEl) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isPointerDown = false;
    let isDragging = false;
    let isLockedDirection = false;
    let isVerticalScroll = false;
    let activePointerId = null;

    const SWIPE_TRIGGER_THRESHOLD = 75; // px to trigger action
    const MAX_DRAG_DISTANCE = 140; // max visual drag boundary

    const onPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;

      startX = e.clientX;
      startY = e.clientY;
      currentX = 0;
      isPointerDown = true;
      isDragging = false;
      isLockedDirection = false;
      isVerticalScroll = false;
      activePointerId = e.pointerId;

      itemEl.style.transition = 'none';
    };

    const onPointerMove = (e) => {
      if (!isPointerDown || e.pointerId !== activePointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!isLockedDirection) {
        if (Math.hypot(dx, dy) >= 6) {
          isLockedDirection = true;
          if (Math.abs(dy) > Math.abs(dx)) {
            isVerticalScroll = true;
            return;
          } else {
            isDragging = true;
            try {
              itemEl.setPointerCapture(e.pointerId);
            } catch (err) {}
          }
        } else {
          return;
        }
      }

      if (isVerticalScroll || !isDragging) return;

      e.preventDefault();

      // Non-linear drag resistance beyond 85px
      let targetX = dx;
      if (Math.abs(targetX) > 85) {
        const excess = Math.abs(targetX) - 85;
        const sign = targetX > 0 ? 1 : -1;
        targetX = sign * (85 + excess * 0.35);
      }
      currentX = Math.max(-MAX_DRAG_DISTANCE, Math.min(MAX_DRAG_DISTANCE, targetX));
      itemEl.style.transform = `translateX(${currentX}px)`;

      // Dynamic action reveal feedback
      if (currentX > 0) {
        // Swiping RIGHT -> Delete
        if (deleteAction) {
          deleteAction.style.opacity = '1';
          if (currentX >= SWIPE_TRIGGER_THRESHOLD) {
            deleteAction.classList.add('is-ready');
          } else {
            deleteAction.classList.remove('is-ready');
          }
        }
        if (exportAction) exportAction.style.opacity = '0';
      } else if (currentX < 0) {
        // Swiping LEFT -> Export
        if (exportAction) {
          exportAction.style.opacity = '1';
          if (Math.abs(currentX) >= SWIPE_TRIGGER_THRESHOLD) {
            exportAction.classList.add('is-ready');
          } else {
            exportAction.classList.remove('is-ready');
          }
        }
        if (deleteAction) deleteAction.style.opacity = '0';
      } else {
        if (deleteAction) deleteAction.style.opacity = '0';
        if (exportAction) exportAction.style.opacity = '0';
      }
    };

    const onPointerEnd = (e) => {
      if (!isPointerDown || (e.pointerId !== activePointerId && activePointerId !== null)) return;
      isPointerDown = false;

      try {
        if (itemEl.hasPointerCapture(e.pointerId)) {
          itemEl.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}

      if (isDragging) {
        swipeBox._hasSwiped = true;
        setTimeout(() => {
          swipeBox._hasSwiped = false;
        }, 320);

        const finalX = currentX;

        // Animate snap-back to origin
        itemEl.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        itemEl.style.transform = 'translateX(0px)';

        const isCloud = swipeBox.dataset.isCloud === 'true';

        if (finalX >= SWIPE_TRIGGER_THRESHOLD) {
          // Slide RIGHT -> Delete confirmation modal
          const projectId = swipeBox.dataset.id;
          const projectName = swipeBox.dataset.name;
          openDeleteModal(projectId, projectName, isCloud);
        } else if (finalX <= -SWIPE_TRIGGER_THRESHOLD) {
          // Slide LEFT -> Export to .ofts
          const projectId = swipeBox.dataset.id;
          const projectName = swipeBox.dataset.name;
          exportProjectAction(projectId, projectName, isCloud);
        }

        setTimeout(() => {
          if (deleteAction) {
            deleteAction.style.opacity = '';
            deleteAction.classList.remove('is-ready');
          }
          if (exportAction) {
            exportAction.style.opacity = '';
            exportAction.classList.remove('is-ready');
          }
          itemEl.style.transition = '';
        }, 240);
      }

      activePointerId = null;
      isDragging = false;
      isLockedDirection = false;
      isVerticalScroll = false;
    };

    itemEl.addEventListener('pointerdown', onPointerDown);
    itemEl.addEventListener('pointermove', onPointerMove);
    itemEl.addEventListener('pointerup', onPointerEnd);
    itemEl.addEventListener('pointercancel', onPointerEnd);

    // Direct click fallback on revealed actions
    if (deleteAction) {
      deleteAction.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCloud = swipeBox.dataset.isCloud === 'true';
        openDeleteModal(swipeBox.dataset.id, swipeBox.dataset.name, isCloud);
      });
    }
    if (exportAction) {
      exportAction.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCloud = swipeBox.dataset.isCloud === 'true';
        exportProjectAction(swipeBox.dataset.id, swipeBox.dataset.name, isCloud);
      });
    }
  });
}

/**
 * Basic XSS sanitizer for safe template string rendering
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Opens the Project Settings Modal and populates existing configuration
 */
async function openProjectSettingsModal(projectId) {
  if (!projectId) return;

  let project = null;
  if (window.FishDatabase && typeof window.FishDatabase.getProject === 'function') {
    try {
      project = await window.FishDatabase.getProject(projectId);
    } catch (e) {
      console.warn('Failed to load project for settings:', e);
    }
  }

  if (!project) return;

  const idInput = document.getElementById('settings-project-id');
  const nameInput = document.getElementById('settings-input-name');
  if (idInput) idInput.value = projectId;
  if (nameInput) nameInput.value = project.name || '';

  // 1. Aspect Ratio Frame
  const aspectVal = project.aspectRatio || '16:9';
  const aspectGrid = document.getElementById('settings-options-aspect-ratio');
  if (aspectGrid) {
    aspectGrid.querySelectorAll('.aspect-ratio-frame').forEach(f => {
      f.classList.toggle('is-selected', f.dataset.val === aspectVal);
    });
  }

  // 2. Resolution Dropdown
  const resVal = project.resolution || '1080p';
  const resDropdown = document.getElementById('settings-dropdown-resolution');
  if (resDropdown) {
    resDropdown.dataset.value = resVal;
    const label = resDropdown.querySelector('.custom-dropdown-label');
    if (label) label.textContent = resVal;
    resDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
      item.classList.toggle('is-selected', item.dataset.val === resVal);
    });
  }

  // 3. FPS Dropdown
  const fpsVal = String(project.fps || '60');
  const fpsDropdown = document.getElementById('settings-dropdown-fps');
  if (fpsDropdown) {
    fpsDropdown.dataset.value = fpsVal;
    const label = fpsDropdown.querySelector('.custom-dropdown-label');
    if (label) label.textContent = `${fpsVal} FPS`;
    fpsDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
      item.classList.toggle('is-selected', item.dataset.val === fpsVal);
    });
  }

  // 4. Background Color Swatch
  const bgVal = project.bgColor || 'transparent';
  const bgRow = document.getElementById('settings-options-bgcolor');
  if (bgRow) {
    bgRow.querySelectorAll('.modal-color-swatch').forEach(s => {
      s.classList.toggle('is-selected', s.dataset.val === bgVal);
    });
  }

  if (window.Modal) {
    window.Modal.open('modal-project-settings');
  }

  setTimeout(() => {
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }, 80);
}

/**
 * Saves updated project settings (name, aspect ratio, resolution, fps, background color)
 */
async function saveProjectSettingsAction() {
  const idInput = document.getElementById('settings-project-id');
  const nameInput = document.getElementById('settings-input-name');
  const projectId = idInput ? idInput.value : '';
  if (!projectId || !window.FishDatabase) return;

  const newName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'Project';
  const selectedRatio = document.querySelector('#settings-options-aspect-ratio .aspect-ratio-frame.is-selected')?.dataset.val || '16:9';
  const selectedRes = document.getElementById('settings-dropdown-resolution')?.dataset.value || '1080p';
  const selectedFps = document.getElementById('settings-dropdown-fps')?.dataset.value || '60';
  const selectedBg = document.querySelector('#settings-options-bgcolor .modal-color-swatch.is-selected')?.dataset.val || 'transparent';

  try {
    const project = await window.FishDatabase.getProject(projectId);
    if (project) {
      project.name = newName;
      project.aspectRatio = selectedRatio;
      project.resolution = selectedRes;
      project.fps = selectedFps;
      project.bgColor = selectedBg;
      await window.FishDatabase.saveProject(project);
      showDashboardToast('Project settings saved');
    }
  } catch (err) {
    console.warn('Failed to save project settings:', err);
    showDashboardToast('Failed to save settings');
  }

  if (window.Modal) {
    window.Modal.close();
  }
}

/**
 * Legacy compatibility wrappers
 */
function openRenameModal(projectId, currentName) {
  openProjectSettingsModal(projectId);
}

async function saveRenameProjectAction() {
  await saveProjectSettingsAction();
}

/**
 * Opens the Delete Project Confirmation Modal
 */
function openDeleteModal(projectId, currentName, isCloud = false) {
  const modal = document.getElementById('modal-delete-project');
  const idInput = document.getElementById('delete-project-id');
  const targetNameEl = document.getElementById('delete-target-name');
  const promptEl = document.getElementById('delete-project-prompt');
  if (!modal || !idInput) return;

  idInput.value = projectId || '';
  idInput.dataset.isCloud = isCloud ? 'true' : 'false';
  const displayName = `"${currentName || 'Untitled'}"`;
  if (targetNameEl) {
    targetNameEl.textContent = displayName;
  } else if (promptEl) {
    promptEl.textContent = `Delete ${isCloud ? 'cloud ' : ''}project ${displayName}?`;
  }

  if (window.Modal) {
    window.Modal.open('modal-delete-project');
  }
}

/**
 * Confirms deletion of project from modal
 */
async function confirmDeleteProjectAction() {
  const idInput = document.getElementById('delete-project-id');
  const projectId = idInput ? idInput.value : '';
  const isCloud = idInput && idInput.dataset.isCloud === 'true';

  if (projectId) {
    if (isCloud && window.FishGDriveSync) {
      try {
        await window.FishGDriveSync.deleteProject(projectId);
        showDashboardToast('Cloud project deleted from Drive');
      } catch (e) {
        showDashboardToast('Failed to delete cloud project: ' + (e.message || 'Error'));
      }
    } else if (window.FishDatabase) {
      try {
        await window.FishDatabase.deleteProject(projectId);
        showDashboardToast('Project deleted successfully');
      } catch (e) {
        console.warn('Delete project error:', e);
      }
    }
  }

  if (window.Modal) {
    window.Modal.close('modal-delete-project');
  }

  // Refresh project list
  if (isCloud) {
    window.dispatchEvent(new CustomEvent('gdrive-projects-updated'));
  } else {
    const listContainer = document.getElementById('projects-container');
    const countBadge = document.getElementById('project-count-badge');
    if (listContainer && window.FishDatabase) {
      try {
        const projects = await window.FishDatabase.getProjects();
        renderProjects(projects, listContainer, countBadge);
      } catch (_) {}
    }
  }
}

/**
 * Exports project as .ofts package
 */
async function exportProjectAction(projectId, projectName, isCloud = false) {
  if (!projectId) return;

  showDashboardToast(`Exporting ${projectName || 'project'}...`);

  if (isCloud && window.FishGDriveSync) {
    try {
      const prjData = await window.FishGDriveSync.getProject(projectId);
      const jsonStr = JSON.stringify(prjData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName || 'Project'}.ofts`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showDashboardToast('.ofts export completed');
      return;
    } catch (e) {
      console.warn('Cloud export error:', e);
      showDashboardToast('Failed to export cloud project');
      return;
    }
  }

  if (window.FishDatabase && typeof window.FishDatabase.exportProjectToOFTS === 'function') {
    try {
      await window.FishDatabase.exportProjectToOFTS(projectId);
      showDashboardToast('.ofts export completed');
    } catch (err) {
      console.warn('Export project error:', err);
      showDashboardToast('Failed to export .ofts file');
    }
  }
}

let dashboardToastTimer = null;

/**
 * Displays a non-intrusive dashboard toast notification
 */
function showDashboardToast(text, duration = 2400) {
  let toast = document.getElementById('dashboard-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'dashboard-toast';
    toast.className = 'dashboard-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = text;
  toast.classList.add('is-visible');

  if (dashboardToastTimer) {
    clearTimeout(dashboardToastTimer);
  }

  dashboardToastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
  }, duration);
}

/**
 * Creates project and navigates to editor
 */
async function createNewProjectAction() {
  const nameInput = document.getElementById('project-input-name');
  const name = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'New_Project';
  
  const selectedRatio = document.querySelector('#options-aspect-ratio .aspect-ratio-frame.is-selected')?.dataset.val || '16:9';
  const selectedRes = document.getElementById('dropdown-resolution')?.dataset.value || '1080p';
  const selectedFps = document.getElementById('dropdown-fps')?.dataset.value || '60';
  const selectedBg = document.querySelector('#options-bgcolor .modal-color-swatch.is-selected')?.dataset.val || 'transparent';

  if (activeProjectsTab === 'cloud') {
    if (!window.FishGDriveSync || !window.FishGDriveSync.isAuthenticated()) {
      showDashboardToast('Please sign in to Google Drive first');
      if (window.Modal) window.Modal.close();
      return;
    }
    showDashboardToast('Creating cloud project on Drive...');
    try {
      const created = await window.FishGDriveSync.createProject({
        name: name,
        aspectRatio: selectedRatio,
        resolution: selectedRes,
        fps: selectedFps,
        bgColor: selectedBg
      });
      if (window.Modal) window.Modal.close();
      setTimeout(() => {
        const query = new URLSearchParams({
          id: created.id,
          source: 'gdrive',
          name: created.name,
          aspect: selectedRatio,
          resolution: selectedRes,
          fps: selectedFps,
          bg: selectedBg
        });
        window.location.href = `editor.html?${query.toString()}`;
      }, 120);
      return;
    } catch (err) {
      showDashboardToast('Failed creating cloud project: ' + (err.message || 'Error'));
      return;
    }
  }

  let projectId = '';
  if (window.FishDatabase) {
    const project = await window.FishDatabase.createProject({
      name: name,
      aspectRatio: selectedRatio,
      resolution: selectedRes,
      fps: selectedFps,
      bgColor: selectedBg
    });
    projectId = project.id;
  }

  if (window.Modal) {
    window.Modal.close();
  }

  // Navigate to editor screen with state
  setTimeout(() => {
    const query = new URLSearchParams({
      id: projectId,
      name: name,
      aspect: selectedRatio,
      resolution: selectedRes,
      fps: selectedFps,
      bg: selectedBg
    });
    window.location.href = `editor.html?${query.toString()}`;
  }, 120);
}

/**
 * Initializes interactive option selectors for modal dialogs (Custom Dropdowns, Aspect Frames, Swatches)
 */
document.addEventListener('DOMContentLoaded', () => {
  // Custom Themed Dropdowns
  document.querySelectorAll('.custom-dropdown').forEach(dropdown => {
    const trigger = dropdown.querySelector('.custom-dropdown-trigger');
    const label = dropdown.querySelector('.custom-dropdown-label');
    const items = dropdown.querySelectorAll('.custom-dropdown-item');

    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown.is-open').forEach(other => {
          if (other !== dropdown) other.classList.remove('is-open');
        });
        dropdown.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', dropdown.classList.contains('is-open'));
      });
    }

    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = item.dataset.val;
        dropdown.dataset.value = val;
        if (label) label.textContent = item.textContent;
        items.forEach(i => i.classList.remove('is-selected'));
        item.classList.add('is-selected');
        dropdown.classList.remove('is-open');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });
    });
  });

  // Close custom dropdowns on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-dropdown.is-open').forEach(dropdown => {
      dropdown.classList.remove('is-open');
      const trigger = dropdown.querySelector('.custom-dropdown-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  });

  // Aspect Ratio Visual Frames
  document.querySelectorAll('.modal-aspect-grid').forEach(grid => {
    grid.addEventListener('click', (e) => {
      const frame = e.target.closest('.aspect-ratio-frame');
      if (!frame) return;
      grid.querySelectorAll('.aspect-ratio-frame').forEach(f => f.classList.remove('is-selected'));
      frame.classList.add('is-selected');
    });
  });

  // Color Swatches
  document.querySelectorAll('.modal-color-swatches').forEach(row => {
    row.addEventListener('click', (e) => {
      const swatch = e.target.closest('.modal-color-swatch');
      if (!swatch) return;
      row.querySelectorAll('.modal-color-swatch').forEach(s => s.classList.remove('is-selected'));
      swatch.classList.add('is-selected');
    });
  });

  // Modular Settings Category Accordion Expand/Collapse (Capture phase)
  document.addEventListener('click', (e) => {
    const header = e.target.closest('.settings-category-header');
    if (!header) return;
    const category = header.closest('.settings-category');
    if (!category) return;
    const isCollapsed = category.classList.toggle('is-collapsed');
    header.setAttribute('aria-expanded', String(!isCollapsed));
  }, true);

  // Modular Drag & Drop Zones
  document.querySelectorAll('.modal-dropzone').forEach(dropzone => {
    const fileInput = dropzone.querySelector('input[type="file"]');
    const statusEl = dropzone.querySelector('.dropzone-file-status');

    dropzone.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });

    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (fileInput) fileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'dragend'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('is-dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImportedFiles(e.dataTransfer.files, dropzone, statusEl);
      }
    });

    if (fileInput) {
      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          handleImportedFiles(fileInput.files, dropzone, statusEl);
        }
      });
    }
  });

  // Enter key support for project inputs
  const newNameInput = document.getElementById('project-input-name');
  if (newNameInput) {
    newNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createNewProjectAction();
      }
    });
  }

  const renameInput = document.getElementById('rename-input-name');
  if (renameInput) {
    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveRenameProjectAction();
      }
    });
  }

  const settingsInput = document.getElementById('settings-input-name');
  if (settingsInput) {
    settingsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveProjectSettingsAction();
      }
    });
  }
});

/**
 * Handles imported .ofts project file
 */
async function handleImportedFiles(files, dropzone, statusEl) {
  if (!files || files.length === 0) return;
  const file = files[0];
  if (!file || !file.name.toLowerCase().endsWith('.ofts')) {
    alert('Only .ofts files are supported');
    return;
  }

  dropzone.classList.add('has-file');
  if (statusEl) {
    statusEl.textContent = `Importing ${file.name}...`;
  }

  let importedProject = null;

  if (window.FishDatabase && typeof window.FishDatabase.importOFTSPackage === 'function') {
    try {
      importedProject = await window.FishDatabase.importOFTSPackage(file);
    } catch (e) {
      console.warn('OFTS package import error:', e);
      alert('Failed to import .ofts file');
    }
  }

  setTimeout(() => {
    if (window.Modal) window.Modal.close();
    dropzone.classList.remove('has-file');
    if (statusEl) statusEl.textContent = '';
    
    if (importedProject && importedProject.id) {
      if (importedProject.isTemplate) {
        window.location.href = `editor.html?id=${encodeURIComponent(importedProject.id)}&template=1`;
      } else {
        window.location.href = `editor.html?id=${encodeURIComponent(importedProject.id)}`;
      }
    } else {
      loadAndRender();
    }
  }, 300);
}

/**
 * Automatically displays Welcome modal on first visit unless dismissed
 */
function initWelcomeModal() {
  syncWelcomeVersionTags();
  try {
    const hasDismissed = localStorage.getItem('oft_seen_welcome_v1');
    if (!hasDismissed) {
      setTimeout(() => {
        if (window.Modal) {
          window.Modal.open('modal-welcome');
        }
      }, 450);
    }
  } catch (e) {
    console.warn('Welcome modal init error:', e);
  }
}

/**
 * Closes welcome modal and saves dismissal preference if checked
 */
function closeWelcomeModal() {
  const checkbox = document.getElementById('welcome-dismiss-checkbox');
  if (checkbox && checkbox.checked) {
    try {
      localStorage.setItem('oft_seen_welcome_v1', '1');
    } catch (e) {
      console.warn('[Storage] Failed to save welcome dismissal:', e);
    }
  }
  if (window.Modal) {
    window.Modal.close();
  }
}

/**
 * Opens donate modal from inside welcome modal
 */
function openDonateFromWelcome() {
  const checkbox = document.getElementById('welcome-dismiss-checkbox');
  if (checkbox && checkbox.checked) {
    try {
      localStorage.setItem('oft_seen_welcome_v1', '1');
    } catch (e) {
      console.warn('[Storage] Failed to save welcome dismissal:', e);
    }
  }
  if (window.Modal) {
    window.Modal.open('modal-donate');
  }
}

/**
 * Toggles accordion preview for QRIS donation
 */
function toggleQrisDisplay() {
  const content = document.getElementById('donate-qris-content');
  const arrow = document.getElementById('qris-arrow-icon');
  if (!content) return;

  const isHidden = content.style.display === 'none' || !content.style.display;
  if (isHidden) {
    content.style.display = 'flex';
    if (arrow) arrow.classList.add('is-open');
  } else {
    content.style.display = 'none';
    if (arrow) arrow.classList.remove('is-open');
  }
}

// Global exposes for HTML onclick handlers & module interop
window.openDeleteModal = openDeleteModal;
window.confirmDeleteProjectAction = confirmDeleteProjectAction;
window.exportProjectAction = exportProjectAction;
window.showDashboardToast = showDashboardToast;
window.openRenameModal = openRenameModal;
window.saveRenameProjectAction = saveRenameProjectAction;
window.openProjectSettingsModal = openProjectSettingsModal;
window.saveProjectSettingsAction = saveProjectSettingsAction;
window.syncWelcomeVersionTags = syncWelcomeVersionTags;
window.createNewProjectAction = createNewProjectAction;
window.closeWelcomeModal = closeWelcomeModal;
window.openDonateFromWelcome = openDonateFromWelcome;
window.toggleQrisDisplay = toggleQrisDisplay;
