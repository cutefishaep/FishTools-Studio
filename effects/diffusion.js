(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let _diffBuf = null;
  let _diffCtx = null;
  let _threshBuf = null;
  let _threshCtx = null;

  function getDiffBuffer(w, h) {
    if (typeof document === 'undefined') return null;
    if (!_diffBuf) {
      _diffBuf = document.createElement('canvas');
      _diffCtx = _diffBuf.getContext('2d');
    }
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    if (_diffBuf.width !== rw || _diffBuf.height !== rh) {
      _diffBuf.width = rw;
      _diffBuf.height = rh;
    }
    return { canvas: _diffBuf, ctx: _diffCtx };
  }

  reg.register({
    id: 'diffusion',
    name: 'Diffusion',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Black Pro-Mist style highlight bloom and film diffusion glow',
    params: [
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, default: 40, unit: '%' },
      { id: 'radius', label: 'Radius', type: 'number', min: 2, max: 150, default: 30, unit: 'px' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 60, unit: '%' },
      { id: 'color', label: 'Color', type: 'color', default: '#ffffff' },
      { id: 'blendMode', label: 'Blend Mode', type: 'select', options: ['screen', 'lighter', 'soft-light'], default: 'screen' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      const intensity = Math.max(0, Math.min(100, fx && fx.intensity !== undefined ? Number(fx.intensity) : 40)) / 100;
      const radius = Math.max(1, fx && fx.radius !== undefined ? Number(fx.radius) : 30);
      const threshold = Math.max(0, Math.min(100, fx && fx.threshold !== undefined ? Number(fx.threshold) : 60)) / 100;
      const color = (fx && fx.color) ? fx.color : '#ffffff';
      const blendMode = (fx && fx.blendMode) || 'screen';

      // Draw base image first
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}

      if (intensity <= 0.01) return;

      // Extract high-key bloom into offscreen buffer
      const buf = getDiffBuffer(w, h);
      if (!buf || !buf.ctx) return;
      const bCtx = buf.ctx;

      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.isCanvasFilterSupported === 'function' && window.FishEffects.isCanvasFilterSupported()) {
        bCtx.clearRect(0, 0, w, h);
        bCtx.save();
        const contrast = 1.0 + threshold * 2.0;
        const brightness = 0.6 + (1.0 - threshold) * 0.8;
        bCtx.filter = `contrast(${contrast.toFixed(2)}) brightness(${brightness.toFixed(2)}) blur(${radius.toFixed(1)}px)`;
        try {
          bCtx.drawImage(el, 0, 0, w, h);
        } catch (_) {}
        bCtx.restore();
      } else {
        // Universal Safari WebKit Fallback: Extract highlights via thresholding and blur
        bCtx.clearRect(0, 0, w, h);
        try { bCtx.drawImage(el, 0, 0, w, h); } catch (_) {}
        if (threshold > 0.1) {
          bCtx.save();
          bCtx.globalCompositeOperation = 'multiply';
          const multPasses = Math.min(3, Math.max(1, Math.round(threshold * 3)));
          for (let p = 0; p < multPasses; p++) {
            try { bCtx.drawImage(buf.canvas, 0, 0); } catch (_) {}
          }
          bCtx.restore();
        }
        if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
          // Create temp snapshot to blur from
          if (!_threshBuf) {
            _threshBuf = document.createElement('canvas');
            _threshCtx = _threshBuf.getContext('2d');
          }
          if (_threshBuf.width !== w || _threshBuf.height !== h) {
            _threshBuf.width = w;
            _threshBuf.height = h;
          }
          _threshCtx.clearRect(0, 0, w, h);
          _threshCtx.drawImage(buf.canvas, 0, 0);

          bCtx.clearRect(0, 0, w, h);
          window.FishEffects.drawBlurred(bCtx, _threshBuf, w, h, radius);
        }
      }

      // Tint bloom if color is specified and not pure white
      if (color && color.toLowerCase() !== '#ffffff') {
        bCtx.save();
        bCtx.globalCompositeOperation = 'source-in';
        bCtx.fillStyle = color;
        bCtx.fillRect(0, 0, w, h);
        bCtx.restore();
      }

      // Composite dreamy bloom over base image
      ctx.save();
      ctx.globalCompositeOperation = blendMode;
      ctx.globalAlpha = Math.min(1.0, intensity);
      try {
        ctx.drawImage(buf.canvas, x, y, w, h);
      } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
