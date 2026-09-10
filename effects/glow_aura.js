(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgba(hex, alpha) {
    let c = (hex || '#00f0ff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  let auraBuf = null;
  let auraCtx = null;
  let glowBuf = null;
  let glowCtx = null;

  reg.register({
    id: 'glow-aura',
    name: 'Glow Aura',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Radiating aura glow blooming outward from alpha boundaries with rays and brightness like Sapphire S_GlowAura',
    params: [
      { id: 'auraWidth', label: 'Aura Width', type: 'number', min: 2, max: 150, default: 30, unit: 'px' },
      { id: 'brightness', label: 'Brightness', type: 'number', min: 10, max: 400, default: 160, unit: '%' },
      { id: 'color', label: 'Color', type: 'color', default: '#00f0ff' },
      { id: 'rays', label: 'Rays Intensity', type: 'number', min: 0, max: 100, default: 30 },
      { id: 'falloff', label: 'Falloff', type: 'number', min: 10, max: 100, default: 50, unit: '%' },
      { id: 'blendMode', label: 'Blend Mode', type: 'select', options: ['screen', 'lighter', 'source-over'], default: 'screen' },
      { id: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 100, default: 100, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const auraW = Math.max(2, fx.auraWidth !== undefined ? fx.auraWidth : 30);
      const bright = Math.max(0.1, (fx.brightness !== undefined ? fx.brightness : 160) / 100);
      const color = fx.color || '#00f0ff';
      const rays = Math.max(0, Math.min(100, fx.rays !== undefined ? fx.rays : 30)) / 100;
      const op = Math.max(0, Math.min(1, (fx.opacity !== undefined ? fx.opacity : 100) / 100));
      const blend = fx.blendMode || 'screen';

      if (op <= 0.001) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const pad = Math.round(auraW * 1.8);
      const bw = Math.min(1440, Math.round(w + pad * 2));
      const bh = Math.min(900, Math.round(h + pad * 2));

      if (!auraBuf) {
        auraBuf = document.createElement('canvas');
        auraCtx = auraBuf.getContext('2d');
        glowBuf = document.createElement('canvas');
        glowCtx = glowBuf.getContext('2d');
      }
      if (auraBuf.width !== bw || auraBuf.height !== bh) {
        auraBuf.width = bw;
        auraBuf.height = bh;
        glowBuf.width = bw;
        glowBuf.height = bh;
      }

      auraCtx.clearRect(0, 0, bw, bh);
      glowCtx.clearRect(0, 0, bw, bh);

      // 1. Draw solid color mask into auraBuf
      try {
        auraCtx.drawImage(el, pad, pad, w, h);
      } catch (_) {
        return;
      }
      auraCtx.globalCompositeOperation = 'source-in';
      auraCtx.fillStyle = color;
      auraCtx.fillRect(0, 0, bw, bh);
      auraCtx.globalCompositeOperation = 'source-over';

      // 2. Multi-step radiant blur simulation using stepped scale & opacity passes
      const passes = 6;
      const maxDist = auraW;
      for (let p = 1; p <= passes; p++) {
        const factor = p / passes;
        const d = maxDist * factor;
        const passAlpha = (bright / passes) * (1.0 - factor * 0.5) * op;
        if (passAlpha <= 0.001) continue;

        glowCtx.globalAlpha = Math.min(1.0, passAlpha);
        glowCtx.drawImage(auraBuf, -d, 0, bw, bh);
        glowCtx.drawImage(auraBuf, d, 0, bw, bh);
        glowCtx.drawImage(auraBuf, 0, -d, bw, bh);
        glowCtx.drawImage(auraBuf, 0, d, bw, bh);

        if (rays > 0.05) {
          const rayDist = d * (1.0 + rays * 1.5);
          glowCtx.drawImage(auraBuf, -rayDist * 0.707, -rayDist * 0.707, bw, bh);
          glowCtx.drawImage(auraBuf, rayDist * 0.707, -rayDist * 0.707, bw, bh);
          glowCtx.drawImage(auraBuf, -rayDist * 0.707, rayDist * 0.707, bw, bh);
          glowCtx.drawImage(auraBuf, rayDist * 0.707, rayDist * 0.707, bw, bh);
        }
      }

      // 3. Composite aura glow behind or with layer
      ctx.save();
      const prevGCO = ctx.globalCompositeOperation;
      if (blend && blend !== 'normal') {
        ctx.globalCompositeOperation = blend;
      }
      try {
        ctx.drawImage(glowBuf, x - pad, y - pad, bw, bh);
      } catch (_) {}

      // Draw sharp layer on top
      ctx.globalCompositeOperation = prevGCO;
      try {
        ctx.drawImage(el, x, y, w, h);
      } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
