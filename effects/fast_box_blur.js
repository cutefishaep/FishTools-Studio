(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'fast-box-blur',
    name: 'Fast Box Blur',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'High performance rapid box blur pass with radius and iteration control',
    params: [
      { id: 'radius', label: 'Radius', type: 'number', min: 0, max: 100, default: 10, unit: 'px' },
      { id: 'iterations', label: 'Iterations', type: 'number', min: 1, max: 5, default: 1, unit: '' }
    ],
    filter(fx) {
      const r = Math.max(0, fx.radius !== undefined ? fx.radius : 10);
      const iters = Math.max(1, Math.min(5, fx.iterations !== undefined ? fx.iterations : 1));
      if (r === 0) return '';
      const effRadius = Math.round(r * Math.sqrt(iters));
      return `blur(${effRadius}px)`;
    }
  });
})(typeof window !== 'undefined' ? window : this);
