(function checkProjectRouting() {
  if (typeof window === 'undefined' || !window.location) return;

  const urlParams = new URLSearchParams(window.location.search);
  const queryId = urlParams.get('project');
  const sessionId = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('activeProjectId') : null;
  const importedData = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('importedProjectData') : null;

  const activeId = queryId || sessionId;
  if (!activeId && !importedData) {
    window.location.replace('index.html?openModal=true');
    return;
  }

  if (activeId) {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('activeProjectId', activeId);
    window.currentProjectId = activeId;
    if (window.history && window.history.replaceState && !window.location.search.includes('project=')) {
      try {
        window.history.replaceState(null, '', 'editor.html?project=' + activeId);
      } catch (_) {}
    }
  }
})();
window.FishLoading = {
  currentProgress: 0,
  isFinished: false,
  _isWarmingUp: false,

  init() {
    const rawName = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('activeProject')) || 'My Project';
    const nameEl = document.getElementById('loadingProjectName');
    if (nameEl) nameEl.textContent = rawName;
    this.update(10, 'Menginisialisasi editor engine...');
    this.log('[ENGINE] FishTool Studio 2D/3D Hybrid Engine diinisialisasi.', 'info');
  },

  log(message, type = 'info') {
    const scrollEl = document.getElementById('loadingLogsScroll');
    if (!scrollEl) return;
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    const entry = document.createElement('div');
    entry.className = `loading-log-entry ${type}`;
    entry.textContent = `[${time}] ${message}`;
    scrollEl.appendChild(entry);
    scrollEl.scrollTop = scrollEl.scrollHeight;
  },

  update(percent, statusText) {
    if (this.isFinished) return;
    const clamped = Math.max(this.currentProgress, Math.min(100, Math.round(percent)));
    this.currentProgress = clamped;

    const fillEl = document.getElementById('loadingProgressBar');
    const pctEl = document.getElementById('loadingPercentText');
    const statusEl = document.getElementById('loadingStatusText');
    const nameEl = document.getElementById('loadingProjectName');

    if (fillEl) fillEl.style.width = `${clamped}%`;
    if (pctEl) pctEl.textContent = `${clamped}%`;
    if (statusEl && statusText) statusEl.textContent = statusText;
    if (nameEl && (!nameEl.textContent || nameEl.textContent === 'My Project')) {
      const liveName = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('activeProject')) || document.getElementById('activeTitle')?.textContent || '';
      if (liveName) nameEl.textContent = liveName;
    }
  },

  async preloadImageSource(src) {
    return new Promise((resolve) => {
      if (!src || src.startsWith('video_pkg_') || src.startsWith('pkg_')) {
        resolve();
        return;
      }
      const resolved = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(src) : src;
      if (!resolved || (!resolved.startsWith('http://') && !resolved.startsWith('https://') && !resolved.startsWith('blob:') && !resolved.startsWith('data:'))) {
        resolve();
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(resolve, 3000);
      img.onload = () => {
        clearTimeout(timer);
        if (typeof img.decode === 'function') {
          img.decode().then(resolve).catch(resolve);
        } else {
          resolve();
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      img.src = resolved;
    });
  },

  async warmUpGroupComposite(groupId, groupData) {
    return new Promise((resolve) => {
      try {
        if (typeof renderGroupCompositeTexture === 'function') {
          const timeout = setTimeout(resolve, 3500);
          renderGroupCompositeTexture(groupId, groupData, 1024, (groupCanvas) => {
            clearTimeout(timeout);
            const mesh = (typeof meshLayerMap !== 'undefined') ? meshLayerMap.get(groupId) : null;
            if (mesh && mesh.material) {
              if (mesh.material.map) {
                mesh.material.map.image = groupCanvas;
                mesh.material.map.needsUpdate = true;
              } else if (typeof THREE !== 'undefined') {
                const tex = new THREE.CanvasTexture(groupCanvas);
                tex.minFilter = THREE.LinearFilter;
                tex.magFilter = THREE.LinearFilter;
                mesh.material.map = tex;
                mesh.material.needsUpdate = true;
              }
            }
            resolve();
          }, 0);
        } else {
          resolve();
        }
      } catch (_) {
        resolve();
      }
    });
  },

  async startFullPreloadAndWarmUp() {
    if (this._isWarmingUp || this.isFinished) return;
    this._isWarmingUp = true;

    try {
      this.update(20, 'Membaca konfigurasi & struktur layer...');
      this.log('[STATE] Membaca layer timeline dan konfigurasi proyek...', 'info');
      this.update(35, 'Memuat database media & paket video...');
      this.log('[IDB] Membuka IndexedDB & memvalidasi cache media...', 'info');
      if (typeof window.initGlobalMediaLibraryPromise !== 'undefined') {
        try { await window.initGlobalMediaLibraryPromise; } catch(_) {}
      }
      const mediaUrlsToPreload = new Set();
      if (typeof layerFills !== 'undefined') {
        layerFills.forEach((fill) => {
          if (fill && fill.type === 'media' && fill.mediaUrl) {
            mediaUrlsToPreload.add(fill.mediaUrl);
          }
        });
      }
      if (typeof layerGroupData !== 'undefined') {
        layerGroupData.forEach((gd) => {
          if (gd && gd.fills) {
            gd.fills.forEach(([cid, fill]) => {
              if (fill && fill.type === 'media' && fill.mediaUrl) {
                mediaUrlsToPreload.add(fill.mediaUrl);
              }
            });
          }
        });
      }

      const urlArray = Array.from(mediaUrlsToPreload);
      let loadedCount = 0;
      if (urlArray.length > 0) {
        this.update(45, `Mendekode aset gambar (0/${urlArray.length})...`);
        this.log(`[ASSETS] Mendekode ${urlArray.length} aset gambar via browser image decoder...`, 'info');
        await Promise.all(urlArray.map(async (url) => {
          await this.preloadImageSource(url);
          loadedCount++;
          const pct = 45 + Math.round((loadedCount / urlArray.length) * 35);
          this.update(pct, `Mendekode aset gambar (${loadedCount}/${urlArray.length})...`);
        }));
        this.log(`[ASSETS] Semua ${urlArray.length} aset gambar berhasil didekode.`, 'success');
      } else {
        this.update(80, 'Aset gambar siap...');
      }
      if (typeof videoFrameSequenceMap !== 'undefined' && typeof renderer3D !== 'undefined' && renderer3D) {
        const activeVideoKeys = new Set();
        document.querySelectorAll('.track-row').forEach(row => {
          const id = row.dataset.layerId;
          const fill = (typeof getLayerFill === 'function') ? getLayerFill(id) : (typeof layerFills !== 'undefined' ? layerFills.get(id) : null);
          const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
          if (fill && fill.type === 'media' && fill.mediaUrl) {
            activeVideoKeys.add(fill.mediaUrl);
          }
          if (clipName) activeVideoKeys.add(clipName);
          if (id) activeVideoKeys.add(id);
        });
        if (typeof layerGroupData !== 'undefined') {
          layerGroupData.forEach((gd) => {
            if (gd && gd.fills) {
              gd.fills.forEach(([cid, fill]) => {
                if (fill && fill.type === 'media' && fill.mediaUrl) {
                  activeVideoKeys.add(fill.mediaUrl);
                }
              });
            }
          });
        }
        const uniqueActiveSequences = new Set();
        for (const key of activeVideoKeys) {
          const seq = videoFrameSequenceMap.get(key);
          if (seq && seq.frames && seq.frames.length > 0) {
            uniqueActiveSequences.add(seq);
          }
        }

        const allSequences = Array.from(uniqueActiveSequences);
        let totalFrames = 0;
        allSequences.forEach(seq => { if (seq && seq.frames) totalFrames += seq.frames.length; });
        
        if (totalFrames > 0 && typeof THREE !== 'undefined') {
          this.update(81, `Memproses memori GPU untuk video timeline (0/${totalFrames})...`);
          this.log(`[GPU] Mengalokasikan ${totalFrames} frame video timeline ke VRAM...`, 'info');
          let processedFrames = 0;
          const dummyTex = new THREE.Texture(document.createElement('canvas'));
          dummyTex.colorSpace = THREE.SRGBColorSpace;
          dummyTex.minFilter = THREE.LinearFilter;
          dummyTex.magFilter = THREE.LinearFilter;
          dummyTex.generateMipmaps = false;
          const dummyMat = new THREE.MeshBasicMaterial({ map: dummyTex });
          const dummyMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dummyMat);
          const dummyScene = new THREE.Scene();
          dummyScene.add(dummyMesh);
          const dummyCamera = new THREE.PerspectiveCamera();
          const BATCH_SIZE = 12;
          let batchCounter = 0;

          for (const seq of allSequences) {
            if (!seq || !seq.frames) continue;
            for (const frame of seq.frames) {
              if (!frame) continue;
              dummyTex.image = frame;
              dummyTex.needsUpdate = true;
              
              if (typeof renderer3D.initTexture === 'function') {
                renderer3D.initTexture(dummyTex);
              } else {
                renderer3D.render(dummyScene, dummyCamera);
              }

              processedFrames++;
              batchCounter++;

              if (batchCounter >= BATCH_SIZE || processedFrames === totalFrames) {
                batchCounter = 0;
                const pct = 81 + Math.round((processedFrames / totalFrames) * 7);
                this.update(pct, `Memproses memori GPU untuk video (${processedFrames}/${totalFrames})...`);
                await new Promise(r => requestAnimationFrame(r));
              }
            }
          }
          dummyTex.dispose();
          dummyMat.dispose();
          dummyMesh.geometry.dispose();
          this.log(`[GPU] ${totalFrames} frame video timeline berhasil dialokasikan ke VRAM.`, 'success');
        } else {
          this.log('[GPU] Tidak ada layer video aktif di timeline, melewati alokasi VRAM.', 'info');
        }
      }
      this.update(90, 'Merender sub-komposisi grup & WebGL...');
      this.log('[RENDER] Kompilasi shader Three.js WebGL & sub-komposisi grup...', 'info');
      if (typeof syncThreeLayers === 'function') syncThreeLayers();
      if (typeof render3D === 'function') render3D();
      this.log('[RENDER] WebGL Stage siap.', 'success');
      this.update(98, 'Menyelesaikan setup visual...');
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => setTimeout(r, 60));

      this.log('[READY] Proyek siap digunakan!', 'success');
      this.finish();
    } catch (err) {
      console.warn('Preload & warm-up error:', err);
      this.log(`[ERROR] Terjadi kendala warm-up: ${err.message}`, 'warn');
      this.finish();
    }
  },

  finish() {
    if (this.isFinished) return;
    this.update(100, 'Proyek siap!');
    this.isFinished = true;
    setTimeout(() => {
      const screen = document.getElementById('projectLoadingScreen');
      if (screen) {
        screen.classList.add('hidden');
        setTimeout(() => {
          screen.style.display = 'none';
        }, 450);
      }
    }, 350);
  }
};
if (typeof document !== 'undefined') {
  window.FishLoading.init();
}

let _mediaDbPromise = null;
function getMediaDB() {
  if (!_mediaDbPromise) {
    _mediaDbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('fishTool_media_db', 2);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('media_items')) {
            db.createObjectStore('media_items', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('video_packages')) {
            db.createObjectStore('video_packages', { keyPath: 'id' });
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }
  return _mediaDbPromise;
}

let _projectsDbPromise = null;
function getProjectsDB() {
  if (!_projectsDbPromise) {
    _projectsDbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('fishTool_projects_db', 2);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('saved_projects')) {
            db.createObjectStore('saved_projects', { keyPath: 'id' });
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }
  return _projectsDbPromise;
}

function resolveMediaUrl(urlOrId) {
  if (!urlOrId) return '';
  if (typeof urlOrId !== 'string') return '';

  if (typeof getGlobalMediaLibrary === 'function') {
    const list = getGlobalMediaLibrary();
    let found = list.find(m => m.id === urlOrId || m.name === urlOrId || m.url === urlOrId);
    if (!found && (urlOrId.includes('/') || urlOrId.includes('%2F') || urlOrId.includes('\\'))) {
      let decoded = urlOrId;
      try { decoded = decodeURIComponent(urlOrId); } catch(_) {}
      const fname = decoded.split(/[\\/]/).pop();
      if (fname) {
        found = list.find(m => m.name === fname || (m.name && m.name.toLowerCase() === fname.toLowerCase()));
      }
    }

    if (found) {
      if (found.blob instanceof Blob) {
        found.url = URL.createObjectURL(found.blob);
        return found.url;
      }
      if (found.url && (found.url.startsWith('data:') || found.url.startsWith('http://') || found.url.startsWith('https://') || found.url.startsWith('blob:'))) {
        return found.url;
      }
      if (found.url) return found.url;
    }
  }

  if (urlOrId.startsWith('data:') || urlOrId.startsWith('http://') || urlOrId.startsWith('https://') || urlOrId.startsWith('blob:')) {
    return urlOrId;
  }
  if (urlOrId.startsWith('content://') || urlOrId.startsWith('file://')) {
    return '';
  }

  return urlOrId;
}
window.resolveMediaUrl = resolveMediaUrl;

function getProjectDimensions() {
  let w = 1080, h = 1920;
  const ratio = (typeof projectRatio !== 'undefined' && projectRatio) ? projectRatio : '9:16';
  const res = (typeof projectResolution !== 'undefined' && projectResolution) ? projectResolution : '1080p';

  if (ratio === '16:9') {
    w = 1920; h = 1080;
  } else if (ratio === '9:16') {
    w = 1080; h = 1920;
  } else if (ratio === '1:1') {
    w = 1080; h = 1080;
  } else if (ratio === '4:5') {
    w = 1080; h = 1350;
  } else if (ratio === '4:3') {
    w = 1440; h = 1080;
  } else if (ratio === 'custom') {
    w = (typeof projectCustomWidth !== 'undefined' && projectCustomWidth) ? projectCustomWidth : 1080;
    h = (typeof projectCustomHeight !== 'undefined' && projectCustomHeight) ? projectCustomHeight : 1920;
  }

  if (res === '720p') {
    const scale = 720 / Math.min(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  } else if (res === '4k') {
    const scale = 2160 / Math.min(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  return { width: w, height: h };
}
window.getProjectDimensions = getProjectDimensions;

let scene3D = null;
let camera3D = null;
let renderer3D = null;
const meshLayerMap = new Map();

const _rulerInstances = {};

function initInfiniteRuler(id, vertical) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window.FishUI && window.FishUI.createRuler) {
    _rulerInstances[id] = window.FishUI.createRuler({
      container: el,
      vertical: !!vertical,
      onChange: (val, valChange) => {
        if (!selectedTrackRow) return;
        const layerId = selectedTrackRow.dataset.layerId || 'default';
        const t = getLayerTransform(layerId);
        if (id === 'z-ruler') {
          t.posZ = Math.round(t.posZ - valChange * 1.5);
        } else if (id === 'ruler-w') {
          const delta = Math.round(valChange * 0.5);
          t.scaleW = t.scaleW + delta;
          if (t.isLinked) {
            t.scaleH = t.scaleH + delta;
          }
        } else if (id === 'ruler-h') {
          const delta = Math.round(valChange * 0.5);
          t.scaleH = t.scaleH + delta;
          if (t.isLinked) {
            t.scaleW = t.scaleW + delta;
          }
        }
        recordTransformChange(layerId, t);
        syncControllerUI();
      }
    });
  }
}

function updateInfiniteRuler(id, offset) {
  if (_rulerInstances[id]) {
    _rulerInstances[id].setOffset(offset);
  }
}

const layerTransforms = new Map();
const layerKeyframes = new Map();
const layerFills = new Map();
const layerShapeParams = new Map();
const layerBorderShadow = new Map();
const layerMotionBlur = new Map();
const layerExpressions = new Map();
const layerTextAnimators = new Map();
const layerEffects = new Map();

const EFFECTS_CATALOG = [
  {
    type: 'copy_background',
    name: 'Copy Background (Adjustment Layer)',
    icon: 'content_copy',
    category: 'style',
    desc: 'Menyalin gambar latar belakang seluruh layer di bawahnya untuk dijadikan Adjustment Layer.',
    defaultParams: { opacity: 100 }
  },
  {
    type: 'gaussian_blur',
    name: 'Gaussian Blur',
    icon: 'blur_on',
    category: 'blur',
    desc: 'Efek blur merata ke segala arah dengan transisi halus.',
    defaultParams: { strength: 12 }
  },
  {
    type: 'hue_saturation',
    name: 'Hue / Saturation',
    icon: 'palette',
    category: 'color',
    desc: 'Ubah warna, kejenuhan, dan kecerahan layer.',
    defaultParams: { hue: 0, saturation: 100, lightness: 100 }
  },
  {
    type: 'brightness_contrast',
    name: 'Brightness & Contrast',
    icon: 'brightness_6',
    category: 'color',
    desc: 'Atur intensitas cahaya dan kontras ketajaman visual.',
    defaultParams: { brightness: 100, contrast: 100 }
  },
  {
    type: 'glow',
    name: 'Glow / Aura',
    icon: 'flare',
    category: 'color',
    desc: 'Pancaran cahaya neon berkilau di sekitar layer.',
    defaultParams: { radius: 15, color: '#FAB778', intensity: 100 }
  },
  {
    type: 'rgb_split',
    name: 'RGB Split / Glitch',
    icon: 'grain',
    category: 'distort',
    desc: 'Pemisahan kanal warna chromatic aberration bergaya glitch.',
    defaultParams: { distance: 8, angle: 0 }
  },
  {
    type: 'vignette',
    name: 'Vignette',
    icon: 'vignette',
    category: 'style',
    desc: 'Penggelapan sinematik pada tepi sudut layer.',
    defaultParams: { radius: 50, feather: 50 }
  },
  {
    type: 'grayscale',
    name: 'Grayscale / B&W',
    icon: 'tonality',
    category: 'color',
    desc: 'Filter hitam-putih monokrom klasik.',
    defaultParams: { amount: 100 }
  },
  {
    type: 'invert',
    name: 'Invert Color',
    icon: 'invert_colors',
    category: 'color',
    desc: 'Pembalikan warna negatif RGB.',
    defaultParams: { amount: 100 }
  },
  {
    type: 'sepia',
    name: 'Sepia Vintage',
    icon: 'photo_filter',
    category: 'color',
    desc: 'Filter nuansa klasik kecokelatan retro.',
    defaultParams: { amount: 80 }
  },
  {
    type: 'drop_shadow',
    name: 'Drop Shadow',
    icon: 'shadow',
    category: 'style',
    desc: 'Bayangan 3D realistis dengan offset arah cahaya.',
    defaultParams: { size: 12, offsetX: 6, offsetY: 6, color: '#000000', opacity: 60 }
  }
];

function getLayerEffects(id) {
  if (!layerEffects.has(id)) {
    layerEffects.set(id, []);
  }
  return layerEffects.get(id);
}

function setLayerEffects(id, effects) {
  layerEffects.set(id, effects || []);
}

let isGlobalMotionBlurEnabled = true;
let projectMotionBlurTune = 0.5;
let projectMotionBlurSamples = 6;
const pendingTextureRenders = new Map();
let projectFps = 30;

let _overlayRaf = null;
function requestCanvasOverlayRender() {
  if (_overlayRaf) return;
  _overlayRaf = requestAnimationFrame(() => {
    _overlayRaf = null;
    if (typeof renderCanvasOverlay === 'function') {
      renderCanvasOverlay();
    }
  });
}

function getLayerExpressions(id) {
  if (!layerExpressions.has(id)) {
    layerExpressions.set(id, {});
  }
  return layerExpressions.get(id);
}

function setLayerExpression(id, prop, code) {
  const exps = getLayerExpressions(id);
  if (code && code.trim()) {
    exps[prop] = code.trim();
  } else {
    delete exps[prop];
  }
}

function clearLayerExpression(id, prop) {
  const exps = getLayerExpressions(id);
  if (prop) {
    delete exps[prop];
  } else {
    layerExpressions.set(id, {});
  }
}

function getLayerTextAnimators(id) {
  if (!layerTextAnimators.has(id)) {
    layerTextAnimators.set(id, []);
  }
  return layerTextAnimators.get(id);
}

function getLayerShapeParams(id, shapeType) {
  const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
  const defShapeDim = Math.round(Math.min(projDim.width, projDim.height) * 0.38) || 400;

  if (!layerShapeParams.has(id)) {
    layerShapeParams.set(id, {
      square: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, rounded: 0, renderMode: 'fill', thickness: 14, points: [{x:-50, y:-50}, {x:50, y:-50}, {x:50, y:50}, {x:-50, y:50}], selectedPointIdx: 0 },
      circle: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, renderMode: 'fill', thickness: 14, points: [{x:0, y:-50}, {x:50, y:0}, {x:0, y:50}, {x:-50, y:0}], selectedPointIdx: 0 },
      round: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, rounded: 22, renderMode: 'fill', thickness: 14 },
      triangle: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, step: 3, curve: 0, innerRadius: 100, renderMode: 'fill', thickness: 14, points: [{x:0, y:-50}, {x:50, y:50}, {x:-50, y:50}], selectedPointIdx: 0 },
      heart: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, renderMode: 'fill', thickness: 14, points: [{x:0, y:-30}, {x:40, y:-60}, {x:60, y:-10}, {x:0, y:60}, {x:-60, y:-10}, {x:-40, y:-60}], selectedPointIdx: 0 },
      love: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, renderMode: 'fill', thickness: 14, points: [{x:0, y:-30}, {x:40, y:-60}, {x:60, y:-10}, {x:0, y:60}, {x:-60, y:-10}, {x:-40, y:-60}], selectedPointIdx: 0 },
      star: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, pointsCount: 5, innerRadius: 40, curve: 0, renderMode: 'fill', thickness: 14, points: [{x:0, y:-60}, {x:18, y:-20}, {x:60, y:-20}, {x:26, y:8}, {x:38, y:50}, {x:0, y:24}, {x:-38, y:50}, {x:-26, y:8}, {x:-60, y:-20}, {x:-18, y:-20}], selectedPointIdx: 0 },
      'star-4': { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, pointsCount: 4, innerRadius: 30, renderMode: 'fill', thickness: 14, points: [{x:0, y:-60}, {x:16, y:-16}, {x:60, y:0}, {x:16, y:16}, {x:0, y:60}, {x:-16, y:16}, {x:-60, y:0}, {x:-16, y:-16}], selectedPointIdx: 0 },
      hexagon: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, sides: 6, rounded: 0, renderMode: 'fill', thickness: 14, points: [{x:0, y:-55}, {x:48, y:-28}, {x:48, y:28}, {x:0, y:55}, {x:-48, y:28}, {x:-48, y:-28}], selectedPointIdx: 0 },
      polygon: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, sides: 5, rounded: 0, renderMode: 'fill', thickness: 14 },
      svg_path: { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: (defShapeDim / projDim.width) * 100, sizeY: (defShapeDim / projDim.height) * 100, pathData: '', points: [], selectedPointIdx: 0, renderMode: 'fill', thickness: 14 },
      line: {
        points: [
          { x: -50, y: 0 },
          { x: 50, y: 0 }
        ],
        selectedPointIdx: 0,
        thickness: 14,
        renderMode: 'outline'
      },
      arrow: {
        points: [
          { x: -50, y: 0 },
          { x: 50, y: 0 }
        ],
        selectedPointIdx: 0,
        thickness: 16,
        headSize: 34,
        renderMode: 'outline'
      }
    });
  }
  const allParams = layerShapeParams.get(id);
  if (!allParams) {
    return { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: 100, sizeY: 100, renderMode: 'fill', thickness: 14 };
  }
  if (allParams.sizeX_px !== undefined || allParams.sizeX !== undefined || allParams.points !== undefined) {
    return allParams;
  }

  if (shapeType && allParams[shapeType]) {
    return allParams[shapeType];
  }
  if (shapeType === 'love' && allParams['heart']) return allParams['heart'];
  if (shapeType && !allParams[shapeType]) {
    allParams[shapeType] = { sizeX_px: defShapeDim, sizeY_px: defShapeDim, sizeX: 100, sizeY: 100, renderMode: 'fill', thickness: 14, points: [{x:0, y:-50}, {x:50, y:50}, {x:-50, y:50}], selectedPointIdx: 0 };
    return allParams[shapeType];
  }
  return allParams;
}
function getProjectFromDOM() {
  const container = document.getElementById('trackRowsContainer');
  if (!container) return { tracks: [] };

  const tracks = [];
  container.querySelectorAll('.track-row').forEach(row => {
    const clip = row.querySelector('.track-clip');
    if (!clip) return;

    const id = row.dataset.layerId;
    const name = clip.querySelector('.track-clip-name')?.textContent || row.dataset.category || 'Layer';
    const category = row.dataset.category || 'custom';
    const colorTag = row.dataset.tagColor || 'none';
    const visible = !row.querySelector('.track-eye')?.classList.contains('hidden-layer');

    const marginLeft = parseFloat(clip.style.marginLeft) || 0;
    const width = parseFloat(clip.style.width) || clip.offsetWidth || 300;
    const startTime = marginLeft / (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 80);
    const duration = width / (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 80);

    tracks.push({
      id,
      name,
      type: category === 'shape' ? 'shape' : category === 'text' ? 'text' : 'media',
      category,
      colorTag,
      visible,
      startTime,
      duration,
      linkedTo: row.dataset.linkedTo ? JSON.parse(row.dataset.linkedTo) : [],
      linkedFrom: row.dataset.linkedFrom ? JSON.parse(row.dataset.linkedFrom) : [],
      parentBind: row.dataset.parentBind ? JSON.parse(row.dataset.parentBind) : null
    });
  });

  return { tracks };
}

function saveProjectToDOM(project) {
  const container = document.getElementById('trackRowsContainer');
  if (!container || !project) return;

  project.tracks.forEach(track => {
    const row = container.querySelector(`.track-row[data-layer-id="${track.id}"]`);
    if (!row) return;

    if (track.linkedTo && track.linkedTo.length > 0) {
      row.dataset.linkedTo = JSON.stringify(track.linkedTo);
    } else {
      delete row.dataset.linkedTo;
      delete row.dataset.parentBind;
    }
    if (track.parentBind) {
      row.dataset.parentBind = JSON.stringify(track.parentBind);
    }
    if (track.linkedFrom && track.linkedFrom.length > 0) {
      row.dataset.linkedFrom = JSON.stringify(track.linkedFrom);
    } else {
      delete row.dataset.linkedFrom;
    }
  });
}
function getLayerFill(id) {
  if (!layerFills.has(id)) layerFills.set(id, {type:'color', color:'#FAB778', mediaUrl:null, gradientType:'linear', gradientStops:[{offset:0,color:'#000000'},{offset:1,color:'#FFFFFF'}]});
  return layerFills.get(id);
}
const layerTexts = new Map();

function getLayerText(id) {
  let t = layerTexts.get(id);
  if (!t) {
    t = {
      content: 'Heading Title',
      font: 'Poppins',
      size: 48,
      align: 'center',
      bold: true,
      italic: false,
      underline: false,
      uppercase: false,
      letterSpacing: 0,
      lineHeight: 1.2
    };
    layerTexts.set(id, t);
  }
  return t;
}
const getLayerTextData = getLayerText;

const GOOGLE_FONTS_CATALOG = [
  { name: 'Plus Jakarta Sans', category: 'sans-serif', preview: 'Plus Jakarta Sans' },
  { name: 'Poppins', category: 'sans-serif', preview: 'Poppins Modern Design' },
  { name: 'Montserrat', category: 'sans-serif', preview: 'Montserrat Clean Bold' },
  { name: 'Inter', category: 'sans-serif', preview: 'Inter Dynamic Type' },
  { name: 'Roboto', category: 'sans-serif', preview: 'Roboto Standard' },
  { name: 'Open Sans', category: 'sans-serif', preview: 'Open Sans Neutral' },
  { name: 'Lato', category: 'sans-serif', preview: 'Lato Warm Sans' },
  { name: 'Oswald', category: 'sans-serif', preview: 'OSWALD CONDENSED' },
  { name: 'Raleway', category: 'sans-serif', preview: 'Raleway Elegant Sans' },
  { name: 'Nunito', category: 'sans-serif', preview: 'Nunito Soft Rounded' },
  { name: 'Rubik', category: 'sans-serif', preview: 'Rubik Smooth Geo' },
  { name: 'Work Sans', category: 'sans-serif', preview: 'Work Sans Modern' },
  { name: 'DM Sans', category: 'sans-serif', preview: 'DM Sans Geometric' },
  { name: 'Outfit', category: 'sans-serif', preview: 'Outfit Tech Clean' },
  { name: 'Ubuntu', category: 'sans-serif', preview: 'Ubuntu Contemporary' },
  { name: 'Playfair Display', category: 'serif', preview: 'Playfair Display Luxury' },
  { name: 'Merriweather', category: 'serif', preview: 'Merriweather Editorial' },
  { name: 'Lora', category: 'serif', preview: 'Lora Contemporary Serif' },
  { name: 'PT Serif', category: 'serif', preview: 'PT Serif Classic' },
  { name: 'Cinzel', category: 'serif', preview: 'CINZEL ROMAN EMPIRE' },
  { name: 'Cormorant Garamond', category: 'serif', preview: 'Cormorant Haute Couture' },
  { name: 'EB Garamond', category: 'serif', preview: 'EB Garamond Traditional' },
  { name: 'Bitter', category: 'serif', preview: 'Bitter Contemporary Slab' },
  { name: 'Spectral', category: 'serif', preview: 'Spectral Refined Serif' },
  { name: 'Bodoni Moda', category: 'serif', preview: 'Bodoni Moda Elegance' },
  { name: 'Bebas Neue', category: 'display', preview: 'BEBAS NEUE IMPACT' },
  { name: 'Anton', category: 'display', preview: 'ANTON MASSIVE HEADLINE' },
  { name: 'Bangers', category: 'display', preview: 'BANGERS COMIC ACTION' },
  { name: 'Righteous', category: 'display', preview: 'Righteous 80s Retro' },
  { name: 'Alfa Slab One', category: 'display', preview: 'ALFA SLAB ULTRA HEAVY' },
  { name: 'Abril Fatface', category: 'display', preview: 'Abril Fatface Display' },
  { name: 'Bungee', category: 'display', preview: 'BUNGEE SIGNBOARD' },
  { name: 'Fredoka', category: 'display', preview: 'Fredoka Bold Bubble' },
  { name: 'Permanent Marker', category: 'display', preview: 'Permanent Marker Style' },
  { name: 'Shrikhand', category: 'display', preview: 'Shrikhand Retro Swash' },
  { name: 'Russo One', category: 'display', preview: 'RUSSO ONE POWER' },
  { name: 'Lobster', category: 'display', preview: 'Lobster Vintage Script' },
  { name: 'Rubik Glitch', category: 'display', preview: 'Rubik Glitch Cyber' },
  { name: 'Pacifico', category: 'handwriting', preview: 'Pacifico Ocean Surf' },
  { name: 'Caveat', category: 'handwriting', preview: 'Caveat Natural Handwriting' },
  { name: 'Dancing Script', category: 'handwriting', preview: 'Dancing Script Cursive' },
  { name: 'Satisfy', category: 'handwriting', preview: 'Satisfy Brush Calligraphy' },
  { name: 'Great Vibes', category: 'handwriting', preview: 'Great Vibes Elegant Script' },
  { name: 'Sacramento', category: 'handwriting', preview: 'Sacramento Monoline Script' },
  { name: 'Kalam', category: 'handwriting', preview: 'Kalam Casual Ballpoint' },
  { name: 'Shadows Into Light', category: 'handwriting', preview: 'Shadows Into Light' },
  { name: 'Yellowtail', category: 'handwriting', preview: 'Yellowtail Flat Script' },
  { name: 'JetBrains Mono', category: 'monospace', preview: 'JetBrains Mono 0123' },
  { name: 'Orbitron', category: 'monospace', preview: 'ORBITRON SCI-FI HUD' },
  { name: 'Fira Code', category: 'monospace', preview: 'Fira Code => () {}' },
  { name: 'Space Mono', category: 'monospace', preview: 'Space Mono 80s Synth' },
  { name: 'VT323', category: 'monospace', preview: 'VT323 RETRO TERMINAL' },
  { name: 'Press Start 2P', category: 'monospace', preview: 'PRESS START 8-BIT' },
  { name: 'Share Tech Mono', category: 'monospace', preview: 'Share Tech Digital Matrix' },
  { name: 'Silkscreen', category: 'monospace', preview: 'SILKSCREEN PIXEL ART' }
];

const loadedGoogleFonts = new Set(['Plus Jakarta Sans']);

function loadGoogleFont(fontName) {
  if (!fontName || fontName === 'sans-serif' || fontName === 'serif' || fontName === 'monospace') {
    return Promise.resolve();
  }
  if (loadedGoogleFonts.has(fontName)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const formatted = fontName.replace(/\s+/g, '+');
    const linkId = 'gfont_' + fontName.replace(/[^a-zA-Z0-9]/g, '_');
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${formatted}:ital,wght@0,400;0,600;0,700;0,800;1,400;1,700&display=swap`;
      link.onload = () => {
        loadedGoogleFonts.add(fontName);
        if (document.fonts) {
          document.fonts.ready.then(() => resolve());
        } else {
          resolve();
        }
      };
      link.onerror = () => resolve();
      document.head.appendChild(link);
    } else {
      loadedGoogleFonts.add(fontName);
      resolve();
    }
  });
}

let isMultiSelectMode = false;
let selectedMultiRows = new Set();
const layerGroupData = new Map();
let groupNavigationStack = [];
let activeGroupContext = null;

function getLayerGroupData(groupId) {
  return layerGroupData.get(groupId) || null;
}

function setLayerGroupData(groupId, data) {
  if (!groupId || !data) return;
  layerGroupData.set(groupId, data);
}
function cloneGroupData(srcGroupId, targetGroupId, newName = null) {
  const src = layerGroupData.get(srcGroupId);
  if (!src) return null;

  const cloned = JSON.parse(JSON.stringify(src));
  cloned.id = targetGroupId;
  if (newName) cloned.name = newName;
  const idMap = new Map();
  cloned.layers.forEach(l => {
    const oldId = l.layerId;
    const freshId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    idMap.set(oldId, freshId);
    l.layerId = freshId;
    if (l.dataset) l.dataset.layerId = freshId;
  });

  function remapEntries(entryArray) {
    if (!entryArray || !Array.isArray(entryArray)) return [];
    return entryArray.map(([k, v]) => {
      const newK = idMap.get(k) || k;
      return [newK, v];
    });
  }

  cloned.transforms = remapEntries(cloned.transforms);
  cloned.keyframes = remapEntries(cloned.keyframes);
  cloned.fills = remapEntries(cloned.fills);
  cloned.borderShadows = remapEntries(cloned.borderShadows);
  cloned.shapeParams = remapEntries(cloned.shapeParams);
  cloned.texts = remapEntries(cloned.texts);
  cloned.cameraParams = remapEntries(cloned.cameraParams);
  cloned.effects = remapEntries(cloned.effects);
  cloned.motionBlurs = remapEntries(cloned.motionBlurs);

  layerGroupData.set(targetGroupId, cloned);
  return cloned;
}

const SHAPE_ITEMS = [
  { title: 'Kotak', shapeType: 'square', icon: 'crop_square', filename: 'Shape_Kotak.svg' },
  { title: 'Lingkaran', shapeType: 'circle', icon: 'radio_button_unchecked', filename: 'Shape_Lingkaran.svg' },
  { title: 'Segitiga', shapeType: 'triangle', icon: 'change_history', filename: 'Shape_Segitiga.svg' },
  { title: 'Bintang', shapeType: 'star', icon: 'star', filename: 'Shape_Bintang.svg' },
  { title: 'Love', shapeType: 'heart', icon: 'favorite', filename: 'Shape_Love.svg' },
  { title: 'Panah', shapeType: 'arrow', icon: 'arrow_forward', filename: 'Shape_Panah.svg' },
  { title: 'Segi Enam', shapeType: 'hexagon', icon: 'hexagon', filename: 'Shape_SegiEnam.svg' }
];

const SHAPE_PICKER_ITEMS = SHAPE_ITEMS;

var CATEGORY_ITEMS = null;

