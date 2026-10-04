(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let _scratchCanvas = null;
  let _scratchCtx = null;

  reg.register({
    id: 'linear_wipe',
    name: 'Linear Wipe',
    category: 'Wipe',
    icon: 'assets/FXPH.svg',
    description: 'Linear wipe transition effect wiping layer along an angle with adjustable feather',
    params: [
      { id: 'completion', label: 'Transition Completion', type: 'number', min: 0, max: 100, default: 0, unit: '%', step: 1 },
      { id: 'angle', label: 'Wipe Angle', type: 'number', min: -360, max: 360, default: 90, unit: '°', step: 1 },
      { id: 'feather', label: 'Feather', type: 'number', min: 0, max: 300, default: 0, unit: 'px', step: 1 }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      let currentFx = fx || {};
      if (layer && typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function') {
        const sec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : (layer._currentSec || 0);
        const eff = window.getLayerEffectivePropsAtTime(layer, sec);
        if (eff && Array.isArray(eff.effects)) {
          const found = eff.effects.find(f => f && f.id === currentFx.id);
          if (found) currentFx = found;
        }
      }

      const completionRaw = Number(currentFx.completion !== undefined ? currentFx.completion : (currentFx.params && currentFx.params.completion !== undefined ? currentFx.params.completion : 0));
      const completion = Math.max(0, Math.min(100, isNaN(completionRaw) ? 0 : completionRaw));
      const angle = Number(currentFx.angle !== undefined ? currentFx.angle : (currentFx.params && currentFx.params.angle !== undefined ? currentFx.params.angle : 90));
      const feather = Math.max(0, Number(currentFx.feather !== undefined ? currentFx.feather : (currentFx.params && currentFx.params.feather !== undefined ? currentFx.params.feather : 0)));

      // 0% completion: completely visible (no wiping needed)
      if (completion <= 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      // 100% completion: completely wiped out
      if (completion >= 100 && feather <= 0) {
        return;
      }

      // Setup offscreen scratch canvas to guarantee zero interference with underlying layers
      if (!_scratchCanvas) {
        _scratchCanvas = document.createElement('canvas');
        _scratchCtx = _scratchCanvas.getContext('2d');
      }
      if (_scratchCanvas.width !== w || _scratchCanvas.height !== h) {
        _scratchCanvas.width = w;
        _scratchCanvas.height = h;
      }

      _scratchCtx.clearRect(0, 0, w, h);
      _scratchCtx.drawImage(el, 0, 0, w, h);

      // Mask with linear gradient using destination-in
      _scratchCtx.globalCompositeOperation = 'destination-in';

      // Angle in radians (90 deg = wipe from right to left, 0 deg = wipe from top to bottom)
      const rad = ((angle - 90) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const cx = w / 2;
      const cy = h / 2;
      const diag = Math.hypot(w, h);
      const maxDist = diag / 2;

      // Completion mapped to travel distance across diagonal
      const cNorm = completion / 100;
      const cutDist = (1 - 2 * cNorm) * maxDist;
      const midX = cx + cos * cutDist;
      const midY = cy + sin * cutDist;

      // Feather half-span
      const fSpan = Math.max(0.5, feather / 2);

      const p1x = midX - cos * fSpan;
      const p1y = midY - sin * fSpan;
      const p2x = midX + cos * fSpan;
      const p2y = midY + sin * fSpan;

      const grad = _scratchCtx.createLinearGradient(p1x, p1y, p2x, p2y);
      grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      _scratchCtx.fillStyle = grad;
      _scratchCtx.fillRect(0, 0, w, h);
      _scratchCtx.globalCompositeOperation = 'source-over';

      ctx.drawImage(_scratchCanvas, x, y);
    }
  });
})(typeof window !== 'undefined' ? window : this);
