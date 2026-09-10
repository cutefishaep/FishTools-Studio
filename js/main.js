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
  if (!raw) return '0.2.0 Alpha';
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
 * Fetches package.json and updates the badge next to Studio
 */
async function initVersionFetcher() {
  const badgeEl = document.getElementById('studio-version-badge');
  if (!badgeEl) return;

  if (window.location.protocol === 'file:') {
    badgeEl.textContent = '0.2.0 Alpha';
    return;
  }

  try {
    const response = await fetch('./package.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const pkg = await response.json();
    if (pkg.version) {
      badgeEl.textContent = formatAppVersion(pkg.version);
    }
  } catch (err) {
    badgeEl.textContent = '0.2.0 Alpha';
  }
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
          label: 'Rename',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
          action: () => openRenameModal(projectId, projectName)
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

  bindProjectSwipeGestures(container);
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
 * Opens the Rename Project Modal
 */
function openRenameModal(projectId, currentName) {
  const modal = document.getElementById('modal-rename-project');
  const input = document.getElementById('rename-input-name');
  const hiddenId = document.getElementById('rename-project-id');
  if (!modal || !input || !hiddenId) return;

  hiddenId.value = projectId;
  input.value = currentName || '';
  if (window.Modal) {
    window.Modal.open('modal-rename-project');
  }
  setTimeout(() => {
    input.focus();
    input.select();
  }, 80);
}

/**
 * Saves project rename from modal
 */
async function saveRenameProjectAction() {
  const input = document.getElementById('rename-input-name');
  const hiddenId = document.getElementById('rename-project-id');
  if (!input || !hiddenId) return;

  const newName = input.value.trim();
  const projectId = hiddenId.value;

  if (newName && projectId && window.FishDatabase) {
    await window.FishDatabase.renameProject(projectId, newName);
  }

  if (window.Modal) {
    window.Modal.close();
  }
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
    promptEl.textContent = `Hapus proyek ${displayName}?`;
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

  if (projectId && window.FishDatabase) {
    try {
      await window.FishDatabase.deleteProject(projectId);
      showDashboardToast('Proyek berhasil dihapus');
    } catch (e) {
      console.warn('Delete project error:', e);
    }
  }

  if (window.Modal) {
    window.Modal.close('modal-delete-project');
  }

  // Refresh project list
  const listContainer = document.getElementById('projects-container');
  const countBadge = document.getElementById('project-count-badge');
  if (listContainer && window.FishDatabase) {
    try {
      const projects = await window.FishDatabase.getProjects();
      renderProjects(projects, listContainer, countBadge);
    } catch (_) {}
  }
}

/**
 * Exports project as .ofts package
 */
async function exportProjectAction(projectId, projectName) {
  if (!projectId) return;

  showDashboardToast(`Mengekspor ${projectName || 'proyek'}...`);

  if (window.FishDatabase && typeof window.FishDatabase.exportProjectToOFTS === 'function') {
    try {
      await window.FishDatabase.exportProjectToOFTS(projectId);
      showDashboardToast('Ekspor .ofts selesai');
    } catch (err) {
      console.warn('Export project error:', err);
      showDashboardToast('Gagal mengekspor file .ofts');
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
});

/**
 * Handles imported .ofts project file
 */
async function handleImportedFiles(files, dropzone, statusEl) {
  if (!files || files.length === 0) return;
  const file = files[0];
  if (!file || !file.name.toLowerCase().endsWith('.ofts')) {
    alert('Hanya support file .ofts');
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
      alert('Gagal mengimport file .ofts');
    }
  }

  setTimeout(() => {
    if (window.Modal) window.Modal.close();
    dropzone.classList.remove('has-file');
    if (statusEl) statusEl.textContent = '';
    
    if (importedProject && importedProject.id) {
      window.location.href = `editor.html?id=${encodeURIComponent(importedProject.id)}&imported=1`;
    } else {
      loadAndRender();
    }
  }, 300);
}

/**
 * Automatically displays Welcome modal on first visit unless dismissed
 */
function initWelcomeModal() {
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
window.createNewProjectAction = createNewProjectAction;
window.closeWelcomeModal = closeWelcomeModal;
window.openDonateFromWelcome = openDonateFromWelcome;
window.toggleQrisDisplay = toggleQrisDisplay;
