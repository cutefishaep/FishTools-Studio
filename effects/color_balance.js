(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'color-balance',
    name: 'Color Balance',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Adjust individual Red, Green, and Blue color channels',
    params: [
      { id: 'red', label: 'Red', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'green', label: 'Green', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'blue', label: 'Blue', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    renderPost(ctx, el, layer, bounds, fx) {
      const r = (fx.red || 0) / 100;
      const g = (fx.green || 0) / 100;
      const b = (fx.blue || 0) / 100;
      if (r === 0 && g === 0 && b === 0) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      ctx.save();
      ctx.globalCompositeOperation = 'color';
      const rVal = Math.round(128 + r * 127);
      const gVal = Math.round(128 + g * 127);
      const bVal = Math.round(128 + b * 127);
      ctx.fillStyle = `rgb(${rVal}, ${gVal}, ${bVal})`;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
