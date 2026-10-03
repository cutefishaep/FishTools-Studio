(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgb(hex) {
    let c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  // Offscreen canvas pools (reused across frames for zero-allocation 60fps performance)
  let downCanvas = null;
  let downCtx = null;
  let glowCanvas = null;
  let glowCtx = null;
  let tintCanvas = null;
  let tintCtx = null;
  let chromaCanvas = null;
  let chromaCtx = null;
  let mipCanvases = null;
  let mipCtxs = null;

  reg.register({
    id: 'deep-glow',
    name: 'Deep Glow',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    isExpanding: false,
    params: [
      { id: 'radius', label: 'Radius', type: 'number', min: 2, max: 400, default: 80, unit: 'px' },
      { id: 'exposure', label: 'Exposure', type: 'number', min: 10, max: 500, default: 140, unit: '%' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'thresholdSmooth', label: 'Threshold Smooth', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'falloff', label: 'Falloff', type: 'number', min: 5, max: 30, default: 14, unit: 'x' },
      { id: 'gammaCorrect', label: 'Gamma Correction', type: 'switch', default: true },
      { id: 'color', label: 'Glow Tint', type: 'color', default: '#ffffff' },
      { id: 'tintMode', label: 'Tint Mode', type: 'select', options: ['multiply', 'overlay', 'soft-light'], default: 'multiply' },
      { id: 'chromaticAberration', label: 'Chromatic Shift', type: 'number', min: 0, max: 40, default: 0, unit: 'px' },
      { id: 'caChannels', label: 'CA Channels', type: 'select', options: ['red-blue', 'red-green', 'green-blue'], default: 'red-blue' },
      { id: 'aspect', label: 'Aspect Ratio', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'blendMode', label: 'Blend Mode', type: 'select', options: ['screen', 'lighter', 'source-over'], default: 'screen' },
      { id: 'glowOnly', label: 'Glow Only', type: 'switch', default: false },
      { id: 'unmult', label: 'Unmult (Alpha)', type: 'switch', default: true },
      { id: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 100, default: 100, unit: '%' }
    ],

    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500)));

      const radius = Math.max(2, fx.radius !== undefined ? fx.radius : 80);
      const exposure = Math.max(0.05, (fx.exposure !== undefined ? fx.exposure : 140) / 100);
      const threshold = Math.max(0, Math.min(1, (fx.threshold !== undefined ? fx.threshold : 0) / 100));
      const thresholdSmooth = Math.max(0, Math.min(1, (fx.thresholdSmooth !== undefined ? fx.thresholdSmooth : 50) / 100));
      const falloff = Math.max(0.5, (fx.falloff !== undefined ? fx.falloff : 14) / 10);
      const gammaCorrect = fx.gammaCorrect !== undefined ? !!fx.gammaCorrect : true;
      const tintColor = fx.color || '#ffffff';
      const tintMode = fx.tintMode || 'multiply';
      const chromatic = Math.max(0, fx.chromaticAberration !== undefined ? fx.chromaticAberration : 0);
      const caChannels = fx.caChannels || 'red-blue';
      const aspect = Math.max(-100, Math.min(100, fx.aspect !== undefined ? fx.aspect : 0)) / 100;
      const blendMode = fx.blendMode || 'screen';
      const glowOnly = !!fx.glowOnly;
      const opacity = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 100) / 100));

      if (opacity <= 0.001) {
        if (!glowOnly) {
          try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        }
        return;
      }

      // ── 1. Layer Boundary Detection & Controlled Padding ──
      // On full-comp / adjustment layers (w >= 900 or >= 90% canvas), pad = 0 (glow fits within full screen comp).
      // On discrete text/shape layers, pad allows glow to naturally bleed outside the letters without clipping.
      const isCompSized = (w >= 900 || (ctx.canvas && w >= ctx.canvas.width * 0.9 && h >= ctx.canvas.height * 0.9));
      const pad = isCompSized ? 0 : Math.min(120, Math.round(radius * 0.75));

      const targetX = x - pad;
      const targetY = y - pad;
      const targetW = w + pad * 2;
      const targetH = h + pad * 2;

      // ── 2. Downsampled Processing Dimensions (16x Faster GPU Throughput) ──
      const TARGET_MAX_DIM = 480;
      const maxDim = Math.max(targetW, targetH);
      const downScale = maxDim > TARGET_MAX_DIM ? (TARGET_MAX_DIM / maxDim) : 1.0;
      const gw = Math.max(16, Math.round(targetW * downScale));
      const gh = Math.max(16, Math.round(targetH * downScale));
      const padDownX = Math.round(pad * downScale);
      const padDownY = Math.round(pad * downScale);
      const srcDownW = Math.max(1, Math.round(w * downScale));
      const srcDownH = Math.max(1, Math.round(h * downScale));

      // ── 3. Initialize Reusable Canvas Pools ──
      if (!downCanvas) {
        downCanvas = document.createElement('canvas');
        downCtx = downCanvas.getContext('2d', { willReadFrequently: true });
        glowCanvas = document.createElement('canvas');
        glowCtx = glowCanvas.getContext('2d');
        tintCanvas = document.createElement('canvas');
        tintCtx = tintCanvas.getContext('2d');
      }

      if (downCanvas.width !== gw || downCanvas.height !== gh) {
        downCanvas.width = gw;
        downCanvas.height = gh;
      }
      if (glowCanvas.width !== gw || glowCanvas.height !== gh) {
        glowCanvas.width = gw;
        glowCanvas.height = gh;
      }

      // ── 4. Draw Source Layer into Downsampled Buffer with Margin ──
      downCtx.clearRect(0, 0, gw, gh);
      try {
        downCtx.drawImage(el, padDownX, padDownY, srcDownW, srcDownH);
      } catch (_) {
        return;
      }

      // ── 5. Pre-Process: Authentic AE Threshold Knee & Gamma Linearization ──
      const needsPreproc = (threshold > 0.005 || gammaCorrect);
      if (needsPreproc) {
        const threshVal = threshold * 255;
        const lut = new Uint8Array(256);
        for (let v = 0; v < 256; v++) {
          let val = v;
          if (threshold > 0.005) {
            if (val < threshVal) {
              const tPct = val / Math.max(1, threshVal);
              val = (tPct * val) * thresholdSmooth;
            }
          }
          if (gammaCorrect) {
            val = Math.pow(val / 255, 2.222222) * 255;
          }
          lut[v] = Math.min(255, Math.max(0, Math.round(val)));
        }

        const imgData = downCtx.getImageData(0, 0, gw, gh);
        const data = imgData.data;
        const len = data.length;
        for (let i = 0; i < len; i += 4) {
          data[i] = lut[data[i]];
          data[i + 1] = lut[data[i + 1]];
          data[i + 2] = lut[data[i + 2]];
        }
        downCtx.putImageData(imgData, 0, 0);
      }

      // ── 6. Progressive 5-Octave Mipmap Pyramid (Authentic Inverse-Square Falloff) ──
      const octaves = 5;
      const mipScales = [1.0, 0.5, 0.25, 0.125, 0.0625];
      const octaveMultipliers = [0.10, 0.28, 0.75, 1.85, 4.20];

      if (!mipCanvases) {
        mipCanvases = [];
        mipCtxs = [];
        for (let i = 0; i < 5; i++) {
          const mc = document.createElement('canvas');
          mipCanvases.push(mc);
          mipCtxs.push(mc.getContext('2d'));
        }
      }

      // Downsample progressively Level 0 -> 1 -> 2 -> 3 -> 4 (Anti-Aliased 2x Bilinear)
      for (let oct = 0; oct < octaves; oct++) {
        const mScale = mipScales[oct];
        const mw = Math.max(8, Math.round(gw * mScale));
        const mh = Math.max(8, Math.round(gh * mScale));
        const mc = mipCanvases[oct];
        const mctx = mipCtxs[oct];

        if (mc.width !== mw || mc.height !== mh) {
          mc.width = mw;
          mc.height = mh;
        }

        mctx.clearRect(0, 0, mw, mh);
        if (oct === 0) {
          mctx.drawImage(downCanvas, 0, 0, mw, mh);
        } else {
          // Progressive downsampling from previous mip level eliminates aliasing
          mctx.drawImage(mipCanvases[oct - 1], 0, 0, mw, mh);
        }
      }

      // ── 7. Inverse-Square Falloff Accumulation into glowCanvas ──
      glowCtx.clearRect(0, 0, gw, gh);
      glowCtx.globalCompositeOperation = 'lighter';

      const aspectScaleX = aspect > 0 ? (1 + aspect * 1.5) : (1 / (1 + Math.abs(aspect) * 1.5));
      const aspectScaleY = aspect < 0 ? (1 + Math.abs(aspect) * 1.5) : (1 / (1 + aspect * 1.5));

      const hasNativeFilter = typeof window !== 'undefined' && window.FishEffects &&
                              typeof window.FishEffects.isCanvasFilterSupported === 'function' &&
                              window.FishEffects.isCanvasFilterSupported();

      for (let oct = octaves - 1; oct >= 0; oct--) {
        const weight = 1.0 / Math.pow(1.0 + oct * 1.15, falloff);
        if (weight <= 0.005) continue;

        const mc = mipCanvases[oct];
        const effRadius = radius * downScale * octaveMultipliers[oct];
        const scaleK = Math.pow(2, oct);
        const blurR = Math.max(1, Math.round(effRadius / scaleK));

        glowCtx.save();
        glowCtx.globalAlpha = Math.min(1.0, weight);

        if (hasNativeFilter) {
          glowCtx.filter = `blur(${blurR}px)`;
          if (Math.abs(aspect) > 0.02) {
            const centerX = gw / 2;
            const centerY = gh / 2;
            glowCtx.translate(centerX, centerY);
            glowCtx.scale(aspectScaleX, aspectScaleY);
            glowCtx.drawImage(mc, -centerX, -centerY, gw, gh);
          } else {
            glowCtx.drawImage(mc, 0, 0, gw, gh);
          }
          glowCtx.filter = 'none';
        } else if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
          if (Math.abs(aspect) > 0.02) {
            const centerX = gw / 2;
            const centerY = gh / 2;
            glowCtx.translate(centerX, centerY);
            glowCtx.scale(aspectScaleX, aspectScaleY);
            window.FishEffects.drawBlurred(glowCtx, mc, gw, gh, blurR, -centerX, -centerY);
          } else {
            window.FishEffects.drawBlurred(glowCtx, mc, gw, gh, blurR, 0, 0);
          }
        } else {
          glowCtx.drawImage(mc, 0, 0, gw, gh);
        }
        glowCtx.restore();
      }

      glowCtx.globalCompositeOperation = 'source-over';
      glowCtx.filter = 'none';

      // ── 8. GPU Tinting (Multiply, Overlay, Soft Light) ──
      const rgb = hexToRgb(tintColor);
      const isWhiteTint = (rgb.r >= 250 && rgb.g >= 250 && rgb.b >= 250);

      if (!isWhiteTint) {
        if (tintCanvas.width !== gw || tintCanvas.height !== gh) {
          tintCanvas.width = gw;
          tintCanvas.height = gh;
        }
        tintCtx.clearRect(0, 0, gw, gh);
        tintCtx.drawImage(glowCanvas, 0, 0);
        tintCtx.globalCompositeOperation = 'source-in';
        tintCtx.fillStyle = tintColor;
        tintCtx.fillRect(0, 0, gw, gh);
        tintCtx.globalCompositeOperation = 'source-over';

        if (tintMode === 'overlay') {
          glowCtx.globalCompositeOperation = 'overlay';
        } else if (tintMode === 'soft-light') {
          glowCtx.globalCompositeOperation = 'soft-light';
        } else {
          glowCtx.globalCompositeOperation = 'multiply';
        }
        glowCtx.drawImage(tintCanvas, 0, 0);
        glowCtx.globalCompositeOperation = 'source-over';
      }

      // ── 9. GPU Chromatic Aberration ──
      let finalGlowSource = glowCanvas;
      if (chromatic > 0.5) {
        if (!chromaCanvas) {
          chromaCanvas = document.createElement('canvas');
          chromaCtx = chromaCanvas.getContext('2d');
        }
        if (chromaCanvas.width !== gw || chromaCanvas.height !== gh) {
          chromaCanvas.width = gw;
          chromaCanvas.height = gh;
        }
        chromaCtx.clearRect(0, 0, gw, gh);
        const caAmt = Math.max(1, Math.round(chromatic * downScale));

        chromaCtx.drawImage(glowCanvas, 0, 0);
        chromaCtx.save();
        chromaCtx.globalCompositeOperation = 'screen';
        let rX = 0, bX = 0;
        if (caChannels === 'red-blue' || caChannels === 'red-green') rX = -caAmt;
        if (caChannels === 'red-blue' || caChannels === 'green-blue') bX = caAmt;
        if (rX !== 0) chromaCtx.drawImage(glowCanvas, rX, 0);
        if (bX !== 0) chromaCtx.drawImage(glowCanvas, bX, 0);
        chromaCtx.restore();

        finalGlowSource = chromaCanvas;
      }

      // ── 10. Final Composite onto Target Canvas (Pure GPU Scaling, 60fps) ──
      ctx.save();
      const expPct = Math.round(exposure * 100);
      const filterStr = `brightness(${expPct}%)`;

      if (glowOnly) {
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = (blendMode === 'source-over' ? 'source-over' : blendMode);
        if (hasNativeFilter) ctx.filter = filterStr;
        try {
          ctx.drawImage(finalGlowSource, targetX, targetY, targetW, targetH);
        } catch (_) {}
      } else if (blendMode === 'source-over') {
        // Source-over: 1. Radiant glow behind, 2. Crisp sharp source on top, 3. Subtle hot center core
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = 'source-over';
        if (hasNativeFilter) ctx.filter = filterStr;
        try { ctx.drawImage(finalGlowSource, targetX, targetY, targetW, targetH); } catch (_) {}
        ctx.restore();

        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}

        ctx.save();
        ctx.globalAlpha = opacity * 0.40;
        ctx.globalCompositeOperation = 'lighter';
        if (hasNativeFilter) ctx.filter = filterStr;
        try { ctx.drawImage(finalGlowSource, targetX, targetY, targetW, targetH); } catch (_) {}
        ctx.restore();
      } else {
        // Screen or Lighter: draw source, composite radiant bloom additively/screen
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = blendMode;
        if (hasNativeFilter) ctx.filter = filterStr;
        try { ctx.drawImage(finalGlowSource, targetX, targetY, targetW, targetH); } catch (_) {}
        ctx.restore();
      }

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
