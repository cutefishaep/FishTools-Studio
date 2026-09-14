/**
 * SHAPES: Star (Bintang)
 * Modular plugin for OpenFishTools Studio
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: 'star',
    aliases: ['bintang'],
    name: 'Bintang',
    title: 'Star',
    iconSvg: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    defaultProps: {
      sizeX: 320,
      sizeY: 320,
      points: 5,
      innerRadius: 0.4
    },
    controls: {
      size: true,
      roundness: false,
      step: false,
      star: true
    },
    getContour(shapeProps = {}, sx = 320, sy = 320) {
      const rx = sx / 2;
      const ry = sy / 2;
      const pts = [];
      const numPts = Math.max(3, parseInt(shapeProps.points, 10) || 5);
      let inR = Number(shapeProps.innerRadius);
      if (isNaN(inR) || inR <= 0) inR = 0.4;
      inR = Math.max(0.1, Math.min(0.9, inR));
      const total = numPts * 2;
      for (let i = 0; i < total; i++) {
        const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
        const radRatio = (i % 2 === 0) ? 1.0 : inR;
        pts.push({ x: Math.cos(a) * rx * radRatio, y: Math.sin(a) * ry * radRatio });
      }
      return pts;
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 320, sy = 320) {
      const rx = sx / 2;
      const ry = sy / 2;
      const numPts = Math.max(3, parseInt(shapeProps.points, 10) || 5);
      let inR = Number(shapeProps.innerRadius);
      if (isNaN(inR) || inR <= 0) inR = 0.4;
      inR = Math.max(0.1, Math.min(0.9, inR));
      const total = numPts * 2;
      for (let i = 0; i < total; i++) {
        const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
        const radRatio = (i % 2 === 0) ? 1.0 : inR;
        const px = cx + Math.cos(a) * rx * radRatio;
        const py = cy + Math.sin(a) * ry * radRatio;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  });
})();
