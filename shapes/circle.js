/**
 * SHAPES: Circle (Lingkaran)
 * Modular plugin for OpenFishTools Studio
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: 'circle',
    aliases: ['lingkaran'],
    name: 'Lingkaran',
    title: 'Circle',
    iconSvg: '<circle cx="12" cy="12" r="9.5"/>',
    defaultProps: {
      sizeX: 300,
      sizeY: 300
    },
    controls: {
      size: true,
      roundness: false,
      step: false,
      star: false
    },
    getContour(shapeProps = {}, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      const pts = [];
      const segs = 48;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
      }
      return pts;
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const rx = Math.max(0.1, sx / 2);
      const ry = Math.max(0.1, sy / 2);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    }
  });
})();
