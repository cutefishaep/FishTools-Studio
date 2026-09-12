(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let _lumiaCanvas = null;
  let _lumiaCtx = null;

  reg.register({
    id: 'lumia',
    name: 'Lumia',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Isolate and extract luma threshold highlights with smoothness and intensity',
    params: [
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'smoothness', label: 'Smoothness', type: 'number', min: 0, max: 100, default: 20, unit: '%' },
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 200, default: 100, unit: '%' }
    ],
    renderPost(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const intensity = (fx.intensity !== undefined ? fx.intensity : 100) / 100;
      if (intensity <= 0) return;

      const thresh = (fx.threshold !== undefined ? fx.threshold : 50) / 100;
      const smooth = (fx.smoothness !== undefined ? fx.smoothness : 20) / 100;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, intensity);

      const contrastVal = 1 + thresh * 2.5;
      const blurVal = Math.round(smooth * 12);

      // Primary Path: Native Canvas filter if supported
      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.isCanvasFilterSupported === 'function' && window.FishEffects.isCanvasFilterSupported()) {
        ctx.filter = `contrast(${contrastVal.toFixed(2)}) brightness(${intensity.toFixed(2)}) ${blurVal > 0 ? `blur(${blurVal}px)` : ''}`;
        try {
          ctx.drawImage(el, x, y, w, h);
        } catch (_) {}
        ctx.restore();
        return;
      }

      // Universal Safari WebKit Fallback: Offscreen thresholding & blur
      if (!_lumiaCanvas && typeof document !== 'undefined') {
        _lumiaCanvas = document.createElement('canvas');
        _lumiaCtx = _lumiaCanvas.getContext('2d');
      }
      if (!_lumiaCanvas || !_lumiaCtx) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        ctx.restore();
        return;
      }

      const rw = Math.max(1, Math.round(w));
      const rh = Math.max(1, Math.round(h));
      if (_lumiaCanvas.width !== rw || _lumiaCanvas.height !== rh) {
        _lumiaCanvas.width = rw;
        _lumiaCanvas.height = rh;
      }
      _lumiaCtx.clearRect(0, 0, rw, rh);
      try {
        _lumiaCtx.drawImage(el, 0, 0, rw, rh);
      } catch (_) {
        ctx.restore();
        return;
      }

      // Threshold: multiply pass suppresses shadow & midtones to isolate specular highlights
      const multPasses = Math.min(3, Math.max(1, Math.round(thresh * 3)));
      _lumiaCtx.save();
      _lumiaCtx.globalCompositeOperation = 'multiply';
      for (let p = 0; p < multPasses; p++) {
        try { _lumiaCtx.drawImage(_lumiaCanvas, 0, 0); } catch (_) {}
      }
      _lumiaCtx.restore();

      // Render blurred highlights
      if (blurVal > 0 && typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
        window.FishEffects.drawBlurred(ctx, _lumiaCanvas, rw, rh, blurVal);
      } else {
        try { ctx.drawImage(_lumiaCanvas, x, y, w, h); } catch (_) {}
      }
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
