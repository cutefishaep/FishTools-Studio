/**
 * FISH-GPU.JS - WebGPU Hardware Acceleration Manager & Device Lifecycle
 * 
 * Provides unified WebGPU probing, device initialization, offscreen rendering,
 * texture pooling, device loss recovery, and seamless fallback to WebGL / Canvas2D.
 * 
 * Singleton: window.FishGPU
 */
(function(global) {
  'use strict';

  // Shared full-screen triangle vertex shader (WGSL)
  // Generates a screen-covering clip-space triangle with vertex index 0, 1, 2
  // Zero vertex buffer required!
  const WGSL_FULLSCREEN_VS = /* wgsl */ `
    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
    };

    @vertex
    fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
      var out: VertexOutput;
      let x = f32((vertex_index << 1u) & 2u) * 2.0 - 1.0;
      let y = f32(vertex_index & 2u) * -2.0 + 1.0;
      out.position = vec4<f32>(x, y, 0.0, 1.0);
      out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
      return out;
    }
  `;

  class FishGPUManager {
    constructor() {
      this.isSupported = false;
      this.isReady = false;
      this.activeBackend = 'wgl'; // 'wgpu' | 'wgl' | 'canvas2d'
      this.adapter = null;
      this.device = null;
      this.queue = null;
      this.canvasFormat = 'bgra8unorm';
      this.adapterInfo = null;
      this.fullscreenVS = WGSL_FULLSCREEN_VS;

      this._texturePool = new Map();
      this._samplers = new Map();
      this._pipelines = new Map();
      this._initPromise = null;
      this._offscreenCanvas = null;
      this._offscreenCtx = null;
    }

    /**
     * Probes WebGPU availability and initializes GPUDevice
     * @returns {Promise<boolean>} True if WebGPU is ready, false if fallen back to WebGL
     */
    async init() {
      if (this._initPromise) return this._initPromise;
      this._initPromise = this._doInit();
      return this._initPromise;
    }

    async _doInit() {
      // 1. Check user preference override (e.g. from debug settings or test flag)
      let forcedBackend = null;
      try {
        forcedBackend = localStorage.getItem('oft_gpu_backend_override');
      } catch (_) {}
      if (global.__FISH_FORCE_WEBGL || forcedBackend === 'wgl') {
        console.info('[FishGPU] WebGL forced by configuration flag. Active backend: wgl');
        this.activeBackend = 'wgl';
        this._updateUIBadge();
        return false;
      }

      // 2. Check browser API support
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        console.info('[FishGPU] navigator.gpu not supported by this browser. Active backend: wgl');
        this.activeBackend = 'wgl';
        this._updateUIBadge();
        return false;
      }

      try {
        // 3. Request high-performance adapter
        this.adapter = await navigator.gpu.requestAdapter({
          powerPreference: 'high-performance'
        });

        if (!this.adapter) {
          console.warn('[FishGPU] No compatible GPUAdapter returned. Falling back to WebGL.');
          this.activeBackend = 'wgl';
          this._updateUIBadge();
          return false;
        }

        // Cache adapter info if available
        try {
          if (typeof this.adapter.requestAdapterInfo === 'function') {
            this.adapterInfo = await this.adapter.requestAdapterInfo();
          } else if (this.adapter.info) {
            this.adapterInfo = this.adapter.info;
          }
        } catch (_) {}

        // 4. Request logical GPU device
        this.device = await this.adapter.requestDevice({
          requiredFeatures: [],
          requiredLimits: {}
        });

        if (!this.device) {
          console.warn('[FishGPU] GPU device request failed. Falling back to WebGL.');
          this.activeBackend = 'wgl';
          this._updateUIBadge();
          return false;
        }

        this.queue = this.device.queue;
        this.canvasFormat = navigator.gpu.getPreferredCanvasFormat
          ? navigator.gpu.getPreferredCanvasFormat()
          : 'bgra8unorm';

        this.isSupported = true;
        this.isReady = true;
        this.activeBackend = 'wgpu';

        // 5. Setup device loss handler
        if (this.device.lost) {
          this.device.lost.then(info => {
            console.error(`[FishGPU] GPUDevice lost (${info.reason}): ${info.message}. Falling back to WebGL.`);
            this._handleDeviceLoss();
          });
        }

        // 6. Setup uncaptured error handler
        this.device.addEventListener('uncapturederror', event => {
          console.error('[FishGPU] Uncaptured WebGPU error:', event.error);
        });

        const gpuName = (this.adapterInfo && (this.adapterInfo.description || this.adapterInfo.device)) || 'Hardware GPU';
        console.info(`[FishGPU] ⚡ WebGPU initialized successfully (${gpuName}). Preferred format: ${this.canvasFormat}`);

        this._updateUIBadge();
        this._dispatch('fishgpu:ready', { device: this.device, adapter: this.adapter, format: this.canvasFormat });
        return true;
      } catch (err) {
        console.warn('[FishGPU] WebGPU initialization error, falling back to WebGL:', err);
        this.activeBackend = 'wgl';
        this.isReady = false;
        this._updateUIBadge();
        return false;
      }
    }

    _handleDeviceLoss() {
      this.isReady = false;
      this.activeBackend = 'wgl';
      this.device = null;
      this.queue = null;
      this._texturePool.clear();
      this._pipelines.clear();
      this._samplers.clear();
      this._initPromise = null;

      this._updateUIBadge();
      this._dispatch('fishgpu:devicelost');

      // Schedule reconnection attempt after 2 seconds
      setTimeout(() => {
        console.info('[FishGPU] Attempting to re-initialize WebGPU device...');
        this.init();
      }, 2000);
    }

    _dispatch(eventName, detail = {}) {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
          window.dispatchEvent(new CustomEvent(eventName, { detail }));
        } catch (_) {}
      }
    }

    _updateUIBadge() {
      if (typeof document === 'undefined') return;
      const badge = document.getElementById('gpu-engine-badge');
      if (!badge) return;

      if (this.activeBackend === 'wgpu' && this.isReady) {
        badge.textContent = 'WebGPU';
        badge.dataset.backend = 'wgpu';
        const gpuName = (this.adapterInfo && (this.adapterInfo.description || this.adapterInfo.device)) || 'Hardware GPU';
        badge.setAttribute('title', `Hardware Accelerated: WebGPU active (${gpuName}) — Klik untuk switch ke WebGL2`);
        badge.classList.remove('is-wgl', 'is-canvas2d');
        badge.classList.add('is-wgpu');
      } else if (this.activeBackend === 'wgl') {
        badge.textContent = 'WebGL2';
        badge.dataset.backend = 'wgl';
        badge.setAttribute('title', 'Hardware Accelerated: WebGL2 fallback active — Klik untuk switch ke WebGPU');
        badge.classList.remove('is-wgpu', 'is-canvas2d');
        badge.classList.add('is-wgl');
      } else {
        badge.textContent = 'Canvas2D';
        badge.dataset.backend = 'canvas2d';
        badge.setAttribute('title', 'CPU Fallback: Canvas 2D active');
        badge.classList.remove('is-wgpu', 'is-wgl');
        badge.classList.add('is-canvas2d');
      }
    }

    /**
     * Get or create a pooled offscreen WebGPU canvas per effect tag
     * Prevents canvas resize thrashing and swapchain recreation between effects
     * @param {number} width
     * @param {number} height
     * @param {string} tag
     * @returns {{ canvas: HTMLCanvasElement, ctx: GPUCanvasContext }}
     */
    getOffscreenCanvas(width, height, tag = 'default') {
      const w = Math.max(1, Math.round(width || 320));
      const h = Math.max(1, Math.round(height || 180));

      if (!this._offscreenPool) {
        this._offscreenPool = new Map();
      }

      let entry = this._offscreenPool.get(tag);
      if (!entry) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('webgpu');
        if (ctx && this.device) {
          ctx.configure({
            device: this.device,
            format: this.canvasFormat,
            alphaMode: 'premultiplied'
          });
        }
        entry = { canvas: c, ctx: ctx };
        this._offscreenPool.set(tag, entry);
      } else {
        if (entry.canvas.width !== w || entry.canvas.height !== h) {
          entry.canvas.width = w;
          entry.canvas.height = h;
          if (entry.ctx && this.device) {
            entry.ctx.configure({
              device: this.device,
              format: this.canvasFormat,
              alphaMode: 'premultiplied'
            });
          }
        }
      }

      return entry;
    }

    /**
     * Upload an image, video, or canvas element to a GPUTexture at native resolution
     * Eliminates per-frame DOM allocations, guarantees no copySize bounds errors
     * @param {CanvasImageSource} source
     * @param {string} tag
     * @returns {{ texture: GPUTexture, width: number, height: number }|null}
     */
    uploadSourceToTexture(source, tag = 'src') {
      if (!this.device || !this.queue || !source) return null;
      const w = Math.max(1, Math.round(source.videoWidth || source.naturalWidth || source.width || 100));
      const h = Math.max(1, Math.round(source.videoHeight || source.naturalHeight || source.height || 100));

      const tex = this.getTexture(tag, w, h, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT);
      if (!tex) return null;

      try {
        this.queue.copyExternalImageToTexture(
          { source, flipY: false },
          { texture: tex },
          [w, h]
        );
        return { texture: tex, width: w, height: h };
      } catch (_) {
        if (!this._sharedScratchCanvas) {
          this._sharedScratchCanvas = document.createElement('canvas');
          this._sharedScratchCtx = this._sharedScratchCanvas.getContext('2d');
        }
        if (this._sharedScratchCanvas.width !== w || this._sharedScratchCanvas.height !== h) {
          this._sharedScratchCanvas.width = w;
          this._sharedScratchCanvas.height = h;
        }
        this._sharedScratchCtx.clearRect(0, 0, w, h);
        try {
          this._sharedScratchCtx.drawImage(source, 0, 0, w, h);
          this.queue.copyExternalImageToTexture(
            { source: this._sharedScratchCanvas, flipY: false },
            { texture: tex },
            [w, h]
          );
          return { texture: tex, width: w, height: h };
        } catch (err2) {
          return null;
        }
      }
    }

    /**
     * Gets a pooled 2D GPUTexture or creates a new one
     * @param {string} id Unique tag
     * @param {number} width
     * @param {number} height
     * @param {GPUTextureUsageFlags} usage
     * @param {GPUTextureFormat} format
     * @returns {GPUTexture|null}
     */
    getTexture(id, width, height, usage = null, format = null) {
      if (!this.device) return null;
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      const fmt = format || 'rgba8unorm';
      const u = usage || (GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC);
      const key = `${id}_${w}x${h}_${fmt}_${u}`;

      let tex = this._texturePool.get(key);
      if (!tex) {
        tex = this.device.createTexture({
          size: [w, h, 1],
          format: fmt,
          usage: u
        });
        this._texturePool.set(key, tex);
      }
      return tex;
    }

    /**
     * Copy an HTML canvas or image source to a GPUTexture
     * @param {CanvasImageSource} source Canvas, OffscreenCanvas, or ImageBitmap
     * @param {GPUTexture} targetTexture Destination GPUTexture
     */
    copyImageToTexture(source, targetTexture) {
      if (!this.device || !this.queue || !source || !targetTexture) return;
      try {
        this.queue.copyExternalImageToTexture(
          { source, flipY: false },
          { texture: targetTexture },
          [source.width, source.height]
        );
      } catch (err) {
        console.warn('[FishGPU] copyExternalImageToTexture failed:', err);
      }
    }

    /**
     * Get or create a cached GPUSampler
     * @param {string} key Unique name
     * @param {GPUSamplerDescriptor} descriptor
     * @returns {GPUSampler|null}
     */
    getSampler(key = 'linear_clamp', descriptor = null) {
      if (!this.device) return null;
      if (!this._samplers.has(key)) {
        const desc = descriptor || {
          magFilter: 'linear',
          minFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge'
        };
        this._samplers.set(key, this.device.createSampler(desc));
      }
      return this._samplers.get(key);
    }

    /**
     * Get or compile a cached GPURenderPipeline
     * @param {string} id
     * @param {Function} factory
     * @returns {GPURenderPipeline|null}
     */
    getPipeline(id, factory) {
      if (!this.device) return null;
      if (!this._pipelines.has(id)) {
        try {
          const pipe = factory(this.device, this);
          if (pipe) this._pipelines.set(id, pipe);
        } catch (e) {
          console.error(`[FishGPU] Error compiling pipeline "${id}":`, e);
          return null;
        }
      }
      return this._pipelines.get(id);
    }

    /**
     * Return status object for telemetry and UI
     */
    getStatus() {
      return {
        supported: this.isSupported,
        ready: this.isReady,
        backend: this.activeBackend,
        adapterInfo: this.adapterInfo
      };
    }

    _notifyUser(message, type = 'info') {
      if (typeof window !== 'undefined') {
        if (typeof window.showEffectsRackToast === 'function') {
          window.showEffectsRackToast(message);
          return;
        }
        if (typeof window.showDashboardToast === 'function') {
          window.showDashboardToast(message, 3500);
          return;
        }
      }
      console.info(`[FishGPU] ${message}`);
    }

    /**
     * Manually switch GPU backend
     * @param {'wgpu'|'wgl'} target
     */
    async setBackend(target) {
      if (target === 'wgpu') {
        try { localStorage.removeItem('oft_gpu_backend_override'); } catch (_) {}
        global.__FISH_FORCE_WEBGL = false;
        this._initPromise = null;
        const ok = await this.init();
        if (!ok || !this.isReady) {
          this.activeBackend = 'wgl';
          this.isReady = false;
          this._updateUIBadge();
          const reason = (typeof window !== 'undefined' && !window.isSecureContext)
            ? 'WebGPU butuh Secure Context (HTTPS / localhost)'
            : (typeof navigator !== 'undefined' && !navigator.gpu)
              ? 'navigator.gpu tidak didukung di browser ini'
              : 'Gagal inisialisasi GPUDevice';
          this._notifyUser(`⚠️ WebGPU tidak aktif (${reason}) — fallback ke WebGL2`, 'warning');
          return;
        }
        const gpuName = (this.adapterInfo && (this.adapterInfo.description || this.adapterInfo.device)) || 'Hardware GPU';
        this._notifyUser(`⚡ GPU Engine: WebGPU (${gpuName})`, 'success');
      } else {
        try { localStorage.setItem('oft_gpu_backend_override', 'wgl'); } catch (_) {}
        global.__FISH_FORCE_WEBGL = true;
        this.activeBackend = 'wgl';
        this.isReady = false;
        this._updateUIBadge();
        this._notifyUser('🔄 GPU Engine: WebGL2 (Fallback mode)', 'info');
      }

      // 1. Invalidate preview RAM cache and timeline ruler green bar
      if (typeof window !== 'undefined' && window.PreviewCacheManager) {
        try {
          if (typeof window.PreviewCacheManager.clearAll === 'function') {
            window.PreviewCacheManager.clearAll('all');
          }
          if (typeof window.PreviewCacheManager.updateRulerUI === 'function') {
            window.PreviewCacheManager.updateRulerUI();
          }
        } catch (_) {}
      }

      // 2. Clear effective properties cache & FrameExtractor cache
      if (typeof window !== 'undefined' && typeof window.invalidateEffectivePropsCache === 'function') {
        try { window.invalidateEffectivePropsCache(); } catch (_) {}
      }
      if (typeof window !== 'undefined' && window.FrameExtractor && typeof window.FrameExtractor.clearCache === 'function') {
        try { window.FrameExtractor.clearCache(); } catch (_) {}
      }

      // 3. Clear GPU texture pool to ensure fresh textures
      this._texturePool.clear();

      // 4. Force redraw
      if (typeof window !== 'undefined' && typeof window.redrawComposition === 'function') {
        window.redrawComposition('gpu-backend-change');
      }
    }
  }

  // Instantiate singleton
  const FishGPU = new FishGPUManager();
  global.FishGPU = FishGPU;

  // Auto-init as soon as DOM is ready or current execution completes
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        FishGPU.init();
      });
    } else {
      setTimeout(() => {
        FishGPU.init();
      }, 0);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
