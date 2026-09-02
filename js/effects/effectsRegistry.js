
window.FishEffects = window.FishEffects || {};

const EFFECT_PROCESSORS = new Map();
const scratchPool = new Map();

function getScratchCanvas(id, w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  let canvas = scratchPool.get(id);
  if (!canvas) {
    canvas = document.createElement('canvas');
    scratchPool.set(id, canvas);
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return canvas;
}

function registerEffect(effectDef, processorFn) {
  if (!effectDef || !effectDef.type) return;
  if (typeof EFFECTS_CATALOG !== 'undefined') {
    const existingIdx = EFFECTS_CATALOG.findIndex(e => e.type === effectDef.type);
    if (existingIdx >= 0) {
      EFFECTS_CATALOG[existingIdx] = effectDef;
    } else {
      EFFECTS_CATALOG.push(effectDef);
    }
  }

  if (processorFn) {
    EFFECT_PROCESSORS.set(effectDef.type, processorFn);
  }
}

function getEffectDefinition(type) {
  if (typeof EFFECTS_CATALOG === 'undefined') return null;
  return EFFECTS_CATALOG.find(e => e.type === type) || null;
}
const effectOutputCache = new Map();

function normalizeEffectType(type) {
  if (!type) return '';
  const t = String(type).toLowerCase();
  if (t.includes('satvib') || t.includes('vibrance') || t.includes('saturation') || t.includes('saturasi')) return 'satvib';
  if (t.includes('hueshift') || t.includes('hue_saturation') || t.includes('colorize')) return 'hue_saturation';
  if (t.includes('exposure') || t.includes('lift') || t.includes('gamma')) return 'exposure';
  if (t.includes('directionalblur') || t.includes('directional_blur')) return 'directional_blur';
  if (t.includes('boxblur') || t.includes('box_blur')) return 'box_blur';
  if (t.includes('gaussianblur') || t.includes('gaussian_blur') || t === 'blur' || t.includes('fast_blur')) return 'gaussian_blur';
  if (t.includes('unsharp')) return 'unsharpmask';
  if (t.includes('sharpen')) return 'sharpen';
  if (t.includes('lightglow') || t.includes('glow')) return 'lightglow';
  if (t.includes('transform')) return 'raster_transform';
  if (t.includes('rgbsplit') || t.includes('rgb_split')) return 'rgb_split';
  if (t.includes('pinch')) return 'pinch_bulge';
  if (t.includes('wipe')) return 'wipe';
  if (t.includes('gradient')) return 'gradient_overlay';
  if (t.includes('vignette')) return 'vignette';
  return type;
}

function getEffectProcessor(type) {
  if (!type) return null;
  if (EFFECT_PROCESSORS.has(type)) return EFFECT_PROCESSORS.get(type);
  const norm = normalizeEffectType(type);
  if (EFFECT_PROCESSORS.has(norm)) return EFFECT_PROCESSORS.get(norm);
  return null;
}

function applyCustomEffectProcessors(baseCanvas, activeEffects, layerId) {
  if (!baseCanvas || !activeEffects || !activeEffects.length) return baseCanvas;

  const enabledEffects = [];
  let paramSig = '';
  for (let i = 0; i < activeEffects.length; i++) {
    const eff = activeEffects[i];
    const proc = getEffectProcessor(eff ? eff.type : '');
    if (eff && eff.enabled !== false && proc) {
      enabledEffects.push({ ...eff, _proc: proc });
      paramSig += (eff.type || '') + ':';
      if (eff.params) {
        for (const k in eff.params) {
          const v = eff.params[k];
          paramSig += k + '=' + (typeof v === 'number' ? Math.round(v * 100) / 100 : v) + ';';
        }
      }
    }
  }

  if (enabledEffects.length === 0) return baseCanvas;
  const hasCopyBg = enabledEffects.some(e => e.type === 'copy_background' || e.type === 'copybackground');
  const cacheKey = (layerId || 'default') + '|' + (baseCanvas._version || 0) + '|' + baseCanvas.width + 'x' + baseCanvas.height + '|' + paramSig;
  if (!hasCopyBg) {
    const cached = effectOutputCache.get(layerId || 'default');
    if (cached && cached.key === cacheKey && cached.canvas) {
      return cached.canvas;
    }
  }

  const origW = baseCanvas.width;
  const origH = baseCanvas.height;
  const isScrub = (typeof isScrubbing !== 'undefined' && isScrubbing);
  const maxDim = isScrub ? 480 : 1280;

  let procW = origW;
  let procH = origH;
  const maxOrig = Math.max(origW, origH);
  if (maxOrig > maxDim) {
    const scale = maxDim / maxOrig;
    procW = Math.max(64, Math.round(origW * scale));
    procH = Math.max(64, Math.round(origH * scale));
  }

  let currentCanvas;
  if (procW !== origW || procH !== origH) {
    currentCanvas = getScratchCanvas((layerId || 'G') + '_DOWN', procW, procH);
    const downCtx = currentCanvas.getContext('2d');
    downCtx.imageSmoothingEnabled = true;
    downCtx.imageSmoothingQuality = 'medium';
    downCtx.clearRect(0, 0, procW, procH);
    downCtx.drawImage(baseCanvas, 0, 0, procW, procH);
  } else {
    currentCanvas = baseCanvas;
  }

  let bufferToggle = false;

  for (let i = 0; i < enabledEffects.length; i++) {
    const eff = enabledEffects[i];
    const processor = eff._proc || getEffectProcessor(eff.type);
    if (typeof processor === 'function') {
      const outputCanvas = getScratchCanvas((layerId || 'G') + (bufferToggle ? '_A' : '_B'), procW, procH);
      if (!outputCanvas) continue;
      const outCtx = outputCanvas.getContext('2d');
      try {
        processor(currentCanvas, outCtx, eff.params || {}, procW, procH);
        currentCanvas = outputCanvas;
        bufferToggle = !bufferToggle;
      } catch (err) {
        console.warn('Effect processing error on:', eff.type, err);
      }
    }
  }

  let resultCanvas = currentCanvas;
  if (procW !== origW || procH !== origH || currentCanvas !== baseCanvas) {
    const finalCanvas = getScratchCanvas((layerId || 'G') + '_FINAL', origW, origH);
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'medium';
    finalCtx.clearRect(0, 0, origW, origH);
    finalCtx.drawImage(currentCanvas, 0, 0, origW, origH);
    resultCanvas = finalCanvas;
  }
  if (!hasCopyBg) {
    effectOutputCache.set(layerId || 'default', {
      key: cacheKey,
      canvas: resultCanvas
    });
  }

  return resultCanvas;
}

window.FishEffects = {
  registerEffect,
  getEffectDefinition,
  applyCustomEffectProcessors,
  EFFECT_PROCESSORS
};

