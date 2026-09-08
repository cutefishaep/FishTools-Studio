(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  reg.register({
    id: 'tile',
    name: 'Tile',
    category: 'warp',
    icon: 'assets/FXPH.svg',
    description: 'Optimal seamless motion tile repeat with mirror switch',
    params: [
      { id: 'mirror', label: 'Mirror', type: 'switch', default: 1 },
      { id: 'scale', label: 'Scale', type: 'number', min: 10, max: 300, default: 100, unit: '%' },
      { id: 'offsetX', label: 'Offset X', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'offsetY', label: 'Offset Y', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx, rgbSplitFx) {
      if (!ctx || !el) return;

      const bw = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const bh = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;

      const renderRgbSplit = (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.renderRGBSplit === 'function')
        ? window.FishEffects.renderRGBSplit
        : null;

      if (!fx) {
        try {
          if (rgbSplitFx && renderRgbSplit) renderRgbSplit(ctx, el, layer, { x: bx, y: by, w: bw, h: bh }, rgbSplitFx);
          else ctx.drawImage(el, bx, by, bw, bh);
        } catch (_) {}
        return;
      }

      const isMirror = (fx.mirror === 1 || fx.mirror === true || fx.mirror === '1' || fx.mirror === 'true' || fx.mirror === 'on');
      const scale = Math.max(5, (fx.scale !== undefined ? fx.scale : 100)) / 100;
      const tw = Math.max(1, Math.round(bw * scale));
      const th = Math.max(1, Math.round(bh * scale));

      const offX = ((fx.offsetX !== undefined ? fx.offsetX : 0) / 100) * bw;
      const offY = ((fx.offsetY !== undefined ? fx.offsetY : 0) / 100) * bh;
      const baseX = bx + offX;
      const baseY = by + offY;



      const targetCanvas = ctx.canvas;
      const cw = targetCanvas ? targetCanvas.width : (bw * 2);
      const ch = targetCanvas ? targetCanvas.height : (bh * 2);

      let minLocalX = bx - bw * 2;
      let maxLocalX = bx + bw * 3;
      let minLocalY = by - bh * 2;
      let maxLocalY = by + bh * 3;

      if (ctx.getTransform) {
        try {
          const mat = ctx.getTransform();
          const inv = mat.inverse();
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

      let minI = Math.floor((minLocalX - baseX) / tw);
      let maxI = Math.ceil((maxLocalX - baseX) / tw);
      let minJ = Math.floor((minLocalY - baseY) / th);
      let maxJ = Math.ceil((maxLocalY - baseY) / th);

      if (!Number.isFinite(minI) || !Number.isFinite(maxI) || minI > maxI) {
        minI = -1; maxI = 1;
      }
      if (!Number.isFinite(minJ) || !Number.isFinite(maxJ) || minJ > maxJ) {
        minJ = -1; maxJ = 1;
      }

      const MAX_TILES = 15;
      minI = Math.max(minI, -MAX_TILES);
      maxI = Math.min(maxI, MAX_TILES);
      minJ = Math.max(minJ, -MAX_TILES);
      maxJ = Math.min(maxJ, MAX_TILES);

      try {
        for (let j = minJ; j <= maxJ; j++) {
          for (let i = minI; i <= maxI; i++) {
            const tx = baseX + i * tw;
            const ty = baseY + j * th;

            const flipX = isMirror && (Math.abs(i) % 2 === 1);
            const flipY = isMirror && (Math.abs(j) % 2 === 1);

            if (!flipX && !flipY) {
              if (rgbSplitFx && renderRgbSplit) {
                renderRgbSplit(ctx, el, layer, { x: tx, y: ty, w: tw, h: th }, rgbSplitFx);
              } else {
                ctx.drawImage(el, tx, ty, tw, th);
              }
            } else {
              ctx.save();
              ctx.translate(tx + (flipX ? tw : 0), ty + (flipY ? th : 0));
              ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
              if (rgbSplitFx && renderRgbSplit) {
                renderRgbSplit(ctx, el, layer, { x: 0, y: 0, w: tw, h: th }, rgbSplitFx);
              } else {
                ctx.drawImage(el, 0, 0, tw, th);
              }
              ctx.restore();
            }
          }
        }
      } catch (err) {
        try {
          if (rgbSplitFx && renderRgbSplit) renderRgbSplit(ctx, el, layer, { x: bx, y: by, w: bw, h: bh }, rgbSplitFx);
          else ctx.drawImage(el, bx, by, bw, bh);
        } catch (_) {}
      }
    }
  });
})(typeof window !== 'undefined' ? window : this);
