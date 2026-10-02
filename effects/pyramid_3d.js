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

  reg.register({
    id: 'pyramid_3d',
    name: '3D Pyramid',
    category: '3d',
    icon: 'assets/FXPH.svg',
    description: 'Renders a 3D pyramid shape with side texture or solid faces',
    isExclusive3D: true,

    params: [
      { id: 'sideMode',    label: 'Side Fill',    type: 'select', options: ['texture', 'solid color'], default: 'texture' },
      { id: 'faceColor',   label: 'Solid Color',  type: 'color',  default: '#ffffff' },
      { id: 'faceOpacity', label: 'Side Opacity', type: 'number', min: 0,   max: 100, default: 100, unit: '%', step: 1 },
      { id: 'edgeColor',   label: 'Edge Color',   type: 'color',  default: '#ffffff' },
      { id: 'edgeOpacity', label: 'Edge Opacity', type: 'number', min: 0,   max: 100, default: 0,   unit: '%', step: 1 },
      { id: 'shading',     label: 'Shading',      type: 'number', min: 0,   max: 100, default: 0,   unit: '%', step: 1 },
      { id: 'apexX',       label: 'Apex X',       type: 'number', min: 10,  max: 90,  default: 50,  unit: '%', step: 1 },
      { id: 'apexY',       label: 'Apex Y',       type: 'number', min: 5,   max: 80,  default: 25,  unit: '%', step: 1 }
    ],

    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width  : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const defaultPyramidH = Math.round(Math.min(w, h));
      const pyramidHeight = Math.max(0, (layer && layer.scaleZ !== undefined) ? layer.scaleZ : ((layer && layer.depth !== undefined) ? layer.depth : ((fx && fx.height !== undefined) ? fx.height : defaultPyramidH)));
      let apexXPct        = fx && fx.apexX !== undefined ? fx.apexX : 50;
      let apexYPct        = fx && fx.apexY !== undefined ? fx.apexY : 25;

      // Link apex with layer 3D rotation
      const rotX = (layer && typeof layer.rotX === 'number') ? layer.rotX : 0;
      const rotY = (layer && typeof layer.rotY === 'number') ? layer.rotY : 0;
      apexXPct += rotY * 0.4;
      apexYPct -= rotX * 0.3;
      apexXPct = Math.max(10, Math.min(90, apexXPct));
      apexYPct = Math.max(5, Math.min(80, apexYPct));

      const isSolidMode   = (fx && fx.sideMode === 'solid color');
      let faceColor       = (fx && fx.faceColor) || '#ffffff';
      if (isSolidMode && faceColor === '#ffffff' && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const faceOpacity   = Math.max(0, Math.min(100, fx && fx.faceOpacity !== undefined ? fx.faceOpacity : 100)) / 100;
      const edgeColor     = (fx && fx.edgeColor) || '#ffffff';
      const edgeOpacity   = Math.max(0, Math.min(100, fx && fx.edgeOpacity !== undefined ? fx.edgeOpacity : (fx && fx.edgeWidth ? 70 : 0))) / 100;
      const shading       = Math.max(0, Math.min(100, fx && fx.shading !== undefined ? fx.shading : 0)) / 100;

      if (pyramidHeight <= 0.5) {
        if (el) {
          ctx.save();
          try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
          ctx.restore();
        }
        return;
      }

      ctx.save();

      // 1. Draw base layer image on ground
      if (el) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      }

      // 2. Base quad within bounds
      const bBL = { x: x + w * 0.05, y: y + h * 0.95 };
      const bBR = { x: x + w * 0.95, y: y + h * 0.95 };
      const bTR = { x: x + w * 0.85, y: y + h * 0.65 };
      const bTL = { x: x + w * 0.15, y: y + h * 0.65 };

      // 3. Apex coordinate safely inside bounds
      const apexH = Math.min(h * 0.55, pyramidHeight);
      const apex = {
        x: x + (apexXPct / 100) * w,
        y: y + Math.max(h * 0.05, (apexYPct / 100) * h * 0.6 - (apexH * 0.5))
      };

      // 4. Draw 4 triangular faces
      const faces = [
        { verts: [bTL, bTR, apex], mult: 0.65 }, // Back
        { verts: [bTL, bBL, apex], mult: 0.80 }, // Left
        { verts: [bBR, bTR, apex], mult: 0.90 }, // Right
        { verts: [bBL, bBR, apex], mult: 1.10 }  // Front
      ];

      for (const face of faces) {
        const [v0, v1, v2] = face.verts;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(v0.x, v0.y);
        ctx.lineTo(v1.x, v1.y);
        ctx.lineTo(v2.x, v2.y);
        ctx.closePath();

        if (isSolidMode) {
          ctx.fillStyle = hexToRgba(faceColor, faceOpacity * Math.min(1.0, face.mult));
          ctx.fill();
        } else {
          ctx.clip();
          if (el) {
            try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
          }
          if (shading > 0) {
            ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, (1.0 - face.mult) * shading * 0.8)})`;
            ctx.fill();
          }
        }
        ctx.restore();

        if (edgeOpacity > 0) {
          ctx.beginPath();
          ctx.moveTo(v0.x, v0.y); ctx.lineTo(v1.x, v1.y); ctx.lineTo(v2.x, v2.y); ctx.closePath();
          ctx.strokeStyle = hexToRgba(edgeColor, edgeOpacity * 0.5);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // 5. Draw prominent ridge edges from apex to each base corner
      if (edgeOpacity > 0) {
        ctx.strokeStyle = hexToRgba(edgeColor, edgeOpacity);
        ctx.lineWidth = 1;
        [bBL, bBR, bTR, bTL].forEach(corner => {
          ctx.beginPath();
          ctx.moveTo(apex.x, apex.y);
          ctx.lineTo(corner.x, corner.y);
          ctx.stroke();
        });
      }

      ctx.restore();
    }
  });

})(typeof window !== 'undefined' ? window : this);
