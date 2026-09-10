(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgb(hex) {
    let c = (hex || '#ff0066').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function getCurrentTime(layer, currentSec) {
    if (typeof currentSec === 'number' && !isNaN(currentSec)) return currentSec;
    if (layer && typeof layer._currentSec === 'number' && !isNaN(layer._currentSec)) return layer._currentSec;
    if (layer && typeof layer._timeInClip === 'number' && !isNaN(layer._timeInClip)) return layer._timeInClip;
    if (typeof window !== 'undefined') {
      if (typeof window.currentPlaybackSec === 'number' && !isNaN(window.currentPlaybackSec)) return window.currentPlaybackSec;
      if (typeof window.currentSec === 'number' && !isNaN(window.currentSec)) return window.currentSec;
      if (typeof window.getCurrentPlayheadTime === 'function') {
        const pt = window.getCurrentPlayheadTime();
        if (typeof pt === 'number' && !isNaN(pt)) return pt;
      }
      const pps = window.currentPixelsPerSecond || 80;
      const panX = window.timelinePanX !== undefined ? Math.min(0, window.timelinePanX) : 0;
      return Math.max(0, -panX) / pps;
    }
    return 0;
  }

  let maskCanvas = null;
  let maskCtx = null;
  let fluxCanvas = null;
  let fluxCtx = null;

  reg.register({
    id: 'solid-aura',
    name: 'Solid Aura (Flux)',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Solid alpha outline filled with dynamic turbulent texture flux animation like Sapphire S_TextureFlux',
    params: [
      { id: 'thickness', label: 'Thickness', type: 'number', min: 2, max: 80, default: 16, unit: 'px' },
      { id: 'fluxScale', label: 'Flux Scale', type: 'number', min: 10, max: 150, default: 45 },
      { id: 'fluxSpeed', label: 'Flux Speed', type: 'number', min: 0, max: 200, default: 60 },
      { id: 'color1', label: 'Flux Color 1', type: 'color', default: '#ff0066' },
      { id: 'color2', label: 'Flux Color 2', type: 'color', default: '#00f0ff' },
      { id: 'roughness', label: 'Roughness', type: 'number', min: 1, max: 5, default: 3 },
      { id: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 100, default: 100, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const thick = Math.max(2, fx.thickness !== undefined ? fx.thickness : 16);
      const scale = Math.max(5, fx.fluxScale !== undefined ? fx.fluxScale : 45);
      const speed = (fx.fluxSpeed !== undefined ? fx.fluxSpeed : 60) * 0.03;
      const c1 = hexToRgb(fx.color1 || '#ff0066');
      const c2 = hexToRgb(fx.color2 || '#00f0ff');
      const rough = Math.max(1, Math.min(5, Math.round(fx.roughness !== undefined ? fx.roughness : 3)));
      const op = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 100) / 100));

      if (op <= 0.001) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const pad = Math.round(thick + 4);
      const bw = Math.min(1280, Math.round(w + pad * 2));
      const bh = Math.min(720, Math.round(h + pad * 2));

      if (!maskCanvas) {
        maskCanvas = document.createElement('canvas');
        maskCtx = maskCanvas.getContext('2d');
        fluxCanvas = document.createElement('canvas');
        fluxCtx = fluxCanvas.getContext('2d');
      }
      if (maskCanvas.width !== bw || maskCanvas.height !== bh) {
        maskCanvas.width = bw;
        maskCanvas.height = bh;
        fluxCanvas.width = bw;
        fluxCanvas.height = bh;
      }

      maskCtx.clearRect(0, 0, bw, bh);
      fluxCtx.clearRect(0, 0, bw, bh);

      // 1. Build dilated outline mask in maskCanvas
      // Draw 8-way directional dilation
      const steps = Math.ceil(thick);
      for (let s = 1; s <= steps; s += 2) {
        const rad = (s / steps) * thick;
        for (let a = 0; a < 8; a++) {
          const ang = (a * Math.PI) / 4;
          const ox = Math.cos(ang) * rad;
          const oy = Math.sin(ang) * rad;
          try {
            maskCtx.drawImage(el, pad + ox, pad + oy, w, h);
          } catch (_) {}
        }
      }

      // Cut out the inner core so only the outline ring remains
      maskCtx.globalCompositeOperation = 'destination-out';
      try {
        maskCtx.drawImage(el, pad, pad, w, h);
      } catch (_) {}
      maskCtx.globalCompositeOperation = 'source-over';

      // 2. Synthesize animated texture flux inside fluxCanvas
      const curTime = getCurrentTime(layer, currentSec);
      const t = curTime * speed;

      // Downsample simulation grid for 60fps realtime responsiveness
      const resStep = (bw > 640 || bh > 480) ? 4 : 2;
      const simW = Math.ceil(bw / resStep);
      const simH = Math.ceil(bh / resStep);

      const imgData = fluxCtx.createImageData(simW, simH);
      const data = imgData.data;

      const invScale = 1.0 / scale;
      for (let py = 0; py < simH; py++) {
        const ny = (py * resStep) * invScale;
        const rowIdx = py * simW * 4;
        for (let px = 0; px < simW; px++) {
          const nx = (px * resStep) * invScale;

          // Multi-octave swirling turbulence (flux currents)
          let val = 0;
          let amp = 1.0;
          let freq = 1.0;
          for (let oct = 0; oct < rough; oct++) {
            const sx = Math.sin(nx * freq + Math.cos(ny * freq + t * 0.8));
            const sy = Math.cos(ny * freq + Math.sin(nx * freq - t * 0.6));
            val += (sx * sy) * amp;
            amp *= 0.5;
            freq *= 2.1;
          }

          // Normalize to [0, 1]
          const norm = Math.max(0, Math.min(1, val * 0.5 + 0.5));

          const r = Math.round(c1[0] + (c2[0] - c1[0]) * norm);
          const g = Math.round(c1[1] + (c2[1] - c1[1]) * norm);
          const b = Math.round(c1[2] + (c2[2] - c1[2]) * norm);

          const idx = rowIdx + px * 4;
          data[idx + 0] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }

      fluxCtx.putImageData(imgData, 0, 0);

      // Mask flux texture with the dilated outline ring
      fluxCtx.globalCompositeOperation = 'destination-in';
      fluxCtx.drawImage(maskCanvas, 0, 0, simW, simH);
      fluxCtx.globalCompositeOperation = 'source-over';

      // 3. Composite final result: flux outline behind layer
      ctx.save();
      if (op < 1.0) ctx.globalAlpha = op;
      try {
        ctx.drawImage(fluxCanvas, 0, 0, simW, simH, x - pad, y - pad, bw, bh);
      } catch (_) {}

      // Draw original sharp layer on top
      try {
        ctx.drawImage(el, x, y, w, h);
      } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
