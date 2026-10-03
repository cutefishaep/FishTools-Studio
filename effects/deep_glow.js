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

  // Precomputed de-gamma lookup table (x^0.454545) for true physical optical expansion
  const deGammaLut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    deGammaLut[v] = Math.min(255, Math.max(0, Math.round(Math.pow(v / 255, 0.45454545) * 255)));
  }

  // Offscreen canvas pools (reused across frames for zero-allocation performance)
  let threshCanvas = null;
  let threshCtx = null;
  let glowCanvas = null;
  let glowCtx = null;
  let chromaCanvas = null;
  let chromaCtx = null;
  let tintCanvas = null;
  let tintCtx = null;

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
      { id: 'chromaticAberration', label: 'Chromatic Shift', type: 'number', min: 0, max: 40, default: 4, unit: 'px' },
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
      const chromatic = Math.max(0, fx.chromaticAberration !== undefined ? fx.chromaticAberration : 4);
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

      // Strictly layer-bounded: pad = 0 guarantees glow stays 100% inside the layer boundary
      const bw = w;
      const bh = h;

      if (!threshCanvas) {
        threshCanvas = document.createElement('canvas');
        threshCtx = threshCanvas.getContext('2d', { willReadFrequently: true });
        glowCanvas = document.createElement('canvas');
        glowCtx = glowCanvas.getContext('2d', { willReadFrequently: true });
        chromaCanvas = document.createElement('canvas');
        chromaCtx = chromaCanvas.getContext('2d');
        tintCanvas = document.createElement('canvas');
        tintCtx = tintCanvas.getContext('2d');
      }

      if (threshCanvas.width !== bw || threshCanvas.height !== bh) {
        threshCanvas.width = bw;
        threshCanvas.height = bh;
        glowCanvas.width = bw;
        glowCanvas.height = bh;
        chromaCanvas.width = bw;
        chromaCanvas.height = bh;
      }

      threshCtx.clearRect(0, 0, bw, bh);
      glowCtx.clearRect(0, 0, bw, bh);
      chromaCtx.clearRect(0, 0, bw, bh);

      // 1. Draw source layer fitted exactly inside layer buffer
      try {
        threshCtx.drawImage(el, 0, 0, w, h);
      } catch (_) {
        return;
      }

      // 2. Pre-process: Thresholding Knee & Gamma Linearization
      const threshVal = threshold * 255;
      const needsPreproc = (threshVal > 0.5 || gammaCorrect);

      if (needsPreproc) {
        const imgData = threshCtx.getImageData(0, 0, bw, bh);
        const data = imgData.data;
        const len = data.length;

        // Precompute LUT for instant lookup
        const lut = new Uint8Array(256);
        for (let v = 0; v < 256; v++) {
          let val = v;
          if (threshVal > 0.5 && val < threshVal) {
            const tPct = val / Math.max(1, threshVal);
            val = (tPct * val) * thresholdSmooth;
          }
          if (gammaCorrect) {
            val = Math.pow(val / 255, 2.222222) * 255;
          }
          lut[v] = Math.min(255, Math.max(0, Math.round(val)));
        }

        for (let i = 0; i < len; i += 4) {
          if (data[i + 3] <= 1) continue;
          data[i] = lut[data[i]];
          data[i + 1] = lut[data[i + 1]];
          data[i + 2] = lut[data[i + 2]];
        }
        threshCtx.putImageData(imgData, 0, 0);
      }

      // 3. Multi-Octave Inverse-Square Falloff Bloom
      // 6 distinct octave tiers spanning from sub-pixel tight core up to broad cosmic bloom.
      // This ensures small particles and stars retain an intense incandescent burning core,
      // while large text and solids produce a rich, deep, expansive halo.
      const octaves = 6;
      const octMultipliers = [0.012, 0.045, 0.15, 0.45, 1.25, 2.80];

      const aspectScaleX = aspect > 0 ? (1 + aspect * 1.5) : (1 / (1 + Math.abs(aspect) * 1.5));
      const aspectScaleY = aspect < 0 ? (1 + Math.abs(aspect) * 1.5) : (1 / (1 + aspect * 1.5));

      glowCtx.globalCompositeOperation = 'lighter';

      const hasNativeFilter = typeof window !== 'undefined' && window.FishEffects &&
                              typeof window.FishEffects.isCanvasFilterSupported === 'function' &&
                              window.FishEffects.isCanvasFilterSupported();

      for (let oct = 0; oct < octaves; oct++) {
        const octRadius = Math.max(1.2, radius * octMultipliers[oct]);
        const blurX = Math.max(1, Math.round(octRadius * aspectScaleX));
        const blurY = Math.max(1, Math.round(octRadius * aspectScaleY));

        // Physically accurate inverse-square falloff weight
        const weight = 1.0 / Math.pow(oct + 1.15, falloff);
        if (weight <= 0.005) continue;

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
        } else {
          glowCtx.drawImage(threshCanvas, 0, 0);
        }
        glowCtx.restore();
      }

      glowCtx.globalCompositeOperation = 'source-over';
      glowCtx.filter = 'none';

      // 4. Post-process: Authentic AE Deep Glow De-Gamma (x^0.4545) & Alpha Unmult
      // Expands linear bloom falloff so small particles and faint glow tails radiate vividly without 8-bit clipping.
      if (gammaCorrect || unmult) {
        const gImg = glowCtx.getImageData(0, 0, bw, bh);
        const gData = gImg.data;
        const gLen = gData.length;

        for (let i = 0; i < gLen; i += 4) {
          let r = gData[i];
          let g = gData[i + 1];
          let b = gData[i + 2];

          if (gammaCorrect) {
            r = deGammaLut[r];
            g = deGammaLut[g];
            b = deGammaLut[b];
            gData[i] = r;
            gData[i + 1] = g;
            gData[i + 2] = b;
          }

          if (unmult) {
            gData[i + 3] = Math.max(r, g, b);
          }
        }
        glowCtx.putImageData(gImg, 0, 0);
      }

      // 5. GPU Tinting (Multiply, Overlay, Soft Light)
      const rgb = hexToRgb(tintColor);
      const isWhiteTint = (rgb.r >= 250 && rgb.g >= 250 && rgb.b >= 250);

      if (!isWhiteTint) {
        if (tintCanvas.width !== bw || tintCanvas.height !== bh) {
          tintCanvas.width = bw;
          tintCanvas.height = bh;
        }
        tintCtx.clearRect(0, 0, bw, bh);
        tintCtx.drawImage(glowCanvas, 0, 0);
        tintCtx.globalCompositeOperation = 'source-in';
        tintCtx.fillStyle = tintColor;
        tintCtx.fillRect(0, 0, bw, bh);
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

      // 6. Chromatic Aberration Shift on Glow Buffer (Red and Blue channel separation)
      let finalGlowSource = glowCanvas;
      if (chromatic > 0.5) {
        chromaCtx.clearRect(0, 0, bw, bh);
        const caAmt = Math.round(chromatic);

        // Draw master in center
        chromaCtx.globalAlpha = 1.0;
        chromaCtx.drawImage(glowCanvas, 0, 0);

        // Shift channels
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

      // 7. Draw to Target Canvas with Enhanced Exposure & Strict Layer Clipping
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip(); // 100% guarantee: glow NEVER spills outside layer boundary

      const expPct = Math.round(exposure * 100);
      const filterStr = `brightness(${expPct}%)`;

      if (glowOnly) {
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = (blendMode === 'source-over' ? 'source-over' : blendMode);
        if (hasNativeFilter) ctx.filter = filterStr;
        try { ctx.drawImage(finalGlowSource, x, y, w, h); } catch (_) {}
      } else if (blendMode === 'source-over') {
        // Ambient background glow
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = 'source-over';
        if (hasNativeFilter) ctx.filter = filterStr;
        try { ctx.drawImage(finalGlowSource, x, y, w, h); } catch (_) {}
        ctx.restore();

        // Crisp source layer
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}

        // Intense radiant core boosted by exposure
        ctx.save();
        ctx.globalAlpha = opacity * Math.min(1.0, exposure * 0.75);
        ctx.globalCompositeOperation = 'lighter';
        if (hasNativeFilter) ctx.filter = filterStr;
        try { ctx.drawImage(finalGlowSource, x, y, w, h); } catch (_) {}
        ctx.restore();
      } else {
        // Screen or Lighter: draw source, composite radiant glow with full exposure multiplication
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = blendMode;
        if (hasNativeFilter) ctx.filter = filterStr;
        try { ctx.drawImage(finalGlowSource, x, y, w, h); } catch (_) {}
        ctx.restore();

        // Extra hot core pass for high exposure (> 1.2)
        if (exposure > 1.2) {
          ctx.save();
          const extraCore = Math.min(1.0, (exposure - 1.0) * 0.65);
          ctx.globalAlpha = opacity * extraCore;
          ctx.globalCompositeOperation = 'lighter';
          if (hasNativeFilter) ctx.filter = filterStr;
          try { ctx.drawImage(finalGlowSource, x, y, w, h); } catch (_) {}
          ctx.restore();
        }
      }

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
