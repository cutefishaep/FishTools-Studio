let activeProject = {
  id: 'proj_' + Date.now(),
  name: 'My Project',
  aspectRatio: '16:9',
  resolution: '1080p',
  fps: 30,
  duration: 30,
  backgroundColor: '#000000',
  tracks: []
};

const projectListeners = new Set();

export function getProject() {
  return activeProject;
}

export function setProject(newProjectData) {
  activeProject = { ...activeProject, ...newProjectData };
  notifyProjectChange();
}

export function createTrack(type, name, options = {}) {
  const track = {
    id: 'track_' + Math.random().toString(36).substr(2, 9),
    name: name || `${type}_layer`,
    type: type || 'shape',
    startTime: options.startTime || 0,
    duration: options.duration || 5,
    visible: true,
    locked: false,
    colorTag: 'none',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      opacity: 1
    },
    borderShadow: {
      stroke: { enabled: false, color: '#000000', size: 4, cap: 'butt', align: 'center' },
      shadow: { enabled: false, color: '#000000', size: 4, alpha: 100, posX: 3, posY: 3 }
    },
    effects: [],
    customData: options.customData || {},
    ...options
  };

  track.linkedTo = [];
  activeProject.tracks.unshift(track);
  notifyProjectChange();
  return track;
}

export function updateTrack(trackId, updates) {
  const index = activeProject.tracks.findIndex(t => t.id === trackId);
  if (index !== -1) {
    activeProject.tracks[index] = {
      ...activeProject.tracks[index],
      ...updates
    };
    notifyProjectChange();
    return activeProject.tracks[index];
  }
  return null;
}

export function removeTrack(trackId) {
  const index = activeProject.tracks.findIndex(t => t.id === trackId);
  if (index !== -1) {
    const removed = activeProject.tracks.splice(index, 1)[0];
    notifyProjectChange();
    return removed;
  }
  return null;
}

export function getTrackById(trackId) {
  return activeProject.tracks.find(t => t.id === trackId) || null;
}

export function reorderTracks(newOrderedIds) {
  const map = new Map(activeProject.tracks.map(t => [t.id, t]));
  const reordered = [];
  for (const id of newOrderedIds) {
    if (map.has(id)) reordered.push(map.get(id));
  }
  activeProject.tracks = reordered;
  notifyProjectChange();
}

export function subscribeProject(fn) {
  projectListeners.add(fn);
  return () => projectListeners.delete(fn);
}

function notifyProjectChange() {
  for (const fn of projectListeners) {
    fn(activeProject);
  }
}
