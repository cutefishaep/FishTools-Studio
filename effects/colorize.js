(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'colorize',
    name: 'Colorize',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Tint composition with a solid color hue',
    params: [
      { id: 'hue', label: 'Hue', type: 'number', min: 0, max: 360, default: 180, unit: '°' },
      { id: 'saturation', label: 'Saturation', type: 'number', min: 0, max: 100, default: 60, unit: '%' },
      { id: 'brightness', label: 'Brightness', type: 'number', min: -50, max: 50, default: 0, unit: '%' }
    ],
    filter(fx) {
      const h = fx.hue !== undefined ? fx.hue : 180;
      const s = (fx.saturation !== undefined ? fx.saturation : 60) * 2;
      const b = 1 + (fx.brightness || 0) / 100;
      return `sepia(1) hue-rotate(${h}deg) saturate(${s}%) brightness(${b.toFixed(3)})`;
    }
  });
})(typeof window !== 'undefined' ? window : this);
