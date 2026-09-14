/**
 * SHAPES: Capsule (Kapsul)
 * Modular plugin for OpenFishTools Studio
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: 'capsule',
    aliases: ['kapsul'],
    name: 'Kapsul',
    title: 'Capsule',
    iconSvg: '<rect x="3" y="6" width="18" height="12" rx="6"/>',
    defaultProps: {
      sizeX: 360,
      sizeY: 180
    },
    controls: {
      size: true,
      roundness: false,
      step: false,
      star: false
    },
    getContour(shapeProps = {}, sx = 360, sy = 180) {
      const rx = sx / 2;
      const ry = sy / 2;
      const pts = [];
      const r = Math.min(rx, ry);
      const arcSegs = 8;
      if (rx >= ry) {
        for (let i = 0; i <= arcSegs; i++) {
          const a = -Math.PI / 2 + (i / arcSegs) * Math.PI;
          pts.push({ x: rx - r + Math.cos(a) * r, y: Math.sin(a) * r });
        }
        for (let i = 0; i <= arcSegs; i++) {
          const a = Math.PI / 2 + (i / arcSegs) * Math.PI;
          pts.push({ x: -rx + r + Math.cos(a) * r, y: Math.sin(a) * r });
        }
      } else {
        for (let i = 0; i <= arcSegs; i++) {
          const a = (i / arcSegs) * Math.PI;
          pts.push({ x: Math.cos(a) * r, y: ry - r + Math.sin(a) * r });
        }
        for (let i = 0; i <= arcSegs; i++) {
          const a = Math.PI + (i / arcSegs) * Math.PI;
          pts.push({ x: Math.cos(a) * r, y: -ry + r + Math.sin(a) * r });
        }
      }
      return pts;
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 360, sy = 180) {
      const rx = sx / 2;
      const ry = sy / 2;
      const r = Math.min(rx, ry);
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(cx - rx, cy - ry, sx, sy, r);
      } else {
        ctx.moveTo(cx - rx + r, cy - ry);
        ctx.arcTo(cx + rx, cy - ry, cx + rx, cy + ry, r);
        ctx.arcTo(cx + rx, cy + ry, cx - rx, cy + ry, r);
        ctx.arcTo(cx - rx, cy + ry, cx - rx, cy - ry, r);
        ctx.arcTo(cx - rx, cy - ry, cx + rx, cy - ry, r);
        ctx.closePath();
      }
    }
  });
})();
