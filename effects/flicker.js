(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hash(n) {
    let s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
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
    id: 'flicker',
    name: 'Flicker',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'High-frequency film, neon, CRT, or strobe flicker modulating opacity and exposure',
    params: [
      { id: 'frequency', label: 'Speed / Frequency', type: 'number', min: 1, max: 60, default: 15, unit: 'Hz', step: 1 },
      { id: 'amount', label: 'Intensity', type: 'number', min: 0, max: 100, default: 60, unit: '%', step: 1 },
      { id: 'randomness', label: 'Randomness', type: 'number', min: 0, max: 100, default: 75, unit: '%', step: 1 },
      { id: 'mode', label: 'Flicker Mode', type: 'select', options: ['opacity', 'brightness', 'both'], default: 'opacity' },
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

      const freq = Math.max(0.1, Number(currentFx.frequency !== undefined ? currentFx.frequency : (currentFx.params && currentFx.params.frequency !== undefined ? currentFx.params.frequency : 15)));
      const amount = Math.max(0, Math.min(100, Number(currentFx.amount !== undefined ? currentFx.amount : (currentFx.params && currentFx.params.amount !== undefined ? currentFx.params.amount : 60))));
      const randomness = Math.max(0, Math.min(100, Number(currentFx.randomness !== undefined ? currentFx.randomness : (currentFx.params && currentFx.params.randomness !== undefined ? currentFx.params.randomness : 75))));
      const mode = (currentFx.mode || (currentFx.params && currentFx.params.mode) || 'opacity').toLowerCase();
      const seed = Number(currentFx.seed !== undefined ? currentFx.seed : (currentFx.params && currentFx.params.seed !== undefined ? currentFx.params.seed : 1234));

      if (amount <= 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const tTotal = sec * freq;
      const step = Math.floor(tTotal);
      const frac = tTotal - step;

      // Pseudo-random noise with cubic smoothing across frame sub-steps
      const n0 = hash(step + seed * 133.7);
      const n1 = hash(step + 1 + seed * 133.7);
      const smoothNoise = n0 + (n1 - n0) * (frac * frac * (3 - 2 * frac));

      // Periodic harmonic sine wave
      const periodicVal = 0.5 + 0.5 * Math.sin(tTotal * Math.PI * 2);

      const randFactor = randomness / 100;
      const mixed = (1 - randFactor) * periodicVal + randFactor * smoothNoise;

      // Drop amount below full visibility
      const drop = (amount / 100) * (1 - mixed);

      const prevAlpha = ctx.globalAlpha;
      const prevFilter = ctx.filter;

      try {
        if (mode === 'brightness') {
          const bVal = Math.max(0, Math.round((1 - drop * 0.9) * 100));
          ctx.filter = `brightness(${bVal}%)`;
          ctx.drawImage(el, x, y, w, h);
        } else if (mode === 'both') {
          ctx.globalAlpha = Math.max(0.05, Math.min(1, prevAlpha * (1 - drop * 0.7)));
          const bVal = Math.max(0, Math.round((1 - drop * 0.6) * 100));
          ctx.filter = `brightness(${bVal}%)`;
          ctx.drawImage(el, x, y, w, h);
        } else {
          // Default: opacity
          ctx.globalAlpha = Math.max(0, Math.min(1, prevAlpha * (1 - drop)));
          ctx.drawImage(el, x, y, w, h);
        }
      } catch (_) {
        try { ctx.drawImage(el, x, y, w, h); } catch (e) {}
      } finally {
        ctx.globalAlpha = prevAlpha;
        ctx.filter = prevFilter;
      }
    }
  });
})(typeof window !== 'undefined' ? window : this);
