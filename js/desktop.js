/**
 * DESKTOP.JS - Desktop NLE Workstation Controller
 * Manages 3-column top + full-width bottom timeline layout,
 * multi-axis splitter resizers, docked inspector, and media browser.
 */
(function initDesktopWorkstation() {
  'use strict';

  // --- 1. Load Saved Layout Dimensions ---
  const viewport = document.querySelector('.desktop-viewport');
  if (!viewport) return;

  try {
    const ua = navigator.userAgent || '';
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|SM-G/i.test(ua) ||
      (window.matchMedia && window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches) ||
      window.innerWidth < 900;
    if (!isMobileDevice) {
      localStorage.setItem('oft_preferred_view', 'desktop');
    }
    const savedUpperH = localStorage.getItem('oft_desktop_upper_height');
    if (savedUpperH) viewport.style.setProperty('--desktop-upper-height', savedUpperH);

    const savedLeftW = localStorage.getItem('oft_desktop_left_width');
    if (savedLeftW) viewport.style.setProperty('--desktop-left-width', savedLeftW);

    const savedRightW = localStorage.getItem('oft_desktop_right_width');
    if (savedRightW) viewport.style.setProperty('--desktop-right-width', savedRightW);

    const savedExtW = localStorage.getItem('oft_desktop_extension_width');
    if (savedExtW) viewport.style.setProperty('--desktop-extension-width', savedExtW);
  } catch (_) {}

  // Helper to sync preview canvas & timeline after layout changes
  function syncLayout() {
    if (typeof window.fitPreviewCanvasBox === 'function') {
      window.fitPreviewCanvasBox();
    }
    const layersVp = document.getElementById('timeline-layers-viewport');
    const layersTrk = document.getElementById('timeline-layers-track');
    if (layersVp) {
      if (layersVp.scrollLeft !== 0) layersVp.scrollLeft = 0;
      const maxScrollY = Math.max(0, (layersTrk ? layersTrk.scrollHeight : 0) - layersVp.clientHeight);
      if (layersVp.scrollTop > maxScrollY) {
        layersVp.scrollTop = maxScrollY;
      }
    }
    if (typeof window.updateTimelinePosition === 'function') {
      window.updateTimelinePosition(window.timelinePanX || 0, true);
    }
    if (window.PreviewCacheManager && typeof window.PreviewCacheManager.updateRulerUI === 'function') {
      window.PreviewCacheManager.updateRulerUI();
    }
  }
  window.syncDesktopLayout = syncLayout;

  // --- 2. Multi-Axis Split Resizers ---

  // A. Horizontal Splitter (Upper Row vs Timeline)
  const splitH = document.getElementById('desktop-split-horizontal');
  if (splitH) {
    let isDraggingH = false;

    splitH.addEventListener('pointerdown', (e) => {
      isDraggingH = true;
      splitH.classList.add('is-dragging');
      viewport.classList.add('is-resizing');
      splitH.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });

    splitH.addEventListener('pointermove', (e) => {
      if (!isDraggingH) return;
      const rect = viewport.getBoundingClientRect();
      const headerH = 36;
      const splitterH = 5;
      const minTimelineH = 160; // Timeline must always have at least 160px visible
      const minUpperH = 200;    // Upper panels need at least 200px
      const totalH = rect.height - headerH;
      const topOffset = e.clientY - rect.top - headerH;

      // Clamp strictly in pixels so timeline never collapes or gets pushed off screen
      const maxUpperH = Math.max(minUpperH, totalH - minTimelineH - splitterH);
      const clampedTopOffset = Math.max(minUpperH, Math.min(maxUpperH, topOffset));
      const percent = ((clampedTopOffset / totalH) * 100).toFixed(2) + '%';

      viewport.style.setProperty('--desktop-upper-height', percent);
      try {
        localStorage.setItem('oft_desktop_upper_height', percent);
      } catch (_) {}
      syncLayout();
    });

    function stopH(e) {
      if (!isDraggingH) return;
      isDraggingH = false;
      splitH.classList.remove('is-dragging');
      viewport.classList.remove('is-resizing');
      try { splitH.releasePointerCapture(e.pointerId); } catch (_) {}
      document.body.style.cursor = '';
      syncLayout();
    }

    splitH.addEventListener('pointerup', stopH);
    splitH.addEventListener('pointercancel', stopH);
  }

  // B. Left Vertical Splitter (Left Media Panel vs Preview)
  const splitLeft = document.getElementById('desktop-split-left');
  if (splitLeft) {
    let isDraggingLeft = false;

    splitLeft.addEventListener('pointerdown', (e) => {
      isDraggingLeft = true;
      splitLeft.classList.add('is-dragging');
      viewport.classList.add('is-resizing');
      splitLeft.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    splitLeft.addEventListener('pointermove', (e) => {
      if (!isDraggingLeft) return;
      const rect = viewport.getBoundingClientRect();
      let px = e.clientX - rect.left;

      // Clamp between 220px and 460px
      px = Math.max(220, Math.min(460, px));
      const val = Math.round(px) + 'px';
      viewport.style.setProperty('--desktop-left-width', val);
      try {
        localStorage.setItem('oft_desktop_left_width', val);
      } catch (_) {}
      syncLayout();
    });

    function stopLeft(e) {
      if (!isDraggingLeft) return;
      isDraggingLeft = false;
      splitLeft.classList.remove('is-dragging');
      viewport.classList.remove('is-resizing');
      try { splitLeft.releasePointerCapture(e.pointerId); } catch (_) {}
      document.body.style.cursor = '';
      syncLayout();
    }

    splitLeft.addEventListener('pointerup', stopLeft);
    splitLeft.addEventListener('pointercancel', stopLeft);
  }

  // C. Extension Vertical Splitter (Preview vs FishTools CEP Extension Panel)
  const splitExt = document.getElementById('desktop-split-extension');
  if (splitExt) {
    let isDraggingExt = false;

    splitExt.addEventListener('pointerdown', (e) => {
      isDraggingExt = true;
      splitExt.classList.add('is-dragging');
      viewport.classList.add('is-resizing');
      splitExt.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    splitExt.addEventListener('pointermove', (e) => {
      if (!isDraggingExt) return;
      const rect = viewport.getBoundingClientRect();
      const inspectorEl = document.getElementById('desktop-panel-inspector');
      const inspectorW = inspectorEl ? inspectorEl.getBoundingClientRect().width : 320;
      let px = (rect.right - e.clientX) - inspectorW - 5;

      // Clamp between 220px and 600px
      px = Math.max(220, Math.min(600, px));
      const val = Math.round(px) + 'px';
      viewport.style.setProperty('--desktop-extension-width', val);
      try {
        localStorage.setItem('oft_desktop_extension_width', val);
      } catch (_) {}
      syncLayout();
    });

    function stopExt(e) {
      if (!isDraggingExt) return;
      isDraggingExt = false;
      splitExt.classList.remove('is-dragging');
      viewport.classList.remove('is-resizing');
      try { splitExt.releasePointerCapture(e.pointerId); } catch (_) {}
      document.body.style.cursor = '';
      syncLayout();
    }

    splitExt.addEventListener('pointerup', stopExt);
    splitExt.addEventListener('pointercancel', stopExt);
  }

  // D. Right Vertical Splitter (Preview/Extension vs Right Inspector Panel)
  const splitRight = document.getElementById('desktop-split-right');
  if (splitRight) {
    let isDraggingRight = false;

    splitRight.addEventListener('pointerdown', (e) => {
      isDraggingRight = true;
      splitRight.classList.add('is-dragging');
      viewport.classList.add('is-resizing');
      splitRight.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    splitRight.addEventListener('pointermove', (e) => {
      if (!isDraggingRight) return;
      const rect = viewport.getBoundingClientRect();
      let px = rect.right - e.clientX;

      // Clamp between 260px and 500px
      px = Math.max(260, Math.min(500, px));
      const val = Math.round(px) + 'px';
      viewport.style.setProperty('--desktop-right-width', val);
      try {
        localStorage.setItem('oft_desktop_right_width', val);
      } catch (_) {}
      syncLayout();
    });

    function stopRight(e) {
      if (!isDraggingRight) return;
      isDraggingRight = false;
      splitRight.classList.remove('is-dragging');
      viewport.classList.remove('is-resizing');
      try { splitRight.releasePointerCapture(e.pointerId); } catch (_) {}
      document.body.style.cursor = '';
      syncLayout();
    }

    splitRight.addEventListener('pointerup', stopRight);
    splitRight.addEventListener('pointercancel', stopRight);
  }

  // Window resize handler — debounced (100ms) to prevent per-pixel layout thrash during window drag
  let _resizeDebounceTimer = null;
  window.addEventListener('resize', () => {
    if (_resizeDebounceTimer) return;
    _resizeDebounceTimer = setTimeout(() => {
      _resizeDebounceTimer = null;
      syncLayout();
    }, 100);
  }, { passive: true });

  // --- 3. Left Panel Category Tab Controller ---
  function initLeftPanelTabs() {
    const catSwitch = document.querySelector('.add-layer-categories-switch');
    if (!catSwitch) return;

    const mediaPool = document.getElementById('add-layer-media-pool');
    const controlPanel = document.getElementById('add-layer-control-panel');
    const shapePanel = document.getElementById('add-layer-shape-panel');
    const textPanel = document.getElementById('add-layer-text-panel');

    function switchCategory(category) {
      catSwitch.querySelectorAll('.segmented-switch-item').forEach((item) => {
        const cat = item.dataset.category || item.dataset.value;
        const isMatch = (cat === category);
        item.classList.toggle('is-active', isMatch);
        item.classList.toggle('is-selected', isMatch);
        item.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      if (mediaPool) mediaPool.style.display = (category === 'media') ? '' : 'none';
      if (controlPanel) controlPanel.style.display = (category === 'control') ? '' : 'none';
      if (shapePanel) shapePanel.style.display = (category === 'shape') ? '' : 'none';
      if (textPanel) textPanel.style.display = (category === 'text') ? '' : 'none';

      if (category === 'media' && typeof window.renderProjectMediaGrid === 'function') {
        window.renderProjectMediaGrid();
      }
      if (category === 'text' && typeof window.renderTextPresetsGrid === 'function') {
        window.renderTextPresetsGrid();
      }
    }

    catSwitch.addEventListener('click', (e) => {
      const item = e.target.closest('.segmented-switch-item');
      if (item) {
        const cat = item.dataset.category || item.dataset.value || 'media';
        switchCategory(cat);
      }
    });

    // Default to shape or media
    switchCategory('media');
  }

  // --- 4. Inspector State Synchronization ---
  const headerNavLayer = document.getElementById('header-nav-layer');
  const inspectorEmpty = document.getElementById('desktop-inspector-empty');
  const layerDrawer = document.getElementById('timeline-layer-drawer');
  const inspectorTitle = document.getElementById('desktop-inspector-title');
  const inspectorPanel = document.getElementById('desktop-panel-inspector');

  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('testInspector')) {
      window.mockInspectorActive = true;
    }
  } catch (_) {}

  function setDesktopSelectedLayers(idSet, primaryId) {
    const ids = Array.from(idSet || []);
    if (ids.length === 0) {
      deselectAllDesktopLayers();
      return;
    }

    const firstId = (primaryId && ids.includes(primaryId)) ? primaryId : ids[0];

    if (typeof window.selectTimelineLayers === 'function') {
      window.selectTimelineLayers(ids, firstId);
    } else {
      window.selectedLayerId = firstId;
      window.lastSelectedLayerId = firstId;
      if (!window.selectedLayerIds) window.selectedLayerIds = new Set();
      window.selectedLayerIds.clear();
      ids.forEach(id => window.selectedLayerIds.add(id));
      window.isSelectorMode = (ids.length > 1);

      if (typeof window.updateEditorHeaderMode === 'function') {
        window.updateEditorHeaderMode();
      }
      if (typeof window.syncSelectionClassesInPlace === 'function') {
        window.syncSelectionClassesInPlace();
      }
      syncInspectorState();
      if (typeof window.redrawComposition === 'function') {
        window.redrawComposition();
      }
    }
  }
  window.setDesktopSelectedLayers = setDesktopSelectedLayers;

  function deselectAllDesktopLayers() {
    // 1. Call editor.js deselect first while selectedLayerId is still known
    if (typeof window.deselectTimelineLayer === 'function') {
      try { window.deselectTimelineLayer(); } catch (_) {}
    }

    // 2. Explicitly ensure all global desktop flags and states are reset
    window.mockInspectorActive = false;
    window._mockInspectorDismissed = true;
    window.isSelectorMode = false;
    window.selectedLayerId = null;
    if (window.selectedLayerIds) {
      window.selectedLayerIds.clear();
    } else {
      window.selectedLayerIds = new Set();
    }
    window.lastSelectedLayerId = null;
    window.selectedMediaId = null;
    window.activeKeyframeProperty = null;

    if (typeof window.clearSelectedKeyframes === 'function') {
      try { window.clearSelectedKeyframes(); } catch (_) {}
    }

    if (window.Drawer && window.Drawer.isOpen('timeline-layer-drawer')) {
      try { window.Drawer.close(false); } catch (_) {}
    }

    if (window.Popover && typeof window.Popover.close === 'function') {
      try { window.Popover.close(); } catch (_) {}
    }

    const projectNav = document.getElementById('header-nav-project');
    const layerNav = document.getElementById('header-nav-layer');
    const leftBatchActions = document.getElementById('editor-layer-batch-actions');
    if (leftBatchActions) leftBatchActions.style.display = 'none';
    if (layerNav) layerNav.style.display = 'none';
    if (projectNav) projectNav.style.display = 'flex';

    document.querySelectorAll('.timeline-lane-pill-slot.is-focused, .timeline-lane-pill-slot.is-selected').forEach(s => {
      s.classList.remove('is-focused', 'is-selected');
    });
    document.querySelectorAll('.timeline-layer-ctrl-pill.is-selected, .timeline-layer-ctrl-pill.is-focused').forEach(p => {
      p.classList.remove('is-selected', 'is-focused');
    });
    document.querySelectorAll('.timeline-clip-block.is-selected').forEach(c => {
      c.classList.remove('is-selected');
    });

    const overlay = document.getElementById('timeline-lane-heads-overlay');
    if (overlay) overlay.classList.remove('is-selector-mode');
    const vp = document.getElementById('timeline-layers-viewport');
    if (vp) vp.classList.remove('is-selector-mode', 'has-drawer-open');
    const tl = document.getElementById('main-editor-timeline');
    if (tl) tl.classList.remove('has-layer-drawer-open');

    if (typeof window.syncSelectionClassesInPlace === 'function') {
      try { window.syncSelectionClassesInPlace(); } catch (_) {}
    }
    if (typeof window.updateEditorHeaderMode === 'function') {
      try { window.updateEditorHeaderMode(); } catch (_) {}
    }
    syncInspectorState();
    if (typeof window.redrawComposition === 'function') {
      try { window.redrawComposition(); } catch (_) {}
    }
  }
  window.deselectAllDesktopLayers = deselectAllDesktopLayers;

  function syncInspectorState() {
    const hasActiveLayer = !!(
      (!window._mockInspectorDismissed && window.mockInspectorActive) ||
      (window.selectedLayerId && window.selectedLayerId !== '') ||
      (window.selectedLayerIds && window.selectedLayerIds.size > 0)
    );

    if (inspectorPanel) {
      inspectorPanel.classList.toggle('has-active-layer', hasActiveLayer);
    }

    // Force-sync clipboard toolbar buttons directly from here (authoritative truth)
    // This prevents a 30ms setTimeout race in the global click listener from re-showing buttons
    const _btnCopy = document.getElementById('desktop-btn-copy');
    const _btnPaste = document.getElementById('desktop-btn-paste');
    if (!hasActiveLayer) {
      // Copy always requires a selection — always hide via class (beats CSS !important)
      if (_btnCopy) { _btnCopy.classList.add('is-clipboard-hidden'); _btnCopy.style.display = ''; }

      // Paste is still visible when clipboard has content (layer or attribute clipboard)
      const hasClipboardContent = !!(
        window.internalAttributeClipboard ||
        (window.internalLayerClipboard && window.internalLayerClipboard.length > 0)
      );
      if (_btnPaste) { _btnPaste.classList.toggle('is-clipboard-hidden', !hasClipboardContent); _btnPaste.style.display = ''; }
    } else {
      if (typeof window.updateClipboardButtonsVisibility === 'function') {
        window.updateClipboardButtonsVisibility();
      }
    }

    if (typeof window.updateCutBarRowState === 'function') {
      window.updateCutBarRowState();
    }

    if (hasActiveLayer) {
      if (inspectorEmpty) inspectorEmpty.style.display = 'none';
      if (layerDrawer) layerDrawer.style.display = 'flex';

      if (window.mockInspectorActive) {
        const mainView = document.getElementById('layer-drawer-main-view');
        const transformView = document.getElementById('layer-drawer-transform-view');
        const blendView = document.getElementById('layer-drawer-blend-view');
        const graphView = document.getElementById('layer-drawer-graph-view');

        const testMode = new URLSearchParams(window.location.search).get('testInspector');
        if (testMode === 'blend') {
          if (mainView) mainView.classList.remove('is-active');
          if (blendView) blendView.classList.add('is-active');
        } else if (testMode === 'graph') {
          if (mainView) mainView.classList.remove('is-active');
          if (graphView) graphView.classList.add('is-active');
        } else if (testMode === 'transform') {
          if (mainView) {
            mainView.classList.remove('is-active');
            mainView.style.display = 'none';
          }
          if (transformView) {
            transformView.classList.add('is-active');
            transformView.style.display = 'flex';
          }
        } else if (testMode === 'scale') {
          if (mainView) {
            mainView.classList.remove('is-active');
            mainView.style.display = 'none';
          }
          if (transformView) {
            transformView.classList.add('is-active');
            transformView.style.display = 'flex';
            const scaleBtn = transformView.querySelector('.transform-tool-btn[data-tool="scale"]');
            if (scaleBtn) scaleBtn.click();
          }
        } else if (testMode === 'scale-unlinked') {
          if (mainView) {
            mainView.classList.remove('is-active');
            mainView.style.display = 'none';
          }
          if (transformView) {
            transformView.classList.add('is-active');
            transformView.style.display = 'flex';
            const scaleBtn = transformView.querySelector('.transform-tool-btn[data-tool="scale"]');
            if (scaleBtn) scaleBtn.click();
            const linkBtn = document.getElementById('btn-scale-link');
            if (linkBtn) linkBtn.click();
          }
        }
      }

      // Sync Speed & Volume buttons in Inspector
      const currentLayer = window.selectedLayerId
        ? (window.currentProjectState && window.currentProjectState.layers || []).find(l => l.id === window.selectedLayerId)
        : null;
      const supportsSpeedVolume = !!(window.mockInspectorActive || (currentLayer && (currentLayer.type === 'video' || currentLayer.type === 'audio' || currentLayer.type === 'precomp')));
      const btnSpeed = document.getElementById('btn-layer-speed');
      const btnVolume = document.getElementById('btn-layer-volume');
      if (btnSpeed) btnSpeed.style.display = supportsSpeedVolume ? 'inline-flex' : 'none';
      if (btnVolume) btnVolume.style.display = supportsSpeedVolume ? 'inline-flex' : 'none';
      if (typeof window.updateVolumeAndSpeedBtnState === 'function') {
        window.updateVolumeAndSpeedBtnState(currentLayer);
      }

      const layerNameInput = document.getElementById('editor-layer-name-input');
      const batchTitle = document.getElementById('editor-layer-batch-title');
      let name = 'Selected';
      if (batchTitle && batchTitle.style.display !== 'none' && batchTitle.textContent) {
        name = batchTitle.textContent;
      } else if (layerNameInput && layerNameInput.value) {
        name = layerNameInput.value;
      }
      if (inspectorTitle) inspectorTitle.textContent = 'Inspector';
    } else {
      if (inspectorEmpty) {
        inspectorEmpty.style.display = 'flex';
      }
      if (layerDrawer) layerDrawer.style.display = 'none';
      if (inspectorTitle) inspectorTitle.textContent = 'Inspector';
    }
  }

  // Observe headerNavLayer style changes (which toggles when a layer is selected/deselected)
  if (headerNavLayer) {
    const observer = new MutationObserver(() => {
      syncInspectorState();
    });
    observer.observe(headerNavLayer, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  // Also hook into deselect button
  const deselectBtn = document.getElementById('btn-layer-header-back');
  if (deselectBtn) {
    deselectBtn.addEventListener('click', () => {
      setTimeout(syncInspectorState, 50);
    });
  }

  // Periodic safety check for selectedLayerId state changes (200ms polling, early-exit if unchanged)
  let _lastInspectorHasLayer = null;
  setInterval(() => {
    const hasActiveLayer = !!(
      (!window._mockInspectorDismissed && window.mockInspectorActive) ||
      (window.selectedLayerId && window.selectedLayerId !== '') ||
      (window.selectedLayerIds && window.selectedLayerIds.size > 0)
    );
    // Early-exit: skip DOM class check when state didn't change
    if (hasActiveLayer === _lastInspectorHasLayer) return;
    _lastInspectorHasLayer = hasActiveLayer;
    if (inspectorPanel && inspectorPanel.classList.contains('has-active-layer') !== hasActiveLayer) {
      syncInspectorState();
    }
  }, 200);

  // --- 5. FishTools CEP Extension Panel Controller ---
  let isExtensionInited = false;
  function initDesktopFishToolsExtension() {
    if (isExtensionInited) return;
    const triggerBtn = document.getElementById('editor-btn-fishtool-trigger');
    const extensionPanel = document.getElementById('desktop-panel-fishtool');
    const extensionSplitter = document.getElementById('desktop-split-extension');
    const bodyEl = document.getElementById('desktop-fishtools-body');
    const loaderEl = document.getElementById('desktop-fishtools-loader');
    const closeBtn = document.getElementById('desktop-fishtool-btn-close');
    const reloadBtn = document.getElementById('desktop-fishtool-btn-reload');

    if (!triggerBtn || !extensionPanel || !bodyEl) return;
    isExtensionInited = true;

    let isLoaded = false;
    let iframe = null;

    function openExtension() {
      extensionPanel.style.display = 'flex';
      if (extensionSplitter) extensionSplitter.style.display = 'flex';
      triggerBtn.classList.add('is-active');
      triggerBtn.setAttribute('aria-expanded', 'true');

      if (!isLoaded) {
        isLoaded = true;
        loadIframe();
      }

      syncLayout();
    }

    function closeExtension() {
      extensionPanel.style.display = 'none';
      if (extensionSplitter) extensionSplitter.style.display = 'none';
      triggerBtn.classList.remove('is-active');
      triggerBtn.setAttribute('aria-expanded', 'false');
      syncLayout();
    }

    function toggleExtension() {
      const isOpen = extensionPanel.style.display !== 'none' && extensionPanel.style.display !== '';
      if (isOpen) {
        closeExtension();
      } else {
        openExtension();
      }
    }
    window.toggleDesktopFishTools = toggleExtension;

    function loadIframe() {
      if (loaderEl) loaderEl.style.display = 'flex';
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.className = 'desktop-extension-frame';
        iframe.id = 'desktop-fishtools-frame';
        iframe.title = 'FishTools Extension';
        bodyEl.appendChild(iframe);
      }

      function mount() {
        if (window.FishToolsAdapter && typeof window.FishToolsAdapter.loadIntoIframe === 'function') {
          window.FishToolsAdapter.loadIntoIframe(iframe, loaderEl);
        }
      }

      if (window.FishToolsAdapter) {
        mount();
      } else {
        const checkAdapter = setInterval(() => {
          if (window.FishToolsAdapter) {
            clearInterval(checkAdapter);
            mount();
          }
        }, 100);
        setTimeout(() => clearInterval(checkAdapter), 5000);
      }
    }

    // Intercept click on FishTool trigger button in timeline toolbar
    triggerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleExtension();
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeExtension();
      });
    }

    if (reloadBtn) {
      reloadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (iframe && window.FishToolsAdapter) {
          if (loaderEl) loaderEl.style.display = 'flex';
          window.FishToolsAdapter.loadIntoIframe(iframe, loaderEl, true);
        }
      });
    }

    // Auto-open if query param ?fishtools=open is provided
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('fishtools') === 'open') {
        openExtension();
      }
    } catch (_) {}
  }

  // --- 6. Desktop Pro NLE Timeline Controller ---
  function initDesktopTimeline() {
    const layersViewport = document.getElementById('timeline-layers-viewport');
    const overlayContainer = document.getElementById('timeline-lane-heads-overlay');
    if (!layersViewport || !overlayContainer) return;

    // Reorder indicator line
    let indicator = layersViewport.querySelector('.desktop-reorder-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'desktop-reorder-indicator';
      layersViewport.appendChild(indicator);
    }

    let activeDesktopParentDropdown = null;

    function closeDesktopParentDropdown() {
      if (activeDesktopParentDropdown) {
        activeDesktopParentDropdown.remove();
        activeDesktopParentDropdown = null;
      }
      document.removeEventListener('pointerdown', onDropdownDocPointerDown, true);
      document.removeEventListener('keydown', onDropdownDocKeyDown, true);
      window.removeEventListener('resize', closeDesktopParentDropdown, { passive: true });
      const vp = document.getElementById('timeline-layers-viewport');
      if (vp) vp.removeEventListener('scroll', closeDesktopParentDropdown, { passive: true });
    }

    function onDropdownDocPointerDown(e) {
      if (activeDesktopParentDropdown && !activeDesktopParentDropdown.contains(e.target)) {
        closeDesktopParentDropdown();
      }
    }

    function onDropdownDocKeyDown(e) {
      if (e.key === 'Escape') {
        closeDesktopParentDropdown();
      }
    }

    function openDesktopParentDropdown(triggerBadge, layerId) {
      if (activeDesktopParentDropdown && activeDesktopParentDropdown._targetLayerId === String(layerId)) {
        closeDesktopParentDropdown();
        return;
      }
      closeDesktopParentDropdown();

      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const currentLayer = layers.find(l => String(l.id) === String(layerId));
      if (!currentLayer) return;

      const isMulti = window.selectedLayerIds && (window.selectedLayerIds.has(layerId) || window.selectedLayerIds.has(String(layerId))) && window.selectedLayerIds.size > 1;
      const targetIds = isMulti ? new Set(Array.from(window.selectedLayerIds).map(String)) : new Set([String(layerId)]);
      const targetLayers = layers.filter(l => targetIds.has(String(l.id)));
      if (targetLayers.length === 0) targetLayers.push(currentLayer);

      const hasParent = targetLayers.some(l => !!l.parentId);

      function isDescendant(candidateId, ancestorId) {
        let cur = layers.find(l => String(l.id) === String(candidateId));
        const visited = new Set();
        while (cur && cur.parentId) {
          if (visited.has(cur.id)) break;
          visited.add(cur.id);
          if (String(cur.parentId) === String(ancestorId)) return true;
          cur = layers.find(l => String(l.id) === String(cur.parentId));
        }
        return false;
      }

      const dropdown = document.createElement('div');
      dropdown.className = 'desktop-parent-dropdown';
      dropdown.setAttribute('role', 'menu');
      dropdown.setAttribute('aria-label', 'Select Parent Layer');
      dropdown._targetLayerId = String(layerId);

      // 1. None / Unlink item at top
      const noneBtn = document.createElement('button');
      noneBtn.type = 'button';
      noneBtn.className = `desktop-parent-dropdown-item item-none ${!hasParent ? 'is-active' : ''}`;
      noneBtn.innerHTML = `
        <span class="dropdown-item-text">None</span>
        ${!hasParent ? '<span class="dropdown-item-check" aria-hidden="true">✓</span>' : ''}
      `;
      noneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (typeof window.unlinkLayer === 'function') {
          targetLayers.forEach(t => {
            if (t.parentId) window.unlinkLayer(t);
          });
          if (typeof window.showEffectsRackToast === 'function') {
            window.showEffectsRackToast(targetLayers.length > 1 ? `Unlinked ${targetLayers.length} layers` : `Unlinked "${currentLayer.name}"`);
          }
        }
        closeDesktopParentDropdown();
      });
      dropdown.appendChild(noneBtn);

      // Separator
      const divider = document.createElement('div');
      divider.className = 'desktop-parent-dropdown-divider';
      dropdown.appendChild(divider);

      // 2. Pure text layer list (1. Layer Name, 2. Layer Name, etc.)
      const listWrapper = document.createElement('div');
      listWrapper.className = 'desktop-parent-dropdown-list';

      layers.forEach((l, idx) => {
        const isSelf = String(l.id) === String(currentLayer.id);
        const isSelected = targetIds.has(String(l.id));
        const isCurrentParent = targetLayers.some(t => String(t.parentId) === String(l.id));
        const isCircular = !isSelected && targetLayers.some(t => isDescendant(l.id, t.id));
        const isDisabled = isSelf || isSelected || isCircular;

        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.className = `desktop-parent-dropdown-item ${isCurrentParent ? 'is-active' : ''} ${isDisabled ? 'is-disabled' : ''}`;
        if (isDisabled) {
          itemBtn.disabled = true;
          itemBtn.title = isSelf ? 'Current layer' : (isSelected ? 'Selected layer' : 'Descendant layer (circular)');
        }

        itemBtn.innerHTML = `
          <span class="dropdown-item-num">${idx + 1}.</span>
          <span class="dropdown-item-text">${l.name || 'Untitled Layer'}</span>
          ${isCurrentParent ? '<span class="dropdown-item-check" aria-hidden="true">✓</span>' : ''}
        `;

        if (!isDisabled) {
          itemBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (typeof window.linkLayer === 'function') {
              targetLayers.forEach(t => {
                window.linkLayer(t, l);
              });
              if (typeof window.showEffectsRackToast === 'function') {
                window.showEffectsRackToast(targetLayers.length > 1 ? `Linked ${targetLayers.length} layers to "${l.name}"` : `Linked "${currentLayer.name}" to "${l.name}"`);
              }
            }
            closeDesktopParentDropdown();
          });
        }

        listWrapper.appendChild(itemBtn);
      });

      dropdown.appendChild(listWrapper);
      document.body.appendChild(dropdown);
      activeDesktopParentDropdown = dropdown;

      // Position anchored above or below trigger badge
      let targetEl = (triggerBadge && triggerBadge.isConnected) ? triggerBadge : null;
      if (!targetEl && layerId) {
        targetEl = document.querySelector(`.timeline-lane-pill-slot[data-layer-id="${layerId}"] .desktop-layer-parent-badge`) ||
                   document.querySelector(`.timeline-lane-pill-slot[data-layer-id="${layerId}"] .desktop-layer-parent-col`) ||
                   document.querySelector(`.timeline-lane-pill-slot[data-layer-id="${layerId}"]`);
      }
      if (!targetEl && triggerBadge) {
        targetEl = triggerBadge;
      }

      let badgeRect = targetEl ? targetEl.getBoundingClientRect() : null;
      const isValidRect = badgeRect && (badgeRect.width > 0 || badgeRect.height > 0) && (badgeRect.top !== 0 || badgeRect.bottom !== 0 || badgeRect.left !== 0);

      if (!isValidRect && layerId) {
        const slotEl = document.querySelector(`.timeline-lane-pill-slot[data-layer-id="${layerId}"]`);
        if (slotEl && slotEl.isConnected) {
          badgeRect = slotEl.getBoundingClientRect();
        }
      }

      const vh = window.innerHeight;
      const vw = window.innerWidth;

      if (!badgeRect || (badgeRect.top === 0 && badgeRect.bottom === 0)) {
        const overlay = document.getElementById('timeline-lane-heads-overlay') || document.getElementById('main-editor-timeline');
        if (overlay) {
          const oRect = overlay.getBoundingClientRect();
          badgeRect = {
            top: oRect.top + 40,
            bottom: oRect.top + 64,
            left: oRect.left + 140,
            right: oRect.left + 220,
            width: 80,
            height: 24
          };
        } else {
          badgeRect = {
            top: vh - 180,
            bottom: vh - 156,
            left: 200,
            right: 280,
            width: 80,
            height: 24
          };
        }
      }

      const dropdownRect = dropdown.getBoundingClientRect();
      const spaceAbove = badgeRect.top;
      const spaceBelow = vh - badgeRect.bottom;

      let left = Math.max(8, Math.min(vw - dropdownRect.width - 8, badgeRect.left));

      if (spaceAbove >= dropdownRect.height + 6 || spaceAbove >= spaceBelow) {
        // Pop Upward (standard on bottom timeline)
        dropdown.style.top = '';
        dropdown.style.bottom = `${vh - badgeRect.top + 4}px`;
        dropdown.style.left = `${left}px`;
        dropdown.style.maxHeight = `${Math.max(120, Math.min(320, spaceAbove - 12))}px`;
        dropdown.style.transformOrigin = 'bottom left';
      } else {
        // Pop Downward
        dropdown.style.bottom = '';
        dropdown.style.top = `${badgeRect.bottom + 4}px`;
        dropdown.style.left = `${left}px`;
        dropdown.style.maxHeight = `${Math.max(120, Math.min(320, spaceBelow - 12))}px`;
        dropdown.style.transformOrigin = 'top left';
      }

      const activeItem = listWrapper.querySelector('.desktop-parent-dropdown-item.is-active');
      if (activeItem) {
        try {
          activeItem.scrollIntoView({ block: 'nearest' });
        } catch (_) {}
      }

      const vp = document.getElementById('timeline-layers-viewport');
      if (vp) vp.addEventListener('scroll', closeDesktopParentDropdown, { passive: true });
      window.addEventListener('resize', closeDesktopParentDropdown, { passive: true });

      setTimeout(() => {
        document.addEventListener('pointerdown', onDropdownDocPointerDown, true);
        document.addEventListener('keydown', onDropdownDocKeyDown, true);
      }, 10);
    }
    window.openDesktopParentDropdown = openDesktopParentDropdown;

    function initPickwhipDrag(pickwhipBtn, sourceLayerId) {
      if (!pickwhipBtn || pickwhipBtn._pickwhipBound) return;
      pickwhipBtn._pickwhipBound = true;

      pickwhipBtn.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
        const sourceLayer = layers.find(l => String(l.id) === String(sourceLayerId));
        if (!sourceLayer) return;

        const rect = pickwhipBtn.getBoundingClientRect();
        const originX = rect.left + rect.width / 2;
        const originY = rect.top + rect.height / 2;

        pickwhipBtn.classList.add('is-dragging');
        document.body.style.cursor = 'crosshair';

        let laserSvg = document.querySelector('.desktop-pickwhip-laser-svg');
        if (!laserSvg) {
          laserSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          laserSvg.setAttribute('class', 'desktop-pickwhip-laser-svg');
          laserSvg.setAttribute('aria-hidden', 'true');
          laserSvg.innerHTML = `<line x1="${originX}" y1="${originY}" x2="${originX}" y2="${originY}" stroke="var(--color-primary)" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round"/>`;
          document.body.appendChild(laserSvg);
        }
        const line = laserSvg.querySelector('line');

        let currentHoverSlot = null;

        function onPointerMove(me) {
          me.preventDefault();
          if (line) {
            line.setAttribute('x2', String(me.clientX));
            line.setAttribute('y2', String(me.clientY));
          }

          const underEl = document.elementFromPoint(me.clientX, me.clientY);
          const slot = underEl ? underEl.closest('.timeline-lane-pill-slot') : null;
          if (slot && slot.dataset.layerId && String(slot.dataset.layerId) !== String(sourceLayerId)) {
            if (currentHoverSlot !== slot) {
              if (currentHoverSlot) currentHoverSlot.classList.remove('is-pickwhip-target');
              currentHoverSlot = slot;
              currentHoverSlot.classList.add('is-pickwhip-target');
            }
          } else {
            if (currentHoverSlot) {
              currentHoverSlot.classList.remove('is-pickwhip-target');
              currentHoverSlot = null;
            }
          }
        }

        function onPointerUp(ue) {
          window.removeEventListener('pointermove', onPointerMove, { capture: true });
          window.removeEventListener('pointerup', onPointerUp, { capture: true });
          window.removeEventListener('pointercancel', onPointerUp, { capture: true });

          pickwhipBtn.classList.remove('is-dragging');
          document.body.style.cursor = '';
          if (laserSvg) laserSvg.remove();
          if (currentHoverSlot) {
            currentHoverSlot.classList.remove('is-pickwhip-target');
          }

          const dropEl = document.elementFromPoint(ue.clientX, ue.clientY);
          const targetSlot = dropEl ? dropEl.closest('.timeline-lane-pill-slot') : null;
          const targetLayerId = targetSlot ? targetSlot.dataset.layerId : null;
          const dist = Math.hypot(ue.clientX - originX, ue.clientY - originY);
          const isReleasedOnSelf = (targetSlot && String(targetLayerId) === String(sourceLayerId)) ||
                                   (dropEl && dropEl.closest('.desktop-layer-pickwhip-btn') === pickwhipBtn);

          const curLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
          const isMulti = window.selectedLayerIds && (window.selectedLayerIds.has(sourceLayerId) || window.selectedLayerIds.has(String(sourceLayerId))) && window.selectedLayerIds.size > 1;
          const targetIds = isMulti ? new Set(Array.from(window.selectedLayerIds).map(String)) : new Set([String(sourceLayerId)]);
          const targetLayers = curLayers.filter(l => targetIds.has(String(l.id)));
          if (targetLayers.length === 0) targetLayers.push(sourceLayer);

          function isDescendant(candidateId, ancestorId) {
            let cur = curLayers.find(l => String(l.id) === String(candidateId));
            const visited = new Set();
            while (cur && cur.parentId) {
              if (visited.has(cur.id)) break;
              visited.add(cur.id);
              if (String(cur.parentId) === String(ancestorId)) return true;
              cur = curLayers.find(l => String(l.id) === String(cur.parentId));
            }
            return false;
          }

          if (targetLayerId && !targetIds.has(String(targetLayerId))) {
            const targetLayer = curLayers.find(l => String(l.id) === String(targetLayerId));
            if (targetLayer && typeof window.linkLayer === 'function') {
              const validTargets = targetLayers.filter(t => !isDescendant(targetLayer.id, t.id));
              validTargets.forEach(t => window.linkLayer(t, targetLayer));
              if (typeof window.showEffectsRackToast === 'function') {
                window.showEffectsRackToast(validTargets.length > 1 ? `Linked ${validTargets.length} layers to "${targetLayer.name}"` : `Linked "${sourceLayer.name}" to "${targetLayer.name}"`);
              }
            }
          } else if (!isReleasedOnSelf && dist >= 8) {
            // Dragged to empty space / outside layer slots / released on empty area: UNLINK!
            if (typeof window.unlinkLayer === 'function') {
              let unlinkedCount = 0;
              targetLayers.forEach(t => {
                if (t.parentId) {
                  window.unlinkLayer(t);
                  unlinkedCount++;
                }
              });
              if (unlinkedCount > 0 && typeof window.showEffectsRackToast === 'function') {
                window.showEffectsRackToast(targetLayers.length > 1 ? `Unlinked ${unlinkedCount} layers` : `Unlinked "${sourceLayer.name}"`);
              }
            }
          }
        }

        window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
        window.addEventListener('pointerup', onPointerUp, { capture: true });
        window.addEventListener('pointercancel', onPointerUp, { capture: true });
      });
    }

    function enhanceLaneHeads() {
      const slots = Array.from(overlayContainer.querySelectorAll('.timeline-lane-pill-slot'));
      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];

      slots.forEach((slot, slotIdx) => {
        const pill = slot.querySelector('.timeline-layer-ctrl-pill');
        if (!pill) return;

        const layerId = slot.dataset.layerId || pill.dataset.layerId;
        const layer = layers.find(l => String(l.id) === String(layerId)) || layers[slotIdx];

        const layerType = layer ? layer.type : 'video';
        const layerName = layer ? layer.name : (pill.title ? pill.title.split(' - ')[0] : 'Layer');

        // Keyframe Expansion Twistie Button
        let twistie = pill.querySelector('.desktop-layer-twistie-btn');
        if (!twistie) {
          twistie = document.createElement('button');
          twistie.type = 'button';
          twistie.className = `desktop-layer-twistie-btn ${layer && layer._kfExpanded ? 'is-expanded' : ''}`;
          twistie.title = layer && layer._kfExpanded ? 'Collapse Keyframes (U)' : 'Expand Keyframes (U)';
          twistie.setAttribute('aria-label', twistie.title);
          twistie.innerHTML = `<svg class="desktop-twistie-icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`;
          pill.prepend(twistie);

          twistie.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
          });
          twistie.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const currentLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
            const targetLayer = currentLayers.find(l => String(l.id) === String(layerId)) || layer;
            if (targetLayer) {
              targetLayer._kfExpanded = !targetLayer._kfExpanded;
              if (typeof window.renderTimelineLayers === 'function') {
                window.renderTimelineLayers();
              }
            }
          });
        } else {
          twistie.className = `desktop-layer-twistie-btn ${layer && layer._kfExpanded ? 'is-expanded' : ''}`;
          twistie.title = layer && layer._kfExpanded ? 'Collapse Keyframes (U)' : 'Expand Keyframes (U)';
        }

        // Clean up any stale layer-type-dot elements
        pill.querySelectorAll('.desktop-layer-type-dot').forEach(d => d.remove());

        // 1. Layer Index Number or Null Icon
        let idxEl = pill.querySelector('.desktop-layer-index, .desktop-layer-null-icon');
        const isNullType = layerType === 'null';
        if (isNullType) {
          if (!idxEl || !idxEl.classList.contains('desktop-layer-null-icon')) {
            if (idxEl) idxEl.remove();
            idxEl = document.createElement('span');
            idxEl.className = 'desktop-layer-null-icon';
            idxEl.title = 'Null Object (Drag to link)';
            idxEl.innerHTML = '<span class="svg-icon svg-icon-null" aria-hidden="true"></span>';
            const eyeBtn = pill.querySelector('.timeline-layer-eye-btn');
            if (eyeBtn && eyeBtn.nextSibling) {
              pill.insertBefore(idxEl, eyeBtn.nextSibling);
            } else {
              pill.appendChild(idxEl);
            }
          }
          initPickwhipDrag(idxEl, layerId);
        } else {
          if (!idxEl || !idxEl.classList.contains('desktop-layer-index')) {
            if (idxEl) idxEl.remove();
            idxEl = document.createElement('span');
            idxEl.className = 'desktop-layer-index';
            idxEl.textContent = String(slotIdx + 1);
            const eyeBtn = pill.querySelector('.timeline-layer-eye-btn');
            if (eyeBtn && eyeBtn.nextSibling) {
              pill.insertBefore(idxEl, eyeBtn.nextSibling);
            } else {
              pill.appendChild(idxEl);
            }
          } else {
            idxEl.textContent = String(slotIdx + 1);
          }
        }

        // 2. Layer Name Label
        let nameEl = pill.querySelector('.desktop-layer-name-text');
        if (!nameEl) {
          nameEl = document.createElement('span');
          nameEl.className = 'desktop-layer-name-text';
          nameEl.textContent = layerName;
          nameEl.title = layerName;
          pill.appendChild(nameEl);
        } else if (nameEl.textContent !== layerName) {
          nameEl.textContent = layerName;
          nameEl.title = layerName;
        }

        // 3. Motion Blur Toggle Switch Button
        let mblurBtn = pill.querySelector('.desktop-layer-mblur-btn');
        const isMbOn = !!(layer && layer.motionBlur);
        if (!mblurBtn) {
          mblurBtn = document.createElement('button');
          mblurBtn.type = 'button';
          mblurBtn.className = 'desktop-layer-mblur-btn' + (isMbOn ? ' is-active' : '');
          mblurBtn.title = isMbOn ? 'Motion Blur: Enabled' : 'Motion Blur: Disabled';
          mblurBtn.setAttribute('aria-label', mblurBtn.title);
          mblurBtn.innerHTML = '<span class="svg-icon svg-icon-motion-blur" aria-hidden="true"></span>';
          pill.appendChild(mblurBtn);

          mblurBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
          });
          mblurBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            const curLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
            const isMulti = window.selectedLayerIds && (window.selectedLayerIds.has(layerId) || window.selectedLayerIds.has(String(layerId))) && window.selectedLayerIds.size > 1;
            const targetIds = isMulti ? new Set(Array.from(window.selectedLayerIds).map(String)) : new Set([String(layerId)]);
            const target = curLayers.find(l => String(l.id) === String(layerId)) || layer;
            const nextState = target ? !target.motionBlur : true;

            curLayers.forEach(l => {
              if (targetIds.has(String(l.id))) {
                l.motionBlur = nextState;
                if (typeof window.invalidatePreviewCacheForLayer === 'function') {
                  window.invalidatePreviewCacheForLayer(l);
                }
              }
            });

            // Update all corresponding pill buttons in DOM
            targetIds.forEach(id => {
              const pillSlot = overlayContainer ? overlayContainer.querySelector(`.timeline-lane-pill-slot[data-layer-id="${id}"]`) : null;
              if (pillSlot) {
                const b = pillSlot.querySelector('.desktop-layer-mblur-btn');
                if (b) {
                  b.classList.toggle('is-active', nextState);
                  b.title = nextState ? 'Motion Blur: Enabled' : 'Motion Blur: Disabled';
                  b.setAttribute('aria-label', b.title);
                }
              }
            });

            const topHeaderMb = document.getElementById('btn-layer-header-motion-blur');
            if (topHeaderMb) topHeaderMb.classList.toggle('is-active', nextState);

            if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers(true);
            if (typeof window.redrawComposition === 'function') window.redrawComposition();
          });
        } else {
          mblurBtn.classList.toggle('is-active', isMbOn);
          mblurBtn.title = isMbOn ? 'Motion Blur: Enabled' : 'Motion Blur: Disabled';
        }

        // 4. Parent & Link Column (Pickwhip + Parent Badge)
        let parentCol = pill.querySelector('.desktop-layer-parent-col');
        if (!parentCol) {
          parentCol = document.createElement('div');
          parentCol.className = 'desktop-layer-parent-col';
          parentCol.innerHTML = `
            <button type="button" class="desktop-layer-pickwhip-btn" title="Parent Pickwhip (drag to layer to link)" aria-label="Parent Pickwhip">
              <span class="svg-icon svg-icon-pickwhip" aria-hidden="true"></span>
            </button>
            <button type="button" class="desktop-layer-parent-badge" title="Parent Layer" aria-label="Select Parent Layer">
              <span class="parent-label-text">None</span>
            </button>
          `;
          pill.appendChild(parentCol);

          const pickwhipBtn = parentCol.querySelector('.desktop-layer-pickwhip-btn');
          const parentBadge = parentCol.querySelector('.desktop-layer-parent-badge');

          initPickwhipDrag(pickwhipBtn, layerId);

          parentBadge.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
          });
          parentBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            if (window.selectedLayerId !== layerId) {
              window.selectedLayerId = layerId;
              if (window.selectedLayerIds) {
                window.selectedLayerIds.clear();
                window.selectedLayerIds.add(layerId);
              }
              const allSlots = document.querySelectorAll('.timeline-lane-pill-slot');
              allSlots.forEach(s => {
                const isSel = String(s.dataset.layerId) === String(layerId);
                s.classList.toggle('is-selected', isSel);
                const p = s.querySelector('.timeline-layer-ctrl-pill');
                if (p) p.classList.toggle('is-selected', isSel);
              });
              const allClips = document.querySelectorAll('.timeline-clip-block');
              allClips.forEach(c => {
                c.classList.toggle('is-selected', String(c.dataset.layerId) === String(layerId));
              });
              if (typeof window.syncInspectorState === 'function') {
                window.syncInspectorState();
              }
            }
            openDesktopParentDropdown(parentBadge, layerId);
          });
        }

        const parentBadge = parentCol.querySelector('.desktop-layer-parent-badge');
        const parentLabel = parentBadge && parentBadge.querySelector('.parent-label-text');
        if (parentLabel) {
          if (layer && layer.parentId) {
            const pLayer = layers.find(l => String(l.id) === String(layer.parentId));
            const pIdx = pLayer ? layers.indexOf(pLayer) : -1;
            const pText = pLayer ? `${pIdx + 1}. ${pLayer.name || 'Layer'}` : 'None';
            if (parentLabel.textContent !== pText) {
              parentLabel.textContent = pText;
            }
            if (!parentBadge.classList.contains('has-parent')) {
              parentBadge.classList.add('has-parent');
            }
            const newTitle = `Parent: ${pText} (Click to change)`;
            if (parentBadge.title !== newTitle) {
              parentBadge.title = newTitle;
            }
          } else {
            if (parentLabel.textContent !== 'None') {
              parentLabel.textContent = 'None';
            }
            if (parentBadge.classList.contains('has-parent')) {
              parentBadge.classList.remove('has-parent');
            }
            const newTitle = 'Parent: None (Click to assign)';
            if (parentBadge.title !== newTitle) {
              parentBadge.title = newTitle;
            }
          }
        }

        // Attach desktop drag reorder to pill if not attached
        if (!pill._desktopDragBound) {
          pill._desktopDragBound = true;

          let startX = 0;
          let startY = 0;
          let isDragging = false;
          let dragGhost = null;
          let fromIdx = -1;
          let targetDropIdx = -1;
          let movingIdSet = new Set();
          let movingLayers = [];
          let movingSlots = [];
          let movingLanes = [];

          let _layerDragRafPending = false;
          let _layerDragLastE = null;
          function onPointerMove(e) {
            const distY = e.clientY - startY;
            if (!isDragging && Math.abs(distY) > 4) {
              isDragging = true;
              pill.classList.add('is-dragging');

              const curLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
              const isMulti = window.selectedLayerIds && (window.selectedLayerIds.has(layerId) || window.selectedLayerIds.has(String(layerId))) && window.selectedLayerIds.size > 1;
              movingIdSet = isMulti ? new Set(Array.from(window.selectedLayerIds).map(String)) : new Set([String(layerId)]);
              movingLayers = curLayers.filter(l => movingIdSet.has(String(l.id)));
              const movingIndices = movingLayers.map(l => curLayers.findIndex(x => String(x.id) === String(l.id))).sort((a, b) => a - b);
              const movingCount = movingLayers.length;

              // Collect moving lanes and slots
              movingSlots = [];
              movingLanes = [];
              const track = document.getElementById('timeline-layers-track');
              movingIdSet.forEach(id => {
                const s = overlayContainer.querySelector(`.timeline-lane-pill-slot[data-layer-id="${id}"]`);
                const l = track ? track.querySelector(`.timeline-track-lane[data-layer-id="${id}"]`) : null;
                if (s) { s.classList.add('is-dragging'); movingSlots.push(s); }
                if (l) { l.classList.add('is-dragging'); movingLanes.push(l); }
              });

              dragGhost = document.createElement('div');
              dragGhost.className = 'desktop-drag-ghost-row';
              dragGhost.textContent = movingCount > 1 ? `${movingCount} layers` : layerName;
              document.body.appendChild(dragGhost);

              fromIdx = curLayers.findIndex(l => String(l.id) === String(layerId));
              if (fromIdx < 0) fromIdx = slotIdx;

              indicator.style.display = 'block';
            }

            if (isDragging && dragGhost) {
              // rAF-throttle: cap DOM reads/writes at display refresh rate
              _layerDragLastE = e;
              if (_layerDragRafPending) return;
              _layerDragRafPending = true;
              requestAnimationFrame(() => {
                _layerDragRafPending = false;
                const ev = _layerDragLastE;
                if (!ev || !isDragging || !dragGhost) return;

                dragGhost.style.left = (ev.clientX + 10) + 'px';
                dragGhost.style.top = (ev.clientY - 17) + 'px';

                const curSlots = Array.from(overlayContainer.querySelectorAll('.timeline-lane-pill-slot'));
                const track = document.getElementById('timeline-layers-track');
                const curLanes = track ? Array.from(track.querySelectorAll('.timeline-track-lane')) : [];
                const curLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
                let dropIdx = curSlots.length;

                for (let i = 0; i < curSlots.length; i++) {
                  const rect = curSlots[i].getBoundingClientRect();
                  const mid = rect.top + rect.height / 2;
                  if (ev.clientY < mid) {
                    dropIdx = i;
                    break;
                  }
                }

                targetDropIdx = dropIdx;

                const vpRect = layersViewport.getBoundingClientRect();
                if (dropIdx < curSlots.length) {
                  const targetSlotRect = curSlots[dropIdx].getBoundingClientRect();
                  indicator.style.top = (targetSlotRect.top - vpRect.top + layersViewport.scrollTop) + 'px';
                } else if (curSlots.length > 0) {
                  const lastSlotRect = curSlots[curSlots.length - 1].getBoundingClientRect();
                  indicator.style.top = (lastSlotRect.bottom - vpRect.top + layersViewport.scrollTop) + 'px';
                }

                // 1. Live translate all moving slots & lanes smoothly with pointer
                const pitch = 34;
                const deltaY = ev.clientY - startY;
                const movingIndices = movingLayers.map(l => curLayers.findIndex(x => String(x.id) === String(l.id))).sort((a, b) => a - b);
                const movingCount = movingLayers.length;
                const minMovingIdx = movingIndices.length > 0 ? movingIndices[0] : fromIdx;
                const maxMovingIdx = movingIndices.length > 0 ? movingIndices[movingIndices.length - 1] : fromIdx;
                const minDeltaY = -minMovingIdx * pitch;
                const maxDeltaY = (curLayers.length - 1 - maxMovingIdx) * pitch;
                const clampedDeltaY = Math.max(minDeltaY - 10, Math.min(maxDeltaY + 10, deltaY));

                movingSlots.forEach(s => s.style.transform = `translateY(${clampedDeltaY}px)`);
                movingLanes.forEach(l => l.style.transform = `translateY(${clampedDeltaY}px)`);

                // 2. Live smooth shift on all non-moving slots & lanes to open a gap
                const remainingLayers = curLayers.filter(l => !movingIdSet.has(String(l.id)));
                let insertIdx = remainingLayers.length;
                for (let j = dropIdx; j < curLayers.length; j++) {
                  if (!movingIdSet.has(String(curLayers[j].id))) {
                    const rIdx = remainingLayers.indexOf(curLayers[j]);
                    if (rIdx !== -1) {
                      insertIdx = rIdx;
                      break;
                    }
                  }
                }

                curSlots.forEach((slot, i) => {
                  const sLayer = curLayers[i];
                  if (!sLayer || movingIdSet.has(String(sLayer.id))) return;
                  const movingAbove = movingIndices.filter(mIdx => mIdx < i).length;
                  const remIdx = i - movingAbove;
                  const shiftRows = (remIdx < insertIdx) ? -movingAbove : (movingCount - movingAbove);
                  const shiftPx = shiftRows * pitch;
                  slot.style.transform = shiftPx ? `translateY(${shiftPx}px)` : '';
                  if (curLanes[i]) curLanes[i].style.transform = shiftPx ? `translateY(${shiftPx}px)` : '';
                });
              });
            }
          }

          function onPointerUp(e) {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);

            try { pill.releasePointerCapture(e.pointerId); } catch (_) {}

            pill.classList.remove('is-dragging');
            indicator.style.display = 'none';

            if (dragGhost) {
              dragGhost.remove();
              dragGhost = null;
            }

            // Remove dragging class and clear transforms on moving elements
            movingSlots.forEach(s => {
              s.classList.remove('is-dragging');
              s.style.transform = '';
            });
            movingLanes.forEach(l => {
              l.classList.remove('is-dragging');
              l.style.transform = '';
            });

            // Clear shifts on all slots and lanes
            const allCurSlots = overlayContainer ? Array.from(overlayContainer.querySelectorAll('.timeline-lane-pill-slot')) : [];
            const track = document.getElementById('timeline-layers-track');
            const allCurLanes = track ? Array.from(track.querySelectorAll('.timeline-track-lane')) : [];
            allCurSlots.forEach(s => s.style.transform = '');
            allCurLanes.forEach(l => l.style.transform = '');

            if (isDragging) {
              isDragging = false;
              e.stopPropagation();
              e.preventDefault();

              if (window.currentProjectState && Array.isArray(window.currentProjectState.layers) && targetDropIdx >= 0) {
                const curLayers = window.currentProjectState.layers;
                const reordered = (typeof window.reorderLayersBatch === 'function')
                  ? window.reorderLayersBatch(curLayers, movingIdSet, targetDropIdx)
                  : curLayers;

                const changed = reordered.some((l, idx) => String(l.id) !== String(curLayers[idx].id));
                if (changed) {
                  // FLIP Step 1: Record FIRST positions
                  const firstTops = new Map();
                  if (track) {
                    track.querySelectorAll('.timeline-track-lane').forEach(lane => {
                      if (lane.dataset.layerId) firstTops.set(lane.dataset.layerId, lane.getBoundingClientRect().top);
                    });
                  }
                  if (overlayContainer) {
                    overlayContainer.querySelectorAll('.timeline-lane-pill-slot').forEach(slot => {
                      const sId = slot.dataset.layerId || (slot.querySelector('.timeline-layer-ctrl-pill') && slot.querySelector('.timeline-layer-ctrl-pill').dataset.layerId);
                      if (sId) firstTops.set('slot_' + sId, slot.getBoundingClientRect().top);
                    });
                  }

                  window.currentProjectState.layers = reordered;
                  movingLayers.forEach(moved => {
                    if (typeof window.invalidatePreviewCacheForLayer === 'function') {
                      window.invalidatePreviewCacheForLayer(moved);
                    }
                  });
                  if (typeof window.saveCurrentProjectLayers === 'function') {
                    window.saveCurrentProjectLayers();
                  }
                  if (typeof window.renderTimelineLayers === 'function') {
                    window.renderTimelineLayers();
                  }
                  if (typeof window.redrawComposition === 'function') {
                    window.redrawComposition();
                  }

                  // Restore multi-selection
                  if (movingIdSet.size > 1) {
                    window.selectedLayerIds = new Set(movingIdSet);
                    window.selectedLayerId = movingLayers[movingLayers.length - 1].id;
                  } else {
                    window.selectedLayerIds = new Set([layerId]);
                    window.selectedLayerId = layerId;
                  }
                  if (typeof window.updateTimelineLayerSelectionState === 'function') {
                    window.updateTimelineLayerSelectionState();
                  }

                  // FLIP Step 2 & 3: INVERT & PLAY smooth animation
                  requestAnimationFrame(() => {
                    const newLanes = track ? Array.from(track.querySelectorAll('.timeline-track-lane')) : [];
                    const newSlots = overlayContainer ? Array.from(overlayContainer.querySelectorAll('.timeline-lane-pill-slot')) : [];
                    const animatedEls = [];

                    [...newLanes, ...newSlots].forEach(el => {
                      const isSlot = el.classList.contains('timeline-lane-pill-slot');
                      const sId = el.dataset.layerId || (el.querySelector('.timeline-layer-ctrl-pill') && el.querySelector('.timeline-layer-ctrl-pill').dataset.layerId);
                      const key = isSlot ? ('slot_' + (sId || '')) : (el.dataset.layerId || '');
                      const oldTop = firstTops.get(key);
                      if (oldTop !== undefined) {
                        const deltaY = oldTop - el.getBoundingClientRect().top;
                        if (Math.abs(deltaY) > 0.5) {
                          el.style.transform = `translateY(${deltaY}px)`;
                          el.style.transition = 'none';
                          animatedEls.push(el);
                        }
                      }
                    });

                    requestAnimationFrame(() => {
                      animatedEls.forEach(el => {
                        el.style.transition = 'transform 0.22s cubic-bezier(0.2, 0, 0, 1)';
                        el.style.transform = '';
                      });
                    });
                  });
                }
              }
            } else {
              // Click / Tap on layer row without vertical reorder: Desktop AE Selection!
              e.stopPropagation();
              e.preventDefault();

              const currentLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
              const targetId = layerId;

              if (e.shiftKey) {
                // Shift-click: Range select
                const anchorId = window.lastSelectedLayerId || window.selectedLayerId || targetId;
                const idx1 = currentLayers.findIndex(l => l.id === anchorId);
                const idx2 = currentLayers.findIndex(l => l.id === targetId);
                const newSet = new Set(window.selectedLayerIds || []);
                if (idx1 !== -1 && idx2 !== -1) {
                  const minI = Math.min(idx1, idx2);
                  const maxI = Math.max(idx1, idx2);
                  for (let i = minI; i <= maxI; i++) {
                    newSet.add(currentLayers[i].id);
                  }
                } else {
                  newSet.add(targetId);
                }
                setDesktopSelectedLayers(newSet, targetId);
              } else if (e.ctrlKey || e.metaKey) {
                // Ctrl / Cmd-click: Toggle select
                const newSet = new Set(window.selectedLayerIds || []);
                if (newSet.has(targetId)) {
                  newSet.delete(targetId);
                  const nextActive = newSet.size > 0 ? Array.from(newSet)[newSet.size - 1] : null;
                  setDesktopSelectedLayers(newSet, nextActive);
                } else {
                  newSet.add(targetId);
                  setDesktopSelectedLayers(newSet, targetId);
                }
              } else {
                // Plain click: Single select
                setDesktopSelectedLayers(new Set([targetId]), targetId);
              }
            }
          }

          pill.addEventListener('pointerdown', (e) => {
            if (
              e.target.closest('.timeline-layer-eye-btn') ||
              e.target.closest('.desktop-layer-twistie-btn') ||
              e.target.closest('.desktop-layer-mblur-btn') ||
              e.target.closest('.desktop-layer-parent-col') ||
              e.target.closest('.desktop-layer-pickwhip-btn') ||
              e.target.closest('.desktop-layer-parent-badge') ||
              e.target.closest('.desktop-layer-null-icon')
            ) {
              return;
            }
            // Stop editor.js mobile hold timer from starting!
            e.stopImmediatePropagation();

            if (e.button !== undefined && e.button !== 0) return;
            startY = e.clientY;
            startX = e.clientX;
            isDragging = false;
            try { pill.setPointerCapture(e.pointerId); } catch (_) {}
            window.addEventListener('pointermove', onPointerMove, { passive: false });
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
          }, true);
        }
      });
    }

    let _enhanceRaf = null;
    let _isEnhancing = false;
    const observer = new MutationObserver(() => {
      if (_isEnhancing) return;
      if (window.isTimelinePlaying) return;
      if (_enhanceRaf) return;
      _enhanceRaf = requestAnimationFrame(() => {
        _enhanceRaf = null;
        if (window.isTimelinePlaying) return;
        _isEnhancing = true;
        try {
          enhanceLaneHeads();
        } finally {
          _isEnhancing = false;
        }
      });
    });
    observer.observe(overlayContainer, { childList: true, subtree: false });


    window.enhanceLaneHeads = enhanceLaneHeads;
    enhanceLaneHeads();
  }

  // Live panel width with cached layout read to eliminate style thrashing during playback
  let _cachedDesktopPanelW = 240;
  function updateCachedDesktopPanelW() {
    const rootVal = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--desktop-layer-panel-w'));
    if (!isNaN(rootVal) && rootVal > 0) {
      _cachedDesktopPanelW = rootVal;
      return;
    }
    const gutter = document.querySelector('.desktop-ruler-gutter');
    if (gutter && gutter.offsetWidth > 0) {
      _cachedDesktopPanelW = gutter.offsetWidth;
      return;
    }
    _cachedDesktopPanelW = 240;
  }
  function getDesktopPanelW() {
    return _cachedDesktopPanelW;
  }
  window.getDesktopPanelW = getDesktopPanelW;
  window.updateCachedDesktopPanelW = updateCachedDesktopPanelW;

  // --- 7. AE-Style Left-Anchored Timeline Engine ---
  let isLeftTimelineInited = false;
  function patchDesktopLeftTimeline() {
    if (isLeftTimelineInited) return;
    const rulerTrack = document.getElementById('timeline-ruler-track');
    const layersTrack = document.getElementById('timeline-layers-track');
    const rulerViewport = document.getElementById('timeline-ruler-viewport');
    const layersViewport = document.getElementById('timeline-layers-viewport');
    const needle = document.getElementById('timeline-center-needle');
    if (!rulerTrack || !layersTrack || !needle) return;
    isLeftTimelineInited = true;

    let desktopScrollX = 0;

    // Cache ruler viewport width to eliminate forced synchronous layout (layout thrashing) per frame
    let _cachedViewW = rulerViewport ? rulerViewport.clientWidth : 800;
    updateCachedDesktopPanelW();
    window.addEventListener('resize', () => {
      if (rulerViewport) _cachedViewW = rulerViewport.clientWidth;
      updateCachedDesktopPanelW();
      syncDesktopPlayhead();
    }, { passive: true });

    let _lastSyncSec = -1;
    let _lastSyncScrollX = -1;
    let _lastSyncPanelW = -1;
    function syncDesktopPlayhead(force = false) {
      const curSec = (typeof window.getCurrentPlayheadTime === 'function')
        ? window.getCurrentPlayheadTime()
        : (window.currentPlaybackSec !== undefined ? window.currentPlaybackSec : (window.currentSec || 0));
      const pps = window.currentPixelsPerSecond || 80;
      const playheadX = curSec * pps;

      // Auto-follow playhead during playback using cached viewport width (zero layout reads)
      if (_cachedViewW > 0) {
        if (playheadX - desktopScrollX > _cachedViewW - 30) {
          desktopScrollX = Math.max(0, playheadX - 60);
        } else if (playheadX < desktopScrollX) {
          desktopScrollX = Math.max(0, playheadX - 30);
        }
      }

      const panelW = getDesktopPanelW();
      const panelChanged = (panelW !== _lastSyncPanelW);
      const scrollChanged = (desktopScrollX !== _lastSyncScrollX);
      const playheadChanged = (Math.abs(curSec - _lastSyncSec) >= 0.0001);

      if (!force && !scrollChanged && !playheadChanged && !panelChanged) return;
      _lastSyncSec = curSec;
      _lastSyncScrollX = desktopScrollX;
      _lastSyncPanelW = panelW;

      // 1. Direct GPU transform on playhead needle (ZERO :root recalc, ZERO full-page style thrashing)
      needle.style.transform = `translate3d(${(panelW + playheadX - desktopScrollX).toFixed(2)}px, 0, 0)`;

      // 2. Only update track transforms when horizontal scroll actually changed
      if (scrollChanged || force) {
        const scrollTransform = `translate3d(${(-desktopScrollX).toFixed(2)}px, 0, 0)`;
        layersTrack.style.transform = scrollTransform;
        rulerTrack.style.transform = scrollTransform;
      }
    }
    window.syncDesktopPlayhead = syncDesktopPlayhead;
    window.getDesktopScrollX = function() {
      return desktopScrollX;
    };

    // Dedicated AE-style playhead position is driven synchronously by updateTimelinePosition
    // in editor.js. Standalone loopDesktopPlayback rAF is eliminated to prevent double rAF jitter.

    const originalUpdatePos = window.updateTimelinePosition;
    if (typeof originalUpdatePos === 'function' && !window._desktopUpdatePosPatched) {
      window._desktopUpdatePosPatched = true;
      window.updateTimelinePosition = function(newPanX, immediate) {
        originalUpdatePos(newPanX, immediate);
        if (!immediate) {
          syncDesktopPlayhead();
        }
      };
    }

    // Initial position sync
    syncDesktopPlayhead();

    function handleRulerSeek(clientX) {
      if (!rulerViewport) return;
      const rect = rulerViewport.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const pps = window.currentPixelsPerSecond || 80;
      let targetSec = Math.max(0, (clickX + desktopScrollX) / pps);

      // Magnet snap to beatmarks when enabled
      if (window.isTimelineSnapEnabled !== false) {
        const beatmarks = (window.currentProjectState && window.currentProjectState.beatmarks) || [];
        for (let i = 0; i < beatmarks.length; i++) {
          const bm = beatmarks[i];
          if (Math.abs(targetSec - bm) * pps <= 8) {
            targetSec = bm;
            break;
          }
        }
      }

      const targetPanX = -targetSec * pps;
      if (typeof window.updateTimelinePosition === 'function') {
        window.updateTimelinePosition(targetPanX, true);
      }
      syncDesktopPlayhead();
    }
    window.handleDesktopRulerSeek = handleRulerSeek;

    if (rulerViewport) {
      let isRulerSeeking = false;

      rulerViewport.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        isRulerSeeking = true;
        try { rulerViewport.setPointerCapture(e.pointerId); } catch (_) {}
        handleRulerSeek(e.clientX);
        e.stopPropagation();
      }, true);

      rulerViewport.addEventListener('pointermove', (e) => {
        if (!isRulerSeeking) return;
        handleRulerSeek(e.clientX);
        e.stopPropagation();
      }, true);

      function stopRulerSeek(e) {
        if (!isRulerSeeking) return;
        isRulerSeeking = false;
        try { rulerViewport.releasePointerCapture(e.pointerId); } catch (_) {}
        e.stopPropagation();
      }

      rulerViewport.addEventListener('pointerup', stopRulerSeek, true);
      rulerViewport.addEventListener('pointercancel', stopRulerSeek, true);

      const handleWheelScroll = (e) => {
        if (e.ctrlKey) return;
        const dx = e.deltaX !== 0 ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
        if (dx !== 0) {
          e.preventDefault();
          e.stopPropagation();
          const pps = window.currentPixelsPerSecond || 80;
          const durSec = (window.currentProjectState && window.currentProjectState.duration) || 30;
          const totalContentW = durSec * pps;
          const viewW = rulerViewport ? rulerViewport.clientWidth : 800;
          const maxScrollX = Math.max(0, totalContentW - viewW + 160);
          desktopScrollX = Math.max(0, Math.min(maxScrollX, desktopScrollX + dx));
          syncDesktopPlayhead();
        }
      };

      rulerViewport.addEventListener('wheel', handleWheelScroll, { passive: false, capture: true });

      if (layersViewport) {
        layersViewport.addEventListener('wheel', (e) => {
          if (e.ctrlKey) return;

          // 1. Horizontal trackpad scroll or Shift+Wheel: AE horizontal timeline panning
          if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            handleWheelScroll(e);
            return;
          }

          // 2. Vertical Wheel: Strictly bounded to track content (NEVER penetrate down or disappear)
          const maxScrollY = Math.max(0, layersTrack.scrollHeight - layersViewport.clientHeight);
          if (maxScrollY <= 0) {
            // All layers fit in viewport: strictly lock vertical scroll at 0 (zero penetration)
            e.preventDefault();
            if (layersViewport.scrollTop !== 0) layersViewport.scrollTop = 0;
            return;
          }

          const targetTop = layersViewport.scrollTop + e.deltaY;
          if (targetTop <= 0 || targetTop >= maxScrollY) {
            e.preventDefault();
            layersViewport.scrollTop = Math.max(0, Math.min(maxScrollY, targetTop));
          }
        }, { passive: false, capture: true });

        layersViewport.addEventListener('scroll', () => {
          const maxScrollY = Math.max(0, layersTrack.scrollHeight - layersViewport.clientHeight);
          if (layersViewport.scrollTop > maxScrollY) {
            layersViewport.scrollTop = maxScrollY;
          }
          if (layersViewport.scrollLeft !== 0) {
            layersViewport.scrollLeft = 0;
          }
        }, { passive: false });
      }
    }

    let isNeedleDragging = false;
    needle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      isNeedleDragging = true;
      try { needle.setPointerCapture(e.pointerId); } catch (_) {}
      e.stopPropagation();
    });

    needle.addEventListener('pointermove', (e) => {
      if (!isNeedleDragging) return;
      handleRulerSeek(e.clientX);
      e.stopPropagation();
    });

    function stopNeedleDrag(e) {
      if (!isNeedleDragging) return;
      isNeedleDragging = false;
      try { needle.releasePointerCapture(e.pointerId); } catch (_) {}
      e.stopPropagation();
    }

    needle.addEventListener('pointerup', stopNeedleDrag);
    needle.addEventListener('pointercancel', stopNeedleDrag);

    initDesktopTimelineResizers();
  }

  // --- AE-Style Column & Panel Resizing Engine ---
  let isResizersInited = false;
  function initDesktopTimelineResizers() {
    const panelResizer = document.getElementById('desktop-timeline-panel-resizer');
    const gutter = document.querySelector('.desktop-ruler-gutter');
    if (!panelResizer && !gutter) return;
    if (isResizersInited) return;
    isResizersInited = true;

    // 1. Restore saved preferences from localStorage
    try {
      const savedPanelW = localStorage.getItem('oft_desktop_layer_panel_w');
      if (savedPanelW) {
        const val = parseFloat(savedPanelW);
        if (!isNaN(val) && val >= 160) {
          document.documentElement.style.setProperty('--desktop-layer-panel-w', `${val}px`);
          _cachedDesktopPanelW = val;
        }
      }
      const savedParentW = localStorage.getItem('oft_desktop_parent_col_w');
      if (savedParentW) {
        const val = parseFloat(savedParentW);
        if (!isNaN(val) && val >= 50) {
          document.documentElement.style.setProperty('--desktop-parent-col-w', `${val}px`);
        }
      }
    } catch (_) {}

    // Helper to resize the overall left Layer Panel width (Left Panel vs Right Timeline Tracks)
    function startLayerPanelResize(startEvent) {
      if (startEvent.button !== undefined && startEvent.button !== 0) return;
      const startX = startEvent.clientX;
      const startW = getDesktopPanelW();
      const pResizer = document.getElementById('desktop-timeline-panel-resizer');
      if (pResizer) pResizer.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      startEvent.preventDefault();
      startEvent.stopPropagation();
      startEvent.stopImmediatePropagation();

      function onPointerMove(e) {
        e.preventDefault();
        const delta = e.clientX - startX;
        const timelineWrapper = document.querySelector('.desktop-timeline-wrapper');
        const maxW = timelineWrapper ? Math.max(300, timelineWrapper.clientWidth - 180) : 700;
        const newW = Math.max(160, Math.min(maxW, Math.round(startW + delta)));

        document.documentElement.style.setProperty('--desktop-layer-panel-w', `${newW}px`);
        _cachedDesktopPanelW = newW;
        try { localStorage.setItem('oft_desktop_layer_panel_w', newW); } catch (_) {}

        if (typeof window.syncDesktopPlayhead === 'function') {
          window.syncDesktopPlayhead();
        }
      }

      function onPointerUp() {
        if (pResizer) pResizer.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);

        _cachedDesktopPanelW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--desktop-layer-panel-w')) || startW;
        if (typeof window.syncDesktopPlayhead === 'function') {
          window.syncDesktopPlayhead();
        }
      }

      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerUp, true);
    }

    // 2. Full-height Layer Panel Resizer Handle (Between Left Panel and Timeline Tracks)
    if (panelResizer) {
      panelResizer.addEventListener('pointerdown', startLayerPanelResize);
    }

    // 3. Ruler Gutter Column Resizers (Layer Name, Parent & Link, and Gutter Panel Border)
    if (gutter) {
      const colResizers = gutter.querySelectorAll('.desktop-ruler-col-resizer');
      colResizers.forEach(resizer => {
        const type = resizer.dataset.resizer;
        if (type === 'panel') {
          // Boundary to the right of Parent & Link: resizes the overall layer panel width
          resizer.addEventListener('pointerdown', (e) => {
            resizer.classList.add('is-dragging');
            startLayerPanelResize(e);
            window.addEventListener('pointerup', () => resizer.classList.remove('is-dragging'), { once: true });
          });
        } else if (type === 'name') {
          // Dragging Layer Name resizer to the right expands the panel width directly so it never gets stuck ("ga mentok")
          resizer.addEventListener('pointerdown', (e) => {
            resizer.classList.add('is-dragging');
            startLayerPanelResize(e);
            window.addEventListener('pointerup', () => resizer.classList.remove('is-dragging'), { once: true });
          });
        } else if (type === 'parent') {
          // Resizing Parent & Link column width
          resizer.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            const startX = e.clientX;
            const startParentW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--desktop-parent-col-w')) || 76;
            resizer.classList.add('is-dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            function onColMove(moveEvent) {
              moveEvent.preventDefault();
              const delta = moveEvent.clientX - startX;
              const newParentW = Math.max(50, Math.min(220, Math.round(startParentW - delta)));
              document.documentElement.style.setProperty('--desktop-parent-col-w', `${newParentW}px`);
              try { localStorage.setItem('oft_desktop_parent_col_w', newParentW); } catch (_) {}
            }

            function onColUp() {
              resizer.classList.remove('is-dragging');
              document.body.style.cursor = '';
              document.body.style.userSelect = '';
              window.removeEventListener('pointermove', onColMove, true);
              window.removeEventListener('pointerup', onColUp, true);
              window.removeEventListener('pointercancel', onColUp, true);
            }

            window.addEventListener('pointermove', onColMove, true);
            window.addEventListener('pointerup', onColUp, true);
            window.addEventListener('pointercancel', onColUp, true);
          });
        }
      });
    }
  }

  // --- 8. Desktop AE-Style Clip Drag & Move Engine ---
  let isClipDragInited = false;
  function initDesktopClipDragEngine() {
    if (isClipDragInited) return;
    const layersViewport = document.getElementById('timeline-layers-viewport');
    if (!layersViewport) return;
    isClipDragInited = true;

    layersViewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      if (window.Popover && typeof window.Popover.close === 'function') {
        const activePop = document.querySelector('.popover-card.is-open');
        if (activePop && !activePop.contains(e.target)) {
          window.Popover.close();
        }
      }

      const clipEl = e.target.closest('.timeline-clip-block');
      if (!clipEl) return;

      // DO NOT intercept trim handles or keyframe markers
      if (
        e.target.closest('.timeline-clip-handle') ||
        e.target.closest('.timeline-keyframe-marker') ||
        e.target.closest('.desktop-kf-diamond') ||
        e.target.closest('.text-anim-marker')
      ) {
        return;
      }

      // CRITICAL: Stop editor.js onClipPointerDown so it NEVER triggers mobile timeline panning!
      e.stopImmediatePropagation();

      const layerId = clipEl.dataset.layerId;
      const currentLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const primaryLayer = currentLayers.find(l => l.id === layerId);
      if (!primaryLayer) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      let isDragging = false;

      // Determine moving layers: if clicked layer is already part of multi-selection, move all together
      const isSelected = (window.selectedLayerIds && window.selectedLayerIds.has(layerId)) || (window.selectedLayerId === layerId);
      let movingLayers = [];

      if (isSelected && window.selectedLayerIds && window.selectedLayerIds.size > 1) {
        movingLayers = currentLayers.filter(l => window.selectedLayerIds.has(l.id));
      } else {
        movingLayers = [primaryLayer];
      }

      const pps = window.currentPixelsPerSecond || 80;

      // Record initial state for each moving layer
      const layerSnapshots = movingLayers.map(l => {
        const initPx = l.startPx || 0;
        const initSec = l.startSec !== undefined ? l.startSec : (initPx / pps);
        const durSec = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pps);
        const el = document.querySelector(`.timeline-clip-block[data-layer-id="${l.id}"]`);
        return {
          layer: l,
          clipEl: el,
          initialStartPx: initPx,
          initialStartSec: initSec,
          durationSec: durSec,
          initialKeyframes: l.keyframes ? JSON.parse(JSON.stringify(l.keyframes)) : null
        };
      });

      let _clipDragRafPending = false;
      let _clipDragLastEvent = null;
      let _clipDragLastDx = 0;
      function onPointerMove(moveEvent) {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const dist = Math.hypot(dx, dy);

        if (!isDragging && dist > 3) {
          isDragging = true;
          window.isTransformInteracting = true;
          try { clipEl.setPointerCapture(pointerId); } catch (_) {}
          layerSnapshots.forEach(s => {
            if (s.clipEl) {
              s.clipEl.classList.add('is-sliding');
            }
          });
        }

        if (isDragging) {
          moveEvent.preventDefault();
          // rAF-throttle: snap calculation + style writes capped at display refresh rate
          _clipDragLastDx = dx;
          _clipDragLastEvent = moveEvent;
          if (_clipDragRafPending) return;
          _clipDragRafPending = true;
          requestAnimationFrame(() => {
            _clipDragRafPending = false;
            if (!isDragging) return;
            const curDx = _clipDragLastDx;

            // Calculate proposed delta
            const minInitialPx = Math.min(...layerSnapshots.map(s => s.initialStartPx));
            const clampedDeltaX = Math.max(-minInitialPx, curDx);

            const primarySnapshot = layerSnapshots.find(s => s.layer.id === primaryLayer.id);
            const primaryInitPx = primarySnapshot ? primarySnapshot.initialStartPx : 0;
            let targetPrimaryPx = Math.max(0, primaryInitPx + clampedDeltaX);
            const primaryDurPx = primaryLayer.widthPx || Math.round((primaryLayer.durationSec || 5) * pps);
            const primaryEndPx = targetPrimaryPx + primaryDurPx;

            // Snapping
            let finalDeltaPx = clampedDeltaX;
            if (typeof window.getTimelineSnapTargets === 'function' && typeof window.findTimelineSnap === 'function') {
              const movingIds = new Set(movingLayers.map(l => l.id));
              const snapTargets = window.getTimelineSnapTargets(primaryLayer.id, true).filter(st => !movingIds.has(st.layerId));

              const startSnap = window.findTimelineSnap(targetPrimaryPx, snapTargets, 10);
              const endSnap = window.findTimelineSnap(primaryEndPx, snapTargets, 10);

              let activeSnap = null;
              if (startSnap && endSnap) {
                activeSnap = Math.abs(targetPrimaryPx - startSnap.px) <= Math.abs(primaryEndPx - endSnap.px)
                  ? { ...startSnap, snapEnd: false }
                  : { ...endSnap, snapEnd: true };
              } else if (startSnap) {
                activeSnap = { ...startSnap, snapEnd: false };
              } else if (endSnap) {
                activeSnap = { ...endSnap, snapEnd: true };
              }

              if (activeSnap) {
                const snapPos = activeSnap.snapEnd ? (activeSnap.px - primaryDurPx) : activeSnap.px;
                targetPrimaryPx = Math.max(0, snapPos);
                finalDeltaPx = targetPrimaryPx - primaryInitPx;
                if (typeof window.showTimelineSnapGuide === 'function') {
                  window.showTimelineSnapGuide(activeSnap.px);
                }
              } else {
                if (typeof window.hideTimelineSnapGuide === 'function') {
                  window.hideTimelineSnapGuide();
                }
              }
            }

            // Live visual update on all moving clip elements
            layerSnapshots.forEach(s => {
              const newPx = Math.max(0, Math.round(s.initialStartPx + finalDeltaPx));
              s.layer.startPx = newPx;
              s.layer.startSec = newPx / pps;
              if (s.clipEl) {
                s.clipEl.style.left = `${newPx}px`;
              }
            });
          });
        }
      }

      function onPointerUp(upEvent) {
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);

        try { clipEl.releasePointerCapture(pointerId); } catch (_) {}

        if (typeof window.hideTimelineSnapGuide === 'function') {
          window.hideTimelineSnapGuide();
        }

        if (isDragging) {
          isDragging = false;
          window.isTransformInteracting = false;

          layerSnapshots.forEach(s => {
            if (s.clipEl) s.clipEl.classList.remove('is-sliding');
          });

          // Quantize to frame rate
          const fps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
          layerSnapshots.forEach(s => {
            s.layer.startSec = Math.round(s.layer.startSec * fps) / fps;
            s.layer.startPx = Math.round(s.layer.startSec * pps);

            // Shift keyframes if any
            if (s.initialKeyframes && s.layer.keyframes) {
              const deltaSec = s.layer.startSec - s.initialStartSec;
              for (const [prop, kfs] of Object.entries(s.initialKeyframes)) {
                if (Array.isArray(kfs) && Array.isArray(s.layer.keyframes[prop])) {
                  kfs.forEach((initKf, idx) => {
                    const curKf = s.layer.keyframes[prop][idx];
                    if (curKf) {
                      curKf.time = Number(Math.max(0, initKf.time + deltaSec).toFixed(4));
                    }
                  });
                }
              }
            }

            if (typeof window.invalidatePreviewCacheForLayer === 'function') {
              window.invalidatePreviewCacheForLayer(s.layer);
            }
          });

          // Select primary layer if it wasn't selected
          if (!isSelected) {
            window.selectedLayerId = primaryLayer.id;
            window.selectedLayerIds = new Set([primaryLayer.id]);
            window.isSelectorMode = false;
          }

          if (typeof window.renderTimelineLayers === 'function') {
            window.renderTimelineLayers();
          }
          if (typeof window.redrawComposition === 'function') {
            window.redrawComposition();
          }
          if (typeof window.saveCurrentProjectLayers === 'function') {
            window.saveCurrentProjectLayers();
          }
          if (typeof window.updateTimelineDuration === 'function') {
            window.updateTimelineDuration(true);
          }
          syncInspectorState();
        } else {
          // Click/tap without drag: Desktop AE selection!
          if (upEvent.shiftKey) {
            const anchorId = window.lastSelectedLayerId || window.selectedLayerId || layerId;
            const idx1 = currentLayers.findIndex(l => l.id === anchorId);
            const idx2 = currentLayers.findIndex(l => l.id === layerId);
            if (idx1 !== -1 && idx2 !== -1) {
              const minI = Math.min(idx1, idx2);
              const maxI = Math.max(idx1, idx2);
              const newSet = new Set(window.selectedLayerIds || []);
              for (let i = minI; i <= maxI; i++) newSet.add(currentLayers[i].id);
              window.selectedLayerIds = newSet;
              window.selectedLayerId = layerId;
            } else {
              window.selectedLayerIds = new Set([layerId]);
              window.selectedLayerId = layerId;
            }
          } else if (upEvent.ctrlKey || upEvent.metaKey) {
            if (!window.selectedLayerIds) window.selectedLayerIds = new Set();
            if (window.selectedLayerIds.has(layerId)) {
              window.selectedLayerIds.delete(layerId);
              window.selectedLayerId = window.selectedLayerIds.size > 0 ? Array.from(window.selectedLayerIds)[window.selectedLayerIds.size - 1] : null;
            } else {
              window.selectedLayerIds.add(layerId);
              window.selectedLayerId = layerId;
            }
          } else {
            // Single select
            if (typeof window.selectTimelineLayer === 'function') {
              window.selectTimelineLayer(layerId, false);
            } else {
              window.selectedLayerIds = new Set([layerId]);
              window.selectedLayerId = layerId;
            }
            window.lastSelectedLayerId = layerId;
          }

          const selCount = (window.selectedLayerIds && window.selectedLayerIds.size) || (window.selectedLayerId ? 1 : 0);
          window.isSelectorMode = (selCount > 1);

          if (typeof window.syncSelectionClassesInPlace === 'function') {
            window.syncSelectionClassesInPlace();
          }
          if (typeof window.updateEditorHeaderMode === 'function') {
            window.updateEditorHeaderMode();
          }
          syncInspectorState();
          if (typeof window.redrawComposition === 'function') {
            window.redrawComposition();
          }
        }
      }

      window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
      window.addEventListener('pointerup', onPointerUp, { capture: true });
      window.addEventListener('pointercancel', onPointerUp, { capture: true });
    }, true);

    layersViewport.addEventListener('dblclick', (e) => {
      const clipEl = e.target.closest('.timeline-clip-block');
      if (!clipEl) return;
      const layerId = clipEl.dataset.layerId;
      const currentLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const layer = currentLayers.find(l => l.id === layerId);
      if (layer && layer.type === 'precomp' && typeof window.enterPrecompose === 'function') {
        e.stopPropagation();
        e.preventDefault();
        window.enterPrecompose(layerId);
      }
    }, true);
  }

  // --- 9. Desktop Marquee Selection Engine (Drag empty space to multi-select with AE Auto-Scroll) ---
  let isMarqueeInited = false;
  function initDesktopMarqueeSelection() {
    if (isMarqueeInited) return;
    const layersViewport = document.getElementById('timeline-layers-viewport');
    if (!layersViewport) return;
    isMarqueeInited = true;

    let marqueeBox = document.querySelector('.desktop-timeline-marquee-box');
    if (!marqueeBox) {
      marqueeBox = document.createElement('div');
      marqueeBox.className = 'desktop-timeline-marquee-box';
      document.body.appendChild(marqueeBox);
    } else if (marqueeBox.parentNode !== document.body) {
      document.body.appendChild(marqueeBox);
    }

    let isMarquee = false;
    let startClientX = 0;
    let startClientY = 0;
    let currentClientX = 0;
    let currentClientY = 0;
    let startScrollX = 0;
    let startScrollY = 0;
    let _marqueeRafId = null;

    layersViewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      if (window.Popover && typeof window.Popover.close === 'function') {
        const activePop = document.querySelector('.popover-card.is-open');
        if (activePop && !activePop.contains(e.target)) {
          window.Popover.close();
        }
      }

      // Do NOT intercept if clicking on a clip, layer pill button, needle, keyframe diamond, handle, left heads, or active dropzone
      if (
        e.target.closest('.timeline-clip-block') ||
        e.target.closest('.timeline-layer-ctrl-pill') ||
        e.target.closest('.timeline-center-needle') ||
        e.target.closest('.desktop-kf-diamond') ||
        e.target.closest('.timeline-clip-handle') ||
        e.target.closest('.timeline-lane-heads-overlay') ||
        e.target.closest('.desktop-timeline-panel-resizer') ||
        e.target.closest('.desktop-ruler-col-resizer') ||
        e.target.closest('button, input, select, textarea') ||
        (e.target.closest('.media-dropzone-split') && e.target.closest('.media-dropzone-split').classList.contains('is-active'))
      ) {
        return;
      }

      // Intercept so editor.js onPanStart does NOT pan the timeline!
      e.stopImmediatePropagation();
      e.preventDefault();

      startClientX = e.clientX;
      startClientY = e.clientY;
      currentClientX = e.clientX;
      currentClientY = e.clientY;
      startScrollX = (typeof window.getDesktopScrollX === 'function') ? window.getDesktopScrollX() : (desktopScrollX || 0);
      startScrollY = layersViewport.scrollTop;
      isMarquee = false;

      function updateMarqueeGeometry() {
        const vpRect = layersViewport.getBoundingClientRect();
        const curScrollX = (typeof window.getDesktopScrollX === 'function') ? window.getDesktopScrollX() : (desktopScrollX || 0);
        const curScrollY = layersViewport.scrollTop;

        // Content-anchored start position projected to current screen space
        const screenStartX = startClientX - (curScrollX - startScrollX);
        const screenStartY = startClientY - (curScrollY - startScrollY);

        const clampedClientX = Math.max(vpRect.left, Math.min(vpRect.right, currentClientX));
        const clampedClientY = Math.max(vpRect.top, Math.min(vpRect.bottom, currentClientY));

        const boxLeft = Math.max(vpRect.left, Math.min(screenStartX, clampedClientX));
        const boxTop = Math.max(vpRect.top, Math.min(screenStartY, clampedClientY));
        const boxRight = Math.min(vpRect.right, Math.max(screenStartX, clampedClientX));
        const boxBottom = Math.min(vpRect.bottom, Math.max(screenStartY, clampedClientY));

        const boxW = Math.max(0, boxRight - boxLeft);
        const boxH = Math.max(0, boxBottom - boxTop);

        marqueeBox.style.left = `${boxLeft}px`;
        marqueeBox.style.top = `${boxTop}px`;
        marqueeBox.style.width = `${boxW}px`;
        marqueeBox.style.height = `${boxH}px`;

        const marqueeRect = {
          left: boxLeft,
          top: boxTop,
          right: boxRight,
          bottom: boxBottom
        };

        const clips = layersViewport.querySelectorAll('.timeline-clip-block');
        clips.forEach(clip => {
          const cr = clip.getBoundingClientRect();
          const intersects = !(
            cr.right < marqueeRect.left ||
            cr.left > marqueeRect.right ||
            cr.bottom < marqueeRect.top ||
            cr.top > marqueeRect.bottom
          );
          clip.classList.toggle('is-marquee-candidate', intersects);
        });

        const diamonds = layersViewport.querySelectorAll('.desktop-kf-diamond');
        diamonds.forEach(diamond => {
          const dr = diamond.getBoundingClientRect();
          const intersects = !(
            dr.right < marqueeRect.left ||
            dr.left > marqueeRect.right ||
            dr.bottom < marqueeRect.top ||
            dr.top > marqueeRect.bottom
          );
          diamond.classList.toggle('is-marquee-candidate', intersects);
        });
      }

      function runAutoScrollLoop() {
        if (!isMarquee) return;

        const vpRect = layersViewport.getBoundingClientRect();
        const edgeZone = 36;
        let scrollDx = 0;
        let scrollDy = 0;

        // Horizontal auto-scroll when near/outside viewport left/right
        if (currentClientX > vpRect.right - edgeZone) {
          const dist = currentClientX - (vpRect.right - edgeZone);
          scrollDx = Math.min(32, Math.max(3, dist * 0.45));
        } else if (currentClientX < vpRect.left + edgeZone) {
          const dist = (vpRect.left + edgeZone) - currentClientX;
          scrollDx = -Math.min(32, Math.max(3, dist * 0.45));
        }

        // Vertical auto-scroll when near/outside viewport top/bottom
        if (currentClientY > vpRect.bottom - edgeZone) {
          const dist = currentClientY - (vpRect.bottom - edgeZone);
          scrollDy = Math.min(26, Math.max(3, dist * 0.45));
        } else if (currentClientY < vpRect.top + edgeZone) {
          const dist = (vpRect.top + edgeZone) - currentClientY;
          scrollDy = -Math.min(26, Math.max(3, dist * 0.45));
        }

        if (scrollDx !== 0) {
          const pps = window.currentPixelsPerSecond || 80;
          const durSec = (window.currentProjectState && window.currentProjectState.duration) || 30;
          const totalContentW = durSec * pps;
          const viewW = layersViewport.clientWidth || 800;
          const maxScrollX = Math.max(0, totalContentW - viewW + 160);
          desktopScrollX = Math.max(0, Math.min(maxScrollX, desktopScrollX + scrollDx));
          syncDesktopPlayhead();
        }

        if (scrollDy !== 0) {
          const layersTrack = document.getElementById('timeline-layers-track');
          const maxScrollY = Math.max(0, (layersTrack ? layersTrack.scrollHeight : 0) - layersViewport.clientHeight);
          layersViewport.scrollTop = Math.max(0, Math.min(maxScrollY, layersViewport.scrollTop + scrollDy));
        }

        updateMarqueeGeometry();
        _marqueeRafId = requestAnimationFrame(runAutoScrollLoop);
      }

      function onPointerMove(moveEvent) {
        currentClientX = moveEvent.clientX;
        currentClientY = moveEvent.clientY;
        const dx = currentClientX - startClientX;
        const dy = currentClientY - startClientY;
        const dist = Math.hypot(dx, dy);

        if (!isMarquee && dist > 4) {
          isMarquee = true;
          marqueeBox.style.display = 'block';
          updateMarqueeGeometry();
          _marqueeRafId = requestAnimationFrame(runAutoScrollLoop);
        }

        if (isMarquee) {
          moveEvent.preventDefault();
          updateMarqueeGeometry();
        }
      }

      function onPointerUp(upEvent) {
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);

        if (_marqueeRafId) {
          cancelAnimationFrame(_marqueeRafId);
          _marqueeRafId = null;
        }

        if (isMarquee) {
          isMarquee = false;
          marqueeBox.style.display = 'none';

          const vpRect = layersViewport.getBoundingClientRect();
          const curScrollX = (typeof window.getDesktopScrollX === 'function') ? window.getDesktopScrollX() : (desktopScrollX || 0);
          const curScrollY = layersViewport.scrollTop;
          const screenStartX = startClientX - (curScrollX - startScrollX);
          const screenStartY = startClientY - (curScrollY - startScrollY);

          const clampedClientX = Math.max(vpRect.left, Math.min(vpRect.right, upEvent.clientX));
          const clampedClientY = Math.max(vpRect.top, Math.min(vpRect.bottom, upEvent.clientY));

          const marqueeRect = {
            left: Math.max(vpRect.left, Math.min(screenStartX, clampedClientX)),
            top: Math.max(vpRect.top, Math.min(screenStartY, clampedClientY)),
            right: Math.min(vpRect.right, Math.max(screenStartX, clampedClientX)),
            bottom: Math.min(vpRect.bottom, Math.max(screenStartY, clampedClientY))
          };

          const matchedDiamonds = [];
          const diamonds = layersViewport.querySelectorAll('.desktop-kf-diamond');
          diamonds.forEach(diamond => {
            diamond.classList.remove('is-marquee-candidate');
            const dr = diamond.getBoundingClientRect();
            const intersects = !(
              dr.right < marqueeRect.left ||
              dr.left > marqueeRect.right ||
              dr.bottom < marqueeRect.top ||
              dr.top > marqueeRect.bottom
            );
            if (intersects) {
              matchedDiamonds.push(diamond);
            }
          });

          if (matchedDiamonds.length > 0) {
            const isShift = !!(upEvent.shiftKey || upEvent.metaKey || upEvent.ctrlKey);
            if (!isShift && typeof window.clearSelectedKeyframes === 'function') {
              window.clearSelectedKeyframes();
            }
            if (!window.selectedKeyframes) window.selectedKeyframes = [];
            const layers = (window.currentProjectState && window.currentProjectState.layers) || [];

            matchedDiamonds.forEach(d => {
              d.classList.add('is-selected-kf');
              const prop = d.dataset.prop;
              const time = Number(d.dataset.time);
              const lane = d.closest('.timeline-track-lane');
              const layerId = lane ? lane.dataset.layerId : (d.dataset.layerId || null);
              const layer = layers.find(l => l.id === layerId);
              const kf = (layer && layer.keyframes && layer.keyframes[prop]) 
                ? layer.keyframes[prop].find(k => Math.abs(k.time - time) < 0.002) 
                : null;

              if (!window.selectedKeyframes.some(it => it.marker === d || (it.layerId === layerId && it.prop === prop && Math.abs(it.time - time) < 0.002))) {
                window.selectedKeyframes.push({
                  layerId: layerId || (layer ? layer.id : ''),
                  layer: layer,
                  prop: prop,
                  time: time,
                  kf: kf,
                  marker: d
                });
              }
            });
            return;
          }

          const matchedIds = new Set();
          const clips = layersViewport.querySelectorAll('.timeline-clip-block');
          clips.forEach(clip => {
            clip.classList.remove('is-marquee-candidate');
            const cr = clip.getBoundingClientRect();
            const intersects = !(
              cr.right < marqueeRect.left ||
              cr.left > marqueeRect.right ||
              cr.bottom < marqueeRect.top ||
              cr.top > marqueeRect.bottom
            );
            if (intersects && clip.dataset.layerId) {
              matchedIds.add(clip.dataset.layerId);
            }
          });

          const isAdditive = !!(upEvent.shiftKey || upEvent.metaKey || upEvent.ctrlKey);
          if (matchedIds.size > 0) {
            if (isAdditive && window.selectedLayerIds && window.selectedLayerIds.size > 0) {
              const combined = new Set(window.selectedLayerIds);
              matchedIds.forEach(id => combined.add(id));
              setDesktopSelectedLayers(combined, Array.from(matchedIds)[0]);
            } else {
              setDesktopSelectedLayers(matchedIds, Array.from(matchedIds)[0]);
            }
          } else if (!isAdditive) {
            deselectAllDesktopLayers();
          }
        }
      }

      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerUp, true);
    }, true);
  }

  // --- 9. Universal Desktop Empty Click & Escape Key Deselect ---
  let isUniversalDeselectInited = false;
  function initDesktopUniversalDeselect() {
    if (isUniversalDeselectInited) return;
    isUniversalDeselectInited = true;

    let emptyClickStart = null;

    // Universal capture-phase dismissal for Popovers when clicking anywhere outside
    document.addEventListener('pointerdown', (e) => {
      if (window.Popover && typeof window.Popover.close === 'function') {
        const activePop = document.querySelector('.popover-card.is-open');
        if (activePop && !activePop.contains(e.target)) {
          const isTrigger = e.target.closest && e.target.closest('[data-popover-target]');
          if (!isTrigger) {
            window.Popover.close();
          }
        }
      }
    }, true);

    document.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;

      // Empty click deselect must strictly happen ONLY when clicking empty space inside the timeline layers viewport
      const timelineViewport = document.getElementById('timeline-layers-viewport') || document.querySelector('.desktop-timeline-viewport');
      const isInsideTimeline = timelineViewport && (timelineViewport === e.target || timelineViewport.contains(e.target));
      if (!isInsideTimeline) {
        emptyClickStart = null;
        return;
      }

      const interactive = e.target.closest(
        '.timeline-clip-block, ' +
        '.timeline-layer-ctrl-pill, ' +
        '.timeline-layer-eye-btn, ' +
        '.timeline-layer-lock-btn, ' +
        '.desktop-layer-twistie-btn, ' +
        '.desktop-kf-diamond, ' +
        '.desktop-kf-track-row, ' +
        '.desktop-kf-prop-row, ' +
        '.timeline-center-needle, ' +
        '.timeline-needle-head, ' +
        '.timeline-ruler-track, ' +
        '.timeline-clip-handle, ' +
        '.timeline-split-handle, ' +
        '.desktop-split-handle, ' +
        'button, ' +
        'input, ' +
        'select, ' +
        'textarea, ' +
        '[role="button"], ' +
        '[role="slider"]'
      );

      if (!interactive) {
        emptyClickStart = { x: e.clientX, y: e.clientY, time: Date.now() };
      } else {
        emptyClickStart = null;
      }
    }, true);

    document.addEventListener('pointerup', (e) => {
      if (!emptyClickStart) return;
      const dx = Math.abs(e.clientX - emptyClickStart.x);
      const dy = Math.abs(e.clientY - emptyClickStart.y);
      const dt = Date.now() - emptyClickStart.time;
      const wasClick = dx < 6 && dy < 6 && dt < 600;
      emptyClickStart = null;

      if (wasClick) {
        const hasSelection = !!(
          (window.selectedLayerId && window.selectedLayerId !== '') ||
          (window.selectedLayerIds && window.selectedLayerIds.size > 0) ||
          window.isSelectorMode ||
          window.mockInspectorActive
        );
        if (hasSelection) {
          deselectAllDesktopLayers();
        }
      }
    }, true);

    // Keyboard Shortcuts: Escape / F2 / Cmd+Shift+A / Ctrl+Shift+A (Deselect) & Cmd+A / Ctrl+A (Select All)
    document.addEventListener('keydown', (e) => {
      const isDeselect = (e.key === 'Escape') || (e.key === 'F2') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a');
      if (isDeselect) {
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select, [contenteditable="true"]')) {
          if (e.key !== 'Escape') return;
        }
        const openModal = document.querySelector('.modal-backdrop.is-active, .modal-backdrop[style*="display: flex"], .modal-backdrop[style*="display: block"]');
        if (openModal) return;

        if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.clearSelectedKeyframes === 'function') {
            window.clearSelectedKeyframes();
          }
          return;
        }

        const hasSelection = !!(
          (window.selectedLayerId && window.selectedLayerId !== '') ||
          (window.selectedLayerIds && window.selectedLayerIds.size > 0) ||
          window.isSelectorMode ||
          window.mockInspectorActive
        );
        if (hasSelection) {
          e.preventDefault();
          deselectAllDesktopLayers();
        }
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'a') {
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select, [contenteditable="true"]')) {
          return;
        }
        const openModal = document.querySelector('.modal-backdrop.is-active, .modal-backdrop[style*="display: flex"], .modal-backdrop[style*="display: block"]');
        if (openModal) return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof window.selectAllTimelineLayers === 'function') {
          window.selectAllTimelineLayers();
        } else {
          const currentLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
          if (currentLayers.length > 0) {
            setDesktopSelectedLayers(new Set(currentLayers.map(l => l.id)), currentLayers[0].id);
          }
        }
      } else {
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select, [contenteditable="true"]')) {
          return;
        }
        const openModal = document.querySelector('.modal-backdrop.is-active, .modal-backdrop[style*="display: flex"], .modal-backdrop[style*="display: block"]');
        if (openModal) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.deleteSelectedKeyframes === 'function') {
              window.deleteSelectedKeyframes();
            }
            return;
          }
        } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c') {
          if (Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.copySelectedKeyframes === 'function') {
              window.copySelectedKeyframes();
            }
            return;
          }
        } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'v') {
          const hasKeyframesSelected = Array.isArray(window.selectedKeyframes) && window.selectedKeyframes.length > 0;
          const hasKeyframeClip = window.internalKeyframeClipboard && Array.isArray(window.internalKeyframeClipboard.items) && window.internalKeyframeClipboard.items.length > 0;
          const shouldPasteKeyframe = (window.lastClipboardType === 'keyframe' && hasKeyframeClip) || (hasKeyframesSelected && hasKeyframeClip);

          if (shouldPasteKeyframe) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.pasteKeyframes === 'function') {
              window.pasteKeyframes();
            }
            return;
          }
        }

        const isBracketLeft = (e.code === 'BracketLeft' || e.key === '[' || e.keyCode === 219 || e.key === '“' || e.key === '”');
        const isBracketRight = (e.code === 'BracketRight' || e.key === ']' || e.keyCode === 221 || e.key === '‘' || e.key === '’');

        if (e.altKey && !e.ctrlKey) {
          if (isBracketLeft) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.executeTrimIn === 'function') {
              window.executeTrimIn();
            }
          } else if (isBracketRight) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.executeTrimOut === 'function') {
              window.executeTrimOut();
            }
          }
        } else if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          if (isBracketLeft) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.executeMoveIn === 'function') {
              window.executeMoveIn();
            }
          } else if (isBracketRight) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.executeMoveOut === 'function') {
              window.executeMoveOut();
            }
          } else if (e.key && e.key.toLowerCase() === 'u') {
            const currentLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
            const selectedIds = window.selectedLayerIds && window.selectedLayerIds.size > 0 
              ? Array.from(window.selectedLayerIds) 
              : (window.selectedLayerId ? [window.selectedLayerId] : []);

            if (selectedIds.length > 0) {
              e.preventDefault();
              e.stopPropagation();

              const anyExpanded = selectedIds.some(id => {
                const l = currentLayers.find(ly => ly.id === id);
                return l && l._kfExpanded;
              });

              selectedIds.forEach(id => {
                const l = currentLayers.find(ly => ly.id === id);
                if (l) l._kfExpanded = !anyExpanded;
              });

              if (typeof window.renderTimelineLayers === 'function') {
                window.renderTimelineLayers();
              }
            }
          }
        }
      }
    }, true);
  }

  function checkUrlTestParams() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('testInspector')) {
        window.mockInspectorActive = true;
        syncInspectorState();
      }
      if (urlParams.get('testDrop')) {
        const type = urlParams.get('testDrop');
        const overlay = document.getElementById('timeline-dropzone-split');
        if (overlay) {
          if (typeof overlay._renderOverlayMode === 'function') {
            overlay._renderOverlayMode(type);
          }
          overlay.classList.add('is-active');
          if (overlay.parentElement) {
            overlay.parentElement.classList.add('has-dropzone-active');
          }
          if (urlParams.get('testHover')) {
            const col = overlay.querySelector('.media-dropzone-col');
            if (col) col.classList.add('is-hover');
          }
        }
      }
      if (urlParams.get('testMockLayers')) {
        const applyMocks = () => {
          if (window.currentProjectState && typeof window.renderTimelineLayers === 'function') {
            window.currentProjectState.layers = [
              {
                id: 'layer_mock_1',
                name: 'Rectangle 1',
                type: 'shape',
                shapeType: 'rectangle',
                startPx: 0,
                startSec: 0,
                durationSec: 5,
                widthPx: 400,
                fillType: 'color',
                fillColor: '#98ce7b'
              },
              {
                id: 'layer_mock_2',
                name: 'Title Text',
                type: 'text',
                startPx: 80,
                startSec: 1,
                durationSec: 3.5,
                widthPx: 280,
                textProps: { text: 'Hello World' }
              },
              {
                id: 'layer_mock_3',
                name: 'Background Solid',
                type: 'color',
                startPx: 0,
                startSec: 0,
                durationSec: 5,
                widthPx: 400,
                color: '#1d2415'
              }
            ];
            if (urlParams.get('testWithEffect')) {
              window.currentProjectState.layers[0].effects = [
                {
                  id: 'fx_gaussian_blur',
                  name: 'Gaussian Blur',
                  category: 'blur',
                  enabled: true,
                  params: { strength: 15 }
                }
              ];
            }
            window.renderTimelineLayers();
            if (typeof window.redrawComposition === 'function') window.redrawComposition();
            if (urlParams.get('testBeatmarks')) {
              window.currentProjectState.beatmarks = [1.0, 2.5, 4.0];
              window.currentProjectState.markerNames = { '1': 'Intro', '2.5': 'Drop', '4': 'Chorus' };
              if (typeof window.renderTimelineBeatmarks === 'function') {
                window.renderTimelineBeatmarks();
              }
              if (typeof syncDesktopMarkerLabels === 'function') {
                syncDesktopMarkerLabels();
              }
              if (urlParams.get('testClickBeatmark')) {
                const bmItem = document.querySelector('.timeline-beatmark-item');
                if (bmItem) {
                  const time = parseFloat(bmItem.dataset.time);
                  openBeatmarkPopover(bmItem, time);
                  const pop = document.getElementById('popover-beatmark-details');
                  if (pop) {
                    pop.style.transition = 'none';
                    pop.style.opacity = '1';
                    pop.style.transform = 'scale(1)';
                    pop.classList.add('is-open');
                    pop.setAttribute('aria-hidden', 'false');
                  }
                }
              }
            }
            if (urlParams.get('testClickCanvas') && !window._testCanvasClicked) {
              window._testCanvasClicked = true;
              setTimeout(() => {
                const canvas = document.getElementById('editor-active-canvas') || document.querySelector('.editor-canvas-container');
                if (canvas) {
                  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, button: 0 }));
                  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, button: 0 }));
                }
              }, 600);
            }
            if (urlParams.get('testClickEmptyTimeline') && !window._testEmptyTimelineClicked) {
              window._testEmptyTimelineClicked = true;
              setTimeout(() => {
                const vp = document.getElementById('timeline-layers-viewport');
                if (vp) {
                  vp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 800, clientY: 800, button: 0 }));
                  vp.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 800, clientY: 800, button: 0 }));
                }
              }, 600);
            }
            if (urlParams.get('testSelectLayer') && !window._testLayerSelectedOnce) {
              window._testLayerSelectedOnce = true;
              const lid = urlParams.get('testSelectLayer');
              const pill = document.querySelector(`.timeline-layer-ctrl-pill[data-layer-id="${lid}"]`);
              if (pill) {
                pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
                pill.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
              } else if (typeof window.selectTimelineLayer === 'function') {
                window.selectTimelineLayer(lid, false);
              }
              syncInspectorState();
              if (urlParams.get('testHoverBtn')) {
                const btnId = urlParams.get('testHoverBtn');
                const btn = document.getElementById(btnId);
                if (btn) btn.classList.add('is-hover-simulated');
              }
              if (urlParams.get('testOpenEffects')) {
                const btnEffects = document.getElementById('btn-layer-effects');
                if (btnEffects) btnEffects.click();
              }
              if (urlParams.get('testClickAddEffect')) {
                const btnAdd = document.getElementById('btn-add-effect');
                if (btnAdd) btnAdd.click();
              }
            }
            if (urlParams.get('testSelectAll')) {
              if (typeof window.selectAllTimelineLayers === 'function') {
                window.selectAllTimelineLayers();
              }
            }
            if (urlParams.get('testRightClickPopover')) {
              const vp = document.getElementById('timeline-layers-viewport');
              if (vp) {
                vp.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 500 }));
                if (urlParams.get('testDismissPopover')) {
                  const canvas = document.getElementById('editor-active-canvas') || document.body;
                  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 200, clientY: 200, button: 0 }));
                  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 200, clientY: 200, button: 0 }));
                }
              }
            }
          }
        };
        applyMocks();
        setTimeout(applyMocks, 100);
        setTimeout(applyMocks, 300);
        setTimeout(applyMocks, 800);
      }
      if (urlParams.get('testSelectLayer') && !window._testLayerSelectedOnce) {
        const lid = urlParams.get('testSelectLayer');
        const runSelect = () => {
          const pill = document.querySelector(`.timeline-layer-ctrl-pill[data-layer-id="${lid}"]`);
          if (pill) {
            pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
            pill.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
          } else if (typeof window.selectTimelineLayer === 'function') {
            window.selectTimelineLayer(lid, false);
          }
          syncInspectorState();
          if (urlParams.get('testHoverBtn')) {
            const btnId = urlParams.get('testHoverBtn');
            const btn = document.getElementById(btnId);
            if (btn) btn.classList.add('is-hover-simulated');
          }
          if (urlParams.get('testDeselectAfter')) {
            setTimeout(() => {
              if (typeof window.deselectAllDesktopLayers === 'function') {
                window.deselectAllDesktopLayers();
              }
            }, 1000);
          }
        };
        setTimeout(runSelect, 1200);
      }
      if (urlParams.get('testSelectAll')) {
        setTimeout(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
          console.log('TEST_SELECT_ALL_FIRED', {
            windowSelectedLayerIds: Array.from(window.selectedLayerIds || []),
            windowSelectedLayerId: window.selectedLayerId,
            isSelectorMode: window.isSelectorMode,
            batchTitle: (function() { var el = document.getElementById('editor-layer-batch-title'); return el ? el.textContent : ''; })(),
            batchDisplay: (function() { var el = document.getElementById('editor-layer-batch-title'); return el ? el.style.display : 'none'; })()
          });
        }, 1200);
      }
    } catch (_) {}
  }

  function ensureHeaderModePatched() {
    if (typeof window.updateEditorHeaderMode === 'function' && !window._desktopHeaderPatched) {
      window._desktopHeaderPatched = true;
      const origUpdateHeader = window.updateEditorHeaderMode;
      window.updateEditorHeaderMode = function() {
        const selCount = (window.selectedLayerIds && window.selectedLayerIds.size) || (window.selectedLayerId ? 1 : 0);
        window.isSelectorMode = (selCount > 1);
        const res = origUpdateHeader.apply(this, arguments);

        const projectNav = document.getElementById('header-nav-project');
        const layerNav = document.getElementById('header-nav-layer');
        const layerNameInput = document.getElementById('editor-layer-name-input');
        const batchTitle = document.getElementById('editor-layer-batch-title');
        const leftBatchActions = document.getElementById('editor-layer-batch-actions');
        const btnPrecomp = document.getElementById('btn-layer-header-precomp');
        const btnGroupMask = document.getElementById('btn-layer-header-group-mask');
        const btnGroupExclude = document.getElementById('btn-layer-header-group-exclude');
        const btnLink = document.getElementById('btn-layer-header-link');

        if (selCount > 1) {
          if (projectNav) projectNav.style.display = 'none';
          if (layerNav) layerNav.style.display = 'flex';
          if (layerNameInput) layerNameInput.style.display = 'none';
          if (btnLink) btnLink.style.display = 'none';
          if (batchTitle) {
            batchTitle.textContent = `${selCount} Selected`;
            batchTitle.style.display = 'block';
          }
          if (leftBatchActions) leftBatchActions.style.display = 'inline-flex';
          if (btnPrecomp) btnPrecomp.style.display = 'inline-flex';
          if (btnGroupMask) btnGroupMask.style.display = 'inline-flex';
          if (btnGroupExclude) btnGroupExclude.style.display = 'inline-flex';
        } else if (selCount === 1) {
          if (leftBatchActions) leftBatchActions.style.display = 'none';
          if (btnPrecomp) btnPrecomp.style.display = 'none';
          if (btnGroupMask) btnGroupMask.style.display = 'none';
          if (btnGroupExclude) btnGroupExclude.style.display = 'none';
          if (batchTitle) batchTitle.style.display = 'none';
          if (layerNameInput) layerNameInput.style.display = 'block';
        } else {
          if (leftBatchActions) leftBatchActions.style.display = 'none';
        }

        const overlay = document.getElementById('timeline-lane-heads-overlay');
        if (overlay) {
          overlay.classList.toggle('is-selector-mode', selCount > 1);
        }
        return res;
      };
    }

    if (typeof window.selectAllTimelineLayers === 'function' && !window._desktopSelectAllPatched) {
      window._desktopSelectAllPatched = true;
      const origSelectAll = window.selectAllTimelineLayers;
      window.selectAllTimelineLayers = function() {
        const res = origSelectAll.apply(this, arguments);
        const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
        window.isSelectorMode = (layers.length > 1);
        if (typeof window.updateEditorHeaderMode === 'function') {
          window.updateEditorHeaderMode();
        }
        syncInspectorState();
        return res;
      };
    }

    if (typeof window.selectTimelineLayer === 'function' && !window._desktopSelectPatched) {
      window._desktopSelectPatched = true;
      const origSelect = window.selectTimelineLayer;
      window.selectTimelineLayer = function(layerId, isMulti) {
        window._mockInspectorDismissed = false;
        const res = origSelect.apply(this, arguments);
        const selCount = (window.selectedLayerIds && window.selectedLayerIds.size) || (window.selectedLayerId ? 1 : 0);
        window.isSelectorMode = (selCount > 1);
        syncInspectorState();
        return res;
      };
    }

    if (typeof window.deselectTimelineLayer === 'function' && !window._desktopDeselectPatched) {
      window._desktopDeselectPatched = true;
      const origDeselect = window.deselectTimelineLayer;
      window.deselectTimelineLayer = function() {
        const res = origDeselect.apply(this, arguments);
        window.mockInspectorActive = false;
        window._mockInspectorDismissed = true;
        window.isSelectorMode = false;
        const leftBatchActions = document.getElementById('editor-layer-batch-actions');
        if (leftBatchActions) leftBatchActions.style.display = 'none';
        syncInspectorState();
        return res;
      };
    }
  }

  function initDesktopHeaderBatchActions() {
    const leftPrecomp = document.getElementById('btn-layer-header-left-precomp');
    if (leftPrecomp && !leftPrecomp._bound) {
      leftPrecomp._bound = true;
      leftPrecomp.addEventListener('click', (e) => {
        e.stopPropagation();
        var target = document.getElementById('btn-layer-header-precomp');
        if (target) target.click();
      });
    }
    const leftMask = document.getElementById('btn-layer-header-left-group-mask');
    if (leftMask && !leftMask._bound) {
      leftMask._bound = true;
      leftMask.addEventListener('click', (e) => {
        e.stopPropagation();
        var target = document.getElementById('btn-layer-header-group-mask');
        if (target) target.click();
      });
    }
    const leftExclude = document.getElementById('btn-layer-header-left-group-exclude');
    if (leftExclude && !leftExclude._bound) {
      leftExclude._bound = true;
      leftExclude.addEventListener('click', (e) => {
        e.stopPropagation();
        var target = document.getElementById('btn-layer-header-group-exclude');
        if (target) target.click();
      });
    }

    const popoverSelectAll = document.getElementById('popover-btn-select-all');
    if (popoverSelectAll && !popoverSelectAll._bound) {
      popoverSelectAll._bound = true;
      popoverSelectAll.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.Popover) window.Popover.close();
        if (typeof window.selectAllTimelineLayers === 'function') {
          window.selectAllTimelineLayers();
        } else {
          const allLayers = (window.currentProjectState && window.currentProjectState.layers) || [];
          if (allLayers.length > 0) {
            setDesktopSelectedLayers(new Set(allLayers.map(l => l.id)), allLayers[0].id);
          }
        }
      });
    }
  }

  /* ==========================================================================
     DESKTOP BEATMARK / MARKER ENGINE
     - Dedicated Toolbar Beatmark Button (#editor-btn-add-beatmark) to left of Draft
     - Disables beatmark toggle on timecode badge click
     - Click Beatmark Item -> Seeks & opens minimalist Popover (#popover-beatmark-details)
     - Drag Beatmark Item -> Moves marker along ruler & layers track, saves new time
     - Marker Name editing in Popover -> Updates DOM label tag & project state
     - Delete Marker button in Popover -> Deletes marker & closes popover
     ========================================================================== */
  let activeEditingBeatmarkTime = null;

  function saveDesktopMarkerNames() {
    if (!window.FishDatabase || !window.currentProjectState || !window.currentProjectState.id) return;
    try {
      window.FishDatabase.getProject(window.currentProjectState.id).then(prj => {
        if (prj) {
          prj.markerNames = Object.assign({}, window.currentProjectState.markerNames || {});
          window.FishDatabase.saveProject(prj).catch(() => {});
        }
      }).catch(() => {});
    } catch (_) {}
  }

  function syncDesktopMarkerLabels() {
    const markerNames = (window.currentProjectState && window.currentProjectState.markerNames) || {};
    const items = document.querySelectorAll('.timeline-beatmark-item');
    items.forEach(item => {
      const timeVal = parseFloat(item.dataset.time);
      if (isNaN(timeVal)) return;

      let name = '';
      if (markerNames[timeVal] !== undefined) {
        name = markerNames[timeVal];
      } else if (markerNames[String(timeVal)] !== undefined) {
        name = markerNames[String(timeVal)];
      } else {
        const key = Object.keys(markerNames).find(k => Math.abs(parseFloat(k) - timeVal) <= 0.05);
        if (key) name = markerNames[key];
      }

      let labelEl = item.querySelector('.timeline-beatmark-label');
      const pinSvg = item.querySelector('.timeline-beatmark-svg');
      const layerLine = document.querySelector(`.timeline-layers-beatmark-line[data-time="${timeVal}"]`) ||
                        document.querySelector(`.timeline-layers-beatmark-line[data-time="${item.dataset.time}"]`);

      if (name) {
        item.classList.remove('is-beatmark');
        if (layerLine) layerLine.classList.remove('is-beatmark');
        if (!labelEl) {
          labelEl = document.createElement('span');
          labelEl.className = 'timeline-beatmark-label';
          item.appendChild(labelEl);
        }
        labelEl.textContent = name;
        item.title = `Marker: ${name} (${timeVal.toFixed(2)}s) — Hold to move, tap to edit`;
        if (pinSvg) {
          pinSvg.innerHTML = '<path d="M 0 11 L 10 11 L 10 5 L 5 0 L 0 5 Z" fill="currentColor"/>';
        }
      } else {
        item.classList.add('is-beatmark');
        if (layerLine) layerLine.classList.add('is-beatmark');
        if (labelEl) labelEl.remove();
        item.title = `Beatmark: ${timeVal.toFixed(2)}s — Hold to move, tap to edit`;
        if (pinSvg) {
          pinSvg.innerHTML = '<path d="M 0 11 L 10 11 L 10 5 L 5 0 L 0 5 Z" fill="currentColor"/>';
        }
      }
    });
    updateDesktopBeatmarkBtnState();
  }
  window.syncDesktopMarkerLabels = syncDesktopMarkerLabels;

  function updateDesktopBeatmarkBtnState() {
    const btnAddBm = document.getElementById('editor-btn-add-beatmark');
    if (!btnAddBm) return;
    const currentSec = (typeof window.getCurrentPlayheadTime === 'function')
      ? window.getCurrentPlayheadTime()
      : 0;
    const beatmarks = (window.currentProjectState && window.currentProjectState.beatmarks) || [];
    const isNear = beatmarks.some(b => Math.abs(b - currentSec) <= 0.05);
    btnAddBm.setAttribute('title', isNear ? 'Playhead on Marker (M)' : 'Add Marker / Beatmark at Playhead (M)');
  }

  function openBeatmarkPopover(item, time) {
    const popover = document.getElementById('popover-beatmark-details');
    const input = document.getElementById('beatmark-popover-name');
    if (!popover || !input) return;

    activeEditingBeatmarkTime = time;
    const markerNames = (window.currentProjectState && window.currentProjectState.markerNames) || {};
    let existingName = markerNames[time] || markerNames[String(time)] || '';
    if (!existingName) {
      const key = Object.keys(markerNames).find(k => Math.abs(parseFloat(k) - time) <= 0.05);
      if (key) existingName = markerNames[key];
    }

    input.value = existingName;

    if (window.Popover && typeof window.Popover.open === 'function') {
      window.Popover.open(item, popover);
      setTimeout(() => {
        input.focus();
        input.select();
      }, 60);
    }
  }

  function initDesktopBeatmarkEngine() {
    // 1. Wire Dedicated Toolbar Beatmark Button (Action with momentary press feedback)
    const btnAddBm = document.getElementById('editor-btn-add-beatmark');
    if (btnAddBm && !btnAddBm._bound) {
      btnAddBm._bound = true;
      btnAddBm.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btnAddBm.blur();
        btnAddBm.classList.add('is-pressed');
        setTimeout(() => btnAddBm.classList.remove('is-pressed'), 180);
        if (typeof window.toggleBeatmarkAtCurrentTime === 'function') {
          window.toggleBeatmarkAtCurrentTime();
        }
        syncDesktopMarkerLabels();
      });
    }

    // 1b. Wire Dedicated Toolbar Magnet Snapping Button
    const btnMagnet = document.getElementById('editor-btn-magnet');
    if (btnMagnet && !btnMagnet._bound) {
      btnMagnet._bound = true;
      if (window.isTimelineSnapEnabled === undefined) window.isTimelineSnapEnabled = true;
      btnMagnet.classList.toggle('is-active', window.isTimelineSnapEnabled !== false);

      btnMagnet.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.isTimelineSnapEnabled = !window.isTimelineSnapEnabled;
        btnMagnet.classList.toggle('is-active', window.isTimelineSnapEnabled);
        btnMagnet.setAttribute('title', window.isTimelineSnapEnabled ? 'Snapping Enabled (N)' : 'Snapping Disabled (N)');
        if (!window.isTimelineSnapEnabled && typeof window.hideTimelineSnapGuide === 'function') {
          window.hideTimelineSnapGuide();
        }
      });
    }

    // 2. Disable beatmark toggle on timecode badge click
    const timeBadge = document.getElementById('timeline-time-badge');
    if (timeBadge && !timeBadge._boundNoBeatmark) {
      timeBadge._boundNoBeatmark = true;
      timeBadge.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        e.stopPropagation();
      }, true);
    }

    // 3. Global keyboard shortcut for magnet snapping (marker toggle handled cleanly by editor.js)
    if (!window._desktopBeatmarkKeyBound) {
      window._desktopBeatmarkKeyBound = true;
      document.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
        if (isInput) return;

        // Snapping toggle hotkey: N
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'n') {
          const mBtn = document.getElementById('editor-btn-magnet');
          if (mBtn) {
            e.preventDefault();
            mBtn.click();
            return;
          }
        }
      });
    }

    // 4. Popover inputs and delete button wiring
    const popoverInput = document.getElementById('beatmark-popover-name');
    const popoverDelete = document.getElementById('beatmark-popover-delete');
    const popoverForm = document.getElementById('beatmark-popover-form');

    if (popoverForm && !popoverForm._bound) {
      popoverForm._bound = true;
      popoverForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (window.Popover) window.Popover.close();
      });
    }

    if (popoverInput && !popoverInput._bound) {
      popoverInput._bound = true;
      popoverInput.addEventListener('input', () => {
        if (activeEditingBeatmarkTime === null) return;
        window.currentProjectState = window.currentProjectState || {};
        window.currentProjectState.markerNames = window.currentProjectState.markerNames || {};
        const val = popoverInput.value.trim();
        if (val) {
          window.currentProjectState.markerNames[activeEditingBeatmarkTime] = val;
        } else {
          delete window.currentProjectState.markerNames[activeEditingBeatmarkTime];
        }
        syncDesktopMarkerLabels();
        saveDesktopMarkerNames();
      });

      popoverInput.addEventListener('change', () => {
        if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
          window.UndoRedoManager.recordSnapshot();
        }
      });

      popoverInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (window.Popover) window.Popover.close();
        } else if (e.key === 'Escape') {
          if (window.Popover) window.Popover.close();
        }
      });
    }

    if (popoverDelete && !popoverDelete._bound) {
      popoverDelete._bound = true;
      popoverDelete.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeEditingBeatmarkTime !== null) {
          if (typeof window.deleteBeatmark === 'function') {
            window.deleteBeatmark(activeEditingBeatmarkTime);
          }
          if (window.currentProjectState && window.currentProjectState.markerNames) {
            delete window.currentProjectState.markerNames[activeEditingBeatmarkTime];
            delete window.currentProjectState.markerNames[String(activeEditingBeatmarkTime)];
          }
          saveDesktopMarkerNames();
          syncDesktopMarkerLabels();
        }
        if (window.Popover) window.Popover.close();
      });
    }

    // 5. Intercept Beatmark Dragging (250ms Hold Required) and Clean Playhead Scrubbing
    if (!window._desktopBeatmarkDragBound) {
      window._desktopBeatmarkDragBound = true;

      document.addEventListener('click', (e) => {
        const item = e.target.closest('.timeline-beatmark-item');
        if (item) {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
        }
      }, true);

      document.addEventListener('pointerdown', (e) => {
        const item = e.target.closest('.timeline-beatmark-item');
        if (!item || e.button !== 0) return;

        const startX = e.clientX;
        const startY = e.clientY;
        const pointerId = e.pointerId;
        const initialTime = parseFloat(item.dataset.time);
        if (isNaN(initialTime)) return;

        let isHoldUnlocked = false;
        let hasMoved = false;
        let currentTime = initialTime;
        const pps = window.currentPixelsPerSecond || window.pixelsPerSecond || 80;

        // 250ms Press & Hold Timer
        const holdTimer = setTimeout(() => {
          isHoldUnlocked = true;
          item.classList.add('is-hold-ready');
          try { item.setPointerCapture(pointerId); } catch (_) {}
          if (navigator.vibrate) try { navigator.vibrate(18); } catch (_) {}
        }, 250);

        const onMove = (me) => {
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;

          // If pointer moved before 250ms: user is scrubbing playhead!
          if (!isHoldUnlocked) {
            if (Math.hypot(dx, dy) > 4) {
              clearTimeout(holdTimer);
              // Delegate to ruler seek so playhead scrub is NOT blocked!
              if (typeof window.handleDesktopRulerSeek === 'function') {
                window.handleDesktopRulerSeek(me.clientX);
              }
            }
            return;
          }

          // User held >= 250ms and is now dragging beatmark!
          if (!hasMoved && Math.abs(dx) > 4) {
            hasMoved = true;
            item.classList.remove('is-hold-ready');
            item.classList.add('is-dragging');
          }

          if (hasMoved) {
            let newSec = Math.max(0, initialTime + dx / pps);
            // Snap to playhead or other markers if within 6px
            const curPlayheadSec = (typeof window.getCurrentPlayheadTime === 'function')
              ? window.getCurrentPlayheadTime()
              : 0;
            if (Math.abs(newSec - curPlayheadSec) * pps < 6) {
              newSec = curPlayheadSec;
            }
            currentTime = Math.round(newSec * 1000) / 1000;
            const newLeftPx = Math.round(currentTime * pps);
            item.style.left = `${newLeftPx}px`;

            const layerLine = document.querySelector(`.timeline-layers-beatmark-line[data-time="${initialTime}"]`) ||
                              document.querySelector(`.timeline-layers-beatmark-line[data-time="${item.dataset.time}"]`);
            if (layerLine) {
              layerLine.style.left = `${newLeftPx}px`;
            }
          }
        };

        const onUp = (ue) => {
          clearTimeout(holdTimer);
          window.removeEventListener('pointermove', onMove, true);
          window.removeEventListener('pointerup', onUp, true);
          window.removeEventListener('pointercancel', onUp, true);
          try { item.releasePointerCapture(ue.pointerId); } catch (_) {}
          item.classList.remove('is-hold-ready');

          if (hasMoved) {
            item.classList.remove('is-dragging');
            const finalTime = currentTime;

            // Update currentProjectState.beatmarks
            if (window.currentProjectState && Array.isArray(window.currentProjectState.beatmarks)) {
              const idx = window.currentProjectState.beatmarks.findIndex(b => Math.abs(b - initialTime) <= 0.05);
              if (idx !== -1) {
                window.currentProjectState.beatmarks[idx] = finalTime;
                window.currentProjectState.beatmarks.sort((a, b) => a - b);
              }
            }

            // Move markerNames entry if any
            if (window.currentProjectState && window.currentProjectState.markerNames) {
              const oldName = window.currentProjectState.markerNames[initialTime] ||
                              window.currentProjectState.markerNames[String(initialTime)];
              if (oldName) {
                delete window.currentProjectState.markerNames[initialTime];
                delete window.currentProjectState.markerNames[String(initialTime)];
                window.currentProjectState.markerNames[finalTime] = oldName;
              }
            }

            item.dataset.time = String(finalTime);
            const layerLine = document.querySelector(`.timeline-layers-beatmark-line[data-time="${initialTime}"]`);
            if (layerLine) {
              layerLine.dataset.time = String(finalTime);
            }

            if (typeof window.saveCurrentProjectBeatmarks === 'function') {
              window.saveCurrentProjectBeatmarks(true);
            }
            saveDesktopMarkerNames();
            syncDesktopMarkerLabels();

            // Record snapshot to Undo/Redo history!
            if (window.UndoRedoManager && !window.UndoRedoManager.isApplying) {
              window.UndoRedoManager.recordSnapshot();
            }
          } else if (isHoldUnlocked || Math.hypot(ue.clientX - startX, ue.clientY - startY) <= 4) {
            // Stationary hold and release: open Popover!
            openBeatmarkPopover(item, initialTime);
          }
        };

        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onUp, true);
      }, true);
    }

    // 6. Hook renderTimelineBeatmarks to keep labels in sync
    if (window.renderTimelineBeatmarks && !window.renderTimelineBeatmarks._desktopPatched) {
      const origRender = window.renderTimelineBeatmarks;
      window.renderTimelineBeatmarks = function () {
        origRender.apply(this, arguments);
        syncDesktopMarkerLabels();
      };
      window.renderTimelineBeatmarks._desktopPatched = true;
    }

    // 7. Hook updateTimeBadgeBeatmarkState to update toolbar button state
    if (window.updateTimeBadgeBeatmarkState && !window.updateTimeBadgeBeatmarkState._desktopPatched) {
      const origBadgeState = window.updateTimeBadgeBeatmarkState;
      window.updateTimeBadgeBeatmarkState = function () {
        origBadgeState.apply(this, arguments);
        updateDesktopBeatmarkBtnState();
      };
      window.updateTimeBadgeBeatmarkState._desktopPatched = true;
    }

    syncDesktopMarkerLabels();
  }

  // --- 8. Desktop Floating Timeline Zoom Controller ---
  function initDesktopFloatingZoom() {
    const container = document.getElementById('desktop-timeline-floating-zoom');
    const slider = document.getElementById('floating-zoom-slider');
    const btnMinus = document.getElementById('floating-zoom-minus');
    const btnPlus = document.getElementById('floating-zoom-plus');
    const valLabel = document.getElementById('floating-zoom-val');
    if (!container || !slider) return;

    function updateZoomUI(pps) {
      slider.value = String(pps);
      if (valLabel) {
        valLabel.textContent = `${Math.round((pps / 80) * 100)}%`;
      }
    }

    const curPps = window.currentPixelsPerSecond || 80;
    updateZoomUI(curPps);

    slider.addEventListener('input', () => {
      const pps = parseInt(slider.value, 10) || 80;
      if (typeof window.setTimelineZoom === 'function') {
        window.setTimelineZoom(pps);
      }
      updateZoomUI(pps);
    });

    if (btnMinus) {
      btnMinus.addEventListener('click', () => {
        const pps = Math.max(20, (window.currentPixelsPerSecond || 80) - 15);
        if (typeof window.setTimelineZoom === 'function') {
          window.setTimelineZoom(pps);
        }
        updateZoomUI(pps);
      });
    }

    if (btnPlus) {
      btnPlus.addEventListener('click', () => {
        const pps = Math.min(400, (window.currentPixelsPerSecond || 80) + 15);
        if (typeof window.setTimelineZoom === 'function') {
          window.setTimelineZoom(pps);
        }
        updateZoomUI(pps);
      });
    }

    if (valLabel) {
      valLabel.addEventListener('click', () => {
        if (typeof window.setTimelineZoom === 'function') {
          window.setTimelineZoom(80);
        }
        updateZoomUI(80);
      });
    }

    // Sync when timeline zoom changes from elsewhere
    if (window.setTimelineZoom && !window.setTimelineZoom._zoomSliderPatched) {
      const origZoom = window.setTimelineZoom;
      window.setTimelineZoom = function(targetPps, anchorSec) {
        origZoom.apply(this, arguments);
        updateZoomUI(window.currentPixelsPerSecond || targetPps);
      };
      window.setTimelineZoom._zoomSliderPatched = true;
    }
  }

  // Initial sync after DOM and engines load
  window.addEventListener('DOMContentLoaded', () => {
    initLeftPanelTabs();
    syncInspectorState();
    initDesktopFishToolsExtension();
    initDesktopTimeline();
    patchDesktopLeftTimeline();
    initDesktopClipDragEngine();
    initDesktopMarqueeSelection();
    initDesktopUniversalDeselect();
    ensureHeaderModePatched();
    initDesktopHeaderBatchActions();
    initDesktopBeatmarkEngine();
    initDesktopFloatingZoom();
    syncLayout();
    checkUrlTestParams();
    checkAndPromptMobileSwitch();
  });

  checkUrlTestParams();

  setTimeout(() => {
    initLeftPanelTabs();
    syncInspectorState();
    initDesktopFishToolsExtension();
    initDesktopTimeline();
    patchDesktopLeftTimeline();
    initDesktopClipDragEngine();
    initDesktopMarqueeSelection();
    initDesktopUniversalDeselect();
    ensureHeaderModePatched();
    initDesktopHeaderBatchActions();
    initDesktopBeatmarkEngine();
    initDesktopFloatingZoom();
    syncLayout();
    checkUrlTestParams();
    checkAndPromptMobileSwitch();
  }, 350);

  // --- Mobile Device & Small Viewport Detection ---
  const MOBILE_DISMISS_KEY = 'oft_desktop_mobile_dismissed';
  let mobilePromptDismissedThisSession = false;

  function isMobileOrSmallScreen() {
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|SM-G/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const w = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 0) || (window.screen ? window.screen.width : 0) || 0;
    const sw = (window.screen && window.screen.width) ? window.screen.width : 0;
    const isNarrowViewport = (w > 0 && w <= 900) || (sw > 0 && sw <= 900) || (window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
    return isNarrowViewport || isMobileUA;
  }

  function checkAndPromptMobileSwitch(force) {
    force = Boolean(force);
    if (!force) {
      try {
        if (localStorage.getItem(MOBILE_DISMISS_KEY) === 'stay') {
          return;
        }
      } catch (_) {}
      if (mobilePromptDismissedThisSession) {
        return;
      }
    }

    if (isMobileOrSmallScreen()) {
      setTimeout(() => {
        if (window.Modal && typeof window.Modal.open === 'function') {
          const modalEl = document.getElementById('modal-switch-mobile');
          if (modalEl && !modalEl.classList.contains('is-active')) {
            window.Modal.open('modal-switch-mobile');
          }
        }
      }, 250);
    }
  }

  function proceedToMobileView() {
    try {
      localStorage.setItem('oft_preferred_view', 'mobile');
    } catch (_) {}
    const checkbox = document.getElementById('checkbox-remember-mobile-switch');
    if (checkbox && checkbox.checked) {
      try {
        localStorage.setItem(MOBILE_DISMISS_KEY, 'mobile');
      } catch (_) {}
    }
    const search = window.location.search || '';
    window.location.href = 'editor.html' + search;
  }

  function dismissMobileSwitchModal() {
    mobilePromptDismissedThisSession = true;
    const checkbox = document.getElementById('checkbox-remember-mobile-switch');
    try {
      if (checkbox && checkbox.checked) {
        localStorage.setItem(MOBILE_DISMISS_KEY, 'stay');
      }
    } catch (_) {}

    if (window.Modal && typeof window.Modal.close === 'function') {
      window.Modal.close();
    }
  }

  let resizeMobileTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeMobileTimer);
    resizeMobileTimer = setTimeout(() => {
      if (isMobileOrSmallScreen()) {
        try {
          if (localStorage.getItem(MOBILE_DISMISS_KEY) === 'stay') return;
        } catch (_) {}
        const modalEl = document.getElementById('modal-switch-mobile');
        if (modalEl && !modalEl.classList.contains('is-active')) {
          if (window.Modal && typeof window.Modal.open === 'function') {
            window.Modal.open('modal-switch-mobile');
          }
        }
      }
    }, 300);
  });

  // Template Editor Auto-Open Fallback for Initial Import in Desktop Workstation
  function ensureTemplateEditorAutoOpens() {
    const searchParams = new URLSearchParams(window.location.search);
    const isTemplateParam = searchParams.get('template') === '1';
    if (isTemplateParam || (window.currentProjectState && window.currentProjectState.isTemplate)) {
      const tryOpen = (attempts = 0) => {
        if (window.FishTemplateEditor && typeof window.FishTemplateEditor.open === 'function') {
          window.FishTemplateEditor.open();
        } else if (attempts < 30) {
          setTimeout(() => tryOpen(attempts + 1), 100);
        }
      };
      setTimeout(() => tryOpen(0), 180);
    }
  }

  // Trigger mobile check immediately if DOM already loaded
  if (document.readyState !== 'loading') {
    checkAndPromptMobileSwitch();
    ensureTemplateEditorAutoOpens();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      checkAndPromptMobileSwitch();
      ensureTemplateEditorAutoOpens();
    });
  }

  window.proceedToMobileView = proceedToMobileView;
  window.dismissMobileSwitchModal = dismissMobileSwitchModal;
  window.checkAndPromptMobileSwitch = checkAndPromptMobileSwitch;
  window.ensureTemplateEditorAutoOpens = ensureTemplateEditorAutoOpens;

})();
