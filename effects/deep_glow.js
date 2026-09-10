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

  // Offscreen canvas pools for high-performance zero-allocation rendering
  let threshCanvas = null;
  let threshCtx = null;
  let glowCanvas = null;
  let glowCtx = null;
  let chromaCanvas = null;
  let chromaCtx = null;

  reg.register({
    id: 'deep-glow',
    name: 'Deep Glow',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Physically accurate inverse-square falloff glow with multi-octave bloom, chromatic aberration, and thresholding like After Effects Deep Glow',
    params: [
      { id: 'radius', label: 'Radius', type: 'number', min: 2, max: 300, default: 80, unit: 'px' },
      { id: 'exposure', label: 'Exposure', type: 'number', min: 10, max: 400, default: 140, unit: '%' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'falloff', label: 'Falloff', type: 'number', min: 5, max: 30, default: 14, unit: 'x' },
      { id: 'color', label: 'Glow Tint', type: 'color', default: '#ffffff' },
      { id: 'chromaticAberration', label: 'Chromatic Shift', type: 'number', min: 0, max: 40, default: 4, unit: 'px' },
      { id: 'aspect', label: 'Aspect Ratio', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'blendMode', label: 'Blend Mode', type: 'select', options: ['screen', 'lighter', 'source-over'], default: 'screen' },
      { id: 'glowOnly', label: 'Glow Only', type: 'switch', default: false },
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
      const falloff = Math.max(0.5, (fx.falloff !== undefined ? fx.falloff : 14) / 10);
      const tintColor = fx.color || '#ffffff';
      const chromatic = Math.max(0, fx.chromaticAberration !== undefined ? fx.chromaticAberration : 4);
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

      // Max padding to capture wide glow falloff
      const pad = Math.min(250, Math.round(radius * 1.6));
      const bw = Math.min(1920, w + pad * 2);
      const bh = Math.min(1080, h + pad * 2);

      if (!threshCanvas) {
        threshCanvas = document.createElement('canvas');
        threshCtx = threshCanvas.getContext('2d', { willReadFrequently: true });
        glowCanvas = document.createElement('canvas');
        glowCtx = glowCanvas.getContext('2d');
        chromaCanvas = document.createElement('canvas');
        chromaCtx = chromaCanvas.getContext('2d');
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

      // 1. Draw source layer centered in padded threshCanvas
      try {
        threshCtx.drawImage(el, pad, pad, w, h);
      } catch (_) {
        return;
      }

      // 2. Apply Threshold and Tint modulation
      const imgData = threshCtx.getImageData(0, 0, bw, bh);
      const data = imgData.data;
      const rgb = hexToRgb(tintColor);
      const isWhiteTint = (rgb.r >= 250 && rgb.g >= 250 && rgb.b >= 250);
      const threshVal = threshold * 255;

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a <= 3) continue;

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        if (threshVal > 0) {
          if (luma < threshVal) {
            data[i + 3] = 0;
            continue;
          }
          // Smooth knee falloff above threshold
          const knee = (luma - threshVal) / Math.max(1, 255 - threshVal);
          data[i + 3] = Math.round(a * knee);
        }

        if (!isWhiteTint) {
          data[i] = Math.round((r * rgb.r) / 255);
          data[i + 1] = Math.round((g * rgb.g) / 255);
          data[i + 2] = Math.round((b * rgb.b) / 255);
        }
      }
      threshCtx.putImageData(imgData, 0, 0);

      // 3. Multi-Octave Inverse-Square Falloff Bloom Pyramid (5 octaves)
      const octaves = 5;
      const aspectScaleX = aspect > 0 ? (1 + aspect * 1.5) : (1 / (1 + Math.abs(aspect) * 1.5));
      const aspectScaleY = aspect < 0 ? (1 + Math.abs(aspect) * 1.5) : (1 / (1 + aspect * 1.5));

      glowCtx.globalCompositeOperation = 'lighter';

      for (let oct = 0; oct < octaves; oct++) {
        const octRadius = radius * Math.pow(1.8, oct) * 0.25;
        const blurX = Math.max(1, Math.round(octRadius * aspectScaleX));
        const blurY = Math.max(1, Math.round(octRadius * aspectScaleY));

        // Weight decreases by inverse-square law
        const weight = (1.0 / Math.pow(oct + 1.2, falloff)) * exposure;
        if (weight <= 0.005) continue;

        glowCtx.save();
        glowCtx.filter = `blur(${Math.max(blurX, blurY)}px)`;
        glowCtx.globalAlpha = Math.min(1.0, weight);

        // Aspect stretch via scale
        if (Math.abs(aspect) > 0.02) {
          const centerX = bw / 2;
          const centerY = bh / 2;
          glowCtx.translate(centerX, centerY);
          glowCtx.scale(aspectScaleX, aspectScaleY);
          glowCtx.drawImage(threshCanvas, -centerX, -centerY);
        } else {
          glowCtx.drawImage(threshCanvas, 0, 0);
        }
        glowCtx.restore();
      }

      // 4. Chromatic Aberration Shift on Glow Buffer (Red and Blue channel separation)
      let finalGlowSource = glowCanvas;
      if (chromatic > 0.5) {
        chromaCtx.clearRect(0, 0, bw, bh);

        // Draw Green / Master in center
        chromaCtx.globalAlpha = 1.0;
        chromaCtx.drawImage(glowCanvas, 0, 0);

        // Composite Red shifted left
        chromaCtx.save();
        chromaCtx.globalCompositeOperation = 'screen';
        chromaCtx.filter = 'brightness(1.1)';
        chromaCtx.drawImage(glowCanvas, -chromatic, 0);
        // Composite Blue shifted right
        chromaCtx.drawImage(glowCanvas, chromatic, 0);
        chromaCtx.restore();

        finalGlowSource = chromaCanvas;
      }

      // 5. Draw to Target Canvas
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
        ctx.drawImage(finalGlowSource, x - pad, y - pad, bw, bh);
      } catch (_) {}

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
