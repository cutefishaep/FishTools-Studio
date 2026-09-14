/**
 * js/preview-cache.js
 * After Effects-Style RAM Preview Cache Engine
 * High-performance hardware-accelerated frame caching, selective range invalidation,
 * background idle caching, and visual timeline ruler indicator.
 */
(function(window) {
  'use strict';

  class PreviewCacheManager {
    constructor() {
      // Map<compId, Map<frameIndex (number), { bitmap: ImageBitmap, isDraft: boolean, width: number, height: number }>>
      this.pools = new Map();
      this.pools.set('root', new Map());
      this.activeCompId = 'root';
      this._fps = 60;
      this.isDraftMode = false;
      this.idleCacheEnabled = false;
      this.isIdleRunning = false;
      this.idleTimer = null;
      this.idleWorkerId = null;
      this.lastUserActivity = Date.now();
      this.rulerCanvas = null;
      this.rulerCtx = null;
      this.offscreenCanvas = null;
      this._isCachingFrame = false;
      this._pendingFrames = new Set();
      // Tracks frames whose createImageBitmap is currently in-flight (prevents double-encode race)
      this._inFlightFrames = new Set();
      // LRU eviction: generous frame buffer (~20s+ at 60fps) to ensure smooth full-fps playback
      this.maxFrames = 1200;
    }

    get frames() {
      const key = this.activeCompId || 'root';
      if (!this.pools.has(key)) {
        this.pools.set(key, new Map());
      }
      return this.pools.get(key);
    }

    getActiveCompId() {
      return this.activeCompId || 'root';
    }

    getPool(compId) {
      const key = compId || this.activeCompId || 'root';
      if (!this.pools.has(key)) {
        this.pools.set(key, new Map());
      }
      return this.pools.get(key);
    }

    deletePool(compId) {
      if (!compId || compId === 'root') return;
      if (this.pools.has(compId)) {
        const pool = this.pools.get(compId);
        for (const entry of pool.values()) {
          if (entry && entry.bitmap && typeof entry.bitmap.close === 'function') {
            try { entry.bitmap.close(); } catch (_) {}
          }
        }
        pool.clear();
        this.pools.delete(compId);
      }
    }

    setActiveComp(compId = 'root') {
      const target = compId || 'root';
      if (this.activeCompId !== target) {
        this.activeCompId = target;
        if (!this.pools.has(target)) {
          this.pools.set(target, new Map());
        }
        this.updateRulerUI();
        if (this.idleCacheEnabled) {
          this.scheduleIdleCheck();
        }
      }
    }

    get fps() {
      if (typeof window !== 'undefined') {
        if (typeof window.getProjectFps === 'function') {
          const pFps = window.getProjectFps();
          if (pFps && pFps > 0) return pFps;
        }
        if (typeof window.currentTimelineFps === 'number' && window.currentTimelineFps > 0) {
          return window.currentTimelineFps;
        }
        if (window.currentProjectState && window.currentProjectState.fps) {
          const pFps = parseInt(window.currentProjectState.fps, 10);
          if (pFps && pFps > 0) return pFps;
        }
      }
      return this._fps || 60;
    }

    set fps(val) {
      const parsed = parseInt(val, 10);
      if (parsed && parsed > 0) {
        this._fps = parsed;
      }
    }

    init({ rulerCanvasId = 'timeline-cache-ruler-bar', defaultFps = 60 } = {}) {
      if (defaultFps) this._fps = defaultFps;
      this.rulerCanvas = document.getElementById(rulerCanvasId);
      if (this.rulerCanvas) {
        this.rulerCtx = this.rulerCanvas.getContext('2d');
      }
      this.setupUserActivityListeners();
    }

    setFps(fps) {
      const parsed = parseInt(fps, 10);
      if (parsed && parsed !== this._fps) {
        this._fps = parsed;
        this.clearAll('all');
      }
    }

    setDraftMode(isDraft) {
      const boolVal = !!isDraft;
      if (this.isDraftMode !== boolVal) {
        this.isDraftMode = boolVal;
        this.clearAll('all');
      }
    }

    setIdleCacheEnabled(enabled) {
      this.idleCacheEnabled = !!enabled;
      if (!this.idleCacheEnabled) {
        this.stopIdleWorker();
      } else {
        this.scheduleIdleCheck();
      }
    }

    hasFrame(frameIndex, expectedWidth = null, expectedHeight = null, compId = null) {
      const pool = this.getPool(compId || this.activeCompId);
      const entry = pool.get(frameIndex);
      if (!entry) return false;
      if (entry.isDraft !== this.isDraftMode) {
        this.deleteFrame(frameIndex, false, compId);
        return false;
      }
      if (expectedWidth && expectedHeight && entry.width && entry.height) {
        const entryAspect = entry.width / entry.height;
        const expectedAspect = expectedWidth / expectedHeight;
        if (Math.abs(entryAspect - expectedAspect) > 0.15) {
          return false;
        }
      }
      return true;
    }

    getFrame(frameIndex, expectedWidth = null, expectedHeight = null, compId = null) {
      const pool = this.getPool(compId || this.activeCompId);
      const entry = pool.get(frameIndex);
      if (!entry) return null;
      if (entry.isDraft !== this.isDraftMode) {
        this.deleteFrame(frameIndex, false, compId);
        return null;
      }
      if (expectedWidth && expectedHeight && entry.width && entry.height) {
        const entryAspect = entry.width / entry.height;
        const expectedAspect = expectedWidth / expectedHeight;
        if (Math.abs(entryAspect - expectedAspect) > 0.15) {
          return null;
        }
      }
      return entry.bitmap;
    }

    /**
     * Evict the single worst frame from the current pool when over maxFrames limit.
     * Strategy: protect the active composition playback range so the timeline bar stays solid.
     * Furthest frames from playhead outside the project loop are evicted first.
     */
    _evictIfNeeded(compId = null) {
      const targetComp = compId || this.activeCompId;
      const pool = this.getPool(targetComp);
      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : 0;
      const totalProjectFrames = Math.round(totalDur * this.fps);
      const effectiveMax = Math.max(this.maxFrames || 1200, totalProjectFrames + 120);
      if (pool.size <= effectiveMax) return;

      const pps = (typeof window !== 'undefined' && window.currentPixelsPerSecond) ? window.currentPixelsPerSecond : 80;
      const curSec = (typeof window !== 'undefined' && typeof window.getCurrentPlayheadTime === 'function')
        ? window.getCurrentPlayheadTime()
        : ((typeof window !== 'undefined' && window.timelinePanX !== undefined) ? Math.abs(window.timelinePanX) / pps : 0);
      const curFrame = Math.round(curSec * this.fps);

      let worstIdx = -1;
      let worstScore = -Infinity;

      for (const fIdx of pool.keys()) {
        const inFlightKey = `${targetComp}:${fIdx}`;
        if (this._inFlightFrames && this._inFlightFrames.has(inFlightKey)) continue; // never evict in-flight
        const dist = Math.abs(fIdx - curFrame);
        // Frames outside project duration bounds are purged first, otherwise furthest from playhead
        let score = dist;
        if (fIdx < 0 || fIdx > totalProjectFrames) {
          score += 100000;
        }
        if (score > worstScore) {
          worstScore = score;
          worstIdx = fIdx;
        }
      }

      if (worstIdx !== -1) {
        this.deleteFrame(worstIdx, false, targetComp);
      }
    }

    /**
     * Check if a frame is part of a contiguous cached sequence.
     * Prevents playback strobe/jitter when cache has gaps or isolated frames.
     * minRun=2: AE-like behavior — just 2 contiguous frames are enough to allow cache playback.
     */
    isContiguousPlaybackFrame(frameIndex, minRun = 2) {
      if (!this.frames.has(frameIndex)) return false;
      const totalDur = (typeof window !== 'undefined' && typeof window.getProjectTotalDuration === 'function')
        ? window.getProjectTotalDuration()
        : 0;
      const effectiveMinRun = totalDur > 0 ? Math.min(minRun, Math.max(1, Math.ceil(totalDur * this.fps))) : minRun;

      let count = 0;
      let f = frameIndex;
      while (this.frames.has(f)) {
        count++;
        if (count >= effectiveMinRun) return true;
        f--;
      }
      f = frameIndex + 1;
      while (this.frames.has(f)) {
        count++;
        if (count >= effectiveMinRun) return true;
        f++;
      }
      return count >= effectiveMinRun;
    }

    // Throttled ruler update: rapid batched updates to display green progress bar promptly
    _scheduleRulerUpdate() {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (this._rulerUpdatePending) return;
      this._rulerUpdatePending = true;
      setTimeout(() => {
        this._rulerUpdatePending = false;
        this.updateRulerUI();
      }, 80);
    }

    async setFrameFromCanvas(frameIndex, sourceCanvas, isDraft = this.isDraftMode, compId = null) {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) return;
      const targetComp = compId || this.activeCompId;
      const targetPool = this.getPool(targetComp);
      if (this.hasFrame(frameIndex, sourceCanvas.width, sourceCanvas.height, targetComp)) return;
      if (!this._pendingFrames) this._pendingFrames = new Set();
      if (!this._inFlightFrames) this._inFlightFrames = new Set();
      const inFlightKey = `${targetComp}:${frameIndex}`;
      // Guard against excessive GPU memory pressure (allow up to 8 in-flight frames for 60fps playback)
      if (this._inFlightFrames.size >= 8) return;
      if (this._pendingFrames.has(inFlightKey) || this._inFlightFrames.has(inFlightKey)) return;
      this._pendingFrames.add(inFlightKey);
      this._inFlightFrames.add(inFlightKey);
      try {
        const bitmap = await createImageBitmap(sourceCanvas);
        // Re-check after await: frame may have been cleared/invalidated while we were encoding
        if (!this._inFlightFrames.has(inFlightKey)) return; // Was cancelled during encoding
        this.deleteFrame(frameIndex, false, targetComp);
        targetPool.set(frameIndex, {
          bitmap,
          isDraft,
          width: sourceCanvas.width,
          height: sourceCanvas.height
        });
        // Evict oldest frame if over limit (LRU — keeps playback smooth without OOM)
        this._evictIfNeeded(targetComp);
        // Throttled ruler update — prevents ruler flickering during rapid idle cache fills (120ms batch)
        this._scheduleRulerUpdate();
      } catch (_) {}
      finally {
        if (this._pendingFrames) this._pendingFrames.delete(inFlightKey);
        if (this._inFlightFrames) this._inFlightFrames.delete(inFlightKey);
      }
    }

    deleteFrame(frameIndex, updateUI = true, compId = null) {
      const targetComp = compId || this.activeCompId;
      const inFlightKey = `${targetComp}:${frameIndex}`;
      if (this._pendingFrames) {
        this._pendingFrames.delete(inFlightKey);
      }
      if (this._inFlightFrames) {
        this._inFlightFrames.delete(inFlightKey);
      }
      const pool = this.getPool(targetComp);
      const entry = pool.get(frameIndex);
      if (entry) {
        if (entry.bitmap && typeof entry.bitmap.close === 'function') {
          entry.bitmap.close();
        }
        pool.delete(frameIndex);
        if (updateUI && targetComp === this.activeCompId) {
          this.updateRulerUI();
        }
      }
    }

    /**
     * Selective Cache Invalidation (AE-style)
     * Invalidate only frames within [startSec, endSec] affected by a layer modification
     */
    invalidateRange(startSec, endSec, fps = this.fps, compId = null) {
      if (startSec === undefined || endSec === undefined) {
        this.clearAll('current', compId);
        return;
      }
      const targetComp = compId || this.activeCompId;
      const pool = this.getPool(targetComp);
      const minSec = Math.max(0, Math.min(startSec, endSec));
      const maxSec = Math.max(startSec, endSec);
      const startFrame = Math.max(0, Math.floor(minSec * fps) - 1);
      const endFrame = Math.ceil(maxSec * fps) + 1;

      let changed = false;
      for (let f = startFrame; f <= endFrame; f++) {
        const inFlightKey = `${targetComp}:${f}`;
        if (this._pendingFrames) {
          this._pendingFrames.delete(inFlightKey);
        }
        if (this._inFlightFrames) {
          this._inFlightFrames.delete(inFlightKey);
        }
        if (pool.has(f)) {
          const entry = pool.get(f);
          if (entry && entry.bitmap && typeof entry.bitmap.close === 'function') {
            entry.bitmap.close();
          }
          pool.delete(f);
          changed = true;
        }
      }
      if (changed && (!compId || compId === this.activeCompId)) {
        this.updateRulerUI();
      }
      if (this.idleCacheEnabled) {
        this.scheduleIdleCheck();
      }
    }

    clearAll(scope = 'current', compId = null) {
      if (this._pendingFrames) {
        this._pendingFrames.clear();
      }
      // Cancel all in-flight bitmap encodes so stale frames don't re-appear after clear
      if (this._inFlightFrames) {
        this._inFlightFrames.clear();
      }
      if (scope === 'all') {
        for (const pool of this.pools.values()) {
          for (const entry of pool.values()) {
            if (entry && entry.bitmap && typeof entry.bitmap.close === 'function') {
              entry.bitmap.close();
            }
          }
          pool.clear();
        }
      } else {
        const pool = this.getPool(compId || this.activeCompId);
        for (const entry of pool.values()) {
          if (entry && entry.bitmap && typeof entry.bitmap.close === 'function') {
            entry.bitmap.close();
          }
        }
        pool.clear();
      }
      this.updateRulerUI();
      if (this.idleCacheEnabled) {
        this.scheduleIdleCheck();
      }
    }

    clearPool(compId) {
      if (compId) {
        this.deletePool(compId);
      }
      this.clearAll('all');
    }

    clear() {
      this.clearAll('all');
    }

    /**
     * Precompose frames are preserved in their own pool (PreviewCacheManager.getPool(layer.id))
     * and drawn directly via renderPrecompToCanvas without mass createImageBitmap cloning.
     */
    adoptPrecompFrames(precompLayer, parentCompId = 'root') {
      this.updateRulerUI();
    }

    adoptRootFrames(precompLayer, rootCompId = 'root') {
      this.updateRulerUI();
    }

    updateRulerUI() {
      if (this._rulerRafScheduled) return;
      this._rulerRafScheduled = true;
      requestAnimationFrame(() => {
        this._rulerRafScheduled = false;
        this._renderRuler();
        if (typeof window.updateAllPrecompClipsProgress === 'function') {
          window.updateAllPrecompClipsProgress();
        }
      });
    }

    _renderRuler() {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (!this.rulerCanvas) {
        this.rulerCanvas = document.getElementById('timeline-cache-ruler-bar');
        if (this.rulerCanvas) this.rulerCtx = this.rulerCanvas.getContext('2d');
      }
      if (!this.rulerCanvas || !this.rulerCtx) return;

      const pps = window.currentPixelsPerSecond || 80;
      const totalDur = (typeof window.getProjectTotalDuration === 'function') ? window.getProjectTotalDuration() : 0;
      const trackWidth = Math.ceil(totalDur * pps);

      if (this.rulerCanvas.width !== trackWidth || this.rulerCanvas.height !== 3) {
        this.rulerCanvas.width = Math.max(1, trackWidth);
        this.rulerCanvas.height = 3;
        this.rulerCanvas.style.width = trackWidth + 'px';
        this.rulerCanvas.style.height = '3px';
      }

      this.rulerCtx.clearRect(0, 0, this.rulerCanvas.width, 3);
      if (totalDur <= 0 || this.frames.size === 0 || window.isPreviewCacheEnabled === false) return;

      if (!this._cachedPrimaryColor || (Date.now() - (this._lastColorQuery || 0) > 3000)) {
        this._cachedPrimaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#98ce7b';
        this._lastColorQuery = Date.now();
      }
      this.rulerCtx.fillStyle = this._cachedPrimaryColor;

      const pxPerFrame = pps / this.fps;
      const totalFrames = Math.ceil(totalDur * this.fps);

      let runStart = -1;
      for (let f = 0; f <= totalFrames; f++) {
        // Bridge single-frame micro gaps during live playback to maintain solid green bar
        const isCached = this.frames.has(f) || (f > 0 && f < totalFrames && this.frames.has(f - 1) && this.frames.has(f + 1));
        if (isCached) {
          if (runStart === -1) runStart = f;
        } else {
          if (runStart !== -1) {
            const x = Math.floor(runStart * pxPerFrame);
            const xEnd = Math.ceil(f * pxPerFrame);
            const w = Math.max(1, xEnd - x);
            this.rulerCtx.fillRect(x, 0, w, 3);
            runStart = -1;
          }
        }
      }
      if (runStart !== -1) {
        const x = Math.floor(runStart * pxPerFrame);
        const xEnd = Math.ceil(totalFrames * pxPerFrame);
        const w = Math.max(1, xEnd - x);
        this.rulerCtx.fillRect(x, 0, w, 3);
      }
    }

    setupUserActivityListeners() {
      const onActivity = () => {
        this.lastUserActivity = Date.now();
        if (this.isIdleRunning) {
          this.stopIdleWorker();
        }
        if (this.idleCacheEnabled) {
          this.scheduleIdleCheck();
        }
      };

      window.addEventListener('pointerdown', onActivity, { passive: true });
      window.addEventListener('pointermove', onActivity, { passive: true });
      window.addEventListener('keydown', onActivity, { passive: true });
      window.addEventListener('wheel', onActivity, { passive: true });
      window.addEventListener('scroll', onActivity, { passive: true });
    }

    _hasExtractingVideoInActiveComp() {
      const projectState = (typeof window !== 'undefined') ? window.currentProjectState : null;
      if (!projectState || !Array.isArray(projectState.layers)) return false;
      const vfe = (typeof window !== 'undefined') ? window.VideoFrameExtractor : null;
      if (!vfe) return false;
      const targetLayers = (this.activeCompId && this.activeCompId !== 'root' && window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers))
        ? window.currentActivePrecomp.layers
        : projectState.layers;
      for (const layer of targetLayers) {
        if (layer && layer.type === 'video' && !layer.hidden) {
          const sk = (typeof vfe._getSourceKey === 'function') ? vfe._getSourceKey(layer) : (layer.mediaId || layer.dataUrl || layer.id);
          const sc = (typeof vfe.getSourceCache === 'function') ? vfe.getSourceCache(sk) : (vfe.sources ? vfe.sources.get(sk) : null);
          if (sc && sc.isExtracting) return true;
        }
      }
      return false;
    }

    scheduleIdleCheck(immediate = false) {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (!this.idleCacheEnabled) return;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      const delay = immediate ? 50 : 600;
      this.idleTimer = setTimeout(() => {
        if (typeof window !== 'undefined' && window.isExporting) return;
        if (!this.idleCacheEnabled) return;
        if (window.isTimelinePlaying || window.isTransformInteracting) return;
        // Only pause idle cache if an active video layer in this composition is currently extracting
        if (this._hasExtractingVideoInActiveComp()) return;
        if (document.querySelector('.modal-backdrop.is-open, .modal-backdrop.active')) return;
        this.startIdleWorker();
      }, delay);
    }

    /**
     * Force immediate background recache for a specific time range or whole active composition
     */
    forceRecache(startSec = null, endSec = null) {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (startSec !== null && endSec !== null && isFinite(startSec) && isFinite(endSec)) {
        this.invalidateRange(startSec, endSec);
      } else {
        this.clearAll('current');
      }
      this.idleCacheEnabled = true;
      this.stopIdleWorker();
      this.scheduleIdleCheck(true);
    }

    startIdleWorker() {
      if (typeof window !== 'undefined' && window.isExporting) return;
      if (this.isIdleRunning || !this.idleCacheEnabled || window.isTimelinePlaying || window.isTransformInteracting) return;
      if (this._hasExtractingVideoInActiveComp()) return;
      this.isIdleRunning = true;
      this.runIdleStep();
    }

    stopIdleWorker() {
      this.isIdleRunning = false;
      if (this.idleWorkerId) {
        if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this.idleWorkerId);
        else clearTimeout(this.idleWorkerId);
        this.idleWorkerId = null;
      }
    }

    isTimeReadyToCache(sec) {
      const projectState = window.currentProjectState;
      if (!projectState || !projectState.layers) return true;
      const pps = window.currentPixelsPerSecond || 80;
      const vfe = window.VideoFrameExtractor;

      const checkLayers = (layers) => {
        if (!Array.isArray(layers)) return true;
        for (const layer of layers) {
          if (layer.hidden) continue;
          if (layer.type === 'precomp' && Array.isArray(layer.layers)) {
            if (!checkLayers(layer.layers)) return false;
          }
          if (layer.type !== 'video') continue;
          const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
          const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
          const end = start + dur;

          // If time falls within this video layer's active playback bounds
          if (sec >= start && sec < end) {
            if (vfe && typeof vfe.isVideoFrameReady === 'function') {
              if (!vfe.isVideoFrameReady(layer, sec)) {
                return false; // Video frame not yet extracted into cache! Skip project caching!
              }
            } else {
              return false;
            }
          }
        }
        return true;
      };

      return checkLayers(projectState.layers);
    }

    runIdleStep() {
      if (typeof window !== 'undefined' && window.isExporting) {
        this.stopIdleWorker();
        return;
      }
      if (!this.isIdleRunning || !this.idleCacheEnabled || window.isTimelinePlaying || window.isTransformInteracting) {
        this.stopIdleWorker();
        return;
      }
      // Wait only for video layers in the active composition to complete extraction
      if (this._hasExtractingVideoInActiveComp()) {
        this.stopIdleWorker();
        return;
      }

      const totalDur = (typeof window.getProjectTotalDuration === 'function') ? window.getProjectTotalDuration() : 0;
      if (totalDur <= 0) {
        this.stopIdleWorker();
        return;
      }

      const totalFrames = Math.ceil(totalDur * this.fps);
      const pps = window.currentPixelsPerSecond || 80;
      const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
      const currentFrame = Math.max(0, Math.min(totalFrames - 1, Math.round((Math.abs(currentPanX) / pps) * this.fps)));

      // AE-Style Bidirectional RAM Preview Sweep:
      // Fill cache OUTWARD from playhead in both directions simultaneously.
      // Forward: currentFrame, +1, +2, +3...
      // Backward: currentFrame-1, -2, -3...
      let targetFrame = -1;
      let fwdIdx = currentFrame;
      let bwdIdx = currentFrame - 1;
      const targetComp = this.activeCompId || 'root';

      while (targetFrame === -1 && (fwdIdx < totalFrames || bwdIdx >= 0)) {
        // Check forward first (more useful — user is likely playing forward)
        if (fwdIdx < totalFrames) {
          const inFlightKey = `${targetComp}:${fwdIdx}`;
          if (!this.frames.has(fwdIdx) && (!this._inFlightFrames || !this._inFlightFrames.has(inFlightKey)) && this.isTimeReadyToCache(fwdIdx / this.fps)) {
            targetFrame = fwdIdx;
            break;
          }
          fwdIdx++;
        }
        // Then check backward (recent history — scrub back support)
        if (bwdIdx >= 0) {
          const inFlightKey = `${targetComp}:${bwdIdx}`;
          if (!this.frames.has(bwdIdx) && (!this._inFlightFrames || !this._inFlightFrames.has(inFlightKey)) && this.isTimeReadyToCache(bwdIdx / this.fps)) {
            targetFrame = bwdIdx;
            break;
          }
          bwdIdx--;
        }
      }

      if (targetFrame === -1) {
        this.stopIdleWorker();
        return;
      }

      const renderNext = async () => {
        if (!this.isIdleRunning || !this.idleCacheEnabled || window.isTimelinePlaying || window.isTransformInteracting) {
          this.stopIdleWorker();
          return;
        }

        const activeCanvas = document.getElementById('editor-active-canvas');
        if (!activeCanvas || activeCanvas.width === 0 || activeCanvas.height === 0) {
          this.stopIdleWorker();
          return;
        }

        if (!this.offscreenCanvas) {
          this.offscreenCanvas = document.createElement('canvas');
        }
        this.offscreenCanvas.width = activeCanvas.width;
        this.offscreenCanvas.height = activeCanvas.height;

        const targetSec = targetFrame / this.fps;

        // Pre-hydrate exact video frames from IndexedDB into RAM before idle-cache renders
        const vfe = window.VideoFrameExtractor;
        if (vfe && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
          const pps = window.currentPixelsPerSecond || 80;
          for (const layer of window.currentProjectState.layers) {
            if (layer.type === 'video' && !layer.hidden) {
              const start = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
              const dur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
              if (targetSec >= start && targetSec < start + dur) {
                const sourceKey = vfe._getSourceKey ? vfe._getSourceKey(layer) : (layer.mediaId || layer.dataUrl || layer.id);
                const source = vfe.getSourceCache ? vfe.getSourceCache(sourceKey) : null;
                if (source) {
                  let timeInClip = 0;
                  if (layer.speedMode === 'time_remap') {
                    const eff = (typeof window.getLayerEffectivePropsAtTime === 'function')
                      ? window.getLayerEffectivePropsAtTime(layer, targetSec)
                      : layer;
                    timeInClip = Math.max(0, eff.timeRemap !== undefined ? eff.timeRemap : ((targetSec - start) * (layer.speed || 1.0)));
                  } else {
                    timeInClip = (typeof window.getLayerIntegratedSpeedTime === 'function')
                      ? window.getLayerIntegratedSpeedTime(layer, targetSec)
                      : Math.max(0, (layer.sourceOffsetSec || 0) + (targetSec - start) * (layer.speed || 1.0));
                  }
                  const fIdx = Math.round(timeInClip * source.fps);
                  if (!source.frames.has(fIdx) && source.cachedFrameIndices && source.cachedFrameIndices.has(fIdx)) {
                    if (typeof vfe.fetchFrameFromDBAsync === 'function') {
                      await vfe.fetchFrameFromDBAsync(source, fIdx);
                    }
                  }
                }
              }
            }
          }
        }

        let isFrameReady = true;
        if (typeof window.renderCanvasFrame === 'function') {
          const res = window.renderCanvasFrame(
            this.offscreenCanvas,
            window.currentProjectState ? window.currentProjectState.bgColor : 'transparent',
            this.offscreenCanvas.width,
            this.offscreenCanvas.height,
            'idle-cache',
            targetSec
          );
          if (res === false) isFrameReady = false;
        }
        if (isFrameReady) {
          await this.setFrameFromCanvas(targetFrame, this.offscreenCanvas, this.isDraftMode);
        } else {
          this.stopIdleWorker();
          return;
        }

        if (this.isIdleRunning) {
          if (typeof requestIdleCallback === 'function') {
            this.idleWorkerId = requestIdleCallback(() => this.runIdleStep(), { timeout: 50 });
          } else {
            // 16ms = exactly one 60fps frame tick — idle cache fills at display refresh rate
            this.idleWorkerId = setTimeout(() => this.runIdleStep(), 16);
          }
        }
      };

      renderNext();
    }

    /**
     * Progressive Auto-Prebake for Precomposition Layers
     * Autonomous background pipeline (mirrors VideoFrameExtractor):
     * - Auto-triggered when precomp is created, loaded, or timeline renders
     * - Proxy resolution (max 960px) for high quality + 1ms ImageBitmap encode
     * - Cooperative yielding via requestIdleCallback/setTimeout
     * - Zero-delay pause during live playback/scrubbing to ensure 60fps
     * - Real-time green loading bar update on timeline clip
     */
    prebakePrecomp(layer) {
      if (!layer || layer.type !== 'precomp') return;
      if (!Array.isArray(layer.layers) || layer.layers.length === 0) {
        layer._precompCacheProgress = 1;
        layer._precompCacheComplete = true;
        if (typeof window.updatePrecompClipProgress === 'function') {
          window.updatePrecompClipProgress(layer);
        }
        return;
      }

      if (!this._precompBakers) this._precompBakers = new Map();
      if (this._precompBakers.has(layer.id)) {
        return;
      }

      const pool = this.getPool(layer.id);
      const fps = this.fps || 60;
      const pps = window.currentPixelsPerSecond || 80;
      const dur = (layer.durationSec !== undefined && layer.durationSec > 0)
        ? layer.durationSec
        : ((layer.widthPx || 320) / pps);
      const effSpeed = (layer.speed !== undefined && layer.speed > 0) ? layer.speed : 1.0;
      let totalDur = (layer.mediaDuration && layer.mediaDuration > 0)
        ? layer.mediaDuration
        : Math.max(1, (dur * effSpeed) + (layer.sourceOffsetSec || 0));
      if (layer.speedMode === 'time_remap' && layer.keyframes && Array.isArray(layer.keyframes.timeRemap)) {
        let maxRemap = 0;
        layer.keyframes.timeRemap.forEach(kf => {
          const v = (kf && kf.value && typeof kf.value.timeRemap === 'number') ? kf.value.timeRemap : (typeof kf.value === 'number' ? kf.value : 0);
          if (v > maxRemap) maxRemap = v;
        });
        if (maxRemap > 0) {
          totalDur = Math.max(totalDur, maxRemap + 1);
        }
      }
      const totalFrames = Math.max(1, Math.ceil(totalDur * fps));

      const missing = [];
      for (let f = 0; f < totalFrames; f++) {
        if (!pool.has(f)) missing.push(f);
      }

      if (missing.length === 0) {
        layer._precompCacheProgress = 1;
        layer._precompCacheComplete = true;
        if (typeof window.updatePrecompClipProgress === 'function') {
          window.updatePrecompClipProgress(layer);
        }
        return;
      }

      const bakerState = {
        isCancelled: false,
        missing,
        totalFrames,
        timer: null
      };
      this._precompBakers.set(layer.id, bakerState);

      const baseW = Math.round(Math.abs(layer.mediaWidth || layer.scaleW || 1920));
      const baseH = Math.round(Math.abs(layer.mediaHeight || layer.scaleH || 1080));
      const maxDim = 960;
      const scale = Math.min(1, maxDim / Math.max(baseW, baseH));
      const bakeW = Math.max(160, Math.round(baseW * scale));
      const bakeH = Math.max(90, Math.round(baseH * scale));

      let offCanvas = null;
      try {
        if (typeof OffscreenCanvas !== 'undefined') {
          offCanvas = new OffscreenCanvas(bakeW, bakeH);
        } else {
          offCanvas = document.createElement('canvas');
          offCanvas.width = bakeW;
          offCanvas.height = bakeH;
        }
      } catch (_) {
        offCanvas = document.createElement('canvas');
        offCanvas.width = bakeW;
        offCanvas.height = bakeH;
      }

      const step = async () => {
        if (bakerState.isCancelled || !this._precompBakers.has(layer.id)) {
          this._precompBakers.delete(layer.id);
          return;
        }

        // Pause during playback, dragging, or scrubbing
        if (window.isTimelinePlaying || window.isTransformInteracting || window.isExporting || (typeof isPanning !== 'undefined' && isPanning)) {
          bakerState.timer = setTimeout(step, 200);
          return;
        }

        if (missing.length === 0) {
          this._precompBakers.delete(layer.id);
          layer._precompCacheProgress = 1;
          layer._precompCacheComplete = true;
          if (typeof window.updatePrecompClipProgress === 'function') {
            window.updatePrecompClipProgress(layer);
          }
          return;
        }

        const targetFrame = missing.shift();
        const innerSec = targetFrame / fps;

        if (typeof window.renderPrecompToCanvas === 'function') {
          window.renderPrecompToCanvas(layer, offCanvas, innerSec, bakeW, bakeH, 'prebake');
          try {
            const bitmap = await createImageBitmap(offCanvas);
            pool.set(targetFrame, {
              bitmap,
              isDraft: false,
              width: bakeW,
              height: bakeH
            });
          } catch (_) {}
        }

        const progress = Math.min(1, pool.size / totalFrames);
        layer._precompCacheProgress = progress;
        if (typeof window.updatePrecompClipProgress === 'function') {
          window.updatePrecompClipProgress(layer);
        }

        if (missing.length > 0) {
          if (typeof requestIdleCallback === 'function') {
            bakerState.timer = requestIdleCallback(step, { timeout: 100 });
          } else {
            bakerState.timer = setTimeout(step, 16);
          }
        } else {
          this._precompBakers.delete(layer.id);
          layer._precompCacheProgress = 1;
          layer._precompCacheComplete = true;
          if (typeof window.updatePrecompClipProgress === 'function') {
            window.updatePrecompClipProgress(layer);
          }
        }
      };

      if (typeof requestIdleCallback === 'function') {
        bakerState.timer = requestIdleCallback(step, { timeout: 100 });
      } else {
        bakerState.timer = setTimeout(step, 16);
      }
    }

    cancelPrecompPrebake(layerId) {
      if (!this._precompBakers || !this._precompBakers.has(layerId)) return;
      const b = this._precompBakers.get(layerId);
      b.isCancelled = true;
      if (b.timer) {
        if (typeof cancelIdleCallback === 'function') cancelIdleCallback(b.timer);
        else clearTimeout(b.timer);
      }
      this._precompBakers.delete(layerId);
    }

    prebakeAllPrecomps(layers) {
      (layers || []).forEach(l => {
        if (l && l.type === 'precomp' && !l._precompCacheComplete) {
          this.prebakePrecomp(l);
        }
      });
    }

    /**
     * Look-Ahead Playback Caching
     * Pre-renders frames AHEAD of the current playhead into the cache during playback.
     * Triggered from stepPlay after each rendered frame.
     * @param {number} fromSec  - current playhead position in seconds
     * @param {number} fps      - project fps
     */
    startLookaheadWorker(fromSec, fps) {
      if (!window.isTimelinePlaying) return;

      const lookaheadSec = (typeof window.cacheLookaheadSec === 'number' && window.cacheLookaheadSec > 0)
        ? window.cacheLookaheadSec : 1.5;

      if (this._lookaheadRunning) {
        const workerEndSec = (this._lookaheadFromSec || 0) + lookaheadSec;
        if (fromSec < workerEndSec) {
          // Slide the lookahead window forward with the playhead
          this._lookaheadExtendTo = Math.round((fromSec + lookaheadSec) * fps);
          return;
        }
        this.stopLookaheadWorker();
      }

      const targetComp = this.activeCompId || 'root';
      const startFrame = Math.round(fromSec * fps) + 1;
      const endFrame   = startFrame + Math.round(lookaheadSec * fps);

      const queue = [];
      for (let f = startFrame; f < endFrame; f++) {
        const k = `${targetComp}:${f}`;
        if (!this.frames.has(f) && !(this._inFlightFrames && this._inFlightFrames.has(k))) {
          queue.push(f);
        }
      }
      if (queue.length === 0) return;

      this._lookaheadRunning   = true;
      this._lookaheadCancelled = false;
      this._lookaheadFromSec   = fromSec;
      this._lookaheadExtendTo  = endFrame;
      this._lookaheadQueueTail = queue[queue.length - 1]; // O(1) tail tracking

      if (!this._lookaheadCanvas) {
        this._lookaheadCanvas = document.createElement('canvas');
      }
      const activeCanvas = document.getElementById('editor-active-canvas');
      if (!activeCanvas) { this._lookaheadRunning = false; return; }
      this._lookaheadCanvas.width  = activeCanvas.width;
      this._lookaheadCanvas.height = activeCanvas.height;

      // MessageChannel: fires as macro-task between rAF ticks (reliable during active playback)
      const mc = new MessageChannel();
      this._lookaheadPort = mc.port2;

      const scheduleNext = () => {
        // Use _lookaheadCancelled (not mc reference) so stopLookaheadWorker truly kills the loop
        if (!this._lookaheadCancelled) mc.port2.postMessage(null);
      };

      mc.port1.onmessage = async () => {
        if (this._lookaheadCancelled || !window.isTimelinePlaying ||
            window.isTransformInteracting || window.isExporting) {
          this._lookaheadRunning = false;
          return;
        }

        // Back off if GPU encode pipeline saturated
        if (this._inFlightFrames && this._inFlightFrames.size >= 5) {
          scheduleNext();
          return;
        }

        // Extend queue O(1) tail — no Math.max spread
        if (this._lookaheadExtendTo > (this._lookaheadQueueTail || 0) + 1) {
          const tail = this._lookaheadQueueTail || startFrame;
          for (let f = tail + 1; f < this._lookaheadExtendTo; f++) {
            const k = `${targetComp}:${f}`;
            if (!this.frames.has(f) && !(this._inFlightFrames && this._inFlightFrames.has(k))) {
              queue.push(f);
            }
          }
          this._lookaheadQueueTail = this._lookaheadExtendTo - 1;
        }

        const targetFrame = queue.shift();
        if (targetFrame === undefined) {
          this._lookaheadRunning = false;
          return;
        }

        // Skip already-cached
        const k = `${targetComp}:${targetFrame}`;
        if (this.frames.has(targetFrame) || (this._inFlightFrames && this._inFlightFrames.has(k))) {
          scheduleNext();
          return;
        }

        const targetSec = targetFrame / fps;
        if (typeof window.renderCanvasFrame === 'function') {
          const res = window.renderCanvasFrame(
            this._lookaheadCanvas,
            window.currentProjectState ? window.currentProjectState.bgColor : 'transparent',
            this._lookaheadCanvas.width,
            this._lookaheadCanvas.height,
            'lookahead-cache',
            targetSec
          );
          if (res !== false) {
            // CRITICAL: await bitmap encode BEFORE scheduling next step.
            // Canvas must not be redrawn until createImageBitmap completes.
            await this.setFrameFromCanvas(targetFrame, this._lookaheadCanvas, this.isDraftMode);
          }
        }

        // Schedule next frame AFTER await — canvas is safe to reuse now
        if (queue.length > 0 || this._lookaheadExtendTo > targetFrame + 1) {
          scheduleNext();
        } else {
          this._lookaheadRunning = false;
        }
      };

      // Kick off on next macro-task
      setTimeout(scheduleNext, 0);
    }

    stopLookaheadWorker() {
      this._lookaheadCancelled = true;
      this._lookaheadRunning   = false;
      if (this._lookaheadPort) {
        this._lookaheadPort.onmessage = null;
        this._lookaheadPort = null;
      }
      if (this._lookaheadTimer) {
        clearTimeout(this._lookaheadTimer);
        this._lookaheadTimer = null;
      }
    }
  }

  window.PreviewCacheManager = new PreviewCacheManager();
})(window);