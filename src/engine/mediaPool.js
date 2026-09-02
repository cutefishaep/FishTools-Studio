const videoElements = new Map();
const audioElements = new Map();
const textureCache = new Map();

export function getOrCreateVideo(id, src) {
  if (videoElements.has(id)) {
    const existing = videoElements.get(id);
    if (src && existing.src !== src) {
      existing.src = src;
      existing.load();
    }
    return existing;
  }
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.muted = true;
  video.preload = 'auto';
  if (src) {
    video.src = src;
    video.load();
  }
  videoElements.set(id, video);
  return video;
}

export function getOrCreateAudio(id, src) {
  if (audioElements.has(id)) {
    const existing = audioElements.get(id);
    if (src && existing.src !== src) {
      existing.src = src;
      existing.load();
    }
    return existing;
  }
  const audio = new Audio();
  audio.preload = 'auto';
  if (src) {
    audio.src = src;
    audio.load();
  }
  audioElements.set(id, audio);
  return audio;
}

export function cacheTexture(key, texture) {
  textureCache.set(key, texture);
}

export function getCachedTexture(key) {
  return textureCache.get(key) || null;
}

export function releaseMedia(id) {
  if (videoElements.has(id)) {
    const v = videoElements.get(id);
    v.pause();
    v.removeAttribute('src');
    v.load();
    videoElements.delete(id);
  }
  if (audioElements.has(id)) {
    const a = audioElements.get(id);
    a.pause();
    a.removeAttribute('src');
    a.load();
    audioElements.delete(id);
  }
  if (textureCache.has(id)) {
    const t = textureCache.get(id);
    if (t && typeof t.dispose === 'function') t.dispose();
    textureCache.delete(id);
  }
}

export function clearMediaPool() {
  for (const [id] of videoElements) {
    releaseMedia(id);
  }
}
