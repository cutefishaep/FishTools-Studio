(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgba(hex, alpha) {
    let c = (hex || '#000000').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  reg.register({
    id: 'drop-shadow',
    name: 'Drop Shadow',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Cast dynamic drop shadow behind layer with distance, angle, blur, and opacity',
    params: [
      { id: 'color', label: 'Color', type: 'color', default: '#000000' },
      { id: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 100, default: 75, unit: '%' },
      { id: 'distance', label: 'Distance', type: 'number', min: 0, max: 200, default: 15, unit: 'px' },
      { id: 'angle', label: 'Angle', type: 'angle', default: 135, unit: '°' },
      { id: 'blur', label: 'Blur', type: 'number', min: 0, max: 100, default: 10, unit: 'px' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      const op = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 75) / 100));
      const angle = ((fx.angle !== undefined ? fx.angle : 135) * Math.PI) / 180;
      const dist = fx.distance !== undefined ? fx.distance : 15;
      const blur = Math.max(0, fx.blur !== undefined ? fx.blur : 10);
      const ox = Math.cos(angle) * dist;
      const oy = Math.sin(angle) * dist;
      const color = fx.color || '#000000';

      ctx.save();
      if (op > 0 && (blur > 0 || dist > 0)) {
        ctx.shadowColor = hexToRgba(color, op);
        ctx.shadowBlur = blur;
        ctx.shadowOffsetX = ox;
        ctx.shadowOffsetY = oy;
      }
      try {
        ctx.drawImage(el, x, y, w, h);
      } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
