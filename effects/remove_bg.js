(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let _scratchCanvas = null;
  let _scratchCtx = null;

  function applyMattePostProcess(ctx, targetEl, bounds, fx) {
    const x = bounds.x;
    const y = bounds.y;
    const w = Math.max(1, Math.round(bounds.w));
    const h = Math.max(1, Math.round(bounds.h));

    const feather = Math.max(0, Math.min(40, Number(fx.feather !== undefined ? fx.feather : (fx.params && fx.params.feather !== undefined ? fx.params.feather : 0))));
    const threshold = Number(fx.threshold !== undefined ? fx.threshold : (fx.params && fx.params.threshold !== undefined ? fx.params.threshold : 50));
    const choke = Math.max(-20, Math.min(20, Number(fx.choke !== undefined ? fx.choke : (fx.params && fx.params.choke !== undefined ? fx.params.choke : 0))));

    if (feather <= 0 && threshold === 50 && choke === 0) {
      ctx.drawImage(targetEl, x, y, w, h);
      return;
    }

    if (!_scratchCanvas) {
      _scratchCanvas = document.createElement('canvas');
      _scratchCtx = _scratchCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (_scratchCanvas.width !== w || _scratchCanvas.height !== h) {
      _scratchCanvas.width = w;
      _scratchCanvas.height = h;
    }

    _scratchCtx.clearRect(0, 0, w, h);

    if (feather > 0) {
      _scratchCtx.filter = `blur(${feather}px)`;
      _scratchCtx.drawImage(targetEl, 0, 0, w, h);
      _scratchCtx.filter = 'none';
      _scratchCtx.globalCompositeOperation = 'source-in';
      _scratchCtx.drawImage(targetEl, 0, 0, w, h);
      _scratchCtx.globalCompositeOperation = 'source-over';
    } else {
      _scratchCtx.drawImage(targetEl, 0, 0, w, h);
    }

    if (threshold !== 50 || choke !== 0) {
      try {
        const imgData = _scratchCtx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // Precompute 256-value LUT for ultra fast 60fps real-time pixel pass
        const lut = new Uint8ClampedArray(256);
        const tNorm = Math.max(0.01, Math.min(0.99, threshold / 100));
        const chokeShift = choke * 4;

        for (let a = 0; a < 256; a++) {
          if (a === 0 && choke <= 0) { lut[0] = 0; continue; }
          let aNorm = a / 255;
          if (chokeShift !== 0) {
            aNorm = Math.max(0, Math.min(1, aNorm + (chokeShift / 255)));
          }
          if (threshold !== 50) {
            if (aNorm < tNorm) {
              aNorm = (aNorm / tNorm) * 0.5;
            } else {
              aNorm = 0.5 + ((aNorm - tNorm) / (1 - tNorm)) * 0.5;
            }
          }
          lut[a] = Math.max(0, Math.min(255, Math.round(aNorm * 255)));
        }

        for (let i = 3; i < data.length; i += 4) {
          const a = data[i];
          if (a > 0) {
            data[i] = lut[a];
          }
        }
        _scratchCtx.putImageData(imgData, 0, 0);
      } catch (_) {}
    }

    ctx.drawImage(_scratchCanvas, x, y);
  }

  reg.register({
    id: 'remove_bg',
    name: 'Remove Background (AI)',
    category: 'Artificial Intelligence',
    icon: 'assets/FXPH.svg',
    description: 'AI background removal using Robust Video Matting (RVM) with edge feather and choke controls',
    params: [
      {
        id: 'model',
        label: 'AI Model',
        type: 'select',
        default: 'rvm_mobilenetv3',
        options: [
          { value: 'rvm_mobilenetv3', label: 'Robust Video Matting (RVM)' }
        ]
      },
      {
        id: 'feather',
        label: 'Feather',
        type: 'number',
        min: 0,
        max: 40,
        default: 0,
        unit: 'px',
        step: 1
      },
      {
        id: 'threshold',
        label: 'Threshold',
        type: 'number',
        min: 1,
        max: 99,
        default: 50,
        unit: '%',
        step: 1
      },
      {
        id: 'choke',
        label: 'Choke / Expand',
        type: 'number',
        min: -20,
        max: 20,
        default: 0,
        unit: 'px',
        step: 1
      }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100);
      const h = bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100);

      // Model switch detection: re-render & re-run background removal if model changed
      const currentModel = (fx && fx.model) || 'rvm_mobilenetv3';
      if (layer && layer._lastMattingModel && layer._lastMattingModel !== currentModel) {
        layer._lastMattingModel = currentModel;
        delete layer._bgCutoutBitmap;
        if (window.FishBgRemovalEngine) {
          window.FishBgRemovalEngine.clearLayerCutouts(layer);
          window.FishBgRemovalEngine.processLayer(layer, true);
        }
      } else if (layer && !layer._lastMattingModel) {
        layer._lastMattingModel = currentModel;
      }

      let targetEl = el;

      if (window.FishBgRemovalEngine) {
        if (layer && layer.type === 'video') {
          const pps = window.currentPixelsPerSecond || 80;
          const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
          const effSpeed = layer.speed || 1.0;
          const fps = (window.currentProjectState && window.currentProjectState.fps) || 60;
          const cSec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : (window.currentPlaybackSec || 0);
          const timeInClip = Math.max(0, (layer.sourceOffsetSec || 0) + (cSec - startSec) * effSpeed);
          const fIdx = Math.round(timeInClip * fps);

          const sourceKey = (window.VideoFrameExtractor && window.VideoFrameExtractor._getSourceKey)
            ? window.VideoFrameExtractor._getSourceKey(layer)
            : (layer.mediaId || layer.dataUrl || layer.id);

          const cutoutFrame = window.FishBgRemovalEngine.getVideoCutoutFrame(sourceKey, fIdx);
          if (cutoutFrame) {
            targetEl = cutoutFrame;
          } else {
            window.FishBgRemovalEngine.processLayer(layer);
          }
        } else if (layer) {
          const photoCutout = window.FishBgRemovalEngine.getPhotoCutout(layer);
          if (photoCutout) {
            targetEl = photoCutout;
          } else {
            window.FishBgRemovalEngine.processLayer(layer);
          }
        }
      }

      try {
        if (fx) {
          applyMattePostProcess(ctx, targetEl, { x, y, w, h }, fx);
        } else {
          ctx.drawImage(targetEl, x, y, w, h);
        }
      } catch (_) {
        try { ctx.drawImage(el, x, y, w, h); } catch (e) {}
      }
    }
  });
})(window);
