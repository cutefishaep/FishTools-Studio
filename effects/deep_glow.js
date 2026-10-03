(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // Reusable GPU offscreen buffers for zero-allocation performance
  let _threshCanvas = null;
  let _threshCtx = null;
  let _glowCanvas = null;
  let _glowCtx = null;
  let _tintCanvas = null;
  let _tintCtx = null;

  function getBuffers(w, h) {
    if (typeof document === 'undefined') return null;
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));

    if (!_threshCanvas) {
      _threshCanvas = document.createElement('canvas');
      _threshCtx = _threshCanvas.getContext('2d');
      _glowCanvas = document.createElement('canvas');
      _glowCtx = _glowCanvas.getContext('2d');
      _tintCanvas = document.createElement('canvas');
      _tintCtx = _tintCanvas.getContext('2d');
    }

    if (_threshCanvas.width !== rw || _threshCanvas.height !== rh) {
      _threshCanvas.width = rw;
      _threshCanvas.height = rh;
      _glowCanvas.width = rw;
      _glowCanvas.height = rh;
      _tintCanvas.width = rw;
      _tintCanvas.height = rh;
    }

    return {
      threshCanvas: _threshCanvas,
      threshCtx: _threshCtx,
      glowCanvas: _glowCanvas,
      glowCtx: _glowCtx,
      tintCanvas: _tintCanvas,
      tintCtx: _tintCtx
    };
  }

  reg.register({
    id: 'deep-glow',
    name: 'Deep Glow',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    isExpanding: false, // Strictly layer-bounded: glow never spills outside layer bounds
    params: [
      { id: 'radius', label: 'Radius', type: 'number', min: 2, max: 400, default: 80, unit: 'px' },
      { id: 'exposure', label: 'Exposure', type: 'number', min: 10, max: 500, default: 150, unit: '%' },
      { id: 'coreBoost', label: 'Core Intensity', type: 'number', min: 50, max: 500, default: 200, unit: '%' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'saturation', label: 'Saturation', type: 'number', min: 50, max: 300, default: 150, unit: '%' },
      { id: 'color', label: 'Glow Color', type: 'color', default: '#ffffff' },
      { id: 'tintStrength', label: 'Tint Amount', type: 'number', min: 0, max: 100, default: 100, unit: '%' },
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

      const radius = Math.max(2, fx.radius !== undefined ? Number(fx.radius) : 80);
      const exposure = Math.max(0.1, (fx.exposure !== undefined ? Number(fx.exposure) : 150) / 100);
      const coreBoost = Math.max(0.5, (fx.coreBoost !== undefined ? Number(fx.coreBoost) : 200) / 100);
      const threshold = Math.max(0, Math.min(100, fx.threshold !== undefined ? Number(fx.threshold) : 0));
      const saturation = Math.max(50, Math.min(300, fx.saturation !== undefined ? Number(fx.saturation) : 150));
      const tintColor = fx.color || '#ffffff';
      const tintStrength = Math.max(0, Math.min(100, fx.tintStrength !== undefined ? Number(fx.tintStrength) : 100)) / 100;
      const blendMode = fx.blendMode || 'screen';
      const glowOnly = !!fx.glowOnly;
      const opacity = Math.max(0, Math.min(100, fx.opacity !== undefined ? Number(fx.opacity) : 100)) / 100;

      if (opacity <= 0.001) {
        if (!glowOnly) {
          try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        }
        return;
      }

      const bufs = getBuffers(w, h);
      if (!bufs) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const { threshCanvas, threshCtx, glowCanvas, glowCtx, tintCanvas, tintCtx } = bufs;

      threshCtx.clearRect(0, 0, w, h);
      glowCtx.clearRect(0, 0, w, h);

      // 1. Highlight / Source Extraction on GPU (Zero CPU getImageData)
      if (threshold > 1) {
        const tNorm = threshold / 100;
        const contrastVal = Math.round((1.0 + tNorm * 2.2) * 100);
        const brightVal = Math.round(Math.max(0.1, 1.0 - tNorm * 0.75) * 100);
        threshCtx.filter = `contrast(${contrastVal}%) brightness(${brightVal}%)`;
      } else {
        threshCtx.filter = 'none';
      }

      try {
        threshCtx.drawImage(el, 0, 0, w, h);
      } catch (_) {
        return;
      }
      threshCtx.filter = 'none';

      // 2. 4-Tier Deep Optical Bloom Hierarchy
      // Tier 1 (Core): Tight 2-4px radius keeps small particles, stars, and small layers burning hot and vivid
      // Tier 2 (Radiance): Inner saturated aura
      // Tier 3 (Mid Bloom): Smooth atmospheric falloff
      // Tier 4 (Deep Aura): Expansive cinematic haze
      const tiers = [
        {
          r: Math.max(1.5, radius * 0.04),
          weight: Math.min(2.0, coreBoost * exposure * 1.5),
          filter: `brightness(220%) saturate(${saturation}%)`
        },
        {
          r: Math.max(5.0, radius * 0.16),
          weight: Math.min(1.5, exposure * 0.85),
          filter: `brightness(150%) saturate(${saturation}%)`
        },
        {
          r: Math.max(14.0, radius * 0.45),
          weight: Math.min(1.2, exposure * 0.50),
          filter: `brightness(120%) saturate(${saturation}%)`
        },
        {
          r: Math.max(30.0, radius * 1.00),
          weight: Math.min(1.0, exposure * 0.28),
          filter: `brightness(100%) saturate(${saturation}%)`
        }
      ];

      glowCtx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        if (tier.weight <= 0.01) continue;

        glowCtx.save();
        glowCtx.globalAlpha = Math.min(1.0, tier.weight);
        glowCtx.filter = `blur(${tier.r.toFixed(1)}px) ${tier.filter}`;
        glowCtx.drawImage(threshCanvas, 0, 0);
        glowCtx.restore();
      }

      glowCtx.globalCompositeOperation = 'source-over';
      glowCtx.filter = 'none';

      // 3. GPU Color Tinting (Instant, zero CPU readback)
      const isWhite = (!tintColor || tintColor.toLowerCase() === '#ffffff' || tintColor.toLowerCase() === '#fff');
      if (!isWhite && tintStrength > 0.01) {
        tintCtx.clearRect(0, 0, w, h);
        tintCtx.drawImage(glowCanvas, 0, 0);
        tintCtx.globalCompositeOperation = 'source-in';
        tintCtx.fillStyle = tintColor;
        tintCtx.fillRect(0, 0, w, h);
        tintCtx.globalCompositeOperation = 'source-over';

        glowCtx.save();
        glowCtx.globalAlpha = tintStrength;
        glowCtx.globalCompositeOperation = 'source-over';
        glowCtx.drawImage(tintCanvas, 0, 0);
        glowCtx.restore();
      }

      // 4. Draw to Canvas with STRICT LAYER BOUNDARY CLIPPING
      // Guarantees 100% that glow NEVER bleeds outside the layer boundary (including adjustment layers)
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      if (!glowOnly) {
        try {
          ctx.drawImage(el, x, y, w, h);
        } catch (_) {}
      }

      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = (blendMode === 'lighter' ? 'lighter' : (blendMode === 'source-over' ? 'source-over' : 'screen'));
      ctx.drawImage(glowCanvas, x, y, w, h);

      ctx.restore();
    }
  });

})(typeof window !== 'undefined' ? window : this);
