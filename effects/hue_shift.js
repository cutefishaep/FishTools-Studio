(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'hue-shift',
    name: 'Hue Shift',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Rotate color wheel angle across full spectrum',
    params: [
      { id: 'hue', label: 'Hue Angle', type: 'angle', default: 0, unit: '°' }
    ],
    filter(fx) {
      return `hue-rotate(${fx.hue || 0}deg)`;
    }
  });
})(typeof window !== 'undefined' ? window : this);
