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

  /* ── Sprite Texture Cache for High-Performance Rendering ───────────────── */

  const spriteCache = new Map();
  const MAX_SPRITE_SIZE = 128;

  function getParticleSprite(type, r, g, b, glowAmt) {
    const key = `${type}_${r}_${g}_${b}_${Math.round(glowAmt)}`;
    if (spriteCache.has(key)) return spriteCache.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = MAX_SPRITE_SIZE;
    canvas.height = MAX_SPRITE_SIZE;
    const ctx = canvas.getContext('2d');
    const c = MAX_SPRITE_SIZE / 2;
    const rad = c - 4;

    const rgbStr = `${r}, ${g}, ${b}`;

    if (type === 'Crisp Circle') {
      ctx.beginPath();
      ctx.arc(c, c, rad * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${rgbStr})`;
      ctx.fill();
    } else if (type === 'Glowing Ring') {
      ctx.beginPath();
      ctx.arc(c, c, rad * 0.75, 0, Math.PI * 2);
      ctx.lineWidth = rad * 0.28;
      ctx.strokeStyle = `rgb(${rgbStr})`;
      ctx.stroke();

      if (glowAmt > 5) {
        ctx.beginPath();
        ctx.arc(c, c, rad * 0.75, 0, Math.PI * 2);
        ctx.lineWidth = rad * 0.55;
        ctx.strokeStyle = `rgba(${rgbStr}, ${(glowAmt / 200).toFixed(2)})`;
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
      // Default: Glow Sphere (with intense high-luminance white core so Deep Glow triggers heavily!)
      const grad = ctx.createRadialGradient(c, c, 0, c, c, rad);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, `rgb(${rgbStr})`);
      const glowEdge = Math.min(0.92, 0.45 + (glowAmt / 200));
      grad.addColorStop(glowEdge, `rgba(${rgbStr}, ${(0.4 + glowAmt / 150).toFixed(2)})`);
      grad.addColorStop(1, `rgba(${rgbStr}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    if (spriteCache.size > 120) {
      const firstKey = spriteCache.keys().next().value;
      spriteCache.delete(firstKey);
    }
    spriteCache.set(key, canvas);
    return canvas;
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
      // Wajib Blend Mode Normal by default: enables full alpha compatibility with downstream Deep Glow
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

      /* ── 1. Hide Source Fill Rule (Mandatory for Particular on Solids) ── */
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

      /* ── 3. Parameter Parsing ── */
      const seed = Math.round(fx.seed !== undefined ? Number(fx.seed) : 1234);
      const birthRate = Math.max(5, Math.min(1000, fx.birthRate !== undefined ? Number(fx.birthRate) : 150));
      const baseLife = Math.max(0.2, Math.min(10, fx.life !== undefined ? Number(fx.life) : 3.0));
      const lifeRandom = Math.max(0, Math.min(100, fx.lifeRandom !== undefined ? Number(fx.lifeRandom) : 30)) / 100;
      const maxLife = baseLife * (1 + lifeRandom);

      const motionType = fx.motionType || 'Still / Locked in Place';
      const emitterType = fx.emitterType || 'Full Space (Comp Volume)';
      const baseVel = Math.max(0, fx.velocity !== undefined ? Number(fx.velocity) : 25);
      const velRand = Math.max(0, Math.min(100, fx.velocityRandom !== undefined ? Number(fx.velocityRandom) : 40)) / 100;
      const direction = fx.direction || 'Omni (Uniform)';
      const spread = Math.max(0, Math.min(100, fx.spread !== undefined ? Number(fx.spread) : 100)) / 100;
      const dirAngleX = (fx.dirAngleX || 0) * (Math.PI / 180);
      const dirAngleY = (fx.dirAngleY || 0) * (Math.PI / 180);

      const emX = fx.emitterX || 0;
      const emY = fx.emitterY || 0;
      const emZ = fx.emitterZ || 0;
      const emSx = (fx.emitterSizeX !== undefined ? Number(fx.emitterSizeX) : 900) / 2;
      const emSy = (fx.emitterSizeY !== undefined ? Number(fx.emitterSizeY) : 700) / 2;
      const emSz = (fx.emitterSizeZ !== undefined ? Number(fx.emitterSizeZ) : 1200) / 2;

      const pType = fx.particleType || 'Glow Sphere';
      const baseSize = Math.max(1, fx.size !== undefined ? Number(fx.size) : 14);
      const sizeRand = Math.max(0, Math.min(100, fx.sizeRandom !== undefined ? Number(fx.sizeRandom) : 40)) / 100;
      const sizeOverLife = fx.sizeOverLife || 'Grow & Shrink';

      const primaryColor = hexToRgb(fx.color || '#38bdf8');
      const secondaryColor = hexToRgb(fx.color2 || '#fbbf24');
      const colorMode = fx.colorMode || 'Two Color Blend';
      const baseOp = Math.max(0, Math.min(100, fx.opacity !== undefined ? Number(fx.opacity) : 100)) / 100;
      const opOverLife = fx.opacityOverLife || 'Fade In & Out';

      // Default blendMode is Normal / Alpha so downstream effects like Deep Glow see full RGB and alpha!
      const isNormalBlend = (fx.blendMode === undefined || fx.blendMode === 'Normal / Alpha' || fx.blendMode === 'normal');
      const glowAmt = Math.max(0, Math.min(100, fx.glow !== undefined ? Number(fx.glow) : 40));

      const gravity = fx.gravity !== undefined ? Number(fx.gravity) : 0;
      const dragVal = Math.max(0, Math.min(100, fx.drag !== undefined ? Number(fx.drag) : 10)) / 100;
      const dragK = dragVal * 2.5;
      const windX = fx.windX || 0;
      const windY = fx.windY || 0;
      const windZ = fx.windZ || 0;
      const turbulence = Math.max(0, fx.turbulence !== undefined ? Number(fx.turbulence) : 25);
      const turbSpeed = Math.max(0.1, fx.turbSpeed !== undefined ? Number(fx.turbSpeed) : 0.8);
      const depthFade = Math.max(0, Math.min(100, fx.depthFade !== undefined ? Number(fx.depthFade) : 75)) / 100;

      /* ── 4. 3D Camera Tracking & Perspective Projection ── */
      let camPosX = 0, camPosY = 0, camPosZ = 0;
      let camRotX = 0, camRotY = 0, camRotZ = 0;
      let camZoom = 1.0;
      let camLens = 50;

      const isLayer3D = !!(layer && layer.is3D);

      if (fx.useCamera !== 0 && typeof window !== 'undefined') {
        let compLayers = null;
        if (window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers)) {
          compLayers = window.currentActivePrecomp.layers;
        } else if (window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
          compLayers = window.currentProjectState.layers;
        }

        if (compLayers) {
          const cam = compLayers.find(l => l && l.type === 'camera' && !l.hidden);
          if (cam) {
            const camEff = (typeof window.getLayerEffectivePropsAtTime === 'function' && typeof curTime === 'number')
              ? window.getLayerEffectivePropsAtTime(cam, curTime, null, compLayers)
              : cam;

            if (!isLayer3D) {
              camPosX = camEff.posX || 0;
              camPosY = camEff.posY || 0;
              camPosZ = camEff.posZ || 0;
              camRotX = camEff.rotX || 0;
              camRotY = camEff.rotY || 0;
              camRotZ = camEff.rotZ !== undefined ? camEff.rotZ : (camEff.rotation || 0);
            }
            camZoom = (camEff.cameraZoom !== undefined ? camEff.cameraZoom : 100) / 100;
            camLens = Math.max(1, camEff.cameraLens !== undefined ? camEff.cameraLens : 50);
          }
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

      const lensFactor = Math.max(0.01, camLens / 50);
      const totalZoom = lensFactor * camZoom;
      const D = 1000.0 * lensFactor;

      const compW = (window.currentProjectState && window.currentProjectState.width) || w;
      const compH = (window.currentProjectState && window.currentProjectState.height) || h;
      const compCenterX = compW / 2;
      const compCenterY = compH / 2;
      const layerPosX = (layer && layer.posX !== undefined) ? layer.posX : compCenterX;
      const layerPosY = (layer && layer.posY !== undefined) ? layer.posY : compCenterY;
      const screenCenterX = (x + w / 2) + (compCenterX - layerPosX);
      const screenCenterY = (y + h / 2) + (compCenterY - layerPosY);

      /* ── 5. Deterministic Particle Simulation Loop ── */
      const lastIdx = Math.floor(simTime * birthRate);
      const firstIdx = Math.max(0, Math.floor((simTime - maxLife) * birthRate));
      const maxCount = 1500;
      const safeFirstIdx = Math.max(firstIdx, lastIdx - maxCount);

      const aliveParticles = [];

      for (let j = safeFirstIdx; j <= lastIdx; j++) {
        const tBirth = j / birthRate;
        const age = simTime - tBirth;
        if (age < 0) continue;

        const pLife = baseLife * (1 + (hash(j, seed + 1) - 0.5) * 2 * lifeRandom);
        if (age >= pLife) continue;

        const progress = Math.max(0, Math.min(1, age / pLife));

        // 5a. Initial 3D Spawn Position (In-place ambient distribution across space)
        let px0 = emX;
        let py0 = emY;
        let pz0 = emZ;

        if (emitterType === 'Full Space (Comp Volume)') {
          const spanX = Math.max(w * 1.3, emSx * 2);
          const spanY = Math.max(h * 1.3, emSy * 2);
          const spanZ = Math.max(w * 1.3, Math.max(1400, emSz * 2));
          px0 += (hash(j, seed + 2) - 0.5) * spanX;
          py0 += (hash(j, seed + 3) - 0.5) * spanY;
          pz0 += (hash(j, seed + 4) - 0.5) * spanZ;
        } else if (emitterType === 'Box') {
          px0 += (hash(j, seed + 2) - 0.5) * 2 * emSx;
          py0 += (hash(j, seed + 3) - 0.5) * 2 * emSy;
          pz0 += (hash(j, seed + 4) - 0.5) * 2 * emSz;
        } else if (emitterType === 'Sphere') {
          const u = hash(j, seed + 2);
          const v = hash(j, seed + 3);
          const rRad = Math.cbrt(hash(j, seed + 4));
          const theta = u * Math.PI * 2;
          const phi = Math.acos(2 * v - 1);
          px0 += rRad * emSx * Math.sin(phi) * Math.cos(theta);
          py0 += rRad * emSy * Math.sin(phi) * Math.sin(theta);
          pz0 += rRad * emSz * Math.cos(phi);
        } else if (emitterType === 'Disc') {
          const theta = hash(j, seed + 2) * Math.PI * 2;
          const rRad = Math.sqrt(hash(j, seed + 3));
          px0 += rRad * emSx * Math.cos(theta);
          py0 += rRad * emSy * Math.sin(theta);
          pz0 += (hash(j, seed + 4) - 0.5) * emSz * 0.15;
        }

        // 5b. Initial Velocity Vector / Drift Behavior
        const isStill = (
          motionType === 'Still / Locked in Place' ||
          motionType === 'Static Floating' ||
          (typeof motionType === 'string' && (motionType.toLowerCase().includes('still') || motionType.toLowerCase().includes('locked')))
        );

        const pSpeed = Math.max(0, baseVel * (1 + (hash(j, seed + 5) - 0.5) * 2 * velRand));
        let vx0 = 0, vy0 = 0, vz0 = 0;

        if (isStill) {
          // Particles stay completely locked at spawn coordinates (0 velocity, 0 drift)
          vx0 = 0;
          vy0 = 0;
          vz0 = 0;
        } else if (motionType === 'Floating Ambient (In-Place)') {
          // Particles appear in-place across the room and gently float/shimmer (NO fountain shoot!)
          const driftAngle = hash(j, seed + 6) * Math.PI * 2;
          const driftZ = (hash(j, seed + 7) - 0.5) * 2;
          const driftSpeed = pSpeed * 0.5;
          vx0 = Math.cos(driftAngle) * driftSpeed;
          vy0 = (Math.sin(driftAngle) * 0.3 - 0.5) * driftSpeed; // slight buoyant rise
          vz0 = driftZ * driftSpeed * 0.4;
        } else {
          // Emitter Jet / Fountain (Classic ejection outward)
          if (direction === 'Omni (Uniform)') {
            const theta = hash(j, seed + 6) * Math.PI * 2;
            const zDir = hash(j, seed + 7) * 2 - 1;
            const rXy = Math.sqrt(Math.max(0, 1 - zDir * zDir));
            vx0 = rXy * Math.cos(theta) * pSpeed;
            vy0 = rXy * Math.sin(theta) * pSpeed;
            vz0 = zDir * pSpeed;
          } else if (direction === 'Up') {
            const coneU = (hash(j, seed + 6) - 0.5) * spread;
            const coneV = (hash(j, seed + 7) - 0.5) * spread;
            vx0 = coneU * pSpeed;
            vy0 = -pSpeed;
            vz0 = coneV * pSpeed;
          } else if (direction === 'Down') {
            const coneU = (hash(j, seed + 6) - 0.5) * spread;
            const coneV = (hash(j, seed + 7) - 0.5) * spread;
            vx0 = coneU * pSpeed;
            vy0 = pSpeed;
            vz0 = coneV * pSpeed;
          } else if (direction === 'Disc Plane') {
            const theta = hash(j, seed + 6) * Math.PI * 2;
            vx0 = Math.cos(theta) * pSpeed;
            vy0 = Math.sin(theta) * pSpeed;
            vz0 = (hash(j, seed + 7) - 0.5) * pSpeed * spread * 0.2;
          } else {
            const coneSpread = (1 - spread) * 0.5;
            const ru = (hash(j, seed + 6) - 0.5) * 2 * (1 - coneSpread);
            const rv = (hash(j, seed + 7) - 0.5) * 2 * (1 - coneSpread);
            const cDirX = Math.cos(dirAngleX), sDirX = Math.sin(dirAngleX);
            const cDirY = Math.cos(dirAngleY), sDirY = Math.sin(dirAngleY);
            vx0 = (sDirY + ru * spread) * pSpeed;
            vy0 = (-sDirX + rv * spread) * pSpeed;
            vz0 = (cDirY * cDirX) * pSpeed;
          }
        }

        // 5c. Physics Integration (Analytical, O(1) Zero Drift)
        let worldPx = px0;
        let worldPy = py0;
        let worldPz = pz0;

        if (!isStill) {
          let velDisp = age;
          if (dragK > 0.02) {
            velDisp = (1 - Math.exp(-dragK * age)) / dragK;
          }

          const netAccX = windX;
          const netAccY = gravity + windY;
          const netAccZ = windZ;

          const halfAge2 = 0.5 * age * age;

          // 3D Turbulence Curl Wiggle
          let turbX = 0, turbY = 0, turbZ = 0;
          if (turbulence > 0) {
            const phase = (j * 0.381966 + seed) % 1000;
            const ft = age * turbSpeed * 3.14 + phase;
            const tScale = Math.min(1, age * 2.0) * turbulence;
            turbX = (Math.sin(ft) + 0.5 * Math.sin(ft * 2.3 + 1.2)) * tScale;
            turbY = (Math.cos(ft * 1.37 + 1.8) + 0.5 * Math.cos(ft * 2.71 + 0.4)) * tScale;
            turbZ = (Math.sin(ft * 0.89 + 3.1) + 0.5 * Math.sin(ft * 1.93 + 2.5)) * tScale;
          }

          worldPx += vx0 * velDisp + netAccX * halfAge2 + turbX;
          worldPy += vy0 * velDisp + netAccY * halfAge2 + turbY;
          worldPz += vz0 * velDisp + netAccZ * halfAge2 + turbZ;
        }

        // 5d. Camera Space Coordinate Transformation (Exact FishTool 3D Camera Model)
        let relX = worldPx - camPosX;
        let relY = worldPy - camPosY;
        let relZ = (worldPz - camPosZ) - D;

        // Roll Z
        if (totalRotZ !== 0) {
          const nX = relX * cZ - relY * sZ;
          const nY = relX * sZ + relY * cZ;
          relX = nX;
          relY = nY;
        }

        // Yaw Y
        if (totalRotY !== 0) {
          const nX = relX * cY + relZ * sY;
          const nZ = -relX * sY + relZ * cY;
          relX = nX;
          relZ = nZ;
        }

        // Pitch X
        if (totalRotX !== 0) {
          const nY = relY * cX - relZ * sX;
          const nZ = relY * sX + relZ * cX;
          relY = nY;
          relZ = nZ;
        }

        const dist = -relZ;
        const pNear = 20.0;
        if (dist <= pNear) continue; // Behind camera near plane

        const projScale = (D * totalZoom) / dist;
        const scrX = screenCenterX + relX * projScale;
        const scrY = screenCenterY + relY * projScale;

        if (scrX < x - 120 || scrX > x + w + 120 || scrY < y - 120 || scrY > y + h + 120) {
          continue;
        }

        // 5e. Particle Size over Life
        const pSize = Math.max(1, baseSize * (1 + (hash(j, seed + 8) - 0.5) * 2 * sizeRand));
        let sizeFactor = 1.0;
        if (sizeOverLife === 'Grow & Shrink') {
          sizeFactor = Math.sin(progress * Math.PI);
        } else if (sizeOverLife === 'Shrink Only') {
          sizeFactor = 1 - progress;
        } else if (sizeOverLife === 'Grow Only') {
          sizeFactor = progress;
        }
        const scrRadius = Math.max(0.6, pSize * sizeFactor * projScale * 0.5);

        // 5f. Particle Opacity over Life & Depth Fade
        let opLife = 1.0;
        if (opOverLife === 'Fade In & Out') {
          opLife = Math.sin(progress * Math.PI);
        } else if (opOverLife === 'Fade Out Only') {
          opLife = 1 - progress;
        } else if (opOverLife === 'Fade In Only') {
          opLife = progress;
        }

        let depthAlpha = 1.0;
        if (depthFade > 0.05) {
          const nearFade = Math.min(1.0, Math.max(0.0, (dist - pNear - 15) / 120));
          const farThreshold = D * (1.8 + (1 - depthFade) * 2.0);
          const farFade = Math.min(1.0, Math.max(0.0, (farThreshold * 1.5 - dist) / farThreshold));
          depthAlpha = nearFade * farFade;
        }

        const finalAlpha = Math.max(0.01, Math.min(1.0, baseOp * opLife * depthAlpha));

        // 5g. Particle Color
        let pColor;
        if (colorMode === 'Two Color Blend') {
          const colorBlendT = (progress * 0.7 + hash(j, seed + 9) * 0.3);
          pColor = lerpRgb(primaryColor, secondaryColor, colorBlendT);
        } else if (colorMode === 'Rainbow Hue') {
          const hue = Math.round((progress * 240 + hash(j, seed + 9) * 360) % 360);
          pColor = hslToRgb(hue, 0.95, 0.6);
        } else {
          pColor = primaryColor;
        }

        aliveParticles.push({
          dist,
          scrX,
          scrY,
          scrRadius,
          finalAlpha,
          pColor,
          velX: vx0,
          velY: vy0
        });
      }

      /* ── 6. Painter's Algorithm Depth Sort (Farthest to Nearest) ── */
      aliveParticles.sort((a, b) => b.dist - a.dist);

      /* ── 7. Render Particle Sprites to Canvas ── */
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      if (isNormalBlend) {
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.globalCompositeOperation = 'screen';
      }

      const totalAlive = aliveParticles.length;
      for (let i = 0; i < totalAlive; i++) {
        const p = aliveParticles[i];
        const sprite = getParticleSprite(pType, p.pColor.r, p.pColor.g, p.pColor.b, glowAmt);

        ctx.globalAlpha = p.finalAlpha;
        const diam = p.scrRadius * 2;

        if (pType === 'Streak') {
          const spd = Math.sqrt(p.velX * p.velX + p.velY * p.velY);
          if (spd > 15) {
            const streakLen = Math.min(40, spd * 0.08 * (D / p.dist));
            const angle = Math.atan2(p.velY, p.velX);
            ctx.save();
            ctx.translate(p.scrX, p.scrY);
            ctx.rotate(angle);
            ctx.drawImage(sprite, -streakLen, -p.scrRadius, streakLen + diam, diam);
            ctx.restore();
            continue;
          }
        }

        ctx.drawImage(sprite, p.scrX - p.scrRadius, p.scrY - p.scrRadius, diam, diam);
      }

      ctx.restore();
    }
  };

  reg.register(particleEngineDef);

})(typeof window !== 'undefined' ? window : this);
