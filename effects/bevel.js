(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgba(hex, alpha) {
    let c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  let bevelBuf = null;
  let bevelCtx = null;

  reg.register({
    id: 'bevel',
    name: 'Bevel',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: '3D edge bevel with customizable light angle, thickness, highlight, and shadow like After Effects Bevel Alpha',
    params: [
      { id: 'edgeThickness', label: 'Thickness', type: 'number', min: 1, max: 40, default: 6, unit: 'px' },
      { id: 'lightAngle', label: 'Light Angle', type: 'angle', default: 45, unit: '°' },
      { id: 'lightIntensity', label: 'Light Intensity', type: 'number', min: 0, max: 100, default: 80, unit: '%' },
      { id: 'lightColor', label: 'Light Color', type: 'color', default: '#ffffff' },
      { id: 'shadowIntensity', label: 'Shadow Intensity', type: 'number', min: 0, max: 100, default: 75, unit: '%' },
      { id: 'shadowColor', label: 'Shadow Color', type: 'color', default: '#000000' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const thick = Math.max(1, fx.edgeThickness !== undefined ? fx.edgeThickness : 6);
      const angle = ((fx.lightAngle !== undefined ? fx.lightAngle : 45) * Math.PI) / 180;
      const lightInt = Math.max(0, Math.min(1, (fx.lightIntensity !== undefined ? fx.lightIntensity : 80) / 100));
      const shadowInt = Math.max(0, Math.min(1, (fx.shadowIntensity !== undefined ? fx.shadowIntensity : 75) / 100));
      const lightColor = fx.lightColor || '#ffffff';
      const shadowColor = fx.shadowColor || '#000000';

      const pw = Math.round(w);
      const ph = Math.round(h);

      if (!bevelBuf) {
        bevelBuf = document.createElement('canvas');
        bevelCtx = bevelBuf.getContext('2d');
      }
      if (bevelBuf.width !== pw || bevelBuf.height !== ph) {
        bevelBuf.width = pw;
        bevelBuf.height = ph;
      }
      bevelCtx.clearRect(0, 0, pw, ph);

      // 1. Draw base image into buffer
      try {
        bevelCtx.drawImage(el, 0, 0, pw, ph);
      } catch (_) {
        return;
      }

      // Compute directional vectors for light and shadow
      const lx = Math.cos(angle) * thick;
      const ly = Math.sin(angle) * thick;

      // 2. Draw base image onto destination canvas
      ctx.save();
      try {
        ctx.drawImage(el, x, y, w, h);
      } catch (_) {}

      // 3. Highlight Pass (lit edge)
      if (lightInt > 0.01) {
        bevelCtx.save();
        bevelCtx.globalCompositeOperation = 'source-in';
        bevelCtx.fillStyle = hexToRgba(lightColor, lightInt);
        bevelCtx.fillRect(0, 0, pw, ph);

        bevelCtx.globalCompositeOperation = 'destination-out';
        try { bevelCtx.drawImage(el, lx, ly, pw, ph); } catch (_) {}
        bevelCtx.restore();

        ctx.globalCompositeOperation = 'lighter';
        try { ctx.drawImage(bevelBuf, x, y, w, h); } catch (_) {}
      }

      // 4. Shadow Pass (unlit opposite edge)
      if (shadowInt > 0.01) {
        bevelCtx.clearRect(0, 0, pw, ph);
        try { bevelCtx.drawImage(el, 0, 0, pw, ph); } catch (_) {}

        bevelCtx.save();
        bevelCtx.globalCompositeOperation = 'source-in';
        bevelCtx.fillStyle = hexToRgba(shadowColor, shadowInt);
        bevelCtx.fillRect(0, 0, pw, ph);

        bevelCtx.globalCompositeOperation = 'destination-out';
        try { bevelCtx.drawImage(el, -lx, -ly, pw, ph); } catch (_) {}
        bevelCtx.restore();

        ctx.globalCompositeOperation = 'source-over';
        try { ctx.drawImage(bevelBuf, x, y, w, h); } catch (_) {}
      }

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
