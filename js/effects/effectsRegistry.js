
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

function applyCustomEffectProcessors(baseCanvas, activeEffects, layerId) {
  if (!baseCanvas || !activeEffects || !activeEffects.length) return baseCanvas;

  const enabledEffects = [];
  let paramSig = '';
  for (let i = 0; i < activeEffects.length; i++) {
    const eff = activeEffects[i];
    if (eff && eff.enabled !== false && EFFECT_PROCESSORS.has(eff.type)) {
      enabledEffects.push(eff);
      paramSig += eff.type + ':';
      if (eff.params) {
        for (const k in eff.params) {
          const v = eff.params[k];
          paramSig += k + '=' + (typeof v === 'number' ? Math.round(v * 100) / 100 : v) + ';';
        }
      }
    }
  }

  if (enabledEffects.length === 0) return baseCanvas;
  const cacheKey = (layerId || 'default') + '|' + (baseCanvas._version || 0) + '|' + baseCanvas.width + 'x' + baseCanvas.height + '|' + paramSig;
  const cached = effectOutputCache.get(layerId || 'default');
  if (cached && cached.key === cacheKey && cached.canvas) {
    return cached.canvas;
  }

  const origW = baseCanvas.width;
  const origH = baseCanvas.height;
  const isScrub = (typeof isScrubbing !== 'undefined' && isScrubbing);
  const maxDim = isScrub ? 256 : ((typeof isLowQuality !== 'undefined' && isLowQuality) ? 320 : 420);

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
    const processor = EFFECT_PROCESSORS.get(eff.type);
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
  if (procW !== origW || procH !== origH) {
    const finalCanvas = getScratchCanvas((layerId || 'G') + '_FINAL', origW, origH);
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'medium';
    finalCtx.clearRect(0, 0, origW, origH);
    finalCtx.drawImage(currentCanvas, 0, 0, origW, origH);
    resultCanvas = finalCanvas;
  }
  effectOutputCache.set(layerId || 'default', {
    key: cacheKey,
    canvas: resultCanvas
  });

  return resultCanvas;
}
registerEffect({
  type: 'copy_background',
  name: 'Copy Background (Adjustment Layer)',
  icon: 'content_copy',
  category: 'style',
  desc: 'Menyalin komposisi seluruh layer di bawahnya untuk dijadikan Adjustment Layer.',
  defaultParams: { opacity: 100 }
}, function(srcCanvas, dstCtx, params, width, height) {
  const alpha = params.opacity !== undefined ? Math.max(0, Math.min(1, params.opacity / 100)) : 1;
  dstCtx.clearRect(0, 0, width, height);
  dstCtx.save();
  dstCtx.globalAlpha = alpha;
  dstCtx.drawImage(srcCanvas, 0, 0, width, height);
  dstCtx.restore();
});

window.FishEffects = {
  registerEffect,
  getEffectDefinition,
  applyCustomEffectProcessors,
  EFFECT_PROCESSORS
};

