(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'tint',
    name: 'Tint',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Dual-tone color tint mapping black tones and white tones with mix amount',
    params: [
      { id: 'mapBlackTo', label: 'Map Black To', type: 'color', default: '#000000' },
      { id: 'mapWhiteTo', label: 'Map White To', type: 'color', default: '#ffffff' },
      { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, default: 100, unit: '%' }
    ],
    renderPost(ctx, el, layer, bounds, fx) {
      const amt = Math.max(0, Math.min(1, (fx.amount !== undefined ? fx.amount : 100) / 100));
      if (amt <= 0) return;

      const black = fx.mapBlackTo || '#000000';
      const white = fx.mapWhiteTo || '#ffffff';
      if (black.toLowerCase() === '#000000' && white.toLowerCase() === '#ffffff') return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      ctx.save();
      // Shadows tint pass
      if (black.toLowerCase() !== '#000000') {
        ctx.globalCompositeOperation = 'lighten';
        ctx.globalAlpha = amt;
        ctx.fillStyle = black;
        ctx.fillRect(x, y, w, h);
      }
      // Highlights tint pass
      if (white.toLowerCase() !== '#ffffff') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = amt;
        ctx.fillStyle = white;
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
