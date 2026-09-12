(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'fast-box-blur',
    name: 'Fast Box Blur',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'High performance rapid box blur pass with radius and iteration control',
    params: [
      { id: 'radius', label: 'Radius', type: 'number', min: 0, max: 100, default: 10, unit: 'px' },
      { id: 'iterations', label: 'Iterations', type: 'number', min: 1, max: 5, default: 1, unit: '' }
    ],
    filter(fx) {
      const r = Math.max(0, fx.radius !== undefined ? fx.radius : 10);
      const iters = Math.max(1, Math.min(5, fx.iterations !== undefined ? fx.iterations : 1));
      if (r === 0) return '';
      const effRadius = Math.round(r * Math.sqrt(iters));
      return `blur(${effRadius}px)`;
    },
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      const r = Math.max(0, fx && fx.radius !== undefined ? fx.radius : 10);
      const iters = Math.max(1, Math.min(5, fx && fx.iterations !== undefined ? fx.iterations : 1));
      if (r === 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }
      const effRadius = Math.round(r * Math.sqrt(iters));

      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
        ctx.save();
        ctx.translate(x, y);
        window.FishEffects.drawBlurred(ctx, el, w, h, effRadius);
        ctx.restore();
        return;
      }

      try {
        ctx.save();
        ctx.filter = `blur(${effRadius}px)`;
        ctx.drawImage(el, x, y, w, h);
        ctx.restore();
      } catch (_) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      }
    }
  });
})(typeof window !== 'undefined' ? window : this);
