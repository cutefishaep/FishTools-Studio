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
  initWelcomeModal();

  // Purge all non-essential caches when opening index.html (preserves projects and media)
  if (typeof window.cleanupAllStudioCaches === 'function') {
    window.cleanupAllStudioCaches('index_init').catch(() => {});
  }

  // Handle redirect errors from editor (ghost project guard)
  const _urlErr = new URLSearchParams(window.location.search).get('error');
  if (_urlErr) {
    const _errMessages = {
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
  if (!raw) return '';
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
    return;
  }

  const cleanNum = String(detected).trim().replace(/^v\.?/i, '');
  const displayTag = `v${cleanNum}`;
  if (typeof window !== 'undefined') {
    window.OFT_VERSION = cleanNum;
  }

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
 * Fetches version metadata and updates the badges dynamically
 */
async function initVersionFetcher() {
  if (window.location.protocol === 'file:') {
    syncWelcomeVersionTags();
    return;
  }

  try {
    const response = await fetch('./version.json');
    if (response.ok) {
      const data = await response.json();
      if (data && data.version) {
        syncWelcomeVersionTags(data.version);
        return;
      }
    }
  } catch (_) {}

  syncWelcomeVersionTags();
}

/**
 * Loads projects from FishDatabase and populates the "Your Project" list and "Uploaded Projects" list
 */
async function initProjectsFetcher() {
  const listContainer = document.getElementById('projects-container');
  const countBadge = document.getElementById('project-count-badge');
  const uploadedListContainer = document.getElementById('uploaded-projects-container');
  const uploadedCountBadge = document.getElementById('uploaded-count-badge');

  const tabLocal = document.getElementById('tab-local-projects');
  const tabUploaded = document.getElementById('tab-uploaded-projects');
  const panelLocal = document.getElementById('panel-local-projects');
  const panelUploaded = document.getElementById('panel-uploaded-projects');

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

  function loadAndRenderUploaded() {
    let uploaded = [];
    if (window.FishDatabase && typeof window.FishDatabase.getUploadedProjects === 'function') {
      try {
        uploaded = window.FishDatabase.getUploadedProjects();
      } catch (e) {
        uploaded = [];
      }
    }
    renderUploadedProjects(uploaded, uploadedListContainer, uploadedCountBadge);
  }

  // Dual tab switcher (Your Projects vs Uploaded Projects)
  if (tabLocal && tabUploaded) {
    tabLocal.addEventListener('click', () => {
      tabLocal.classList.add('is-active');
      tabLocal.setAttribute('aria-selected', 'true');
      tabUploaded.classList.remove('is-active');
      tabUploaded.setAttribute('aria-selected', 'false');
      if (panelLocal) panelLocal.style.display = 'flex';
      if (panelUploaded) panelUploaded.style.display = 'none';
    });

    tabUploaded.addEventListener('click', () => {
      tabUploaded.classList.add('is-active');
      tabUploaded.setAttribute('aria-selected', 'true');
      tabLocal.classList.remove('is-active');
      tabLocal.setAttribute('aria-selected', 'false');
      if (panelLocal) panelLocal.style.display = 'none';
      if (panelUploaded) panelUploaded.style.display = 'flex';
      loadAndRenderUploaded();
    });
  }

  // Initial load
  if (listContainer) await loadAndRender();
  if (uploadedListContainer) loadAndRenderUploaded();

  // Listen to custom DB project update events
  window.addEventListener('fish-db-projects-updated', () => {
    loadAndRender();
  });
  window.addEventListener('fish-db-uploaded-projects-updated', () => {
    loadAndRenderUploaded();
  });

  // Local Project item left-click navigation (delegated)
  if (listContainer) {
    listContainer.addEventListener('click', (e) => {
      const swipeBox = e.target.closest('.project-swipe-container');
      if (swipeBox && swipeBox._hasSwiped) {
        return;
      }
      const item = e.target.closest('.project-item');
      if (!item) return;
      const projectId = item.dataset.id;
      if (projectId) {
        const targetPage = resolveTargetEditorPage();
        window.location.href = `${targetPage}?id=${encodeURIComponent(projectId)}`;
      }
    });
  }

  // Uploaded Project item actions (delegated)
  if (uploadedListContainer) {
    uploadedListContainer.addEventListener('click', async (e) => {
      // 1. Copy link button (icon only)
      const copyBtn = e.target.closest('.btn-copy-uploaded-link');
      if (copyBtn) {
        e.stopPropagation();
        const url = copyBtn.dataset.url;
        if (url) {
          try {
            await navigator.clipboard.writeText(url);
            showDashboardToast('Link copied to clipboard!');
          } catch (_) {}
        }
        return;
      }

      // 2. View QR button (icon only)
      const qrBtn = e.target.closest('.btn-view-uploaded-qr');
      if (qrBtn) {
        e.stopPropagation();
        const id = qrBtn.dataset.id;
        const list = window.FishDatabase ? window.FishDatabase.getUploadedProjects() : [];
        const item = list.find(p => p && String(p.id) === String(id));
        if (item) {
          openDashboardQRModal(item);
        }
        return;
      }

      // 3. Remove button (icon only)
      const removeBtn = e.target.closest('.btn-remove-uploaded');
      if (removeBtn) {
        e.stopPropagation();
        const id = removeBtn.dataset.id;
        if (id && window.FishDatabase) {
          window.FishDatabase.removeUploadedProject(id);
          loadAndRenderUploaded();
          showDashboardToast('Removed from uploaded projects');
        }
        return;
      }

      // 4. Clicked card body -> trigger preset import preview
      const card = e.target.closest('.uploaded-project-item');
      if (card) {
        const id = card.dataset.id;
        const list = window.FishDatabase ? window.FishDatabase.getUploadedProjects() : [];
        const item = list.find(p => p && String(p.id) === String(id));
        if (item) {
          triggerUploadedProjectImport(item);
        }
      }
    });
  }

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
          label: 'Share as Link',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>',
          action: () => openShareProjectLinkModal(projectId, projectName)
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

/**
 * Resolves whether to open desktop.html or editor.html (mobile)
 * Automatically routes mobile/Android/iOS/narrow screens (< 900px) to editor.html.
 */
function resolveTargetEditorPage() {
  const ua = navigator.userAgent || '';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|SM-G/i.test(ua) ||
    (window.matchMedia && window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches) ||
    window.innerWidth < 900;

  const preferred = localStorage.getItem('oft_preferred_view');

  if (isMobile) {
    if (preferred === 'desktop' && window.innerWidth >= 900) {
      return 'desktop.html';
    }
    return 'editor.html';
  }

  if (preferred === 'mobile') {
    return 'editor.html';
  }
  return 'desktop.html';
}
window.resolveTargetEditorPage = resolveTargetEditorPage;



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
          <div class="project-thumb-box" aria-hidden="true">
            ${project.thumbnail ? `
              <img class="project-thumb-img" src="${project.thumbnail}" alt="" loading="lazy" />
            ` : `
              <div class="project-thumb-placeholder">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v10h14V5H5z"/>
                  <path d="M14.7 7.3a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4l-4.9 4.9a1 1 0 0 1-.4.25l-2.2.7a.5.5 0 0 1-.6-.6l.7-2.2a1 1 0 0 1 .25-.4l4.9-4.9.7-.75.45.45z"/>
                  <path d="M2 19.5a1 1 0 0 1 1-1h18a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1z"/>
                </svg>
              </div>
            `}
          </div>
          <div class="project-info">
            <div class="project-row-main">
              <span class="project-name">${escapeHtml(name)}</span>
              <span class="project-size" data-project-size-id="${escapeHtml(project.id)}">${escapeHtml(size)}</span>
            </div>
            <div class="project-row-sub">
              <span class="project-saved">${escapeHtml(savedTime)}</span>
              <span class="project-specs">${specs}</span>
            </div>
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
 * Renders uploaded/shared projects in the Uploaded Projects tab
 */
function renderUploadedProjects(projects, container, countBadge) {
  if (countBadge) {
    countBadge.textContent = String(projects ? projects.length : 0);
    countBadge.setAttribute('title', `${projects ? projects.length : 0} Uploaded Projects`);
  }

  if (!container) return;

  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div class="projects-empty">
        <div class="projects-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
          </svg>
        </div>
        <span>No uploaded projects yet</span>
        <span style="font-size:12px;color:var(--text-muted);margin-top:4px;">Projects exported as link will appear here</span>
      </div>
    `;
    return;
  }

  container.innerHTML = projects.map(project => {
    const name = project.name || 'Untitled Project';
    const size = project.size || '1.0 MB';
    const savedTime = formatRelativeTime(project.createdAt || Date.now());
    const specs = `${escapeHtml(project.specs || '1080p • 60 fps')}`;
    const shareUrl = project.shareUrl || `${window.location.origin}/${project.id}`;

    return `
      <div class="project-swipe-container" data-id="${escapeHtml(project.id)}">
        <article class="project-item uploaded-project-item" data-id="${escapeHtml(project.id)}" tabindex="0" role="button" aria-label="Uploaded Project: ${escapeHtml(name)}">
          <div class="project-thumb-box" aria-hidden="true">
            ${project.thumbnail ? `
              <img class="project-thumb-img" src="${project.thumbnail}" alt="" loading="lazy" />
            ` : `
              <div class="project-thumb-placeholder">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v10h14V5H5z"/>
                  <path d="M14.7 7.3a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4l-4.9 4.9a1 1 0 0 1-.4.25l-2.2.7a.5.5 0 0 1-.6-.6l.7-2.2a1 1 0 0 1 .25-.4l4.9-4.9.7-.75.45.45z"/>
                  <path d="M2 19.5a1 1 0 0 1 1-1h18a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1z"/>
                </svg>
              </div>
            `}
          </div>
          <div class="project-info">
            <div class="project-row-main">
              <span class="project-name">${escapeHtml(name)}</span>
              <span class="project-size">${escapeHtml(size)}</span>
            </div>
            <div class="project-row-sub">
              <span class="project-saved">${escapeHtml(savedTime)}</span>
              <span class="project-specs">${specs}</span>
            </div>
          </div>
          <!-- Action Buttons (Copy Link, QR, Remove - Icon only) -->
          <div class="uploaded-actions">
            <button type="button" class="uploaded-btn-action btn-copy-uploaded-link" data-url="${escapeHtml(shareUrl)}" title="Copy Link" aria-label="Copy Link">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
              </svg>
            </button>
            <button type="button" class="uploaded-btn-action btn-view-uploaded-qr" data-id="${escapeHtml(project.id)}" title="View QR Code" aria-label="View QR Code">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M4 4h6v6H4V4zm2 2v2h2V6H6zm8-2h6v6h-6V4zm2 2v2h2V6h-2zM4 14h6v6H4v-6zm2 2v2h2v-2H6zm10-2h2v2h-2v-2zm-2 2h2v2h-2v-2zm4 0h2v2h-2v-2zm-2 2h2v2h-2v-2zm2 2h2v2h-2v-2zm-6-2h2v2h-2v-2zm0-4h2v2h-2v-2z"/>
              </svg>
            </button>
            <button type="button" class="uploaded-btn-action btn-remove-uploaded" data-id="${escapeHtml(project.id)}" title="Remove" aria-label="Remove">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
        </article>
      </div>
    `;
  }).join('');
}

/**
 * Triggers link project import flow when clicking an uploaded project card
 */
async function triggerUploadedProjectImport(project) {
  if (!project || !project.id) return;
  showDashboardToast('Fetching project...');
  try {
    const res = await fetch(`/api/project?id=${encodeURIComponent(project.id)}`);
    const data = await res.json();
    if (res.ok && data.success && data.project) {
      showPresetConfirmModal(data.project);
      return;
    }
  } catch (_) {}
  showPresetConfirmModal(project);
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

        if (finalX >= SWIPE_TRIGGER_THRESHOLD) {
          // Slide RIGHT -> Delete confirmation modal
          const projectId = swipeBox.dataset.id;
          const projectName = swipeBox.dataset.name;
          openDeleteModal(projectId, projectName);
        } else if (finalX <= -SWIPE_TRIGGER_THRESHOLD) {
          // Slide LEFT -> Export to .ofts
          const projectId = swipeBox.dataset.id;
          const projectName = swipeBox.dataset.name;
          exportProjectAction(projectId, projectName);
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
        openDeleteModal(swipeBox.dataset.id, swipeBox.dataset.name);
      });
    }
    if (exportAction) {
      exportAction.addEventListener('click', (e) => {
        e.stopPropagation();
        exportProjectAction(swipeBox.dataset.id, swipeBox.dataset.name);
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

  if (window.Modal) {
    window.Modal.close();
  }

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
function openDeleteModal(projectId, currentName) {
  const modal = document.getElementById('modal-delete-project');
  const idInput = document.getElementById('delete-project-id');
  const targetNameEl = document.getElementById('delete-target-name');
  const promptEl = document.getElementById('delete-project-prompt');
  if (!modal || !idInput) return;

  idInput.value = projectId || '';
  const displayName = `"${currentName || 'Untitled'}"`;
  if (targetNameEl) {
    targetNameEl.textContent = displayName;
  } else if (promptEl) {
    promptEl.textContent = `Delete project ${displayName}?`;
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
  let projectId = idInput ? idInput.value : '';

  if (window.Modal) {
    window.Modal.close('modal-delete-project');
  }

  // Immediately remove card from DOM for instant feedback
  const listContainer = document.getElementById('projects-container');
  const countBadge = document.getElementById('project-count-badge');

  // Fallback: If projectId was empty, match by target name or single remaining card
  if (!projectId) {
    const targetNameEl = document.getElementById('delete-target-name');
    const rawName = targetNameEl ? targetNameEl.textContent.replace(/^"|"$/g, '').trim() : '';
    if (rawName && window.FishDatabase) {
      try {
        const all = await window.FishDatabase.getProjects();
        const found = all.find(p => p && (p.name === rawName || p.id === rawName));
        if (found) projectId = found.id;
      } catch (_) {}
    }
    if (!projectId && listContainer) {
      const cards = listContainer.querySelectorAll('.project-swipe-container');
      if (cards.length === 1 && cards[0].dataset.id) {
        projectId = cards[0].dataset.id;
      }
    }
  }

  if (listContainer && projectId) {
    const cards = listContainer.querySelectorAll('.project-swipe-container');
    cards.forEach(card => {
      if (card.dataset.id === projectId || card.dataset.name === projectId) {
        card.remove();
      }
    });
    const remaining = listContainer.querySelectorAll('.project-swipe-container').length;
    if (countBadge) {
      countBadge.textContent = String(remaining);
      countBadge.setAttribute('title', `${remaining} Total Projects`);
    }
    if (remaining === 0) {
      renderProjects([], listContainer, countBadge);
    }
  }

  if (projectId && window.FishDatabase) {
    try {
      await window.FishDatabase.deleteProject(projectId);
      showDashboardToast('Project deleted successfully');
    } catch (e) {
      console.warn('Delete project error:', e);
      showDashboardToast('Failed to delete project');
    }
  }

  // Refresh project list from database
  if (listContainer && window.FishDatabase) {
    try {
      let projects = await window.FishDatabase.getProjects();
      if (projectId) {
        projects = projects.filter(p => p && p.id !== projectId && String(p.id).trim() !== String(projectId).trim());
      }
      renderProjects(projects, listContainer, countBadge);
    } catch (_) {}
  }
}

/**
 * Exports project as .ofts package
 */
async function exportProjectAction(projectId, projectName) {
  showDashboardToast(`Exporting ${projectName || 'project'}...`);

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

/**
 * Opens Share Project Link modal from dashboard
 */
async function openShareProjectLinkModal(projectId, projectName) {
  if (!projectId || !window.FishDatabase) return;
  const project = await window.FishDatabase.getProject(projectId);
  if (!project) return;

  showDashboardToast('Packaging project for share link...');

  try {
    const zipBlob = await window.FishDatabase.exportProjectToOFTS(projectId, {
      skipDownload: true
    });

    if (!zipBlob) {
      showDashboardToast('Failed to package project');
      return;
    }

    const MAX_SHARE_SIZE = 15 * 1024 * 1024; // 15MB
    if (zipBlob.size > MAX_SHARE_SIZE) {
      const formattedSize = window.FishDatabase.formatBytes(zipBlob.size);
      alert(`Project size (${formattedSize}) exceeds the 15MB share limit.\n\nCloud link sharing is limited to 15MB. Please save the project directly to your local device (.ofts).`);
      return;
    }

    showDashboardToast('Uploading to storage...');

    const fd = new FormData();
    fd.append('file', zipBlob, (project.name || 'Project') + '.ofts');
    fd.append('name', project.name || 'Untitled Project');
    fd.append('specs', `${project.resolution || '1080p'} • ${project.fps || 60} fps`);
    fd.append('aspectRatio', project.aspectRatio || '16:9');
    fd.append('size', window.FishDatabase.formatBytes(zipBlob.size));
    fd.append('thumbnail', project.thumbnail || '');

    const res = await fetch('/api/share', {
      method: 'POST',
      body: fd
    });

    const json = await res.json();
    if (!res.ok || !json.success || !json.shareUrl) {
      alert('Share upload failed: ' + (json.error || 'Server error'));
      return;
    }

    // Save to persistent uploaded projects
    const rec = {
      id: String(json.id),
      name: (json.record && json.record.name) || project.name || 'Untitled Project',
      specs: (json.record && json.record.specs) || `${project.resolution || '1080p'} • ${project.fps || 60} fps`,
      size: (json.record && json.record.size) || window.FishDatabase.formatBytes(zipBlob.size),
      aspectRatio: (json.record && json.record.aspectRatio) || project.aspectRatio || '16:9',
      thumbnail: (json.record && json.record.thumbnail) || project.thumbnail || '',
      shareUrl: json.shareUrl,
      fileUrl: (json.record && json.record.fileUrl) || json.catboxUrl || '',
      createdAt: (json.record && json.record.createdAt) || Date.now()
    };

    window.FishDatabase.saveUploadedProject(rec);
    showDashboardToast('Share link created!');

    // Open QR modal directly
    openDashboardQRModal(rec);
  } catch (err) {
    console.error('[Dashboard:ShareLink]', err);
    showDashboardToast('Failed to generate project link: ' + (err.message || err));
  }
}
window.openShareProjectLinkModal = openShareProjectLinkModal;

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
let isCreatingNewProject = false;

async function createNewProjectAction() {
  if (isCreatingNewProject) return;
  isCreatingNewProject = true;

  const createBtn = document.querySelector('#modal-new-project .modal-btn-create');
  if (createBtn) {
    createBtn.style.opacity = '0.6';
    createBtn.style.pointerEvents = 'none';
  }

  try {
    const nameInput = document.getElementById('project-input-name');
    const name = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'New_Project';
    
    const selectedRatio = document.querySelector('#options-aspect-ratio .aspect-ratio-frame.is-selected')?.dataset.val || '16:9';
    const selectedRes = document.getElementById('dropdown-resolution')?.dataset.value || '1080p';
    const selectedFps = document.getElementById('dropdown-fps')?.dataset.value || '60';
    const selectedBg = document.querySelector('#options-bgcolor .modal-color-swatch.is-selected')?.dataset.val || 'transparent';

    const projectId = 'prj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    if (window.FishDatabase && typeof window.FishDatabase.createProject === 'function') {
      try {
        await window.FishDatabase.createProject({
          id: projectId,
          name: name,
          aspectRatio: selectedRatio,
          resolution: selectedRes,
          fps: selectedFps,
          bgColor: selectedBg
        });
      } catch (err) {
        console.warn('FishDatabase createProject error, using fallback:', err);
      }
    }

    // Close modal without triggering history.back (prevents navigation abort in Safari)
    if (window.Modal) {
      window.Modal.close(false);
    }

    const query = new URLSearchParams({
      id: projectId,
      name: name,
      aspect: selectedRatio,
      resolution: selectedRes,
      fps: selectedFps,
      bg: selectedBg
    });

    const targetPage = typeof resolveTargetEditorPage === 'function' ? resolveTargetEditorPage() : 'editor.html';
    window.location.href = `${targetPage}?${query.toString()}`;
  } catch (err) {
    console.error('Failed to create new project:', err);
    isCreatingNewProject = false;
    if (createBtn) {
      createBtn.style.opacity = '1';
      createBtn.style.pointerEvents = 'auto';
    }
  }
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

  // Wire Copy button for dashboard Share Link modal
  const btnIndexCopy = document.getElementById('btn-index-copy-project-link');
  if (btnIndexCopy && !btnIndexCopy._wired) {
    btnIndexCopy._wired = true;
    btnIndexCopy.addEventListener('click', async (e) => {
      e.preventDefault();
      const input = document.getElementById('index-share-project-link-input');
      if (input && input.value) {
        try {
          await navigator.clipboard.writeText(input.value);
          const orig = btnIndexCopy.textContent;
          btnIndexCopy.textContent = 'Copied!';
          showDashboardToast('Link copied to clipboard!');
          setTimeout(() => { btnIndexCopy.textContent = orig; }, 1800);
        } catch (_) {}
      }
    });
  }

  // ==========================================================================
  // MODULAR POP-UP: IMPORT PROJECT (File Dropzone & Link Switcher + Preset Confirm)
  // ==========================================================================
  setupImportProjectModal();
});

// Active shared project state
let activeSharedProject = null;

function extractProjectId(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  try {
    const parsed = new URL(str, window.location.origin);
    const queryId = parsed.searchParams.get('import') || parsed.searchParams.get('p') || parsed.searchParams.get('project');
    if (queryId) return queryId.trim();
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs.length > 0) return segs[segs.length - 1].trim();
  } catch (_) {}
  const parts = str.split('/');
  return parts[parts.length - 1].replace(/[^a-zA-Z0-9_-]/g, '').trim();
}

function showPresetConfirmModal(project) {
  activeSharedProject = project;
  const nameEl = document.getElementById('preset-confirm-name');
  const specsEl = document.getElementById('preset-confirm-specs');
  const thumbBox = document.getElementById('preset-confirm-thumb-box');
  const statusEl = document.getElementById('preset-confirm-status');
  const btn = document.getElementById('btn-do-preset-import');

  if (nameEl) nameEl.textContent = project.name || 'Shared Project';
  if (specsEl) {
    const parts = [project.specs, project.size].filter(Boolean);
    specsEl.textContent = parts.join(' • ') || 'Ready to import';
  }
  if (statusEl) {
    statusEl.className = 'modal-import-status';
    statusEl.textContent = '';
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Import';
  }

  if (thumbBox) {
    thumbBox.textContent = '';
    const isSafeThumb = typeof project.thumbnail === 'string' &&
      (project.thumbnail.startsWith('data:image/jpeg;base64,') ||
       project.thumbnail.startsWith('data:image/webp;base64,') ||
       project.thumbnail.startsWith('data:image/png;base64,'));
    if (isSafeThumb) {
      const img = document.createElement('img');
      img.src = project.thumbnail;
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      thumbBox.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'project-thumb-placeholder';
      ph.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--color-primary);background-color:var(--bg-canvas);';
      ph.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v10h14V5H5z"/></svg>';
      thumbBox.appendChild(ph);
    }
  }

  if (window.Modal) {
    window.Modal.open('modal-preset-confirm');
  }
}

function setupImportProjectModal() {
  const tabFile = document.getElementById('import-tab-file');
  const tabLink = document.getElementById('import-tab-link');
  const panelFile = document.getElementById('import-panel-file');
  const panelLink = document.getElementById('import-panel-link');
  const linkInput = document.getElementById('import-project-link-input');
  const statusText = document.getElementById('import-link-status-text');
  const btnSubmitLink = document.getElementById('btn-submit-import-link');
  const fileDropzone = document.getElementById('import-file-dropzone');
  const fileInput = document.getElementById('import-file-input');
  const fileStatus = document.getElementById('import-file-status');

  // 1. Icon-only Tab Switcher (File vs Link)
  if (tabFile && tabLink) {
    tabFile.addEventListener('click', () => {
      tabFile.classList.add('is-active');
      tabFile.setAttribute('aria-selected', 'true');
      tabLink.classList.remove('is-active');
      tabLink.setAttribute('aria-selected', 'false');
      if (panelFile) panelFile.style.display = 'block';
      if (panelLink) panelLink.style.display = 'none';
    });

    tabLink.addEventListener('click', () => {
      tabLink.classList.add('is-active');
      tabLink.setAttribute('aria-selected', 'true');
      tabFile.classList.remove('is-active');
      tabFile.setAttribute('aria-selected', 'false');
      if (panelFile) panelFile.style.display = 'none';
      if (panelLink) panelLink.style.display = 'block';
      if (linkInput) linkInput.focus();
    });
  }

  // 2. File Ingestion (.ofts dropzone)
  if (fileDropzone && fileInput) {
    fileDropzone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(name => {
      fileDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileDropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'dragend'].forEach(name => {
      fileDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileDropzone.classList.remove('is-dragover');
      });
    });

    fileDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileDropzone.classList.remove('is-dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImportedFiles(e.dataTransfer.files, fileDropzone, fileStatus);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleImportedFiles(fileInput.files, fileDropzone, fileStatus);
      }
    });
  }

  // 3. Link Ingestion: NOT realtime! Only fetch when clicking Import or Enter
  async function triggerLinkFetch() {
    const val = (linkInput?.value || '').trim();
    if (!val) {
      if (statusText) {
        statusText.className = 'modal-import-status is-error';
        statusText.textContent = 'Please enter a project link or ID';
      }
      return;
    }

    const id = extractProjectId(val);
    if (!id) {
      if (statusText) {
        statusText.className = 'modal-import-status is-error';
        statusText.textContent = 'Invalid link or project ID';
      }
      return;
    }

    if (btnSubmitLink) {
      btnSubmitLink.disabled = true;
      btnSubmitLink.textContent = 'Checking...';
    }
    if (statusText) {
      statusText.className = 'modal-import-status';
      statusText.textContent = 'Checking project availability...';
    }

    try {
      const res = await fetch(`/api/project?id=${encodeURIComponent(id)}`);
      const data = await res.json();

      if (!res.ok || !data.success || !data.project) {
        if (statusText) {
          statusText.className = 'modal-import-status is-error';
          statusText.textContent = 'Project Not Found';
        }
        if (btnSubmitLink) {
          btnSubmitLink.disabled = false;
          btnSubmitLink.textContent = 'Import';
        }
        return;
      }

      // Found: close link modal & open clean preset confirmation modal
      if (btnSubmitLink) {
        btnSubmitLink.disabled = false;
        btnSubmitLink.textContent = 'Import';
      }
      if (statusText) statusText.textContent = '';
      if (window.Modal) window.Modal.close('modal-import-project');

      setTimeout(() => {
        showPresetConfirmModal(data.project);
      }, 180);
    } catch (err) {
      if (statusText) {
        statusText.className = 'modal-import-status is-error';
        statusText.textContent = 'Project Not Found';
      }
      if (btnSubmitLink) {
        btnSubmitLink.disabled = false;
        btnSubmitLink.textContent = 'Import';
      }
    }
  }

  if (btnSubmitLink) {
    btnSubmitLink.addEventListener('click', (e) => {
      e.preventDefault();
      triggerLinkFetch();
    });
  }

  if (linkInput) {
    linkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerLinkFetch();
      }
    });
  }

  // 4. Confirm Preset Import button
  const btnDoPresetImport = document.getElementById('btn-do-preset-import');
  if (btnDoPresetImport) {
    btnDoPresetImport.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!activeSharedProject || !activeSharedProject.id) return;

      const confirmStatus = document.getElementById('preset-confirm-status');
      if (confirmStatus) {
        confirmStatus.className = 'modal-import-status';
        confirmStatus.textContent = 'Downloading package from Catbox storage...';
      }
      btnDoPresetImport.disabled = true;
      btnDoPresetImport.textContent = 'Importing...';

      try {
        const downloadUrl = `/api/project?id=${encodeURIComponent(activeSharedProject.id)}&download=1`;
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error('Download failed: ' + res.status);
        const blob = await res.blob();

        if (confirmStatus) confirmStatus.textContent = 'Extracting layers & assets into IndexedDB...';
        const file = new File([blob], (activeSharedProject.name || 'Project') + '.ofts', { type: 'application/octet-stream' });

        if (!window.FishDatabase || typeof window.FishDatabase.importOFTSPackage !== 'function') {
          throw new Error('Database import module unavailable');
        }

        const imported = await window.FishDatabase.importOFTSPackage(file);
        if (confirmStatus) {
          confirmStatus.className = 'modal-import-status is-ready';
          confirmStatus.textContent = 'Import successful! Opening project...';
        }

        setTimeout(() => {
          if (window.Modal) window.Modal.close();
          const targetPage = resolveTargetEditorPage();
          window.location.href = `${targetPage}?id=${imported.id}`;
        }, 400);
      } catch (err) {
        console.error('[FishImport:Preset]', err);
        if (confirmStatus) {
          confirmStatus.className = 'modal-import-status is-error';
          confirmStatus.textContent = 'Import failed: ' + (err.message || err);
        }
        btnDoPresetImport.disabled = false;
        btnDoPresetImport.textContent = 'Import';
      }
    });
  }

  // Auto-detect incoming project link in URL (/1 or ?import=1)
  checkIncomingProjectImportLink();
}

async function checkIncomingProjectImportLink() {
  const url = new URL(window.location.href);
  let importId = url.searchParams.get('import') || url.searchParams.get('p') || url.searchParams.get('project');
  if (!importId) {
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments.length === 1 && !['index.html', 'editor.html', 'desktop.html', 'demo.html', 'privacy.html', 'terms.html'].includes(segments[0])) {
      importId = segments[0];
    }
  }

  if (importId) {
    // Direct URL access: DO NOT open modal-import-project! Directly fetch & show preset confirmation popup
    try {
      const res = await fetch(`/api/project?id=${encodeURIComponent(importId)}`);
      const data = await res.json();
      if (res.ok && data.success && data.project) {
        setTimeout(() => {
          showPresetConfirmModal(data.project);
        }, 200);
      } else {
        alert('Project Not Found (file may have been deleted or expired).');
      }
    } catch (_) {
      alert('Project Not Found');
    }
  }
}

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
      const targetPage = resolveTargetEditorPage();
      window.location.href = `${targetPage}?id=${encodeURIComponent(importedProject.id)}&template=1`;
    } else {
      loadAndRender();
    }
  }, 300);
}

/**
 * Queries and updates storage durability status in Welcome modal
 */
async function updateStorageDurabilityUI() {
  const statusEl = document.getElementById('welcome-storage-status');
  const btnEl = document.getElementById('welcome-storage-btn');
  if (!statusEl) return;

  if (!window.FishDatabase || typeof window.FishDatabase.checkStoragePersistence !== 'function') {
    statusEl.textContent = 'IndexedDB local storage active';
    return;
  }

  const info = await window.FishDatabase.checkStoragePersistence();
  let usageStr = '';
  if (info.usage && info.quota) {
    const usedMB = (info.usage / (1024 * 1024)).toFixed(1);
    const quotaGB = (info.quota / (1024 * 1024 * 1024)).toFixed(1);
    usageStr = ` (${usedMB} MB / ${quotaGB} GB)`;
  }

  if (info.persisted) {
    statusEl.innerHTML = `<span style="color: var(--color-primary); font-weight: 700;">Protected (Persistent)</span> &bull; IndexedDB${usageStr}`;
    if (btnEl) btnEl.style.display = 'none';
  } else {
    statusEl.innerHTML = `<span>Standard (Best-effort)${usageStr}</span>`;
    if (btnEl) btnEl.style.display = 'inline-flex';
  }
}

window.requestStudioStoragePersist = async function () {
  const btnEl = document.getElementById('welcome-storage-btn');
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'Protecting...';
  }
  if (window.FishDatabase && typeof window.FishDatabase.requestPersistentStorage === 'function') {
    await window.FishDatabase.requestPersistentStorage();
    await updateStorageDurabilityUI();
  }
  if (btnEl) {
    btnEl.disabled = false;
    btnEl.textContent = 'Protect';
  }
};

/**
 * Automatically displays Welcome modal on first visit unless dismissed
 */
function initWelcomeModal() {
  syncWelcomeVersionTags();
  updateStorageDurabilityUI().catch(() => {});
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

// ==========================================================================
// DASHBOARD QR CODE SHARE MODAL CONTROLLER
// ==========================================================================
let _dashboardQRShareUrl = '';
let _dashboardCachedQRCardDataUrl = '';

// Dynamically load QRCode.js if not already available
if (typeof window !== 'undefined' && !window.QRCode) {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
  document.head.appendChild(s);
}

function drawImageCover(ctx, img, targetX, targetY, targetW, targetH) {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  if (!imgW || !imgH) return;
  const scale = Math.max(targetW / imgW, targetH / imgH);
  const sW = targetW / scale;
  const sH = targetH / scale;
  const sX = (imgW - sW) / 2;
  const sY = (imgH - sH) / 2;
  ctx.drawImage(img, sX, sY, sW, sH, targetX, targetY, targetW, targetH);
}

async function generateDashboardQRCardCanvas(shareUrl, record) {
  const W = 900, H = 1200;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // 1. Base dark background
  ctx.fillStyle = '#0d1109';
  ctx.fillRect(0, 0, W, H);

  // 2. Background thumbnail (COVER aspect ratio, NEVER stretched)
  let thumbSrc = (record && record.thumbnail) || null;
  if (thumbSrc && typeof thumbSrc === 'string' && thumbSrc.startsWith('data:')) {
    try {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = thumbSrc;
      });
      ctx.save();
      ctx.globalAlpha = 0.40;
      drawImageCover(ctx, img, 0, 0, W, H);
      ctx.restore();
    } catch (_) {}
  }

  // Dark overlay on thumbnail to guarantee high contrast
  ctx.fillStyle = 'rgba(13, 17, 9, 0.75)';
  ctx.fillRect(0, 0, W, H);

  // Card border inside canvas
  ctx.strokeStyle = '#222d1b';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  // 3. Header: Project Name (Centered, Cal Sans, truncated with ellipsis if long)
  ctx.fillStyle = '#98ce7b';
  ctx.font = 'bold 46px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let pName = (record && record.name) || 'Untitled Project';
  pName = String(pName).trim();
  if (ctx.measureText(pName).width > 740) {
    while (pName.length > 3 && ctx.measureText(pName + '…').width > 740) {
      pName = pName.slice(0, -1);
    }
    pName += '…';
  }
  ctx.fillText(pName, W / 2, 95);

  // Project Specs Subtitle
  const specsText = [record && record.specs, record && record.size].filter(Boolean).join(' • ') || '1080p • 60 fps';
  ctx.fillStyle = '#8fad84';
  ctx.font = '600 24px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(specsText, W / 2, 145);

  // 4. QR Code Box (White container card with rounded corners, prominent & scannable)
  const qrBoxSize = 640;
  const qrBoxX = (W - qrBoxSize) / 2;
  const qrBoxY = 195;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 32);
  } else {
    ctx.rect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);
  }
  ctx.fill();

  // Draw QR code from scratch element
  const qrWrap = document.getElementById('qr-share-qr-wrap');
  const qrCanvas = qrWrap ? qrWrap.querySelector('canvas') : null;
  const qrImg = qrWrap ? qrWrap.querySelector('img') : null;
  const pad = 36;
  const qrInnerSize = qrBoxSize - pad * 2;

  if (qrCanvas) {
    ctx.drawImage(qrCanvas, qrBoxX + pad, qrBoxY + pad, qrInnerSize, qrInnerSize);
  } else if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) {
    ctx.drawImage(qrImg, qrBoxX + pad, qrBoxY + pad, qrInnerSize, qrInnerSize);
  } else {
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(shareUrl, W / 2, qrBoxY + qrBoxSize / 2);
  }

  // 5. Action Instruction Prompt
  ctx.fillStyle = '#c0dbc0';
  ctx.font = '600 23px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Scan with camera to import project', W / 2, 905);

  // 6. Branding Footer: Premium Capsule Pill Badge (App Icon + "FishTools Studio")
  let iconLoaded = false;
  const appIcon = new Image();
  try {
    await new Promise((res, rej) => {
      appIcon.onload = res;
      appIcon.onerror = rej;
      appIcon.src = 'assets/icon-192.png';
    });
    iconLoaded = true;
  } catch (_) {
    try {
      await new Promise((res, rej) => {
        appIcon.onload = res;
        appIcon.onerror = rej;
        appIcon.src = 'assets/icon.svg';
      });
      iconLoaded = true;
    } catch (_) {}
  }

  const brandPillY = 1015;
  const brandPillH = 72;
  const iconSize = 44;
  const gap = 16;
  const brandText = 'FishTools Studio';

  ctx.font = 'bold 30px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  const textW = ctx.measureText(brandText).width;
  const innerW = (iconLoaded ? iconSize + gap : 0) + textW;
  const pillPaddingX = 32;
  const pillW = innerW + pillPaddingX * 2;
  const pillX = (W - pillW) / 2;
  const pillY = brandPillY - brandPillH / 2;

  ctx.fillStyle = '#151c12';
  ctx.strokeStyle = '#2d3e26';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pillX, pillY, pillW, brandPillH, brandPillH / 2);
  } else {
    ctx.rect(pillX, pillY, pillW, brandPillH);
  }
  ctx.fill();
  ctx.stroke();

  const contentStartX = pillX + pillPaddingX;
  if (iconLoaded) {
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(contentStartX, brandPillY - iconSize / 2, iconSize, iconSize, 10);
    } else {
      ctx.rect(contentStartX, brandPillY - iconSize / 2, iconSize, iconSize);
    }
    ctx.clip();
    ctx.drawImage(appIcon, contentStartX, brandPillY - iconSize / 2, iconSize, iconSize);
    ctx.restore();
  }

  const textStartX = iconLoaded ? contentStartX + iconSize + gap : contentStartX;
  ctx.fillStyle = '#98ce7b';
  ctx.font = 'bold 30px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(brandText, textStartX, brandPillY);

  return c;
}

async function openDashboardQRModal(record) {
  const backdrop = document.getElementById('qr-share-backdrop');
  if (!backdrop || !record) return;

  _dashboardQRShareUrl = record.shareUrl || `${window.location.origin}/${record.id}`;

  const qrWrap = document.getElementById('qr-share-qr-wrap');
  if (qrWrap) {
    if (!window.QRCode) {
      await new Promise(r => setTimeout(r, 400));
    }
    qrWrap.innerHTML = '';
    if (window.QRCode) {
      try {
        new window.QRCode(qrWrap, {
          text: _dashboardQRShareUrl,
          width: 500,
          height: 500,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.H
        });
      } catch (_) {}
    }
    await new Promise(r => setTimeout(r, 80));
  }

  try {
    const cardCanvas = await generateDashboardQRCardCanvas(_dashboardQRShareUrl, record);
    _dashboardCachedQRCardDataUrl = cardCanvas.toDataURL('image/png');
    const renderedImg = document.getElementById('qr-share-rendered-img');
    if (renderedImg) {
      renderedImg.src = _dashboardCachedQRCardDataUrl;
    }
  } catch (err) {
    console.error('[FishDashboard:QRCard]', err);
  }

  history.pushState({ qrModal: true }, '');
  backdrop.classList.add('is-active');
}

// Bind QR backdrop controls on dashboard
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('popstate', () => {
    const backdrop = document.getElementById('qr-share-backdrop');
    if (backdrop && backdrop.classList.contains('is-active')) {
      backdrop.classList.remove('is-active');
    }
  });

  const qrCloseBtn = document.getElementById('qr-btn-close');
  if (qrCloseBtn) {
    qrCloseBtn.addEventListener('click', () => {
      const backdrop = document.getElementById('qr-share-backdrop');
      if (backdrop) backdrop.classList.remove('is-active');
    });
  }

  const qrBackdropEl = document.getElementById('qr-share-backdrop');
  if (qrBackdropEl) {
    qrBackdropEl.addEventListener('click', (e) => {
      if (e.target === qrBackdropEl) {
        qrBackdropEl.classList.remove('is-active');
      }
    });
  }

  const qrCopyBtn = document.getElementById('qr-btn-copy');
  if (qrCopyBtn) {
    qrCopyBtn.addEventListener('click', async () => {
      if (_dashboardQRShareUrl) {
        try {
          await navigator.clipboard.writeText(_dashboardQRShareUrl);
          showDashboardToast('Link copied to clipboard!');
        } catch (_) {}
      }
    });
  }

  const qrDownloadBtn = document.getElementById('qr-btn-download');
  if (qrDownloadBtn) {
    qrDownloadBtn.addEventListener('click', () => {
      if (!_dashboardCachedQRCardDataUrl) return;
      const a = document.createElement('a');
      a.href = _dashboardCachedQRCardDataUrl;
      a.download = `Project_QR.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); }, 1000);
    });
  }
});

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
