(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let tempChanCanvas = null;
  let tempResCanvas = null;

  reg.register({
    id: 'rgb-split',
    name: 'RGB Split',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Chromatic aberration color fringe separation',
    params: [
      { id: 'distance', label: 'Distance', type: 'number', min: 0, max: 100, default: 8, unit: 'px' },
      { id: 'angle', label: 'Angle', type: 'number', min: 0, max: 360, default: 0, unit: '°' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const dist = fx && fx.distance !== undefined ? fx.distance : 8;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      if (dist <= 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      // Fast Path: WebGL Hardware RGB Split via FishToolEngine (< 0.2ms)
      if (typeof window !== 'undefined' && window.FishToolEngine && window.FishToolEngine.isReady && typeof window.FishToolEngine.renderRGBSplit === 'function') {
        if (window.FishToolEngine.renderRGBSplit(ctx, el, bounds, fx)) {
          return;
        }
      }

      const angle = ((fx && fx.angle !== undefined ? fx.angle : 0) * Math.PI) / 180;
      const dx = Math.round(Math.cos(angle) * dist);
      const dy = Math.round(Math.sin(angle) * dist);

      if (typeof document === 'undefined') {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const iw = Math.max(1, Math.round(w));
      const ih = Math.max(1, Math.round(h));
      const pad = Math.max(Math.abs(dx), Math.abs(dy)) + 4;
      const cw = iw + pad * 2;
      const ch = ih + pad * 2;

      if (!tempChanCanvas) tempChanCanvas = document.createElement('canvas');
      if (tempChanCanvas.width !== iw || tempChanCanvas.height !== ih) {
        tempChanCanvas.width = iw;
        tempChanCanvas.height = ih;
      }

      if (!tempResCanvas) tempResCanvas = document.createElement('canvas');
      if (tempResCanvas.width !== cw || tempResCanvas.height !== ch) {
        tempResCanvas.width = cw;
        tempResCanvas.height = ch;
      }

      const cctx = tempChanCanvas.getContext('2d');
      const rctx = tempResCanvas.getContext('2d');
      rctx.clearRect(0, 0, cw, ch);

      const drawChannel = (colorHex, shiftX, shiftY, isFirst) => {
        cctx.clearRect(0, 0, iw, ih);
        cctx.globalCompositeOperation = 'source-over';
        try { cctx.drawImage(el, 0, 0, iw, ih); } catch (_) { return; }

        cctx.globalCompositeOperation = 'multiply';
        cctx.fillStyle = colorHex;
        cctx.fillRect(0, 0, iw, ih);

        cctx.globalCompositeOperation = 'destination-in';
        try { cctx.drawImage(el, 0, 0, iw, ih); } catch (_) { return; }

        rctx.globalCompositeOperation = isFirst ? 'source-over' : 'lighter';
        rctx.drawImage(tempChanCanvas, pad + shiftX, pad + shiftY);
      };

      // 1. Green at center anchor (0, 0)
      drawChannel('#00ff00', 0, 0, true);
      // 2. Red shifted (+dx, +dy)
      drawChannel('#ff0000', dx, dy, false);
      // 3. Blue shifted (-dx, -dy)
      drawChannel('#0000ff', -dx, -dy, false);

      ctx.drawImage(tempResCanvas, x - pad, y - pad, cw, ch);
    }
  });
})(typeof window !== 'undefined' ? window : this);
