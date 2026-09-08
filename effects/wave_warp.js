(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // Reusable offscreen buffer to avoid memory allocations and garbage collection overhead
  let _waveBuf = null;
  let _waveBufCtx = null;

  function getWaveBuffer(w, h) {
    if (typeof document === 'undefined') return null;
    if (!_waveBuf) {
      _waveBuf = document.createElement('canvas');
      _waveBufCtx = _waveBuf.getContext('2d');
    }
    const rw = Math.max(1, Math.ceil(w));
    const rh = Math.max(1, Math.ceil(h));
    if (_waveBuf.width !== rw || _waveBuf.height !== rh) {
      _waveBuf.width = rw;
      _waveBuf.height = rh;
    }
    return { canvas: _waveBuf, ctx: _waveBufCtx };
  }

  reg.register({
    id: 'wave-warp',
    name: 'Wave Warp',
    category: 'warp',
    icon: 'assets/FXPH.svg',
    description: 'After Effects style wave distortion with true 360° arbitrary direction and continuous sine/triangle/square warping',
    params: [
      { id: 'waveType', label: 'Wave Type', type: 'select', default: 'sine', options: ['sine', 'triangle', 'square', 'sawtooth'] },
      { id: 'waveHeight', label: 'Wave Height', type: 'number', min: 0, max: 200, default: 25, unit: 'px' },
      { id: 'waveWidth', label: 'Wave Width', type: 'number', min: 10, max: 2000, default: 120, unit: 'px' },
      { id: 'direction', label: 'Direction', type: 'number', min: 0, max: 360, default: 0, unit: '°' },
      { id: 'speed', label: 'Wave Speed', type: 'number', min: -10, max: 10, default: 1, step: 0.05, unit: 'x' },
      { id: 'phase', label: 'Phase', type: 'number', min: 0, max: 360, default: 0, unit: '°' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      const height = fx && fx.waveHeight !== undefined ? fx.waveHeight : 25;
      if (height === 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const width = Math.max(10, fx && fx.waveWidth !== undefined ? fx.waveWidth : 120);
      const type = (fx && fx.waveType ? fx.waveType : 'sine').toLowerCase();
      const dirDeg = fx && fx.direction !== undefined ? fx.direction : 0;
      const speed = fx && fx.speed !== undefined ? fx.speed : 1;
      const phaseDeg = fx && fx.phase !== undefined ? fx.phase : 0;

      let curSec = 0;
      if (typeof window !== 'undefined') {
        if (typeof window.getCurrentPlayheadTime === 'function') curSec = window.getCurrentPlayheadTime();
        else if (window.currentFrame !== undefined && window.currentFps) curSec = window.currentFrame / window.currentFps;
        else if (window.timelinePanX !== undefined) curSec = Math.abs(window.timelinePanX) / (window.currentPixelsPerSecond || 80);
      }
      const layerStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
      const t = curSec - layerStart;

      // Positive speed moves the wave forward along the direction vector
      const phaseRad = (phaseDeg * Math.PI / 180) - (t * speed * Math.PI * 2);
      const dirRad = (dirDeg * Math.PI) / 180;

      function getWave(val) {
        const p = (val / width) * Math.PI * 2 + phaseRad;
        if (type === 'triangle') {
          const s = Math.max(-1, Math.min(1, Math.sin(p)));
          return Math.asin(s) * (2 / Math.PI);
        } else if (type === 'square') {
          return Math.sin(p) >= 0 ? 1 : -1;
        } else if (type === 'sawtooth') {
          const norm = ((p / (Math.PI * 2)) % 1 + 1) % 1;
          return norm * 2 - 1;
        }
        return Math.sin(p);
      }

      // True continuous 2D arbitrary rotation transformation:
      // Rotates layer into wave propagation coordinate space, applies perpendicular slice displacement,
      // and transforms back seamlessly. Zero angle snapping or stair-stepping seams.
      const cosA = Math.abs(Math.cos(dirRad));
      const sinA = Math.abs(Math.sin(dirRad));
      const spanW = Math.ceil(w * cosA + h * sinA);
      const spanH = Math.ceil(w * sinA + h * cosA);

      // Extra padding for wave displacement peaks to prevent clipping
      const padY = Math.ceil(Math.abs(height) * 2) + 4;
      const totalW = spanW + 4;
      const totalH = spanH + padY;

      const buf = getWaveBuffer(totalW, totalH);
      if (!buf || !buf.ctx) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const bCanvas = buf.canvas;
      const bCtx = buf.ctx;

      // Render source layer into buffer centered and pre-rotated by -dirRad
      bCtx.clearRect(0, 0, totalW, totalH);
      bCtx.save();
      bCtx.translate(totalW / 2, totalH / 2);
      bCtx.rotate(-dirRad);
      bCtx.imageSmoothingEnabled = true;
      try {
        bCtx.drawImage(el, -w / 2, -h / 2, w, h);
      } catch (_) {
        bCtx.restore();
        try { ctx.drawImage(el, x, y, w, h); } catch (e) {}
        return;
      }
      bCtx.restore();

      // Transform target context: centered at (cx, cy) and rotated by +dirRad
      const cx = x + w / 2;
      const cy = y + h / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(dirRad);

      // Slicing parameters: fine subpixel slice width with slight overlap to guarantee 0 seam lines/gaps
      const sliceW = spanW > 1400 ? 2 : (spanW > 700 ? 1.5 : 1);
      const overlap = 0.65; // Subpixel overlap prevents anti-aliasing seam bleed through
      const startSx = Math.max(0, Math.floor((totalW - spanW) / 2));
      const endSx = Math.min(totalW, Math.ceil((totalW + spanW) / 2));

      for (let sx = startSx; sx < endSx; sx += sliceW) {
        const sw = Math.min(sliceW, endSx - sx);
        const u = (sx + sw / 2) - (totalW / 2);
        const wave = getWave(u);
        const dy = wave * height;

        ctx.drawImage(
          bCanvas,
          sx, 0, sw, totalH,
          sx - totalW / 2, -totalH / 2 + dy, sw + overlap, totalH
        );
      }

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
