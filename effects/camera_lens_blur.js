(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'camera-lens-blur',
    name: 'Camera Lens Blur',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Optical lens blur with aperture aspect ratio and specular highlight bloom',
    params: [
      { id: 'radius', label: 'Radius', type: 'number', min: 0, max: 100, default: 15, unit: 'px' },
      { id: 'aspectRatio', label: 'Aspect Ratio', type: 'number', min: 50, max: 200, default: 100, unit: '%' },
      { id: 'bloom', label: 'Bloom', type: 'number', min: 0, max: 100, default: 30, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      const r = Math.max(0, fx.radius !== undefined ? fx.radius : 15);
      const aspect = (fx.aspectRatio !== undefined ? fx.aspectRatio : 100) / 100;
      const bloom = Math.max(0, Math.min(1, (fx.bloom !== undefined ? fx.bloom : 30) / 100));

      if (r === 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      ctx.save();
      // 1. Base optical blur pass
      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.isCanvasFilterSupported === 'function' && window.FishEffects.isCanvasFilterSupported()) {
        ctx.filter = `blur(${Math.round(r)}px)`;
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        ctx.filter = 'none';

        // 2. Specular bokeh / highlight bloom pass
        if (bloom > 0) {
          ctx.globalAlpha = bloom * 0.7;
          ctx.globalCompositeOperation = 'screen';
          const bloomR = Math.round(r * 1.4);
          ctx.filter = `brightness(1.6) contrast(1.5) blur(${bloomR}px)`;
          try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        }
      } else if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
        ctx.translate(x, y);
        window.FishEffects.drawBlurred(ctx, el, w, h, r);
        if (bloom > 0) {
          ctx.globalAlpha = bloom * 0.7;
          ctx.globalCompositeOperation = 'screen';
          window.FishEffects.drawBlurred(ctx, el, w, h, r * 1.4);
        }
      } else {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      }
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
