/**
 * effects/fsmb.js
 * Fish Studio Motion Blur (FSMB) - Professional RSMB-Grade Motion Blur Plugin & Engine
 * 
 * Features:
 * - Multi-radius directional block-matching optical flow for video and precompositions
 * - Analytical transform keyframe velocity tracking (Position, Rotation, Scale, Anchor)
 * - Directional 16-sample 180° photographic shutter line blur with flat-top bell weighting
 * - Hardware-accelerated WebGL 2.0/1.0 pipeline with fail-safe Canvas2D fallback
 * - Full support for Video layers, Images, Shapes, Precomps, and Adjustment Layers
 * - 100% self-contained modular architecture
 *
 * Artifact fixes (v2):
 * - Edge-clamp → out-of-bounds samples fade to transparent (no border stretch artifacts)
 * - Flat-top bell curve: wider uniform centre prevents ghost frame dominance at t≈0
 * - rotVel uses shortest-path angular diff to avoid wrap-around velocity spikes
 * - Canvas2D fallback uses correct fixed-alpha lighter accumulation (no sharp leading ghosts)
 * - Optical flow noise gate tightened; blurFade onset softened
 */
(function(window) {
  'use strict';

  class FishSMBEngine {
    constructor() {
      this._glCanvas = null;
      this._gl = null;
      this._glProg = null;
      this._glUniforms = null;
      this._posBuf = null;
      this._uvBuf = null;
      this._currTex = null;
      this._prevTex = null;
      this._glFailed = false;

      // Layer temporal frame cache for optical flow tracking
      // Map<layerId, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, sec: number, width: number, height: number, valid: boolean }>
      this._layerFrameCache = new Map();

      // Canvas2D fallback offscreen buffers
      this._2dAccumCanvas = null;
      this._2dAccumCtx = null;
    }

    /**
     * Clear all cached previous frame buffers
     */
    clearCache() {
      this._layerFrameCache.clear();
    }

    /**
     * Invalidate frame cache for a specific layer
     */
    invalidateLayer(layerId) {
      if (layerId) {
        this._layerFrameCache.delete(String(layerId));
      }
    }

    /**
     * Initialize hardware WebGL pipeline
     */
    _initWebGL() {
      if (this._gl && this._glProg) return true;
      if (this._glFailed) return false;

      try {
        if (!this._glCanvas) {
          this._glCanvas = document.createElement('canvas');
          this._glCanvas.width = 1920;
          this._glCanvas.height = 1080;
        }

        const opts = {
          alpha: true,
          depth: false,
          stencil: false,
          antialias: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: false
        };

        const gl = this._glCanvas.getContext('webgl2', opts) ||
                   this._glCanvas.getContext('webgl', opts) ||
                   this._glCanvas.getContext('experimental-webgl', opts);

        if (!gl) {
          this._glFailed = true;
          return false;
        }
        this._gl = gl;

        const vsSource = [
          'attribute vec2 a_pos;',
          'attribute vec2 a_uv;',
          'varying vec2 v_uv;',
          'void main(void) {',
          '  v_uv = a_uv;',
          '  gl_Position = vec4(a_pos, 0.0, 1.0);',
          '}'
        ].join('\n');

        // Continuous 3-Tier Pyramidal Horn-Schunck / Benson Optical Flow + Transform Vector Blur
        const fsSource = [
          'precision highp float;',
          'varying vec2 v_uv;',
          '',
          'uniform sampler2D u_currentFrame;',
          'uniform sampler2D u_prevFrame;',
          '',
          'uniform float u_blurAmount;',       // Shutter multiplier (0.0 to 2.0+)
          'uniform vec2 u_transVel;',          // Normalized translation (dx, dy) in UV/frame
          'uniform float u_rotVel;',           // Angular velocity (radians/frame)
          'uniform float u_scaleVel;',         // Scale velocity (dScale/frame)
          'uniform vec2 u_anchor;',            // Normalized anchor in UV [0, 1]
          'uniform float u_aspect;',           // width / height
          'uniform vec2 u_texelSize;',         // (1/w, 1/h)
          'uniform float u_hasPrevFrame;',     // 1.0 if previous frame valid, 0.0 otherwise
          '',
          'float rgb2lum(vec3 c) {',
          '  return dot(c, vec3(0.299, 0.587, 0.114));',
          '}',
          '',
          '// 5-tap Gaussian cross-filter: strips high-frequency camera noise & compression artifacts',
          'float sampleSmoothLum(sampler2D tex, vec2 uv, vec2 step) {',
          '  float c  = rgb2lum(texture2D(tex, uv).rgb);',
          '  float l  = rgb2lum(texture2D(tex, uv - vec2(step.x, 0.0)).rgb);',
          '  float r  = rgb2lum(texture2D(tex, uv + vec2(step.x, 0.0)).rgb);',
          '  float u  = rgb2lum(texture2D(tex, uv + vec2(0.0, step.y)).rgb);',
          '  float d  = rgb2lum(texture2D(tex, uv - vec2(0.0, step.y)).rgb);',
          '  return c * 0.4 + (l + r + u + d) * 0.15;',
          '}',
          '',
          '// Sample with transparent out-of-bounds — prevents border-pixel stretch artifacts.',
          '// Pixels outside [0,1] UV contribute 0 (transparent) instead of clamped edge colour.',
          'vec4 sampleBounded(sampler2D tex, vec2 uv) {',
          '  vec2 margin = u_texelSize * 0.5;',
          '  if (uv.x < margin.x || uv.x > 1.0 - margin.x ||',
          '      uv.y < margin.y || uv.y > 1.0 - margin.y) {',
          '    return vec4(0.0);',
          '  }',
          '  return texture2D(tex, uv);',
          '}',
          '',
          '// Continuous Horn-Schunck / Benson Optical Flow Estimator at a given pixel radius',
          'vec2 computeFlowAtScale(vec2 uvCurr, vec2 uvPrev, float pxRadius, float lambda) {',,
          '  vec2 off = u_texelSize * pxRadius;',
          '  vec2 filterStep = u_texelSize * 1.5;',
          '',
          '  // Spatial gradient samples on current frame',
          '  float c_r = sampleSmoothLum(u_currentFrame, uvCurr + vec2(off.x, 0.0), filterStep);',
          '  float c_l = sampleSmoothLum(u_currentFrame, uvCurr - vec2(off.x, 0.0), filterStep);',
          '  float c_u = sampleSmoothLum(u_currentFrame, uvCurr + vec2(0.0, off.y), filterStep);',
          '  float c_d = sampleSmoothLum(u_currentFrame, uvCurr - vec2(0.0, off.y), filterStep);',
          '  float c_c = sampleSmoothLum(u_currentFrame, uvCurr, filterStep);',
          '',
          '  // Spatial gradient samples on previous frame',
          '  float p_r = sampleSmoothLum(u_prevFrame, uvPrev + vec2(off.x, 0.0), filterStep);',
          '  float p_l = sampleSmoothLum(u_prevFrame, uvPrev - vec2(off.x, 0.0), filterStep);',
          '  float p_u = sampleSmoothLum(u_prevFrame, uvPrev + vec2(0.0, off.y), filterStep);',
          '  float p_d = sampleSmoothLum(u_prevFrame, uvPrev - vec2(0.0, off.y), filterStep);',
          '  float p_c = sampleSmoothLum(u_prevFrame, uvPrev, filterStep);',
          '',
          '  // Spatial gradients (averaged over both frames for temporal symmetry)',
          '  float gradX = ((c_r - c_l) + (p_r - p_l)) * 0.5;',
          '  float gradY = ((c_u - c_d) + (p_u - p_d)) * 0.5;',
          '',
          '  // Temporal gradient',
          '  float gradT = c_c - p_c;',
          '',
          '  // Closed-form regularized Horn-Schunck velocity vector',
          '  float gradMagSq = gradX * gradX + gradY * gradY;',
          '  float denom = gradMagSq + lambda;',
          '',
          '  return - (gradT / denom) * vec2(gradX, gradY) * (off * 2.0);',
          '}',
          '',
          'void main(void) {',
          '  vec4 currCol = texture2D(u_currentFrame, v_uv);',
          '',
          '  // 1. Analytical Transform Motion Vector from Keyframes',
          '  vec2 rel = vec2((v_uv.x - u_anchor.x) * u_aspect, v_uv.y - u_anchor.y);',
          '  vec2 v_rot = vec2(-rel.y, rel.x / u_aspect) * u_rotVel;',
          '  vec2 v_scale = (v_uv - u_anchor) * u_scaleVel;',
          '  vec2 v_motion = u_transVel + v_rot + v_scale;',
          '',
          '  // 2. Video Optical Flow (3-Tier Pyramidal Coarse-to-Fine Tracking)',
          '  if (u_hasPrevFrame > 0.5) {',
          '    vec2 gateFilterStep = u_texelSize * 2.0;',
          '    float currCenterLum = sampleSmoothLum(u_currentFrame, v_uv, gateFilterStep);',
          '    float prevCenterLum = sampleSmoothLum(u_prevFrame, v_uv, gateFilterStep);',
          '    float tempDiff = abs(currCenterLum - prevCenterLum);',
          '',
          '    // Smooth noise gate: eliminates H.264 macroblock compression noise & camera grain.',
          '    // Raised lower bound (0.020 vs 0.015) reduces false-positive blur on still areas.',
          '    float motionGate = smoothstep(0.020, 0.055, tempDiff);',,
          '',
          '    if (motionGate > 0.001) {',
          '      // Tier 1 (Coarse Scale, 10px): captures sweeping macro movement up to 25px',
          '      vec2 flowCoarse = computeFlowAtScale(v_uv, v_uv, 10.0, 0.035);',
          '      vec2 maxCoarse = 25.0 * u_texelSize;',
          '      flowCoarse = clamp(flowCoarse, -maxCoarse, maxCoarse);',
          '',
          '      // Tier 2 (Medium Scale, 4px): warps previous frame coordinate by coarse flow',
          '      vec2 uvWarped1 = clamp(v_uv - flowCoarse, 0.0, 1.0);',
          '      vec2 flowMedium = computeFlowAtScale(v_uv, uvWarped1, 4.0, 0.020);',
          '      vec2 maxMedium = 10.0 * u_texelSize;',
          '      flowMedium = clamp(flowMedium, -maxMedium, maxMedium);',
          '',
          '      // Tier 3 (Fine Scale, 1.5px): subpixel edge refinement',
          '      vec2 uvWarped2 = clamp(v_uv - (flowCoarse + flowMedium), 0.0, 1.0);',
          '      vec2 flowFine = computeFlowAtScale(v_uv, uvWarped2, 1.5, 0.010);',
          '      vec2 maxFine = 4.0 * u_texelSize;',
          '      flowFine = clamp(flowFine, -maxFine, maxFine);',
          '',
          '      vec2 totalFlow = (flowCoarse + flowMedium + flowFine) * motionGate;',
          '      v_motion += totalFlow;',
          '    }',
          '  }',
          '',
          '  // Apply user blur multiplier',
          '  v_motion *= u_blurAmount;',
          '',
          '  // Clamp maximum blur streak to prevent streak overflow',
          '  float maxStreak = 60.0 * max(u_texelSize.x, u_texelSize.y);',
          '  float vLen = length(v_motion);',
          '  if (vLen > maxStreak) {',
          '    v_motion = v_motion * (maxStreak / vLen);',
          '    vLen = maxStreak;',
          '  }',
          '',
          '  // Smooth subpixel fade: eliminates hard cutoff popping between static and moving pixels.',
          '  // Raised upper bound (1.2 vs 1.0) for a softer onset, less abrupt blur edge.',
          '  float pxLen = vLen / max(u_texelSize.x, u_texelSize.y);',
          '  float blurFade = smoothstep(0.3, 1.2, pxLen);',,
          '  if (blurFade <= 0.001) {',
          '    gl_FragColor = currCol;',
          '    return;',
          '  }',
          '',
          '  // 3. Directional Shutter Accumulation (16-sample centered 180° shutter)',
          '  //    Out-of-bounds samples return transparent via sampleBounded() — no edge stretch.',
          '  //    Subtle micro-dither breaks 8-bit banding without visible grain or jitter.',
          '  float dither = (fract(sin(dot(v_uv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.04;',,
          '',
          '  vec4 accumColor = vec4(0.0);',
          '  float totalWeight = 0.0;',
          '',
          '  for (int i = 0; i < 16; i++) {',
          '    float fi = float(i);',
          '    float t = -0.5 + (fi + 0.5 + dither) / 16.0;',
          '    vec2 sampleUV = v_uv + v_motion * t;',
          '    vec4 col = sampleBounded(u_currentFrame, sampleUV);',
          '    // Flat-top bell curve: wider uniform centre avoids ghost-frame dominance at t≈0.',
          '    // exp(-2.5*t²) shallower than old -3.8 → more uniform trail opacity.',
          '    // Samples landing outside bounds (col.a == 0) get zero contribution.',
          '    float w = exp(-2.5 * t * t) * (col.a > 0.0 ? 1.0 : 0.0);',
          '    accumColor += col * w;',
          '    totalWeight += w;',
          '  }',
          '',
          '  vec4 blurredCol = (totalWeight > 0.001) ? (accumColor / totalWeight) : currCol;',,
          '  gl_FragColor = mix(currCol, blurredCol, blurFade);',
          '}'
        ].join('\n');

        function compileShader(type, src) {
          const s = gl.createShader(type);
          gl.shaderSource(s, src);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('[FSMB] Shader Compile Error:', gl.getShaderInfoLog(s));
            return null;
          }
          return s;
        }

        const vs = compileShader(gl.VERTEX_SHADER, vsSource);
        const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) {
          this._glFailed = true;
          return false;
        }

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          console.error('[FSMB] Program Link Error:', gl.getProgramInfoLog(prog));
          this._glFailed = true;
          return false;
        }

        this._glProg = prog;
        this._glUniforms = {
          currentFrame: gl.getUniformLocation(prog, 'u_currentFrame'),
          prevFrame: gl.getUniformLocation(prog, 'u_prevFrame'),
          blurAmount: gl.getUniformLocation(prog, 'u_blurAmount'),
          transVel: gl.getUniformLocation(prog, 'u_transVel'),
          rotVel: gl.getUniformLocation(prog, 'u_rotVel'),
          scaleVel: gl.getUniformLocation(prog, 'u_scaleVel'),
          anchor: gl.getUniformLocation(prog, 'u_anchor'),
          aspect: gl.getUniformLocation(prog, 'u_aspect'),
          texelSize: gl.getUniformLocation(prog, 'u_texelSize'),
          hasPrevFrame: gl.getUniformLocation(prog, 'u_hasPrevFrame')
        };

        const positions = new Float32Array([
          -1.0,  1.0,
          -1.0, -1.0,
           1.0,  1.0,
           1.0, -1.0
        ]);
        const texCoords = new Float32Array([
          0.0, 0.0,
          0.0, 1.0,
          1.0, 0.0,
          1.0, 1.0
        ]);

        this._posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        this._uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        this._currTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._currTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

        this._prevTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._prevTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

        gl.useProgram(prog);
        gl.uniform1i(this._glUniforms.currentFrame, 0);
        gl.uniform1i(this._glUniforms.prevFrame, 1);

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);

        return true;
      } catch (e) {
        console.warn('[FSMB] WebGL init failed, using Canvas2D fallback:', e);
        this._glFailed = true;
        return false;
      }
    }

    /**
     * Compute analytical transform velocity from layer keyframes
     */
    computeTransformVelocity(layer, currentSec, fps = 60, baseW = 1920, baseH = 1080) {
      const frameDur = 1 / Math.max(1, fps);
      const prevSec = Math.max(0, currentSec - frameDur);

      if (typeof window.getLayerEffectivePropsAtTime !== 'function') {
        return { transX: 0, transY: 0, rotVel: 0, scaleVel: 0, anchorX: 0.5, anchorY: 0.5, hasMotion: false };
      }

      const pCurr = window.getLayerEffectivePropsAtTime(layer, currentSec) || layer;
      const pPrev = window.getLayerEffectivePropsAtTime(layer, prevSec) || layer;

      const posXCurr = pCurr.posX !== undefined ? pCurr.posX : (layer.posX || 0);
      const posYCurr = pCurr.posY !== undefined ? pCurr.posY : (layer.posY || 0);
      const posXPrev = pPrev.posX !== undefined ? pPrev.posX : (layer.posX || 0);
      const posYPrev = pPrev.posY !== undefined ? pPrev.posY : (layer.posY || 0);

      const dx = (posXCurr - posXPrev) / Math.max(1, baseW);
      const dy = (posYCurr - posYPrev) / Math.max(1, baseH);

      // Shortest-path angular diff: avoids ±360° wrap-around velocity spikes.
      // E.g. rotating from 350° to 10° → diff = +20°, not −340°.
      const rotDegCurr = pCurr.rotZ !== undefined ? pCurr.rotZ : (pCurr.rotation || layer.rotZ || layer.rotation || 0);
      const rotDegPrev = pPrev.rotZ !== undefined ? pPrev.rotZ : (pPrev.rotation || layer.rotZ || layer.rotation || 0);
      const rotDegDiff = ((rotDegCurr - rotDegPrev) % 360 + 540) % 360 - 180;
      const rotVel = rotDegDiff * (Math.PI / 180);

      const scaleCurr = pCurr.scaleW !== undefined ? pCurr.scaleW : (layer.scaleW || 1);
      const scalePrev = pPrev.scaleW !== undefined ? pPrev.scaleW : (layer.scaleW || 1);
      const scaleVel = (scaleCurr - scalePrev) / Math.max(0.001, Math.abs(scaleCurr));

      const layerW = Math.max(1, Math.abs(layer.scaleW || layer.mediaWidth || baseW));
      const layerH = Math.max(1, Math.abs(layer.scaleH || layer.mediaHeight || baseH));
      const ax = 0.5 + ((pCurr.anchorX || layer.anchorX || 0) / layerW);
      const ay = 0.5 + ((pCurr.anchorY || layer.anchorY || 0) / layerH);

      const hasMotion = (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001 || Math.abs(rotVel) > 0.0002 || Math.abs(scaleVel) > 0.0005);

      return {
        transX: dx,
        transY: dy,
        rotVel: rotVel,
        scaleVel: scaleVel,
        anchorX: Math.max(0, Math.min(1, ax)),
        anchorY: Math.max(0, Math.min(1, ay)),
        hasMotion: hasMotion
      };
    }

    /**
     * Get or create temporal frame buffer for optical flow
     */
    _getLayerBuffer(layerId, w, h) {
      const key = String(layerId || 'global_precomp');
      let entry = this._layerFrameCache.get(key);
      if (!entry) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        entry = {
          canvas: c,
          ctx: c.getContext('2d', { willReadFrequently: false }),
          sec: -1,
          valid: false,
          width: w,
          height: h
        };
        this._layerFrameCache.set(key, entry);
      } else if (entry.width !== w || entry.height !== h) {
        entry.canvas.width = w;
        entry.canvas.height = h;
        entry.width = w;
        entry.height = h;
        entry.valid = false;
      }
      return entry;
    }

    /**
     * Check if source element has valid dimensions
     */
    _isValidSource(el) {
      if (!el) return false;
      if (el.tagName === 'VIDEO') {
        return el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0;
      }
      if (el.tagName === 'IMG') {
        return el.complete && el.naturalWidth > 0 && el.naturalHeight > 0;
      }
      if (typeof el.width === 'number' && typeof el.height === 'number') {
        return el.width > 0 && el.height > 0;
      }
      return true;
    }

    /**
     * Fallback Canvas2D Multi-Pass Vector Blur
     */
    _renderCanvas2D(ctx, el, bounds, blurAmount, vel) {
      const w = Math.max(1, Math.round(bounds.w));
      const h = Math.max(1, Math.round(bounds.h));
      const x = bounds.x;
      const y = bounds.y;

      if (!vel.hasMotion || blurAmount <= 0.001) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      if (!this._2dAccumCanvas) {
        this._2dAccumCanvas = document.createElement('canvas');
        this._2dAccumCtx = this._2dAccumCanvas.getContext('2d');
      }
      const ac = this._2dAccumCanvas;
      const actx = this._2dAccumCtx;

      if (ac.width !== w || ac.height !== h) {
        ac.width = w;
        ac.height = h;
      }

      actx.clearRect(0, 0, w, h);

      const maxBlurPx = 50.0;
      const dxPx = Math.max(-maxBlurPx, Math.min(maxBlurPx, vel.transX * w * blurAmount));
      const dyPx = Math.max(-maxBlurPx, Math.min(maxBlurPx, vel.transY * h * blurAmount));
      const rotRad = Math.max(-0.5, Math.min(0.5, vel.rotVel * blurAmount));

      const fSamples = 10;

      // Fixed 1/N lighter accumulation — correct for sparse-coverage pixels.
      // (Previously used progressive 1/(i+1) source-over which left leading-edge at full opacity.)
      actx.globalAlpha = 1.0 / fSamples;
      actx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < fSamples; i++) {
        const t = -0.5 + (i + 0.5) / fSamples;
        const offX = dxPx * t;
        const offY = dyPx * t;
        const rot = rotRad * t;

        actx.save();
        if (rot !== 0) {
          const cx = w * vel.anchorX;
          const cy = h * vel.anchorY;
          actx.translate(cx + offX, cy + offY);
          actx.rotate(rot);
          actx.drawImage(el, -cx, -cy, w, h);
        } else {
          actx.drawImage(el, offX, offY, w, h);
        }
        actx.restore();
      }

      // Reset composite state before drawing to destination
      actx.globalAlpha = 1;
      actx.globalCompositeOperation = 'source-over';

      ctx.drawImage(ac, x, y, w, h);
    }

    /**
     * Main FSMB Render Entrypoint
     */
    render(ctx, el, layer, bounds, fx, currentSec = 0) {
      if (!ctx || !el) return;

      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;
      const bw = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const bh = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      if (!this._isValidSource(el)) {
        try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
        return;
      }

      // Read single simple "Blur" parameter (0% to 100%, default 50%)
      const rawBlur = (fx.blur !== undefined ? fx.blur : (fx.blurAmount !== undefined ? fx.blurAmount * 100 : 50));
      const blurAmount = Math.max(0, Math.min(100, Number(rawBlur))) / 50.0; // 50% = 1.0x shutter, 100% = 2.0x shutter

      // If blur amount is 0, render sharp source directly
      if (blurAmount <= 0.001) {
        try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
        return;
      }

      const fps = (typeof window.getProjectFps === 'function')
        ? window.getProjectFps()
        : ((window.currentProjectState && window.currentProjectState.fps) ? parseInt(window.currentProjectState.fps, 10) : 60);

      // 1. Calculate Analytical Transform Velocity from Keyframes
      const baseW = (window.currentProjectState && window.currentProjectState.canvasWidth) || 1920;
      const baseH = (window.currentProjectState && window.currentProjectState.canvasHeight) || 1080;
      const vel = this.computeTransformVelocity(layer, currentSec, fps, baseW, baseH);

      // 2. Manage Temporal Frame Cache for Optical Flow
      const layerId = (layer && (layer.id || layer.mediaId || layer.name)) || (ctx.canvas && ctx.canvas.id ? ctx.canvas.id : 'precomp_layer');
      const frameBuf = this._getLayerBuffer(layerId, bw, bh);
      const timeDelta = Math.abs(currentSec - frameBuf.sec);
      const isPlayingOrScrubbing = !!(window.isTimelinePlaying || window.isTimelineScrubbing || window.isTimelinePanning || window.isExporting || (timeDelta > 0.0001 && timeDelta <= 0.25));
      const isPlayheadNear = frameBuf.valid && timeDelta > 0.0001 && timeDelta <= 0.35 && isPlayingOrScrubbing;

      // 3. Stationary / Frame Parked Fast-Path:
      // If playhead is paused/stationary and layer has no active transform velocity,
      // render crisp pristine original without any blur or black artifact!
      if (!vel.hasMotion && !isPlayheadNear) {
        try {
          ctx.drawImage(el, bx, by, bw, bh);
        } catch (_) {}
        try {
          frameBuf.ctx.clearRect(0, 0, bw, bh);
          frameBuf.ctx.drawImage(el, 0, 0, bw, bh);
          frameBuf.sec = currentSec;
          frameBuf.valid = true;
        } catch (_) {}
        return;
      }

      // 4. Attempt Hardware WebGL Render
      if (!this._glFailed && this._initWebGL()) {
        try {
          const gl = this._gl;
          const prog = this._glProg;
          const u = this._glUniforms;

          if (this._glCanvas.width !== bw || this._glCanvas.height !== bh) {
            this._glCanvas.width = bw;
            this._glCanvas.height = bh;
          }

          gl.viewport(0, 0, bw, bh);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);

          gl.useProgram(prog);

          // Upload current frame texture (Texture 0)
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this._currTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
          gl.uniform1i(u.currentFrame, 0);

          // Upload previous frame texture for optical flow (Texture 1)
          let hasPrev = 0.0;
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, this._prevTex);
          if (isPlayheadNear && frameBuf.canvas) {
            try {
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frameBuf.canvas);
              hasPrev = 1.0;
            } catch (_) {
              hasPrev = 0.0;
            }
          }
          gl.uniform1i(u.prevFrame, 1);
          gl.uniform1f(u.hasPrevFrame, hasPrev);

          // Set shader parameters
          gl.uniform1f(u.blurAmount, blurAmount);
          gl.uniform2f(u.transVel, vel.transX, vel.transY);
          gl.uniform1f(u.rotVel, vel.rotVel);
          gl.uniform1f(u.scaleVel, vel.scaleVel);
          gl.uniform2f(u.anchor, vel.anchorX, vel.anchorY);
          gl.uniform1f(u.aspect, bw / bh);
          gl.uniform2f(u.texelSize, 1.0 / bw, 1.0 / bh);

          // Bind quad attributes
          const posLoc = gl.getAttribLocation(prog, 'a_pos');
          gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
          gl.enableVertexAttribArray(posLoc);
          gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

          const uvLoc = gl.getAttribLocation(prog, 'a_uv');
          gl.bindBuffer(gl.ARRAY_BUFFER, this._uvBuf);
          gl.enableVertexAttribArray(uvLoc);
          gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // Draw rendered WebGL result into destination context
          ctx.drawImage(this._glCanvas, bx, by, bw, bh);

          // Snapshot current frame for next temporal optical flow step
          try {
            frameBuf.ctx.clearRect(0, 0, bw, bh);
            frameBuf.ctx.drawImage(el, 0, 0, bw, bh);
            frameBuf.sec = currentSec;
            frameBuf.valid = true;
          } catch (_) {}

          return;
        } catch (webglErr) {
          console.warn('[FSMB] WebGL draw failed, falling back to Canvas2D:', webglErr);
          this._renderCanvas2D(ctx, el, { x: bx, y: by, w: bw, h: bh }, blurAmount, vel);
          return;
        }
      }

      // 5. Fail-Safe Canvas2D Fallback Render
      this._renderCanvas2D(ctx, el, { x: bx, y: by, w: bw, h: bh }, blurAmount, vel);

      // Snapshot to frame buffer
      try {
        frameBuf.ctx.clearRect(0, 0, bw, bh);
        frameBuf.ctx.drawImage(el, 0, 0, bw, bh);
        frameBuf.sec = currentSec;
        frameBuf.valid = true;
      } catch (_) {}
    }
  }

  // Global Engine Instance
  const engine = new FishSMBEngine();
  window.FishSMBEngine = engine;
  window.FSMBEngine = engine;

  // Register Effect Plugin into FishEffectsRegistry
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (reg) {
    reg.register({
      id: 'fsmb',
      name: 'FSMB (Motion Blur)',
      category: 'movement',
      icon: 'assets/FXPH.svg',
      description: 'RSMB-style motion blur with optical flow pixel tracking and transform velocity',
      params: [
        { id: 'blur', label: 'Blur', type: 'number', min: 0, max: 100, default: 50, step: 1, unit: '%' }
      ],
      render(ctx, el, layer, bounds, fx, currentSec) {
        if (!ctx || !el) return;
        engine.render(ctx, el, layer, bounds, fx, currentSec);
      }
    });
  }

})(typeof window !== 'undefined' ? window : this);
