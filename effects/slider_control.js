(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'slider-control',
    name: 'Slider Control',
    category: 'expression',
    icon: 'assets/FXPH.svg',
    description: 'After Effects Slider Control for expressions',
    params: [
      { id: 'slider', label: 'Slider', type: 'number', min: -10000, max: 10000, default: 0, unit: '' }
    ]
  });
})(typeof window !== 'undefined' ? window : this);
