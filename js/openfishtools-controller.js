/**
 * OpenFishTools Controller & Dispatcher
 * Bridges OpenFishTools Panel actions into FishTools Studio Editor.
 * Modular, decoupled controller for toolbox tools, velocity tools, and beat effects.
 */
(function(window) {
  'use strict';

  // Helper: Get timing from currently selected layer
  function getSelectedLayerTiming() {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
    const selLayer = layers.find(l => l.id === selId);
    if (selLayer) {
      return {
        durationSec: selLayer.durationSec !== undefined ? selLayer.durationSec : null,
        startSec: selLayer.startSec !== undefined ? selLayer.startSec : null
      };
    }
    return { durationSec: null, startSec: null };
  }

  // --- TOOLBOX: FREEZE FRAME ---
  function applyToolboxFreezeFrame() {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
    const selLayer = layers.find(l => l.id === selId);
    if (!selLayer) {
      const msg = 'Please select a video layer first.';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'Freeze Frame', type: 'warn', message: msg });
    }
    if (selLayer.type !== 'video') {
      const msg = 'Freeze Frame is only supported on video layers!';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'Freeze Frame', type: 'warn', message: msg });
    }
    if (typeof window.freezeFrameAtCurrentTime === 'function') {
      window.freezeFrameAtCurrentTime();
      return JSON.stringify({ error: false, message: 'Video frame frozen' });
    }
  }

  // --- TOOLBOX: FIT TO COMP ---
  function applyToolboxFitToComp(alter = false) {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
    const selLayer = layers.find(l => l.id === selId);
    if (!selLayer) return JSON.stringify({ error: true, tool: 'Fit to Comp', type: 'warn', message: 'No layer selected.' });

    const aspect = (window.currentProjectState && window.currentProjectState.aspectRatio) || '16:9';
    const res = (window.currentProjectState && window.currentProjectState.resolution) || '1080p';
    const resMap = window.resMap || {};
    const baseDims = (resMap[res] && resMap[res][aspect]) || [1920, 1080];
    const baseW = baseDims[0];
    const baseH = baseDims[1];

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    selLayer.posX = Math.round(baseW / 2);
    selLayer.posY = Math.round(baseH / 2);

    if (alter) {
      // Right-click: Stretch full comp
      selLayer.scaleW = baseW;
      selLayer.scaleH = baseH;
    } else {
      // Left-click: Contain / preserve aspect ratio
      const natW = Math.abs(selLayer.mediaWidth || selLayer.scaleW || baseW);
      const natH = Math.abs(selLayer.mediaHeight || selLayer.scaleH || baseH);
      const fitScale = Math.min(baseW / natW, baseH / natH);
      selLayer.scaleW = Math.round(natW * fitScale);
      selLayer.scaleH = Math.round(natH * fitScale);
    }

    selLayer.normW = Number((Math.abs(selLayer.scaleW) / baseW).toFixed(4));
    selLayer.normH = Number((Math.abs(selLayer.scaleH) / baseH).toFixed(4));
    selLayer.normX = Number(((selLayer.posX - Math.abs(selLayer.scaleW) / 2) / baseW).toFixed(4));
    selLayer.normY = Number(((selLayer.posY - Math.abs(selLayer.scaleH) / 2) / baseH).toFixed(4));

    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(selLayer);
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers(true);
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('fitToComp');
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(alter ? 'Fit to Comp (Stretch)' : 'Fit to Comp');
    return JSON.stringify({ error: false, message: 'Fitted to comp' });
  }

  // --- TOOLBOX: DROP SHADOW ---
  function applyToolboxDropShadow() {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
    const selLayer = layers.find(l => l.id === selId);
    if (!selLayer) return JSON.stringify({ error: true, tool: 'Drop Shadow', type: 'warn', message: 'No layer selected.' });

    if (typeof window.addEffectToLayer === 'function') {
      window.addEffectToLayer('drop-shadow');
      if (Array.isArray(selLayer.effects)) {
        const dshFx = [...selLayer.effects].reverse().find(fx => fx.type === 'drop-shadow');
        if (dshFx) {
          dshFx.distance = 0;
          dshFx.blur = 25;
          dshFx.opacity = 75;
          dshFx.color = '#000000';
          dshFx.angle = 0;
        }
      }
      if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(selLayer);
      if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers(true);
      if (typeof window.redrawComposition === 'function') window.redrawComposition('dropShadow');
      if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Drop Shadow (Distance: 0)');
      return JSON.stringify({ error: false, message: 'Drop shadow applied' });
    }
  }

  // --- TOOLBOX: MIRROR ---
  function applyToolboxMirror(isVertical = false) {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const idSet = new Set();
    if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
      window.selectedLayerIds.forEach(id => idSet.add(id));
    }
    if (window.selectedLayerId) idSet.add(window.selectedLayerId);

    const targets = layers.filter(l => idSet.has(l.id));
    if (targets.length === 0) return JSON.stringify({ error: true, tool: 'Mirror', type: 'warn', message: 'No layer selected.' });

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    const aspect = (window.currentProjectState && window.currentProjectState.aspectRatio) || '16:9';
    const res = (window.currentProjectState && window.currentProjectState.resolution) || '1080p';
    const resMap = window.resMap || {};
    const baseDims = (resMap[res] && resMap[res][aspect]) || [1920, 1080];
    const baseW = baseDims[0];
    const baseH = baseDims[1];

    targets.forEach(selLayer => {
      // 1. Unlink scale proportions first
      if (typeof window.setScaleLinked === 'function') {
        window.setScaleLinked(false, selLayer);
      } else {
        selLayer.isScaleLinked = false;
        selLayer.lockAspect = false;
      }

      // 2. Ensure base scale values exist
      if (selLayer.scaleW === undefined) {
        selLayer.scaleW = selLayer.normW !== undefined ? selLayer.normW * baseW : (selLayer.mediaWidth || baseW);
      }
      if (selLayer.scaleH === undefined) {
        selLayer.scaleH = selLayer.normH !== undefined ? selLayer.normH * baseH : (selLayer.mediaHeight || baseH);
      }

      selLayer._userResized = true;
      selLayer._userResizedManual = true;

      // 3. Mirror horizontal or vertical
      if (isVertical) {
        selLayer.scaleH = -selLayer.scaleH;
        if (selLayer.transformScaleY !== undefined) selLayer.transformScaleY = -selLayer.transformScaleY;
      } else {
        selLayer.scaleW = -selLayer.scaleW;
        if (selLayer.transformScaleX !== undefined) selLayer.transformScaleX = -selLayer.transformScaleX;
      }

      // 4. Invert scale keyframes if present
      if (selLayer.keyframes && Array.isArray(selLayer.keyframes.scale) && selLayer.keyframes.scale.length > 0) {
        selLayer.keyframes.scale.forEach(kf => {
          if (kf && kf.value) {
            if (isVertical) {
              if (kf.value.scaleH !== undefined) kf.value.scaleH = -kf.value.scaleH;
            } else {
              if (kf.value.scaleW !== undefined) kf.value.scaleW = -kf.value.scaleW;
            }
          }
        });
      }

      if (typeof window.invalidatePreviewCacheForLayer === 'function') {
        window.invalidatePreviewCacheForLayer(selLayer);
      }
    });

    if (typeof window.syncTransformControllerValues === 'function') {
      window.syncTransformControllerValues();
    }
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers(true);
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('mirror');
    const flipMsg = isVertical ? 'Mirror Vertical' : 'Mirror Horizontal';
    if (typeof window.showEffectsRackToast === 'function') {
      window.showEffectsRackToast(flipMsg);
    }
    return JSON.stringify({ error: false, message: isVertical ? 'Flipped vertically' : 'Flipped horizontally' });
  }

  // --- VELOCITY: TWIXTOR ---
  function applyTwixtorVelocity() {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
    const selLayer = layers.find(l => l.id === selId);
    if (!selLayer) return JSON.stringify({ error: true, tool: 'Twixtor', type: 'warn', message: 'Please select a video layer first.' });
    if (selLayer.type !== 'video') {
      const msg = 'Twixtor velocity is only supported on video layers!';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'Twixtor', type: 'warn', message: msg });
    }

    const pps = window.currentPixelsPerSecond || 80;
    const clipStart = selLayer.startSec !== undefined ? selLayer.startSec : ((selLayer.startPx || 0) / pps);
    const clipDur = selLayer.durationSec !== undefined ? selLayer.durationSec : ((selLayer.widthPx || 400) / pps);
    const clipEnd = clipStart + clipDur;

    const allBeatmarks = (Array.isArray(window.currentProjectState.beatmarks) ? window.currentProjectState.beatmarks : [])
      .concat(Array.isArray(selLayer.markers) ? selLayer.markers.map(m => typeof m === 'number' ? m : m.time) : []);
    const uniqueBms = Array.from(new Set(allBeatmarks))
      .filter(t => t >= clipStart - 0.001 && t <= clipEnd + 0.001)
      .sort((a, b) => a - b);

    if (uniqueBms.length < 2) {
      const msg = 'Please place at least 2 beatmarks across the video layer to generate velocity speed ramps.';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'Twixtor', type: 'warn', message: msg });
    }

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    selLayer.speedMode = 'speed';
    if (!selLayer.keyframes) selLayer.keyframes = {};

    const kfs = [];
    if (uniqueBms[0] > clipStart + 0.05) {
      kfs.push({
        time: Number(clipStart.toFixed(3)),
        value: { speed: 1.0 },
        easing: [0.42, 0.0, 0.58, 1.0]
      });
    }

    for (let i = 0; i < uniqueBms.length; i++) {
      const t = uniqueBms[i];
      // Beatmark = 100% speed (1.0)
      kfs.push({
        time: Number(t.toFixed(3)),
        value: { speed: 1.0 },
        easing: [0.42, 0.0, 0.58, 1.0]
      });

      if (i < uniqueBms.length - 1) {
        const nextT = uniqueBms[i + 1];
        const mid = (t + nextT) / 2;
        // Midpoint between beatmarks = 50% speed (0.5)
        kfs.push({
          time: Number(mid.toFixed(3)),
          value: { speed: 0.5 },
          easing: [0.42, 0.0, 0.58, 1.0]
        });
      }
    }

    if (uniqueBms[uniqueBms.length - 1] < clipEnd - 0.05) {
      kfs.push({
        time: Number(clipEnd.toFixed(3)),
        value: { speed: 1.0 },
        easing: [0.42, 0.0, 0.58, 1.0]
      });
    }

    kfs.sort((a, b) => a.time - b.time);
    selLayer.keyframes.speed = kfs;

    if (typeof window.syncSpeedControllerValues === 'function') window.syncSpeedControllerValues();
    if (typeof window.updateSpeedKeyframeBtnState === 'function') window.updateSpeedKeyframeBtnState();
    if (typeof window.updateTimelineKeyframeMarkersHighlight === 'function') window.updateTimelineKeyframeMarkersHighlight();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(selLayer);
    if (typeof window.redrawComposition === 'function') window.redrawComposition('twixtor-velocity');
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers(true);
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Twixtor Velocity Applied (100% / 50%)');
    return JSON.stringify({ error: false, message: 'Twixtor velocity applied' });
  }

  // --- VELOCITY: TIME REMAP ---
  function applyTimeRemapVelocity() {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
    const selLayer = layers.find(l => l.id === selId);
    if (!selLayer) return JSON.stringify({ error: true, tool: 'Time Remap', type: 'warn', message: 'Please select a video layer first.' });
    if (selLayer.type !== 'video') {
      const msg = 'Time Remap is only supported on video layers!';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'Time Remap', type: 'warn', message: msg });
    }

    const pps = window.currentPixelsPerSecond || 80;
    const clipStart = selLayer.startSec !== undefined ? selLayer.startSec : ((selLayer.startPx || 0) / pps);
    const clipDur = selLayer.durationSec !== undefined ? selLayer.durationSec : ((selLayer.widthPx || 400) / pps);
    const clipEnd = clipStart + clipDur;
    const srcOffset = selLayer.sourceOffsetSec || 0;

    const allBeatmarks = (Array.isArray(window.currentProjectState.beatmarks) ? window.currentProjectState.beatmarks : [])
      .concat(Array.isArray(selLayer.markers) ? selLayer.markers.map(m => typeof m === 'number' ? m : m.time) : []);
    const bms = Array.from(new Set(allBeatmarks))
      .filter(t => t > clipStart + 0.04 && t < clipEnd - 0.04)
      .sort((a, b) => a - b);

    if (bms.length === 0) {
      const msg = 'Please place at least one beatmark inside the video layer for Time Remap velocity.';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'Time Remap', type: 'warn', message: msg });
    }

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    selLayer.speedMode = 'time_remap';
    if (!selLayer.keyframes) selLayer.keyframes = {};

    const times = [clipStart, ...bms, clipEnd];
    const slowmoEasing = [0.2, 0.8, 0.8, 0.2]; // Matching original JSX repo avgSpeed * 4, 20% influence curve

    const kfs = [];
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const localOffset = t - clipStart;
      const val = Number((srcOffset + localOffset).toFixed(3));
      kfs.push({
        time: Number(t.toFixed(3)),
        value: { timeRemap: val },
        easing: (i < times.length - 1) ? slowmoEasing : [0.0, 0.0, 1.0, 1.0]
      });
    }

    selLayer.keyframes.timeRemap = kfs;
    selLayer.timeRemap = srcOffset;

    if (typeof window.syncSpeedControllerValues === 'function') window.syncSpeedControllerValues();
    if (typeof window.updateSpeedKeyframeBtnState === 'function') window.updateSpeedKeyframeBtnState();
    if (typeof window.updateTimelineKeyframeMarkersHighlight === 'function') window.updateTimelineKeyframeMarkersHighlight();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(selLayer);
    if (typeof window.redrawComposition === 'function') window.redrawComposition('timeremap-velocity');
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers(true);
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Time Remap Slow-Mo Graph Applied');
    return JSON.stringify({ error: false, message: 'Time Remap velocity applied' });
  }

  // --- BEAT EFFECT: GHOST ---
  function applyBeatGhostEffect() {
    const pps = window.currentPixelsPerSecond || 80;
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
    const startSec = curSec;
    const durationSec = 0.7714;
    const t1 = Number((startSec + 0.0598).toFixed(4));
    const t2 = Number((startSec + 0.7733).toFixed(4));
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Ghost Effect';
    adj.isDurationExplicit = true;

    const transformFx = {
      id: 'fx_transform_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'transform',
      name: 'Transform',
      isExpanded: true,
      disabled: false,
      posX: 0,
      posY: 0,
      scale: 100,
      rotation: 0,
      skew: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 100
    };
    adj.effects = [transformFx];

    const easeGhost = [0, 0, 0.2, 1];

    adj.keyframes = {
      [`${transformFx.id}:scale`]: [
        { time: t1, value: { scale: 100 }, easing: [...easeGhost] },
        { time: t2, value: { scale: 220 }, easing: [...easeGhost] }
      ],
      [`${transformFx.id}:opacity`]: [],
      opacity: [
        { time: t1, value: { opacity: 1 }, easing: [...easeGhost] },
        { time: t2, value: { opacity: 0 }, easing: [...easeGhost] }
      ]
    };

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${transformFx.id}:scale`] = [...easeGhost];
    adj.defaultEasing[`${transformFx.id}:opacity`] = [...easeGhost];
    adj.defaultEasing['opacity'] = [...easeGhost];
    adj._defaultEasing = adj.defaultEasing;

    // Position above selected layer
    if (selId && selId !== adj.id) {
      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(adj.id, false);
    } else {
      window.selectedLayerId = adj.id;
      if (window.selectedLayerIds) {
        window.selectedLayerIds.clear();
        window.selectedLayerIds.add(adj.id);
      }
    }

    window.activeKeyframeProperty = `${transformFx.id}:scale`;
    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(adj);
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyBeatGhostEffect');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Ghost Effect applied');
    return JSON.stringify({ error: false, message: 'Ghost Effect applied', layerId: adj.id });
  }

  // --- BEAT EFFECT: WAVE WARP ---
  function applyBeatWarpEffect(customFrames = 8) {
    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
    const frames = (typeof customFrames === 'number' && customFrames > 0) ? customFrames : 8;
    const durationSec = Number((frames / fps).toFixed(3)); // 8 frames (punchy beat warp matching OpenFishTools)
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, curSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Warp Effect';

    const fx = (window.FishEffects && window.FishEffects.registry && typeof window.FishEffects.registry.createInstance === 'function')
      ? window.FishEffects.registry.createInstance('wave-warp')
      : null;
    const waveWarpFx = fx || {
      id: 'fx_wave_warp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'smooth-noise',
      waveHeight: 19,
      waveWidth: 10,
      direction: 90,
      speed: 0,
      phase: 0,
      tile: 1
    };
    waveWarpFx.waveType = 'smooth-noise';
    waveWarpFx.waveHeight = 19;
    waveWarpFx.waveWidth = 10;
    waveWarpFx.direction = 90;
    waveWarpFx.speed = 0;
    waveWarpFx.tile = 1;
    adj.effects = [waveWarpFx];

    const easeOut = [0.0, 0.0, 0.2, 1.0];
    const endTime = Number((curSec + durationSec).toFixed(3));

    adj.keyframes = {
      [`${waveWarpFx.id}:waveHeight`]: [
        { time: curSec, value: { waveHeight: 19 }, easing: [...easeOut] },
        { time: endTime, value: { waveHeight: 0 }, easing: [...easeOut] }
      ]
    };

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${waveWarpFx.id}:waveHeight`] = [...easeOut];
    adj._defaultEasing = adj.defaultEasing;

    // Position above selected layer
    if (selId && selId !== adj.id) {
      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(adj.id, false);
    } else {
      window.selectedLayerId = adj.id;
      if (window.selectedLayerIds) {
        window.selectedLayerIds.clear();
        window.selectedLayerIds.add(adj.id);
      }
    }

    window.activeKeyframeProperty = `${waveWarpFx.id}:waveHeight`;
    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(adj);
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyBeatWarpEffect');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Warp Effect applied');
    return JSON.stringify({ error: false, message: 'Warp Effect applied', layerId: adj.id });
  }

  // --- BEAT EFFECT: FISHEYE RIPPLE ---
  function applyBeatFisheyeEffect(scaleFactor = 2) {
    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
    const fd = 1 / fps;

    const sf = (typeof scaleFactor === 'number' && scaleFactor > 0) ? scaleFactor : 2;
    // Spaced keyframe offsets (-12f, -4f, 0, +12f, +28f, +44f at 2x) for smooth, visible ripple
    const rawOffsets = [-6, -2, 0, 6, 14, 22].map(v => Math.round(v * sf));
    const rawValues = [0, 15, -80, 15, -4, 0];

    const preFrames = Math.abs(rawOffsets[0]);
    const postFrames = rawOffsets[rawOffsets.length - 1] + 4;
    const totalFrames = preFrames + postFrames;

    const startSec = Math.max(0, Number((curSec - preFrames * fd).toFixed(3)));
    const durationSec = Number((totalFrames * fd).toFixed(3)); // 60 frames (~1.0s - 1.2s)
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Fish Eye Ripple';

    const fx = (window.FishEffects && window.FishEffects.registry && typeof window.FishEffects.registry.createInstance === 'function')
      ? window.FishEffects.registry.createInstance('warp')
      : null;
    const warpFx = fx || {
      id: 'fx_warp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'warp',
      name: 'Warp',
      isExpanded: true,
      disabled: false,
      warpStyle: 'fisheye',
      bend: -80,
      distortH: 0,
      distortV: 0
    };
    warpFx.warpStyle = 'fisheye';
    warpFx.bend = -80;
    adj.effects = [warpFx];

    const easyEase = [0.33, 0.0, 0.67, 1.0];

    const kfList = [];
    for (let i = 0; i < rawOffsets.length; i++) {
      const t = Math.max(0, Number((curSec + rawOffsets[i] * fd).toFixed(3)));
      if (kfList.length > 0 && Math.abs(kfList[kfList.length - 1].time - t) < 0.001) continue;
      kfList.push({
        time: t,
        value: { bend: rawValues[i] },
        easing: [...easyEase]
      });
    }

    adj.keyframes = {
      [`${warpFx.id}:bend`]: kfList
    };

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${warpFx.id}:bend`] = [...easyEase];
    adj._defaultEasing = adj.defaultEasing;

    // Position above selected layer
    if (selId && selId !== adj.id) {
      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(adj.id, false);
    } else {
      window.selectedLayerId = adj.id;
      if (window.selectedLayerIds) {
        window.selectedLayerIds.clear();
        window.selectedLayerIds.add(adj.id);
      }
    }

    window.activeKeyframeProperty = `${warpFx.id}:bend`;
    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(adj);
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyBeatFisheyeEffect');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Fish Eye Ripple applied');
    return JSON.stringify({ error: false, message: 'Fish Eye Ripple applied', layerId: adj.id });
  }

  // --- BEAT EFFECT: MID-WAVE ---
  function applyBeatMidwaveEffect() {
    const pps = window.currentPixelsPerSecond || 80;
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));

    const startSec = curSec;
    const durationSec = 1.5914;
    const t1 = Number(startSec.toFixed(4));
    const t2 = Number((startSec + 0.3667).toFixed(4));
    const t3 = Number((startSec + 1.5914).toFixed(4));
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Mid-Wave';
    adj.isDurationExplicit = true;
    adj.direction = 45;
    adj.waveHeight = 85;
    adj.waveWidth = 1797;
    adj.speed = 1.6;

    const ww1 = {
      id: 'fx_wave_warp_' + Date.now() + '_1_' + Math.random().toString(36).substring(2, 6),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 1797,
      direction: 45,
      speed: 1.6,
      phase: 0,
      tile: 1
    };

    const ww2 = {
      id: 'fx_wave_warp_' + Date.now() + '_2_' + Math.random().toString(36).substring(2, 6),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 1797,
      direction: -216,
      speed: 1.6,
      phase: 0,
      tile: 1
    };

    adj.effects = [ww1, ww2];

    const kfList1 = [
      { time: t1, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] },
      { time: t2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.224, 1] },
      { time: t3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
    ];
    const kfList2 = [
      { time: t1, value: { waveHeight: 0 }, easing: [0.368, 0.37, 0.702, 0.682] },
      { time: t2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.138, 1] },
      { time: t3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
    ];

    adj.keyframes = {
      [`${ww1.id}:waveWidth`]: [],
      [`${ww1.id}:waveHeight`]: kfList1,
      [`${ww2.id}:waveHeight`]: kfList2
    };

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${ww1.id}:waveWidth`] = [0, 0, 1, 1];
    adj.defaultEasing[`${ww1.id}:waveHeight`] = [0.002, 1, 0.224, 1];
    adj.defaultEasing[`${ww2.id}:waveHeight`] = [0.002, 1, 0.138, 1];
    adj._defaultEasing = adj.defaultEasing;

    // Position above selected layer
    if (selId && selId !== adj.id) {
      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(adj.id, false);
    } else {
      window.selectedLayerId = adj.id;
      if (window.selectedLayerIds) {
        window.selectedLayerIds.clear();
        window.selectedLayerIds.add(adj.id);
      }
    }

    window.activeKeyframeProperty = `${ww1.id}:waveHeight`;
    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(adj);
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyBeatMidwaveEffect');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Mid-Wave applied');
    return JSON.stringify({ error: false, message: 'Mid-Wave applied', layerId: adj.id });
  }

  // --- BEAT EFFECT: HUE SPIN ---
  function applyBeatHuespinEffect() {
    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
    const curSec = Number((Math.abs(window.timelinePanX || 0) / pps).toFixed(3));
    const fd = 1 / fps;

    // AE _HUESPIN(): duration = 25 * fd; masterHue 0 -> 360 linear
    const durationSec = Number((25 * fd).toFixed(3));
    const startSec = curSec;
    const endSec = Number((curSec + durationSec).toFixed(3));
    const selId = window.selectedLayerId;

    const adj = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(durationSec, startSec) : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Hue Spin';

    const hueFx = {
      id: 'fx_hue_shift_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'hue-shift',
      name: 'Hue Shift',
      isExpanded: true,
      disabled: false,
      hue: 0
    };
    adj.effects = [hueFx];

    const linearEase = [0.0, 0.0, 1.0, 1.0];
    adj.keyframes = {
      [`${hueFx.id}:hue`]: [
        { time: startSec, value: { hue: 0 }, easing: [...linearEase] },
        { time: endSec, value: { hue: 360 }, easing: [...linearEase] }
      ]
    };

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[`${hueFx.id}:hue`] = [...linearEase];
    adj._defaultEasing = adj.defaultEasing;

    // Position above selected layer
    if (selId && selId !== adj.id) {
      const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(adj.id, false);
    } else {
      window.selectedLayerId = adj.id;
      if (window.selectedLayerIds) {
        window.selectedLayerIds.clear();
        window.selectedLayerIds.add(adj.id);
      }
    }

    window.activeKeyframeProperty = `${hueFx.id}:hue`;
    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(adj);
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyBeatHuespinEffect');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Hue Spin applied');
    return JSON.stringify({ error: false, message: 'Hue Spin applied', layerId: adj.id });
  }

  // --- PRESET: WARP1 ---
  function applyPresetWarp1() {
    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function')
      ? window.getProjectFps()
      : ((window.currentProjectState && parseInt(window.currentProjectState.fps, 10)) || 60);

    // CRITICAL: Always obtain the true timeline playhead position
    // Never read volatile window.currentSec directly because background frame caching/export overwrites it.
    const curPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
    const rawPlayheadSec = (typeof window.getCurrentPlayheadTime === 'function')
      ? window.getCurrentPlayheadTime()
      : (typeof window.getTimelineCurrentSec === 'function')
        ? window.getTimelineCurrentSec()
        : Math.max(0, -curPanX / pps);

    // Frame-snap to exact project frame to eliminate sub-frame drift across all zoom levels
    const curFrame = Math.round(rawPlayheadSec * fps);
    const curSec = Number((curFrame / fps).toFixed(4));

    const selId = window.selectedLayerId;
    const createdLayers = [];

    const uid = (prefix) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    // 1. Layer: Mid-Wave
    // Preset timing: ramp-up starts 22 frames before impact (0.3667s @ 60fps), peak lands exactly on curSec
    const midwavePreFrames = Math.round(0.3667 * fps);
    const midwaveStartFrame = Math.max(0, curFrame - midwavePreFrames);
    const midwaveStart = Number((midwaveStartFrame / fps).toFixed(4));
    const midwaveDur = 1.5914;
    const mwT1 = midwaveStart;
    const mwT2 = curSec; // Peak hits precisely on playhead frame
    const mwT3 = Number((midwaveStart + midwaveDur).toFixed(4));

    const adjMidwave = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(midwaveDur, midwaveStart) : null;
    if (!adjMidwave) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adjMidwave.name = 'Mid-Wave';
    adjMidwave.isDurationExplicit = true;
    adjMidwave.direction = 45;
    adjMidwave.waveHeight = 85;
    adjMidwave.waveWidth = 1797;
    adjMidwave.speed = 1.6;

    const ww1 = {
      id: uid('fx_wave_warp_1'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 1797,
      direction: 45,
      speed: 1.6,
      phase: 0,
      tile: 1
    };

    const ww2 = {
      id: uid('fx_wave_warp_2'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 1797,
      direction: -216,
      speed: 1.6,
      phase: 0,
      tile: 1
    };

    adjMidwave.effects = [ww1, ww2];
    adjMidwave.keyframes = {
      [`${ww1.id}:waveWidth`]: [],
      [`${ww1.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.224, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ],
      [`${ww2.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.138, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ]
    };
    adjMidwave.defaultEasing = {
      [`${ww1.id}:waveWidth`]: [0, 0, 1, 1],
      [`${ww1.id}:waveHeight`]: [0.002, 1, 0.224, 1],
      [`${ww2.id}:waveHeight`]: [0.002, 1, 0.138, 1]
    };
    adjMidwave._defaultEasing = adjMidwave.defaultEasing;
    createdLayers.push(adjMidwave);

    // 2. Layer: Ghost Effect
    // Preset timing: starts directly on curSec, kf1 at curSec (scale: 100, op: 1), kf2 at curSec + 0.7135s (scale: 220, op: 0)
    const ghostStart = curSec;
    const ghostDur = 0.7714;
    const ghT1 = curSec;
    const ghT2 = Number((curSec + 0.7135).toFixed(4));

    const adjGhost = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(ghostDur, ghostStart) : null;
    if (adjGhost) {
      adjGhost.name = 'Ghost Effect';
      adjGhost.isDurationExplicit = true;

      const transformFx = {
        id: uid('fx_transform'),
        type: 'transform',
        name: 'Transform',
        isExpanded: true,
        disabled: false,
        posX: 0,
        posY: 0,
        scale: 100,
        rotation: 0,
        skew: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 100
      };
      adjGhost.effects = [transformFx];

      const easeGhost = [0, 0, 0.2, 1];
      adjGhost.keyframes = {
        [`${transformFx.id}:scale`]: [
          { time: ghT1, value: { scale: 100 }, easing: [...easeGhost] },
          { time: ghT2, value: { scale: 220 }, easing: [...easeGhost] }
        ],
        [`${transformFx.id}:opacity`]: [],
        opacity: [
          { time: ghT1, value: { opacity: 1 }, easing: [...easeGhost] },
          { time: ghT2, value: { opacity: 0 }, easing: [...easeGhost] }
        ]
      };
      adjGhost.defaultEasing = {
        [`${transformFx.id}:scale`]: [...easeGhost],
        [`${transformFx.id}:opacity`]: [...easeGhost],
        opacity: [...easeGhost]
      };
      adjGhost._defaultEasing = adjGhost.defaultEasing;
      createdLayers.push(adjGhost);
    }

    // 3. Layer: Hue Spin
    // Preset timing: starts on curSec, dur = 0.7125s, kf1 at curSec (val: 0), kf2 at curSec + 0.417s (val: 360)
    const hueStart = curSec;
    const hueDur = 0.7125;
    const hueT1 = curSec;
    const hueT2 = Number((curSec + 0.417).toFixed(4));

    const adjHue = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(hueDur, hueStart) : null;
    if (adjHue) {
      adjHue.name = 'Hue Spin';
      adjHue.isDurationExplicit = true;

      const hueFx = {
        id: uid('fx_hue_shift'),
        type: 'hue-shift',
        name: 'Hue Shift',
        isExpanded: true,
        disabled: false,
        hue: 0
      };
      adjHue.effects = [hueFx];

      const linearEase = [0, 0, 1, 1];
      adjHue.keyframes = {
        [`${hueFx.id}:hue`]: [
          { time: hueT1, value: { hue: 0 }, easing: [...linearEase] },
          { time: hueT2, value: { hue: 360 }, easing: [...linearEase] }
        ]
      };
      adjHue.defaultEasing = {
        [`${hueFx.id}:hue`]: [...linearEase]
      };
      adjHue._defaultEasing = adjHue.defaultEasing;
      createdLayers.push(adjHue);
    }

    // 4. Layer: Warp Effect
    // Preset timing: starts on curSec, dur = 0.133s (8 frames @ 60fps), kf1 at curSec (val: 19), kf2 at curSec + 0.133s (val: 0)
    const warpStart = curSec;
    const warpDur = 0.133;
    const warpT1 = warpStart;
    const warpT2 = Number((warpStart + warpDur).toFixed(4));

    const adjWarp = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(warpDur, warpStart) : null;
    if (adjWarp) {
      adjWarp.name = 'Warp Effect';

      const warpWw = {
        id: uid('fx_wave_warp'),
        type: 'wave-warp',
        name: 'Wave Warp',
        isExpanded: true,
        disabled: false,
        waveType: 'smooth-noise',
        waveHeight: 19,
        waveWidth: 10,
        direction: 90,
        speed: 0,
        phase: 0,
        tile: 1
      };
      adjWarp.effects = [warpWw];

      const easeOut = [0, 0, 0.2, 1];
      adjWarp.keyframes = {
        [`${warpWw.id}:waveHeight`]: [
          { time: warpT1, value: { waveHeight: 19 }, easing: [...easeOut] },
          { time: warpT2, value: { waveHeight: 0 }, easing: [...easeOut] }
        ]
      };
      adjWarp.defaultEasing = {
        [`${warpWw.id}:waveHeight`]: [...easeOut]
      };
      adjWarp._defaultEasing = adjWarp.defaultEasing;
      createdLayers.push(adjWarp);
    }

    // Timeline stacking order matching Photo 1: [Warp Effect, Ghost Effect, Hue Spin, Mid-Wave] from top to bottom
    const stackInOrder = [adjWarp, adjGhost, adjHue, adjMidwave].filter(Boolean);
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];

    const idsToRemove = new Set(createdLayers.map(l => l.id));
    for (let i = layers.length - 1; i >= 0; i--) {
      if (idsToRemove.has(layers[i].id)) {
        layers.splice(i, 1);
      }
    }

    if (selId) {
      const selIdx = layers.findIndex(l => l.id === selId);
      if (selIdx >= 0) {
        layers.splice(selIdx, 0, ...stackInOrder);
      } else {
        layers.unshift(...stackInOrder);
      }
    } else {
      layers.unshift(...stackInOrder);
    }

    const topLayer = adjWarp || adjMidwave;
    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(topLayer.id, false);
    }
    if (window.selectedLayerIds) {
      window.selectedLayerIds.clear();
      createdLayers.forEach(l => window.selectedLayerIds.add(l.id));
    }
    window.selectedLayerId = topLayer.id;

    createdLayers.forEach(l => {
      if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(l);
    });

    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyPresetWarp1');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Preset Warp1 applied');

    return JSON.stringify({
      error: false,
      message: 'Preset Warp1 applied',
      layerIds: createdLayers.map(l => l.id)
    });
  }

  // --- PRESET: WARP2 ---
  function applyPresetWarp2() {
    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function')
      ? window.getProjectFps()
      : ((window.currentProjectState && parseInt(window.currentProjectState.fps, 10)) || 60);

    // CRITICAL: Always obtain the true timeline playhead position
    const curPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
    const rawPlayheadSec = (typeof window.getCurrentPlayheadTime === 'function')
      ? window.getCurrentPlayheadTime()
      : (typeof window.getTimelineCurrentSec === 'function')
        ? window.getTimelineCurrentSec()
        : Math.max(0, -curPanX / pps);

    // Frame-snap to exact project frame to eliminate sub-frame drift across all zoom levels
    const curFrame = Math.round(rawPlayheadSec * fps);
    const curSec = Number((curFrame / fps).toFixed(4));

    const selId = window.selectedLayerId;
    const createdLayers = [];

    const uid = (prefix) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    // 1. Layer: Mid-Wave (WARP2 parameters: direction 306/49, waveWidth 2652/2392, phase -75/-27)
    const midwavePreFrames = Math.round(0.3667 * fps);
    const midwaveStartFrame = Math.max(0, curFrame - midwavePreFrames);
    const midwaveStart = Number((midwaveStartFrame / fps).toFixed(4));
    const midwaveDur = 1.5914;
    const mwT1 = midwaveStart;
    const mwT2 = curSec; // Peak hits precisely on playhead frame
    const mwT3 = Number((midwaveStart + midwaveDur).toFixed(4));

    const adjMidwave = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(midwaveDur, midwaveStart) : null;
    if (!adjMidwave) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adjMidwave.name = 'Mid-Wave';
    adjMidwave.isDurationExplicit = true;
    adjMidwave.direction = 306;
    adjMidwave.waveHeight = 85;
    adjMidwave.waveWidth = 2652;
    adjMidwave.speed = 1.6;

    const ww1 = {
      id: uid('fx_wave_warp_1'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 2652,
      direction: 306,
      speed: 1.6,
      phase: -75,
      tile: 1
    };

    const ww2 = {
      id: uid('fx_wave_warp_2'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 2392,
      direction: 49,
      speed: 1.6,
      phase: -27,
      tile: 1
    };

    adjMidwave.effects = [ww1, ww2];
    adjMidwave.keyframes = {
      [`${ww1.id}:waveWidth`]: [],
      [`${ww1.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.224, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ],
      [`${ww2.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.138, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ]
    };
    adjMidwave.defaultEasing = {
      [`${ww1.id}:waveWidth`]: [0, 0, 1, 1],
      [`${ww1.id}:waveHeight`]: [0.002, 1, 0.224, 1],
      [`${ww2.id}:waveHeight`]: [0.002, 1, 0.138, 1]
    };
    adjMidwave._defaultEasing = adjMidwave.defaultEasing;
    createdLayers.push(adjMidwave);

    // 2. Layer: Ghost Effect
    const ghostStart = curSec;
    const ghostDur = 0.7714;
    const ghT1 = curSec;
    const ghT2 = Number((curSec + 0.7135).toFixed(4));

    const adjGhost = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(ghostDur, ghostStart) : null;
    if (adjGhost) {
      adjGhost.name = 'Ghost Effect';
      adjGhost.isDurationExplicit = true;

      const transformFx = {
        id: uid('fx_transform'),
        type: 'transform',
        name: 'Transform',
        isExpanded: true,
        disabled: false,
        posX: 0,
        posY: 0,
        scale: 100,
        rotation: 0,
        skew: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 100
      };
      adjGhost.effects = [transformFx];

      const easeGhost = [0, 0, 0.2, 1];
      adjGhost.keyframes = {
        [`${transformFx.id}:scale`]: [
          { time: ghT1, value: { scale: 100 }, easing: [...easeGhost] },
          { time: ghT2, value: { scale: 220 }, easing: [...easeGhost] }
        ],
        [`${transformFx.id}:opacity`]: [],
        opacity: [
          { time: ghT1, value: { opacity: 1 }, easing: [...easeGhost] },
          { time: ghT2, value: { opacity: 0 }, easing: [...easeGhost] }
        ]
      };
      adjGhost.defaultEasing = {
        [`${transformFx.id}:scale`]: [...easeGhost],
        [`${transformFx.id}:opacity`]: [...easeGhost],
        opacity: [...easeGhost]
      };
      adjGhost._defaultEasing = adjGhost.defaultEasing;
      createdLayers.push(adjGhost);
    }

    // 3. Layer: Hue Spin
    const hueStart = curSec;
    const hueDur = 0.7125;
    const hueT1 = curSec;
    const hueT2 = Number((curSec + 0.417).toFixed(4));

    const adjHue = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(hueDur, hueStart) : null;
    if (adjHue) {
      adjHue.name = 'Hue Spin';
      adjHue.isDurationExplicit = true;

      const hueFx = {
        id: uid('fx_hue_shift'),
        type: 'hue-shift',
        name: 'Hue Shift',
        isExpanded: true,
        disabled: false,
        hue: 0
      };
      adjHue.effects = [hueFx];

      const linearEase = [0, 0, 1, 1];
      adjHue.keyframes = {
        [`${hueFx.id}:hue`]: [
          { time: hueT1, value: { hue: 0 }, easing: [...linearEase] },
          { time: hueT2, value: { hue: 360 }, easing: [...linearEase] }
        ]
      };
      adjHue.defaultEasing = {
        [`${hueFx.id}:hue`]: [...linearEase]
      };
      adjHue._defaultEasing = adjHue.defaultEasing;
      createdLayers.push(adjHue);
    }

    // 4. Layer: Warp Effect
    const warpStart = curSec;
    const warpDur = 0.133;
    const warpT1 = warpStart;
    const warpT2 = Number((curSec + warpDur).toFixed(4));

    const adjWarp = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(warpDur, warpStart) : null;
    if (adjWarp) {
      adjWarp.name = 'Warp Effect';

      const warpWw = {
        id: uid('fx_wave_warp'),
        type: 'wave-warp',
        name: 'Wave Warp',
        isExpanded: true,
        disabled: false,
        waveType: 'smooth-noise',
        waveHeight: 19,
        waveWidth: 10,
        direction: 90,
        speed: 0,
        phase: 0,
        tile: 1
      };
      adjWarp.effects = [warpWw];

      const easeOut = [0, 0, 0.2, 1];
      adjWarp.keyframes = {
        [`${warpWw.id}:waveHeight`]: [
          { time: warpT1, value: { waveHeight: 19 }, easing: [...easeOut] },
          { time: warpT2, value: { waveHeight: 0 }, easing: [...easeOut] }
        ]
      };
      adjWarp.defaultEasing = {
        [`${warpWw.id}:waveHeight`]: [...easeOut]
      };
      adjWarp._defaultEasing = adjWarp.defaultEasing;
      createdLayers.push(adjWarp);
    }

    // Timeline stacking order: [Warp Effect, Ghost Effect, Hue Spin, Mid-Wave] from top to bottom
    const stackInOrder = [adjWarp, adjGhost, adjHue, adjMidwave].filter(Boolean);
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];

    const idsToRemove = new Set(createdLayers.map(l => l.id));
    for (let i = layers.length - 1; i >= 0; i--) {
      if (idsToRemove.has(layers[i].id)) {
        layers.splice(i, 1);
      }
    }

    if (selId) {
      const selIdx = layers.findIndex(l => l.id === selId);
      if (selIdx >= 0) {
        layers.splice(selIdx, 0, ...stackInOrder);
      } else {
        layers.unshift(...stackInOrder);
      }
    } else {
      layers.unshift(...stackInOrder);
    }

    const topLayer = adjWarp || adjMidwave;
    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(topLayer.id, false);
    }
    if (window.selectedLayerIds) {
      window.selectedLayerIds.clear();
      createdLayers.forEach(l => window.selectedLayerIds.add(l.id));
    }
    window.selectedLayerId = topLayer.id;

    createdLayers.forEach(l => {
      if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(l);
    });

    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyPresetWarp2');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Preset Warp2 applied');

    return JSON.stringify({
      error: false,
      message: 'Preset Warp2 applied',
      layerIds: createdLayers.map(l => l.id)
    });
  }

  // --- PRESET: WARP3 ---
  function applyPresetWarp3() {
    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function')
      ? window.getProjectFps()
      : ((window.currentProjectState && parseInt(window.currentProjectState.fps, 10)) || 60);

    // CRITICAL: Always obtain the true timeline playhead position
    const curPanX = window.timelinePanX !== undefined ? window.timelinePanX : 0;
    const rawPlayheadSec = (typeof window.getCurrentPlayheadTime === 'function')
      ? window.getCurrentPlayheadTime()
      : (typeof window.getTimelineCurrentSec === 'function')
        ? window.getTimelineCurrentSec()
        : Math.max(0, -curPanX / pps);

    // Frame-snap to exact project frame to eliminate sub-frame drift across all zoom levels
    const curFrame = Math.round(rawPlayheadSec * fps);
    const curSec = Number((curFrame / fps).toFixed(4));

    const selId = window.selectedLayerId;
    const createdLayers = [];

    const uid = (prefix) => prefix + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    // 1. Layer: Mid-Wave (WARP3 parameters: direction -346/460, speed 0.6/-2.28, phase -73/0, waveWidth 2652/2392)
    const midwavePreFrames = Math.round(0.3667 * fps);
    const midwaveStartFrame = Math.max(0, curFrame - midwavePreFrames);
    const midwaveStart = Number((midwaveStartFrame / fps).toFixed(4));
    const midwaveDur = 1.5914;
    const mwT1 = midwaveStart;
    const mwT2 = curSec; // Peak hits precisely on playhead frame
    const mwT3 = Number((midwaveStart + midwaveDur).toFixed(4));

    const adjMidwave = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(midwaveDur, midwaveStart) : null;
    if (!adjMidwave) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adjMidwave.name = 'Mid-Wave';
    adjMidwave.isDurationExplicit = true;
    adjMidwave.direction = -346;
    adjMidwave.waveHeight = 85;
    adjMidwave.waveWidth = 2652;
    adjMidwave.speed = 0.6;

    const ww1 = {
      id: uid('fx_wave_warp_1'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 2652,
      direction: -346,
      speed: 0.6,
      phase: -73,
      tile: 1
    };

    const ww2 = {
      id: uid('fx_wave_warp_2'),
      type: 'wave-warp',
      name: 'Wave Warp',
      isExpanded: true,
      disabled: false,
      waveType: 'sine',
      waveHeight: 85,
      waveWidth: 2392,
      direction: 460,
      speed: -2.28,
      phase: 0,
      tile: 1
    };

    adjMidwave.effects = [ww1, ww2];
    adjMidwave.keyframes = {
      [`${ww1.id}:waveWidth`]: [],
      [`${ww1.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.224, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ],
      [`${ww2.id}:waveHeight`]: [
        { time: mwT1, value: { waveHeight: 0 }, easing: [0, 0, 1, 0] },
        { time: mwT2, value: { waveHeight: 85 }, easing: [0.002, 1, 0.138, 1] },
        { time: mwT3, value: { waveHeight: 0 }, easing: [0, 0, 1, 1] }
      ]
    };
    adjMidwave.defaultEasing = {
      [`${ww1.id}:waveWidth`]: [0, 0, 1, 1],
      [`${ww1.id}:waveHeight`]: [0.002, 1, 0.224, 1],
      [`${ww2.id}:waveHeight`]: [0.002, 1, 0.138, 1]
    };
    adjMidwave._defaultEasing = adjMidwave.defaultEasing;
    createdLayers.push(adjMidwave);

    // 2. Layer: Ghost Effect
    const ghostStart = curSec;
    const ghostDur = 0.7714;
    const ghT1 = curSec;
    const ghT2 = Number((curSec + 0.7135).toFixed(4));

    const adjGhost = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(ghostDur, ghostStart) : null;
    if (adjGhost) {
      adjGhost.name = 'Ghost Effect';
      adjGhost.isDurationExplicit = true;

      const transformFx = {
        id: uid('fx_transform'),
        type: 'transform',
        name: 'Transform',
        isExpanded: true,
        disabled: false,
        posX: 0,
        posY: 0,
        scale: 100,
        rotation: 0,
        skew: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 100
      };
      adjGhost.effects = [transformFx];

      const easeGhost = [0, 0, 0.2, 1];
      adjGhost.keyframes = {
        [`${transformFx.id}:scale`]: [
          { time: ghT1, value: { scale: 100 }, easing: [...easeGhost] },
          { time: ghT2, value: { scale: 220 }, easing: [...easeGhost] }
        ],
        [`${transformFx.id}:opacity`]: [],
        opacity: [
          { time: ghT1, value: { opacity: 1 }, easing: [...easeGhost] },
          { time: ghT2, value: { opacity: 0 }, easing: [...easeGhost] }
        ]
      };
      adjGhost.defaultEasing = {
        [`${transformFx.id}:scale`]: [...easeGhost],
        [`${transformFx.id}:opacity`]: [...easeGhost],
        opacity: [...easeGhost]
      };
      adjGhost._defaultEasing = adjGhost.defaultEasing;
      createdLayers.push(adjGhost);
    }

    // 3. Layer: Hue Spin
    const hueStart = curSec;
    const hueDur = 0.7125;
    const hueT1 = curSec;
    const hueT2 = Number((curSec + 0.417).toFixed(4));

    const adjHue = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(hueDur, hueStart) : null;
    if (adjHue) {
      adjHue.name = 'Hue Spin';
      adjHue.isDurationExplicit = true;

      const hueFx = {
        id: uid('fx_hue_shift'),
        type: 'hue-shift',
        name: 'Hue Shift',
        isExpanded: true,
        disabled: false,
        hue: 0
      };
      adjHue.effects = [hueFx];

      const linearEase = [0, 0, 1, 1];
      adjHue.keyframes = {
        [`${hueFx.id}:hue`]: [
          { time: hueT1, value: { hue: 0 }, easing: [...linearEase] },
          { time: hueT2, value: { hue: 360 }, easing: [...linearEase] }
        ]
      };
      adjHue.defaultEasing = {
        [`${hueFx.id}:hue`]: [...linearEase]
      };
      adjHue._defaultEasing = adjHue.defaultEasing;
      createdLayers.push(adjHue);
    }

    // 4. Layer: Warp Effect
    const warpStart = curSec;
    const warpDur = 0.133;
    const warpT1 = warpStart;
    const warpT2 = Number((curSec + warpDur).toFixed(4));

    const adjWarp = (typeof window.addAdjustmentLayer === 'function') ? window.addAdjustmentLayer(warpDur, warpStart) : null;
    if (adjWarp) {
      adjWarp.name = 'Warp Effect';

      const warpWw = {
        id: uid('fx_wave_warp'),
        type: 'wave-warp',
        name: 'Wave Warp',
        isExpanded: true,
        disabled: false,
        waveType: 'smooth-noise',
        waveHeight: 19,
        waveWidth: 10,
        direction: 90,
        speed: 0,
        phase: 0,
        tile: 1
      };
      adjWarp.effects = [warpWw];

      const easeOut = [0, 0, 0.2, 1];
      adjWarp.keyframes = {
        [`${warpWw.id}:waveHeight`]: [
          { time: warpT1, value: { waveHeight: 19 }, easing: [...easeOut] },
          { time: warpT2, value: { waveHeight: 0 }, easing: [...easeOut] }
        ]
      };
      adjWarp.defaultEasing = {
        [`${warpWw.id}:waveHeight`]: [...easeOut]
      };
      adjWarp._defaultEasing = adjWarp.defaultEasing;
      createdLayers.push(adjWarp);
    }

    // Timeline stacking order: [Warp Effect, Ghost Effect, Hue Spin, Mid-Wave] from top to bottom
    const stackInOrder = [adjWarp, adjGhost, adjHue, adjMidwave].filter(Boolean);
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];

    const idsToRemove = new Set(createdLayers.map(l => l.id));
    for (let i = layers.length - 1; i >= 0; i--) {
      if (idsToRemove.has(layers[i].id)) {
        layers.splice(i, 1);
      }
    }

    if (selId) {
      const selIdx = layers.findIndex(l => l.id === selId);
      if (selIdx >= 0) {
        layers.splice(selIdx, 0, ...stackInOrder);
      } else {
        layers.unshift(...stackInOrder);
      }
    } else {
      layers.unshift(...stackInOrder);
    }

    const topLayer = adjWarp || adjMidwave;
    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(topLayer.id, false);
    }
    if (window.selectedLayerIds) {
      window.selectedLayerIds.clear();
      createdLayers.forEach(l => window.selectedLayerIds.add(l.id));
    }
    window.selectedLayerId = topLayer.id;

    createdLayers.forEach(l => {
      if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(l);
    });

    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyPresetWarp3');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Preset Warp3 applied');

    return JSON.stringify({
      error: false,
      message: 'Preset Warp3 applied',
      layerIds: createdLayers.map(l => l.id)
    });
  }

  // --- BEAT EFFECT: FLASH (EXPOSURE FLASH BEAT) ---
  function applyBeatFlashEffect() {
    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function')
      ? window.getProjectFps()
      : ((window.currentProjectState && parseInt(window.currentProjectState.fps, 10)) || 60);
    const fd = 1 / fps;

    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
    const selLayer = layers.find(l => l.id === selId);

    if (!selLayer) {
      const msg = 'Please select a layer first to apply Flash.';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'EXPO', type: 'warn', message: msg });
    }

    const startSec = selLayer.startSec !== undefined ? selLayer.startSec : ((selLayer.startPx || 0) / pps);
    const durationSec = selLayer.durationSec !== undefined ? selLayer.durationSec : ((selLayer.widthPx || 320) / pps);
    const endSec = Number((startSec + durationSec).toFixed(4));

    // Gather timeline beatmarks inside the selected layer duration
    let rawMarkers = [];
    if (Array.isArray(selLayer.markers) && selLayer.markers.length > 0) {
      rawMarkers = rawMarkers.concat(selLayer.markers.map(m => (typeof m === 'number' ? m : (m.time || 0))));
    }
    const pState = window.currentProjectState;
    if (pState && Array.isArray(pState.beatmarks) && pState.beatmarks.length > 0) {
      rawMarkers = rawMarkers.concat(pState.beatmarks);
    }
    if (Array.isArray(window.beatmarks) && window.beatmarks.length > 0) {
      rawMarkers = rawMarkers.concat(window.beatmarks);
    }
    const allBeatmarks = Array.from(new Set(rawMarkers.map(m => Number(m.toFixed(4)))))
      .filter(b => b >= (startSec - 0.001) && b <= (endSec + 0.001))
      .sort((a, b) => a - b);

    if (allBeatmarks.length === 0) {
      const msg = 'Please place beatmarks across the selected layer first.';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'EXPO', type: 'warn', message: msg });
    }

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    // 1. Create Adjustment layer matching selected layer timing
    const adj = (typeof window.addAdjustmentLayer === 'function')
      ? window.addAdjustmentLayer(durationSec, startSec)
      : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = 'Exposure Flash Beat';

    // 2. Add Exposure / Gamma effect
    const fx = (window.FishEffects && window.FishEffects.registry && typeof window.FishEffects.registry.createInstance === 'function')
      ? window.FishEffects.registry.createInstance('exposure-gamma')
      : null;
    const expoFx = fx || {
      id: 'fx_exposure_gamma_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'exposure-gamma',
      name: 'Exposure / Gamma',
      isExpanded: true,
      disabled: false,
      exposure: 0,
      gamma: 0,
      offset: 0
    };
    expoFx.exposure = 0;
    expoFx.gamma = 0;
    expoFx.offset = 0;
    adj.effects = [expoFx];

    // 3. Build Keyframes:
    // - Tepat di beatmark: exposure = 0.5
    // - Mundur 1 frame sebelum beatmark: exposure = 0.0
    // - Flash decay cepat setelah beatmark: exposure = 0.0
    const easeFlashOut = [0.0, 0.0, 0.2, 1.0];
    const linearEase = [0.0, 0.0, 1.0, 1.0];
    const rawKfs = [];

    // Base start at 0 if first beatmark is after layer start
    if (allBeatmarks[0] - fd > startSec + 0.001) {
      rawKfs.push({ time: Number(startSec.toFixed(4)), value: { exposure: 0.0 }, easing: [...linearEase] });
    }

    allBeatmarks.forEach((bm, i) => {
      const nextBm = (i < allBeatmarks.length - 1) ? allBeatmarks[i + 1] : endSec;

      // 1 frame mundur (belakang beatmark) = 0.0
      const tBefore = Number(Math.max(startSec, bm - fd).toFixed(4));
      rawKfs.push({
        time: tBefore,
        value: { exposure: 0.0 },
        easing: [...linearEase]
      });

      // Tepat di beatmark = 0.5
      const tBeat = Number(bm.toFixed(4));
      rawKfs.push({
        time: tBeat,
        value: { exposure: 0.5 },
        easing: [...easeFlashOut]
      });

      // Decay kembali ke 0.0 setelah beatmark (3-4 frame, tidak melewati beatmark berikutnya)
      const maxDecayTime = nextBm - fd;
      const decayDuration = Math.min(3.5 * fd, Math.max(fd, (nextBm - bm) * 0.45));
      const tDecay = Number(Math.min(endSec, Math.min(maxDecayTime, bm + decayDuration)).toFixed(4));
      if (tDecay > tBeat + 0.001) {
        rawKfs.push({
          time: tDecay,
          value: { exposure: 0.0 },
          easing: [...easeFlashOut]
        });
      }
    });

    // End at 0 if needed
    rawKfs.push({ time: Number(endSec.toFixed(4)), value: { exposure: 0.0 }, easing: [...linearEase] });

    // Sort & deduplicate close timestamps
    rawKfs.sort((a, b) => a.time - b.time);
    const kfs = [];
    rawKfs.forEach(kf => {
      const prev = kfs[kfs.length - 1];
      if (!prev || Math.abs(prev.time - kf.time) > 0.001) {
        kfs.push(kf);
      } else {
        if ((kf.value.exposure || 0) > (prev.value.exposure || 0)) {
          prev.value.exposure = kf.value.exposure;
        }
      }
    });

    const scopedKey = `${expoFx.id}:exposure`;
    adj.keyframes = {
      [scopedKey]: kfs,
      exposure: kfs
    };

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[scopedKey] = [...easeFlashOut];
    adj.defaultEasing['exposure'] = [...easeFlashOut];
    adj._defaultEasing = adj.defaultEasing;

    // Position adjustment layer right above selected layer
    if (selId && selId !== adj.id) {
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(adj.id, false);
    } else {
      window.selectedLayerId = adj.id;
      if (window.selectedLayerIds) {
        window.selectedLayerIds.clear();
        window.selectedLayerIds.add(adj.id);
      }
    }

    window.activeKeyframeProperty = scopedKey;
    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(adj);
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyBeatFlashEffect');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast('Exposure Flash Beat applied');
    return JSON.stringify({ error: false, message: 'Exposure Flash Beat applied', layerId: adj.id });
  }

  // --- BEAT EFFECT: LENS / BLUR (FAST BOX BLUR OR LENS BLUR BEAT) ---
  function applyBeatBlurEffect(isRightClick) {
    const isLensBlur = (isRightClick === true);
    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function')
      ? window.getProjectFps()
      : ((window.currentProjectState && parseInt(window.currentProjectState.fps, 10)) || 60);
    const fd = 1 / fps;

    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
    const selLayer = layers.find(l => l.id === selId);

    if (!selLayer) {
      const msg = 'Please select a layer first to apply Blur.';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'LENS', type: 'warn', message: msg });
    }

    const startSec = selLayer.startSec !== undefined ? selLayer.startSec : ((selLayer.startPx || 0) / pps);
    const durationSec = selLayer.durationSec !== undefined ? selLayer.durationSec : ((selLayer.widthPx || 320) / pps);
    const endSec = Number((startSec + durationSec).toFixed(4));

    // Gather timeline beatmarks inside the selected layer duration
    let rawMarkers = [];
    if (Array.isArray(selLayer.markers) && selLayer.markers.length > 0) {
      rawMarkers = rawMarkers.concat(selLayer.markers.map(m => (typeof m === 'number' ? m : (m.time || 0))));
    }
    const pState = window.currentProjectState;
    if (pState && Array.isArray(pState.beatmarks) && pState.beatmarks.length > 0) {
      rawMarkers = rawMarkers.concat(pState.beatmarks);
    }
    if (Array.isArray(window.beatmarks) && window.beatmarks.length > 0) {
      rawMarkers = rawMarkers.concat(window.beatmarks);
    }
    const allBeatmarks = Array.from(new Set(rawMarkers.map(m => Number(m.toFixed(4)))))
      .filter(b => b >= (startSec - 0.001) && b <= (endSec + 0.001))
      .sort((a, b) => a - b);

    if (allBeatmarks.length === 0) {
      const msg = 'Please place beatmarks across the selected layer first.';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'LENS', type: 'warn', message: msg });
    }

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    // 1. Create Adjustment layer matching selected layer timing
    const adj = (typeof window.addAdjustmentLayer === 'function')
      ? window.addAdjustmentLayer(durationSec, startSec)
      : null;
    if (!adj) return JSON.stringify({ error: true, message: 'Failed to create adjustment layer' });
    adj.name = isLensBlur ? 'Lens Blur Beat' : 'Fast Box Blur Beat';

    // 2. Add Blur effect:
    // - Left click: Fast Box Blur
    // - Right click: Lens Blur with bloom = 0, max blur = 5px
    let blurFx = null;
    const maxBlur = isLensBlur ? 5 : 10;

    if (isLensBlur) {
      const fx = (window.FishEffects && window.FishEffects.registry && typeof window.FishEffects.registry.createInstance === 'function')
        ? window.FishEffects.registry.createInstance('camera-lens-blur')
        : null;
      blurFx = fx || {
        id: 'fx_camera_lens_blur_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'camera-lens-blur',
        name: 'Camera Lens Blur',
        isExpanded: true,
        disabled: false,
        radius: 0,
        aspectRatio: 100,
        bloom: 0
      };
      blurFx.radius = 0;
      blurFx.bloom = 0; // Boom/bloom = 0 per user requirement
      blurFx.aspectRatio = 100;
    } else {
      const fx = (window.FishEffects && window.FishEffects.registry && typeof window.FishEffects.registry.createInstance === 'function')
        ? window.FishEffects.registry.createInstance('fast-box-blur')
        : null;
      blurFx = fx || {
        id: 'fx_fast_box_blur_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'fast-box-blur',
        name: 'Fast Box Blur',
        isExpanded: true,
        disabled: false,
        radius: 0,
        iterations: 1
      };
      blurFx.radius = 0;
      blurFx.iterations = 1;
    }
    adj.effects = [blurFx];

    // 3. Build Keyframes for radius:
    // - Tepat di beatmark: radius = maxBlur (5 for lens blur, 10 for fast box blur)
    // - Mundur 1 frame sebelum beatmark: radius = 0.0
    // - Fast decay setelah beatmark: radius = 0.0
    const easeBlurOut = [0.0, 0.0, 0.2, 1.0];
    const linearEase = [0.0, 0.0, 1.0, 1.0];
    const rawKfs = [];

    // Base start at 0 if first beatmark is after layer start
    if (allBeatmarks[0] - fd > startSec + 0.001) {
      rawKfs.push({ time: Number(startSec.toFixed(4)), value: { radius: 0.0 }, easing: [...linearEase] });
    }

    allBeatmarks.forEach((bm, i) => {
      const nextBm = (i < allBeatmarks.length - 1) ? allBeatmarks[i + 1] : endSec;

      // 1 frame mundur (belakang beatmark) = 0.0
      const tBefore = Number(Math.max(startSec, bm - fd).toFixed(4));
      rawKfs.push({
        time: tBefore,
        value: { radius: 0.0 },
        easing: [...linearEase]
      });

      // Tepat di beatmark = maxBlur
      const tBeat = Number(bm.toFixed(4));
      rawKfs.push({
        time: tBeat,
        value: { radius: maxBlur },
        easing: [...easeBlurOut]
      });

      // Decay kembali ke 0.0 setelah beatmark (3-4 frame, tidak melewati beatmark berikutnya)
      const maxDecayTime = nextBm - fd;
      const decayDuration = Math.min(3.5 * fd, Math.max(fd, (nextBm - bm) * 0.45));
      const tDecay = Number(Math.min(endSec, Math.min(maxDecayTime, bm + decayDuration)).toFixed(4));
      if (tDecay > tBeat + 0.001) {
        rawKfs.push({
          time: tDecay,
          value: { radius: 0.0 },
          easing: [...easeBlurOut]
        });
      }
    });

    // End at 0 if needed
    rawKfs.push({ time: Number(endSec.toFixed(4)), value: { radius: 0.0 }, easing: [...linearEase] });

    // Sort & deduplicate close timestamps
    rawKfs.sort((a, b) => a.time - b.time);
    const kfs = [];
    rawKfs.forEach(kf => {
      const prev = kfs[kfs.length - 1];
      if (!prev || Math.abs(prev.time - kf.time) > 0.001) {
        kfs.push(kf);
      } else {
        if ((kf.value.radius || 0) > (prev.value.radius || 0)) {
          prev.value.radius = kf.value.radius;
        }
      }
    });

    const scopedKey = `${blurFx.id}:radius`;
    adj.keyframes = {
      [scopedKey]: kfs,
      radius: kfs
    };

    if (!adj.defaultEasing) adj.defaultEasing = {};
    adj.defaultEasing[scopedKey] = [...easeBlurOut];
    adj.defaultEasing['radius'] = [...easeBlurOut];
    adj._defaultEasing = adj.defaultEasing;

    // Position adjustment layer right above selected layer
    if (selId && selId !== adj.id) {
      const adjIdx = layers.findIndex(l => l.id === adj.id);
      const selIdx = layers.findIndex(l => l.id === selId);
      if (adjIdx >= 0 && selIdx >= 0 && adjIdx !== selIdx) {
        const [extracted] = layers.splice(adjIdx, 1);
        const targetIdx = layers.findIndex(l => l.id === selId);
        layers.splice(targetIdx, 0, extracted);
      }
    }

    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(adj.id, false);
    } else {
      window.selectedLayerId = adj.id;
      if (window.selectedLayerIds) {
        window.selectedLayerIds.clear();
        window.selectedLayerIds.add(adj.id);
      }
    }

    window.activeKeyframeProperty = scopedKey;
    if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(adj);
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyBeatBlurEffect');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    const effectLabel = isLensBlur ? 'Lens Blur Beat' : 'Fast Box Blur Beat';
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(`${effectLabel} applied`);
    return JSON.stringify({ error: false, message: `${effectLabel} applied`, layerId: adj.id });
  }

  // --- TRANSITIONS: FADE IN, FADE OUT, SCALE IN, SCALE OUT ---
  function applyTransitionKeyframes(toolName) {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    let selected = [];
    if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
      selected = layers.filter(l => window.selectedLayerIds.has(l.id));
    }
    if (selected.length === 0 && window.selectedLayerId) {
      const found = layers.find(l => l.id === window.selectedLayerId);
      if (found) selected = [found];
    }

    if (selected.length === 0) {
      const msg = 'Please select at least one layer to apply a transition.';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: 'Transition', type: 'warn', message: msg });
    }

    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function')
      ? window.getProjectFps()
      : ((window.currentProjectState && parseInt(window.currentProjectState.fps, 10)) || 60);
    const fd = 1 / fps;
    const defaultDur = Number((15 * fd).toFixed(4)); // 15 frames transition

    const aspect = (window.currentProjectState && window.currentProjectState.aspectRatio) || '16:9';
    const res = (window.currentProjectState && window.currentProjectState.resolution) || '1080p';
    const resMap = window.resMap || {};
    const baseDims = (resMap[res] && resMap[res][aspect]) || [1920, 1080];
    const baseW = baseDims[0];
    const baseH = baseDims[1];

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    const easeOut = [0.16, 1.0, 0.3, 1.0]; // Punchy smooth ease-out
    const easeIn = [0.4, 0.0, 0.2, 1.0];   // Smooth ease-in

    let activeProp = 'opacity';
    let label = 'Transition';

    selected.forEach(layer => {
      const clipStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
      const clipDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
      const clipEnd = Number((clipStart + clipDur).toFixed(4));
      const dur = Math.min(defaultDur, Math.max(fd, clipDur * 0.45));

      if (!layer.keyframes) layer.keyframes = {};
      if (!layer.defaultEasing) layer.defaultEasing = {};

      const baseOpacity = layer.opacity !== undefined ? layer.opacity : 1.0;
      const origScaleW = layer.scaleW !== undefined ? layer.scaleW : (layer.mediaWidth || baseW);
      const origScaleH = layer.scaleH !== undefined ? layer.scaleH : (layer.mediaHeight || baseH);

      if (toolName === 'TRANS_FADE_IN') {
        label = 'Fade In';
        activeProp = 'opacity';
        const t1 = Number(clipStart.toFixed(4));
        const t2 = Number((clipStart + dur).toFixed(4));

        const existing = Array.isArray(layer.keyframes.opacity)
          ? layer.keyframes.opacity.filter(k => k.time < t1 - 0.005 || k.time > t2 + 0.005)
          : [];

        existing.push({ time: t1, value: { opacity: 0.0 }, easing: [...easeOut] });
        existing.push({ time: t2, value: { opacity: baseOpacity }, easing: [...easeOut] });
        existing.sort((a, b) => a.time - b.time);

        layer.keyframes.opacity = existing;
        layer.defaultEasing.opacity = [...easeOut];
      } else if (toolName === 'TRANS_FADE_OUT') {
        label = 'Fade Out';
        activeProp = 'opacity';
        const t1 = Number((clipEnd - dur).toFixed(4));
        const t2 = Number(clipEnd.toFixed(4));

        const existing = Array.isArray(layer.keyframes.opacity)
          ? layer.keyframes.opacity.filter(k => k.time < t1 - 0.005 || k.time > t2 + 0.005)
          : [];

        existing.push({ time: t1, value: { opacity: baseOpacity }, easing: [...easeIn] });
        existing.push({ time: t2, value: { opacity: 0.0 }, easing: [...easeIn] });
        existing.sort((a, b) => a.time - b.time);

        layer.keyframes.opacity = existing;
        layer.defaultEasing.opacity = [...easeIn];
      } else if (toolName === 'TRANS_SCALE_IN') {
        label = 'Scale In';
        activeProp = 'scale';
        const t1 = Number(clipStart.toFixed(4));
        const t2 = Number((clipStart + dur).toFixed(4));

        const existing = Array.isArray(layer.keyframes.scale)
          ? layer.keyframes.scale.filter(k => k.time < t1 - 0.005 || k.time > t2 + 0.005)
          : [];

        existing.push({ time: t1, value: { scaleW: 0, scaleH: 0 }, easing: [...easeOut] });
        existing.push({ time: t2, value: { scaleW: origScaleW, scaleH: origScaleH }, easing: [...easeOut] });
        existing.sort((a, b) => a.time - b.time);

        layer.keyframes.scale = existing;
        layer.defaultEasing.scale = [...easeOut];
      } else if (toolName === 'TRANS_SCALE_OUT') {
        label = 'Scale Out';
        activeProp = 'scale';
        const t1 = Number((clipEnd - dur).toFixed(4));
        const t2 = Number(clipEnd.toFixed(4));

        const existing = Array.isArray(layer.keyframes.scale)
          ? layer.keyframes.scale.filter(k => k.time < t1 - 0.005 || k.time > t2 + 0.005)
          : [];

        existing.push({ time: t1, value: { scaleW: origScaleW, scaleH: origScaleH }, easing: [...easeIn] });
        existing.push({ time: t2, value: { scaleW: 0, scaleH: 0 }, easing: [...easeIn] });
        existing.sort((a, b) => a.time - b.time);

        layer.keyframes.scale = existing;
        layer.defaultEasing.scale = [...easeIn];
      }

      layer._defaultEasing = layer.defaultEasing;

      if (typeof window.invalidatePreviewCacheForLayer === 'function') {
        window.invalidatePreviewCacheForLayer(layer);
      }
    });

    window.activeKeyframeProperty = activeProp;
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyTransitionKeyframes');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(`${label} applied`);

    return JSON.stringify({ error: false, message: `${label} applied`, count: selected.length });
  }

  // --- BEAT & PANNING EFFECTS (NULL LAYER RIG MATCHING OPENFISHTOOLS) ---
  function applyBeatNullTool(toolName) {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const selId = window.selectedLayerId || (window.selectedLayerIds && window.selectedLayerIds.size === 1 ? Array.from(window.selectedLayerIds)[0] : null);
    const targetLayer = layers.find(l => l.id === selId);

    if (!targetLayer) {
      const msg = 'Please select a layer first.';
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: toolName, type: 'warn', message: msg });
    }

    const pps = window.currentPixelsPerSecond || 80;
    const fps = (typeof window.getProjectFps === 'function')
      ? window.getProjectFps()
      : ((window.currentProjectState && parseInt(window.currentProjectState.fps, 10)) || 60);
    const fd = 1 / fps;

    const startSec = targetLayer.startSec !== undefined ? targetLayer.startSec : ((targetLayer.startPx || 0) / pps);
    const durationSec = targetLayer.durationSec !== undefined ? targetLayer.durationSec : ((targetLayer.widthPx || 320) / pps);
    const endSec = Number((startSec + durationSec).toFixed(4));

    // Gather timeline beatmarks inside the selected layer duration
    let rawMarkers = [];
    if (Array.isArray(targetLayer.markers) && targetLayer.markers.length > 0) {
      rawMarkers = rawMarkers.concat(targetLayer.markers.map(m => (typeof m === 'number' ? m : (m.time || 0))));
    }
    const pState = window.currentProjectState;
    if (pState && Array.isArray(pState.beatmarks) && pState.beatmarks.length > 0) {
      rawMarkers = rawMarkers.concat(pState.beatmarks);
    }
    if (Array.isArray(window.beatmarks) && window.beatmarks.length > 0) {
      rawMarkers = rawMarkers.concat(window.beatmarks);
    }
    const allMarkers = Array.from(new Set(rawMarkers.map(m => Number(m.toFixed(4))))).sort((a, b) => a - b);
    const markers = allMarkers.filter(b => b >= (startSec - 0.001) && b <= (endSec + 0.001));

    // Some tools require beat markers
    const isPanning = toolName.indexOf('PANNING') === 0;
    if (!isPanning && allMarkers.length === 0) {
      const msg = `Please place beat markers on the timeline first to apply ${toolName}.`;
      if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
      return JSON.stringify({ error: true, tool: toolName, type: 'warn', message: msg });
    }

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    const aspect = (window.currentProjectState && window.currentProjectState.aspectRatio) || '16:9';
    const res = (window.currentProjectState && window.currentProjectState.resolution) || '1080p';
    const resMap = window.resMap || {};
    const baseDims = (resMap[res] && resMap[res][aspect]) || [1920, 1080];
    const baseW = baseDims[0];
    const baseH = baseDims[1];

    const targetX = targetLayer.posX !== undefined ? targetLayer.posX : Math.round(baseW / 2);
    const targetY = targetLayer.posY !== undefined ? targetLayer.posY : Math.round(baseH / 2);
    const targetScaleW = targetLayer.scaleW !== undefined ? targetLayer.scaleW : (targetLayer.mediaWidth || baseW);
    const targetScaleH = targetLayer.scaleH !== undefined ? targetLayer.scaleH : (targetLayer.mediaHeight || baseH);

    // Map toolName to AE OpenFishTools Null Name
    let nullName = 'Null';
    if (toolName === 'OSCILLATE') nullName = 'OSCILLATE';
    else if (toolName === 'Y_BEAT') nullName = 'Y BEAT';
    else if (toolName === 'Y_FLIP') nullName = 'Y FLIP';
    else if (toolName === 'X_BEAT') nullName = 'X BEAT';
    else if (toolName === 'X_FLIP') nullName = 'X FLIP';
    else if (toolName === 'SCALE_BEAT') nullName = 'SCALE BEAT';
    else if (toolName === 'SCALE_OVERLAP') nullName = 'SCALE OVER';
    else if (toolName === 'SWING') nullName = 'Swing_Null';
    else if (toolName === 'PANNING_POS') nullName = 'PANNING Position';
    else if (toolName === 'PANNING_ROT') nullName = 'PANNING Rotation';
    else if (toolName === 'PANNING_SCALE') nullName = 'PANNING Scale';
    else if (toolName === 'PANNING_MIX_PR') nullName = 'PANNING Mix PR';
    else if (toolName === 'PANNING_MIX_ALL') nullName = 'PANNING Mix All';

    // 1. Create Null Layer matching OpenFishTools structure
    const nullLayer = {
      id: 'layer_null_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: nullName,
      type: 'null',
      startPx: Math.round(startSec * pps),
      startSec: startSec,
      durationSec: durationSec,
      widthPx: Math.max(40, Math.round(durationSec * pps)),
      posX: targetX,
      posY: targetY,
      posZ: 0,
      rotZ: 0,
      rotation: 0,
      scaleW: 100,
      scaleH: 100,
      keyframes: {},
      expressions: {},
      effects: [],
      defaultEasing: {}
    };

    // 2. Resolve parent chain — if targetLayer already has a parent, walk to the top of
    //    the existing null hierarchy so the new null leapfrogs above it (AE-style stacking).
    const neutralBind = {
      parentPosX: targetX,
      parentPosY: targetY,
      parentPosZ: 0,
      parentRotX: 0,
      parentRotY: 0,
      parentRotZ: 0,
      parentScaleW: 100,
      parentScaleH: 100
    };

    let topOfChain = targetLayer;
    while (topOfChain.parentId) {
      const p = layers.find(l => l.id === topOfChain.parentId);
      if (!p) break;
      topOfChain = p;
    }

    if (topOfChain.id !== targetLayer.id) {
      // targetLayer already has a parent chain — insert nullLayer above the top of that chain.
      // nullLayer inherits whatever parent topOfChain had (grandparent, if any).
      nullLayer.parentId = topOfChain.parentId || null;
      nullLayer.parentBind = topOfChain.parentBind ? Object.assign({}, topOfChain.parentBind) : null;
      topOfChain.parentId = nullLayer.id;
      topOfChain.parentBind = Object.assign({}, neutralBind);

      const topIdx = layers.findIndex(l => l.id === topOfChain.id);
      if (topIdx >= 0) {
        layers.splice(topIdx, 0, nullLayer);
      } else {
        layers.push(nullLayer);
      }
    } else {
      // No existing parent — null becomes direct parent of targetLayer.
      const targetIdx = layers.findIndex(l => l.id === targetLayer.id);
      if (targetIdx >= 0) {
        layers.splice(targetIdx, 0, nullLayer);
      } else {
        layers.push(nullLayer);
      }
      targetLayer.parentId = nullLayer.id;
      targetLayer.parentBind = Object.assign({}, neutralBind);
    }

    let activeProp = 'move';

    function createSlider(name, val, min, max, step, unit) {
      return {
        id: 'fx_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'slider-control',
        name: name,
        slider: val,
        value: val,
        min: min !== undefined ? min : -10000,
        max: max !== undefined ? max : 10000,
        step: step !== undefined ? step : 1,
        unit: unit || '',
        isExpanded: true
      };
    }

    // 4. Attach Slider Controls & Pure Mathematical Expressions (Matching GitHub OpenFishTools)
    if (toolName === 'OSCILLATE') {
      activeProp = 'move';
      nullLayer.effects.push(createSlider('Freq', 3, 0.1, 20, 0.1, ' Hz'));
      nullLayer.effects.push(createSlider('Amp', 30, 0, 500, 1, ' px'));
      nullLayer.effects.push(createSlider('Decay', 2.7, 0, 20, 0.1, ''));
      nullLayer.effects.push(createSlider('Attack', 40, 0, 100, 1, ''));

      nullLayer.expressions.move = [
        'freq = effect("Freq")("ADBE Slider Control-0001");',
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        'attack = effect("Attack")("ADBE Slider Control-0001");',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = 0;',
        '    if (m.numKeys > 0){',
        '        n = m.nearestKey(time).index;',
        '        if (m.key(n).time > time) n--;',
        '    }',
        '',
        '    if (n > 0){',
        '        markerTime = m.key(n).time;',
        '        if (markerTime >= inPoint && markerTime <= outPoint){',
        '            t = time - markerTime;',
        '            env = (attack > 0) ? (1 - Math.exp(-t * attack)) : 1;',
        '            currAmp = amp * env / Math.exp(t * decay);',
        '            x = Math.sin(t * freq * Math.PI * 2) * currAmp;',
        '            y = (1 - Math.cos(t * freq * Math.PI * 2)) * currAmp;',
        '            value + [x, y];',
        '        }else{',
        '            value;',
        '        }',
        '    }else{',
        '        value;',
        '    }',
        '}'
      ].join('\n');

    } else if (toolName === 'SWING') {
      activeProp = 'rotate';
      nullLayer.effects.push(createSlider('Freq', 1, 0.1, 20, 0.1, ' Hz'));
      nullLayer.effects.push(createSlider('Amp', 4, 0, 180, 0.5, '°'));
      nullLayer.effects.push(createSlider('Decay', 1.5, 0, 20, 0.1, ''));

      nullLayer.expressions.rotate = [
        'freq = effect("Freq")("ADBE Slider Control-0001");',
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = 0;',
        '    if (m.numKeys > 0){',
        '        n = m.nearestKey(time).index;',
        '        if (m.key(n).time > time) n--;',
        '    }',
        '',
        '    if (n > 0){',
        '        markerTime = m.key(n).time;',
        '        if (markerTime >= inPoint && markerTime <= outPoint){',
        '            t = time - markerTime;',
        '            currAmp = amp / Math.exp(t * decay);',
        '            r = currAmp * Math.sin(t * freq * Math.PI * 2);',
        '            value + r;',
        '        }else{',
        '            value;',
        '        }',
        '    }else{',
        '        value;',
        '    }',
        '}'
      ].join('\n');

    } else if (toolName === 'Y_BEAT') {
      activeProp = 'move';
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 20, 1, 100, 1, ''));

      nullLayer.expressions.move = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = m.nearestKey(time).index;',
        '    if (m.key(n).time > time) {',
        '        t2 = m.key(n).time;',
        '        t1 = (n > 1) ? m.key(n-1).time : -99999;',
        '    } else {',
        '        t1 = m.key(n).time;',
        '        t2 = (n < m.numKeys) ? m.key(n+1).time : 99999;',
        '    }',
        '',
        '    val1 = 0;',
        '    if (t1 >= inPoint && t1 <= outPoint) {',
        '        val1 = amp / Math.exp((time - t1) * decay);',
        '    }',
        '',
        '    val2 = 0;',
        '    if (t2 >= inPoint && t2 <= outPoint) {',
        '        val2 = amp / Math.exp((t2 - time) * decay);',
        '    }',
        '',
        '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '    value + [0, val];',
        '}'
      ].join('\n');

    } else if (toolName === 'X_BEAT') {
      activeProp = 'move';
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 20, 1, 100, 1, ''));

      nullLayer.expressions.move = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = m.nearestKey(time).index;',
        '    if (m.key(n).time > time) {',
        '        t2 = m.key(n).time;',
        '        t1 = (n > 1) ? m.key(n-1).time : -99999;',
        '    } else {',
        '        t1 = m.key(n).time;',
        '        t2 = (n < m.numKeys) ? m.key(n+1).time : 99999;',
        '    }',
        '',
        '    val1 = 0;',
        '    if (t1 >= inPoint && t1 <= outPoint) {',
        '        val1 = amp / Math.exp((time - t1) * decay);',
        '    }',
        '',
        '    val2 = 0;',
        '    if (t2 >= inPoint && t2 <= outPoint) {',
        '        val2 = amp / Math.exp((t2 - time) * decay);',
        '    }',
        '',
        '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '    value + [val, 0];',
        '}'
      ].join('\n');

    } else if (toolName === 'Y_FLIP') {
      activeProp = 'move';
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 15, 1, 100, 1, ''));

      nullLayer.expressions.move = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    validKeys = [];',
        '    for (i = 1; i <= m.numKeys; i++){',
        '        kt = m.key(i).time;',
        '        if (kt >= inPoint && kt <= outPoint){',
        '            validKeys.push(i);',
        '        }',
        '    }',
        '',
        '    if (validKeys.length === 0){',
        '        value;',
        '    }else{',
        '        activeIdx = -1;',
        '        for (k = 0; k < validKeys.length; k++){',
        '            if (m.key(validKeys[k]).time <= time){',
        '                activeIdx = k;',
        '            }else{',
        '                break;',
        '            }',
        '        }',
        '',
        '        if (activeIdx === -1){',
        '            // From inPoint up to 1st marker: start from CENTER (0), smoothly approach 1st marker',
        '            tNext = m.key(validKeys[0]).time;',
        '            dir = -1; // 1st marker is UP (-1)',
        '            val = -dir * amp / Math.exp((tNext - time) * decay);',
        '            value + [0, val];',
        '        }else{',
        '            t1 = m.key(validKeys[activeIdx]).time;',
        '            hasNext = (activeIdx + 1 < validKeys.length);',
        '            t2 = hasNext ? m.key(validKeys[activeIdx + 1]).time : (outPoint + 9999);',
        '',
        '            // 1st marker in null (activeIdx=0) = UP (-1), 2nd (activeIdx=1) = DOWN (+1)...',
        '            dir = (activeIdx % 2 === 0) ? -1 : 1;',
        '',
        '            val1 = dir * amp / Math.exp((time - t1) * decay);',
        '            val2 = hasNext ? (dir * amp / Math.exp((t2 - time) * decay)) : 0;',
        '            val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '            value + [0, val];',
        '        }',
        '    }',
        '}'
      ].join('\n');

      nullLayer.expressions.scale = [
        'if (time < inPoint || time > outPoint){',
        '    value;',
        '}else{',
        '    m = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '    if (!m || m.numKeys === 0){',
        '        value;',
        '    }else{',
        '        validKeys = [];',
        '        for (i = 1; i <= m.numKeys; i++){',
        '            kt = m.key(i).time;',
        '            if (kt >= inPoint && kt <= outPoint){',
        '                validKeys.push(i);',
        '            }',
        '        }',
        '',
        '        if (validKeys.length === 0){',
        '            value;',
        '        }else{',
        '            activeIdx = -1;',
        '            for (k = 0; k < validKeys.length; k++){',
        '                if (m.key(validKeys[k]).time <= time){',
        '                    activeIdx = k;',
        '                }else{',
        '                    break;',
        '                }',
        '            }',
        '',
        '            if (activeIdx === -1){',
        '                // Before 1st marker: default scale',
        '                value;',
        '            }else{',
        '                // 1st marker in null (activeIdx=0) -> -100, 2nd (activeIdx=1) -> +100...',
        '                sY = (activeIdx % 2 === 0) ? -100 : 100;',
        '                [value[0], sY];',
        '            }',
        '        }',
        '    }',
        '}'
      ].join('\n');

    } else if (toolName === 'X_FLIP') {
      activeProp = 'move';
      nullLayer.effects.push(createSlider('Amp', 500, -2000, 2000, 10, ' px'));
      nullLayer.effects.push(createSlider('Decay', 15, 1, 100, 1, ''));

      nullLayer.expressions.move = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    validKeys = [];',
        '    for (i = 1; i <= m.numKeys; i++){',
        '        kt = m.key(i).time;',
        '        if (kt >= inPoint && kt <= outPoint){',
        '            validKeys.push(i);',
        '        }',
        '    }',
        '',
        '    if (validKeys.length === 0){',
        '        value;',
        '    }else{',
        '        activeIdx = -1;',
        '        for (k = 0; k < validKeys.length; k++){',
        '            if (m.key(validKeys[k]).time <= time){',
        '                activeIdx = k;',
        '            }else{',
        '                break;',
        '            }',
        '        }',
        '',
        '        if (activeIdx === -1){',
        '            // From inPoint up to 1st marker: start from CENTER (0), smoothly approach 1st marker',
        '            tNext = m.key(validKeys[0]).time;',
        '            dir = -1; // 1st marker is LEFT (-1)',
        '            val = -dir * amp / Math.exp((tNext - time) * decay);',
        '            value + [val, 0];',
        '        }else{',
        '            t1 = m.key(validKeys[activeIdx]).time;',
        '            hasNext = (activeIdx + 1 < validKeys.length);',
        '            t2 = hasNext ? m.key(validKeys[activeIdx + 1]).time : (outPoint + 9999);',
        '',
        '            // 1st marker in null (activeIdx=0) = LEFT (-1), 2nd (activeIdx=1) = RIGHT (+1)...',
        '            dir = (activeIdx % 2 === 0) ? -1 : 1;',
        '',
        '            val1 = dir * amp / Math.exp((time - t1) * decay);',
        '            val2 = hasNext ? (dir * amp / Math.exp((t2 - time) * decay)) : 0;',
        '            val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '            value + [val, 0];',
        '        }',
        '    }',
        '}'
      ].join('\n');

      nullLayer.expressions.scale = [
        'if (time < inPoint || time > outPoint){',
        '    value;',
        '}else{',
        '    m = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '    if (!m || m.numKeys === 0){',
        '        value;',
        '    }else{',
        '        validKeys = [];',
        '        for (i = 1; i <= m.numKeys; i++){',
        '            kt = m.key(i).time;',
        '            if (kt >= inPoint && kt <= outPoint){',
        '                validKeys.push(i);',
        '            }',
        '        }',
        '',
        '        if (validKeys.length === 0){',
        '            value;',
        '        }else{',
        '            activeIdx = -1;',
        '            for (k = 0; k < validKeys.length; k++){',
        '                if (m.key(validKeys[k]).time <= time){',
        '                    activeIdx = k;',
        '                }else{',
        '                    break;',
        '                }',
        '            }',
        '',
        '            if (activeIdx === -1){',
        '                // Before 1st marker: default scale',
        '                value;',
        '            }else{',
        '                // 1st marker in null (activeIdx=0) -> -100, 2nd (activeIdx=1) -> +100...',
        '                sX = (activeIdx % 2 === 0) ? -100 : 100;',
        '                [sX, value[1]];',
        '            }',
        '        }',
        '    }',
        '}'
      ].join('\n');

    } else if (toolName === 'SCALE_BEAT') {
      activeProp = 'scale';
      nullLayer.effects.push(createSlider('Amp', 500, 0, 2000, 10, '%'));
      nullLayer.effects.push(createSlider('Decay', 20, 1, 100, 1, ''));

      nullLayer.expressions.scale = [
        'amp = effect("Amp")("ADBE Slider Control-0001");',
        'decay = effect("Decay")("ADBE Slider Control-0001");',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        '',
        'if (time < inPoint || time > outPoint || !m || m.numKeys === 0){',
        '    value;',
        '}else{',
        '    n = m.nearestKey(time).index;',
        '    if (m.key(n).time > time) {',
        '        t2 = m.key(n).time;',
        '        t1 = (n > 1) ? m.key(n-1).time : -99999;',
        '    } else {',
        '        t1 = m.key(n).time;',
        '        t2 = (n < m.numKeys) ? m.key(n+1).time : 99999;',
        '    }',
        '',
        '    val1 = 0;',
        '    if (t1 >= inPoint && t1 <= outPoint) {',
        '        val1 = amp / Math.exp((time - t1) * decay);',
        '    }',
        '',
        '    val2 = 0;',
        '    if (t2 >= inPoint && t2 <= outPoint) {',
        '        val2 = amp / Math.exp((t2 - time) * decay);',
        '    }',
        '',
        '    val = (Math.abs(val1) > Math.abs(val2)) ? val1 : val2;',
        '    value + [val, val];',
        '}'
      ].join('\n');

    } else if (toolName === 'SCALE_OVERLAP') {
      activeProp = 'scale';
      nullLayer.effects.push(createSlider('Scale In', 0, -200, 500, 1, '%'));
      nullLayer.effects.push(createSlider('Scale Out', 20, -200, 500, 1, '%'));
      nullLayer.effects.push(createSlider('Overshoot', 20, 0, 100, 1, '%'));

      nullLayer.expressions.scale = [
        'function bezier(x1, y1, x2, y2, t) {',
        '    if (t <= 0) return 0;',
        '    if (t >= 1) return 1;',
        '    var p = t;',
        '    for (var i = 0; i < 8; i++) {',
        '        var omP = 1 - p;',
        '        var f = 3 * omP * omP * p * x1 + 3 * omP * p * p * x2 + p * p * p - t;',
        '        var df = 3 * omP * omP * x1 + 6 * omP * p * (x2 - x1) + 3 * p * p * (1 - x2);',
        '        if (Math.abs(df) < 1e-6) break;',
        '        p -= f / df;',
        '        p = Math.max(0, Math.min(1, p));',
        '    }',
        '    var omP = 1 - p;',
        '    return 3 * omP * omP * p * y1 + 3 * omP * p * p * y2 + p * p * p;',
        '}',
        '',
        'm = (index + 1 <= thisComp.numLayers && thisComp.layer(index + 1).marker.numKeys > 0) ? thisComp.layer(index + 1).marker : thisComp.marker;',
        'scaleIn = effect("Scale In")("ADBE Slider Control-0001");',
        'scaleOut = effect("Scale Out")("ADBE Slider Control-0001");',
        'overshoot = effect("Overshoot")("ADBE Slider Control-0001");',
        '',
        'if (time < inPoint || time > outPoint) {',
        '    value;',
        '} else if (m && m.numKeys > 0) {',
        '    n = 0;',
        '    if (m.numKeys > 0) {',
        '        n = m.nearestKey(time).index;',
        '        if (m.key(n).time > time) n--;',
        '    }',
        '    ',
        '    if (n > 0 && n < m.numKeys) {',
        '        t1 = m.key(n).time;',
        '        t2 = m.key(n+1).time;',
        '        dur = t2 - t1;',
        '        ',
        '        startVal = (n % 2 !== 0) ? scaleIn : scaleOut;',
        '        endVal = (n % 2 !== 0) ? scaleOut : scaleIn;',
        '        ',
        '        t = time - t1;',
        '        progress = Math.max(0, Math.min(1, t / dur));',
        '        yMult = overshoot / 20;',
        '        eased = bezier(0.4, -0.5 * yMult, 0.8, -0.5 * yMult, progress);',
        '        val = startVal + (endVal - startVal) * eased;',
        '        value + [val, val];',
        '    } else if (n >= m.numKeys) {',
        '        finalVal = (m.numKeys % 2 !== 0) ? scaleOut : scaleIn;',
        '        value + [finalVal, finalVal];',
        '    } else {',
        '        value + [scaleIn, scaleIn];',
        '    }',
        '} else {',
        '    value;',
        '}'
      ].join('\n');

    } else if (isPanning) {
      const isPos = (toolName === 'PANNING_POS' || toolName === 'PANNING_MIX_PR' || toolName === 'PANNING_MIX_ALL' || toolName === 'PANNING');
      const isRot = (toolName === 'PANNING_ROT' || toolName === 'PANNING_MIX_PR' || toolName === 'PANNING_MIX_ALL');
      const isScale = (toolName === 'PANNING_SCALE' || toolName === 'PANNING_MIX_ALL');

      const isMixPR = (toolName === 'PANNING_MIX_PR');
      const defaultFreq = isMixPR ? 7 : 1.5;
      const defaultPos = isMixPR ? 10 : 30;
      const defaultRot = isMixPR ? 1 : 5;
      const defaultScale = 10;

      nullLayer.effects.push(createSlider('Freq', defaultFreq, 0.1, 30, 0.1, ' Hz'));

      if (isPos) {
        nullLayer.effects.push(createSlider('Position', defaultPos, 0, 500, 1, ' px'));
        nullLayer.expressions.move = [
          'freq = effect("Freq")("ADBE Slider Control-0001");',
          'posAmp = effect("Position")("ADBE Slider Control-0001");',
          'if (time < inPoint || time > outPoint){',
          '    value;',
          '}else{',
          '    t = time * freq;',
          '    x = (Math.sin(t * 1.2) * 0.7 + Math.sin(t * 2.3) * 0.3) * posAmp;',
          '    y = (Math.cos(t * 0.9) * 0.7 + Math.sin(t * 1.7) * 0.3) * posAmp;',
          '    value + [x, y];',
          '}'
        ].join('\n');
        activeProp = 'move';
      }

      if (isRot) {
        nullLayer.effects.push(createSlider('Rotation', defaultRot, 0, 180, 0.5, '°'));
        nullLayer.expressions.rotate = [
          'freq = effect("Freq")("ADBE Slider Control-0001");',
          'rotAmp = effect("Rotation")("ADBE Slider Control-0001");',
          'if (time < inPoint || time > outPoint){',
          '    value;',
          '}else{',
          '    t = time * freq;',
          '    r = (Math.sin(t * 0.8 + 1.5) * 0.7 + Math.cos(t * 1.5) * 0.3) * rotAmp;',
          '    value + r;',
          '}'
        ].join('\n');
        if (!isPos) activeProp = 'rotate';
      }

      if (isScale) {
        nullLayer.effects.push(createSlider('Scale', defaultScale, 0, 200, 1, '%'));
        nullLayer.expressions.scale = [
          'freq = effect("Freq")("ADBE Slider Control-0001");',
          'scaleAmp = effect("Scale")("ADBE Slider Control-0001");',
          'if (time < inPoint || time > outPoint){',
          '    value;',
          '}else{',
          '    t = time * freq;',
          '    s = (Math.sin(t * 1.1) * 0.7 + Math.cos(t * 2.1) * 0.3) * scaleAmp;',
          '    value + [s, s];',
          '}'
        ].join('\n');
        if (!isPos && !isRot) activeProp = 'scale';
      }
    }

    nullLayer._defaultEasing = nullLayer.defaultEasing;

    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(nullLayer.id, false);
    } else {
      window.selectedLayerId = nullLayer.id;
      if (window.selectedLayerIds) {
        window.selectedLayerIds.clear();
        window.selectedLayerIds.add(nullLayer.id);
      }
    }

    window.activeKeyframeProperty = activeProp;
    if (typeof window.invalidatePreviewCacheForLayer === 'function') {
      window.invalidatePreviewCacheForLayer(nullLayer);
      window.invalidatePreviewCacheForLayer(targetLayer);
    }
    if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
    if (typeof window.renderTimelineLayers === 'function') window.renderTimelineLayers();
    if (typeof window.redrawComposition === 'function') window.redrawComposition('applyBeatNullTool');
    if (typeof window.syncEffectsRackUI === 'function') window.syncEffectsRackUI();
    if (typeof window.switchLayerDrawerSubview === 'function') window.switchLayerDrawerSubview('effects');
    if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(`${nullName} applied`);

    return JSON.stringify({ error: false, message: `${nullName} applied`, nullLayerId: nullLayer.id, targetLayerId: targetLayer.id });
  }

  // ======================================================================
  // CENTRAL DISPATCHER: executeFishTool
  // ======================================================================
  function executeFishTool(tool, ...args) {
    if (!tool) return;
    if (typeof window !== 'undefined') {
      window._lastDirectFishToolCall = { key: tool + ':' + JSON.stringify(args), time: Date.now() };
    }
    switch (tool) {
      // Beat Effects
      case 'GHST':
        return applyBeatGhostEffect();
      case 'WARP':
        return applyBeatWarpEffect(args[0]);
      case 'FISHEYE':
        return applyBeatFisheyeEffect(args[0]);
      case 'MIDWAVE':
        return applyBeatMidwaveEffect();
      case 'HUESPIN':
        return applyBeatHuespinEffect();
      case 'EXPO':
      case 'FLASH':
        return applyBeatFlashEffect();
      case 'LENS':
        return applyBeatBlurEffect(args[0]);
      case 'PRESET_WARP1':
      case 'WARP1':
        return applyPresetWarp1();
      case 'PRESET_WARP2':
      case 'WARP2':
        return applyPresetWarp2();
      case 'PRESET_WARP3':
      case 'WARP3':
        return applyPresetWarp3();

      // Null Rigs (matching After Effects OpenFishTools)
      case 'OSCILLATE':
      case 'SWING':
      case 'Y_BEAT':
      case 'Y_FLIP':
      case 'X_BEAT':
      case 'X_FLIP':
      case 'SCALE_BEAT':
      case 'SCALE_OVERLAP':
      case 'PANNING':
      case 'PANNING_POS':
      case 'PANNING_ROT':
      case 'PANNING_SCALE':
      case 'PANNING_MIX_PR':
      case 'PANNING_MIX_ALL':
        return applyBeatNullTool(tool === 'PANNING' ? 'PANNING_MIX_ALL' : tool);

      // Transitions
      case 'TRANS_FADE_IN':
      case 'TRANS_FADE_OUT':
      case 'TRANS_SCALE_IN':
      case 'TRANS_SCALE_OUT':
        return applyTransitionKeyframes(tool);

      // Anchor Point (3x3 grid)
      case 'setAnchorPoint':
        if (typeof window.setAnchorPointForSelectedLayers === 'function') {
          return window.setAnchorPointForSelectedLayers(args[0]);
        }
        break;

      // Cut (Trim In, Split, Trim Out)
      case 'CUT_FRONT':
        if (typeof window.executeCutLeft === 'function') return window.executeCutLeft();
        break;
      case 'CUT_MID':
        if (typeof window.executeCutMid === 'function') return window.executeCutMid();
        break;
      case 'CUT_BACK':
        if (typeof window.executeCutRight === 'function') return window.executeCutRight();
        break;

      // Align
      case 'ALIGN_LEFT':
      case 'ALIGN_HCENTER':
      case 'ALIGN_RIGHT':
      case 'ALIGN_TOP':
      case 'ALIGN_VCENTER':
      case 'ALIGN_BOTTOM':
        if (typeof window.alignSelectedLayers === 'function') {
          return window.alignSelectedLayers(tool);
        }
        break;

      // Actions
      case 'PRECOMP':
        if (typeof window.precomposeSelectedLayers === 'function') {
          return window.precomposeSelectedLayers(false);
        }
        break;
      case 'PRECOMP_AUTOCROP':
        if (typeof window.precomposeSelectedLayers === 'function') {
          return window.precomposeSelectedLayers(true);
        }
        break;
      case 'CENTERINCOMP':
        if (typeof window.alignSelectedLayers === 'function') {
          return window.alignSelectedLayers('CENTERINCOMP');
        }
        break;
      case 'OVERLAP':
        if (typeof window.applyKeyframeOverlap === 'function') {
          return window.applyKeyframeOverlap();
        }
        break;
      case 'PNG':
        if (typeof window.exportCurrentFrameAsPNG === 'function') {
          return window.exportCurrentFrameAsPNG();
        }
        break;
      case 'DUP': {
        const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
        const selId = window.selectedLayerId;
        const selLayer = layers.find(l => l.id === selId);
        if (selLayer && selLayer.type === 'precomp') {
          if (typeof window.duplicatePrecompLayer === 'function') {
            return window.duplicatePrecompLayer(args[0]);
          }
        } else {
          if (typeof window.duplicateSelectedLayers === 'function') {
            return window.duplicateSelectedLayers();
          }
        }
        break;
      }

      // Toolbox - Layer
      case 'FRZ':
        return applyToolboxFreezeFrame();
      case 'FIT':
        return applyToolboxFitToComp(args[0]);
      case 'DSH':
        return applyToolboxDropShadow();
      case 'MIR':
        return applyToolboxMirror(args[0]);

      // Toolbox - Create
      case 'SHA':
        if (typeof window.addShapeLayer === 'function') return window.addShapeLayer('rectangle');
        break;
      case 'SOL': {
        const timing = getSelectedLayerTiming();
        const isBlack = args[0] === true;
        if (typeof window.addSolidLayer === 'function') {
          const newLayer = window.addSolidLayer(timing.durationSec, timing.startSec, isBlack);
          const msg = isBlack ? 'Black Solid created' : 'Solid created';
          if (typeof window.showEffectsRackToast === 'function') window.showEffectsRackToast(msg);
          return JSON.stringify({ error: false, message: msg, layerId: newLayer.id, color: newLayer.fillColor });
        }
        break;
      }
      case 'NUL':
        if (typeof window.addNullLayer === 'function') return window.addNullLayer(args[0] === true);
        break;
      case 'CAM': {
        const timing = getSelectedLayerTiming();
        if (typeof window.addCameraLayer === 'function') return window.addCameraLayer(timing.durationSec, timing.startSec);
        break;
      }
      case 'ADJ': {
        const timing = getSelectedLayerTiming();
        if (typeof window.addAdjustmentLayer === 'function') return window.addAdjustmentLayer(timing.durationSec, timing.startSec);
        break;
      }

      // Toolbox - Effects
      case 'FILL':
        if (typeof window.addEffectToLayer === 'function') return window.addEffectToLayer('fill');
        break;
      case 'TINT':
        if (typeof window.addEffectToLayer === 'function') return window.addEffectToLayer('tint');
        break;
      case 'BLUR':
        if (typeof window.addEffectToLayer === 'function') {
          return window.addEffectToLayer(args[0] === true ? 'camera-lens-blur' : 'fast-box-blur');
        }
        break;
      case 'LUM':
        if (typeof window.addEffectToLayer === 'function') return window.addEffectToLayer('brightness-contrast');
        break;
      case 'CURV':
        if (typeof window.addEffectToLayer === 'function') return window.addEffectToLayer('curve');
        break;
      case 'HUE':
        if (typeof window.addEffectToLayer === 'function') return window.addEffectToLayer('hue-shift');
        break;

      // Velocity
      case 'TWIX':
        return applyTwixtorVelocity();
      case 'TMRE':
        return applyTimeRemapVelocity();

      // Format
      case 'changeCompRatio':
        if (typeof window.changeCompositionRatio === 'function') return window.changeCompositionRatio(args[0], args[1]);
        break;
      case 'changeCompFPS':
        if (typeof window.changeCompositionFPS === 'function') return window.changeCompositionFPS(args[0]);
        break;

      // 3D Procedural Generators & Cube
      case 'CUBE':
        if (typeof window.createProceduralCube === 'function') {
          return window.createProceduralCube(args[0], args[1], args[2], args[3]);
        }
        break;

      case 'GEN_3D_2SPLIT':
        if (typeof window.createProcedural2Split === 'function') {
          return window.createProcedural2Split();
        }
        break;

      case 'GEN_3D_3SPLIT':
        if (typeof window.createProcedural3Split === 'function') {
          return window.createProcedural3Split();
        }
        break;

      case 'GEN_3D_TUNNEL':
        if (typeof window.createProceduralTunnel === 'function') {
          return window.createProceduralTunnel();
        }
        break;

      case 'GEN_3D_MC':
        if (typeof window.createProceduralMC === 'function') {
          return window.createProceduralMC();
        }
        break;

      case 'GEN_3D':
        if (typeof window.createProcedural3D === 'function') {
          return window.createProcedural3D(args[0]);
        }
        break;

      case 'GEN_3D_PHONE':
      case 'GEN_3D_ZFLIP':
      case 'GEN_3D_ZFOLD':
      case 'GEN_3D_TABLET':
      case 'GEN_3D_LAPTOP':
      case 'GEN_3D_MONITOR':
      case 'GEN_3D_PC':
      case 'GEN_3D_CRT':
      case 'GEN_3D_ROOM':
      case 'GEN_3D_DOOR':
      case 'GEN_3D_WINDOW':
      case 'GEN_3D_TABLE':
      case 'GEN_3D_DESK':
      case 'GEN_3D_CABINET':
      case 'GEN_3D_BOX':
      case 'GEN_3D_BOOK':
      case 'GEN_3D_BINDER':
      case 'GEN_3D_GLASSES':
        if (typeof window.createProcedural3D === 'function') {
          return window.createProcedural3D(tool.replace('GEN_3D_', ''));
        }
        break;

      default:
        break;
    }
  }

  // Export to window
  window.executeFishTool = executeFishTool;
  window.applyToolboxFreezeFrame = applyToolboxFreezeFrame;
  window.applyToolboxFitToComp = applyToolboxFitToComp;
  window.applyToolboxDropShadow = applyToolboxDropShadow;
  window.applyToolboxMirror = applyToolboxMirror;
  window.applyTwixtorVelocity = applyTwixtorVelocity;
  window.applyTimeRemapVelocity = applyTimeRemapVelocity;
  window.applyBeatGhostEffect = applyBeatGhostEffect;
  window.applyBeatWarpEffect = applyBeatWarpEffect;
  window.applyBeatFisheyeEffect = applyBeatFisheyeEffect;
  window.applyBeatMidwaveEffect = applyBeatMidwaveEffect;
  window.applyBeatHuespinEffect = applyBeatHuespinEffect;
  window.applyBeatFlashEffect = applyBeatFlashEffect;
  window.applyBeatExpoEffect = applyBeatFlashEffect;
  window.applyBeatBlurEffect = applyBeatBlurEffect;
  window.applyBeatLensEffect = applyBeatBlurEffect;
  window.applyTransitionKeyframes = applyTransitionKeyframes;
  window.applyBeatNullTool = applyBeatNullTool;
  window.applyPresetWarp1 = applyPresetWarp1;
  window.applyPresetWarp2 = applyPresetWarp2;
  window.applyPresetWarp3 = applyPresetWarp3;

  // Cross-frame message listener for postMessage triggers from OpenFishTools panel iframe
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('message', (event) => {
      if (event && event.data && event.data.type === 'fishtools-run-tool' && event.data.tool) {
        const args = Array.isArray(event.data.args) ? event.data.args : [];
        executeFishTool(event.data.tool, ...args);
      }
    });
  }

})(typeof window !== 'undefined' ? window : this);
