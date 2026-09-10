(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgb(hex) {
    let c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function getCurrentTime(layer, currentSec) {
    if (typeof currentSec === 'number' && !isNaN(currentSec)) return currentSec;
    if (layer && typeof layer._currentSec === 'number' && !isNaN(layer._currentSec)) return layer._currentSec;
    if (layer && typeof layer._timeInClip === 'number' && !isNaN(layer._timeInClip)) return layer._timeInClip;
    if (typeof window !== 'undefined') {
      if (typeof window.currentPlaybackSec === 'number' && !isNaN(window.currentPlaybackSec)) return window.currentPlaybackSec;
      if (typeof window.currentSec === 'number' && !isNaN(window.currentSec)) return window.currentSec;
      if (typeof window.getCurrentPlayheadTime === 'function') {
        const pt = window.getCurrentPlayheadTime();
        if (typeof pt === 'number' && !isNaN(pt)) return pt;
      }
      const pps = window.currentPixelsPerSecond || 80;
      const panX = window.timelinePanX !== undefined ? Math.min(0, window.timelinePanX) : 0;
      return Math.max(0, -panX) / pps;
    }
    return 0;
  }

  // Pre-seed pseudo-random star points
  const MAX_STARS = 1500;
  const starSeeds = new Float32Array(MAX_STARS * 4);
  let s = 123456789;
  function lcg() {
    s = (1103515245 * s + 12345) & 0x7fffffff;
    return s / 2147483648;
  }
  for (let i = 0; i < MAX_STARS; i++) {
    starSeeds[i * 4 + 0] = (lcg() - 0.5) * 2; // normX [-1, 1]
    starSeeds[i * 4 + 1] = (lcg() - 0.5) * 2; // normY [-1, 1]
    starSeeds[i * 4 + 2] = lcg();             // normZ [0, 1]
    starSeeds[i * 4 + 3] = 0.5 + lcg() * 0.5; // brightness variation
  }

  reg.register({
    id: 'star-burst',
    name: 'Star Burst',
    category: 'background',
    icon: 'assets/FXPH.svg',
    description: '3D starfield burst moving through space with true 3D rotation and camera depth support',
    params: [
      { id: 'speed', label: 'Speed', type: 'number', min: -10, max: 10, default: 2.0 },
      { id: 'density', label: 'Star Count', type: 'number', min: 20, max: 1200, default: 300 },
      { id: 'scatter', label: 'Scatter Radius', type: 'number', min: 20, max: 1000, default: 280, unit: 'px' },
      { id: 'size', label: 'Star Size', type: 'number', min: 1, max: 30, default: 3, unit: 'px' },
      { id: 'streak', label: 'Streak Length', type: 'number', min: 0, max: 100, default: 35, unit: '%' },
      { id: 'depth', label: 'Depth Range', type: 'number', min: 200, max: 4000, default: 1400, unit: 'px' },
      { id: 'color', label: 'Color', type: 'color', default: '#ffffff' },
      { id: 'rotX', label: 'Pitch (Rot X)', type: 'angle', default: 0, unit: '°' },
      { id: 'rotY', label: 'Yaw (Rot Y)', type: 'angle', default: 0, unit: '°' },
      { id: 'rotZ', label: 'Roll (Rot Z)', type: 'angle', default: 0, unit: '°' },
      { id: 'useCamera', label: 'Use Camera 3D', type: 'switch', default: 1 },
      { id: 'phase', label: 'Phase', type: 'number', min: 0, max: 100, default: 0 }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      if (el) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      }

      const speed = fx.speed !== undefined ? fx.speed : 2.0;
      const density = Math.max(10, Math.min(MAX_STARS, Math.round(fx.density !== undefined ? fx.density : 300)));
      const scatter = Math.max(10, fx.scatter !== undefined ? fx.scatter : 280);
      const starSize = Math.max(0.5, fx.size !== undefined ? fx.size : 3);
      const streakAmt = Math.max(0, Math.min(100, fx.streak !== undefined ? fx.streak : 35)) / 100;
      const depth = Math.max(200, fx.depth !== undefined ? fx.depth : 1400);
      const colorRgb = hexToRgb(fx.color || '#ffffff');
      const phase = fx.phase || 0;

      const curTime = getCurrentTime(layer, currentSec);

      // Check if WebGL engine is handling perspective projection
      const isEngineFxCtx = (typeof window !== 'undefined' && window.FishToolEngine && ctx === window.FishToolEngine._fxCtx);

      // Compute composite 3D Rotations
      let rotX = fx.rotX || 0;
      let rotY = fx.rotY || 0;
      let rotZ = fx.rotZ || 0;

      if (!isEngineFxCtx) {
        // Direct 2D path: apply layer rotation and camera angles
        rotX += ((layer && layer.rotX) || 0);
        rotY += ((layer && layer.rotY) || 0);
        rotZ += ((layer && (layer.rotZ !== undefined ? layer.rotZ : (layer.rotation || 0))) || 0);

        if (fx.useCamera !== 0 && typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
          const cam = window.currentProjectState.layers.find(l => l.type === 'camera' && !l.hidden);
          if (cam) {
            rotX -= (cam.rotX || 0);
            rotY -= (cam.rotY || 0);
            rotZ -= (cam.rotZ !== undefined ? cam.rotZ : (cam.rotation || 0));
          }
        }
      }

      const radX = (rotX * Math.PI) / 180;
      const radY = (rotY * Math.PI) / 180;
      const radZ = (rotZ * Math.PI) / 180;
      const cx = Math.cos(radX), sx = Math.sin(radX);
      const cy = Math.cos(radY), sy = Math.sin(radY);
      const cz = Math.cos(radZ), sz = Math.sin(radZ);

      // 3D rotation matrix M = Rz * Ry * Rx
      const m00 = cy * cz;
      const m10 = sx * sy * cz - cx * sz;
      const m20 = cx * sy * cz + sx * sz;
      const m01 = cy * sz;
      const m11 = sx * sy * sz + cx * cz;
      const m21 = cx * sy * sz - sx * cz;
      const m02 = -sy;
      const m12 = sx * cy;
      const m22 = cx * cy;

      const D = 500; // Focal perspective distance
      const centerCanvasX = x + w / 2;
      const centerCanvasY = y + h / 2;

      // Positive speed moves forward along Z toward camera
      const timeZ = (curTime * speed * 350) + (phase * 20);

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      const r = colorRgb[0], g = colorRgb[1], b = colorRgb[2];

      for (let i = 0; i < density; i++) {
        const rawX = starSeeds[i * 4 + 0] * scatter * (w / 300);
        const rawY = starSeeds[i * 4 + 1] * scatter * (h / 300);
        const seedZ = starSeeds[i * 4 + 2] * depth;
        const bright = starSeeds[i * 4 + 3];

        // Animate Z moving toward camera: decreasing Z wraps smoothly
        let z = ((seedZ - timeZ) % depth + depth) % depth + 20;

        // 3D Rotation transform centered at depth / 2
        const localZ = z - depth / 2;
        const rx = m00 * rawX + m10 * rawY + m20 * localZ;
        const ry = m01 * rawX + m11 * rawY + m21 * localZ;
        const rz = m02 * rawX + m12 * rawY + m22 * localZ + depth / 2;

        if (rz <= 15) continue; // Behind camera or at near clipping plane

        const projScale = D / rz;
        const px = centerCanvasX + rx * projScale;
        const py = centerCanvasY + ry * projScale;

        // Viewport bounds check
        if (px < x - 40 || px > x + w + 40 || py < y - 40 || py > y + h + 40) continue;

        // Smooth fade-in in deep distance, fade-out when passing close by
        const normZ = rz / depth;
        const alpha = Math.min(1.0, Math.max(0.04, Math.sin(normZ * Math.PI) * bright * 1.2));
        const pRadius = Math.max(0.6, starSize * projScale * 0.7);

        // Render Motion Blur Streaks (hyperspace warp lines)
        if (streakAmt > 0.01 && Math.abs(speed) > 0.1) {
          const streakLen = Math.max(15, Math.abs(speed) * 40 * streakAmt);
          const tailZ = Math.min(depth, rz + (speed >= 0 ? streakLen : -streakLen));
          if (tailZ > 15) {
            const tailScale = D / tailZ;
            const tx = centerCanvasX + rx * tailScale;
            const ty = centerCanvasY + ry * tailScale;

            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(alpha * 0.7).toFixed(3)})`;
            ctx.lineWidth = Math.max(0.8, pRadius * 0.8);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(px, py);
            ctx.stroke();
          }
        }

        // Star Head
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, pRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
