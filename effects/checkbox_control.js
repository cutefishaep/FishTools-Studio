(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'checkbox-control',
    name: 'Checkbox Control',
    category: 'expression',
    icon: 'assets/FXPH.svg',
    description: 'After Effects Checkbox (Boolean) Control for expressions',
    params: [
      { id: 'checkbox', label: 'Checkbox', type: 'switch', default: 1 }
    ]
  });
})(typeof window !== 'undefined' ? window : this);
