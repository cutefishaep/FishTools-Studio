import { getState } from '../state/store.js';
import { getTrackById, updateTrack, createTrack, removeTrack } from '../state/project.js';
import { recordAction } from '../state/history.js';

export function splitTrackAtPlayhead(trackId) {
  const state = getState();
  const track = getTrackById(trackId);
  if (!track) return;

  const playhead = state.currentTime;
  if (playhead <= track.startTime || playhead >= (track.startTime + track.duration)) return;

  const originalDuration = track.duration;
  const leftDuration = playhead - track.startTime;
  const rightDuration = originalDuration - leftDuration;

  updateTrack(trackId, { duration: leftDuration });

  const rightTrack = createTrack(track.type, `${track.name}_cut`, {
    startTime: playhead,
    duration: rightDuration,
    transform: JSON.parse(JSON.stringify(track.transform)),
    effects: JSON.parse(JSON.stringify(track.effects)),
    customData: JSON.parse(JSON.stringify(track.customData))
  });

  recordAction({
    type: 'SPLIT_TRACK',
    undo: () => {
      updateTrack(trackId, { duration: originalDuration });
      removeTrack(rightTrack.id);
    },
    redo: () => {
      updateTrack(trackId, { duration: leftDuration });
      createTrack(rightTrack.type, rightTrack.name, rightTrack);
    }
  });
}

export function trimLeftToPlayhead(trackId) {
  const state = getState();
  const track = getTrackById(trackId);
  if (!track) return;

  const playhead = state.currentTime;
  const oldStart = track.startTime;
  const oldDuration = track.duration;
  const oldEnd = oldStart + oldDuration;

  if (playhead <= oldStart || playhead >= oldEnd) return;

  const newStart = playhead;
  const newDuration = oldEnd - newStart;

  updateTrack(trackId, { startTime: newStart, duration: newDuration });

  recordAction({
    type: 'TRIM_LEFT',
    undo: () => updateTrack(trackId, { startTime: oldStart, duration: oldDuration }),
    redo: () => updateTrack(trackId, { startTime: newStart, duration: newDuration })
  });
}

export function trimRightToPlayhead(trackId) {
  const state = getState();
  const track = getTrackById(trackId);
  if (!track) return;

  const playhead = state.currentTime;
  const oldStart = track.startTime;
  const oldDuration = track.duration;

  if (playhead <= oldStart || playhead >= (oldStart + oldDuration)) return;

  const newDuration = playhead - oldStart;
  updateTrack(trackId, { duration: newDuration });

  recordAction({
    type: 'TRIM_RIGHT',
    undo: () => updateTrack(trackId, { duration: oldDuration }),
    redo: () => updateTrack(trackId, { duration: newDuration })
  });
}

export function moveTrackToPlayhead(trackId) {
  const state = getState();
  const track = getTrackById(trackId);
  if (!track) return;

  const oldStart = track.startTime;
  const newStart = Math.max(0, state.currentTime);

  updateTrack(trackId, { startTime: newStart });

  recordAction({
    type: 'MOVE_TRACK',
    undo: () => updateTrack(trackId, { startTime: oldStart }),
    redo: () => updateTrack(trackId, { startTime: newStart })
  });
}

export function extendTrackToPlayhead(trackId) {
  const state = getState();
  const track = getTrackById(trackId);
  if (!track) return;

  const playhead = state.currentTime;
  const oldStart = track.startTime;
  const oldDuration = track.duration;
  const oldEnd = oldStart + oldDuration;

  if (playhead > oldEnd) {
    const newDuration = playhead - oldStart;
    updateTrack(trackId, { duration: newDuration });
    recordAction({
      type: 'EXTEND_RIGHT',
      undo: () => updateTrack(trackId, { duration: oldDuration }),
      redo: () => updateTrack(trackId, { duration: newDuration })
    });
  } else if (playhead < oldStart) {
    const newStart = playhead;
    const newDuration = oldEnd - newStart;
    updateTrack(trackId, { startTime: newStart, duration: newDuration });
    recordAction({
      type: 'EXTEND_LEFT',
      undo: () => updateTrack(trackId, { startTime: oldStart, duration: oldDuration }),
      redo: () => updateTrack(trackId, { startTime: newStart, duration: newDuration })
    });
  }
}

export function bindClipDragHandles(rowElement, track) {
  const clipEl = rowElement.querySelector('.track-clip');
  const leftHandle = rowElement.querySelector('.handle-left');
  const rightHandle = rowElement.querySelector('.handle-right');
  if (!clipEl) return;

  const scale = getState().scalePxPerSec;

  if (leftHandle) {
    leftHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const initStart = track.startTime;
      const initDur = track.duration;

      function onMove(ev) {
        const dx = (ev.clientX - startX) / scale;
        const newStart = Math.max(0, Math.min(initStart + initDur - 0.2, initStart + dx));
        const newDur = (initStart + initDur) - newStart;
        updateTrack(track.id, { startTime: newStart, duration: newDur });
      }

      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  if (rightHandle) {
    rightHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const initDur = track.duration;

      function onMove(ev) {
        const dx = (ev.clientX - startX) / scale;
        const newDur = Math.max(0.2, initDur + dx);
        updateTrack(track.id, { duration: newDur });
      }

      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }
}
