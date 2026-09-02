import { getProject, getTrackById, updateTrack } from '../state/project.js';
import { getState, subscribe } from '../state/store.js';
import { splitTrackAtPlayhead, trimLeftToPlayhead, trimRightToPlayhead, moveTrackToPlayhead, extendTrackToPlayhead } from '../timeline/clipManipulator.js';
import { renderEffectsPanel } from './effectsPanel.js';
import { t } from '../i18n/translator.js';

export function initInspectorDrawer(drawerEl) {
  if (!drawerEl) return;

  const quickTrimLeft = drawerEl.querySelector('[data-action="trim-left"]');
  const quickSplit = drawerEl.querySelector('[data-action="split"]');
  const quickTrimRight = drawerEl.querySelector('[data-action="trim-right"]');
  const quickMove = drawerEl.querySelector('[data-action="move"]');

  if (quickTrimLeft) {
    quickTrimLeft.addEventListener('click', () => {
      const id = getState().selectedTrackId;
      if (id) trimLeftToPlayhead(id);
    });
  }

  if (quickSplit) {
    quickSplit.addEventListener('click', () => {
      const id = getState().selectedTrackId;
      if (id) splitTrackAtPlayhead(id);
    });
  }

  if (quickTrimRight) {
    quickTrimRight.addEventListener('click', () => {
      const id = getState().selectedTrackId;
      if (id) trimRightToPlayhead(id);
    });
  }

  if (quickMove) {
    quickMove.addEventListener('click', () => {
      const id = getState().selectedTrackId;
      if (id) moveTrackToPlayhead(id);
    });
  }

  const tabBtns = drawerEl.querySelectorAll('.insp-tab-btn');
  const panes = drawerEl.querySelectorAll('.inspector-tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const activePane = drawerEl.querySelector(`.inspector-tab-pane[data-tab="${targetTab}"]`);
      if (activePane) activePane.classList.add('active');

      if (targetTab === 'effects') {
        const fxContainer = drawerEl.querySelector('#effectsContainer');
        if (fxContainer) renderEffectsPanel(fxContainer);
      }
    });
  });

  bindTransformInputs(drawerEl);

  subscribe('selectedTrackId', (id) => {
    if (id) {
      drawerEl.classList.add('active');
      populateTransformFields(drawerEl, id);
      populateLinkedLayers(drawerEl, id);
      const fxContainer = drawerEl.querySelector('#effectsContainer');
      if (fxContainer) renderEffectsPanel(fxContainer);
    } else {
      drawerEl.classList.remove('active');
    }
  });
}

function bindTransformInputs(drawerEl) {
  const inputs = drawerEl.querySelectorAll('.transform-input');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      const id = getState().selectedTrackId;
      const track = getTrackById(id);
      if (!track) return;

      const field = input.dataset.field;
      const val = parseFloat(input.value) || 0;
      const transform = { ...track.transform };

      if (field === 'posX') transform.position = { ...transform.position, x: val };
      else if (field === 'posY') transform.position = { ...transform.position, y: val };
      else if (field === 'posZ') transform.position = { ...transform.position, z: val };
      else if (field === 'rotX') transform.rotation = { ...transform.rotation, x: val };
      else if (field === 'rotY') transform.rotation = { ...transform.rotation, y: val };
      else if (field === 'rotZ') transform.rotation = { ...transform.rotation, z: val };
      else if (field === 'scale') transform.scale = { x: val, y: val, z: val };
      else if (field === 'opacity') transform.opacity = val;

      updateTrack(id, { transform });
    });
  });
}

function populateTransformFields(drawerEl, trackId) {
  const track = getTrackById(trackId);
  if (!track || !track.transform) return;

  const tf = track.transform;
  setInputValue(drawerEl, 'posX', tf.position?.x ?? 0);
  setInputValue(drawerEl, 'posY', tf.position?.y ?? 0);
  setInputValue(drawerEl, 'posZ', tf.position?.z ?? 0);
  setInputValue(drawerEl, 'rotX', tf.rotation?.x ?? 0);
  setInputValue(drawerEl, 'rotY', tf.rotation?.y ?? 0);
  setInputValue(drawerEl, 'rotZ', tf.rotation?.z ?? 0);
  setInputValue(drawerEl, 'scale', tf.scale?.x ?? 1);
  setInputValue(drawerEl, 'opacity', tf.opacity ?? 1);
}

function setInputValue(drawerEl, field, value) {
  const input = drawerEl.querySelector(`[data-field="${field}"]`);
  if (input) input.value = value;
}

function populateLinkedLayers(drawerEl, trackId) {
  const section = drawerEl.querySelector('#linkedLayersSection');
  const list = drawerEl.querySelector('#linkedLayersList');
  if (!section || !list) return;

  const project = getProject();
  const track = project.tracks.find(t => t.id === trackId);
  if (!track) return;

  list.innerHTML = '';
  let hasLinks = false;

  // Linked TO (this layer controls others)
  if (track.linkedTo && track.linkedTo.length > 0) {
    hasLinks = true;
    track.linkedTo.forEach(targetId => {
      const targetTrack = project.tracks.find(t => t.id === targetId);
      if (!targetTrack) return;

      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '8px';
      item.style.padding = '6px 8px';
      item.style.background = 'rgba(255,255,255,0.05)';
      item.style.borderRadius = '6px';
      item.style.cursor = 'pointer';
      item.style.transition = 'all 0.2s ease';
      item.style.border = '1px solid rgba(208,100,35,0.3)';

      const icon = document.createElement('div');
      icon.style.width = '20px';
      icon.style.height = '20px';
      icon.style.borderRadius = '4px';
      icon.style.background = targetTrack.colorTag && targetTrack.colorTag !== 'none' ? targetTrack.colorTag : '#5C2607';
      icon.style.display = 'flex';
      icon.style.alignItems = 'center';
      icon.style.justifyContent = 'center';
      icon.innerHTML = `<span class="material-symbols-rounded" style="font-size: 14px; color: white;">${targetTrack.type === 'shape' ? 'crop_square' : targetTrack.type === 'text' ? 'title' : 'videocam'}</span>`;

      const name = document.createElement('span');
      name.textContent = `${targetTrack.name} (controlled)`;
      name.style.fontSize = '12px';
      name.style.color = 'var(--col-text-primary, #FFF2C2)';
      name.style.flex = '1';

      const unlinkBtn = document.createElement('button');
      unlinkBtn.innerHTML = '✕';
      unlinkBtn.style.background = 'none';
      unlinkBtn.style.border = 'none';
      unlinkBtn.style.color = 'var(--col-primary, #D06423)';
      unlinkBtn.style.cursor = 'pointer';
      unlinkBtn.style.fontSize = '14px';
      unlinkBtn.style.padding = '2px 6px';
      unlinkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unlinkLayers(trackId, targetId);
        populateLinkedLayers(drawerEl, trackId);
      });

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(unlinkBtn);
      list.appendChild(item);
    });
  }

  // Linked FROM (others control this layer)
  if (track.linkedFrom && track.linkedFrom.length > 0) {
    hasLinks = true;
    track.linkedFrom.forEach(sourceId => {
      const sourceTrack = project.tracks.find(t => t.id === sourceId);
      if (!sourceTrack) return;

      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '8px';
      item.style.padding = '6px 8px';
      item.style.background = 'rgba(255,255,255,0.05)';
      item.style.borderRadius = '6px';
      item.style.cursor = 'pointer';
      item.style.transition = 'all 0.2s ease';
      item.style.border = '1px solid rgba(45,156,219,0.3)';

      const icon = document.createElement('div');
      icon.style.width = '20px';
      icon.style.height = '20px';
      icon.style.borderRadius = '4px';
      icon.style.background = sourceTrack.colorTag && sourceTrack.colorTag !== 'none' ? sourceTrack.colorTag : '#5C2607';
      icon.style.display = 'flex';
      icon.style.alignItems = 'center';
      icon.style.justifyContent = 'center';
      icon.innerHTML = `<span class="material-symbols-rounded" style="font-size: 14px; color: white;">${sourceTrack.type === 'shape' ? 'crop_square' : sourceTrack.type === 'text' ? 'title' : 'videocam'}</span>`;

      const name = document.createElement('span');
      name.textContent = `${sourceTrack.name} (controller)`;
      name.style.fontSize = '12px';
      name.style.color = 'var(--col-text-primary, #FFF2C2)';
      name.style.flex = '1';

      const unlinkBtn = document.createElement('button');
      unlinkBtn.innerHTML = '✕';
      unlinkBtn.style.background = 'none';
      unlinkBtn.style.border = 'none';
      unlinkBtn.style.color = 'var(--col-primary, #D06423)';
      unlinkBtn.style.cursor = 'pointer';
      unlinkBtn.style.fontSize = '14px';
      unlinkBtn.style.padding = '2px 6px';
      unlinkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unlinkLayers(sourceId, trackId);
        populateLinkedLayers(drawerEl, trackId);
      });

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(unlinkBtn);
      list.appendChild(item);
    });
  }

  section.style.display = hasLinks ? 'block' : 'none';
}

function unlinkLayers(sourceId, targetId) {
  const project = getProject();
  const sourceTrack = project.tracks.find(t => t.id === sourceId);
  const targetTrack = project.tracks.find(t => t.id === targetId);

  if (!sourceTrack || !targetTrack) return;

  if (sourceTrack.linkedTo) {
    const index = sourceTrack.linkedTo.indexOf(targetId);
    if (index !== -1) sourceTrack.linkedTo.splice(index, 1);
  }

  if (targetTrack.linkedFrom) {
    const index = targetTrack.linkedFrom.indexOf(sourceId);
    if (index !== -1) targetTrack.linkedFrom.splice(index, 1);
  }

  setProject(project);
}
