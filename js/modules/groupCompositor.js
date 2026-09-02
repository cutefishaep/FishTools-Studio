function getGroupPropMap(gd, propName, fallbackGlobalMap) {
  if (gd && gd[propName]) {
    if (gd[propName] instanceof Map) return gd[propName];
    if (Array.isArray(gd[propName])) return new Map(gd[propName]);
  }
  return fallbackGlobalMap || new Map();
}

const groupCompositeCache = new Map();

function invalidateGroupCache(id) {
  if (groupCompositeCache.has(id)) {
    const entry = groupCompositeCache.get(id);
    entry.isDirty = true;
    entry.childCanvases.clear();
  }
  if (typeof layerGroupData !== 'undefined') {
    for (const [gId, gd] of layerGroupData.entries()) {
      if (gd && gd.layers && gd.layers.some(l => l.layerId === id)) {
        if (groupCompositeCache.has(gId)) {
          const entry = groupCompositeCache.get(gId);
          entry.isDirty = true;
          entry.childCanvases.delete(id);
        }
      }
    }
  }
}

function groupHasAnimation(gd) {
  if (!gd) return false;
  if (gd.keyframes && gd.keyframes.length > 0) {
    for (const [_, kfList] of gd.keyframes) {
      if (kfList && kfList.length > 0) return true;
    }
  }
  const childLayers = gd.layers || [];
  for (const l of childLayers) {
    if (l.category === 'video') return true;
    if (typeof layerKeyframes !== 'undefined' && layerKeyframes.has(l.layerId)) {
      const kfList = layerKeyframes.get(l.layerId);
      if (kfList && kfList.length > 0) return true;
    }
  }
  return false;
}

function renderGroupCompositeTexture(id, gd, canvasSize, onDone, targetTime = (typeof elapsed !== 'undefined' ? elapsed : 0)) {
  if (!gd) {
    if (onDone) onDone(document.createElement('canvas'));
    return;
  }

  const S = Math.min(2048, Math.max(1024, canvasSize || 1024));
  const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
  const compAspect = projDim.width / projDim.height;
  const canvasW = Math.max(16, Math.round(S * compAspect));
  const canvasH = S;

  let cacheEntry = groupCompositeCache.get(id);
  if (!cacheEntry) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    cacheEntry = { canvas, ctx, childCanvases: new Map(), isDirty: true };
    groupCompositeCache.set(id, cacheEntry);
  } else {
    if (cacheEntry.canvas.width !== canvasW || cacheEntry.canvas.height !== canvasH) {
      cacheEntry.canvas.width = canvasW;
      cacheEntry.canvas.height = canvasH;
      cacheEntry.isDirty = true;
    }
  }

  const canvas = cacheEntry.canvas;
  const ctx = cacheEntry.ctx;
  const childCanvases = cacheEntry.childCanvases;

  const hasAnim = groupHasAnimation(gd);
  if (!cacheEntry.isDirty && cacheEntry.lastRenderedTime !== undefined) {
    if (!hasAnim || Math.abs(cacheEntry.lastRenderedTime - targetTime) < 0.0005) {
      if (onDone) onDone(canvas, false);
      return;
    }
  }

  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const frameH = canvasH;
  const frameW = canvasW;
  const frameX = 0;
  const frameY = 0;

  const childLayers = gd.layers || [];
  if (!childLayers.length) {
    ctx.clearRect(0, 0, canvasW, canvasH);
    if (onDone) onDone(canvas);
    return;
  }
  if (gd.keyframes && typeof layerKeyframes !== 'undefined') {
    gd.keyframes.forEach(([k, v]) => {
      if (!layerKeyframes.has(k)) layerKeyframes.set(k, v);
    });
  }
  if (gd.transforms && typeof layerTransforms !== 'undefined') {
    gd.transforms.forEach(([k, v]) => {
      if (!layerTransforms.has(k)) layerTransforms.set(k, v);
    });
  }

  const mapTransforms = getGroupPropMap(gd, 'transforms', typeof layerTransforms !== 'undefined' ? layerTransforms : null);
  const mapFills = getGroupPropMap(gd, 'fills', typeof layerFills !== 'undefined' ? layerFills : null);
  const mapBorderShadows = getGroupPropMap(gd, 'borderShadows', typeof layerBorderShadow !== 'undefined' ? layerBorderShadow : null);
  const mapShapeParams = getGroupPropMap(gd, 'shapeParams', typeof layerShapeParams !== 'undefined' ? layerShapeParams : null);
  const mapTexts = getGroupPropMap(gd, 'texts', typeof layerTexts !== 'undefined' ? layerTexts : null);
  let childLocalTime = targetTime;
  if (typeof document !== 'undefined') {
    const row = document.querySelector(`.track-row[data-layer-id="${id}"]`);
    if (row) {
      const clip = row.querySelector('.track-clip');
      const startSec = clip ? (parseFloat(clip.style.marginLeft) || 0) / (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 50) : 0;
      childLocalTime = Math.max(0, targetTime - startSec);
    }
  }
  const layersBottomToTop = [...childLayers].reverse();

  function finalizeComposite() {
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(frameX, frameY, frameW, frameH);
    ctx.clip();
    if (gd.backgroundColor && gd.backgroundColor !== 'transparent') {
      ctx.fillStyle = gd.backgroundColor;
      ctx.fillRect(frameX, frameY, frameW, frameH);
    }
    const pxPerUnit = canvasH / 4.1421356;
    const refH = projDim.height;

    layersBottomToTop.forEach(layer => {
      const childId = layer.layerId;
      const childCanvas = childCanvases.get(childId);
      if (!childCanvas) return;

      let t;
      if (typeof getLayerTransform === 'function') {
        t = getLayerTransform(childId, childLocalTime);
      } else {
        t = mapTransforms.get(childId) || { posX: 0, posY: 0, scaleW: 100, scaleH: 100, rotZ: 0, opacity: 100 };
      }

      const posX = Number(t.posX) || 0;
      const posY = Number(t.posY) || 0;
      const scaleW = (t.scaleW !== undefined ? Number(t.scaleW) : 100) / 100;
      const scaleH = (t.scaleH !== undefined ? Number(t.scaleH) : 100) / 100;
      const rotZ = (Number(t.rotZ) || 0) * Math.PI / 180;
      const opacity = (t.opacity !== undefined ? Number(t.opacity) : 100) / 100;

      const childCanvasX = cx + (posX / 200) * pxPerUnit;
      const childCanvasY = cy - (posY / 200) * pxPerUnit;

      const rawChildSp = mapShapeParams.get(childId) || (typeof getLayerShapeParams === 'function' ? getLayerShapeParams(childId, (layer.shapeType === 'media' || layer.shapeType === 'line' || layer.shapeType === 'arrow') ? 'square' : (layer.shapeType || 'square')) : null);
      const childShapeKey = (layer.shapeType === 'media' || layer.shapeType === 'line' || layer.shapeType === 'arrow') ? 'square' : (layer.shapeType || 'square');
      const childSp = (rawChildSp && rawChildSp[childShapeKey]) ? rawChildSp[childShapeKey] : (rawChildSp && rawChildSp.square ? rawChildSp.square : rawChildSp);

      let childDrawW = canvasH;
      let childDrawH = canvasH;
      if (childSp && childSp.sizeX_px !== undefined && childSp.sizeY_px !== undefined) {
        childDrawW = (childSp.sizeX_px / refH) * canvasH;
        childDrawH = (childSp.sizeY_px / refH) * canvasH;
      } else if (childSp && childSp.sizeX !== undefined && childSp.sizeY !== undefined) {
        childDrawW = (childSp.sizeX / 100) * 1.6 * (canvasH / 4.1421356);
        childDrawH = (childSp.sizeY / 100) * 1.6 * (canvasH / 4.1421356);
      } else if (childCanvas && childCanvas.width && childCanvas.height) {
        const asp = childCanvas.width / childCanvas.height;
        if (asp >= 1) {
          childDrawW = canvasH;
          childDrawH = canvasH / asp;
        } else {
          childDrawW = canvasH * asp;
          childDrawH = canvasH;
        }
      }

      ctx.save();
      ctx.translate(childCanvasX, childCanvasY);
      if (rotZ) ctx.rotate(rotZ);
      ctx.scale(scaleW, scaleH);
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
      ctx.drawImage(childCanvas, -childDrawW / 2, -childDrawH / 2, childDrawW, childDrawH);
      ctx.restore();
    });

    ctx.restore();

    cacheEntry.lastRenderedTime = targetTime;
    cacheEntry.isDirty = false;

    if (onDone) onDone(canvas, true);
  }
  let needsChildRender = false;
  for (const layer of layersBottomToTop) {
    if (!childCanvases.has(layer.layerId)) {
      needsChildRender = true;
      break;
    }
  }

  if (!needsChildRender && !cacheEntry.isDirty) {
    finalizeComposite();
    return;
  }

  cacheEntry.isDirty = false;
  let pendingCount = layersBottomToTop.length;

  layersBottomToTop.forEach(layer => {
    const childId = layer.layerId;
    const f = mapFills.get(childId) || { type: 'color', color: '#FAB778' };
    const b = mapBorderShadows.get(childId) || { stroke: { enabled: false }, shadow: { enabled: false } };

    if (mapShapeParams.has(childId) && typeof layerShapeParams !== 'undefined' && !layerShapeParams.has(childId)) {
      layerShapeParams.set(childId, mapShapeParams.get(childId));
    }
    if (mapTexts.has(childId) && typeof layerTexts !== 'undefined' && !layerTexts.has(childId)) {
      layerTexts.set(childId, mapTexts.get(childId));
    }

    renderLayerTexture(childId, f, b, (cCanvas) => {
      childCanvases.set(childId, cCanvas);
      pendingCount--;
      if (pendingCount <= 0) {
        finalizeComposite();
      }
    });
  });
}

function getCompositeBackgroundCanvasBelowLayer(id, targetTime = (typeof elapsed !== 'undefined' ? elapsed : 0)) {
  const rows = Array.from(document.querySelectorAll('.track-row'));
  const myIdx = rows.findIndex(r => r.dataset.layerId === id);

  const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
  const W = Math.min(1080, projDim.width || 1080);
  const H = Math.min(1920, projDim.height || 1920);

  const bgCanvas = (typeof getScratchCanvas === 'function') ? getScratchCanvas('COPY_BG_' + id, W, H) : document.createElement('canvas');
  bgCanvas.width = W;
  bgCanvas.height = H;
  const ctx = bgCanvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const bgColor = (typeof projectBgColor !== 'undefined' && projectBgColor) ? projectBgColor : '#000000';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  if (myIdx === -1 || myIdx >= rows.length - 1) {
    return bgCanvas;
  }

  const pxPerSec = (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 80);
  const cx = W / 2;
  const cy = H / 2;
  for (let i = rows.length - 1; i > myIdx; i--) {
    const row = rows[i];
    const belowId = row.dataset.layerId;
    if (!belowId) continue;

    const clip = row.querySelector('.track-clip');
    const clipMargin = parseFloat(clip?.style?.marginLeft) || 0;
    const clipWidth = parseFloat(clip?.style?.width) || 300;
    const startSec = clipMargin / pxPerSec;
    const endSec = (clipMargin + clipWidth) / pxPerSec;

    if (targetTime < startSec - 0.05 || targetTime > endSec + 0.05) continue;

    let belowCanvas = null;
    const belowEffects = (typeof getLayerEffects === 'function') ? getLayerEffects(belowId) : [];
    if (belowEffects.length > 0 && typeof FishEffects !== 'undefined' && typeof layerBaseCanvasMap !== 'undefined') {
      const bCanvas = layerBaseCanvasMap.get(belowId);
      if (bCanvas) {
        belowCanvas = FishEffects.applyCustomEffectProcessors(bCanvas, belowEffects, belowId);
      }
    }
    if (!belowCanvas && typeof layerBaseCanvasMap !== 'undefined') {
      belowCanvas = layerBaseCanvasMap.get(belowId);
    }
    if (!belowCanvas) continue;

    const wt = (typeof getLayerWorldTransform === 'function') ? getLayerWorldTransform(belowId, new Set(), targetTime) : getLayerTransform(belowId);
    const opacity = (wt && wt.opacity !== undefined) ? Math.max(0, Math.min(1, wt.opacity / 100)) : 1;

    const posX = ((wt.posX || 0) / 1080) * W;
    const posY = -((wt.posY || 0) / 1920) * H;
    const scaleX = ((wt.scaleW !== undefined ? wt.scaleW : 100) / 100);
    const scaleY = ((wt.scaleH !== undefined ? wt.scaleH : 100) / 100);
    const rotZ = -((wt.rotZ || 0) * Math.PI) / 180;

    ctx.save();
    ctx.translate(cx + posX, cy + posY);
    ctx.rotate(rotZ);
    ctx.scale(scaleX, scaleY);
    ctx.globalAlpha = opacity;
    ctx.drawImage(belowCanvas, -belowCanvas.width / 2, -belowCanvas.height / 2, belowCanvas.width, belowCanvas.height);
    ctx.restore();
  }

  return bgCanvas;
}

window.getGroupPropMap = getGroupPropMap;
window.invalidateGroupCache = invalidateGroupCache;
window.groupHasAnimation = groupHasAnimation;
window.renderGroupCompositeTexture = renderGroupCompositeTexture;
window.getCompositeBackgroundCanvasBelowLayer = getCompositeBackgroundCanvasBelowLayer;
