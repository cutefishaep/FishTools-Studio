(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let offCanvas = null;
  let offCtx = null;

  function hslToHex(h, s, l) {
    l /= 100;
    const a = (s * Math.min(l, 1 - l)) / 100;
    const f = n => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  reg.register({
    id: 'colorize',
    name: 'Colorize',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Tint layer with a chosen solid color preserving luminance and alpha shape',
    params: [
      { id: 'color', label: 'Color', type: 'color', default: '#38bdf8' },
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, default: 100, unit: '%' },
      { id: 'blendMode', label: 'Blend', type: 'select', default: 'color', options: ['color', 'hue', 'multiply', 'screen', 'overlay'] },
      { id: 'brightness', label: 'Brightness', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      // Support backward compatibility if older project saved fx.hue
      let color = fx.color;
      if (!color && fx.hue !== undefined) {
        color = hslToHex(fx.hue, fx.saturation !== undefined ? fx.saturation : 60, 50);
      }
      if (!color) color = '#38bdf8';

      const intensity = Math.max(0, Math.min(1, (fx.intensity !== undefined ? fx.intensity : 100) / 100));
      const blendMode = (fx.blendMode || 'color').toLowerCase();
      const brightness = (fx.brightness || 0) / 100;

      // If intensity is 0 and no brightness tweak, draw base element directly
      if (intensity <= 0 && brightness === 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const absW = Math.max(1, Math.min(4096, Math.round(Math.abs(w))));
      const absH = Math.max(1, Math.min(4096, Math.round(Math.abs(h))));

      if (!offCanvas && typeof document !== 'undefined') {
        offCanvas = document.createElement('canvas');
        offCtx = offCanvas.getContext('2d');
      }

      if (!offCanvas || !offCtx) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      if (offCanvas.width !== absW || offCanvas.height !== absH) {
        offCanvas.width = absW;
        offCanvas.height = absH;
      }
      offCtx.clearRect(0, 0, absW, absH);

      // 1. Draw base element onto offscreen buffer (with optional brightness adjustment)
      offCtx.save();
      if (brightness !== 0) {
        offCtx.filter = `brightness(${(1 + brightness).toFixed(3)})`;
      }
      try {
        offCtx.drawImage(el, 0, 0, absW, absH);
      } catch (_) {
        offCtx.restore();
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }
      offCtx.restore();

      // 2. Colorize pass using blend mode (default 'color' retains luminance while tinting hue & chroma)
      if (intensity > 0) {
        offCtx.save();
        offCtx.globalAlpha = intensity;
        offCtx.globalCompositeOperation = blendMode;
        offCtx.fillStyle = color;
        offCtx.fillRect(0, 0, absW, absH);
        offCtx.restore();

        // 3. Re-clip strictly to original alpha shape so no color leaks outside the element
        offCtx.save();
        offCtx.globalCompositeOperation = 'destination-in';
        try {
          offCtx.drawImage(el, 0, 0, absW, absH);
        } catch (_) {}
        offCtx.restore();
      }

      // 4. Draw processed result to destination context
      try {
        ctx.drawImage(offCanvas, x, y, w, h);
      } catch (_) {}
    }
  });
})(typeof window !== 'undefined' ? window : this);
