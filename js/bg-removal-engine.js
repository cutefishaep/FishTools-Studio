/**
 * FishTools Studio - Background Removal Engine (AI Matting)
 * 
 * Supports:
 * 1. Single-frame photo matting (MediaPipe / Selfie Segmenter ~1MB)
 * 2. Multi-frame video image sequence matting with RobustVideoMatting (RVM ~15MB)
 *    using recurrent temporal states (r1, r2, r3, r4) for flicker-free video.
 * 3. ONNX Runtime Web (WebGPU -> WebGL -> WASM CPU fallback).
 * 4. Cache API persistence for model weights (zero redundant downloads).
 * 5. Non-blocking UI background queue with real-time progress callbacks.
 * 6. Non-blocking fallback rendering (renders raw footage until frames are ready).
 */

(function(window) {
  'use strict';

  const ORT_SOURCES = [
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort.all.min.js',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort.webgpu.min.js',
    'https://unpkg.com/onnxruntime-web@1.17.3/dist/ort.webgpu.min.js'
  ];

  const MODEL_META = {
    rvm_mobilenetv3: {
      id: 'rvm_mobilenetv3',
      label: 'RobustVideoMatting (~15MB)',
      file: 'rvm_mobilenetv3_fp32.onnx',
      type: 'rvm',
      w: 512,
      h: 512
    }
  };

  const HF_BASE_URL = 'https://huggingface.co/cutefishae/resource-cutefish/resolve/main/models';
  const CACHE_NAME = 'fish-ai-models-v1';
  const DB_NAME = 'FishMattingCacheDB';
  const DB_VERSION = 1;
  const STORE_FRAMES = 'matting_frames';

  function yieldToUI() {
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
      return scheduler.yield();
    }
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    });
  }

  function smoothstepAlpha(raw) {
    if (raw <= 0.15) return 0.0;
    if (raw >= 0.70) return 1.0;
    const t = (raw - 0.15) / 0.55;
    return t * t * (3.0 - 2.0 * t);
  }

  class BgRemovalEngine {
    constructor() {
      this._ortPromise = null;
      this._sessions = new Map(); // modelId:device -> session
      this._activeTasks = new Map(); // taskId -> TaskInfo
      this._taskQueue = [];
      this._isQueueRunning = false;
      this._progressListeners = new Set();

      // RAM Caches:
      // Photo: sourceKey -> ImageBitmap
      this._photoCutoutCache = new Map();
      // Video: sourceKey -> Map<frameIdx, ImageBitmap>
      this._videoFrameCache = new Map();

      this._dbPromise = this._openDB();
    }

    _openDB() {
      if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
      return new Promise(resolve => {
        try {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_FRAMES)) {
              const store = db.createObjectStore(STORE_FRAMES, { keyPath: 'key' });
              store.createIndex('sourceKey', 'sourceKey', { unique: false });
            }
          };
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
    }

    async ensureOnnxRuntime() {
      if (typeof window.ort !== 'undefined' && window.ort.InferenceSession) {
        if (window.ort.env && window.ort.env.wasm && !window.ort.env.wasm.wasmPaths) {
          window.ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
          window.ort.env.wasm.numThreads = 1;
        }
        return true;
      }
      if (!this._ortPromise) {
        this._ortPromise = new Promise((resolve, reject) => {
          let idx = 0;
          const tryNext = () => {
            if (idx >= ORT_SOURCES.length) {
              reject(new Error('ONNX Runtime Web failed to load from CDN.'));
              return;
            }
            const s = document.createElement('script');
            s.src = ORT_SOURCES[idx++];
            s.async = true;
            s.onload = () => {
              setTimeout(() => {
                if (typeof window.ort !== 'undefined' && window.ort.InferenceSession) {
                  if (window.ort.env && window.ort.env.wasm) {
                    window.ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
                    window.ort.env.wasm.numThreads = 1;
                  }
                  resolve(true);
                } else {
                  tryNext();
                }
              }, 10);
            };
            s.onerror = () => tryNext();
            document.head.appendChild(s);
          };
          tryNext();
        });
      }
      return this._ortPromise;
    }

    async _fetchModelBuffer(filename, onProgress) {
      const url = `${HF_BASE_URL}/${filename}`;
      // Check CacheStorage first
      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          const cache = await caches.open(CACHE_NAME);
          const cachedResp = await cache.match(url);
          if (cachedResp) {
            return await cachedResp.arrayBuffer();
          }
        } catch (_) {}
      }

      // Download model
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Model not found at: ${url}`);

      const contentLength = resp.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      let buffer;
      if (resp.body && total > 0 && typeof ReadableStream !== 'undefined') {
        const reader = resp.body.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          if (onProgress && total > 0) {
            onProgress(Math.round((loaded / total) * 100));
          }
        }
        const totalArr = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          totalArr.set(chunk, offset);
          offset += chunk.length;
        }
        buffer = totalArr.buffer;
      } else {
        buffer = await resp.arrayBuffer();
      }

      // Store in CacheStorage
      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(url, new Response(buffer.slice(0), {
            headers: { 'Content-Type': 'application/octet-stream' }
          }));
        } catch (_) {}
      }

      return buffer;
    }

    async getSession(modelId = 'rvm_mobilenetv3', preferredDevice = 'gpu', onModelDownloadProgress) {
      await this.ensureOnnxRuntime();
      const meta = MODEL_META[modelId] || MODEL_META.rvm_mobilenetv3;
      const cacheKey = `${modelId}:${preferredDevice}`;
      if (this._sessions.has(cacheKey)) {
        return this._sessions.get(cacheKey);
      }

      const buffer = await this._fetchModelBuffer(meta.file, onModelDownloadProgress);
      const modelBytes = new Uint8Array(buffer.slice(0));

      let epList = [];
      if (preferredDevice === 'cpu') {
        epList = ['wasm'];
      } else {
        epList = meta.type === 'rvm'
          ? ['wasm'] // RVM runs with high precision in wasm SIMD
          : ['webgpu', 'webgl', 'wasm'];
      }

      let session = null;
      let activeEP = 'wasm';

      for (const ep of epList) {
        try {
          session = await window.ort.InferenceSession.create(modelBytes, {
            executionProviders: [ep],
            graphOptimizationLevel: 'all'
          });
          activeEP = typeof ep === 'string' ? ep : ep.name;
          break;
        } catch (_) {}
      }

      if (!session) {
        session = await window.ort.InferenceSession.create(modelBytes, {
          executionProviders: ['wasm']
        });
        activeEP = 'wasm';
      }

      const sessionObj = { session, activeEP, meta, recurrentStates: null };
      this._sessions.set(cacheKey, sessionObj);
      return sessionObj;
    }

    /**
     * Segment a single image/canvas/bitmap using specified model.
     * Returns an alpha mask canvas.
     */
    async segmentSource(srcLike, modelId = 'rvm_mobilenetv3', sessionObj = null) {
      if (!sessionObj) {
        sessionObj = await this.getSession(modelId);
      }
      const { session, meta } = sessionObj;

      const srcW = srcLike.videoWidth || srcLike.naturalWidth || srcLike.width;
      const srcH = srcLike.videoHeight || srcLike.naturalHeight || srcLike.height;
      if (!srcW || !srcH) throw new Error('Invalid source dimensions.');

      let inferW = meta.w;
      let inferH = meta.h;
      if (meta.type === 'rvm') {
        inferW = Math.max(256, Math.round(srcW / 64) * 64);
        inferH = Math.max(256, Math.round(srcH / 64) * 64);
      }

      const inputCanvas = document.createElement('canvas');
      inputCanvas.width = inferW;
      inputCanvas.height = inferH;
      const ictx = inputCanvas.getContext('2d', { willReadFrequently: true });
      ictx.imageSmoothingEnabled = true;
      ictx.imageSmoothingQuality = 'high';
      ictx.drawImage(srcLike, 0, 0, inferW, inferH);

      const imgData = ictx.getImageData(0, 0, inferW, inferH).data;
      const totalPixels = inferW * inferH;
      const floatData = new Float32Array(3 * totalPixels);

      if (meta.type === 'modnet') {
        const inv127 = 1.0 / 127.5;
        for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
          floatData[i] = imgData[p] * inv127 - 1.0;
          floatData[totalPixels + i] = imgData[p + 1] * inv127 - 1.0;
          floatData[2 * totalPixels + i] = imgData[p + 2] * inv127 - 1.0;
        }
      } else {
        const inv255 = 1.0 / 255.0;
        for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
          floatData[i] = imgData[p] * inv255;
          floatData[totalPixels + i] = imgData[p + 1] * inv255;
          floatData[2 * totalPixels + i] = imgData[p + 2] * inv255;
        }
      }

      const inputTensor = new window.ort.Tensor('float32', floatData, [1, 3, inferH, inferW]);
      const feeds = {};

      if (meta.type === 'rvm') {
        feeds['src'] = inputTensor;
        if (!sessionObj.recurrentStates) {
          sessionObj.recurrentStates = {
            r1: new window.ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]),
            r2: new window.ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]),
            r3: new window.ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]),
            r4: new window.ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])
          };
        }
        feeds['r1i'] = sessionObj.recurrentStates.r1;
        feeds['r2i'] = sessionObj.recurrentStates.r2;
        feeds['r3i'] = sessionObj.recurrentStates.r3;
        feeds['r4i'] = sessionObj.recurrentStates.r4;
        feeds['downsample_ratio'] = new window.ort.Tensor('float32', new Float32Array([0.25]), [1]);
      } else {
        feeds[session.inputNames[0]] = inputTensor;
      }

      const results = await session.run(feeds);
      let alphaData = null;
      let maskW = inferW;
      let maskH = inferH;

      if (meta.type === 'rvm') {
        const phaKey = Object.keys(results).find(k => k.toLowerCase().includes('pha')) || 'pha';
        const phaTensor = results[phaKey];
        const rawPha = phaTensor.data;
        maskW = phaTensor.dims[3] || inferW;
        maskH = phaTensor.dims[2] || inferH;
        alphaData = rawPha.subarray(0, maskW * maskH);

        if (results['r1o']) {
          sessionObj.recurrentStates = {
            r1: results['r1o'],
            r2: results['r2o'],
            r3: results['r3o'],
            r4: results['r4o']
          };
        }
      } else if (meta.type === 'modnet') {
        const outKey = session.outputNames[0];
        const rawData = results[outKey].data;
        maskW = inferW;
        maskH = inferH;
        alphaData = new Float32Array(maskW * maskH);
        for (let i = 0; i < alphaData.length; i++) {
          alphaData[i] = smoothstepAlpha(rawData[i]);
        }
      } else {
        const outKey = session.outputNames[0];
        const outTensor = results[outKey];
        const rawData = outTensor.data;
        maskW = outTensor.dims[outTensor.dims.length - 1] || inferW;
        maskH = outTensor.dims[outTensor.dims.length - 2] || inferH;
        const area = maskW * maskH;
        alphaData = new Float32Array(area);
        if (outTensor.dims[1] === 2) {
          for (let i = 0; i < area; i++) {
            alphaData[i] = smoothstepAlpha(1.0 / (1.0 + Math.exp(rawData[i] - rawData[area + i])));
          }
        } else {
          for (let i = 0; i < area; i++) {
            alphaData[i] = smoothstepAlpha(rawData[i]);
          }
        }
      }

      // Generate Mask Canvas
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = maskW;
      maskCanvas.height = maskH;
      const mctx = maskCanvas.getContext('2d');
      const maskImgData = mctx.createImageData(maskW, maskH);
      for (let i = 0; i < maskW * maskH; i++) {
        const v = Math.max(0, Math.min(255, Math.round(alphaData[i] * 255)));
        maskImgData.data[i * 4] = 255;
        maskImgData.data[i * 4 + 1] = 255;
        maskImgData.data[i * 4 + 2] = 255;
        maskImgData.data[i * 4 + 3] = v;
      }
      mctx.putImageData(maskImgData, 0, 0);
      return maskCanvas;
    }

    /**
     * Composite source with alpha mask to produce a transparent canvas or ImageBitmap.
     */
    async compositeCutout(srcLike, maskCanvas) {
      const W = srcLike.videoWidth || srcLike.naturalWidth || srcLike.width;
      const H = srcLike.videoHeight || srcLike.naturalHeight || srcLike.height;

      const outCanvas = document.createElement('canvas');
      outCanvas.width = W;
      outCanvas.height = H;
      const octx = outCanvas.getContext('2d');

      // Draw source
      octx.drawImage(srcLike, 0, 0, W, H);
      // Destination-in mask
      octx.globalCompositeOperation = 'destination-in';
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(maskCanvas, 0, 0, W, H);
      octx.globalCompositeOperation = 'source-over';

      if (typeof createImageBitmap === 'function') {
        try {
          return await createImageBitmap(outCanvas);
        } catch (_) {}
      }
      return outCanvas;
    }

    /**
     * Check if a layer has Background Removal effect enabled.
     */
    isLayerMattingActive(layer) {
      if (!layer) return false;
      if (layer.removeBg === true) return true;
      if (Array.isArray(layer.effects)) {
        return layer.effects.some(e => {
          if (!e || e.disabled === true) return false;
          return e.type === 'remove_bg' || e.id === 'remove_bg' || (typeof e.id === 'string' && e.id.startsWith('fx_remove_bg'));
        });
      }
      return false;
    }

    getLayerMattingEffect(layer) {
      if (!layer || !Array.isArray(layer.effects)) return null;
      return layer.effects.find(e => {
        if (!e || e.disabled === true) return false;
        return e.type === 'remove_bg' || e.id === 'remove_bg' || (typeof e.id === 'string' && e.id.startsWith('fx_remove_bg'));
      }) || null;
    }

    /**
     * Get processed cutout ImageBitmap/Canvas for a photo layer (or null if pending).
     */
    getPhotoCutout(layer) {
      if (!layer) return null;
      if (layer._bgCutoutBitmap) return layer._bgCutoutBitmap;
      const key = layer.mediaId || layer.dataUrl || layer.id;
      if (this._photoCutoutCache.has(key)) {
        return this._photoCutoutCache.get(key);
      }
      if (layer.mediaId && this._photoCutoutCache.has(layer.mediaId)) {
        const bmp = this._photoCutoutCache.get(layer.mediaId);
        layer._bgCutoutBitmap = bmp;
        return bmp;
      }
      if (layer.dataUrl && this._photoCutoutCache.has(layer.dataUrl)) {
        const bmp = this._photoCutoutCache.get(layer.dataUrl);
        layer._bgCutoutBitmap = bmp;
        return bmp;
      }
      if (window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
        for (const l of window.currentProjectState.layers) {
          if (l && l !== layer) {
            const matchesMedia = (layer.mediaId && l.mediaId === layer.mediaId) || (layer.dataUrl && l.dataUrl === layer.dataUrl);
            if (matchesMedia && l._bgCutoutBitmap) {
              layer._bgCutoutBitmap = l._bgCutoutBitmap;
              this._photoCutoutCache.set(key, l._bgCutoutBitmap);
              return l._bgCutoutBitmap;
            }
          }
        }
      }
      if (!this._dbLoadingKeys) this._dbLoadingKeys = new Set();
      if (!this._dbLoadingKeys.has(key)) {
        this._dbLoadingKeys.add(key);
        this._loadPhotoCutoutFromDB(key, layer);
      }
      return null;
    }

    async _loadPhotoCutoutFromDB(key, layer) {
      if (!key) return;
      try {
        const db = await this._dbPromise;
        if (!db) return;
        const tx = db.transaction(STORE_FRAMES, 'readonly');
        const req = tx.objectStore(STORE_FRAMES).get(`photo_${key}`);
        req.onsuccess = async () => {
          if (req.result && req.result.blob) {
            try {
              const bmp = await createImageBitmap(req.result.blob);
              this._photoCutoutCache.set(key, bmp);
              if (layer) layer._bgCutoutBitmap = bmp;
              if (typeof window.redrawComposition === 'function') {
                window.redrawComposition('cutout-restored-from-db');
              }
              if (window.FishTemplateEditor && typeof window.FishTemplateEditor.renderFrame === 'function') {
                window.FishTemplateEditor.renderFrame();
              }
            } catch (_) {}
          }
        };
      } catch (_) {}
    }

    async _savePhotoCutoutToDB(key, bmpOrCanvas) {
      if (!key || !bmpOrCanvas) return;
      try {
        const db = await this._dbPromise;
        if (!db) return;
        let blob = null;
        if (typeof bmpOrCanvas.toBlob === 'function') {
          blob = await new Promise(resolve => bmpOrCanvas.toBlob(resolve, 'image/png'));
        } else {
          const c = document.createElement('canvas');
          c.width = bmpOrCanvas.width;
          c.height = bmpOrCanvas.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(bmpOrCanvas, 0, 0);
          blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
        }
        if (!blob) return;
        const tx = db.transaction(STORE_FRAMES, 'readwrite');
        tx.objectStore(STORE_FRAMES).put({
          key: `photo_${key}`,
          sourceKey: key,
          blob: blob,
          timestamp: Date.now()
        });
      } catch (_) {}
    }

    async _deletePhotoCutoutFromDB(key) {
      if (!key) return;
      try {
        const db = await this._dbPromise;
        if (!db) return;
        const tx = db.transaction(STORE_FRAMES, 'readwrite');
        tx.objectStore(STORE_FRAMES).delete(`photo_${key}`);
      } catch (_) {}
    }

    /**
     * Get processed cutout ImageBitmap for a specific video frame (or null if pending).
     */
    getVideoCutoutFrame(sourceKey, frameIndex) {
      if (!sourceKey) return null;
      const cache = this._videoFrameCache.get(sourceKey);
      if (cache && cache.has(frameIndex)) {
        return cache.get(frameIndex);
      }
      return null;
    }

    /**
     * Clear cached cutouts for a layer when model or footage is changed.
     */
    clearLayerCutouts(layer) {
      if (!layer) return;
      delete layer._bgCutoutBitmap;
      delete layer._bgMaskCanvas;
      delete layer._bgSrcElement;
      const sourceKey = (window.VideoFrameExtractor && window.VideoFrameExtractor._getSourceKey)
        ? window.VideoFrameExtractor._getSourceKey(layer)
        : (layer.mediaId || layer.dataUrl || layer.id);
      this._photoCutoutCache.delete(sourceKey);
      if (layer.mediaId) this._photoCutoutCache.delete(layer.mediaId);
      if (layer.fillMediaId) this._photoCutoutCache.delete(layer.fillMediaId);
      if (layer.dataUrl) this._photoCutoutCache.delete(layer.dataUrl);
      if (layer.id) this._photoCutoutCache.delete(layer.id);
      this._videoFrameCache.delete(sourceKey);
      if (layer.mediaId) this._videoFrameCache.delete(layer.mediaId);

      this._deletePhotoCutoutFromDB(sourceKey);
      if (layer.mediaId) this._deletePhotoCutoutFromDB(layer.mediaId);
      if (layer.fillMediaId) this._deletePhotoCutoutFromDB(layer.fillMediaId);
      if (layer.dataUrl) this._deletePhotoCutoutFromDB(layer.dataUrl);
      if (layer.id) this._deletePhotoCutoutFromDB(layer.id);
    }

    /**
     * Add progress listener for UI updates.
     */
    addProgressListener(fn) {
      if (typeof fn === 'function') {
        this._progressListeners.add(fn);
        try {
          fn(Array.from(this._activeTasks.values()));
        } catch (_) {}
      }
    }

    removeProgressListener(fn) {
      this._progressListeners.delete(fn);
    }

    _notifyProgress() {
      const activeList = Array.from(this._activeTasks.values());
      for (const fn of this._progressListeners) {
        try {
          fn(activeList);
        } catch (_) {}
      }
    }

    getActiveTasks() {
      return Array.from(this._activeTasks.values());
    }

    hasPendingTasks() {
      return Array.from(this._activeTasks.values()).some(t => {
        return !t.cancelled && (t.status === 'queued' || t.status === 'processing' || (typeof t.status === 'string' && (t.status.startsWith('Download') || t.status === 'downloading_model')));
      });
    }

    cancelTask(taskId) {
      const task = this._activeTasks.get(taskId);
      if (task) {
        task.cancelled = true;
        task.status = 'cancelled';
        this._activeTasks.delete(taskId);
        this._notifyProgress();
      }
    }

    /**
     * Main entry point: process a layer (Photo or Video sequence).
     */
    async processLayer(layer, force = false) {
      if (!layer) return;
      if (!this.isLayerMattingActive(layer) && !force) return;

      const isVideo = (layer.type === 'video');
      const sourceKey = (window.VideoFrameExtractor && window.VideoFrameExtractor._getSourceKey)
        ? window.VideoFrameExtractor._getSourceKey(layer)
        : (layer.mediaId || layer.dataUrl || layer.id);

      // If video layer raw extraction is still in progress or incomplete, revert half-rendered raw frames immediately
      if (isVideo && window.VideoFrameExtractor) {
        const source = window.VideoFrameExtractor.getSourceCache(sourceKey);
        const fps = (window.currentProjectState && window.currentProjectState.fps) || 60;
        const pps = window.currentPixelsPerSecond || 80;
        const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
        const totalFrames = Math.max(1, Math.round(durSec * fps));
        const isRawIncomplete = !layer._extractComplete || (source && (source.isExtracting || (source.frames && source.frames.size < totalFrames)));
        if (isRawIncomplete && typeof window.VideoFrameExtractor.abortAndRevertPartialSequence === 'function') {
          await window.VideoFrameExtractor.abortAndRevertPartialSequence(layer);
        }
      }

      // Check if already cached (bypass when forced)
      if (!force && !isVideo && this.getPhotoCutout(layer)) {
        return;
      }

      // Deduplicate: avoid queuing duplicate active task for same layer/source
      const isAlreadyRunning = Array.from(this._activeTasks.values()).some(t => {
        return !t.cancelled && (t.layerId === layer.id || t.sourceKey === sourceKey) &&
               (t.status === 'queued' || t.status === 'processing' || (typeof t.status === 'string' && (t.status.startsWith('Download') || t.status === 'downloading_model')));
      });
      if (isAlreadyRunning) return;

      if (this._taskQueue.some(item => !item.task.cancelled && (item.sourceKey === sourceKey || item.layer.id === layer.id))) {
        return;
      }

      // Remove any finished/errored tasks for this footage before adding fresh task so UI never duplicates
      Array.from(this._activeTasks.values()).forEach(t => {
        if (t.sourceKey === sourceKey || t.layerId === layer.id) {
          this._activeTasks.delete(t.id);
        }
      });

      const taskId = `task_${layer.id}_${Date.now()}`;
      const eff = this.getLayerMattingEffect(layer);
      const modelId = (eff && (eff.model || (eff.params && eff.params.model))) || 'rvm_mobilenetv3';

      const task = {
        id: taskId,
        layerId: layer.id,
        sourceKey: sourceKey,
        layerName: layer.name || (isVideo ? 'Video Clip' : 'Photo Layer'),
        type: isVideo ? 'video' : 'photo',
        thumbUrl: layer.thumbUrl || layer.mediaUrl || layer.dataUrl || '',
        status: 'queued',
        currentFrame: 0,
        totalFrames: isVideo ? 100 : 1,
        percent: 0,
        cancelled: false
      };

      this._activeTasks.set(taskId, task);
      this._notifyProgress();

      this._taskQueue.push({ task, layer, sourceKey, modelId });
      this._runQueue();
    }

    async _runQueue() {
      if (this._isQueueRunning) return;
      this._isQueueRunning = true;

      while (this._taskQueue.length > 0) {
        const item = this._taskQueue.shift();
        if (item.task.cancelled) {
          this._activeTasks.delete(item.task.id);
          continue;
        }

        item.task.status = 'processing';
        this._notifyProgress();

        // Critical: yield to requestAnimationFrame so browser paints the progress badge to DOM first
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 40)));
        await yieldToUI();

        try {
          if (item.task.type === 'video') {
            await this._processVideoTask(item);
          } else {
            await this._processPhotoTask(item);
          }
          item.task.status = 'done';
          item.task.percent = 100;
        } catch (err) {
          console.warn('[FishBgRemovalEngine] Task error:', err);
          item.task.status = 'error';
          item.task.error = err.message || 'Processing error';
        }

        this._notifyProgress();
        // Remove completed task from active tasks after 4 seconds
        setTimeout(() => {
          this._activeTasks.delete(item.task.id);
          this._notifyProgress();
        }, 4000);

        if (typeof window.invalidatePreviewCacheForLayer === 'function') {
          window.invalidatePreviewCacheForLayer(item.layer);
        }
        if (window.PreviewCacheManager && typeof window.PreviewCacheManager.clear === 'function') {
          window.PreviewCacheManager.clear();
        }
        if (typeof window.redrawComposition === 'function') {
          window.redrawComposition('bg-removed-complete');
        }
        if (window.FishTemplateEditor && typeof window.FishTemplateEditor.renderFrame === 'function') {
          window.FishTemplateEditor.renderFrame();
        }
      }

      this._isQueueRunning = false;
    }

    async _processPhotoTask({ task, layer, sourceKey, modelId }) {
      task.status = 'downloading_model';
      this._notifyProgress();

      const sessionObj = await this.getSession(modelId, 'gpu', (pct) => {
        task.status = `Downloading model (${pct}%)`;
        this._notifyProgress();
      });

      task.status = 'processing';
      this._notifyProgress();

      // Retrieve source image
      let srcEl = null;
      if (layer._fillMediaImg && (layer._fillMediaImg.complete || layer._fillMediaImg instanceof ImageBitmap)) {
        srcEl = layer._fillMediaImg;
      } else if (window.layerMediaCache) {
        const cached = window.layerMediaCache.get(layer.id) || (layer.mediaId ? window.layerMediaCache.get(layer.mediaId) : null);
        if (cached && cached.el && (cached.el.complete || cached.isReady)) {
          srcEl = cached.el;
        }
      }

      if (!srcEl && typeof window.getOrLoadLayerMedia === 'function') {
        const m = window.getOrLoadLayerMedia(layer);
        if (m && m.el && (m.el.complete || m.isReady)) {
          srcEl = m.el;
        } else if (m && m.el) {
          await new Promise((resolve) => {
            if (m.el.complete && m.el.naturalWidth > 0) return resolve();
            m.el.addEventListener('load', resolve, { once: true });
            m.el.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 3000);
          });
          if (m.el.naturalWidth > 0) srcEl = m.el;
        }
      }

      if (!srcEl && (layer.dataUrl || layer.mediaUrl || layer.thumbUrl)) {
        const url = layer.dataUrl || layer.mediaUrl || layer.thumbUrl;
        srcEl = await new Promise((resolve) => {
          const img = new Image();
          if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = url;
        });
      }

      if (!srcEl && (layer.mediaId || layer.fillMediaId) && window.FishDatabase && typeof window.FishDatabase.getMedia === 'function') {
        try {
          const m = await window.FishDatabase.getMedia(layer.mediaId || layer.fillMediaId);
          if (m && (m.dataUrl || m.blob || m.thumbUrl)) {
            const url = m.dataUrl || (m.blob ? URL.createObjectURL(m.blob) : m.thumbUrl);
            srcEl = await new Promise((resolve) => {
              const img = new Image();
              if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous';
              img.onload = () => resolve(img);
              img.onerror = () => resolve(null);
              img.src = url;
            });
          }
        } catch (_) {}
      }

      if (!srcEl) throw new Error('Could not resolve photo source image.');

      const maskCanvas = await this.segmentSource(srcEl, modelId, sessionObj);
      const cutout = await this.compositeCutout(srcEl, maskCanvas);

      layer._bgCutoutBitmap = cutout;
      this._photoCutoutCache.set(sourceKey, cutout);
      if (layer.mediaId) this._photoCutoutCache.set(layer.mediaId, cutout);
      if (layer.id) this._photoCutoutCache.set(layer.id, cutout);

      this._savePhotoCutoutToDB(sourceKey, cutout);
      if (layer.mediaId && layer.mediaId !== sourceKey) {
        this._savePhotoCutoutToDB(layer.mediaId, cutout);
      }
      if (layer.id && layer.id !== sourceKey) {
        this._savePhotoCutoutToDB(layer.id, cutout);
      }

      if (window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
        const syncCutouts = (layers) => {
          layers.forEach(l => {
            if (l.id === layer.id || (layer.mediaId && l.mediaId === layer.mediaId) || (sourceKey && (l.mediaId === sourceKey || l.dataUrl === sourceKey))) {
              l._bgCutoutBitmap = cutout;
            }
            if (Array.isArray(l.layers)) syncCutouts(l.layers);
          });
        };
        syncCutouts(window.currentProjectState.layers);
      }

      task.percent = 100;
      task.currentFrame = 1;
    }

    async _processVideoTask({ task, layer, sourceKey, modelId }) {
      task.status = 'downloading_model';
      this._notifyProgress();

      const sessionObj = await this.getSession(modelId, 'gpu', (pct) => {
        task.status = `Downloading model (${pct}%)`;
        this._notifyProgress();
      });

      task.status = 'processing';
      this._notifyProgress();

      // Get frame range from layer duration & fps
      const fps = (window.currentProjectState && window.currentProjectState.fps) || 60;
      const pps = window.currentPixelsPerSecond || 80;
      const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
      const effSpeed = layer.speed || 1.0;

      const totalFramesToProcess = Math.max(1, Math.round(durSec * fps));
      task.totalFrames = totalFramesToProcess;

      let frameCache = this._videoFrameCache.get(sourceKey);
      if (!frameCache) {
        frameCache = new Map();
        this._videoFrameCache.set(sourceKey, frameCache);
      }

      // Check VideoFrameExtractor for cached source frames
      let cachedSource = null;
      if (window.VideoFrameExtractor) {
        cachedSource = window.VideoFrameExtractor.getSourceCache(sourceKey);
        if (!cachedSource) {
          cachedSource = window.VideoFrameExtractor._getOrCreateSource(sourceKey, layer.dataUrl, layer.name, layer.id);
        }
      }

      // Resolve video URL for dedicated decoding element
      let videoUrl = layer.dataUrl || (cachedSource && cachedSource.dataUrl);
      if (!videoUrl && window.FishDatabase && window.currentProjectState && window.currentProjectState.id) {
        try {
          const medias = await window.FishDatabase.getProjectMedia(window.currentProjectState.id);
          let m = (medias || []).find(item => item.id === (layer.mediaId || sourceKey));
          if (!m && layer.name) m = (medias || []).find(item => item.name === layer.name);
          if (m) {
            if (m.dataUrl) videoUrl = m.dataUrl;
            else if (m.blob) videoUrl = URL.createObjectURL(m.blob);
          }
        } catch (_) {}
      }

      let decoderVideo = null;
      let offCanvas = null;
      let offCtx = null;

      if (videoUrl) {
        decoderVideo = document.createElement('video');
        decoderVideo.muted = true;
        decoderVideo.playsInline = true;
        decoderVideo.preload = 'auto';
        decoderVideo.style.cssText = 'position:fixed;bottom:0;right:0;width:32px;height:32px;opacity:0.01;pointer-events:none;z-index:-9999;';
        const mountPool = document.getElementById('editor-video-mount-pool') || document.body;
        mountPool.appendChild(decoderVideo);
        decoderVideo.src = videoUrl;

        await new Promise(resolve => {
          let ready = false;
          const onReady = () => { if (!ready) { ready = true; cleanup(); resolve(); } };
          const timer = setTimeout(() => { if (!ready) { ready = true; cleanup(); resolve(); } }, 2500);
          const cleanup = () => {
            clearTimeout(timer);
            decoderVideo.removeEventListener('loadedmetadata', onReady);
            decoderVideo.removeEventListener('loadeddata', onReady);
            decoderVideo.removeEventListener('canplay', onReady);
            decoderVideo.removeEventListener('error', onReady);
          };
          decoderVideo.addEventListener('loadedmetadata', onReady, { once: true });
          decoderVideo.addEventListener('loadeddata', onReady, { once: true });
          decoderVideo.addEventListener('canplay', onReady, { once: true });
          decoderVideo.addEventListener('error', onReady, { once: true });
        });

        const vw = decoderVideo.videoWidth || layer.mediaWidth || 640;
        const vh = decoderVideo.videoHeight || layer.mediaHeight || 360;
        const maxDim = 960;
        const scale = Math.min(1, maxDim / Math.max(vw, vh));
        const targetW = Math.max(160, Math.round(vw * scale));
        const targetH = Math.max(90, Math.round(vh * scale));

        if (typeof OffscreenCanvas !== 'undefined') {
          offCanvas = new OffscreenCanvas(targetW, targetH);
        } else {
          offCanvas = document.createElement('canvas');
          offCanvas.width = targetW;
          offCanvas.height = targetH;
        }
        offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
      }

      try {
        // Process sequentially for temporal recurrent state stability
        for (let i = 0; i < totalFramesToProcess; i++) {
          if (task.cancelled) break;

          const timeInClip = (layer.sourceOffsetSec || 0) + (i / fps) * effSpeed;
          const fIdx = Math.round(timeInClip * ((cachedSource && cachedSource.fps) || fps));

          // Skip if already in cache
          if (frameCache.has(fIdx)) {
            task.currentFrame = i + 1;
            task.percent = Math.round(((i + 1) / totalFramesToProcess) * 100);
            layer._extractProgress = (i + 1) / totalFramesToProcess;
            continue;
          }

          let rawFrame = null;
          // Check if previously extracted raw frame exists in RAM or DB
          if (cachedSource && cachedSource.frames && cachedSource.frames.has(fIdx)) {
            rawFrame = cachedSource.frames.get(fIdx);
          } else if (cachedSource && window.VideoFrameExtractor && typeof window.VideoFrameExtractor.fetchFrameFromDB === 'function') {
            try {
              rawFrame = await window.VideoFrameExtractor.fetchFrameFromDB(cachedSource, fIdx);
            } catch (_) {}
          }

          // Otherwise seek dedicated decoder video directly to exact timestamp
          if (!rawFrame && decoderVideo && decoderVideo.readyState >= 1) {
            const targetTime = Math.min(Math.max(0, (decoderVideo.duration || 3600) - 0.01), Math.max(0, timeInClip));
            await new Promise(resolve => {
              if (Math.abs(decoderVideo.currentTime - targetTime) < 0.003) return resolve(true);
              let resolved = false;
              const cleanup = () => {
                decoderVideo.removeEventListener('seeked', onSeek);
                decoderVideo.removeEventListener('error', onError);
              };
              const timer = setTimeout(() => {
                if (!resolved) { resolved = true; cleanup(); resolve(false); }
              }, 600);
              const onSeek = () => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                cleanup();
                resolve(true);
              };
              const onError = () => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                cleanup();
                resolve(false);
              };
              decoderVideo.addEventListener('seeked', onSeek, { once: true });
              decoderVideo.addEventListener('error', onError, { once: true });
              try { decoderVideo.currentTime = targetTime; } catch (_) { onError(); }
            });

            if (offCtx && offCanvas) {
              offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
              offCtx.drawImage(decoderVideo, 0, 0, offCanvas.width, offCanvas.height);
              rawFrame = offCanvas;
            } else {
              rawFrame = decoderVideo;
            }
          }

          if (rawFrame) {
            try {
              const maskCanvas = await this.segmentSource(rawFrame, modelId, sessionObj);
              const cutout = await this.compositeCutout(rawFrame, maskCanvas);
              frameCache.set(fIdx, cutout);

              // Seamlessly populate VideoFrameExtractor so timeline scrubbing and playback read the cutouts directly
              if (cachedSource) {
                cachedSource.frames.set(fIdx, cutout);
                if (!cachedSource.cachedFrameIndices) cachedSource.cachedFrameIndices = new Set();
                cachedSource.cachedFrameIndices.add(fIdx);
                cachedSource._hasNewExtractedFrames = true;

                // Queue save to IndexedDB as WebP (with alpha) so cutouts persist across reloads
                if (window.VideoFrameExtractor && typeof window.VideoFrameExtractor._queueFrameSave === 'function') {
                  if (typeof cutout.convertToBlob === 'function') {
                    cutout.convertToBlob({ type: 'image/webp', quality: 0.85 }).then(blob => {
                      if (blob) window.VideoFrameExtractor._queueFrameSave(sourceKey, fIdx, blob, fps);
                    }).catch(() => {});
                  } else if (typeof cutout.toBlob === 'function') {
                    cutout.toBlob(blob => {
                      if (blob) window.VideoFrameExtractor._queueFrameSave(sourceKey, fIdx, blob, fps);
                    }, 'image/webp', 0.85);
                  }
                }
              }
            } catch (segErr) {
              console.warn('[FishBgRemovalEngine] Frame segment error at', fIdx, segErr);
            }
          }

          task.currentFrame = i + 1;
          task.percent = Math.round(((i + 1) / totalFramesToProcess) * 100);
          layer._extractProgress = (i + 1) / totalFramesToProcess;
          if (i + 1 >= totalFramesToProcess) {
            layer._extractComplete = true;
          }

          if (window.VideoFrameExtractor) {
            window.VideoFrameExtractor.updateLayerProgressBar(layer);
          }

          // Notify progress every 2 frames or at completion
          if (i % 2 === 0 || i === totalFramesToProcess - 1) {
            this._notifyProgress();
          }

          // Selectively redraw composition to show live cutouts
          if (typeof window.redrawComposition === 'function' && (i % 3 === 0 || i === totalFramesToProcess - 1)) {
            window.redrawComposition('cutoutFrameReady');
          }

          // Yield to browser UI loop so scrubbing & playback remain 60 FPS smooth
          await yieldToUI();
        }
      } finally {
        if (decoderVideo) {
          try {
            decoderVideo.removeAttribute('src');
            decoderVideo.load();
            if (decoderVideo.parentNode) decoderVideo.parentNode.removeChild(decoderVideo);
          } catch (_) {}
          decoderVideo = null;
        }
        if (cachedSource && window.VideoFrameExtractor && typeof window.VideoFrameExtractor._flushSaveQueue === 'function') {
          window.VideoFrameExtractor._flushSaveQueue();
        }
        if (!task.cancelled) {
          layer._extractComplete = true;
          layer._extractProgress = 1;
          task.percent = 100;
          task.status = 'done';
          this._notifyProgress();
          if (window.VideoFrameExtractor) {
            window.VideoFrameExtractor.updateLayerProgressBar(layer);
          }
          if (typeof window.redrawComposition === 'function') {
            window.redrawComposition('bgRemovalDone');
          }
        }
      }
    }
  }

  window.FishBgRemovalEngine = new BgRemovalEngine();
})(window);
