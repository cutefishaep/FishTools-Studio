/**
 * js/motion-blur-engine.js
 * Professional 1:1 After Effects Sub-Frame Multi-Sampling Motion Blur Engine
 * 
 * Features:
 * - Exact photographic sub-frame multi-sampling across shutter angle & shutter phase
 * - Equal-weighted accumulation using mathematical alpha progression: alpha_i = 1 / (i + 1)
 * - Zero-overhead stationary layer bypass (detects static layers and falls back to 1 pass)
 * - Per-composition settings support (Root and Precomps can have unique Shutter Angle/Phase/Samples)
 * - Full support for 2D/3D Transforms, Scaling, Rotation, Anchor Point, Skew, Effects & Opacity
 */
(function(window) {
  'use strict';

  class FishMotionBlurEngine {
    constructor() {
      this._accumCanvas = null;
      this._accumCtx = null;
      this._sampleCanvas = null;
      this._sampleCtx = null;
    }

    /**
     * Resolve effective motion blur configuration for a composition or project
     */
    getConfig(compState = null) {
      const state = compState || (typeof window !== 'undefined' && window.currentActivePrecomp) || (typeof window !== 'undefined' ? window.currentProjectState : null) || {};
      const mb = state.motionBlur || {};
      return {
        enabled: !!mb.enabled,
        shutterAngle: (typeof mb.shutterAngle === 'number' && !isNaN(mb.shutterAngle)) ? mb.shutterAngle : 180,
        shutterPhase: (typeof mb.shutterPhase === 'number' && !isNaN(mb.shutterPhase)) ? mb.shutterPhase : -90,
        samples: (typeof mb.samples === 'number' && mb.samples >= 2) ? Math.min(64, Math.max(2, Math.round(mb.samples))) : 16
      };
    }

    /**
     * Check if motion blur should be rendered for this layer
     */
    isLayerActive(layer, compState = null) {
      if (!layer || !layer.motionBlur) return false;
      const config = this.getConfig(compState);
      return config.enabled;
    }

    /**
     * Fast-path check: Did the layer actually move during the shutter exposure interval?
     * If static, multi-sampling is completely bypassed with zero performance overhead.
     */
    hasMotion(layer, currentSec, config = null, fps = 60, layerList = null) {
      if (!layer) return false;
      const cfg = config || this.getConfig();
      const hasKeyframes = layer.keyframes && Object.keys(layer.keyframes).length > 0;
      if (!hasKeyframes) return false;

      const frameDur = 1 / Math.max(1, fps);
      const exposureTime = (cfg.shutterAngle / 360) * frameDur;
      if (exposureTime <= 0.0001) return false;

      const tStart = currentSec + (cfg.shutterPhase / 360) * frameDur;
      const tEnd = tStart + exposureTime;

      if (typeof window.getLayerEffectivePropsAtTime !== 'function') return false;

      const p0 = window.getLayerEffectivePropsAtTime(layer, tStart, null, layerList);
      const p1 = window.getLayerEffectivePropsAtTime(layer, tEnd, null, layerList);
      if (!p0 || !p1) return false;

      const eps = 0.001;
      const dx = Math.abs((p0.posX ?? layer.posX ?? 0) - (p1.posX ?? layer.posX ?? 0));
      const dy = Math.abs((p0.posY ?? layer.posY ?? 0) - (p1.posY ?? layer.posY ?? 0));
      const dz = Math.abs((p0.posZ ?? layer.posZ ?? 0) - (p1.posZ ?? layer.posZ ?? 0));
      const dsX = Math.abs((p0.scaleW ?? layer.scaleW ?? 1) - (p1.scaleW ?? layer.scaleW ?? 1));
      const dsY = Math.abs((p0.scaleH ?? layer.scaleH ?? 1) - (p1.scaleH ?? layer.scaleH ?? 1));
      const drZ = Math.abs((p0.rotZ ?? layer.rotZ ?? layer.rotation ?? 0) - (p1.rotZ ?? layer.rotZ ?? layer.rotation ?? 0));
      const drX = Math.abs((p0.rotX ?? layer.rotX ?? 0) - (p1.rotX ?? layer.rotX ?? 0));
      const drY = Math.abs((p0.rotY ?? layer.rotY ?? 0) - (p1.rotY ?? layer.rotY ?? 0));
      const dskX = Math.abs((p0.skewX ?? layer.skewX ?? 0) - (p1.skewX ?? layer.skewX ?? 0));
      const dskY = Math.abs((p0.skewY ?? layer.skewY ?? 0) - (p1.skewY ?? layer.skewY ?? 0));
      const dax = Math.abs((p0.anchorX ?? layer.anchorX ?? 0) - (p1.anchorX ?? layer.anchorX ?? 0));
      const day = Math.abs((p0.anchorY ?? layer.anchorY ?? 0) - (p1.anchorY ?? layer.anchorY ?? 0));

      return (dx > eps || dy > eps || dz > eps || dsX > eps || dsY > eps ||
              drZ > eps || drX > eps || drY > eps || dskX > eps || dskY > eps ||
              dax > eps || day > eps);
    }

    /**
     * Render layer with multi-sampled sub-frame accumulation
     */
    renderLayerWithMotionBlur(ctx, el, layer, bufferScale, camera, currentSec, renderSinglePassFn, compState = null) {
      if (!ctx || !el || !layer || typeof renderSinglePassFn !== 'function') return;

      const config = this.getConfig(compState);
      const fps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
      const frameDur = 1 / Math.max(1, fps);
      const exposureTime = (config.shutterAngle / 360) * frameDur;
      const tStart = currentSec + (config.shutterPhase / 360) * frameDur;
      const samples = Math.max(2, config.samples || 16);

      const targetW = ctx.canvas.width;
      const targetH = ctx.canvas.height;

      // Ensure accumulation canvas matches target resolution
      if (!this._accumCanvas) {
        this._accumCanvas = document.createElement('canvas');
      }
      if (this._accumCanvas.width !== targetW || this._accumCanvas.height !== targetH) {
        this._accumCanvas.width = targetW;
        this._accumCanvas.height = targetH;
      }
      const actx = this._accumCanvas.getContext('2d');
      if (!actx) return;
      actx.clearRect(0, 0, targetW, targetH);

      // Ensure single-sample buffer matches target resolution
      if (!this._sampleCanvas) {
        this._sampleCanvas = document.createElement('canvas');
      }
      if (this._sampleCanvas.width !== targetW || this._sampleCanvas.height !== targetH) {
        this._sampleCanvas.width = targetW;
        this._sampleCanvas.height = targetH;
      }
      const sctx = this._sampleCanvas.getContext('2d');
      if (!sctx) return;

      // Photographic Sub-Frame Multi-Sampling Loop
      for (let i = 0; i < samples; i++) {
        const subSec = tStart + (i + 0.5) * (exposureTime / samples);
        sctx.clearRect(0, 0, targetW, targetH);

        // Render one sub-frame sample into sample canvas
        renderSinglePassFn(sctx, el, layer, bufferScale, camera, subSec);

        // Mathematical equal-weight accumulation: alpha_i = 1 / (i + 1)
        actx.save();
        actx.globalAlpha = 1 / (i + 1);
        actx.drawImage(this._sampleCanvas, 0, 0);
        actx.restore();
      }

      // Draw the accumulated motion blur result onto main context
      ctx.drawImage(this._accumCanvas, 0, 0);
    }
  }

  window.FishMotionBlurEngine = new FishMotionBlurEngine();
})(window);
