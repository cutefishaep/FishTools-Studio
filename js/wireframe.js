/**
 * OpenFishTools Studio - Modular Canvas Wireframe & Selection Bounding Box Component
 * 100% Theme Token Binding, Pure Flat Vector Lines, 8 Control Handles
 */
(function(window) {
  'use strict';

  const CanvasWireframe = {
    /**
     * Compute 8 control handles (4 corners + 4 edge midpoints) + center anchor
     * @param {{ x: number, y: number, w: number, h: number }} bounds
     * @param {number} [handleSize=8]
     * @returns {Array<{ type: string, x: number, y: number, cursor: string }>}
     */
    /**
     * Compute 8 control handles (4 corners + 4 edge midpoints) + center anchor
     * @param {{ x: number, y: number, w: number, h: number, cx?: number, cy?: number, rotation?: number, skewX?: number, skewY?: number }} bounds
     * @param {number} [handleSize=8]
     * @returns {Array<{ type: string, x: number, y: number, cursor: string }>}
     */
    getHandles(bounds, handleSize = 8) {
      if (bounds.handles && Array.isArray(bounds.handles)) {
        return bounds.handles;
      }

      if (bounds.corners && Array.isArray(bounds.corners) && bounds.corners.length === 4) {
        const c = bounds.corners;
        const defaultAnchor = { x: (c[0].x + c[1].x + c[2].x + c[3].x) / 4, y: (c[0].y + c[1].y + c[2].y + c[3].y) / 4 };
        const anc = bounds.anchor || defaultAnchor;
        return [
          { type: 'nw', x: c[0].x, y: c[0].y, cursor: 'nwse-resize' },
          { type: 'n',  x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2, cursor: 'ns-resize' },
          { type: 'ne', x: c[1].x, y: c[1].y, cursor: 'nesw-resize' },
          { type: 'e',  x: (c[1].x + c[2].x) / 2, y: (c[1].y + c[2].y) / 2, cursor: 'ew-resize' },
          { type: 'se', x: c[2].x, y: c[2].y, cursor: 'nwse-resize' },
          { type: 's',  x: (c[2].x + c[3].x) / 2, y: (c[2].y + c[3].y) / 2, cursor: 'ns-resize' },
          { type: 'sw', x: c[3].x, y: c[3].y, cursor: 'nesw-resize' },
          { type: 'w',  x: (c[3].x + c[0].x) / 2, y: (c[3].y + c[0].y) / 2, cursor: 'ew-resize' },
          { type: 'anchor', x: anc.x, y: anc.y, cursor: 'move' }
        ];
      }

      const { w, h } = bounds;

      if (!bounds.isCamera && bounds.cx !== undefined && bounds.cy !== undefined) {
        const engine = window.FishToolEngine || window.LayerTransform;
        if (engine) {
          const ltBounds = engine.getBounds(bounds, 1);
          if (ltBounds && ltBounds.handles) return ltBounds.handles;
        }

        const { cx, cy, rotation = 0, skewX = 0, skewY = 0 } = bounds;
        const rad = (rotation * Math.PI) / 180;
        const tanX = Math.tan((skewX * Math.PI) / 180);
        const tanY = Math.tan((skewY * Math.PI) / 180);

        const toGlobal = (lx, ly) => {
          const sx = lx + tanX * ly;
          const sy = tanY * lx + ly;
          const rx = sx * Math.cos(rad) - sy * Math.sin(rad);
          const ry = sx * Math.sin(rad) + sy * Math.cos(rad);
          return { x: cx + rx, y: cy + ry };
        };

        const localPoints = [
          { type: 'nw', lx: -w / 2, ly: -h / 2, cursor: 'nwse-resize' },
          { type: 'n',  lx: 0,      ly: -h / 2, cursor: 'ns-resize' },
          { type: 'ne', lx: w / 2,  ly: -h / 2, cursor: 'nesw-resize' },
          { type: 'e',  lx: w / 2,  ly: 0,      cursor: 'ew-resize' },
          { type: 'se', lx: w / 2,  ly: h / 2,  cursor: 'nwse-resize' },
          { type: 's',  lx: 0,      ly: h / 2,  cursor: 'ns-resize' },
          { type: 'sw', lx: -w / 2, ly: h / 2,  cursor: 'nesw-resize' },
          { type: 'w',  lx: -w / 2, ly: 0,      cursor: 'ew-resize' },
          { type: 'anchor', lx: bounds.anchorX || 0, ly: bounds.anchorY || 0, cursor: 'move' }
        ];

        return localPoints.map(p => {
          const g = toGlobal(p.lx, p.ly);
          return { type: p.type, x: g.x, y: g.y, cursor: p.cursor };
        });
      }

      const { x, y } = bounds;
      return [
        { type: 'nw', x: x, y: y, cursor: 'nwse-resize' },
        { type: 'n',  x: x + w / 2, y: y, cursor: 'ns-resize' },
        { type: 'ne', x: x + w, y: y, cursor: 'nesw-resize' },
        { type: 'e',  x: x + w, y: y + h / 2, cursor: 'ew-resize' },
        { type: 'se', x: x + w, y: y + h, cursor: 'nwse-resize' },
        { type: 's',  x: x + w / 2, y: y + h, cursor: 'ns-resize' },
        { type: 'sw', x: x, y: y + h, cursor: 'nesw-resize' },
        { type: 'w',  x: x, y: y + h / 2, cursor: 'ew-resize' },
        { type: 'anchor', x: (bounds.anchor ? bounds.anchor.x : (x + w / 2 + (bounds.anchorX || 0))), y: (bounds.anchor ? bounds.anchor.y : (y + h / 2 + (bounds.anchorY || 0))), cursor: 'move' }
      ];
    },

    /**
     * Draw wireframe directly onto any 2D Canvas Rendering Context
     * @param {CanvasRenderingContext2D} ctx
     * @param {{ x: number, y: number, w: number, h: number, cx?: number, cy?: number, rotation?: number, skewX?: number, skewY?: number }} bounds
     * @param {Object} [options]
     */
    draw(ctx, bounds, options = {}) {
      if (!ctx || !bounds) return;
      const { w, h } = bounds;
      if (w <= 0 || h <= 0) return;

      const style = getComputedStyle(document.documentElement);
      const primaryColor = options.color || style.getPropertyValue('--color-primary').trim() || '#98ce7b';
      const canvasBg = options.bgColor || style.getPropertyValue('--bg-canvas').trim() || '#0d1109';

      let dprScale = 1;
      if (ctx.canvas) {
        if (options.dprScale) {
          dprScale = options.dprScale;
        } else if (typeof ctx.canvas.getBoundingClientRect === 'function') {
          const rect = ctx.canvas.getBoundingClientRect();
          if (rect && rect.width > 0) {
            dprScale = ctx.canvas.width / rect.width;
          }
        }
      }

      const cssHandleSize = options.cssHandleSize || 8;
      const cssLineWidth = options.cssLineWidth || 1.5;
      const cssBorderWidth = options.cssBorderWidth || 1.5;

      const lineWidth = options.lineWidth || Math.max(1, Math.round(cssLineWidth * dprScale));
      const handleSize = options.handleSize || Math.max(3, Math.round(cssHandleSize * dprScale));
      const handleBorder = options.handleBorder || Math.max(1, Math.round(cssBorderWidth * dprScale));
      const half = handleSize / 2;

      ctx.save();

      // Special: Camera Viewfinder Wireframe
      if (bounds.isCamera) {
        this.drawCamera(ctx, bounds, {
          ...options,
          primaryColor,
          canvasBg,
          dprScale,
          lineWidth,
          handleSize,
          handleBorder
        });
        ctx.restore();
        return;
      }

      const showAnchor = (options.showAnchor !== false) && (!options.hideAnchor);
      const showHandles = (options.showHandles !== false) && (!options.hideHandles);

      if (bounds.corners && Array.isArray(bounds.corners) && bounds.corners.length === 4) {
        // 1. Crisp bounding quad or adaptive shape contour stroke
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = primaryColor;
        ctx.beginPath();
        if (bounds.shapeContour && Array.isArray(bounds.shapeContour) && bounds.shapeContour.length >= 3) {
          ctx.moveTo(bounds.shapeContour[0].x, bounds.shapeContour[0].y);
          for (let i = 1; i < bounds.shapeContour.length; i++) {
            ctx.lineTo(bounds.shapeContour[i].x, bounds.shapeContour[i].y);
          }
        } else {
          ctx.moveTo(bounds.corners[0].x, bounds.corners[0].y);
          for (let i = 1; i < bounds.corners.length; i++) {
            ctx.lineTo(bounds.corners[i].x, bounds.corners[i].y);
          }
        }
        ctx.closePath();
        ctx.stroke();

        // 2. Center Anchor Point
        if (showAnchor) {
          const anchor = bounds.anchor || {
            x: (bounds.cx !== undefined ? bounds.cx + (bounds.anchorX || 0) : ((bounds.corners[0].x + bounds.corners[1].x + bounds.corners[2].x + bounds.corners[3].x) / 4)),
            y: (bounds.cy !== undefined ? bounds.cy + (bounds.anchorY || 0) : ((bounds.corners[0].y + bounds.corners[1].y + bounds.corners[2].y + bounds.corners[3].y) / 4))
          };
          const isAnchorMode = !!options.isAnchorMode;
          const anchorRadius = Math.max(3.5, Math.round((isAnchorMode ? 6 : 5) * dprScale));
          const anchorDot = Math.max(1.5, Math.round((isAnchorMode ? 2.5 : 1.75) * dprScale));
          const crossArm = Math.max(2, Math.round((isAnchorMode ? 4 : 3) * dprScale));

          ctx.beginPath();
          ctx.arc(anchor.x, anchor.y, anchorRadius, 0, Math.PI * 2);
          ctx.strokeStyle = primaryColor;
          ctx.lineWidth = isAnchorMode ? Math.max(2, lineWidth + 0.5) : lineWidth;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(anchor.x, anchor.y, anchorDot, 0, Math.PI * 2);
          ctx.fillStyle = primaryColor;
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(anchor.x - anchorRadius - crossArm, anchor.y); ctx.lineTo(anchor.x - anchorRadius, anchor.y);
          ctx.moveTo(anchor.x + anchorRadius, anchor.y); ctx.lineTo(anchor.x + anchorRadius + crossArm, anchor.y);
          ctx.moveTo(anchor.x, anchor.y - anchorRadius - crossArm); ctx.lineTo(anchor.x, anchor.y - anchorRadius);
          ctx.moveTo(anchor.x, anchor.y + anchorRadius); ctx.lineTo(anchor.x, anchor.y + anchorRadius + crossArm);
          ctx.strokeStyle = primaryColor;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        }

        // 3. 8 Perimeter control handles
        if (showHandles) {
          const handles = (bounds.handles || this.getHandles(bounds, handleSize)).filter(h => h.type !== 'anchor');
          handles.forEach(p => {
            const px = Math.round(p.x);
            const py = Math.round(p.y);
            ctx.fillStyle = primaryColor;
            ctx.fillRect(px - half, py - half, handleSize, handleSize);
            ctx.fillStyle = canvasBg;
            const innerSize = Math.max(1, handleSize - handleBorder * 2);
            ctx.fillRect(px - half + handleBorder, py - half + handleBorder, innerSize, innerSize);
          });
        }

      } else if (bounds.cx !== undefined && bounds.cy !== undefined) {
        const { cx, cy, rotation = 0, rotX = 0, rotY = 0, skewX = 0, skewY = 0 } = bounds;
        ctx.translate(cx, cy);
        if (rotation) {
          ctx.rotate((rotation * Math.PI) / 180);
        }
        if (rotX || rotY) {
          const cosX = Math.cos((rotX * Math.PI) / 180);
          const cosY = Math.cos((rotY * Math.PI) / 180);
          ctx.scale(cosY, cosX);
        }
        if (skewX || skewY) {
          const tanX = Math.tan((skewX * Math.PI) / 180);
          const tanY = Math.tan((skewY * Math.PI) / 180);
          ctx.transform(1, tanY, tanX, 1, 0, 0);
        }

        // 1. Crisp bounding box or adaptive shape contour stroke
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = primaryColor;
        if (bounds.shapeContourLocal && Array.isArray(bounds.shapeContourLocal) && bounds.shapeContourLocal.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(bounds.shapeContourLocal[0].x, bounds.shapeContourLocal[0].y);
          for (let i = 1; i < bounds.shapeContourLocal.length; i++) {
            ctx.lineTo(bounds.shapeContourLocal[i].x, bounds.shapeContourLocal[i].y);
          }
          ctx.closePath();
          ctx.stroke();
        } else {
          ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, Math.round(w), Math.round(h));
        }

        // 2. Center Anchor Point
        if (showAnchor) {
          const isAnchorMode = !!options.isAnchorMode;
          const anchorRadius = Math.max(3.5, Math.round((isAnchorMode ? 6 : 5) * dprScale));
          const anchorDot = Math.max(1.5, Math.round((isAnchorMode ? 2.5 : 1.75) * dprScale));
          const crossArm = Math.max(2, Math.round((isAnchorMode ? 4 : 3) * dprScale));
          const ax = bounds.anchorX || 0;
          const ay = bounds.anchorY || 0;

          ctx.beginPath();
          ctx.arc(ax, ay, anchorRadius, 0, Math.PI * 2);
          ctx.strokeStyle = primaryColor;
          ctx.lineWidth = isAnchorMode ? Math.max(2, lineWidth + 0.5) : lineWidth;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(ax, ay, anchorDot, 0, Math.PI * 2);
          ctx.fillStyle = primaryColor;
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(ax - anchorRadius - crossArm, ay); ctx.lineTo(ax - anchorRadius, ay);
          ctx.moveTo(ax + anchorRadius, ay); ctx.lineTo(ax + anchorRadius + crossArm, ay);
          ctx.moveTo(ax, ay - anchorRadius - crossArm); ctx.lineTo(ax, ay - anchorRadius);
          ctx.moveTo(ax, ay + anchorRadius); ctx.lineTo(ax, ay + anchorRadius + crossArm);
          ctx.strokeStyle = primaryColor;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        }

        // 3. 8 Control handles in local space
        if (showHandles) {
          const localPoints = [
            { x: -w / 2, y: -h / 2 },
            { x: 0,      y: -h / 2 },
            { x: w / 2,  y: -h / 2 },
            { x: w / 2,  y: 0 },
            { x: w / 2,  y: h / 2 },
            { x: 0,      y: h / 2 },
            { x: -w / 2, y: h / 2 },
            { x: -w / 2, y: 0 }
          ];

          localPoints.forEach(p => {
            const px = Math.round(p.x);
            const py = Math.round(p.y);
            ctx.fillStyle = primaryColor;
            ctx.fillRect(px - half, py - half, handleSize, handleSize);
            ctx.fillStyle = canvasBg;
            const innerSize = Math.max(1, handleSize - handleBorder * 2);
            ctx.fillRect(px - half + handleBorder, py - half + handleBorder, innerSize, innerSize);
          });
        }

      } else {
        const { x, y } = bounds;
        // 1. Crisp bounding box or adaptive shape contour stroke
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = primaryColor;
        if (bounds.shapeContour && Array.isArray(bounds.shapeContour) && bounds.shapeContour.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(bounds.shapeContour[0].x, bounds.shapeContour[0].y);
          for (let i = 1; i < bounds.shapeContour.length; i++) {
            ctx.lineTo(bounds.shapeContour[i].x, bounds.shapeContour[i].y);
          }
          ctx.closePath();
          ctx.stroke();
        } else {
          ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
        }

        // 2. Center Anchor Point (Poros Titik Tengah Simetris)
        if (showAnchor) {
          const isAnchorMode = !!options.isAnchorMode;
          const cx = Math.round(x + w / 2 + (bounds.anchorX || 0));
          const cy = Math.round(y + h / 2 + (bounds.anchorY || 0));
          const anchorRadius = Math.max(3.5, Math.round((isAnchorMode ? 6 : 5) * dprScale));
          const anchorDot = Math.max(1.5, Math.round((isAnchorMode ? 2.5 : 1.75) * dprScale));
          const crossArm = Math.max(2, Math.round((isAnchorMode ? 4 : 3) * dprScale));

          // Anchor circle
          ctx.beginPath();
          ctx.arc(cx, cy, anchorRadius, 0, Math.PI * 2);
          ctx.strokeStyle = primaryColor;
          ctx.lineWidth = isAnchorMode ? Math.max(2, lineWidth + 0.5) : lineWidth;
          ctx.stroke();

          // Anchor center solid dot
          ctx.beginPath();
          ctx.arc(cx, cy, anchorDot, 0, Math.PI * 2);
          ctx.fillStyle = primaryColor;
          ctx.fill();

          // Anchor 4 crosshair ticks
          ctx.beginPath();
          ctx.moveTo(cx - anchorRadius - crossArm, cy); ctx.lineTo(cx - anchorRadius, cy);
          ctx.moveTo(cx + anchorRadius, cy); ctx.lineTo(cx + anchorRadius + crossArm, cy);
          ctx.moveTo(cx, cy - anchorRadius - crossArm); ctx.lineTo(cx, cy - anchorRadius);
          ctx.moveTo(cx, cy + anchorRadius); ctx.lineTo(cx, cy + anchorRadius + crossArm);
          ctx.strokeStyle = primaryColor;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        }

        // 3. 8 Control point handles (4 corners + 4 edge centers)
        if (showHandles) {
          const handles = this.getHandles(bounds, handleSize).filter(h => h.type !== 'anchor');
          handles.forEach(p => {
            const px = Math.round(p.x);
            const py = Math.round(p.y);
            ctx.fillStyle = primaryColor;
            ctx.fillRect(px - half, py - half, handleSize, handleSize);
            ctx.fillStyle = canvasBg;
            const innerSize = Math.max(1, handleSize - handleBorder * 2);
            ctx.fillRect(px - half + handleBorder, py - half + handleBorder, innerSize, innerSize);
          });
        }
      }

      ctx.restore();
    },

    /**
     * Draw layer position motion path & frame-by-frame position dots onto canvas
     * Performance-gated: only rendered for layers with >= 2 move keyframes during active 'move' tool mode
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} layer - Layer data with keyframes.move
     * @param {Object} [options] - Options: bufferScale, fps, currentSec, color, bgColor, dprScale
     */
    drawMotionPath(ctx, layer, options = {}) {
      if (!ctx || !layer) return;
      const kfs = layer.keyframes && layer.keyframes.move;
      if (!kfs || !Array.isArray(kfs) || kfs.length < 2) return;

      // 1. Sort keyframes ascending by time
      const sorted = [...kfs].sort((a, b) => a.time - b.time);
      const tStart = sorted[0].time;
      const tEnd = sorted[sorted.length - 1].time;
      if (tEnd <= tStart) return;

      const bufferScale = options.bufferScale || 1;

      // Resolve project FPS dynamically with full multi-source fallback
      let rawFps = options.fps;
      if (!rawFps || isNaN(parseInt(rawFps, 10))) {
        if (typeof window.getProjectFps === 'function') {
          rawFps = window.getProjectFps();
        } else if (typeof window.currentTimelineFps === 'number' && window.currentTimelineFps > 0) {
          rawFps = window.currentTimelineFps;
        } else if (window.currentProjectState && window.currentProjectState.fps) {
          rawFps = window.currentProjectState.fps;
        } else {
          const domFps = document.getElementById('dropdown-fps')?.dataset?.value;
          if (domFps) rawFps = domFps;
        }
      }
      const fps = Math.max(1, Math.min(240, parseInt(rawFps, 10) || 60));

      // Theme tokens
      const style = getComputedStyle(document.documentElement);
      const primaryColor = options.color || style.getPropertyValue('--color-primary').trim() || '#98ce7b';
      const canvasBg = options.bgColor || style.getPropertyValue('--bg-canvas').trim() || '#0d1109';

      let dprScale = options.dprScale || 1;
      if (!options.dprScale && ctx.canvas && typeof ctx.canvas.getBoundingClientRect === 'function') {
        const rect = ctx.canvas.getBoundingClientRect();
        if (rect && rect.width > 0) {
          dprScale = ctx.canvas.width / rect.width;
        }
      }

      // High-performance cubic bezier solver helper (with overshoot support)
      const evalBezier = (x1, y1, x2, y2, t) => {
        if (typeof window.evaluateCubicBezier === 'function') {
          return window.evaluateCubicBezier(x1, y1, x2, y2, t);
        }
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        if ((x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) || (x1 === y1 && x2 === y2)) return t;
        const sampleX = s => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
        const sampleY = s => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
        const sampleDX = s => 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
        let s = t;
        for (let i = 0; i < 8; i++) {
          const curX = sampleX(s) - t;
          if (Math.abs(curX) < 1e-5) return sampleY(s);
          const dX = sampleDX(s);
          if (Math.abs(dX) < 1e-5) break;
          s -= curX / dX;
        }
        let low = 0.0, high = 1.0;
        s = t;
        for (let j = 0; j < 12; j++) {
          const curX = sampleX(s);
          if (Math.abs(curX - t) < 1e-4) return sampleY(s);
          if (t > curX) low = s;
          else high = s;
          s = (high - low) / 2 + low;
        }
        return sampleY(s);
      };

      // Helper to compute interpolated position (x, y) at time t
      const getPointAt = (t) => {
        const getKfPos = (kf) => {
          const v = kf && kf.value;
          return {
            x: v && v.posX !== undefined ? v.posX : (v && v.x !== undefined ? v.x : (layer.posX || 0)),
            y: v && v.posY !== undefined ? v.posY : (v && v.y !== undefined ? v.y : (layer.posY || 0))
          };
        };

        let posX, posY;
        if (t <= sorted[0].time) {
          const p0 = getKfPos(sorted[0]);
          posX = p0.x;
          posY = p0.y;
        } else if (t >= sorted[sorted.length - 1].time) {
          const plast = getKfPos(sorted[sorted.length - 1]);
          posX = plast.x;
          posY = plast.y;
        } else {
          for (let i = 0; i < sorted.length - 1; i++) {
            const k0 = sorted[i];
            const k1 = sorted[i + 1];
            if (t >= k0.time && t <= k1.time) {
              const span = k1.time - k0.time;
              const u = span > 0 ? (t - k0.time) / span : 0;
              const easing = k0.easing || [0.0, 0.0, 1.0, 1.0];
              const eased = evalBezier(easing[0], easing[1], easing[2], easing[3], u);
              const p0 = getKfPos(k0);
              const p1 = getKfPos(k1);
              posX = p0.x + (p1.x - p0.x) * eased;
              posY = p0.y + (p1.y - p0.y) * eased;
              break;
            }
          }
        }

        return {
          x: posX * bufferScale,
          y: posY * bufferScale
        };
      };

      // 1. Continuous Trajectory Line Points (Starting precisely at tStart and ending at tEnd)
      const startFrame = Math.round(tStart * fps);
      const endFrame = Math.round(tEnd * fps);
      const totalFrames = Math.max(1, endFrame - startFrame);

      // Sample density safety limit (max 1800 points for buttery 60fps performance)
      const maxSample = 1800;
      const step = totalFrames > maxSample ? Math.ceil(totalFrames / maxSample) : 1;

      const pathPoints = [getPointAt(tStart)];
      const framePoints = [];

      for (let f = startFrame; f <= endFrame; f += step) {
        const t = f / fps;
        const pt = getPointAt(t);
        framePoints.push(pt);
        if (t > tStart + 1e-4 && t < tEnd - 1e-4) {
          pathPoints.push(pt);
        }
      }
      pathPoints.push(getPointAt(tEnd));

      ctx.save();

      // 1. Draw continuous trajectory track line
      const lineWidth = Math.max(1, Math.round(1.5 * dprScale));
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = primaryColor;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
      for (let i = 1; i < pathPoints.length; i++) {
        ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
      }
      ctx.stroke();

      // 2. Draw frame-by-frame position dots exactly matching project FPS ticks
      const dotRadius = Math.max(1.5, Math.round(2 * dprScale));
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = primaryColor;
      for (let i = 0; i < framePoints.length; i++) {
        const p = framePoints[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Draw distinct keyframe diamond markers
      const kfSize = Math.max(4, Math.round(5.5 * dprScale));
      const kfBorder = Math.max(1, Math.round(1.2 * dprScale));
      ctx.globalAlpha = 1.0;
      for (let i = 0; i < sorted.length; i++) {
        const kp = getPointAt(sorted[i].time);
        ctx.beginPath();
        ctx.moveTo(kp.x, kp.y - kfSize);
        ctx.lineTo(kp.x + kfSize, kp.y);
        ctx.lineTo(kp.x, kp.y + kfSize);
        ctx.lineTo(kp.x - kfSize, kp.y);
        ctx.closePath();
        ctx.fillStyle = primaryColor;
        ctx.fill();
        ctx.lineWidth = kfBorder;
        ctx.strokeStyle = canvasBg;
        ctx.stroke();
      }

      // 4. Highlight current playhead position indicator if playhead is within keyframe span
      if (options.currentSec !== undefined && options.currentSec !== null) {
        if (options.currentSec >= tStart - 0.05 && options.currentSec <= tEnd + 0.05) {
          const cp = getPointAt(options.currentSec);
          const ringRadius = Math.max(4.5, Math.round(6.5 * dprScale));
          const ringBorder = Math.max(1.5, Math.round(2 * dprScale));
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, ringRadius, 0, Math.PI * 2);
          ctx.lineWidth = ringBorder;
          ctx.strokeStyle = primaryColor;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(cp.x, cp.y, Math.max(1.5, Math.round(2.5 * dprScale)), 0, Math.PI * 2);
          ctx.fillStyle = primaryColor;
          ctx.fill();
        }
      }

      ctx.restore();
    },

    /**
     * Test if coordinate (x, y) hits any control handle or center anchor
     * @param {{ x: number, y: number, w: number, h: number, cx?: number, cy?: number, rotation?: number, skewX?: number, skewY?: number }} bounds
     * @param {number} x
     * @param {number} y
     * @param {number} [hitTolerance=12]
     * @returns {{ type: string, x: number, y: number, cursor: string } | null}
     */
    hitTestHandle(bounds, x, y, hitTolerance = 12, allowAnchor = true) {
      if (!bounds) return null;
      const handles = this.getHandles(bounds);
      // Check scale handles first, then anchor
      for (const h of handles) {
        if (h.type === 'anchor') continue;
        const dx = x - h.x;
        const dy = y - h.y;
        if (Math.sqrt(dx * dx + dy * dy) <= hitTolerance) {
          return h;
        }
      }
      if (allowAnchor) {
        const anchor = handles.find(h => h.type === 'anchor');
        if (anchor) {
          const dx = x - anchor.x;
          const dy = y - anchor.y;
          if (Math.sqrt(dx * dx + dy * dy) <= hitTolerance) {
            return anchor;
          }
        }
      }
      return null;
    },

    /**
     * Hit test a coordinate (x, y) against layer bounds
     * @param {{ x: number, y: number, w: number, h: number, cx?: number, cy?: number, rotation?: number, skewX?: number, skewY?: number }} bounds
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    hitTest(bounds, x, y) {
      if (!bounds) return false;
      const engine = window.FishToolEngine || window.LayerTransform;
      if (bounds.corners && Array.isArray(bounds.corners)) {
        if (engine) {
          return engine.hitTest(bounds, x, y);
        }
      }
      if (bounds.cx !== undefined && bounds.cy !== undefined) {
        if (engine && (bounds.rotX || bounds.rotY)) {
          const ltBounds = engine.getBounds(bounds, 1);
          return engine.hitTest(ltBounds, x, y);
        }
        let lx = x - bounds.cx;
        let ly = y - bounds.cy;
        const rot = bounds.rotation || 0;
        if (rot) {
          const rad = -(rot * Math.PI) / 180;
          const rx = lx * Math.cos(rad) - ly * Math.sin(rad);
          const ry = lx * Math.sin(rad) + ly * Math.cos(rad);
          lx = rx;
          ly = ry;
        }
        const sx = bounds.skewX || 0;
        const sy = bounds.skewY || 0;
        if (sx || sy) {
          const tanX = Math.tan((sx * Math.PI) / 180);
          const tanY = Math.tan((sy * Math.PI) / 180);
          const det = 1 - tanX * tanY;
          if (Math.abs(det) > 1e-6) {
            const ix = (lx - tanX * ly) / det;
            const iy = (-tanY * lx + ly) / det;
            lx = ix;
            ly = iy;
          }
        }
        const halfW = bounds.w / 2;
        const halfH = bounds.h / 2;
        return lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH;
      }
      return x >= bounds.x && x <= (bounds.x + bounds.w) && y >= bounds.y && y <= (bounds.y + bounds.h);
    },

    /**
     * Draw specialized Camera Viewfinder Wireframe
     * - Viewfinder corner brackets [ ]
     * - Dashed perimeter frame
     * - Center target ring & crosshair
     * - Camera icon + name badge
     * - 8 perimeter handles
     */
    drawCamera(ctx, bounds, options = {}) {
      const { w, h } = bounds;
      if (w <= 0 || h <= 0) return;

      const style = getComputedStyle(document.documentElement);
      const primaryColor = options.primaryColor || options.color || style.getPropertyValue('--color-primary').trim() || '#98ce7b';
      const canvasBg = options.canvasBg || options.bgColor || style.getPropertyValue('--bg-canvas').trim() || '#0d1109';
      const panelBg = style.getPropertyValue('--bg-panel').trim() || '#1a2214';

      let dprScale = options.dprScale || 1;
      if (!options.dprScale && ctx.canvas && typeof ctx.canvas.getBoundingClientRect === 'function') {
        const rect = ctx.canvas.getBoundingClientRect();
        if (rect && rect.width > 0) dprScale = ctx.canvas.width / rect.width;
      }

      const lineWidth = options.lineWidth || Math.max(1.5, Math.round(1.5 * dprScale));
      const handleSize = options.handleSize || Math.max(6, Math.round(8 * dprScale));
      const handleBorder = options.handleBorder || Math.max(1, Math.round(1.5 * dprScale));
      const half = handleSize / 2;

      // Corners
      const corners = (bounds.corners && bounds.corners.length === 4) ? bounds.corners : [
        { x: (bounds.cx !== undefined ? bounds.cx - w/2 : (bounds.x || 0)), y: (bounds.cy !== undefined ? bounds.cy - h/2 : (bounds.y || 0)) },
        { x: (bounds.cx !== undefined ? bounds.cx + w/2 : (bounds.x || 0) + w), y: (bounds.cy !== undefined ? bounds.cy - h/2 : (bounds.y || 0)) },
        { x: (bounds.cx !== undefined ? bounds.cx + w/2 : (bounds.x || 0) + w), y: (bounds.cy !== undefined ? bounds.cy + h/2 : (bounds.y || 0)) + h },
        { x: (bounds.cx !== undefined ? bounds.cx - w/2 : (bounds.x || 0)), y: (bounds.cy !== undefined ? bounds.cy + h/2 : (bounds.y || 0)) + h }
      ];

      // 1. Subtle dashed perimeter boundary
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = primaryColor;
      ctx.setLineDash([5 * dprScale, 5 * dprScale]);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. 4 Solid L-shaped Viewfinder Corner Brackets
      const bracketLen = Math.max(18, Math.round(26 * dprScale));
      ctx.lineWidth = Math.max(2, Math.round(2.5 * dprScale));
      ctx.strokeStyle = primaryColor;

      const drawBracket = (cIdx, prevIdx, nextIdx) => {
        const c = corners[cIdx];
        const prev = corners[prevIdx];
        const next = corners[nextIdx];

        const dPrev = { x: prev.x - c.x, y: prev.y - c.y };
        const lenPrev = Math.hypot(dPrev.x, dPrev.y) || 1;
        const dNext = { x: next.x - c.x, y: next.y - c.y };
        const lenNext = Math.hypot(dNext.x, dNext.y) || 1;

        const p1 = { x: c.x + (dPrev.x / lenPrev) * Math.min(bracketLen, lenPrev * 0.4), y: c.y + (dPrev.y / lenPrev) * Math.min(bracketLen, lenPrev * 0.4) };
        const p2 = { x: c.x + (dNext.x / lenNext) * Math.min(bracketLen, lenNext * 0.4), y: c.y + (dNext.y / lenNext) * Math.min(bracketLen, lenNext * 0.4) };

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      };

      drawBracket(0, 3, 1); // TL
      drawBracket(1, 0, 2); // TR
      drawBracket(2, 1, 3); // BR
      drawBracket(3, 2, 0); // BL

      // 3. Center Viewfinder Crosshair & Target Ring
      const anchor = bounds.anchor || {
        x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
        y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4
      };
      const crossRadius = Math.max(7, Math.round(10 * dprScale));
      const crossArm = Math.max(5, Math.round(7 * dprScale));
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = primaryColor;

      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, crossRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(anchor.x - crossRadius - crossArm, anchor.y); ctx.lineTo(anchor.x - crossRadius, anchor.y);
      ctx.moveTo(anchor.x + crossRadius, anchor.y); ctx.lineTo(anchor.x + crossRadius + crossArm, anchor.y);
      ctx.moveTo(anchor.x, anchor.y - crossRadius - crossArm); ctx.lineTo(anchor.x, anchor.y - crossRadius);
      ctx.moveTo(anchor.x, anchor.y + crossRadius); ctx.lineTo(anchor.x, anchor.y + crossRadius + crossArm);
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, Math.max(1.5, Math.round(2 * dprScale)), 0, Math.PI * 2);
      ctx.fillStyle = primaryColor;
      ctx.fill();

      // 4. Camera Viewfinder Badge at top-left
      const badgeX = corners[0].x + Math.max(10, Math.round(14 * dprScale));
      const badgeY = corners[0].y + Math.max(10, Math.round(14 * dprScale));
      const badgeH = Math.max(20, Math.round(24 * dprScale));
      const labelText = bounds.name ? `CAM • ${bounds.name.toUpperCase()}` : 'CAM • CAMERA';
      ctx.font = `bold ${Math.max(9, Math.round(11 * dprScale))}px 'Cal Sans', sans-serif`;
      const textMetrics = ctx.measureText(labelText);
      const badgeW = textMetrics.width + Math.max(16, Math.round(20 * dprScale));
      const badgeR = Math.max(4, Math.round(6 * dprScale));

      ctx.fillStyle = panelBg;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeR);
      } else {
        ctx.rect(badgeX, badgeY, badgeW, badgeH);
      }
      ctx.fill();
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = Math.max(1, Math.round(1.2 * dprScale));
      ctx.stroke();

      ctx.fillStyle = primaryColor;
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, badgeX + Math.max(8, Math.round(10 * dprScale)), badgeY + badgeH / 2);

      // 5. 8 Perimeter Control Handles
      const handles = (bounds.handles || this.getHandles(bounds, handleSize)).filter(h => h.type !== 'anchor');
      handles.forEach(p => {
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        ctx.fillStyle = primaryColor;
        ctx.fillRect(px - half, py - half, handleSize, handleSize);
        ctx.fillStyle = canvasBg;
        const innerSize = Math.max(1, handleSize - handleBorder * 2);
        ctx.fillRect(px - half + handleBorder, py - half + handleBorder, innerSize, innerSize);
      });
    },

    /**
     * Mount an interactive DOM-based wireframe overlay into a container
     * @param {HTMLElement} container
     * @param {{ x: number, y: number, w: number, h: number }} bounds
     * @returns {HTMLElement}
     */
    mountOverlay(container, bounds) {
      if (!container || !bounds) return null;
      let overlay = container.querySelector('.canvas-wireframe-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'canvas-wireframe-overlay';
        
        // 8 handles
        const types = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        types.forEach(t => {
          const h = document.createElement('div');
          h.className = `canvas-wireframe-handle handle-${t}`;
          h.dataset.handle = t;
          overlay.appendChild(h);
        });

        // Center anchor
        const anchorEl = document.createElement('div');
        anchorEl.className = 'canvas-wireframe-anchor';
        anchorEl.dataset.handle = 'anchor';
        overlay.appendChild(anchorEl);

        container.appendChild(overlay);
      }

      overlay.style.left = `${bounds.x}px`;
      overlay.style.top = `${bounds.y}px`;
      overlay.style.width = `${bounds.w}px`;
      overlay.style.height = `${bounds.h}px`;
      overlay.style.display = 'block';

      return overlay;
    }
  };

  window.CanvasWireframe = CanvasWireframe;
})(typeof window !== 'undefined' ? window : globalThis);
