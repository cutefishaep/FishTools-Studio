(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let _scratchCanvas = null;
  let _scratchCtx = null;

  reg.register({
    id: 'wipe_jaws',
    name: 'Wipe Jaws',
    category: 'Wipe',
    icon: 'assets/FXWipeJaws.svg',
    description: 'Jaws wipe transition with interlocking zigzag teeth',
    params: [
      { id: 'completion', label: 'Transition Completion', type: 'number', min: 0, max: 100, default: 0, unit: '%', step: 1 },
      { id: 'angle', label: 'Wipe Angle', type: 'number', min: -360, max: 360, default: 0, unit: '°', step: 1 },
      { id: 'teeth', label: 'Teeth Count', type: 'number', min: 2, max: 100, default: 10, unit: '', step: 1 }
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
      const angle = Number(currentFx.angle !== undefined ? currentFx.angle : (currentFx.params && currentFx.params.angle !== undefined ? currentFx.params.angle : 0));
      const teeth = Math.max(2, Number(currentFx.teeth !== undefined ? currentFx.teeth : (currentFx.params && currentFx.params.teeth !== undefined ? currentFx.params.teeth : 10)));

      if (completion <= 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      if (completion >= 100) {
        return;
      }

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

      _scratchCtx.globalCompositeOperation = 'destination-out';

      const diag = Math.hypot(w, h);
      
      _scratchCtx.save();
      _scratchCtx.translate(w / 2, h / 2);
      _scratchCtx.rotate((angle * Math.PI) / 180);

      // The wipe hides the image.
      // 0%: nothing hidden (jaws at edges)
      // 100%: everything hidden (jaws overlap in center)
      const maxDist = diag / 2;
      
      // Each tooth is a triangle. The teeth are on the edge of the jaws.
      const teethWidth = diag / teeth; // width of one tooth along the edge
      const teethHeight = teethWidth; // depth of the teeth

      // Calculate how far the jaws have moved in.
      // When comp = 0, distance from center is maxDist + teethHeight.
      // When comp = 100, distance from center is -teethHeight (fully overlapped).
      const p = completion / 100;
      const startDist = maxDist;
      const endDist = -teethHeight;
      const currentDist = startDist - p * (startDist - endDist);

      _scratchCtx.fillStyle = 'black';

      // Draw Top Jaw
      _scratchCtx.beginPath();
      _scratchCtx.moveTo(-diag/2, -diag);
      _scratchCtx.lineTo(diag/2, -diag);
      _scratchCtx.lineTo(diag/2, -currentDist);
      
      for (let i = 0; i < teeth; i++) {
        const xRight = diag/2 - i * teethWidth;
        const xLeft = diag/2 - (i+1) * teethWidth;
        const xMid = (xRight + xLeft) / 2;
        _scratchCtx.lineTo(xMid, -currentDist + teethHeight);
        _scratchCtx.lineTo(xLeft, -currentDist);
      }
      _scratchCtx.fill();

      // Draw Bottom Jaw
      _scratchCtx.beginPath();
      _scratchCtx.moveTo(-diag/2, diag);
      _scratchCtx.lineTo(diag/2, diag);
      _scratchCtx.lineTo(diag/2, currentDist);
      
      for (let i = 0; i < teeth; i++) {
        const xRight = diag/2 - i * teethWidth;
        const xLeft = diag/2 - (i+1) * teethWidth;
        const xMid = (xRight + xLeft) / 2;
        _scratchCtx.lineTo(xMid, currentDist - teethHeight);
        _scratchCtx.lineTo(xLeft, currentDist);
      }
      _scratchCtx.fill();

      _scratchCtx.restore();
      _scratchCtx.globalCompositeOperation = 'source-over';

      ctx.drawImage(_scratchCanvas, x, y);
    }
  });
})(typeof window !== 'undefined' ? window : this);
