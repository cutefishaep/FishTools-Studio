(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // Cached offscreen buffers
  let _threshBuf = null, _threshCtx = null;
  let _streakBuf = null, _streakCtx = null;
  let _compBuf = null, _compCtx = null;

  function getBuf(name, w, h) {
    if (typeof document === 'undefined') return null;
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    let c, x;
    if (name === 'thresh') {
      if (!_threshBuf) { _threshBuf = document.createElement('canvas'); _threshCtx = _threshBuf.getContext('2d'); }
      c = _threshBuf; x = _threshCtx;
    } else if (name === 'streak') {
      if (!_streakBuf) { _streakBuf = document.createElement('canvas'); _streakCtx = _streakBuf.getContext('2d'); }
      c = _streakBuf; x = _streakCtx;
    } else {
      if (!_compBuf) { _compBuf = document.createElement('canvas'); _compCtx = _compBuf.getContext('2d'); }
      c = _compBuf; x = _compCtx;
    }
    if (c.width !== rw || c.height !== rh) { c.width = rw; c.height = rh; }
    return { c, x };
  }

  reg.register({
    id: 'anamorphic-flare',
    name: 'Anamorphic Flare',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Magic Bullet Looks style anamorphic lens flare with full-width razor-thin horizontal streaks and chromatic fringe',
    params: [
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, default: 55, unit: '%' },
      { id: 'length', label: 'Streak Length', type: 'number', min: 10, max: 100, default: 75, unit: '%' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 60, unit: '%' },
      { id: 'thickness', label: 'Thickness', type: 'number', min: 1, max: 30, default: 4, unit: 'px' },
      { id: 'tint', label: 'Tint', type: 'color', default: '#6699ff' },
      { id: 'chromatic', label: 'Chromatic Fringe', type: 'number', min: 0, max: 100, default: 35, unit: '%' },
      { id: 'blendMode', label: 'Blend', type: 'select', options: ['screen', 'lighter', 'soft-light'], default: 'screen' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      // Always draw base image first
      try { ctx.drawImage(el, bx, by, w, h); } catch (_) {}

      const intensity = Math.max(0, Math.min(100, fx && fx.intensity !== undefined ? Number(fx.intensity) : 55)) / 100;
      if (intensity <= 0.005) return;

      const lengthPct = Math.max(10, Math.min(100, fx && fx.length !== undefined ? Number(fx.length) : 75)) / 100;
      const threshold = Math.max(0, Math.min(100, fx && fx.threshold !== undefined ? Number(fx.threshold) : 60)) / 100;
      const thickness = Math.max(1, Math.min(30, fx && fx.thickness !== undefined ? Number(fx.thickness) : 4));
      const tint = (fx && fx.tint) || '#6699ff';
      const chromatic = Math.max(0, Math.min(100, fx && fx.chromatic !== undefined ? Number(fx.chromatic) : 35)) / 100;
      const blendMode = (fx && fx.blendMode) || 'screen';

      const thresh = getBuf('thresh', w, h);
      const streak = getBuf('streak', w, h);
      const comp = getBuf('comp', w, h);
      if (!thresh || !streak || !comp) return;

      // --- STEP 1: Isolate bright highlights ---
      thresh.x.clearRect(0, 0, w, h);
      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.isCanvasFilterSupported === 'function' && window.FishEffects.isCanvasFilterSupported()) {
        const contrast = 2.0 + threshold * 8.0;
        const bright = Math.max(0.1, (1.0 - threshold) * 1.5);
        thresh.x.save();
        thresh.x.filter = `contrast(${contrast.toFixed(1)}) brightness(${bright.toFixed(2)})`;
        try { thresh.x.drawImage(el, 0, 0, w, h); } catch (_) {}
        thresh.x.restore();
      } else {
        try { thresh.x.drawImage(el, 0, 0, w, h); } catch (_) {}
        if (threshold > 0.05) {
          thresh.x.save();
          thresh.x.globalCompositeOperation = 'multiply';
          const pCount = Math.min(4, Math.max(1, Math.round(threshold * 4)));
          for (let p = 0; p < pCount; p++) {
            try { thresh.x.drawImage(thresh.c, 0, 0); } catch (_) {}
          }
          thresh.x.restore();
        }
      }

      // --- STEP 2: Create FULL-WIDTH horizontal streak ---
      // The MBL anamorphic key: squash image horizontally to extreme ratio, then stretch back
      // This makes every bright pixel smear across the full frame width
      // Squash ratio determines streak length: lower = longer streak
      const squashW = Math.max(2, Math.round(w * (1.0 - lengthPct * 0.97)));
      // Vertical blur = thickness control (razor thin)
      const vBlur = Math.max(0.5, thickness * 0.5);

      streak.x.clearRect(0, 0, w, h);

      // Multi-pass streak for cinematic falloff: tight core + wide wings
      const passes = [
        { squash: squashW,                        alpha: 0.6 },   // main streak
        { squash: Math.max(1, squashW * 0.5),     alpha: 0.3 },   // wider wings
        { squash: Math.max(1, squashW * 0.25),    alpha: 0.15 }   // ultra-wide glow edge
      ];

      for (let i = 0; i < passes.length; i++) {
        const p = passes[i];
        const sw = Math.max(1, p.squash);

        streak.x.save();
        streak.x.globalCompositeOperation = i === 0 ? 'source-over' : 'lighter';
        streak.x.globalAlpha = p.alpha;
        if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.isCanvasFilterSupported === 'function' && window.FishEffects.isCanvasFilterSupported()) {
          streak.x.filter = `blur(${vBlur.toFixed(1)}px)`;
          try { streak.x.drawImage(thresh.c, 0, 0, w, h, 0, 0, sw, h); } catch (_) {}
        } else {
          try { streak.x.drawImage(thresh.c, 0, 0, w, h, 0, 0, sw, h); } catch (_) {}
          if (vBlur > 1.0 && typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
            window.FishEffects.drawBlurred(streak.x, streak.c, sw, h, vBlur);
          }
        }
        streak.x.restore();

        // Stretch the squashed result back to full width
        comp.x.clearRect(0, 0, w, h);
        try { comp.x.drawImage(streak.c, 0, 0, sw, h, 0, 0, w, h); } catch (_) {}
        // Copy stretched result back
        streak.x.save();
        streak.x.globalCompositeOperation = i === 0 ? 'source-over' : 'lighter';
        streak.x.globalAlpha = 1.0;
        streak.x.clearRect(0, 0, w, h);
        try { streak.x.drawImage(comp.c, 0, 0, w, h); } catch (_) {}
        streak.x.restore();
      }

      // --- STEP 3: Chromatic fringe ---
      // MBL anamorphic has subtle R/B fringe at streak edges
      if (chromatic > 0.01) {
        const shift = Math.round(chromatic * 8 + 2);
        comp.x.clearRect(0, 0, w, h);

        // Red channel shifted left
        comp.x.save();
        comp.x.globalCompositeOperation = 'lighter';
        comp.x.globalAlpha = chromatic * 0.25;
        comp.x.filter = 'saturate(0)'; // desaturate for channel isolation
        try { comp.x.drawImage(streak.c, -shift, 0, w, h); } catch (_) {}
        comp.x.restore();

        // Tint red shift
        comp.x.save();
        comp.x.globalCompositeOperation = 'source-atop';
        comp.x.fillStyle = 'rgb(255, 100, 80)';
        comp.x.globalAlpha = 0.7;
        comp.x.fillRect(0, 0, w, h);
        comp.x.restore();

        // Blue channel shifted right — draw on top
        comp.x.save();
        comp.x.globalCompositeOperation = 'lighter';
        comp.x.globalAlpha = chromatic * 0.2;
        comp.x.filter = 'saturate(0)';
        try { comp.x.drawImage(streak.c, shift, 0, w, h); } catch (_) {}
        comp.x.restore();

        // Add fringe to streak
        streak.x.save();
        streak.x.globalCompositeOperation = 'lighter';
        streak.x.globalAlpha = 1.0;
        try { streak.x.drawImage(comp.c, 0, 0, w, h); } catch (_) {}
        streak.x.restore();
      }

      // --- STEP 4: Tint the streak ---
      streak.x.save();
      streak.x.globalCompositeOperation = 'color';
      streak.x.globalAlpha = 0.65;
      streak.x.fillStyle = tint;
      streak.x.fillRect(0, 0, w, h);
      streak.x.restore();

      // --- STEP 5: Final composite over base ---
      ctx.save();
      ctx.globalCompositeOperation = blendMode;
      ctx.globalAlpha = Math.min(1.0, intensity * 1.3);
      try { ctx.drawImage(streak.c, bx, by, w, h); } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
