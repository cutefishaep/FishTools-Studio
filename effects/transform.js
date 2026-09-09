(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'transform',
    name: 'Transform',
    category: 'movement',
    icon: 'assets/FXPH.svg',
    description: 'Secondary 2D transform stack with independent anchor, position, scale, rotation, skew and opacity',
    params: [
      { id: 'posX', label: 'Position X', type: 'number', min: -1000, max: 1000, default: 0, unit: 'px' },
      { id: 'posY', label: 'Position Y', type: 'number', min: -1000, max: 1000, default: 0, unit: 'px' },
      { id: 'scale', label: 'Scale', type: 'number', min: 0, max: 400, default: 100, unit: '%' },
      { id: 'rotation', label: 'Rotation', type: 'number', min: -360, max: 360, default: 0, unit: '°' },
      { id: 'skew', label: 'Skew', type: 'number', min: -85, max: 85, default: 0, unit: '°' },
      { id: 'anchorX', label: 'Anchor X', type: 'number', min: -500, max: 500, default: 0, unit: 'px' },
      { id: 'anchorY', label: 'Anchor Y', type: 'number', min: -500, max: 500, default: 0, unit: 'px' },
      { id: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 100, default: 100, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      const ax = fx && fx.anchorX !== undefined ? fx.anchorX : 0;
      const ay = fx && fx.anchorY !== undefined ? fx.anchorY : 0;
      const px = fx && fx.posX !== undefined ? fx.posX : 0;
      const py = fx && fx.posY !== undefined ? fx.posY : 0;
      const scale = (fx && fx.scale !== undefined ? fx.scale : 100) / 100;
      const rot = fx && fx.rotation !== undefined ? fx.rotation : 0;
      const skew = fx && fx.skew !== undefined ? fx.skew : 0;
      const op = Math.max(0, Math.min(100, fx && fx.opacity !== undefined ? fx.opacity : 100)) / 100;

      ctx.save();
      if (op < 1) {
        ctx.globalAlpha *= op;
      }

      // Center of source bounds
      const cx = x + w / 2;
      const cy = y + h / 2;

      // 1. Move to Position offset
      ctx.translate(cx + px, cy + py);

      // 2. Rotate around Anchor Point
      if (rot !== 0) {
        ctx.rotate((rot * Math.PI) / 180);
      }

      // 3. Skew around Anchor Point
      if (skew !== 0) {
        const tanSkew = Math.tan((skew * Math.PI) / 180);
        ctx.transform(1, 0, tanSkew, 1, 0, 0);
      }

      // 4. Scale around Anchor Point
      if (scale !== 1) {
        ctx.scale(scale, scale);
      }

      // 5. Offset by Anchor Point so (ax, ay) acts as true pivot point
      ctx.translate(-ax, -ay);

      // 6. Draw layer content unclipped
      ctx.drawImage(el, -w / 2, -h / 2, w, h);

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
