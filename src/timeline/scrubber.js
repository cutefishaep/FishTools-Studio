import { getState, subscribe } from '../state/store.js';
import { seekClock } from '../engine/clock.js';

let viewportEl = null;
let timecodeEl = null;
let rulerMarksEl = null;

export function initScrubber(viewport, timecodeBadge, rulerMarks) {
  viewportEl = viewport;
  timecodeEl = timecodeBadge;
  rulerMarksEl = rulerMarks;

  if (viewportEl) {
    let isDragging = false;
    let startX = 0;
    let initialOffset = 0;

    viewportEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('.clip-extend-handle') || e.target.closest('.timeline-marker-pin')) return;
      isDragging = true;
      startX = e.clientX;
      initialOffset = getState().timelineOffset;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = startX - e.clientX;
      const state = getState();
      const newOffset = Math.max(0, Math.min(state.totalDuration * state.scalePxPerSec, initialOffset + dx));
      const newTime = newOffset / state.scalePxPerSec;
      seekClock(newTime);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  subscribe('currentTime', updateTimecode);
  subscribe('timelineOffset', updateRulerPosition);
  updateTimecode(getState().currentTime);
}

function updateTimecode(time) {
  if (!timecodeEl) return;
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  const ms = Math.floor((time % 1) * 100);
  timecodeEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(ms).padStart(2, '0')}`;
}

function updateRulerPosition(offset) {
  if (rulerMarksEl) {
    rulerMarksEl.style.transform = `translateX(-${offset}px)`;
  }
}
