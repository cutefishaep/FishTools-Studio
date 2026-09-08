(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'oscillate',
    name: 'Oscillate',
    category: 'movement',
    icon: 'assets/FXPH.svg',
    description: 'Continuous harmonic motion oscillation with frequency, amplitude, angle and damping decay',
    params: [
      { id: 'frequency', label: 'Frequency', type: 'number', min: 0.1, max: 20, default: 2.0, unit: 'Hz' },
      { id: 'amplitude', label: 'Amplitude', type: 'number', min: 0, max: 300, default: 50, unit: 'px' },
      { id: 'angle', label: 'Angle', type: 'number', min: 0, max: 360, default: 0, unit: '°' },
      { id: 'phase', label: 'Phase', type: 'number', min: 0, max: 360, default: 0, unit: '°' },
      { id: 'decay', label: 'Decay', type: 'number', min: 0, max: 10, default: 0, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      const freq = fx && fx.frequency !== undefined ? fx.frequency : 2.0;
      const amp = fx && fx.amplitude !== undefined ? fx.amplitude : 50;
      const angle = fx && fx.angle !== undefined ? fx.angle : 0;
      const phase = fx && fx.phase !== undefined ? fx.phase : 0;
      const decay = fx && fx.decay !== undefined ? fx.decay : 0;

      let curSec = 0;
      if (typeof window !== 'undefined') {
        if (typeof window.getCurrentPlayheadTime === 'function') curSec = window.getCurrentPlayheadTime();
        else if (window.timelinePanX !== undefined) curSec = Math.abs(window.timelinePanX) / (window.currentPixelsPerSecond || 80);
      }
      const layerStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
      const t = Math.max(0, curSec - layerStart);

      const decayMultiplier = decay > 0 ? Math.exp(- (decay / 100) * t * 2.5) : 1;
      const wave = Math.sin(2 * Math.PI * freq * t + (phase * Math.PI / 180)) * amp * decayMultiplier;

      const rad = (angle * Math.PI) / 180;
      const dx = Math.cos(rad) * wave;
      const dy = Math.sin(rad) * wave;

      ctx.drawImage(el, x + dx, y + dy, w, h);
    }
  });
})(typeof window !== 'undefined' ? window : this);
