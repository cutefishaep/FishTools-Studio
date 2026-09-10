(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'exposure-gamma',
    name: 'Exposure / Gamma',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Optical exposure and non-linear gamma curve',
    params: [
      { id: 'exposure', label: 'Exposure', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'gamma', label: 'Gamma', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'offset', label: 'Offset', type: 'number', min: -50, max: 50, default: 0, unit: '%' }
    ],
    filter(fx) {
      let exp = (fx.exposure !== undefined ? fx.exposure : 0);
      if (Math.abs(exp) > 20) exp = exp / 50;
      const off = (fx.offset || 0) / 100;
      const gam = 1 + (fx.gamma || 0) / 100;
      const br = Math.max(0, Math.pow(2, exp) + off);
      return `brightness(${br.toFixed(3)}) contrast(${gam.toFixed(3)})`;
    }
  });
})(typeof window !== 'undefined' ? window : this);
