(function (window) {
  'use strict';

  const reg =
    (window && window.FishEffectsRegistry) ||
    (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  /* ── Color helpers ────────────────────────────────────────────────────── */

  function hexToRgb(hex) {
    let c = (hex || '#000000').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function rgbaStr(rgb, alpha) {
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
  }

  function adjustBrightness(rgb, factor) {
    return {
      r: Math.max(0, Math.min(255, Math.round(rgb.r * factor))),
      g: Math.max(0, Math.min(255, Math.round(rgb.g * factor))),
      b: Math.max(0, Math.min(255, Math.round(rgb.b * factor)))
    };
  }

  /* ── Registration ─────────────────────────────────────────────────────── */

  const box3dDef = {
    id: 'box_3d',
    name: '3D Box / Cube',
    category: '3d',
    icon: 'assets/FXPH.svg',
    description: 'Wraps layer into a 3D box or cube with perspective top and side faces',
    isExclusive3D: true,

    params: [
      { id: 'sideMode',    label: 'Side Fill',    type: 'select', options: ['texture', 'solid color'], default: 'texture' },
      { id: 'faceColor',   label: 'Solid Color',  type: 'color',  default: '#ffffff'               },
      { id: 'faceOpacity', label: 'Side Opacity',  type: 'number', min: 0,   max: 100,  default: 100,     unit: '%',  step: 1  },
      { id: 'edgeColor',   label: 'Edge Color',    type: 'color',                        default: '#ffffff'               },
      { id: 'edgeOpacity', label: 'Edge Opacity',  type: 'number', min: 0,   max: 100,  default: 0,       unit: '%',  step: 1  },
      { id: 'shading',     label: 'Shading',       type: 'number', min: 0,   max: 100,  default: 0,       unit: '%',  step: 1  },
      { id: 'convertPrecomp', label: 'Convert to 3D Precomp (6 Faces)', type: 'button' }
    ],

    onButtonClick(paramId, fx, layer) {
      if (paramId === 'convertPrecomp') {
        const root = typeof window !== 'undefined' ? window : global;
        if (typeof root.createProceduralCube === 'function') {
          const d = (layer && (layer.scaleZ !== undefined ? layer.scaleZ : layer.depth)) || 400;
          root.createProceduralCube(null, null, d, true);
        }
      }
    },

    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;

      /* ── Resolve bounds ── */
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width  : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      /* ── Resolve params & link with layer transform ── */
      const defaultCubeD = Math.round(Math.min(w, h));
      const depthParam = Math.max(0, (layer && layer.scaleZ !== undefined) ? layer.scaleZ : ((layer && layer.depth !== undefined) ? layer.depth : defaultCubeD));
      const angleXdeg  = (layer && typeof layer.rotX === 'number') ? layer.rotX : 0;
      const angleYdeg  = (layer && typeof layer.rotY === 'number') ? layer.rotY : 0;

      const isSolidMode = (fx && fx.sideMode === 'solid color');
      let faceColorHex  = (fx && fx.faceColor) || '#ffffff';
      if (isSolidMode && faceColorHex === '#ffffff' && layer && (layer.fillColor || layer.color)) {
        faceColorHex = layer.fillColor || layer.color;
      }
      const faceOpacityVal = Math.max(0, Math.min(100, fx && fx.faceOpacity !== undefined ? fx.faceOpacity : 100)) / 100;
      const edgeColorHex   = (fx && fx.edgeColor) || '#ffffff';
      const edgeOpacityVal = Math.max(0, Math.min(100, fx && fx.edgeOpacity !== undefined ? fx.edgeOpacity : 0)) / 100;
      const shadingVal     = Math.max(0, Math.min(100, fx && fx.shading !== undefined ? fx.shading : 0)) / 100;

      // If depth is 0, render front face normally
      if (depthParam < 0.5) {
        ctx.save();
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        ctx.restore();
        return;
      }

      /* ── Compute recede offsets ── */
      const clampAngleX = Math.max(-85, Math.min(85, angleXdeg));
      const clampAngleY = Math.max(-85, Math.min(85, angleYdeg));
      const radX = (clampAngleX * Math.PI) / 180;
      const radY = (clampAngleY * Math.PI) / 180;

      // shiftX: positive = recedes right, negative = recedes left
      // shiftY: negative = recedes up (top face visible), positive = recedes down (bottom face visible)
      const maxExtrude = Math.min(w * 0.45, h * 0.45, depthParam);
      const shiftX = Math.round(maxExtrude * Math.sin(radY) * Math.cos(radX));
      const shiftY = Math.round(-maxExtrude * Math.sin(radX));

      /* ── Inset geometry so the entire 3D box fits perfectly in [x, y, w, h] ── */
      const absShiftX = Math.abs(shiftX);
      const absShiftY = Math.abs(shiftY);

      const frontW = Math.max(10, Math.round(w - absShiftX));
      const frontH = Math.max(10, Math.round(h - absShiftY));

      const frontX = Math.round(x + (shiftX < 0 ? absShiftX : 0));
      const frontY = Math.round(y + (shiftY < 0 ? absShiftY : 0));

      const backX = frontX + shiftX;
      const backY = frontY + shiftY;

      // 4 Front corners
      const fTL = { x: frontX,          y: frontY          };
      const fTR = { x: frontX + frontW,  y: frontY          };
      const fBR = { x: frontX + frontW,  y: frontY + frontH };
      const fBL = { x: frontX,          y: frontY + frontH };

      // 4 Back corners
      const bTL = { x: backX,           y: backY           };
      const bTR = { x: backX + frontW,   y: backY           };
      const bBR = { x: backX + frontW,   y: backY + frontH  };
      const bBL = { x: backX,           y: backY + frontH  };

      const baseRgb = hexToRgb(faceColorHex);
      const edgeRgb = hexToRgb(edgeColorHex);

      ctx.save();

      function renderSideFace(p1, p2, p3, p4, tintRgb, tintFactor) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.clip();

        if (!isSolidMode) {
          // Texture mode: maps layer texture onto side face with directional shading
          const minFx = Math.min(p1.x, p2.x, p3.x, p4.x);
          const maxFx = Math.max(p1.x, p2.x, p3.x, p4.x);
          const minFy = Math.min(p1.y, p2.y, p3.y, p4.y);
          const maxFy = Math.max(p1.y, p2.y, p3.y, p4.y);
          try {
            ctx.drawImage(el, minFx, minFy, Math.max(1, maxFx - minFx), Math.max(1, maxFy - minFy));
          } catch (_) {}
          const shadeRgb = adjustBrightness({ r: 0, g: 0, b: 0 }, 0);
          const shadeAlpha = Math.max(0, Math.min(0.85, (1.0 - tintFactor) * shadingVal));
          if (shadeAlpha > 0.01) {
            ctx.fillStyle = `rgba(0, 0, 0, ${shadeAlpha})`;
            ctx.fill();
          }
        } else {
          // Solid color mode with diffuse shading
          ctx.fillStyle = rgbaStr(tintRgb, faceOpacityVal);
          ctx.fill();
        }
        ctx.restore();

        if (edgeOpacityVal > 0) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.lineTo(p4.x, p4.y);
          ctx.closePath();
          ctx.strokeStyle = rgbaStr(edgeRgb, edgeOpacityVal * 0.85);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      /* ── 1. Draw Receding Faces (Behind Front Face) ── */

      // A. TOP FACE (visible when shiftY < 0, viewed from above)
      if (shiftY < -0.5) {
        const topRgb = adjustBrightness(baseRgb, 1.0 + shadingVal * 0.45);
        renderSideFace(fTL, fTR, bTR, bTL, topRgb, 1.2);
      }

      // B. BOTTOM FACE (visible when shiftY > 0, viewed from below)
      if (shiftY > 0.5) {
        const botRgb = adjustBrightness(baseRgb, Math.max(0.2, 1.0 - shadingVal * 0.55));
        renderSideFace(fBL, fBR, bBR, bBL, botRgb, 0.45);
      }

      // C. RIGHT FACE (visible when shiftX > 0, viewed from right)
      if (shiftX > 0.5) {
        const rightRgb = adjustBrightness(baseRgb, Math.max(0.3, 1.0 - shadingVal * 0.3));
        renderSideFace(fTR, bTR, bBR, fBR, rightRgb, 0.7);
      }

      // D. LEFT FACE (visible when shiftX < 0, viewed from left)
      if (shiftX < -0.5) {
        const leftRgb = adjustBrightness(baseRgb, Math.max(0.35, 1.0 - shadingVal * 0.2));
        renderSideFace(fTL, bTL, bBL, fBL, leftRgb, 0.8);
      }

      /* ── 2. Draw Front Face (The Layer Image/Shape Content) ── */
      try {
        ctx.drawImage(el, frontX, frontY, frontW, frontH);
      } catch (_) {}

      /* ── 3. Front Face Outline & Corner Depth Edges ── */
      if (edgeOpacityVal > 0) {
        ctx.strokeStyle = rgbaStr(edgeRgb, edgeOpacityVal);
        ctx.lineWidth = 1.2;

        // Front face rectangular outline
        ctx.strokeRect(frontX, frontY, frontW, frontH);

        // Corner depth lines connecting front corners to back corners
        if (shiftY < -0.5 && shiftX > 0.5) {
          // Top & Right visible: connect fTL, fTR, fBR
          ctx.beginPath();
          ctx.moveTo(fTL.x, fTL.y); ctx.lineTo(bTL.x, bTL.y);
          ctx.moveTo(fTR.x, fTR.y); ctx.lineTo(bTR.x, bTR.y);
          ctx.moveTo(fBR.x, fBR.y); ctx.lineTo(bBR.x, bBR.y);
          ctx.stroke();
        } else if (shiftY < -0.5 && shiftX < -0.5) {
          // Top & Left visible: connect fTR, fTL, fBL
          ctx.beginPath();
          ctx.moveTo(fTR.x, fTR.y); ctx.lineTo(bTR.x, bTR.y);
          ctx.moveTo(fTL.x, fTL.y); ctx.lineTo(bTL.x, bTL.y);
          ctx.moveTo(fBL.x, fBL.y); ctx.lineTo(bBL.x, bBL.y);
          ctx.stroke();
        } else if (shiftY > 0.5 && shiftX > 0.5) {
          // Bottom & Right visible: connect fTR, fBR, fBL
          ctx.beginPath();
          ctx.moveTo(fTR.x, fTR.y); ctx.lineTo(bTR.x, bTR.y);
          ctx.moveTo(fBR.x, fBR.y); ctx.lineTo(bBR.x, bBR.y);
          ctx.moveTo(fBL.x, fBL.y); ctx.lineTo(bBL.x, bBL.y);
          ctx.stroke();
        } else if (shiftY > 0.5 && shiftX < -0.5) {
          // Bottom & Left visible: connect fTL, fBL, fBR
          ctx.beginPath();
          ctx.moveTo(fTL.x, fTL.y); ctx.lineTo(bTL.x, bTL.y);
          ctx.moveTo(fBL.x, fBL.y); ctx.lineTo(bBL.x, bBL.y);
          ctx.moveTo(fBR.x, fBR.y); ctx.lineTo(bBR.x, bBR.y);
          ctx.stroke();
        } else if (shiftY < -0.5) {
          // Top only visible
          ctx.beginPath();
          ctx.moveTo(fTL.x, fTL.y); ctx.lineTo(bTL.x, bTL.y);
          ctx.moveTo(fTR.x, fTR.y); ctx.lineTo(bTR.x, bTR.y);
          ctx.stroke();
        } else if (shiftY > 0.5) {
          // Bottom only visible
          ctx.beginPath();
          ctx.moveTo(fBL.x, fBL.y); ctx.lineTo(bBL.x, bBL.y);
          ctx.moveTo(fBR.x, fBR.y); ctx.lineTo(bBR.x, bBR.y);
          ctx.stroke();
        } else if (shiftX > 0.5) {
          // Right only visible
          ctx.beginPath();
          ctx.moveTo(fTR.x, fTR.y); ctx.lineTo(bTR.x, bTR.y);
          ctx.moveTo(fBR.x, fBR.y); ctx.lineTo(bBR.x, bBR.y);
          ctx.stroke();
        } else if (shiftX < -0.5) {
          // Left only visible
          ctx.beginPath();
          ctx.moveTo(fTL.x, fTL.y); ctx.lineTo(bTL.x, bTL.y);
          ctx.moveTo(fBL.x, fBL.y); ctx.lineTo(bBL.x, bBL.y);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  };

  reg.register(box3dDef);

})(typeof window !== 'undefined' ? window : this);
