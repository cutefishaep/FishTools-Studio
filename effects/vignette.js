(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function parseHexColor(hex) {
    if (!hex || typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
    let c = hex.trim();
    if (c.startsWith('#')) c = c.slice(1);
    if (c.length === 3) {
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    }
    const num = parseInt(c, 16);
    if (isNaN(num)) return { r: 0, g: 0, b: 0 };
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  reg.register({
    id: 'vignette',
    name: 'Vignette',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Edge darkening vignette with adjustable size, feather, roundness and color',
    params: [
      { id: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, default: -50, unit: '' },
      { id: 'midpoint', label: 'Midpoint', type: 'number', min: 10, max: 90, default: 50, unit: '%' },
      { id: 'roundness', label: 'Roundness', type: 'number', min: -100, max: 100, default: 0, unit: '' },
      { id: 'feather', label: 'Feather', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'color', label: 'Color', type: 'color', default: '#000000' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      // 1. Draw base image first
      if (el) {
        try {
          ctx.drawImage(el, x, y, w, h);
        } catch (_) {}
      }

      // Check keyframed or effective properties if available
      let currentFx = fx || {};
      if (layer && typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function') {
        const sec = (currentSec !== undefined && currentSec !== null) ? currentSec : (layer._currentSec || 0);
        const eff = window.getLayerEffectivePropsAtTime(layer, sec);
        if (eff && Array.isArray(eff.effects)) {
          const found = eff.effects.find(f => f && f.id === currentFx.id);
          if (found) currentFx = found;
        }
      }

      const amount = currentFx.amount !== undefined ? Number(currentFx.amount) : -50;
      if (Math.abs(amount) < 0.001) return;

      const midpoint = Math.max(10, Math.min(90, currentFx.midpoint !== undefined ? Number(currentFx.midpoint) : 50));
      const roundness = Math.max(-100, Math.min(100, currentFx.roundness !== undefined ? Number(currentFx.roundness) : 0));
      const feather = Math.max(0, Math.min(100, currentFx.feather !== undefined ? Number(currentFx.feather) : 50));
      const rawColor = currentFx.color || '#000000';

      // 4. Use 'multiply' composite for darkening (negative amount) or 'screen' for lightening (positive amount)
      const isDarkening = amount < 0;
      const compositeOp = isDarkening ? 'multiply' : 'screen';
      const intensity = Math.min(1, Math.abs(amount) / 100);

      // When lightening with default black color, use white fallback so positive amount produces visible lightening
      let effectiveColor = rawColor;
      if (!isDarkening && (effectiveColor.toLowerCase() === '#000000' || effectiveColor.toLowerCase() === '#000')) {
        effectiveColor = '#ffffff';
      }

      const { r, g, b } = parseHexColor(effectiveColor);

      const hw = Math.max(1, w / 2);
      const hh = Math.max(1, h / 2);
      const cx = x + hw;
      const cy = y + hh;
      const diag = Math.hypot(hw, hh);

      // Base outer radius extending to corners
      const r1 = diag;
      // Inner radius based on midpoint (transparent/no-effect zone)
      const r0 = r1 * (midpoint / 100);

      // 3. Adjust gradient shape using canvas transforms (scale X/Y differently based on roundness)
      // Elliptical scale factors conforming to frame aspect ratio
      const sx_ellipse = (hw * Math.SQRT2) / diag;
      const sy_ellipse = (hh * Math.SQRT2) / diag;

      let scaleX = sx_ellipse;
      let scaleY = sy_ellipse;

      if (roundness > 0) {
        // Towards circular (scaleX = 1.0, scaleY = 1.0)
        const t = roundness / 100;
        scaleX = sx_ellipse + (1.0 - sx_ellipse) * t;
        scaleY = sy_ellipse + (1.0 - sy_ellipse) * t;
      } else if (roundness < 0) {
        // Towards rectangular (flattens against edges and pushes into corners)
        const k = -roundness / 100;
        const boostX = 1 + k * 0.45 * (hw / diag);
        const boostY = 1 + k * 0.45 * (hh / diag);
        scaleX = sx_ellipse * (1 + k * 0.35) * boostX;
        scaleY = sy_ellipse * (1 + k * 0.35) * boostY;
      }

      // Safe bounds to cover entire transformed area
      const minScale = Math.max(0.01, Math.min(scaleX, scaleY));
      const fillExtent = (diag / minScale) * 2;

      ctx.save();

      // Clip strictly to layer bounds
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      ctx.globalCompositeOperation = compositeOp;
      ctx.globalAlpha = (ctx.globalAlpha || 1) * intensity;

      // Transform: origin at center of layer, scaled for roundness
      ctx.translate(cx, cy);
      ctx.scale(scaleX, scaleY);

      // 2. Create radial gradient on the main ctx:
      // Center (0, 0), inner radius r0, outer radius r1
      const grad = ctx.createRadialGradient(0, 0, r0, 0, 0, r1);

      // 5. Apply feather by adjusting gradient stop positions
      const fNorm = feather / 100;
      const fadeSpan = Math.max(0.001, Math.min(1.0, Math.pow(fNorm, 0.75)));

      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const p = i / steps;
        // Smoothstep hermite easing
        const ease = p * p * (3 - 2 * p);
        const stopPos = Math.min(1, p * fadeSpan);
        grad.addColorStop(stopPos, `rgba(${r}, ${g}, ${b}, ${ease.toFixed(4)})`);
      }
      if (fadeSpan < 1) {
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 1)`);
      }

      ctx.fillStyle = grad;
      ctx.fillRect(-fillExtent, -fillExtent, fillExtent * 2, fillExtent * 2);

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
