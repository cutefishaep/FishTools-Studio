(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // Dual-pyramid bloom: extract at 1/2 res, chain-downsample (cheap box filter, no big blurs),
  // then upsample-accumulate back up. Every octave adds a wider halo => long power-law falloff
  // (hot clipped core + saturated mid + huge soft haze) like real Deep Glow, at tiny GPU cost.
  const MAX_LEVELS = 8;
  const P = []; // downsampled source per level (level 0 = 1/2 res)
  const A = []; // accumulated glow per level
  let _tintCanvas = null;
  let _tintCtx = null;

  function makeCanvas() {
    const c = document.createElement('canvas');
    return { c, cx: c.getContext('2d') };
  }
  function sizeCanvas(c, w, h) {
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  function ensureLevels(w, h, n) {
    for (let i = 0; i < n; i++) {
      if (!P[i]) { P[i] = makeCanvas(); A[i] = makeCanvas(); }
      const lw = Math.max(1, Math.round(w / Math.pow(2, i + 1)));
      const lh = Math.max(1, Math.round(h / Math.pow(2, i + 1)));
      sizeCanvas(P[i].c, lw, lh);
      sizeCanvas(A[i].c, lw, lh);
      P[i].w = A[i].w = lw;
      P[i].h = A[i].h = lh;
    }
  }
  function getTintBuffer(w, h) {
    if (!_tintCanvas) { const t = makeCanvas(); _tintCanvas = t.c; _tintCtx = t.cx; }
    sizeCanvas(_tintCanvas, w, h);
    return { tintCanvas: _tintCanvas, tintCtx: _tintCtx };
  }
  function addLayer(cx, src, weight, sw, sh, dw, dh) {
    let wt = weight;
    while (wt > 0.01) {
      cx.globalAlpha = Math.min(1, wt);
      cx.drawImage(src, 0, 0, sw, sh, 0, 0, dw, dh);
      wt -= 1;
    }
  }

  reg.register({
    id: 'deep-glow',
    name: 'Deep Glow',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    isExpanding: false, // Bounded by default; expands via Out Layer switch (checked in pipeline)
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
      { id: 'outLayer', label: 'Out Layer', type: 'switch', default: false },
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
      const outLayer = (fx.outLayer === 1 || fx.outLayer === true || fx.outLayer === '1' || fx.outLayer === 'true' || fx.outLayer === 'on');
      const pad = outLayer ? Math.min(600, Math.ceil(radius * 1.1 + 24)) : 0;
      const ew = w + pad * 2;
      const eh = h + pad * 2;

      if (opacity <= 0.001) {
        if (!glowOnly) {
          try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        }
        return;
      }

      if (typeof document === 'undefined') {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      // Octave k covers ~ 3*2^k px of full-res blur radius. Use only octaves up to ~2x radius.
      let n = 1;
      while (n < MAX_LEVELS && 3 * Math.pow(2, n - 1) < radius * 2) n++;
      ensureLevels(ew, eh, n);

      // 1. Extraction at half res: threshold + saturation + hot boost in one GPU filter pass
      const p0 = P[0];
      const pc = p0.cx;
      pc.globalCompositeOperation = 'source-over';
      pc.globalAlpha = 1;
      pc.clearRect(0, 0, p0.w, p0.h);
      let f = '';
      if (threshold > 1) {
        const tNorm = threshold / 100;
        f += `contrast(${Math.round((1 + tNorm * 2.2) * 100)}%) brightness(${Math.round(Math.max(0.1, 1 - tNorm * 0.75) * 100)}%) `;
      }
      f += `saturate(${saturation}%) brightness(130%)`;
      pc.filter = f;
      pc.imageSmoothingEnabled = true;
      pc.imageSmoothingQuality = 'high';
      if (!outLayer) {
        try { pc.drawImage(el, 0, 0, p0.w, p0.h); } catch (_) { pc.filter = 'none'; return; }
      } else {
        const dw0 = Math.max(1, Math.round(w / 2));
        const dh0 = Math.max(1, Math.round(h / 2));
        const dx0 = Math.round((p0.w - dw0) / 2);
        const dy0 = Math.round((p0.h - dh0) / 2);
        try { pc.drawImage(el, dx0, dy0, dw0, dh0); } catch (_) { pc.filter = 'none'; return; }
      }
      pc.filter = 'none';

      // 2. Chain downsample
      for (let k = 1; k < n; k++) {
        const s = P[k - 1], d = P[k];
        d.cx.globalAlpha = 1;
        d.cx.clearRect(0, 0, d.w, d.h);
        d.cx.imageSmoothingEnabled = true;
        d.cx.imageSmoothingQuality = 'high';
        d.cx.drawImage(s.c, 0, 0, s.w, s.h, 0, 0, d.w, d.h);
      }

      // 3. Upsample-accumulate from deepest octave to shallowest, weighted with power-law falloff
      for (let k = n - 1; k >= 0; k--) {
        const a = A[k];
        const g = a.cx;
        g.globalAlpha = 1;
        g.filter = 'none';
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, a.w, a.h);
        g.globalCompositeOperation = 'lighter';
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';

        const rk = 3 * Math.pow(2, k);
        // octaves beyond radius fade out over one octave
        const rw = rk <= radius ? 1 : Math.max(0, 1 - Math.log2(rk / radius));
        let wt = exposure * Math.pow(0.78, k) * rw * 0.9;
        if (k === 0) wt *= coreBoost;
        else if (k === 1) wt *= 1 + (coreBoost - 1) * 0.5;
        if (wt > 0.01) addLayer(g, P[k].c, Math.min(wt, 4), P[k].w, P[k].h, a.w, a.h);

        if (k < n - 1) {
          const up = A[k + 1];
          g.globalAlpha = 1;
          if (k <= 1) g.filter = 'blur(1.2px)'; // hide bilinear blockiness on shallow levels only
          g.drawImage(up.c, 0, 0, up.w, up.h, 0, 0, a.w, a.h);
          g.filter = 'none';
        }
      }

      const L0 = { w: A[0].w, h: A[0].h };
      const glowCanvas = A[0].c;
      const glowCtx = A[0].cx;
      glowCtx.globalAlpha = 1;
      glowCtx.globalCompositeOperation = 'source-over';

      // 3. GPU Color Tinting (Instant, zero CPU readback)
      const isWhite = (!tintColor || tintColor.toLowerCase() === '#ffffff' || tintColor.toLowerCase() === '#fff');
      if (!isWhite && tintStrength > 0.01) {
        const { tintCanvas, tintCtx } = getTintBuffer(L0.w, L0.h);
        tintCtx.clearRect(0, 0, L0.w, L0.h);
        tintCtx.drawImage(glowCanvas, 0, 0);
        tintCtx.globalCompositeOperation = 'source-in';
        tintCtx.fillStyle = tintColor;
        tintCtx.fillRect(0, 0, L0.w, L0.h);
        tintCtx.globalCompositeOperation = 'source-over';

        glowCtx.save();
        glowCtx.globalAlpha = tintStrength;
        glowCtx.globalCompositeOperation = 'source-over';
        glowCtx.drawImage(tintCanvas, 0, 0);
        glowCtx.restore();
      }

      // 4. Draw to Canvas: strict clip in-layer, free spill when Out Layer is ON
      if (!outLayer) {
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
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(glowCanvas, x, y, w, h);

        ctx.restore();
        return;
      }

      if (!glowOnly) {
        try {
          ctx.drawImage(el, x, y, w, h);
        } catch (_) {}
      }

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = (blendMode === 'lighter' ? 'lighter' : (blendMode === 'source-over' ? 'source-over' : 'screen'));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      try {
        ctx.drawImage(glowCanvas, x - pad, y - pad, ew, eh);
      } catch (_) {}
      ctx.restore();
    }
  });

})(typeof window !== 'undefined' ? window : this);
