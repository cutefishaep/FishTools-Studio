(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgb(hex) {
    let c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  let offCanvas = null;
  let offCtx = null;

  reg.register({
    id: 'mono',
    name: 'Mono',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Black & White monochrome with optional duotone tint, contrast, and brightness',
    params: [
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, default: 100, unit: '%' },
      { id: 'tintColor', label: 'Tint Color', type: 'color', default: '#ffffff' },
      { id: 'tintAmount', label: 'Tint Amount', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'contrast', label: 'Contrast', type: 'number', min: -100, max: 100, default: 0 },
      { id: 'brightness', label: 'Brightness', type: 'number', min: -100, max: 100, default: 0 }
    ],
    filter(fx) {
      const tintAmt = fx.tintAmount !== undefined ? fx.tintAmount : 0;
      // If pure grayscale without custom tint or contrast tweaks, return native CSS filter string
      if (tintAmt <= 0 && !fx.contrast && !fx.brightness) {
        const intensity = fx.intensity !== undefined ? fx.intensity : 100;
        return `grayscale(${intensity}%)`;
      }
      return '';
    },
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const intensity = Math.max(0, Math.min(1, (fx.intensity !== undefined ? fx.intensity : 100) / 100));
      const tintAmt = Math.max(0, Math.min(1, (fx.tintAmount !== undefined ? fx.tintAmount : 0) / 100));
      const tintRgb = hexToRgb(fx.tintColor || '#ffffff');
      const contrast = (fx.contrast || 0) / 100;
      const brightness = (fx.brightness || 0);

      // Fast path: pure grayscale with no tint/contrast
      if (tintAmt <= 0 && contrast === 0 && brightness === 0) {
        ctx.save();
        ctx.filter = `grayscale(${Math.round(intensity * 100)}%)`;
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        ctx.restore();
        return;
      }

      // Buffer for pixel tint/contrast processing
      if (!offCanvas) {
        offCanvas = document.createElement('canvas');
        offCtx = offCanvas.getContext('2d');
      }
      const pw = Math.min(1280, Math.round(w));
      const ph = Math.min(720, Math.round(h));
      if (offCanvas.width !== pw || offCanvas.height !== ph) {
        offCanvas.width = pw;
        offCanvas.height = ph;
      }
      offCtx.clearRect(0, 0, pw, ph);
      try {
        offCtx.drawImage(el, 0, 0, pw, ph);
      } catch (_) {
        return;
      }

      const imgData = offCtx.getImageData(0, 0, pw, ph);
      const d = imgData.data;
      const len = d.length;

      const cFactor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
      const tr = tintRgb[0] / 255;
      const tg = tintRgb[1] / 255;
      const tb = tintRgb[2] / 255;

      for (let i = 0; i < len; i += 4) {
        const a = d[i + 3];
        if (a === 0) continue;

        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        // Rec. 709 Luminance
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Blend with original colors by intensity
        let mr = r + (lum - r) * intensity;
        let mg = g + (lum - g) * intensity;
        let mb = b + (lum - b) * intensity;

        // Apply tint
        if (tintAmt > 0) {
          mr = mr * (1 - tintAmt) + (lum * tr) * tintAmt;
          mg = mg * (1 - tintAmt) + (lum * tg) * tintAmt;
          mb = mb * (1 - tintAmt) + (lum * tb) * tintAmt;
        }

        // Apply contrast & brightness
        if (contrast !== 0) {
          mr = cFactor * (mr - 128) + 128;
          mg = cFactor * (mg - 128) + 128;
          mb = cFactor * (mb - 128) + 128;
        }
        if (brightness !== 0) {
          mr += brightness;
          mg += brightness;
          mb += brightness;
        }

        d[i] = Math.max(0, Math.min(255, mr));
        d[i + 1] = Math.max(0, Math.min(255, mg));
        d[i + 2] = Math.max(0, Math.min(255, mb));
      }

      offCtx.putImageData(imgData, 0, 0);

      ctx.save();
      try {
        ctx.drawImage(offCanvas, x, y, w, h);
      } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
