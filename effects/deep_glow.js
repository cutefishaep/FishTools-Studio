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

  // Precomputed de-gamma LUT (gamma 2.2 to sRGB: 1 / 2.2 = 0.454545)
  const deGammaLut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    deGammaLut[i] = Math.round(Math.pow(i / 255, 0.454545) * 255);
  }

  // Offscreen canvas pools (reused across frames for zero-allocation performance)
  // downCanvas: handles lightweight downscaled source and threshold LUT
  let downCanvas = null;
  let downCtx = null;

  // glowCanvas: hardware-accelerated (willReadFrequently: false) for ultra-fast GPU filter blur
  let glowCanvas = null;
  let glowCtx = null;

  // tintCanvas: lightweight scratchpad for GPU tint compositing
  let tintCanvas = null;
  let tintCtx = null;

  reg.register({
    id: 'deep-glow',
    name: 'Deep Glow',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Physically accurate inverse-square falloff glow with multi-octave bloom, chromatic aberration, smooth thresholding, and unmult like After Effects Deep Glow',
    isExpanding: true,
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
      const unmult = fx.unmult !== undefined ? !!fx.unmult : true;
      const opacity = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 100) / 100));

      if (opacity <= 0.001) {
        if (!glowOnly) {
          try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        }
        return;
      }

      // ── 1. Calculate Bloom Bounding Box & Target Downsampling Resolution ──
      // Glow is low-frequency light diffusion: downsampling to max 640px cuts pixel work by ~90%
      // while hardware bilinear texture scaling renders a silky-smooth, banding-free bloom.
      const pad = Math.min(280, Math.round(radius * 1.4));
      const bw = w + pad * 2;
      const bh = h + pad * 2;

      const TARGET_MAX_DIM = 640;
      const maxDim = Math.max(bw, bh);
      const downScale = maxDim > TARGET_MAX_DIM ? (TARGET_MAX_DIM / maxDim) : 1.0;
      const gw = Math.max(16, Math.round(bw * downScale));
      const gh = Math.max(16, Math.round(bh * downScale));

      // ── 2. Initialize Reusable Canvas Pools ──
      if (!downCanvas) {
        downCanvas = document.createElement('canvas');
        downCtx = downCanvas.getContext('2d', { willReadFrequently: true });
        glowCanvas = document.createElement('canvas');
        // glowCtx does NOT use willReadFrequently: true so GPU hardware acceleration is preserved!
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

      // ── 3. Draw Source Layer into Downscaled Buffer with Solid Black Base ──
      downCtx.fillStyle = '#000000';
      downCtx.fillRect(0, 0, gw, gh);
      try {
        downCtx.drawImage(
          el,
          Math.round(pad * downScale),
          Math.round(pad * downScale),
          Math.round(w * downScale),
          Math.round(h * downScale)
        );
      } catch (_) {
        return;
      }

      // ── 4. Pre-Process: Threshold Knee, Gamma Linearization, & Chromatic Aberration ──
      // Only execute pixel readback if threshold, gamma curve, or chromatic shift is non-default
      const needsPreProcess = (threshold > 0.005) || gammaCorrect || (chromatic > 0.5);

      if (needsPreProcess) {
        const imgData = downCtx.getImageData(0, 0, gw, gh);
        const data = imgData.data;

        // A. Chromatic Aberration (Channel Shift)
        const caAmt = Math.round(chromatic * downScale);
        if (caAmt > 0) {
          const srcData = new Uint8ClampedArray(data);
          let rOff = 0, gOff = 0, bOff = 0;
          if (caChannels === 'red-blue') {
            rOff = -caAmt;
            bOff = caAmt;
          } else if (caChannels === 'red-green') {
            rOff = -caAmt;
            gOff = caAmt;
          } else if (caChannels === 'green-blue') {
            gOff = -caAmt;
            bOff = caAmt;
          }

          for (let py = 0; py < gh; py++) {
            const row = py * gw * 4;
            for (let px = 0; px < gw; px++) {
              const idx = row + px * 4;
              const rx = Math.max(0, Math.min(gw - 1, px + rOff));
              const gx = Math.max(0, Math.min(gw - 1, px + gOff));
              const bx = Math.max(0, Math.min(gw - 1, px + bOff));
              data[idx] = srcData[row + rx * 4];
              data[idx + 1] = srcData[row + gx * 4 + 1];
              data[idx + 2] = srcData[row + bx * 4 + 2];
            }
          }
        }

        // B. Smooth Knee Threshold & Gamma LUT
        const threshVal = threshold * 255;
        const smoothLut = new Uint8Array(256);
        for (let v = 0; v < 256; v++) {
          let val = v;
          if (threshVal > 0) {
            if (val < threshVal) {
              const tPct = val / Math.max(1, threshVal);
              val = (tPct * val) * thresholdSmooth;
            }
          }
          if (gammaCorrect) {
            val = Math.pow(val / 255, 2.2222) * 255;
          }
          smoothLut[v] = Math.max(0, Math.min(255, Math.round(val)));
        }

        const len = data.length;
        for (let i = 0; i < len; i += 4) {
          data[i] = smoothLut[data[i]];
          data[i + 1] = smoothLut[data[i + 1]];
          data[i + 2] = smoothLut[data[i + 2]];
          data[i + 3] = 255;
        }

        downCtx.putImageData(imgData, 0, 0);
      }

      // ── 5. Multi-Octave Inverse-Square Falloff Bloom Pyramid (5 Octaves) ──
      glowCtx.clearRect(0, 0, gw, gh);
      glowCtx.fillStyle = '#000000';
      glowCtx.fillRect(0, 0, gw, gh);

      const octaves = 5;
      const aspectScaleX = aspect > 0 ? (1 + aspect * 1.5) : (1 / (1 + Math.abs(aspect) * 1.5));
      const aspectScaleY = aspect < 0 ? (1 + Math.abs(aspect) * 1.5) : (1 / (1 + aspect * 1.5));

      glowCtx.globalCompositeOperation = 'lighter';

      const hasNativeFilter = typeof window !== 'undefined' && window.FishEffects &&
                              typeof window.FishEffects.isCanvasFilterSupported === 'function' &&
                              window.FishEffects.isCanvasFilterSupported();

      for (let oct = 0; oct < octaves; oct++) {
        const octRadius = radius * Math.pow(1.85, oct) * 0.22 * downScale;
        const blurX = Math.max(1, Math.round(octRadius * aspectScaleX));
        const blurY = Math.max(1, Math.round(octRadius * aspectScaleY));
        const blurRadius = Math.max(blurX, blurY);

        // Physically accurate inverse-square falloff weight
        const weight = (1.0 / Math.pow(oct + 1.25, falloff)) * exposure;
        if (weight <= 0.002) continue;

        glowCtx.save();
        glowCtx.globalAlpha = Math.min(1.0, weight);

        if (hasNativeFilter) {
          glowCtx.filter = `blur(${blurRadius}px)`;
          if (Math.abs(aspect) > 0.02) {
            const centerX = gw / 2;
            const centerY = gh / 2;
            glowCtx.translate(centerX, centerY);
            glowCtx.scale(aspectScaleX, aspectScaleY);
            glowCtx.drawImage(downCanvas, -centerX, -centerY);
          } else {
            glowCtx.drawImage(downCanvas, 0, 0);
          }
          glowCtx.filter = 'none';
        } else if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
          if (Math.abs(aspect) > 0.02) {
            const centerX = gw / 2;
            const centerY = gh / 2;
            glowCtx.translate(centerX, centerY);
            glowCtx.scale(aspectScaleX, aspectScaleY);
            window.FishEffects.drawBlurred(glowCtx, downCanvas, gw, gh, blurRadius, -centerX, -centerY);
          } else {
            window.FishEffects.drawBlurred(glowCtx, downCanvas, gw, gh, blurRadius, 0, 0);
          }
        } else {
          glowCtx.drawImage(downCanvas, 0, 0);
        }
        glowCtx.restore();
      }

      glowCtx.globalCompositeOperation = 'source-over';
      glowCtx.filter = 'none';

      // ── 6. GPU Tinting & Alpha Unmult ──
      const rgb = hexToRgb(tintColor);
      const isWhiteTint = (rgb.r >= 250 && rgb.g >= 250 && rgb.b >= 250);

      // Fast GPU Tint pass without CPU byte loops
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

        if (tintMode === 'multiply') {
          glowCtx.globalCompositeOperation = 'multiply';
          glowCtx.drawImage(tintCanvas, 0, 0);
          glowCtx.globalCompositeOperation = 'source-over';
        } else {
          glowCtx.globalCompositeOperation = tintMode;
          glowCtx.drawImage(tintCanvas, 0, 0);
          glowCtx.globalCompositeOperation = 'source-over';
        }
      }

      // Unmult: for screen and lighter blend modes, black is pure identity (no alpha extraction required!).
      // Only extract alpha on the compact downscaled buffer when blendMode is source-over.
      if (blendMode === 'source-over' && unmult) {
        const gImg = glowCtx.getImageData(0, 0, gw, gh);
        const gData = gImg.data;
        const gLen = gData.length;
        for (let i = 0; i < gLen; i += 4) {
          if (gammaCorrect) {
            gData[i] = deGammaLut[gData[i]];
            gData[i + 1] = deGammaLut[gData[i + 1]];
            gData[i + 2] = deGammaLut[gData[i + 2]];
          }
          gData[i + 3] = Math.max(gData[i], gData[i + 1], gData[i + 2]);
        }
        glowCtx.putImageData(gImg, 0, 0);
      }

      // ── 7. Final Bilinear Composite onto Destination Canvas ──
      ctx.save();
      if (!glowOnly) {
        try {
          ctx.drawImage(el, x, y, w, h);
        } catch (_) {}
      }

      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = blendMode;
      try {
        ctx.drawImage(glowCanvas, x - pad, y - pad, bw, bh);
      } catch (_) {}

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
