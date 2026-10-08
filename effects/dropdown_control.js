(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'dropdown-control',
    name: 'Dropdown Menu Control',
    category: 'expression',
    icon: 'assets/FXPH.svg',
    description: 'After Effects Dropdown Menu Control for expressions',
    params: [
      {
        id: 'menu',
        label: 'Menu',
        type: 'select',
        default: 'Item 1',
        options: ['Item 1', 'Item 2', 'Item 3']
      }
    ]
  });
})(typeof window !== 'undefined' ? window : this);
