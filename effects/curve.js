(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'curve',
    name: 'Curve',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Tonal response curve adjusting blacks, shadows, midtones, highlights, and whites',
    params: [
      { id: 'blacks', label: 'Blacks', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'shadows', label: 'Shadows', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'midtones', label: 'Midtones', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'highlights', label: 'Highlights', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'whites', label: 'Whites', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    filter(fx) {
      const blacks = fx.blacks || 0;
      const shadows = fx.shadows || 0;
      const midtones = fx.midtones || 0;
      const highlights = fx.highlights || 0;
      const whites = fx.whites || 0;

      if (blacks === 0 && shadows === 0 && midtones === 0 && highlights === 0 && whites === 0) return '';

      const b = 1 + (midtones * 0.5 + highlights * 0.25 + shadows * 0.15) / 100;
      const c = 1 + (whites * 0.4 - blacks * 0.4 + highlights * 0.2 - shadows * 0.2) / 100;
      return `brightness(${Math.max(0, b).toFixed(3)}) contrast(${Math.max(0, c).toFixed(3)})`;
    }
  });
})(typeof window !== 'undefined' ? window : this);
