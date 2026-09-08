(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'color-temperature',
    name: 'Color Temperature',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Adjust warm/cool Kelvin tone and tint shift',
    params: [
      { id: 'temperature', label: 'Temperature', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'tint', label: 'Tint', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    renderPost(ctx, el, layer, bounds, fx) {
      const temp = (fx.temperature || 0) / 100;
      const tint = (fx.tint || 0) / 100;
      if (temp === 0 && tint === 0) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      if (temp > 0) {
        ctx.fillStyle = `rgba(255, 170, 50, ${Math.min(1, temp * 0.7)})`;
        ctx.fillRect(x, y, w, h);
      } else if (temp < 0) {
        ctx.fillStyle = `rgba(50, 150, 255, ${Math.min(1, Math.abs(temp) * 0.7)})`;
        ctx.fillRect(x, y, w, h);
      }
      if (tint > 0) {
        ctx.fillStyle = `rgba(255, 50, 200, ${Math.min(1, tint * 0.6)})`;
        ctx.fillRect(x, y, w, h);
      } else if (tint < 0) {
        ctx.fillStyle = `rgba(50, 255, 100, ${Math.min(1, Math.abs(tint) * 0.6)})`;
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
