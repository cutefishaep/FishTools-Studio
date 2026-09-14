/**
 * SHAPES: Rectangle (Kotak)
 * Modular plugin for OpenFishTools Studio
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: 'rectangle',
    aliases: ['kotak'],
    name: 'Kotak',
    title: 'Rectangle',
    iconSvg: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
    defaultProps: {
      sizeX: 300,
      sizeY: 300,
      roundness: 24
    },
    controls: {
      size: true,
      roundness: true,
      step: false,
      star: false
    },
    getContour(shapeProps = {}, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      const pts = [];
      const baseW = (shapeProps.sizeX && Number(shapeProps.sizeX) > 0) ? Number(shapeProps.sizeX) : sx;
      const scaleR = sx / Math.max(1, baseW);

      let r = Number(shapeProps.roundness);
      if (isNaN(r) || r < 0) r = 0;
      r = Math.min(r * scaleR, rx, ry);

      if (r <= 0.5) {
        pts.push({ x: -rx, y: -ry }, { x: rx, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry });
      } else {
        const arcSegs = 6;
        for (let i = 0; i <= arcSegs; i++) {
          const a = -Math.PI / 2 + (i / arcSegs) * (Math.PI / 2);
          pts.push({ x: rx - r + Math.cos(a) * r, y: -ry + r + Math.sin(a) * r });
        }
        for (let i = 0; i <= arcSegs; i++) {
          const a = (i / arcSegs) * (Math.PI / 2);
          pts.push({ x: rx - r + Math.cos(a) * r, y: ry - r + Math.sin(a) * r });
        }
        for (let i = 0; i <= arcSegs; i++) {
          const a = Math.PI / 2 + (i / arcSegs) * (Math.PI / 2);
          pts.push({ x: -rx + r + Math.cos(a) * r, y: ry - r + Math.sin(a) * r });
        }
        for (let i = 0; i <= arcSegs; i++) {
          const a = Math.PI + (i / arcSegs) * (Math.PI / 2);
          pts.push({ x: -rx + r + Math.cos(a) * r, y: -ry + r + Math.sin(a) * r });
        }
      }
      return pts;
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      let r = Number(shapeProps.roundness);
      if (isNaN(r) || r < 0) r = 0;
      r = Math.min(r, rx, ry);

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
