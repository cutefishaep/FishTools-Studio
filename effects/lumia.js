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

      // Threshold: smooth Hermite isolation of specular highlights (no multiply posterization)
      try {
        const imgData = _lumiaCtx.getImageData(0, 0, rw, rh);
        const data = imgData.data;
        const threshVal = thresh * 255;
        const knee = Math.max(15, smooth * 60);
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] <= 3) continue;
          const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          if (luma < threshVal - knee) {
            data[i + 3] = 0;
          } else {
            const factor = Math.min(1.0, Math.max(0.0, (luma - (threshVal - knee)) / (knee * 2)));
            const s = factor * factor * (3.0 - 2.0 * factor);
            data[i + 3] = Math.round(data[i + 3] * s);
          }
        }
        _lumiaCtx.putImageData(imgData, 0, 0);
      } catch (_) {}

      // Render blurred highlights with proper layer offset (x, y)
      if (blurVal > 0 && typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
        window.FishEffects.drawBlurred(ctx, _lumiaCanvas, rw, rh, blurVal, x, y);
      } else {
        try { ctx.drawImage(_lumiaCanvas, x, y, rw, rh); } catch (_) {}
      }
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
