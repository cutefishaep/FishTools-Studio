/**
 * js/motion-blur-engine.js
 * Professional 1:1 After Effects Sub-Frame Multi-Sampling Motion Blur Engine
 * 
 * Features:
 * - Exact photographic sub-frame multi-sampling across shutter angle & shutter phase
 * - AE-accurate equal-weight averaging: each sample drawn at alpha 1/N into accumulation buffer
 * - Zero-overhead stationary layer bypass (detects static layers and falls back to 1 pass)
 * - Per-composition settings support (Root and Precomps can have unique Shutter Angle/Phase/Samples)
 * - Full support for 2D/3D Transforms, Scaling, Rotation, Anchor Point, Skew, Effects & Opacity
 * - ForCompLayer (precomp layer motionBlur switch) correctly propagates to child layers
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
     * Resolve effective motion blur configuration for a composition or project.
     * compState may be:
     *   - currentProjectState (has motionBlur: { enabled, shutterAngle, shutterPhase, samples })
     *   - currentActivePrecomp (same shape)
     *   - a precomp layer object (has motionBlur: true/false boolean)
     */
    getConfig(compState = null) {
      // --- Resolve the project-level MB config (always used for shutter params) ---
      const projectState = (typeof window !== 'undefined' && window.currentProjectState) || {};
      const projectMb = (projectState.motionBlur && typeof projectState.motionBlur === 'object')
        ? projectState.motionBlur
        : {};

      // --- Determine which state object holds the shutter params ---
      // If compState is a real composition state (has object motionBlur), use it for params.
      // If compState is a precomp *layer* (motionBlur is boolean), fall back to projectMb for params.
      let paramMb = projectMb;
      let globalEnabled = !!(projectMb.enabled);

      if (compState && typeof compState === 'object') {
        const mb = compState.motionBlur;
        if (mb && typeof mb === 'object') {
          // compState is a real composition state (precomp comp or project)
          globalEnabled = !!(mb.enabled);
          paramMb = mb;
        } else if (typeof mb === 'boolean') {
          // compState is a precomp *layer* whose .motionBlur is a per-layer switch boolean
          // Shutter params come from project level; enabled = project-level MB is on
          globalEnabled = !!(projectMb.enabled);
          paramMb = projectMb;
        }
      }

      return {
        enabled: globalEnabled,
        shutterAngle: (typeof paramMb.shutterAngle === 'number' && !isNaN(paramMb.shutterAngle)) ? paramMb.shutterAngle : 180,
        shutterPhase: (typeof paramMb.shutterPhase === 'number' && !isNaN(paramMb.shutterPhase)) ? paramMb.shutterPhase : 0,
        samples: (typeof paramMb.samples === 'number' && paramMb.samples >= 2) ? Math.min(64, Math.max(2, Math.round(paramMb.samples))) : 16
      };
    }

    /**
     * Check if motion blur should be rendered for this layer.
     * A layer is MB-active if:
     *   1. Global MB is enabled in the project/precomp composition state, AND
     *   2. The layer's own motionBlur toggle is on (layer.motionBlur === true),
     *      OR the containing precomp LAYER has its MB switch on (ForCompLayer mode —
     *      only applies when compState is a precomp layer with motionBlur as a boolean,
     *      NOT when compState is a composition/project settings object).
     */
    isLayerActive(layer, compState = null) {
      if (!layer) return false;
      const config = this.getConfig(compState);
      if (!config.enabled) return false;

      // Per-layer switch: layer.motionBlur must be on
      const layerMbOn = !!layer.motionBlur;

      // ForCompLayer: only propagate when compState is a precomp *layer* object
      // whose .motionBlur is a boolean true — NOT when it's the composition
      // settings object (which has motionBlur as an object {enabled, shutterAngle, ...}).
      // Without this guard, the project-level motionBlur object was always truthy,
      // bypassing the per-layer toggle entirely.
      const compMbOn = !!(compState &&
                          typeof compState.motionBlur === 'boolean' &&
                          compState.motionBlur);

      return layerMbOn || compMbOn;
    }

    /**
     * Fast-path check: Did the layer actually move during the shutter exposure interval?
     * If static, multi-sampling is completely bypassed with zero performance overhead.
     * For collapsed precomp children (_precompParentLayer), also checks parent motion.
     */
    hasMotion(layer, currentSec, config = null, fps = 60, layerList = null) {
      if (!layer) return false;
      const cfg = config || this.getConfig();

      const frameDur = 1 / Math.max(1, fps);
      const exposureTime = (cfg.shutterAngle / 360) * frameDur;
      if (exposureTime <= 0.0001) return false;

      const tStart = currentSec + (cfg.shutterPhase / 360) * frameDur;
      const tEnd = tStart + exposureTime;

      if (typeof window.getLayerEffectivePropsAtTime !== 'function') return false;

      // For collapsed precomp children: check both child keyframes AND parent layer keyframes
      const parentLayer = layer._precompParentLayer || null;
      const childOrig = layer._childOrigLayer || null;

      // Check child's own keyframes (using original child layer if available)
      const checkLayer = childOrig || layer;
      const hasKeyframes = checkLayer.keyframes && Object.keys(checkLayer.keyframes).length > 0;
      const parentHasKeyframes = parentLayer && parentLayer.keyframes && Object.keys(parentLayer.keyframes).length > 0;

      // Also check if layer is driven by a null parent chain (expressions, no keyframes on null)
      // getLayerEffectivePropsAtTime already resolves full parentId chain + expressions.
      // If no keyframes anywhere in the chain, compare effective world pos at tStart vs tEnd.
      const hasNullParent = !layer._isCollapsedPrecompChild && !!(checkLayer.parentId);

      if (!hasKeyframes && !parentHasKeyframes && !hasNullParent) return false;

      const eps = 0.001;

      // For collapsed precomp children: compare world positions at tStart vs tEnd
      // We need to re-compute world transforms using the parent+child combo
      if (layer._isCollapsedPrecompChild && parentLayer && childOrig) {
        const worldAt = (t) => this._computeCollapsedChildWorldPos(parentLayer, childOrig, t, layerList);
        const w0 = worldAt(tStart);
        const w1 = worldAt(tEnd);
        if (!w0 || !w1) return false;
        return (
          Math.abs(w0.posX - w1.posX) > eps ||
          Math.abs(w0.posY - w1.posY) > eps ||
          Math.abs(w0.posZ - w1.posZ) > eps ||
          Math.abs(w0.scaleW - w1.scaleW) > eps ||
          Math.abs(w0.scaleH - w1.scaleH) > eps ||
          Math.abs(w0.rotZ - w1.rotZ) > eps
        );
      }

      const pool = layerList || (typeof window !== 'undefined' && window.currentProjectState && window.currentProjectState.layers) || null;
      const p0 = window.getLayerEffectivePropsAtTime(checkLayer, tStart, null, pool);
      const p1 = window.getLayerEffectivePropsAtTime(checkLayer, tEnd, null, pool);
      if (!p0 || !p1) return false;

      // Helper: shortest angular path diff, normalized to [0, 180]
      const angDiff = (a, b) => {
        const d = ((b - a) % 360 + 540) % 360 - 180;
        return Math.abs(d);
      };

      // Helper: detect if a rotation range crosses a cosine pole (±90°, ±270°)
      // At these points cos(angle) passes through 0 — visual scale change is maximum.
      const crossesPole = (r0, r1) => {
        const lo = Math.min(r0, r1) % 360;
        const hi = Math.max(r0, r1) % 360;
        // Expand range to both normalised and offset-360 to handle wrap
        const inRange = (pole) => (lo <= pole && pole <= hi) || (lo + 360 <= pole + 360 && pole + 360 <= hi + 360);
        return inRange(90) || inRange(270) || inRange(-90) || inRange(-270);
      };

      // posX/posY: getLayerEffectivePropsAtTime always sets these in baseProps,
      // so if p0.posX === undefined the layer truly has no position data — use layer fallback
      const x0 = p0.posX !== undefined ? p0.posX : (layer.posX ?? 0);
      const x1 = p1.posX !== undefined ? p1.posX : (layer.posX ?? 0);
      const y0 = p0.posY !== undefined ? p0.posY : (layer.posY ?? 0);
      const y1 = p1.posY !== undefined ? p1.posY : (layer.posY ?? 0);

      const dx  = Math.abs(x0 - x1);
      const dy  = Math.abs(y0 - y1);
      const dz  = Math.abs((p0.posZ  ?? layer.posZ  ?? 0) - (p1.posZ  ?? layer.posZ  ?? 0));
      const dsX = Math.abs((p0.scaleW ?? layer.scaleW ?? 1) - (p1.scaleW ?? layer.scaleW ?? 1));
      const dsY = Math.abs((p0.scaleH ?? layer.scaleH ?? 1) - (p1.scaleH ?? layer.scaleH ?? 1));

      // Shortest-path angular diffs (avoids 340° reading for a 20° wrap-around move)
      const r0Z = p0.rotZ ?? layer.rotZ ?? layer.rotation ?? 0;
      const r1Z = p1.rotZ ?? layer.rotZ ?? layer.rotation ?? 0;
      const r0X = p0.rotX ?? layer.rotX ?? 0;
      const r1X = p1.rotX ?? layer.rotX ?? 0;
      const r0Y = p0.rotY ?? layer.rotY ?? 0;
      const r1Y = p1.rotY ?? layer.rotY ?? 0;

      const drZ  = angDiff(r0Z, r1Z);
      const drX  = angDiff(r0X, r1X);
      const drY  = angDiff(r0Y, r1Y);

      // Pole-crossing check for X/Y rotation: cos(90°) = 0 means the layer
      // visually collapses then re-expands — guarantee blur is applied even
      // when the shutter window straddles the pole with a small angular delta.
      const drYpole = (drY > 0.001 && crossesPole(r0Y, r1Y)) ? 999 : drY;
      const drXpole = (drX > 0.001 && crossesPole(r0X, r1X)) ? 999 : drX;

      const dskX = Math.abs((p0.skewX ?? layer.skewX ?? 0) - (p1.skewX ?? layer.skewX ?? 0));
      const dskY = Math.abs((p0.skewY ?? layer.skewY ?? 0) - (p1.skewY ?? layer.skewY ?? 0));
      const dax  = Math.abs((p0.anchorX ?? layer.anchorX ?? 0) - (p1.anchorX ?? layer.anchorX ?? 0));
      const day  = Math.abs((p0.anchorY ?? layer.anchorY ?? 0) - (p1.anchorY ?? layer.anchorY ?? 0));

      return (dx > eps || dy > eps || dz > eps || dsX > eps || dsY > eps ||
              drZ > eps || drXpole > eps || drYpole > eps || dskX > eps || dskY > eps ||
              dax > eps || day > eps);
    }

    /**
     * Compute world-space position/scale/rotation for a collapsed precomp child
     * at a given time t, by evaluating parent + child transforms together.
     */
    _computeCollapsedChildWorldPos(parentLayer, childLayer, t, layerList) {
      if (typeof window.getLayerEffectivePropsAtTime !== 'function') return null;

      const parentEff = window.getLayerEffectivePropsAtTime(parentLayer, t, null, layerList);
      const pps = window.currentPixelsPerSecond || 80;
      const clipStart = parentLayer.startSec !== undefined ? parentLayer.startSec : ((parentLayer.startPx || 0) / pps);
      const innerT = Math.max(0, (parentLayer.sourceOffsetSec || 0) + (t - clipStart) * (parentLayer.speed || 1.0));
      const childEff = window.getLayerEffectivePropsAtTime(childLayer, innerT, null, childLayer._parentLayers || null);
      if (!parentEff || !childEff) return null;

      const pw = Math.round(Math.abs(parentLayer.mediaWidth || parentLayer.scaleW || 1920));
      const ph = Math.round(Math.abs(parentLayer.mediaHeight || parentLayer.scaleH || 1080));

      const pRotX = parentEff.rotX || 0;
      const pRotY = parentEff.rotY || 0;
      const pRotZ = parentEff.rotZ !== undefined ? parentEff.rotZ : (parentEff.rotation || 0);
      const parentScaleW = parentEff.scaleW !== undefined ? parentEff.scaleW : pw;
      const parentScaleH = parentEff.scaleH !== undefined ? parentEff.scaleH : ph;
      const scaleRatioW = parentScaleW / (pw || 1920);
      const scaleRatioH = parentScaleH / (ph || 1080);
      const scaleRatioZ = (Math.abs(scaleRatioW) + Math.abs(scaleRatioH)) / 2;

      const pivotX = pw / 2 + (parentEff.anchorX || 0);
      const pivotY = ph / 2 + (parentEff.anchorY || 0);
      const pivotZ = parentEff.anchorZ || 0;

      const pWorldX = (parentEff.posX !== undefined ? parentEff.posX : 540) + (parentEff.anchorX || 0);
      const pWorldY = (parentEff.posY !== undefined ? parentEff.posY : 960) + (parentEff.anchorY || 0);
      const pWorldZ = (parentEff.posZ || 0) + (parentEff.anchorZ || 0);

      let vx = (childEff.posX !== undefined ? childEff.posX : pw / 2) - pivotX;
      let vy = (childEff.posY !== undefined ? childEff.posY : ph / 2) - pivotY;
      let vz = (childEff.posZ || 0) - pivotZ;

      vx *= scaleRatioW;
      vy *= scaleRatioH;
      vz *= scaleRatioZ;

      if (pRotX !== 0) {
        const rad = pRotX * Math.PI / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const ny = vy * c - vz * s, nz = vy * s + vz * c;
        vy = ny; vz = nz;
      }
      if (pRotY !== 0) {
        const rad = pRotY * Math.PI / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const nx = vx * c + vz * s, nz = -vx * s + vz * c;
        vx = nx; vz = nz;
      }
      if (pRotZ !== 0) {
        const rad = pRotZ * Math.PI / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const nx = vx * c - vy * s, ny = vx * s + vy * c;
        vx = nx; vy = ny;
      }

      const childBaseW = childEff.scaleW !== undefined ? childEff.scaleW : (childLayer.scaleW || 500);
      const childBaseH = childEff.scaleH !== undefined ? childEff.scaleH : (childLayer.scaleH || 500);

      const compRot = (typeof window.composeEulerRotations === 'function')
        ? window.composeEulerRotations(pRotX, pRotY, pRotZ, childEff.rotX || 0, childEff.rotY || 0, childEff.rotZ !== undefined ? childEff.rotZ : (childEff.rotation || 0))
        : { rotX: 0, rotY: 0, rotZ: pRotZ + (childEff.rotZ !== undefined ? childEff.rotZ : (childEff.rotation || 0)) };

      return {
        posX: pWorldX + vx,
        posY: pWorldY + vy,
        posZ: pWorldZ + vz,
        scaleW: childBaseW * scaleRatioW,
        scaleH: childBaseH * scaleRatioH,
        rotX: compRot.rotX,
        rotY: compRot.rotY,
        rotZ: compRot.rotZ
      };
    }

    /**
     * Render layer with multi-sampled sub-frame accumulation (AE-accurate equal-weight averaging)
     */
    renderLayerWithMotionBlur(ctx, el, layer, bufferScale, camera, currentSec, renderSinglePassFn, compState = null) {
      if (!ctx || !el || !layer || typeof renderSinglePassFn !== 'function') return;

      const config = this.getConfig(compState);
      const fps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
      const frameDur = 1 / Math.max(1, fps);
      const exposureTime = (config.shutterAngle / 360) * frameDur;
      const tStart = currentSec + (config.shutterPhase / 360) * frameDur;

      const isExport = (typeof window !== 'undefined' && (window._isExportingVideo === true || window._isExportingSequence === true));
      // Preview: 8 samples — sufficient for smooth cinematic look, 2x faster than 16
      const maxPreviewSamples = 8;
      const samples = isExport
        ? Math.max(2, config.samples || 16)
        : Math.min(maxPreviewSamples, Math.max(2, config.samples || 8));

      const targetW = ctx.canvas.width;
      const targetH = ctx.canvas.height;
      if (targetW <= 0 || targetH <= 0) return;

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

      // AE-Accurate Motion Blur Accumulation — Premultiplied Additive Equal-Weight:
      //
      // Each sample draws at a FIXED globalAlpha = 1/N using 'lighter' (additive) blend.
      //   lighter: dst_premult += src_premult * globalAlpha  (clamped to 1.0)
      //
      // Result: pixel covered by k of N samples → k/N final opacity.
      //   k=N (fully overlapping, opaque layer) → 1.0  ✓  (no clipping since k/N ≤ 1)
      //   k=1 (leading/trailing sparse ghost)   → 1/N  ✓  (correctly faint)
      //
      // This fixes the "sharp leading-edge ghost" bug from the old progressive source-over:
      //   old: sample_0 drawn at alpha=1.0 → sparse areas stayed FULL opacity forever.
      //   new: sparse areas get 1/N opacity, exactly matching AE behaviour.
      const sampleAlpha = 1 / samples;

      actx.globalAlpha = sampleAlpha;
      actx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < samples; i++) {
        const subSec = tStart + (i + 0.5) * (exposureTime / samples);

        sctx.clearRect(0, 0, targetW, targetH);
        renderSinglePassFn(sctx, el, layer, bufferScale, camera, subSec);

        actx.drawImage(this._sampleCanvas, 0, 0);
      }

      // Reset composite mode before drawing result to destination
      actx.globalAlpha = 1;
      actx.globalCompositeOperation = 'source-over';

      // Draw accumulated motion blur result onto destination canvas
      ctx.drawImage(this._accumCanvas, 0, 0);
    }
  }

  window.FishMotionBlurEngine = new FishMotionBlurEngine();
})(window);
