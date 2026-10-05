/**
 * js/motion-blur-engine.js
 * Professional 1:1 After Effects Sub-Frame Multi-Sampling Motion Blur Engine
 * 
 * Features:
 * - Exact photographic sub-frame multi-sampling across shutter angle & shutter phase
 * - AE-accurate equal-weight averaging via running mean (incremental 1/(i+1) blend):
 *   buffer stays near full brightness so 8-bit rounding never shifts hues
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
      this._subDepth = 0;
      this._lastDirty = null;
    }

    /* ── Central quality policy (single definition for text / shatter / layer / 3D) ───────── */

    /**
     * @returns {{tier:'draft'|'mobile'|'preview'|'export', isExport:boolean, isDraft:boolean,
     *            isMobile:boolean, limit:number, maxSamples:number, spacing:number}}
     * limit = Settings > Motion Blur > Samples (AE "adaptive sample limit").
     */
    getQuality(compState = null) {
      const w = (typeof window !== 'undefined') ? window : {};
      const isExport = !!(w._isExportingVideo === true || w._isExportingSequence === true || w.isExporting === true);
      const draftBtn = (typeof document !== 'undefined' && document.getElementById)
        ? document.getElementById('editor-icon-low-quality') : null;
      const isDraft = !!(draftBtn && draftBtn.classList && draftBtn.classList.contains('is-active'));
      const isMobile = !!(typeof w.innerWidth === 'number' && (w.innerWidth <= 600 || ('ontouchstart' in w && w.innerWidth <= 900)));
      const limit = Math.max(2, this.getConfig(compState).samples || 16);

      let tier, cap, spacing;
      if (isExport)      { tier = 'export';  cap = limit;                    spacing = 1.0; }
      else if (isDraft)  { tier = 'draft';   cap = Math.min(limit, 6);       spacing = 3.0; }
      else if (isMobile) { tier = 'mobile';  cap = Math.min(limit, 8);       spacing = 2.5; }
      else               { tier = 'preview'; cap = Math.min(limit, 16);      spacing = 2.0; }
      return { tier, isExport, isDraft, isMobile, limit, maxSamples: cap, spacing };
    }

    /**
     * Sample count for a given screen travel (px). costFactor scales the cap for cheap
     * accumulators (text sprites ≈ 2) vs expensive ones (full GPU passes = 1).
     */
    adaptiveCount(travelPx, costFactor = 1, compState = null) {
      const q = this.getQuality(compState);
      const cap = Math.max(2, Math.round(q.maxSamples * costFactor));
      const minN = q.isExport ? Math.min(8, cap) : Math.min(3, cap);
      return Math.max(minN, Math.min(cap, Math.ceil((travelPx || 0) / q.spacing)));
    }

    /* ── Sub-sample guard: effects must NOT blur themselves while a layer-level pass is sampling ── */

    beginSubSample() { this._subDepth++; }
    endSubSample() { if (this._subDepth > 0) this._subDepth--; }
    isInSubSample() { return this._subDepth > 0; }

    /**
     * Should an effect/text engine accumulate its own shutter blur right now?
     * False inside a layer-level sample (the layer pass already averages those frames).
     */
    isEffectBlurActive(layer, compState = null, activeCamera = null) {
      return this._subDepth === 0 && this.isLayerActive(layer, compState, activeCamera);
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
     *      OR the containing precomp LAYER has its MB switch on (ForCompLayer mode),
     *      OR active camera has motion blur enabled and layer is a 3D layer in camera view.
     */
    isLayerActive(layer, compState = null, activeCamera = null) {
      if (!layer) return false;

      // Per-layer switch: layer.motionBlur is on
      const layerMbOn = !!layer.motionBlur;

      // Camera-level switch: if active camera has motion blur on, 3D visual content recorded by camera receives motion blur!
      const pool = (compState && Array.isArray(compState.layers) && compState.layers) || ((typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) ? window.currentProjectState.layers : null);
      const cam = activeCamera || (pool ? pool.find(l => l && l.type === 'camera' && !l.hidden) : null);
      const is3DLayer = !!(layer.is3D || (layer.type === 'camera') || (Array.isArray(layer.effects) && layer.effects.some(f => f && !f.disabled && (f.type === 'box_3d' || f.type === 'extrude_3d' || f.type === 'pyramid_3d' || f.type === 'sphere_3d'))));
      const cameraMbOn = !!(cam && cam.motionBlur && is3DLayer && layer.type !== 'audio');

      // ForCompLayer: propagate when compState is a precomp layer with motionBlur boolean
      const compMbOn = !!(compState &&
                          typeof compState.motionBlur === 'boolean' &&
                          compState.motionBlur);

      const anyExplicitOn = layerMbOn || cameraMbOn || compMbOn;
      if (!anyExplicitOn) return false;

      // Global master switch (More Settings > Motion Blur) overrides every per-layer,
      // camera and precomp switch: global OFF means no motion blur anywhere.
      const config = this.getConfig(compState);
      if (!config.enabled) return false;

      return true;
    }

    /**
     * Layers whose effects generate content sized to the layer bounds (e.g. particle engine).
     * They must use the sampled 2D render path: the WebGL quad path renders effects at the
     * source's natural size and would stretch/squash them.
     */
    needsSampledPath(layer) {
      if (!layer) return false;
      // Effects that handle their own GPU shutter accumulation (e.g. Shatter 3D FBO) must NOT use the 2D sampled path!
      if (Array.isArray(layer.effects)) {
        const hasSelfBlur = layer.effects.some(f => {
          if (!f || f.disabled) return false;
          if (f.type === 'shatter') return true;
          const d = this._effectDef(f);
          return !!(d && d.selfBlur);
        });
        if (hasSelfBlur) return false;
      }
      if (layer.type === 'text') return true;
      if (!Array.isArray(layer.effects)) return false;
      return layer.effects.some(f => {
        if (!f || f.disabled) return false;
        if (f.type === 'particle-engine') return true;
        if (f.type === 'deep-glow' && (f.outLayer === 1 || f.outLayer === true || f.outLayer === '1' || f.outLayer === 'true' || f.outLayer === 'on')) return true;
        const d = this._effectDef(f);
        return !!(d && (d.isExpanding || d.cameraDriven));
      });
    }

    /**
     * Text canvases carry animation padding. The normal compositor enlarges the quad by the
     * padding ratio so the texture maps 1:1; motion-blur sub-samples must do the same
     * or the padded canvas is squeezed into the unpadded text box (squash).
     */
    compensateTextPad(srcLayer, el, animLayer) {
      if (!srcLayer || srcLayer.type !== 'text' || !(srcLayer._textPadY > 0) || !el || !el.width || !el.height) return animLayer;
      if (animLayer && animLayer._textPadComp) return animLayer;
      const natW = srcLayer._textNaturalW || (el.width - 2 * srcLayer._textPadX);
      const natH = srcLayer._textNaturalH || (el.height - 2 * srcLayer._textPadY);
      return Object.assign({}, animLayer, {
        scaleW: animLayer.scaleW * (el.width / Math.max(1, natW)),
        scaleH: animLayer.scaleH * (el.height / Math.max(1, natH)),
        _textPadComp: true
      });
    }

    /**
     * Check if a layer has active procedural movement effects (shake, oscillate, swing, etc.)
     */
    hasMovementEffect(layer) {
      if (!layer || !Array.isArray(layer.effects)) return false;
      return layer.effects.some(f => {
        if (!f || f.disabled) return false;
        if (f.type === 'shake' || f.type === 'oscillate' || f.type === 'swing' || f.type === 'wave-warp' || f.type === 'transform') {
          if (f.type === 'shake') {
            const amp = f.amplitude !== undefined ? f.amplitude : (f.amp !== undefined ? f.amp : 1.0);
            const ampX = f.amplitudeX !== undefined ? f.amplitudeX : 25;
            const ampY = f.amplitudeY !== undefined ? f.amplitudeY : 25;
            const rot = f.rotation !== undefined ? f.rotation : 3;
            return amp > 0.001 && (ampX > 0.1 || ampY > 0.1 || rot > 0.1);
          }
          if (f.type === 'oscillate') {
            const amp = f.amplitude !== undefined ? f.amplitude : 50;
            return amp > 0.1;
          }
          if (f.type === 'swing') {
            const angle = f.swingAngle !== undefined ? f.swingAngle : 25;
            return angle > 0.1;
          }
          return true;
        }
        const def = (typeof window !== 'undefined' && window.FishEffectsRegistry && typeof window.FishEffectsRegistry.get === 'function')
          ? window.FishEffectsRegistry.get(f.type)
          : null;
        return def && def.category === 'movement';
      });
    }

    /**
     * Check if a text layer has active character-level animation during the shutter window.
     */
    hasTextMotion(layer, currentSec, config = null, fps = 60) {
      if (!layer || layer.type !== 'text') return false;
      const tp = layer.textProps;
      if (!tp) return false;

      const normIn = (typeof window !== 'undefined' && window.FishTextEngine && typeof window.FishTextEngine.normalizeAnimIn === 'function')
        ? window.FishTextEngine.normalizeAnimIn(tp.animIn || tp.animation)
        : (tp.animIn || tp.animation || 'bounce_1');
      const normOut = (typeof window !== 'undefined' && window.FishTextEngine && typeof window.FishTextEngine.normalizeAnimOut === 'function')
        ? window.FishTextEngine.normalizeAnimOut(tp.animOut)
        : (tp.animOut || 'none');

      const pps = (typeof window !== 'undefined' && window.currentPixelsPerSecond) || 80;
      const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);

      const cfg = config || this.getConfig();
      const frameDur = 1 / Math.max(1, fps);
      const exposureTime = (cfg.shutterAngle / 360) * frameDur;
      const tStart = currentSec - (exposureTime / 2) + (cfg.shutterPhase / 360) * frameDur;
      const tEnd = tStart + exposureTime;

      const localT0 = tStart - clipStart;
      const localT1 = tEnd - clipStart;

      // Layer not visible within this shutter window
      if (localT1 < 0 || localT0 > clipDur) return false;

      // Continuous kinetic motions are active throughout clip
      if (normIn === 'wave' || normIn === 'glitch' || normOut === 'wave' || normOut === 'glitch') {
        return true;
      }

      const inDur = Math.max(0.1, Number(tp.animInDuration || tp.animDuration) || 0.8);
      const outDur = Math.max(0.1, Number(tp.animOutDuration) || 0.6);
      const outStartSec = Math.max(inDur, clipDur - outDur);

      const aPosX = Number(tp.animPosX) || 0;
      const aPosY = Number(tp.animPosY) || 0;
      const aRot = Number(tp.animRotation) || 0;
      const aScl = tp.animScale !== undefined && tp.animScale !== '' ? Number(tp.animScale) : 100;
      const aOp = tp.animOpacity !== undefined && tp.animOpacity !== '' ? Number(tp.animOpacity) : 100;
      const hasAnimator = aPosX !== 0 || aPosY !== 0 || aRot !== 0 || aScl !== 100 || aOp !== 100;

      const inActive = (normIn !== 'none' || hasAnimator);
      if (inActive && localT0 < inDur && localT1 > 0) {
        return true;
      }

      const outActive = (normOut !== 'none' || hasAnimator);
      if (outActive && localT1 > outStartSec && localT0 < clipDur) {
        return true;
      }

      return false;
    }

    /**
     * Fast-path check: Did the layer actually move during the shutter exposure interval?
     * If static, multi-sampling is completely bypassed with zero performance overhead.
     * For collapsed precomp children (_precompParentLayer), also checks parent motion.
     */
    hasMotion(layer, currentSec, config = null, fps = 60, layerList = null, cameraLayer = null) {
      if (!layer) return false;
      const cfg = config || this.getConfig();

      const frameDur = 1 / Math.max(1, fps);
      const exposureTime = (cfg.shutterAngle / 360) * frameDur;
      if (exposureTime <= 0.0001) return false;

      const tStart = currentSec - (exposureTime / 2) + (cfg.shutterPhase / 360) * frameDur;
      const tEnd = tStart + exposureTime;

      // For collapsed precomp children: check both child keyframes AND parent layer keyframes
      const parentLayer = layer._precompParentLayer || null;
      const childOrig = layer._childOrigLayer || null;

      // Check child's own keyframes (using original child layer if available)
      const checkLayer = childOrig || layer;

      // Check if layer or parent has active procedural movement effects (shake, oscillate, swing, etc.)
      if (this.hasMovementEffect(checkLayer) || (parentLayer && this.hasMovementEffect(parentLayer))) {
        return true;
      }

      // Text glyph animation blur is rendered inside FishTextEngine (per-glyph shutter
      // accumulation). Only layer transform motion should trigger layer multi-sampling here.

      if (typeof window.getLayerEffectivePropsAtTime !== 'function') return false;

      const pool = layerList || (typeof window !== 'undefined' && window.currentProjectState && window.currentProjectState.layers) || null;
      const cam = cameraLayer || (pool && pool.find(l => l && l.type === 'camera' && !l.hidden)) || null;
      // A scene camera only moves layers that are 3D (or precomps collapsing into 3D space).
      // 2D layers are NOT transformed by the camera → camera motion must not trigger layer-level blur
      // for them. Effects that read the camera themselves (particles, star-burst) are the exception
      // (they re-project internally, so averaging whole frames is the right blur); effects flagged
      // `selfBlur` (shatter) accumulate their own shutter and are excluded to avoid double blur.
      const followsCameraFx = this.hasCameraDrivenEffect(checkLayer);
      const isAffectedByCamera = !layer.hidden && layer.type !== 'audio' && (
        layer.is3D || layer.type === 'camera' || followsCameraFx ||
        (layer.type === 'precomp' && !!layer.collapseTransformations) ||
        (Array.isArray(layer.effects) && layer.effects.some(f => f && !f.disabled && (f.type === 'box_3d' || f.type === 'extrude_3d' || f.type === 'pyramid_3d' || f.type === 'sphere_3d'))) ||
        !!layer._isCollapsedPrecompChild
      );

      if (isAffectedByCamera && cam) {
        const c0 = window.getLayerEffectivePropsAtTime(cam, tStart, null, pool);
        const c1 = window.getLayerEffectivePropsAtTime(cam, tEnd, null, pool);
        if (c0 && c1) {
          const cdx = Math.abs((c0.posX || 0) - (c1.posX || 0));
          const cdy = Math.abs((c0.posY || 0) - (c1.posY || 0));
          const cdz = Math.abs((c0.posZ || 0) - (c1.posZ || 0));
          const cdrX = Math.abs((c0.rotX || 0) - (c1.rotX || 0));
          const cdrY = Math.abs((c0.rotY || 0) - (c1.rotY || 0));
          const cdrZ = Math.abs((c0.rotZ !== undefined ? c0.rotZ : (c0.rotation || 0)) - (c1.rotZ !== undefined ? c1.rotZ : (c1.rotation || 0)));
          const cdLens = Math.abs((c0.cameraLens || 50) - (c1.cameraLens || 50));
          const cdZoom = Math.abs((c0.cameraZoom || 100) - (c1.cameraZoom || 100));
          const cdTgtX = Math.abs((c0.cameraTargetX !== undefined ? c0.cameraTargetX : (c0.targetX || 0)) - (c1.cameraTargetX !== undefined ? c1.cameraTargetX : (c1.targetX || 0)));
          const cdTgtY = Math.abs((c0.cameraTargetY !== undefined ? c0.cameraTargetY : (c0.targetY || 0)) - (c1.cameraTargetY !== undefined ? c1.cameraTargetY : (c1.targetY || 0)));
          const cdTgtZ = Math.abs((c0.cameraTargetZ !== undefined ? c0.cameraTargetZ : (c0.targetZ || 0)) - (c1.cameraTargetZ !== undefined ? c1.cameraTargetZ : (c1.targetZ || 0)));
          if (cdx > 0.04 || cdy > 0.04 || cdz > 0.04 || cdrX > 0.02 || cdrY > 0.02 || cdrZ > 0.02 || cdLens > 0.05 || cdZoom > 0.05 || cdTgtX > 0.04 || cdTgtY > 0.04 || cdTgtZ > 0.04) {
            return true; // Camera motion directly induces motion blur on 3D layer!
          }
        }
      }

      const hasKeyframes = checkLayer.keyframes && Object.keys(checkLayer.keyframes).length > 0;
      const parentHasKeyframes = parentLayer && parentLayer.keyframes && Object.keys(parentLayer.keyframes).length > 0;
      const hasNullParent = !layer._isCollapsedPrecompChild && !!(checkLayer.parentId);
      const hasExpressions = !!(checkLayer.expressions && Object.keys(checkLayer.expressions).length > 0);

      if (!hasKeyframes && !parentHasKeyframes && !hasNullParent && !hasExpressions && !this.hasMovementEffect(checkLayer)) return false;

      const epsPos = 0.04;
      const epsRot = 0.02;
      const epsScale = 0.001;

      // For collapsed precomp children: compare world positions at tStart vs tEnd
      // We need to re-compute world transforms using the parent+child combo
      if (layer._isCollapsedPrecompChild && parentLayer && childOrig) {
        const worldAt = (t) => this._computeCollapsedChildWorldPos(parentLayer, childOrig, t, layerList);
        const w0 = worldAt(tStart);
        const w1 = worldAt(tEnd);
        if (!w0 || !w1) return false;
        return (
          Math.abs(w0.posX - w1.posX) > epsPos ||
          Math.abs(w0.posY - w1.posY) > epsPos ||
          Math.abs(w0.posZ - w1.posZ) > epsPos ||
          Math.abs(w0.scaleW - w1.scaleW) > epsScale ||
          Math.abs(w0.scaleH - w1.scaleH) > epsScale ||
          Math.abs(w0.rotZ - w1.rotZ) > epsRot
        );
      }

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

      function def(v1, v2, v3) {
        if (v1 !== undefined && v1 !== null) return v1;
        if (v2 !== undefined && v2 !== null) return v2;
        return v3 !== undefined ? v3 : 0;
      }

      // posX/posY: getLayerEffectivePropsAtTime always sets these in baseProps,
      // so if p0.posX === undefined the layer truly has no position data — use layer fallback
      const x0 = p0.posX !== undefined ? p0.posX : (layer.posX !== undefined ? layer.posX : 0);
      const x1 = p1.posX !== undefined ? p1.posX : (layer.posX !== undefined ? layer.posX : 0);
      const y0 = p0.posY !== undefined ? p0.posY : (layer.posY !== undefined ? layer.posY : 0);
      const y1 = p1.posY !== undefined ? p1.posY : (layer.posY !== undefined ? layer.posY : 0);

      const dx  = Math.abs(x0 - x1);
      const dy  = Math.abs(y0 - y1);
      const dz  = Math.abs(def(p0.posZ, layer.posZ, 0) - def(p1.posZ, layer.posZ, 0));
      const dsX = Math.abs(def(p0.scaleW, layer.scaleW, 1) - def(p1.scaleW, layer.scaleW, 1));
      const dsY = Math.abs(def(p0.scaleH, layer.scaleH, 1) - def(p1.scaleH, layer.scaleH, 1));

      // Shortest-path angular diffs (avoids 340° reading for a 20° wrap-around move)
      const r0Z = def(p0.rotZ, layer.rotZ, def(layer.rotation, 0));
      const r1Z = def(p1.rotZ, layer.rotZ, def(layer.rotation, 0));
      const r0X = def(p0.rotX, layer.rotX, 0);
      const r1X = def(p1.rotX, layer.rotX, 0);
      const r0Y = def(p0.rotY, layer.rotY, 0);
      const r1Y = def(p1.rotY, layer.rotY, 0);

      const drZ  = angDiff(r0Z, r1Z);
      const drX  = angDiff(r0X, r1X);
      const drY  = angDiff(r0Y, r1Y);

      // Pole-crossing check for X/Y rotation: cos(90°) = 0 means the layer
      // visually collapses then re-expands — guarantee blur is applied even
      // when the shutter window straddles the pole with a small angular delta.
      const drYpole = (drY > 0.001 && crossesPole(r0Y, r1Y)) ? 999 : drY;
      const drXpole = (drX > 0.001 && crossesPole(r0X, r1X)) ? 999 : drX;

      const dskX = Math.abs(def(p0.skewX, layer.skewX, 0) - def(p1.skewX, layer.skewX, 0));
      const dskY = Math.abs(def(p0.skewY, layer.skewY, 0) - def(p1.skewY, layer.skewY, 0));
      const dax  = Math.abs(def(p0.anchorX, layer.anchorX, 0) - def(p1.anchorX, layer.anchorX, 0));
      const day  = Math.abs(def(p0.anchorY, layer.anchorY, 0) - def(p1.anchorY, layer.anchorY, 0));

      return (dx > epsPos || dy > epsPos || dz > epsPos || dsX > epsScale || dsY > epsScale ||
              drZ > epsRot || drXpole > epsRot || drYpole > epsRot || dskX > epsRot || dskY > epsRot ||
              dax > epsPos || day > epsPos);
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

    /* ── Effect hooks (defined by effect modules, read here — single place) ─────────────────
     *   def.cameraDriven : effect re-projects with the scene camera itself (particles, star-burst)
     *   def.selfBlur     : effect accumulates its own shutter when run top-level (shatter)
     *   def.motionTravel(layer, fx, info) → screen px the effect's content moves across the shutter
     *        info = { t0, t1, exposure, bufferScale, camTravelPx, size }
     */
    _effectDef(fx) {
      const reg = (typeof window !== 'undefined') ? window.FishEffectsRegistry : null;
      return (reg && typeof reg.get === 'function' && fx) ? reg.get(fx.type) : null;
    }

    hasCameraDrivenEffect(layer) {
      if (!layer || !Array.isArray(layer.effects)) return false;
      return layer.effects.some(fx => {
        if (!fx || fx.disabled) return false;
        const d = this._effectDef(fx);
        return !!(d && d.cameraDriven && !d.selfBlur && fx.useCamera !== 0 && fx.useCamera !== false);
      });
    }

    /** Screen-px travel of the scene camera across the shutter (pos + rot + zoom, perspective headroom ×1.5). */
    _cameraTravelPx(camLayer, t0, t1, bufferScale, sizePx) {
      const getEff = (typeof window !== 'undefined') ? window.getLayerEffectivePropsAtTime : null;
      if (!camLayer || typeof getEff !== 'function') return 0;
      const c0 = getEff(camLayer, t0), c1 = getEff(camLayer, t1);
      if (!c0 || !c1) return 0;
      const rz = (c) => (c.rotZ !== undefined ? c.rotZ : (c.rotation || 0));
      const pos = Math.hypot((c1.posX || 0) - (c0.posX || 0), (c1.posY || 0) - (c0.posY || 0)) * bufferScale;
      const dz = Math.abs((c1.posZ || 0) - (c0.posZ || 0)) * bufferScale * 0.5;
      const rad = (Math.abs((c1.rotX || 0) - (c0.rotX || 0)) + Math.abs((c1.rotY || 0) - (c0.rotY || 0)) + Math.abs(rz(c1) - rz(c0))) * Math.PI / 180;
      const zoom = Math.abs(((c1.cameraZoom || 100) - (c0.cameraZoom || 100)) / 100) * sizePx * 0.5
                 + Math.abs(((c1.cameraLens || 50) - (c0.cameraLens || 50)) / 50) * sizePx * 0.5;
      return (pos + dz + rad * sizePx * 0.8 + zoom) * 1.5;
    }

    /** Max travel (px) over this layer's effects that declare motionTravel / cameraDriven. */
    _effectTravelPx(layer, bufferScale, camLayer, t0, exposure) {
      if (!layer || !Array.isArray(layer.effects)) return { travel: 0, hasFxMotion: false };
      let travel = 0, hasFxMotion = false, camPx = null;
      const t1 = t0 + exposure;
      const size = Math.max(Math.abs(layer.scaleW || 0), Math.abs(layer.scaleH || 0), 500) * bufferScale;
      for (const fx of layer.effects) {
        if (!fx || fx.disabled) continue;
        const d = this._effectDef(fx);
        if (!d) continue;
        const follows = d.cameraDriven && fx.useCamera !== 0 && fx.useCamera !== false;
        if (!follows && typeof d.motionTravel !== 'function') continue;
        if (camPx === null) camPx = this._cameraTravelPx(camLayer, t0, t1, bufferScale, size);
        let tr = follows ? camPx : 0;
        if (typeof d.motionTravel === 'function') {
          try { tr = Math.max(tr, Number(d.motionTravel(layer, fx, { t0, t1, exposure, bufferScale, camTravelPx: follows ? camPx : 0, size })) || 0); } catch (_) {}
        }
        if (tr > 0.5) hasFxMotion = true;
        if (tr > travel) travel = tr;
      }
      return { travel, hasFxMotion };
    }

    /**
     * AE-style adaptive sample plan (central).
     * N from projected corner travel + effect travel, bounded by getQuality() (draft/mobile/preview/export).
     * Also returns the union screen rect the layer sweeps (null = unknown/large → full canvas).
     */
    planSamples(layer, bufferScale, camera, tStart, exposureTime, compState = null) {
      const q = this.getQuality(compState);
      const maxN = q.maxSamples;
      const minN = q.isExport ? Math.min(8, maxN) : Math.min(3, maxN);
      const spacing = q.spacing;

      const engine = window.FishToolEngine || window.LayerTransform;
      const getEff = window.getLayerEffectivePropsAtTime;
      const pool = (compState && Array.isArray(compState.layers) && compState.layers)
        || ((typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) ? window.currentProjectState.layers : null);
      const camLayer = (camera && camera._rawCamera)
        || (camera && camera.type === 'camera' ? camera : null)
        || (pool ? pool.find(l => l && l.type === 'camera' && !l.hidden) : null)
        || null;
      const fxInfo = this._effectTravelPx(layer, bufferScale, camLayer, tStart, exposureTime);

      if (!engine || typeof engine.getBounds !== 'function' || typeof getEff !== 'function' || layer._isCollapsedPrecompChild) {
        const cfg = this.getConfig(compState);
        const fixedN = Math.max(2, cfg.samples || 16);
        return { n: Math.max(minN, Math.min(64, maxN, fixedN)), rect: null, travel: fxInfo.travel };
      }

      let travel = 0;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let prev = null;
      const probes = 2; // start / mid / end are enough: keyframe motion is smooth inside one shutter
      try {
        for (let i = 0; i <= probes; i++) {
          const t = tStart + (i / probes) * exposureTime;
          const eff = getEff(layer, t, null, pool);
          const al = Object.assign({}, layer, eff);
          if (layer.type === 'text' && typeof this.compensateTextPad === 'function' && layer._textBufferCanvas) {
            Object.assign(al, this.compensateTextPad(layer, layer._textBufferCanvas, al));
          }
          const cam = camLayer ? getEff(camLayer, t, null, pool) : camera;
          const b = engine.getBounds(al, bufferScale, cam);
          if (!b) continue;
          const pts = Array.isArray(b.corners) && b.corners.length ? b.corners : [{ x: b.x, y: b.y }, { x: b.x + b.aabbW, y: b.y + b.aabbH }];
          if (prev && prev.length === pts.length) {
            let segMax = 0;
            for (let k = 0; k < pts.length; k++) {
              const d = Math.hypot((pts[k].x || 0) - (prev[k].x || 0), (pts[k].y || 0) - (prev[k].y || 0));
              if (d > segMax) segMax = d;
            }
            travel += segMax;
          }
          prev = pts;
          minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.aabbW); maxY = Math.max(maxY, b.y + b.aabbH);
        }
      } catch (_) {
        return { n: maxN, rect: null, travel };
      }

      const cfg = this.getConfig(compState);
      const fixedN = Math.max(2, cfg.samples || 16);

      // Adaptive sampling: 1 sample per `spacing` physical pixels of travel to prevent
      // discrete ghosting. `spacing` comes from the quality tier (draft/mobile/preview/export).
      const adaptiveN = travel > 0 ? Math.ceil(travel / (spacing * (bufferScale || 1))) : fixedN;

      // User Samples setting is the baseline; adaptive grows past it on long trails.
      // Clamped by the quality-tier cap (draft/mobile/preview/export) and hard max 64.
      const n = Math.max(minN, Math.min(64, maxN, Math.max(fixedN, adaptiveN)));

      let rect = null;
      if (isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY)) {
        const pad = Math.max(32 * (bufferScale || 1), 0.15 * Math.max(maxX - minX, maxY - minY));
        const rx = Math.max(0, Math.floor(minX - pad));
        const ry = Math.max(0, Math.floor(minY - pad));
        const rw = Math.ceil(maxX + pad) - rx;
        const rh = Math.ceil(maxY + pad) - ry;
        rect = { x: rx, y: ry, w: Math.max(1, rw), h: Math.max(1, rh) };
      }
      return { n, rect, travel, minX, minY, maxX, maxY };
    }

    /**
     * Render layer with multi-sampled sub-frame accumulation (AE-accurate equal-weight averaging).
     * Effects inside a sample never blur themselves (guard) — the sample average IS the blur.
     */
    renderLayerWithMotionBlur(ctx, el, layer, bufferScale, camera, currentSec, renderSinglePassFn, compState = null) {
      if (!ctx || !el || !layer || typeof renderSinglePassFn !== 'function') return;

      const shutter = this.getShutter(compState, currentSec);
      const exposureTime = shutter.exposureTime;
      const tStart = shutter.tStart;

      const targetW = ctx.canvas.width;
      const targetH = ctx.canvas.height;
      if (targetW <= 0 || targetH <= 0) return;

      const plan = this.planSamples(layer, bufferScale, camera, tStart, exposureTime, compState);
      const samples = plan.n;

      // Dirty rect: disabled due to coordinate space mismatch with viewport transform
      let rx = 0, ry = 0, rw = targetW, rh = targetH;

      if (!this._accumCanvas) this._accumCanvas = document.createElement('canvas');
      if (this._accumCanvas.width !== targetW || this._accumCanvas.height !== targetH) {
        this._accumCanvas.width = targetW;
        this._accumCanvas.height = targetH;
      }
      if (!this._sampleCanvas) this._sampleCanvas = document.createElement('canvas');
      if (this._sampleCanvas.width !== targetW || this._sampleCanvas.height !== targetH) {
        this._sampleCanvas.width = targetW;
        this._sampleCanvas.height = targetH;
      }
      const actx = this._accumCanvas.getContext('2d');
      const sctx = this._sampleCanvas.getContext('2d');
      if (!actx || !sctx) return;

      // Both buffers are only ever drawn inside the dirty rect (sample pass is clipped to it), so
      // clearing that rect fully resets them — no full-canvas clears, no ghost pixels.
      actx.setTransform(1, 0, 0, 1, 0, 0);
      actx.globalCompositeOperation = 'source-over';
      actx.globalAlpha = 1;
      actx.clearRect(rx, ry, rw, rh);
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalCompositeOperation = 'source-over';
      sctx.globalAlpha = 1;

      // AE-Accurate Motion Blur Accumulation — running mean (incremental average).
      // Sample 0 is copied at full strength; sample i>0 blends at weight 1/(i+1)
      // over the previous mean via two steps: 'destination-in' scales the old mean
      // by i/(i+1), then 'lighter' adds the new sample at 1/(i+1). The two-step form
      // matters: transparent sample pixels must DILUTE the mean (sparse coverage),
      // but a plain source-over treats transparent src as no-op — that biased early
      // samples and left one-sided trails (blur only on the leading edge). Buffer
      // stays near full brightness, so no 8-bit hue shift like fixed 1/N sums.
      actx.globalCompositeOperation = 'source-over';
      actx.globalAlpha = 1;

      const camLayer = (camera && camera.type === 'camera')
        ? camera
        : (camera && camera._rawCamera ? camera._rawCamera : null);

      this.beginSubSample();
      try {
        for (let i = 0; i < samples; i++) {
          const subSec = tStart + ((i + 0.5) / samples) * exposureTime;

          const subCamera = (camLayer && typeof window.getLayerEffectivePropsAtTime === 'function')
            ? window.getLayerEffectivePropsAtTime(camLayer, subSec)
            : camera;

          sctx.clearRect(rx, ry, rw, rh);
          sctx.save();
          sctx.beginPath();
          sctx.rect(rx, ry, rw, rh);
          sctx.clip();
          try {
            renderSinglePassFn(sctx, el, layer, bufferScale, subCamera, subSec);
          } finally {
            sctx.restore();
          }
          actx.globalAlpha = 1;
          if (i === 0) {
            actx.globalCompositeOperation = 'source-over';
            actx.drawImage(this._sampleCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
          } else {
            const w = 1 / (i + 1);
            actx.globalCompositeOperation = 'destination-in';
            actx.globalAlpha = 1 - w;
            actx.fillStyle = '#000';
            actx.fillRect(rx, ry, rw, rh);
            actx.globalCompositeOperation = 'lighter';
            actx.globalAlpha = w;
            actx.drawImage(this._sampleCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
            actx.globalAlpha = 1;
          }
        }
      } finally {
        this.endSubSample();
      }

      // Reset composite mode before drawing result to destination
      actx.globalAlpha = 1;
      actx.globalCompositeOperation = 'source-over';

      // Draw accumulated motion blur result onto destination canvas
      ctx.drawImage(this._accumCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
    }

    /**
     * Single Source of Truth for shutter calculations across all systems (3D engine, Shatter, Text, etc.)
     */
    getShutter(compState = null, currentSec = 0) {
      const config = this.getConfig(compState);
      const fps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
      const frameDur = 1 / Math.max(1, fps);
      const exposureTime = (config.shutterAngle / 360) * frameDur;
      const tStart = currentSec - (exposureTime / 2) + (config.shutterPhase / 360) * frameDur;
      return {
        config,
        fps,
        frameDur,
        exposureTime,
        tStart,
        shutterAngle: config.shutterAngle,
        shutterPhase: config.shutterPhase,
        samples: config.samples
      };
    }

    getSampleTimes(tStart, exposureTime, samples) {
      const times = [];
      const n = Math.max(1, samples);
      for (let i = 0; i < n; i++) {
        times.push(tStart + ((i + 0.5) / n) * exposureTime);
      }
      return times;
    }
  }

  window.FishMotionBlurEngine = new FishMotionBlurEngine();
})(window);
