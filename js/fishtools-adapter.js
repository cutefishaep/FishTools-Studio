/**
 * OpenFishTools Web App Bridge & Runtime Adapter
 * Fetches original tools/OpenFishTools/client/index.html dynamically and:
 * - Converts all asset/script URLs to absolute paths (/tools/OpenFishTools/client/...)
 * - Completely removes unused components/scripts (Controller, Graph, TTS, BeatMaker, AutoSave, AeToAm, ProjectPool, Debug, Updater)
 * - Injects Adobe CEP & CSInterface web mocks with localStorage persistence
 * - Updates System Status info (System Time: local real-time, Ext: Latest, AE: Web App, OS: Browser)
 * 
 * ZERO modifications to tools/OpenFishTools/ source repository files.
 */

/**
 * FishTools Bridge for OpenFishTools Web App Integration
 * Handles Anchor Point (grid & center in comp), Cut (front, mid, back), and Align (left, center, right, top, bottom)
 */
window.FishToolsBridge = (function () {
  function getResolutionDims() {
    const pState = window.currentProjectState;
    const res = (pState && (pState.resolution || (pState.settings && pState.settings.resolution))) || '1080p';
    const aspect = (pState && (pState.aspectRatio || (pState.settings && pState.settings.aspectRatio))) || '16:9';
    const rMap = (typeof window !== 'undefined' && window.resMap) || {
      '4K':   { '16:9': [3840, 2160], '9:16': [2160, 3840], '1:1': [2160, 2160], '4:3': [2880, 2160], '21:9': [5120, 2160] },
      '2K':   { '16:9': [2560, 1440], '9:16': [1440, 2560], '1:1': [1440, 1440], '4:3': [1920, 1440], '21:9': [3440, 1440] },
      '1080p':{ '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '21:9': [2560, 1080] },
      '720p': { '16:9': [1280, 720],  '9:16': [720, 1280],  '1:1': [720, 720],   '4:3': [960, 720],   '21:9': [1680, 720] },
      '480p': { '16:9': [854, 480],   '9:16': [480, 854],   '1:1': [480, 480],   '4:3': [640, 480],   '21:9': [1120, 480] }
    };
    if (rMap[res] && rMap[res][aspect]) return rMap[res][aspect];
    const resKey = Object.keys(rMap).find(k => k.toLowerCase() === String(res).toLowerCase()) || '1080p';
    if (rMap[resKey] && rMap[resKey][aspect]) return rMap[resKey][aspect];
    return [1920, 1080];
  }

  function getSelectedLayers() {
    const pState = window.currentProjectState;
    if (!pState || !Array.isArray(pState.layers) || pState.layers.length === 0) return [];

    const ids = new Set();
    if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
      window.selectedLayerIds.forEach(id => ids.add(id));
    }
    if (window.selectedLayerId) {
      ids.add(window.selectedLayerId);
    }

    let selected = pState.layers.filter(l => ids.has(l.id));

    // Smart fallback if layer selection is empty
    if (selected.length === 0) {
      if (pState.layers.length === 1) {
        // Only one layer exists in project: auto-target it!
        const single = pState.layers[0];
        if (typeof window.selectTimelineLayer === 'function') {
          window.selectTimelineLayer(single.id, false);
        } else {
          window.selectedLayerId = single.id;
        }
        selected = [single];
      } else if (window.lastSelectedLayerId) {
        // Restore last selected layer if still exists
        const lastLayer = pState.layers.find(l => l.id === window.lastSelectedLayerId);
        if (lastLayer) {
          if (typeof window.selectTimelineLayer === 'function') {
            window.selectTimelineLayer(lastLayer.id, false);
          } else {
            window.selectedLayerId = lastLayer.id;
          }
          selected = [lastLayer];
        }
      } else {
        // Auto-target first visible layer so tool does not silently fail
        const fallback = pState.layers.find(l => !l.hidden) || pState.layers[0];
        if (fallback) {
          if (typeof window.selectTimelineLayer === 'function') {
            window.selectTimelineLayer(fallback.id, false);
          } else {
            window.selectedLayerId = fallback.id;
          }
          selected = [fallback];
        }
      }
    }

    return selected;
  }

  function getLayerDimensions(layer, baseW, baseH) {
    if (!layer) return { w: 100, h: 100 };
    if (layer.scaleW !== undefined && layer.scaleH !== undefined) {
      return { w: Math.abs(layer.scaleW) || 100, h: Math.abs(layer.scaleH) || 100 };
    }
    if (layer.mediaWidth && layer.mediaHeight) {
      return { w: layer.mediaWidth, h: layer.mediaHeight };
    }
    if (layer.widthPx && layer.heightPx) {
      return { w: layer.widthPx, h: layer.heightPx };
    }
    const w = Math.abs(layer.normW !== undefined ? layer.normW * baseW : 0.2 * baseW);
    const h = Math.abs(layer.normH !== undefined ? layer.normH * baseH : 0.2 * baseH);
    return { w: w || 100, h: h || 100 };
  }

  function commitChanges(reason) {
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition(reason);
    if (typeof window.syncTransformControllerValues === 'function') window.syncTransformControllerValues();
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
  }

  function setAnchorPoint(pos) {
    const selected = getSelectedLayers();
    if (selected.length === 0) {
      return JSON.stringify({
        error: true,
        tool: 'Anchor Point',
        type: 'warn',
        message: 'Please select at least one layer to set the anchor point.'
      });
    }

    const posNum = parseInt(pos, 10) || 5;
    const col = (posNum - 1) % 3;
    const row = Math.floor((posNum - 1) / 3);

    const [baseW, baseH] = getResolutionDims();

    selected.forEach(layer => {
      const dims = getLayerDimensions(layer, baseW, baseH);
      const curScaleW = layer.scaleW !== undefined ? layer.scaleW : dims.w;
      const curScaleH = layer.scaleH !== undefined ? layer.scaleH : dims.h;

      const targetAx = (col === 0 ? -curScaleW / 2 : (col === 1 ? 0 : curScaleW / 2));
      const targetAy = (row === 0 ? -curScaleH / 2 : (row === 1 ? 0 : curScaleH / 2));

      const oldAx = layer.anchorX || 0;
      const oldAy = layer.anchorY || 0;
      const curPosX = layer.posX !== undefined ? layer.posX : (baseW / 2);
      const curPosY = layer.posY !== undefined ? layer.posY : (baseH / 2);

      const rotZ = layer.rotZ || layer.rotation || 0;
      const rad = (rotZ * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      // Exact pan-behind compensation to keep screen coordinates invariant
      const newPosX = curPosX + (oldAx - targetAx) * (1 - cos) + (oldAy - targetAy) * sin;
      const newPosY = curPosY + (targetAx - oldAx) * sin + (oldAy - targetAy) * (1 - cos);

      layer.anchorX = Number(targetAx.toFixed(2));
      layer.anchorY = Number(targetAy.toFixed(2));
      layer.posX = Number(newPosX.toFixed(2));
      layer.posY = Number(newPosY.toFixed(2));
      layer.normX = (layer.posX - curScaleW / 2) / baseW;
      layer.normY = (layer.posY - curScaleH / 2) / baseH;

      if (typeof window.recordLayerPropertyChange === 'function') {
        window.recordLayerPropertyChange(layer, 'transform');
      }
      if (typeof window.invalidatePreviewCacheForLayer === 'function') {
        window.invalidatePreviewCacheForLayer(layer);
      }
    });

    commitChanges('setAnchorPoint');
    return 'true';
  }

  function centerInComp() {
    const selected = getSelectedLayers();
    if (selected.length === 0) {
      return JSON.stringify({
        error: true,
        tool: 'Center In Comp',
        type: 'warn',
        message: 'Please select at least one layer to center.'
      });
    }

    const [baseW, baseH] = getResolutionDims();
    const engine = (typeof window !== 'undefined' && (window.FishToolEngine || window.LayerTransform));

    selected.forEach(layer => {
      const dims = getLayerDimensions(layer, baseW, baseH);
      const curScaleW = layer.scaleW !== undefined ? layer.scaleW : dims.w;
      const curScaleH = layer.scaleH !== undefined ? layer.scaleH : dims.h;

      if (layer.posX === undefined) layer.posX = baseW / 2;
      if (layer.posY === undefined) layer.posY = baseH / 2;

      let curCenterX, curCenterY;
      if (engine && typeof engine.getBounds === 'function') {
        const animLayer = Object.assign({}, layer, {
          scaleW: curScaleW,
          scaleH: curScaleH
        });
        const bounds = engine.getBounds(animLayer, 1);
        const curLeft = bounds.x;
        const curRight = bounds.x + (bounds.aabbW !== undefined ? bounds.aabbW : bounds.w);
        const curTop = bounds.y;
        const curBottom = bounds.y + (bounds.aabbH !== undefined ? bounds.aabbH : bounds.h);
        curCenterX = (curLeft + curRight) / 2;
        curCenterY = (curTop + curBottom) / 2;
      } else {
        curCenterX = layer.posX;
        curCenterY = layer.posY;
      }

      const deltaX = (baseW / 2) - curCenterX;
      const deltaY = (baseH / 2) - curCenterY;

      layer.posX = Number((layer.posX + deltaX).toFixed(2));
      layer.posY = Number((layer.posY + deltaY).toFixed(2));

      layer.normX = (layer.posX - curScaleW / 2) / baseW;
      layer.normY = (layer.posY - curScaleH / 2) / baseH;

      if (typeof window.recordLayerPropertyChange === 'function') {
        window.recordLayerPropertyChange(layer, 'transform');
      }
      if (typeof window.invalidatePreviewCacheForLayer === 'function') {
        window.invalidatePreviewCacheForLayer(layer);
      }
    });

    commitChanges('centerInComp');
    return 'true';
  }

  function alignLayers(type) {
    const selected = getSelectedLayers();
    if (selected.length === 0) {
      return JSON.stringify({
        error: true,
        tool: 'Align',
        type: 'warn',
        message: 'Please select at least one layer to align.'
      });
    }

    const [baseW, baseH] = getResolutionDims();
    const engine = (typeof window !== 'undefined' && (window.FishToolEngine || window.LayerTransform));

    selected.forEach(layer => {
      const dims = getLayerDimensions(layer, baseW, baseH);
      const curScaleW = layer.scaleW !== undefined ? layer.scaleW : dims.w;
      const curScaleH = layer.scaleH !== undefined ? layer.scaleH : dims.h;

      if (layer.posX === undefined) layer.posX = baseW / 2;
      if (layer.posY === undefined) layer.posY = baseH / 2;

      let curLeft, curRight, curTop, curBottom, curCenterX, curCenterY;

      if (engine && typeof engine.getBounds === 'function') {
        const animLayer = Object.assign({}, layer, {
          scaleW: curScaleW,
          scaleH: curScaleH
        });
        const bounds = engine.getBounds(animLayer, 1);
        curLeft = bounds.x;
        curRight = bounds.x + (bounds.aabbW !== undefined ? bounds.aabbW : bounds.w);
        curTop = bounds.y;
        curBottom = bounds.y + (bounds.aabbH !== undefined ? bounds.aabbH : bounds.h);
        curCenterX = (curLeft + curRight) / 2;
        curCenterY = (curTop + curBottom) / 2;
      } else {
        const halfW = curScaleW / 2;
        const halfH = curScaleH / 2;
        curCenterX = layer.posX;
        curCenterY = layer.posY;
        curLeft = curCenterX - halfW;
        curRight = curCenterX + halfW;
        curTop = curCenterY - halfH;
        curBottom = curCenterY + halfH;
      }

      let deltaX = 0;
      let deltaY = 0;

      if (type === 'LEFT') deltaX = 0 - curLeft;
      else if (type === 'HCENTER') deltaX = (baseW / 2) - curCenterX;
      else if (type === 'RIGHT') deltaX = baseW - curRight;
      else if (type === 'TOP') deltaY = 0 - curTop;
      else if (type === 'VCENTER') deltaY = (baseH / 2) - curCenterY;
      else if (type === 'BOTTOM') deltaY = baseH - curBottom;

      layer.posX = Number((layer.posX + deltaX).toFixed(2));
      layer.posY = Number((layer.posY + deltaY).toFixed(2));

      layer.normX = (layer.posX - curScaleW / 2) / baseW;
      layer.normY = (layer.posY - curScaleH / 2) / baseH;

      if (typeof window.recordLayerPropertyChange === 'function') {
        window.recordLayerPropertyChange(layer, 'transform');
      }
      if (typeof window.invalidatePreviewCacheForLayer === 'function') {
        window.invalidatePreviewCacheForLayer(layer);
      }
    });

    commitChanges('align_' + type);
    return 'true';
  }

  function cutLayers(type) {
    const selected = getSelectedLayers();
    if (selected.length === 0) {
      return JSON.stringify({
        error: true,
        tool: 'Cut',
        type: 'warn',
        message: 'Please select at least one layer to cut.'
      });
    }

    const pps = window.currentPixelsPerSecond || 80;
    const currentPanX = window.timelinePanX !== undefined ? window.timelinePanX : (window.panX || 0);
    const currentSec = Math.max(0, Math.abs(currentPanX) / pps);
    const minDuration = 16 / pps;

    let anyModified = false;
    const newlyCreatedIds = [];

    selected.forEach(layer => {
      const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
      const endSec = startSec + durSec;

      if (type === 'FRONT') {
        if (currentSec <= startSec + minDuration || currentSec >= endSec) return;
        const trimmedSec = currentSec - startSec;
        const remainingDurSec = endSec - currentSec;

        if (typeof window.invalidatePreviewCacheForLayer === 'function') {
          window.invalidatePreviewCacheForLayer(layer, startSec, endSec);
        }

        layer.startSec = currentSec;
        layer.durationSec = remainingDurSec;
        layer.startPx = Math.round(currentSec * pps);
        layer.widthPx = Math.round(remainingDurSec * pps);
        layer.sourceOffsetSec = (layer.sourceOffsetSec || 0) + trimmedSec;
        layer.isDurationExplicit = true;
        layer._cachedStartSec = currentSec;
        layer._cachedEndSec = endSec;
        anyModified = true;

      } else if (type === 'BACK') {
        if (currentSec <= startSec || currentSec >= endSec - minDuration) return;
        const remainingDurSec = currentSec - startSec;

        if (typeof window.invalidatePreviewCacheForLayer === 'function') {
          window.invalidatePreviewCacheForLayer(layer, startSec, endSec);
        }

        layer.durationSec = remainingDurSec;
        layer.widthPx = Math.round(remainingDurSec * pps);
        layer.isDurationExplicit = true;
        layer._cachedStartSec = startSec;
        layer._cachedEndSec = currentSec;
        anyModified = true;

      } else if (type === 'MID') {
        if (currentSec <= startSec + minDuration || currentSec >= endSec - minDuration) return;
        const leftDurSec = currentSec - startSec;
        const rightDurSec = endSec - currentSec;
        const leftWidthPx = Math.round(leftDurSec * pps);
        const rightWidthPx = Math.round(rightDurSec * pps);

        if (typeof window.invalidatePreviewCacheForLayer === 'function') {
          window.invalidatePreviewCacheForLayer(layer, startSec, endSec);
        }

        const newLayerId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        let clonedLayer = {};
        try {
          clonedLayer = JSON.parse(JSON.stringify(layer));
        } catch (_) {
          clonedLayer = Object.assign({}, layer);
        }

        const newLayer = {
          ...clonedLayer,
          id: newLayerId,
          startPx: Math.round(currentSec * pps),
          widthPx: rightWidthPx,
          startSec: currentSec,
          durationSec: rightDurSec,
          sourceOffsetSec: (layer.sourceOffsetSec || 0) + leftDurSec,
          mediaDuration: layer.mediaDuration || (typeof window.getLayerMediaDuration === 'function' ? window.getLayerMediaDuration(layer) : null) || null,
          isDurationExplicit: true,
          _cachedStartSec: currentSec,
          _cachedEndSec: endSec
        };

        layer.widthPx = leftWidthPx;
        layer.durationSec = leftDurSec;
        layer.isDurationExplicit = true;
        layer._cachedStartSec = startSec;
        layer._cachedEndSec = currentSec;

        const layerIdx = window.currentProjectState.layers.findIndex(l => l.id === layer.id);
        if (layerIdx !== -1) {
          window.currentProjectState.layers.splice(layerIdx, 0, newLayer);
        } else {
          window.currentProjectState.layers.unshift(newLayer);
        }

        newlyCreatedIds.push(newLayerId);
        anyModified = true;
      }
    });

    if (anyModified) {
      commitChanges('cut_' + type);
      if (newlyCreatedIds.length > 0) {
        if (newlyCreatedIds.length === 1 && typeof window.selectTimelineLayer === 'function') {
          window.selectTimelineLayer(newlyCreatedIds[0], false);
        } else if (window.selectedLayerIds) {
          window.selectedLayerIds.clear();
          newlyCreatedIds.forEach(id => window.selectedLayerIds.add(id));
          window.selectedLayerId = newlyCreatedIds[0];
          if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
        }
      }
    }

    return 'true';
  }

  function executeTool(toolName, ...args) {
    const directExec = (typeof window.executeFishTool === 'function')
      ? window.executeFishTool
      : (window.parent && typeof window.parent.executeFishTool === 'function' ? window.parent.executeFishTool : null);
    if (directExec) {
      const res = directExec(toolName, ...args);
      if (res !== undefined) return res;
    }

    if (toolName === 'setAnchorPoint') {
      return setAnchorPoint(args[0]);
    }
    if (toolName === 'CENTERINCOMP') {
      return centerInComp();
    }
    if (toolName === 'CUT_FRONT') {
      return cutLayers('FRONT');
    }
    if (toolName === 'CUT_MID') {
      return cutLayers('MID');
    }
    if (toolName === 'CUT_BACK') {
      return cutLayers('BACK');
    }
    if (typeof toolName === 'string' && toolName.indexOf('ALIGN_') === 0) {
      const alignType = toolName.replace('ALIGN_', '');
      return alignLayers(alignType);
    }
    if (toolName === 'PRECOMP' || toolName === 'PRECOMPOSE') {
      if (typeof window.precomposeSelectedLayers === 'function') {
        window.precomposeSelectedLayers(false);
      }
      return 'true';
    }
    if (toolName === 'PRECOMP_AUTOCROP') {
      if (typeof window.precomposeSelectedLayers === 'function') {
        window.precomposeSelectedLayers(true);
      }
      return 'true';
    }
    if (toolName === 'OVERLAP') {
      if (typeof window.applyKeyframeOverlap === 'function') {
        return window.applyKeyframeOverlap();
      }
      return 'true';
    }
    if (toolName === 'DUP') {
      const newName = args[0];
      if (typeof window.duplicatePrecompLayer === 'function') {
        return window.duplicatePrecompLayer(newName);
      }
      return 'true';
    }
    if (toolName === 'changeCompRatio') {
      const w = args[0];
      const h = args[1];
      if (typeof window.changeCompositionRatio === 'function') {
        return window.changeCompositionRatio(w, h);
      }
      return 'true';
    }
    if (toolName === 'changeCompFPS') {
      const fps = args[0];
      if (typeof window.changeCompositionFPS === 'function') {
        return window.changeCompositionFPS(fps);
      }
      return 'true';
    }
    if (toolName === 'CUBE' || (typeof toolName === 'string' && toolName.indexOf('GEN_3D') === 0)) {
      if (typeof window.executeFishTool === 'function') {
        return window.executeFishTool(toolName, ...args);
      }
    }
    // --- Toolbox & Layer Helpers ---
    function mirrorLayers(alter = false) {
      const selected = getSelectedLayers();
      if (selected.length === 0) {
        return JSON.stringify({
          error: true,
          tool: 'Mirror',
          type: 'warn',
          message: 'Please select at least one layer to mirror.'
        });
      }
      const [baseW, baseH] = getResolutionDims();
      selected.forEach(layer => {
        const dims = getLayerDimensions(layer, baseW, baseH);
        if (layer.scaleW === undefined) layer.scaleW = dims.w;
        if (layer.scaleH === undefined) layer.scaleH = dims.h;
        if (alter) {
          layer.scaleH = -layer.scaleH;
        } else {
          layer.scaleW = -layer.scaleW;
        }
        if (typeof window.recordLayerPropertyChange === 'function') {
          window.recordLayerPropertyChange(layer, 'transform');
        }
        if (typeof window.invalidatePreviewCacheForLayer === 'function') {
          window.invalidatePreviewCacheForLayer(layer);
        }
      });
      commitChanges('mirror');
      return 'true';
    }

    function applyEffectSafely(effectId) {
      const selected = getSelectedLayers();
      if (selected.length === 0) {
        return JSON.stringify({
          error: true,
          tool: effectId,
          type: 'warn',
          message: 'Please select at least one layer.'
        });
      }
      if (typeof window.applyEffectToSelectedLayers === 'function') {
        window.applyEffectToSelectedLayers(effectId);
      }
      return 'true';
    }

    function getActiveBeatMarkers(layer) {
      const pps = window.currentPixelsPerSecond || 80;
      const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
      const clipEnd = clipStart + clipDur;

      let markers = [];
      if (Array.isArray(layer.markers) && layer.markers.length > 0) {
        markers = layer.markers.map(m => (typeof m === 'number' ? m : (m.time || 0)));
      }
      const pState = window.currentProjectState;
      if (pState && Array.isArray(pState.beatmarks) && pState.beatmarks.length > 0) {
        const inRange = pState.beatmarks.filter(b => b >= clipStart - 0.02 && b <= clipEnd + 0.02);
        markers = markers.concat(inRange);
      }

      let unique = Array.from(new Set(markers.map(m => Number(m.toFixed(3))))).sort((a, b) => a - b);
      unique = unique.filter(t => t >= clipStart - 0.02 && t <= clipEnd + 0.02);

      if (unique.length < 2) {
        unique = [];
        const step = 0.6;
        for (let t = clipStart; t <= clipEnd - 0.05; t += step) {
          unique.push(Number(t.toFixed(3)));
        }
        if (unique.length < 2) {
          unique = [Number(clipStart.toFixed(3)), Number(((clipStart + clipEnd) / 2).toFixed(3)), Number(clipEnd.toFixed(3))];
        }
      }
      return unique;
    }

    // --- Velocity Card Helpers (AMV Beat Curves + Optical Flow) ---
    function applyTwixtorVelocity() {
      const selected = getSelectedLayers();
      if (selected.length === 0) {
        return JSON.stringify({
          error: true,
          tool: 'Twixtor',
          type: 'warn',
          message: 'Please select at least one layer to apply Twixtor velocity.'
        });
      }

      const pps = window.currentPixelsPerSecond || 80;
      selected.forEach(layer => {
        layer.speedMode = 'speed';
        layer.speedInterpolation = 'optical_flow';
        layer.speed = 1.0;

        const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
        const clipEnd = clipStart + clipDur;
        const markers = getActiveBeatMarkers(layer);

        if (!layer.keyframes) layer.keyframes = {};
        const kfs = [];

        if (markers[0] > clipStart + 0.05) {
          kfs.push({
            time: Number(clipStart.toFixed(3)),
            value: { speed: 1.0 },
            easing: [0.42, 0.0, 0.58, 1.0]
          });
        }

        for (let i = 0; i < markers.length; i++) {
          const t = markers[i];
          kfs.push({
            time: Number(t.toFixed(3)),
            value: { speed: 1.0 },
            easing: [0.42, 0.0, 0.58, 1.0]
          });
          if (i < markers.length - 1) {
            const nextT = markers[i + 1];
            const midT = (t + nextT) / 2;
            kfs.push({
              time: Number(midT.toFixed(3)),
              value: { speed: 0.2 },
              easing: [0.42, 0.0, 0.58, 1.0]
            });
          }
        }

        if (markers[markers.length - 1] < clipEnd - 0.05) {
          kfs.push({
            time: Number(clipEnd.toFixed(3)),
            value: { speed: 1.0 },
            easing: [0.42, 0.0, 0.58, 1.0]
          });
        }

        kfs.sort((a, b) => a.time - b.time);
        layer.keyframes.speed = kfs;

        if (typeof window.invalidatePreviewCacheForLayer === 'function') {
          window.invalidatePreviewCacheForLayer(layer);
        }
      });

      window.activeKeyframeProperty = 'speed';
      if (typeof window.syncSpeedControllerValues === 'function') window.syncSpeedControllerValues();
      if (typeof window.updateSpeedKeyframeBtnState === 'function') window.updateSpeedKeyframeBtnState();
      commitChanges('velocity_twixtor');
      return 'true';
    }

    function applyTimeRemapVelocity() {
      const selected = getSelectedLayers();
      if (selected.length === 0) {
        return JSON.stringify({
          error: true,
          tool: 'Time Remap',
          type: 'warn',
          message: 'Please select at least one layer to apply Time Remap velocity.'
        });
      }

      const pps = window.currentPixelsPerSecond || 80;
      selected.forEach(layer => {
        layer.speedMode = 'time_remap';
        layer.speedInterpolation = 'optical_flow';

        const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
        const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
        const clipEnd = clipStart + clipDur;
        const srcOffset = layer.sourceOffsetSec || 0;
        const markers = getActiveBeatMarkers(layer);

        if (!layer.keyframes) layer.keyframes = {};
        const kfs = [];

        // Classic AMV S-Curve easing: fast on beat impact, smooth slow-mo in midpoint, fast accelerating into next beat
        const S_CURVE_EASE = [0.20, 0.70, 0.80, 0.30];

        if (markers[0] > clipStart + 0.05) {
          kfs.push({
            time: Number(clipStart.toFixed(3)),
            value: { timeRemap: Number(srcOffset.toFixed(3)) },
            easing: [...S_CURVE_EASE]
          });
        }

        for (let i = 0; i < markers.length; i++) {
          const t = markers[i];
          const sourceTime = srcOffset + (t - clipStart);
          kfs.push({
            time: Number(t.toFixed(3)),
            value: { timeRemap: Number(sourceTime.toFixed(3)) },
            easing: [...S_CURVE_EASE]
          });
        }

        if (markers[markers.length - 1] < clipEnd - 0.05) {
          kfs.push({
            time: Number(clipEnd.toFixed(3)),
            value: { timeRemap: Number((srcOffset + clipDur).toFixed(3)) },
            easing: [...S_CURVE_EASE]
          });
        }

        kfs.sort((a, b) => a.time - b.time);
        layer.keyframes.timeRemap = kfs;
        layer.timeRemap = srcOffset;

        if (typeof window.invalidatePreviewCacheForLayer === 'function') {
          window.invalidatePreviewCacheForLayer(layer);
        }
      });

      window.activeKeyframeProperty = 'timeRemap';
      if (typeof window.syncSpeedControllerValues === 'function') window.syncSpeedControllerValues();
      if (typeof window.updateSpeedKeyframeBtnState === 'function') window.updateSpeedKeyframeBtnState();
      commitChanges('velocity_timeremap');
      return 'true';
    }

    // --- Beat Effects Helpers ---
    function applyBeatKeyframes(type) {
      const fnNull = (typeof window.applyBeatNullTool === 'function')
        ? window.applyBeatNullTool
        : (window.parent && typeof window.parent.applyBeatNullTool === 'function' ? window.parent.applyBeatNullTool : null);
      if (typeof fnNull === 'function' && (type === 'OSCILLATE' || type === 'SWING' || type === 'Y_BEAT' || type === 'Y_FLIP' || type === 'X_BEAT' || type === 'X_FLIP' || type === 'SCALE_BEAT' || type === 'SCALE_OVERLAP')) {
        return fnNull(type);
      }
      const fnExec = (typeof window.executeFishTool === 'function')
        ? window.executeFishTool
        : (window.parent && typeof window.parent.executeFishTool === 'function' ? window.parent.executeFishTool : null);
      if (typeof fnExec === 'function' && (type === 'OSCILLATE' || type === 'SWING' || type === 'Y_BEAT' || type === 'Y_FLIP' || type === 'X_BEAT' || type === 'X_FLIP' || type === 'SCALE_BEAT' || type === 'SCALE_OVERLAP')) {
        return fnExec(type);
      }
      if (type === 'EXPO' || type === 'FLASH') {
        const fn = (typeof window.applyBeatFlashEffect === 'function')
          ? window.applyBeatFlashEffect
          : (window.parent && typeof window.parent.applyBeatFlashEffect === 'function' ? window.parent.applyBeatFlashEffect : null);
        if (typeof fn === 'function') {
          return fn();
        }
      }
      if (type === 'LENS') {
        const fn = (typeof window.applyBeatBlurEffect === 'function')
          ? window.applyBeatBlurEffect
          : (window.parent && typeof window.parent.applyBeatBlurEffect === 'function' ? window.parent.applyBeatBlurEffect : null);
        if (typeof fn === 'function') {
          return fn(false);
        }
      }

      const selected = getSelectedLayers();
      if (selected.length === 0) {
        return JSON.stringify({
          error: true,
          tool: type,
          type: 'warn',
          message: 'Please select at least one layer.'
        });
      }

      return JSON.stringify({
        error: true,
        tool: type,
        type: 'warn',
        message: 'Beat Null Rig controller not loaded.'
      });
    }

    function applyPanningKeyframes(type) {
      const fnNull = (typeof window.applyBeatNullTool === 'function')
        ? window.applyBeatNullTool
        : (window.parent && typeof window.parent.applyBeatNullTool === 'function' ? window.parent.applyBeatNullTool : null);
      if (typeof fnNull === 'function') {
        return fnNull(type === 'PANNING' ? 'PANNING_MIX_ALL' : type);
      }
      const fnExec = (typeof window.executeFishTool === 'function')
        ? window.executeFishTool
        : (window.parent && typeof window.parent.executeFishTool === 'function' ? window.parent.executeFishTool : null);
      if (typeof fnExec === 'function') {
        return fnExec(type === 'PANNING' ? 'PANNING_MIX_ALL' : type);
      }

      const selected = getSelectedLayers();
      if (selected.length === 0) {
        return JSON.stringify({
          error: true,
          tool: type,
          type: 'warn',
          message: 'Please select at least one layer.'
        });
      }

      return JSON.stringify({
        error: true,
        tool: type,
        type: 'warn',
        message: 'Panning Null Rig controller not loaded.'
      });
    }

    // --- Toolbox: Layers ---
    if (toolName === 'FRZ') {
      if (typeof window.freezeFrameAtCurrentTime === 'function') {
        window.freezeFrameAtCurrentTime();
      }
      return 'true';
    }
    if (toolName === 'FIT') {
      const selected = getSelectedLayers();
      if (selected.length > 0) {
        const [baseW, baseH] = getResolutionDims();
        selected.forEach(layer => {
          layer.posX = Math.round(baseW / 2);
          layer.posY = Math.round(baseH / 2);
          layer.scaleW = baseW;
          layer.scaleH = baseH;
          layer.normX = 0;
          layer.normY = 0;
          layer.normW = 1;
          layer.normH = 1;
          if (typeof window.recordLayerPropertyChange === 'function') {
            window.recordLayerPropertyChange(layer, 'transform');
          }
          if (typeof window.invalidatePreviewCacheForLayer === 'function') {
            window.invalidatePreviewCacheForLayer(layer);
          }
        });
        commitChanges('fit');
      }
      return 'true';
    }
    if (toolName === 'DSH') {
      return applyEffectSafely('drop-shadow');
    }
    if (toolName === 'MIR') {
      return mirrorLayers(args[0] === true);
    }

    // --- Toolbox: Create ---
    if (toolName === 'SHA') {
      if (typeof window.addShapeLayer === 'function') {
        window.addShapeLayer('rectangle');
      }
      return 'true';
    }
    if (toolName === 'SOL') {
      if (typeof window.addSolidLayer === 'function') {
        window.addSolidLayer();
      } else if (typeof window.addShapeLayer === 'function') {
        window.addShapeLayer('rectangle');
      }
      return 'true';
    }
    if (toolName === 'CAM') {
      if (typeof window.addCameraLayer === 'function') {
        window.addCameraLayer();
      }
      return 'true';
    }
    if (toolName === 'NUL') {
      if (typeof window.addNullLayer === 'function') {
        window.addNullLayer();
      }
      return 'true';
    }
    if (toolName === 'ADJ') {
      if (typeof window.addAdjustmentLayer === 'function') {
        window.addAdjustmentLayer();
      }
      return 'true';
    }

    // --- Toolbox: Effects ---
    if (toolName === 'FILL') {
      return applyEffectSafely('fill');
    }
    if (toolName === 'TINT') {
      return applyEffectSafely('tint');
    }
    if (toolName === 'BLUR') {
      const effectId = (args[0] === true) ? 'camera-lens-blur' : 'fast-box-blur';
      return applyEffectSafely(effectId);
    }
    if (toolName === 'LUM') {
      return applyEffectSafely('brightness-contrast');
    }
    if (toolName === 'CURV') {
      return applyEffectSafely('curve');
    }
    if (toolName === 'HUE') {
      return applyEffectSafely('hue-shift');
    }

    // --- Velocity Card ---
    if (toolName === 'TWIX') {
      return applyTwixtorVelocity();
    }
    if (toolName === 'TMRE') {
      return applyTimeRemapVelocity();
    }

    // --- Beat Effects: Disabled S_Shake ---
    if (toolName === 'SHKE') {
      return JSON.stringify({
        error: true,
        tool: 'S_Shake',
        type: 'warn',
        message: 'S_Shake is temporarily disabled.'
      });
    }

    // --- Beat Effects: Current ---
    if (toolName === 'GHST' || toolName === 'WARP' || toolName === 'FISHEYE' || toolName === 'MIDWAVE' || toolName === 'HUESPIN' || toolName === 'EXPO' || toolName === 'FLASH' || toolName === 'LENS' ||
        toolName === 'OSCILLATE' || toolName === 'SWING' ||
        toolName === 'Y_BEAT' || toolName === 'Y_FLIP' || toolName === 'X_BEAT' || toolName === 'X_FLIP' ||
        toolName === 'SCALE_BEAT' || toolName === 'SCALE_OVERLAP' ||
        (typeof toolName === 'string' && (toolName === 'PANNING' || toolName.indexOf('PANNING_') === 0))) {
      const exec = (typeof window.executeFishTool === 'function')
        ? window.executeFishTool
        : (window.parent && typeof window.parent.executeFishTool === 'function' ? window.parent.executeFishTool : null);
      if (typeof exec === 'function') {
        return exec(toolName, ...args);
      }
      const fnNull = (typeof window.applyBeatNullTool === 'function')
        ? window.applyBeatNullTool
        : (window.parent && typeof window.parent.applyBeatNullTool === 'function' ? window.parent.applyBeatNullTool : null);
      if (typeof fnNull === 'function' && (toolName === 'OSCILLATE' || toolName === 'SWING' || toolName === 'Y_BEAT' || toolName === 'Y_FLIP' || toolName === 'X_BEAT' || toolName === 'X_FLIP' || toolName === 'SCALE_BEAT' || toolName === 'SCALE_OVERLAP' || toolName === 'PANNING' || (typeof toolName === 'string' && toolName.indexOf('PANNING_') === 0))) {
        return fnNull(toolName === 'PANNING' ? 'PANNING_MIX_ALL' : toolName);
      }
      const fn = (typeof window.applyBeatFlashEffect === 'function')
        ? window.applyBeatFlashEffect
        : (window.parent && typeof window.parent.applyBeatFlashEffect === 'function' ? window.parent.applyBeatFlashEffect : null);
      if (typeof fn === 'function' && (toolName === 'EXPO' || toolName === 'FLASH')) {
        return fn();
      }
      const fnBlur = (typeof window.applyBeatBlurEffect === 'function')
        ? window.applyBeatBlurEffect
        : (window.parent && typeof window.parent.applyBeatBlurEffect === 'function' ? window.parent.applyBeatBlurEffect : null);
      if (typeof fnBlur === 'function' && toolName === 'LENS') {
        return fnBlur(...args);
      }
    }

    // --- Beat Effects: Continuous Fallbacks ---
    if (toolName === 'EXPO' || toolName === 'FLASH') {
      return applyBeatKeyframes(toolName);
    }
    if (toolName === 'LENS') {
      const fnBlur = (typeof window.applyBeatBlurEffect === 'function')
        ? window.applyBeatBlurEffect
        : (window.parent && typeof window.parent.applyBeatBlurEffect === 'function' ? window.parent.applyBeatBlurEffect : null);
      if (typeof fnBlur === 'function') {
        return fnBlur(...args);
      }
      return applyBeatKeyframes('LENS');
    }
    if (toolName === 'OSCILLATE' || toolName === 'SWING' || toolName === 'Y_BEAT' || toolName === 'Y_FLIP' || toolName === 'X_BEAT' || toolName === 'X_FLIP' || toolName === 'SCALE_BEAT' || toolName === 'SCALE_OVERLAP') {
      return applyBeatKeyframes(toolName);
    }

    // --- Beat Effects: Panning ---
    if (typeof toolName === 'string' && toolName.indexOf('PANNING') === 0) {
      return applyPanningKeyframes(toolName);
    }

    // --- Transitions ---
    if (typeof toolName === 'string' && toolName.indexOf('TRANS_') === 0) {
      const exec = (typeof window.executeFishTool === 'function')
        ? window.executeFishTool
        : (window.parent && typeof window.parent.executeFishTool === 'function' ? window.parent.executeFishTool : null);
      if (typeof exec === 'function') {
        return exec(toolName, ...args);
      }
      const fn = (typeof window.applyTransitionKeyframes === 'function')
        ? window.applyTransitionKeyframes
        : (window.parent && typeof window.parent.applyTransitionKeyframes === 'function' ? window.parent.applyTransitionKeyframes : null);
      if (typeof fn === 'function') {
        return fn(toolName);
      }
    }

    if (toolName === 'PNG') {
      if (typeof window.exportCurrentFrameAsPNG === 'function') {
        window.exportCurrentFrameAsPNG({ keepPopoverOpen: true });
      }
      return JSON.stringify({ error: false, type: 'info', message: 'Screenshot saved successfully!' });
    }

    console.log('[FishToolsBridge] Tool not yet handled:', toolName, args);
    return 'true';
  }

  return {
    executeTool: executeTool,
    setAnchorPoint: setAnchorPoint,
    centerInComp: centerInComp,
    alignLayers: alignLayers,
    cutLayers: cutLayers,
    precompose: function () { return executeTool('PRECOMP'); },
    getSelectedLayers: getSelectedLayers
  };
})();

window.FishToolsAdapter = (function () {
  let cachedTemplate = null;

  const CDN_BASE = 'https://cdn.jsdelivr.net/gh/cutefishaep/OpenFishTools@main/client/';
  const RAW_FALLBACK = 'https://raw.githubusercontent.com/cutefishaep/OpenFishTools/main/client/index.html';

  async function getAdaptedHtml() {
    if (!cachedTemplate) {
      let rawHtml = '';
      let isLocal = false;
      try {
        const localRes = await fetch('Extension/extension.html');
        if (localRes.ok) {
          rawHtml = await localRes.text();
          isLocal = true;
        } else {
          throw new Error('Local status ' + localRes.status);
        }
      } catch (localErr) {
        try {
          const response = await fetch(CDN_BASE + 'index.html');
          if (!response.ok) throw new Error('CDN status ' + response.status);
          rawHtml = await response.text();
        } catch (err) {
          console.warn('CDN fetch failed, trying GitHub raw fallback...', err);
          const fallbackRes = await fetch(RAW_FALLBACK);
          rawHtml = await fallbackRes.text();
        }
      }

      // 1. Parse HTML with DOMParser for clean, robust manipulation
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, 'text/html');

      // 2. Remove Unused Script Tags
      const unusedScriptPatterns = [
        'filestore.js',
        'controller.js',
        'graph.js',
        'elasticgraph.js',
        'beatmaker.js',
        'debug.js',
        'tts.js',
        'autosave.js',
        'aetoam.js',
        'projectpool.js',
        'jszip.min.js',
        'tips.js',
        'update.js'
      ];

      doc.querySelectorAll('script').forEach((script) => {
        const src = script.getAttribute('src') || '';
        if (unusedScriptPatterns.some(pattern => src.includes(pattern))) {
          script.remove();
        }
      });

      // 3. Remove Unused Tabs and Navigation
      doc.querySelectorAll('button[data-tab="controller"], button[data-tab="graph"]').forEach(el => el.remove());
      const tabController = doc.getElementById('tab-controller');
      if (tabController) tabController.remove();
      const tabGraph = doc.getElementById('tab-graph');
      if (tabGraph) tabGraph.remove();

      // 4. Remove Unused Cards by ID or contents
      const removeCardIds = ['card-tts', 'card-autosave', 'card-aetoam', 'card-project-pool'];
      removeCardIds.forEach(id => {
        const el = doc.getElementById(id);
        if (el) el.remove();
      });

      // Remove specific cards based on content triggers
      doc.querySelectorAll('.card').forEach(card => {
        if (
          card.querySelector('#beat-manual-controls') ||
          card.querySelector('#beat-tap-btn') ||
          card.querySelector('#tip-content') ||
          card.querySelector('#btn-check-update') ||
          card.querySelector('#update-current-ver') ||
          card.querySelector('#rec-womtools') ||
          card.querySelector('#btn-womtools') ||
          card.querySelector('#btn-backup-settings') ||
          card.querySelector('#btn-restore-settings') ||
          card.querySelector('#btn-open-settings-dir') ||
          card.querySelector('#btn-purge-all') ||
          card.querySelector('#btn-debug-all') ||
          card.querySelector('#debug-output')
        ) {
          card.remove();
        }
      });

      // 5. Remove Theme & UI Style Select Controls (Fixed to Studio Matcha Theme)
      const themeSelect = doc.getElementById('theme-select');
      if (themeSelect) {
        const row = themeSelect.closest('.settings-row');
        if (row) row.remove();
        else themeSelect.remove();
      }
      const styleSelect = doc.getElementById('style-select');
      if (styleSelect) {
        const row = styleSelect.closest('.settings-row');
        if (row) row.remove();
        else styleSelect.remove();
      }

      // 6. Remove Unused Modals (QRIS, Permissions)
      const qrisModal = doc.getElementById('qris-modal');
      if (qrisModal) qrisModal.remove();

      // Static initial text updates
      const extEl = doc.getElementById('info-ext-ver');
      if (extEl) extEl.textContent = 'Latest';
      const aeEl = doc.getElementById('info-ae-ver');
      if (aeEl) aeEl.textContent = 'Web App';
      const osEl = doc.getElementById('info-os');
      if (osEl) osEl.textContent = 'Browser';

      // 6. Disable S_Shake button (no replacement effect yet)
      const shakeBtn = doc.querySelector('.tool-btn[data-tool="SHKE"]');
      if (shakeBtn) {
        shakeBtn.setAttribute('disabled', 'disabled');
        shakeBtn.setAttribute('aria-disabled', 'true');
        shakeBtn.setAttribute('title', 'S_Shake is temporarily disabled (replacement in development)');
        shakeBtn.style.setProperty('opacity', '0.35', 'important');
        shakeBtn.style.setProperty('pointer-events', 'none', 'important');
        shakeBtn.style.setProperty('filter', 'grayscale(1)', 'important');
        shakeBtn.style.setProperty('cursor', 'not-allowed', 'important');
      }

      // Configure LENS button: left click = Fast Box Blur, right click = Lens Blur
      const lensBtn = doc.querySelector('.tool-btn[data-tool="LENS"]');
      if (lensBtn) {
        lensBtn.classList.add('has-context');
        lensBtn.setAttribute('data-has-alter', 'true');
        lensBtn.setAttribute('title', 'Left click: Fast Box Blur | Right click: Lens Blur');
      }

      // 7. Convert all Relative URLs in <link>, <script>, <img> to Absolute or Extension/ URLs
      const CLIENT_BASE = isLocal ? 'Extension/' : CDN_BASE;

      doc.querySelectorAll('link[href]').forEach(el => {
        const href = el.getAttribute('href');
        if (href && !href.startsWith('http') && !href.startsWith('//')) {
          el.setAttribute('href', CLIENT_BASE + href.replace(/^\.\//, '').replace(/^\//, ''));
        }
      });

      doc.querySelectorAll('script[src]').forEach(el => {
        const src = el.getAttribute('src');
        if (src && !src.startsWith('http') && !src.startsWith('//')) {
          el.setAttribute('src', CLIENT_BASE + src.replace(/^\.\//, '').replace(/^\//, ''));
        }
      });

      doc.querySelectorAll('img[src]').forEach(el => {
        const src = el.getAttribute('src');
        if (src && !src.startsWith('http') && !src.startsWith('//')) {
          el.setAttribute('src', CLIENT_BASE + src.replace(/^\.\//, '').replace(/^\//, ''));
        }
      });

      // 7. Inject Web Bridge Polyfill and Web Styles into <head>
      const bridgeScript = doc.createElement('script');
      bridgeScript.textContent = `
        // Extension Version override
        window.EXTENSION_VERSION = 'Latest';

        // Native Web FileStore implementation
        window.FileStore = (function () {
          var _cache = {};
          function getDB() {
            return (window.parent && window.parent.FishDatabase) || window.FishDatabase;
          }
          function load() {
            try {
              var db = getDB();
              var raw = db ? db.getSyncSettings() : (localStorage.getItem('fishtools_save') || localStorage.getItem('fishToolsFileStore'));
              _cache = raw ? JSON.parse(raw) : {};
            } catch (e) {
              _cache = {};
            }
            if (!_cache || typeof _cache !== 'object') _cache = {};
            if (!_cache.config) {
              _cache.config = {
                version: 'Latest',
                theme: 'dark',
                uiStyle: 'simple',
                animEnabled: true,
                snapScroll: false,
                tipsEnabled: false,
                lastTab: 'main'
              };
            }
            if (!_cache.config.theme) _cache.config.theme = 'dark';
          }
          function save() {
            try {
              var jsonStr = JSON.stringify(_cache);
              var db = getDB();
              if (db) {
                db.saveSyncSettings(jsonStr);
              } else {
                localStorage.setItem('fishtools_save', jsonStr);
                localStorage.setItem('fishToolsFileStore', jsonStr);
              }
            } catch (e) {}
          }

          load();

          return {
            init: function () {
              load();
            },
            load: load,
            save: save,
            get: function (k) {
              return _cache[k];
            },
            set: function (k, v) {
              _cache[k] = v;
              save();
            },
            remove: function (k) {
              delete _cache[k];
              save();
            },
            getAll: function () {
              return JSON.parse(JSON.stringify(_cache));
            },
            clear: function () {
              _cache = {};
              save();
            },
            replace: function (d) {
              _cache = d || {};
              save();
            },
            getDataDir: function () {
              return '/web_storage';
            },
            isLocalStorage: function () {
              return true;
            }
          };
        })();

        // Mock Adobe CEP Environment
        // Mock ExtendScript globals ($ and app) for CEP evalScript compatibility
        window.$ = {
          os: 'Browser',
          evalFile: function (path) {
            return true;
          },
          global: window
        };

        window.app = {
          version: 'Web App',
          project: {
            file: {
              name: 'Web Project'
            },
            activeItem: null
          },
          preferences: {
            getPrefAsLong: function () {
              return 1;
            }
          },
          beginUndoGroup: function () {},
          endUndoGroup: function () {},
          executeCommand: function () {},
          findMenuCommandId: function () { return 0; }
        };

        window.Folder = function (path) {
          return {
            fullName: path || '/web_storage',
            exists: true,
            execute: function () { return true; },
            toString: function () { return path || '/web_storage'; }
          };
        };
        window.Folder.temp = {
          fullName: '/web_storage/temp',
          toString: function () { return '/web_storage/temp'; }
        };

        window.File = function (path) {
          return {
            fullName: path || '',
            open: function () { return true; },
            write: function () { return true; },
            close: function () { return true; },
            remove: function () { return true; }
          };
        };

        // Expose FishTools execution bridge to iframe
        window.FishTools = {
          executeTool: function (toolName) {
            var args = Array.prototype.slice.call(arguments, 1);
            var parentExec = (window.parent && typeof window.parent.executeFishTool === 'function')
              ? window.parent.executeFishTool
              : (typeof window.executeFishTool === 'function' ? window.executeFishTool : null);
            if (parentExec) {
              var r = parentExec.apply(window.parent || window, [toolName].concat(args));
              if (r !== undefined) return r;
            }
            var bridge = (window.parent && window.parent.FishToolsBridge) || window.FishToolsBridge;
            if (bridge && typeof bridge.executeTool === 'function') {
              return bridge.executeTool.apply(bridge, [toolName].concat(args));
            }
            return 'true';
          },
          setAnchorPoint: function (pos) { return this.executeTool('setAnchorPoint', pos); },
          CENTERINCOMP: function () { return this.executeTool('CENTERINCOMP'); },
          CUT_FRONT: function () { return this.executeTool('CUT_FRONT'); },
          CUT_MID: function () { return this.executeTool('CUT_MID'); },
          CUT_BACK: function () { return this.executeTool('CUT_BACK'); },
          ALIGN_LEFT: function () { return this.executeTool('ALIGN_LEFT'); },
          ALIGN_HCENTER: function () { return this.executeTool('ALIGN_HCENTER'); },
          ALIGN_RIGHT: function () { return this.executeTool('ALIGN_RIGHT'); },
          ALIGN_TOP: function () { return this.executeTool('ALIGN_TOP'); },
          ALIGN_VCENTER: function () { return this.executeTool('ALIGN_VCENTER'); },
          ALIGN_BOTTOM: function () { return this.executeTool('ALIGN_BOTTOM'); },
          PRECOMP: function () { return this.executeTool('PRECOMP'); },
          PRECOMP_AUTOCROP: function () { return this.executeTool('PRECOMP_AUTOCROP'); },
          PRECOMPOSE: function () { return this.executeTool('PRECOMPOSE'); },
          OVERLAP: function () { return this.executeTool('OVERLAP'); },
          PNG: function () { return this.executeTool('PNG'); },
          DUP: function (name) { return this.executeTool('DUP', name); },
          changeCompRatio: function (w, h) { return this.executeTool('changeCompRatio', w, h); },
          changeCompFPS: function (fps) { return this.executeTool('changeCompFPS', fps); }
        };

        // Mock Adobe CEP Environment
        window.__adobe_cep__ = {
          getHostEnvironment: function () {
            return JSON.stringify({
              appId: 'PHXS',
              appName: 'Web App',
              appVersion: 'Web App',
              appLocale: 'en_US',
              appUILocale: 'en_US',
              isAppOnline: true,
              appSkinInfo: {
                baseFontFamily: 'Inter',
                baseFontSize: 12,
                appBarBackgroundColor: { color: { red: 13, green: 17, blue: 13 } },
                panelBackgroundColor: { color: { red: 13, green: 17, blue: 13 } }
              }
            });
          },
          evalScript: function (script, callback) {
            var res = 'true';
            try {
              if (typeof script !== 'string') script = String(script || '');
              if (script.indexOf('app.version') !== -1) {
                res = 'Web App';
              } else if (script.indexOf('$.os') !== -1) {
                res = 'Browser';
              } else if (script.indexOf('app.project.file') !== -1) {
                var curW = (typeof window !== 'undefined') ? window : (typeof global !== 'undefined' ? global : {});
                var pName = (curW.parent && curW.parent.currentProjectState && curW.parent.currentProjectState.name) || 'Web Project';
                res = pName;
              } else if (script.indexOf('$.evalFile') !== -1) {
                res = 'true';
              } else if (script.indexOf('Pref_SCRIPTING_FILE_NETWORK_SECURITY') !== -1) {
                res = 'ok';
              } else if (script.indexOf('app.project.activeItem') !== -1 || script.indexOf('NOT_A_PRECOMP') !== -1 || script.indexOf('selectedLayers[0].source') !== -1) {
                var curW = (typeof window !== 'undefined' && window.parent) ? window : (typeof global !== 'undefined' && global.window ? global.window : ((typeof this !== 'undefined' && this && this.parent) ? this : {}));
                var parentWin = (curW.parent && curW.parent.currentProjectState) ? curW.parent : curW;
                var pState = parentWin.currentProjectState;
                if (!pState) {
                  res = '';
                } else {
                  var selId = parentWin.selectedLayerId;
                  var selLayer = null;
                  if (selId && Array.isArray(pState.layers)) {
                    selLayer = pState.layers.find(function (l) { return l.id === selId; });
                  }
                  if (selLayer) {
                    if (selLayer.type === 'precomp') {
                      res = selLayer.name || 'Pre-comp 1';
                    } else {
                      res = 'NOT_A_PRECOMP';
                    }
                  } else if (parentWin.currentActivePrecomp) {
                    res = parentWin.currentActivePrecomp.name || 'Pre-comp 1';
                  } else {
                    var anyPrecomp = (pState.layers || []).find(function (l) { return l.type === 'precomp'; });
                    if (anyPrecomp) {
                      res = anyPrecomp.name || 'Pre-comp 1';
                    } else {
                      res = '';
                    }
                  }
                }
              } else {
                try {
                  res = new Function('window', 'with(window){ return ' + script + '; }')(window);
                } catch (_) {
                  res = new Function('window', 'with(window){ ' + script + ' }')(window);
                }
              }
            } catch (e) {
              console.warn('evalScript error:', e, script);
              res = JSON.stringify({ error: true, type: 'error', message: (e.message || String(e)).replace(/"/g, "'") });
            }
            if (typeof callback === 'function') {
              callback(typeof res === 'string' ? res : (res !== undefined ? JSON.stringify(res) : 'true'));
            }
          },
          invokeSync: function () {
            return JSON.stringify({ error: 0 });
          },
          getSystemPath: function () {
            return '/web_storage';
          },
          setPanelFlyoutMenu: function () {},
          openURLInDefaultBrowser: function (url) {
            window.open(url, '_blank');
          },
          addEventListener: function () {},
          removeEventListener: function () {},
          dispatchEvent: function () {},
          requestOpenExtension: function () {},
          closeExtension: function () {}
        };

        // Mock CEP Local Storage / Database FileStore routing
        window.cep = {
          fs: {
            readFile: function (path) {
              if (path && path.indexOf('manifest.xml') !== -1) {
                return { err: 0, data: '<ExtensionManifest ExtensionBundleVersion="Latest"></ExtensionManifest>' };
              }
              var db = (window.parent && window.parent.FishDatabase) || window.FishDatabase;
              var raw = db ? db.getSyncSettings() : (localStorage.getItem('fishtools_save') || localStorage.getItem('fishToolsFileStore'));
              var dataObj = {};
              try { dataObj = raw ? JSON.parse(raw) : {}; } catch (e) {}
              if (!dataObj.config) {
                dataObj.config = {
                  version: 'Latest',
                  theme: 'dark',
                  uiStyle: 'simple',
                  animEnabled: true,
                  snapScroll: false,
                  tipsEnabled: false,
                  lastTab: 'main'
                };
              }
              if (!dataObj.config.theme) dataObj.config.theme = 'dark';
              return { err: 0, data: JSON.stringify(dataObj) };
            },
            writeFile: function (path, data) {
              var db = (window.parent && window.parent.FishDatabase) || window.FishDatabase;
              if (db) {
                db.saveSyncSettings(data);
              } else {
                try {
                  localStorage.setItem('fishtools_save', data);
                  localStorage.setItem('fishToolsFileStore', data);
                } catch (e) {}
              }
              return { err: 0 };
            },
            stat: function (path) {
              var isDir = !path || path.indexOf('.') === -1;
              return {
                err: 0,
                data: {
                  isDirectory: function () { return isDir; },
                  isFile: function () { return !isDir; }
                }
              };
            },
            makedir: function () { return { err: 0 }; },
            deleteFile: function () { return { err: 0 }; }
          }
        };

        window.SystemPath = {
          EXTENSION: 'EXT',
          USER_DATA: 'USER_DATA',
          HOST_APPLICATION: 'HOST'
        };

        // Mock Disabled Modules so main.js instantiation never errors
        window.TipsModule = function () {
          return {
            init: function () {},
            showRandomTip: function () {},
            destroy: function () {}
          };
        };
        window.tips = {
          init: function () {},
          showRandomTip: function () {},
          destroy: function () {}
        };

        window.UpdateModule = {
          init: function () {},
          checkUpdate: function () {}
        };

        // Web App Overrides on DOM Ready
        document.addEventListener('DOMContentLoaded', function () {
          window.EXTENSION_VERSION = 'Latest';

          var db = (window.parent && window.parent.FishDatabase) || window.FishDatabase;
          if (window.FileStore && db) {
            try {
              var syncData = JSON.parse(db.getSyncSettings());
              if (syncData) window.FileStore.replace(syncData);
            } catch (e) {}
          }

          if (window.settings) {
            try {
              var savedConfig = window.FileStore ? window.FileStore.get('config') : null;
              if (savedConfig) {
                for (var key in savedConfig) {
                  if (savedConfig.hasOwnProperty(key)) {
                    window.settings.settings[key] = savedConfig[key];
                  }
                }
              }
            } catch (e) {}
            if (typeof window.settings.applySettings === 'function') window.settings.applySettings(true);
            if (typeof window.settings.syncUI === 'function') window.settings.syncUI();
          }

          function enforceLatestVer() {
            var extVer = document.getElementById('info-ext-ver');
            if (extVer) extVer.textContent = 'Latest';
            var updateVer = document.getElementById('update-ver');
            if (updateVer) updateVer.textContent = 'Latest';
          }
          enforceLatestVer();
          setTimeout(enforceLatestVer, 100);
          setTimeout(enforceLatestVer, 500);

          var aeVer = document.getElementById('info-ae-ver');
          if (aeVer) aeVer.textContent = 'Web App';

          var osEl = document.getElementById('info-os');
          if (osEl) osEl.textContent = 'Browser';

          var timeEl = document.getElementById('info-time');
          function updateClock() {
            if (!timeEl) return;
            var now = new Date();
            timeEl.textContent = String(now.getHours()).padStart(2, '0') + ':' +
                                 String(now.getMinutes()).padStart(2, '0') + ':' +
                                 String(now.getSeconds()).padStart(2, '0');
          }
          updateClock();
          setInterval(updateClock, 1000);
        });
      `;
      doc.head.insertBefore(bridgeScript, doc.head.firstChild);

      // Custom CSS to ensure clean edge-to-edge container styling & exact theme solid canvas
      const styleEl = doc.createElement('style');
      styleEl.textContent = `
        :root {
          color-scheme: dark;
        }
        :root, [data-theme="dark"], [data-theme="matcha"] {
          --bg: #0d1109 !important;
          --surface: #151a0f !important;
          --surface2: #1d2415 !important;
          --border: #2a3321 !important;
          --border2: #3d4a2f !important;
          --accent: #98ce7b !important;
          --accent-h: #abdd90 !important;
          --accent-rgb: 152, 206, 123 !important;
          --accent-fg: #000000 !important;
          --text: #98ce7b !important;
          --text-dim: #98ce7b !important;
          --text-mut: #7fb862 !important;
        }
        html, body {
          background-color: var(--bg, #0d1109) !important;
          background: var(--bg, #0d1109) !important;
          color: var(--accent, #98ce7b) !important;
          width: 100%;
          height: 100% !important;
          margin: 0;
          padding: 0;
          overflow: hidden !important;
        }
        .content-container {
          height: 100% !important;
          padding: 8px 8px 48px !important;
          box-sizing: border-box !important;
          background-color: var(--bg, #0d1109) !important;
          background: var(--bg, #0d1109) !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch !important;
        }
        .tab-content {
          background-color: var(--bg, #0d1109) !important;
          background: var(--bg, #0d1109) !important;
        }
        .bottom-nav, nav, .nav-bar {
          background-color: var(--surface, #151a0f) !important;
          background: var(--surface, #151a0f) !important;
          border-top-color: var(--border, #2a3321) !important;
          height: 42px !important;
        }
        .tab-btn {
          color: var(--text-mut, #7fb862) !important;
        }
        .tab-btn .tab-label,
        .tab-btn .material-icons {
          color: inherit !important;
        }
        .tab-btn.active,
        .style-material-you .tab-btn.active,
        .style-simple .tab-btn.active {
          background-color: var(--accent, #98ce7b) !important;
          color: #000000 !important;
        }
        .tab-btn.active .tab-label,
        .tab-btn.active .material-icons,
        .style-material-you .tab-btn.active .tab-label,
        .style-material-you .tab-btn.active .material-icons {
          color: #000000 !important;
          background: transparent !important;
        }
        .card {
          background-color: var(--surface, #151a0f) !important;
          background: var(--surface, #151a0f) !important;
          border-color: var(--border, #2a3321) !important;
          padding: 8px 10px !important;
          margin-bottom: 8px !important;
          border-radius: 10px !important;
        }
        .card h3, .card-header h3 {
          color: var(--accent, #98ce7b) !important;
          font-size: 11px !important;
          margin: 0 0 6px 0 !important;
          letter-spacing: 0.5px !important;
        }
        .anchor-grid {
          gap: 4px !important;
          margin: 4px auto !important;
        }
        .anchor-cell {
          width: 24px !important;
          height: 24px !important;
          border-radius: 4px !important;
        }
        .tool-btn,
        .style-simple .tool-btn,
        .style-material-you .tool-btn {
          color: var(--accent, #98ce7b) !important;
          border-color: var(--border, #2a3321) !important;
          background-color: var(--surface2, #1d2415);
          min-height: 32px !important;
          padding: 4px 6px !important;
          border-radius: 8px !important;
          font-size: 11px !important;
        }
        .tool-label {
          color: var(--accent, #98ce7b) !important;
          font-size: 9px !important;
          margin-top: 2px !important;
        }
        .tab-btn {
          height: 42px !important;
          padding: 3px 0 !important;
        }
        .tab-btn .material-icons {
          font-size: 18px !important;
        }
        .tab-btn .tab-label {
          font-size: 9px !important;
        }
        .tool-btn .material-icons,
        .tool-btn span,
        .tool-btn div > span {
          color: var(--accent, #98ce7b) !important;
        }
        .tool-btn:hover,
        .style-simple .tool-btn:hover,
        .style-material-you .tool-btn:hover {
          background-color: var(--accent, #98ce7b) !important;
          color: #000000 !important;
          border-color: var(--accent, #98ce7b) !important;
        }
        .tool-btn:hover .tool-label,
        .tool-btn:hover .material-icons,
        .tool-btn:hover span,
        .tool-btn:hover div > span,
        .style-simple .tool-btn:hover *,
        .style-material-you .tool-btn:hover * {
          color: #000000 !important;
        }
        .tool-btn--active,
        .style-simple .tool-btn--active,
        .style-material-you .tool-btn--active {
          background-color: var(--accent, #98ce7b) !important;
          color: #000000 !important;
          border-color: var(--accent, #98ce7b) !important;
        }
        .tool-btn--active .tool-label,
        .tool-btn--active .material-icons,
        .tool-btn--active span,
        .tool-btn--active div > span {
          color: #000000 !important;
        }
        .tool-btn[data-tool="SHKE"],
        .tool-btn[data-tool="SHKE"]:hover,
        .tool-btn[data-tool="SHKE"]:active {
          opacity: 0.35 !important;
          pointer-events: none !important;
          filter: grayscale(1) !important;
          cursor: not-allowed !important;
        }
        .anchor-cell {
          border-color: var(--border, #2a3321) !important;
          background-color: var(--surface2, #1d2415) !important;
        }
        .anchor-cell.active {
          background-color: var(--accent, #98ce7b) !important;
          border-color: var(--accent, #98ce7b) !important;
        }
        .status-box {
          background-color: var(--surface2, #1d2415) !important;
          border-color: var(--border, #2a3321) !important;
        }
        .status-box .status-value {
          color: var(--accent, #98ce7b) !important;
        }
        .status-box .status-label {
          color: var(--text-mut, #7fb862) !important;
        }
        .settings-label,
        .settings-row label,
        .settings-row span,
        .form-row label,
        .form-row span {
          color: var(--accent, #98ce7b) !important;
        }
        .custom-select-trigger,
        .custom-select-trigger span {
          color: var(--accent, #98ce7b) !important;
        }
        .custom-select-option {
          color: var(--accent, #98ce7b) !important;
          background-color: var(--surface, #151a0f) !important;
        }
        .custom-select-option:hover,
        .custom-select-option.selected {
          background-color: var(--accent, #98ce7b) !important;
          color: #000000 !important;
        }
        button, input, select, textarea {
          color: var(--accent, #98ce7b) !important;
        }
        #splash-screen {
          background-color: var(--bg, #0d1109) !important;
          background: var(--bg, #0d1109) !important;
        }
        #container-theme-select,
        #container-style-select,
        #theme-select,
        #style-select,
        .settings-row:has(#theme-select),
        .settings-row:has(#style-select) {
          display: none !important;
        }
        #perm-modal-overlay,
        #qris-modal,
        .modal-overlay:not(.custom-modal-overlay) {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .custom-modal-overlay {
          background: rgba(13, 17, 9, 0.85) !important;
        }
        .custom-modal {
          background-color: var(--surface, #151a0f) !important;
          border: 1px solid var(--border, #2a3321) !important;
          border-radius: 10px !important;
          color: var(--accent, #98ce7b) !important;
          box-shadow: none !important;
        }
        .custom-modal h3 {
          color: var(--accent, #98ce7b) !important;
        }
        .custom-modal .modal-body {
          color: var(--text-mut, #7fb862) !important;
        }
        .custom-modal-footer .btn-modal {
          border-radius: 6px !important;
          outline: none !important;
          box-shadow: none !important;
        }
        .custom-modal-footer .primary-btn {
          background: var(--accent, #98ce7b) !important;
          color: #000000 !important;
          border: 1px solid var(--accent, #98ce7b) !important;
        }
        .custom-modal-footer .secondary-btn {
          background: var(--surface2, #1d2415) !important;
          color: var(--accent, #98ce7b) !important;
          border: 1px solid var(--border, #2a3321) !important;
        }
      `;
      doc.head.appendChild(styleEl);

      cachedTemplate = doc;
    }

    // Hydrate latest saved settings into the document before returning HTML
    let currentTheme = 'dark';
    let currentStyle = 'simple';
    let currentAnim = true;
    try {
      const db = window.FishDatabase;
      if (db) {
        const raw = db.getSyncSettings();
        const parsed = JSON.parse(raw);
        if (parsed && parsed.config) {
          if (parsed.config.theme) currentTheme = parsed.config.theme;
          if (parsed.config.uiStyle) currentStyle = parsed.config.uiStyle;
          if (parsed.config.animEnabled !== undefined) currentAnim = parsed.config.animEnabled;
        }
      }
    } catch (e) {}

    const docClone = cachedTemplate.cloneNode(true);
    docClone.documentElement.setAttribute('data-theme', currentTheme);
    docClone.documentElement.setAttribute('data-anim', currentAnim ? 'on' : 'off');
    if (docClone.body) {
      docClone.body.classList.remove('style-material-you', 'style-simple');
      if (currentStyle === 'material') docClone.body.classList.add('style-material-you');
      if (currentStyle === 'simple') docClone.body.classList.add('style-simple');
    }

    return '<!DOCTYPE html>\n' + docClone.documentElement.outerHTML;
  }

  async function loadIntoIframe(iframeEl, loaderEl) {
    if (!iframeEl) return;
    try {
      const html = await getAdaptedHtml();
      iframeEl.srcdoc = html;
      iframeEl.onload = function () {
        if (loaderEl) loaderEl.style.display = 'none';
        iframeEl.classList.add('is-loaded');
        if (window.Popover && typeof window.Popover.updatePosition === 'function') {
          window.Popover.updatePosition();
        }
      };
    } catch (err) {
      console.error('FishToolsAdapter load error:', err);
      if (loaderEl) {
        loaderEl.innerHTML = '<span style="color:var(--color-danger, #ff5555);">Failed to load OpenFishTools</span>';
      }
    }
  }

  return {
    getAdaptedHtml: getAdaptedHtml,
    loadIntoIframe: loadIntoIframe
  };
})();
