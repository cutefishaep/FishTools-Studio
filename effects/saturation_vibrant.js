(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'saturation-vibrant',
    name: 'Saturation / Vibrant',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Adjust color intensity and vibrance',
    params: [
      { id: 'saturation', label: 'Saturation', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'vibrance', label: 'Vibrance', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    filter(fx) {
      const sat = (fx.saturation || 0) / 100;
      const vib = (fx.vibrance || 0) / 150;
      const val = Math.max(0, 1 + sat + vib);
      return `saturate(${val.toFixed(3)})`;
    }
  });
})(typeof window !== 'undefined' ? window : this);
