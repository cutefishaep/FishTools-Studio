(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // Cached offscreen buffers
  let _srcBuf = null, _srcCtx = null;
  let _bloomBuf = null, _bloomCtx = null;
  let _haloBuf = null, _haloCtx = null;

  function ensureBuf(name, w, h) {
    if (typeof document === 'undefined') return null;
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    if (name === 'src') {
      if (!_srcBuf) { _srcBuf = document.createElement('canvas'); _srcCtx = _srcBuf.getContext('2d'); }
      if (_srcBuf.width !== rw || _srcBuf.height !== rh) { _srcBuf.width = rw; _srcBuf.height = rh; }
      return { c: _srcBuf, x: _srcCtx };
    }
    if (name === 'bloom') {
      if (!_bloomBuf) { _bloomBuf = document.createElement('canvas'); _bloomCtx = _bloomBuf.getContext('2d'); }
      if (_bloomBuf.width !== rw || _bloomBuf.height !== rh) { _bloomBuf.width = rw; _bloomBuf.height = rh; }
      return { c: _bloomBuf, x: _bloomCtx };
    }
    if (!_haloBuf) { _haloBuf = document.createElement('canvas'); _haloCtx = _haloBuf.getContext('2d'); }
    if (_haloBuf.width !== rw || _haloBuf.height !== rh) { _haloBuf.width = rw; _haloBuf.height = rh; }
    return { c: _haloBuf, x: _haloCtx };
  }

  reg.register({
    id: 'haze-flare',
    name: 'Haze / Flare',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Magic Bullet Looks style cinematic halation haze with highlight bloom bleed, warm glow, and subtle black lift',
    params: [
      { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'highlight', label: 'Highlight', type: 'number', min: 0, max: 100, default: 65, unit: '%' },
      { id: 'saturation', label: 'Saturation', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'bloom', label: 'Bloom Size', type: 'number', min: 2, max: 120, default: 35, unit: 'px' },
      { id: 'warmth', label: 'Warmth', type: 'number', min: -50, max: 50, default: 15 },
      { id: 'blackLift', label: 'Black Lift', type: 'number', min: 0, max: 50, default: 8, unit: '%' },
      { id: 'color', label: 'Tint', type: 'color', default: '#ffeedd' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      // Draw base image first — always
      try { ctx.drawImage(el, bx, by, w, h); } catch (_) {}

      const amount = Math.max(0, Math.min(100, fx && fx.amount !== undefined ? Number(fx.amount) : 50)) / 100;
      if (amount <= 0.005) return;

      const highlight = Math.max(0, Math.min(100, fx && fx.highlight !== undefined ? Number(fx.highlight) : 65)) / 100;
      const saturation = Math.max(0, Math.min(100, fx && fx.saturation !== undefined ? Number(fx.saturation) : 50)) / 100;
      const bloomSize = Math.max(2, fx && fx.bloom !== undefined ? Number(fx.bloom) : 35);
      const warmth = Math.max(-50, Math.min(50, fx && fx.warmth !== undefined ? Number(fx.warmth) : 15));
      const blackLift = Math.max(0, Math.min(50, fx && fx.blackLift !== undefined ? Number(fx.blackLift) : 8)) / 100;
      const tintColor = (fx && fx.color) || '#ffeedd';

      const src = ensureBuf('src', w, h);
      const bloom = ensureBuf('bloom', w, h);
      const halo = ensureBuf('halo', w, h);
      if (!src || !bloom || !halo) return;

      // --- PASS 1: Extract highlights with threshold ---
      // Magic Bullet style: soft threshold that preserves highlight roll-off
      bloom.x.clearRect(0, 0, w, h);
      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.isCanvasFilterSupported === 'function' && window.FishEffects.isCanvasFilterSupported()) {
        const threshContrast = 1.0 + highlight * 4.0;
        const threshBright = 0.3 + (1.0 - highlight) * 1.2;
        bloom.x.save();
        bloom.x.filter = `contrast(${threshContrast.toFixed(2)}) brightness(${threshBright.toFixed(2)}) saturate(${(0.5 + saturation * 0.8).toFixed(2)})`;
        try { bloom.x.drawImage(el, 0, 0, w, h); } catch (_) {}
        bloom.x.restore();
      } else {
        try { bloom.x.drawImage(el, 0, 0, w, h); } catch (_) {}
        if (highlight > 0.1) {
          bloom.x.save();
          bloom.x.globalCompositeOperation = 'multiply';
          const pCount = Math.min(3, Math.max(1, Math.round(highlight * 3)));
          for (let p = 0; p < pCount; p++) {
            try { bloom.x.drawImage(bloom.c, 0, 0); } catch (_) {}
          }
          bloom.x.restore();
        }
      }

      // --- PASS 2: Multi-radius halation bloom ---
      // MBL style: multiple concentric bloom passes at different radii for natural falloff
      // Small tight bloom + medium spread + large soft halo
      halo.x.clearRect(0, 0, w, h);

      const passes = [
        { radius: bloomSize * 0.3, alpha: 0.55 },  // tight core glow
        { radius: bloomSize * 0.7, alpha: 0.35 },  // medium halation spread
        { radius: bloomSize * 1.2, alpha: 0.20 },  // large soft atmospheric halo
        { radius: bloomSize * 2.0, alpha: 0.10 }   // ultra-wide subtle wash
      ];

      for (let i = 0; i < passes.length; i++) {
        const p = passes[i];
        halo.x.save();
        halo.x.globalCompositeOperation = i === 0 ? 'source-over' : 'lighter';
        halo.x.globalAlpha = p.alpha;
        if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
          window.FishEffects.drawBlurred(halo.x, bloom.c, w, h, p.radius);
        } else {
          try {
            halo.x.filter = `blur(${p.radius.toFixed(1)}px)`;
            halo.x.drawImage(bloom.c, 0, 0, w, h);
          } catch (_) {}
        }
        halo.x.restore();
      }

      // --- PASS 3: Tint the halation glow ---
      if (tintColor && tintColor.toLowerCase() !== '#ffffff') {
        halo.x.save();
        halo.x.globalCompositeOperation = 'color';
        halo.x.globalAlpha = 0.4 + saturation * 0.3;
        halo.x.fillStyle = tintColor;
        halo.x.fillRect(0, 0, w, h);
        halo.x.restore();
      }

      // --- PASS 4: Warmth shift ---
      if (Math.abs(warmth) > 0.5) {
        halo.x.save();
        halo.x.globalCompositeOperation = 'soft-light';
        const wNorm = Math.abs(warmth) / 50;
        halo.x.globalAlpha = wNorm * 0.35;
        halo.x.fillStyle = warmth > 0
          ? 'rgb(255, 180, 80)'    // warm amber
          : 'rgb(80, 160, 255)';   // cool blue
        halo.x.fillRect(0, 0, w, h);
        halo.x.restore();
      }

      // --- PASS 5: Composite halation over base with screen blend ---
      // This is the key MBL look: halation ADDS to the image, highlights bleed into darks
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1.0, amount * 1.2);
      try { ctx.drawImage(halo.c, bx, by, w, h); } catch (_) {}
      ctx.restore();

      // --- PASS 6: Subtle black lift (raises shadow floor) ---
      if (blackLift > 0.005) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = blackLift * amount;
        ctx.fillStyle = tintColor;
        ctx.fillRect(bx, by, w, h);
        ctx.restore();
      }
    }
  });
})(typeof window !== 'undefined' ? window : this);
