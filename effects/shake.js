(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hash(n) {
    let s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return (s - Math.floor(s)) * 2 - 1; // Range: -1.0 to 1.0
  }

  function smoothNoise1D(t, seedOffset) {
    const step = Math.floor(t);
    const frac = t - step;
    // Quintic smoothstep for C2 continuous velocity & natural organic camera shake
    const u = frac * frac * frac * (frac * (frac * 6 - 15) + 10);
    const n0 = hash(step + seedOffset);
    const n1 = hash(step + 1 + seedOffset);
    return n0 + (n1 - n0) * u;
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

  reg.register({
    id: 'shake',
    name: 'Shake',
    category: 'movement',
    icon: 'assets/FXPH.svg',
    description: 'Natural organic camera and layer shake with position, rotation, and frequency controls',
    isExpanding: true,
    params: [
      { id: 'amplitude', label: 'Amplitude', type: 'number', min: 0, max: 20, default: 1.0, unit: '', step: 0.1 },
      { id: 'frequency', label: 'Frequency', type: 'number', min: 0.1, max: 30, default: 8, unit: 'Hz', step: 0.1 },
      { id: 'amplitudeX', label: 'Position X', type: 'number', min: 0, max: 300, default: 25, unit: 'px', step: 1 },
      { id: 'amplitudeY', label: 'Position Y', type: 'number', min: 0, max: 300, default: 25, unit: 'px', step: 1 },
      { id: 'rotation', label: 'Rotation', type: 'number', min: 0, max: 45, default: 3, unit: '°', step: 0.5 },
      { id: 'randomness', label: 'Randomness', type: 'number', min: 0, max: 100, default: 80, unit: '%', step: 1 },
      { id: 'seed', label: 'Random Seed', type: 'number', min: 1, max: 9999, default: 1234, unit: '', step: 1 }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      let currentFx = fx || {};
      const sec = getCurrentTime(layer, currentSec);
      if (layer && typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function') {
        const eff = window.getLayerEffectivePropsAtTime(layer, sec);
        if (eff && Array.isArray(eff.effects)) {
          const found = eff.effects.find(f => f && f.id === currentFx.id);
          if (found) currentFx = found;
        }
      }

      const amp = Math.max(0, Number(
        currentFx.amplitude !== undefined ? currentFx.amplitude :
        (currentFx.amp !== undefined ? currentFx.amp :
        (currentFx.params && currentFx.params.amplitude !== undefined ? currentFx.params.amplitude :
        (currentFx.params && currentFx.params.amp !== undefined ? currentFx.params.amp : 1.0)))
      ));
      const freq = Math.max(0.01, Number(currentFx.frequency !== undefined ? currentFx.frequency : (currentFx.params && currentFx.params.frequency !== undefined ? currentFx.params.frequency : 8)));
      const ampX = Math.max(0, Number(currentFx.amplitudeX !== undefined ? currentFx.amplitudeX : (currentFx.params && currentFx.params.amplitudeX !== undefined ? currentFx.params.amplitudeX : 25)));
      const ampY = Math.max(0, Number(currentFx.amplitudeY !== undefined ? currentFx.amplitudeY : (currentFx.params && currentFx.params.amplitudeY !== undefined ? currentFx.params.amplitudeY : 25)));
      const maxRot = Math.max(0, Number(currentFx.rotation !== undefined ? currentFx.rotation : (currentFx.params && currentFx.params.rotation !== undefined ? currentFx.params.rotation : 3)));
      const randomness = Math.max(0, Math.min(100, Number(currentFx.randomness !== undefined ? currentFx.randomness : (currentFx.params && currentFx.params.randomness !== undefined ? currentFx.params.randomness : 80))));
      const seed = Number(currentFx.seed !== undefined ? currentFx.seed : (currentFx.params && currentFx.params.seed !== undefined ? currentFx.params.seed : 1234));

      if (amp <= 0 || (ampX <= 0 && ampY <= 0 && maxRot <= 0)) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const tTotal = sec * freq;
      const randRatio = randomness / 100;

      // 1. Position X noise + harmonic wave
      const noiseX = smoothNoise1D(tTotal, seed * 17.13 + 101.5);
      const waveX = Math.sin(tTotal * Math.PI * 2 * 0.9 + 0.3);
      const mixedX = (1 - randRatio) * waveX + randRatio * noiseX;
      const dx = mixedX * ampX * amp;

      // 2. Position Y noise + harmonic wave
      const noiseY = smoothNoise1D(tTotal, seed * 31.79 + 503.2);
      const waveY = Math.cos(tTotal * Math.PI * 2 * 1.1 + 1.2);
      const mixedY = (1 - randRatio) * waveY + randRatio * noiseY;
      const dy = mixedY * ampY * amp;

      // 3. Rotation noise + harmonic wave
      const noiseRot = smoothNoise1D(tTotal, seed * 47.91 + 919.7);
      const waveRot = Math.sin(tTotal * Math.PI * 2 * 0.7 + 2.5);
      const mixedRot = (1 - randRatio) * waveRot + randRatio * noiseRot;
      const dRotDeg = mixedRot * maxRot * amp;

      const cx = x + w / 2;
      const cy = y + h / 2;

      ctx.save();
      ctx.translate(cx + dx, cy + dy);
      if (Math.abs(dRotDeg) > 0.001) {
        ctx.rotate((dRotDeg * Math.PI) / 180);
      }
      ctx.drawImage(el, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
