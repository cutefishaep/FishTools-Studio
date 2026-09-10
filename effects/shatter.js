(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // Pre-seed deterministic shard offsets and random vectors
  const MAX_SHARDS = 64;
  const shardSeeds = [];
  let seedVal = 987654321;
  function pseudoRandom() {
    seedVal = (1103515245 * seedVal + 12345) & 0x7fffffff;
    return seedVal / 2147483648;
  }
  for (let i = 0; i < MAX_SHARDS; i++) {
    shardSeeds.push({
      dirX: (pseudoRandom() - 0.5) * 2,
      dirY: (pseudoRandom() - 0.5) * 2,
      dirZ: (pseudoRandom() - 0.5) * 2.5,
      rotAxisX: (pseudoRandom() - 0.5) * 4,
      rotAxisY: (pseudoRandom() - 0.5) * 4,
      rotAxisZ: (pseudoRandom() - 0.5) * 4,
      jitterX: (pseudoRandom() - 0.5) * 0.4,
      jitterY: (pseudoRandom() - 0.5) * 0.4
    });
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

  reg.register({
    id: 'shatter',
    name: 'Shatter',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Fragments layer into 3D glass shards that blast outward with 3D physics and perspective',
    params: [
      { id: 'progress', label: 'Progress', type: 'number', min: 0, max: 100, default: 25, unit: '%' },
      { id: 'autoAnimate', label: 'Auto Animate', type: 'switch', default: 0 },
      { id: 'duration', label: 'Explosion Duration', type: 'number', min: 0.2, max: 10, default: 2.0, unit: 's' },
      { id: 'pieces', label: 'Pieces Count', type: 'number', min: 4, max: 36, default: 16 },
      { id: 'force', label: 'Explosion Force', type: 'number', min: 20, max: 500, default: 180 },
      { id: 'extrusion', label: '3D Extrusion', type: 'number', min: 0, max: 25, default: 5, unit: 'px' },
      { id: 'spin', label: 'Spin Rate', type: 'number', min: 0, max: 300, default: 120 },
      { id: 'gravity', label: 'Gravity', type: 'number', min: 0, max: 200, default: 60 },
      { id: 'pattern', label: 'Pattern', type: 'select', options: ['glass', 'triangles', 'hexagons'], default: 'glass' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      let prog = Math.max(0, Math.min(100, fx.progress !== undefined ? fx.progress : 25)) / 100;
      if (fx.autoAnimate === 1 || fx.autoAnimate === true) {
        const curTime = getCurrentTime(layer, currentSec);
        const start = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
        const dur = Math.max(0.2, fx.duration || 2.0);
        prog = Math.max(0, Math.min(1.0, (curTime - start) / dur));
      }

      if (prog <= 0.001) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const pieces = Math.max(2, Math.min(6, Math.round(Math.sqrt(fx.pieces !== undefined ? fx.pieces : 16))));
      const force = Math.max(10, fx.force !== undefined ? fx.force : 180);
      const extrusion = Math.max(0, fx.extrusion !== undefined ? fx.extrusion : 5);
      const spin = (fx.spin !== undefined ? fx.spin : 120) * 0.05;
      const grav = (fx.gravity !== undefined ? fx.gravity : 60) * 2;
      const pattern = fx.pattern || 'glass';

      const cols = pieces;
      const rows = pieces;
      const cellW = w / cols;
      const cellH = h / rows;

      const D = 800; // Camera distance
      const centerX = x + w / 2;
      const centerY = y + h / 2;

      ctx.save();

      let shardIdx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const seed = shardSeeds[shardIdx % MAX_SHARDS];
          shardIdx++;

          // Base source coordinates
          const sx = c * cellW;
          const sy = r * cellH;
          const scx = sx + cellW / 2;
          const scy = sy + cellH / 2;

          // Normalized explosion direction from center + random scatter
          const relX = (scx - w / 2) / (w / 2) + seed.dirX * 0.6;
          const relY = (scy - h / 2) / (h / 2) + seed.dirY * 0.6;
          const len = Math.sqrt(relX * relX + relY * relY) || 1;
          const normDirX = relX / len;
          const normDirY = relY / len;
          const normDirZ = seed.dirZ;

          // 3D Translation
          const tx = (scx + normDirX * force * prog) - scx;
          const ty = (scy + normDirY * force * prog + grav * prog * prog) - scy;
          const tz = normDirZ * force * prog;

          const eyeZ = tz + D;
          if (eyeZ <= 10) continue;
          const projScale = D / eyeZ;

          // 3D Tumble Rotations
          const rotZ = seed.rotAxisZ * spin * prog;
          const rotY = seed.rotAxisY * spin * prog;
          const rotX = seed.rotAxisX * spin * prog;

          const cosY = Math.cos(rotY);
          const sinY = Math.sin(rotY);

          // Render shard piece
          ctx.save();
          const drawCX = x + scx + tx * projScale;
          const drawCY = y + scy + ty * projScale;

          ctx.translate(drawCX, drawCY);
          ctx.scale(projScale, projScale);
          ctx.rotate(rotZ);
          ctx.transform(cosY, 0, 0, 1, 0, 0); // 3D Y pitch simulation

          // Optional 3D Glass edge extrusion shadow
          if (extrusion > 0 && prog > 0.05) {
            ctx.fillStyle = 'rgba(20, 20, 30, 0.4)';
            ctx.fillRect(-cellW / 2 + extrusion, -cellH / 2 + extrusion, cellW, cellH);
          }

          // Shard Polygon Path
          ctx.beginPath();
          if (pattern === 'triangles') {
            ctx.moveTo(-cellW / 2, -cellH / 2);
            ctx.lineTo(cellW / 2, -cellH / 2);
            ctx.lineTo(0, cellH / 2);
          } else {
            // Glass shard with subtle jagged corner variation
            const jx = seed.jitterX * cellW;
            const jy = seed.jitterY * cellH;
            ctx.moveTo(-cellW / 2 + jx, -cellH / 2);
            ctx.lineTo(cellW / 2, -cellH / 2 + jy);
            ctx.lineTo(cellW / 2 - jx, cellH / 2);
            ctx.lineTo(-cellW / 2, cellH / 2 - jy);
          }
          ctx.closePath();
          ctx.clip();

          // Draw the sliced texture portion of this shard
          try {
            const elW = el.videoWidth || el.naturalWidth || el.width || w;
            const elH = el.videoHeight || el.naturalHeight || el.height || h;
            const srcX = (sx / w) * elW;
            const srcY = (sy / h) * elH;
            const srcW = (cellW / w) * elW;
            const srcH = (cellH / h) * elH;

            ctx.drawImage(el, srcX, srcY, srcW, srcH, -cellW / 2, -cellH / 2, cellW, cellH);
          } catch (_) {}

          // Glass specular reflection highlight across shard edge
          ctx.strokeStyle = `rgba(255, 255, 255, ${Math.max(0, 0.6 - prog * 0.4).toFixed(2)})`;
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.restore();
        }
      }

      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
