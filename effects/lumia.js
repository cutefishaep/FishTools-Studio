(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'lumia',
    name: 'Lumia',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Isolate and extract luma threshold highlights with smoothness and intensity',
    params: [
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'smoothness', label: 'Smoothness', type: 'number', min: 0, max: 100, default: 20, unit: '%' },
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 200, default: 100, unit: '%' }
    ],
    renderPost(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const intensity = (fx.intensity !== undefined ? fx.intensity : 100) / 100;
      if (intensity <= 0) return;

      const thresh = (fx.threshold !== undefined ? fx.threshold : 50) / 100;
      const smooth = (fx.smoothness !== undefined ? fx.smoothness : 20) / 100;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, intensity);

      const contrastVal = 1 + thresh * 2.5;
      const blurVal = Math.round(smooth * 12);
      ctx.filter = `contrast(${contrastVal.toFixed(2)}) brightness(${intensity.toFixed(2)}) ${blurVal > 0 ? `blur(${blurVal}px)` : ''}`;
      try {
        ctx.drawImage(el, x, y, w, h);
      } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
