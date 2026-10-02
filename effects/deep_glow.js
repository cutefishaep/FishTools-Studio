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

  // Offscreen canvas pools for high-performance zero-allocation rendering
  let threshCanvas = null;
  let threshCtx = null;
  let glowCanvas = null;
  let glowCtx = null;

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

      // Generous padding to capture full radiant bloom falloff without box clipping
      const pad = Math.min(350, Math.round(radius * 1.5));
      const bw = w + pad * 2;
      const bh = h + pad * 2;

      if (!threshCanvas) {
        threshCanvas = document.createElement('canvas');
        threshCtx = threshCanvas.getContext('2d', { willReadFrequently: true });
        glowCanvas = document.createElement('canvas');
        glowCtx = glowCanvas.getContext('2d', { willReadFrequently: true });
      }
      if (threshCanvas.width !== bw || threshCanvas.height !== bh) {
        threshCanvas.width = bw;
        threshCanvas.height = bh;
        glowCanvas.width = bw;
        glowCanvas.height = bh;
      }

      // 1. Draw source layer onto black background to eliminate alpha dilution
      // (Stars and particles radiate full RGB energy into dark space without fading to transparent)
      threshCtx.fillStyle = '#000000';
      threshCtx.fillRect(0, 0, bw, bh);
      try {
        threshCtx.drawImage(el, pad, pad, w, h);
      } catch (_) {
        return;
      }

      // 2. Pre-Process: Chromatic Aberration, Threshold with Smooth Knee, Gamma 2.2
      const imgData = threshCtx.getImageData(0, 0, bw, bh);
      const data = imgData.data;

      // A. Pre-Process Chromatic Aberration (Channel Separation)
      const caAmt = Math.round(chromatic);
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

        for (let py = 0; py < bh; py++) {
          const row = py * bw * 4;
          for (let px = 0; px < bw; px++) {
            const idx = row + px * 4;
            const rx = Math.max(0, Math.min(bw - 1, px + rOff));
            const gx = Math.max(0, Math.min(bw - 1, px + gOff));
            const bx = Math.max(0, Math.min(bw - 1, px + bOff));
            data[idx] = srcData[row + rx * 4];
            data[idx + 1] = srcData[row + gx * 4 + 1];
            data[idx + 2] = srcData[row + bx * 4 + 2];
          }
        }
      }

      // B. Pre-Process Smooth Knee Threshold & Gamma Linearization LUT
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

      for (let i = 0; i < data.length; i += 4) {
        data[i] = smoothLut[data[i]];
        data[i + 1] = smoothLut[data[i + 1]];
        data[i + 2] = smoothLut[data[i + 2]];
        data[i + 3] = 255; // Keep opaque for multi-octave blur
      }
      threshCtx.putImageData(imgData, 0, 0);

      // 3. Multi-Octave Inverse-Square Falloff Bloom Pyramid (6 octaves)
      glowCtx.clearRect(0, 0, bw, bh);
      glowCtx.fillStyle = '#000000';
      glowCtx.fillRect(0, 0, bw, bh);

      const octaves = 6;
      const aspectScaleX = aspect > 0 ? (1 + aspect * 1.5) : (1 / (1 + Math.abs(aspect) * 1.5));
      const aspectScaleY = aspect < 0 ? (1 + Math.abs(aspect) * 1.5) : (1 / (1 + aspect * 1.5));

      glowCtx.globalCompositeOperation = 'lighter';

      const hasNativeFilter = typeof window !== 'undefined' && window.FishEffects &&
                              typeof window.FishEffects.isCanvasFilterSupported === 'function' &&
                              window.FishEffects.isCanvasFilterSupported();

      for (let oct = 0; oct < octaves; oct++) {
        const octRadius = radius * Math.pow(1.85, oct) * 0.22;
        const blurX = Math.max(1, Math.round(octRadius * aspectScaleX));
        const blurY = Math.max(1, Math.round(octRadius * aspectScaleY));

        // Physically accurate inverse-square weight
        const weight = (1.0 / Math.pow(oct + 1.25, falloff)) * exposure;
        if (weight <= 0.002) continue;

        glowCtx.save();
        glowCtx.globalAlpha = Math.min(1.0, weight);
        const blurRadius = Math.max(blurX, blurY);

        if (hasNativeFilter) {
          glowCtx.filter = `blur(${blurRadius}px)`;
          if (Math.abs(aspect) > 0.02) {
            const centerX = bw / 2;
            const centerY = bh / 2;
            glowCtx.translate(centerX, centerY);
            glowCtx.scale(aspectScaleX, aspectScaleY);
            glowCtx.drawImage(threshCanvas, -centerX, -centerY);
          } else {
            glowCtx.drawImage(threshCanvas, 0, 0);
          }
          glowCtx.filter = 'none';
        } else if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
          if (Math.abs(aspect) > 0.02) {
            const centerX = bw / 2;
            const centerY = bh / 2;
            glowCtx.translate(centerX, centerY);
            glowCtx.scale(aspectScaleX, aspectScaleY);
            window.FishEffects.drawBlurred(glowCtx, threshCanvas, bw, bh, blurRadius, -centerX, -centerY);
          } else {
            window.FishEffects.drawBlurred(glowCtx, threshCanvas, bw, bh, blurRadius, 0, 0);
          }
        }
        glowCtx.restore();
      }

      glowCtx.globalCompositeOperation = 'source-over';
      glowCtx.filter = 'none';

      // 4. Post-Process: Gamma De-linearization, Tint Modulation, and Unmult Alpha
      const glowImgData = glowCtx.getImageData(0, 0, bw, bh);
      const gData = glowImgData.data;
      const rgb = hexToRgb(tintColor);
      const isWhiteTint = (rgb.r >= 252 && rgb.g >= 252 && rgb.b >= 252);
      const tR = rgb.r / 255;
      const tG = rgb.g / 255;
      const tB = rgb.b / 255;

      for (let i = 0; i < gData.length; i += 4) {
        let r = gData[i];
        let g = gData[i + 1];
        let b = gData[i + 2];

        // De-linearize gamma back to sRGB display space
        if (gammaCorrect) {
          r = deGammaLut[r];
          g = deGammaLut[g];
          b = deGammaLut[b];
        }

        // Tint modulation
        if (!isWhiteTint) {
          if (tintMode === 'multiply') {
            r = Math.round((r * rgb.r) / 255);
            g = Math.round((g * rgb.g) / 255);
            b = Math.round((b * rgb.b) / 255);
          } else if (tintMode === 'overlay') {
            const ov = (bg, fg) => bg < 128 ? (2 * bg * fg) / 255 : 255 - (2 * (255 - bg) * (255 - fg)) / 255;
            r = Math.round(ov(r, rgb.r));
            g = Math.round(ov(g, rgb.g));
            b = Math.round(ov(b, rgb.b));
          } else if (tintMode === 'soft-light') {
            // Pegtop soft light formula
            const sl = (a, b) => ((1 - 2 * b) * (a * a) + 2 * b * a) * 255;
            r = Math.round(sl(r / 255, tR));
            g = Math.round(sl(g / 255, tG));
            b = Math.round(sl(b / 255, tB));
          }
        }

        gData[i] = Math.min(255, Math.max(0, r));
        gData[i + 1] = Math.min(255, Math.max(0, g));
        gData[i + 2] = Math.min(255, Math.max(0, b));

        // Unmult: extract transparent alpha from brightest channel
        if (unmult) {
          gData[i + 3] = Math.min(255, Math.max(gData[i], Math.max(gData[i + 1], gData[i + 2])));
        } else {
          gData[i + 3] = 255;
        }
      }
      glowCtx.putImageData(glowImgData, 0, 0);

      // 5. Composite Final Result onto Destination Canvas
      ctx.save();
      // A. Original Layer (if not glowOnly)
      if (!glowOnly) {
        try {
          ctx.drawImage(el, x, y, w, h);
        } catch (_) {}
      }

      // B. Blended Glow
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = blendMode;
      try {
        ctx.drawImage(glowCanvas, x - pad, y - pad, bw, bh);
      } catch (_) {}

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
