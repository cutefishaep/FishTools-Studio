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
    fill: {
      id: 'fill',
      label: 'Fill',
      icon: '<svg viewBox="0 0 24 24"><path d="M19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5zM16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21z"/></svg>',
      isApplicable: (l) => l && (l.type === 'shape' || l.type === 'video' || l.type === 'image')
    },
    opacityBlend: {
      id: 'opacityBlend',
      label: 'Opacity & Blend',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 9.5h8M4 12h10M5 14.5h8" stroke-width="1.2" stroke-linecap="round"/><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>',
      isApplicable: () => true
    },
    effects: {
      id: 'effects',
      label: 'Effects',
      icon: '<svg viewBox="0 0 24 24"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>',
      isApplicable: () => true
    },
    transform: {
      id: 'transform',
      label: 'Transform',
      icon: '<svg viewBox="0 0 24 24"><path d="M3 3h7v2H5v5H3V3zm11 0h7v7h-2V5h-5V3zM3 14h2v5h5v2H3v-7zm16 5h-5v2h7v-7h-2v5z"/></svg>',
      isApplicable: () => true
    },
    borderShadow: {
      id: 'borderShadow',
      label: 'Border & Shadow',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
      isApplicable: (l) => l && (l.type === 'shape' || l.type === 'image')
    },
    speedVolume: {
      id: 'speedVolume',
      label: 'Speed & Volume',
      icon: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
      isApplicable: (l) => l && l.type === 'video'
    }
  };

  /**
   * Helper to retrieve currently selected layer objects from project state
   */
  function getSelectedLayers() {
    const layers = (window.currentProjectState && window.currentProjectState.layers) || [];
    const ids = [];
    if (window.selectedLayerId && !ids.includes(window.selectedLayerId)) ids.push(window.selectedLayerId);
    if (typeof selectedLayerId !== 'undefined' && selectedLayerId && !ids.includes(selectedLayerId)) ids.push(selectedLayerId);
    const set = window.selectedLayerIds || (typeof selectedLayerIds !== 'undefined' ? selectedLayerIds : null);
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
    return layer.type === 'shape' || layer.type === 'video' || layer.type === 'image' || layer.type === 'text' || layer.type === 'null';
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
      const sId = window.selectedLayerId || (typeof selectedLayerId !== 'undefined' ? selectedLayerId : null);
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
      // Copy: only when selection exists
      desktopBtnCopy.style.display = hasSelection ? 'inline-flex' : 'none';
    }
    if (desktopBtnPaste) {
      // Paste: when selection exists OR clipboard has content
      desktopBtnPaste.style.display = showPaste ? 'inline-flex' : 'none';
    }

    // Mobile dock buttons — same rules
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
    const pps = (typeof pixelsPerSecond === 'number' && pixelsPerSecond > 0) ? pixelsPerSecond : (window.currentPixelsPerSecond || 80);
    const startSec = (layer.startSec !== undefined) ? layer.startSec : ((layer.startPx || 0) / pps);
    const durationSec = (layer.durationSec !== undefined) ? layer.durationSec : ((layer.widthPx || 400) / pps);

    const payload = {
      sourceLayerId: layer.id,
      sourceLayerName: layer.name || 'Layer',
      sourceLayerType: layer.type,
      sourceStartSec: startSec,
      sourceDurationSec: durationSec,
      categories: Array.from(categoriesSet),
      data: {}
    };

    // 1. Fill
    if (categoriesSet.has('fill')) {
      const effectiveFillColor = layer.fillColor || layer.color || '#98ce7b';
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

    // 2. Opacity & Blend
    if (categoriesSet.has('opacityBlend')) {
      payload.data.opacityBlend = {
        opacity: (layer.opacity !== undefined) ? layer.opacity : 1.0,
        blendMode: layer.blendMode || 'normal',
        keyframes: extractKeyframesForProps(layer, ['opacity'])
      };
    }

    // 3. Effects
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

    // 4. Transform
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

    // 5. Border & Shadow
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

    // 6. Speed & Volume
    if (categoriesSet.has('speedVolume')) {
      payload.data.speedVolume = {
        speed: (layer.speed !== undefined) ? layer.speed : 1.0,
        volume: (layer.volume !== undefined) ? layer.volume : 1.0,
        muted: !!layer.muted,
        audioEffects: Array.isArray(layer.audioEffects) ? JSON.parse(JSON.stringify(layer.audioEffects)) : [],
        keyframes: extractKeyframesForProps(layer, ['speed', 'volume'])
      };
    }

    return payload;
  }

  /**
   * Apply attributes payload to target layer
   */
  function applyAttributesToTarget(targetLayer, payload, categoriesSet) {
    const pps = (typeof pixelsPerSecond === 'number' && pixelsPerSecond > 0) ? pixelsPerSecond : (window.currentPixelsPerSecond || 80);
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

      applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 2. Opacity & Blend
    if (categoriesSet.has('opacityBlend') && payload.data.opacityBlend) {
      const d = payload.data.opacityBlend;
      if (d.opacity !== undefined) targetLayer.opacity = d.opacity;
      if (d.blendMode !== undefined) targetLayer.blendMode = d.blendMode;
      applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 3. Effects
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

    // 4. Transform
    if (categoriesSet.has('transform') && payload.data.transform) {
      const d = payload.data.transform;
      if (d.values) {
        Object.keys(d.values).forEach(prop => {
          targetLayer[prop] = d.values[prop];
        });
      }
      applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 5. Border & Shadow
    if (categoriesSet.has('borderShadow') && payload.data.borderShadow) {
      const d = payload.data.borderShadow;
      if (d.values) {
        Object.keys(d.values).forEach(prop => {
          targetLayer[prop] = d.values[prop];
        });
      }
      applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
    }

    // 6. Speed & Volume
    if (categoriesSet.has('speedVolume') && payload.data.speedVolume && targetLayer.type === 'video') {
      const d = payload.data.speedVolume;
      if (d.speed !== undefined) targetLayer.speed = d.speed;
      if (d.volume !== undefined) targetLayer.volume = d.volume;
      if (d.muted !== undefined) targetLayer.muted = d.muted;
      if (Array.isArray(d.audioEffects)) {
        targetLayer.audioEffects = JSON.parse(JSON.stringify(d.audioEffects)).map(fx => {
          fx.id = 'fx_' + (fx.type || 'audio') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          return fx;
        });
      }
      applyShiftedKeyframes(targetLayer, d.keyframes, sourceStartSec, sourceDur, targetStartSec, targetDur);
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
    const gridEl = document.getElementById('attr-toggle-grid');
    const actionBtn = document.getElementById('attr-btn-action');

    if (!gridEl || !actionBtn) return;
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

        let labelText = def.label;

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

        gridEl.appendChild(btn);
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

      Object.keys(CATEGORY_DEFINITIONS).forEach(catKey => {
        const def = CATEGORY_DEFINITIONS[catKey];
        const hasInClipboard = copiedCategories.has(catKey);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.category = catKey;

        let labelText = def.label;

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

        gridEl.appendChild(btn);
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

      if (compatibleTargets.length === 0) {
        // No selection → paste as a brand-new layer carrying only the copied attributes
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
   * Create a new shape layer, apply all attribute clipboard categories to it,
   * and insert at the top of the timeline (index 0).
   * Used when user clicks Paste with no layer selected but attribute clipboard exists.
   */
  function pasteAttributesAsNewLayer() {
    const clip = window.internalAttributeClipboard;
    if (!clip) return;

    const ps = window.currentProjectState;
    if (!ps || !Array.isArray(ps.layers)) return;

    // Resolve playhead position for layer start
    const pps = (typeof pixelsPerSecond === 'number' && pixelsPerSecond > 0)
      ? pixelsPerSecond
      : (window.currentPixelsPerSecond || 80);
    const panXVal = (typeof panX === 'number') ? panX : (window.timelinePanX !== undefined ? window.timelinePanX : 0);
    const playheadSec = Math.max(0, -panXVal / pps);

    const durSec = (clip.sourceDurationSec && clip.sourceDurationSec > 0.1) ? clip.sourceDurationSec : 5;

    // Build a clean default shape layer
    const newId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6) + '_' + ps.layers.length;
    const newLayer = {
      id: newId,
      type: 'shape',
      name: 'Pasted Layer',
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

    if (window.UndoRedoManager && typeof window.UndoRedoManager.recordSnapshot === 'function') {
      window.UndoRedoManager.recordSnapshot();
    }

    // Apply all clipboard categories directly — no popover needed
    const categoriesSet = new Set(clip.categories || []);
    applyAttributesToTarget(newLayer, clip, categoriesSet);

    // Insert at top (renders above all other layers)
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
    if (typeof window.syncInspectorState === 'function') {
      window.syncInspectorState();
    }

    const cats = Array.from(categoriesSet).map(k => (CATEGORY_DEFINITIONS[k] ? CATEGORY_DEFINITIONS[k].label : k));
    notify('Pasted as new layer' + (cats.length ? ': ' + cats.join(', ') : ''));
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
          if (_c) _c.style.display = 'none';
          // Keep paste visible if clipboard has content
          const hasClipboardContent = !!(
            window.internalAttributeClipboard ||
            (window.internalLayerClipboard && window.internalLayerClipboard.length > 0)
          );
          if (_p) _p.style.display = hasClipboardContent ? 'inline-flex' : 'none';
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

  // Expose public API
  window.FishAttributesClipboard = {
    triggerCopy,
    triggerPaste,
    renderAttributesPopover,
    updateVisibility: updateClipboardButtonsVisibility
  };
})();
