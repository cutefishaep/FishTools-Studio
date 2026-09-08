(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let raysSrcCanvas = null;

  reg.register({
    id: 'rays',
    name: 'Rays',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Volumetric light rays and bloom radiating from layer',
    params: [
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'length', label: 'Length', type: 'number', min: 0, max: 100, default: 40, unit: '%' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'color', label: 'Color', type: 'color', default: '#ffffff' },
      { id: 'originX', label: 'Center X', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'originY', label: 'Center Y', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    renderPost(ctx, el, layer, bounds, fx) {
      if (!ctx || !el || !fx) return;
      const intensity = Math.max(0, Math.min(100, fx.intensity !== undefined ? fx.intensity : 50)) / 100;
      const length = Math.max(0, Math.min(100, fx.length !== undefined ? fx.length : 40)) / 100;
      if (intensity <= 0 || length <= 0) return;

      const isReady = (el.tagName === 'IMG' && el.complete && el.naturalWidth > 0) ||
                      (el.tagName === 'CANVAS' && el.width > 0 && el.height > 0) ||
                      (typeof ImageBitmap !== 'undefined' && el instanceof ImageBitmap) ||
                      (el.tagName === 'VIDEO' && el.readyState >= 2 && el.videoWidth > 0);
      if (!isReady && el.tagName === 'VIDEO' && el.seeking) return;
      if (!isReady) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);
      if (w <= 0 || h <= 0) return;

      const threshold = Math.max(0, Math.min(100, fx.threshold !== undefined ? fx.threshold : 50)) / 100;
      const originXNorm = Math.max(-100, Math.min(100, fx.originX !== undefined ? fx.originX : 0)) / 100;
      const originYNorm = Math.max(-100, Math.min(100, fx.originY !== undefined ? fx.originY : 0)) / 100;
      const rayColor = fx.color || '#ffffff';

      const maxDim = 280;
      const aspect = w / Math.max(1, h);
      const sw = Math.max(48, Math.min(maxDim, aspect >= 1 ? maxDim : Math.round(maxDim * aspect)));
      const sh = Math.max(48, Math.min(maxDim, aspect >= 1 ? Math.round(maxDim / aspect) : maxDim));

      if (!raysSrcCanvas && typeof document !== 'undefined') {
        raysSrcCanvas = document.createElement('canvas');
      }
      if (!raysSrcCanvas) return;
      if (raysSrcCanvas.width !== sw || raysSrcCanvas.height !== sh) {
        raysSrcCanvas.width = sw;
        raysSrcCanvas.height = sh;
      }
      const sctx = raysSrcCanvas.getContext('2d', { willReadFrequently: true });
      sctx.clearRect(0, 0, sw, sh);
      try {
        sctx.drawImage(el, 0, 0, sw, sh);
      } catch (_) {
        return;
      }

      try {
        const imgData = sctx.getImageData(0, 0, sw, sh);
        const data = imgData.data;
        const threshVal = threshold * 255;

        let tr = 255, tg = 255, tb = 255;
        if (typeof rayColor === 'string' && rayColor.startsWith('#') && rayColor.length >= 7) {
          tr = parseInt(rayColor.slice(1, 3), 16) || 255;
          tg = parseInt(rayColor.slice(3, 5), 16) || 255;
          tb = parseInt(rayColor.slice(5, 7), 16) || 255;
        }
        const isWhite = (tr === 255 && tg === 255 && tb === 255);

        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a === 0) continue;
          const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          if (threshold > 0) {
            if (luma < threshVal) {
              const falloff = threshVal > 0 ? (luma / threshVal) : 0;
              data[i + 3] = Math.round(a * falloff * falloff * falloff);
            } else {
              const boost = 1 + ((luma - threshVal) / Math.max(1, 255 - threshVal)) * 1.5;
              data[i] = Math.min(255, data[i] * boost);
              data[i + 1] = Math.min(255, data[i + 1] * boost);
              data[i + 2] = Math.min(255, data[i + 2] * boost);
            }
          }
          if (!isWhite) {
            data[i] = (data[i] * tr) >> 8;
            data[i + 1] = (data[i + 1] * tg) >> 8;
            data[i + 2] = (data[i + 2] * tb) >> 8;
          }
        }
        sctx.putImageData(imgData, 0, 0);
      } catch (_) {}

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cx = x + w / 2 + originXNorm * (w / 2);
      const cy = y + h / 2 + originYNorm * (h / 2);
      const passes = 28;
      const maxExpansion = 1.0 + length * 2.2;

      for (let k = 1; k <= passes; k++) {
        const t = k / passes;
        const s = 1.0 + t * (maxExpansion - 1.0);
        const decay = Math.pow(1.0 - t * 0.75, 1.4);
        const passAlpha = (intensity * 1.6 / passes) * decay;
        ctx.globalAlpha = Math.min(1.0, Math.max(0.005, passAlpha));
        const dx = cx + (x - cx) * s;
        const dy = cy + (y - cy) * s;
        const dw = w * s;
        const dh = h * s;
        ctx.drawImage(raysSrcCanvas, dx, dy, dw, dh);
      }
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
