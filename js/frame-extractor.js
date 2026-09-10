/**
 * FishTool Studio - VideoFrameExtractor
 * Shared Media-Source Range Extractor & Frame Cache
 * 
 * Features:
 * 1. Global Source Cache: Keyed by mediaId / dataUrl. Duplicate layers share the exact same frames!
 * 2. Incremental Range Extraction: Only extracts missing frames within the visible clip range.
 * 3. Realtime Smooth Updates: Zero-delay seek with timeout and frame-by-frame UI event loop yields.
 * 4. Multi-layer Progress Bars: Updates progress bar of all active layers referencing this source based on their own range.
 * 5. Instant 60+ FPS Scrubbing: Direct ImageBitmap retrieval from RAM.
 */

(function(window) {
  'use strict';

  const DB_NAME = 'FishFrameCacheDB';
  const DB_VERSION = 4;
  const STORE_NAME = 'frames';

  function openFrameCacheDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          let store;
          if (db.objectStoreNames.contains(STORE_NAME)) {
            db.deleteObjectStore(STORE_NAME);
          }
          store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('sourceKey', 'sourceKey', { unique: false });
          store.createIndex('sourceFpsKey', ['sourceKey', 'fps'], { unique: false });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

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

  class VideoFrameExtractor {
    constructor() {
      // sourceKey -> { sourceKey, dataUrl, frames: Map<frameIdx, ImageBitmap>, cachedFrameIndices: Set<number>, fps, width, height, duration, isExtracting, isDbLoaded, dbLoadPromise, activeVideo, pendingFrames: Set<frameIdx>, _fetchingFrames: Set<number> }
      this.sources = new Map();
      this._targetFps = 60;
      this.maxRamFrames = 600; // 10 seconds of 60 FPS lookahead frames in RAM
      this._db = null;
      this._dbPromise = null;
      this._saveQueue = [];
      this._flushTimer = null;
      this._rafProgressBarScheduled = false;

      this._interpCache = new Map();
      this._ofCanvas0 = null;
      this._ofCtx0 = null;
      this._ofCanvas1 = null;
      this._ofCtx1 = null;

      if (typeof window !== 'undefined') {
        const markInteraction = () => {
          window._lastUserInteractionTime = Date.now();
        };
        window.addEventListener('pointerdown', markInteraction, { passive: true, capture: true });
        window.addEventListener('pointermove', (e) => {
          if (e.buttons > 0) markInteraction();
        }, { passive: true, capture: true });
        window.addEventListener('wheel', markInteraction, { passive: true, capture: true });
        window.addEventListener('keydown', markInteraction, { passive: true, capture: true });

        window.addEventListener('beforeunload', () => {
          this._flushSaveQueue();
        });
      }
    }

    /**
     * Check if user is actively interacting (playing, scrubbing, dragging, or recent pointer activity)
     */
    _isUserInteracting() {
      if (typeof window === 'undefined') return false;
      if (window.isTimelinePlaying) return true;
      if (window.isTimelineScrubbing || window.isTimelinePanning) return true;
      if (window.isUserInteracting) return true;
      if (window._lastUserInteractionTime && (Date.now() - window._lastUserInteractionTime < 300)) {
        return true;
      }
      return false;
    }

    /**
     * Compute current playhead's video-relative frame index for a specific source
     */
    _getVideoFrameForPlayhead(source) {
      if (!source) return 0;
      const pps = window.currentPixelsPerSecond || 80;
      const curSec = (typeof window.getCurrentPlayheadTime === 'function')
        ? window.getCurrentPlayheadTime()
        : ((Math.abs(window.timelinePanX || 0)) / pps);

      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
      for (const l of layers) {
        if (l.type === 'video' && !l.hidden && this._getSourceKey(l) === source.sourceKey) {
          const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
          const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 400) / pps);
          if (curSec >= start && curSec <= start + dur) {
            const effSpeed = (typeof window.getLayerEffectivePropsAtTime === 'function')
              ? (window.getLayerEffectivePropsAtTime(l, curSec).speed || l.speed || 1.0)
              : (l.speed !== undefined && l.speed > 0 ? l.speed : 1.0);
            const timeInClip = Math.max(0, (l.sourceOffsetSec || 0) + (curSec - start) * effSpeed);
            return Math.round(timeInClip * (source.fps || 60));
          }
        }
      }
      for (const l of layers) {
        if (l.type === 'video' && this._getSourceKey(l) === source.sourceKey) {
          const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
          const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 400) / pps);
          const targetSec = (curSec < start) ? 0 : dur;
          const effSpeed = (typeof window.getLayerEffectivePropsAtTime === 'function')
            ? (window.getLayerEffectivePropsAtTime(l, curSec).speed || l.speed || 1.0)
            : (l.speed !== undefined && l.speed > 0 ? l.speed : 1.0);
          const timeInClip = Math.max(0, (l.sourceOffsetSec || 0) + targetSec * effSpeed);
          return Math.round(timeInClip * (source.fps || 60));
        }
      }
      return 0;
    }

    _evictOldestFrame(source, protectIdx = null) {
      if (!source || !source.frames || source.frames.size <= this.maxRamFrames) return;
      const curFIdx = this._getVideoFrameForPlayhead(source);

      let worstIdx = -1;
      let worstScore = -1;

      for (const fIdx of source.frames.keys()) {
        if (fIdx === protectIdx) continue;
        // Never evict frame 0: it is the primary opening anchor for the layer
        if (fIdx === 0 && source.frames.size > 1) continue;

        let score;
        if (fIdx < curFIdx) {
          // Behind playhead: evicted first (higher score = evicted sooner)
          score = (curFIdx - fIdx) + 1000;
        } else {
          // Ahead of playhead: protect lookahead buffer [curFIdx, curFIdx + 180]
          const aheadDist = fIdx - curFIdx;
          score = aheadDist > 180 ? (aheadDist + 100) : (aheadDist * 0.1);
        }

        if (score > worstScore) {
          worstScore = score;
          worstIdx = fIdx;
        }
      }

      if (worstIdx !== -1) {
        const bmp = source.frames.get(worstIdx);
        source.frames.delete(worstIdx);
        if (bmp && typeof bmp.close === 'function') {
          try { bmp.close(); } catch (_) {}
        }
      }
    }

    isAnySourceExtracting() {
      for (const s of this.sources.values()) {
        if (s.isExtracting) return true;
      }
      return false;
    }

    get targetFps() {
      if (typeof window !== 'undefined') {
        if (typeof window.getProjectFps === 'function') {
          const pFps = window.getProjectFps();
          if (pFps && pFps > 0) return Math.max(1, pFps);
        }
        if (window.currentProjectState && window.currentProjectState.fps) {
          const pFps = parseInt(window.currentProjectState.fps, 10);
          if (pFps && pFps > 0) return Math.max(1, pFps);
        }
      }
      return Math.max(1, this._targetFps || 60);
    }

    set targetFps(val) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed) && parsed > 0) {
        this.setFps(parsed);
      }
    }

    setFps(val) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed) && parsed > 0) {
        // No artificial FPS cap — support native project FPS (24/30/60/120)
        const fpsChanged = (this._targetFps !== parsed);
        if (fpsChanged) {
          this._targetFps = parsed;
          this.clearAll();
        }
        if (typeof window !== 'undefined' && window.currentProjectState && window.currentProjectState.layers) {
          window.currentProjectState.layers.forEach(l => {
            if (l.type === 'video' && (l.dataUrl || l.mediaId)) {
              this.extractLayerRange(l);
            }
          });
        }
      }
    }

    clearAll() {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      this._saveQueue = [];
      for (const source of this.sources.values()) {
        if (source.activeVideo) {
          try {
            source.activeVideo.removeAttribute('src');
            source.activeVideo.load();
            if (source.activeVideo.parentNode) {
              source.activeVideo.parentNode.removeChild(source.activeVideo);
            }
          } catch (_) {}
          source.activeVideo = null;
        }
        source.isExtracting = false;
        if (source.frames) {
          for (const bmp of source.frames.values()) {
            if (bmp && typeof bmp.close === 'function') {
              bmp.close();
            }
          }
          source.frames.clear();
        }
        if (source.cachedFrameIndices) {
          source.cachedFrameIndices.clear();
        }
        if (source._fetchingFrames) {
          source._fetchingFrames.clear();
        }
        if (source.pendingFrames) {
          source.pendingFrames.clear();
        }
        source.isDbLoaded = false;
        source.dbLoadPromise = null;
      }
      this.sources.clear();
    }

    _getDB() {
      if (this._db) return Promise.resolve(this._db);
      if (this._dbPromise) return this._dbPromise;
      this._dbPromise = openFrameCacheDB().then(db => {
        this._db = db;
        return db;
      });
      return this._dbPromise;
    }

    _queueFrameSave(sourceKey, frameIdx, blob, fps = this.targetFps) {
      if (!sourceKey || blob == null) return;
      const effectiveFps = fps || this.targetFps;
      this._saveQueue.push({
        key: `${sourceKey}_${effectiveFps}_${frameIdx}`,
        sourceKey: sourceKey,
        fps: effectiveFps,
        frameIdx: frameIdx,
        blob: blob
      });

      if (this._saveQueue.length >= 10) {
        this._flushSaveQueue();
      } else if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => {
          this._flushTimer = null;
          this._flushSaveQueue();
        }, 80);
      }
    }

    _flushSaveQueue() {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      if (!this._saveQueue || this._saveQueue.length === 0) return;
      const batch = this._saveQueue.splice(0, this._saveQueue.length);

      this._getDB().then(db => {
        if (!db) return;
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          for (const item of batch) {
            store.put(item);
          }
        } catch (err) {
          console.warn('Frame cache batch save error:', err);
        }
      });
    }

    _getSourceKey(layer) {
      if (!layer) return '';
      if (layer.mediaId) return layer.mediaId;
      if (layer.dataUrl && !layer.dataUrl.startsWith('blob:')) return layer.dataUrl;
      if (window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
        const matching = window.currentProjectState.layers.find(l => l && (l.id === layer.id || (l.name === layer.name && l.type === layer.type)) && l.mediaId);
        if (matching && matching.mediaId) {
          layer.mediaId = matching.mediaId;
          return layer.mediaId;
        }
      }
      if (layer.name && this.sources) {
        for (const [key, src] of this.sources.entries()) {
          if (src && src.name === layer.name) return key;
        }
      }
      if (layer.id) return 'src_' + layer.id;
      return layer.dataUrl || '';
    }

    getSourceCache(sourceKey) {
      return this.sources.get(sourceKey) || null;
    }

    /**
     * Fetch a specific missing frame directly from IndexedDB point-lookup
     */
    async fetchFrameFromDB(source, frameIdx, callback = null) {
      if (!source) {
        if (callback) callback(null);
        return;
      }
      if (source.frames.has(frameIdx)) {
        if (callback) callback(source.frames.get(frameIdx));
        return;
      }
      if (!source._fetchCallbacks) source._fetchCallbacks = new Map();
      if (callback) {
        const list = source._fetchCallbacks.get(frameIdx) || [];
        list.push(callback);
        source._fetchCallbacks.set(frameIdx, list);
      }
      if (source._fetchingFrames && source._fetchingFrames.has(frameIdx)) return;
      if (!source._fetchingFrames) source._fetchingFrames = new Set();
      source._fetchingFrames.add(frameIdx);

      const db = await this._getDB();
      if (!db) {
        source._fetchingFrames.delete(frameIdx);
        this._flushFetchCallbacks(source, frameIdx, null);
        return;
      }
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const effectiveFps = parseInt(source.fps || this.targetFps, 10) || 60;
        const key = `${source.sourceKey}_${effectiveFps}_${frameIdx}`;
        const req = store.get(key);
        req.onsuccess = async () => {
          source._fetchingFrames.delete(frameIdx);
          const rec = req.result;
          let loadedBmp = null;
          if (rec && rec.blob) {
            try {
              const bmp = await createImageBitmap(rec.blob);
              const fpsMatch = !rec.fps || !source.fps || parseInt(source.fps, 10) === parseInt(rec.fps, 10);
              if (this.sources.has(source.sourceKey) && fpsMatch) {
                source.frames.set(frameIdx, bmp);
                this._evictOldestFrame(source, frameIdx);
                loadedBmp = bmp;
                const curPlayheadFIdx = this._getVideoFrameForPlayhead(source);
                if (Math.abs(frameIdx - curPlayheadFIdx) <= 15 && typeof window.redrawComposition === 'function' && !window.isTimelinePlaying && !window.isExporting) {
                  window.redrawComposition('frameReady');
                }
              } else if (bmp && typeof bmp.close === 'function') {
                bmp.close();
              }
            } catch (_) {}
          }
          this._flushFetchCallbacks(source, frameIdx, loadedBmp);
        };
        req.onerror = () => {
          source._fetchingFrames.delete(frameIdx);
          this._flushFetchCallbacks(source, frameIdx, null);
        };
      } catch (_) {
        source._fetchingFrames.delete(frameIdx);
        this._flushFetchCallbacks(source, frameIdx, null);
      }
    }

    _flushFetchCallbacks(source, frameIdx, bmp) {
      if (source && source._fetchCallbacks && source._fetchCallbacks.has(frameIdx)) {
        const cbs = source._fetchCallbacks.get(frameIdx) || [];
        source._fetchCallbacks.delete(frameIdx);
        cbs.forEach(cb => {
          try { cb(bmp); } catch (_) {}
        });
      }
    }

    fetchFrameFromDBAsync(source, frameIdx) {
      if (!source || source.frames.has(frameIdx)) return Promise.resolve(source ? source.frames.get(frameIdx) : null);
      return new Promise(resolve => {
        this.fetchFrameFromDB(source, frameIdx, resolve);
      });
    }

    /**
     * Stream upcoming frames from IndexedDB into RAM cache ahead of playhead during playback
     */
    async ensurePlaybackFrames(source, currentFIdx, windowSize = 180) {
      if (!source || !source.cachedFrameIndices || source.cachedFrameIndices.size === 0) return;
      if (source._isStreamingPrefetch) return;

      const missing = [];
      const startFIdx = Math.max(0, currentFIdx - Math.round(windowSize / 3));
      const endFIdx = currentFIdx + windowSize;
      for (let f = startFIdx; f <= endFIdx; f++) {
        if (source.cachedFrameIndices.has(f) && (!source.frames || !source.frames.has(f))) {
          if (!source._fetchingFrames || !source._fetchingFrames.has(f)) {
            missing.push(f);
          }
        }
      }

      if (missing.length === 0) return;

      source._isStreamingPrefetch = true;
      try {
        const db = await this._getDB();
        if (!db) return;

        // Cover full 3s lookahead at 60fps in fast responsive batches
        const batchSize = Math.min(60, missing.length);
        const batch = missing.slice(0, batchSize);
        batch.forEach(idx => {
          if (!source._fetchingFrames) source._fetchingFrames = new Set();
          source._fetchingFrames.add(idx);
        });

        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const effectiveFps = parseInt(source.fps || this.targetFps, 10) || 60;

        await Promise.all(batch.map(idx => new Promise(res => {
          try {
            const key = `${source.sourceKey}_${effectiveFps}_${idx}`;
            const req = store.get(key);
            req.onsuccess = async () => {
              if (source._fetchingFrames) source._fetchingFrames.delete(idx);
              const rec = req.result;
              if (rec && rec.blob && (!source.frames || !source.frames.has(idx))) {
                try {
                  const bmp = await createImageBitmap(rec.blob);
                  if (!source.fps || parseInt(source.fps, 10) === effectiveFps) {
                    source.frames.set(idx, bmp);
                    this._evictOldestFrame(source, idx);
                  } else if (bmp && typeof bmp.close === 'function') {
                    bmp.close();
                  }
                } catch (_) {}
              }
              res();
            };
            req.onerror = () => {
              if (source._fetchingFrames) source._fetchingFrames.delete(idx);
              res();
            };
          } catch (_) {
            if (source._fetchingFrames) source._fetchingFrames.delete(idx);
            res();
          }
        })));
      } finally {
        source._isStreamingPrefetch = false;
        if (typeof window.redrawComposition === 'function' && !window.isTimelinePlaying && !window.isExporting) {
          window.redrawComposition('playbackFramesBatchLoaded');
        }
      }
    }

    /**
     * Ensure source cache entry exists
     */
    _getOrCreateSource(sourceKey, dataUrl, name = '', layerId = '') {
      const currentFps = this.targetFps;
      if (this.sources.has(sourceKey)) {
        const existing = this.sources.get(sourceKey);
        if (name && !existing.name) existing.name = name;
        if (layerId && !existing.layerId) existing.layerId = layerId;
        if (existing.fps !== currentFps) {
          // Project FPS changed! Invalidate stale frames immediately
          if (existing.frames) {
            for (const bmp of existing.frames.values()) {
              if (bmp && typeof bmp.close === 'function') bmp.close();
            }
            existing.frames.clear();
          }
          if (existing.cachedFrameIndices) existing.cachedFrameIndices.clear();
          if (existing._fetchingFrames) existing._fetchingFrames.clear();
          if (existing.pendingFrames) existing.pendingFrames.clear();
          existing.fps = currentFps;
          existing.isDbLoaded = false;
          existing.dbLoadPromise = null;
        }
      } else {
        this.sources.set(sourceKey, {
          sourceKey: sourceKey,
          name: name || '',
          layerId: layerId || '',
          dataUrl: dataUrl,
          frames: new Map(),
          cachedFrameIndices: new Set(),
          _fetchingFrames: new Set(),
          fps: currentFps,
          width: 480,
          height: 270,
          duration: 0,
          isExtracting: false,
          isDbLoaded: false,
          dbLoadPromise: null,
          activeVideo: null,
          pendingFrames: new Set()
        });
      }
      const source = this.sources.get(sourceKey);
      if (name && !source.name) source.name = name;
      if (layerId && !source.layerId) source.layerId = layerId;
      if (dataUrl && dataUrl !== source.dataUrl) {
        source.dataUrl = dataUrl;
      }
      return source;
    }

    /**
     * Load existing cached frame indices from IndexedDB and decode active playhead window into RAM
     */
    async _loadFramesFromDB(source) {
      const db = await this._getDB();
      if (!db) {
        source.isDbLoaded = true;
        return;
      }

      const currentFps = parseInt(source.fps || this.targetFps, 10) || 60;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          let req;
          if (store.indexNames.contains('sourceFpsKey')) {
            const index = store.index('sourceFpsKey');
            req = index.getAll(IDBKeyRange.only([source.sourceKey, currentFps]));
          } else if (store.indexNames.contains('sourceKey')) {
            const index = store.index('sourceKey');
            req = index.getAll(IDBKeyRange.only(source.sourceKey));
          } else {
            req = store.getAll();
          }

          req.onsuccess = async () => {
            const records = req.result || [];
            if (records.length > 0) {
              if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
              for (const rec of records) {
                if (rec && rec.frameIdx !== undefined && rec.frameIdx !== null) {
                  const recFps = parseInt(rec.fps, 10);
                  if (!recFps || recFps === currentFps) {
                    source.cachedFrameIndices.add(rec.frameIdx);
                  }
                }
              }

              if (source && (!source.duration || source.duration === 0)) {
                let maxF = 0;
                for (const f of source.cachedFrameIndices) {
                  if (f > maxF) maxF = f;
                }
                if (maxF > 0) {
                  source.duration = Math.max(source.duration || 0, (maxF + 1) / currentFps);
                }
              }

              // Sequential cache loading in ascending frame order from left to right
              const initialBatchSize = 150;

              const prioritized = records
                .filter(rec => rec && rec.blob && (!rec.fps || parseInt(rec.fps, 10) === currentFps))
                .sort((a, b) => a.frameIdx - b.frameIdx);

              const initialChunk = prioritized.slice(0, initialBatchSize);

              const chunkSize = 25;
              for (let i = 0; i < initialChunk.length; i += chunkSize) {
                if (!this.sources.has(source.sourceKey)) break;
                if (parseInt(source.fps, 10) !== currentFps) break;
                const chunk = initialChunk.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (rec) => {
                  if (rec && rec.blob && !source.frames.has(rec.frameIdx)) {
                    try {
                      const bmp = await createImageBitmap(rec.blob);
                      if (!source.fps || parseInt(source.fps, 10) === currentFps) {
                        source.frames.set(rec.frameIdx, bmp);
                      } else if (bmp && typeof bmp.close === 'function') {
                        bmp.close();
                      }
                    } catch (_) {}
                  }
                }));
                await yieldToUI();
              }

              // Instantly mark DB loaded and notify UI so timeline is immediately ready!
              source.isDbLoaded = true;
              this._notifyLayersForSource(source.sourceKey, true);
              resolve();

              // Tahap B: Background idle streaming for remaining cached frames (non-blocking)
              this._startBackgroundIdleHydration(source, prioritized.slice(initialBatchSize), currentFps);
              return;
            }
            source.isDbLoaded = true;
            this._notifyLayersForSource(source.sourceKey, true);
            resolve();
          };

          req.onerror = () => {
            source.isDbLoaded = true;
            resolve();
          };
        } catch (_) {
          source.isDbLoaded = true;
          resolve();
        }
      });
    }

    /**
     * Smart Sliding Window Tahap B: Background idle streaming for remaining cached frames
     */
    _startBackgroundIdleHydration(source, remainingRecords, currentFps) {
      if (!remainingRecords || remainingRecords.length === 0) return;
      if (source._idleHydrationRunning) return;
      source._idleHydrationRunning = true;

      let currentIndex = 0;
      const step = async () => {
        if (!this.sources.has(source.sourceKey) || parseInt(source.fps, 10) !== currentFps) {
          source._idleHydrationRunning = false;
          return;
        }
        if (currentIndex >= remainingRecords.length || (source.frames && source.frames.size >= this.maxRamFrames)) {
          source._idleHydrationRunning = false;
          return;
        }

        // Pause idle hydration during playback, scrubbing, or user interaction to ensure 60fps UI
        if (window.isTimelinePlaying || window.isTransformInteracting || (typeof isPanning !== 'undefined' && isPanning)) {
          setTimeout(step, 250);
          return;
        }

        const chunk = remainingRecords.slice(currentIndex, currentIndex + 12);
        currentIndex += 12;

        await Promise.all(chunk.map(async (rec) => {
          if (rec && rec.blob && (!source.frames || !source.frames.has(rec.frameIdx))) {
            try {
              const bmp = await createImageBitmap(rec.blob);
              if (!source.fps || parseInt(source.fps, 10) === currentFps) {
                source.frames.set(rec.frameIdx, bmp);
                this._evictOldestFrame(source, rec.frameIdx);
              } else if (bmp && typeof bmp.close === 'function') {
                bmp.close();
              }
            } catch (_) {}
          }
        }));

        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(step, { timeout: 350 });
        } else {
          setTimeout(step, 80);
        }
      };

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(step, { timeout: 350 });
      } else {
        setTimeout(step, 80);
      }
    }

    /**
     * Compute frame index range required by a layer (clamped to true video duration)
     */
    getLayerFrameRange(layer) {
      const fps = this.targetFps;
      const pixelsPerSec = window.currentPixelsPerSecond || 80;
      const offsetSec = Math.max(0, layer.sourceOffsetSec || 0);
      const durSec = (layer.durationSec !== undefined && layer.durationSec > 0)
        ? layer.durationSec
        : ((layer.widthPx || 320) / pixelsPerSec);

      let minTimeSec = offsetSec;
      let maxTimeSec = offsetSec;

      if (layer.speedMode === 'time_remap') {
        if (layer.keyframes && Array.isArray(layer.keyframes.timeRemap) && layer.keyframes.timeRemap.length > 0) {
          const remapVals = layer.keyframes.timeRemap.map(k => (k.value && k.value.timeRemap !== undefined ? k.value.timeRemap : 0));
          minTimeSec = Math.min(...remapVals);
          maxTimeSec = Math.max(...remapVals);
        } else {
          minTimeSec = 0;
          maxTimeSec = durSec;
        }
      } else if (layer.keyframes && Array.isArray(layer.keyframes.speed) && layer.keyframes.speed.length > 0) {
        const pps = window.currentPixelsPerSecond || 80;
        const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        if (typeof window.getLayerIntegratedSpeedTime === 'function') {
          minTimeSec = window.getLayerIntegratedSpeedTime(layer, start);
          maxTimeSec = window.getLayerIntegratedSpeedTime(layer, start + durSec);
        } else {
          minTimeSec = offsetSec;
          maxTimeSec = offsetSec + durSec * 4.0;
        }
      } else {
        const effSpeed = (layer.speed !== undefined && layer.speed > 0) ? layer.speed : 1.0;
        const videoDurationConsumed = durSec * effSpeed;
        minTimeSec = offsetSec;
        maxTimeSec = offsetSec + videoDurationConsumed;
      }

      const sourceKey = this._getSourceKey(layer);
      const source = this.sources.get(sourceKey);
      const trueMediaDur = (source && isFinite(source.duration) && source.duration > 0)
        ? source.duration
        : (layer.mediaDuration && isFinite(layer.mediaDuration) && layer.mediaDuration > 0 ? layer.mediaDuration : maxTimeSec);

      const startIdx = Math.max(0, Math.floor(minTimeSec * fps));
      let endIdx = Math.ceil(maxTimeSec * fps) + 2;
      if (trueMediaDur > 0) {
        const maxVideoFrame = Math.max(0, Math.floor(trueMediaDur * fps) - 1);
        endIdx = Math.min(endIdx, maxVideoFrame);
      }
      endIdx = Math.max(startIdx, endIdx);
      return { startIdx, endIdx, total: Math.max(1, endIdx - startIdx + 1) };
    }

    /**
     * Check whether the frame at a specific timeline second for a video layer is ready in RAM cache
     */
    isVideoFrameReady(layer, currentSec) {
      if (!layer || layer.type !== 'video') return true;
      const sourceKey = this._getSourceKey(layer);
      const source = this.sources.get(sourceKey);
      if (!source || !source.frames) return false;

      const pixelsPerSec = window.currentPixelsPerSecond || 80;
      const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSec);
      let timeInClip = 0;
      if (layer.speedMode === 'time_remap') {
        const eff = (typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(layer, currentSec)
          : layer;
        timeInClip = Math.max(0, eff.timeRemap !== undefined ? eff.timeRemap : ((currentSec - start) * (layer.speed || 1.0)));
      } else {
        timeInClip = (typeof window.getLayerIntegratedSpeedTime === 'function')
          ? window.getLayerIntegratedSpeedTime(layer, currentSec)
          : Math.max(0, (layer.sourceOffsetSec || 0) + (currentSec - start) * (layer.speed || 1.0));
      }
      const rawFrame = timeInClip * source.fps;

      const interp = layer.speedInterpolation || 'none';
      if (interp === 'blend' || interp === 'optical_flow') {
        const f0 = Math.floor(rawFrame);
        const f1 = f0 + 1;
        const has0 = source.frames.has(f0) || (source.cachedFrameIndices && source.cachedFrameIndices.has(f0));
        const has1 = source.frames.has(f1) || (source.cachedFrameIndices && source.cachedFrameIndices.has(f1));
        return has0 && has1;
      }

      const fIdx = Math.round(rawFrame);
      return source.frames.has(fIdx) || (source.cachedFrameIndices && source.cachedFrameIndices.has(fIdx));
    }

    /**
     * Clear all synthesized sub-frame interpolation buffers
     */
    clearInterpolationCache() {
      if (this._interpCache) {
        this._interpCache.clear();
      }
    }

    /**
     * Get or synthesize an interpolated video frame between integer frames
     * @param {Object} source - Video source cache entry
     * @param {number} timeInClip - Sub-frame time inside media clip
     * @param {string} mode - 'none' | 'blend' | 'optical_flow'
     * @param {number} targetW - Canvas width
     * @param {number} targetH - Canvas height
     */
    getInterpolatedFrame(source, timeInClip, mode = 'none', targetW = null, targetH = null) {
      if (!source || !source.frames) return null;
      const fps = source.fps || 60;
      const rawFrame = Math.max(0, timeInClip * fps);
      const f0 = Math.floor(rawFrame);
      const f1 = f0 + 1;
      const alpha = rawFrame - f0;

      // Nearest-neighbor if mode is none or at integer boundaries
      if (mode === 'none' || mode === 'nearest' || alpha < 0.02) {
        return source.frames.get(Math.round(rawFrame)) || source.frames.get(f0) || null;
      }
      if (alpha > 0.98) {
        return source.frames.get(f1) || source.frames.get(Math.round(rawFrame)) || null;
      }

      const frame0 = source.frames.get(f0);
      const frame1 = source.frames.get(f1);

      // Trigger asynchronous fetch from IndexedDB if in DB but not in RAM
      if (!frame0 && source.cachedFrameIndices && source.cachedFrameIndices.has(f0)) {
        this.fetchFrameFromDB(source, f0);
      }
      if (!frame1 && source.cachedFrameIndices && source.cachedFrameIndices.has(f1)) {
        this.fetchFrameFromDB(source, f1);
      }

      // If one of the frames is missing from RAM, fallback to available
      if (!frame0 && !frame1) return null;
      if (!frame0) return frame1;
      if (!frame1) return frame0;

      // Discretize sub-frame alpha into steps (5% precision -> 20 sub-steps) for instant cache hit
      const stepAlpha = Math.round(alpha * 20) / 20;
      if (stepAlpha <= 0) return frame0;
      if (stepAlpha >= 1) return frame1;

      const cacheKey = `${source.sourceKey}_${f0}_${Math.round(stepAlpha * 100)}_${mode}`;
      if (!this._interpCache) this._interpCache = new Map();
      if (this._interpCache.has(cacheKey)) {
        return this._interpCache.get(cacheKey);
      }

      const fw = (frame0.width || targetW || 960);
      const fh = (frame0.height || targetH || 540);

      let resultCanvas = null;
      if (mode === 'optical_flow') {
        resultCanvas = this._synthesizeOpticalFlow(frame0, frame1, stepAlpha, fw, fh);
      } else {
        // Default to frame blend
        resultCanvas = this._synthesizeFrameBlend(frame0, frame1, stepAlpha, fw, fh);
      }

      if (resultCanvas) {
        if (this._interpCache.size >= 150) {
          const firstKey = this._interpCache.keys().next().value;
          this._interpCache.delete(firstKey);
        }
        this._interpCache.set(cacheKey, resultCanvas);
        return resultCanvas;
      }

      return frame0;
    }

    /**
     * Synthesize a linear frame blend between two consecutive video frames
     */
    _synthesizeFrameBlend(frame0, frame1, alpha, fw, fh) {
      const canvas = document.createElement('canvas');
      canvas.width = fw;
      canvas.height = fh;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return frame0;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.globalAlpha = 1.0;
      try {
        ctx.drawImage(frame0, 0, 0, fw, fh);
      } catch (_) {
        return frame1;
      }

      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      try {
        ctx.drawImage(frame1, 0, 0, fw, fh);
      } catch (_) {}
      ctx.globalAlpha = 1.0;

      return canvas;
    }

    /**
     * Synthesize an optical flow motion-interpolated frame between two video frames
     * Uses block-based motion estimation with 3x3 median filtering and seamless patch blending
     */
    _synthesizeOpticalFlow(frame0, frame1, alpha, fw, fh) {
      const canvas = document.createElement('canvas');
      canvas.width = fw;
      canvas.height = fh;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return frame0;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // 1. Draw base blend as foundation (guarantees zero missing patches / zero artifacts)
      ctx.globalAlpha = 1.0;
      try {
        ctx.drawImage(frame0, 0, 0, fw, fh);
      } catch (_) {
        return frame1;
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      try {
        ctx.drawImage(frame1, 0, 0, fw, fh);
      } catch (_) {}
      ctx.globalAlpha = 1.0;

      // 2. Downscaled analysis grid for motion vector estimation
      const AW = 160;
      const AH = 90;
      if (!this._ofCanvas0) {
        this._ofCanvas0 = document.createElement('canvas');
        this._ofCanvas0.width = AW;
        this._ofCanvas0.height = AH;
        this._ofCtx0 = this._ofCanvas0.getContext('2d', { willReadFrequently: true });
      }
      if (!this._ofCanvas1) {
        this._ofCanvas1 = document.createElement('canvas');
        this._ofCanvas1.width = AW;
        this._ofCanvas1.height = AH;
        this._ofCtx1 = this._ofCanvas1.getContext('2d', { willReadFrequently: true });
      }

      const ctxA0 = this._ofCtx0;
      const ctxA1 = this._ofCtx1;
      if (!ctxA0 || !ctxA1) return canvas;

      try {
        ctxA0.drawImage(frame0, 0, 0, AW, AH);
        ctxA1.drawImage(frame1, 0, 0, AW, AH);
      } catch (_) {
        return canvas;
      }

      let imgData0, imgData1;
      try {
        imgData0 = ctxA0.getImageData(0, 0, AW, AH).data;
        imgData1 = ctxA1.getImageData(0, 0, AW, AH).data;
      } catch (_) {
        return canvas;
      }

      // 3. Grayscale luminance arrays
      const totalPixels = AW * AH;
      const lum0 = new Uint8Array(totalPixels);
      const lum1 = new Uint8Array(totalPixels);
      for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
        lum0[i] = (imgData0[p] * 77 + imgData0[p + 1] * 150 + imgData0[p + 2] * 29) >> 8;
        lum1[i] = (imgData1[p] * 77 + imgData1[p + 1] * 150 + imgData1[p + 2] * 29) >> 8;
      }

      // 4. Block-based motion vector estimation
      const BS = 16;
      const maxSearchX = 10;
      const maxSearchY = 6;
      const numBlocksX = Math.floor(AW / BS);
      const numBlocksY = Math.floor(AH / BS);

      const vx = new Int16Array(numBlocksX * numBlocksY);
      const vy = new Int16Array(numBlocksX * numBlocksY);
      const hasMotion = new Uint8Array(numBlocksX * numBlocksY);

      for (let by = 0; by < numBlocksY; by++) {
        for (let bx = 0; bx < numBlocksX; bx++) {
          const bIdx = by * numBlocksX + bx;
          const startX = bx * BS;
          const startY = by * BS;

          // Compute SAD for static (0, 0)
          let sad00 = 0;
          for (let y = 0; y < BS; y++) {
            const row0 = (startY + y) * AW;
            for (let x = 0; x < BS; x++) {
              const idx = row0 + (startX + x);
              sad00 += Math.abs(lum0[idx] - lum1[idx]);
            }
          }

          // Static block: base blend is already optimal
          if (sad00 < BS * BS * 3.5) continue;

          let bestSad = sad00;
          let bestDx = 0;
          let bestDy = 0;

          for (let dy = -maxSearchY; dy <= maxSearchY; dy += 2) {
            const targetY = startY + dy;
            if (targetY < 0 || targetY + BS > AH) continue;

            for (let dx = -maxSearchX; dx <= maxSearchX; dx += 2) {
              const targetX = startX + dx;
              if (targetX < 0 || targetX + BS > AW) continue;

              let curSad = 0;
              let earlyBreak = false;

              for (let y = 0; y < BS; y++) {
                const r0 = (startY + y) * AW + startX;
                const r1 = (targetY + y) * AW + targetX;
                for (let x = 0; x < BS; x++) {
                  curSad += Math.abs(lum0[r0 + x] - lum1[r1 + x]);
                }
                if (curSad >= bestSad) {
                  earlyBreak = true;
                  break;
                }
              }

              if (!earlyBreak && curSad < bestSad) {
                bestSad = curSad;
                bestDx = dx;
                bestDy = dy;
              }
            }
          }

          if ((bestDx !== 0 || bestDy !== 0) && bestSad < sad00 * 0.85) {
            vx[bIdx] = bestDx;
            vy[bIdx] = bestDy;
            hasMotion[bIdx] = 1;
          }
        }
      }

      // 5. Spatial median filter on motion vectors to eliminate rogue vector spikes
      const smoothVx = new Int16Array(vx);
      const smoothVy = new Int16Array(vy);

      for (let by = 0; by < numBlocksY; by++) {
        for (let bx = 0; bx < numBlocksX; bx++) {
          const bIdx = by * numBlocksX + bx;
          if (!hasMotion[bIdx]) continue;

          const neighborsX = [];
          const neighborsY = [];
          for (let ny = Math.max(0, by - 1); ny <= Math.min(numBlocksY - 1, by + 1); ny++) {
            for (let nx = Math.max(0, bx - 1); nx <= Math.min(numBlocksX - 1, bx + 1); nx++) {
              const nIdx = ny * numBlocksX + nx;
              if (hasMotion[nIdx]) {
                neighborsX.push(vx[nIdx]);
                neighborsY.push(vy[nIdx]);
              }
            }
          }

          if (neighborsX.length >= 3) {
            neighborsX.sort((a, b) => a - b);
            neighborsY.sort((a, b) => a - b);
            const mid = Math.floor(neighborsX.length / 2);
            smoothVx[bIdx] = neighborsX[mid];
            smoothVy[bIdx] = neighborsY[mid];
          }
        }
      }

      // 6. Fast, lightweight 9-argument block patch rendering
      const scaleX = fw / AW;
      const scaleY = fh / AH;

      for (let by = 0; by < numBlocksY; by++) {
        for (let bx = 0; bx < numBlocksX; bx++) {
          const bIdx = by * numBlocksX + bx;
          if (!hasMotion[bIdx]) continue;

          const dx = smoothVx[bIdx];
          const dy = smoothVy[bIdx];
          if (dx === 0 && dy === 0) continue;

          const sx = Math.floor(bx * BS * scaleX);
          const sy = Math.floor(by * BS * scaleY);
          const sw = Math.ceil(BS * scaleX);
          const sh = Math.ceil(BS * scaleY);

          const shiftX0 = Math.round(dx * scaleX * alpha);
          const shiftY0 = Math.round(dy * scaleY * alpha);
          const shiftX1 = Math.round(-dx * scaleX * (1 - alpha));
          const shiftY1 = Math.round(-dy * scaleY * (1 - alpha));

          const dstX0 = Math.max(0, Math.min(fw - sw, sx + shiftX0));
          const dy0 = Math.max(0, Math.min(fh - sh, sy + shiftY0));
          const dstX1 = Math.max(0, Math.min(fw - sw, sx + shiftX1));
          const dy1 = Math.max(0, Math.min(fh - sh, sy + shiftY1));

          try {
            ctx.globalAlpha = 1.0 - alpha;
            ctx.drawImage(frame0, sx, sy, sw, sh, dstX0, dy0, sw, sh);
            ctx.globalAlpha = alpha;
            ctx.drawImage(frame1, sx, sy, sw, sh, dstX1, dy1, sw, sh);
          } catch (_) {}
        }
      }

      ctx.globalAlpha = 1.0;
      return canvas;
    }

    /**
     * Request frame extraction for a layer's active range (resumes from where it left off)
     */
    async extractLayerRange(layer) {
      if (!layer || layer.type !== 'video') return;
      if (layer._extractComplete) {
        const sourceKey = this._getSourceKey(layer);
        const source = this.sources.get(sourceKey);
        if (source && source.frames.size > 0) {
          this.updateLayerProgressBar(layer);
          return;
        }
      }

      // Ensure layer.mediaId and fresh layer.dataUrl from FishDatabase before resolving sourceKey
      if (window.FishDatabase && window.currentProjectState && window.currentProjectState.id) {
        try {
          const medias = await window.FishDatabase.getProjectMedia(window.currentProjectState.id);
          if (Array.isArray(medias) && medias.length > 0) {
            let m = layer.mediaId ? medias.find(item => item.id === layer.mediaId) : null;
            if (!m && layer.name) {
              m = medias.find(item => item.name === layer.name && (item.type === 'video' || !item.type));
            }
            if (!m) {
              const videoMedias = medias.filter(item => item.type === 'video');
              if (videoMedias.length === 1) m = videoMedias[0];
            }
            if (m) {
              if (m.id && !layer.mediaId) layer.mediaId = m.id;
              if (m.dataUrl) {
                layer.dataUrl = m.dataUrl;
              } else if (m.blob) {
                try { layer.dataUrl = URL.createObjectURL(m.blob); } catch (_) {}
              }
              if (m.width && !layer.mediaWidth) layer.mediaWidth = m.width;
              if (m.height && !layer.mediaHeight) layer.mediaHeight = m.height;
              if (m.duration && !layer.mediaDuration) layer.mediaDuration = m.duration;
            }
          }
        } catch (_) {}
      }

      const sourceKey = this._getSourceKey(layer);
      if (!sourceKey) return;

      const source = this._getOrCreateSource(sourceKey, layer.dataUrl, layer.name, layer.id);
      if (layer.dataUrl && layer.dataUrl !== source.dataUrl) {
        source.dataUrl = layer.dataUrl;
      }
      if (layer.mediaDuration && (!source.duration || source.duration <= 0)) {
        source.duration = layer.mediaDuration;
      }
      const nativeFps = (layer.mediaFps && layer.mediaFps >= 10 && layer.mediaFps <= 240) ? layer.mediaFps : null;
      const effectiveFps = nativeFps || (parseInt(window.currentProjectState && window.currentProjectState.fps, 10) || this.targetFps || 60);
      if (!source.fps || (nativeFps && source.fps !== nativeFps)) {
        source.fps = effectiveFps;
      }

      // 1. Ensure previously cached frames from IndexedDB are loaded first
      if (!source.isDbLoaded) {
        if (!source.dbLoadPromise) {
          source.dbLoadPromise = this._loadFramesFromDB(source);
        }
        await source.dbLoadPromise;
      }

      // 2. Refresh progress bar with cached frames
      this.updateLayerProgressBar(layer);

      const { startIdx, endIdx } = this.getLayerFrameRange(layer);

      // 3. Collect only missing frames (checking both RAM cache and IndexedDB cache)
      const missing = [];
      for (let i = startIdx; i <= endIdx; i++) {
        const hasRam = source.frames.has(i);
        const hasDb = source.cachedFrameIndices && source.cachedFrameIndices.has(i);
        if (!hasRam && !hasDb) {
          missing.push(i);
        }
      }

      // 4. If all frames in this layer's range are already cached, we are done!
      if (missing.length === 0) {
        layer._extractProgress = 1;
        layer._extractComplete = true;
        this.updateLayerProgressBar(layer);
        return;
      }

      // 5. Start or extend background extraction for missing frames
      // While missing frames are extracting, sterilize PreviewCacheManager for this video layer
      if (window.PreviewCacheManager) {
        const pps = window.currentPixelsPerSecond || 80;
        const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
        window.PreviewCacheManager.invalidateRange(start, start + dur);
      }

      if (source.dataUrl) {
        this._startExtractionForSource(source, missing);
      }
    }

    extract(layer) {
      return this.extractLayerRange(layer);
    }

    /**
     * Ensure all frames required by the given video layers are 100% cached at full quality before export.
     * Yields progress callback (percent, text) and checks isCancelled callback.
     */
    async ensureLayersCached(layers, onProgress = null, isCancelled = null) {
      if (!layers || layers.length === 0) return true;

      const videoLayers = layers.filter(l => l && l.type === 'video' && !l.hidden);
      if (videoLayers.length === 0) return true;

      if (window.currentProjectState && window.currentProjectState.fps) {
        this.setFps(parseInt(window.currentProjectState.fps, 10) || 60);
      }

      const sourcesToExtract = new Map();

      for (const vl of videoLayers) {
        if (isCancelled && isCancelled()) return false;

        if (window.FishDatabase && window.currentProjectState && window.currentProjectState.id) {
          try {
            const medias = await window.FishDatabase.getProjectMedia(window.currentProjectState.id);
            let m = vl.mediaId ? (medias || []).find(item => item.id === vl.mediaId) : null;
            if (!m && vl.name) m = (medias || []).find(item => item.name === vl.name && (item.type === 'video' || !item.type));
            if (!m) {
              const videoMedias = (medias || []).filter(item => item.type === 'video');
              if (videoMedias.length === 1) m = videoMedias[0];
            }
            if (m) {
              if (m.id && !vl.mediaId) vl.mediaId = m.id;
              if (!vl.dataUrl && m.dataUrl) {
                vl.dataUrl = m.dataUrl;
              } else if (!vl.dataUrl && m.blob) {
                try { vl.dataUrl = URL.createObjectURL(m.blob); } catch (_) {}
              }
              if (m.duration && !vl.mediaDuration) vl.mediaDuration = m.duration;
            }
          } catch (_) {}
        }

        const sourceKey = this._getSourceKey(vl);
        if (!sourceKey) continue;

        const source = this._getOrCreateSource(sourceKey, vl.dataUrl, vl.name, vl.id);
        if (vl.mediaDuration && (!source.duration || source.duration <= 0)) {
          source.duration = vl.mediaDuration;
        }
        const nativeFps = (vl.mediaFps && vl.mediaFps >= 10 && vl.mediaFps <= 240) ? vl.mediaFps : null;
        const effectiveFps = nativeFps || (parseInt(window.currentProjectState && window.currentProjectState.fps, 10) || this.targetFps || 60);
        if (!source.fps || (nativeFps && source.fps !== nativeFps)) {
          source.fps = effectiveFps;
        }
        if (!source.isDbLoaded) {
          if (!source.dbLoadPromise) {
            source.dbLoadPromise = this._loadFramesFromDB(source);
          }
          await source.dbLoadPromise;
        }

        const { startIdx, endIdx } = this.getLayerFrameRange(vl);
        if (!sourcesToExtract.has(sourceKey)) {
          sourcesToExtract.set(sourceKey, {
            source,
            neededFrames: new Set(),
            missingFrames: new Set()
          });
        }
        const entry = sourcesToExtract.get(sourceKey);
        for (let idx = startIdx; idx <= endIdx; idx++) {
          entry.neededFrames.add(idx);
        }
      }

      let totalNeededCount = 0;
      let totalCachedCount = 0;

      for (const [sourceKey, entry] of sourcesToExtract.entries()) {
        const source = entry.source;
        for (const idx of entry.neededFrames) {
          totalNeededCount++;
          const hasRam = source.frames && source.frames.has(idx);
          const hasDb = source.cachedFrameIndices && source.cachedFrameIndices.has(idx);
          if (hasRam || hasDb) {
            totalCachedCount++;
          } else {
            entry.missingFrames.add(idx);
          }
        }
      }

      if (totalCachedCount >= totalNeededCount || totalNeededCount === 0) {
        if (onProgress) onProgress(100, 'Video cache verified');
        return true;
      }

      for (const [sourceKey, entry] of sourcesToExtract.entries()) {
        if (entry.missingFrames.size > 0 && entry.source.dataUrl) {
          entry.source._forceExtraction = true;
          this._startExtractionForSource(entry.source, Array.from(entry.missingFrames));
        }
      }

      while (true) {
        if (isCancelled && isCancelled()) {
          for (const entry of sourcesToExtract.values()) {
            delete entry.source._forceExtraction;
          }
          return false;
        }

        let currentCached = 0;
        let anyExtracting = false;

        for (const [sourceKey, entry] of sourcesToExtract.entries()) {
          const source = entry.source;
          if (source.isExtracting) {
            anyExtracting = true;
          }
          for (const idx of entry.neededFrames) {
            const hasRam = source.frames && source.frames.has(idx);
            const hasDb = source.cachedFrameIndices && source.cachedFrameIndices.has(idx);
            if (hasRam || hasDb) {
              currentCached++;
            }
          }
        }

        const pct = totalNeededCount > 0 ? Math.min(99, Math.round((currentCached / totalNeededCount) * 100)) : 100;
        if (onProgress) {
          onProgress(pct, `Caching video layers (${pct}% - ${currentCached}/${totalNeededCount} frames)...`);
        }

        if (currentCached >= totalNeededCount || !anyExtracting) {
          break;
        }

        await new Promise(r => setTimeout(r, 60));
      }

      for (const entry of sourcesToExtract.values()) {
        delete entry.source._forceExtraction;
        const matchingLayer = videoLayers.find(l => this._getSourceKey(l) === entry.source.sourceKey);
        if (matchingLayer) this.updateLayerProgressBar(matchingLayer);
      }

      this._flushSaveQueue();

      if (onProgress) onProgress(100, 'Video cache complete');
      return true;
    }

    /**
     * Seek video with fail-safe timeout and instant zero-check (never hangs)
     */
    _seekVideo(video, targetTime) {
      return new Promise(resolve => {
        if (!video.seeking && Math.abs(video.currentTime - targetTime) < 0.003) {
          resolve(true);
          return;
        }

        let resolved = false;
        const cleanup = () => {
          video.removeEventListener('seeked', onSeek);
          video.removeEventListener('error', onError);
        };

        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(false);
          }
        }, 700);

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

        video.addEventListener('seeked', onSeek, { once: true });
        video.addEventListener('error', onError, { once: true });

        try {
          video.currentTime = targetTime;
        } catch (_) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            cleanup();
            resolve(false);
          }
        }
      });
    }

    /**
     * Background progressive decoder for missing frame indices of a source
     */
    _startExtractionForSource(source, newMissingIndices) {
      if (!source.dataUrl) return;

      // Ensure dataUrl is converted to a Blob URL if it is a base64 string
      // Chromium hardware video decoders cannot seek efficiently on base64 data URIs
      if (typeof source.dataUrl === 'string' && source.dataUrl.startsWith('data:video')) {
        try {
          const parts = source.dataUrl.split(',');
          const mimeMatch = parts[0].match(/:(.*?);/);
          const mime = mimeMatch ? mimeMatch[1] : 'video/mp4';
          const bstr = atob(parts[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          const blob = new Blob([u8arr], { type: mime });
          source.dataUrl = URL.createObjectURL(blob);
          source._blobUrlCreated = true;
        } catch (e) {
          console.warn('[VideoFrameExtractor] Failed to convert data URL to Blob URL:', e);
        }
      }

      if (!source.pendingFrames) source.pendingFrames = new Set();
      newMissingIndices.forEach(idx => source.pendingFrames.add(idx));

      if (source.isExtracting) {
        // Extractor is already running; newly added pending frames will be processed in the active loop
        return;
      }

      source.isExtracting = true;

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      // Positioning ensures Chromium and Firefox maintain hardware decoding pipeline without throttling
      video.style.cssText = 'position:fixed;bottom:0;right:0;width:32px;height:32px;opacity:0.01;pointer-events:none;z-index:-9999;';
      const mountPool = document.getElementById('editor-video-mount-pool') || document.body;
      mountPool.appendChild(video);
      source.activeVideo = video;

      let decodingStarted = false;
      const startDecoding = async () => {
        if (decodingStarted) return;
        decodingStarted = true;

        if ((!source.duration || source.duration <= 0) && (!isFinite(video.duration) || video.duration <= 0)) {
          try {
            video.currentTime = 1e101;
            await new Promise(r => {
              const onSeek = () => { video.removeEventListener('seeked', onSeek); r(); };
              video.addEventListener('seeked', onSeek, { once: true });
              setTimeout(r, 200);
            });
            if (isFinite(video.currentTime) && video.currentTime > 0) {
              source.duration = video.currentTime;
            }
            video.currentTime = 0;
          } catch (_) {}
        } else if (!source.duration || source.duration <= 0) {
          source.duration = video.duration;
        }

        // Auto-expand any timeline layer using this video source whose duration was clamped or cut off
        if (source.duration > 0 && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
          let layerChanged = false;
          window.currentProjectState.layers.forEach(l => {
            if (l.type === 'video') {
              const matches = (this._getSourceKey(l) === source.sourceKey || l.mediaId === source.sourceKey || l.id === source.sourceKey || (l.name && source.name && l.name === source.name));
              if (matches) {
                l.mediaDuration = source.duration;
                if (!l._userResized && (!l.durationSec || l.durationSec < source.duration)) {
                  l.durationSec = source.duration;
                  const pps = window.currentPixelsPerSecond || 80;
                  l.widthPx = Math.round(source.duration * pps);
                  l.isDurationExplicit = true;
                  layerChanged = true;
                }
              }
            }
          });
          if (layerChanged) {
            if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
            if (typeof window.updateTimelineDuration === 'function') window.updateTimelineDuration(true);
            if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
          }
        }

        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 360;
        // Sharp proxy resolution: Max 960px for high-definition canvas preview with low overhead
        const maxDim = 960;
        const scale = Math.min(1, maxDim / Math.max(vw, vh));
        const targetW = Math.max(160, Math.round(vw * scale));
        const targetH = Math.max(90, Math.round(vh * scale));
        source.width = targetW;
        source.height = targetH;

        let offCanvas = null;
        let offCtx = null;
        const failedAttempts = new Map();

        while (source.pendingFrames && source.pendingFrames.size > 0) {
          // If source was cleared or cancelled, abort
          if (!this.sources.has(source.sourceKey) || !source.isExtracting) break;

          // Pause background extraction while exporting unless priority extraction was requested
          if (window.isExporting && !source._forceExtraction) {
            await new Promise(r => setTimeout(r, 120));
            continue;
          }

          // Point 1: Auto-pause while user is actively interacting (playback, scrubbing, dragging)
          if (!source._forceExtraction && this._isUserInteracting()) {
            await new Promise(r => setTimeout(r, 80));
            continue;
          }

          // Point 2: Pick next frame with Playhead-Proximity Priority
          let targetIdx = -1;

          if (source._forceExtraction) {
            // Strictly ascending order during export cache verification
            for (const idx of source.pendingFrames) {
              if (targetIdx === -1 || idx < targetIdx) {
                targetIdx = idx;
              }
            }
          } else {
            // Playhead-Proximity Priority for live interactive editing
            const anchorFrame = this._getVideoFrameForPlayhead(source);
            const fps = source.fps || 60;
            const lookahead = Math.round(fps * 1.5);
            const lookbehind = Math.round(fps * 0.75);

            let bestTier = 99;
            for (const idx of source.pendingFrames) {
              let tier = 4;
              if (idx >= anchorFrame && idx <= anchorFrame + lookahead) {
                tier = 1; // Immediate forward playback window
              } else if (idx >= anchorFrame - lookbehind && idx < anchorFrame) {
                tier = 2; // Immediate reverse scrub window
              } else if (idx > anchorFrame + lookahead) {
                tier = 3; // Remaining forward frames
              } else {
                tier = 4; // Remaining backward frames
              }

              if (tier < bestTier) {
                bestTier = tier;
                targetIdx = idx;
              } else if (tier === bestTier) {
                if (targetIdx === -1 || idx < targetIdx) {
                  targetIdx = idx;
                }
              }
            }
          }

          source.pendingFrames.delete(targetIdx);

          // If frame was already extracted, notify and continue
          if (source.frames.has(targetIdx)) {
            this._notifyLayersForSource(source.sourceKey, false, targetIdx);
            continue;
          }

          const targetTime = Math.min(Math.max(0, (source.duration || 3600) - 0.01), Math.max(0, targetIdx / source.fps));

          const seekOk = await this._seekVideo(video, targetTime);
          const timeDiff = Math.abs(video.currentTime - targetTime);
          const isAtEnd = (source.duration > 0 && Math.abs(video.currentTime - source.duration) < 0.1 && targetTime >= source.duration - 0.1);
          if (!seekOk && timeDiff > 0.08 && !isAtEnd) {
            const attempts = (failedAttempts.get(targetIdx) || 0) + 1;
            failedAttempts.set(targetIdx, attempts);
            if (attempts < 4) {
              source.pendingFrames.add(targetIdx);
            }
            await yieldToUI();
            continue;
          }

          let bmp = null;
          if (video.videoWidth > 0) {
            try {
              if (!offCanvas) {
                if (typeof OffscreenCanvas !== 'undefined') {
                  offCanvas = new OffscreenCanvas(targetW, targetH);
                } else {
                  offCanvas = document.createElement('canvas');
                  offCanvas.width = targetW;
                  offCanvas.height = targetH;
                }
                offCtx = offCanvas.getContext('2d', { alpha: false });
              }
              if (offCtx) {
                offCtx.drawImage(video, 0, 0, targetW, targetH);
                bmp = await createImageBitmap(offCanvas);

                if (typeof offCanvas.convertToBlob === 'function') {
                  offCanvas.convertToBlob({ type: 'image/webp', quality: 0.75 }).then(blob => {
                    if (blob) this._queueFrameSave(source.sourceKey, targetIdx, blob, source.fps);
                  }).catch(() => {});
                } else if (typeof offCanvas.toBlob === 'function') {
                  offCanvas.toBlob(blob => {
                    if (blob) this._queueFrameSave(source.sourceKey, targetIdx, blob, source.fps);
                  }, 'image/webp', 0.75);
                }
              } else {
                bmp = await createImageBitmap(video);
              }
            } catch (_) {
              try {
                bmp = await createImageBitmap(video, {
                  resizeWidth: targetW,
                  resizeHeight: targetH,
                  resizeQuality: 'high'
                });
              } catch (__) {}
            }
          }

          if (bmp) {
            source.frames.set(targetIdx, bmp);
            if (!source.cachedFrameIndices) source.cachedFrameIndices = new Set();
            source.cachedFrameIndices.add(targetIdx);
            source._hasNewExtractedFrames = true;
            this._evictOldestFrame(source, targetIdx);
          }

          // Realtime progress bar update for all layers referencing this source (throttled)
          this._notifyLayersForSource(source.sourceKey, false, targetIdx);

          // Yield smoothly to browser UI thread with minimal overhead
          await yieldToUI();
        }

        source.isExtracting = false;
        source.activeVideo = null;
        try {
          video.removeAttribute('src');
          video.load();
        } catch (_) {}
        if (video.parentNode) {
          try { video.parentNode.removeChild(video); } catch (_) {}
        }
        this._flushSaveQueue();
        this._notifyLayersForSource(source.sourceKey, true);
      };

      const onVideoReady = () => {
        video.removeEventListener('loadedmetadata', onVideoReady);
        video.removeEventListener('loadeddata', onVideoReady);
        video.removeEventListener('canplay', onVideoReady);
        startDecoding();
      };
      video.addEventListener('loadedmetadata', onVideoReady, { once: true });
      video.addEventListener('loadeddata', onVideoReady, { once: true });
      video.addEventListener('canplay', onVideoReady, { once: true });

      video.onerror = async () => {
        console.warn(`[VideoFrameExtractor] Video element error for source ${source.sourceKey}, attempting recovery...`);
        if (window.FishDatabase && window.currentProjectState && window.currentProjectState.id) {
          try {
            const medias = await window.FishDatabase.getProjectMedia(window.currentProjectState.id);
            let m = (medias || []).find(item => item.id === source.sourceKey);
            if (!m && source.name) {
              m = (medias || []).find(item => item.name === source.name);
            }
            if (!m && window.currentProjectState.layers) {
              const matchingLayer = window.currentProjectState.layers.find(l => l && (l.id === source.layerId || l.mediaId === source.sourceKey || this._getSourceKey(l) === source.sourceKey));
              if (matchingLayer) {
                if (matchingLayer.mediaId) m = (medias || []).find(item => item.id === matchingLayer.mediaId);
                if (!m && matchingLayer.name) m = (medias || []).find(item => item.name === matchingLayer.name);
              }
            }
            if (!m) {
              const videoMedias = (medias || []).filter(item => item.type === 'video');
              if (videoMedias.length === 1) m = videoMedias[0];
            }

            if (m && m.blob) {
              const freshUrl = URL.createObjectURL(m.blob);
              source.dataUrl = freshUrl;
              if (m.name && !source.name) source.name = m.name;
              if (m.id && source.sourceKey.startsWith('src_')) {
                this.sources.delete(source.sourceKey);
                source.sourceKey = m.id;
                this.sources.set(m.id, source);
              }
              if (window.currentProjectState && window.currentProjectState.layers) {
                window.currentProjectState.layers.forEach(l => {
                  if (l.type === 'video' && (l.mediaId === m.id || l.name === m.name || this._getSourceKey(l) === source.sourceKey)) {
                    l.dataUrl = freshUrl;
                    l.mediaId = m.id;
                  }
                });
                if (typeof window.saveCurrentProjectLayers === 'function') {
                  window.saveCurrentProjectLayers();
                }
              }
              video.src = freshUrl;
              video.load();
              if (video.readyState >= 1) {
                startDecoding();
              } else {
                video.addEventListener('loadedmetadata', startDecoding, { once: true });
                video.addEventListener('canplay', startDecoding, { once: true });
              }
              return;
            }
          } catch (e) {
            console.warn('[VideoFrameExtractor] Video recovery failed:', e);
          }
        }
        if (video.parentNode) {
          try { video.parentNode.removeChild(video); } catch (_) {}
        }
        source.isExtracting = false;
        source.activeVideo = null;
      };

      video.src = source.dataUrl;
      video.load();

      if (video.readyState >= 1) {
        startDecoding();
      }

      setTimeout(() => {
        if (!decodingStarted && video.readyState >= 1) {
          startDecoding();
        }
      }, 250);
    }

    /**
     * Update progress bar of a specific layer according to its visible frame range
     */
    updateLayerProgressBar(layer) {
      if (!layer || layer.type !== 'video') return;
      const sourceKey = this._getSourceKey(layer);
      let source = this.sources.get(sourceKey);
      if (!source) {
        for (const [sKey, s] of this.sources.entries()) {
          if (sKey === layer.mediaId || (layer.name && s.name === layer.name)) {
            source = s;
            break;
          }
        }
      }

      const { startIdx, endIdx, total } = this.getLayerFrameRange(layer);

      let cached = 0;
      if (source) {
        for (let i = startIdx; i <= endIdx; i++) {
          if (source.frames.has(i) || (source.cachedFrameIndices && source.cachedFrameIndices.has(i))) cached++;
        }
      }

      const progress = total > 0 ? Math.min(1, cached / total) : 1;
      layer._extractProgress = progress;
      layer._extractComplete = (cached >= total);

      const clipBlock = document.querySelector(`.timeline-clip-block[data-layer-id="${layer.id}"]`);
      if (clipBlock) {
        let bar = clipBlock.querySelector('.timeline-clip-progress');
        let track = clipBlock.querySelector('.timeline-clip-progress-track');
        if (!track && !layer._extractComplete) {
          track = document.createElement('div');
          track.className = 'timeline-clip-progress-track';
          bar = document.createElement('div');
          bar.className = 'timeline-clip-progress';
          track.appendChild(bar);
          clipBlock.appendChild(track);
        }
        const pct = (progress * 100).toFixed(1);
        if (bar) bar.style.width = pct + '%';
        if (layer._extractComplete) {
          if (bar) bar.classList.add('is-complete');
          if (track) track.classList.add('is-complete');
        } else {
          if (bar) bar.classList.remove('is-complete');
          if (track) track.classList.remove('is-complete');
        }
      }
    }

    /**
     * Notify and update all timeline layers sharing this media source.
     * Throttles DOM updates and eliminates redundant canvas composition redraws.
     */
    _notifyLayersForSource(sourceKey, isComplete = false, extractedFrameIdx = null) {
      // 1. Throttled UI Progress Bar Update (max 1 DOM batch per animation frame)
      if (!this._rafProgressBarScheduled) {
        this._rafProgressBarScheduled = true;
        requestAnimationFrame(() => {
          this._rafProgressBarScheduled = false;
          const source = this.sources.get(sourceKey);
          const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
          if (layers.length > 0) {
            layers.forEach(l => {
              if (l.type === 'video') {
                const match = (this._getSourceKey(l) === sourceKey || l.mediaId === sourceKey || l.id === sourceKey || (l.name && source && l.name === source.name));
                if (match) {
                  this.updateLayerProgressBar(l);
                }
              }
            });
          } else {
            const clips = document.querySelectorAll('.timeline-clip-block.clip-video');
            clips.forEach(clip => {
              const layerId = clip.dataset.layerId;
              if (layerId) {
                this.updateLayerProgressBar({ id: layerId, type: 'video', mediaId: sourceKey, dataUrl: sourceKey });
              }
            });
          }
        });
      }

      // 2. Selectively redraw composition during extraction (throttled) and on completion
      if (typeof window.redrawComposition === 'function' && !this._isUserInteracting()) {
        if (isComplete) {
          window.redrawComposition('frameExtractorComplete');
        } else {
          // Throttled canvas redraw during background extraction (max once every 120ms / ~8fps)
          // so user clearly sees extraction percentage & progress bar without timeline lag
          const now = performance.now();
          if (!this._lastProgressRedrawTime || (now - this._lastProgressRedrawTime) >= 120) {
            this._lastProgressRedrawTime = now;
            window.redrawComposition('frameExtractorProgress');
          }
        }
      }

      // 3. Invalidate PreviewCacheManager only when extraction actually completed new frames
      const source = this.sources.get(sourceKey);
      if (window.PreviewCacheManager && isComplete && source && source._hasNewExtractedFrames) {
        source._hasNewExtractedFrames = false;
        const pps = window.currentPixelsPerSecond || 80;
        const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
        const hasMatching = layers.some(l => l.type === 'video' && !l.hidden && this._getSourceKey(l) === sourceKey);
        if (!hasMatching) return; // Video layer no longer in project — do not invalidate preview cache!

        if (!window.isTimelinePlaying) {
          layers.forEach(l => {
            if (l.type === 'video' && !l.hidden && this._getSourceKey(l) === sourceKey) {
              const start = l.startSec !== undefined ? l.startSec : ((l.startPx || 0) / pps);
              const dur = l.durationSec !== undefined ? l.durationSec : ((l.widthPx || 320) / pps);
              window.PreviewCacheManager.invalidateRange(start, start + dur);
            }
          });
          if (window.PreviewCacheManager.idleCacheEnabled) {
            window.PreviewCacheManager.scheduleIdleCheck();
          }
        } else {
          window._pendingVideoCacheInvalidation = true;
        }
      }
    }

    /**
     * Clean up when a layer is deleted (only deletes cache from DB if no other layer uses this source)
     */
    async clearLayer(layer) {
      if (!layer) return;
      const sourceKey = this._getSourceKey(layer);
      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const isStillUsed = layers.some(l => l.id !== layer.id && this._getSourceKey(l) === sourceKey);
      if (!isStillUsed) {
        await this.clearSource(sourceKey);
      }
    }

    /**
     * Purges frame cache from RAM and IndexedDB for a given sourceKey, layer, or media item
     */
    async clearSource(target) {
      if (!target) return;
      const keysToClear = new Set();
      if (typeof target === 'object' && target !== null) {
        if (target.id) keysToClear.add(target.id);
        if (target.mediaId) keysToClear.add(target.mediaId);
        if (target.dataUrl) keysToClear.add(target.dataUrl);
        if (target.name) {
          keysToClear.add(target.name);
          for (const [k, s] of this.sources.entries()) {
            if (s && s.name === target.name) keysToClear.add(k);
          }
        }
      } else if (typeof target === 'string') {
        keysToClear.add(target);
        for (const [k, s] of this.sources.entries()) {
          if (s && (s.sourceKey === target || s.name === target || s.dataUrl === target || s.layerId === target)) {
            keysToClear.add(k);
          }
        }
      }

      if (this._saveQueue && this._saveQueue.length > 0) {
        this._saveQueue = this._saveQueue.filter(item => !keysToClear.has(item.sourceKey));
      }

      for (const k of keysToClear) {
        const source = this.sources.get(k);
        if (source) {
          source.isExtracting = false;
          if (source.pendingFrames) source.pendingFrames.clear();
          if (source.activeVideo) {
            try {
              source.activeVideo.removeAttribute('src');
              source.activeVideo.load();
              if (source.activeVideo.parentNode) {
                source.activeVideo.parentNode.removeChild(source.activeVideo);
              }
            } catch (_) {}
            source.activeVideo = null;
          }
          if (source.frames) {
            source.frames.forEach(bmp => {
              if (bmp && typeof bmp.close === 'function') {
                try { bmp.close(); } catch (_) {}
              }
            });
            source.frames.clear();
          }
          if (source.cachedFrameIndices) source.cachedFrameIndices.clear();
          if (source._fetchingFrames) source._fetchingFrames.clear();
          if (source.pendingFrames) source.pendingFrames.clear();
          this.sources.delete(k);
        }
        await this._deleteFramesFromDB(k);
      }
    }

    async _deleteFramesFromDB(sourceKey) {
      const db = await this._getDB();
      if (!db) return;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
          if (store.indexNames.contains('sourceKey')) {
            const index = store.index('sourceKey');
            const req = index.openKeyCursor(IDBKeyRange.only(sourceKey));
            req.onsuccess = (e) => {
              const cursor = e.target.result;
              if (cursor) {
                store.delete(cursor.primaryKey);
                cursor.continue();
              } else {
                resolve();
              }
            };
            req.onerror = () => resolve();
          } else {
            const req = store.openCursor();
            req.onsuccess = (e) => {
              const cursor = e.target.result;
              if (cursor) {
                if (cursor.value && (cursor.value.sourceKey === sourceKey || (cursor.key && String(cursor.key).startsWith(sourceKey + '_')))) {
                  store.delete(cursor.primaryKey);
                }
                cursor.continue();
              } else {
                resolve();
              }
            };
            req.onerror = () => resolve();
          }
        } catch (_) {
          resolve();
        }
      });
    }

    /**
     * Wipe all cached video frames
     */
    async clearAllCache() {
      this.sources.forEach(source => {
        if (source.frames) {
          source.frames.forEach(bmp => {
            if (bmp && typeof bmp.close === 'function') bmp.close();
          });
          source.frames.clear();
        }
      });
      this.sources.clear();
      const db = await this._getDB();
      if (db) {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).clear();
        } catch (_) {}
      }
    }

    /**
     * Backward-compat shim for extract(layer)
     */
    extract(layer) {
      return this.extractLayerRange(layer);
    }
  }

  window.VideoFrameExtractor = new VideoFrameExtractor();
})(window);
