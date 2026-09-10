(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'point-control',
    name: 'Point Control',
    category: 'expression',
    icon: 'assets/FXPH.svg',
    description: 'After Effects 2D Point Control (X, Y) for expressions',
    params: [
      { id: 'point_x', label: 'Point X', type: 'number', min: -5000, max: 5000, default: 0, unit: 'px' },
      { id: 'point_y', label: 'Point Y', type: 'number', min: -5000, max: 5000, default: 0, unit: 'px' }
    ]
  });
})(typeof window !== 'undefined' ? window : this);
