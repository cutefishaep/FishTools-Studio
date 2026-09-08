(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'brightness-contrast',
    name: 'Brightness / Contrast',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Adjust luminance and tonal contrast',
    params: [
      { id: 'brightness', label: 'Brightness', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'contrast', label: 'Contrast', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    filter(fx) {
      const b = 1 + (fx.brightness || 0) / 100;
      const c = 1 + (fx.contrast || 0) / 100;
      return `brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)})`;
    }
  });
})(typeof window !== 'undefined' ? window : this);
