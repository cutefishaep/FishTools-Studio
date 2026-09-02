import { getState, setState, subscribe } from '../state/store.js';
import { seekClock } from '../engine/clock.js';
import { recordAction } from '../state/history.js';
import { t } from '../i18n/translator.js';

let rulerMarksContainer = null;

export function initMarkerManager(rulerContainer) {
  rulerMarksContainer = rulerContainer;
  subscribe('markers', renderMarkers);
  subscribe('scalePxPerSec', renderMarkers);
  renderMarkers(getState().markers);
}

export function toggleMarkerAtCurrent() {
  const state = getState();
  const curTime = Math.round(state.currentTime * 10) / 10;
  const existingIdx = state.markers.findIndex(m => Math.abs(m - curTime) <= 0.2);

  const updated = [...state.markers];
  if (existingIdx >= 0) {
    const removed = updated.splice(existingIdx, 1)[0];
    setState({ markers: updated });
    recordAction({
      type: 'REMOVE_MARKER',
      undo: () => {
        const list = [...getState().markers, removed].sort((a, b) => a - b);
        setState({ markers: list });
      },
      redo: () => {
        const list = getState().markers.filter(m => m !== removed);
        setState({ markers: list });
      }
    });
  } else {
    updated.push(curTime);
    updated.sort((a, b) => a - b);
    setState({ markers: updated });
    recordAction({
      type: 'ADD_MARKER',
      undo: () => {
        const list = getState().markers.filter(m => m !== curTime);
        setState({ markers: list });
      },
      redo: () => {
        const list = [...getState().markers, curTime].sort((a, b) => a - b);
        setState({ markers: list });
      }
    });
  }
}

export function skipToPreviousMarker() {
  const state = getState();
  const cur = state.currentTime;
  const prev = state.markers.filter(m => m < cur - 0.2);
  if (prev.length > 0) {
    seekClock(prev[prev.length - 1]);
  } else {
    seekClock(0);
  }
}

export function skipToNextMarker() {
  const state = getState();
  const cur = state.currentTime;
  const next = state.markers.find(m => m > cur + 0.2);
  if (next !== undefined) {
    seekClock(next);
  } else {
    seekClock(state.totalDuration);
  }
}

function renderMarkers(markers = []) {
  if (!rulerMarksContainer) return;
  const oldPins = rulerMarksContainer.querySelectorAll('.timeline-marker-pin');
  oldPins.forEach(p => p.remove());

  const scale = getState().scalePxPerSec;
  for (const sec of markers) {
    const pin = document.createElement('div');
    pin.className = 'timeline-marker-pin';
    pin.style.left = `${sec * scale}px`;
    pin.title = t('timeline.marker', { time: sec.toFixed(1) + 's' });
    pin.innerHTML = `
      <div class="marker-diamond"></div>
      <div class="marker-line"></div>
    `;
    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      seekClock(sec);
    });
    rulerMarksContainer.appendChild(pin);
  }
}
