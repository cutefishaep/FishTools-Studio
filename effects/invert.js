(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'invert',
    name: 'Invert',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Invert all color channels',
    params: [
      { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, default: 100, unit: '%' }
    ],
    filter(fx) {
      const amt = fx.amount !== undefined ? fx.amount : 100;
      return `invert(${amt}%)`;
    }
  });
})(typeof window !== 'undefined' ? window : this);
