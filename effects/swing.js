(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'swing',
    name: 'Swing',
    category: 'movement',
    icon: 'assets/FXPH.svg',
    description: 'Pendulum-style angular swinging motion pivoting around custom origin point with decay',
    params: [
      { id: 'frequency', label: 'Frequency', type: 'number', min: 0.1, max: 10, default: 1.5, unit: 'Hz' },
      { id: 'swingAngle', label: 'Swing Angle', type: 'number', min: 0, max: 90, default: 25, unit: '°' },
      { id: 'originX', label: 'Anchor X', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'originY', label: 'Anchor Y', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'decay', label: 'Decay', type: 'number', min: 0, max: 10, default: 0, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      const freq = fx && fx.frequency !== undefined ? fx.frequency : 1.5;
      const maxAngle = fx && fx.swingAngle !== undefined ? fx.swingAngle : 25;
      const origX = fx && (fx.originX !== undefined ? fx.originX : (fx.anchorX !== undefined ? fx.anchorX : 50));
      const origY = fx && (fx.originY !== undefined ? fx.originY : (fx.anchorY !== undefined ? fx.anchorY : 50));
      const decay = fx && fx.decay !== undefined ? fx.decay : 0;

      let curSec = 0;
      if (typeof window !== 'undefined') {
        if (typeof window.getCurrentPlayheadTime === 'function') curSec = window.getCurrentPlayheadTime();
        else if (window.timelinePanX !== undefined) curSec = Math.abs(window.timelinePanX) / (window.currentPixelsPerSecond || 80);
      }
      const layerStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
      const t = Math.max(0, curSec - layerStart);

      const decayMultiplier = decay > 0 ? Math.exp(- (decay / 100) * t * 2.0) : 1;
      const currentAngleDeg = Math.sin(2 * Math.PI * freq * t) * maxAngle * decayMultiplier;

      const pivotX = x + (origX / 100) * w;
      const pivotY = y + (origY / 100) * h;

      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.rotate((currentAngleDeg * Math.PI) / 180);
      ctx.drawImage(el, x - pivotX, y - pivotY, w, h);
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
