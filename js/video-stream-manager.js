/**
 * FishTool Studio - VideoStreamManager
 * Main-thread coordinator for WebCodecs worker video streams.
 * Features bounded LRU cache (15 frames max) and mobile memory protection.
 */

(function(window) {
  'use strict';

  /**
   * Detect Safari and extract major version.
   * Returns 0 if not Safari.
   * Safari on Ventura (macOS 13) ships Safari 16.x which has a buggy
   * WebCodecs (VideoDecoder) implementation in Worker threads that causes
   * a hard WebContent process crash. We gate WebCodecs to Safari >= 17 only.
   */
  function _getSafariMajorVersion() {
    const ua = navigator.userAgent;
    // Must have 'Safari' but NOT 'Chrome'/'Chromium'/'EdgA'/'FxiOS' (which spoof Safari UA)
    if (!/Safari\//.test(ua) || /Chrome\/|Chromium\/|EdgA\/|FxiOS\//.test(ua)) return 0;
    const m = ua.match(/Version\/(\d+)\./);
    return m ? parseInt(m[1], 10) : 0;
  }

  class VideoStreamManager {
    constructor() {
      const safariVer = _getSafariMajorVersion();
      // Disable WebCodecs on Safari < 17 — crashes WebContent process on Ventura
      const safariWebCodecsOk = safariVer === 0 || safariVer >= 17;
      this.isSupported = safariWebCodecsOk &&
        typeof window.VideoDecoder !== 'undefined' &&
        typeof window.Worker !== 'undefined';
      this.worker = null;
      this.requestId = 0;
      this.pendingRequests = new Map();
      this.streams = new Map(); // mediaId -> { ready: boolean, width: number, height: number, duration: number, isSeekingWorker: boolean, pendingSeekTime: number }
      this.frameCache = new Map(); // cacheKey -> { bitmap: ImageBitmap, lastUsed: number }
      this.maxCacheSize = 180; // Expanded for smoother full-timeline video scrubbing

      if (this.isSupported) {
        this._initWorker();
      } else if (safariVer > 0 && safariVer < 17) {
        console.info('[VideoStreamManager] Safari ' + safariVer + ' detected — WebCodecs disabled, using HTML5 video fallback.');
      }
    }

    _initWorker() {
      try {
        this.worker = new Worker('js/video-decoder-worker.js');
        this.worker.onmessage = (e) => this._onWorkerMessage(e);
        this.worker.onerror = (err) => {
          console.warn('[VideoStreamManager] Worker error, falling back to HTML5 video:', err);
          this.isSupported = false;
        };
      } catch (err) {
        console.warn('[VideoStreamManager] Could not instantiate worker:', err);
        this.isSupported = false;
      }
    }

    _onWorkerMessage(e) {
      const data = e.data;
      if (!data) return;

      const { type, id, mediaId, bitmap, timeSec } = data;

      if (type === 'init_ok') {
        const streamInfo = this.streams.get(mediaId);
        if (streamInfo) {
          streamInfo.ready = true;
          streamInfo.duration = data.duration;
          streamInfo.width = data.width;
          streamInfo.height = data.height;
          if (streamInfo.resolveInit) {
            streamInfo.resolveInit(streamInfo);
            streamInfo.resolveInit = null;
          }
        }
      } else if (type === 'init_error') {
        console.error(`%c[FishWebCodecs:InitError] mediaId=${mediaId}: ${data.error}`, 'color: #ff5555; font-weight: bold;');
        const streamInfo = this.streams.get(mediaId);
        if (streamInfo && streamInfo.rejectInit) {
          streamInfo.rejectInit(data.error);
          streamInfo.rejectInit = null;
        }
      } else if (type === 'seek_result') {
        const streamInfo = this.streams.get(mediaId);
        if (streamInfo) {
          streamInfo.isSeekingWorker = false;
        }
        const req = this.pendingRequests.get(id);
        if (req) {
          this.pendingRequests.delete(id);
          const elapsed = performance.now() - (req.startTime || performance.now());
          if (bitmap) {
            this._storeInCache(mediaId, timeSec, bitmap);
            req.resolve(bitmap);
          } else {
            req.resolve(null);
          }
        }

        // Process any queued pending seek for this media stream
        if (streamInfo && streamInfo.pendingSeekTime !== null && streamInfo.pendingSeekTime !== undefined) {
          const nextTime = streamInfo.pendingSeekTime;
          const nextResolves = streamInfo.pendingResolves || [];
          streamInfo.pendingSeekTime = null;
          streamInfo.pendingResolves = null;
          this.seekFrame(mediaId, nextTime).then(bmp => {
            nextResolves.forEach(r => r(bmp));
          });
        }
      }
    }

    _storeInCache(mediaId, timeSec, bitmap) {
      // 1ms resolution key — supports up to 1000fps, no collision for 60/120fps content
      const key = `${mediaId}_${Math.round(timeSec * 1000)}`;
      // If cache full, prune oldest entry to keep mobile memory flat
      if (this.frameCache.size >= this.maxCacheSize) {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [k, v] of this.frameCache.entries()) {
          if (v.lastUsed < oldestTime) {
            oldestTime = v.lastUsed;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          const oldEntry = this.frameCache.get(oldestKey);
          if (oldEntry && oldEntry.bitmap && typeof oldEntry.bitmap.close === 'function') {
            oldEntry.bitmap.close();
          }
          this.frameCache.delete(oldestKey);
        }
      }

      this.frameCache.set(key, {
        bitmap: bitmap,
        lastUsed: performance.now()
      });
    }

    _getFromCache(mediaId, timeSec) {
      // Must match _storeInCache 1ms resolution
      const key = `${mediaId}_${Math.round(timeSec * 1000)}`;
      const entry = this.frameCache.get(key);
      if (entry && entry.bitmap) {
        entry.lastUsed = performance.now();
        return entry.bitmap;
      }
      return null;
    }

    async loadMedia(mediaId, dataUrlOrBlob) {
      if (!this.isSupported || !this.worker) return false;
      if (this.streams.has(mediaId) && this.streams.get(mediaId).ready) {
        return true;
      }

      try {
        let arrayBuffer;
        if (dataUrlOrBlob instanceof Blob) {
          arrayBuffer = await dataUrlOrBlob.arrayBuffer();
        } else if (typeof dataUrlOrBlob === 'string') {
          if (dataUrlOrBlob.startsWith('data:')) {
            try {
              const res = await fetch(dataUrlOrBlob);
              arrayBuffer = await res.arrayBuffer();
            } catch (_) {
              // Large data URL fallback (Chromium fetch limit bypass)
              const commaIdx = dataUrlOrBlob.indexOf(',');
              const base64 = commaIdx !== -1 ? dataUrlOrBlob.substring(commaIdx + 1) : dataUrlOrBlob;
              const binary = atob(base64);
              const len = binary.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              arrayBuffer = bytes.buffer;
            }
          } else {
            const res = await fetch(dataUrlOrBlob);
            arrayBuffer = await res.arrayBuffer();
          }
        }

        if (!arrayBuffer) {
          console.warn(`[FishWebCodecs:LoadFail] Empty array buffer for mediaId=${mediaId}`);
          return false;
        }

        return new Promise((resolve, reject) => {
          const streamInfo = {
            ready: false,
            width: 1920,
            height: 1080,
            duration: 0,
            resolveInit: resolve,
            rejectInit: reject
          };
          this.streams.set(mediaId, streamInfo);

          const id = ++this.requestId;
          this.worker.postMessage(
            { type: 'init', id: id, mediaId: mediaId, buffer: arrayBuffer },
            [arrayBuffer] // Transfer buffer to worker
          );
        });
      } catch (err) {
        console.warn('[VideoStreamManager] Failed loading media buffer:', err);
        return false;
      }
    }

    /**
     * Rapid seek request (non-blocking, returns cached or resolves via worker)
     */
    seekFrame(mediaId, timeSec) {
      if (!this.isSupported || !this.worker) return Promise.resolve(null);
      const stream = this.streams.get(mediaId);
      if (!stream || !stream.ready) return Promise.resolve(null);

      // Check cache first (0ms latency!)
      const cached = this._getFromCache(mediaId, timeSec);
      if (cached) {
        return Promise.resolve(cached);
      }

      // If worker is currently busy with a seek, queue this latest target time
      if (stream.isSeekingWorker) {
        stream.pendingSeekTime = timeSec;
        return new Promise((resolve) => {
          if (!stream.pendingResolves) stream.pendingResolves = [];
          stream.pendingResolves.push(resolve);
        });
      }

      stream.isSeekingWorker = true;
      const id = ++this.requestId;
      const startTime = performance.now();
      return new Promise((resolve) => {
        this.pendingRequests.set(id, { resolve, startTime });
        this.worker.postMessage({
          type: 'seek',
          id: id,
          mediaId: mediaId,
          timeSec: timeSec
        });
      });
    }

    hasStream(mediaId) {
      return this.streams.has(mediaId) && this.streams.get(mediaId).ready;
    }

    releaseMedia(mediaId) {
      if (this.worker) {
        this.worker.postMessage({ type: 'release', id: ++this.requestId, mediaId: mediaId });
      }
      this.streams.delete(mediaId);

      // Clean cache entries for this media
      for (const [k, v] of this.frameCache.entries()) {
        if (k.startsWith(`${mediaId}_`)) {
          if (v.bitmap && typeof v.bitmap.close === 'function') {
            v.bitmap.close();
          }
          this.frameCache.delete(k);
        }
      }
    }
  }

  window.VideoStreamManager = new VideoStreamManager();
})(window);
