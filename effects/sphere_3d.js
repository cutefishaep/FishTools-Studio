(function (window) {
  'use strict';

  const reg =
    (window && window.FishEffectsRegistry) ||
    (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgba(hex, alpha) {
    let c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  function ellipsePath(ctx, cx, cy, rx, ry) {
    const k = 0.5523;
    const kx = rx * k, ky = ry * k;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry);
    ctx.bezierCurveTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
    ctx.bezierCurveTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
    ctx.bezierCurveTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
    ctx.bezierCurveTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
    ctx.closePath();
  }

  reg.register({
    id: 'sphere_3d',
    name: '3D Sphere',
    category: '3d',
    icon: 'assets/FXPH.svg',
    description: 'Maps layer onto a 3D sphere with surface texture or solid color',
    isExclusive3D: true,

    params: [
      { id: 'sideMode',         label: 'Surface Fill',     type: 'select', options: ['texture', 'solid color'], default: 'texture' },
      { id: 'faceColor',        label: 'Solid Color',      type: 'color',                                       default: '#ffffff' },
      { id: 'faceOpacity',      label: 'Surface Opacity',  type: 'number', min: 0,   max: 100, default: 100,    unit: '%', step: 1 },
      { id: 'edgeColor',        label: 'Edge Color',       type: 'color',                                       default: '#ffffff' },
      { id: 'edgeOpacity',      label: 'Edge Opacity',     type: 'number', min: 0,   max: 100, default: 0,      unit: '%', step: 1 },
      { id: 'shading',          label: 'Shading',          type: 'number', min: 0,   max: 100, default: 0,      unit: '%', step: 1 },
      { id: 'lightX',           label: 'Light X',          type: 'number', min: 0,   max: 100, default: 30,     unit: '%', step: 1 },
      { id: 'lightY',           label: 'Light Y',          type: 'number', min: 0,   max: 100, default: 25,     unit: '%', step: 1 },
      { id: 'highlightColor',   label: 'Highlight',        type: 'color',                                       default: '#ffffff' },
      { id: 'highlightOpacity', label: 'Highlight Opacity',type: 'number', min: 0,   max: 100, default: 0,      unit: '%', step: 1 },
      { id: 'shadowColor',      label: 'Shadow',           type: 'color',                                       default: '#000000' },
      { id: 'shadowOpacity',    label: 'Shadow Opacity',   type: 'number', min: 0,   max: 100, default: 0,      unit: '%', step: 1 },
      { id: 'rimColor',         label: 'Rim Color',        type: 'color',                                       default: '#000000' },
      { id: 'rimWidth',         label: 'Rim Width',        type: 'number', min: 0,   max: 50,  default: 0,      unit: '%', step: 1 },
      { id: 'squeeze',          label: 'Squeeze',          type: 'number', min: 50,  max: 150, default: 100,    unit: '%', step: 1 }
    ],

    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !bounds) return;

      const x = bounds.x !== undefined ? bounds.x : 0;
      const y = bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width  : 500));
      const h = Math.max(1, bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const isSolidMode     = (fx && (fx.sideMode === 'solid color' || fx.fillMode === 'solid color'));
      let faceColorHex      = (fx && (fx.faceColor || fx.color)) || '#ffffff';
      if (isSolidMode && faceColorHex === '#ffffff' && layer && (layer.fillColor || layer.color)) {
        faceColorHex = layer.fillColor || layer.color;
      }
      const faceOpacityVal  = Math.max(0, Math.min(100, fx && fx.faceOpacity !== undefined ? fx.faceOpacity : 100)) / 100;
      const edgeColorHex    = (fx && fx.edgeColor) || '#ffffff';
      const edgeOpacityVal  = Math.max(0, Math.min(100, fx && fx.edgeOpacity !== undefined ? fx.edgeOpacity : 0)) / 100;
      const shadingVal      = Math.max(0, Math.min(100, fx && fx.shading !== undefined ? fx.shading : 0)) / 100;

      let lightXPct         = fx && fx.lightX !== undefined ? fx.lightX : 30;
      let lightYPct         = fx && fx.lightY !== undefined ? fx.lightY : 25;

      // Link lighting with layer 3D rotation
      const rotX = (layer && typeof layer.rotX === 'number') ? layer.rotX : 0;
      const rotY = (layer && typeof layer.rotY === 'number') ? layer.rotY : 0;
      lightXPct += rotY * 0.4;
      lightYPct -= rotX * 0.4;
      lightXPct = Math.max(5, Math.min(95, lightXPct));
      lightYPct = Math.max(5, Math.min(95, lightYPct));

      const hlColor         = (fx && fx.highlightColor) || '#ffffff';
      const hlOpacity       = Math.max(0, Math.min(1, (fx && fx.highlightOpacity !== undefined ? fx.highlightOpacity : 0) / 100));
      const shColor         = (fx && fx.shadowColor) || '#000000';
      const shOpacity       = Math.max(0, Math.min(1, (fx && fx.shadowOpacity !== undefined && fx.shadowOpacity > 0 ? fx.shadowOpacity / 100 : shadingVal)));
      const rimColor        = (fx && fx.rimColor) || '#000000';
      const rimWidthPct     = Math.max(0, Math.min(50, fx && fx.rimWidth !== undefined ? fx.rimWidth : 0)) / 100;
      const squeeze         = Math.max(50, Math.min(150, fx && fx.squeeze !== undefined ? fx.squeeze : 100)) / 100;

      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = w / 2;
      const ry = (h / 2) * squeeze;

      const lx = x + (lightXPct / 100) * w;
      const ly = y + (lightYPct / 100) * h;

      ctx.save();

      // 1. Elliptical clip matching sphere boundary
      ellipsePath(ctx, cx, cy, rx, ry);
      ctx.clip();

      // 2. Draw source texture or solid color fill
      if (isSolidMode) {
        ctx.fillStyle = hexToRgba(faceColorHex, faceOpacityVal);
        ctx.fillRect(x, y, w, h);
      } else if (el) {
        try {
          ctx.drawImage(el, x, y, w, h);
        } catch (_) {}
      }

      // 3. Diffuse spherical shadow pass (receding curvature)
      if (shOpacity > 0.01) {
        const oppX = cx + (cx - lx) * 0.65;
        const oppY = cy + (cy - ly) * 0.65;
        const shGrad = ctx.createRadialGradient(oppX, oppY, Math.min(rx, ry) * 0.2, cx, cy, Math.max(rx, ry));
        shGrad.addColorStop(0, hexToRgba(shColor, 0));
        shGrad.addColorStop(0.55, hexToRgba(shColor, shOpacity * 0.4));
        shGrad.addColorStop(1, hexToRgba(shColor, shOpacity));
        ctx.fillStyle = shGrad;
        ctx.fillRect(x, y, w, h);
      }

      // 4. Specular highlight pass
      if (hlOpacity > 0.01) {
        const hlRadius = Math.max(rx, ry) * 0.85;
        const hlGrad = ctx.createRadialGradient(lx, ly, 0, lx, ly, hlRadius);
        hlGrad.addColorStop(0, hexToRgba(hlColor, hlOpacity));
        hlGrad.addColorStop(0.25, hexToRgba(hlColor, hlOpacity * 0.5));
        hlGrad.addColorStop(0.7, hexToRgba(hlColor, 0));
        hlGrad.addColorStop(1, hexToRgba(hlColor, 0));
        ctx.fillStyle = hlGrad;
        ctx.fillRect(x, y, w, h);
      }

      // 5. Rim shadow vignette
      if (rimWidthPct > 0.005) {
        const rimOuter = Math.max(rx, ry);
        const rimInner = rimOuter * Math.max(0.2, 1 - rimWidthPct * 2);
        const rimGrad = ctx.createRadialGradient(cx, cy, rimInner, cx, cy, rimOuter);
        rimGrad.addColorStop(0, hexToRgba(rimColor, 0));
        rimGrad.addColorStop(0.7, hexToRgba(rimColor, 0.4));
        rimGrad.addColorStop(1, hexToRgba(rimColor, 0.9));
        ctx.fillStyle = rimGrad;
        ctx.fillRect(x, y, w, h);
      }

      // 6. Edge line (optional)
      if (edgeOpacityVal > 0.01) {
        ellipsePath(ctx, cx, cy, rx, ry);
        ctx.strokeStyle = hexToRgba(edgeColorHex, edgeOpacityVal);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.restore();
    }
  });

})(typeof window !== 'undefined' ? window : this);
