/**
 * SHAPES: Polygon (Poligon)
 * Modular plugin for OpenFishTools Studio
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: 'polygon',
    aliases: ['poligon'],
    name: 'Poligon',
    title: 'Polygon',
    iconSvg: '<path d="M12 2.5l8.66 5v10L12 22.5l-8.66-5v-10L12 2.5z"/>',
    defaultProps: {
      sizeX: 300,
      sizeY: 300,
      sides: 6,
      roundness: 0
    },
    controls: {
      size: true,
      roundness: true,
      step: { label: 'Sides', min: 3, max: 12, default: 6 },
      star: false
    },
    getContour(shapeProps = {}, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      const pts = [];
      const sides = Math.max(3, parseInt(shapeProps.sides, 10) || 6);
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
      }
      return pts;
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      const sides = Math.max(3, parseInt(shapeProps.sides, 10) || 6);
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
        const px = cx + Math.cos(a) * rx;
        const py = cy + Math.sin(a) * ry;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  });
})();
