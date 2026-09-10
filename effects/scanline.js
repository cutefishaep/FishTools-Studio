(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgba(hex, alpha) {
    let c = (hex || '#000000').replace('#', '');
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
    id: 'scanline',
    name: 'Scanline',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Retro CRT monitor scanlines with scrolling animation, configurable spacing and opacity',
    params: [
      { id: 'lineWidth', label: 'Line Width', type: 'number', min: 1, max: 20, default: 2, unit: 'px' },
      { id: 'spacing', label: 'Spacing', type: 'number', min: 1, max: 40, default: 4, unit: 'px' },
      { id: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 100, default: 45, unit: '%' },
      { id: 'speed', label: 'Scroll Speed', type: 'number', min: -200, max: 200, default: 25, unit: 'px/s' },
      { id: 'color', label: 'Line Color', type: 'color', default: '#000000' },
      { id: 'blendMode', label: 'Blend Mode', type: 'select', options: ['multiply', 'source-over', 'overlay'], default: 'multiply' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      if (el) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      }

      const lineW = Math.max(1, fx.lineWidth !== undefined ? fx.lineWidth : 2);
      const spacing = Math.max(1, fx.spacing !== undefined ? fx.spacing : 4);
      const op = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 45) / 100));
      if (op <= 0.001) return;

      const speed = fx.speed !== undefined ? fx.speed : 25;
      const color = fx.color || '#000000';
      const blend = fx.blendMode || 'multiply';

      const curTime = getCurrentTime(layer, currentSec);

      const period = lineW + spacing;
      const scrollOffset = ((curTime * speed) % period + period) % period;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      if (blend && blend !== 'normal') {
        ctx.globalCompositeOperation = blend;
      }
      ctx.fillStyle = hexToRgba(color, op);

      const startY = y - period + scrollOffset;
      for (let cy = startY; cy < y + h; cy += period) {
        const drawY = Math.max(y, cy);
        const drawH = Math.min(y + h - drawY, lineW - (drawY - cy));
        if (drawH > 0) {
          ctx.fillRect(x, drawY, w, drawH);
        }
      }

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
