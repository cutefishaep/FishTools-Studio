import { initI18n } from './i18n/translator.js';
import { initStorage, loadProject, saveProject, scheduleAutoSave } from './state/storage.js';
import { getProject, setProject, createTrack, subscribeProject } from './state/project.js';
import { getState, setState, subscribe } from './state/store.js';
import { undo, redo, subscribeHistory } from './state/history.js';
import { initCompositor3D } from './engine/compositor3d.js';
import { toggleClock, seekClock } from './engine/clock.js';
import { registerEffect } from './engine/effects/effectRegistry.js';
import { ColorGradingEffect } from './engine/effects/colorGrading.js';
import { ChromaKeyEffect } from './engine/effects/chromaKey.js';
import { GlitchEffect } from './engine/effects/glitch.js';
import { TransformWiggleEffect } from './engine/effects/transformWiggle.js';
import { initTimeRuler } from './timeline/timeRuler.js';
import { initMarkerManager, toggleMarkerAtCurrent, skipToPreviousMarker, skipToNextMarker } from './timeline/markerManager.js';
import { initTrackManager } from './timeline/trackManager.js';
import { initScrubber } from './timeline/scrubber.js';
import { initTopNav } from './ui/topNav.js';
import { initInspectorDrawer } from './ui/inspectorDrawer.js';
import { initAddTrackPopover } from './ui/addTrackPopover.js';
import { initMultiSelectBar } from './ui/multiSelectBar.js';
import { initExporter } from './export/exporter.js';

document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();
  await initStorage();

  registerEffect(new ColorGradingEffect());
  registerEffect(new ChromaKeyEffect());
  registerEffect(new GlitchEffect());
  registerEffect(new TransformWiggleEffect());

  const activeId = sessionStorage.getItem('activeProjectId');
  if (activeId) {
    const loaded = await loadProject(activeId);
    if (loaded) setProject(loaded);
  } else {
    const rawCfg = sessionStorage.getItem('projectConfig');
    if (rawCfg) {
      try {
        const cfg = JSON.parse(rawCfg);
        setProject({
          name: cfg.name || 'My Project',
          aspectRatio: cfg.ratio || '16:9',
          resolution: cfg.resolution || '1080p',
          backgroundColor: cfg.backgroundColor || '#000000'
        });
      } catch (e) {}
    }
  }

  const project = getProject();
  if (project.tracks.length === 0) {
    createTrack('shape', 'Shape_Card', {
      startTime: 0,
      duration: 8,
      customData: { shapeType: 'rectangle', fillColor: '#D06423' },
      transform: { position: { x: -1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 1.5, z: 1 }, opacity: 1 }
    });
    createTrack('text', 'Title_3D', {
      startTime: 1,
      duration: 7,
      customData: { text: 'FishTools Studio', fontSize: 72, textColor: '#FFF2C2' },
      transform: { position: { x: 0, y: 0.8, z: 0.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 0.8, z: 1 }, opacity: 1 }
    });
  }

  const canvasWrap = document.getElementById('canvasWrap');
  if (canvasWrap) initCompositor3D(canvasWrap);

  const rulerMarks = document.getElementById('timeRulerMarks');
  if (rulerMarks) {
    initTimeRuler(rulerMarks);
    initMarkerManager(rulerMarks);
  }

  const trackContainer = document.getElementById('trackRowsContainer');
  if (trackContainer) initTrackManager(trackContainer);

  const tracksViewport = document.getElementById('tracksViewport');
  const timecodeBadge = document.getElementById('timecodeDisplay');
  if (tracksViewport && timecodeBadge && rulerMarks) {
    initScrubber(tracksViewport, timecodeBadge, rulerMarks);
  }

  const navEl = document.getElementById('editorNavbar');
  const topContextBar = document.getElementById('layerTopContextBar');
  initTopNav(navEl, topContextBar);

  const drawerEl = document.getElementById('layerInspectorDrawer');
  initInspectorDrawer(drawerEl);

  const addTrackPopover = document.getElementById('addTrackPopover');
  const fabAddTrack = document.getElementById('fabAddTrack');
  initAddTrackPopover(addTrackPopover, fabAddTrack);

  const multiSelectBar = document.getElementById('multiSelectHeaderBar');
  initMultiSelectBar(multiSelectBar);

  const exportModal = document.getElementById('exportModal');
  initExporter(exportModal);

  bindToolbarControls();

  subscribeProject((p) => {
    scheduleAutoSave(p);
  });
});

function bindToolbarControls() {
  const playBtns = document.querySelectorAll('.btn-play-main');
  playBtns.forEach(btn => {
    btn.addEventListener('click', () => toggleClock());
  });

  subscribe('playing', (isPlaying) => {
    playBtns.forEach(btn => {
      const icon = btn.querySelector('.material-symbols-rounded');
      if (icon) icon.textContent = isPlaying ? 'pause' : 'play_arrow';
    });
  });

  const undoBtns = document.querySelectorAll('[title="Undo"], [data-i18n-title="preview.undo"]');
  undoBtns.forEach(btn => {
    btn.addEventListener('click', () => undo());
  });

  const redoBtns = document.querySelectorAll('[title="Redo"], [data-i18n-title="preview.redo"]');
  redoBtns.forEach(btn => {
    btn.addEventListener('click', () => redo());
  });

  subscribeHistory(({ canUndo, canRedo }) => {
    undoBtns.forEach(b => b.disabled = !canUndo);
    redoBtns.forEach(b => b.disabled = !canRedo);
  });

  const skipPrevBtns = document.querySelectorAll('[title="Skip ke awal"], [title="Skip Previous"], [data-i18n-title="preview.skipPrev"]');
  skipPrevBtns.forEach(btn => {
    btn.addEventListener('click', () => skipToPreviousMarker());
  });

  const skipNextBtns = document.querySelectorAll('[title="Skip ke akhir"], [title="Skip Next"], [data-i18n-title="preview.skipNext"]');
  skipNextBtns.forEach(btn => {
    btn.addEventListener('click', () => skipToNextMarker());
  });

  const markerBtns = document.querySelectorAll('[title="Bookmark"], [data-i18n-title="preview.bookmark"]');
  markerBtns.forEach(btn => {
    btn.addEventListener('click', () => toggleMarkerAtCurrent());
  });

  const menuBtns = document.querySelectorAll('.btn-menu-toggle');
  menuBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const popover = document.getElementById('desktopMenuPopover') || document.getElementById('mobileMenuPopover');
      if (popover) popover.classList.toggle('active');
    });
  });

  document.addEventListener('click', () => {
    const p1 = document.getElementById('desktopMenuPopover');
    const p2 = document.getElementById('mobileMenuPopover');
    if (p1) p1.classList.remove('active');
    if (p2) p2.classList.remove('active');
  });

  const gridBtns = document.querySelectorAll('#btnToggleGridDesktop, #btnToggleGridMobile');
  gridBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const state = getState();
      const next = !state.isGridOn;
      setState({ isGridOn: next });
      const grid = document.getElementById('canvasGridOverlay');
      if (grid) grid.classList.toggle('active', next);
      btn.classList.toggle('active', next);
    });
  });

  const qualityBtns = document.querySelectorAll('#btnToggleQualityDesktop, #btnToggleQualityMobile');
  qualityBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const state = getState();
      const next = !state.isDraftQuality;
      setState({ isDraftQuality: next });
      const badge = document.getElementById('canvasQualityBadge');
      if (badge) badge.classList.toggle('active', next);
      btn.classList.toggle('active', next);
    });
  });

  const zoomInBtns = document.querySelectorAll('#btnZoomInDesktop, #btnZoomInMobile');
  const zoomOutBtns = document.querySelectorAll('#btnZoomOutDesktop, #btnZoomOutMobile');
  const zoomLabels = document.querySelectorAll('#zoomValueDesktop, #zoomValueMobile');

  zoomInBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const state = getState();
      if (state.zoomIndex < state.zoomLevels.length - 1) {
        const nextIdx = state.zoomIndex + 1;
        setState({ zoomIndex: nextIdx });
        applyZoom(state.zoomLevels[nextIdx], zoomLabels);
      }
    });
  });

  zoomOutBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const state = getState();
      if (state.zoomIndex > 0) {
        const nextIdx = state.zoomIndex - 1;
        setState({ zoomIndex: nextIdx });
        applyZoom(state.zoomLevels[nextIdx], zoomLabels);
      }
    });
  });
}

function applyZoom(level, labels) {
  const canvasScreen = document.getElementById('canvasScreen');
  if (canvasScreen) canvasScreen.style.transform = `scale(${level})`;
  labels.forEach(l => l.textContent = `${Math.round(level * 100)}%`);
}
