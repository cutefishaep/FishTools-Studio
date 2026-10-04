/**
 * OpenFishTools Studio — Canvas Overlay Engine
 * Draws UI overlays (grid, wireframe, motion path, snap guides)
 * onto a dedicated transparent overlay canvas layered ABOVE the main render canvas.
 * These overlays are NEVER cached, NEVER exported — pure UI feedback.
 */
(function() {
  'use strict';

  const CanvasOverlay = {
    _canvas: null,
    _ctx: null,
    _rafId: null,
    _dirty: false,

    /**
     * Initialize overlay canvas — call once after DOM ready.
     * overlayCanvas: the <canvas id="editor-overlay-canvas"> element
     */
    init(overlayCanvas) {
      if (!overlayCanvas) return;
      this._canvas = overlayCanvas;
      this._ctx = overlayCanvas.getContext('2d', { alpha: true });
      // Sync size to match main canvas physical size
      this.syncSize();
      window.addEventListener('resize', () => this.syncSize(), { passive: true });
    },

    _lastTheme: null,
    _cachedPrimary: null,
    _cachedBgCanvas: null,
    _dprScale: 1,

    _getThemeColors() {
      const curTheme = (document.documentElement && document.documentElement.getAttribute('data-theme')) || 'default';
      if (this._lastTheme !== curTheme || !this._cachedPrimary || !this._cachedBgCanvas) {
        this._lastTheme = curTheme;
        const style = getComputedStyle(document.documentElement);
        this._cachedPrimary = style.getPropertyValue('--color-primary').trim() || '#98ce7b';
        this._cachedBgCanvas = style.getPropertyValue('--bg-canvas').trim() || '#0d1109';
      }
      return { primary: this._cachedPrimary, bg: this._cachedBgCanvas };
    },

    syncSize() {
      if (!this._canvas) return;
      const main = document.getElementById('editor-active-canvas');
      if (!main) return;
      if (this._canvas.width !== main.width || this._canvas.height !== main.height || !this._dprScale) {
        this._canvas.width = main.width;
        this._canvas.height = main.height;
        const rect = this._canvas.getBoundingClientRect ? this._canvas.getBoundingClientRect() : null;
        this._dprScale = (rect && rect.width > 0) ? (this._canvas.width / rect.width) : (window.devicePixelRatio || 1);
      }
    },

    /** Request a redraw on next rAF — debounced */
    scheduleRedraw() {
      this._dirty = true;
      if (this._rafId) return;
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        if (this._dirty) {
          this._dirty = false;
          this.redraw();
        }
      });
    },

    /** Immediate synchronous clear of overlay elements (preserving grid if enabled) */
    clear() {
      if (!this._ctx || !this._canvas) return;
      this.syncSize();
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      this._drawGrid(this._ctx, this._canvas.width, this._canvas.height);
    },

    /** Immediate synchronous redraw */
    redraw() {
      if (!this._ctx || !this._canvas) return;
      this.syncSize();
      const ctx = this._ctx;
      const w = this._canvas.width;
      const h = this._canvas.height;
      if (!w || !h) return;

      ctx.clearRect(0, 0, w, h);

      this._drawGrid(ctx, w, h);
      this._drawWireframes(ctx, w, h);
      this._drawMotionPath(ctx, w, h);
      this._drawSnapGuides(ctx, w, h);
    },

    _drawGrid(ctx, w, h) {
      const gridBtn = document.getElementById('editor-icon-grid');
      if (!gridBtn || !gridBtn.classList.contains('is-active')) return;

      ctx.save();
      const cx = w / 2;
      const cy = h / 2;
      const baseLineWidth = Math.max(1, Math.round(w / 1200));
      const themePrimary = this._getThemeColors().primary;

      // Quarter grid lines
      ctx.lineWidth = baseLineWidth;
      ctx.strokeStyle = themePrimary;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.moveTo(w * 0.25, 0); ctx.lineTo(w * 0.25, h);
      ctx.moveTo(w * 0.75, 0); ctx.lineTo(w * 0.75, h);
      ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25);
      ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75);
      ctx.stroke();

      // Center axes
      ctx.lineWidth = Math.max(1.5, baseLineWidth * 1.6);
      ctx.strokeStyle = themePrimary;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
      ctx.moveTo(0, cy); ctx.lineTo(w, cy);
      ctx.stroke();

      // Center crosshair
      const crossSize = Math.max(12, Math.round(Math.min(w, h) * 0.035));
      ctx.lineWidth = Math.max(2, baseLineWidth * 2.2);
      ctx.strokeStyle = themePrimary;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(cx - crossSize, cy); ctx.lineTo(cx + crossSize, cy);
      ctx.moveTo(cx, cy - crossSize); ctx.lineTo(cx, cy + crossSize);
      ctx.stroke();

      ctx.restore();
    },

    _getProjectBaseDims(fallbackW, fallbackH) {
      const proj = window.currentProjectState || {};
      const aspect = proj.aspectRatio || '16:9';
      const res = proj.resolution || '1080p';
      let baseDims = window.getProjectDimensions(res, aspect);
      if (window.currentActivePrecomp) {
        const cw = Math.round(Math.abs(window.currentActivePrecomp.mediaWidth || window.currentActivePrecomp.scaleW || baseDims[0]));
        const ch = Math.round(Math.abs(window.currentActivePrecomp.mediaHeight || window.currentActivePrecomp.scaleH || baseDims[1]));
        baseDims = [cw, ch];
      }
      const baseW = proj._baseW || proj.width || baseDims[0] || fallbackW;
      const baseH = proj._baseH || proj.height || baseDims[1] || fallbackH;
      return { baseW, baseH };
    },

    _drawSnapGuides(ctx, w, h) {
      if (!window.activeSnapGuides) return;
      const { baseW, baseH } = this._getProjectBaseDims(w, h);
      const themePrimary = this._getThemeColors().primary;

      ctx.save();
      ctx.strokeStyle = themePrimary;
      ctx.setLineDash([8, 4]);
      ctx.lineWidth = 1;

      if (window.activeSnapGuides.x != null) {
        const gx = window.activeSnapGuides.x * (w / baseW);
        ctx.beginPath();
        ctx.moveTo(gx, 0); ctx.lineTo(gx, h);
        ctx.stroke();
      }
      if (window.activeSnapGuides.y != null) {
        const gy = window.activeSnapGuides.y * (h / baseH);
        ctx.beginPath();
        ctx.moveTo(0, gy); ctx.lineTo(w, gy);
        ctx.stroke();
      }
      ctx.restore();
    },

    _drawMotionPath(ctx, w, h) {
      if (window.activeKeyframeProperty !== 'move') return;
      if (!(typeof window.isPropertyEditorActive === 'function' && window.isPropertyEditorActive())) return;
      const state = window.currentProjectState;
      if (!state) return;
      const selectedLayer = (state.layers || []).find(l => l.id === window.selectedLayerId);
      if (!selectedLayer || !selectedLayer.keyframes || !selectedLayer.keyframes.move || selectedLayer.keyframes.move.length < 2) return;
      if (!window.CanvasWireframe || typeof window.CanvasWireframe.drawMotionPath !== 'function') return;

      const colors = this._getThemeColors();
      const { baseW, baseH } = this._getProjectBaseDims(w, h);
      const bufferScale = (window._lastBufferScale) || (w / (baseW || 1920));
      const fps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
      const currentSec = (typeof window.getCurrentPlayheadTime === 'function') ? window.getCurrentPlayheadTime() : 0;

      window.CanvasWireframe.drawMotionPath(ctx, selectedLayer, {
        bufferScale,
        baseW,
        baseH,
        fps,
        currentSec,
        color: colors.primary,
        bgColor: colors.bg,
        dprScale: this._dprScale || 1
      });
    },

    _drawWireframes(ctx, w, h) {
      if (!window.CanvasWireframe) return;

      const allSelectedIds = (window.selectedLayerIds && window.selectedLayerIds.size > 0)
        ? Array.from(window.selectedLayerIds)
        : (window.selectedLayerId ? [window.selectedLayerId] : []);
      if (allSelectedIds.length === 0) return;

      const colors = this._getThemeColors();
      const dprScale = this._dprScale || 1;
      const isSelectionMode = allSelectedIds.length > 1;

      if (isSelectionMode) {
        const state = window.currentProjectState;
        allSelectedIds.forEach(id => {
          const l = (state && state.layers || []).find(layer => layer.id === id);
          if (!l || l.hidden || l.type === 'camera' || l.type === 'audio') return;
          const b = l._canvasBounds;
          if (b && (!b.isBehindCamera || (b.posZ || 0) < 950)) {
            window.CanvasWireframe.draw(ctx, b, {
              showAnchor: false,
              showHandles: false,
              isAnchorMode: false,
              color: colors.primary,
              bgColor: colors.bg,
              dprScale
            });
          }
        });
      } else {
        const state = window.currentProjectState;
        const selId = allSelectedIds[0];
        const selL = (state && state.layers || []).find(l => l.id === selId);
        if (selL && !selL.hidden && selL.type !== 'camera' && selL.type !== 'audio') {
          const b = selL._canvasBounds;
          if (b && (!b.isBehindCamera || (b.posZ || 0) < 950)) {
            const isAnchor = typeof window.isAnchorMode === 'function' ? window.isAnchorMode() : (window.moveAnchorSubmode === 'anchor');
            window.CanvasWireframe.draw(ctx, b, {
              showAnchor: true,
              showHandles: true,
              isAnchorMode: isAnchor,
              color: colors.primary,
              bgColor: colors.bg,
              dprScale
            });
          }
        }
      }
    }
  };

  window.CanvasOverlay = CanvasOverlay;
})();
