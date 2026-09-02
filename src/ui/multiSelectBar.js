import { getProject, updateTrack } from '../state/project.js';
import { getState, setState, subscribe } from '../state/store.js';

export function initMultiSelectBar(barEl) {
  if (!barEl) return;

  const btnExit = document.getElementById('btnExitMultiSelect');
  const btnToggleAlign = document.getElementById('btnToggleAlignMenu');
  const mainBar = document.getElementById('multiHeaderMain');
  const alignBar = document.getElementById('multiHeaderAlign');
  const btnBackGroup = document.getElementById('btnBackToGroupMenu');

  if (btnExit) {
    btnExit.addEventListener('click', () => {
      setState({ isMultiSelectMode: false, selectedTrackIds: new Set() });
    });
  }

  if (btnToggleAlign && mainBar && alignBar) {
    btnToggleAlign.addEventListener('click', () => {
      mainBar.style.display = 'none';
      alignBar.classList.add('active');
    });
  }

  if (btnBackGroup && mainBar && alignBar) {
    btnBackGroup.addEventListener('click', () => {
      alignBar.classList.remove('active');
      mainBar.style.display = 'flex';
    });
  }

  const alignBtns = barEl.querySelectorAll('[data-align]');
  alignBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.align;
      applyAlignment(mode);
    });
  });

  subscribe('isMultiSelectMode', (active) => {
    barEl.classList.toggle('active', !!active);
  });
}

function applyAlignment(mode) {
  const state = getState();
  const selectedIds = Array.from(state.selectedTrackIds);
  if (selectedIds.length < 2) return;

  const project = getProject();
  const selectedTracks = project.tracks.filter(t => selectedIds.includes(t.id));
  if (selectedTracks.length === 0) return;

  if (mode === 'left') {
    const minX = Math.min(...selectedTracks.map(t => t.transform.position.x));
    selectedTracks.forEach(t => {
      const tf = { ...t.transform, position: { ...t.transform.position, x: minX } };
      updateTrack(t.id, { transform: tf });
    });
  } else if (mode === 'center') {
    const avgX = selectedTracks.reduce((acc, t) => acc + t.transform.position.x, 0) / selectedTracks.length;
    selectedTracks.forEach(t => {
      const tf = { ...t.transform, position: { ...t.transform.position, x: avgX } };
      updateTrack(t.id, { transform: tf });
    });
  } else if (mode === 'right') {
    const maxX = Math.max(...selectedTracks.map(t => t.transform.position.x));
    selectedTracks.forEach(t => {
      const tf = { ...t.transform, position: { ...t.transform.position, x: maxX } };
      updateTrack(t.id, { transform: tf });
    });
  }
}
