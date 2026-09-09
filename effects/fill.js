(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let offCanvas = null;
  let offCtx = null;

  reg.register({
    id: 'fill',
    name: 'Fill',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Fill layer with a solid color conforming to layer alpha shape and blend mode',
    params: [
      { id: 'color', label: 'Color', type: 'color', default: '#ff0000' },
      { id: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 100, default: 100, unit: '%' },
      { id: 'blendMode', label: 'Blend', type: 'select', default: 'normal', options: ['normal', 'multiply', 'screen', 'overlay'] }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      if (layer) layer._fillRendered = true;
      if (fx) fx._fillRendered = true;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      const color = fx.color || '#ff0000';
      const op = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 100) / 100));
      const blendMode = (fx.blendMode || 'normal').toLowerCase();

      // If opacity is 0, draw base element normally and return
      if (op <= 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const absW = Math.max(1, Math.round(Math.abs(w)));
      const absH = Math.max(1, Math.round(Math.abs(h)));

      if (!offCanvas && typeof document !== 'undefined') {
        offCanvas = document.createElement('canvas');
        offCtx = offCanvas.getContext('2d');
      }

      let drewBase = false;
      if (offCanvas && offCtx) {
        if (offCanvas.width !== absW || offCanvas.height !== absH) {
          offCanvas.width = absW;
          offCanvas.height = absH;
        }
        offCtx.clearRect(0, 0, absW, absH);

        // 1. Draw base element onto offscreen buffer
        try {
          offCtx.drawImage(el, 0, 0, absW, absH);
          drewBase = true;
        } catch (_) {
          drewBase = false;
        }

        if (drewBase) {
          // 2. Fill with solid color over the element's alpha channel
          offCtx.save();
          offCtx.globalAlpha = op;
          offCtx.globalCompositeOperation = (blendMode === 'normal') ? 'source-atop' : blendMode;
          offCtx.fillStyle = color;
          offCtx.fillRect(0, 0, absW, absH);
          offCtx.restore();

          // If blend mode is multiply/screen/overlay, re-clip strictly to original alpha
          if (blendMode !== 'normal') {
            offCtx.save();
            offCtx.globalCompositeOperation = 'destination-in';
            try { offCtx.drawImage(el, 0, 0, absW, absH); } catch (_) {}
            offCtx.restore();
          }

          // 3. Draw final processed layer onto target context
          ctx.drawImage(offCanvas, x, y, w, h);
          return;
        }
      }

      // Safe fallback if offscreen buffer failed
      try {
        ctx.drawImage(el, x, y, w, h);
      } catch (_) {}
    },

    renderPost(ctx, el, layer, bounds, fx) {
      if ((layer && layer._fillRendered) || (fx && fx._fillRendered)) {
        if (layer) delete layer._fillRendered;
        if (fx) delete fx._fillRendered;
        return;
      }

      // Safety guard: never wipe the entire viewport with source-atop during full-screen post passes
      const isViewportPass = bounds && (bounds.x === 0 && bounds.y === 0 && bounds.w >= (ctx.canvas ? ctx.canvas.width - 2 : 1000));
      if (isViewportPass) return;

      const op = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 100) / 100));
      if (op <= 0) return;

      const color = fx.color || '#ff0000';
      const blendMode = (fx.blendMode || 'normal').toLowerCase();
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      ctx.save();
      ctx.globalAlpha = (ctx.globalAlpha || 1) * op;
      ctx.globalCompositeOperation = (blendMode === 'normal') ? 'source-atop' : blendMode;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);

