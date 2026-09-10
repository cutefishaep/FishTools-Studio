(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgba(hex, alpha) {
    let c = (hex || '#00e5ff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
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

  reg.register({
    id: 'grid',
    name: 'Grid',
    category: 'background',
    icon: 'assets/FXPH.svg',
    description: 'Procedural geometric grid generator with customizable spacing, border width, and anchor offset',
    params: [
      { id: 'size', label: 'Size', type: 'number', min: 10, max: 400, default: 60, unit: 'px' },
      { id: 'border', label: 'Border', type: 'number', min: 1, max: 20, default: 2, unit: 'px' },
      { id: 'color', label: 'Color', type: 'color', default: '#00e5ff' },
      { id: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 100, default: 80, unit: '%' },
      { id: 'anchorX', label: 'Anchor X', type: 'number', min: -500, max: 500, default: 0, unit: 'px' },
      { id: 'anchorY', label: 'Anchor Y', type: 'number', min: -500, max: 500, default: 0, unit: 'px' },
      { id: 'speedX', label: 'Scroll Speed X', type: 'number', min: -500, max: 500, default: 0, unit: 'px/s' },
      { id: 'speedY', label: 'Scroll Speed Y', type: 'number', min: -500, max: 500, default: 0, unit: 'px/s' },
      { id: 'invert', label: 'Invert Grid', type: 'switch', min: 0, max: 1, default: 0 },
      { id: 'overlay', label: 'Overlay on Layer', type: 'switch', min: 0, max: 1, default: 0 }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const overlay = (fx.overlay === 1 || fx.overlay === true);
      if (el && overlay) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      }

      const curTime = getCurrentTime(layer, currentSec);
      const size = Math.max(5, fx.size !== undefined ? fx.size : 60);
      const border = Math.max(1, fx.border !== undefined ? fx.border : 2);
      const op = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 80) / 100));
      const colorStr = hexToRgba(fx.color || '#00e5ff', op);
      const sx = (fx.speedX || 0) * curTime;
      const sy = (fx.speedY || 0) * curTime;
      const ax = ((fx.anchorX || 0) + sx) % size;
      const ay = ((fx.anchorY || 0) + sy) % size;
      const invert = (fx.invert === 1 || fx.invert === true);

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      if (invert) {
        // Solid background with transparent grid holes
        ctx.fillStyle = colorStr;
        ctx.fillRect(x, y, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        const halfB = border / 2;
        const startX = x + ax;
        const startY = y + ay;
        for (let gx = startX - size; gx < x + w + size; gx += size) {
          for (let gy = startY - size; gy < y + h + size; gy += size) {
            ctx.clearRect(gx + halfB, gy + halfB, size - border, size - border);
          }
        }
      } else {
        // Crisp vector grid lines
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = border;
        ctx.beginPath();

        const startX = x + ((ax % size + size) % size);
        for (let gx = startX; gx <= x + w; gx += size) {
          ctx.moveTo(Math.round(gx) + 0.5, y);
          ctx.lineTo(Math.round(gx) + 0.5, y + h);
        }

        const startY = y + ((ay % size + size) % size);
        for (let gy = startY; gy <= y + h; gy += size) {
          ctx.moveTo(x, Math.round(gy) + 0.5);
          ctx.lineTo(x + w, Math.round(gy) + 0.5);
        }
        ctx.stroke();
      }

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
