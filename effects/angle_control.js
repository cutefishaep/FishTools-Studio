(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'angle-control',
    name: 'Angle Control',
    category: 'expression',
    icon: 'assets/FXPH.svg',
    description: 'After Effects Angle Control for expressions',
    params: [
      { id: 'angle', label: 'Angle', type: 'angle', min: 0, max: 360, default: 0, unit: '°' }
    ]
  });
})(typeof window !== 'undefined' ? window : this);
