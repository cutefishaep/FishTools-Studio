/**
 * SHAPES: Triangle (Segitiga)
 * Modular plugin for OpenFishTools Studio
 */

(function() {
  'use strict';

  if (!window.FishShapesRegistry) return;

  window.FishShapesRegistry.register({
    id: 'triangle',
    aliases: ['segitiga'],
    name: 'Segitiga',
    title: 'Triangle',
    iconSvg: '<path d="M12 3.2L2.8 19.5c-.8 1.4.2 3.2 1.8 3.2h14.8c1.6 0 2.6-1.8 1.8-3.2L12 3.2z"/>',
    defaultProps: {
      sizeX: 300,
      sizeY: 300,
      step: 3,
      roundness: 0
    },
    controls: {
      size: true,
      roundness: true,
      step: { label: 'Step', min: 3, max: 12, default: 3 },
      star: false
    },
    getContour(shapeProps = {}, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      const pts = [];
      const baseW = (shapeProps.sizeX && Number(shapeProps.sizeX) > 0) ? Number(shapeProps.sizeX) : sx;
      const scaleR = sx / Math.max(1, baseW);
      const step = Math.max(3, parseInt(shapeProps.step || shapeProps.steps, 10) || 3);

      if (step === 3) {
        let r = Number(shapeProps.roundness);
        if (isNaN(r) || r < 0) r = 0;
        r = r * scaleR;
        if (r <= 0.5) {
          pts.push({ x: 0, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry });
        } else {
          const raw = [{ x: 0, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry }];
          const cornerR = Math.min(r, Math.min(sx, sy) * 0.25);
          for (let i = 0; i < 3; i++) {
            const pPrev = raw[(i + 2) % 3];
            const pCurr = raw[i];
            const pNext = raw[(i + 1) % 3];
            const v1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
            const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };
            const l1 = Math.hypot(v1.x, v1.y) || 1;
            const l2 = Math.hypot(v2.x, v2.y) || 1;
            const u1 = { x: v1.x / l1, y: v1.y / l1 };
            const u2 = { x: v2.x / l2, y: v2.y / l2 };
            const startPt = { x: pCurr.x + u1.x * cornerR, y: pCurr.y + u1.y * cornerR };
            const endPt = { x: pCurr.x + u2.x * cornerR, y: pCurr.y + u2.y * cornerR };
            pts.push(startPt);
            for (let k = 1; k <= 4; k++) {
              const t = k / 5;
              pts.push({
                x: (1 - t) * (1 - t) * startPt.x + 2 * (1 - t) * t * pCurr.x + t * t * endPt.x,
                y: (1 - t) * (1 - t) * startPt.y + 2 * (1 - t) * t * pCurr.y + t * t * endPt.y
              });
            }
            pts.push(endPt);
          }
        }
      } else {
        for (let i = 0; i < step; i++) {
          const a = -Math.PI / 2 + (i / step) * Math.PI * 2;
          pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
        }
      }
      return pts;
    },
    drawPath(ctx, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const rx = sx / 2;
      const ry = sy / 2;
      const step = Math.max(3, parseInt(shapeProps.step || shapeProps.steps, 10) || 3);

      if (step === 3) {
        let r = Number(shapeProps.roundness);
        if (isNaN(r) || r < 0) r = 0;
        if (r <= 0.5) {
          ctx.moveTo(cx, cy - ry);
          ctx.lineTo(cx + rx, cy + ry);
          ctx.lineTo(cx - rx, cy + ry);
          ctx.closePath();
        } else {
          const pts = this.getContour(shapeProps, sx, sy);
          if (pts.length > 0) {
            ctx.moveTo(cx + pts[0].x, cy + pts[0].y);
            for (let i = 1; i < pts.length; i++) {
              ctx.lineTo(cx + pts[i].x, cy + pts[i].y);
            }
            ctx.closePath();
          } else {
            ctx.moveTo(cx, cy - ry);
            ctx.lineTo(cx + rx, cy + ry);
            ctx.lineTo(cx - rx, cy + ry);
            ctx.closePath();
          }
        }
      } else {
        for (let i = 0; i < step; i++) {
          const a = -Math.PI / 2 + (i / step) * Math.PI * 2;
          const px = cx + Math.cos(a) * rx;
          const py = cy + Math.sin(a) * ry;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
    }
  });
})();
