import { getState, subscribe } from '../state/store.js';

export function initTimeRuler(container) {
  if (!container) return;

  function renderRuler() {
    const state = getState();
    const totalSec = Math.ceil(state.totalDuration);
    const pxPerSec = state.scalePxPerSec;
    container.innerHTML = '';
    container.style.width = `${totalSec * pxPerSec}px`;

    const fragment = document.createDocumentFragment();

    for (let s = 0; s <= totalSec; s++) {
      const mark = document.createElement('div');
      mark.className = 'ruler-tick major';
      mark.style.left = `${s * pxPerSec}px`;

      const label = document.createElement('span');
      label.className = 'ruler-tick-label';
      label.textContent = formatRulerTime(s);
      mark.appendChild(label);
      fragment.appendChild(mark);

      if (s < totalSec) {
        for (let sub = 1; sub <= 3; sub++) {
          const subTick = document.createElement('div');
          subTick.className = 'ruler-tick';
          subTick.style.left = `${(s + sub * 0.25) * pxPerSec}px`;
          fragment.appendChild(subTick);
        }
      }
    }

    container.appendChild(fragment);
  }

  subscribe('totalDuration', renderRuler);
  subscribe('scalePxPerSec', renderRuler);
  renderRuler();
}

function formatRulerTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
