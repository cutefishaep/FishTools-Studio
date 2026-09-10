(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'color-control',
    name: 'Color Control',
    category: 'expression',
    icon: 'assets/FXPH.svg',
    description: 'After Effects Color Swatch Control for expressions',
    params: [
      { id: 'color', label: 'Color', type: 'color', default: '#ffffff' }
    ]
  });
})(typeof window !== 'undefined' ? window : this);
