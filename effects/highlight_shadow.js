(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'highlight-shadow',
    name: 'Highlight / Shadow',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Adjust high tonal dynamic range and deep shadows',
    params: [
      { id: 'highlights', label: 'Highlights', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'shadows', label: 'Shadows', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    filter(fx) {
      const h = fx.highlights || 0;
      const s = fx.shadows || 0;
      const br = 1 + (h + s) / 200;
      const ct = 1 + (h - s) / 200;
      return `brightness(${br.toFixed(3)}) contrast(${ct.toFixed(3)})`;
    }
  });
})(typeof window !== 'undefined' ? window : this);
