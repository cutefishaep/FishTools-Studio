(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'tile',
    name: 'Tile',
    category: 'warp',
    icon: 'assets/FXPH.svg',
    description: 'Optimal seamless motion tile repeat with centered coordinates and symmetrical mirror switch',
    isExpanding: true,
    params: [
      { id: 'mirror', label: 'Mirror', type: 'switch', default: 1 },
      { id: 'scale', label: 'Scale', type: 'number', min: 10, max: 300, default: 100, unit: '%' },
      { id: 'offsetX', label: 'Offset X', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'offsetY', label: 'Offset Y', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;

      const bw = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const bh = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;

      if (!fx) {
        try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
        return;
      }

      const tileWgl = (typeof reg.getBackend === 'function') ? reg.getBackend('tile', 'wgl') : (reg.get('tile') && reg.get('tile').backends && reg.get('tile').backends.wgl);
      if (tileWgl && typeof tileWgl.render === 'function') {
        if (tileWgl.render(ctx, el, layer, bounds, fx)) return;
      }

      const isMirror = !(fx.mirror === 0 || fx.mirror === false || fx.mirror === '0' || fx.mirror === 'false' || fx.mirror === 'off');
      const scale = Math.max(5, (fx.scale !== undefined ? Number(fx.scale) : 100)) / 100;
      const tw = Math.max(1, Math.round(bw * scale));
      const th = Math.max(1, Math.round(bh * scale));

      const offX = ((fx.offsetX !== undefined ? Number(fx.offsetX) : 0) / 100) * tw;
      const offY = ((fx.offsetY !== undefined ? Number(fx.offsetY) : 0) / 100) * th;


      // Center tile (0, 0) directly on the layer/target center
      const centerX = bx + bw / 2;
      const centerY = by + bh / 2;
      const originX = centerX - tw / 2 + offX;
      const originY = centerY - th / 2 + offY;

      // Compute visible viewport bounds in local context coordinate space
      let minLocalX = originX - bw * 3;
      let maxLocalX = originX + bw * 4;
      let minLocalY = originY - bh * 3;
      let maxLocalY = originY + bh * 4;

      if (ctx.getTransform) {
        try {
          const mat = ctx.getTransform();
          const inv = mat.inverse();
          const targetCanvas = ctx.canvas;
          const cw = targetCanvas ? targetCanvas.width : (bw * 3);
          const ch = targetCanvas ? targetCanvas.height : (bh * 3);

          const p1 = inv.transformPoint ? inv.transformPoint({ x: 0, y: 0 }) : null;
          const p2 = inv.transformPoint ? inv.transformPoint({ x: cw, y: 0 }) : null;
          const p3 = inv.transformPoint ? inv.transformPoint({ x: 0, y: ch }) : null;
          const p4 = inv.transformPoint ? inv.transformPoint({ x: cw, y: ch }) : null;

          if (p1 && p2 && p3 && p4 &&
              Number.isFinite(p1.x) && Number.isFinite(p2.x) &&
              Number.isFinite(p3.x) && Number.isFinite(p4.x) &&
              Number.isFinite(p1.y) && Number.isFinite(p2.y) &&
              Number.isFinite(p3.y) && Number.isFinite(p4.y)) {
            minLocalX = Math.min(p1.x, p2.x, p3.x, p4.x);
            maxLocalX = Math.max(p1.x, p2.x, p3.x, p4.x);
            minLocalY = Math.min(p1.y, p2.y, p3.y, p4.y);
            maxLocalY = Math.max(p1.y, p2.y, p3.y, p4.y);
          }
        } catch (_) {}
      }

      let minI = Math.floor((minLocalX - originX) / tw) - 1;
      let maxI = Math.ceil((maxLocalX - originX) / tw) + 1;
      let minJ = Math.floor((minLocalY - originY) / th) - 1;
      let maxJ = Math.ceil((maxLocalY - originY) / th) + 1;

      if (!Number.isFinite(minI) || !Number.isFinite(maxI) || minI > maxI) {
        minI = -2; maxI = 2;
      }
      if (!Number.isFinite(minJ) || !Number.isFinite(maxJ) || minJ > maxJ) {
        minJ = -2; maxJ = 2;
      }

      // Safety clamp
      const MAX_TILES = 30;
      minI = Math.max(minI, -MAX_TILES);
      maxI = Math.min(maxI, MAX_TILES);
      minJ = Math.max(minJ, -MAX_TILES);
      maxJ = Math.min(maxJ, MAX_TILES);

      try {
        for (let j = minJ; j <= maxJ; j++) {
          const ty0 = Math.floor(originY + j * th);
          const ty1 = Math.floor(originY + (j + 1) * th);
          const curTh = ty1 - ty0;
          const flipY = isMirror && (Math.abs(j) % 2 === 1);

          for (let i = minI; i <= maxI; i++) {
            const tx0 = Math.floor(originX + i * tw);
            const tx1 = Math.floor(originX + (i + 1) * tw);
            const curTw = tx1 - tx0;
            const flipX = isMirror && (Math.abs(i) % 2 === 1);

            if (!flipX && !flipY) {
              ctx.drawImage(el, tx0, ty0, curTw, curTh);
            } else {
              ctx.save();
              ctx.translate(tx0 + (flipX ? curTw : 0), ty0 + (flipY ? curTh : 0));
              ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
              ctx.drawImage(el, 0, 0, curTw, curTh);
              ctx.restore();
            }
          }
        }
      } catch (err) {
        try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
      }
    }
  });
})(typeof window !== 'undefined' ? window : this);
