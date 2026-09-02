const state = {
  currentTime: 0,
  timelineOffset: 0,
  totalDuration: 30,
  scalePxPerSec: 80,
  playing: false,
  zoomIndex: 2,
  zoomLevels: [0.6, 0.8, 1.0, 1.25, 1.5, 1.8],
  isDraftQuality: false,
  isGridOn: false,
  selectedTrackId: null,
  selectedTrackIds: new Set(),
  isMultiSelectMode: false,
  markers: []
};

const listeners = new Map();

export function getState() {
  return state;
}

export function setState(updates) {
  let hasChanges = false;
  const changedKeys = [];

  for (const [key, value] of Object.entries(updates)) {
    if (state[key] !== value) {
      state[key] = value;
      hasChanges = true;
      changedKeys.push(key);
    }
  }

  if (hasChanges) {
    for (const key of changedKeys) {
      if (listeners.has(key)) {
        for (const fn of listeners.get(key)) {
          fn(state[key], state);
        }
      }
    }
    if (listeners.has('*')) {
      for (const fn of listeners.get('*')) {
        fn(state, changedKeys);
      }
    }
  }
}

export function subscribe(key, callback) {
  if (!listeners.has(key)) {
    listeners.set(key, new Set());
  }
  listeners.get(key).add(callback);
  return () => listeners.get(key).delete(callback);
}
