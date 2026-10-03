(function (window) {
  'use strict';

  const reg =
    (window && window.FishEffectsRegistry) ||
    (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  /* ── Color & Utility Helpers ───────────────────────────────────────────── */

  function hexToRgb(hex) {
    let c = (hex || '#38bdf8').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpRgb(c1, c2, t) {
    const cl = Math.max(0, Math.min(1, t));
    return {
      r: Math.round(lerp(c1.r, c2.r, cl)),
      g: Math.round(lerp(c1.g, c2.g, cl)),
      b: Math.round(lerp(c1.b, c2.b, cl))
    };
  }

  function hslToRgb(h, s, l) {
    h = (h % 360 + 360) % 360 / 360;
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }

  function getCurrentTime(layer, currentSec) {
    if (typeof currentSec === 'number' && !isNaN(currentSec)) return currentSec;
    if (layer && typeof layer._currentSec === 'number' && !isNaN(layer._currentSec)) return layer._currentSec;
    if (layer && typeof layer._timeInClip === 'number' && !isNaN(layer._timeInClip)) return layer._timeInClip;
    if (typeof window !== 'undefined') {
      if (typeof window._currentRenderSec === 'number' && !isNaN(window._currentRenderSec)) return window._currentRenderSec;
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

  /* ── Deterministic Integer Hash (Murmur-like 32-bit PRNG) ──────────────── */

  function hash(i, seed) {
    let h = ((i + 1) * 2654435761 ^ (seed || 1234) * 2246822519) >>> 0;
    h = ((h ^ (h >>> 16)) * 0x45d9f3b) >>> 0;
    h = ((h ^ (h >>> 16)) * 0x45d9f3b) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  /* ── Constants ─────────────────────────────────────────────────────────── */

  // Fixed simulation budget: never changes during interaction, so the simulation cache
  // stays valid across pointerdown / pointerup and particles never "pop".
  const MAX_SIM = 1400;
  const SIM_CAPACITY = MAX_SIM + 2;

  function particleTypeCode(pType) {
    if (pType === 'Crisp Circle') return 1;
    if (pType === 'Glowing Ring') return 2;
    if (pType === 'Sparkle Star') return 3;
    if (pType === 'Smoke Puff') return 4;
    return 0; // Glow Sphere & Streak
  }

  function quantizeGlow(glowAmt) {
    return Math.max(0, Math.min(100, Math.round(glowAmt / 10) * 10));
  }

  /* ── Quantized Sprite Texture Cache (Canvas2D fallback only) ──────────── */

  const spriteCache = new Map();
  const MAX_SPRITE_SIZE = 64;

  function getParticleSprite(type, qr, qg, qb, qglow) {
    const key = `${type}_${qr}_${qg}_${qb}_${qglow}`;
    const hit = spriteCache.get(key);
    if (hit) return hit;

    const canvas = document.createElement('canvas');
    canvas.width = MAX_SPRITE_SIZE;
    canvas.height = MAX_SPRITE_SIZE;
    const ctx = canvas.getContext('2d');
    const c = MAX_SPRITE_SIZE / 2;
    const rad = c - 2;

    const rgbStr = `${qr}, ${qg}, ${qb}`;

    if (type === 'Crisp Circle') {
      ctx.beginPath();
      ctx.arc(c, c, rad * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${rgbStr})`;
      ctx.fill();
    } else if (type === 'Glowing Ring') {
      ctx.beginPath();
      ctx.arc(c, c, rad * 0.75, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, rad * 0.28);
      ctx.strokeStyle = `rgb(${rgbStr})`;
      ctx.stroke();

      if (qglow > 5) {
        ctx.beginPath();
        ctx.arc(c, c, rad * 0.75, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2, rad * 0.55);
        ctx.strokeStyle = `rgba(${rgbStr}, ${(qglow / 200).toFixed(2)})`;
        ctx.stroke();
      }
    } else if (type === 'Sparkle Star') {
      const grad = ctx.createRadialGradient(c, c, 0, c, c, rad);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, `rgb(${rgbStr})`);
      grad.addColorStop(1, `rgba(${rgbStr}, 0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, rad * 0.35, 0, Math.PI * 2);
      ctx.fill();

      // 4-point diamond sparkle rays
      ctx.beginPath();
      ctx.moveTo(c, c - rad);
      ctx.quadraticCurveTo(c, c, c + rad, c);
      ctx.quadraticCurveTo(c, c, c, c + rad);
      ctx.quadraticCurveTo(c, c, c - rad, c);
      ctx.quadraticCurveTo(c, c, c, c - rad);
      ctx.closePath();
      ctx.fillStyle = `rgba(${rgbStr}, 0.95)`;
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(c, c, rad * 0.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'Smoke Puff') {
      const grad = ctx.createRadialGradient(c, c, 0, c, c, rad);
      grad.addColorStop(0, `rgba(${rgbStr}, 0.6)`);
      grad.addColorStop(0.4, `rgba(${rgbStr}, 0.35)`);
      grad.addColorStop(0.85, `rgba(${rgbStr}, 0.1)`);
      grad.addColorStop(1, `rgba(${rgbStr}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, rad, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Default: Glow Sphere (intense white core so downstream Deep Glow triggers heavily)
      const grad = ctx.createRadialGradient(c, c, 0, c, c, rad);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, `rgb(${rgbStr})`);
      const glowEdge = Math.min(0.92, 0.45 + (qglow / 200));
      grad.addColorStop(glowEdge, `rgba(${rgbStr}, ${(0.4 + qglow / 150).toFixed(2)})`);
      grad.addColorStop(1, `rgba(${rgbStr}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    if (spriteCache.size > 512) {
      const firstKey = spriteCache.keys().next().value;
      spriteCache.delete(firstKey);
    }
    spriteCache.set(key, canvas);
    return canvas;
  }

  /* ── Stage 1: World-Space Simulation Cache (module level) ─────────────── */
  // Keyed by `${layer.id}|${fx.id}`: survives the per-frame cloning of layer/effect objects
  // done by getLayerEffectivePropsAtTime() and the editor render loop.

  const simCacheMap = new Map();
  const MAX_SIM_CACHE_ENTRIES = 48;

  function createSimStore() {
    return {
      sig: '',
      count: 0,
      wx: new Float32Array(SIM_CAPACITY),
      wy: new Float32Array(SIM_CAPACITY),
      wz: new Float32Array(SIM_CAPACITY),
      rad: new Float32Array(SIM_CAPACITY),
      alpha: new Float32Array(SIM_CAPACITY),
      spd: new Float32Array(SIM_CAPACITY),
      ang: new Float32Array(SIM_CAPACITY),
      cr: new Uint8Array(SIM_CAPACITY),
      cg: new Uint8Array(SIM_CAPACITY),
      cb: new Uint8Array(SIM_CAPACITY),
      sprites: null,
      spritesKey: ''
    };
  }

  function getSimStore(key) {
    let store = simCacheMap.get(key);
    if (store) {
      // LRU touch
      simCacheMap.delete(key);
      simCacheMap.set(key, store);
      return store;
    }
    if (simCacheMap.size >= MAX_SIM_CACHE_ENTRIES) {
      const oldest = simCacheMap.keys().next().value;
      simCacheMap.delete(oldest);
    }
    store = createSimStore();
    simCacheMap.set(key, store);
    return store;
  }

  function runSimulation(store, P) {
    const primaryColor = hexToRgb(P.color);
    const secondaryColor = hexToRgb(P.color2);

    const lastIdx = Math.floor(P.simTime * P.birthRate);
    const firstIdx = Math.max(0, Math.floor((P.simTime - P.maxLife) * P.birthRate));
    const safeFirstIdx = Math.max(firstIdx, lastIdx - MAX_SIM);

    const motionType = P.motionType;
    const isStill = (
      motionType === 'Still / Locked in Place' ||
      motionType === 'Static Floating' ||
      (typeof motionType === 'string' && (motionType.toLowerCase().includes('still') || motionType.toLowerCase().includes('locked')))
    );
    const isFloating = (motionType === 'Floating Ambient (In-Place)');

    const seed = P.seed;
    const emitterType = P.emitterType;
    const direction = P.direction;
    const spread = P.spread;
    const cDirX = Math.cos(P.dirAngleX), sDirX = Math.sin(P.dirAngleX);
    const cDirY = Math.cos(P.dirAngleY), sDirY = Math.sin(P.dirAngleY);

    const spanX = Math.max(P.compW * 1.3, P.emSx * 2);
    const spanY = Math.max(P.compH * 1.3, P.emSy * 2);
    const spanZ = Math.max(P.compW * 1.3, Math.max(1400, P.emSz * 2));

    const wx = store.wx, wy = store.wy, wz = store.wz;
    const radArr = store.rad, alphaArr = store.alpha;
    const spdArr = store.spd, angArr = store.ang;
    const crArr = store.cr, cgArr = store.cg, cbArr = store.cb;

    let n = 0;
    for (let j = safeFirstIdx; j <= lastIdx && n < SIM_CAPACITY; j++) {
      const tBirth = j / P.birthRate;
      const age = P.simTime - tBirth;
      if (age < 0) continue;

      const pLife = P.baseLife * (1 + (hash(j, seed + 1) - 0.5) * 2 * P.lifeRandom);
      if (age >= pLife) continue;

      const progress = Math.max(0, Math.min(1, age / pLife));

      // Initial 3D spawn position
      let px0 = P.emX;
      let py0 = P.emY;
      let pz0 = P.emZ;

      if (emitterType === 'Full Space (Comp Volume)') {
        px0 += (hash(j, seed + 2) - 0.5) * spanX;
        py0 += (hash(j, seed + 3) - 0.5) * spanY;
        pz0 += (hash(j, seed + 4) - 0.5) * spanZ;
      } else if (emitterType === 'Box') {
        px0 += (hash(j, seed + 2) - 0.5) * 2 * P.emSx;
        py0 += (hash(j, seed + 3) - 0.5) * 2 * P.emSy;
        pz0 += (hash(j, seed + 4) - 0.5) * 2 * P.emSz;
      } else if (emitterType === 'Sphere') {
        const u = hash(j, seed + 2);
        const v = hash(j, seed + 3);
        const rRad = Math.cbrt(hash(j, seed + 4));
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        px0 += rRad * P.emSx * Math.sin(phi) * Math.cos(theta);
        py0 += rRad * P.emSy * Math.sin(phi) * Math.sin(theta);
        pz0 += rRad * P.emSz * Math.cos(phi);
      } else if (emitterType === 'Disc') {
        const theta = hash(j, seed + 2) * Math.PI * 2;
        const rRad = Math.sqrt(hash(j, seed + 3));
        px0 += rRad * P.emSx * Math.cos(theta);
        py0 += rRad * P.emSy * Math.sin(theta);
        pz0 += (hash(j, seed + 4) - 0.5) * P.emSz * 0.15;
      }

      // Initial velocity
      const pSpeed = Math.max(0, P.baseVel * (1 + (hash(j, seed + 5) - 0.5) * 2 * P.velRand));
      let vx0 = 0, vy0 = 0, vz0 = 0;

      if (isStill) {
        vx0 = 0; vy0 = 0; vz0 = 0;
      } else if (isFloating) {
        const driftAngle = hash(j, seed + 6) * Math.PI * 2;
        const driftZ = (hash(j, seed + 7) - 0.5) * 2;
        const driftSpeed = pSpeed * 0.5;
        vx0 = Math.cos(driftAngle) * driftSpeed;
        vy0 = (Math.sin(driftAngle) * 0.3 - 0.5) * driftSpeed;
        vz0 = driftZ * driftSpeed * 0.4;
      } else if (direction === 'Omni (Uniform)') {
        const theta = hash(j, seed + 6) * Math.PI * 2;
        const zDir = hash(j, seed + 7) * 2 - 1;
        const rXy = Math.sqrt(Math.max(0, 1 - zDir * zDir));
        vx0 = rXy * Math.cos(theta) * pSpeed;
        vy0 = rXy * Math.sin(theta) * pSpeed;
        vz0 = zDir * pSpeed;
      } else if (direction === 'Up') {
        vx0 = (hash(j, seed + 6) - 0.5) * spread * pSpeed;
        vy0 = -pSpeed;
        vz0 = (hash(j, seed + 7) - 0.5) * spread * pSpeed;
      } else if (direction === 'Down') {
        vx0 = (hash(j, seed + 6) - 0.5) * spread * pSpeed;
        vy0 = pSpeed;
        vz0 = (hash(j, seed + 7) - 0.5) * spread * pSpeed;
      } else if (direction === 'Disc Plane') {
        const theta = hash(j, seed + 6) * Math.PI * 2;
        vx0 = Math.cos(theta) * pSpeed;
        vy0 = Math.sin(theta) * pSpeed;
        vz0 = (hash(j, seed + 7) - 0.5) * pSpeed * spread * 0.2;
      } else {
        const coneSpread = (1 - spread) * 0.5;
        const ru = (hash(j, seed + 6) - 0.5) * 2 * (1 - coneSpread);
        const rv = (hash(j, seed + 7) - 0.5) * 2 * (1 - coneSpread);
        vx0 = (sDirY + ru * spread) * pSpeed;
        vy0 = (-sDirX + rv * spread) * pSpeed;
        vz0 = (cDirY * cDirX) * pSpeed;
      }

      // Analytical physics integration O(1)
      let worldPx = px0;
      let worldPy = py0;
      let worldPz = pz0;

      if (!isStill) {
        let velDisp = age;
        if (P.dragK > 0.02) {
          velDisp = (1 - Math.exp(-P.dragK * age)) / P.dragK;
        }
        const halfAge2 = 0.5 * age * age;

        let turbX = 0, turbY = 0, turbZ = 0;
        if (P.turbulence > 0) {
          const phase = (j * 0.381966 + seed) % 1000;
          const ft = age * P.turbSpeed * 3.14 + phase;
          const tScale = Math.min(1, age * 2.0) * P.turbulence;
          turbX = (Math.sin(ft) + 0.5 * Math.sin(ft * 2.3 + 1.2)) * tScale;
          turbY = (Math.cos(ft * 1.37 + 1.8) + 0.5 * Math.cos(ft * 2.71 + 0.4)) * tScale;
          turbZ = (Math.sin(ft * 0.89 + 3.1) + 0.5 * Math.sin(ft * 1.93 + 2.5)) * tScale;
        }

        worldPx += vx0 * velDisp + P.windX * halfAge2 + turbX;
        worldPy += vy0 * velDisp + (P.gravity + P.windY) * halfAge2 + turbY;
        worldPz += vz0 * velDisp + P.windZ * halfAge2 + turbZ;
      }

      // Size over life
      const pSize = Math.max(1, P.baseSize * (1 + (hash(j, seed + 8) - 0.5) * 2 * P.sizeRand));
      let sizeFactor = 1.0;
      if (P.sizeOverLife === 'Grow & Shrink') sizeFactor = Math.sin(progress * Math.PI);
      else if (P.sizeOverLife === 'Shrink Only') sizeFactor = 1 - progress;
      else if (P.sizeOverLife === 'Grow Only') sizeFactor = progress;

      // Opacity over life
      let opLife = 1.0;
      if (P.opOverLife === 'Fade In & Out') opLife = Math.sin(progress * Math.PI);
      else if (P.opOverLife === 'Fade Out Only') opLife = 1 - progress;
      else if (P.opOverLife === 'Fade In Only') opLife = progress;

      // Color (16-step blend / 15° hue palette, 8-unit RGB bins)
      let pColor;
      if (P.colorMode === 'Two Color Blend') {
        const colorBlendT = (progress * 0.7 + hash(j, seed + 9) * 0.3);
        pColor = lerpRgb(primaryColor, secondaryColor, Math.round(colorBlendT * 16) / 16);
      } else if (P.colorMode === 'Rainbow Hue') {
        const rawHue = (progress * 240 + hash(j, seed + 9) * 360) % 360;
        pColor = hslToRgb(Math.round(rawHue / 15) * 15, 0.95, 0.6);
      } else {
        pColor = primaryColor;
      }

      wx[n] = worldPx;
      wy[n] = worldPy;
      wz[n] = worldPz;
      radArr[n] = pSize * sizeFactor * 0.5;
      alphaArr[n] = P.baseOp * opLife;
      spdArr[n] = Math.sqrt(vx0 * vx0 + vy0 * vy0);
      angArr[n] = Math.atan2(vy0, vx0);
      crArr[n] = Math.min(255, (pColor.r >> 3) << 3);
      cgArr[n] = Math.min(255, (pColor.g >> 3) << 3);
      cbArr[n] = Math.min(255, (pColor.b >> 3) << 3);
      n++;
    }

    store.count = n;
    store.sprites = null;
    store.spritesKey = '';
  }

  /* ── Per-Frame Camera Memo ─────────────────────────────────────────────── */
  // Resolved once per synchronous frame and shared by every particle layer.
  // Cleared by a microtask so the next frame always re-resolves fresh camera values.

  let _camMemo = null;
  let _camMemoClearScheduled = false;

  function scheduleCamMemoClear() {
    if (_camMemoClearScheduled) return;
    _camMemoClearScheduled = true;
    Promise.resolve().then(() => {
      _camMemo = null;
      _camMemoClearScheduled = false;
    });
  }

  function resolveCameraState(curTime) {
    let compLayers = null;
    if (window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers)) {
      compLayers = window.currentActivePrecomp.layers;
    } else if (window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
      compLayers = window.currentProjectState.layers;
    }

    if (_camMemo && _camMemo.time === curTime && _camMemo.layers === compLayers) {
      return _camMemo.state;
    }

    const state = { found: false, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, zoom: 1.0, lens: 50 };
    if (compLayers) {
      let cam = null;
      for (let i = 0; i < compLayers.length; i++) {
        const l = compLayers[i];
        if (l && l.type === 'camera' && !l.hidden) { cam = l; break; }
      }
      if (cam) {
        const camEff = (typeof window.getLayerEffectivePropsAtTime === 'function' && typeof curTime === 'number')
          ? window.getLayerEffectivePropsAtTime(cam, curTime, null, compLayers)
          : cam;
        state.found = true;
        state.posX = camEff.posX || 0;
        state.posY = camEff.posY || 0;
        state.posZ = camEff.posZ || 0;
        state.rotX = camEff.rotX || 0;
        state.rotY = camEff.rotY || 0;
        state.rotZ = camEff.rotZ !== undefined ? camEff.rotZ : (camEff.rotation || 0);
        state.zoom = (camEff.cameraZoom !== undefined ? camEff.cameraZoom : 100) / 100;
        state.lens = Math.max(1, camEff.cameraLens !== undefined ? camEff.cameraLens : 50);
      }
    }

    _camMemo = { time: curTime, layers: compLayers, state };
    scheduleCamMemoClear();
    return state;
  }

  /* ── Stage 2 Scratch Buffers (zero allocation per frame) ──────────────── */

  const rIdx = new Uint32Array(SIM_CAPACITY);
  const rX = new Float32Array(SIM_CAPACITY);
  const rY = new Float32Array(SIM_CAPACITY);
  const rR = new Float32Array(SIM_CAPACITY);
  const rA = new Float32Array(SIM_CAPACITY);
  const rSL = new Float32Array(SIM_CAPACITY);
  const rDist = new Float32Array(SIM_CAPACITY);
  const rOrder = new Uint32Array(SIM_CAPACITY);
  const INST_FLOATS = 9;
  const instData = new Float32Array(SIM_CAPACITY * INST_FLOATS);

  function depthCompare(a, b) {
    return rDist[b] - rDist[a];
  }

  /* ── WebGL Instanced Particle Renderer ────────────────────────────────── */
  // One shared offscreen WebGL context renders every particle as an instanced quad with
  // procedural shapes (no sprite textures, no per-particle draw calls). Result is blitted
  // onto the 2D layer context with a single drawImage. Falls back to Canvas2D if unavailable.

  const VERT_SRC = [
    'attribute vec2 aCorner;',
    'attribute vec4 aPosRad;',
    'attribute vec4 aColor;',
    'attribute float aAngle;',
    'uniform vec2 uRes;',
    'varying vec2 vUv;',
    'varying vec4 vColor;',
    'varying float vRadPx;',
    'void main() {',
    '  float r = aPosRad.z;',
    '  float sl = aPosRad.w;',
    '  float x0 = sl > 0.0 ? -sl : -r;',
    '  float x1 = sl > 0.0 ? 2.0 * r : r;',
    '  float lx = mix(x0, x1, aCorner.x);',
    '  float ly = mix(-r, r, aCorner.y);',
    '  float c = cos(aAngle);',
    '  float s = sin(aAngle);',
    '  vec2 p = aPosRad.xy + vec2(lx * c - ly * s, lx * s + ly * c);',
    '  vec2 clip = (p / uRes) * 2.0 - 1.0;',
    '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);',
    '  vUv = aCorner * 2.0 - 1.0;',
    '  vColor = aColor;',
    '  vRadPx = r;',
    '}'
  ].join('\n');

  const FRAG_SRC = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'varying vec4 vColor;',
    'varying float vRadPx;',
    'uniform float uType;',
    'uniform float uGlow;',
    'vec4 overOp(vec4 dst, vec4 src) { return src + dst * (1.0 - src.a); }',
    'void main() {',
    '  vec3 col = vColor.rgb;',
    '  float rr = length(vUv) / 0.9375;',
    '  float aa = clamp(1.5 / max(vRadPx, 0.5), 0.004, 0.5);',
    '  vec4 c = vec4(0.0);',
    '  if (uType < 0.5) {',
    '    float e = min(0.92, 0.45 + uGlow / 200.0);',
    '    float ae = min(1.0, 0.4 + uGlow / 150.0);',
    '    if (rr < 0.25) {',
    '      c = mix(vec4(1.0), vec4(col, 1.0), rr / 0.25);',
    '    } else if (rr < e) {',
    '      c = mix(vec4(col, 1.0), vec4(col * ae, ae), (rr - 0.25) / (e - 0.25));',
    '    } else {',
    '      c = mix(vec4(col * ae, ae), vec4(0.0), clamp((rr - e) / (1.0 - e), 0.0, 1.0));',
    '    }',
    '    c *= 1.0 - smoothstep(1.0 - aa, 1.0, rr);',
    '  } else if (uType < 1.5) {',
    '    c = vec4(col, 1.0) * (1.0 - smoothstep(0.9 - aa, 0.9, rr));',
    '  } else if (uType < 2.5) {',
    '    float d = abs(rr - 0.75);',
    '    float inner = 1.0 - smoothstep(0.14 - aa, 0.14, d);',
    '    float outer = uGlow > 5.0 ? (1.0 - smoothstep(0.275 - aa, 0.275, d)) * (uGlow / 200.0) : 0.0;',
    '    c = vec4(col, 1.0) * (inner + outer * (1.0 - inner));',
    '  } else if (uType < 3.5) {',
    '    vec4 g = rr < 0.25 ? mix(vec4(1.0), vec4(col, 1.0), rr / 0.25) : mix(vec4(col, 1.0), vec4(0.0), clamp((rr - 0.25) / 0.75, 0.0, 1.0));',
    '    c = g * (1.0 - smoothstep(0.35 - aa, 0.35, rr));',
    '    vec2 q = abs(vUv) / 0.9375;',
    '    float st = sqrt(q.x) + sqrt(q.y);',
    '    float starMask = 1.0 - smoothstep(1.0 - aa * 2.0, 1.0, st);',
    '    c = overOp(c, vec4(col, 1.0) * 0.95 * starMask);',
    '    c = overOp(c, vec4(1.0) * (1.0 - smoothstep(0.2 - aa, 0.2, rr)));',
    '  } else {',
    '    float a;',
    '    if (rr < 0.4) a = mix(0.6, 0.35, rr / 0.4);',
    '    else if (rr < 0.85) a = mix(0.35, 0.1, (rr - 0.4) / 0.45);',
    '    else a = mix(0.1, 0.0, clamp((rr - 0.85) / 0.15, 0.0, 1.0));',
    '    c = vec4(col, 1.0) * a;',
    '  }',
    '  gl_FragColor = c * vColor.a;',
    '}'
  ].join('\n');

  const GLR = {
    canvas: null,
    gl: null,
    isGL2: false,
    ext: null,
    prog: null,
    loc: null,
    cornerBuf: null,
    instBuf: null,
    maxDim: 4096,
    failures: 0,
    disabled: false
  };

  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('[ParticleEngine] shader compile failed: ' + info);
    }
    return sh;
  }

  function resetGL() {
    GLR.canvas = null;
    GLR.gl = null;
    GLR.ext = null;
    GLR.prog = null;
    GLR.loc = null;
    GLR.cornerBuf = null;
    GLR.instBuf = null;
  }

  function getGL() {
    if (GLR.disabled) return null;
    if (GLR.gl) return GLR;
    if (typeof document === 'undefined') { GLR.disabled = true; return null; }
    if (GLR.failures >= 3) { GLR.disabled = true; return null; }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const opts = {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      };
      let gl = canvas.getContext('webgl2', opts);
      let isGL2 = !!gl;
      let ext = null;
      if (!gl) {
        gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
        if (gl) ext = gl.getExtension('ANGLE_instanced_arrays');
        if (!gl || !ext) {
          GLR.disabled = true;
          return null;
        }
      }

      const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('[ParticleEngine] program link failed: ' + gl.getProgramInfoLog(prog));
      }

      const loc = {
        aCorner: gl.getAttribLocation(prog, 'aCorner'),
        aPosRad: gl.getAttribLocation(prog, 'aPosRad'),
        aColor: gl.getAttribLocation(prog, 'aColor'),
        aAngle: gl.getAttribLocation(prog, 'aAngle'),
        uRes: gl.getUniformLocation(prog, 'uRes'),
        uType: gl.getUniformLocation(prog, 'uType'),
        uGlow: gl.getUniformLocation(prog, 'uGlow')
      };

      const cornerBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

      const instBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);

      const vpDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      const rbMax = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096;
      const vpMax = vpDims ? Math.min(vpDims[0], vpDims[1]) : 4096;

      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        GLR.failures++;
        resetGL();
      }, false);

      GLR.canvas = canvas;
      GLR.gl = gl;
      GLR.isGL2 = isGL2;
      GLR.ext = ext;
      GLR.prog = prog;
      GLR.loc = loc;
      GLR.cornerBuf = cornerBuf;
      GLR.instBuf = instBuf;
      GLR.maxDim = Math.max(256, Math.min(rbMax, vpMax, 8192));
      return GLR;
    } catch (err) {
      GLR.failures++;
      resetGL();
      if (GLR.failures >= 3) GLR.disabled = true;
      if (typeof console !== 'undefined') console.warn(err && err.message ? err.message : err);
      return null;
    }
  }

  function setDivisor(R, loc, div) {
    if (R.isGL2) R.gl.vertexAttribDivisor(loc, div);
    else R.ext.vertexAttribDivisorANGLE(loc, div);
  }

  // Returns true when particles were drawn via WebGL.
  function drawWithGL(ctx, count, store, order, regX, regY, regW, regH, typeCode, qglow, isNormalBlend) {
    const R = getGL();
    if (!R) return false;
    if (regW > R.maxDim || regH > R.maxDim) return false;

    const gl = R.gl;
    if (gl.isContextLost && gl.isContextLost()) { resetGL(); return false; }

    // Grow-only canvas sizing in 256px steps: avoids per-frame GPU reallocations
    const canvas = R.canvas;
    const needW = Math.min(R.maxDim, Math.ceil(regW / 256) * 256);
    const needH = Math.min(R.maxDim, Math.ceil(regH / 256) * 256);
    if (canvas.width < needW || canvas.height < needH) {
      canvas.width = Math.max(canvas.width, needW);
      canvas.height = Math.max(canvas.height, needH);
    }
    const CH = canvas.height;

    // Pack instance data (order respects depth sort for normal blending)
    const crArr = store.cr, cgArr = store.cg, cbArr = store.cb;
    for (let k = 0; k < count; k++) {
      const ri = order ? order[k] : k;
      const si = rIdx[ri];
      const o = k * INST_FLOATS;
      instData[o] = rX[ri] - regX;
      instData[o + 1] = rY[ri] - regY;
      instData[o + 2] = rR[ri];
      instData[o + 3] = rSL[ri];
      instData[o + 4] = crArr[si] / 255;
      instData[o + 5] = cgArr[si] / 255;
      instData[o + 6] = cbArr[si] / 255;
      instData[o + 7] = rA[ri];
      instData[o + 8] = rSL[ri] > 0 ? store.ang[si] : 0;
    }

    gl.viewport(0, CH - regH, regW, regH);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, CH - regH, regW, regH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(R.prog);
    gl.uniform2f(R.loc.uRes, regW, regH);
    gl.uniform1f(R.loc.uType, typeCode);
    gl.uniform1f(R.loc.uGlow, qglow);

    gl.enable(gl.BLEND);
    if (isNormalBlend) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    const L = R.loc;
    gl.bindBuffer(gl.ARRAY_BUFFER, R.cornerBuf);
    gl.enableVertexAttribArray(L.aCorner);
    gl.vertexAttribPointer(L.aCorner, 2, gl.FLOAT, false, 0, 0);
    setDivisor(R, L.aCorner, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, R.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData.subarray(0, count * INST_FLOATS));
    const stride = INST_FLOATS * 4;
    gl.enableVertexAttribArray(L.aPosRad);
    gl.vertexAttribPointer(L.aPosRad, 4, gl.FLOAT, false, stride, 0);
    setDivisor(R, L.aPosRad, 1);
    gl.enableVertexAttribArray(L.aColor);
    gl.vertexAttribPointer(L.aColor, 4, gl.FLOAT, false, stride, 16);
    setDivisor(R, L.aColor, 1);
    gl.enableVertexAttribArray(L.aAngle);
    gl.vertexAttribPointer(L.aAngle, 1, gl.FLOAT, false, stride, 32);
    setDivisor(R, L.aAngle, 1);

    if (R.isGL2) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    else R.ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count);

    gl.disable(gl.SCISSOR_TEST);

    // Single blit onto the layer context
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = isNormalBlend ? 'source-over' : 'screen';
    try {
      ctx.drawImage(canvas, 0, 0, regW, regH, regX, regY, regW, regH);
    } catch (_) {
      ctx.restore();
      return false;
    }
    ctx.restore();
    return true;
  }

  /* ── Canvas2D Fallback Renderer ───────────────────────────────────────── */

  function ensureSprites(store, pType, qglow) {
    const key = pType + '|' + qglow;
    if (store.sprites && store.spritesKey === key && store.sprites.length >= store.count) return store.sprites;
    const arr = new Array(store.count);
    for (let i = 0; i < store.count; i++) {
      arr[i] = getParticleSprite(pType, store.cr[i], store.cg[i], store.cb[i], qglow);
    }
    store.sprites = arr;
    store.spritesKey = key;
    return arr;
  }

  function drawWithCanvas2D(ctx, count, store, order, x, y, w, h, pType, qglow, isNormalBlend, stride) {
    const sprites = ensureSprites(store, pType, qglow);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalCompositeOperation = isNormalBlend ? 'source-over' : 'screen';

    const base = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : null;
    let transformDirty = false;

    for (let k = 0; k < count; k += stride) {
      const ri = order ? order[k] : k;
      const si = rIdx[ri];
      const sprite = sprites[si];
      if (!sprite) continue;
      const r = rR[ri];
      const diam = r * 2;
      ctx.globalAlpha = rA[ri];

      const sl = rSL[ri];
      if (sl > 0) {
        const ang = store.ang[si];
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const px = rX[ri], py = rY[ri];
        if (base) {
          // Direct matrix compose: base × translate(px,py) × rotate(ang) — no save/restore churn
          ctx.setTransform(
            base.a * cs + base.c * sn,
            base.b * cs + base.d * sn,
            -base.a * sn + base.c * cs,
            -base.b * sn + base.d * cs,
            base.a * px + base.c * py + base.e,
            base.b * px + base.d * py + base.f
          );
          ctx.drawImage(sprite, -sl, -r, sl + diam, diam);
          transformDirty = true;
        } else {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(ang);
          ctx.drawImage(sprite, -sl, -r, sl + diam, diam);
          ctx.restore();
        }
        continue;
      }

      if (transformDirty) {
        ctx.setTransform(base);
        transformDirty = false;
      }
      ctx.drawImage(sprite, rX[ri] - r, rY[ri] - r, diam, diam);
    }

    if (base) ctx.setTransform(base);
    ctx.restore();
  }

  /* ── Effect Definition ─────────────────────────────────────────────────── */

  const particleEngineDef = {
    id: 'particle-engine',
    name: 'Particle Engine',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: '3D particle simulation engine like Trapcode Particular with ambient in-place spawn, physics, turbulence, and 3D camera depth',
    isExpanding: true,

    params: [
      /* Spawn & Motion Group */
      { id: 'motionType',      label: 'Motion Style',     type: 'select', options: ['Still / Locked in Place', 'Floating Ambient (In-Place)', 'Emitter Jet / Fountain'], default: 'Still / Locked in Place' },
      { id: 'emitterType',     label: 'Spawn Area',       type: 'select', options: ['Full Space (Comp Volume)', 'Box', 'Sphere', 'Point', 'Disc'], default: 'Full Space (Comp Volume)' },
      { id: 'birthRate',       label: 'Birth Rate',       type: 'number', min: 10, max: 1000, default: 150, unit: 'p/s', step: 5 },
      { id: 'velocity',        label: 'Velocity / Drift', type: 'number', min: 0, max: 1000, default: 25, unit: 'px/s', step: 1 },
      { id: 'velocityRandom',  label: 'Velocity Random',  type: 'number', min: 0, max: 100, default: 40, unit: '%', step: 1 },
      { id: 'direction',       label: 'Jet Direction',    type: 'select', options: ['Omni (Uniform)', 'Directional', 'Up', 'Down', 'Disc Plane'], default: 'Omni (Uniform)' },
      { id: 'dirAngleX',       label: 'Dir Pitch (X)',    type: 'angle',  default: 0, unit: '°' },
      { id: 'dirAngleY',       label: 'Dir Yaw (Y)',      type: 'angle',  default: 0, unit: '°' },
      { id: 'spread',          label: 'Spread Angle',     type: 'number', min: 0, max: 100, default: 100, unit: '%', step: 1 },
      { id: 'emitterX',        label: 'Center Pos X',     type: 'number', min: -1000, max: 1000, default: 0, unit: 'px', step: 1 },
      { id: 'emitterY',        label: 'Center Pos Y',     type: 'number', min: -1000, max: 1000, default: 0, unit: 'px', step: 1 },
      { id: 'emitterZ',        label: 'Center Pos Z',     type: 'number', min: -2000, max: 2000, default: 0, unit: 'px', step: 5 },
      { id: 'emitterSizeX',    label: 'Area Width (X)',   type: 'number', min: 0, max: 3000, default: 900, unit: 'px', step: 10 },
      { id: 'emitterSizeY',    label: 'Area Height (Y)',  type: 'number', min: 0, max: 3000, default: 700, unit: 'px', step: 10 },
      { id: 'emitterSizeZ',    label: 'Area Depth (Z)',   type: 'number', min: 0, max: 4000, default: 1200, unit: 'px', step: 10 },
      { id: 'preRun',          label: 'Warmup Time',      type: 'number', min: 0, max: 10, default: 2.5, unit: 's', step: 0.1 },

      /* Particle Appearance Group */
      { id: 'particleType',    label: 'Particle Type',    type: 'select', options: ['Glow Sphere', 'Sparkle Star', 'Crisp Circle', 'Glowing Ring', 'Smoke Puff', 'Streak'], default: 'Glow Sphere' },
      { id: 'life',            label: 'Life',             type: 'number', min: 0.2, max: 10, default: 3.0, unit: 's', step: 0.1 },
      { id: 'lifeRandom',      label: 'Life Random',      type: 'number', min: 0, max: 100, default: 30, unit: '%', step: 1 },
      { id: 'size',            label: 'Size',             type: 'number', min: 1, max: 100, default: 14, unit: 'px', step: 1 },
      { id: 'sizeRandom',      label: 'Size Random',      type: 'number', min: 0, max: 100, default: 40, unit: '%', step: 1 },
      { id: 'sizeOverLife',    label: 'Size over Life',   type: 'select', options: ['Grow & Shrink', 'Shrink Only', 'Grow Only', 'Constant'], default: 'Grow & Shrink' },
      { id: 'color',           label: 'Primary Color',    type: 'color',  default: '#38bdf8' },
      { id: 'color2',          label: 'Secondary Color',  type: 'color',  default: '#fbbf24' },
      { id: 'colorMode',       label: 'Color Mode',       type: 'select', options: ['Two Color Blend', 'Single Color', 'Rainbow Hue'], default: 'Two Color Blend' },
      { id: 'opacity',         label: 'Opacity',          type: 'number', min: 0, max: 100, default: 100, unit: '%', step: 1 },
      { id: 'opacityOverLife', label: 'Opacity over Life',type: 'select', options: ['Fade In & Out', 'Fade Out Only', 'Fade In Only', 'Constant'], default: 'Fade In & Out' },
      // Blend Mode Normal enables full alpha compatibility with downstream Deep Glow
      { id: 'blendMode',       label: 'Blend Mode',       type: 'select', options: ['Normal / Alpha', 'Screen / Additive'], default: 'Normal / Alpha' },
      { id: 'glow',            label: 'Inner Glow Halo',  type: 'number', min: 0, max: 100, default: 40, unit: '%', step: 1 },

      /* Physics Group */
      { id: 'gravity',         label: 'Gravity (Y)',      type: 'number', min: -1000, max: 1000, default: 0, unit: 'px/s²', step: 5 },
      { id: 'drag',            label: 'Air Resistance',   type: 'number', min: 0, max: 100, default: 10, unit: '%', step: 1 },
      { id: 'windX',           label: 'Wind X',           type: 'number', min: -500, max: 500, default: 0, unit: 'px/s', step: 2 },
      { id: 'windY',           label: 'Wind Y',           type: 'number', min: -500, max: 500, default: 0, unit: 'px/s', step: 2 },
      { id: 'windZ',           label: 'Wind Z',           type: 'number', min: -500, max: 500, default: 0, unit: 'px/s', step: 2 },
      { id: 'turbulence',      label: 'Turbulence Wiggle',type: 'number', min: 0, max: 200, default: 25, unit: 'px', step: 1 },
      { id: 'turbSpeed',       label: 'Turbulence Speed', type: 'number', min: 0.1, max: 5.0, default: 0.8, step: 0.1 },

      /* 3D Camera & Layer Group */
      { id: 'useCamera',       label: 'Follow 3D Camera', type: 'switch', default: 1 },
      { id: 'depthFade',       label: 'Depth Fade',       type: 'number', min: 0, max: 100, default: 75, unit: '%', step: 1 },
      { id: 'camRotX',         label: 'Manual Pitch (X)', type: 'angle',  default: 0, unit: '°' },
      { id: 'camRotY',         label: 'Manual Yaw (Y)',   type: 'angle',  default: 0, unit: '°' },
      { id: 'camRotZ',         label: 'Manual Roll (Z)',  type: 'angle',  default: 0, unit: '°' },
      { id: 'hideSource',      label: 'Hide Source Layer',type: 'switch', default: 1 },
      { id: 'seed',            label: 'Random Seed',      type: 'number', min: 1, max: 9999, default: 1234, step: 1 }
    ],

    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      /* ── 1. Hide Source Fill Rule ── */
      const hideSource = (fx.hideSource === undefined || fx.hideSource === 1 || fx.hideSource === true || fx.hideSource === 'true');
      if (!hideSource && el) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      }

      /* ── 2. Time Resolution ── */
      const curTime = getCurrentTime(layer, currentSec);
      const startSec = (layer && typeof layer.startSec === 'number') ? layer.startSec : 0;
      const relTime = curTime - startSec;
      const preRun = Math.max(0, fx.preRun !== undefined ? Number(fx.preRun) : 2.5);
      const simTime = Math.max(0, relTime + preRun);

      /* ── 3. Base Comp Dimensions ── */
      const aspect = (window.currentProjectState && window.currentProjectState.aspectRatio) || '16:9';
      const res = (window.currentProjectState && window.currentProjectState.resolution) || '1080p';
      const rMap = (typeof window !== 'undefined' && window.resMap) || {
        '720p':  { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720], '4:5': [720, 900], '21:9': [1680, 720] },
        '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '21:9': [2560, 1080] },
        '2k':    { '16:9': [2560, 1440], '9:16': [1440, 2560], '1:1': [1440, 1440], '4:5': [1440, 1800], '21:9': [3440, 1440] },
        '4k':    { '16:9': [3840, 2160], '9:16': [2160, 3840], '1:1': [2160, 2160], '4:5': [2160, 2700], '21:9': [5120, 2160] }
      };
      const baseDims = (rMap[res] && rMap[res][aspect]) || [1920, 1080];
      const compW = (window.currentProjectState && window.currentProjectState.width && window.currentProjectState.width > 0)
        ? window.currentProjectState.width
        : baseDims[0];
      const compH = (window.currentProjectState && window.currentProjectState.height && window.currentProjectState.height > 0)
        ? window.currentProjectState.height
        : baseDims[1];
      const compCenterX = compW / 2;
      const compCenterY = compH / 2;

      /* ── 4. Parameter Parsing ── */
      const baseLife = Math.max(0.2, Math.min(10, fx.life !== undefined ? Number(fx.life) : 3.0));
      const lifeRandom = Math.max(0, Math.min(100, fx.lifeRandom !== undefined ? Number(fx.lifeRandom) : 30)) / 100;
      const P = {
        simTime,
        seed: Math.round(fx.seed !== undefined ? Number(fx.seed) : 1234),
        birthRate: Math.max(5, Math.min(1000, fx.birthRate !== undefined ? Number(fx.birthRate) : 150)),
        baseLife,
        lifeRandom,
        maxLife: baseLife * (1 + lifeRandom),
        motionType: fx.motionType || 'Still / Locked in Place',
        emitterType: fx.emitterType || 'Full Space (Comp Volume)',
        baseVel: Math.max(0, fx.velocity !== undefined ? Number(fx.velocity) : 25),
        velRand: Math.max(0, Math.min(100, fx.velocityRandom !== undefined ? Number(fx.velocityRandom) : 40)) / 100,
        direction: fx.direction || 'Omni (Uniform)',
        spread: Math.max(0, Math.min(100, fx.spread !== undefined ? Number(fx.spread) : 100)) / 100,
        dirAngleX: (fx.dirAngleX || 0) * (Math.PI / 180),
        dirAngleY: (fx.dirAngleY || 0) * (Math.PI / 180),
        emX: fx.emitterX || 0,
        emY: fx.emitterY || 0,
        emZ: fx.emitterZ || 0,
        emSx: (fx.emitterSizeX !== undefined ? Number(fx.emitterSizeX) : 900) / 2,
        emSy: (fx.emitterSizeY !== undefined ? Number(fx.emitterSizeY) : 700) / 2,
        emSz: (fx.emitterSizeZ !== undefined ? Number(fx.emitterSizeZ) : 1200) / 2,
        baseSize: Math.max(1, fx.size !== undefined ? Number(fx.size) : 14),
        sizeRand: Math.max(0, Math.min(100, fx.sizeRandom !== undefined ? Number(fx.sizeRandom) : 40)) / 100,
        sizeOverLife: fx.sizeOverLife || 'Grow & Shrink',
        color: fx.color || '#38bdf8',
        color2: fx.color2 || '#fbbf24',
        colorMode: fx.colorMode || 'Two Color Blend',
        baseOp: Math.max(0, Math.min(100, fx.opacity !== undefined ? Number(fx.opacity) : 100)) / 100,
        opOverLife: fx.opacityOverLife || 'Fade In & Out',
        gravity: fx.gravity !== undefined ? Number(fx.gravity) : 0,
        dragK: (Math.max(0, Math.min(100, fx.drag !== undefined ? Number(fx.drag) : 10)) / 100) * 2.5,
        windX: fx.windX || 0,
        windY: fx.windY || 0,
        windZ: fx.windZ || 0,
        turbulence: Math.max(0, fx.turbulence !== undefined ? Number(fx.turbulence) : 25),
        turbSpeed: Math.max(0.1, fx.turbSpeed !== undefined ? Number(fx.turbSpeed) : 0.8),
        compW,
        compH
      };

      const pType = fx.particleType || 'Glow Sphere';
      const isStreak = (pType === 'Streak');
      const typeCode = particleTypeCode(pType);
      const qglow = quantizeGlow(Math.max(0, Math.min(100, fx.glow !== undefined ? Number(fx.glow) : 40)));
      const isNormalBlend = (fx.blendMode === undefined || fx.blendMode === 'Normal / Alpha' || fx.blendMode === 'normal');
      const depthFade = Math.max(0, Math.min(100, fx.depthFade !== undefined ? Number(fx.depthFade) : 75)) / 100;

      /* ── 5. Stage 1: Cached World-Space Simulation ── */
      const cacheKey = ((layer && layer.id !== undefined) ? layer.id : 'anon') + '|' + (fx.id !== undefined ? fx.id : 'fx');
      const store = getSimStore(cacheKey);
      const sig = [
        simTime.toFixed(4), P.seed, P.birthRate, P.baseLife, P.lifeRandom, P.motionType, P.emitterType,
        P.baseVel, P.velRand, P.direction, P.spread, P.dirAngleX, P.dirAngleY,
        P.emX, P.emY, P.emZ, P.emSx, P.emSy, P.emSz, P.baseSize, P.sizeRand, P.sizeOverLife,
        P.color, P.color2, P.colorMode, P.baseOp, P.opOverLife, P.gravity, P.dragK,
        P.windX, P.windY, P.windZ, P.turbulence, P.turbSpeed, compW, compH
      ].join('|');
      if (store.sig !== sig) {
        runSimulation(store, P);
        store.sig = sig;
      }

      const numSim = store.count;
      if (numSim === 0) return;

      /* ── 6. Stage 2: 3D Camera Projection ── */
      let camPosX = 0, camPosY = 0, camPosZ = 0;
      let camRotX = 0, camRotY = 0, camRotZ = 0;
      let camZoom = 1.0;
      let camLens = 50;

      if (fx.useCamera !== 0 && typeof window !== 'undefined') {
        const cam = resolveCameraState(curTime);
        if (cam.found) {
          const isLayer3D = !!(layer && layer.is3D);
          if (!isLayer3D) {
            camPosX = cam.posX;
            camPosY = cam.posY;
            camPosZ = cam.posZ;
            camRotX = cam.rotX;
            camRotY = cam.rotY;
            camRotZ = cam.rotZ;
          }
          camZoom = cam.zoom;
          camLens = cam.lens;
        }
      }

      const totalRotX = camRotX + (fx.camRotX || 0);
      const totalRotY = camRotY + (fx.camRotY || 0);
      const totalRotZ = camRotZ + (fx.camRotZ || 0);

      const radZ = (-totalRotZ * Math.PI) / 180;
      const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
      const radY = (totalRotY * Math.PI) / 180;
      const cY = Math.cos(radY), sY = Math.sin(radY);
      const radX = (totalRotX * Math.PI) / 180;
      const cX = Math.cos(radX), sX = Math.sin(radX);

      // Combined 3x3 rotation matrix (Roll Z -> Yaw Y -> Pitch X)
      const m00 = cY * cZ;
      const m01 = -cY * sZ;
      const m02 = sY;
      const m10 = cX * sZ + sX * sY * cZ;
      const m11 = cX * cZ - sX * sY * sZ;
      const m12 = -sX * cY;
      const m20 = sX * sZ - cX * sY * cZ;
      const m21 = sX * cZ + cX * sY * sZ;
      const m22 = cX * cY;

      const lensFactor = Math.max(0.01, camLens / 50);
      const totalZoom = lensFactor * camZoom;
      const D = 1000.0 * lensFactor;
      const DZ = D * totalZoom;

      const bScale = (bounds && typeof bounds.bufferScale === 'number' && bounds.bufferScale > 0)
        ? bounds.bufferScale
        : Math.max(0.01, w / Math.max(1, (layer && layer.scaleW) ? Math.abs(layer.scaleW) : compW));

      const layerPosX = (layer && layer.posX !== undefined) ? layer.posX : compCenterX;
      const layerPosY = (layer && layer.posY !== undefined) ? layer.posY : compCenterY;
      const screenCenterX = (x + w / 2) + (compCenterX - layerPosX) * bScale;
      const screenCenterY = (y + h / 2) + (compCenterY - layerPosY) * bScale;

      const pNear = 20.0;
      const margin = 100 * bScale;
      const clipLeft = x - margin;
      const clipRight = x + w + margin;
      const clipTop = y - margin;
      const clipBottom = y + h + margin;

      const useDepthFade = depthFade > 0.05;
      const farThreshold = D * (1.8 + (1 - depthFade) * 2.0);
      const farLimit = farThreshold * 1.5;
      const streakMax = 40 * bScale;

      const wxA = store.wx, wyA = store.wy, wzA = store.wz;
      const radA = store.rad, alphaA = store.alpha, spdA = store.spd;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let k = 0;

      for (let i = 0; i < numSim; i++) {
        const relX = wxA[i] - camPosX;
        const relY = wyA[i] - camPosY;
        const relZ = (wzA[i] - camPosZ) - D;

        const camZ = relX * m20 + relY * m21 + relZ * m22;
        const dist = -camZ;
        if (dist <= pNear) continue;

        const camXv = relX * m00 + relY * m01 + relZ * m02;
        const camYv = relX * m10 + relY * m11 + relZ * m12;
        const projScale = DZ / dist;
        const sx = screenCenterX + camXv * projScale * bScale;
        const sy = screenCenterY + camYv * projScale * bScale;

        if (sx < clipLeft || sx > clipRight || sy < clipTop || sy > clipBottom) continue;

        let depthAlpha = 1.0;
        if (useDepthFade) {
          const nearFade = Math.min(1.0, Math.max(0.0, (dist - pNear - 15) / 120));
          const farFade = Math.min(1.0, Math.max(0.0, (farLimit - dist) / farThreshold));
          depthAlpha = nearFade * farFade;
        }
        const a = Math.max(0.01, Math.min(1.0, alphaA[i] * depthAlpha));
        const r = Math.max(0.6, radA[i] * projScale * bScale);

        let sl = 0;
        if (isStreak && spdA[i] > 15) {
          sl = Math.min(streakMax, spdA[i] * 0.08 * (D / dist) * bScale);
        }

        rIdx[k] = i;
        rX[k] = sx;
        rY[k] = sy;
        rR[k] = r;
        rA[k] = a;
        rSL[k] = sl;
        rDist[k] = dist;

        const ext = sl > 0 ? (sl + r * 2) : r;
        if (sx - ext < minX) minX = sx - ext;
        if (sx + ext > maxX) maxX = sx + ext;
        if (sy - ext < minY) minY = sy - ext;
        if (sy + ext > maxY) maxY = sy + ext;
        k++;
      }

      if (k === 0) return;

      /* ── 7. Painter's Depth Sort (normal blend only; screen is commutative) ── */
      let order = null;
      if (isNormalBlend && k > 1) {
        for (let i = 0; i < k; i++) rOrder[i] = i;
        order = rOrder.subarray(0, k);
        order.sort(depthCompare);
      }

      /* ── 8. Render: WebGL instanced (primary) or Canvas2D (fallback) ── */
      // Dirty region = particle bounding box ∩ layer bounds → minimal GPU fill & blit area
      const regX = Math.floor(Math.max(x, minX));
      const regY = Math.floor(Math.max(y, minY));
      const regR = Math.ceil(Math.min(x + w, maxX));
      const regB = Math.ceil(Math.min(y + h, maxY));
      const regW = regR - regX;
      const regH = regB - regY;
      if (regW <= 0 || regH <= 0) return;

      if (drawWithGL(ctx, k, store, order, regX, regY, regW, regH, typeCode, qglow, isNormalBlend)) {
        return;
      }

      const isInteracting = !!(window.isTransformInteracting || window.isTimelinePanning || window.isPanning);
      const stride = (isInteracting && k > 700) ? 2 : 1;
      drawWithCanvas2D(ctx, k, store, order, x, y, w, h, pType, qglow, isNormalBlend, stride);
    }
  };

  reg.register(particleEngineDef);

})(typeof window !== 'undefined' ? window : this);
