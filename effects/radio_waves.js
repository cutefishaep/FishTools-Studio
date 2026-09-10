(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgba(hex, alpha) {
    let c = (hex || '#00ffcc').replace('#', '');
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

  function drawPolygon(ctx, cx, cy, radius, sides, rotRad) {
    if (sides < 3) {
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      return;
    }
    const step = (Math.PI * 2) / sides;
    for (let i = 0; i < sides; i++) {
      const a = rotRad + i * step;
      const px = cx + Math.cos(a) * radius;
      const py = cy + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawStar(ctx, cx, cy, outerR, innerR, points, rotRad) {
    const step = Math.PI / points;
    for (let i = 0; i < points * 2; i++) {
      const r = (i % 2 === 0) ? outerR : innerR;
      const a = rotRad + i * step;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  reg.register({
    id: 'radio-waves',
    name: 'Radio Waves',
    category: 'background',
    icon: 'assets/FXPH.svg',
    description: 'Concentric expanding waves emitting outward like After Effects Radio Waves',
    params: [
      { id: 'frequency', label: 'Frequency', type: 'number', min: 0.2, max: 10, default: 1.5, unit: 'w/s' },
      { id: 'expansion', label: 'Expansion Speed', type: 'number', min: 10, max: 400, default: 80, unit: 'px/s' },
      { id: 'lifespan', label: 'Lifespan', type: 'number', min: 0.5, max: 10, default: 3.0, unit: 's' },
      { id: 'shape', label: 'Shape', type: 'select', options: ['circle', 'polygon', 'star'], default: 'circle' },
      { id: 'sides', label: 'Sides', type: 'number', min: 3, max: 12, default: 5 },
      { id: 'startWidth', label: 'Start Width', type: 'number', min: 1, max: 30, default: 2, unit: 'px' },
      { id: 'endWidth', label: 'End Width', type: 'number', min: 1, max: 60, default: 8, unit: 'px' },
      { id: 'color', label: 'Color', type: 'color', default: '#00ffcc' },
      { id: 'startOpacity', label: 'Start Opacity', type: 'number', min: 0, max: 100, default: 100, unit: '%' },
      { id: 'endOpacity', label: 'End Opacity', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'spin', label: 'Spin Rate', type: 'number', min: -360, max: 360, default: 15, unit: '°/s' },
      { id: 'centerX', label: 'Center X', type: 'number', min: -500, max: 500, default: 0, unit: 'px' },
      { id: 'centerY', label: 'Center Y', type: 'number', min: -500, max: 500, default: 0, unit: 'px' }
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

      const freq = Math.max(0.1, fx.frequency !== undefined ? fx.frequency : 1.5);
      const expansion = Math.max(5, fx.expansion !== undefined ? fx.expansion : 80);
      const lifespan = Math.max(0.2, fx.lifespan !== undefined ? fx.lifespan : 3.0);
      const shape = fx.shape || 'circle';
      const sides = Math.max(3, Math.min(16, Math.round(fx.sides !== undefined ? fx.sides : 5)));
      const startW = Math.max(0.5, fx.startWidth !== undefined ? fx.startWidth : 2);
      const endW = Math.max(0.5, fx.endWidth !== undefined ? fx.endWidth : 8);
      const color = fx.color || '#00ffcc';
      const startOp = Math.max(0, Math.min(1, (fx.startOpacity !== undefined ? fx.startOpacity : 100) / 100));
      const endOp = Math.max(0, Math.min(1, (fx.endOpacity !== undefined ? fx.endOpacity : 0) / 100));
      const spin = fx.spin !== undefined ? fx.spin : 15;

      const emX = x + w / 2 + (fx.centerX || 0);
      const emY = y + h / 2 + (fx.centerY || 0);

      const curTime = getCurrentTime(layer, currentSec);
      const layerStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
      const t = curTime - layerStart;

      // Continuous wave emission with pre-roll so waves radiate smoothly at all times
      const waveInterval = 1.0 / freq;
      const maxWaves = Math.ceil(lifespan * freq) + 3;
      const latestWaveIndex = Math.floor(t * freq);

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      for (let i = 0; i <= maxWaves; i++) {
        const waveIdx = latestWaveIndex - i;
        const waveBirthTime = waveIdx * waveInterval;
        const waveAge = t - waveBirthTime;

        if (waveAge < 0 || waveAge > lifespan) continue;

        const normAge = waveAge / lifespan; // [0, 1]
        const radius = waveAge * expansion;
        if (radius <= 0.5) continue;

        const currentLineWidth = startW + (endW - startW) * normAge;
        const currentOpacity = startOp + (endOp - startOp) * normAge;
        if (currentOpacity <= 0.001) continue;

        const rotAngle = ((spin * waveAge) * Math.PI) / 180;

        ctx.strokeStyle = hexToRgba(color, currentOpacity);
        ctx.lineWidth = currentLineWidth;
        ctx.beginPath();

        if (shape === 'polygon') {
          drawPolygon(ctx, emX, emY, radius, sides, rotAngle);
        } else if (shape === 'star') {
          drawStar(ctx, emX, emY, radius, radius * 0.5, sides, rotAngle);
        } else {
          ctx.arc(emX, emY, radius, 0, Math.PI * 2);
        }

        ctx.stroke();
      }

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
