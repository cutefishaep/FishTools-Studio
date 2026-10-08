/**
 * OpenFishTools Studio — Selective Layer Attributes Clipboard & Popover Controller
 * Features:
 * - Single-select Shape/Video/Image detection for Copy & Paste Attributes Popover
 * - Selective attribute toggling (Fill, Opacity & Blend, Effects, Transform, Border & Shadow, Speed & Volume)
 * - Automatic clipboard filtering: Paste popover only permits toggles present in clipboard
 * - Multi-target paste support (1-to-many application across selected timeline layers)
 * - Transparent fallback to standard layer copy/paste on multi-select or other layer types
 * - 100% Flat theme tokens, macOS-style popover integration, zero hyperbole
 */

(function () {
  'use strict';

  // Global clipboard state for selective attributes
  window.internalAttributeClipboard = null;

  // Active UI state
  let activeMode = 'copy'; // 'copy' | 'paste'
  let activeCategories = new Set();
  let currentTargetLayers = [];
  let currentSourceLayer = null;

  const CATEGORY_DEFINITIONS = {
    // ROW 1: Quick Actions (Speed & Audio, stretched 50%/50%, cut buttons removed)
    speed: {
      id: 'speed',
      row: 'top',
      label: 'Speed',
      icon: '<i class="fticon fticon-speed" aria-hidden="true"></i>',
      isApplicable: (l) => l && (l.type === 'video' || l.type === 'audio' || l.type === 'precomp')
    },
    volume: {
      id: 'volume',
      row: 'top',
      label: 'Audio',
      icon: '<i class="fticon fticon-volume" aria-hidden="true"></i>',
      isApplicable: (l) => l && (l.type === 'video' || l.type === 'audio' || l.type === 'precomp')
    },

    // ROW 2: Action Drawer Buttons
    group: {
      id: 'group',
      row: 'grid',
      label: 'Edit Group',
      icon: '<i class="fticon fticon-edit-group-enter-precompose" aria-hidden="true"></i>',
      isApplicable: (l) => l && l.type === 'precomp'
    },
    shape: {
      id: 'shape',
      row: 'grid',
      label: 'Edit Shape',
      icon: '<i class="fticon fticon-edit-shape" aria-hidden="true"></i>',
      isApplicable: (l) => l && l.type === 'shape'
    },
    text: {
      id: 'text',
      row: 'grid',
      label: 'Text',
      icon: '<i class="fticon fticon-edit-text" aria-hidden="true"></i>',
      isApplicable: (l) => l && l.type === 'text'
    },
    camera: {
      id: 'camera',
      row: 'grid',
      label: 'Camera settings',
      icon: '<i class="fticon fticon-camera" aria-hidden="true"></i>',
      isApplicable: (l) => l && l.type === 'camera'
    },
    transform: {
      id: 'transform',
      row: 'grid',
      label: 'Transform',
      icon: '<i class="fticon fticon-transform-layer" aria-hidden="true"></i>',
      isApplicable: (l) => l && l.type !== 'audio'
    },
    fill: {
      id: 'fill',
      row: 'grid',
      label: 'Fill',
      icon: '<i class="fticon fticon-fill-color-media-gradient" aria-hidden="true"></i>',
      isApplicable: (l) => l && (l.type === 'shape' || l.type === 'video' || l.type === 'image' || l.type === 'text' || l.type === 'precomp')
    },
    blend: {
      id: 'blend',
      row: 'grid',
      label: 'Blend and overlay',
      icon: '<i class="fticon fticon-blend-overlay" aria-hidden="true"></i>',
      isApplicable: (l) => l && (l.type === 'shape' || l.type === 'video' || l.type === 'image' || l.type === 'text' || l.type === 'precomp')
    },
    effects: {
      id: 'effects',
      row: 'grid',
      label: 'Effects',
      icon: '<i class="fticon fticon-effects" aria-hidden="true"></i>',
      isApplicable: (l) => l && (l.type === 'shape' || l.type === 'video' || l.type === 'image' || l.type === 'text' || l.type === 'precomp')
    }
  };

  /**
   * Helper to retrieve currently selected layer objects from project state
   */
  function getSelectedLayers() {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const ids = [];
    if (window.selectedLayerId && !ids.includes(window.selectedLayerId)) ids.push(window.selectedLayerId);
    const set = window.selectedLayerIds || null;
    if (set && set.size > 0) {
      set.forEach(id => { if (!ids.includes(id)) ids.push(id); });
    }
    // Fallback: check DOM active elements if state variable was temporarily desynced
    if (ids.length === 0) {
      const activePill = document.querySelector('.timeline-layer-ctrl-pill.is-selected, .timeline-lane-pill-slot.is-focused, .timeline-clip-block.is-selected');
      if (activePill && activePill.dataset && activePill.dataset.layerId) {
        ids.push(activePill.dataset.layerId);
      }
    }
    const strIds = ids.map(String);
    return layers.filter(l => strIds.includes(String(l.id)));
  }

  /**
   * Check whether layer is of supported types for selective attributes
   */
  function isSupportedLayerType(layer) {
    if (!layer || !layer.type) return false;
    return layer.type === 'shape' || layer.type === 'video' || layer.type === 'image' || layer.type === 'text' || layer.type === 'audio' || layer.type === 'precomp' || layer.type === 'camera' || layer.type === 'null';
  }

  /**
   * Toggles visibility of Copy & Paste buttons: shown ONLY when at least 1 layer is selected
   */
  function updateClipboardButtonsVisibility() {
    let hasSelection = false;
    if (window.selectedLayerIds && window.selectedLayerIds.size > 0) {
      if (window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
        hasSelection = window.currentProjectState.layers.some(l => window.selectedLayerIds.has(l.id));
      } else {
        hasSelection = true;
      }
    } else {
      const sId = window.selectedLayerId || null;
      if (sId && sId !== '') {
        if (window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
          hasSelection = window.currentProjectState.layers.some(l => l.id === sId);
        } else {
          hasSelection = true;
        }
      }
    }

    // Paste is available when selection exists OR clipboard has any content
    const hasClipboardContent = !!(
      window.internalAttributeClipboard ||
      (window.internalLayerClipboard && window.internalLayerClipboard.length > 0)
    );
    const showPaste = hasSelection || hasClipboardContent;

    const desktopBtnCopy = document.getElementById('desktop-btn-copy');
    const desktopBtnPaste = document.getElementById('desktop-btn-paste');
    if (desktopBtnCopy) {
      // Copy: only when selection exists — use class to beat CSS !important
      desktopBtnCopy.classList.toggle('is-clipboard-hidden', !hasSelection);
      desktopBtnCopy.style.display = '';
    }
    if (desktopBtnPaste) {
      // Paste: when selection exists OR clipboard has content — use class to beat CSS !important
      desktopBtnPaste.classList.toggle('is-clipboard-hidden', !showPaste);
      desktopBtnPaste.style.display = '';
    }

    // Mobile dock buttons — inline style is fine (no !important CSS override there)
    const dockCopy = document.getElementById('editor-btn-copy-dock');
    const dockPaste = document.getElementById('editor-btn-paste-dock');
    if (dockCopy) {
      dockCopy.style.display = hasSelection ? 'inline-flex' : 'none';
    }
    if (dockPaste) {
      dockPaste.style.display = showPaste ? 'inline-flex' : 'none';
    }

  }
  window.updateClipboardButtonsVisibility = updateClipboardButtonsVisibility;


  /**
   * Toast notification dispatch helper
   */
  function notify(msg) {
    if (typeof window.showEffectsRackToast === 'function') {
      window.showEffectsRackToast(msg);
      return;
    }
    if (typeof window.showDashboardToast === 'function') {
      window.showDashboardToast(msg);
      return;
    }

    let t = document.getElementById('attr-clipboard-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'attr-clipboard-toast';
      t.style.position = 'fixed';
      t.style.bottom = '24px';
      t.style.left = '50%';
      t.style.transform = 'translateX(-50%)';
      t.style.backgroundColor = 'var(--color-primary)';
      t.style.color = 'var(--bg-canvas)';
      t.style.fontFamily = 'var(--font-brand)';
      t.style.fontSize = '12px';
      t.style.fontWeight = '700';
      t.style.padding = '8px 16px';
      t.style.borderRadius = '20px';
      t.style.zIndex = '9999';
      t.style.pointerEvents = 'none';
      t.style.transition = 'opacity 0.18s ease';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.style.opacity = '0';
    }, 2200);
  }

  /**
   * Extract keyframe tracks for specific properties
   */
  function extractKeyframesForProps(layer, propNames) {
    if (!layer || !layer.keyframes) return null;
    const res = {};
    let found = false;
    propNames.forEach(p => {
      if (Array.isArray(layer.keyframes[p]) && layer.keyframes[p].length > 0) {
        res[p] = JSON.parse(JSON.stringify(layer.keyframes[p]));
        found = true;
      }
    });
    return found ? res : null;
  }

  /**
   * Proportional keyframe time stretching across layer boundaries:
   * Maps keyframe at srcTime in source layer [sourceStartSec, sourceStartSec + sourceDur]
   * to target layer [targetStartSec, targetStartSec + targetDur].
   * If durations are not available or 0, gracefully falls back to delta shift.
   */
  function mapKeyframeTime(srcTime, sourceStartSec, sourceDur, targetStartSec, targetDur) {
    if (typeof srcTime !== 'number' || isNaN(srcTime)) return targetStartSec;
    if (sourceDur <= 0.0001 || targetDur <= 0.0001) {
      return Number(Math.max(0, srcTime + (targetStartSec - sourceStartSec)).toFixed(4));
    }
    const progress = (srcTime - sourceStartSec) / sourceDur;
    const targetTime = targetStartSec + progress * targetDur;
    return Number(Math.max(0, targetTime).toFixed(4));
  }

  /**
   * Apply time-stretched keyframes to a target layer
   */
  function applyShiftedKeyframes(targetLayer, kfMap, sourceStartSec, sourceDur, targetStartSec, targetDur) {
    if (!targetLayer || !kfMap) return;
    if (!targetLayer.keyframes) targetLayer.keyframes = {};
    Object.keys(kfMap).forEach(prop => {
      const track = kfMap[prop];
      if (Array.isArray(track)) {
        targetLayer.keyframes[prop] = track.map(kf => ({
          time: mapKeyframeTime(kf.time, sourceStartSec, sourceDur, targetStartSec, targetDur),
          value: (kf.value !== undefined) ? JSON.parse(JSON.stringify(kf.value)) : null,
          easing: kf.easing ? [...kf.easing] : [0, 0, 1, 1]
        }));
      }
    });
  }

  /**
   * Build attributes clipboard payload from source layer
   */
  function extractAttributesPayload(layer, categoriesSet) {
    const pps = (typeof window.currentPixelsPerSecond === 'number' && window.currentPixelsPerSecond > 0) ? window.currentPixelsPerSecond : 80;
    const startSec = (layer.startSec !== undefined) ? layer.startSec : ((layer.startPx || 0) / pps);
    const durationSec = (layer.durationSec !== undefined) ? layer.durationSec : ((layer.widthPx || 400) / pps);

    const safeCloneSource = (window.UndoRedoManager && typeof window.UndoRedoManager._safeClone === 'function')
      ? window.UndoRedoManager._safeClone(layer)
      : JSON.parse(JSON.stringify(layer, (k, v) => (typeof v === 'function' || (k.startsWith('_') && k !== '_bgCutoutBitmap') ? undefined : v)));

    const payload = {
      sourceLayerId: layer.id,
      sourceLayerName: layer.name || 'Layer',
      sourceLayerType: layer.type,
      sourceStartSec: startSec,
      sourceDurationSec: durationSec,
      sourceLayerSnapshot: safeCloneSource,
      categories: Array.from(categoriesSet),
      data: {}
    };

    // 1. Fill
    if (categoriesSet.has('fill')) {
      const effectiveFillColor = (layer.textProps && layer.textProps.fillColor) || layer.fillColor || layer.color || '#98ce7b';
      const effectiveFillType = layer.fillType || (layer.type === 'video' || layer.type === 'image' ? 'media' : 'color');
      const effectiveMediaUrl = layer.dataUrl || layer.fillMediaUrl || layer.thumbUrl || null;
      const effectiveMediaId = layer.mediaId || layer.fillMediaId || null;

      payload.data.fill = {
        fillType: effectiveFillType,
        fillColor: effectiveFillColor,
        color: effectiveFillColor,
        fillGradType: layer.fillGradType || 'linear',
        fillGradAngle: (layer.fillGradAngle !== undefined) ? layer.fillGradAngle : 90,
        fillGradStops: Array.isArray(layer.fillGradStops) ? JSON.parse(JSON.stringify(layer.fillGradStops)) : null,
        fillGradColor1: layer.fillGradColor1 || null,
        fillGradColor2: layer.fillGradColor2 || null,
        fillGradient: layer.fillGradient ? JSON.parse(JSON.stringify(layer.fillGradient)) : null,
        fillMediaId: effectiveMediaId,
        fillMediaUrl: effectiveMediaUrl,
        dataUrl: layer.dataUrl || effectiveMediaUrl,
        thumbUrl: layer.thumbUrl || null,
        mediaId: effectiveMediaId,
        mediaWidth: layer.mediaWidth || null,
        mediaHeight: layer.mediaHeight || null,
        mediaFillMode: layer.mediaFillMode || null,
        fillTint: layer.fillTint || null,
        isSolid: !!layer.isSolid,
        sourceType: layer.type,
        keyframes: extractKeyframesForProps(layer, ['fillColor', 'color', 'fillGradient'])
      };
    }

    // 2. Text & Typography
    if (categoriesSet.has('text') && layer.type === 'text') {
      payload.data.text = {
        textProps: layer.textProps ? JSON.parse(JSON.stringify(layer.textProps)) : {},
        fillColor: (layer.textProps && layer.textProps.fillColor) || layer.fillColor || '#ffffff',
        fontFamily: (layer.textProps && layer.textProps.fontFamily) || 'Cal Sans',
        fontSize: (layer.textProps && layer.textProps.fontSize) || 48
      };
    }

    // 3. Edit Shape
    if (categoriesSet.has('shape') && layer.type === 'shape') {
      payload.data.shape = {
        shapeType: layer.shapeType || 'rectangle',
        shapeProps: layer.shapeProps ? JSON.parse(JSON.stringify(layer.shapeProps)) : {},
        roundness: layer.roundness,
        strokeColor: layer.strokeColor,
        strokeWidth: layer.strokeWidth,
        strokeType: layer.strokeType,
        isSolid: !!layer.isSolid,
        keyframes: extractKeyframesForProps(layer, ['roundness', 'strokeWidth', 'strokeColor'])
      };
    }

    // 4. Edit Group (Precompose)
    if (categoriesSet.has('group') && layer.type === 'precomp') {
      payload.data.group = {
        layers: Array.isArray(layer.layers) ? JSON.parse(JSON.stringify(layer.layers)) : []
      };
    }

    // 5. Camera settings
    if (categoriesSet.has('camera') && layer.type === 'camera') {
      payload.data.camera = {
        cameraLens: layer.cameraLens,
        cameraLensPreset: layer.cameraLensPreset,
        cameraZoom: layer.cameraZoom,
        cameraBlurEnabled: !!layer.cameraBlurEnabled,
        cameraFocusMode: layer.cameraFocusMode,
        cameraFocusDistance: layer.cameraFocusDistance,
        cameraFocusTargetLayerId: layer.cameraFocusTargetLayerId,
        cameraBlurAmount: layer.cameraBlurAmount,
        cameraBlurNearFar: layer.cameraBlurNearFar,
        cameraBlurBalance: layer.cameraBlurBalance,
        keyframes: extractKeyframesForProps(layer, [
          'cameraLens', 'cameraZoom', 'cameraFocusDistance', 'cameraBlurAmount', 'cameraBlurNearFar', 'cameraBlurBalance'
        ])
      };
    }

    // 6. Blend & Overlay (Opacity & Blend)
    if (categoriesSet.has('blend') || categoriesSet.has('opacityBlend')) {
      payload.data.blend = {
        opacity: (layer.opacity !== undefined) ? layer.opacity : 1.0,
        blendMode: layer.blendMode || 'normal',
        keyframes: extractKeyframesForProps(layer, ['opacity'])
      };
      payload.data.opacityBlend = payload.data.blend;
    }

    // 7. Effects
    if (categoriesSet.has('effects')) {
      const fxList = Array.isArray(layer.effects) ? JSON.parse(JSON.stringify(layer.effects)) : [];
      const effectKeyframes = {};
      if (layer.keyframes) {
        fxList.forEach(fx => {
          Object.keys(layer.keyframes).forEach(k => {
            if (k.startsWith(fx.id + ':')) {
              effectKeyframes[k] = JSON.parse(JSON.stringify(layer.keyframes[k]));
            }
          });
        });
      }
      payload.data.effects = {
        effects: fxList,
        keyframes: effectKeyframes
      };
    }

    // 8. Transform
    if (categoriesSet.has('transform')) {
      const tProps = [
        'posX', 'posY', 'posZ',
        'scaleW', 'scaleH', 'scale', 'scaleX', 'scaleY', 'scaleZ',
        'rotX', 'rotY', 'rotZ', 'rotation',
        'originX', 'originY', 'anchorX', 'anchorY',
        'skewX', 'skewY'
      ];
      const vals = {};
      tProps.forEach(p => {
        if (layer[p] !== undefined) vals[p] = layer[p];
      });
      payload.data.transform = {
        values: vals,
        keyframes: extractKeyframesForProps(layer, [
          'move', 'pos', 'position', 'scale', 'scaleW', 'scaleH',
          'rotate', 'rotation', 'rotX', 'rotY', 'rotZ',
          'skew', 'skewX', 'skewY', 'anchor', 'originX', 'originY'
        ])
      };
    }

    // 9. Border & Shadow (backward compat)
    if (categoriesSet.has('borderShadow')) {
      const bsProps = [
        'strokeColor', 'strokeWidth', 'strokeType',
        'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY',
        'glowColor', 'glowRadius'
      ];
      const vals = {};
      bsProps.forEach(p => {
        if (layer[p] !== undefined) vals[p] = layer[p];
      });
      payload.data.borderShadow = {
        values: vals,
        keyframes: extractKeyframesForProps(layer, ['strokeWidth', 'strokeColor', 'shadowBlur', 'glowRadius'])
      };
    }

    // 10. Speed (Top row)
    if (categoriesSet.has('speed') || categoriesSet.has('speedVolume')) {
      payload.data.speed = {
        speed: (layer.speed !== undefined) ? layer.speed : 1.0,
        speedInterpolation: layer.speedInterpolation || 'none',
        keyframes: extractKeyframesForProps(layer, ['speed'])
      };
    }

    // 11. Audio / Volume (Top row)
    if (categoriesSet.has('volume') || categoriesSet.has('speedVolume')) {
      payload.data.volume = {
        volume: (layer.volume !== undefined) ? layer.volume : 1.0,
        muted: !!layer.muted,
        preservePitch: layer.preservePitch !== undefined ? layer.preservePitch : true,
        audioEffects: Array.isArray(layer.audioEffects) ? JSON.parse(JSON.stringify(layer.audioEffects)) : [],
        keyframes: extractKeyframesForProps(layer, ['volume'])
      };
    }

    if (payload.data.speed || payload.data.volume) {
      payload.data.speedVolume = {
        speed: payload.data.speed ? payload.data.speed.speed : 1.0,
        volume: payload.data.volume ? payload.data.volume.volume : 1.0,
        muted: payload.data.volume ? payload.data.volume.muted : false,
        audioEffects: payload.data.volume ? payload.data.volume.audioEffects : [],
        keyframes: Object.assign({}, (payload.data.speed && payload.data.speed.keyframes) || {}, (payload.data.volume && payload.data.volume.keyframes) || {})
      };
    }

    return payload;
  }

  /**
   * Apply attributes payload to target layer
   */
  function applyAttributesToTarget(targetLayer, payload, categoriesSet) {
    const pps = (typeof window.currentPixelsPerSecond === 'number' && window.currentPixelsPerSecond > 0) ? window.currentPixelsPerSecond : 80;
    const targetStartSec = (targetLayer.startSec !== undefined) ? targetLayer.startSec : ((targetLayer.startPx || 0) / pps);
    const targetDur = (targetLayer.durationSec !== undefined) ? targetLayer.durationSec : ((targetLayer.widthPx || 400) / pps);
    const sourceStartSec = (payload.sourceStartSec !== undefined) ? payload.sourceStartSec : 0;
    const sourceDur = (payload.sourceDurationSec !== undefined && payload.sourceDurationSec > 0) ? payload.sourceDurationSec : 0;

    if (!targetLayer.keyframes) targetLayer.keyframes = {};

    // 1. Fill
    if (categoriesSet.has('fill') && payload.data.fill) {
      const d = payload.data.fill;
      if (d.fillType !== undefined) targetLayer.fillType = d.fillType;
      if (d.fillColor !== undefined) {
        targetLayer.fillColor = d.fillColor;
        targetLayer.color = d.fillColor;
      }
      if (d.fillGradType !== undefined) targetLayer.fillGradType = d.fillGradType;
      if (d.fillGradAngle !== undefined) targetLayer.fillGradAngle = d.fillGradAngle;
      if (d.fillGradStops) targetLayer.fillGradStops = JSON.parse(JSON.stringify(d.fillGradStops));
      if (d.fillGradColor1 !== undefined) targetLayer.fillGradColor1 = d.fillGradColor1;
      if (d.fillGradColor2 !== undefined) targetLayer.fillGradColor2 = d.fillGradColor2;
      if (d.fillGradient) targetLayer.fillGradient = JSON.parse(JSON.stringify(d.fillGradient));
      if (d.fillMediaId !== undefined) targetLayer.fillMediaId = d.fillMediaId;
      if (d.fillMediaUrl !== undefined) targetLayer.fillMediaUrl = d.fillMediaUrl;
      if (d.mediaFillMode !== undefined) targetLayer.mediaFillMode = d.mediaFillMode;
      if (d.fillTint !== undefined) targetLayer.fillTint = d.fillTint;
      if (d.isSolid !== undefined && targetLayer.type === 'shape') targetLayer.isSolid = d.isSolid;

      const newMediaDataUrl = d.dataUrl || d.fillMediaUrl || null;
      if (newMediaDataUrl) {
        // Clear media cache for target layer so canvas immediately reloads and renders new image
        if (window.layerMediaCache) {
          window.layerMediaCache.delete(targetLayer.id);
          if (targetLayer.mediaId) window.layerMediaCache.delete(targetLayer.mediaId);
          if (targetLayer.fillMediaId) window.layerMediaCache.delete(targetLayer.fillMediaId);
        }

        if (targetLayer.type === 'image' || targetLayer.type === 'video') {
          targetLayer.dataUrl = newMediaDataUrl;
          if (d.thumbUrl) targetLayer.thumbUrl = d.thumbUrl;
          if (d.mediaId) targetLayer.mediaId = d.mediaId;
          if (d.mediaWidth) targetLayer.mediaWidth = d.mediaWidth;
          if (d.mediaHeight) targetLayer.mediaHeight = d.mediaHeight;

          if (targetLayer.type === 'image' && typeof window.getOrLoadLayerMedia === 'function') {
            const mediaEntry = window.getOrLoadLayerMedia(targetLayer);
            const img = new Image();
            if (targetLayer.dataUrl && !targetLayer.dataUrl.startsWith('blob:')) {
              img.crossOrigin = 'anonymous';
            }
            img.onload = () => {
              if (mediaEntry) {
                mediaEntry.isReady = true;
                mediaEntry.el = img;
                mediaEntry.type = 'image';
              }
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                targetLayer.mediaWidth = img.naturalWidth;
                targetLayer.mediaHeight = img.naturalHeight;
                if (!targetLayer._userResized && typeof window.fitLayerToComposition === 'function') {
                  window.fitLayerToComposition(targetLayer, img.naturalWidth, img.naturalHeight);
                }
              }
              if (typeof window.invalidatePreviewCacheForLayer === 'function') {
                window.invalidatePreviewCacheForLayer(targetLayer);
              }
              if (typeof window.redrawComposition === 'function') {
                window.redrawComposition('paste-fill-img-loaded');
              }
            };
            img.src = targetLayer.dataUrl;
            if (mediaEntry) {
              mediaEntry.el = img;
              mediaEntry.type = 'image';
            }
          } else if (targetLayer.type === 'video' && typeof window.getOrLoadLayerMedia === 'function') {
            const mediaEntry = window.getOrLoadLayerMedia(targetLayer);
            if (mediaEntry && mediaEntry.el) {
              mediaEntry.el.src = targetLayer.dataUrl;
              mediaEntry.el.load();
            }
          }
        } else if (targetLayer.type === 'shape') {
          targetLayer.fillType = 'media';
          targetLayer.fillMediaUrl = newMediaDataUrl;
          if (d.mediaId || d.fillMediaId) targetLayer.fillMediaId = d.mediaId || d.fillMediaId;
        }
      }

      // Invalidate dynamic fill cache canvas
      targetLayer._fillDirty = true;
      targetLayer._lastFillRenderKey = null;
      targetLayer._fillBufferCanvas = null;
      targetLayer._cachedCanvas = null;
      targetLayer._fillMediaImg = null;

      if (typeof window.invalidatePreviewCacheForLayer === 'function') {
        window.invalidatePreviewCacheForLayer(targetLayer);
      }

      if (targetLayer.type === 'text') {
        if (!targetLayer.textProps) targetLayer.textProps = {};
        if (d.fillColor !== undefined) {
          targetLayer.fillColor = d.fillColor;
          targetLayer.textProps.fillColor = d.fillColor;
        }
      }

      applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 2. Text & Typography
    if (categoriesSet.has('text') && payload.data.text && targetLayer.type === 'text') {
      const td = payload.data.text;
      if (!targetLayer.textProps) targetLayer.textProps = {};
      if (td.textProps) {
        Object.assign(targetLayer.textProps, JSON.parse(JSON.stringify(td.textProps)));
      }
      if (td.fillColor) {
        targetLayer.fillColor = td.fillColor;
        targetLayer.textProps.fillColor = td.fillColor;
      }
      if (typeof window.FishTextEngine !== 'undefined' && typeof window.FishTextEngine.getNaturalSize === 'function') {
        const nat = window.FishTextEngine.getNaturalSize(targetLayer);
        if (nat && nat.width > 0 && nat.height > 0) {
          targetLayer.mediaWidth = nat.width;
          targetLayer.mediaHeight = nat.height;
        }
      }
    }

    // 3. Edit Shape
    if (categoriesSet.has('shape') && payload.data.shape && targetLayer.type === 'shape') {
      const d = payload.data.shape;
      if (d.shapeType) targetLayer.shapeType = d.shapeType;
      if (d.shapeProps) targetLayer.shapeProps = JSON.parse(JSON.stringify(d.shapeProps));
      if (d.roundness !== undefined) targetLayer.roundness = d.roundness;
      if (d.strokeColor !== undefined) targetLayer.strokeColor = d.strokeColor;
      if (d.strokeWidth !== undefined) targetLayer.strokeWidth = d.strokeWidth;
      if (d.strokeType !== undefined) targetLayer.strokeType = d.strokeType;
      if (d.isSolid !== undefined) targetLayer.isSolid = d.isSolid;
      if (d.keyframes) applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 4. Edit Group (Precompose)
    if (categoriesSet.has('group') && payload.data.group && targetLayer.type === 'precomp') {
      if (Array.isArray(payload.data.group.layers)) {
        targetLayer.layers = JSON.parse(JSON.stringify(payload.data.group.layers));
      }
    }

    // 5. Camera settings
    if (categoriesSet.has('camera') && payload.data.camera && targetLayer.type === 'camera') {
      const d = payload.data.camera;
      ['cameraLens', 'cameraLensPreset', 'cameraZoom', 'cameraBlurEnabled', 'cameraFocusMode', 'cameraFocusDistance', 'cameraFocusTargetLayerId', 'cameraBlurAmount', 'cameraBlurNearFar', 'cameraBlurBalance'].forEach(p => {
        if (d[p] !== undefined) targetLayer[p] = d[p];
      });
      if (d.keyframes) applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 6. Blend & Overlay (Opacity & Blend)
    if ((categoriesSet.has('blend') || categoriesSet.has('opacityBlend')) && (payload.data.blend || payload.data.opacityBlend)) {
      const d = payload.data.blend || payload.data.opacityBlend;
      if (d.opacity !== undefined) targetLayer.opacity = d.opacity;
      if (d.blendMode !== undefined) targetLayer.blendMode = d.blendMode;
      applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 7. Effects
    if (categoriesSet.has('effects') && payload.data.effects) {
      const d = payload.data.effects;
      // Clean up previous effect keyframes on target
      if (Array.isArray(targetLayer.effects)) {
        targetLayer.effects.forEach(oldFx => {
          Object.keys(targetLayer.keyframes).forEach(k => {
            if (k.startsWith(oldFx.id + ':')) delete targetLayer.keyframes[k];
          });
        });
      }

      const newEffects = [];
      if (Array.isArray(d.effects)) {
        d.effects.forEach((fx, idx) => {
          const oldId = fx.id;
          const newId = 'fx_' + (fx.type || 'effect') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + idx;
          const clonedFx = JSON.parse(JSON.stringify(fx));
          clonedFx.id = newId;
          newEffects.push(clonedFx);

          if (d.keyframes) {
            Object.keys(d.keyframes).forEach(oldKey => {
              if (oldKey.startsWith(oldId + ':')) {
                const paramName = oldKey.slice(oldId.length + 1);
                const newKey = `${newId}:${paramName}`;
                const shifted = (d.keyframes[oldKey] || []).map(kf => ({
                  time: mapKeyframeTime(kf.time, sourceStartSec, sourceDur, targetStartSec, targetDur),
                  value: (kf.value !== undefined) ? JSON.parse(JSON.stringify(kf.value)) : null,
                  easing: kf.easing ? [...kf.easing] : [0, 0, 1, 1]
                }));
                targetLayer.keyframes[newKey] = shifted;
              }
            });
          }
        });
      }
      targetLayer.effects = newEffects;
    }

    // 8. Transform
    if (categoriesSet.has('transform') && payload.data.transform) {
      const d = payload.data.transform;
      if (d.values) {
        Object.keys(d.values).forEach(prop => {
          targetLayer[prop] = d.values[prop];
        });
      }
      applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 9. Border & Shadow (backward compat)
    if (categoriesSet.has('borderShadow') && payload.data.borderShadow) {
      const d = payload.data.borderShadow;
      if (d.values) {
        Object.keys(d.values).forEach(prop => {
          targetLayer[prop] = d.values[prop];
        });
        if (targetLayer.type === 'text') {
          if (!targetLayer.textProps) targetLayer.textProps = {};
          if (d.values.strokeColor !== undefined) targetLayer.textProps.strokeColor = d.values.strokeColor;
          if (d.values.strokeWidth !== undefined) targetLayer.textProps.strokeWidth = d.values.strokeWidth;
          if (d.values.shadowColor !== undefined) targetLayer.textProps.shadowColor = d.values.shadowColor;
          if (d.values.shadowBlur !== undefined) targetLayer.textProps.shadowBlur = d.values.shadowBlur;
        }
      }
      applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 10. Speed
    if ((categoriesSet.has('speed') || categoriesSet.has('speedVolume')) && (targetLayer.type === 'video' || targetLayer.type === 'audio' || targetLayer.type === 'precomp')) {
      const d = payload.data.speed || payload.data.speedVolume;
      if (d) {
        if (d.speed !== undefined) targetLayer.speed = d.speed;
        if (d.speedInterpolation !== undefined) targetLayer.speedInterpolation = d.speedInterpolation;
        if (d.keyframes) applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
      }
    }

    // 11. Audio / Volume
    if ((categoriesSet.has('volume') || categoriesSet.has('speedVolume')) && (targetLayer.type === 'video' || targetLayer.type === 'audio' || targetLayer.type === 'precomp')) {
      const d = payload.data.volume || payload.data.speedVolume;
      if (d) {
        if (d.volume !== undefined) targetLayer.volume = d.volume;
        if (d.muted !== undefined) targetLayer.muted = d.muted;
        if (d.preservePitch !== undefined) targetLayer.preservePitch = d.preservePitch;
        if (Array.isArray(d.audioEffects)) {
          targetLayer.audioEffects = JSON.parse(JSON.stringify(d.audioEffects)).map(fx => {
            fx.id = 'fx_' + (fx.type || 'audio') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            return fx;
          });
        }
        if (d.keyframes) applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
      }
    }

    if (typeof window.invalidatePreviewCacheForLayer === 'function') {
      window.invalidatePreviewCacheForLayer(targetLayer);
    }
  }

  /**
   * Render popover card UI for either Copy or Paste
   */
  function renderAttributesPopover(mode, layerOrLayers, anchorEl) {
    const popoverEl = document.getElementById('popover-layer-attributes');
    if (!popoverEl) return;

    activeMode = mode;
    activeCategories = new Set();

    const titleEl = document.getElementById('attr-popover-title');
    const subtitleEl = document.getElementById('attr-popover-subtitle');
    const speedAudioRowEl = document.getElementById('attr-speed-audio-row');
    const gridEl = document.getElementById('attr-toggle-grid');
    const actionBtn = document.getElementById('attr-btn-action');

    if (!gridEl || !actionBtn) return;
    if (speedAudioRowEl) speedAudioRowEl.innerHTML = '';
    gridEl.innerHTML = '';

    if (mode === 'copy') {
      currentSourceLayer = layerOrLayers;
      currentTargetLayers = [];
      if (titleEl) titleEl.textContent = 'Copy Attributes';
      if (subtitleEl) {
        const typeLabel = currentSourceLayer.type.charAt(0).toUpperCase() + currentSourceLayer.type.slice(1);
        subtitleEl.textContent = `${currentSourceLayer.name || 'Layer'} (${typeLabel})`;
      }
      actionBtn.textContent = 'Copy';

      // Build toggle cards for applicable categories
      Object.keys(CATEGORY_DEFINITIONS).forEach(catKey => {
        const def = CATEGORY_DEFINITIONS[catKey];
        if (!def.isApplicable(currentSourceLayer)) return;

        // By default, pre-select all applicable categories
        activeCategories.add(catKey);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'attr-toggle-btn is-active';
        btn.dataset.category = catKey;

        const labelText = def.label;

        btn.innerHTML = `
          <span class="attr-toggle-icon">${def.icon}</span>
          <span class="attr-toggle-label">${labelText}</span>
        `;

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (activeCategories.has(catKey)) {
            activeCategories.delete(catKey);
            btn.classList.remove('is-active');
          } else {
            activeCategories.add(catKey);
            btn.classList.add('is-active');
          }
        });

        if (def.row === 'top' && speedAudioRowEl) {
          speedAudioRowEl.appendChild(btn);
        } else {
          gridEl.appendChild(btn);
        }
      });
    } else {
      // Paste mode
      currentTargetLayers = Array.isArray(layerOrLayers) ? layerOrLayers : [layerOrLayers];
      currentSourceLayer = null;

      if (titleEl) titleEl.textContent = 'Paste Attributes';
      if (subtitleEl) {
        subtitleEl.textContent = currentTargetLayers.length === 1
          ? currentTargetLayers[0].name || 'Target Layer'
          : `${currentTargetLayers.length} Layers Selected`;
      }
      actionBtn.textContent = 'Paste';

      const clip = window.internalAttributeClipboard;
      const copiedCategories = clip ? new Set(clip.categories || []) : new Set();
      if (copiedCategories.has('speedVolume')) {
        copiedCategories.add('speed');
        copiedCategories.add('volume');
      }
      if (copiedCategories.has('opacityBlend')) {
        copiedCategories.add('blend');
      }
      if (copiedCategories.has('blend')) {
        copiedCategories.add('opacityBlend');
      }

      Object.keys(CATEGORY_DEFINITIONS).forEach(catKey => {
        const def = CATEGORY_DEFINITIONS[catKey];
        const isApplicableToTarget = currentTargetLayers.some(l => def.isApplicable(l));
        if (!isApplicableToTarget) return;

        const hasInClipboard = copiedCategories.has(catKey) ||
          (catKey === 'speed' && (copiedCategories.has('speed') || copiedCategories.has('speedVolume'))) ||
          (catKey === 'volume' && (copiedCategories.has('volume') || copiedCategories.has('speedVolume'))) ||
          (catKey === 'blend' && (copiedCategories.has('blend') || copiedCategories.has('opacityBlend')));

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.category = catKey;

        const labelText = def.label;

        if (hasInClipboard) {
          // Available from clipboard: enabled & active by default
          activeCategories.add(catKey);
          btn.className = 'attr-toggle-btn is-active';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeCategories.has(catKey)) {
              activeCategories.delete(catKey);
              btn.classList.remove('is-active');
            } else {
              activeCategories.add(catKey);
              btn.classList.add('is-active');
            }
          });
        } else {
          // Not copied in clipboard: uncheckable / disabled
          btn.className = 'attr-toggle-btn is-disabled';
          btn.title = 'Attribute not present in clipboard';
        }

        btn.innerHTML = `
          <span class="attr-toggle-icon">${def.icon}</span>
          <span class="attr-toggle-label">${labelText}</span>
        `;

        if (def.row === 'top' && speedAudioRowEl) {
          speedAudioRowEl.appendChild(btn);
        } else {
          gridEl.appendChild(btn);
        }
      });
    }

    // Open popover anchored to trigger button
    if (window.Popover && anchorEl) {
      window.Popover.open(anchorEl, 'popover-layer-attributes');
    }
  }

  /**
   * Action button click (Copy or Paste)
   */
  function handleActionClick() {
    if (activeMode === 'copy') {
      if (!currentSourceLayer) return;
      if (activeCategories.size === 0) {
        notify('Please select at least one attribute to copy');
        return;
      }

      const payload = extractAttributesPayload(currentSourceLayer, activeCategories);
      window.internalAttributeClipboard = payload;
      window.lastClipboardType = 'attributes';

      // Keep internalLayerClipboard in sync with full layer clone
      if (payload.sourceLayerSnapshot) {
        const fullLayerClone = (window.UndoRedoManager && typeof window.UndoRedoManager._safeClone === 'function')
          ? window.UndoRedoManager._safeClone(payload.sourceLayerSnapshot)
          : JSON.parse(JSON.stringify(payload.sourceLayerSnapshot));
        window.internalLayerClipboard = [fullLayerClone];
      }

      if (window.Popover) window.Popover.close();

      const labels = Array.from(activeCategories).map(k => (CATEGORY_DEFINITIONS[k] ? CATEGORY_DEFINITIONS[k].label : k));
      notify(`Copied: ${labels.join(', ')}`);
    } else {
      // Execute paste
      if (!window.internalAttributeClipboard || !currentTargetLayers.length) return;
      if (activeCategories.size === 0) {
        notify('Please select at least one attribute to paste');
        return;
      }

      if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
        window.UndoRedoManager.recordSnapshot();
      }

      const payload = window.internalAttributeClipboard;
      currentTargetLayers.forEach(l => {
        applyAttributesToTarget(l, payload, activeCategories);
      });

      if (typeof window.saveCurrentProjectLayers === 'function') {
        window.saveCurrentProjectLayers();
      }
      if (typeof window.renderTimelineLayers === 'function') {
        window.renderTimelineLayers();
      }
      if (typeof window.redrawComposition === 'function') {
        window.redrawComposition('pasteAttributes');
      }
      if (typeof window.syncFillControllerUI === 'function') {
        window.syncFillControllerUI();
      }
      if (typeof window.syncTextControllerUI === 'function') {
        window.syncTextControllerUI();
      }
      if (typeof window.syncShapeControllerUI === 'function') {
        window.syncShapeControllerUI();
      }
      if (typeof window.syncCameraSettingsUI === 'function') {
        window.syncCameraSettingsUI();
      }
      if (typeof window.syncEffectsRackUI === 'function') {
        window.syncEffectsRackUI();
      }
      if (typeof window.syncInspectorState === 'function') {
        window.syncInspectorState();
      }

      if (window.Popover) window.Popover.close();

      const count = currentTargetLayers.length;
      notify(`Attributes pasted to ${count} layer${count > 1 ? 's' : ''}`);
    }
  }

  /**
   * Main entry point when Copy button is pressed
   */
  function triggerCopy(anchorEl) {
    const selected = getSelectedLayers();

    // Condition A: Multi-selection (> 1 layer)
    if (selected.length > 1) {
      if (typeof window.copySelectedLayers === 'function') {
        window.copySelectedLayers();
        notify(`Copied ${selected.length} layers`);
      }
      return;
    }

    // Condition B: Zero selection
    if (selected.length === 0) {
      notify('No layer selected');
      return;
    }

    // Condition C: Single selection
    const layer = selected[0];
    if (isSupportedLayerType(layer)) {
      renderAttributesPopover('copy', layer, anchorEl);
    } else {
      // Text, Audio, Camera, Null, Adjustment, Precomp -> Standard Layer Copy
      if (typeof window.copySelectedLayers === 'function') {
        window.copySelectedLayers();
        notify(`Copied ${layer.name || 'layer'}`);
      }
    }
  }

  /**
   * Main entry point when Paste button is pressed
   */
  function triggerPaste(anchorEl) {
    const clipType = window.lastClipboardType;

    // Standard layer paste fallback
    if (clipType === 'layer') {
      if (typeof window.pasteLayers === 'function') {
        window.pasteLayers();
      }
      return;
    }

    // Keyframe paste fallback
    if (clipType === 'keyframe') {
      if (typeof window.pasteKeyframes === 'function') {
        window.pasteKeyframes();
      }
      return;
    }

    // Selective attributes paste
    if (clipType === 'attributes' && window.internalAttributeClipboard) {
      const selected = getSelectedLayers();
      const compatibleTargets = selected.filter(isSupportedLayerType);

      // If no layer is selected, OR if the selected layer is the exact source layer:
      // User's intention is to duplicate/paste as a new layer at the playhead!
      if (compatibleTargets.length === 0 || (compatibleTargets.length === 1 && compatibleTargets[0].id === window.internalAttributeClipboard.sourceLayerId)) {
        pasteAttributesAsNewLayer();
        return;
      }

      renderAttributesPopover('paste', compatibleTargets, anchorEl);
      return;
    }

    // Default fallback if clipboard empty or layer clipboard exists
    if (window.internalLayerClipboard && window.internalLayerClipboard.length > 0) {
      if (typeof window.pasteLayers === 'function') {
        window.pasteLayers();
      }
    } else {
      notify('Clipboard is empty');
    }
  }

  /**
   * Paste clipboard contents as a brand-new layer matching the exact source layer type and configuration,
   * shifting keyframes and inserting at the playhead on top of the timeline.
   */
  function pasteAttributesAsNewLayer() {
    const clip = window.internalAttributeClipboard;
    if (!clip) return;

    const ps = window.currentProjectState;
    if (!ps || !Array.isArray(ps.layers)) return;

    // Resolve playhead position for layer start
    const pps = (typeof window.currentPixelsPerSecond === 'number' && window.currentPixelsPerSecond > 0)
      ? window.currentPixelsPerSecond
      : 80;
    const panXVal = (typeof window.timelinePanX === 'number') ? window.timelinePanX : 0;
    const playheadSec = Math.max(0, -panXVal / pps);

    const durSec = (clip.sourceDurationSec && clip.sourceDurationSec > 0.1) ? clip.sourceDurationSec : 5;
    const origStartSec = clip.sourceStartSec !== undefined ? clip.sourceStartSec : 0;
    const deltaSec = playheadSec - origStartSec;

    const newId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + ps.layers.length;

    let newLayer;
    if (clip.sourceLayerSnapshot) {
      newLayer = (window.UndoRedoManager && typeof window.UndoRedoManager._safeClone === 'function')
        ? window.UndoRedoManager._safeClone(clip.sourceLayerSnapshot)
        : JSON.parse(JSON.stringify(clip.sourceLayerSnapshot));

      newLayer.id = newId;
      newLayer.name = clip.sourceLayerName ? (clip.sourceLayerName + ' (Copy)') : (clip.sourceLayerType ? (clip.sourceLayerType.charAt(0).toUpperCase() + clip.sourceLayerType.slice(1) + ' (Copy)') : 'Layer (Copy)');
      newLayer.startSec = playheadSec;
      newLayer.startPx = Math.round(playheadSec * pps);
      newLayer.durationSec = durSec;
      newLayer.widthPx = Math.round(durSec * pps);

      // Deep clone keyframes & shift all times by deltaSec so animation aligns with pasted layer
      if (newLayer.keyframes && Math.abs(deltaSec) > 0.0001) {
        Object.keys(newLayer.keyframes).forEach(prop => {
          if (Array.isArray(newLayer.keyframes[prop])) {
            newLayer.keyframes[prop].forEach(kf => {
              if (typeof kf.time === 'number') {
                kf.time = Number(Math.max(0, kf.time + deltaSec).toFixed(4));
              }
            });
          }
        });
      }

      // Regenerate effect IDs and remap keyframes
      if (Array.isArray(newLayer.effects)) {
        newLayer.effects.forEach(fx => {
          const oldId = fx.id;
          const newFxId = 'fx_' + (fx.type || 'effect') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + Math.floor(Math.random() * 1000);
          fx.id = newFxId;
          if (newLayer.keyframes) {
            Object.keys(newLayer.keyframes).forEach(k => {
              if (k.startsWith(oldId + ':')) {
                const paramName = k.slice(oldId.length + 1);
                newLayer.keyframes[`${newFxId}:${paramName}`] = newLayer.keyframes[k];
                delete newLayer.keyframes[k];
              }
            });
          }
        });
      }

      // Regenerate audio effect IDs
      if (Array.isArray(newLayer.audioEffects)) {
        newLayer.audioEffects.forEach(fx => {
          fx.id = 'fx_' + (fx.type || 'audio') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        });
      }

      // Preserve media and cutout references
      const origLayer = clip.sourceLayerSnapshot;
      if (origLayer._bgCutoutBitmap) newLayer._bgCutoutBitmap = origLayer._bgCutoutBitmap;
      if (origLayer._lastMattingModel) newLayer._lastMattingModel = origLayer._lastMattingModel;
      if (origLayer._fillMediaImg) newLayer._fillMediaImg = origLayer._fillMediaImg;

      if (window.FishBgRemovalEngine) {
        const cutout = origLayer._bgCutoutBitmap || window.FishBgRemovalEngine.getPhotoCutout(origLayer);
        if (cutout) {
          newLayer._bgCutoutBitmap = cutout;
          if (window.FishBgRemovalEngine._photoCutoutCache) {
            window.FishBgRemovalEngine._photoCutoutCache.set(newId, cutout);
            if (newLayer.mediaId) window.FishBgRemovalEngine._photoCutoutCache.set(newLayer.mediaId, cutout);
          }
        }
      }

      if (window.layerMediaCache) {
        const origMedia = window.layerMediaCache.get(origLayer.id) || (origLayer.mediaId ? window.layerMediaCache.get(origLayer.mediaId) : null);
        if (origMedia) {
          window.layerMediaCache.set(newId, origMedia);
        }
      }
    } else {
      // Typed fallback if snapshot not stored
      const sType = clip.sourceLayerType || 'shape';
      if (sType === 'text') {
        newLayer = {
          id: newId,
          type: 'text',
          name: clip.sourceLayerName ? (clip.sourceLayerName + ' (Copy)') : 'Text (Copy)',
          startSec: playheadSec,
          startPx: Math.round(playheadSec * pps),
          durationSec: durSec,
          widthPx: Math.round(durSec * pps),
          textProps: (clip.data && clip.data.text && clip.data.text.textProps) ? JSON.parse(JSON.stringify(clip.data.text.textProps)) : {
            text: 'Text',
            fontSize: 48,
            fontFamily: 'Cal Sans',
            fillColor: '#ffffff'
          },
          fillColor: (clip.data && clip.data.text && clip.data.text.fillColor) || '#ffffff',
          fillType: 'color',
          posX: 0,
          posY: 0,
          scaleW: 320,
          scaleH: 100,
          opacity: 1,
          blendMode: 'normal',
          effects: [],
          keyframes: {},
          hidden: false,
          locked: false
        };
      } else if (sType === 'audio') {
        newLayer = {
          id: newId,
          type: 'audio',
          name: clip.sourceLayerName ? (clip.sourceLayerName + ' (Copy)') : 'Audio (Copy)',
          startSec: playheadSec,
          startPx: Math.round(playheadSec * pps),
          durationSec: durSec,
          widthPx: Math.round(durSec * pps),
          speed: 1.0,
          volume: 1.0,
          muted: false,
          audioEffects: [],
          keyframes: {},
          hidden: false,
          locked: false
        };
      } else if (sType === 'video' || sType === 'image') {
        newLayer = {
          id: newId,
          type: sType,
          name: clip.sourceLayerName ? (clip.sourceLayerName + ' (Copy)') : (sType === 'video' ? 'Video (Copy)' : 'Image (Copy)'),
          startSec: playheadSec,
          startPx: Math.round(playheadSec * pps),
          durationSec: durSec,
          widthPx: Math.round(durSec * pps),
          posX: 0,
          posY: 0,
          scaleW: 400,
          scaleH: 300,
          opacity: 1,
          blendMode: 'normal',
          effects: [],
          keyframes: {},
          hidden: false,
          locked: false
        };
      } else {
        newLayer = {
          id: newId,
          type: 'shape',
          name: clip.sourceLayerName ? (clip.sourceLayerName + ' (Copy)') : 'Shape (Copy)',
          startSec: playheadSec,
          startPx: Math.round(playheadSec * pps),
          durationSec: durSec,
          widthPx: Math.round(durSec * pps),
          posX: 0,
          posY: 0,
          scaleW: 1,
          scaleH: 1,
          rotZ: 0,
          opacity: 1,
          blendMode: 'normal',
          fillColor: '#98ce7b',
          fillType: 'color',
          isSolid: true,
          effects: [],
          keyframes: {},
          hidden: false,
          locked: false
        };
      }
    }

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    // Apply all clipboard categories directly
    const categoriesSet = new Set(clip.categories || []);
    applyAttributesToTarget(newLayer, clip, categoriesSet);

    if (typeof window.invalidatePreviewCacheForLayer === 'function') {
      window.invalidatePreviewCacheForLayer(newLayer);
    }

    // Insert at top of timeline
    ps.layers.unshift(newLayer);

    if (typeof window.saveCurrentProjectLayers === 'function') {
      window.saveCurrentProjectLayers();
    }
    if (typeof window.renderTimelineLayers === 'function') {
      window.renderTimelineLayers();
    }
    if (typeof window.redrawComposition === 'function') {
      window.redrawComposition('pasteAsNewLayer');
    }
    if (typeof window.selectTimelineLayer === 'function') {
      window.selectTimelineLayer(newId, false);
    }
    if (typeof window.syncInspectorState === 'function') {
      window.syncInspectorState();
    }

    const typeName = newLayer.type ? (newLayer.type.charAt(0).toUpperCase() + newLayer.type.slice(1)) : 'Layer';
    notify(`Pasted as new ${typeName} layer`);
  }

  // Setup DOM listeners once ready
  function initAttributesClipboard() {
    // Popover Action Button
    const actionBtn = document.getElementById('attr-btn-action');
    if (actionBtn) {
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleActionClick();
      });
    }

    // 1. Mobile More Settings Dock Copy Button
    const btnCopyDock = document.getElementById('editor-btn-copy-dock');
    if (btnCopyDock) {
      btnCopyDock.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.Popover) window.Popover.close(false);
        const anchor = document.getElementById('editor-more-settings-btn') || btnCopyDock;
        triggerCopy(anchor);
      });
    }

    // 2. Mobile More Settings Dock Paste Button
    const btnPasteDock = document.getElementById('editor-btn-paste-dock');
    if (btnPasteDock) {
      btnPasteDock.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.Popover) window.Popover.close(false);
        const anchor = document.getElementById('editor-more-settings-btn') || btnPasteDock;
        triggerPaste(anchor);
      });
    }

    // 3. Desktop Workstation Toolbar Copy Button
    const desktopBtnCopy = document.getElementById('desktop-btn-copy');
    if (desktopBtnCopy) {
      desktopBtnCopy.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerCopy(desktopBtnCopy);
      });
    }

    // 4. Desktop Workstation Toolbar Paste Button
    const desktopBtnPaste = document.getElementById('desktop-btn-paste');
    if (desktopBtnPaste) {
      desktopBtnPaste.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerPaste(desktopBtnPaste);
      });
    }

    updateClipboardButtonsVisibility();

    // Re-check visibility when user interacts with timeline layers
    // Guard: skip if inspector panel explicitly has no active layer (prevents race with syncInspectorState)
    document.addEventListener('click', () => {
      setTimeout(() => {
        const inspectorEl = document.getElementById('desktop-panel-inspector') || document.getElementById('inspector-panel');
        const inspectorHasLayer = inspectorEl ? inspectorEl.classList.contains('has-active-layer') : null;
        if (inspectorHasLayer === false) {
          // Inspector definitively says no selection — copy always hidden, paste depends on clipboard
          const _c = document.getElementById('desktop-btn-copy');
          const _p = document.getElementById('desktop-btn-paste');
          if (_c) { _c.classList.add('is-clipboard-hidden'); _c.style.display = ''; }
          // Keep paste visible if clipboard has content
          const hasClipboardContent = !!(
            window.internalAttributeClipboard ||
            (window.internalLayerClipboard && window.internalLayerClipboard.length > 0)
          );
          if (_p) { _p.classList.toggle('is-clipboard-hidden', !hasClipboardContent); _p.style.display = ''; }
        } else {
          updateClipboardButtonsVisibility();
        }
        if (typeof window.updateCutBarRowState === 'function') {
          window.updateCutBarRowState();
        }
      }, 30);
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAttributesClipboard);
  } else {
    initAttributesClipboard();
  }

  function syncFromLayer(layer) {
    if (!layer) return;
    const allCategories = new Set(Object.keys(CATEGORY_DEFINITIONS).filter(k => CATEGORY_DEFINITIONS[k].isApplicable(layer)));
    const payload = extractAttributesPayload(layer, allCategories);
    window.internalAttributeClipboard = payload;
  }

  // Expose public API
  window.FishAttributesClipboard = {
    triggerCopy,
    triggerPaste,
    renderAttributesPopover,
    updateVisibility: updateClipboardButtonsVisibility,
    syncFromLayer
  };
})();
