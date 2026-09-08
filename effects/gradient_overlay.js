(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let offCanvas = null;

  reg.register({
    id: 'gradient-overlay',
    name: 'Gradient Overlay',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Linear color gradient overlay masked to layer with custom colors and blend modes',
    params: [
      { id: 'blendMode', label: 'Blend', type: 'select', default: 'normal', options: ['normal', 'multiply', 'overlay'] },
      { id: 'color1', label: 'Color 1', type: 'color', default: '#000000' },
      { id: 'color2', label: 'Color 2', type: 'color', default: '#ffffff' },
      { id: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 100, default: 60, unit: '%' },
      { id: 'angle', label: 'Angle', type: 'angle', default: 90, unit: '°' },
      { id: 'scale', label: 'Scale', type: 'number', min: 10, max: 200, default: 100, unit: '%' }
    ],
    renderPost(ctx, el, layer, bounds, fx) {
      const op = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 60) / 100));
      if (op <= 0) return;

      const angle = ((fx.angle !== undefined ? fx.angle : 90) * Math.PI) / 180;
      const scale = Math.max(0.1, (fx.scale !== undefined ? fx.scale : 100) / 100);
      const color1 = fx.color1 || '#000000';
      const color2 = fx.color2 || '#ffffff';
      const blendMode = (fx.blendMode || 'normal').toLowerCase();

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      const iw = Math.max(1, Math.round(w));
      const ih = Math.max(1, Math.round(h));

      if (!offCanvas && typeof document !== 'undefined') {
        offCanvas = document.createElement('canvas');
      }

      ctx.save();
      const gco = (blendMode === 'multiply') ? 'multiply'
                : (blendMode === 'overlay') ? 'overlay'
                : 'source-over';

      if (offCanvas) {
        if (offCanvas.width !== iw || offCanvas.height !== ih) {
          offCanvas.width = iw;
          offCanvas.height = ih;
        }
        const octx = offCanvas.getContext('2d');
        octx.clearRect(0, 0, iw, ih);

        const cx = iw / 2;
        const cy = ih / 2;
        const r = (Math.sqrt(iw * iw + ih * ih) / 2) * scale;
        const x0 = cx - Math.cos(angle) * r;
        const y0 = cy - Math.sin(angle) * r;
        const x1 = cx + Math.cos(angle) * r;
        const y1 = cy + Math.sin(angle) * r;
        const grad = octx.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, color1);
        grad.addColorStop(1, color2);
        octx.fillStyle = grad;
        octx.fillRect(0, 0, iw, ih);

        let didMask = false;
        if (el) {
          const isReady = (el.tagName === 'IMG' && el.complete && el.naturalWidth > 0) ||
                          (el.tagName === 'CANVAS' && el.width > 0 && el.height > 0) ||
                          (typeof ImageBitmap !== 'undefined' && el instanceof ImageBitmap) ||
                          (el.tagName === 'VIDEO' && el.readyState >= 2 && !el.seeking && el.videoWidth > 0);
          if (isReady) {
            octx.save();
            octx.globalCompositeOperation = 'destination-in';
            try {
              octx.drawImage(el, 0, 0, iw, ih);
              didMask = true;
            } catch (_) {}
            octx.restore();
          }
        }

        ctx.globalAlpha = (ctx.globalAlpha || 1) * op;
        if (blendMode === 'normal') {
          ctx.globalCompositeOperation = didMask ? 'source-over' : 'source-atop';
        } else {
          ctx.globalCompositeOperation = gco;
        }
        ctx.drawImage(offCanvas, x, y, w, h);
      }
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
