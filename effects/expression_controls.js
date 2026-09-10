(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'expression-controls',
    name: 'Expression Controls',
    category: 'expression',
    icon: 'assets/FXPH.svg',
    description: 'Multi-parameter expression controller rack (Sliders, Point, Angle, Checkbox, Color)',
    params: [
      { id: 'slider1', label: 'Slider 1', type: 'number', min: -10000, max: 10000, default: 0, unit: '' },
      { id: 'slider2', label: 'Slider 2', type: 'number', min: -10000, max: 10000, default: 100, unit: '' },
      { id: 'point_x', label: 'Point X', type: 'number', min: -5000, max: 5000, default: 0, unit: 'px' },
      { id: 'point_y', label: 'Point Y', type: 'number', min: -5000, max: 5000, default: 0, unit: 'px' },
      { id: 'angle', label: 'Angle', type: 'angle', default: 0, unit: '°' },
      { id: 'checkbox', label: 'Checkbox', type: 'switch', default: 1 },
      { id: 'color', label: 'Color', type: 'color', default: '#ffffff' }
    ]
  });
})(typeof window !== 'undefined' ? window : this);
