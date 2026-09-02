import { getProject, subscribeProject, updateTrack } from '../state/project.js';
import { getState, setState, subscribe } from '../state/store.js';
import { bindClipDragHandles } from './clipManipulator.js';
import { t } from '../i18n/translator.js';

let containerEl = null;

export function initTrackManager(container) {
  containerEl = container;
  subscribeProject(renderTracks);
  subscribe('timelineOffset', updateTrackwayPositions);
  subscribe('selectedTrackId', updateSelectionUI);
  subscribe('scalePxPerSec', renderTracks);
  renderTracks(getProject());
}

export function renderTracks(project = getProject()) {
  if (!containerEl) return;
  const state = getState();
  const scale = state.scalePxPerSec;
  const currentOffset = state.timelineOffset;

  containerEl.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const track of project.tracks) {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.dataset.trackId = track.id;
    if (state.selectedTrackId === track.id) row.classList.add('selected');

    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.className = `track-eye ${!track.visible ? 'hidden-layer' : ''}`;
    eyeBtn.title = t('timeline.toggleEye');
    eyeBtn.innerHTML = `<span class="material-symbols-rounded">${track.visible ? 'visibility' : 'visibility_off'}</span>`;
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newVis = !track.visible;
      updateTrack(track.id, { visible: newVis });
    });

    const trackway = document.createElement('div');
    trackway.className = 'track-trackway';
    trackway.style.transform = `translateX(-${currentOffset}px)`;

    const clip = document.createElement('div');
    clip.className = 'track-clip';
    clip.style.marginLeft = `${track.startTime * scale}px`;
    clip.style.width = `${track.duration * scale}px`;
    if (track.colorTag && track.colorTag !== 'none') {
      clip.style.backgroundColor = track.colorTag;
    }

    const isLinked = (track.linkedTo && track.linkedTo.length > 0) || (track.linkedFrom && track.linkedFrom.length > 0);
    clip.innerHTML = `
      <div class="clip-extend-handle handle-left" title="${t('timeline.extendLeft')}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"/></svg>
      </div>
      <span class="track-clip-name">${track.name}</span>
      ${isLinked ? `<span class="track-link-indicator" style="margin-left: 4px; color: var(--col-primary, #D06423); font-size: 10px;">↔</span>` : ''}
      <div class="clip-extend-handle handle-right" title="${t('timeline.extendRight')}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    `;

    clip.addEventListener('click', (e) => {
      e.stopPropagation();
      setState({ selectedTrackId: track.id });
    });

    trackway.appendChild(clip);

    const reorderHandle = document.createElement('button');
    reorderHandle.type = 'button';
    reorderHandle.className = 'track-reorder-handle';
    reorderHandle.title = t('timeline.reorder');
    reorderHandle.innerHTML = `<span class="material-symbols-rounded">menu</span>`;

    row.appendChild(eyeBtn);
    row.appendChild(trackway);
    row.appendChild(reorderHandle);

    bindClipDragHandles(row, track);
    fragment.appendChild(row);
  }

  containerEl.appendChild(fragment);
}

function updateTrackwayPositions(offset) {
  if (!containerEl) return;
  const trackways = containerEl.querySelectorAll('.track-trackway');
  for (let i = 0; i < trackways.length; i++) {
    trackways[i].style.transform = `translateX(-${offset}px)`;
  }
}

function updateSelectionUI(selectedId) {
  if (!containerEl) return;
  const rows = containerEl.querySelectorAll('.track-row');
  rows.forEach(r => {
    r.classList.toggle('selected', r.dataset.trackId === selectedId);
  });
}
