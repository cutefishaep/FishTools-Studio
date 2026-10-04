(function (window) {
  'use strict';

  const reg =
    (window && window.FishEffectsRegistry) ||
    (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  const DIRECTION_MAP = {
    'bottom-right': { dx:  1, dy:  1 },
    'bottom-left':  { dx: -1, dy:  1 },
    'top-right':    { dx:  1, dy: -1 },
    'top-left':     { dx: -1, dy: -1 },
    'right':        { dx:  1, dy:  0 },
    'left':         { dx: -1, dy:  0 },
    'bottom':       { dx:  0, dy:  1 },
    'top':          { dx:  0, dy: -1 }
  };

  function hexToRgba(hex, alpha) {
    let c = (hex || '#000000').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  reg.register({
    id: 'extrude_3d',
    name: '3D Extrude',
    category: '3d',
    icon: 'assets/FXPH.svg',
    description: 'Extrudes layer content outward with depth thickness and side texture',
    isExclusive3D: true,

    params: [
      { id: 'sideMode',    label: 'Side Fill',    type: 'select', options: ['texture', 'solid color'], default: 'texture' },
      { id: 'faceColor',   label: 'Solid Color',  type: 'color',  default: '#ffffff' },
      { id: 'faceOpacity', label: 'Side Opacity', type: 'number', min: 0,   max: 100, default: 100, unit: '%', step: 1 },
      { id: 'edgeColor',   label: 'Edge Color',   type: 'color',  default: '#ffffff' },
      { id: 'edgeOpacity', label: 'Edge Opacity', type: 'number', min: 0,   max: 100, default: 0,   unit: '%', step: 1 },
      { id: 'shading',     label: 'Shading',      type: 'number', min: 0,   max: 100, default: 0,   unit: '%', step: 1 },
      { id: 'steps',       label: 'Steps',        type: 'number', min: 2,   max: 24,  default: 10,  unit: '',  step: 1 }
    ],

    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;

      const x = bounds && bounds.x != null ? bounds.x : 0;
      const y = bounds && bounds.y != null ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w != null ? bounds.w : (ctx.canvas ? ctx.canvas.width  : 500));
      const h = Math.max(1, bounds && bounds.h != null ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const defaultExtrudeD = Math.round(Math.min(w, h));
      const depthParam    = Math.max(0, (layer && layer.scaleZ !== undefined) ? layer.scaleZ : ((layer && layer.depth !== undefined) ? layer.depth : ((fx && fx.extrudeDepth != null) ? fx.extrudeDepth : defaultExtrudeD)));
      const steps         = Math.max(2, Math.round(fx && fx.steps != null ? fx.steps : 10));
      const isSolidMode   = (fx && fx.sideMode === 'solid color');
      let faceColor       = (fx && fx.faceColor) || (fx && fx.shadeColor) || '#ffffff';
      if (isSolidMode && faceColor === '#ffffff' && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const faceOpacity   = Math.max(0, Math.min(100, fx && fx.faceOpacity !== undefined ? fx.faceOpacity : (fx && fx.shadeOpacity !== undefined ? fx.shadeOpacity : 100))) / 100;
      const edgeColor     = (fx && fx.edgeColor) || '#ffffff';
      const edgeOpacity   = Math.max(0, Math.min(100, fx && fx.edgeOpacity != null ? fx.edgeOpacity : 0)) / 100;
      const shading       = Math.max(0, Math.min(100, fx && fx.shading != null ? fx.shading : 0)) / 100;

      if (depthParam <= 0.5) {
        ctx.save();
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        ctx.restore();
        return;
      }

      // Base direction vector
      let dx = 1;
      let dy = 1;

      // React to layer 3D rotation if rotated in transform tab
      const rotX = (layer && typeof layer.rotX === 'number') ? layer.rotX : 0;
      const rotY = (layer && typeof layer.rotY === 'number') ? layer.rotY : 0;
      if (Math.abs(rotX) > 0.5 || Math.abs(rotY) > 0.5) {
        dx = Math.sin((rotY * Math.PI) / 180) * 1.2;
        dy = -Math.sin((rotX * Math.PI) / 180) * 1.2;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
      }

      // Extrusion clamped to reasonable range
      const maxExtrude = Math.min(w * 0.45, h * 0.45, depthParam);
      const totalShiftX = dx * maxExtrude;
      const totalShiftY = dy * maxExtrude;

      const absShiftX = Math.abs(totalShiftX);
      const absShiftY = Math.abs(totalShiftY);

      // Inset front face so all depth slices stay strictly within bounds [x, y, w, h]
      const frontW = Math.max(10, Math.round(w - absShiftX));
      const frontH = Math.max(10, Math.round(h - absShiftY));

      const frontX = Math.round(x + (totalShiftX < 0 ? absShiftX : 0));
      const frontY = Math.round(y + (totalShiftY < 0 ? absShiftY : 0));

      let tempCanvas = null;
      let tempCtx = null;
      if (isSolidMode || shading > 0) {
        tempCanvas = document.createElement('canvas');
        tempCanvas.width = frontW;
        tempCanvas.height = frontH;
        tempCtx = tempCanvas.getContext('2d');
      }

      ctx.save();

      // Render extruded slices from back to front
      for (let i = steps - 1; i >= 1; i--) {
        const t = i / steps; // 1 = backmost, near 0 = just behind front
        const offX = Math.round(frontX + dx * (t * maxExtrude));
        const offY = Math.round(frontY + dy * (t * maxExtrude));

        ctx.save();
        try {
          if (isSolidMode) {
            tempCtx.clearRect(0, 0, frontW, frontH);
            tempCtx.drawImage(el, 0, 0, frontW, frontH);
            tempCtx.globalCompositeOperation = 'source-in';
            tempCtx.fillStyle = hexToRgba(faceColor, faceOpacity * (1.0 - t * shading * 0.5));
            tempCtx.fillRect(0, 0, frontW, frontH);
            tempCtx.globalCompositeOperation = 'source-over';
            ctx.drawImage(tempCanvas, offX, offY, frontW, frontH);
          } else {
            ctx.drawImage(el, offX, offY, frontW, frontH);
            if (shading > 0) {
              tempCtx.clearRect(0, 0, frontW, frontH);
              tempCtx.drawImage(el, 0, 0, frontW, frontH);
              tempCtx.globalCompositeOperation = 'source-in';
              tempCtx.fillStyle = `rgba(0, 0, 0, ${t * shading * 0.6})`;
              tempCtx.fillRect(0, 0, frontW, frontH);
              tempCtx.globalCompositeOperation = 'source-over';
              ctx.drawImage(tempCanvas, offX, offY, frontW, frontH);
            }
          }
        } catch (_) {}
        ctx.restore();
      }

      // Render crisp front face
      try {
        ctx.drawImage(el, frontX, frontY, frontW, frontH);
      } catch (_) {}

      ctx.restore();
    }
  });

})(typeof window !== 'undefined' ? window : this);
