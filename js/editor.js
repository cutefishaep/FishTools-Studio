
let scene3D = null;
let camera3D = null;
let renderer3D = null;
const meshLayerMap = new Map();

const _rulerInstances = {};

function initInfiniteRuler(id, vertical) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window.FishUI && window.FishUI.createRuler) {
    _rulerInstances[id] = window.FishUI.createRuler({
      container: el,
      vertical: !!vertical,
      onChange: (val, valChange) => {
        if (!selectedTrackRow) return;
        const layerId = selectedTrackRow.dataset.layerId || 'default';
        const t = getLayerTransform(layerId);
        if (id === 'z-ruler') {
          t.posZ = Math.round(t.posZ - valChange * 1.5);
        } else if (id === 'ruler-w') {
          const delta = Math.round(valChange * 0.5);
          t.scaleW = t.scaleW + delta;
          if (t.isLinked) {
            t.scaleH = t.scaleH + delta;
          }
        } else if (id === 'ruler-h') {
          const delta = Math.round(valChange * 0.5);
          t.scaleH = t.scaleH + delta;
          if (t.isLinked) {
            t.scaleW = t.scaleW + delta;
          }
        }
        recordTransformChange(layerId, t);
        syncControllerUI();
      }
    });
  }
}

function updateInfiniteRuler(id, offset) {
  if (_rulerInstances[id]) {
    _rulerInstances[id].setOffset(offset);
  }
}

const layerTransforms = new Map();
const layerKeyframes = new Map();
const layerFills = new Map(); // {type:'color'|'media'|'gradient', color, mediaUrl, gradientType, gradientStops}
const layerShapeParams = new Map();
const layerMotionBlur = new Map(); // layerId -> boolean
let isGlobalMotionBlurEnabled = true;
let projectMotionBlurTune = 0.5;
let projectMotionBlurSamples = 6;
const pendingTextureRenders = new Map(); // debounce biar tidak lag saat drag stroke/shadow
let projectFps = 30;

function getLayerShapeParams(id, shapeType) {
  if (!layerShapeParams.has(id)) {
    layerShapeParams.set(id, {
      square: { sizeX: 100, sizeY: 100, rounded: 0 },
      circle: { sizeX: 100, sizeY: 100 },
      round: { sizeX: 100, sizeY: 100 },
      triangle: { sizeX: 100, sizeY: 100, step: 3, curve: 0 },
      line: {
        points: [
          { x: -50, y: 0 },
          { x: 50, y: 0 }
        ],
        selectedPointIdx: 0,
        thickness: 14
      },
      arrow: {
        points: [
          { x: -50, y: 0 },
          { x: 50, y: 0 }
        ],
        selectedPointIdx: 0,
        thickness: 16,
        headSize: 34
      }
    });
  }
  const allParams = layerShapeParams.get(id);
  if (shapeType && allParams[shapeType]) {
    return allParams[shapeType];
  }
  return allParams;
}

// Helper functions for layer linking
function getProjectFromDOM() {
  const container = document.getElementById('trackRowsContainer');
  if (!container) return { tracks: [] };

  const tracks = [];
  container.querySelectorAll('.track-row').forEach(row => {
    const clip = row.querySelector('.track-clip');
    if (!clip) return;

    const id = row.dataset.layerId;
    const name = clip.querySelector('.track-clip-name')?.textContent || row.dataset.category || 'Layer';
    const category = row.dataset.category || 'custom';
    const colorTag = row.dataset.tagColor || 'none';
    const visible = !row.querySelector('.track-eye')?.classList.contains('hidden-layer');

    const marginLeft = parseFloat(clip.style.marginLeft) || 0;
    const width = parseFloat(clip.style.width) || clip.offsetWidth || 300;
    const startTime = marginLeft / (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 80);
    const duration = width / (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 80);

    tracks.push({
      id,
      name,
      type: category === 'shape' ? 'shape' : category === 'text' ? 'text' : 'media',
      category,
      colorTag,
      visible,
      startTime,
      duration,
      linkedTo: row.dataset.linkedTo ? JSON.parse(row.dataset.linkedTo) : [],
      linkedFrom: row.dataset.linkedFrom ? JSON.parse(row.dataset.linkedFrom) : [],
      parentBind: row.dataset.parentBind ? JSON.parse(row.dataset.parentBind) : null
    });
  });

  return { tracks };
}

function saveProjectToDOM(project) {
  const container = document.getElementById('trackRowsContainer');
  if (!container || !project) return;

  project.tracks.forEach(track => {
    const row = container.querySelector(`.track-row[data-layer-id="${track.id}"]`);
    if (!row) return;

    if (track.linkedTo && track.linkedTo.length > 0) {
      row.dataset.linkedTo = JSON.stringify(track.linkedTo);
    } else {
      delete row.dataset.linkedTo;
      delete row.dataset.parentBind;
    }
    if (track.parentBind) {
      row.dataset.parentBind = JSON.stringify(track.parentBind);
    }
    if (track.linkedFrom && track.linkedFrom.length > 0) {
      row.dataset.linkedFrom = JSON.stringify(track.linkedFrom);
    } else {
      delete row.dataset.linkedFrom;
    }
  });
}
function getLayerFill(id) {
  if (!layerFills.has(id)) layerFills.set(id, {type:'color', color:'#FAB778', mediaUrl:null, gradientType:'linear', gradientStops:[{offset:0,color:'#000000'},{offset:1,color:'#FFFFFF'}]});
  return layerFills.get(id);
}
function renderLayerTexture(id, fill, bs, onDone) {
  // Canvas adaptif + low quality beneran (bukan cuma alpha) — optimized biar shadow gede gak lag
  const strokeEnabledTmp2 = bs && bs.stroke && bs.stroke.enabled;
  const shadowEnabledTmp2 = bs && bs.shadow && bs.shadow.enabled;
  const shadowSizeTmp = shadowEnabledTmp2 ? (bs.shadow.size || 4) : 0;
  const isHeavyShadow = shadowEnabledTmp2 && shadowSizeTmp > 18;
  const isVeryHeavyShadow = shadowEnabledTmp2 && shadowSizeTmp > 45;
  let baseCanvas;
  if (typeof isLowQuality !== 'undefined' && isLowQuality) baseCanvas = 512;
  else if (isVeryHeavyShadow) baseCanvas = 384; // ~7x lebih enteng dari 1024 (384*384 vs 1024*1024)
  else if (isHeavyShadow) baseCanvas = 512; // 4x lebih enteng
  else baseCanvas = 1024;
  const scaleFactor = baseCanvas / 1024; // biar blur/offset/stroke visual tetap sama walau canvas kecil
  let requiredPad2 = 64 * scaleFactor;
  if (strokeEnabledTmp2) requiredPad2 = Math.max(requiredPad2, (bs.stroke.size || 4) * 4 * scaleFactor + 24 * scaleFactor);
  if (shadowEnabledTmp2) {
    const blur2 = (bs.shadow.size || 4) * 2.5 * scaleFactor;
    const off2 = Math.max(Math.abs(bs.shadow.posX || 3), Math.abs(bs.shadow.posY || 3)) * 1.5 * scaleFactor;
    requiredPad2 = Math.max(requiredPad2, blur2 + off2 + 24 * scaleFactor);
  }
  requiredPad2 = Math.min(512 * scaleFactor, Math.ceil(requiredPad2));
  const canvasSize = baseCanvas;
  const planeSize = 4.0;
  const wireframeBase = 1.6;
  const shapeW = Math.round((wireframeBase / planeSize) * canvasSize);
  const shapeH = shapeW;
  const pad = Math.round((canvasSize - shapeW) / 2);
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasSize, canvasSize);

  const rowTmp = document.querySelector(`.track-row[data-layer-id="${id}"]`);
  const catTmp = rowTmp ? (rowTmp.dataset.category || 'media') : 'media';
  const clipName = rowTmp?.querySelector('.track-clip-name')?.textContent || '';
  let shapeType = rowTmp ? (rowTmp.dataset.shapeType || '') : '';

  if (!shapeType) {
    const lower = (clipName + '_' + catTmp).toLowerCase();
    if (lower.includes('camera')) shapeType = 'camera';
    else if (lower.includes('null')) shapeType = 'null';
    else if (lower.includes('circle') || lower.includes('bulat')) shapeType = 'circle';
    else if (lower.includes('triangle') || lower.includes('segitiga')) shapeType = 'triangle';
    else if (lower.includes('round')) shapeType = 'round';
    else if (lower.includes('square') || lower.includes('kotak')) shapeType = 'square';
    else if (lower.includes('line') || lower.includes('garis')) shapeType = 'line';
    else if (lower.includes('arrow') || lower.includes('panah')) shapeType = 'arrow';
    else if (catTmp === 'camera') shapeType = 'camera';
    else if (catTmp === 'null') shapeType = 'null';
    else if (catTmp === 'shape') shapeType = 'square';
    else if (catTmp === 'media' || catTmp === 'video' || (fill && fill.type === 'media')) shapeType = 'media';
    else shapeType = 'square';
  }

  if (shapeType === 'camera' || shapeType === 'null' || catTmp === 'camera' || catTmp === 'null' || clipName.toLowerCase().startsWith('camera') || clipName.toLowerCase().startsWith('null')) {
    // Camera & Null Objects have NO visible graphic/mesh body - only wireframe is shown when selected
    if (onDone) onDone(canvas);
    return;
  }

  const shadowEnabled = bs && bs.shadow && bs.shadow.enabled;
  const strokeEnabled = bs && bs.stroke && bs.stroke.enabled;

  function applyShadowContext() {
    if (shadowEnabled) {
      const p = parseHexOrRgbLocal(bs.shadow.color || '#000000');
      const shadowAlpha = (bs.shadow.alpha !== undefined ? bs.shadow.alpha : 100) / 100;
      ctx.shadowColor = `rgba(${p.r}, ${p.g}, ${p.b}, ${shadowAlpha})`;
      // scale blur/offset biar visual sama walau canvas kecil, + cap biar gak brutal
      const rawBlur = Math.max(0, (bs.shadow.size !== undefined ? bs.shadow.size : 4) * 2.5 * scaleFactor);
      ctx.shadowBlur = Math.min(80 * scaleFactor, rawBlur);
      ctx.shadowOffsetX = (bs.shadow.posX !== undefined ? bs.shadow.posX : 3) * 1.5 * scaleFactor;
      ctx.shadowOffsetY = -(bs.shadow.posY !== undefined ? bs.shadow.posY : 3) * 1.5 * scaleFactor;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  function applyStrokeContext(align) {
    if (!strokeEnabled) return;
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    const p = parseHexOrRgbLocal(bs.stroke.color || '#000000');
    ctx.strokeStyle = `rgba(${p.r}, ${p.g}, ${p.b}, 1)`;
    const baseSize = Math.max(1, (bs.stroke.size !== undefined ? bs.stroke.size : 4) * 2 * scaleFactor);
    if (align === 'inside' || align === 'outside') {
      ctx.lineWidth = baseSize * 2;
    } else {
      ctx.lineWidth = baseSize;
    }
    ctx.lineCap = bs.stroke.cap || 'butt';
    ctx.lineJoin = 'miter';
  }

  const strokeAlign = (bs.stroke.align || 'center');

  // helper to create current shape path
  const makeShapePath = () => {
    ctx.beginPath();

    switch (shapeType) {
      case 'circle': {
        const p = getLayerShapeParams(id, 'circle');
        const scaleX = (p.sizeX !== undefined ? p.sizeX : 100) / 100;
        const scaleY = (p.sizeY !== undefined ? p.sizeY : 100) / 100;
        const rx = Math.max(1, (shapeW / 2) * Math.abs(scaleX));
        const ry = Math.max(1, (shapeH / 2) * Math.abs(scaleY));
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        break;
      }
      case 'square': {
        const p = getLayerShapeParams(id, 'square');
        const scaleX = (p.sizeX !== undefined ? p.sizeX : 100) / 100;
        const scaleY = (p.sizeY !== undefined ? p.sizeY : 100) / 100;
        const w = shapeW * Math.abs(scaleX);
        const h = shapeH * Math.abs(scaleY);
        const x = cx - w / 2;
        const y = cy - h / 2;
        const maxR = Math.min(w, h) / 2;
        const r = Math.max(0, Math.min(maxR, ((p.rounded || 0) / 100) * maxR));
        if (r > 0 && typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, w, h, r);
        } else {
          ctx.rect(x, y, w, h);
        }
        break;
      }
      case 'round': {
        const p = getLayerShapeParams(id, 'round');
        const scaleX = (p.sizeX !== undefined ? p.sizeX : 100) / 100;
        const scaleY = (p.sizeY !== undefined ? p.sizeY : 100) / 100;
        const w = shapeW * Math.abs(scaleX);
        const h = shapeH * Math.abs(scaleY);
        const x = cx - w / 2;
        const y = cy - h / 2;
        const r = Math.min(w, h) * 0.22;
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, w, h, r);
        } else {
          ctx.rect(x, y, w, h);
        }
        break;
      }
      case 'triangle': {
        const p = getLayerShapeParams(id, 'triangle');
        const scaleX = (p.sizeX !== undefined ? p.sizeX : 100) / 100;
        const scaleY = (p.sizeY !== undefined ? p.sizeY : 100) / 100;
        const w = shapeW * scaleX;
        const h = shapeH * scaleY;
        const absW = Math.abs(w);
        const absH = Math.abs(h);
        const curve = Math.max(0, (p.curve || 0) / 100);
        const x1 = cx, y1 = cy - h / 2;
        const x2 = cx + w / 2, y2 = cy + h / 2;
        const x3 = cx - w / 2, y3 = cy + h / 2;
        if (curve > 0) {
          const cornerR = Math.min(absW, absH) * 0.28 * curve;
          ctx.moveTo((x1 + x2) / 2, (y1 + y2) / 2);
          ctx.arcTo(x2, y2, x3, y3, cornerR);
          ctx.arcTo(x3, y3, x1, y1, cornerR);
          ctx.arcTo(x1, y1, x2, y2, cornerR);
          ctx.closePath();
        } else {
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineTo(x3, y3);
          ctx.closePath();
        }
        break;
      }
      case 'line': {
        const p = getLayerShapeParams(id, 'line');
        const pts = p.points && p.points.length >= 2 ? p.points : [{ x: -50, y: 0 }, { x: 50, y: 0 }];
        const thick = Math.max(4, (p.thickness || 14) * scaleFactor);
        const canvasPts = pts.map(pt => ({
          x: cx + ((Number(pt.x) || 0) / 100) * (shapeW / 2),
          y: cy - ((Number(pt.y) || 0) / 100) * (shapeH / 2)
        }));

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = thick;
        ctx.moveTo(canvasPts[0].x, canvasPts[0].y);
        for (let i = 1; i < canvasPts.length; i++) {
          ctx.lineTo(canvasPts[i].x, canvasPts[i].y);
        }
        break;
      }
      case 'arrow': {
        const p = getLayerShapeParams(id, 'arrow');
        const pts = p.points && p.points.length >= 2 ? p.points : [{ x: -50, y: 0 }, { x: 50, y: 0 }];
        const thick = Math.max(4, (p.thickness || 16) * scaleFactor);
        const canvasPts = pts.map(pt => ({
          x: cx + ((Number(pt.x) || 0) / 100) * (shapeW / 2),
          y: cy - ((Number(pt.y) || 0) / 100) * (shapeH / 2)
        }));

        const lastIdx = canvasPts.length - 1;
        const pPrev = canvasPts[lastIdx - 1];
        const pTip = canvasPts[lastIdx];
        const dx = pTip.x - pPrev.x;
        const dy = pTip.y - pPrev.y;
        const totalLen = Math.hypot(dx, dy) || 1;
        const ux = dx / totalLen;
        const uy = dy / totalLen;
        const actualHeadLen = Math.min(totalLen * 0.85, (p.headSize || 36) * scaleFactor);
        const pBase = {
          x: pTip.x - ux * actualHeadLen,
          y: pTip.y - uy * actualHeadLen
        };

        const bodyPts = canvasPts.slice(0, lastIdx).concat([pBase]);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = thick;
        ctx.moveTo(bodyPts[0].x, bodyPts[0].y);
        for (let i = 1; i < bodyPts.length; i++) {
          ctx.lineTo(bodyPts[i].x, bodyPts[i].y);
        }
        break;
      }
      default: {
        const radius = Math.max(4, Math.round(16 * scaleFactor));
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(pad, pad, shapeW, shapeH, radius);
        } else {
          ctx.rect(pad, pad, shapeW, shapeH);
        }
        break;
      }
    }
  };

  // Draw based on fill type
  if (fill.type === 'media' && fill.mediaUrl) {
    if (fill.mediaUrl.startsWith('video_pkg_') || fill.mediaUrl.startsWith('pkg_')) {
      if (onDone) onDone(canvas);
      return;
    }
    const isVideo = (catTmp === 'video') || (clipName && /\.(mp4|webm|mov|mkv|ogg|avi)$/i.test(clipName)) || (fill.mediaType && fill.mediaType.startsWith('video')) || (fill.mediaUrl && (fill.mediaUrl.startsWith('data:video/') || /\.(mp4|webm|mov|mkv|ogg|avi)$/i.test(fill.mediaUrl)));

    if (isVideo) {
      let video = layerVideoMap.get(id);
      if (!video || video.src !== fill.mediaUrl) {
        if (video) {
          video.pause();
          video.removeAttribute("src"); try { video.load(); } catch(_) {}
        }
        video = document.createElement('video');
        video.src = fill.mediaUrl;
        video.crossOrigin = 'anonymous';
        video.playsInline = true;
        video.muted = false;
        video.preload = 'auto';
        layerVideoMap.set(id, video);
      }

      const drawVideoFrame = () => {
        const natW = video.videoWidth || 1920;
        const natH = video.videoHeight || 1080;
        const natAspect = (natW && natH) ? (natW / natH) : 1.0;
        const prevAspect = mediaNaturalRatioMap.get(id);
        mediaNaturalRatioMap.set(id, natAspect);
        if (fill.mediaUrl) mediaNaturalRatioMap.set(fill.mediaUrl, natAspect);
        fill.aspectRatio = natAspect;

        let drawW, drawH;
        if (natAspect >= 1) {
          drawW = shapeW;
          drawH = Math.round(shapeW / natAspect);
        } else {
          drawH = shapeH;
          drawW = Math.round(shapeH * natAspect);
        }
        const drawX = Math.round(cx - drawW / 2);
        const drawY = Math.round(cy - drawH / 2);

        applyShadowContext();
        if (video.readyState >= 2) {
          ctx.drawImage(video, 0, 0, canvasSize, canvasSize);
        } else {
          ctx.fillStyle = '#111111';
          ctx.fillRect(0, 0, canvasSize, canvasSize);
        }
        if (strokeEnabled) {
          applyStrokeContext('center');
          ctx.strokeRect(0, 0, canvasSize, canvasSize);
        }
        if (onDone) onDone(canvas);
        if (prevAspect !== natAspect) {
          requestCanvasOverlayRender();
        }
      };

      if (video.readyState >= 2) {
        drawVideoFrame();
      } else {
        video.onloadeddata = drawVideoFrame;
        video.onerror = () => {
          applyShadowContext();
          ctx.fillStyle = '#FAB778';
          ctx.fillRect(pad, pad, shapeW, shapeH);
          if (onDone) onDone(canvas);
        };
      }
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const natW = img.naturalWidth || 512;
      const natH = img.naturalHeight || 512;
      const natAspect = (natW && natH) ? (natW / natH) : 1.0;
      const prevAspect = mediaNaturalRatioMap.get(id);
      mediaNaturalRatioMap.set(id, natAspect);
      if (fill.mediaUrl) mediaNaturalRatioMap.set(fill.mediaUrl, natAspect);
      fill.aspectRatio = natAspect;

      applyShadowContext();
      ctx.drawImage(img, 0, 0, canvasSize, canvasSize);
      if (strokeEnabled) {
        applyStrokeContext('center');
        ctx.strokeRect(0, 0, canvasSize, canvasSize);
      }
      if (onDone) onDone(canvas);
      applyTransformToThreeMesh(id, getLayerTransform(id));
      render3D();
      if (prevAspect !== natAspect) {
        requestCanvasOverlayRender();
      }
    };
    img.onerror = () => {
      applyShadowContext();
      ctx.fillStyle = '#FAB778';
      ctx.fillRect(pad, pad, shapeW, shapeH);
      if (strokeEnabled) {
        applyStrokeContext('center');
        ctx.strokeRect(pad, pad, shapeW, shapeH);
      }
      if (onDone) onDone(canvas);
    };
    img.src = fill.mediaUrl;
    return;
  }

  // Color or Gradient Fill
  applyShadowContext();

  let fillStyle = '#FAB778';
  if (fill.type === 'gradient' && fill.gradientStops) {
    const sorted = fill.gradientStops.slice().sort((a,b) => a.offset - b.offset);
    const gradType = fill.gradientType || 'linear';
    let g;
    if (gradType === 'radial') {
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, shapeW / 2);
    } else if (gradType === 'conical' || gradType === 'conic') {
      if (ctx.createConicGradient) {
        g = ctx.createConicGradient(0, cx, cy);
      } else {
        g = ctx.createLinearGradient(pad, cy, pad + shapeW, cy);
      }
    } else {
      g = ctx.createLinearGradient(pad, cy, pad + shapeW, cy);
    }
    sorted.forEach(s => {
      let col = s.color;
      if (s.alpha !== undefined && s.alpha < 1) {
        const p = parseHexOrRgbLocal(col);
        col = `rgba(${p.r}, ${p.g}, ${p.b}, ${s.alpha})`;
      }
      g.addColorStop(Math.max(0, Math.min(1, s.offset)), col);
    });
    fillStyle = g;
  } else {
    const p = parseHexOrRgbLocal(fill.color || '#FAB778');
    const alphaVal = (fill.alpha !== undefined) ? fill.alpha : (p.a !== undefined ? p.a : 1);
    fillStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${alphaVal})`;
  }

  ctx.fillStyle = fillStyle;

  if (shapeType === 'line') {
    ctx.strokeStyle = fillStyle;
    makeShapePath();
    ctx.stroke();
    if (strokeEnabled) {
      applyStrokeContext('center');
      makeShapePath();
      ctx.stroke();
    }
  } else if (shapeType === 'arrow') {
    ctx.strokeStyle = fillStyle;
    makeShapePath();
    ctx.stroke();

    const p = getLayerShapeParams(id, 'arrow');
    const pts = p.points && p.points.length >= 2 ? p.points : [{ x: -50, y: 0 }, { x: 50, y: 0 }];
    const canvasPts = pts.map(pt => ({
      x: cx + ((Number(pt.x) || 0) / 100) * (shapeW / 2),
      y: cy - ((Number(pt.y) || 0) / 100) * (shapeH / 2)
    }));
    const lastIdx = canvasPts.length - 1;
    const pPrev = canvasPts[lastIdx - 1];
    const pTip = canvasPts[lastIdx];
    const dx = pTip.x - pPrev.x;
    const dy = pTip.y - pPrev.y;
    const totalLen = Math.hypot(dx, dy) || 1;
    const ux = dx / totalLen;
    const uy = dy / totalLen;
    const actualHeadLen = Math.min(totalLen * 0.85, (p.headSize || 36) * scaleFactor);
    const headW = actualHeadLen * 0.85;
    const pBase = {
      x: pTip.x - ux * actualHeadLen,
      y: pTip.y - uy * actualHeadLen
    };
    const nx = -uy * headW;
    const ny = ux * headW;

    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.moveTo(pTip.x, pTip.y);
    ctx.lineTo(pBase.x + nx, pBase.y + ny);
    ctx.lineTo(pBase.x + nx * 0.35, pBase.y + ny * 0.35);
    ctx.lineTo(pBase.x - nx * 0.35, pBase.y - ny * 0.35);
    ctx.lineTo(pBase.x - nx, pBase.y - ny);
    ctx.closePath();
    ctx.fill();

    if (strokeEnabled) {
      applyStrokeContext('center');
      makeShapePath();
      ctx.stroke();
    }
  } else {
    // Other shapes (circle, square, triangle, round)
    makeShapePath(); ctx.fill();
    if (strokeEnabled) {
      if (strokeAlign === 'inside') {
        ctx.save();
        makeShapePath(); ctx.clip();
        applyStrokeContext('inside');
        makeShapePath(); ctx.stroke();
        ctx.restore();
      } else if (strokeAlign === 'outside') {
        applyStrokeContext('outside');
        makeShapePath(); ctx.stroke();
        ctx.save();
        makeShapePath(); ctx.clip();
        ctx.fillStyle = fillStyle;
        ctx.fill();
        ctx.restore();
      } else {
        applyStrokeContext('center');
        makeShapePath(); ctx.stroke();
      }
    }
  }

  if (onDone) onDone(canvas);
}

const layerBaseCanvasMap = new Map();
const layerBlurTextureCache = new Map();

function getBlurredTextureForLayer(id, blurPx) {
  const baseCanvas = layerBaseCanvasMap.get(id);
  if (!baseCanvas) return null;
  const qBlur = Math.min(32, Math.max(0, Math.round(blurPx || 0)));
  const key = id + '_' + qBlur;
  let cached = layerBlurTextureCache.get(key);
  if (cached) return cached;

  if (qBlur === 0) {
    const tex = new THREE.CanvasTexture(baseCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    layerBlurTextureCache.set(key, tex);
    return tex;
  }

  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = baseCanvas.width;
  blurCanvas.height = baseCanvas.height;
  const bCtx = blurCanvas.getContext('2d');
  bCtx.filter = `blur(${qBlur}px)`;
  bCtx.drawImage(baseCanvas, 0, 0);

  const tex = new THREE.CanvasTexture(blurCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  layerBlurTextureCache.set(key, tex);
  return tex;
}


// ══════════════════════════════════════════════════════════════
// GLOBAL MEDIA STORAGE & VIDEO FRAME SEQUENCE SYSTEM
// ══════════════════════════════════════════════════════════════
const layerVideoTextureMap = new Map(); // layerId -> THREE.VideoTexture
const videoFrameSequenceMap = new Map(); // mediaId/url/name -> { fps, duration, frames, width, height, aspectRatio, audioUrl, isReady }
const layerFrameTextureMap = new Map();
const layerLastRenderedFrameIndex = new Map(); // layerId -> frameIndex // layerId -> THREE.CanvasTexture

let _mediaDbPromise = null;
function getMediaDB() {
  if (_mediaDbPromise) return _mediaDbPromise;
  _mediaDbPromise = new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open('FishTool_MediaStorage_DB', 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('media_items')) {
          db.createObjectStore('media_items', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('video_packages')) {
          db.createObjectStore('video_packages', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  });
  return _mediaDbPromise;
}

// ----------------------------------------------------
// Global Media Pool / Library (Synchronized across panels)
// ----------------------------------------------------
const GLOBAL_MEDIA_STORAGE_KEY = 'fishTool_globalMediaLibrary';
let _globalMediaMemoryCache = null;

function initGlobalMediaLibrary() {
    if (_globalMediaMemoryCache !== null) return;
    _globalMediaMemoryCache = [];
    
    // 1. Initial lightweight read from localStorage
    try {
      const stored = localStorage.getItem(GLOBAL_MEDIA_STORAGE_KEY);
      if (stored) _globalMediaMemoryCache = JSON.parse(stored);
    } catch (e) {}

    // 2. Asynchronously sync all full video/audio/photo items from IndexedDB
    getMediaDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction('media_items', 'readonly');
        const store = tx.objectStore('media_items');
        const req = store.getAll();
        req.onsuccess = () => {
          if (req.result && req.result.length > 0) {
            const idbItems = req.result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            idbItems.forEach(item => {
              // Generate fresh valid blob URL if item contains a stored binary Blob/File
              if (item.blob && (item.blob instanceof Blob || item.blob.size)) {
                item.url = URL.createObjectURL(item.blob);
              }
              const existingIdx = _globalMediaMemoryCache.findIndex(m => m.id === item.id || m.name === item.name);
              if (existingIdx >= 0) {
                _globalMediaMemoryCache[existingIdx] = { ..._globalMediaMemoryCache[existingIdx], ...item };
              } else {
                _globalMediaMemoryCache.push(item);
              }
            });
            if (typeof syncAllMediaGrids === 'function') syncAllMediaGrids();
            loadAllVideoPackagesFromIDB();

            // Re-bind all timeline layers that use this media with fresh blob/data URLs
            document.querySelectorAll('.track-row').forEach(row => {
              const id = row.dataset.layerId;
              if (id) {
                const fill = getLayerFill(id);
                if (fill && fill.type === 'media') {
                  const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
                  const match = _globalMediaMemoryCache.find(m => m.url === fill.mediaUrl || m.id === fill.mediaUrl || (clipName && m.name === clipName));
                  if (match && match.url) {
                    fill.mediaUrl = match.url;
                  }
                  applyFillToMeshGlobal(id);
                  applyTransformToThreeMesh(id, getLayerTransform(id));
                }
              }
            });
            render3D();
            requestCanvasOverlayRender();
          }
        };
      } catch (err) {
        console.warn('IndexedDB load error', err);
      }
    });
  }

  initGlobalMediaLibrary();

  function getGlobalMediaLibrary() {
    if (_globalMediaMemoryCache === null) {
      initGlobalMediaLibrary();
    }
    return _globalMediaMemoryCache || [];
  }

  function saveGlobalMediaLibrary(list) {
    _globalMediaMemoryCache = list || [];

    // Save full items (with raw binary Blob/File objects) to IndexedDB with unlimited capacity
    getMediaDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction('media_items', 'readwrite');
        const store = tx.objectStore('media_items');
        store.clear();
        (list || []).forEach(item => {
          store.put(item);
        });
      } catch (err) {
        console.warn('Failed saving to IndexedDB', err);
      }
    });

    // Safely sync lightweight metadata to localStorage without throwing quota error
    try {
      const lightList = (list || []).slice(0, 8).map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        createdAt: item.createdAt,
        url: (item.url && item.url.startsWith('data:') && item.url.length < 300000) ? item.url : ''
      }));
      localStorage.setItem(GLOBAL_MEDIA_STORAGE_KEY, JSON.stringify(lightList));
    } catch (e) {
      // Ignored safely because IndexedDB holds the persistent media
    }
  }

  function addGlobalMedia(dataUrlOrBlob, name, type, fileBlob) {
    const list = getGlobalMediaLibrary();
    const isBlob = (dataUrlOrBlob instanceof Blob) || (fileBlob instanceof Blob);
    const blobObj = isBlob ? (fileBlob || dataUrlOrBlob) : null;
    const liveUrl = (typeof dataUrlOrBlob === 'string') ? dataUrlOrBlob : (blobObj ? URL.createObjectURL(blobObj) : '');

    const existingIdx = list.findIndex(m => (m.name === name) || (m.url === liveUrl && liveUrl !== ''));
    if (existingIdx >= 0) {
      const item = list.splice(existingIdx, 1)[0];
      item.url = liveUrl || item.url;
      if (blobObj) item.blob = blobObj;
      list.unshift(item);
      saveGlobalMediaLibrary(list);
      syncAllMediaGrids();
      return item;
    }

    const newItem = {
      id: 'media_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      url: liveUrl,
      blob: blobObj,
      name: name || ('Media_' + (list.length + 1)),
      type: type || 'image',
      createdAt: Date.now()
    };
    list.unshift(newItem);
    saveGlobalMediaLibrary(list);
    syncAllMediaGrids();
    return newItem;
  }

  function removeGlobalMedia(mediaId) {
    const list = getGlobalMediaLibrary();
    const removedItem = list.find(m => m.id === mediaId);
    const updatedList = list.filter(m => m.id !== mediaId);
    saveGlobalMediaLibrary(updatedList);
    syncAllMediaGrids();

    // Also remove package from IndexedDB video_packages store
    getMediaDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction('video_packages', 'readwrite');
        tx.objectStore('video_packages').delete(mediaId);
      } catch(_) {}
    });

    if (removedItem) {
      const removedUrl = removedItem.url;
      const removedName = removedItem.name;

      // Delete all track rows / layers in timeline using this deleted media
      const rows = Array.from(document.querySelectorAll('.track-row'));
      rows.forEach(row => {
        const id = row.dataset.layerId;
        const fill = id ? getLayerFill(id) : null;
        const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';

        const isMatch = (
          (fill && fill.type === 'media' && (fill.mediaUrl === mediaId || fill.mediaUrl === removedUrl)) ||
          (clipName && (clipName === removedName || clipName === mediaId)) ||
          (row.dataset.mediaId === mediaId)
        );

        if (isMatch) {
          // Clean up 3D mesh
          const mesh = meshLayerMap.get(id);
          if (mesh && scene3D) {
            scene3D.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
            meshLayerMap.delete(id);
          }

          // Clean up audio
          const audio = layerAudioMap.get(id);
          if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            layerAudioMap.delete(id);
          }

          // Clean up maps
          layerFills.delete(id);
          layerTransforms.delete(id);
          layerKeyframes.delete(id);
          layerMotionBlur.delete(id);
          layerFrameTextureMap.delete(id);
          layerLastRenderedFrameIndex.delete(id);
          videoFrameSequenceMap.delete(mediaId);
          if (removedUrl) videoFrameSequenceMap.delete(removedUrl);
          if (removedName) videoFrameSequenceMap.delete(removedName);

          // Remove row from DOM
          row.remove();
        }
      });

      if (selectedTrackRow && !document.contains(selectedTrackRow)) {
        selectedTrackRow = null;
        renderCanvasOverlay();
      }

      calculateMaxDuration();
      rebuildTimeRuler(totalDuration);
      syncThreeLayers();
      render3D();
      triggerAutoSave();
    }
  }

  function syncAllMediaGrids() {
    const mediaList = getGlobalMediaLibrary();
    
    // 1. Render in Color & Fill panel -> Media tab (#uploadedMediaGrid)
    const mediaGrid = document.getElementById('uploadedMediaGrid');
    if (mediaGrid) {
      mediaGrid.innerHTML = `
        <button type="button" id="btnUploadMedia" class="media-upload-tile-btn" title="Upload Media">
          <span class="material-symbols-rounded">add</span>
        </button>
      `;
      const btnUpload = mediaGrid.querySelector('#btnUploadMedia');
      const inputFillMedia = document.getElementById('inputFillMedia');
      if (btnUpload && inputFillMedia) {
        btnUpload.addEventListener('click', (e) => {
          e.stopPropagation();
          inputFillMedia.click();
        });
      }

      if (mediaList && mediaList.length > 0) {
        mediaList.forEach(item => {
          const thumb = createMediaThumbnailElement(item, (mediaItem) => {
            // Apply fill to currently selected layer
            if (selectedTrackRow) {
              const id = selectedTrackRow.dataset.layerId || 'default';
              const fill = getLayerFill(id);
              fill.type = 'media';
              fill.mediaUrl = mediaItem.id || mediaItem.url;
              fill.color = null;
              fill.gradientType = null;
              applyFillToMeshGlobal(id);
              triggerAutoSave();
            }
          });
          mediaGrid.appendChild(thumb);
        });
      }
    }

    // 2. If Add Track Popover is open on 'media' tab, update its items
    const popover = document.getElementById('addTrackPopover');
    const activeTab = document.querySelector('#popoverCategoryTabs .cat-tab-btn.active');
    if (popover && popover.classList.contains('active') && activeTab && activeTab.dataset.cat === 'media') {
      renderCategoryItems('media');
    }
  }

  function promptDeleteMedia(mediaItem, anchorEl) {
    if (window.FishPopover) {
      window.FishPopover.confirmDelete({
        anchorElement: anchorEl,
        onConfirm: () => {
          removeGlobalMedia(mediaItem.id);
        }
      });
    }
  }

  function createMediaThumbnailElement(item, onClick) {
    const btn = document.createElement('div');
    btn.className = 'media-thumb-item';
    btn.title = `${item.name}\n(Klik untuk gunakan, Tahan lama / Klik Kanan untuk hapus)`;

    const isVideo = (item.type && item.type.startsWith('video')) || (item.name && /\.(mp4|webm|mov|mkv)$/i.test(item.name));
    if (isVideo) {
      if (item.thumbnailUrl || (item.url && item.url.startsWith('data:image/'))) {
        const img = document.createElement('img');
        img.src = item.thumbnailUrl || item.url;
        img.alt = item.name;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '12px';
        btn.appendChild(img);
      } else {
        const vid = document.createElement('video');
        vid.src = item.url;
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'metadata';
        vid.style.width = '100%';
        vid.style.height = '100%';
        vid.style.objectFit = 'cover';
        vid.style.borderRadius = '12px';
        btn.appendChild(vid);
      }

      const playBadge = document.createElement('div');
      playBadge.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.3); pointer-events:none; border-radius:12px;';
      playBadge.innerHTML = '<span class="material-symbols-rounded" style="font-size:22px; color:#FFF2C2;">play_circle</span>';
      btn.appendChild(playBadge);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;
      btn.appendChild(img);
    }

    // Delete badge icon
    const delBadge = document.createElement('button');
    delBadge.type = 'button';
    delBadge.className = 'media-del-badge';
    delBadge.title = 'Hapus Media';
    delBadge.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px;">close</span>';
    delBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      removeGlobalMedia(item.id);
    });
    btn.appendChild(delBadge);

    // Long press and right click handlers
    let pressTimer = null;
    let isLongPress = false;

    const startPress = (e) => {
      isLongPress = false;
      btn.classList.add('holding-delete');
      pressTimer = setTimeout(() => {
        isLongPress = true;
        btn.classList.remove('holding-delete');
        if (navigator.vibrate) navigator.vibrate(35);
        promptDeleteMedia(item, btn);
      }, 450);
    };

    const cancelPress = () => {
      clearTimeout(pressTimer);
      btn.classList.remove('holding-delete');
    };

    btn.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        // Right click
        e.preventDefault();
        e.stopPropagation();
        cancelPress();
        promptDeleteMedia(item, btn);
        return;
      }
      startPress(e);
    });

    btn.addEventListener('touchstart', startPress, { passive: true });
    btn.addEventListener('touchend', cancelPress);
    btn.addEventListener('touchmove', cancelPress);
    btn.addEventListener('mouseup', cancelPress);
    btn.addEventListener('mouseleave', cancelPress);

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelPress();
      promptDeleteMedia(item, btn);
    });

    btn.addEventListener('click', (e) => {
      if (isLongPress) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (onClick) onClick(item);
    });

    return btn;
  }

const _notReadyTextureCacheMap = new Map();
function getNotReadyVideoTexture(aspectRatio = 1.7778) {
  const aspectKey = Math.round(Number(aspectRatio || 1.7778) * 100) / 100;
  if (_notReadyTextureCacheMap.has(aspectKey)) {
    return _notReadyTextureCacheMap.get(aspectKey);
  }

  let canvasW = 1280;
  let canvasH = 720;
  if (aspectRatio >= 1) {
    canvasW = 1280;
    canvasH = Math.max(200, Math.round(1280 / aspectRatio));
  } else {
    canvasH = 1280;
    canvasW = Math.max(200, Math.round(1280 * aspectRatio));
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#22130C';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.strokeStyle = 'rgba(250, 183, 120, 0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, canvasW - 24, canvasH - 24);

  const cx = canvasW / 2;
  const cy = canvasH / 2;

  const fontSizeTitle = Math.max(20, Math.min(36, Math.round(canvasW * 0.048)));
  const fontSizeSub = Math.max(14, Math.min(22, Math.round(canvasW * 0.028)));

  ctx.fillStyle = '#FFF2C2';
  ctx.font = `bold ${fontSizeTitle}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Media is not ready yet', cx, cy - fontSizeTitle * 0.8);

  ctx.fillStyle = '#FAB778';
  ctx.font = `600 ${fontSizeSub}px sans-serif`;
  ctx.fillText('Memproses frame sequence...', cx, cy + fontSizeSub * 1.2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = true;

  _notReadyTextureCacheMap.set(aspectKey, tex);
  return tex;
}

async function saveVideoPackageToIDB(pkg) {
  const db = await getMediaDB();
  if (!db) return;
  try {
    const tx = db.transaction('video_packages', 'readwrite');
    const store = tx.objectStore('video_packages');
    store.put({
      id: pkg.id,
      name: pkg.name,
      manifest: {
        fps: pkg.fps,
        width: pkg.width,
        height: pkg.height,
        duration: pkg.duration,
        totalFrames: pkg.totalFrames,
        aspectRatio: pkg.aspectRatio,
        createdAt: Date.now()
      },
      frames: pkg.frameBlobs || [],
      audioBlob: pkg.audioBlob || null
    });
  } catch (e) {
    console.warn('Failed saving video package to IDB', e);
  }
}

async function loadAllVideoPackagesFromIDB() {
  // Legacy frame decoding removed in favor of hardware-accelerated video streaming
  return;
}
 // layerId -> THREE.CanvasTexture

function applyFillToMeshGlobal(id) {
  const fill = getLayerFill(id);
  if (!fill) return;
  const bs = (typeof getLayerBorderShadow === 'function') ? getLayerBorderShadow(id) : null;
  const mesh = meshLayerMap.get(id);
  if (!mesh || !mesh.material) return;
  const t = getLayerTransform(id);
  const transformOpacity = (t && t.opacity !== undefined) ? (t.opacity / 100) : 1;

  const row = document.querySelector(`.track-row[data-layer-id="${id}"]`);
  const clipName = row?.querySelector('.track-clip-name')?.textContent.trim() || '';

  // 1. High Speed Frame Sequence (PNG/Bitmap Sequence) Rendering (Synchronous, Zero Delay)
  const isPkg = fill.mediaUrl && (fill.mediaUrl.startsWith('video_pkg_') || fill.mediaUrl.startsWith('pkg_'));
  const seq = videoFrameSequenceMap.get(fill.mediaUrl) || videoFrameSequenceMap.get(id) || (clipName && videoFrameSequenceMap.get(clipName));
  if (seq || isPkg) {
    if (!seq || !seq.isReady || !seq.frames || seq.frames.length === 0) {
      const notReadyTex = getNotReadyVideoTexture(getMediaAspectRatio(id, fill?.mediaUrl));
      if (mesh.material.map !== notReadyTex) {
        mesh.material.map = notReadyTex;
        mesh.material.color = new THREE.Color('#FFFFFF');
        mesh.material.transparent = true;
        mesh.material.needsUpdate = true;
      }
      mesh.material.opacity = transformOpacity;
      return;
    }
    const clip = row ? row.querySelector('.track-clip') : null;
    const startTime = clip ? (parseFloat(clip.style.marginLeft) || 0) / PX_PER_SEC : 0;
    const localTime = Math.max(0, elapsed - startTime);
    const frameIndex = Math.min(seq.frames.length - 1, Math.max(0, Math.floor(localTime * (seq.fps || 30))));
    const currentFrame = seq.frames[frameIndex];

    if (!currentFrame || (currentFrame.width === 0 && (!currentFrame.naturalWidth || currentFrame.naturalWidth === 0))) {
      const notReadyTex = getNotReadyVideoTexture(getMediaAspectRatio(id, fill?.mediaUrl));
      if (mesh.material.map !== notReadyTex) {
        mesh.material.map = notReadyTex;
        mesh.material.color = new THREE.Color('#FFFFFF');
        mesh.material.transparent = true;
        mesh.material.needsUpdate = true;
      }
      mesh.material.opacity = transformOpacity;
      return;
    }

    const lastIndex = layerLastRenderedFrameIndex.get(id);
    let fTex = layerFrameTextureMap.get(id);
    if (!fTex) {
      fTex = new THREE.CanvasTexture(currentFrame);
      fTex.colorSpace = THREE.SRGBColorSpace;
      fTex.minFilter = THREE.LinearFilter;
      fTex.magFilter = THREE.LinearFilter;
      fTex.generateMipmaps = false;
      fTex.flipY = true;
      layerFrameTextureMap.set(id, fTex);
      layerLastRenderedFrameIndex.set(id, frameIndex);
    } else if (lastIndex !== frameIndex || fTex.image !== currentFrame) {
      fTex.image = currentFrame;
      fTex.generateMipmaps = false;
      fTex.flipY = true;
      fTex.needsUpdate = true;
      layerLastRenderedFrameIndex.set(id, frameIndex);
    }

    if (mesh.material.map !== fTex) {
      mesh.material.map = fTex;
      mesh.material.color = new THREE.Color('#FFFFFF');
      mesh.material.transparent = true;
      mesh.material.needsUpdate = true;
    }
    mesh.material.opacity = transformOpacity;

    if (seq.aspectRatio) {
      mediaNaturalRatioMap.set(id, seq.aspectRatio);
      fill.aspectRatio = seq.aspectRatio;
    }
    return;
  }

  if (pendingTextureRenders.has(id)) {
    cancelAnimationFrame(pendingTextureRenders.get(id));
  }
  const handle = requestAnimationFrame(() => {
    pendingTextureRenders.delete(id);

    const isVideo = (fill.type === 'media' && fill.mediaUrl && !fill.mediaUrl.startsWith('video_pkg_') && !fill.mediaUrl.startsWith('pkg_') && ((fill.mediaType && fill.mediaType.startsWith('video')) || fill.mediaUrl.startsWith('data:video/') || fill.mediaUrl.startsWith('blob:') || /\.(mp4|webm|mov|mkv|ogg)$/i.test(fill.mediaUrl)));

    if (isVideo) {
      let video = layerVideoMap.get(id);
      if (!video || video.src !== fill.mediaUrl) {
        if (video) {
          video.pause();
          video.removeAttribute("src"); try { video.load(); } catch(_) {}
        }
        video = document.createElement('video');
        video.src = fill.mediaUrl;
        video.crossOrigin = 'anonymous';
        video.playsInline = true;
        video.muted = true;
        video.preload = 'auto';
        layerVideoMap.set(id, video);
        try { video.load(); } catch(e) {}
      }

      let vTex = layerVideoTextureMap.get(id);
      if (!vTex || vTex.image !== video) {
        if (vTex) try { vTex.dispose(); } catch(_) {}
        vTex = new THREE.VideoTexture(video);
        vTex.colorSpace = THREE.SRGBColorSpace;
        vTex.minFilter = THREE.LinearFilter;
        vTex.magFilter = THREE.LinearFilter;
        vTex.generateMipmaps = false;
        layerVideoTextureMap.set(id, vTex);
      }

      const refreshVideoFrame = () => {
        vTex.needsUpdate = true;
        if (video.videoWidth && video.videoHeight) {
          const aspect = video.videoWidth / video.videoHeight;
          mediaNaturalRatioMap.set(id, aspect);
          if (fill.mediaUrl) mediaNaturalRatioMap.set(fill.mediaUrl, aspect);
          fill.aspectRatio = aspect;
        }
        render3D();
      };

      video.addEventListener('loadeddata', refreshVideoFrame, { once: true });
      video.addEventListener('loadedmetadata', refreshVideoFrame, { once: true });
      video.addEventListener('canplay', refreshVideoFrame, { once: true });
      video.addEventListener('seeked', refreshVideoFrame);

      vTex.needsUpdate = true;
      mesh.material.map = vTex;
      mesh.material.color = new THREE.Color('#FFFFFF');
      mesh.material.transparent = true;
      mesh.material.opacity = transformOpacity;
      mesh.material.needsUpdate = true;

      refreshVideoFrame();
      return;
    }

    renderLayerTexture(id, fill, bs, (canvas) => {
      layerBaseCanvasMap.set(id, canvas);

      // Invalidate old blur textures for this layer
      for (const k of Array.from(layerBlurTextureCache.keys())) {
        if (k.startsWith(id + '_')) {
          const oldTex = layerBlurTextureCache.get(k);
          if (oldTex) try { oldTex.dispose(); } catch(_) {}
          layerBlurTextureCache.delete(k);
        }
      }

      mesh.userData = mesh.userData || {};
      mesh.userData._currentBlurPx = 0;

      const tex = getBlurredTextureForLayer(id, 0);
      mesh.material.map = tex;
      mesh.material.color = new THREE.Color('#FFFFFF');
      mesh.material.transparent = true;
      mesh.material.depthTest = true;
      mesh.material.depthWrite = true;
      mesh.material.alphaTest = 0.02;
      mesh.material.side = THREE.DoubleSide;
      const fillAlpha = (() => {
        if (fill && fill.type === 'color') {
          const p = typeof parseHexOrRgbLocal === 'function' ? parseHexOrRgbLocal(fill.color || '#FAB778') : {a:1};
          return (fill.alpha !== undefined) ? fill.alpha : (p.a !== undefined ? p.a : 1);
        }
        return 1;
      })();
      mesh.material.opacity = Math.max(0, Math.min(1, transformOpacity * fillAlpha));
      mesh.material.needsUpdate = true;
      render3D();
    });
  });
  pendingTextureRenders.set(id, handle);
}
let activeControllerPanel = 'move';

function solveCubicBezier(p1x, p1y, p2x, p2y, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const x = 3 * (1 - s) * (1 - s) * s * p1x + 3 * (1 - s) * s * s * p2x + s * s * s;
    const dx = 3 * (1 - s) * (1 - s) * p1x + 6 * (1 - s) * s * (p2x - p1x) + 3 * s * s * (1 - p2x);
    const diff = x - t;
    if (Math.abs(diff) < 1e-4) break;
    if (Math.abs(dx) > 1e-5) {
      s -= diff / dx;
    } else {
      break;
    }
    s = Math.max(0, Math.min(1, s));
  }
  return 3 * (1 - s) * (1 - s) * s * p1y + 3 * (1 - s) * s * s * p2y + s * s * s;
}

let graphEditorState = {
  channel: 'position',
  layerId: null,
  kfIndex: 0,
  cp1: { x: 0.33, y: 0.33 },
  cp2: { x: 0.67, y: 0.67 },
  dragging: null,
  dirty: false,
  showGrid: true,
  isOvershoot: false
};

let graphLibrary = JSON.parse(localStorage.getItem('fishGraphLibrary') || '[]');
let globalMoveTransformKfController = null;
let globalGraphEditor = null;

function openGraphEditor(channel, anchorEl) {
  if (selectedTrackRow) {
    graphEditorState.layerId = selectedTrackRow.dataset.layerId || 'default';
  }
  graphEditorState.channel = channel;
  graphEditorState.dirty = false;
  if (graphEditorState.showGrid === undefined) graphEditorState.showGrid = true;

  const kfs = layerKeyframes.get(graphEditorState.layerId) || [];
  const chanKfs = kfs.filter(k => graphKeyForChannel(channel, k) !== undefined).sort((a, b) => a.time - b.time);

  if (chanKfs.length >= 2) {
    let nearest = 0;
    let minDist = Infinity;
    chanKfs.forEach((k, i) => { const d = Math.abs(k.time - elapsed); if (d < minDist) { minDist = d; nearest = i; } });
    graphEditorState.kfIndex = Math.min(nearest, chanKfs.length - 2);
    const kf = chanKfs[graphEditorState.kfIndex];
    const cp = kf['easing_' + channel] || kf.easing || { cp1x: 0.33, cp1y: 0.33, cp2x: 0.67, cp2y: 0.67 };
    graphEditorState.cp1 = { x: cp.cp1x, y: cp.cp1y };
    graphEditorState.cp2 = { x: cp.cp2x, y: cp.cp2y };
  } else {
    graphEditorState.cp1 = { x: 0.33, y: 0.33 };
    graphEditorState.cp2 = { x: 0.67, y: 0.67 };
  }

  const channelLabels = { position: 'Position Graph', rotX: 'Rotation X Graph', rotY: 'Rotation Y Graph', rotZ: 'Rotation Z Graph', scale: 'Scale Graph', opacity: 'Opacity Graph', strokeColor: 'Stroke Color', strokeSize: 'Stroke Size', shadowColor: 'Shadow Color', shadowSize: 'Shadow Size', shadowAlpha: 'Shadow Alpha', shadowPosX: 'Shadow X', shadowPosY: 'Shadow Y' };
  const finalAnchor = anchorEl || document.getElementById('btnKeyframeGraph') || document.getElementById('panelMoveTransform');

  if (window.FishUI && window.FishUI.openGraphPopover) {
    window.FishUI.openGraphPopover({
      anchorElement: finalAnchor,
      title: channelLabels[channel] || `${channel} Graph`,
      cp1: graphEditorState.cp1,
      cp2: graphEditorState.cp2,
      isOvershoot: (graphEditorState.cp1.y > 1.01 || graphEditorState.cp1.y < -0.01 || graphEditorState.cp2.y > 1.01 || graphEditorState.cp2.y < -0.01),
      onCurveChange: ({ cp1, cp2, isOvershoot }) => {
        graphEditorState.cp1 = { ...cp1 };
        graphEditorState.cp2 = { ...cp2 };
        graphEditorState.isOvershoot = isOvershoot;
        graphEditorState.dirty = true;
        applyGraphEasingToKeyframe();
      }
    });
  }
}

function updateGraphButtonsUI() {
  const btnGrid = document.getElementById('btnToggleGrid');
  if (btnGrid) {
    btnGrid.classList.toggle('active', graphEditorState.showGrid !== false);
  }
  const btnOvershoot = document.getElementById('btnToggleOvershoot');
  if (btnOvershoot) {
    btnOvershoot.classList.toggle('active', !!graphEditorState.isOvershoot);
  }
}

function graphKeyForChannel(channel, k) {
  if (channel === 'position') return k.posX !== undefined ? k.posX : undefined;
  if (channel === 'rotX') return k.rotX;
  if (channel === 'rotY') return k.rotY;
  if (channel === 'rotZ') return k.rotZ;
  if (channel === 'scale') return k.scaleW;
  if (channel === 'opacity') return k.opacity;
  if (['strokeColor','strokeSize','shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(channel)) return k[channel];
  return k[channel];
}

function applyGraphEasingToKeyframe() {
  if (!graphEditorState.layerId) return;
  const kfs = layerKeyframes.get(graphEditorState.layerId) || [];
  const chanKfs = kfs.filter(k => graphKeyForChannel(graphEditorState.channel, k) !== undefined).sort((a, b) => a.time - b.time);
  if (chanKfs.length >= 2 && graphEditorState.kfIndex < chanKfs.length - 1) {
    const easingData = {
      cp1x: graphEditorState.cp1.x,
      cp1y: graphEditorState.cp1.y,
      cp2x: graphEditorState.cp2.x,
      cp2y: graphEditorState.cp2.y
    };
    const easingKey = 'easing_' + graphEditorState.channel;
    chanKfs[graphEditorState.kfIndex][easingKey] = easingData;
    chanKfs[graphEditorState.kfIndex].easing = easingData;
    if (typeof saveCurrentProject === 'function') saveCurrentProject();
    syncControllerUI();
    renderCanvasOverlay();
  }
}

function closeGraphEditor(save) {
  const panelMove = document.getElementById('panelMoveTransform');
  const panelGraph = document.getElementById('panelGraphEditor');
  if (panelGraph) {
    panelGraph.classList.remove('slide-in');
    panelGraph.classList.add('slide-out');
    setTimeout(() => {
      panelGraph.style.display = 'none';
      panelGraph.classList.remove('slide-out');
      if (panelMove) {
        panelMove.style.display = 'flex';
        panelMove.classList.remove('slide-out');
        panelMove.classList.add('slide-in');
      }
      renderAllKeyframeMarkers();
      updateKeyframeUI();
    }, 140);
  } else if (panelMove) {
    panelMove.style.display = 'flex';
  }

  if (save && graphEditorState.layerId) {
    applyGraphEasingToKeyframe();
  }
}

function renderGraphCanvas() {
  const canvas = document.getElementById('graphEditorCanvas');
  if (!canvas) return;
  const wrapper = document.getElementById('graphCanvasWrapper');
  if (!wrapper) return;

  const dpr = window.devicePixelRatio || 1;
  const W = wrapper.clientWidth;
  const H = wrapper.clientHeight;
  if (W <= 0 || H <= 0) return;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const isOver = !!graphEditorState.isOvershoot;
  const padX = 22;
  const padY = isOver ? 24 : 18;
  const gw = W - padX * 2;
  const gh = H - padY * 2;

  const YMIN = isOver ? -0.5 : 0.0;
  const YMAX = isOver ? 1.5 : 1.0;
  const YRANGE = YMAX - YMIN;

  const toCanvasX = t => padX + t * gw;
  const toCanvasY = v => padY + (1 - (v - YMIN) / YRANGE) * gh;
  const zeroY = toCanvasY(0);
  const oneY = toCanvasY(1);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#732D06';
  ctx.fillRect(0, 0, W, H);

  if (graphEditorState.showGrid !== false) {
    ctx.strokeStyle = 'rgba(255,242,194,0.06)';
    ctx.lineWidth = 1;
    const gridStepsX = 4;
    const gridStepsY = isOver ? 6 : 4;
    for (let i = 0; i <= gridStepsX; i++) {
      const x = padX + (gw / gridStepsX) * i;
      ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, padY + gh); ctx.stroke();
    }
    for (let i = 0; i <= gridStepsY; i++) {
      const y = padY + (gh / gridStepsY) * i;
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(padX + gw, y); ctx.stroke();
    }
  }

  if (isOver) {
    ctx.strokeStyle = 'rgba(255,242,194,0.22)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(padX, zeroY); ctx.lineTo(padX + gw, zeroY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padX, oneY); ctx.lineTo(padX + gw, oneY); ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(255,242,194,0.18)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(padX, padY, gw, gh);
  }

  const cp1cx = toCanvasX(graphEditorState.cp1.x);
  const cp1cy = toCanvasY(graphEditorState.cp1.y);
  const cp2cx = toCanvasX(graphEditorState.cp2.x);
  const cp2cy = toCanvasY(graphEditorState.cp2.y);
  const startX = toCanvasX(0);
  const startY = toCanvasY(0);
  const endX = toCanvasX(1);
  const endY = toCanvasY(1);

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(cp1cx, cp1cy);
  ctx.strokeStyle = 'rgba(250,183,120,0.65)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(cp2cx, cp2cy);
  ctx.strokeStyle = 'rgba(250,183,120,0.65)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.bezierCurveTo(cp1cx, cp1cy, cp2cx, cp2cy, endX, endY);
  ctx.strokeStyle = '#FAB778';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const kfs = layerKeyframes.get(graphEditorState.layerId) || [];
  const chanKfs = kfs.filter(k => graphKeyForChannel(graphEditorState.channel, k) !== undefined).sort((a, b) => a.time - b.time);
  if (chanKfs.length >= 2 && graphEditorState.kfIndex < chanKfs.length - 1) {
    const k1 = chanKfs[graphEditorState.kfIndex];
    const k2 = chanKfs[graphEditorState.kfIndex + 1];
    const span = Math.max(0.001, k2.time - k1.time);
    const rawProgress = Math.max(0, Math.min(1, (elapsed - k1.time) / span));
    const easedVal = solveCubicBezier(graphEditorState.cp1.x, graphEditorState.cp1.y, graphEditorState.cp2.x, graphEditorState.cp2.y, rawProgress);
    const dotX = toCanvasX(rawProgress);
    const dotY = toCanvasY(easedVal);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFF2C2';
    ctx.fill();
    ctx.strokeStyle = '#4A1D05';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  const drawHandle = (cx, cy) => {
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#FFF2C2';
    ctx.fill();
    ctx.strokeStyle = '#4A1D05';
    ctx.lineWidth = 2.2;
    ctx.stroke();
  };
  drawHandle(cp1cx, cp1cy);
  drawHandle(cp2cx, cp2cy);

  ctx.beginPath();
  ctx.arc(startX, startY, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#FAB778';
  ctx.fill();
  ctx.strokeStyle = '#4A1D05';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(endX, endY, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#FAB778';
  ctx.fill();
  ctx.strokeStyle = '#4A1D05';
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

function initGraphEditorInteraction() {
  const canvas = document.getElementById('graphEditorCanvas');
  if (!canvas) return;

  const HANDLE_R = 26;

  const canvasPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { cx: src.clientX - rect.left, cy: src.clientY - rect.top };
  };

  const getDims = () => {
    const isOver = !!graphEditorState.isOvershoot;
    const padX = 22;
    const padY = isOver ? 24 : 18;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const gw = W - padX * 2;
    const gh = H - padY * 2;
    const YMIN = isOver ? -0.5 : 0.0;
    const YMAX = isOver ? 1.5 : 1.0;
    const YRANGE = YMAX - YMIN;
    return { padX, padY, gw, gh, YMIN, YMAX, YRANGE, isOver };
  };

  const toNorm = (cx, cy) => {
    const { padX, padY, gw, gh, YMIN, YMAX, YRANGE, isOver } = getDims();
    let t = Math.max(0, Math.min(1, (cx - padX) / gw));
    let v;
    if (!isOver) {
      v = Math.max(0, Math.min(1, 1 - (cy - padY) / gh));
    } else {
      v = Math.max(YMIN, Math.min(YMAX, YMIN + (1 - (cy - padY) / gh) * YRANGE));
    }

    if (graphEditorState.showGrid !== false) {
      const snapThresholdX = 10 / Math.max(100, gw);
      const snapThresholdY = 10 / Math.max(100, gh);
      const snapStepsX = [0, 0.25, 0.333, 0.5, 0.667, 0.75, 1.0];
      for (let s of snapStepsX) {
        if (Math.abs(t - s) <= snapThresholdX) {
          t = s;
          break;
        }
      }
      const snapStepsY = isOver ? [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5] : [0, 0.25, 0.333, 0.5, 0.667, 0.75, 1.0];
      for (let s of snapStepsY) {
        if (Math.abs(v - s) <= snapThresholdY) {
          v = s;
          break;
        }
      }
      if (Math.abs(t - v) <= snapThresholdX) {
        v = t;
      }
    }

    return { t, v };
  };

  const isNear = (cx, cy, hx, hy) => {
    const { padX, padY, gw, gh, YMIN, YRANGE } = getDims();
    const hcx = padX + hx * gw;
    const hcy = padY + (1 - (hy - YMIN) / YRANGE) * gh;
    return Math.hypot(cx - hcx, cy - hcy) <= HANDLE_R;
  };

  const onDown = (e) => {
    e.preventDefault();
    const { cx, cy } = canvasPos(e);
    if (isNear(cx, cy, graphEditorState.cp1.x, graphEditorState.cp1.y)) {
      graphEditorState.dragging = 'cp1';
      if (e.pointerId !== undefined) canvas.setPointerCapture(e.pointerId);
    } else if (isNear(cx, cy, graphEditorState.cp2.x, graphEditorState.cp2.y)) {
      graphEditorState.dragging = 'cp2';
      if (e.pointerId !== undefined) canvas.setPointerCapture(e.pointerId);
    }
  };

  const onMove = (e) => {
    e.preventDefault();
    if (!graphEditorState.dragging) return;
    const { cx, cy } = canvasPos(e);
    const { t, v } = toNorm(cx, cy);
    if (graphEditorState.dragging === 'cp1') {
      graphEditorState.cp1 = { x: t, y: v };
    } else {
      graphEditorState.cp2 = { x: t, y: v };
    }
    graphEditorState.dirty = true;
    updateGraphButtonsUI();
    renderGraphCanvas();
  };

  const onUp = (e) => {
    if (graphEditorState.dragging) {
      applyGraphEasingToKeyframe();
    }
    graphEditorState.dragging = null;
    if (e.pointerId !== undefined) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
}

function openGraphLibrary() {
  const overlay = document.getElementById('graphLibraryOverlay');
  if (!overlay) return;
  overlay.classList.add('active');
  renderGraphLibraryList();
}

function closeGraphLibrary() {
  const overlay = document.getElementById('graphLibraryOverlay');
  if (overlay) overlay.classList.remove('active');
}

function renderGraphLibraryList() {
  const list = document.getElementById('graphLibraryList');
  if (!list) return;
  list.innerHTML = '';

  const defaultPresets = [
    { name: 'Linear', cp1x: 0.33, cp1y: 0.33, cp2x: 0.67, cp2y: 0.67 },
    { name: 'Ease In', cp1x: 0.42, cp1y: 0.0, cp2x: 1.0, cp2y: 1.0 },
    { name: 'Ease Out', cp1x: 0.0, cp1y: 0.0, cp2x: 0.58, cp2y: 1.0 },
    { name: 'S-Curve (Ease In Out)', cp1x: 0.42, cp1y: 0.0, cp2x: 0.58, cp2y: 1.0 },
    { name: 'Overshoot / Bounce', cp1x: 0.34, cp1y: 1.45, cp2x: 0.64, cp2y: 1.0 },
    { name: 'Anticipation / Back', cp1x: 0.36, cp1y: -0.35, cp2x: 0.64, cp2y: 1.0 }
  ];

  defaultPresets.forEach(item => {
    const el = document.createElement('div');
    el.className = 'graph-library-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'graph-library-item-name';
    nameEl.textContent = item.name;
    el.appendChild(nameEl);
    el.addEventListener('click', () => {
      graphEditorState.cp1 = { x: item.cp1x, y: item.cp1y };
      graphEditorState.cp2 = { x: item.cp2x, y: item.cp2y };
      graphEditorState.isOvershoot = (item.cp1y > 1.01 || item.cp1y < -0.01 || item.cp2y > 1.01 || item.cp2y < -0.01);
      closeGraphLibrary();
      updateGraphButtonsUI();
      applyGraphEasingToKeyframe();
      renderGraphCanvas();
    });
    list.appendChild(el);
  });

  if (graphLibrary.length > 0) {
    graphLibrary.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'graph-library-item';
      const nameEl = document.createElement('span');
      nameEl.className = 'graph-library-item-name';
      nameEl.textContent = item.name;
      const delBtn = document.createElement('button');
      delBtn.className = 'graph-library-item-delete';
      delBtn.innerHTML = '<span class="material-symbols-rounded">delete</span>';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        graphLibrary.splice(idx, 1);
        localStorage.setItem('fishGraphLibrary', JSON.stringify(graphLibrary));
        renderGraphLibraryList();
      });
      el.addEventListener('click', () => {
        graphEditorState.cp1 = { x: item.cp1x, y: item.cp1y };
        graphEditorState.cp2 = { x: item.cp2x, y: item.cp2y };
        graphEditorState.isOvershoot = (item.cp1y > 1.01 || item.cp1y < -0.01 || item.cp2y > 1.01 || item.cp2y < -0.01);
        closeGraphLibrary();
        updateGraphButtonsUI();
        applyGraphEasingToKeyframe();
        renderGraphCanvas();
      });
      el.appendChild(nameEl);
      el.appendChild(delBtn);
      list.appendChild(el);
    });
  }
}

function saveCurrentGraphToLibrary() {
  const name = prompt('Nama preset graph:');
  if (!name || !name.trim()) return;
  graphLibrary.push({ name: name.trim(), cp1x: graphEditorState.cp1.x, cp1y: graphEditorState.cp1.y, cp2x: graphEditorState.cp2.x, cp2y: graphEditorState.cp2.y });
  localStorage.setItem('fishGraphLibrary', JSON.stringify(graphLibrary));
  renderGraphLibraryList();
}

function isTransformPanelOpen() {
  const panelMove = document.getElementById('panelMoveTransform');
  const panelGraph = document.getElementById('panelGraphEditor');
  const drawer = document.getElementById('layerInspectorDrawer');
  const isSubpanelMove = drawer && drawer.classList.contains('subpanel-move');
  const moveOpen = !!(panelMove && panelMove.style.display !== 'none');
  const graphOpen = !!(panelGraph && panelGraph.style.display !== 'none');
  return isSubpanelMove || moveOpen || graphOpen;
}

function getActiveKeyframeChannel() {
  if (!isTransformPanelOpen()) return null;
  if (activeControllerPanel === 'rotate') {
    return 'rot' + (activeRotationAxis || 'Z');
  }
  if (activeControllerPanel === 'scale') {
    return 'scale';
  }
  if (activeControllerPanel === 'opacity') {
    return 'opacity';
  }
  return 'position';
}

function hasKeyframeForChannel(id, time, channel, tolerance = 0.15) {
  const kfs = layerKeyframes.get(id);
  if (!kfs || !kfs.length) return false;
  return kfs.some(k => {
    if (Math.abs(k.time - time) > tolerance) return false;
    if (channel === 'rotX') return k.rotX !== undefined;
    if (channel === 'rotY') return k.rotY !== undefined;
    if (channel === 'rotZ') return k.rotZ !== undefined;
    if (channel === 'scale') return k.scaleW !== undefined || k.scaleH !== undefined;
    if (channel === 'opacity') return k.opacity !== undefined;
    if (channel === 'position') return k.posX !== undefined || k.posY !== undefined || k.posZ !== undefined;
    if (['strokeColor','strokeSize','shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(channel)) return k[channel] !== undefined;
    return k[channel] !== undefined;
  });
}

function getKeyframeAt(id, time, tolerance = 0.15) {
  const kfs = layerKeyframes.get(id);
  if (!kfs || !kfs.length) return null;
  return kfs.find(k => Math.abs(k.time - time) <= tolerance) || null;
}

function updateKeyframeUI() {
  if (!selectedTrackRow) return;
  const id = selectedTrackRow.dataset.layerId || 'default';
  const channel = getActiveKeyframeChannel();
  const hasKf = hasKeyframeForChannel(id, elapsed, channel);
  const diamondBtn = document.getElementById('btnToggleKeyframe');
  if (diamondBtn) {
    const symbol = diamondBtn.querySelector('.diamond-icon-symbol');
    if (hasKf) {
      diamondBtn.classList.add('is-on-keyframe');
      if (symbol) symbol.setAttribute('d', 'M7 12 L17 12');
    } else {
      diamondBtn.classList.remove('is-on-keyframe');
      if (symbol) symbol.setAttribute('d', 'M12 7 L12 17 M7 12 L17 12');
    }
  }
  // also update Border & Shadow diamond jika panel terbuka
  if (typeof updateBorderShadowKeyframeUI === 'function') {
    try { updateBorderShadowKeyframeUI(); } catch(e) {}
  }
}

let selectedKeyframeTime = null;
let selectedKeyframeLayerId = null;

function renderKeyframeMarkersOnClip(row) {
  if (!row) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const id = row.dataset.layerId;
  if (!id) return;

  let container = clip.querySelector('.clip-keyframes-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'clip-keyframes-container';
    clip.appendChild(container);
  }
  container.innerHTML = '';

  const kfs = layerKeyframes.get(id);
  if (!kfs || kfs.length === 0) return;

  const clipMargin = parseFloat(clip.style.marginLeft) || 0;
  const clipWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const isRowSelected = (selectedTrackRow === row);

  // Determine active channel currently open in inspector
  let activeChannel = null;
  const drawer = document.getElementById('layerInspectorDrawer');
  const isBorderPanel = isRowSelected && ((document.getElementById('panelBorderShadow') && document.getElementById('panelBorderShadow').style.display !== 'none') || (drawer && drawer.classList.contains('subpanel-border-shadow')));
  
  if (isRowSelected) {
    if (isBorderPanel) {
      activeChannel = getActiveBorderShadowChannel();
    } else if (isTransformPanelOpen()) {
      activeChannel = getActiveKeyframeChannel();
    }
  }

  kfs.forEach(kf => {
    const kfPx = (kf.time * PX_PER_SEC) - clipMargin;
    if (kfPx >= -8 && kfPx <= clipWidth + 8) {
      const marker = document.createElement('div');
      
      // Check if this keyframe contains the active channel
      let isMatchingChannel = false;
      if (isRowSelected && activeChannel) {
        if (activeChannel === 'position') {
          isMatchingChannel = kf.posX !== undefined || kf.posY !== undefined || kf.posZ !== undefined;
        } else if (activeChannel === 'rotX') {
          isMatchingChannel = kf.rotX !== undefined;
        } else if (activeChannel === 'rotY') {
          isMatchingChannel = kf.rotY !== undefined;
        } else if (activeChannel === 'rotZ') {
          isMatchingChannel = kf.rotZ !== undefined;
        } else if (activeChannel === 'scale') {
          isMatchingChannel = kf.scaleW !== undefined || kf.scaleH !== undefined;
        } else if (activeChannel === 'opacity') {
          isMatchingChannel = kf.opacity !== undefined;
        } else {
          isMatchingChannel = kf[activeChannel] !== undefined;
        }
      }

      // ONLY keyframes matching the currently active parameter are interactive and highlighted!
      const canInteract = isRowSelected && isMatchingChannel;
      const isActive = canInteract && Math.abs(kf.time - elapsed) <= 0.05;

      marker.className = 'clip-keyframe-marker' + 
        (isActive ? ' is-active' : '') + 
        (isMatchingChannel ? ' is-channel-keyframe can-drag' : ' is-other-channel is-locked');
      
      marker.style.left = `${kfPx}px`;
      marker.title = `Keyframe: ${kf.time.toFixed(2)}s${isMatchingChannel ? ` (${activeChannel})` : ''}`;
      
      // Full-height vertical diamond shape
      marker.innerHTML = `
        <svg viewBox="0 0 16 32" preserveAspectRatio="none" class="keyframe-diamond-svg">
          <path d="M8 1 L15 16 L8 31 L1 16 Z" class="diamond-shape"/>
        </svg>
      `;

      if (!canInteract) {
        // Not in this parameter or unselected layer: non-interactive (locked)
        marker.style.pointerEvents = 'none';
        container.appendChild(marker);
        return;
      }

      // If in active parameter: enable dragging and scrubbing
      let isDraggingKf = false;
      let startKfX = 0;
      let initKfTime = kf.time;
      let holdTimer = null;
      let didMoveKf = false;

      const onKfDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const pt = e.touches ? e.touches[0] : e;
        startKfX = pt.pageX;
        initKfTime = kf.time;
        isDraggingKf = false;
        didMoveKf = false;
        selectedKeyframeTime = kf.time;
        selectedKeyframeLayerId = id;

        holdTimer = setTimeout(() => {
          isDraggingKf = true;
          marker.classList.add('is-dragging-keyframe');
          if (navigator.vibrate) navigator.vibrate(25);
        }, 140);

        const onKfMove = (me) => {
          const mpt = me.touches ? me.touches[0] : me;
          const dx = mpt.pageX - startKfX;

          if (!isDraggingKf) {
            if (Math.abs(dx) > 3) {
              clearTimeout(holdTimer);
              isDraggingKf = true;
              marker.classList.add('is-dragging-keyframe');
            }
          }

          if (isDraggingKf) {
            me.preventDefault();
            me.stopPropagation();
            didMoveKf = true;
            const deltaSec = dx / PX_PER_SEC;
            const minSec = clipMargin / PX_PER_SEC;
            const maxSec = (clipMargin + clipWidth) / PX_PER_SEC;
            const newTime = Math.max(minSec, Math.min(maxSec, initKfTime + deltaSec));
            kf.time = Math.round(newTime * 100) / 100;
            selectedKeyframeTime = kf.time;
            const newPos = (kf.time * PX_PER_SEC) - clipMargin;
            marker.style.left = `${newPos}px`;
            marker.title = `Keyframe: ${kf.time.toFixed(2)}s (${activeChannel})`;
            setTimelineOffset(kf.time * PX_PER_SEC);
          }
        };

        const onKfUp = (ue) => {
          if (ue) ue.stopPropagation();
          clearTimeout(holdTimer);
          window.removeEventListener('mousemove', onKfMove);
          window.removeEventListener('mouseup', onKfUp);
          window.removeEventListener('touchmove', onKfMove);
          window.removeEventListener('touchend', onKfUp);

          marker.classList.remove('is-dragging-keyframe');

          if (didMoveKf) {
            kfs.sort((a, b) => a.time - b.time);
            renderAllKeyframeMarkers();
            syncControllerUI();
            triggerAutoSave();
          } else {
            setTimelineOffset(kf.time * PX_PER_SEC);
          }
        };

        window.addEventListener('mousemove', onKfMove);
        window.addEventListener('mouseup', onKfUp);
        window.addEventListener('touchmove', onKfMove, { passive: false });
        window.addEventListener('touchend', onKfUp);
      };

      marker.addEventListener('mousedown', onKfDown);
      marker.addEventListener('touchstart', onKfDown, { passive: false });

      container.appendChild(marker);
    }
  });
}

function renderAllKeyframeMarkers() {
  document.querySelectorAll('.track-row').forEach(row => {
    renderKeyframeMarkersOnClip(row);
  });
}

function toggleKeyframe() {
  if (!selectedTrackRow) return;
  if (typeof pushUndoState === 'function') {
    pushUndoState();
  }
  const id = selectedTrackRow.dataset.layerId || 'default';
  if (!layerKeyframes.has(id)) {
    layerKeyframes.set(id, []);
  }
  const kfs = layerKeyframes.get(id);
  const channel = getActiveKeyframeChannel();
  const existing = getKeyframeAt(id, elapsed);
  const t = getLayerTransform(id);

  if (existing && hasKeyframeForChannel(id, elapsed, channel)) {
    if (channel === 'rotX') delete existing.rotX;
    else if (channel === 'rotY') delete existing.rotY;
    else if (channel === 'rotZ') delete existing.rotZ;
    else if (channel === 'scale') { delete existing.scaleW; delete existing.scaleH; }
    else if (channel === 'opacity') delete existing.opacity;
    else if (channel === 'position') { delete existing.posX; delete existing.posY; delete existing.posZ; }

    const hasAny = ['posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'scaleW', 'scaleH', 'opacity'].some(p => existing[p] !== undefined);
    if (!hasAny) {
      const idx = kfs.indexOf(existing);
      if (idx !== -1) kfs.splice(idx, 1);
    }
  } else {
    let target = existing;
    if (!target) {
      target = { time: elapsed };
      kfs.push(target);
    }
    if (channel === 'rotX') target.rotX = t.rotX;
    else if (channel === 'rotY') target.rotY = t.rotY;
    else if (channel === 'rotZ') target.rotZ = t.rotZ;
    else if (channel === 'scale') { target.scaleW = t.scaleW; target.scaleH = t.scaleH; }
    else if (channel === 'opacity') target.opacity = t.opacity;
    else if (channel === 'position') { target.posX = t.posX; target.posY = t.posY; target.posZ = t.posZ; }
    kfs.sort((a, b) => a.time - b.time);
  }

  updateKeyframeUI();
  syncControllerUI();
  renderAllKeyframeMarkers();
  triggerAutoSave();
}

function recordTransformChange(id, t) {
  if (!_isGestureActive && typeof pushUndoState === 'function') {
    pushUndoState();
    _isGestureActive = true;
  }

  if (!layerTransforms.has(id)) {
    layerTransforms.set(id, { ...t });
  } else {
    Object.assign(layerTransforms.get(id), t);
  }

  // Auto-add keyframe: jika user menggeser tanpa keyframe, langsung buat keyframe baru
  const channel = getActiveKeyframeChannel();
  if (channel) {
    if (!layerKeyframes.has(id)) layerKeyframes.set(id, []);
    const kfs = layerKeyframes.get(id);
    const hasKf = hasKeyframeForChannel(id, elapsed, channel);
    let target = getKeyframeAt(id, elapsed);
    if (hasKf && target) {
      // Update existing keyframe for active channel
      if (channel === 'rotX') target.rotX = t.rotX;
      else if (channel === 'rotY') target.rotY = t.rotY;
      else if (channel === 'rotZ') target.rotZ = t.rotZ;
      else if (channel === 'scale') { target.scaleW = t.scaleW; target.scaleH = t.scaleH; }
      else if (channel === 'opacity') target.opacity = t.opacity;
      else if (channel === 'position') { target.posX = t.posX; target.posY = t.posY; target.posZ = t.posZ; }
    } else {
      // Belum ada keyframe di waktu ini untuk channel aktif -> buat otomatis
      if (!target) {
        target = { time: Math.round(elapsed * 100) / 100 };
        kfs.push(target);
      }
      if (channel === 'rotX') target.rotX = t.rotX;
      else if (channel === 'rotY') target.rotY = t.rotY;
      else if (channel === 'rotZ') target.rotZ = t.rotZ;
      else if (channel === 'scale') { target.scaleW = t.scaleW; target.scaleH = t.scaleH; }
      else if (channel === 'opacity') target.opacity = t.opacity;
      else if (channel === 'position') { target.posX = t.posX; target.posY = t.posY; target.posZ = t.posZ; }
      kfs.sort((a, b) => a.time - b.time);
    }
    requestAllKeyframeMarkersRender();
    updateKeyframeUI();
  } else {
    // Fallback: tetap render marker jika ada keyframe lama
    const kfs = layerKeyframes.get(id);
    if (kfs && kfs.length > 0) {
      requestAllKeyframeMarkersRender();
      updateKeyframeUI();
    }
  }
  requestCanvasOverlayRender();
  triggerAutoSave();
}

let cachedScreenW = 360;
let cachedScreenH = 640;
let _lastOverlaySvg = '';
let _cachedMotionPathKey = '';
let _cachedMotionPathSvg = '';

function updateCachedScreenDimensions() {
  const screen = document.getElementById('canvasScreen');
  if (screen) {
    cachedScreenW = screen.clientWidth || 360;
    cachedScreenH = screen.clientHeight || 640;
  }
}
const mediaNaturalRatioMap = new Map(); // layerId or mediaUrl -> aspect ratio (w / h)

function getMediaAspectRatio(layerId, mediaUrl) {
  const row = document.querySelector(`.track-row[data-layer-id="${layerId}"]`);
  const clipName = row?.querySelector('.track-clip-name')?.textContent.trim() || '';

  if (layerId && mediaNaturalRatioMap.has(layerId)) {
    return mediaNaturalRatioMap.get(layerId);
  }
  if (mediaUrl && mediaNaturalRatioMap.has(mediaUrl)) {
    return mediaNaturalRatioMap.get(mediaUrl);
  }
  if (clipName && mediaNaturalRatioMap.has(clipName)) {
    return mediaNaturalRatioMap.get(clipName);
  }
  const seq = (mediaUrl && videoFrameSequenceMap.get(mediaUrl)) || (layerId && videoFrameSequenceMap.get(layerId)) || (clipName && videoFrameSequenceMap.get(clipName));
  if (seq && seq.aspectRatio) {
    return seq.aspectRatio;
  }
  if (layerId && typeof getLayerFill === 'function') {
    const f = getLayerFill(layerId);
    if (f && f.aspectRatio) return f.aspectRatio;
    if (f && f.mediaUrl && mediaNaturalRatioMap.has(f.mediaUrl)) return mediaNaturalRatioMap.get(f.mediaUrl);
  }
  return 1.0;
}

function renderCanvasOverlay() {
  const overlay = document.getElementById('canvasTransformOverlay');
  if (!overlay) return;

  if (!selectedTrackRow) {
    if (_lastOverlaySvg !== '') {
      _lastOverlaySvg = '';
      overlay.innerHTML = '';
    }
    return;
  }

  const id = selectedTrackRow.dataset.layerId || 'default';
  const wt = (typeof getLayerWorldTransform === 'function') ? getLayerWorldTransform(id) : getLayerTransform(id);
  const screen = document.getElementById('canvasScreen');
  if (!screen) return;

  const w = screen.clientWidth || 360;
  const h = screen.clientHeight || 640;

  const posX = Number(wt.posX) || 0;
  const posY = Number(wt.posY) || 0;
  const posZ = Number(wt.posZ) || 0;
  const scaleW = Number(wt.scaleW) || 100;
  const scaleH = Number(wt.scaleH) || 100;
  const rotZ = Number(wt.rotZ) || 0;
  const rotX = Number(wt.rotX) || 0;
  const rotY = Number(wt.rotY) || 0;

  // 1. Calculate screen coordinates matching Three.js Perspective Camera
  const camDist = Math.max(0.5, (camera3D ? camera3D.position.z : 5) - (posZ / 200));
  const fovRad = ((camera3D ? camera3D.fov : 45) * Math.PI) / 180;
  const visH = 2 * Math.tan(fovRad / 2) * camDist;
  const pxPerUnit = h / visH;

  const curX = w / 2 + (posX / 200) * pxPerUnit;
  const curY = h / 2 - (posY / 200) * pxPerUnit;

  // 2. Determine Layer Shape & Local Dimensions
  const cat = selectedTrackRow.dataset.category || 'media';
  const clipName = selectedTrackRow.querySelector('.track-clip-name')?.textContent.trim() || '';
  const fill = (typeof getLayerFill === 'function') ? getLayerFill(id) : null;
  const isVideoOrMedia = (cat === 'media' || cat === 'video' || (fill && fill.type === 'media') || (clipName && /\.(mp4|webm|mov|mkv|png|jpg|jpeg|webp)$/i.test(clipName)) || videoFrameSequenceMap.has(fill?.mediaUrl) || videoFrameSequenceMap.has(id) || videoFrameSequenceMap.has(clipName));

  let shapeType = selectedTrackRow.dataset.shapeType || '';
  if (!shapeType) {
    const lower = (clipName + '_' + cat).toLowerCase();
    if (lower.includes('circle') || lower.includes('bulat')) shapeType = 'circle';
    else if (lower.includes('triangle') || lower.includes('segitiga')) shapeType = 'triangle';
    else if (lower.includes('round')) shapeType = 'round';
    else if (lower.includes('square') || lower.includes('kotak')) shapeType = 'square';
    else if (lower.includes('star') || lower.includes('bintang')) shapeType = 'star';
    else if (lower.includes('line') || lower.includes('garis')) shapeType = 'line';
    else if (lower.includes('arrow') || lower.includes('panah')) shapeType = 'arrow';
    else if (cat === 'shape') shapeType = 'square';
    else shapeType = isVideoOrMedia ? 'media' : 'square';
  }

  let sizeX = 100, sizeY = 100;
  if (!isVideoOrMedia && typeof getLayerShapeParams === 'function') {
    const sp = getLayerShapeParams(id, (shapeType === 'media' || shapeType === 'line' || shapeType === 'arrow') ? 'square' : shapeType);
    if (sp.sizeX !== undefined) sizeX = sp.sizeX;
    if (sp.sizeY !== undefined) sizeY = sp.sizeY;
  }

  // 3D Plane Mesh Base Dimension: 4.0 units
  let baseW = 4.0;
  let baseH = 4.0;

  if (isVideoOrMedia || shapeType === 'media') {
    const aspect = getMediaAspectRatio(id, wt.mediaUrl || fill?.mediaUrl);
    const mediaBase = 4.0; // 100% full scale
    if (aspect >= 1) {
      baseW = mediaBase;
      baseH = mediaBase / aspect;
    } else {
      baseW = mediaBase * aspect;
      baseH = mediaBase;
    }
  } else {
    // Vector shapes occupy 1.6 units within the 4.0 unit plane texture
    baseW = 1.6;
    baseH = 1.6;
  }

  const rawW = baseW * (Math.abs(sizeX) / 100) * (Math.abs(scaleW) / 100) * pxPerUnit;
  const rawH = baseH * (Math.abs(sizeY) / 100) * (Math.abs(scaleH) / 100) * pxPerUnit;

  // Zero outward margin so wireframe sits perfectly tight on the layer edges
  const marginPx = 0;
  const bw = Math.max(4, rawW);
  const bh = Math.max(4, rawH);

  // 3D Pitch, Yaw, Roll angles (matching control dial)
  const radZ = (rotZ * Math.PI) / 180;
  const radX = (rotX * Math.PI) / 180;
  const radY = (rotY * Math.PI) / 180;

  const hw = (bw / 2) * Math.max(0.08, Math.abs(Math.cos(radY)));
  const hh = (bh / 2) * Math.max(0.08, Math.abs(Math.cos(radX)));

  const cosZ = Math.cos(radZ);
  const sinZ = Math.sin(radZ);

  // 4 3D Rotated Corners (Top-Left, Top-Right, Bottom-Right, Bottom-Left)
  const p1 = { x: curX - hw * cosZ + hh * sinZ, y: curY - hw * sinZ - hh * cosZ };
  const p2 = { x: curX + hw * cosZ + hh * sinZ, y: curY + hw * sinZ - hh * cosZ };
  const p3 = { x: curX + hw * cosZ - hh * sinZ, y: curY + hw * sinZ + hh * cosZ };
  const p4 = { x: curX - hw * cosZ - hh * sinZ, y: curY - hw * sinZ + hh * cosZ };

  // Midpoints for outer edge resize handles
  const pTopMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const pRightMid = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
  const pBotMid = { x: (p3.x + p4.x) / 2, y: (p3.y + p4.y) / 2 };
  const pLeftMid = { x: (p4.x + p1.x) / 2, y: (p4.y + p1.y) / 2 };

  let svgContent = '';

  // 1. Frame-Accurate Motion Path Trajectory (After Effects Style)
  const kfs = layerKeyframes.get(id);
  const posKfs = (kfs || []).filter(k => k.posX !== undefined || k.posY !== undefined || k.posZ !== undefined).sort((a, b) => a.time - b.time);
  if (posKfs.length >= 2) {
    const fps = projectFps || 30;
    const minTime = posKfs[0].time;
    const maxTime = posKfs[posKfs.length - 1].time;
    const minFrame = Math.round(minTime * fps);
    const maxFrame = Math.round(maxTime * fps);
    const kfTimes = new Set(posKfs.map(k => Math.round(k.time * fps)));

    const framePoints = [];
    for (let f = minFrame; f <= maxFrame; f++) {
      const fTime = f / fps;
      const wt = getLayerWorldTransform(id, new Set(), fTime);
      const kDist = Math.max(0.5, (camera3D ? camera3D.position.z : 5) - (wt.posZ / 200));
      const kVisH = 2 * Math.tan(fovRad / 2) * kDist;
      const kPxPerUnit = h / kVisH;
      let kx = w / 2 + (wt.posX / 200) * kPxPerUnit;
      let ky = h / 2 - (wt.posY / 200) * kPxPerUnit;
      if (isNaN(kx)) kx = w / 2;
      if (isNaN(ky)) ky = h / 2;
      framePoints.push({
        x: kx,
        y: ky,
        isKeyframe: kfTimes.has(f)
      });
    }

    if (framePoints.length >= 2) {
      let pathD = '';
      framePoints.forEach((pt, idx) => {
        pathD += (idx === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`);
      });

      let trajSvg = `<path d="${pathD}" fill="none" stroke="#FAB778" stroke-width="1.6" opacity="0.9" stroke-linecap="round" stroke-linejoin="round" />`;

      // Frame position dots: density directly reflects speed / Graph Editor easing curve
      framePoints.forEach(pt => {
        if (!pt.isKeyframe) {
          trajSvg += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="1.6" fill="#FAB778" opacity="0.8" />`;
        }
      });

      // Keyframe Diamond Anchors
      posKfs.forEach(k => {
        const wt = getLayerWorldTransform(id, new Set(), k.time);
        const kDist = Math.max(0.5, (camera3D ? camera3D.position.z : 5) - (wt.posZ / 200));
        const kVisH = 2 * Math.tan(fovRad / 2) * kDist;
        const kPxPerUnit = h / kVisH;
        let kx = w / 2 + (wt.posX / 200) * kPxPerUnit;
        let ky = h / 2 - (wt.posY / 200) * kPxPerUnit;
        const r = 4.8;
        trajSvg += `
          <polygon points="${kx.toFixed(1)},${(ky - r).toFixed(1)} ${(kx + r).toFixed(1)},${ky.toFixed(1)} ${kx.toFixed(1)},${(ky + r).toFixed(1)} ${(kx - r).toFixed(1)},${ky.toFixed(1)}" fill="#38180A" stroke="#FAB778" stroke-width="1.6" />
        `;
      });

      svgContent += trajSvg;
    }
  }

  // 2. Render Outer Wireframe
  if (shapeType === 'line' || shapeType === 'arrow') {
    const sp = getLayerShapeParams(id, shapeType);
    const pts = (sp.points && sp.points.length >= 2) ? sp.points : [{ x: -50, y: 0 }, { x: 50, y: 0 }];
    const activeIdx = sp.selectedPointIdx || 0;

    // Convert local percentage points to screen space
    const screenPts = pts.map(pt => {
      const px = (Number(pt.x) || 0) / 100;
      const py = (Number(pt.y) || 0) / 100;
      const lx = px * (baseDim / 2) * (scaleW / 100);
      const ly = py * (baseDim / 2) * (scaleH / 100);
      const rx = lx * cosZ - ly * sinZ;
      const ry = lx * sinZ + ly * cosZ;
      return {
        x: curX + rx * pxPerUnit,
        y: curY - ry * pxPerUnit
      };
    });

    let linePathD = '';
    screenPts.forEach((spt, idx) => {
      linePathD += (idx === 0 ? `M ${spt.x.toFixed(1)} ${spt.y.toFixed(1)}` : ` L ${spt.x.toFixed(1)} ${spt.y.toFixed(1)}`);
    });

    svgContent += `<path d="${linePathD}" fill="none" stroke="#FAB778" stroke-width="2.5" opacity="0.95" stroke-linecap="round" stroke-linejoin="round" />`;

    // Draggable waypoint handles
    screenPts.forEach((spt, idx) => {
      const isActive = (idx === activeIdx);
      const r = isActive ? 6.5 : 4.5;
      const fillCol = isActive ? '#FFF2C2' : '#FAB778';
      svgContent += `
        <circle cx="${spt.x.toFixed(1)}" cy="${spt.y.toFixed(1)}" r="${r}" fill="${fillCol}" stroke="#4A1D05" stroke-width="1.8" />
      `;
    });
  } else if (shapeType === 'circle') {
    svgContent += `
      <polygon points="${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} ${p4.x.toFixed(1)},${p4.y.toFixed(1)}" fill="none" stroke="#FAB778" stroke-width="1.0" stroke-dasharray="3,3" opacity="0.4" />
      <g transform="rotate(${rotZ} ${curX.toFixed(1)} ${curY.toFixed(1)})">
        <ellipse cx="${curX.toFixed(1)}" cy="${curY.toFixed(1)}" rx="${hw.toFixed(1)}" ry="${hh.toFixed(1)}" fill="none" stroke="#FAB778" stroke-width="1.8" opacity="0.95" />
      </g>
    `;
  } else if (shapeType === 'triangle') {
    const ptTop = { x: curX + hh * sinZ, y: curY - hh * cosZ };
    const ptRight = { x: curX + hw * cosZ - hh * sinZ, y: curY + hw * sinZ + hh * cosZ };
    const ptLeft = { x: curX - hw * cosZ - hh * sinZ, y: curY - hw * sinZ + hh * cosZ };

    svgContent += `
      <polygon points="${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} ${p4.x.toFixed(1)},${p4.y.toFixed(1)}" fill="none" stroke="#FAB778" stroke-width="1.0" stroke-dasharray="3,3" opacity="0.4" />
      <polygon points="${ptTop.x.toFixed(1)},${ptTop.y.toFixed(1)} ${ptRight.x.toFixed(1)},${ptRight.y.toFixed(1)} ${ptLeft.x.toFixed(1)},${ptLeft.y.toFixed(1)}" fill="none" stroke="#FAB778" stroke-width="1.8" opacity="0.95" stroke-linejoin="round" />
      <circle cx="${ptTop.x.toFixed(1)}" cy="${ptTop.y.toFixed(1)}" r="4.2" fill="#FAB778" stroke="#4A1D05" stroke-width="1.5" />
      <circle cx="${ptRight.x.toFixed(1)}" cy="${ptRight.y.toFixed(1)}" r="4.2" fill="#FAB778" stroke="#4A1D05" stroke-width="1.5" />
      <circle cx="${ptLeft.x.toFixed(1)}" cy="${ptLeft.y.toFixed(1)}" r="4.2" fill="#FAB778" stroke="#4A1D05" stroke-width="1.5" />
    `;
  } else if (shapeType === 'camera' || cat === 'camera') {
    // Camera Viewfinder & Frustum Wireframe
    svgContent += `
      <polygon points="${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} ${p4.x.toFixed(1)},${p4.y.toFixed(1)}" fill="none" stroke="#FAB778" stroke-width="2.0" opacity="0.95" stroke-dasharray="6,4" stroke-linejoin="round" />
      <path d="M ${(curX - 12).toFixed(1)} ${(curY - 7).toFixed(1)} L ${(curX + 4).toFixed(1)} ${(curY - 7).toFixed(1)} L ${(curX + 4).toFixed(1)} ${(curY + 7).toFixed(1)} L ${(curX - 12).toFixed(1)} ${(curY + 7).toFixed(1)} Z M ${(curX + 4).toFixed(1)} ${(curY - 3.5).toFixed(1)} L ${(curX + 12).toFixed(1)} ${(curY - 8).toFixed(1)} L ${(curX + 12).toFixed(1)} ${(curY + 8).toFixed(1)} L ${(curX + 4).toFixed(1)} ${(curY + 3.5).toFixed(1)} Z" fill="#FAB778" opacity="0.9" />
    `;
  } else if (shapeType === 'null' || cat === 'null') {
    // Null Object Empty Controller Dashed Wireframe
    svgContent += `
      <polygon points="${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} ${p4.x.toFixed(1)},${p4.y.toFixed(1)}" fill="none" stroke="#FAB778" stroke-width="1.8" opacity="0.9" stroke-dasharray="5,4" stroke-linejoin="round" />
    `;
  } else {
    svgContent += `
      <polygon points="${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} ${p4.x.toFixed(1)},${p4.y.toFixed(1)}" fill="none" stroke="#FAB778" stroke-width="1.8" opacity="0.95" stroke-linejoin="round" />
    `;
  }

  // 3. Outer Corner Handles (Outside the Layer)
  svgContent += `
    <circle cx="${p1.x.toFixed(1)}" cy="${p1.y.toFixed(1)}" r="4.2" fill="#FAB778" stroke="#4A1D05" stroke-width="1.5" />
    <circle cx="${p2.x.toFixed(1)}" cy="${p2.y.toFixed(1)}" r="4.2" fill="#FAB778" stroke="#4A1D05" stroke-width="1.5" />
    <circle cx="${p3.x.toFixed(1)}" cy="${p3.y.toFixed(1)}" r="4.2" fill="#FAB778" stroke="#4A1D05" stroke-width="1.5" />
    <circle cx="${p4.x.toFixed(1)}" cy="${p4.y.toFixed(1)}" r="4.2" fill="#FAB778" stroke="#4A1D05" stroke-width="1.5" />
  `;

  // 4. Outer Midpoint Edge Handles
  svgContent += `
    <rect x="${(pTopMid.x - 3).toFixed(1)}" y="${(pTopMid.y - 3).toFixed(1)}" width="6" height="6" fill="#FFF2C2" stroke="#4A1D05" stroke-width="1.2" />
    <rect x="${(pRightMid.x - 3).toFixed(1)}" y="${(pRightMid.y - 3).toFixed(1)}" width="6" height="6" fill="#FFF2C2" stroke="#4A1D05" stroke-width="1.2" />
    <rect x="${(pBotMid.x - 3).toFixed(1)}" y="${(pBotMid.y - 3).toFixed(1)}" width="6" height="6" fill="#FFF2C2" stroke="#4A1D05" stroke-width="1.2" />
    <rect x="${(pLeftMid.x - 3).toFixed(1)}" y="${(pLeftMid.y - 3).toFixed(1)}" width="6" height="6" fill="#FFF2C2" stroke="#4A1D05" stroke-width="1.2" />
  `;

  // 5. Center Anchor Crosshair
  svgContent += `
    <line x1="${(curX - 8).toFixed(1)}" y1="${curY.toFixed(1)}" x2="${(curX + 8).toFixed(1)}" y2="${curY.toFixed(1)}" stroke="#FAB778" stroke-width="1.6" />
    <line x1="${curX.toFixed(1)}" y1="${(curY - 8).toFixed(1)}" x2="${curX.toFixed(1)}" y2="${(curY + 8).toFixed(1)}" stroke="#FAB778" stroke-width="1.6" />
    <circle cx="${curX.toFixed(1)}" cy="${curY.toFixed(1)}" r="3.8" fill="none" stroke="#FAB778" stroke-width="1.4" />
  `;

  if (svgContent !== _lastOverlaySvg) {
    _lastOverlaySvg = svgContent;
    overlay.innerHTML = svgContent;
  }
}

let activeRotationAxis = 'Z';

function getLayerTransform(id, targetTime = elapsed) {
  if (!layerTransforms.has(id)) {
    layerTransforms.set(id, {
      posX: 0,
      posY: 0,
      posZ: 0,
      rotZ: 0,
      rotX: 0,
      rotY: 0,
      rotationAxis: activeRotationAxis || 'Z',
      scaleW: 100,
      scaleH: 100,
      isLinked: true,
      opacity: 100,
      blendMode: 'NORMAL'
    });
  }

  const base = layerTransforms.get(id);
  if (base.isLinked === undefined) base.isLinked = true;
  const kfs = layerKeyframes.get(id);
  if (!kfs || kfs.length === 0) {
    return base;
  }

  function interpolateChannel(prop, defaultVal) {
    const relevant = kfs.filter(k => k[prop] !== undefined);
    if (relevant.length === 0) return defaultVal;
    if (relevant.length === 1 || targetTime <= relevant[0].time) return relevant[0][prop];
    const last = relevant[relevant.length - 1];
    if (targetTime >= last.time) return last[prop];

    for (let i = 0; i < relevant.length - 1; i++) {
      const k1 = relevant[i];
      const k2 = relevant[i + 1];
      if (targetTime >= k1.time && targetTime <= k2.time) {
        const span = k2.time - k1.time;
        const rawT = span > 0 ? (targetTime - k1.time) / span : 0;
        let channelKey = prop;
        if (prop === 'posX' || prop === 'posY' || prop === 'posZ') channelKey = 'position';
        else if (prop === 'scaleW' || prop === 'scaleH') channelKey = 'scale';

        const easing = k1['easing_' + channelKey] || k1['easing_' + prop] || k1.easing;
        let t = rawT;
        if (easing && easing.cp1x !== undefined) {
          t = solveCubicBezier(easing.cp1x, easing.cp1y, easing.cp2x, easing.cp2y, rawT);
        }
        return k1[prop] + (k2[prop] - k1[prop]) * t;
      }
    }
    return defaultVal;
  }

  return {
    ...base,
    posX: interpolateChannel('posX', base.posX),
    posY: interpolateChannel('posY', base.posY),
    posZ: interpolateChannel('posZ', base.posZ),
    rotX: interpolateChannel('rotX', base.rotX),
    rotY: interpolateChannel('rotY', base.rotY),
    rotZ: interpolateChannel('rotZ', base.rotZ),
    scaleW: interpolateChannel('scaleW', base.scaleW),
    scaleH: interpolateChannel('scaleH', base.scaleH),
    opacity: interpolateChannel('opacity', base.opacity),
    isLinked: base.isLinked,
    rotationAxis: base.rotationAxis || activeRotationAxis || 'Z'
  };
}

function getLayerWorldTransform(id, visited = new Set(), targetTime = elapsed) {
  const t = getLayerTransform(id, targetTime);
  if (!id || visited.has(id)) return { ...t };
  visited.add(id);

  const row = document.querySelector(`.track-row[data-layer-id="${id}"]`);
  let parentId = null;
  let bindPose = null;

  if (row && row.dataset.linkedTo) {
    try {
      const parsed = JSON.parse(row.dataset.linkedTo);
      if (parsed && parsed.length > 0) parentId = parsed[0];
    } catch (_) {}
  }

  if (row && row.dataset.parentBind) {
    try {
      bindPose = JSON.parse(row.dataset.parentBind);
    } catch (_) {}
  }

  if (parentId && parentId !== id && layerTransforms.has(parentId)) {
    const pt = getLayerWorldTransform(parentId, visited, targetTime);

    const bp = bindPose || {
      posX: pt.posX,
      posY: pt.posY,
      posZ: pt.posZ,
      rotX: pt.rotX,
      rotY: pt.rotY,
      rotZ: pt.rotZ,
      scaleW: pt.scaleW,
      scaleH: pt.scaleH
    };

    const deltaRotZ = (pt.rotZ - bp.rotZ);
    const rad = (deltaRotZ * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const scaleFactorX = bp.scaleW > 0 ? (pt.scaleW / bp.scaleW) : 1;
    const scaleFactorY = bp.scaleH > 0 ? (pt.scaleH / bp.scaleH) : 1;

    const relX = (t.posX - bp.posX);
    const relY = (t.posY - bp.posY);

    const orbitedX = (relX * cos - relY * sin) * scaleFactorX;
    const orbitedY = (relX * sin + relY * cos) * scaleFactorY;

    return {
      posX: pt.posX + orbitedX,
      posY: pt.posY + orbitedY,
      posZ: t.posZ + (pt.posZ - bp.posZ),
      rotX: t.rotX + (pt.rotX - bp.rotX),
      rotY: t.rotY + (pt.rotY - bp.rotY),
      rotZ: t.rotZ + deltaRotZ,
      scaleW: t.scaleW * scaleFactorX,
      scaleH: t.scaleH * scaleFactorY,
      opacity: Math.max(0, Math.min(100, t.opacity * (pt.opacity / 100))),
      isLinked: t.isLinked,
      rotationAxis: t.rotationAxis
    };
  }

  return { ...t };
}

function syncControllerUI() {
  if (!selectedTrackRow) return;
  const id = selectedTrackRow.dataset.layerId || 'default';
  const t = getLayerTransform(id);

  const valPosX = document.getElementById('val-pos-x');
  const valPosY = document.getElementById('val-pos-y');
  const valPosZ = document.getElementById('val-pos-z');
  if (valPosX) valPosX.textContent = Number(t.posX).toFixed(2);
  if (valPosY) valPosY.textContent = Number(-t.posY).toFixed(2);
  if (valPosZ) valPosZ.textContent = Number(t.posZ).toFixed(2);

  updateInfiniteRuler('z-ruler', -t.posZ);

  renderDialRotation(t);

  const valScaleW = document.getElementById('val-scale-w');
  const valScaleH = document.getElementById('val-scale-h');
  if (valScaleW) valScaleW.textContent = Number(t.scaleW).toFixed(1);
  if (valScaleH) valScaleH.textContent = Number(t.scaleH).toFixed(1);

  updateInfiniteRuler('ruler-w', (t.scaleW - 100) * 2);
  updateInfiniteRuler('ruler-h', (t.scaleH - 100) * 2);

  const linkBtn = document.getElementById('btn-link');
  const wheelH = document.getElementById('wheel-h');
  const wheelArea = document.querySelector('.controller-wheel-area');
  if (linkBtn) linkBtn.classList.toggle('linked', t.isLinked);
  if (wheelH) wheelH.style.display = t.isLinked ? 'none' : 'flex';
  if (wheelArea) wheelArea.classList.toggle('linked-mode', !!t.isLinked);

  const opacitySlider = document.getElementById('opacity-slider');
  const valOpacity = document.getElementById('val-opacity');
  if (opacitySlider) {
    opacitySlider.value = t.opacity;
    opacitySlider.style.background = `linear-gradient(to right, #FAB778 ${t.opacity}%, rgba(0, 0, 0, 0.3) ${t.opacity}%)`;
  }
  if (valOpacity) valOpacity.textContent = `${Math.round(t.opacity)}%`;

  document.querySelectorAll('.controller-blend-item').forEach(item => {
    item.classList.toggle('is-selected', item.dataset.mode === t.blendMode);
  });

  updateKeyframeUI();
  requestAllKeyframeMarkersRender();
  applyTransformToThreeMesh(id, t);
  requestCanvasOverlayRender();
  render3D();
}

let _overlayRaf = null;
function requestCanvasOverlayRender() {
  if (_overlayRaf) return;
  _overlayRaf = requestAnimationFrame(() => {
    _overlayRaf = null;
    renderCanvasOverlay();
  });
}

let _kfMarkersRaf = null;
function requestAllKeyframeMarkersRender() {
  if (_kfMarkersRaf) return;
  _kfMarkersRaf = requestAnimationFrame(() => {
    _kfMarkersRaf = null;
    renderAllKeyframeMarkers();
  });
}

function applyTransformToThreeMesh(id, t) {
  const mesh = meshLayerMap.get(id);
  if (!mesh) return;

  const rows = document.querySelectorAll('.track-row');
  let idx = -1;
  rows.forEach((r, i) => { if (r.dataset.layerId === id) idx = i; });
  const order = idx >= 0 ? (rows.length - idx) : 0;
  const zEpsilon = order * 0.0001;

  const wt = getLayerWorldTransform(id);

  mesh.renderOrder = 0;
  mesh.position.x = wt.posX / 200;
  mesh.position.y = wt.posY / 200;
  mesh.position.z = wt.posZ / 200 + zEpsilon;

  mesh.rotation.z = -(wt.rotZ * Math.PI) / 180;
  mesh.rotation.x = (wt.rotX * Math.PI) / 180;
  mesh.rotation.y = (wt.rotY * Math.PI) / 180;

  const fill = getLayerFill(id);
  const clipName = rows[idx]?.querySelector('.track-clip-name')?.textContent.trim() || '';
  const cat = rows[idx]?.dataset.category || 'media';
  const isVideoOrMedia = (cat === 'media' || cat === 'video' || (fill && fill.type === 'media') || (clipName && /\.(mp4|webm|mov|mkv|png|jpg|jpeg|webp)$/i.test(clipName)) || videoFrameSequenceMap.has(fill?.mediaUrl) || videoFrameSequenceMap.has(id) || videoFrameSequenceMap.has(clipName));

  let geomW = 4.0;
  let geomH = 4.0;

  if (isVideoOrMedia) {
    const aspect = getMediaAspectRatio(id, fill ? fill.mediaUrl : null);
    if (aspect >= 1) {
      geomW = 4.0;
      geomH = 4.0 / aspect;
    } else {
      geomW = 4.0 * aspect;
      geomH = 4.0;
    }
  }

  mesh.scale.x = ((wt.scaleW !== undefined ? wt.scaleW : 100) / 100) * (geomW / 4.0);
  mesh.scale.y = ((wt.scaleH !== undefined ? wt.scaleH : 100) / 100) * (geomH / 4.0);

  if (mesh.material) {
    const fill = layerFills.get(id);
    let fillAlpha = 1;
    if (fill && fill.type === 'color') {
      const parsed = parseHexOrRgb(fill.color || '#FAB778');
      fillAlpha = (fill.alpha !== undefined) ? fill.alpha : (parsed.a !== undefined ? parsed.a : 1);
    }
    mesh.material.transparent = true;
    mesh.material.depthTest = true;
    mesh.material.depthWrite = true;
    mesh.material.alphaTest = 0.02;
    mesh.material.side = THREE.DoubleSide;
    mesh.material.opacity = Math.max(0, Math.min(1, (wt.opacity / 100) * fillAlpha));
  }

  // Also propagate update to any child layers parented to this layer
  rows.forEach(cr => {
    if (cr.dataset.layerId !== id && cr.dataset.linkedTo) {
      try {
        const pArr = JSON.parse(cr.dataset.linkedTo);
        if (pArr && pArr.includes(id)) {
          const childId = cr.dataset.layerId;
          const childMesh = meshLayerMap.get(childId);
          if (childMesh) {
            const childWt = getLayerWorldTransform(childId);
            const cOrder = rows.length - Array.from(rows).indexOf(cr);
            const cZ = cOrder * 0.0001;

            childMesh.position.set(childWt.posX / 200, childWt.posY / 200, childWt.posZ / 200 + cZ);
            childMesh.rotation.set(
              (childWt.rotX * Math.PI) / 180,
              (childWt.rotY * Math.PI) / 180,
              -(childWt.rotZ * Math.PI) / 180
            );
            childMesh.scale.set(
              (childWt.scaleW !== undefined ? childWt.scaleW : 100) / 100,
              (childWt.scaleH !== undefined ? childWt.scaleH : 100) / 100,
              1
            );
          }
        }
      } catch (_) {}
    }
  });
}

let globalRotationDialInstance = null;

function renderDialRotation(t) {
  const axis = (t && t.rotationAxis) || activeRotationAxis || 'Z';
  activeRotationAxis = axis;
  const curRot = axis === 'X' ? t.rotX : (axis === 'Y' ? t.rotY : t.rotZ);

  if (globalRotationDialInstance) {
    globalRotationDialInstance.setValue(curRot);
  } else {
    // Fallback if FishUI instance is still initializing
    const valRot = document.getElementById('val-rot');
    const rotMult = document.getElementById('rot-multiplier');
    const knob = document.getElementById('dial-knob');
    const trail = document.getElementById('dial-trail-path');
    const trailOverlay = document.getElementById('dial-trail-overlay-path');

    const absDeg = Math.abs(curRot);
    const turns = Math.floor(absDeg / 360);
    const remainder = absDeg % 360;
    const sign = curRot < 0 ? '-' : '+';

    if (rotMult) {
      if (turns > 0) {
        rotMult.textContent = `${turns}×`;
        rotMult.style.display = 'block';
      } else {
        rotMult.textContent = '';
        rotMult.style.display = 'none';
      }
    }

    if (valRot) {
      const dispDeg = turns > 0 ? Math.round(remainder) : Math.round(absDeg);
      valRot.textContent = `${sign}${dispDeg}°`;
    }

    const dialEl = document.getElementById('dial-area');
    const w = dialEl && dialEl.clientWidth > 0 ? dialEl.clientWidth : 116;
    const h = dialEl && dialEl.clientHeight > 0 ? dialEl.clientHeight : 116;
    const cx = w / 2;
    const cy = h / 2;
    const trackRadius = (75 / 180) * w;
    const radius = trackRadius;

    const rad = ((curRot - 90) * Math.PI) / 180;
    const kx = cx + trackRadius * Math.cos(rad);
    const ky = cy + trackRadius * Math.sin(rad);

    if (knob) {
      knob.style.left = `${kx}px`;
      knob.style.top = `${ky}px`;
      knob.style.transform = 'translate(-50%, -50%)';
    }

    const fullCirclePath = `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius}`;
    const startX = cx;
    const startY = cy - radius;

    if (trail) {
      if (absDeg < 0.5) {
        trail.setAttribute('d', '');
      } else if (absDeg >= 360) {
        trail.setAttribute('d', fullCirclePath);
      } else {
        const sweep = curRot > 0 ? 1 : 0;
        const endRad = ((curRot - 90) * Math.PI) / 180;
        const endX = cx + radius * Math.cos(endRad);
        const endY = cy + radius * Math.sin(endRad);
        const largeArc = absDeg > 180 ? 1 : 0;
        trail.setAttribute('d', `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${endX} ${endY}`);
      }
    }

    if (trailOverlay) {
      trailOverlay.setAttribute('d', '');
    }
  }

  document.querySelectorAll('#rotation-axis-switch button').forEach(b => {
    b.classList.toggle('active', (b.dataset.rotationAxis || 'Z') === axis);
  });
}

const BLEND_MODES = [
  'NORMAL', 'DARKEN', 'MULTIPLY', 'COLOR_BURN', 'LIGHTEN', 'SCREEN',
  'COLOR_DODGE', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT', 'DIFFERENCE', 'EXCLUSION'
];

function initBlendList() {
  const list = document.getElementById('blend-list');
  if (!list) return;
  list.innerHTML = '';
  BLEND_MODES.forEach(mode => {
    const item = document.createElement('div');
    item.className = 'controller-blend-item' + (mode === 'NORMAL' ? ' is-selected' : '');
    item.dataset.mode = mode;
    item.innerHTML = `
      <span>${mode.replace(/_/g, ' ')}</span>
      <span class="material-symbols-rounded">check</span>
    `;
    item.addEventListener('click', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const t = getLayerTransform(id);
      t.blendMode = mode;
      document.querySelectorAll('.controller-blend-item').forEach(i => i.classList.remove('is-selected'));
      item.classList.add('is-selected');
    });
    list.appendChild(item);
  });
}

function initMovePad() {
  const pad = document.getElementById('move-pad');
  if (!pad) return;

  if (window.FishUI && window.FishUI.createMovePad) {
    window.FishUI.createMovePad({
      container: pad,
      sensitivityX: 2.0,
      sensitivityY: 2.0,
      invertY: true,
      onMove: ({ dx, dy }) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const t = getLayerTransform(id);
        t.posX = Math.round(t.posX + dx);
        t.posY = Math.round(t.posY + dy);
        recordTransformChange(id, t);
        syncControllerUI();
      }
    });
  }
}

function initZWheel() {
  // Driven smoothly and hardware-accelerated via FishUI.createRuler on #z-ruler
}

function initRotationDial() {
  const dial = document.getElementById('dial-area');
  if (!dial) return;

  if (window.FishUI && window.FishUI.createRotationDial) {
    globalRotationDialInstance = window.FishUI.createRotationDial({
      container: dial,
      knob: document.getElementById('dial-knob'),
      trail: document.getElementById('dial-trail-path'),
      trailOverlay: document.getElementById('dial-trail-overlay-path'),
      valLabel: document.getElementById('val-rot'),
      multiplierLabel: document.getElementById('rot-multiplier'),
      onChange: (newRot) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const t = getLayerTransform(id);
        if (activeRotationAxis === 'X') t.rotX = newRot;
        else if (activeRotationAxis === 'Y') t.rotY = newRot;
        else t.rotZ = newRot;
        recordTransformChange(id, t);
        syncControllerUI();
      }
    });
  }

  document.querySelectorAll('#rotation-axis-switch button').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const axis = b.dataset.rotationAxis || 'Z';
      activeRotationAxis = axis;
      if (selectedTrackRow) {
        const id = selectedTrackRow.dataset.layerId || 'default';
        if (!layerTransforms.has(id)) {
          getLayerTransform(id);
        }
        const base = layerTransforms.get(id);
        if (base) base.rotationAxis = axis;
      }
      document.querySelectorAll('#rotation-axis-switch button').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.rotationAxis || 'Z') === axis);
      });
      syncControllerUI();
    });
  });
}

function initScaleWheels() {
  const linkBtn = document.getElementById('btn-link');
  if (linkBtn) {
    linkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      if (!layerTransforms.has(id)) {
        getLayerTransform(id);
      }
      const base = layerTransforms.get(id);
      if (base) {
        base.isLinked = !base.isLinked;
      }
      const t = getLayerTransform(id);
      if (base) {
        t.isLinked = base.isLinked;
      }
      recordTransformChange(id, t);
      syncControllerUI();
    });
  }
}

let globalOpacitySliderInstance = null;

function initOpacityControl() {
  const slider = document.getElementById('opacity-slider');
  if (!slider) return;

  if (window.FishUI && window.FishUI.createSlider) {
    globalOpacitySliderInstance = window.FishUI.createSlider({
      input: slider,
      valLabel: document.getElementById('val-opacity'),
      unit: '%',
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const t = getLayerTransform(id);
        t.opacity = val;
        recordTransformChange(id, t);
        syncControllerUI();
      }
    });
  } else {
    slider.addEventListener('input', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const t = getLayerTransform(id);
      t.opacity = parseFloat(slider.value) || 0;
      recordTransformChange(id, t);
      syncControllerUI();
    });
  }
}

function openInspectorSubpanel(subpanelEl, subpanelClass, onBeforeShow) {
  const drawer = document.getElementById('layerInspectorDrawer');
  const toolsGrid = document.querySelector('.inspector-tools-grid');
  const quickStrip = document.querySelector('.inspector-quick-strip');
  if (!drawer || !subpanelEl) return;

  drawer.classList.remove('subpanel-color', 'subpanel-border-shadow', 'subpanel-move', 'subpanel-graph', 'subpanel-shape');
  if (subpanelClass) drawer.classList.add('subpanel-open', subpanelClass);

  if (quickStrip) quickStrip.style.display = 'none';
  if (toolsGrid) toolsGrid.style.display = 'none';

  document.querySelectorAll('.inspector-subpanel').forEach(p => {
    if (p !== subpanelEl) p.style.display = 'none';
  });

  subpanelEl.style.display = 'flex';
  if (onBeforeShow) onBeforeShow();
}

function closeInspectorSubpanel(subpanelEl, onAfterClose) {
  const drawer = document.getElementById('layerInspectorDrawer');
  const toolsGrid = document.querySelector('.inspector-tools-grid');
  const quickStrip = document.querySelector('.inspector-quick-strip');
  if (!drawer) return;

  drawer.classList.remove('subpanel-open', 'subpanel-color', 'subpanel-move', 'subpanel-border-shadow', 'subpanel-graph', 'subpanel-shape', 'in-subpanel');

  if (subpanelEl) subpanelEl.style.display = 'none';
  document.querySelectorAll('.inspector-subpanel').forEach(p => {
    p.style.display = 'none';
  });

  if (quickStrip) quickStrip.style.display = 'flex';
  if (toolsGrid) toolsGrid.style.display = 'grid';

  if (onAfterClose) onAfterClose();
}

function initMoveTransformController() {
  initInfiniteRuler('z-ruler', true);
  initInfiniteRuler('ruler-w', false);
  initInfiniteRuler('ruler-h', false);
  initBlendList();
  initMovePad();
  initZWheel();
  initRotationDial();
  initScaleWheels();
  initOpacityControl();

  // Fish Top Tabs API — single style source (edit .fish-top-tabs / --fish-tab-* → global)
  if (window.FishUI && window.FishUI.createTopTabs) {
    window.FishUI.createTopTabs({
      container: '.controller-tab-switch',
      onSwitch: (targetPanel) => {
        activeControllerPanel = targetPanel || 'move';
        document.querySelectorAll('.controller-panel').forEach(p => {
          p.style.display = 'none';
          p.classList.remove('active');
        });
        const activeP = document.getElementById(`card-${targetPanel}`);
        if (activeP) {
          activeP.style.display = 'flex';
          activeP.classList.add('active');
        }
        updateKeyframeUI();
        renderAllKeyframeMarkers();
      }
    });
  } else {
    const switchBtns = document.querySelectorAll('.controller-tab-switch .controller-switch-btn');
    switchBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetPanel = btn.dataset.targetPanel || 'move';
        activeControllerPanel = targetPanel;
        switchBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.controller-panel').forEach(p => {
          p.style.display = 'none';
          p.classList.remove('active');
        });
        const activeP = document.getElementById(`card-${targetPanel}`);
        if (activeP) {
          activeP.style.display = 'flex';
          activeP.classList.add('active');
        }
        updateKeyframeUI();
        renderAllKeyframeMarkers();
      });
    });
  }

  const btnInspMove = document.getElementById('btnInspMoveTransform');
  const btnBackTools = document.getElementById('btnBackToToolsGrid');
  const toolsGrid = document.querySelector('.inspector-tools-grid');
  const quickStrip = document.querySelector('.inspector-quick-strip');
  const panelMove = document.getElementById('panelMoveTransform');

  // Modular Keyframe Controller via FishUI
  if (window.FishUI && window.FishUI.createKeyframeController) {
    globalMoveTransformKfController = window.FishUI.createKeyframeController({
      toggleButton: '#btnToggleKeyframe',
      graphButton: '#btnKeyframeGraph',
      getChannel: () => getActiveKeyframeChannel() || 'position',
      getLayerId: () => selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default',
      getCurrentTime: () => elapsed,
      getKeyframes: (layerId) => layerKeyframes.get(layerId) || [],
      getCurrentValue: (layerId, ch) => getLayerTransform(layerId),
      onToggle: () => {
        toggleKeyframe();
      },
      onOpenGraph: ({ channel }) => {
        openGraphEditor(channel || getActiveKeyframeChannel() || 'position');
      }
    });
  } else {
    const btnToggleKf = document.getElementById('btnToggleKeyframe');
    if (btnToggleKf) {
      btnToggleKf.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleKeyframe();
      });
    }
  }

  if (btnInspMove && toolsGrid && panelMove) {
    btnInspMove.addEventListener('click', (e) => {
      e.stopPropagation();
      openInspectorSubpanel(panelMove, 'subpanel-move', () => {
        syncControllerUI();
        renderAllKeyframeMarkers();
        updateKeyframeUI();
      });
    });
  }

  if (btnBackTools && toolsGrid && panelMove) {
    btnBackTools.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInspectorSubpanel(panelMove, () => {
        renderAllKeyframeMarkers();
        updateKeyframeUI();
      });
    });
  }

  // Color & Fill panel toggle
  const btnInspColor = document.getElementById('btnInspColorFill');
  const panelColor = document.getElementById('panelColorFill');
  const btnBackColor = document.getElementById('btnBackFromColorFill');
  if (btnInspColor && toolsGrid && panelColor) {
    btnInspColor.addEventListener('click', (e) => {
      e.stopPropagation();
      openInspectorSubpanel(panelColor, 'subpanel-color', () => {
        // Sync UI with current layer fill
        const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
        const fill = getLayerFill(id);
        if (fill.type === 'gradient') {
          switchFillTab('gradient');
          if (fill.gradientType) activeGradientType = fill.gradientType;
          if (fill.gradientStops && fill.gradientStops.length) {
            gradientStops = fill.gradientStops.map(s => ({ offset: s.offset, color: s.color }));
          }
          updateGradientTypeUI();
          renderGradient();
        } else if (fill.type === 'media') {
          switchFillTab('media');
        } else {
          switchFillTab('color');
          const col = fill.color || '#FAB778';
          if (fillPreview) fillPreview.style.background = col;
          if (inputFillColor) inputFillColor.value = col;
        }
      });
    });
  }
  if (btnBackColor && toolsGrid && panelColor) {
    btnBackColor.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInspectorSubpanel(panelColor);
    });
  }
  // Fill actions — via Fish Top Tabs API (global style)
  const fillTabColor = document.getElementById('fillTabColor');
  const fillTabMedia = document.getElementById('fillTabMedia');
  const fillTabGradient = document.getElementById('fillTabGradient');
  function switchFillTab(name) {
    // API handles active class, manual fallback if needed
    document.querySelectorAll('#colorFillTabs [data-fill-tab]').forEach(b => b.classList.toggle('active', b.dataset.fillTab === name));
    if (fillTabColor) fillTabColor.style.display = name === 'color' ? 'flex' : 'none';
    if (fillTabMedia) fillTabMedia.style.display = name === 'media' ? 'flex' : 'none';
    if (fillTabGradient) fillTabGradient.style.display = name === 'gradient' ? 'flex' : 'none';
  }
  if (window.FishUI && window.FishUI.createTopTabs) {
    window.FishUI.createTopTabs({
      container: '#colorFillTabs',
      onSwitch: (tabId) => switchFillTab(tabId)
    });
  } else {
    document.querySelectorAll('#colorFillTabs [data-fill-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        switchFillTab(btn.dataset.fillTab);
      });
    });
  }
  // Color grid
  const colorGrid = document.getElementById('fillColorGrid');
  const inputFillColor = document.getElementById('inputFillColor');
  const fillPreview = document.getElementById('fillColorPreview');
  const paletteColors = ['#FAB778','#FFF2C2','#000000','#FFFFFF','#EB5757','#27AE60','#2D9CDB','#BB6BD9','#F2994A','#F2C94C','#9E4310','#D06423','#541F05','#732D06','#FF8A65','#FFCC80','#FFE0B2','#B0BEC5','#90A4AE','#6D4C41','#E91E63','#00BCD4','#4CAF50','#FFEB3B'];
  function applyFillColor(col, alpha) {
    if (fillPreview) fillPreview.style.background = col;
    if (inputFillColor) inputFillColor.value = col;
    if (selectedTrackRow) {
      const id = selectedTrackRow.dataset.layerId || 'default';
      const fill = getLayerFill(id);
      fill.type = 'color';
      fill.color = col;
      if (alpha !== undefined) fill.alpha = alpha;
      fill.mediaUrl = null;
      applyFillToMeshGlobal(id);
      triggerAutoSave();
    }
  }
  if (colorGrid) {
    colorGrid.innerHTML = '';
    paletteColors.forEach(col => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fill-color-swatch-btn';
      b.style.cssText = 'width:100%; aspect-ratio:1; border-radius:5px; border:1px solid rgba(255,242,194,0.22); cursor:pointer; background:' + col + '; padding:0; margin:0;';
      b.title = col;
      b.addEventListener('click', () => applyFillColor(col, 1));
      colorGrid.appendChild(b);
    });
  }
  const btnCustomFillColor = document.getElementById('btnCustomFillColor');
  if (btnCustomFillColor) {
    btnCustomFillColor.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
      const fill = getLayerFill(id);
      const curCol = fill.type === 'color' ? (fill.color || '#FAB778') : '#FAB778';
      const curAlpha = fill.type === 'color' && fill.alpha !== undefined ? fill.alpha : 1;
      if (window.openGlobalColorPicker) {
        window.openGlobalColorPicker({
          color: curCol,
          alpha: curAlpha,
          anchorElement: btnCustomFillColor,
          onChange: (res) => {
            applyFillColor(res.hex, res.alpha !== undefined ? res.alpha : 1);
          }
        });
      } else if (inputFillColor) {
        inputFillColor.click();
      }
    });
  }
  if (inputFillColor) {
    inputFillColor.addEventListener('input', () => applyFillColor(inputFillColor.value));
  }
  // Global Media Library & Pool functions are defined at top-level scope

  // Hook to window
  window.getGlobalMediaLibrary = getGlobalMediaLibrary;
  window.addGlobalMedia = addGlobalMedia;
  window.removeGlobalMedia = removeGlobalMedia;
  window.syncAllMediaGrids = syncAllMediaGrids;
  window.createMediaThumbnailElement = createMediaThumbnailElement;

  const btnUploadMedia = document.getElementById('btnUploadMedia');
  const inputFillMedia = document.getElementById('inputFillMedia');

  if (btnUploadMedia && inputFillMedia) {
    btnUploadMedia.addEventListener('click', () => inputFillMedia.click());
    inputFillMedia.addEventListener('change', () => {
      const file = inputFillMedia.files && inputFillMedia.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          addGlobalMedia(dataUrl, file.name, file.type);
          if (selectedTrackRow) {
            const id = selectedTrackRow.dataset.layerId || 'default';
            const fill = getLayerFill(id);
            fill.type = 'media';
            fill.mediaUrl = dataUrl;
            fill.color = null;
            fill.gradientType = null;
            const mesh = meshLayerMap.get(id);
            if (mesh) {
              new THREE.TextureLoader().load(dataUrl, (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                mesh.material.map = tex;
                mesh.material.color = new THREE.Color('#FFFFFF');
                mesh.material.needsUpdate = true;
                render3D();
              });
            }
            triggerAutoSave();
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  syncAllMediaGrids();

  // ----------------------------------------------------
  // Gradient Advanced Panel (Alight Motion Inspired UI)
  // ----------------------------------------------------
  const gradientBar = document.getElementById('gradientBar');
  const gradientStopsEl = document.getElementById('gradientStops');
  const btnAddStop = document.getElementById('btnAddGradientStop');
  const btnRemoveStop = document.getElementById('btnRemoveGradientStop');
  const btnEditStopColor = document.getElementById('btnEditGradientStopColor');
  const gradientStopColorChip = document.getElementById('gradientStopColorChip');
  const lblGradientStopColor = document.getElementById('lblGradientStopColor');
  const gradientTypeButtons = document.querySelectorAll('#gradientTypeBar .gradient-type-btn');

  let activeGradientType = 'linear';
  let gradientStops = [
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#FFFFFF' }
  ];
  let selectedStopIdx = 0;

  function updateGradientTypeUI() {
    gradientTypeButtons.forEach(btn => {
      if (btn.getAttribute('data-type') === activeGradientType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  gradientTypeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      if (type) {
        activeGradientType = type;
        updateGradientTypeUI();
        renderGradient();
        applyGradient();
      }
    });
  });

  function renderGradient() {
    gradientStops.sort((a,b) => a.offset - b.offset);
    if (selectedStopIdx >= gradientStops.length) {
      selectedStopIdx = gradientStops.length - 1;
    }
    if (selectedStopIdx < 0) selectedStopIdx = 0;

    // Build CSS Gradient string for track with transparent checkerboard support
    const stopsCss = gradientStops.map(s => {
      let col = s.color;
      if (s.alpha !== undefined && s.alpha < 1) {
        const p = parseHexOrRgb(col);
        col = `rgba(${p.r}, ${p.g}, ${p.b}, ${s.alpha})`;
      }
      return col + ' ' + (s.offset * 100).toFixed(1) + '%';
    }).join(', ');

    let trackCss = 'linear-gradient(90deg, ' + stopsCss + '), repeating-conic-gradient(#4A1D05 0% 25%, #732D06 0% 50%) 50% / 10px 10px';
    if (gradientBar) {
      gradientBar.style.background = trackCss;
    }

    // Render Custom Stop Handles
    if (gradientStopsEl) {
      gradientStopsEl.innerHTML = '';
      gradientStops.forEach((s, idx) => {
        const handle = document.createElement('div');
        handle.className = 'gradient-stop-handle' + (idx === selectedStopIdx ? ' selected' : '');
        handle.style.left = (s.offset * 100) + '%';
        handle.title = `Stop ${idx + 1}: ${s.color} (${Math.round(s.offset * 100)}%)`;

        const shape = document.createElement('div');
        shape.className = 'gradient-stop-shape';
        let shapeBg = s.color;
        if (s.alpha !== undefined && s.alpha < 1) {
          const p = parseHexOrRgb(s.color);
          shapeBg = `linear-gradient(rgba(${p.r},${p.g},${p.b},${s.alpha}), rgba(${p.r},${p.g},${p.b},${s.alpha})), repeating-conic-gradient(#4A1D05 0% 25%, #732D06 0% 50%) 50% / 8px 8px`;
        }
        shape.style.background = shapeBg;

        handle.appendChild(shape);

        // Click / select handle
        handle.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedStopIdx = idx;
          renderGradient();
          const targetEl = (gradientStopsEl && gradientStopsEl.children[selectedStopIdx]) || handle;
          openStopColorPicker(targetEl);
        });

        // Double click to open color picker
        handle.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          selectedStopIdx = idx;
          renderGradient();
          const targetEl = (gradientStopsEl && gradientStopsEl.children[selectedStopIdx]) || handle;
          openStopColorPicker(targetEl);
        });

        // Drag handle
        let dragging = false;
        const onDown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          dragging = true;
          selectedStopIdx = idx;
          const rect = gradientBar.getBoundingClientRect();

          const onMove = (me) => {
            const clientX = me.touches ? me.touches[0].clientX : me.clientX;
            let off = (clientX - rect.left) / rect.width;
            off = Math.max(0, Math.min(1, off));
            s.offset = Math.round(off * 100) / 100;
            renderGradient();
            applyGradient();
          };

          const onUp = () => {
            dragging = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
          window.addEventListener('touchmove', onMove, { passive: false });
          window.addEventListener('touchend', onUp);
        };

        handle.addEventListener('mousedown', onDown);
        handle.addEventListener('touchstart', onDown, { passive: false });

        gradientStopsEl.appendChild(handle);
      });
    }

    if (btnRemoveStop) {
      btnRemoveStop.disabled = gradientStops.length <= 2;
    }
  }

  function openStopColorPicker(anchorEl) {
    const curStop = gradientStops[selectedStopIdx];
    if (!curStop) return;

    const targetAnchor = anchorEl || (gradientStopsEl && gradientStopsEl.children[selectedStopIdx]) || gradientBar;

    if (window.openGlobalColorPicker) {
      const parsed = parseHexOrRgb(curStop.color);
      const alphaVal = curStop.alpha !== undefined ? curStop.alpha : (parsed.a !== undefined ? parsed.a : 1);
      window.openGlobalColorPicker({
        color: curStop.color,
        alpha: alphaVal,
        anchorElement: targetAnchor,
        onChange: (res) => {
          if (gradientStops[selectedStopIdx]) {
            gradientStops[selectedStopIdx].color = res.rgba || res.hex;
            gradientStops[selectedStopIdx].alpha = res.alpha !== undefined ? res.alpha : 1;
            renderGradient();
            applyGradient();
          }
        }
      });
    }
  }

  function applyGradient() {
    if (!selectedTrackRow) return;
    const id = selectedTrackRow.dataset.layerId || 'default';
    const fill = getLayerFill(id);
    fill.type = 'gradient';
    fill.gradientType = activeGradientType;
    fill.gradientStops = gradientStops.map(s => ({ offset: s.offset, color: s.color }));
    fill.color = null;
    fill.mediaUrl = null;

    applyFillToMeshGlobal(id);
    triggerAutoSave();
  }

  // Click on empty gradient bar to insert a new stop
  if (gradientBar) {
    gradientBar.addEventListener('click', (e) => {
      if (e.target !== gradientBar && e.target !== gradientStopsEl) return;
      const rect = gradientBar.getBoundingClientRect();
      let off = (e.clientX - rect.left) / rect.width;
      off = Math.max(0, Math.min(1, Math.round(off * 100) / 100));

      const curColor = gradientStops[selectedStopIdx] ? gradientStops[selectedStopIdx].color : '#FFFFFF';
      gradientStops.push({ offset: off, color: curColor });
      selectedStopIdx = gradientStops.length - 1;
      renderGradient();
      applyGradient();
    });
  }

  // Add Stop button
  if (btnAddStop) {
    btnAddStop.addEventListener('click', (e) => {
      e.stopPropagation();
      let off = 0.5;
      if (gradientStops.length >= 2) {
        let maxGap = 0, gapMid = 0.5;
        const sorted = [...gradientStops].sort((a,b) => a.offset - b.offset);
        for (let i = 0; i < sorted.length - 1; i++) {
          const gap = sorted[i+1].offset - sorted[i].offset;
          if (gap > maxGap) {
            maxGap = gap;
            gapMid = (sorted[i].offset + sorted[i+1].offset) / 2;
          }
        }
        off = Math.round(gapMid * 100) / 100;
      }
      const curColor = gradientStops[selectedStopIdx] ? gradientStops[selectedStopIdx].color : '#FAB778';
      gradientStops.push({ offset: off, color: curColor });
      selectedStopIdx = gradientStops.length - 1;
      renderGradient();
      applyGradient();
    });
  }

  // Remove Stop button
  if (btnRemoveStop) {
    btnRemoveStop.addEventListener('click', (e) => {
      e.stopPropagation();
      if (gradientStops.length <= 2) return;
      gradientStops.splice(selectedStopIdx, 1);
      selectedStopIdx = Math.max(0, Math.min(selectedStopIdx, gradientStops.length - 1));
      renderGradient();
      applyGradient();
    });
  }

  // Init gradient panel state
  updateGradientTypeUI();
  renderGradient();

  // Modular Graph Editor via FishUI
  if (window.FishUI && window.FishUI.createGraphEditor) {
    globalGraphEditor = window.FishUI.createGraphEditor({
      canvas: '#graphEditorCanvas',
      container: '#panelGraphEditor',
      toggleGridButton: '#btnToggleGrid',
      toggleOvershootButton: '#btnToggleOvershoot',
      libraryButton: '#btnGraphLibrary',
      saveLibraryButton: '#btnSaveToLibrary',
      closeLibraryButton: '#btnCloseGraphLibrary',
      libraryOverlay: '#graphLibraryOverlay',
      libraryList: '#graphLibraryList',
      backButton: '#btnBackFromGraph',
      onCurveChange: ({ cp1, cp2, isOvershoot }) => {
        graphEditorState.cp1 = { ...cp1 };
        graphEditorState.cp2 = { ...cp2 };
        graphEditorState.isOvershoot = isOvershoot;
        graphEditorState.dirty = true;
        applyGraphEasingToKeyframe();
      },
      onClose: () => {
        closeGraphEditor(false);
      }
    });
  } else {
    const btnKfGraph = document.getElementById('btnKeyframeGraph');
    if (btnKfGraph) {
      btnKfGraph.addEventListener('click', (e) => {
        e.stopPropagation();
        const channel = getActiveKeyframeChannel() || 'position';
        openGraphEditor(channel);
      });
    }

    const btnBackFromGraph = document.getElementById('btnBackFromGraph');
    if (btnBackFromGraph) {
      btnBackFromGraph.addEventListener('click', (e) => {
        e.stopPropagation();
        closeGraphEditor(false);
      });
    }

    const btnGraphLibrary = document.getElementById('btnGraphLibrary');
    if (btnGraphLibrary) {
      btnGraphLibrary.addEventListener('click', (e) => {
        e.stopPropagation();
        openGraphLibrary();
      });
    }

    const btnToggleGrid = document.getElementById('btnToggleGrid');
    if (btnToggleGrid) {
      btnToggleGrid.addEventListener('click', (e) => {
        e.stopPropagation();
        graphEditorState.showGrid = !graphEditorState.showGrid;
        updateGraphButtonsUI();
        renderGraphCanvas();
      });
    }

    const btnToggleOvershoot = document.getElementById('btnToggleOvershoot');
    if (btnToggleOvershoot) {
      btnToggleOvershoot.addEventListener('click', (e) => {
        e.stopPropagation();
        graphEditorState.isOvershoot = !graphEditorState.isOvershoot;
        if (graphEditorState.isOvershoot) {
          if (graphEditorState.cp1.y <= 1.0 && graphEditorState.cp1.y >= 0 && graphEditorState.cp2.y <= 1.0 && graphEditorState.cp2.y >= 0) {
            graphEditorState.cp1 = { x: 0.34, y: 1.35 };
            graphEditorState.cp2 = { x: 0.64, y: 1.0 };
          }
        } else {
          graphEditorState.cp1.y = Math.max(0, Math.min(1, graphEditorState.cp1.y));
          graphEditorState.cp2.y = Math.max(0, Math.min(1, graphEditorState.cp2.y));
        }
        graphEditorState.dirty = true;
        updateGraphButtonsUI();
        applyGraphEasingToKeyframe();
        renderGraphCanvas();
      });
    }

    const btnCloseGraphLibrary = document.getElementById('btnCloseGraphLibrary');
    if (btnCloseGraphLibrary) {
      btnCloseGraphLibrary.addEventListener('click', (e) => {
        e.stopPropagation();
        closeGraphLibrary();
      });
    }

    const btnSaveToLibrary = document.getElementById('btnSaveToLibrary');
    if (btnSaveToLibrary) {
      btnSaveToLibrary.addEventListener('click', (e) => {
        e.stopPropagation();
        saveCurrentGraphToLibrary();
      });
    }

    initGraphEditorInteraction();
  }
}

// ════════════════════════════════════════════════════════════════
// Border & Shadow Controller Suite (Themed & Compact)
// ════════════════════════════════════════════════════════════════
const layerBorderShadow = new Map();

function getLayerBorderShadow(id) {
  if (!layerBorderShadow.has(id)) {
    layerBorderShadow.set(id, {
      stroke: {
        enabled: false,
        color: '#000000',
        size: 4.0,
        cap: 'butt',
        align: 'center'
      },
      shadow: {
        enabled: false,
        color: '#000000',
        size: 4,
        alpha: 100,
        posX: 3,
        posY: 3
      }
    });
  }
  const base = layerBorderShadow.get(id);
  const kfs = layerKeyframes.get(id);
  if (!kfs || kfs.length === 0) return base;
  const hasAny = (ch) => kfs.some(k => k[ch] !== undefined);
  if (!hasAny('strokeColor') && !hasAny('strokeSize') && !hasAny('shadowColor') && !hasAny('shadowSize') && !hasAny('shadowAlpha') && !hasAny('shadowPosX') && !hasAny('shadowPosY')) {
    return base;
  }
  function interpChannel(channel, defaultVal, isColor) {
    const relevant = kfs.filter(k => k[channel] !== undefined);
    if (relevant.length === 0) return defaultVal;
    if (relevant.length === 1 || elapsed <= relevant[0].time) return relevant[0][channel];
    const last = relevant[relevant.length - 1];
    if (elapsed >= last.time) return last[channel];
    for (let i = 0; i < relevant.length - 1; i++) {
      const k1 = relevant[i], k2 = relevant[i+1];
      if (elapsed >= k1.time && elapsed <= k2.time) {
        const span = k2.time - k1.time;
        const rawT = span > 0 ? (elapsed - k1.time) / span : 0;
        const easing = k1['easing_' + channel] || k1.easing;
        let t = rawT;
        if (easing && easing.cp1x !== undefined) t = solveCubicBezier(easing.cp1x, easing.cp1y, easing.cp2x, easing.cp2y, rawT);
        if (isColor) {
          const c1 = parseHexOrRgbLocal(k1[channel]);
          const c2 = parseHexOrRgbLocal(k2[channel]);
          const r = Math.round(c1.r + (c2.r - c1.r) * t);
          const g = Math.round(c1.g + (c2.g - c1.g) * t);
          const b = Math.round(c1.b + (c2.b - c1.b) * t);
          return `rgb(${r},${g},${b})`;
        }
        return k1[channel] + (k2[channel] - k1[channel]) * t;
      }
    }
    return defaultVal;
  }
  return {
    stroke: {
      enabled: base.stroke.enabled,
      color: hasAny('strokeColor') ? interpChannel('strokeColor', base.stroke.color, true) : base.stroke.color,
      size: hasAny('strokeSize') ? interpChannel('strokeSize', base.stroke.size) : base.stroke.size,
      cap: base.stroke.cap,
      align: base.stroke.align
    },
    shadow: {
      enabled: base.shadow.enabled,
      color: hasAny('shadowColor') ? interpChannel('shadowColor', base.shadow.color, true) : base.shadow.color,
      size: hasAny('shadowSize') ? interpChannel('shadowSize', base.shadow.size) : base.shadow.size,
      alpha: hasAny('shadowAlpha') ? interpChannel('shadowAlpha', base.shadow.alpha) : base.shadow.alpha,
      posX: hasAny('shadowPosX') ? interpChannel('shadowPosX', base.shadow.posX) : base.shadow.posX,
      posY: hasAny('shadowPosY') ? interpChannel('shadowPosY', base.shadow.posY) : base.shadow.posY
    }
  };
}

function getActiveBorderShadowChannel() {
  const panel = document.getElementById('panelBorderShadow');
  if (!panel || panel.style.display === 'none') return null;
  const activeTab = document.querySelector('#borderShadowTabs .controller-switch-btn.active');
  const tab = activeTab ? activeTab.dataset.bsTab : 'stroke';
  if (tab === 'stroke') {
    // cek param aktif atau color swatch
    const activeParam = document.querySelector('#bsTabStroke .bs-param-btn.active');
    if (activeParam && activeParam.id === 'btnStrokeSizeParam') return 'strokeSize';
    return 'strokeColor';
  } else {
    const activeParam = document.querySelector('#bsTabShadow .bs-param-btn.active');
    if (activeParam) {
      if (activeParam.id === 'btnShadowColorTrigger') return 'shadowColor';
      if (activeParam.id === 'btnShadowSizeParam') return 'shadowSize';
      if (activeParam.id === 'btnShadowAlphaParam') return 'shadowAlpha';
      if (activeParam.id === 'btnShadowPosParam') return activeShadowAxis === 'X' ? 'shadowPosX' : 'shadowPosY';
    }
    return 'shadowSize';
  }
}

function cleanupBorderShadowKeyframes(id, channels) {
  const kfs = layerKeyframes.get(id);
  if (!kfs || !kfs.length) return;
  let changed = false;
  for (let i = kfs.length - 1; i >= 0; i--) {
    const kf = kfs[i];
    let touched = false;
    channels.forEach(ch => {
      if (kf[ch] !== undefined) {
        delete kf[ch];
        touched = true;
      }
      const eKey = 'easing_' + ch;
      if (kf[eKey] !== undefined) {
        delete kf[eKey];
        touched = true;
      }
    });
    // also clean generic easing if it no longer corresponds to any remaining channel
    if (touched) changed = true;
    const hasMeaningful = ['posX','posY','posZ','rotX','rotY','rotZ','scaleW','scaleH','opacity','strokeColor','strokeSize','shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].some(p => kf[p] !== undefined);
    if (!hasMeaningful) {
      // remove empty keyframe (only time + orphan easing left)
      kfs.splice(i, 1);
      changed = true;
    } else if (kf.easing) {
      const hasAnyEasing = Object.keys(kf).some(k => k.startsWith('easing_'));
      if (!hasAnyEasing) delete kf.easing;
    }
  }
  if (changed) {
    renderAllKeyframeMarkers();
    updateBorderShadowKeyframeUI();
  }
}

function syncBorderShadowDisabledUI() {
  const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : null;
  const strokePane = document.getElementById('bsTabStroke');
  const shadowPane = document.getElementById('bsTabShadow');
  if (!id) {
    if (strokePane) strokePane.classList.add('is-disabled');
    if (shadowPane) shadowPane.classList.add('is-disabled');
    return;
  }
  const base = layerBorderShadow.get(id) || (typeof getLayerBorderShadow === 'function' ? getLayerBorderShadow(id) : null);
  if (!base) return;
  if (strokePane) strokePane.classList.toggle('is-disabled', !base.stroke.enabled);
  if (shadowPane) shadowPane.classList.toggle('is-disabled', !base.shadow.enabled);
}

function recordBorderShadowKeyframe(id, channel, value) {
  // jangan record jika switch untuk channel tersebut sedang OFF
  const base = layerBorderShadow.get(id);
  if (base) {
    const isStrokeChannel = ['strokeColor','strokeSize'].includes(channel);
    const isShadowChannel = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(channel);
    if (isStrokeChannel && !base.stroke.enabled) return;
    if (isShadowChannel && !base.shadow.enabled) return;
  }
  if (!layerKeyframes.has(id)) layerKeyframes.set(id, []);
  const kfs = layerKeyframes.get(id);
  const hasKf = hasKeyframeForChannel(id, elapsed, channel);
  let target = getKeyframeAt(id, elapsed);
  if (hasKf && target) {
    target[channel] = value;
  } else {
    if (!target) { target = { time: Math.round(elapsed * 100) / 100 }; kfs.push(target); }
    target[channel] = value;
    kfs.sort((a,b)=>a.time-b.time);
  }
  renderAllKeyframeMarkers();
  updateBorderShadowKeyframeUI();
  triggerAutoSave();
}

function updateBorderShadowKeyframeUI() {
  if (!selectedTrackRow) return;
  const id = selectedTrackRow.dataset.layerId || 'default';
  const ch = getActiveBorderShadowChannel();
  if (!ch) return;
  const hasKf = hasKeyframeForChannel(id, elapsed, ch);
  const btn = document.getElementById('btnToggleBorderShadowKeyframe');
  if (!btn) return;
  const sym = btn.querySelector('.diamond-icon-symbol');
  if (hasKf) { btn.classList.add('is-on-keyframe'); if(sym) sym.setAttribute('d','M7 12 L17 12'); }
  else { btn.classList.remove('is-on-keyframe'); if(sym) sym.setAttribute('d','M12 7 L12 17 M7 12 L17 12'); }
}

let activeShadowAxis = 'X';
let strokeSizeRulerInstance = null;
let shadowSizeRulerInstance = null;
let shadowAlphaRulerInstance = null;
let shadowPosRulerInstance = null;

function parseHexOrRgbLocal(str) {
  if (!str) return { r: 0, g: 0, b: 0, a: 1 };
  if (typeof parseHexOrRgb === 'function') {
    try { return parseHexOrRgb(str); } catch (_) {}
  }
  const s = String(str).trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a: 1 };
  }
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) {
    return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function initBorderShadowController() {
  const btnInspBS = document.getElementById('btnInspBorderShadow');
  const panelBS = document.getElementById('panelBorderShadow');
  const btnBackBS = document.getElementById('btnBackFromBorderShadow');
  const drawer = document.getElementById('layerInspectorDrawer');
  const toolsGrid = document.querySelector('.inspector-tools-grid');
  const quickStrip = document.querySelector('.inspector-quick-strip');

  // 1. Open subpanel button
  if (btnInspBS && panelBS) {
    btnInspBS.addEventListener('click', (e) => {
      e.stopPropagation();
      openInspectorSubpanel(panelBS, 'subpanel-border-shadow', () => {
        syncBorderShadowUI();
        // set default active param biar diamond tidak kosong
        const activeTab = document.querySelector('#borderShadowTabs .controller-switch-btn.active');
        const tab = activeTab ? activeTab.dataset.bsTab : 'stroke';
        if (tab === 'stroke') {
          document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
          const b = document.getElementById('btnStrokeSizeParam');
          if (b) b.classList.add('active');
        } else {
          document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
          const b = document.getElementById('btnShadowSizeParam');
          if (b) b.classList.add('active');
        }
        setTimeout(() => {
          updateBorderShadowKeyframeUI();
          renderAllKeyframeMarkers();
        }, 10);
      });
    });
  }

  // 2. Back button
  if (btnBackBS && panelBS) {
    btnBackBS.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInspectorSubpanel(panelBS);
    });
  }

  // 3. Tab switching (Stroke vs Shadow)
  document.querySelectorAll('#borderShadowTabs button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = btn.dataset.bsTab || 'stroke';
      document.querySelectorAll('#borderShadowTabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const strokePane = document.getElementById('bsTabStroke');
      const shadowPane = document.getElementById('bsTabShadow');
      if (strokePane) strokePane.style.display = tab === 'stroke' ? 'flex' : 'none';
      if (shadowPane) shadowPane.style.display = tab === 'shadow' ? 'flex' : 'none';
      // set default active param untuk tab baru
      if (tab === 'stroke') {
        document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const b = document.getElementById('btnStrokeSizeParam');
        if (b) b.classList.add('active');
      } else {
        document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const b = document.getElementById('btnShadowSizeParam');
        if (b) b.classList.add('active');
      }
      setTimeout(() => {
        updateBorderShadowKeyframeUI();
        renderAllKeyframeMarkers();
      }, 10);
    });
  });

  // 4. Toggle switches — OFF = reset ke default + kunci param & cleanup keyframe
  const toggleStroke = document.getElementById('toggleStrokeEnabled');
  if (toggleStroke) {
    toggleStroke.addEventListener('change', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      // pastikan base ada
      getLayerBorderShadow(id);
      const base = layerBorderShadow.get(id);
      if (!base) return;
      base.stroke.enabled = toggleStroke.checked;
      if (!toggleStroke.checked) {
        // reset nilai ke default biar UI balik ke default
        base.stroke.size = 4.0;
        base.stroke.color = '#000000';
        base.stroke.cap = 'butt';
        base.stroke.align = 'center';
        cleanupBorderShadowKeyframes(id, ['strokeColor','strokeSize']);
      }
      // sync UI (ruler, color box, cap/align, disabled visual)
      syncBorderShadowUI();
      renderAllKeyframeMarkers();
      updateBorderShadowKeyframeUI();
      applyBorderShadowToMesh(id);
      triggerAutoSave();
    });
  }

  const toggleShadow = document.getElementById('toggleShadowEnabled');
  if (toggleShadow) {
    toggleShadow.addEventListener('change', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      getLayerBorderShadow(id);
      const base = layerBorderShadow.get(id);
      if (!base) return;
      base.shadow.enabled = toggleShadow.checked;
      if (!toggleShadow.checked) {
        // reset nilai shadow ke default
        base.shadow.size = 4;
        base.shadow.alpha = 100;
        base.shadow.posX = 3;
        base.shadow.posY = 3;
        base.shadow.color = '#000000';
        cleanupBorderShadowKeyframes(id, ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY']);
      }
      syncBorderShadowUI();
      renderAllKeyframeMarkers();
      updateBorderShadowKeyframeUI();
      applyBorderShadowToMesh(id);
      triggerAutoSave();
    });
  }

  // 5. FishUI Rulers
  if (window.FishUI && window.FishUI.createRuler) {
    // Stroke Size Ruler
    strokeSizeRulerInstance = window.FishUI.createRuler({
      container: '#strokeSizeRuler',
      min: 0,
      max: 100,
      sensitivity: 0.25,
      value: 4.0,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        if (!base.stroke.enabled) {
          // kembalikan ruler ke nilai aktual biar gak bisa diadjust saat OFF
          if (strokeSizeRulerInstance) strokeSizeRulerInstance.setValue(base.stroke.size);
          return;
        }
        const bs = getLayerBorderShadow(id);
        const rounded = Math.max(0, Math.round(val * 2) / 2);
        bs.stroke.size = rounded;
        const lbl = document.getElementById('valStrokeSize');
        if (lbl) lbl.textContent = rounded.toFixed(1);
        // set active param biar diamond sinkron
        document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const sizeBtn = document.getElementById('btnStrokeSizeParam');
        if (sizeBtn) sizeBtn.classList.add('active');
        // auto-keyframe untuk strokeSize
        recordBorderShadowKeyframe(id, 'strokeSize', rounded);
        applyBorderShadowToMesh(id);
        triggerAutoSave();
        updateBorderShadowKeyframeUI();
      }
    });

    // Shadow Size Ruler
    shadowSizeRulerInstance = window.FishUI.createRuler({
      container: '#shadowSizeRuler',
      min: 0,
      max: 100,
      sensitivity: 0.4,
      value: 4,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        if (!base.shadow.enabled) {
          if (shadowSizeRulerInstance) shadowSizeRulerInstance.setValue(base.shadow.size);
          return;
        }
        const bs = getLayerBorderShadow(id);
        const rounded = Math.max(0, Math.round(val));
        bs.shadow.size = rounded;
        const lbl = document.getElementById('valShadowSize');
        if (lbl) lbl.textContent = rounded;
        document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const btn = document.getElementById('btnShadowSizeParam');
        if (btn) btn.classList.add('active');
        recordBorderShadowKeyframe(id, 'shadowSize', rounded);
        applyBorderShadowToMesh(id);
        triggerAutoSave();
        updateBorderShadowKeyframeUI();
      }
    });

    // Shadow Alpha Ruler
    shadowAlphaRulerInstance = window.FishUI.createRuler({
      container: '#shadowAlphaRuler',
      min: 0,
      max: 100,
      sensitivity: 0.5,
      value: 100,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        if (!base.shadow.enabled) {
          if (shadowAlphaRulerInstance) shadowAlphaRulerInstance.setValue(base.shadow.alpha);
          return;
        }
        const bs = getLayerBorderShadow(id);
        const rounded = Math.max(0, Math.min(100, Math.round(val)));
        bs.shadow.alpha = rounded;
        const lbl = document.getElementById('valShadowAlpha');
        if (lbl) lbl.textContent = `${rounded}%`;
        document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const btn = document.getElementById('btnShadowAlphaParam');
        if (btn) btn.classList.add('active');
        recordBorderShadowKeyframe(id, 'shadowAlpha', rounded);
        applyBorderShadowToMesh(id);
        triggerAutoSave();
        updateBorderShadowKeyframeUI();
      }
    });

    // Shadow Position Ruler
    shadowPosRulerInstance = window.FishUI.createRuler({
      container: '#shadowPosRuler',
      min: -150,
      max: 150,
      sensitivity: 0.5,
      value: 3,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        if (!base.shadow.enabled) {
          if (shadowPosRulerInstance) shadowPosRulerInstance.setValue(activeShadowAxis === 'X' ? base.shadow.posX : base.shadow.posY);
          return;
        }
        const bs = getLayerBorderShadow(id);
        const rounded = Math.round(val);
        document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const posBtn = document.getElementById('btnShadowPosParam');
        if (posBtn) posBtn.classList.add('active');
        if (activeShadowAxis === 'X') {
          bs.shadow.posX = rounded;
          const lblX = document.getElementById('valShadowPosX');
          if (lblX) lblX.textContent = rounded;
          recordBorderShadowKeyframe(id, 'shadowPosX', rounded);
        } else {
          bs.shadow.posY = rounded;
          const lblY = document.getElementById('valShadowPosY');
          if (lblY) lblY.textContent = rounded;
          recordBorderShadowKeyframe(id, 'shadowPosY', rounded);
        }
        applyBorderShadowToMesh(id);
        triggerAutoSave();
        updateBorderShadowKeyframeUI();
      }
    });
  }

  // 6. Color Pickers (Stroke & Shadow) — blocked when switch OFF
  const btnStrokeColor = document.getElementById('btnStrokeColorSwatch');
  if (btnStrokeColor) {
    btnStrokeColor.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
      if (!base.stroke.enabled) return;
      const bs = getLayerBorderShadow(id);
      // set active ke strokeColor (hapus Size)
      document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
      updateBorderShadowKeyframeUI();
      renderAllKeyframeMarkers();
      if (window.openGlobalColorPicker) {
        window.openGlobalColorPicker({
          color: bs.stroke.color || '#000000',
          alpha: 1,
          anchorElement: btnStrokeColor,
          onChange: (res) => {
            bs.stroke.color = res.hex || '#000000';
            const box = document.getElementById('strokeColorBox');
            if (box) box.style.background = bs.stroke.color;
            // pastikan Color jadi channel aktif untuk diamond
            document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
            recordBorderShadowKeyframe(id, 'strokeColor', bs.stroke.color);
            applyBorderShadowToMesh(id);
            triggerAutoSave();
            updateBorderShadowKeyframeUI();
            renderAllKeyframeMarkers();
          }
        });
      }
    });
  }

  const btnShadowColorTrigger = document.getElementById('btnShadowColorTrigger');
  const btnShadowColorSwatch = document.getElementById('btnShadowColorSwatch');
  const openShadowColor = (anchor) => {
    if (!selectedTrackRow) return;
    const id = selectedTrackRow.dataset.layerId || 'default';
    const baseChk = layerBorderShadow.get(id) || getLayerBorderShadow(id);
    if (!baseChk.shadow.enabled) return;
    const bs = getLayerBorderShadow(id);
    // set Color param aktif biar diamond sinkron
    document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
    const colorBtn = document.getElementById('btnShadowColorTrigger');
    if (colorBtn) colorBtn.classList.add('active');
    updateBorderShadowKeyframeUI();
    renderAllKeyframeMarkers();
    if (window.openGlobalColorPicker) {
      window.openGlobalColorPicker({
        color: bs.shadow.color || '#000000',
        alpha: (bs.shadow.alpha !== undefined ? bs.shadow.alpha / 100 : 1),
        anchorElement: anchor,
        onChange: (res) => {
          bs.shadow.color = res.hex || '#000000';
          if (res.alpha !== undefined) {
            bs.shadow.alpha = Math.round(res.alpha * 100);
            const lblA = document.getElementById('valShadowAlpha');
            if (lblA) lblA.textContent = `${bs.shadow.alpha}%`;
            if (shadowAlphaRulerInstance) shadowAlphaRulerInstance.setValue(bs.shadow.alpha);
            recordBorderShadowKeyframe(id, 'shadowAlpha', bs.shadow.alpha);
          }
          const box = document.getElementById('shadowColorBox');
          if (box) box.style.background = bs.shadow.color;
          const p = parseHexOrRgbLocal(bs.shadow.color);
          const rgbText = document.getElementById('shadowRgbText');
          if (rgbText) rgbText.textContent = `${p.r} ${p.g} ${p.b}`;
          // pastikan Color tetap aktif
          document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
          if (colorBtn) colorBtn.classList.add('active');
          recordBorderShadowKeyframe(id, 'shadowColor', bs.shadow.color);
          applyBorderShadowToMesh(id);
          triggerAutoSave();
          updateBorderShadowKeyframeUI();
          renderAllKeyframeMarkers();
        }
      });
    }
  };

  if (btnShadowColorTrigger) {
    btnShadowColorTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      // hanya select param untuk keyframe, popover hanya dari swatch
      document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b => b.classList.remove('active'));
      btnShadowColorTrigger.classList.add('active');
      updateBorderShadowKeyframeUI();
    });
  }
  if (btnShadowColorSwatch) {
    btnShadowColorSwatch.addEventListener('click', (e) => {
      e.stopPropagation();
      // swatch tetap buka popover color picker
      openShadowColor(btnShadowColorSwatch);
    });
  }

  // 7. Cap and Join icon buttons — blocked when stroke OFF
  document.querySelectorAll('#strokeCapGroup button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
      if (!base.stroke.enabled) return;
      const bs = getLayerBorderShadow(id);
      bs.stroke.cap = btn.dataset.cap || 'butt';
      document.querySelectorAll('#strokeCapGroup button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyBorderShadowToMesh(id);
      triggerAutoSave();
    });
  });

  document.querySelectorAll('#strokeAlignGroup button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
      if (!base.stroke.enabled) return;
      const bs = getLayerBorderShadow(id);
      bs.stroke.align = btn.dataset.align || 'center';
      document.querySelectorAll('#strokeAlignGroup button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyBorderShadowToMesh(id);
      triggerAutoSave();
    });
  });

  // Param buttons (Size/Color/Alpha/Position) — klik jadi select (fill terang)
  document.querySelectorAll('#bsTabStroke .bs-param-btn, #bsTabShadow .bs-param-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // jangan override Color picker yang sudah ada handler sendiri, tapi tetap set active
      const pane = btn.closest('.bs-tab-pane');
      if (pane) {
        pane.querySelectorAll('.bs-param-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });

  // 8. Shadow Axis X / Y selector
  const btnAxisX = document.getElementById('btnShadowAxisX');
  const btnAxisY = document.getElementById('btnShadowAxisY');
  if (btnAxisX && btnAxisY) {
    btnAxisX.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedTrackRow) {
        const idAx = selectedTrackRow.dataset.layerId || 'default';
        const baseAx = layerBorderShadow.get(idAx) || getLayerBorderShadow(idAx);
        if (!baseAx.shadow.enabled) return;
      }
      activeShadowAxis = 'X';
      btnAxisX.classList.add('active');
      btnAxisY.classList.remove('active');
      if (selectedTrackRow && shadowPosRulerInstance) {
        const id = selectedTrackRow.dataset.layerId || 'default';
        const bs = getLayerBorderShadow(id);
        shadowPosRulerInstance.setValue(bs.shadow.posX);
      }
      updateBorderShadowKeyframeUI();
    });

    btnAxisY.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedTrackRow) {
        const idAy = selectedTrackRow.dataset.layerId || 'default';
        const baseAy = layerBorderShadow.get(idAy) || getLayerBorderShadow(idAy);
        if (!baseAy.shadow.enabled) return;
      }
      activeShadowAxis = 'Y';
      btnAxisY.classList.add('active');
      btnAxisX.classList.remove('active');
      if (selectedTrackRow && shadowPosRulerInstance) {
        const id = selectedTrackRow.dataset.layerId || 'default';
        const bs = getLayerBorderShadow(id);
        shadowPosRulerInstance.setValue(bs.shadow.posY);
      }
      updateBorderShadowKeyframeUI();
    });
  }

  // Param buttons active → update diamond UI + marker highlight modular
  document.querySelectorAll('#bsTabStroke .bs-param-btn, #bsTabShadow .bs-param-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(() => {
        updateBorderShadowKeyframeUI();
        renderAllKeyframeMarkers();
      }, 10);
    });
  });
  document.querySelectorAll('#borderShadowTabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(updateBorderShadowKeyframeUI, 10);
    });
  });

  // Keyframe & Graph API for Border & Shadow (Color/Size/Alpha/Position)
  const btnBSKf = document.getElementById('btnToggleBorderShadowKeyframe');
  const btnBSGraph = document.getElementById('btnBorderShadowGraph');
  if (btnBSKf) {
    if (window.FishUI && window.FishUI.createKeyframeController) {
      window.FishUI.createKeyframeController({
        toggleButton: '#btnToggleBorderShadowKeyframe',
        graphButton: '#btnBorderShadowGraph',
        getChannel: () => getActiveBorderShadowChannel() || 'strokeSize',
        getLayerId: () => selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default',
        getCurrentTime: () => elapsed,
        getKeyframes: (layerId) => layerKeyframes.get(layerId) || [],
        getCurrentValue: (layerId, ch) => {
          const bs = getLayerBorderShadow(layerId);
          if (ch === 'strokeColor') return bs.stroke.color;
          if (ch === 'strokeSize') return bs.stroke.size;
          if (ch === 'shadowColor') return bs.shadow.color;
          if (ch === 'shadowSize') return bs.shadow.size;
          if (ch === 'shadowAlpha') return bs.shadow.alpha;
          if (ch === 'shadowPosX') return bs.shadow.posX;
          if (ch === 'shadowPosY') return bs.shadow.posY;
          return null;
        },
        onToggle: () => {
          const ch = getActiveBorderShadowChannel() || 'strokeSize';
          const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
          const baseChk = layerBorderShadow.get(id) || getLayerBorderShadow(id);
          const isStrokeCh = ['strokeColor','strokeSize'].includes(ch);
          const isShadowCh = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
          if (isStrokeCh && !baseChk.stroke.enabled) return;
          if (isShadowCh && !baseChk.shadow.enabled) return;
          const bs = getLayerBorderShadow(id);
          let val;
          if (ch === 'strokeColor') val = bs.stroke.color;
          else if (ch === 'strokeSize') val = bs.stroke.size;
          else if (ch === 'shadowColor') val = bs.shadow.color;
          else if (ch === 'shadowSize') val = bs.shadow.size;
          else if (ch === 'shadowAlpha') val = bs.shadow.alpha;
          else if (ch === 'shadowPosX') val = bs.shadow.posX;
          else if (ch === 'shadowPosY') val = bs.shadow.posY;
          if (hasKeyframeForChannel(id, elapsed, ch)) {
            const ex = getKeyframeAt(id, elapsed);
            if (ex) {
              delete ex[ch];
              const eKey = 'easing_' + ch;
              if (ex[eKey] !== undefined) delete ex[eKey];
              if (ex.easing) {
                const hasAnyEasing = Object.keys(ex).some(k => k.startsWith('easing_'));
                if (!hasAnyEasing) delete ex.easing;
              }
              const hasAny = ['strokeColor','strokeSize','shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY','posX','posY','posZ','rotX','rotY','rotZ','scaleW','scaleH','opacity'].some(p=>ex[p]!==undefined);
              if (!hasAny) {
                const kfs = layerKeyframes.get(id);
                const idx = kfs.indexOf(ex);
                if (idx!==-1) kfs.splice(idx,1);
              }
            }
          } else {
            recordBorderShadowKeyframe(id, ch, val);
            return;
          }
          updateBorderShadowKeyframeUI();
          renderAllKeyframeMarkers();
          triggerAutoSave();
        },
        onOpenGraph: ({ channel }) => {
          const ch = channel || getActiveBorderShadowChannel() || 'strokeSize';
          const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
          const baseChk = layerBorderShadow.get(id) || getLayerBorderShadow(id);
          const isStrokeCh = ['strokeColor','strokeSize'].includes(ch);
          const isShadowCh = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
          if (isStrokeCh && !baseChk.stroke.enabled) return;
          if (isShadowCh && !baseChk.shadow.enabled) return;
          const anchor = document.getElementById('btnBorderShadowGraph');
          openGraphEditor(ch, anchor);
        }
      });
    } else {
      btnBSKf.addEventListener('click', (e) => {
        e.stopPropagation();
        const ch = getActiveBorderShadowChannel() || 'strokeSize';
        const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
        const baseChk = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        const isStrokeCh = ['strokeColor','strokeSize'].includes(ch);
        const isShadowCh = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
        if (isStrokeCh && !baseChk.stroke.enabled) return;
        if (isShadowCh && !baseChk.shadow.enabled) return;
        const bs = getLayerBorderShadow(id);
        let val;
        if (ch === 'strokeColor') val = bs.stroke.color;
        else if (ch === 'strokeSize') val = bs.stroke.size;
        else if (ch === 'shadowColor') val = bs.shadow.color;
        else if (ch === 'shadowSize') val = bs.shadow.size;
        else if (ch === 'shadowAlpha') val = bs.shadow.alpha;
        else if (ch === 'shadowPosX') val = bs.shadow.posX;
        else if (ch === 'shadowPosY') val = bs.shadow.posY;
        if (hasKeyframeForChannel(id, elapsed, ch)) {
          const ex = getKeyframeAt(id, elapsed);
          if (ex) {
            delete ex[ch];
            const eKey = 'easing_' + ch;
            if (ex[eKey] !== undefined) delete ex[eKey];
          }
        } else {
          recordBorderShadowKeyframe(id, ch, val);
        }
        updateBorderShadowKeyframeUI();
        renderAllKeyframeMarkers();
        triggerAutoSave();
      });
      if (btnBSGraph) {
        btnBSGraph.addEventListener('click', (e) => {
          e.stopPropagation();
          const ch = getActiveBorderShadowChannel() || 'strokeSize';
          const idG = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
          const baseChkG = layerBorderShadow.get(idG) || getLayerBorderShadow(idG);
          const isStrokeChG = ['strokeColor','strokeSize'].includes(ch);
          const isShadowChG = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
          if (isStrokeChG && !baseChkG.stroke.enabled) return;
          if (isShadowChG && !baseChkG.shadow.enabled) return;
          const anchor = document.getElementById('btnBorderShadowGraph');
          openGraphEditor(ch, anchor);
        });
      }
    }
  } else if (btnBSGraph) {
    btnBSGraph.addEventListener('click', (e) => {
      e.stopPropagation();
      const ch = getActiveBorderShadowChannel() || 'strokeSize';
      const idG2 = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
      const baseChkG2 = layerBorderShadow.get(idG2) || getLayerBorderShadow(idG2);
      const isStrokeChG2 = ['strokeColor','strokeSize'].includes(ch);
      const isShadowChG2 = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
      if (isStrokeChG2 && !baseChkG2.stroke.enabled) return;
      if (isShadowChG2 && !baseChkG2.shadow.enabled) return;
      const anchor = document.getElementById('btnBorderShadowGraph');
      openGraphEditor(ch, anchor);
    });
  }
}

function initEditShapeSubpanel() {
  const btnInspEditShape = document.getElementById('btnInspEditShape');
  const panelShape = document.getElementById('panelEditShape');
  const btnBackShape = document.getElementById('btnBackFromEditShape');
  const titleEl = document.getElementById('shapeSubpanelTitle');
  const contentEl = document.getElementById('shapeEditContent');

  if (!btnInspEditShape || !panelShape) return;

  function renderShapeControls(layerId) {
    if (!contentEl) return;
    contentEl.innerHTML = '';

    const row = document.querySelector(`.track-row[data-layer-id="${layerId}"]`);
    const clipName = row?.querySelector('.track-clip-name')?.textContent || '';
    let shapeType = row ? (row.dataset.shapeType || '') : '';

    if (!shapeType) {
      const lower = (clipName + '_' + (row?.dataset?.category || '')).toLowerCase();
      if (lower.includes('circle') || lower.includes('bulat')) shapeType = 'circle';
      else if (lower.includes('triangle') || lower.includes('segitiga')) shapeType = 'triangle';
      else if (lower.includes('round')) shapeType = 'round';
      else if (lower.includes('square') || lower.includes('kotak')) shapeType = 'square';
      else if (lower.includes('line') || lower.includes('garis')) shapeType = 'line';
      else if (lower.includes('arrow') || lower.includes('panah')) shapeType = 'arrow';
      else shapeType = 'square';
    }

    const titles = {
      square: 'Edit Shape: Kotak',
      circle: 'Edit Shape: Bulat',
      round: 'Edit Shape: Round',
      triangle: 'Edit Shape: Segitiga',
      line: 'Edit Shape: Line',
      arrow: 'Edit Shape: Panah'
    };
    if (titleEl) titleEl.textContent = titles[shapeType] || 'Edit Shape';

    const p = getLayerShapeParams(layerId, shapeType);

    function createRulerRow(label, min, max, val, unit, onValChange) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'shape-slider-row';

      const lbl = document.createElement('span');
      lbl.className = 'shape-slider-lbl';
      lbl.textContent = label;

      const rulerTrack = document.createElement('div');
      rulerTrack.className = 'shape-ruler-track';

      const valLabel = document.createElement('span');
      valLabel.className = 'shape-slider-val';
      valLabel.textContent = val + (unit || '');

      rowDiv.appendChild(lbl);
      rowDiv.appendChild(rulerTrack);
      rowDiv.appendChild(valLabel);

      if (window.FishUI && window.FishUI.createRuler) {
        const minVal = min !== undefined ? min : -Infinity;
        const maxVal = max !== undefined ? max : Infinity;
        const sens = (isFinite(minVal) && isFinite(maxVal)) ? Math.max(0.15, (maxVal - minVal) / 280) : 0.8;
        window.FishUI.createRuler({
          container: rulerTrack,
          min: minVal,
          max: maxVal,
          value: val,
          sensitivity: sens,
          onChange: (v) => {
            const rounded = Math.round(v);
            valLabel.textContent = rounded + (unit || '');
            onValChange(rounded);
            applyFillToMeshGlobal(layerId);
            triggerAutoSave();
          }
        });
      }

      return rowDiv;
    }

    if (shapeType === 'square') {
      const list = document.createElement('div');
      list.className = 'shape-slider-list';

      list.appendChild(createRulerRow('Ukuran X', -Infinity, Infinity, p.sizeX !== undefined ? p.sizeX : 100, '%', (v) => {
        p.sizeX = v;
      }));

      list.appendChild(createRulerRow('Ukuran Y', -Infinity, Infinity, p.sizeY !== undefined ? p.sizeY : 100, '%', (v) => {
        p.sizeY = v;
      }));

      list.appendChild(createRulerRow('Rounded', -Infinity, Infinity, p.rounded !== undefined ? p.rounded : 0, '%', (v) => {
        p.rounded = v;
      }));

      contentEl.appendChild(list);
    } else if (shapeType === 'circle') {
      const list = document.createElement('div');
      list.className = 'shape-slider-list';

      list.appendChild(createRulerRow('Ukuran X', -Infinity, Infinity, p.sizeX !== undefined ? p.sizeX : 100, '%', (v) => {
        p.sizeX = v;
      }));

      list.appendChild(createRulerRow('Ukuran Y', -Infinity, Infinity, p.sizeY !== undefined ? p.sizeY : 100, '%', (v) => {
        p.sizeY = v;
      }));

      contentEl.appendChild(list);
    } else if (shapeType === 'round') {
      const list = document.createElement('div');
      list.className = 'shape-slider-list';

      list.appendChild(createRulerRow('Ukuran X', -Infinity, Infinity, p.sizeX !== undefined ? p.sizeX : 100, '%', (v) => {
        p.sizeX = v;
      }));

      list.appendChild(createRulerRow('Ukuran Y', -Infinity, Infinity, p.sizeY !== undefined ? p.sizeY : 100, '%', (v) => {
        p.sizeY = v;
      }));

      contentEl.appendChild(list);
    } else if (shapeType === 'triangle') {
      const list = document.createElement('div');
      list.className = 'shape-slider-list';

      list.appendChild(createRulerRow('Ukuran X', -Infinity, Infinity, p.sizeX !== undefined ? p.sizeX : 100, '%', (v) => {
        p.sizeX = v;
      }));

      list.appendChild(createRulerRow('Ukuran Y', -Infinity, Infinity, p.sizeY !== undefined ? p.sizeY : 100, '%', (v) => {
        p.sizeY = v;
      }));

      list.appendChild(createRulerRow('Curve', -Infinity, Infinity, p.curve !== undefined ? p.curve : 0, '%', (v) => {
        p.curve = v;
      }));

      list.appendChild(createRulerRow('Step', 3, Infinity, p.step !== undefined ? p.step : 3, '', (v) => {
        p.step = Math.max(3, Math.round(v));
      }));

      contentEl.appendChild(list);
    } else if (shapeType === 'line' || shapeType === 'arrow') {
      if (!p.points || p.points.length < 2) {
        p.points = [{ x: -50, y: 0 }, { x: 50, y: 0 }];
      }
      let activePointIdx = Math.min(p.points.length - 1, Math.max(0, p.selectedPointIdx || 0));

      const list = document.createElement('div');
      list.className = 'shape-slider-list';

      list.appendChild(createRulerRow('Ketebalan', 2, 120, p.thickness !== undefined ? p.thickness : (shapeType === 'arrow' ? 16 : 14), 'px', (v) => {
        p.thickness = Math.max(2, v);
      }));

      if (shapeType === 'arrow') {
        list.appendChild(createRulerRow('Kepala Panah', 10, 150, p.headSize !== undefined ? p.headSize : 34, 'px', (v) => {
          p.headSize = Math.max(10, v);
        }));
      }

      contentEl.appendChild(list);

      const splitContainer = document.createElement('div');
      splitContainer.className = 'shape-split-container';

      // Left Column: Joystick Pad
      const joyCol = document.createElement('div');
      joyCol.className = 'shape-joystick-col';

      const movepadBox = document.createElement('div');
      movepadBox.className = 'shape-movepad-box';

      // MovePad controller with correct Y axis mapping
      if (window.FishUI && window.FishUI.createMovePad) {
        window.FishUI.createMovePad({
          container: movepadBox,
          onMove: ({ dx, dy, deltaX, deltaY }) => {
            const curPt = p.points[activePointIdx];
            if (curPt) {
              const mx = (typeof dx === 'number') ? dx : (typeof deltaX === 'number' ? deltaX : 0);
              const my = (typeof dy === 'number') ? dy : (typeof deltaY === 'number' ? deltaY : 0);
              curPt.x = (Number(curPt.x) || 0) + mx * 0.7;
              curPt.y = (Number(curPt.y) || 0) + my * 0.7;
              renderWaypoints();
              applyFillToMeshGlobal(layerId);
              renderCanvasOverlay();
            }
          },
          onEnd: () => {
            triggerAutoSave();
          }
        });
      }
      joyCol.appendChild(movepadBox);

      // Right Column: Vertical Waypoint Track
      const wpCol = document.createElement('div');
      wpCol.className = 'shape-waypoint-col';

      const trackList = document.createElement('div');
      trackList.className = 'shape-waypoint-track';

      function renderWaypoints() {
        trackList.innerHTML = '';
        p.points.forEach((pt, idx) => {
          const node = document.createElement('div');
          node.className = 'shape-waypoint-node' + (idx === activePointIdx ? ' active' : '');
          node.innerHTML = `
            <span>Titik #${idx + 1}</span>
            ${p.points.length > 2 ? `<span class="material-symbols-rounded" data-del="${idx}" style="font-size:14px; color:rgba(255,242,194,0.6); cursor:pointer;" title="Hapus titik">close</span>` : ''}
          `;

          const delBtn = node.querySelector(`[data-del="${idx}"]`);
          if (delBtn) {
            delBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              p.points.splice(idx, 1);
              if (activePointIdx >= p.points.length) activePointIdx = p.points.length - 1;
              p.selectedPointIdx = activePointIdx;
              renderWaypoints();
              applyFillToMeshGlobal(layerId);
              renderCanvasOverlay();
              triggerAutoSave();
            });
          }

          node.addEventListener('click', () => {
            activePointIdx = idx;
            p.selectedPointIdx = activePointIdx;
            renderWaypoints();
            renderCanvasOverlay();
          });

          trackList.appendChild(node);
        });
      }

      renderWaypoints();
      wpCol.appendChild(trackList);

      // Plus Button to add waypoint
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'shape-waypoint-add-btn';
      addBtn.title = 'Tambah Titik Patokan (Extend Line)';
      addBtn.innerHTML = `
        <span class="material-symbols-rounded" style="font-size:18px;">add</span>
        <span>Tambah</span>
      `;

      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const lastPt = p.points[p.points.length - 1] || { x: 50, y: 0 };
        const prevPt = p.points[p.points.length - 2] || { x: 0, y: 0 };
        const dx = (lastPt.x || 0) - (prevPt.x || 0) || 30;
        const dy = (lastPt.y || 0) - (prevPt.y || 0) || 0;
        const newX = (lastPt.x || 0) + Math.sign(dx) * 25;
        const newY = (lastPt.y || 0) + (p.points.length % 2 === 0 ? 30 : -30);
        p.points.push({ x: newX, y: newY });
        activePointIdx = p.points.length - 1;
        p.selectedPointIdx = activePointIdx;
        renderWaypoints();
        trackList.scrollTop = trackList.scrollHeight;
        applyFillToMeshGlobal(layerId);
        renderCanvasOverlay();
        triggerAutoSave();
      });

      wpCol.appendChild(addBtn);

      splitContainer.appendChild(joyCol);
      splitContainer.appendChild(wpCol);
      contentEl.appendChild(splitContainer);
    }
  }

  btnInspEditShape.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectedTrackRow) return;
    const id = selectedTrackRow.dataset.layerId || 'default';
    openInspectorSubpanel(panelShape, 'subpanel-shape', () => {
      renderShapeControls(id);
    });
  });

  if (btnBackShape) {
    btnBackShape.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInspectorSubpanel(panelShape);
    });
  }
}

const layerCameraParams = new Map();

function getLayerCameraParams(layerId) {
  let p = layerCameraParams.get(layerId);
  if (!p) {
    p = {
      zoom: 100,
      bokehEnabled: false,
      focusMode: 'auto',
      focusTargetId: '',
      manualFocusDist: 100,
      bokehBlur: 50,
      bokehRange: 60
    };
    layerCameraParams.set(layerId, p);
  }
  return p;
}

function initCameraControlSubpanel() {
  const btnInspCamera = document.getElementById('btnInspCameraControl');
  const panelCamera = document.getElementById('panelCameraControl');
  const btnBackCamera = document.getElementById('btnBackFromCameraControl');
  const btnReset = document.getElementById('btnResetCameraView');

  // Zoom
  const sliderZoom = document.getElementById('sliderCameraZoom');
  const valZoom = document.getElementById('valCameraZoom');

  // Bokeh
  const toggleBokeh = document.getElementById('toggleCameraBokeh');
  const bokehSettings = document.getElementById('cameraBokehSettings');
  const btnModeAuto = document.getElementById('btnFocusModeAuto');
  const btnModeManual = document.getElementById('btnFocusModeManual');
  const boxTargetLayer = document.getElementById('boxFocusTargetLayer');
  const selectTargetLayer = document.getElementById('selectFocusTargetLayer');
  const boxManualDist = document.getElementById('boxFocusManualDist');
  const sliderManualDist = document.getElementById('sliderFocusDist');
  const valManualDist = document.getElementById('valFocusDist');
  const sliderBokehBlur = document.getElementById('sliderBokehBlur');
  const valBokehBlur = document.getElementById('valBokehBlur');
  const sliderBokehRange = document.getElementById('sliderBokehRange');
  const valBokehRange = document.getElementById('valBokehRange');

  if (btnInspCamera && panelCamera) {
    btnInspCamera.addEventListener('click', (e) => {
      e.stopPropagation();
      openInspectorSubpanel(panelCamera, 'subpanel-camera', () => {
        syncCameraControlUI();
      });
    });
  }

  if (btnBackCamera && panelCamera) {
    btnBackCamera.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInspectorSubpanel(panelCamera);
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const t = getLayerTransform(id);
      t.posX = 0; t.posY = 0; t.posZ = 0;
      t.rotX = 0; t.rotY = 0; t.rotZ = 0;
      t.scaleW = 100; t.scaleH = 100;

      const cp = getLayerCameraParams(id);
      cp.zoom = 100;
      cp.bokehEnabled = false;
      cp.focusMode = 'auto';
      cp.focusTargetId = '';
      cp.manualFocusDist = 100;
      cp.bokehBlur = 50;
      cp.bokehRange = 60;

      syncCameraControlUI();
      syncControllerUI();
      render3D();
      renderCanvasOverlay();
      triggerAutoSave();
    });
  }

  // 1. Zoom Slider
  if (sliderZoom) {
    sliderZoom.addEventListener('input', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cp = getLayerCameraParams(id);
      cp.zoom = Number(sliderZoom.value) || 100;
      if (valZoom) valZoom.textContent = `${cp.zoom}%`;
      render3D();
      renderCanvasOverlay();
      triggerAutoSave();
    });
  }

  // 2. Bokeh Toggle
  if (toggleBokeh) {
    toggleBokeh.addEventListener('change', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cp = getLayerCameraParams(id);
      cp.bokehEnabled = toggleBokeh.checked;
      if (bokehSettings) {
        bokehSettings.style.display = cp.bokehEnabled ? 'flex' : 'none';
      }
      render3D();
      triggerAutoSave();
    });
  }

  // 3. Focus Mode Switch (Auto Focus vs Manual)
  if (btnModeAuto) {
    btnModeAuto.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cp = getLayerCameraParams(id);
      cp.focusMode = 'auto';
      btnModeAuto.classList.add('active');
      if (btnModeManual) btnModeManual.classList.remove('active');
      if (boxTargetLayer) boxTargetLayer.style.display = 'flex';
      if (boxManualDist) boxManualDist.style.display = 'none';
      render3D();
      triggerAutoSave();
    });
  }

  if (btnModeManual) {
    btnModeManual.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cp = getLayerCameraParams(id);
      cp.focusMode = 'manual';
      btnModeManual.classList.add('active');
      if (btnModeAuto) btnModeAuto.classList.remove('active');
      if (boxTargetLayer) boxTargetLayer.style.display = 'none';
      if (boxManualDist) boxManualDist.style.display = 'flex';
      render3D();
      triggerAutoSave();
    });
  }

  // 4. Target Layer Dropdown
  if (selectTargetLayer) {
    selectTargetLayer.addEventListener('change', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cp = getLayerCameraParams(id);
      cp.focusTargetId = selectTargetLayer.value;
      render3D();
      triggerAutoSave();
    });
  }

  // 5. Manual Focus Distance
  if (sliderManualDist) {
    sliderManualDist.addEventListener('input', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cp = getLayerCameraParams(id);
      cp.manualFocusDist = Number(sliderManualDist.value) || 100;
      if (valManualDist) valManualDist.textContent = `${cp.manualFocusDist} px`;
      render3D();
      triggerAutoSave();
    });
  }

  // 6. Bokeh Blur Strength
  if (sliderBokehBlur) {
    sliderBokehBlur.addEventListener('input', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cp = getLayerCameraParams(id);
      cp.bokehBlur = Number(sliderBokehBlur.value) || 50;
      if (valBokehBlur) valBokehBlur.textContent = `${cp.bokehBlur}%`;
      render3D();
      triggerAutoSave();
    });
  }

  // 7. Bokeh Depth Range / Falloff
  if (sliderBokehRange) {
    sliderBokehRange.addEventListener('input', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cp = getLayerCameraParams(id);
      cp.bokehRange = Number(sliderBokehRange.value) || 60;
      if (valBokehRange) valBokehRange.textContent = `${cp.bokehRange} px`;
      render3D();
      triggerAutoSave();
    });
  }

  function populateFocusTargetLayers(currentCamId, selectedTargetId) {
    if (!selectTargetLayer) return;
    selectTargetLayer.innerHTML = '<option value="">-- Pilih Layer Target --</option>';

    const rows = document.querySelectorAll('.track-row');
    rows.forEach(r => {
      const lid = r.dataset.layerId;
      if (!lid || lid === currentCamId) return;
      const cat = r.dataset.category || 'media';
      if (cat === 'camera') return;

      const name = r.querySelector('.track-clip-name')?.textContent.trim() || `Layer ${lid}`;
      const opt = document.createElement('option');
      opt.value = lid;
      opt.textContent = `${name} (${cat})`;
      if (lid === selectedTargetId) {
        opt.selected = true;
      }
      selectTargetLayer.appendChild(opt);
    });
  }

  function syncCameraControlUI() {
    if (!selectedTrackRow) return;
    const id = selectedTrackRow.dataset.layerId;
    const cp = getLayerCameraParams(id);

    // Zoom
    if (sliderZoom) sliderZoom.value = cp.zoom || 100;
    if (valZoom) valZoom.textContent = `${cp.zoom || 100}%`;

    // Bokeh Toggle
    if (toggleBokeh) toggleBokeh.checked = !!cp.bokehEnabled;
    if (bokehSettings) bokehSettings.style.display = cp.bokehEnabled ? 'flex' : 'none';

    // Focus Mode
    const isAuto = cp.focusMode !== 'manual';
    if (btnModeAuto) btnModeAuto.classList.toggle('active', isAuto);
    if (btnModeManual) btnModeManual.classList.toggle('active', !isAuto);
    if (boxTargetLayer) boxTargetLayer.style.display = isAuto ? 'flex' : 'none';
    if (boxManualDist) boxManualDist.style.display = !isAuto ? 'flex' : 'none';

    // Populate Layers
    populateFocusTargetLayers(id, cp.focusTargetId);

    // Sliders
    if (sliderManualDist) sliderManualDist.value = cp.manualFocusDist || 100;
    if (valManualDist) valManualDist.textContent = `${cp.manualFocusDist || 100} px`;

    if (sliderBokehBlur) sliderBokehBlur.value = cp.bokehBlur !== undefined ? cp.bokehBlur : 50;
    if (valBokehBlur) valBokehBlur.textContent = `${cp.bokehBlur !== undefined ? cp.bokehBlur : 50}%`;

    if (sliderBokehRange) sliderBokehRange.value = cp.bokehRange !== undefined ? cp.bokehRange : 60;
    if (valBokehRange) valBokehRange.textContent = `${cp.bokehRange !== undefined ? cp.bokehRange : 60} px`;
  }
}

function syncBorderShadowUI() {
  if (!selectedTrackRow) return;
  const id = selectedTrackRow.dataset.layerId || 'default';
  const bs = getLayerBorderShadow(id);
  const base = layerBorderShadow.get(id) || bs;

  // Stroke UI
  const toggleStroke = document.getElementById('toggleStrokeEnabled');
  if (toggleStroke) toggleStroke.checked = !!base.stroke.enabled;

  const strokeBox = document.getElementById('strokeColorBox');
  if (strokeBox) strokeBox.style.background = bs.stroke.color || '#000000';

  const valStrokeSize = document.getElementById('valStrokeSize');
  if (valStrokeSize) valStrokeSize.textContent = Number(bs.stroke.size || 4).toFixed(1);
  if (strokeSizeRulerInstance) strokeSizeRulerInstance.setValue(bs.stroke.size || 4);

  document.querySelectorAll('#strokeCapGroup button').forEach(b => {
    b.classList.toggle('active', b.dataset.cap === (bs.stroke.cap || 'butt'));
  });
  document.querySelectorAll('#strokeAlignGroup button').forEach(b => {
    b.classList.toggle('active', b.dataset.align === (bs.stroke.align || 'center'));
  });

  // Shadow UI
  const toggleShadow = document.getElementById('toggleShadowEnabled');
  if (toggleShadow) toggleShadow.checked = !!base.shadow.enabled;

  const shadowBox = document.getElementById('shadowColorBox');
  if (shadowBox) shadowBox.style.background = bs.shadow.color || '#000000';

  const p = parseHexOrRgbLocal(bs.shadow.color || '#000000');
  const rgbText = document.getElementById('shadowRgbText');
  if (rgbText) rgbText.textContent = `${p.r} ${p.g} ${p.b}`;

  const valShadowSize = document.getElementById('valShadowSize');
  if (valShadowSize) valShadowSize.textContent = bs.shadow.size !== undefined ? bs.shadow.size : 4;
  if (shadowSizeRulerInstance) shadowSizeRulerInstance.setValue(bs.shadow.size !== undefined ? bs.shadow.size : 4);

  const valShadowAlpha = document.getElementById('valShadowAlpha');
  if (valShadowAlpha) valShadowAlpha.textContent = `${bs.shadow.alpha !== undefined ? bs.shadow.alpha : 100}%`;
  if (shadowAlphaRulerInstance) shadowAlphaRulerInstance.setValue(bs.shadow.alpha !== undefined ? bs.shadow.alpha : 100);

  const valPosX = document.getElementById('valShadowPosX');
  const valPosY = document.getElementById('valShadowPosY');
  if (valPosX) valPosX.textContent = bs.shadow.posX !== undefined ? bs.shadow.posX : 3;
  if (valPosY) valPosY.textContent = bs.shadow.posY !== undefined ? bs.shadow.posY : 3;

  if (shadowPosRulerInstance) {
    shadowPosRulerInstance.setValue(activeShadowAxis === 'X' ? (bs.shadow.posX || 3) : (bs.shadow.posY || 3));
  }

  // update disabled visual state
  syncBorderShadowDisabledUI();
}

function applyBorderShadowToMesh(id) {
  applyFillToMeshGlobal(id);
}

let projectRatio = '9:16';
let projectResolution = '1080p';
let projectBgColor = '#000000';
let projectCustomWidth = 1080;
let projectCustomHeight = 1080;

function applyProjectConfig(cfg) {
  if (!cfg) return;

  if (cfg.fps !== undefined) {
    projectFps = parseInt(cfg.fps) || 30;
  }
  if (cfg.ratio !== undefined) {
    projectRatio = cfg.ratio;
  }
  if (cfg.resolution !== undefined) {
    projectResolution = cfg.resolution;
  }
  if (cfg.backgroundColor !== undefined) {
    projectBgColor = cfg.backgroundColor;
  }
  if (cfg.customWidth !== undefined) {
    projectCustomWidth = parseInt(cfg.customWidth) || 1080;
  }
  if (cfg.customHeight !== undefined) {
    projectCustomHeight = parseInt(cfg.customHeight) || 1080;
  }
  if (cfg.motionBlurTune !== undefined) {
    projectMotionBlurTune = parseFloat(cfg.motionBlurTune) || 0.5;
  }
  if (cfg.motionBlurSamples !== undefined) {
    projectMotionBlurSamples = parseInt(cfg.motionBlurSamples) || 6;
  }
  if (cfg.globalMotionBlur !== undefined) {
    isGlobalMotionBlurEnabled = !!cfg.globalMotionBlur;
  }
  const btnMbD = document.getElementById('btnToggleGlobalMotionBlurDesktop');
  const btnMbM = document.getElementById('btnToggleGlobalMotionBlurMobile');
  if (btnMbD) btnMbD.classList.toggle('active', isGlobalMotionBlurEnabled);
  if (btnMbM) btnMbM.classList.toggle('active', isGlobalMotionBlurEnabled);

  const canvasWrap = document.getElementById('canvasWrap');
  const canvasScreen = document.getElementById('canvasScreen');
  const canvasVideo = document.getElementById('canvasVideo');
  const previewCanvas = document.getElementById('previewCanvas');
  const specBadge = document.getElementById('projectSpecBadge');

  if (specBadge) {
    specBadge.textContent = `${projectResolution} \u2022 ${projectRatio} \u2022 ${projectFps} FPS`;
  }

  const ratioMap = {
    '9:16': '9 / 16',
    '16:9': '16 / 9',
    '1:1': '1 / 1',
    '4:3': '4 / 3',
    '4:5': '4 / 5',
    'custom': `${projectCustomWidth} / ${projectCustomHeight}`
  };
  const aspectCss = ratioMap[projectRatio] || '9 / 16';
  // numeric ratio w/h for container-query flexible contain
  let ratioNum = 9/16;
  if (projectRatio === '16:9') ratioNum = 16/9;
  else if (projectRatio === '1:1') ratioNum = 1;
  else if (projectRatio === '4:3') ratioNum = 4/3;
  else if (projectRatio === '4:5') ratioNum = 4/5;
  else if (projectRatio === 'custom') ratioNum = (projectCustomWidth||1080)/(projectCustomHeight||1080);
  else if (projectRatio === '9:16') ratioNum = 9/16;

  if (canvasWrap) {
    canvasWrap.style.aspectRatio = aspectCss;
    canvasWrap.style.setProperty('--canvas-ratio', String(ratioNum));
    canvasWrap.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }
  if (canvasScreen) {
    canvasScreen.style.aspectRatio = aspectCss;
    canvasScreen.style.setProperty('--canvas-ratio', String(ratioNum));
    canvasScreen.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }
  if (canvasVideo) {
    canvasVideo.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }
  if (previewCanvas) {
    previewCanvas.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }

  const titleEl = document.getElementById('activeTitle') || document.querySelector('.nav-title');
  if (titleEl && cfg.name) {
    titleEl.textContent = cfg.name;
  }

  if (scene3D && typeof THREE !== 'undefined') {
    if (projectBgColor === 'transparent') {
      scene3D.background = null;
    } else {
      scene3D.background = new THREE.Color(projectBgColor);
    }
  }
  if (renderer3D && typeof THREE !== 'undefined') {
    if (projectBgColor === 'transparent') {
      renderer3D.setClearColor(0x000000, 0.0);
    } else {
      renderer3D.setClearColor(new THREE.Color(projectBgColor), 1.0);
    }
  }

  const activeName = (titleEl && titleEl.textContent.trim()) || sessionStorage.getItem('activeProject') || 'My Project';
  const updatedCfg = {
    id: currentProjectId,
    name: activeName,
    ratio: projectRatio,
    resolution: projectResolution,
    fps: projectFps,
    backgroundColor: projectBgColor,
    customWidth: projectCustomWidth,
    customHeight: projectCustomHeight,
    motionBlurTune: projectMotionBlurTune,
    motionBlurSamples: projectMotionBlurSamples,
    globalMotionBlur: isGlobalMotionBlurEnabled
  };
  sessionStorage.setItem('projectConfig', JSON.stringify(updatedCfg));
  sessionStorage.setItem('activeProject', activeName);

  if (typeof recomputeFitScale === 'function') recomputeFitScale();
  if (typeof updateCanvasScale === 'function') updateCanvasScale();
  if (typeof updateEncoderUI === 'function') updateEncoderUI();

  updateCanvasDimensions();
}

function updateCanvasDimensions() {
  const stage = document.getElementById('previewStage');
  const canvasWrap = document.getElementById('canvasWrap');
  const canvasScreen = document.getElementById('canvasScreen');
  const canvasVideo = document.getElementById('canvasVideo');
  if (!stage || !canvasWrap) return;

  const ratioMap = {
    '9:16': '9 / 16',
    '16:9': '16 / 9',
    '1:1': '1 / 1',
    '4:3': '4 / 3',
    '4:5': '4 / 5',
    'custom': `${projectCustomWidth || 1080} / ${projectCustomHeight || 1080}`
  };
  const aspectCss = ratioMap[projectRatio] || '9 / 16';

  let ratioNum = 9/16;
  if (projectRatio === '16:9') ratioNum = 16/9;
  else if (projectRatio === '1:1') ratioNum = 1;
  else if (projectRatio === '4:3') ratioNum = 4/3;
  else if (projectRatio === '4:5') ratioNum = 4/5;
  else if (projectRatio === 'custom') ratioNum = (projectCustomWidth || 1080) / (projectCustomHeight || 1080);
  else if (projectRatio === '9:16') ratioNum = 9/16;

  const isDesktop = window.innerWidth >= 768;
  const padX = isDesktop ? 48 : 24;
  const padY = isDesktop ? 96 : 32;

  const availW = Math.max(120, stage.clientWidth - padX);
  const availH = Math.max(120, stage.clientHeight - padY);

  let targetW, targetH;
  if (availW / availH > ratioNum) {
    targetH = Math.round(availH);
    targetW = Math.round(targetH * ratioNum);
  } else {
    targetW = Math.round(availW);
    targetH = Math.round(targetW / ratioNum);
  }

  canvasWrap.style.width = `${targetW}px`;
  canvasWrap.style.height = `${targetH}px`;
  canvasWrap.style.aspectRatio = aspectCss;
  canvasWrap.style.setProperty('--canvas-ratio', String(ratioNum));
  canvasWrap.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;

  if (canvasScreen) {
    canvasScreen.style.width = '100%';
    canvasScreen.style.height = '100%';
    canvasScreen.style.aspectRatio = aspectCss;
    canvasScreen.style.setProperty('--canvas-ratio', String(ratioNum));
    canvasScreen.style.backgroundColor = projectBgColor === 'transparent' ? 'transparent' : projectBgColor;
  }

  if (canvasVideo && renderer3D && camera3D) {
    camera3D.aspect = ratioNum;
    camera3D.updateProjectionMatrix();
    renderer3D.setSize(targetW, targetH);
    render3D();
    renderCanvasOverlay();
  }
}

function initThreeEngine() {
  const container = document.getElementById('canvasVideo');
  if (!container || typeof THREE === 'undefined') return;

  scene3D = new THREE.Scene();
  if (projectBgColor === 'transparent') {
    scene3D.background = null;
  } else {
    scene3D.background = new THREE.Color(projectBgColor);
  }

  let ratioNum = 9/16;
  if (projectRatio === '16:9') ratioNum = 16/9;
  else if (projectRatio === '1:1') ratioNum = 1;
  else if (projectRatio === '4:3') ratioNum = 4/3;
  else if (projectRatio === '4:5') ratioNum = 4/5;
  else if (projectRatio === 'custom') ratioNum = (projectCustomWidth || 1080) / (projectCustomHeight || 1080);

  camera3D = new THREE.PerspectiveCamera(45, ratioNum, 0.1, 1000);
  camera3D.position.set(0, 0, 5);

  renderer3D = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer3D.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (projectBgColor === 'transparent') {
    renderer3D.setClearColor(0x000000, 0.0);
  } else {
    renderer3D.setClearColor(new THREE.Color(projectBgColor), 1.0);
  }
  renderer3D.domElement.style.width = '100%';
  renderer3D.domElement.style.height = '100%';
  renderer3D.domElement.style.display = 'block';

  container.innerHTML = '';
  container.appendChild(renderer3D.domElement);

  const amb = new THREE.AmbientLight(0xffffff, 1.2);
  scene3D.add(amb);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene3D.add(dir);

  window.addEventListener('resize', () => {
    updateCanvasDimensions();
  });

  updateCanvasDimensions();
  syncThreeLayers();
  renderCanvasOverlay();
  render3D();
}

let mbSubTarget = null;
let mbTargetA = null;
let mbTargetB = null;
let mbAccumScene = null;
let mbAccumCamera = null;
let mbAccumMaterial = null;
let mbBlitScene = null;
let mbBlitCamera = null;
let mbBlitMaterial = null;

function initGpuAccumulator(w, h) {
  if (!mbSubTarget || mbSubTarget.width !== w || mbSubTarget.height !== h) {
    if (mbSubTarget) mbSubTarget.dispose();
    if (mbTargetA) mbTargetA.dispose();
    if (mbTargetB) mbTargetB.dispose();

    mbSubTarget = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    mbTargetA = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    mbTargetB = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }

  if (!mbAccumScene) {
    mbAccumScene = new THREE.Scene();
    mbAccumCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    mbAccumMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tAccum: { value: null },
        tNew: { value: null },
        uWeight: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tAccum;
        uniform sampler2D tNew;
        uniform float uWeight;
        varying vec2 vUv;
        void main() {
          vec4 acc = texture2D(tAccum, vUv);
          vec4 n = texture2D(tNew, vUv);
          gl_FragColor = mix(acc, n, uWeight);
        }
      `,
      depthTest: false,
      depthWrite: false
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mbAccumMaterial);
    mbAccumScene.add(quad);

    mbBlitScene = new THREE.Scene();
    mbBlitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    mbBlitMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
        }
      `,
      depthTest: false,
      depthWrite: false
    });
    const bQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mbBlitMaterial);
    mbBlitScene.add(bQuad);
  }
}

function applyActiveCameraPerspective(timeSec) {
  if (!camera3D) return { active: false };
  const t = (timeSec !== undefined) ? timeSec : elapsed;
  const rows = document.querySelectorAll('.track-row');
  let activeCamRow = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cat = r.dataset.category || '';
    const clipName = r.querySelector('.track-clip-name')?.textContent || '';
    if (cat === 'camera' || clipName.toLowerCase().startsWith('camera')) {
      const eyeBtn = r.querySelector('.track-eye');
      const isHidden = eyeBtn && eyeBtn.classList.contains('hidden');
      if (isHidden) continue;

      const clip = r.querySelector('.track-clip');
      if (!clip) continue;
      const m = parseFloat(clip.style.marginLeft) || 0;
      const w = parseFloat(clip.style.width) || 300;
      const pxPerSec = (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 100);
      const startSec = m / pxPerSec;
      const endSec = (m + w) / pxPerSec;

      if (t >= (startSec - 0.001) && t <= (endSec + 0.001)) {
        activeCamRow = r;
        break; // Topmost active camera
      }
    }
  }

  if (activeCamRow) {
    const camId = activeCamRow.dataset.layerId;
    const wt = getLayerWorldTransform(camId, new Set(), t);
    const cp = getLayerCameraParams(camId);

    const camPosX = wt.posX / 200;
    const camPosY = wt.posY / 200;
    const camPosZ = 5 + (wt.posZ / 200);

    const radX = (wt.rotX * Math.PI) / 180;
    const radY = (wt.rotY * Math.PI) / 180;
    const radZ = -(wt.rotZ * Math.PI) / 180;

    camera3D.position.set(camPosX, camPosY, camPosZ);
    camera3D.rotation.set(radX, radY, radZ);

    const baseFov = 45;
    const zoomFactor = ((cp.zoom || 100) / 100) * ((wt.scaleW !== undefined ? wt.scaleW : 100) / 100);
    camera3D.fov = Math.max(8, Math.min(120, baseFov / Math.max(0.08, zoomFactor)));
    camera3D.updateProjectionMatrix();

    applyDepthOfFieldBokeh({ active: true, camId, wt, cp, camPosX, camPosY, camPosZ }, t);
    return { active: true, camId, wt, cp, camPosX, camPosY, camPosZ };
  } else {
    // Default Front View (Original Camera Perspective)
    camera3D.position.set(0, 0, 5);
    camera3D.rotation.set(0, 0, 0);
    camera3D.fov = 45;
    camera3D.updateProjectionMatrix();
    applyDepthOfFieldBokeh({ active: false }, t);
    return { active: false };
  }
}

function applyDepthOfFieldBokeh(camInfo, timeSec) {
  if (!camInfo || !camInfo.active || !camInfo.cp || !camInfo.cp.bokehEnabled) {
    for (const [id, mesh] of meshLayerMap.entries()) {
      if (mesh && mesh.material) {
        if (mesh.userData && mesh.userData._currentBlurPx !== 0) {
          mesh.userData._currentBlurPx = 0;
          const sharpTex = getBlurredTextureForLayer(id, 0);
          if (sharpTex) {
            mesh.material.map = sharpTex;
            mesh.material.needsUpdate = true;
          }
        }
      }
    }
    return;
  }

  const { camPosX, camPosY, camPosZ, cp } = camInfo;
  const curTime = (timeSec !== undefined) ? timeSec : elapsed;

  // 1. Compute Focus Distance (in 3D units)
  let focusDist = 5.0; // Default focus distance (main canvas plane at Z=0)
  if (cp.focusMode === 'auto' && cp.focusTargetId) {
    const targetRow = document.querySelector(`.track-row[data-layer-id="${cp.focusTargetId}"]`);
    if (targetRow) {
      const wtTarget = getLayerWorldTransform(cp.focusTargetId, new Set(), curTime);
      const tx = wtTarget.posX / 200;
      const ty = wtTarget.posY / 200;
      const tz = wtTarget.posZ / 200;
      focusDist = Math.sqrt((camPosX - tx) ** 2 + (camPosY - ty) ** 2 + (camPosZ - tz) ** 2);
    }
  } else {
    // Manual focus distance: slider 0..2000 mapped to 0..10 Three.js units (1000px = 5.0 units)
    focusDist = Math.max(0.1, (cp.manualFocusDist !== undefined ? cp.manualFocusDist : 1000) / 200);
  }

  // 2. Compute Depth of Field Bokeh for each non-virtual layer mesh
  const falloff = Math.max(0.05, (cp.bokehRange || 60) / 100);
  const maxBlurPx = ((cp.bokehBlur !== undefined ? cp.bokehBlur : 50) / 100) * 26;

  const rows = document.querySelectorAll('.track-row');
  rows.forEach(row => {
    const id = row.dataset.layerId;
    if (!id || id === camInfo.camId) return;
    const cat = row.dataset.category || '';
    if (cat === 'camera' || cat === 'null' || layerVideoTextureMap.has(id)) return;

    const mesh = meshLayerMap.get(id);
    if (!mesh || !mesh.visible || !mesh.material) return;

    const mx = mesh.position.x;
    const my = mesh.position.y;
    const mz = mesh.position.z;
    const dist = Math.sqrt((camPosX - mx) ** 2 + (camPosY - my) ** 2 + (camPosZ - mz) ** 2);
    const delta = Math.abs(dist - focusDist);

    // If within deadzone, razor sharp
    const blurAmount = (delta < 0.05) ? 0 : Math.min(1.0, (delta - 0.05) / falloff);
    const blurPx = Math.round(blurAmount * maxBlurPx);

    mesh.userData = mesh.userData || {};
    if (mesh.userData._currentBlurPx !== blurPx) {
      mesh.userData._currentBlurPx = blurPx;
      const tex = getBlurredTextureForLayer(id, blurPx);
      if (tex) {
        mesh.material.map = tex;
        mesh.material.needsUpdate = true;
      }
    }
  });
}

const ghostCloneMap = new Map(); // layerId -> THREE.Mesh[]

function updateMotionBlurGhostClones(shutterDt, samples) {
  if (!scene3D) return;
  const rows = document.querySelectorAll('.track-row');

  // Hide or clean up ghost meshes for deleted layers
  const activeIds = new Set();
  rows.forEach(r => { if (r.dataset.layerId) activeIds.add(r.dataset.layerId); });
  for (const [id, ghosts] of ghostCloneMap.entries()) {
    if (!activeIds.has(id)) {
      ghosts.forEach(g => { scene3D.remove(g); if (g.material) g.material.dispose(); });
      ghostCloneMap.delete(id);
    }
  }

  if (!isGlobalMotionBlurEnabled) {
    ghostCloneMap.forEach(ghosts => ghosts.forEach(g => { g.visible = false; }));
    return;
  }

  rows.forEach((row, idx) => {
    const id = row.dataset.layerId;
    if (!id) return;
    const mesh = meshLayerMap.get(id);
    if (!mesh || !mesh.visible || !mesh.material) return;

    const isMbOn = layerMotionBlur.has(id) ? !!layerMotionBlur.get(id) : true;
    if (!isMbOn) {
      const existing = ghostCloneMap.get(id);
      if (existing) existing.forEach(g => { g.visible = false; });
      return;
    }

    const wt0 = getLayerWorldTransform(id, new Set(), Math.max(0, elapsed - shutterDt * 0.5));
    const wt1 = getLayerWorldTransform(id, new Set(), Math.min(totalDuration, elapsed + shutterDt * 0.5));
    const posDist = Math.hypot(wt1.posX - wt0.posX, wt1.posY - wt0.posY, wt1.posZ - wt0.posZ);
    const rotDist = Math.abs(wt1.rotX - wt0.rotX) + Math.abs(wt1.rotY - wt0.rotY) + Math.abs(wt1.rotZ - wt0.rotZ);
    const scaleDist = Math.abs(wt1.scaleW - wt0.scaleW) + Math.abs(wt1.scaleH - wt0.scaleH);
    const isMoving = (posDist > 0.04) || (rotDist > 0.04) || (scaleDist > 0.04);

    // If layer is stationary, hide ghost clones
    if (!isMoving) {
      const existing = ghostCloneMap.get(id);
      if (existing) existing.forEach(g => { g.visible = false; });
      return;
    }

    // Ensure pool has enough ghost clones
    let ghosts = ghostCloneMap.get(id);
    if (!ghosts) {
      ghosts = [];
      ghostCloneMap.set(id, ghosts);
    }

    while (ghosts.length < samples) {
      const gMat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending
      });
      const gMesh = new THREE.Mesh(mesh.geometry, gMat);
      scene3D.add(gMesh);
      ghosts.push(gMesh);
    }

    const wtCurrent = getLayerWorldTransform(id, new Set(), elapsed);
    const baseOp = (wtCurrent && wtCurrent.opacity !== undefined ? wtCurrent.opacity : 100) / 100;
    const fill = getLayerFill(id);
    const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
    const cat = row.dataset.category || 'media';
    const isVideoOrMedia = (cat === 'media' || cat === 'video' || (fill && fill.type === 'media') || (clipName && /\.(mp4|webm|mov|mkv|png|jpg|jpeg|webp)$/i.test(clipName)) || videoFrameSequenceMap.has(fill?.mediaUrl) || videoFrameSequenceMap.has(id) || videoFrameSequenceMap.has(clipName));

    let geomW = 4.0;
    let geomH = 4.0;
    if (isVideoOrMedia) {
      const aspect = getMediaAspectRatio(id, fill ? fill.mediaUrl : null);
      if (aspect >= 1) {
        geomW = 4.0;
        geomH = 4.0 / aspect;
      } else {
        geomW = 4.0 * aspect;
        geomH = 4.0;
      }
    }

    const order = rows.length - idx;

    for (let s = 0; s < samples; s++) {
      const gMesh = ghosts[s];
      const sNorm = (samples > 1) ? (s / (samples - 1)) - 0.5 : 0;
      const subTime = Math.max(0, Math.min(totalDuration, elapsed + sNorm * shutterDt));
      const wtSub = getLayerWorldTransform(id, new Set(), subTime);

      const activeMap = mesh.material.map || layerFrameTextureMap.get(id) || layerVideoTextureMap.get(id);
      gMesh.geometry = mesh.geometry;
      if (gMesh.material.map !== activeMap) {
        gMesh.material.map = activeMap;
        gMesh.material.needsUpdate = true;
      }
      gMesh.material.color.copy(mesh.material.color);
      gMesh.material.side = THREE.DoubleSide;
      gMesh.renderOrder = 0;

      gMesh.position.x = wtSub.posX / 200;
      gMesh.position.y = wtSub.posY / 200;
      gMesh.position.z = wtSub.posZ / 200 + (order * 0.0001);

      gMesh.rotation.z = -(wtSub.rotZ * Math.PI) / 180;
      gMesh.rotation.x = (wtSub.rotX * Math.PI) / 180;
      gMesh.rotation.y = (wtSub.rotY * Math.PI) / 180;

      gMesh.scale.x = ((wtSub.scaleW !== undefined ? wtSub.scaleW : 100) / 100) * (geomW / 4.0);
      gMesh.scale.y = ((wtSub.scaleH !== undefined ? wtSub.scaleH : 100) / 100) * (geomH / 4.0);
      gMesh.scale.z = 1.0;

      // Bell curve opacity distribution across the shutter window
      const weight = Math.exp(-Math.pow(sNorm * 2.0, 2));
      const sampleScale = Math.max(0.6, Math.min(1.2, 10 / samples));
      gMesh.material.opacity = Math.min(1.0, baseOp * 0.36 * weight * sampleScale);
      gMesh.visible = true;
    }

    // Hide extra ghosts if sample count was reduced
    for (let s = samples; s < ghosts.length; s++) {
      ghosts[s].visible = false;
    }
  });
}

function render3D() {
  if (!renderer3D || !scene3D || !camera3D) return;

  const fps = Number(projectFps) || 30;
  const tune = Number(projectMotionBlurTune) || 1.2;
  const samples = Math.max(8, projectMotionBlurSamples || 12);
  const shutterDt = (tune / fps);

  // 1. Update After Effects ghost clones along the motion path
  updateMotionBlurGhostClones(shutterDt, samples);

  // 2. Position all primary layers at current playhead time
  const rows = document.querySelectorAll('.track-row');
  rows.forEach(row => {
    const id = row.dataset.layerId;
    if (!id) return;
    const mesh = meshLayerMap.get(id);
    if (!mesh || !mesh.material) return;
    const wt = getLayerWorldTransform(id, new Set(), elapsed);
    applyTransformToThreeMesh(id, wt);
    mesh.visible = true;
    mesh.material.opacity = (wt && wt.opacity !== undefined ? wt.opacity : 100) / 100;
  });

  applyActiveCameraPerspective(elapsed);

  renderer3D.setRenderTarget(null);
  renderer3D.autoClear = true;
  renderer3D.render(scene3D, camera3D);

  if (!playing) requestCanvasOverlayRender();
}

function createMotionBlurMaterial() {
  const notReadyTex = (typeof getNotReadyVideoTexture === 'function') ? getNotReadyVideoTexture() : null;
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color('#FFFFFF'),
    map: notReadyTex,
    transparent: true,
    opacity: 1.0,
    depthWrite: true,
    depthTest: true,
    alphaTest: 0.02,
    side: THREE.DoubleSide
  });
}

function syncThreeLayers() {
  if (!scene3D) return;
  const rows = document.querySelectorAll('.track-row');
  const activeIds = new Set();

  rows.forEach((row, idx) => {
    let id = row.dataset.layerId;
    if (!id) {
      id = 'layer_' + idx + '_' + Math.random().toString(36).substr(2, 5);
      row.dataset.layerId = id;
    }
    activeIds.add(id);

    const cat = row.dataset.category || 'media';
    const clipName = row.querySelector('.track-clip-name')?.textContent || '';
    const isVirtual = (cat === 'camera' || cat === 'null' || clipName.toLowerCase().startsWith('camera') || clipName.toLowerCase().startsWith('null'));
    const clip = row.querySelector('.track-clip');
    const eye = row.querySelector('.track-eye');
    const isHidden = eye && eye.querySelector('.material-symbols-rounded') && eye.querySelector('.material-symbols-rounded').textContent.trim() === 'visibility_off';

    const startSec = clip ? (parseFloat(clip.style.marginLeft) || 0) / PX_PER_SEC : 0;
    const durSec = clip ? (parseFloat(clip.style.width) || 300) / PX_PER_SEC : 5;
    const endSec = startSec + durSec;
    const isVisibleNow = !isVirtual && !isHidden && elapsed >= startSec && elapsed <= endSec;

    let mesh = meshLayerMap.get(id);
    if (!mesh) {
      // Plane lebih besar (4.0) biar stroke/shadow bisa keluar wireframe bebas, tidak ke-crop kotak
      const geom = new THREE.PlaneGeometry(4.0, 4.0);
      const mat = createMotionBlurMaterial();
      mesh = new THREE.Mesh(geom, mat);
      const zOffset = (rows.length - idx) * 0.0001;
      mesh.position.set(0, (idx - (rows.length / 2)) * 0.25, zOffset);
      meshLayerMap.set(id, mesh);
      scene3D.add(mesh);
      // Apply fill, stroke, and shadow immediately
      applyFillToMeshGlobal(id);
    }

    mesh.visible = isVisibleNow;

    const t = getLayerTransform(id);
    if (t) {
      applyTransformToThreeMesh(id, t);
    }
  });

  for (const [id, mesh] of meshLayerMap.entries()) {
    if (!activeIds.has(id)) {
      scene3D.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
      if (mesh.material && mesh.material.map) try{ mesh.material.map.dispose(); }catch(e){}
      meshLayerMap.delete(id);
      pendingTextureRenders.delete(id);
    }
  }

  render3D();
}

let playing        = false;
let elapsed        = 0;
let timelineOffset = 0;
let totalDuration  = 30;
let timer          = null;
let animFrameId    = null;
let indentIdx      = 0;

let PX_PER_SEC     = 80;

let markers        = [];

const undoStack    = [];
const redoStack    = [];

let isLowQuality = false;
let isGridOn     = false;
let zoomLevels   = [0.6, 0.8, 1.0, 1.25, 1.5, 1.8];
let zoomIndex    = 2;

const TRACK_TYPES = [
  { name: 'Overlay.png',    type: 'img' },
  { name: 'Effect.fx',      type: 'fx'  },
  { name: 'Voiceover.wav',  type: 'aud' },
  { name: 'Subtitles.srt',  type: 'sub' },
  { name: 'Background.mp4', type: 'vid' },
  { name: 'Music_BGM.mp3',  type: 'aud' }
];


// ══════════════════════════════════════════════════════════════
// TIMELINE ZOOM & WEBPAGE ZOOM PREVENTION ENGINE
// ══════════════════════════════════════════════════════════════
function zoomTimeline(factor) {
  const oldPxPerSec = PX_PER_SEC;
  const newPxPerSec = Math.max(25, Math.min(350, Math.round(oldPxPerSec * factor)));
  if (newPxPerSec === oldPxPerSec) return;

  const currentElapsed = elapsed;

  // 1. Scale all clip positions and widths proportionally
  const rows = document.querySelectorAll('.track-row');
  rows.forEach(row => {
    const clip = row.querySelector('.track-clip');
    if (clip) {
      const currentMargin = parseFloat(clip.style.marginLeft) || 0;
      const currentWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
      const startSec = currentMargin / oldPxPerSec;
      const durSec = currentWidth / oldPxPerSec;
      clip.style.marginLeft = `${Math.round(startSec * newPxPerSec)}px`;
      clip.style.width = `${Math.max(20, Math.round(durSec * newPxPerSec))}px`;
    }
  });

  PX_PER_SEC = newPxPerSec;
  document.documentElement.style.setProperty('--timeline-px-per-sec', `${PX_PER_SEC}px`);

  // 2. Update ruler, markers, playhead, and max timeline length
  renderAllKeyframeMarkers();
  calculateMaxDuration();
  rebuildTimeRuler(totalDuration);
  setTimelineOffset(currentElapsed * PX_PER_SEC);
}

function initTimelineZoomAndPreventWebZoom() {
  // A. Disable browser / webpage zoom via Ctrl + Wheel and Touchpad Pinch
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      // If the cursor is inside timeline area, zoom timeline instead
      const isOverTimeline = e.target.closest('#timelineRuler, #timeRulerMarks, .timeline-panel, .timeline-track-area, #timelineTracks, .track-row');
      if (isOverTimeline) {
        const zoomFactor = e.deltaY < 0 ? 1.12 : (1 / 1.12);
        zoomTimeline(zoomFactor);
      }
    }
  }, { passive: false });

  window.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

  // B. PC Scroll on Timeline Top Ruler to Stretch / Zoom Timeline
  const ruler = document.getElementById('timelineRuler') || document.getElementById('timeRulerMarks');
  if (ruler) {
    ruler.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const zoomFactor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
      zoomTimeline(zoomFactor);
    }, { passive: false });
  }

  // C. Touchpad / Touch Pinch on Timeline Track Container
  const timelinePanel = document.querySelector('.timeline-panel') || document.querySelector('.timeline-track-area') || document.getElementById('timelineTracks');
  if (timelinePanel) {
    let initialTouchDistance = null;

    timelinePanel.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 2) {
        initialTouchDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    timelinePanel.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length === 2 && initialTouchDistance !== null) {
        e.preventDefault();
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const ratio = currentDist / initialTouchDistance;
        if (Math.abs(ratio - 1.0) > 0.04) {
          zoomTimeline(ratio > 1 ? 1.06 : 0.94);
          initialTouchDistance = currentDist;
        }
      }
    }, { passive: false });

    timelinePanel.addEventListener('touchend', (e) => {
      if (!e.touches || e.touches.length < 2) {
        initialTouchDistance = null;
      }
    }, { passive: true });
  }
}


document.addEventListener('DOMContentLoaded', () => {
  initTimelineZoomAndPreventWebZoom();
  // Disable default browser contextmenu across app so custom right click works seamlessly
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  });

  const title = sessionStorage.getItem('activeProject') || 'My Project';
  const titleEl = document.getElementById('activeTitle');
  if (titleEl) {
    titleEl.textContent = title;
    
    titleEl.addEventListener('input', () => {
      const newTitle = titleEl.textContent.trim() || 'My Project';
      sessionStorage.setItem('activeProject', newTitle);
      triggerAutoSave();
    });

    titleEl.addEventListener('blur', () => {
      if (!titleEl.textContent.trim()) {
        titleEl.textContent = 'My Project';
        sessionStorage.setItem('activeProject', 'My Project');
      }
      triggerAutoSave();
    });

    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleEl.blur();
      }
    });
  }

  const topLayerNameEl = document.getElementById('topInspLayerName');
  if (topLayerNameEl) {
    topLayerNameEl.addEventListener('input', () => {
      if (selectedTrackRow) {
        const clipName = selectedTrackRow.querySelector('.track-clip-name');
        const newName = topLayerNameEl.textContent.trim() || 'Layer';
        if (clipName) {
          clipName.textContent = newName;
        }
        triggerAutoSave();
      }
    });

    topLayerNameEl.addEventListener('blur', () => {
      if (selectedTrackRow) {
        const clipName = selectedTrackRow.querySelector('.track-clip-name');
        if (!topLayerNameEl.textContent.trim()) {
          const fallback = selectedTrackRow.dataset.category ? (selectedTrackRow.dataset.category.charAt(0).toUpperCase() + selectedTrackRow.dataset.category.slice(1) + ' Layer') : 'Layer';
          topLayerNameEl.textContent = fallback;
          if (clipName) clipName.textContent = fallback;
        }
        triggerAutoSave();
      }
    });

    topLayerNameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        topLayerNameEl.blur();
      }
    });
  }

  try {
    const rawCfg = sessionStorage.getItem('projectConfig');
    if (rawCfg) {
      const cfg = JSON.parse(rawCfg);
      applyProjectConfig(cfg);
    }
  } catch (e) {
    console.warn('Could not parse project config', e);
  }

  const btnBack = document.querySelector('.btn-back');
  if (btnBack) btnBack.addEventListener('click', goBack);

  document.querySelectorAll('.btn-play-main').forEach(btn => {
    btn.addEventListener('click', togglePlayPause);
  });

  document.querySelectorAll('[title="Skip ke awal"], [title="Skip Previous"]').forEach(btn => {
    btn.addEventListener('click', skipPrevious);
  });

  document.querySelectorAll('[title="Skip ke akhir"], [title="Skip Next"]').forEach(btn => {
    btn.addEventListener('click', skipNext);
  });

  document.querySelectorAll('[title="Bookmark"]').forEach(btn => {
    btn.addEventListener('click', toggleMarkerAtCurrent);
  });

  document.querySelectorAll('[title="Undo"]').forEach(btn => {
    btn.addEventListener('click', undo);
  });

  document.querySelectorAll('[title="Redo"]').forEach(btn => {
    btn.addEventListener('click', redo);
  });

  const btnExport = document.querySelector('.btn-export');
  if (btnExport) btnExport.addEventListener('click', openMediaEncoder);

  const fabAdd = document.getElementById('fabAddTrack') || document.querySelector('.fab-add');
  const addTrackPopover = document.getElementById('addTrackPopover');
  const btnAddTrackClose = document.getElementById('btnAddTrackClose');

  if (fabAdd && addTrackPopover) {
    renderCategoryItems('shape');

    fabAdd.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = addTrackPopover.classList.toggle('active');
      fabAdd.classList.toggle('active', isActive);
    });

    if (btnAddTrackClose) {
      btnAddTrackClose.addEventListener('click', (e) => {
        e.stopPropagation();
        addTrackPopover.classList.remove('active');
        fabAdd.classList.remove('active');
      });
    }

    document.querySelectorAll('.cat-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.getAttribute('data-cat') || 'shape';
        renderCategoryItems(cat);
      });
    });

    document.addEventListener('click', (e) => {
      if (!addTrackPopover.contains(e.target) && !fabAdd.contains(e.target)) {
        addTrackPopover.classList.remove('active');
        fabAdd.classList.remove('active');
      }
    });
  }

  // Layer Link Popover (topBtnInspLink)
  const btnTopLink = document.getElementById('topBtnInspLink');
  if (btnTopLink) {
    btnTopLink.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const currentTrackId = selectedTrackRow.dataset.layerId;
      if (!currentTrackId) return;

      const project = getProjectFromDOM();
      const currentTrack = project.tracks.find(t => t.id === currentTrackId) || {
        id: currentTrackId,
        linkedTo: selectedTrackRow.dataset.linkedTo ? JSON.parse(selectedTrackRow.dataset.linkedTo) : []
      };

      const linkedParentId = (currentTrack.linkedTo && currentTrack.linkedTo[0]) || (selectedTrackRow.dataset.linkedTo ? JSON.parse(selectedTrackRow.dataset.linkedTo)[0] : null);

      // Render Popover DOM
      const card = document.createElement('div');
      card.className = 'fish-link-popover-card';

      const list = document.createElement('div');
      list.className = 'fish-link-list';

      // List all layers in exact timeline order
      const rows = document.querySelectorAll('.track-row');
      rows.forEach(r => {
        const trId = r.dataset.layerId;
        if (!trId) return;

        const isCurrent = (trId === currentTrackId);
        const isLinked = (linkedParentId === trId);

        const clip = r.querySelector('.track-clip');
        const trName = clip?.querySelector('.track-clip-name')?.textContent || r.dataset.category || `Layer ${trId}`;

        const item = document.createElement('div');
        item.className = 'fish-link-item' + (isCurrent ? ' disabled' : '') + (isLinked ? ' active' : '');

        item.innerHTML = `
          <span class="fish-link-name">${trName}</span>
          ${isLinked ? '<span class="material-symbols-rounded fish-link-check">check</span>' : ''}
        `;

        if (!isCurrent) {
          item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (isLinked) {
              // Toggle off / Unlink
              const childWorld = getLayerWorldTransform(currentTrackId);
              const childT = getLayerTransform(currentTrackId);
              childT.posX = Math.round(childWorld.posX * 100) / 100;
              childT.posY = Math.round(childWorld.posY * 100) / 100;
              childT.posZ = Math.round(childWorld.posZ * 100) / 100;
              childT.rotX = Math.round(childWorld.rotX * 100) / 100;
              childT.rotY = Math.round(childWorld.rotY * 100) / 100;
              childT.rotZ = Math.round(childWorld.rotZ * 100) / 100;
              childT.scaleW = Math.round(childWorld.scaleW * 100) / 100;
              childT.scaleH = Math.round(childWorld.scaleH * 100) / 100;

              currentTrack.linkedTo = [];
              delete selectedTrackRow.dataset.linkedTo;
              delete selectedTrackRow.dataset.parentBind;
              saveProjectToDOM(project);
              triggerAutoSave();

              btnTopLink.classList.remove('active');
              applyTransformToThreeMesh(currentTrackId, getLayerTransform(currentTrackId));
              syncControllerUI();
              requestCanvasOverlayRender();
            } else {
              // Link to target layer with bind pose
              const parentWorld = getLayerWorldTransform(trId);
              const childWorld = getLayerWorldTransform(currentTrackId);

              const childT = getLayerTransform(currentTrackId);
              childT.posX = Math.round(childWorld.posX * 100) / 100;
              childT.posY = Math.round(childWorld.posY * 100) / 100;
              childT.posZ = Math.round(childWorld.posZ * 100) / 100;
              childT.rotX = Math.round(childWorld.rotX * 100) / 100;
              childT.rotY = Math.round(childWorld.rotY * 100) / 100;
              childT.rotZ = Math.round(childWorld.rotZ * 100) / 100;
              childT.scaleW = Math.round(childWorld.scaleW * 100) / 100;
              childT.scaleH = Math.round(childWorld.scaleH * 100) / 100;

              const bindPose = {
                posX: Math.round(parentWorld.posX * 100) / 100,
                posY: Math.round(parentWorld.posY * 100) / 100,
                posZ: Math.round(parentWorld.posZ * 100) / 100,
                rotX: Math.round(parentWorld.rotX * 100) / 100,
                rotY: Math.round(parentWorld.rotY * 100) / 100,
                rotZ: Math.round(parentWorld.rotZ * 100) / 100,
                scaleW: Math.round(parentWorld.scaleW * 100) / 100,
                scaleH: Math.round(parentWorld.scaleH * 100) / 100
              };

              currentTrack.linkedTo = [trId];
              selectedTrackRow.dataset.linkedTo = JSON.stringify([trId]);
              selectedTrackRow.dataset.parentBind = JSON.stringify(bindPose);
              saveProjectToDOM(project);
              triggerAutoSave();

              btnTopLink.classList.add('active');
              applyTransformToThreeMesh(currentTrackId, childT);
              syncControllerUI();
              requestCanvasOverlayRender();
            }
            if (window.FishPopover) window.FishPopover.close();
          });
        }

        list.appendChild(item);
      });

      card.appendChild(list);

      // Show via Universal FishPopover
      if (window.FishPopover) {
        window.FishPopover.show({
          anchorElement: btnTopLink,
          content: card,
          className: 'fish-link-popover-wrapper',
          onClose: null
        });
      }
    });
  }

// Top Context Bar Buttons
  const btnTopBack = document.getElementById('topBtnInspBack');
  if (btnTopBack) {
    btnTopBack.addEventListener('click', (e) => {
      e.stopPropagation();
      deselectTrack();
    });
  }

  const btnTopDelete = document.getElementById('topBtnInspDelete');
  if (btnTopDelete) {
    btnTopDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSelectedTrack();
    });
  }

  const btnTopMotionBlur = document.getElementById('topBtnInspMotionBlur');
  if (btnTopMotionBlur) {
    btnTopMotionBlur.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cur = !!layerMotionBlur.get(id);
      layerMotionBlur.set(id, !cur);
      btnTopMotionBlur.classList.toggle('active', !cur);
      btnTopMotionBlur.title = !cur ? 'Motion Blur: ON' : 'Motion Blur: OFF';
      render3D();
      triggerAutoSave();
    });
  }

  const btnGlobalMbD = document.getElementById('btnToggleGlobalMotionBlurDesktop');
  if (btnGlobalMbD) {
    btnGlobalMbD.addEventListener('click', (e) => {
      e.stopPropagation();
      isGlobalMotionBlurEnabled = !isGlobalMotionBlurEnabled;
      btnGlobalMbD.classList.toggle('active', isGlobalMotionBlurEnabled);
      const btnM = document.getElementById('btnToggleGlobalMotionBlurMobile');
      if (btnM) btnM.classList.toggle('active', isGlobalMotionBlurEnabled);
      render3D();
      triggerAutoSave();
    });
  }

  const btnGlobalMbM = document.getElementById('btnToggleGlobalMotionBlurMobile');
  if (btnGlobalMbM) {
    btnGlobalMbM.addEventListener('click', (e) => {
      e.stopPropagation();
      isGlobalMotionBlurEnabled = !isGlobalMotionBlurEnabled;
      btnGlobalMbM.classList.toggle('active', isGlobalMotionBlurEnabled);
      const btnD = document.getElementById('btnToggleGlobalMotionBlurDesktop');
      if (btnD) btnD.classList.toggle('active', isGlobalMotionBlurEnabled);
      render3D();
      triggerAutoSave();
    });
  }

  const btnTopMore = document.getElementById('topBtnInspMore');
  const layerOptionsPopup = document.getElementById('layerOptionsPopup');
  if (btnTopMore && layerOptionsPopup) {
    btnTopMore.addEventListener('click', (e) => {
      e.stopPropagation();
      if (layerOptionsPopup.classList.contains('active')) {
        layerOptionsPopup.classList.remove('active');
        return;
      }

      // Reset all items to visible
      layerOptionsPopup.querySelectorAll('.pop-menu-item').forEach(item => {
        item.style.display = 'block';
        item.style.opacity = '1';
        item.style.pointerEvents = 'auto';
      });
      layerOptionsPopup.querySelectorAll('.pop-menu-divider').forEach(div => div.style.display = 'block');
      const colorSection = document.getElementById('popMenuColorSection');
      if (colorSection) {
        colorSection.style.display = 'flex';
        colorSection.classList.remove('hidden');
      }

      const pasteBtn = document.getElementById('popMenuPasteBtn');
      if (pasteBtn) {
        pasteBtn.style.opacity = clipboardLayerData ? '1' : '0.45';
        pasteBtn.style.pointerEvents = clipboardLayerData ? 'auto' : 'none';
      }

      const rect = btnTopMore.getBoundingClientRect();
      const popupW = 195;
      const left = Math.max(10, Math.min(window.innerWidth - popupW - 12, rect.right - popupW));
      const top = rect.bottom + 8;
      layerOptionsPopup.style.left = left + 'px';
      layerOptionsPopup.style.top = top + 'px';

      layerOptionsPopup.classList.add('active');
    });
  }

  document.addEventListener('click', (e) => {
    if (layerOptionsPopup && !layerOptionsPopup.contains(e.target) && e.target !== btnTopMore) {
      layerOptionsPopup.classList.remove('active');
    }
  });

  const timelinePanel = document.getElementById('timelinePanel');
  if (timelinePanel) {
    timelinePanel.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.track-row');
      openLayerContextMenu(e, r || null);
    });

    timelinePanel.addEventListener('dragover', (e) => {
      e.preventDefault();
      timelinePanel.classList.add('drag-over');
    });
    timelinePanel.addEventListener('dragleave', (e) => {
      e.preventDefault();
      timelinePanel.classList.remove('drag-over');
    });
    timelinePanel.addEventListener('drop', (e) => {
      e.preventDefault();
      timelinePanel.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImportedFiles(e.dataTransfer.files);
      }
    });
  }

  const tracksViewport = document.getElementById('tracksViewport');
  if (tracksViewport) {
    tracksViewport.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.track-row');
      openLayerContextMenu(e, r || null);
    });
  }

  const previewStage = document.getElementById('previewStage');
  if (previewStage) {
    previewStage.addEventListener('contextmenu', (e) => {
      openLayerContextMenu(e, selectedTrackRow || null);
    });

    let prevDownPos = { x: 0, y: 0 };
    let prevDownTime = 0;
    previewStage.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, .top-nav, .mobile-editor-controls, #layerInspectorDrawer, #layerTopContextBar, #layerOptionsPopup')) return;
      prevDownPos = { x: e.pageX, y: e.pageY };
      prevDownTime = performance.now();
    });

    previewStage.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, .top-nav, .mobile-editor-controls, #layerInspectorDrawer, #layerTopContextBar, #layerOptionsPopup')) return;
      const dx = Math.abs(e.pageX - prevDownPos.x);
      const dy = Math.abs(e.pageY - prevDownPos.y);

      // Single tap on preview background to deselect
      if (dx < 6 && dy < 6) {
        if (selectedTrackRow && !e.target.closest('.transform-handle, .rot-handle, .corner-handle, .edge-handle')) {
          deselectTrack();
        }
      }
    });
  }

  initLayerOptionsPopup();

  initMultiSelectControls();

  initPreviewControls();
  initProjectSettingsModal();

  initTrackRows();

  initTimelineScrollAndScrub();

  initThreeEngine();
  calculateMaxDuration();
  setTimelineOffset(0);
  updateUndoRedoUI();
  initMoveTransformController();
  initBorderShadowController();
  initEditShapeSubpanel();
  initCameraControlSubpanel();
  initExportModalEvents();
});

function goBack() {
  pausePlayback();
  window.location.href = 'index.html';
}

function handleLayerOptionAction(action) {
  if (action === 'paste') {
    pasteLayerFromClipboard();
    return;
  }

  if (!selectedTrackRow) return;
  const id = selectedTrackRow.dataset.layerId;
  if (!id) return;

  const t = getLayerTransform(id);

  // Compute composition aspect ratio & world screen bounds
  let aspect = 9 / 16;
  if (projectRatio === '16:9') aspect = 16 / 9;
  else if (projectRatio === '1:1') aspect = 1.0;
  else if (projectRatio === '4:5') aspect = 4 / 5;
  else if (projectRatio === '4:3') aspect = 4 / 3;
  else if (projectRatio === 'custom') {
    const cw = projectCustomWidth || 1080;
    const ch = projectCustomHeight || 1080;
    aspect = cw / ch;
  }

  // Three.js Camera distance 5.0, FOV 45 deg -> world screen height = 4.1421356
  const worldH = 4.1421356;
  const worldW = worldH * aspect;

  // Determine Layer Shape & Local Base Dimensions (same base as renderCanvasOverlay / renderLayerTexture)
  const cat = selectedTrackRow.dataset.category || 'media';
  let shapeType = selectedTrackRow.dataset.shapeType || '';
  if (!shapeType) {
    const clipName = selectedTrackRow.querySelector('.track-clip-name')?.textContent || '';
    const lower = (clipName + '_' + cat).toLowerCase();
    if (lower.includes('circle') || lower.includes('bulat')) shapeType = 'circle';
    else if (lower.includes('triangle') || lower.includes('segitiga')) shapeType = 'triangle';
    else if (lower.includes('round')) shapeType = 'round';
    else if (lower.includes('square') || lower.includes('kotak')) shapeType = 'square';
    else if (lower.includes('star') || lower.includes('bintang')) shapeType = 'star';
    else if (cat === 'shape') shapeType = 'square';
    else shapeType = 'media';
  }

  let sizeX = 100, sizeY = 100;
  if (typeof getLayerShapeParams === 'function') {
    const sp = getLayerShapeParams(id, shapeType === 'media' ? 'square' : shapeType);
    if (sp.sizeX !== undefined) sizeX = sp.sizeX;
    if (sp.sizeY !== undefined) sizeY = sp.sizeY;
  }

  const baseDim = 1.6;
  let baseW = baseDim;
  let baseH = baseDim;

  if (shapeType === 'media' || cat === 'media' || cat === 'video') {
    const aspect = getMediaAspectRatio(id);
    if (aspect >= 1) {
      baseW = baseDim;
      baseH = baseDim / aspect;
    } else {
      baseW = baseDim * aspect;
      baseH = baseDim;
    }
  }

  const shapeBaseW = baseW * (Math.abs(sizeX) / 100);
  const shapeBaseH = baseH * (Math.abs(sizeY) / 100);

  // Exact scale percentages to make this shape touch the composition boundaries 100%
  const stretchW = (worldW / shapeBaseW) * 100;
  const stretchH = (worldH / shapeBaseH) * 100;

  switch (action) {
    case 'copy': {
      copySelectedLayer();
      break;
    }
    case 'paste': {
      pasteLayerFromClipboard();
      break;
    }
    case 'duplicate': {
      duplicateSelectedLayer();
      break;
    }
    case 'delete': {
      deleteSelectedTrack();
      break;
    }
    case 'flip-h': {
      // Flip Horizontal: misal scale 100 jadi -100, -100 jadi 100
      const curW = (t.scaleW !== undefined && t.scaleW !== 0) ? t.scaleW : 100;
      t.scaleW = -curW;
      recordTransformChange(id, t);
      applyTransformToThreeMesh(id, t);
      syncControllerUI();
      render3D();
      break;
    }
    case 'flip-v': {
      // Flip Vertical: misal scale 100 jadi -100, -100 jadi 100
      const curH = (t.scaleH !== undefined && t.scaleH !== 0) ? t.scaleH : 100;
      t.scaleH = -curH;
      recordTransformChange(id, t);
      applyTransformToThreeMesh(id, t);
      syncControllerUI();
      render3D();
      break;
    }
    case 'fit-comp': {
      // FIT: Full Screen tapi keliatan semuanya, ga ke-crop apalagi ke-stretch (Uniform Scale)
      const fitScale = Math.min(stretchW, stretchH);
      const signW = (t.scaleW && t.scaleW < 0) ? -1 : 1;
      const signH = (t.scaleH && t.scaleH < 0) ? -1 : 1;
      t.posX = 0;
      t.posY = 0;
      t.posZ = 0;
      t.rotZ = 0;
      t.scaleW = Math.round(fitScale * signW * 10) / 10;
      t.scaleH = Math.round(fitScale * signH * 10) / 10;
      recordTransformChange(id, t);
      applyTransformToThreeMesh(id, t);
      syncControllerUI();
      render3D();
      break;
    }
    case 'fill-comp': {
      // FILL: Full Screen no stretch tapi ada yang ke-crop / keluar zona (Uniform Scale)
      const fillScale = Math.max(stretchW, stretchH);
      const signW = (t.scaleW && t.scaleW < 0) ? -1 : 1;
      const signH = (t.scaleH && t.scaleH < 0) ? -1 : 1;
      t.posX = 0;
      t.posY = 0;
      t.posZ = 0;
      t.rotZ = 0;
      t.scaleW = Math.round(fillScale * signW * 10) / 10;
      t.scaleH = Math.round(fillScale * signH * 10) / 10;
      recordTransformChange(id, t);
      applyTransformToThreeMesh(id, t);
      syncControllerUI();
      render3D();
      break;
    }
    case 'stretch-comp': {
      // STRETCH: Full Screen stretched, mengubah scale W dan H memenuhi 100% batas layar
      const signW = (t.scaleW && t.scaleW < 0) ? -1 : 1;
      const signH = (t.scaleH && t.scaleH < 0) ? -1 : 1;
      t.posX = 0;
      t.posY = 0;
      t.posZ = 0;
      t.rotZ = 0;
      t.scaleW = Math.round(stretchW * signW * 10) / 10;
      t.scaleH = Math.round(stretchH * signH * 10) / 10;
      recordTransformChange(id, t);
      applyTransformToThreeMesh(id, t);
      syncControllerUI();
      render3D();
      break;
    }
  }
}

let clipboardLayerData = null;

function copySelectedLayer(row) {
  const targetRow = row || selectedTrackRow;
  if (!targetRow) return;
  const id = targetRow.dataset.layerId;
  if (!id) return;

  const cat = targetRow.dataset.category || 'media';
  const shapeType = targetRow.dataset.shapeType || '';
  const clip = targetRow.querySelector('.track-clip');
  const clipName = targetRow.querySelector('.track-clip-name')?.textContent.trim() || 'Layer';
  const tagColor = targetRow.dataset.tagColor || 'none';

  const w = clip ? parseFloat(clip.style.width) || 300 : 300;
  const m = clip ? parseFloat(clip.style.marginLeft) || 0 : 0;

  clipboardLayerData = {
    category: cat,
    shapeType: shapeType,
    name: clipName,
    tagColor: tagColor,
    width: w,
    marginLeft: m,
    transform: JSON.parse(JSON.stringify(getLayerTransform(id))),
    keyframes: JSON.parse(JSON.stringify(layerKeyframes.get(id) || [])),
    fill: JSON.parse(JSON.stringify(getLayerFill(id) || { type: 'color', color: '#FAB778' })),
    borderShadow: JSON.parse(JSON.stringify(getLayerBorderShadow(id) || {})),
    shapeParams: JSON.parse(JSON.stringify(layerShapeParams.get(id) || {})),
    cameraParams: JSON.parse(JSON.stringify(layerCameraParams.get(id) || {})),
    motionBlur: !!layerMotionBlur.get(id)
  };
}

function duplicateSelectedLayer(row) {
  const targetRow = row || selectedTrackRow;
  if (!targetRow) return;
  copySelectedLayer(targetRow);
  pasteLayerFromClipboard(true, targetRow);
}

function pasteLayerFromClipboard(isDuplicate = false, insertAfterRow = null) {
  if (!clipboardLayerData) return;

  const data = clipboardLayerData;
  const newId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  const container = document.getElementById('trackRowsContainer');
  if (!container) return;

  const baseName = data.name || 'Layer';
  const newName = isDuplicate ? `${baseName} Copy` : `${baseName}`;

  const row = document.createElement('div');
  row.className = 'track-row adding';
  row.dataset.category = data.category || 'media';
  row.dataset.layerId = newId;
  if (data.shapeType) row.dataset.shapeType = data.shapeType;
  if (data.tagColor && data.tagColor !== 'none') row.dataset.tagColor = data.tagColor;

  const isAudio = (data.category === 'audio');
  const defaultEyeIcon = isAudio ? 'volume_up' : 'visibility';

  let m = data.marginLeft;
  if (!isDuplicate) {
    m = Math.max(0, Math.round(elapsed * PX_PER_SEC));
  }
  const w = data.width || 300;

  const tagStyle = (data.tagColor && data.tagColor !== 'none') ? `border-left: 5px solid ${data.tagColor};` : '';

  row.innerHTML = `
    <button class="track-eye" title="${isAudio ? 'Mute / Unmute Audio' : 'Toggle Visibility'} / Tahan untuk Multi-Select">
      <span class="material-symbols-rounded">${isMultiSelectMode ? 'radio_button_unchecked' : defaultEyeIcon}</span>
    </button>
    <div class="track-trackway" style="transform: translateX(-${timelineOffset}px);">
      <div class="track-clip" style="width: ${w}px; margin-left: ${m}px; ${tagStyle}" title="Klik untuk pilih / buka menu layer">
        <div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </div>
        <span class="track-clip-name">${newName}</span>
        <div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    </div>
    <button class="track-reorder-handle" title="Tahan & geser untuk atur urutan layer (Reorder)">
      <span class="material-symbols-rounded">menu</span>
    </button>
  `;

  if (insertAfterRow && insertAfterRow.parentNode === container) {
    container.insertBefore(row, insertAfterRow.nextSibling);
  } else {
    container.insertBefore(row, container.firstChild);
  }

  // Clone data stores
  layerTransforms.set(newId, JSON.parse(JSON.stringify(data.transform)));
  layerKeyframes.set(newId, JSON.parse(JSON.stringify(data.keyframes)));
  layerFills.set(newId, JSON.parse(JSON.stringify(data.fill)));
  layerBorderShadow.set(newId, JSON.parse(JSON.stringify(data.borderShadow)));
  layerShapeParams.set(newId, JSON.parse(JSON.stringify(data.shapeParams)));
  layerCameraParams.set(newId, JSON.parse(JSON.stringify(data.cameraParams)));
  layerMotionBlur.set(newId, data.motionBlur);

  bindTrackEvents(row);
  setTimeout(() => row.classList.remove('adding'), 300);
  syncThreeLayers();
  applyFillToMeshGlobal(newId);
  selectTrack(row);
  calculateMaxDuration();
  triggerAutoSave();
}

function openLayerContextMenu(e, targetRow) {
  e.preventDefault();
  e.stopPropagation();

  const popup = document.getElementById('layerOptionsPopup');
  if (!popup) return;

  const allItems = popup.querySelectorAll('.pop-menu-item');
  const allDividers = popup.querySelectorAll('.pop-menu-divider');
  const colorSection = document.getElementById('popMenuColorSection');

  if (targetRow) {
    selectTrack(targetRow);

    allItems.forEach(item => {
      item.style.display = 'block';
      item.style.opacity = '1';
      item.style.pointerEvents = 'auto';
    });
    allDividers.forEach(div => div.style.display = 'block');
    if (colorSection) {
      colorSection.style.display = 'flex';
      colorSection.classList.remove('hidden');
    }

    const pasteBtn = document.getElementById('popMenuPasteBtn');
    if (pasteBtn) {
      pasteBtn.style.opacity = clipboardLayerData ? '1' : '0.45';
      pasteBtn.style.pointerEvents = clipboardLayerData ? 'auto' : 'none';
    }
  } else {
    // Empty area right-click: Show Copy, Paste, Duplicate (HIDE color section)
    allItems.forEach(item => {
      const act = item.dataset.action;
      if (act === 'copy' || act === 'duplicate') {
        item.style.display = 'block';
        item.style.opacity = selectedTrackRow ? '1' : '0.45';
        item.style.pointerEvents = selectedTrackRow ? 'auto' : 'none';
      } else if (act === 'paste') {
        item.style.display = 'block';
        item.style.opacity = clipboardLayerData ? '1' : '0.45';
        item.style.pointerEvents = clipboardLayerData ? 'auto' : 'none';
      } else {
        item.style.display = 'none';
      }
    });
    allDividers.forEach(div => div.style.display = 'none');
    if (colorSection) {
      colorSection.style.display = 'none';
      colorSection.classList.add('hidden');
    }
  }

  popup.classList.add('active');

  const mouseX = e.clientX || 100;
  const mouseY = e.clientY || 100;

  const popupW = 195;
  const popupH = targetRow ? 295 : 105;

  const left = Math.max(10, Math.min(window.innerWidth - popupW - 12, mouseX));
  const top = Math.max(10, Math.min(window.innerHeight - popupH - 12, mouseY));

  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

function handleLayerColorTag(color) {
  if (!selectedTrackRow) return;
  if (typeof pushUndoState === 'function') {
    pushUndoState();
  }
  const row = selectedTrackRow;
  row.dataset.tagColor = color;

  const clip = row.querySelector('.track-clip');
  if (clip) {
    if (color === 'none' || !color) {
      clip.style.borderLeft = '';
    } else {
      clip.style.borderLeft = `5px solid ${color}`;
    }
  }

  document.querySelectorAll('.color-tag-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.color === color);
  });

  triggerAutoSave();
}

function initLayerOptionsPopup() {
  const popup = document.getElementById('layerOptionsPopup');
  if (!popup) return;

  popup.addEventListener('click', (e) => {
    const item = e.target.closest('.pop-menu-item');
    const colorBtn = e.target.closest('.color-tag-btn');

    if (item) {
      const action = item.dataset.action;
      handleLayerOptionAction(action);
      popup.classList.remove('active');
    } else if (colorBtn) {
      const color = colorBtn.dataset.color;
      handleLayerColorTag(color);
      popup.classList.remove('active');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) {
      return;
    }
    if (e.key === 'Escape') {
      if (isMultiSelectMode) {
        exitMultiSelectMode();
      } else if (selectedTrackRow) {
        deselectTrack();
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (isMultiSelectMode && selectedMultiRows.size > 0) {
        const btnDeleteBatch = document.getElementById('btnDeleteSelectedBatch');
        if (btnDeleteBatch) btnDeleteBatch.click();
      } else if (selectedTrackRow) {
        deleteSelectedTrack();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      if (selectedTrackRow) {
        e.preventDefault();
        copySelectedLayer();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      if (clipboardLayerData) {
        e.preventDefault();
        pasteLayerFromClipboard();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      if (selectedTrackRow) {
        e.preventDefault();
        duplicateSelectedLayer();
      }
    }
  });
}

function calculateMaxDuration() {
  let maxPx = 0;
  document.querySelectorAll('.track-row').forEach(row => {
    const clip = row.querySelector('.track-clip');
    if (clip) {
      const margin = parseFloat(clip.style.marginLeft) || 0;
      let width    = parseFloat(clip.style.width);
      if (!width || isNaN(width)) {
        width = clip.offsetWidth || 300;
      }
      const endPx  = margin + width;
      if (endPx > maxPx) maxPx = endPx;
    }
  });

  maxPx = Math.max(200, maxPx);
  totalDuration = Math.ceil(maxPx / PX_PER_SEC);
  rebuildTimeRuler(totalDuration);
  renderTimecode();
  return totalDuration;
}

function rebuildTimeRuler(maxSecs) {
  const rulerMarks = document.getElementById('timeRulerMarks');
  if (!rulerMarks) return;

  rulerMarks.innerHTML = '';
  rulerMarks.style.minWidth = `${maxSecs * PX_PER_SEC + 600}px`;

  const wrapper = document.createElement('div');
  wrapper.className = 'ruler-marks-wrapper';
  wrapper.id = 'rulerMarksWrapper';

  // Determine dynamic time step interval based on current zoom level
  let stepSec = 1.0;
  if (PX_PER_SEC >= 220) {
    stepSec = 0.25;
  } else if (PX_PER_SEC >= 115) {
    stepSec = 0.5;
  } else if (PX_PER_SEC >= 55) {
    stepSec = 1.0;
  } else if (PX_PER_SEC >= 28) {
    stepSec = 2.0;
  } else {
    stepSec = 5.0;
  }

  const stepPx = stepSec * PX_PER_SEC;

  for (let s = 0; s <= maxSecs; s = Math.round((s + stepSec) * 100) / 100) {
    const timeText = (typeof formatTime === 'function') ? formatTime(s) : `${s}`;
    const span = document.createElement('span');
    span.className = 'ruler-mark';
    span.style.width = `${stepPx}px`;
    span.innerHTML = `<span class="ruler-mark-text">${timeText}</span>`;
    wrapper.appendChild(span);
  }

  markers.forEach(sec => {
    if (sec <= maxSecs) {
      renderMarkerPin(sec, wrapper);
    }
  });

  rulerMarks.appendChild(wrapper);
}

function renderMarkerPin(sec, container) {
  const targetContainer = container || document.getElementById('rulerMarksWrapper') || document.getElementById('timeRulerMarks');
  if (!targetContainer) return;

  const pin = document.createElement('div');
  pin.className = 'timeline-marker-pin';
  pin.dataset.second = sec;
  pin.style.left = `${sec * PX_PER_SEC}px`;
  pin.title = `Marker: ${formatTime(sec)} (Klik untuk melompat ke titik ini)`;
  pin.innerHTML = `
    <div class="marker-diamond"></div>
    <div class="marker-line"></div>
  `;

  pin.addEventListener('click', (e) => {
    e.stopPropagation();
    setTimelineOffset(sec * PX_PER_SEC);
  });

  targetContainer.appendChild(pin);
}

function toggleMarkerAtCurrent() {
  const curSec = Math.round((timelineOffset / PX_PER_SEC) * 10) / 10;
  const existingIdx = markers.findIndex(m => Math.abs(m - curSec) <= 0.25);

  if (existingIdx >= 0) {
    const removedSec = markers[existingIdx];
    markers.splice(existingIdx, 1);
    rebuildTimeRuler(totalDuration);
    updateMarkerButtonsUI(false);
    recordAction({
      type: 'REMOVE_MARKER',
      second: removedSec
    });
  } else {
    markers.push(curSec);
    markers.sort((a, b) => a - b);
    rebuildTimeRuler(totalDuration);
    updateMarkerButtonsUI(true);
    recordAction({
      type: 'ADD_MARKER',
      second: curSec
    });
  }
}

function removeMarker(sec) {
  const idx = markers.findIndex(m => Math.abs(m - sec) <= 0.25);
  if (idx >= 0) {
    const removedSec = markers[idx];
    markers.splice(idx, 1);
    rebuildTimeRuler(totalDuration);
    updateMarkerButtonsUI(false);
    recordAction({
      type: 'REMOVE_MARKER',
      second: removedSec
    });
  }
}

function updateMarkerButtonsUI(isActive) {
  document.querySelectorAll('[title="Bookmark"]').forEach(btn => {
    btn.classList.toggle('btn-marker-active', isActive);
  });
}

function skipPrevious() {
  const cur = elapsed;
  const stops = new Set([0]);
  markers.forEach(m => stops.add(m));

  if (selectedTrackRow) {
    const id = selectedTrackRow.dataset.layerId;
    if (id) {
      const kfs = layerKeyframes.get(id) || [];
      kfs.forEach(k => stops.add(k.time));
      const clip = selectedTrackRow.querySelector('.track-clip');
      if (clip) {
        const startSec = (parseFloat(clip.style.marginLeft) || 0) / PX_PER_SEC;
        const durSec = (parseFloat(clip.style.width) || 300) / PX_PER_SEC;
        stops.add(startSec);
        stops.add(startSec + durSec);
      }
    }
  }

  const prevStops = Array.from(stops).filter(s => s < cur - 0.05).sort((a, b) => a - b);
  if (prevStops.length > 0) {
    const target = prevStops[prevStops.length - 1];
    setTimelineOffset(target * PX_PER_SEC);
  } else {
    setTimelineOffset(0);
  }
}

function skipNext() {
  const cur = elapsed;
  const maxSec = calculateMaxDuration();
  const stops = new Set([maxSec]);
  markers.forEach(m => stops.add(m));

  if (selectedTrackRow) {
    const id = selectedTrackRow.dataset.layerId;
    if (id) {
      const kfs = layerKeyframes.get(id) || [];
      kfs.forEach(k => stops.add(k.time));
      const clip = selectedTrackRow.querySelector('.track-clip');
      if (clip) {
        const startSec = (parseFloat(clip.style.marginLeft) || 0) / PX_PER_SEC;
        const durSec = (parseFloat(clip.style.width) || 300) / PX_PER_SEC;
        stops.add(startSec);
        stops.add(startSec + durSec);
      }
    }
  }

  const nextStops = Array.from(stops).filter(s => s > cur + 0.05).sort((a, b) => a - b);
  if (nextStops.length > 0) {
    const target = nextStops[0];
    setTimelineOffset(target * PX_PER_SEC);
  } else {
    setTimelineOffset(maxSec * PX_PER_SEC);
  }
}

const videoSeekStates = new Map(); // layerId -> { pendingTime: number|null, isSeeking: boolean }

function requestVideoSeek(layerId, video, targetTime) {
  let state = videoSeekStates.get(layerId);
  if (!state) {
    state = { pendingTime: null, isSeeking: false };
    videoSeekStates.set(layerId, state);

    const onFrameDecoded = () => {
      state.isSeeking = false;
      const vTex = layerVideoTextureMap.get(layerId);
      if (vTex) vTex.needsUpdate = true;
      render3D();

      if (state.pendingTime !== null) {
        const next = state.pendingTime;
        state.pendingTime = null;
        seek(next);
      }
    };

    video.addEventListener('seeked', onFrameDecoded);
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      try {
        const hookVfc = () => {
          video.requestVideoFrameCallback(() => {
            onFrameDecoded();
            if (state.isSeeking) hookVfc();
          });
        };
        video.addEventListener('seeking', hookVfc);
      } catch(e) {}
    }
  }

  function seek(t) {
    state.isSeeking = true;
    if (typeof video.fastSeek === 'function') {
      try {
        video.fastSeek(t);
        return;
      } catch(e) {}
    }
    video.currentTime = t;
  }

  if (state.isSeeking || video.seeking) {
    state.pendingTime = targetTime;
  } else {
    if (Math.abs(video.currentTime - targetTime) > 0.033) {
      seek(targetTime);
    }
  }
}

function setTimelineOffset(newOffset, isScrubbing = false) {
  const maxOffset = totalDuration * PX_PER_SEC;
  timelineOffset = Math.max(0, Math.min(maxOffset, newOffset));
  const fps = Number(projectFps) || 30;
  const rawElapsed = timelineOffset / PX_PER_SEC;
  elapsed = Math.round(rawElapsed * fps) / fps;
  renderTimecode();

  const rulerMarks = document.getElementById('timeRulerMarks');
  if (rulerMarks) {
    rulerMarks.style.transform = `translateX(-${timelineOffset}px)`;
  }

  document.querySelectorAll('.track-trackway').forEach(tw => {
    tw.style.transform = `translateX(-${timelineOffset}px)`;
  });

  if (!playing) {
    const isAtMarker = markers.some(m => Math.abs(m - elapsed) <= 0.25);
    updateMarkerButtonsUI(isAtMarker);
  }

  document.querySelectorAll('.track-row').forEach(row => {
    const id = row.dataset.layerId;
    if (id) {
      applyTransformToThreeMesh(id, getLayerTransform(id));
      const fill = getLayerFill(id);
      const cat = row.dataset.category;
      const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
      if (cat === 'video' || (fill && fill.type === 'media' && (videoFrameSequenceMap.has(fill.mediaUrl) || videoFrameSequenceMap.has(id) || (clipName && videoFrameSequenceMap.has(clipName))))) {
        applyFillToMeshGlobal(id);
      }
    }
  });

  if (selectedTrackRow && !playing) {
    updateInspectorQuickButtons();
    syncControllerUI();
  }

  if (!isScrubbing) {
    try {
      document.querySelectorAll('.track-row').forEach(row => {
        const id = row.dataset.layerId;
        if (!id) return;
        const skfs = layerKeyframes.get(id);
        if (skfs && skfs.some(k=>k.strokeSize!==undefined||k.strokeColor!==undefined||k.shadowSize!==undefined||k.shadowAlpha!==undefined||k.shadowPosX!==undefined||k.shadowPosY!==undefined||k.shadowColor!==undefined)) {
          applyFillToMeshGlobal(id);
        }
      });
    } catch(e) {}

    if (isMultiSelectMode && !playing) {
      updateMultiSelectQuickButtons();
    }

    if (!playing) {
      renderAllKeyframeMarkers();
    }
  }

  const pg = document.getElementById('panelGraphEditor');
  if (pg && pg.style.display !== 'none') {
    renderGraphCanvas();
  }

  syncThreeLayers();
  render3D();
  syncAudioPlayback();
  syncVideoPlayback(isScrubbing);
}

const layerAudioMap = new Map(); // layerId -> HTMLAudioElement
const layerVideoMap = new Map(); // layerId -> HTMLVideoElement

function syncAudioPlayback() {
  const rows = document.querySelectorAll('.track-row');
  rows.forEach(row => {
    const layerId = row.dataset.layerId;
    const cat = row.dataset.category;
    const clip = row.querySelector('.track-clip');
    if (!clip || !layerId) return;

    const fill = getLayerFill(layerId);
    const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';

    let audioUrl = null;
    const isVideoTrack = (cat === 'video') || (clipName && /\.(mp4|webm|mov|mkv|avi)$/i.test(clipName));
    if (cat === 'audio') {
      audioUrl = fill ? fill.mediaUrl : null;
    } else if (isVideoTrack) {
      const seq = (fill && fill.mediaUrl && videoFrameSequenceMap.get(fill.mediaUrl)) || videoFrameSequenceMap.get(layerId) || (clipName && videoFrameSequenceMap.get(clipName));
      if (seq && seq.audioUrl) {
        audioUrl = seq.audioUrl;
      } else if (fill && fill.mediaUrl && !fill.mediaUrl.startsWith('video_pkg_') && !fill.mediaUrl.startsWith('pkg_') && (fill.mediaUrl.startsWith('data:video/') || /\.(mp4|webm|mov|mkv)$/i.test(fill.mediaUrl))) {
        audioUrl = fill.mediaUrl;
      }
    }

    const isValidAudioUri = typeof audioUrl === 'string' && audioUrl.length > 5 && !audioUrl.startsWith('video_pkg_') && !audioUrl.startsWith('pkg_') && !audioUrl.startsWith('[') && (audioUrl.startsWith('http://') || audioUrl.startsWith('https://') || audioUrl.startsWith('blob:') || audioUrl.startsWith('data:audio/') || audioUrl.startsWith('data:video/'));

    if (!isValidAudioUri) {
      const existingAudio = layerAudioMap.get(layerId);
      if (existingAudio && !existingAudio.paused) {
        existingAudio.pause();
      }
      return;
    }

    let audio = layerAudioMap.get(layerId);
    if (!audio || audio.src !== audioUrl) {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src"); try { audio.load(); } catch(_) {}
      }
      audio = new Audio(audioUrl);
      audio.preload = 'auto';
      layerAudioMap.set(layerId, audio);
    }

    const eye = row.querySelector('.track-eye .material-symbols-rounded');
    const isMuted = eye && (eye.textContent.trim() === 'volume_off' || eye.textContent.trim() === 'visibility_off');

    const marginLeft = parseFloat(clip.style.marginLeft) || 0;
    const width = parseFloat(clip.style.width) || clip.offsetWidth || 300;
    const startTime = marginLeft / PX_PER_SEC;
    const clipDuration = width / PX_PER_SEC;

    audio.muted = !!isMuted;

    const inRange = (elapsed >= startTime && elapsed < startTime + clipDuration);
    const currentAudioTime = Math.max(0, elapsed - startTime);

    if (playing && inRange && !isMuted) {
      if (Math.abs(audio.currentTime - currentAudioTime) > 0.25) {
        audio.currentTime = currentAudioTime;
      }
      if (audio.paused) {
        audio.play().catch(() => {});
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
      if (!playing && Math.abs(audio.currentTime - currentAudioTime) > 0.05) {
        audio.currentTime = currentAudioTime;
      }
    }
  });
}

function syncVideoPlayback(isScrubbing = false) {
  const rows = document.querySelectorAll('.track-row');
  rows.forEach(row => {
    const layerId = row.dataset.layerId;
    const cat = row.dataset.category || 'media';
    const clip = row.querySelector('.track-clip');
    if (!clip || !layerId) return;

    const fill = getLayerFill(layerId);
    if (!fill || fill.type !== 'media' || !fill.mediaUrl) return;

    const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
    const seq = videoFrameSequenceMap.get(fill.mediaUrl) || videoFrameSequenceMap.get(layerId) || (clipName && videoFrameSequenceMap.get(clipName));
    if (seq && seq.frames && seq.frames.length > 0) {
      applyFillToMeshGlobal(layerId);
      return;
    }

    const isVideo = (cat === 'video') || (clipName && /\.(mp4|webm|mov|mkv|ogg|avi)$/i.test(clipName)) || (fill.mediaType && fill.mediaType.startsWith('video')) || (fill.mediaUrl && fill.mediaUrl.startsWith('data:video/'));
    if (!isVideo) return;

    let video = layerVideoMap.get(layerId);
    if (!video || video.src !== fill.mediaUrl) {
      if (video) {
        video.pause();
        video.removeAttribute("src"); try { video.load(); } catch(_) {}
      }
      video = document.createElement('video');
      video.src = fill.mediaUrl;
      video.crossOrigin = 'anonymous';
      video.playsInline = true;
      video.muted = false;
      video.preload = 'auto';
      layerVideoMap.set(layerId, video);
    }

    const eye = row.querySelector('.track-eye .material-symbols-rounded');
    const isHiddenOrMuted = eye && (eye.textContent.trim() === 'visibility_off' || eye.textContent.trim() === 'volume_off');

    const marginLeft = parseFloat(clip.style.marginLeft) || 0;
    const width = parseFloat(clip.style.width) || clip.offsetWidth || 300;
    const startTime = marginLeft / PX_PER_SEC;
    const clipDuration = width / PX_PER_SEC;

    video.muted = !!isHiddenOrMuted;

    const inRange = (elapsed >= startTime && elapsed < startTime + clipDuration);
    const currentVideoTime = Math.max(0, elapsed - startTime);

    if (playing && inRange && !isHiddenOrMuted) {
      if (Math.abs(video.currentTime - currentVideoTime) > 0.15) {
        video.currentTime = currentVideoTime;
      }
      if (video.paused) {
        video.play().catch(() => {});
      }
      applyFillToMeshGlobal(layerId);
    } else {
      if (!video.paused) {
        video.pause();
      }
      if (isScrubbing) {
        requestVideoSeek(layerId, video, currentVideoTime);
      } else {
        if (Math.abs(video.currentTime - currentVideoTime) > 0.04) {
          requestVideoSeek(layerId, video, currentVideoTime);
        }
      }
    }
  });
}

function togglePlayPause() {
  playing ? pausePlayback() : startPlayback();
}

function startPlayback() {
  const maxSec = calculateMaxDuration();
  if (elapsed >= maxSec) {
    setTimelineOffset(0);
  }

  playing = true;
  setPlayIcons('pause');

  const video = document.getElementById('canvasVideo');
  if (video && typeof video.play === 'function') {
    video.play().catch(() => {});
  }

  syncAudioPlayback();
  syncVideoPlayback();

  let lastNow = performance.now();
  let frameAccumulator = 0;

  function tick(now) {
    if (!playing) return;
    const dt = (now - lastNow) / 1000;
    lastNow = now;

    frameAccumulator += dt;
    const targetFps = projectFps || 30;
    const frameDuration = 1 / targetFps;

    if (frameAccumulator >= frameDuration) {
      const framesToAdvance = Math.floor(frameAccumulator / frameDuration);
      frameAccumulator -= framesToAdvance * frameDuration;

      const currentFrame = Math.round(elapsed * targetFps);
      const nextFrame = currentFrame + framesToAdvance;
      const maxFrames = Math.ceil(totalDuration * targetFps);

      if (nextFrame >= maxFrames) {
        setTimelineOffset(totalDuration * PX_PER_SEC);
        pausePlayback();
        return;
      }

      const nextSec = nextFrame / targetFps;
      setTimelineOffset(nextSec * PX_PER_SEC);
    }

    animFrameId = requestAnimationFrame(tick);
  }

  animFrameId = requestAnimationFrame(tick);
}

function pausePlayback() {
  playing = false;
  setPlayIcons('play_arrow');
  if (animFrameId) cancelAnimationFrame(animFrameId);
  const video = document.getElementById('canvasVideo');
  if (video && typeof video.pause === 'function') {
    video.pause();
  }
  layerAudioMap.forEach(audio => {
    if (!audio.paused) audio.pause();
  });
}

function setPlayIcons(iconName) {
  document.querySelectorAll('.play-icon').forEach(icon => {
    icon.textContent = iconName;
  });
}

function formatTime(s) {
  const totalFrames = Math.floor((s || 0) * projectFps);
  const frame = totalFrames % projectFps;
  const totalSecs = Math.floor(s || 0);
  const m = String(Math.floor(totalSecs / 60)).padStart(2, '0');
  const sec = String(totalSecs % 60).padStart(2, '0');
  const f = String(frame).padStart(2, '0');
  return `${m}:${sec}:${f}`;
}

function renderTimecode() {
  const display = document.getElementById('timecodeDisplay');
  if (display) {
    display.textContent = formatTime(elapsed);
  }
}

function captureProjectSnapshot() {
  const tracks = [];
  document.querySelectorAll('.track-row').forEach(row => {
    const clip = row.querySelector('.track-clip');
    const clipName = row.querySelector('.track-clip-name');
    const eyeBtn = row.querySelector('.track-eye');
    const isHidden = eyeBtn && eyeBtn.querySelector('.material-symbols-rounded') && eyeBtn.querySelector('.material-symbols-rounded').textContent.trim() === 'visibility_off';

    tracks.push({
      layerId: row.dataset.layerId,
      category: row.dataset.category || 'media',
      name: (clipName && clipName.textContent.trim()) || 'Layer',
      colorTag: row.dataset.tagColor || 'none',
      isMask: row.dataset.isMask === 'true',
      marginLeft: parseFloat(clip ? clip.style.marginLeft : 0) || 0,
      width: parseFloat(clip ? clip.style.width : 300) || (clip ? clip.offsetWidth : 300) || 300,
      isHidden: !!isHidden,
      isLinked: row.classList.contains('linked-parent'),
      linkedTo: row.dataset.linkedTo ? JSON.parse(row.dataset.linkedTo) : [],
      parentBind: row.dataset.parentBind ? JSON.parse(row.dataset.parentBind) : null,
      linkedFrom: row.dataset.linkedFrom ? JSON.parse(row.dataset.linkedFrom) : [],
      dataset: { ...row.dataset }
    });
  });

  return {
    tracks,
    transforms: Array.from(layerTransforms.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]),
    keyframes: Array.from(layerKeyframes.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]),
    fills: Array.from(layerFills.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]),
    borderShadows: Array.from(layerBorderShadow.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]),
    shapeParams: Array.from(layerShapeParams.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]),
    cameraParams: Array.from(layerCameraParams.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]),
    motionBlurs: Array.from(layerMotionBlur.entries()),
    markers: [...markers],
    isGlobalMotionBlurEnabled,
    projectMotionBlurTune,
    projectMotionBlurSamples,
    selectedLayerId: selectedTrackRow ? selectedTrackRow.dataset.layerId : null,
    isMultiSelectMode: !!isMultiSelectMode,
    selectedMultiRowIds: Array.from(selectedMultiRows).map(r => r.dataset.layerId).filter(Boolean)
  };
}

function restoreProjectSnapshot(snapshot) {
  if (!snapshot) return;

  // 1. Restore state Maps
  layerTransforms.clear();
  if (snapshot.transforms) {
    snapshot.transforms.forEach(([k, v]) => layerTransforms.set(k, JSON.parse(JSON.stringify(v))));
  }

  layerKeyframes.clear();
  if (snapshot.keyframes) {
    snapshot.keyframes.forEach(([k, v]) => layerKeyframes.set(k, JSON.parse(JSON.stringify(v))));
  }

  layerFills.clear();
  if (snapshot.fills) {
    snapshot.fills.forEach(([k, v]) => layerFills.set(k, JSON.parse(JSON.stringify(v))));
  }

  layerBorderShadow.clear();
  if (snapshot.borderShadows) {
    snapshot.borderShadows.forEach(([k, v]) => layerBorderShadow.set(k, JSON.parse(JSON.stringify(v))));
  }

  layerShapeParams.clear();
  if (snapshot.shapeParams) {
    snapshot.shapeParams.forEach(([k, v]) => layerShapeParams.set(k, JSON.parse(JSON.stringify(v))));
  }

  layerCameraParams.clear();
  if (snapshot.cameraParams) {
    snapshot.cameraParams.forEach(([k, v]) => layerCameraParams.set(k, JSON.parse(JSON.stringify(v))));
  }

  layerMotionBlur.clear();
  if (snapshot.motionBlurs) {
    snapshot.motionBlurs.forEach(([k, v]) => layerMotionBlur.set(k, v));
  }

  if (snapshot.markers) {
    markers = [...snapshot.markers];
  }

  if (snapshot.isGlobalMotionBlurEnabled !== undefined) {
    isGlobalMotionBlurEnabled = snapshot.isGlobalMotionBlurEnabled;
    const btnD = document.getElementById('btnToggleGlobalMotionBlurDesktop');
    const btnM = document.getElementById('btnToggleGlobalMotionBlurMobile');
    if (btnD) btnD.classList.toggle('active', isGlobalMotionBlurEnabled);
    if (btnM) btnM.classList.toggle('active', isGlobalMotionBlurEnabled);
  }

  if (snapshot.projectMotionBlurTune !== undefined) {
    projectMotionBlurTune = snapshot.projectMotionBlurTune;
  }
  if (snapshot.projectMotionBlurSamples !== undefined) {
    projectMotionBlurSamples = snapshot.projectMotionBlurSamples;
  }

  // 2. Efficient DOM Track Sync (Zero-Flicker & Preserves Event Listeners)
  const container = document.getElementById('trackRowsContainer');
  if (container && snapshot.tracks) {
    const currentRows = Array.from(container.querySelectorAll('.track-row'));
    const currentIds = currentRows.map(r => r.dataset.layerId);
    const snapIds = snapshot.tracks.map(t => t.layerId);

    const idsMatch = (currentIds.length === snapIds.length) && currentIds.every((id, idx) => id === snapIds[idx]);

    if (idsMatch) {
      // In-place update: update properties without tearing down DOM elements
      snapshot.tracks.forEach((tr, i) => {
        const row = currentRows[i];
        row.dataset.tagColor = tr.colorTag || 'none';
        row.dataset.isMask = tr.isMask ? 'true' : 'false';
        row.classList.toggle('is-mask-layer', !!tr.isMask);
        row.classList.toggle('linked-parent', !!tr.isLinked);

        const clip = row.querySelector('.track-clip');
        if (clip) {
          clip.style.width = `${tr.width}px`;
          clip.style.marginLeft = `${tr.marginLeft}px`;
          if (tr.colorTag && tr.colorTag !== 'none') {
            clip.style.borderLeft = `5px solid ${tr.colorTag}`;
          } else {
            clip.style.borderLeft = '';
          }
        }
        const nameEl = row.querySelector('.track-clip-name');
        if (nameEl && tr.name) nameEl.textContent = tr.name;

        const eye = row.querySelector('.track-eye .material-symbols-rounded');
        if (eye && !isMultiSelectMode) {
          const isAudio = tr.category === 'audio';
          eye.textContent = tr.isHidden ? (isAudio ? 'volume_off' : 'visibility_off') : (isAudio ? 'volume_up' : 'visibility');
        }
        const tw = row.querySelector('.track-trackway');
        if (tw) {
          tw.style.transform = `translateX(-${timelineOffset}px)`;
          tw.style.opacity = tr.isHidden ? '0.35' : '1';
        }
      });
    } else {
      // Rebuild tracks only when layers were actually added, removed or reordered
      container.innerHTML = '';
      snapshot.tracks.forEach(tr => {
        const row = document.createElement('div');
        row.className = 'track-row' + (tr.isLinked ? ' linked-parent' : '') + (tr.isMask ? ' is-mask-layer' : '');
        row.dataset.layerId = tr.layerId;
        row.dataset.category = tr.category || 'media';
        row.dataset.tagColor = tr.colorTag || 'none';
        if (tr.dataset) {
          Object.keys(tr.dataset).forEach(k => { row.dataset[k] = tr.dataset[k]; });
        }
        if (tr.linkedTo && tr.linkedTo.length > 0) row.dataset.linkedTo = JSON.stringify(tr.linkedTo);
        if (tr.parentBind) row.dataset.parentBind = JSON.stringify(tr.parentBind);
        if (tr.linkedFrom && tr.linkedFrom.length > 0) row.dataset.linkedFrom = JSON.stringify(tr.linkedFrom);

        const isMulti = isMultiSelectMode;
        const tagStyle = (tr.colorTag && tr.colorTag !== 'none') ? `border-left: 5px solid ${tr.colorTag};` : '';
        const isAudio = tr.category === 'audio';
        const defaultEye = isAudio ? 'volume_up' : 'visibility';
        const hiddenEye = isAudio ? 'volume_off' : 'visibility_off';

        row.innerHTML = `
          <button class="track-eye" title="Toggle Visibility / Tahan untuk Multi-Select">
            <span class="material-symbols-rounded">${isMulti ? 'radio_button_unchecked' : (tr.isHidden ? hiddenEye : defaultEye)}</span>
          </button>
          <div class="track-trackway" style="transform: translateX(-${timelineOffset}px);${tr.isHidden ? ' opacity: 0.35;' : ''}">
            <div class="track-clip" style="width: ${tr.width}px; margin-left: ${tr.marginLeft}px; ${tagStyle}" title="Klik untuk pilih / buka menu layer">
              <div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </div>
              <span class="track-clip-name">${tr.name}</span>
              <div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>
          </div>
          <button class="track-reorder-handle" title="Tahan & geser untuk atur urutan layer (Reorder)">
            <span class="material-symbols-rounded">menu</span>
          </button>
        `;
        bindTrackEvents(row);
        container.appendChild(row);
      });
    }
  }

  // 3. Selection & Multi-Select sync
  if (snapshot.isMultiSelectMode) {
    if (!isMultiSelectMode) {
      isMultiSelectMode = true;
      document.body.classList.add('multi-select-mode');
    }
    selectedMultiRows.clear();
    document.querySelectorAll('.track-row').forEach(r => {
      r.classList.remove('multi-selected');
      const eye = r.querySelector('.track-eye .material-symbols-rounded');
      if (eye) eye.textContent = 'radio_button_unchecked';
    });
    if (snapshot.selectedMultiRowIds) {
      snapshot.selectedMultiRowIds.forEach(id => {
        const r = document.querySelector(`.track-row[data-layer-id="${id}"]`);
        if (r) {
          selectedMultiRows.add(r);
          r.classList.add('multi-selected');
          const eye = r.querySelector('.track-eye .material-symbols-rounded');
          if (eye) eye.textContent = 'check_circle';
        }
      });
    }
    updateMultiSelectUI();
  } else {
    if (isMultiSelectMode) {
      exitMultiSelectMode();
    }
    if (snapshot.selectedLayerId) {
      const rowToSelect = document.querySelector(`.track-row[data-layer-id="${snapshot.selectedLayerId}"]`);
      if (rowToSelect && rowToSelect !== selectedTrackRow) {
        selectTrack(rowToSelect);
      }
    } else if (selectedTrackRow) {
      deselectTrack();
    }
  }

  // 4. Update Engine, 3D Mesh, Fills, Keyframes, Overlay
  syncThreeLayers();
  layerFills.forEach((_, fid) => {
    if (typeof applyFillToMeshGlobal === 'function') applyFillToMeshGlobal(fid);
  });
  rebuildTimeRuler(totalDuration);
  renderAllKeyframeMarkers();
  updateKeyframeUI();
  syncControllerUI();
  if (typeof syncBorderShadowUI === 'function') syncBorderShadowUI();
  calculateMaxDuration();
  render3D();
  renderCanvasOverlay();
  triggerAutoSave();
}

let _isGestureActive = false;

// After Effects Style Undo Group Engine
let _undoGroupDepth = 0;
let _undoGroupInitialSnapshot = null;

function beginUndoGroup(name = 'Operation') {
  if (_undoGroupDepth === 0) {
    _undoGroupInitialSnapshot = captureProjectSnapshot();
  }
  _undoGroupDepth++;
}

function endUndoGroup() {
  if (_undoGroupDepth > 0) {
    _undoGroupDepth--;
    if (_undoGroupDepth === 0 && _undoGroupInitialSnapshot) {
      undoStack.push(_undoGroupInitialSnapshot);
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
      _undoGroupInitialSnapshot = null;
      updateUndoRedoUI();
      triggerAutoSave();
    }
  }
}

function executeWithUndoGroup(name, fn) {
  beginUndoGroup(name);
  try {
    fn();
  } finally {
    endUndoGroup();
  }
}

function pushUndoState() {
  if (_undoGroupDepth > 0) return;
  undoStack.push(captureProjectSnapshot());
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  updateUndoRedoUI();
}

function recordAction(action) {
  if (_undoGroupDepth === 0) {
    pushUndoState();
    triggerAutoSave();
  }
}

function updateUndoRedoUI() {
  const hasUndo = (undoStack.length > 0);
  const hasRedo = (redoStack.length > 0);

  const undoSelectors = ['[title="Undo"]', '#btnUndoDesktop', '#btnUndoMobile', '.undo-btn'];
  undoSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(btn => {
      btn.disabled = !hasUndo;
      btn.style.opacity = hasUndo ? '1.0' : '0.4';
      btn.style.pointerEvents = hasUndo ? 'auto' : 'none';
      btn.classList.toggle('disabled', !hasUndo);
    });
  });

  const redoSelectors = ['[title="Redo"]', '#btnRedoDesktop', '#btnRedoMobile', '.redo-btn'];
  redoSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(btn => {
      btn.disabled = !hasRedo;
      btn.style.opacity = hasRedo ? '1.0' : '0.4';
      btn.style.pointerEvents = hasRedo ? 'auto' : 'none';
      btn.classList.toggle('disabled', !hasRedo);
    });
  });
}

function undo() {
  if (undoStack.length === 0) return;
  const current = captureProjectSnapshot();
  redoStack.push(current);
  if (redoStack.length > 60) redoStack.shift();

  const prev = undoStack.pop();
  restoreProjectSnapshot(prev);
  updateUndoRedoUI();
}

function redo() {
  if (redoStack.length === 0) return;
  const current = captureProjectSnapshot();
  undoStack.push(current);
  if (undoStack.length > 60) undoStack.shift();

  const next = redoStack.pop();
  restoreProjectSnapshot(next);
  updateUndoRedoUI();
}

let isProgrammaticScrolling = false;

function initTimelineScrollAndScrub() {
  const viewport = document.getElementById('tracksViewport');
  const timecode = document.getElementById('timecodeDisplay');
  if (!viewport) return;

  let isDown = false;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let startScrollTop = 0;
  let downTimestamp = 0;
  let isRowTarget = false;
  let scrubRafId = null;
  let pendingScrubOffset = null;

  function scheduleScrub(offset) {
    pendingScrubOffset = offset;
    if (!scrubRafId) {
      scrubRafId = requestAnimationFrame(() => {
        scrubRafId = null;
        if (pendingScrubOffset !== null) {
          setTimelineOffset(pendingScrubOffset, true);
        }
      });
    }
  }

  viewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, .track-eye, .track-del-btn, .timeline-marker-pin, .clip-extend-handle, .clip-keyframe-marker, .clip-keyframes-container, .layer-options-popup')) return;

    isDown = true;
    viewport.classList.add('is-dragging');
    startX = e.pageX;
    startY = e.pageY;
    startOffset = timelineOffset;
    startScrollTop = viewport.scrollTop;
    downTimestamp = performance.now();
    isRowTarget = !!e.target.closest('.track-clip');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const dx = e.pageX - startX;
    const dy = e.pageY - startY;

    scheduleScrub(startOffset - dx);

    if (!selectedTrackRow) {
      viewport.scrollTop = startScrollTop - dy;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isDown) {
      const dx = Math.abs(e.pageX - startX);
      const dy = Math.abs(e.pageY - startY);

      isDown = false;
      viewport.classList.remove('is-dragging');

      if (scrubRafId) {
        cancelAnimationFrame(scrubRafId);
        scrubRafId = null;
      }
      setTimelineOffset(timelineOffset, false);

      // If single click on empty timeline area or trackway space without dragging
      if (!isRowTarget && dx < 6 && dy < 6) {
        if (selectedTrackRow) {
          deselectTrack();
        }
      }
    }
  });

  viewport.addEventListener('touchstart', (e) => {
    if (e.target.closest('button, .track-eye, .track-del-btn, .timeline-marker-pin, .clip-extend-handle, .clip-keyframe-marker, .clip-keyframes-container, .layer-options-popup')) return;
    const touch = e.touches[0];
    isDown = true;
    startX = touch.pageX;
    startY = touch.pageY;
    startOffset = timelineOffset;
    startScrollTop = viewport.scrollTop;
    downTimestamp = performance.now();
    isRowTarget = !!e.target.closest('.track-clip');
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (!isDown) return;
    const touch = e.touches[0];
    const dx = touch.pageX - startX;
    const dy = touch.pageY - startY;

    scheduleScrub(startOffset - dx);

    if (!selectedTrackRow) {
      viewport.scrollTop = startScrollTop - dy;
    }
  }, { passive: true });

  viewport.addEventListener('touchend', (e) => {
    if (isDown) {
      const touch = e.changedTouches ? e.changedTouches[0] : null;
      const curX = touch ? touch.pageX : startX;
      const curY = touch ? touch.pageY : startY;
      const dx = Math.abs(curX - startX);
      const dy = Math.abs(curY - startY);

      isDown = false;

      if (scrubRafId) {
        cancelAnimationFrame(scrubRafId);
        scrubRafId = null;
      }
      setTimelineOffset(timelineOffset, false);

      // If single tap on empty area on touch
      if (!isRowTarget && dx < 8 && dy < 8) {
        if (selectedTrackRow) {
          deselectTrack();
        }
      }
    }
  });

  viewport.addEventListener('wheel', (e) => {
    if (selectedTrackRow || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      setTimelineOffset(timelineOffset + (e.deltaX || e.deltaY));
    } else {
      viewport.scrollTop += e.deltaY;
    }
  }, { passive: false });

  if (timecode) {
    timecode.addEventListener('click', () => {
      setTimelineOffset(timelineOffset + 5 * PX_PER_SEC);
    });
  }
}

function initPreviewControls() {
  const desktopMenuBtn = document.getElementById('btnDesktopMenu');
  const desktopPopover = document.getElementById('desktopMenuPopover');

  const mobileMenuBtn  = document.getElementById('btnMobileMenu');
  const mobilePopover  = document.getElementById('mobileMenuPopover');

  if (desktopMenuBtn && desktopPopover) {
    desktopMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = desktopPopover.classList.toggle('active');
      desktopMenuBtn.classList.toggle('active', isActive);
    });
  }

  if (mobileMenuBtn && mobilePopover) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = mobilePopover.classList.toggle('active');
      mobileMenuBtn.classList.toggle('active', isActive);
    });
  }

  document.addEventListener('click', (e) => {
    if (desktopPopover && !desktopPopover.contains(e.target) && !desktopMenuBtn?.contains(e.target)) {
      desktopPopover.classList.remove('active');
      desktopMenuBtn?.classList.remove('active');
    }
    if (mobilePopover && !mobilePopover.contains(e.target) && !mobileMenuBtn?.contains(e.target)) {
      mobilePopover.classList.remove('active');
      mobileMenuBtn?.classList.remove('active');
    }
  });

  const qualityBtns = [
    document.getElementById('btnToggleQualityDesktop'),
    document.getElementById('btnToggleQualityMobile')
  ];
  qualityBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', toggleLowerQuality);
  });

  const gridBtns = [
    document.getElementById('btnToggleGridDesktop'),
    document.getElementById('btnToggleGridMobile')
  ];
  gridBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', toggleGrid);
  });

  const zoomInBtns = [
    document.getElementById('btnZoomInDesktop'),
    document.getElementById('btnZoomInMobile')
  ];
  zoomInBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', zoomIn);
  });

  const zoomOutBtns = [
    document.getElementById('btnZoomOutDesktop'),
    document.getElementById('btnZoomOutMobile')
  ];
  zoomOutBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', zoomOut);
  });

  const zoomResetBtns = [
    document.getElementById('btnZoomResetDesktop'),
    document.getElementById('btnZoomResetMobile')
  ];
  zoomResetBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', zoomReset);
  });

  // Wire Undo & Redo buttons
  const undoBtns = [
    document.getElementById('btnUndoDesktop'),
    document.getElementById('btnUndoMobile'),
    ...document.querySelectorAll('[title="Undo"]')
  ];
  undoBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        undo();
      });
    }
  });

  const redoBtns = [
    document.getElementById('btnRedoDesktop'),
    document.getElementById('btnRedoMobile'),
    ...document.querySelectorAll('[title="Redo"]')
  ];
  redoBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        redo();
      });
    }
  });

  // Global Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, [contenteditable="true"]')) return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    }
  });

  // Auto-capture undo state before gesture manipulation starts
  const controllerArea = document.getElementById('layerInspectorDrawer');
  if (controllerArea) {
    const onGestureStart = (e) => {
      if (e.target.closest('#move-pad, #dial-area, .fish-ui-ruler-container, .controller-wheel-row, .am-slider, .color-grid-item, .pop-menu-item, .graph-handle, .kf-diamond')) {
        if (!_isGestureActive) {
          pushUndoState();
          _isGestureActive = true;
        }
      }
    };
    controllerArea.addEventListener('pointerdown', onGestureStart, { capture: true });
    controllerArea.addEventListener('touchstart', onGestureStart, { capture: true, passive: true });
  }

  window.addEventListener('pointerup', () => { _isGestureActive = false; });
  window.addEventListener('touchend', () => { _isGestureActive = false; });
  window.addEventListener('mouseup', () => { _isGestureActive = false; });
}

function toggleLowerQuality() {
  isLowQuality = !isLowQuality;
  
  const videoLayer   = document.getElementById('canvasVideo');
  const qualityBadge = document.getElementById('canvasQualityBadge');

  if (videoLayer) videoLayer.classList.toggle('low-quality', isLowQuality);
  if (qualityBadge) qualityBadge.classList.toggle('active', isLowQuality);

  const qualityBtns = [
    document.getElementById('btnToggleQualityDesktop'),
    document.getElementById('btnToggleQualityMobile')
  ];
  qualityBtns.forEach(btn => {
    if (btn) btn.classList.toggle('active', isLowQuality);
  });

  // beneran low-res: turunin WebGL pixel ratio + re-create texture setengah resolusi
  try {
    if (typeof renderer3D !== 'undefined' && renderer3D) {
      const ratio = isLowQuality ? 0.5 : Math.min(window.devicePixelRatio || 1, 2);
      renderer3D.setPixelRatio(ratio);
      const container = document.getElementById('canvasVideo');
      if (container) {
        const w = container.clientWidth || 360;
        const h = container.clientHeight || 640;
        renderer3D.setSize(w, h);
      }
    }
    // clear pending debounced renders
    if (typeof pendingTextureRenders !== 'undefined') {
      pendingTextureRenders.forEach((h) => { try{ cancelAnimationFrame(h); }catch(e){} });
      pendingTextureRenders.clear();
    }
    // force re-render semua layer dengan resolusi baru (512 vs 1024)
    document.querySelectorAll('.track-row').forEach(row => {
      const id = row.dataset.layerId;
      if (id) {
        const mesh = typeof meshLayerMap !== 'undefined' ? meshLayerMap.get(id) : null;
        if (mesh && mesh.material && mesh.material.map) {
          try { mesh.material.map.dispose(); } catch(e) {}
          mesh.material.map = null;
        }
        if (typeof applyFillToMeshGlobal === 'function') applyFillToMeshGlobal(id);
      }
    });
    if (typeof render3D === 'function') render3D();
    if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
  } catch(e) { console.warn('low quality toggle', e); }
}

function toggleGrid() {
  isGridOn = !isGridOn;

  const gridOverlay = document.getElementById('canvasGridOverlay');
  if (gridOverlay) gridOverlay.classList.toggle('active', isGridOn);

  const gridBtns = [
    document.getElementById('btnToggleGridDesktop'),
    document.getElementById('btnToggleGridMobile')
  ];
  gridBtns.forEach(btn => {
    if (btn) btn.classList.toggle('active', isGridOn);
  });
}

function zoomIn() {
  if (zoomIndex < zoomLevels.length - 1) {
    zoomIndex++;
    applyZoom();
  }
}

function zoomOut() {
  if (zoomIndex > 0) {
    zoomIndex--;
    applyZoom();
  }
}

function zoomReset() {
  zoomIndex = 2;
  applyZoom();
}

function applyZoom() {
  const currentZoom = zoomLevels[zoomIndex];
  const canvasWrap = document.getElementById('canvasWrap');
  
  if (canvasWrap) {
    canvasWrap.style.transform = `scale(${currentZoom})`;
    canvasWrap.style.transformOrigin = 'center center';
  }

  const zoomText = `${Math.round(currentZoom * 100)}%`;
  const labels = [
    document.getElementById('zoomValueDesktop'),
    document.getElementById('zoomValueMobile')
  ];
  labels.forEach(l => {
    if (l) l.textContent = zoomText;
  });
}

let selectedTrackRow = null;



function updateInspectorQuickButtons() {
  if (!selectedTrackRow) return;
  const clip = selectedTrackRow.querySelector('.track-clip');
  if (!clip) return;

  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  const btnLeft = document.getElementById('btnInspTrimLeft');
  const btnSplit = document.getElementById('btnInspSplit');
  const btnRight = document.getElementById('btnInspTrimRight');

  if (!btnLeft || !btnSplit || !btnRight) return;

  if (timelineOffset > curEnd + 0.5) {
    btnSplit.style.display = 'none';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Panjangkan / Extend Layer sampai ke Playhead";
    btnLeft.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="20" y1="3" x2="20" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h5" stroke-dasharray="2 2"/>
        <path d="M4 15.5h5" stroke-dasharray="2 2"/>
        <path d="M4 8.5v7" stroke-dasharray="2 2"/>
        <path d="M9 8.5h11v7H9"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeExtendRightToPlayhead(selectedTrackRow);
    };

    btnRight.title = "Geser Layer sampai ke Playhead (Move to Playhead)";
    btnRight.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="20" y1="3" x2="20" y2="21" stroke-width="1.9"/>
        <rect x="4" y="8.5" width="8" height="7" rx="1.5"/>
        <line x1="12" y1="12" x2="19" y2="12"/>
        <polyline points="16 9.5 19 12 16 14.5"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeMoveRightToPlayhead(selectedTrackRow);
    };

  } else if (timelineOffset < curMargin - 0.5) {
    btnSplit.style.display = 'none';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Geser Layer dari awal Playhead (Move to Playhead)";
    btnLeft.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="3" x2="4" y2="21" stroke-width="1.9"/>
        <rect x="12" y="8.5" width="8" height="7" rx="1.5"/>
        <line x1="12" y1="12" x2="5" y2="12"/>
        <polyline points="8 9.5 5 12 8 14.5"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeMoveLeftToPlayhead(selectedTrackRow);
    };

    btnRight.title = "Panjangkan / Extend Layer mundur ke Playhead";
    btnRight.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="3" x2="4" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h11v7H4"/>
        <path d="M15 8.5h5" stroke-dasharray="2 2"/>
        <path d="M15 15.5h5" stroke-dasharray="2 2"/>
        <path d="M20 8.5v7" stroke-dasharray="2 2"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeExtendLeftToPlayhead(selectedTrackRow);
    };

  } else {
    btnSplit.style.display = 'flex';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Potong Sisi Kiri (Trim Left to Playhead)";
    btnLeft.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h4.5v7H4" stroke-dasharray="2 2"/>
        <path d="M15.5 8.5H20v7h-4.5"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeTrimLeftOnRow(selectedTrackRow, true);
    };

    btnSplit.title = "Bagi / Split di Posisi Playhead";
    btnSplit.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M8.5 8.5H4v7h4.5"/>
        <path d="M15.5 8.5H20v7h-4.5"/>
      </svg>
    `;
    btnSplit.onclick = (e) => {
      e.stopPropagation();
      executeSplitOnRow(selectedTrackRow, true);
    };

    btnRight.title = "Potong Sisi Kanan (Trim Right to Playhead)";
    btnRight.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M8.5 8.5H4v7h4.5"/>
        <path d="M20 8.5h-4.5v7H20" stroke-dasharray="2 2"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeTrimRightOnRow(selectedTrackRow, true);
    };
  }
}

function snappyScrollTo(element, targetTop, duration = 110) {
  const startTop = element.scrollTop;
  const change = targetTop - startTop;
  if (Math.abs(change) < 1) return;

  const startTime = performance.now();
  isProgrammaticScrolling = true;

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3);

    element.scrollTop = startTop + change * easeProgress;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.scrollTop = targetTop;
      setTimeout(() => {
        isProgrammaticScrolling = false;
      }, 40);
    }
  }

  requestAnimationFrame(step);
}

function selectTrack(row) {
  if (!row) return;

  if (selectedTrackRow && selectedTrackRow !== row) {
    selectedTrackRow.classList.remove('selected');
  }

  selectedTrackRow = row;
  row.classList.add('selected');

  const clip = row.querySelector('.track-clip');
  if (clip && !clip.querySelector('.clip-extend-handle')) {
    const leftH = document.createElement('div');
    leftH.className = 'clip-extend-handle handle-left';
    leftH.title = 'Tarik untuk memanjangkan awal layer';
    leftH.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    clip.prepend(leftH);

    const rightH = document.createElement('div');
    rightH.className = 'clip-extend-handle handle-right';
    rightH.title = 'Tarik untuk memanjangkan akhir layer';
    rightH.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    clip.appendChild(rightH);

    bindTrackEvents(row);
  }

  const addTrackPopover = document.getElementById('addTrackPopover');
  const fabAdd = document.getElementById('fabAddTrack');
  if (addTrackPopover) addTrackPopover.classList.remove('active');
  if (fabAdd) fabAdd.classList.remove('active');

  const topBar = document.getElementById('layerTopContextBar');
  const nameEl = document.getElementById('topInspLayerName');
  const iconEl = document.getElementById('topInspLayerIcon');
  const clipName = row.querySelector('.track-clip-name');

  if (nameEl && clipName) {
    nameEl.textContent = clipName.textContent.trim();
  }

  if (iconEl) {
    const cat = row.dataset.category || 'media';
    if (cat === 'shape') iconEl.textContent = 'interests';
    else if (cat === 'camera') iconEl.textContent = 'videocam';
    else if (cat === 'text') iconEl.textContent = 'title';
    else iconEl.textContent = 'perm_media';
  }

  if (topBar) {
    topBar.classList.add('active');
  }

  const currentTagColor = row.dataset.tagColor || 'none';
  document.querySelectorAll('.color-tag-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.getAttribute('data-color') === currentTagColor);
  });

  const btnTopLink = document.getElementById('topBtnInspLink');
  if (btnTopLink) {
    let isLinked = false;
    try {
      isLinked = !!(row.dataset.linkedTo && JSON.parse(row.dataset.linkedTo).length > 0);
    } catch (_) {}
    btnTopLink.classList.toggle('active', isLinked);
  }

  const btnTopMotionBlur = document.getElementById('topBtnInspMotionBlur');
  if (btnTopMotionBlur) {
    const layerId = row.dataset.layerId || 'default';
    const isMbOn = !!layerMotionBlur.get(layerId);
    btnTopMotionBlur.classList.toggle('active', isMbOn);
    btnTopMotionBlur.title = isMbOn ? 'Motion Blur: ON' : 'Motion Blur: OFF';
  }

  const drawer = document.getElementById('layerInspectorDrawer');
  const panelMove = document.getElementById('panelMoveTransform');
  const panelColor = document.getElementById('panelColorFill');
  const panelGraph = document.getElementById('panelGraphEditor');
  const toolsGrid = document.querySelector('.inspector-tools-grid');
  const quickStrip = document.querySelector('.inspector-quick-strip');

  const panelBorderShadow = document.getElementById('panelBorderShadow');

  // Reset any subpanels back to tools grid default view
  if (panelMove) {
    panelMove.style.display = 'none';
    panelMove.classList.remove('slide-in', 'slide-out');
  }
  if (panelColor) {
    panelColor.style.display = 'none';
    panelColor.classList.remove('slide-in', 'slide-out');
  }
  if (panelBorderShadow) {
    panelBorderShadow.style.display = 'none';
    panelBorderShadow.classList.remove('slide-in', 'slide-out');
  }
  if (panelGraph) {
    panelGraph.style.display = 'none';
    panelGraph.classList.remove('slide-in', 'slide-out');
  }
  if (quickStrip) quickStrip.style.display = 'flex';
  if (toolsGrid) toolsGrid.style.display = 'grid';

  if (window.FishPopover) {
    window.FishPopover.close();
  }

  if (drawer) {
    drawer.classList.remove('subpanel-open', 'subpanel-color', 'subpanel-move', 'subpanel-border-shadow', 'subpanel-graph', 'in-subpanel');
    drawer.classList.add('active');
  }

  const cat = row.dataset.category || 'media';
  const clipText = clipName ? clipName.textContent.trim() : '';
  const isCamera = (cat === 'camera' || clipText.toLowerCase().startsWith('camera'));
  const isNull = (cat === 'null' || clipText.toLowerCase().startsWith('null'));

  // Configure drawer tools grid buttons
  const allTileBtns = toolsGrid ? Array.from(toolsGrid.querySelectorAll('.insp-tile-btn')) : [];
  if (isCamera) {
    // Camera layer: Show Move & Transform + Camera Control side by side (2-column layout)
    if (toolsGrid) {
      toolsGrid.classList.remove('single-item');
      toolsGrid.classList.add('camera-layout');
    }
    allTileBtns.forEach(btn => {
      if (btn.id === 'btnInspMoveTransform' || btn.id === 'btnInspCameraControl') {
        btn.style.display = 'flex';
      } else {
        btn.style.display = 'none';
      }
    });
  } else if (isNull) {
    // Null layer: ONLY show Move & Transform (Full Width flexible tile)
    if (toolsGrid) {
      toolsGrid.classList.remove('camera-layout');
      toolsGrid.classList.add('single-item');
    }
    allTileBtns.forEach(btn => {
      if (btn.id === 'btnInspMoveTransform') {
        btn.style.display = 'flex';
      } else {
        btn.style.display = 'none';
      }
    });
  } else {
    // Standard layers: show all valid tiles
    if (toolsGrid) {
      toolsGrid.classList.remove('single-item', 'camera-layout');
    }
    allTileBtns.forEach(btn => {
      if (btn.id === 'btnInspCameraControl') {
        btn.style.display = 'none';
      } else if (btn.id === 'btnInspEditShape') {
        btn.style.display = (cat === 'shape') ? 'flex' : 'none';
      } else {
        btn.style.display = 'flex';
      }
    });
  }

  updateInspectorQuickButtons();
  syncControllerUI();
  if (typeof syncBorderShadowUI === 'function') syncBorderShadowUI();
  renderAllKeyframeMarkers();
  requestCanvasOverlayRender();

  const viewport = document.getElementById('tracksViewport');
  if (viewport) {
    viewport.classList.add('drawer-open');
    viewport.classList.add('locked-vertical');
    
    requestAnimationFrame(() => {
      const drawerEl = document.getElementById('layerInspectorDrawer');
      const drawerHeight = (drawerEl && drawerEl.offsetHeight) || 220;
      
      const viewportRect = viewport.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      
      const currentRelativeRowTop = rowRect.top - viewportRect.top;
      const rowHeight = rowRect.height || 34;
      
      const visibleTop = 28;
      const visibleBottom = Math.max(visibleTop + 60, viewportRect.height - drawerHeight);
      const visibleCenter = visibleTop + (visibleBottom - visibleTop) / 2;
      
      const desiredRelativeRowTop = visibleCenter - (rowHeight / 2);
      
      const deltaScroll = currentRelativeRowTop - desiredRelativeRowTop;
      const targetScrollTop = Math.max(0, viewport.scrollTop + deltaScroll);
      
      snappyScrollTo(viewport, targetScrollTop, 110);
    });
  }
}

function deselectTrack() {
  if (selectedTrackRow) {
    selectedTrackRow.classList.remove('selected');
    selectedTrackRow = null;
  }
  const topBar = document.getElementById('layerTopContextBar');
  if (topBar) {
    topBar.classList.remove('active');
  }
  const optionsPopup = document.getElementById('layerOptionsPopup');
  if (optionsPopup) {
    optionsPopup.classList.remove('active');
  }
  const drawer = document.getElementById('layerInspectorDrawer');
  if (drawer) {
    drawer.classList.remove('active', 'subpanel-open', 'subpanel-color', 'subpanel-move', 'subpanel-border-shadow', 'subpanel-graph', 'in-subpanel');
  }
  const panelMove = document.getElementById('panelMoveTransform');
  const panelColor = document.getElementById('panelColorFill');
  const panelBorderShadow = document.getElementById('panelBorderShadow');
  const panelGraph = document.getElementById('panelGraphEditor');
  const toolsGrid = document.querySelector('.inspector-tools-grid');
  const quickStrip = document.querySelector('.inspector-quick-strip');

  if (panelMove) {
    panelMove.style.display = 'none';
    panelMove.classList.remove('slide-in', 'slide-out');
  }
  if (panelColor) {
    panelColor.style.display = 'none';
    panelColor.classList.remove('slide-in', 'slide-out');
  }
  if (panelBorderShadow) {
    panelBorderShadow.style.display = 'none';
    panelBorderShadow.classList.remove('slide-in', 'slide-out');
  }
  if (panelGraph) {
    panelGraph.style.display = 'none';
    panelGraph.classList.remove('slide-in', 'slide-out');
  }
  if (quickStrip) quickStrip.style.display = 'flex';
  if (toolsGrid) toolsGrid.style.display = 'grid';

  if (window.FishPopover) {
    window.FishPopover.close();
  }
  renderCanvasOverlay();
  renderAllKeyframeMarkers();
  updateKeyframeUI();

  const viewport = document.getElementById('tracksViewport');
  if (viewport) {
    viewport.classList.remove('drawer-open');
    viewport.classList.remove('locked-vertical');
  }
}

function cleanupDeletedLayerData(layerId) {
  if (!layerId) return;
  layerTransforms.delete(layerId);
  layerKeyframes.delete(layerId);
  layerFills.delete(layerId);
  layerBorderShadow.delete(layerId);
  layerShapeParams.delete(layerId);
  layerMotionBlur.delete(layerId);
  mediaNaturalRatioMap.delete(layerId);
  if (layerAudioMap.has(layerId)) {
    const a = layerAudioMap.get(layerId);
    if (a) { a.pause(); a.removeAttribute("src"); try { a.load(); } catch(_) {} }
    layerAudioMap.delete(layerId);
  }
  if (layerVideoMap.has(layerId)) {
    const v = layerVideoMap.get(layerId);
    if (v) { v.pause(); v.removeAttribute("src"); try { v.load(); } catch(_) {} }
    layerVideoMap.delete(layerId);
  }
  const m = meshLayerMap.get(layerId);
  if (m) {
    scene3D.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
    meshLayerMap.delete(layerId);
  }
}

function deleteSelectedTrack() {
  if (!selectedTrackRow) return;
  const rowToDelete = selectedTrackRow;
  const layerId = rowToDelete.dataset.layerId;
  deselectTrack();

  const nextSib = rowToDelete.nextSibling;
  rowToDelete.classList.add('deleting');

  setTimeout(() => {
    rowToDelete.remove();
    cleanupDeletedLayerData(layerId);
    calculateMaxDuration();
    recordAction({
      type: 'DELETE_TRACK',
      element: rowToDelete,
      nextSibling: nextSib
    });
    syncThreeLayers();
    renderCanvasOverlay();
    saveCurrentProject();
  }, 290);
}

function initTrackReorder(row, handle) {
  let isDragging = false;
  let startPointerY = 0;
  let initialIndex = 0;
  let targetIndex = 0;
  const container = document.getElementById('trackRowsContainer');
  if (!container) return;

  const onPointerDown = (e) => {
    e.stopPropagation();
    isDragging = true;
    startPointerY = e.pageY || (e.touches && e.touches[0].pageY) || 0;

    const allRows = Array.from(container.querySelectorAll('.track-row'));
    initialIndex = allRows.indexOf(row);
    targetIndex = initialIndex;

    const rowStep = (allRows.length > 1) 
      ? Math.abs(allRows[1].offsetTop - allRows[0].offsetTop)
      : 44.5;

    row.classList.add('dragging-reorder');
    row.style.transform = 'translateY(0px)';

    allRows.forEach(r => {
      if (r !== row) {
        r.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)';
      }
    });

    const onPointerMove = (me) => {
      if (!isDragging) return;
      const currentY = me.pageY || (me.touches && me.touches[0].pageY) || 0;
      const deltaY = currentY - startPointerY;
      row.style.transform = `translateY(${deltaY}px)`;

      const steps = Math.round(deltaY / rowStep);
      const newTargetIndex = Math.max(0, Math.min(initialIndex + steps, allRows.length - 1));

      if (newTargetIndex !== targetIndex) {
        targetIndex = newTargetIndex;

        allRows.forEach((r, idx) => {
          if (r === row) return;

          if (initialIndex < targetIndex) {
            if (idx > initialIndex && idx <= targetIndex) {
              r.style.transform = `translateY(-${rowStep}px)`;
            } else {
              r.style.transform = 'translateY(0px)';
            }
          } else if (initialIndex > targetIndex) {
            if (idx >= targetIndex && idx < initialIndex) {
              r.style.transform = `translateY(${rowStep}px)`;
            } else {
              r.style.transform = 'translateY(0px)';
            }
          } else {
            r.style.transform = 'translateY(0px)';
          }
        });
      }
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      row.classList.remove('dragging-reorder');

      allRows.forEach(r => {
        r.style.transition = 'none';
        r.style.transform = '';
      });

      if (targetIndex !== initialIndex) {
        const currentRows = Array.from(container.querySelectorAll('.track-row'));
        const targetElement = currentRows[targetIndex];
        if (targetIndex > initialIndex) {
          container.insertBefore(row, targetElement.nextSibling);
        } else {
          container.insertBefore(row, targetElement);
        }
      }

      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
    };

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
  };

  handle.addEventListener('mousedown', onPointerDown);
  handle.addEventListener('touchstart', onPointerDown, { passive: false });
}

let currentProjectId = sessionStorage.getItem('activeProjectId') || ('proj_' + Date.now());
let _projectsDbPromise = null;

function getProjectsDB() {
  if (_projectsDbPromise) return _projectsDbPromise;
  _projectsDbPromise = new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open('FishTool_Projects_DB', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('saved_projects')) {
          db.createObjectStore('saved_projects', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  });
  return _projectsDbPromise;
}

function saveCurrentProject() {
  try {
    const titleEl = document.getElementById('activeTitle') || document.querySelector('.nav-title');
    const activeName = (titleEl && titleEl.textContent.trim()) || sessionStorage.getItem('activeProject') || 'Proyek Baru';

    let rawCfg = sessionStorage.getItem('projectConfig');
    let cfg = {};
    if (rawCfg) {
      try { cfg = JSON.parse(rawCfg); } catch(e) {}
    }

    currentProjectId = cfg.id || sessionStorage.getItem('activeProjectId') || currentProjectId;
    sessionStorage.setItem('activeProjectId', currentProjectId);
    sessionStorage.setItem('activeProject', activeName);

    const tracks = [];
    document.querySelectorAll('.track-row').forEach(row => {
      const clip = row.querySelector('.track-clip');
      const clipName = row.querySelector('.track-clip-name');
      const eyeBtn = row.querySelector('.track-eye');
      const isHidden = eyeBtn && eyeBtn.querySelector('.material-symbols-rounded') && eyeBtn.querySelector('.material-symbols-rounded').textContent.trim() === 'visibility_off';

      tracks.push({
        layerId: row.dataset.layerId,
        category: row.dataset.category || 'media',
        name: (clipName && clipName.textContent.trim()) || 'Layer',
        colorTag: row.dataset.tagColor || 'none',
        marginLeft: parseFloat(clip ? clip.style.marginLeft : 0) || 0,
        width: parseFloat(clip ? clip.style.width : 300) || (clip ? clip.offsetWidth : 300) || 300,
        isHidden: !!isHidden,
        isLinked: row.classList.contains('linked-parent'),
        linkedTo: row.dataset.linkedTo ? JSON.parse(row.dataset.linkedTo) : [],
        parentBind: row.dataset.parentBind ? JSON.parse(row.dataset.parentBind) : null,
        linkedFrom: row.dataset.linkedFrom ? JSON.parse(row.dataset.linkedFrom) : [],
        dataset: { ...row.dataset }
      });
    });

    const projectData = {
      id: currentProjectId,
      name: activeName,
      ratio: projectRatio,
      resolution: projectResolution,
      fps: projectFps,
      backgroundColor: projectBgColor,
      customWidth: projectCustomWidth,
      customHeight: projectCustomHeight,
      duration: totalDuration,
      timelineOffset: timelineOffset,
      markers: markers,
      tracks: tracks,
      transforms: Array.from(layerTransforms.entries()),
      keyframes: Array.from(layerKeyframes.entries()),
      fills: Array.from(layerFills.entries()),
      borderShadows: Array.from(layerBorderShadow.entries()),
      shapeParams: Array.from(layerShapeParams.entries()),
      cameraParams: Array.from(layerCameraParams.entries()),
      motionBlurTune: projectMotionBlurTune,
      motionBlurSamples: projectMotionBlurSamples,
      globalMotionBlur: isGlobalMotionBlurEnabled,
      motionBlurs: Array.from(layerMotionBlur.entries()),
      createdAt: cfg.createdAt || new Date().toLocaleDateString(),
      updatedAt: new Date().toLocaleString()
    };

    // 1. Asynchronously save full high-capacity project to IndexedDB (supports unlimited heavy video & audio)
    getProjectsDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction('saved_projects', 'readwrite');
        const store = tx.objectStore('saved_projects');
        store.put(projectData);
      } catch (err) {
        console.warn('IDB project save error', err);
      }
    });

    // 2. Safely sync lightweight metadata to localStorage without throwing quota error
    try {
      let allProjects = [];
      const stored = localStorage.getItem('fishTool_savedProjects');
      if (stored) {
        try { allProjects = JSON.parse(stored); } catch(e) { allProjects = []; }
      }

      // Create a light project summary for localStorage
      const lightProjectData = {
        ...projectData,
        fills: projectData.fills.map(([k, fill]) => {
          if (fill && fill.type === 'media' && fill.mediaUrl && fill.mediaUrl.length > 50000) {
            return [k, { ...fill, mediaUrl: fill.mediaUrl.startsWith('data:') ? '[IDB_MEDIA]' : fill.mediaUrl }];
          }
          return [k, fill];
        })
      };

      const existingIdx = allProjects.findIndex(p => p.id === currentProjectId || p.name === activeName);
      if (existingIdx >= 0) {
        allProjects[existingIdx] = lightProjectData;
      } else {
        allProjects.unshift(lightProjectData);
      }

      localStorage.setItem('fishTool_savedProjects', JSON.stringify(allProjects.slice(0, 10)));
      localStorage.setItem('fishTool_recentProjects', JSON.stringify(allProjects.slice(0, 10)));
    } catch (e) {
      // Safely ignore quota error because IndexedDB holds the authoritative full heavy project data!
    }
  } catch (e) {
    console.warn('Could not save project', e);
  }
}

let autoSaveTimer = null;
function triggerAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveCurrentProject, 300);
}

function loadSavedProject() {
  try {
    const rawId = sessionStorage.getItem('activeProjectId');
    const rawName = sessionStorage.getItem('activeProject');
    const stored = localStorage.getItem('fishTool_savedProjects');
    if (!stored) return false;

    const allProjects = JSON.parse(stored);
    const proj = allProjects.find(p => (rawId && p.id === rawId) || (rawName && p.name === rawName));
    if (!proj || !proj.tracks || proj.tracks.length === 0) return false;

    applyProjectConfig(proj);

    const container = document.getElementById('trackRowsContainer');
    if (!container) return false;

    container.innerHTML = '';

    layerTransforms.clear();
    if (proj.transforms && proj.transforms.length) {
      proj.transforms.forEach(([k, v]) => layerTransforms.set(k, v));
    }

    layerKeyframes.clear();
    if (proj.keyframes && proj.keyframes.length) {
      proj.keyframes.forEach(([k, v]) => layerKeyframes.set(k, v));
    }

    layerFills.clear();
    if (proj.fills && proj.fills.length) {
      proj.fills.forEach(([k, v]) => layerFills.set(k, v));
    }

    layerBorderShadow.clear();
    if (proj.borderShadows && proj.borderShadows.length) {
      proj.borderShadows.forEach(([k, v]) => {
        if (v && v.stroke && v.stroke.join && !v.stroke.align) {
          v.stroke.align = 'center';
          delete v.stroke.join;
        }
        layerBorderShadow.set(k, v);
      });
    } else if (proj.tracks) {
      // fallback: coba baca dari track.borderShadow (new architecture)
      proj.tracks.forEach(tr => {
        if (tr.borderShadow) {
          layerBorderShadow.set(tr.layerId, tr.borderShadow);
        }
      });
    }

    layerShapeParams.clear();
    if (proj.shapeParams && proj.shapeParams.length) {
      proj.shapeParams.forEach(([k, v]) => layerShapeParams.set(k, v));
    }

    layerCameraParams.clear();
    if (proj.cameraParams && proj.cameraParams.length) {
      proj.cameraParams.forEach(([k, v]) => layerCameraParams.set(k, v));
    }

    layerMotionBlur.clear();
    if (proj.motionBlurs && proj.motionBlurs.length) {
      proj.motionBlurs.forEach(([k, v]) => layerMotionBlur.set(k, v));
    }

    if (proj.markers && proj.markers.length) {
      markers = proj.markers;
    }

    proj.tracks.forEach(tr => {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.dataset.category = tr.category || 'media';
      row.dataset.layerId = tr.layerId;
      row.dataset.tagColor = tr.colorTag || 'none';

      // Restore all dataset attributes (including future custom dataset fields)
      if (tr.dataset) {
        Object.keys(tr.dataset).forEach(k => {
          row.dataset[k] = tr.dataset[k];
        });
      }
      if (tr.linkedTo && tr.linkedTo.length > 0) {
        row.dataset.linkedTo = JSON.stringify(tr.linkedTo);
      }
      if (tr.parentBind) {
        row.dataset.parentBind = JSON.stringify(tr.parentBind);
      }
      if (tr.linkedFrom && tr.linkedFrom.length > 0) {
        row.dataset.linkedFrom = JSON.stringify(tr.linkedFrom);
      }

      const isAudio = (tr.category === 'audio');
      const defaultIcon = isAudio ? (tr.isHidden ? 'volume_off' : 'volume_up') : (tr.isHidden ? 'visibility_off' : 'visibility');

      row.innerHTML = `
        <button class="track-eye" title="${isAudio ? 'Mute / Unmute Audio' : 'Toggle Visibility'} / Tahan untuk Multi-Select">
          <span class="material-symbols-rounded">${isMultiSelectMode ? 'radio_button_unchecked' : defaultIcon}</span>
        </button>
        <div class="track-trackway" style="transform: translateX(-${proj.timelineOffset || 0}px);">
          <div class="track-clip" style="width: ${tr.width}px; margin-left: ${tr.marginLeft}px;" title="Klik untuk pilih / buka menu layer">
            <div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </div>
            <span class="track-clip-name">${tr.name}</span>
            <div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        </div>
        <button class="track-reorder-handle" title="Tahan & geser untuk atur urutan layer (Reorder)">
          <span class="material-symbols-rounded">menu</span>
        </button>
      `;

      bindTrackEvents(row);
      container.appendChild(row);

      if (isAudio) {
        const fill = layerFills.get(tr.layerId);
        if (fill && fill.mediaUrl && !fill.mediaUrl.startsWith('video_pkg_') && !fill.mediaUrl.startsWith('pkg_') && (fill.mediaUrl.startsWith('http://') || fill.mediaUrl.startsWith('https://') || fill.mediaUrl.startsWith('blob:') || fill.mediaUrl.startsWith('data:'))) {
          const audio = new Audio(fill.mediaUrl);
          audio.preload = 'auto';
          layerAudioMap.set(tr.layerId, audio);
        }
      } else if (tr.category === 'video' || (layerFills.get(tr.layerId) && layerFills.get(tr.layerId).mediaUrl && (/\.(mp4|webm|mov|mkv|avi)$/i.test(tr.name || '') || /\.(mp4|webm|mov|mkv|avi)$/i.test(layerFills.get(tr.layerId).mediaUrl) || layerFills.get(tr.layerId).mediaUrl.startsWith('data:video/')))) {
        const fill = layerFills.get(tr.layerId);
        const isNotImage = !fill.mediaUrl.startsWith('data:image/') && !/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(tr.name || '');
        if (isNotImage && fill && fill.mediaUrl && !fill.mediaUrl.startsWith('video_pkg_') && !fill.mediaUrl.startsWith('pkg_') && (fill.mediaUrl.startsWith('http://') || fill.mediaUrl.startsWith('https://') || fill.mediaUrl.startsWith('blob:') || fill.mediaUrl.startsWith('data:video/'))) {
          const video = document.createElement('video');
          video.src = fill.mediaUrl;
          video.crossOrigin = 'anonymous';
          video.preload = 'auto';
          layerVideoMap.set(tr.layerId, video);
        }
      }
    });

    renderAllKeyframeMarkers();

    // Re-link and trigger instant render for all restored photo/media layers
    const activeMediaLib = getGlobalMediaLibrary();
    document.querySelectorAll('.track-row').forEach(row => {
      const id = row.dataset.layerId;
      if (id) {
        const fill = getLayerFill(id);
        const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
        if (fill && fill.type === 'media') {
          const match = activeMediaLib.find(m => m.url === fill.mediaUrl || m.id === fill.mediaUrl || (clipName && m.name === clipName));
          if (match && match.url) {
            fill.mediaUrl = match.url;
          }
          applyFillToMeshGlobal(id);
          applyTransformToThreeMesh(id, getLayerTransform(id));
        }
      }
    });

    // Rebuild media grid thumbs from persisted fills (immediate, no delay)
    const mediaGrid = document.getElementById('uploadedMediaGrid');
    if (mediaGrid) {
      let hasMedia = false;
      layerFills.forEach((fill) => {
        if (fill.type === 'media' && fill.mediaUrl && !fill.mediaUrl.startsWith('video_pkg_') && !fill.mediaUrl.startsWith('pkg_') && !fill.mediaUrl.startsWith('[')) {
          if (!hasMedia) { mediaGrid.innerHTML = ''; hasMedia = true; }
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.style.cssText = 'width:100%; aspect-ratio:1; border-radius:8px; overflow:hidden; border:1.5px solid rgba(255,242,194,0.25); background:#222; cursor:pointer;';
          const img = document.createElement('img');
          img.src = fill.mediaUrl;
          img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
          btn.appendChild(img);
          btn.addEventListener('click', () => {
            if (selectedTrackRow) {
              const id = selectedTrackRow.dataset.layerId || 'default';
              const f = getLayerFill(id);
              f.type = 'media'; f.mediaUrl = fill.mediaUrl;
              applyFillToMeshGlobal(id);
              triggerAutoSave();
            }
          });
          mediaGrid.appendChild(btn);
        }
      });
    }
    // Apply fills synchronously before first paint (no flash)
    syncThreeLayers();
    layerFills.forEach((_, id) => applyFillToMeshGlobal(id));
    render3D();
    return true;
  } catch (e) {
    console.warn('Could not load saved project', e);
    return false;
  }
}

function goBack() {
  saveCurrentProject();
  window.location.href = 'index.html';
}

function initTrackRows() {
  const loaded = loadSavedProject();
  if (!loaded) {
    document.querySelectorAll('.track-row').forEach((row, idx) => {
      if (!row.dataset.layerId) {
        row.dataset.layerId = 'layer_' + (idx + 1);
      }
      bindTrackEvents(row);
    });
    renderAllKeyframeMarkers();
  }
  saveCurrentProject();
}

function bindTrackEvents(row) {
  if (!row.dataset.layerId) {
    const existing = document.querySelectorAll('.track-row');
    const idx = Array.from(existing).indexOf(row);
    row.dataset.layerId = 'layer_' + (idx >= 0 ? idx + 1 : Date.now());
  }

  if (row.dataset.tagColor && row.dataset.tagColor !== 'none') {
    const clip = row.querySelector('.track-clip');
    if (clip) clip.style.borderLeft = `5px solid ${row.dataset.tagColor}`;
  }

  renderKeyframeMarkersOnClip(row);

  const eyeBtn = row.querySelector('.track-eye');
  if (eyeBtn) {
    let eyeLongPressTimer = null;
    let isEyeHolding = false;
    let hasSwiped = false;

    const onEyePointerDown = (e) => {
      e.stopPropagation();
      isEyeHolding = false;
      hasSwiped = false;

      if (isMultiSelectMode) {
        isEyeHolding = true;
      } else {
        eyeLongPressTimer = setTimeout(() => {
          isEyeHolding = true;
          enterMultiSelectMode(row);
          if (navigator.vibrate) navigator.vibrate(25);
        }, 200);
      }

      const onEyePointerMove = (me) => {
        const clientX = me.clientX || (me.touches && me.touches[0].clientX) || 0;
        const clientY = me.clientY || (me.touches && me.touches[0].clientY) || 0;

        if (isEyeHolding || isMultiSelectMode) {
          if (!isMultiSelectMode) {
            clearTimeout(eyeLongPressTimer);
            enterMultiSelectMode(row);
          }

          hasSwiped = true;
          const el = document.elementFromPoint(clientX, clientY);
          if (el) {
            const targetRow = el.closest('.track-row');
            if (targetRow && !selectedMultiRows.has(targetRow)) {
              selectedMultiRows.add(targetRow);
              targetRow.classList.add('multi-selected');
              const eye = targetRow.querySelector('.track-eye .material-symbols-rounded');
              if (eye) {
                eye.textContent = 'check';
                eye.style.color = '#082618';
              }
              if (navigator.vibrate) navigator.vibrate(12);
              updateMultiSelectUI();
            }
          }
        }
      };

      const onEyePointerUp = () => {
        clearTimeout(eyeLongPressTimer);
        window.removeEventListener('mousemove', onEyePointerMove);
        window.removeEventListener('mouseup', onEyePointerUp);
        window.removeEventListener('touchmove', onEyePointerMove);
        window.removeEventListener('touchend', onEyePointerUp);

        if (!hasSwiped && !isEyeHolding) {
          if (isMultiSelectMode) {
            toggleRowMultiSelect(row);
          } else {
            toggleEye(eyeBtn, true);
          }
        }
      };

      window.addEventListener('mousemove', onEyePointerMove);
      window.addEventListener('mouseup', onEyePointerUp);
      window.addEventListener('touchmove', onEyePointerMove, { passive: false });
      window.addEventListener('touchend', onEyePointerUp);
    };

    eyeBtn.addEventListener('mousedown', onEyePointerDown);
    eyeBtn.addEventListener('touchstart', onEyePointerDown, { passive: false });
  }

  const handle = row.querySelector('.track-reorder-handle');
  if (handle) {
    initTrackReorder(row, handle);
  }

  const clip = row.querySelector('.track-clip');
  if (clip) {
    let longPressTimer = null;
    let isHolding = false;
    let didScrub = false;
    let startX = 0;
    let startY = 0;
    let startMargin = 0;
    let startOffset = 0;
    let startScrollTop = 0;

    const onPointerDown = (e) => {
      if (e.target.closest('.clip-extend-handle') || e.target.closest('.clip-keyframe-marker') || e.target.closest('.clip-keyframes-container')) return;

      e.stopPropagation();
      const viewport = document.getElementById('tracksViewport');
      const pointerX = e.pageX || (e.touches && e.touches[0].pageX) || 0;
      const pointerY = e.pageY || (e.touches && e.touches[0].pageY) || 0;
      startX = pointerX;
      startY = pointerY;
      startMargin = parseFloat(clip.style.marginLeft) || 0;
      startOffset = timelineOffset;
      startScrollTop = viewport ? viewport.scrollTop : 0;
      isHolding = false;
      didScrub = false;

      longPressTimer = setTimeout(() => {
        isHolding = true;
        clip.classList.add('clip-holding');
        if (navigator.vibrate) navigator.vibrate(20);
      }, 220);

      const onPointerMove = (me) => {
        const curX = me.pageX || (me.touches && me.touches[0].pageX) || 0;
        const curY = me.pageY || (me.touches && me.touches[0].pageY) || 0;
        const dx = curX - startX;
        const dy = curY - startY;

        if (!isHolding) {
          if (Math.abs(dx) > 3 || (!selectedTrackRow && Math.abs(dy) > 3)) {
            clearTimeout(longPressTimer);
            didScrub = true;
          }
          if (didScrub) {
            me.preventDefault();
            setTimelineOffset(startOffset - dx);
            if (viewport && !selectedTrackRow) {
              viewport.scrollTop = startScrollTop - dy;
            }
          }
          return;
        }

        me.preventDefault();
        const newMargin = Math.max(0, startMargin + dx);
        clip.style.marginLeft = `${newMargin}px`;
      };

      const onPointerUp = () => {
        clearTimeout(longPressTimer);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);

        if (isHolding) {
          isHolding = false;
          clip.classList.remove('clip-holding');
          const finalMargin = parseFloat(clip.style.marginLeft) || 0;
          if (Math.abs(finalMargin - startMargin) > 2) {
            recordAction({
              type: 'MOVE_CLIP',
              clip: clip,
              oldMargin: startMargin,
              newMargin: finalMargin
            });
            calculateMaxDuration();
          }
        } else if (!didScrub) {
          if (isMultiSelectMode) {
            toggleRowMultiSelect(row);
          } else {
            selectTrack(row);
          }
        }
      };

      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    };

    clip.addEventListener('mousedown', onPointerDown);
    clip.addEventListener('touchstart', onPointerDown, { passive: false });

    const handleLeft = row.querySelector('.clip-extend-handle.handle-left');
    const handleRight = row.querySelector('.clip-extend-handle.handle-right');

    if (handleLeft) {
      const onLeftHandleDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const pointerX = e.pageX || (e.touches && e.touches[0].pageX) || 0;
        const startX = pointerX;
        const startMargin = parseFloat(clip.style.marginLeft) || 0;
        const startWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
        const startEnd = startMargin + startWidth;

        const onLeftMove = (me) => {
          const curX = me.pageX || (me.touches && me.touches[0].pageX) || 0;
          const dx = curX - startX;
          const newMargin = Math.max(0, Math.min(startEnd - 20, startMargin + dx));
          const newWidth = startEnd - newMargin;
          clip.style.marginLeft = `${newMargin}px`;
          clip.style.width = `${newWidth}px`;
        };

        const onLeftUp = () => {
          window.removeEventListener('mousemove', onLeftMove);
          window.removeEventListener('mouseup', onLeftUp);
          window.removeEventListener('touchmove', onLeftMove);
          window.removeEventListener('touchend', onLeftUp);

          const finalMargin = parseFloat(clip.style.marginLeft) || 0;
          const finalWidth = parseFloat(clip.style.width) || 300;
          if (Math.abs(finalMargin - startMargin) > 2) {
            recordAction({
              type: 'TRIM_CLIP',
              clip: clip,
              oldMargin: startMargin,
              oldWidth: startWidth,
              newMargin: finalMargin,
              newWidth: finalWidth
            });
            calculateMaxDuration();
            updateInspectorQuickButtons();
          }
        };

        window.addEventListener('mousemove', onLeftMove);
        window.addEventListener('mouseup', onLeftUp);
        window.addEventListener('touchmove', onLeftMove, { passive: false });
        window.addEventListener('touchend', onLeftUp);
      };

      handleLeft.addEventListener('mousedown', onLeftHandleDown);
      handleLeft.addEventListener('touchstart', onLeftHandleDown, { passive: false });
    }

    if (handleRight) {
      const onRightHandleDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const pointerX = e.pageX || (e.touches && e.touches[0].pageX) || 0;
        const startX = pointerX;
        const startMargin = parseFloat(clip.style.marginLeft) || 0;
        const startWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;

        const onRightMove = (me) => {
          const curX = me.pageX || (me.touches && me.touches[0].pageX) || 0;
          const dx = curX - startX;
          const newWidth = Math.max(20, startWidth + dx);
          clip.style.width = `${newWidth}px`;
        };

        const onRightUp = () => {
          window.removeEventListener('mousemove', onRightMove);
          window.removeEventListener('mouseup', onRightUp);
          window.removeEventListener('touchmove', onRightMove);
          window.removeEventListener('touchend', onRightUp);

          const finalWidth = parseFloat(clip.style.width) || 300;
          if (Math.abs(finalWidth - startWidth) > 2) {
            recordAction({
              type: 'TRIM_CLIP',
              clip: clip,
              oldMargin: startMargin,
              oldWidth: startWidth,
              newMargin: startMargin,
              newWidth: finalWidth
            });
            calculateMaxDuration();
            updateInspectorQuickButtons();
          }
        };

        window.addEventListener('mousemove', onRightMove);
        window.addEventListener('mouseup', onRightUp);
        window.addEventListener('touchmove', onRightMove, { passive: false });
        window.addEventListener('touchend', onRightUp);
      };

      handleRight.addEventListener('mousedown', onRightHandleDown);
      handleRight.addEventListener('touchstart', onRightHandleDown, { passive: false });
    }
  }

  row.addEventListener('contextmenu', (e) => {
    openLayerContextMenu(e, row);
  });
}

let isMultiSelectMode = false;
const selectedMultiRows = new Set();

function enterMultiSelectMode(initialRow) {
  if (isMultiSelectMode) return;
  deselectTrack();

  isMultiSelectMode = true;
  document.body.classList.add('multi-select-mode');
  selectedMultiRows.clear();

  if (initialRow) {
    toggleRowMultiSelect(initialRow, true);
  }

  updateMultiSelectUI();
}

function exitMultiSelectMode() {
  if (!isMultiSelectMode) return;
  isMultiSelectMode = false;
  document.body.classList.remove('multi-select-mode');

  selectedMultiRows.forEach(row => {
    row.classList.remove('multi-selected');
  });
  selectedMultiRows.clear();

  document.querySelectorAll('.track-row').forEach(r => {
    r.classList.remove('multi-selected');
    const eyeBtn = r.querySelector('.track-eye');
    if (eyeBtn) {
      const icon = eyeBtn.querySelector('.material-symbols-rounded');
      const trackway = eyeBtn.nextElementSibling;
      const isHidden = trackway && trackway.style.opacity === '0.35';
      if (icon) {
        icon.textContent = isHidden ? 'visibility_off' : 'visibility';
        icon.style.color = isHidden ? 'rgba(255, 240, 194, 0.4)' : 'var(--col-yellow)';
      }
    }
  });

  const header = document.getElementById('multiSelectHeaderBar');
  const footer = document.getElementById('multiSelectFooterBar');
  const alignSub = document.getElementById('multiHeaderAlign');
  const mainSub = document.getElementById('multiHeaderMain');

  if (header) header.classList.remove('active');
  if (footer) footer.classList.remove('active');
  if (alignSub) alignSub.classList.remove('active');
  if (mainSub) mainSub.classList.remove('hidden-sub');
}

function toggleRowMultiSelect(row, forceState) {
  const shouldSelect = (forceState !== undefined) ? forceState : !selectedMultiRows.has(row);

  if (shouldSelect) {
    selectedMultiRows.add(row);
    row.classList.add('multi-selected');
    const eyeIcon = row.querySelector('.track-eye .material-symbols-rounded');
    if (eyeIcon) eyeIcon.textContent = 'check';
  } else {
    selectedMultiRows.delete(row);
    row.classList.remove('multi-selected');
    const eyeIcon = row.querySelector('.track-eye .material-symbols-rounded');
    if (eyeIcon) eyeIcon.textContent = 'radio_button_unchecked';
  }

  if (selectedMultiRows.size === 0) {
    exitMultiSelectMode();
  } else {
    updateMultiSelectUI();
  }
}

function updateMultiSelectUI() {
  const header = document.getElementById('multiSelectHeaderBar');
  const footer = document.getElementById('multiSelectFooterBar');
  const countEl = document.getElementById('multiSelectCount');

  if (header) header.classList.add('active');
  if (footer) footer.classList.add('active');

  const count = selectedMultiRows.size;
  if (countEl) {
    countEl.textContent = `${count} ${count === 1 ? 'layer' : 'layers'} selected`;
  }

  document.querySelectorAll('.track-row').forEach(row => {
    const eyeIcon = row.querySelector('.track-eye .material-symbols-rounded');
    if (eyeIcon) {
      if (selectedMultiRows.has(row)) {
        eyeIcon.textContent = 'check';
        eyeIcon.style.color = '#082618';
      } else {
        eyeIcon.textContent = 'radio_button_unchecked';
        eyeIcon.style.color = 'var(--col-yellow)';
      }
    }
  });

  updateMultiSelectQuickButtons();
}

function initMultiSelectControls() {
  const btnExit = document.getElementById('btnExitMultiSelect');
  const btnExitAlign = document.getElementById('btnExitMultiSelectFromAlign');
  if (btnExit) btnExit.addEventListener('click', exitMultiSelectMode);
  if (btnExitAlign) btnExitAlign.addEventListener('click', exitMultiSelectMode);

  const btnToggleAlign = document.getElementById('btnToggleAlignMenu');
  const btnBackGroup = document.getElementById('btnBackToGroupMenu');
  const mainHeader = document.getElementById('multiHeaderMain');
  const alignHeader = document.getElementById('multiHeaderAlign');

  if (btnToggleAlign && mainHeader && alignHeader) {
    btnToggleAlign.addEventListener('click', (e) => {
      e.stopPropagation();
      mainHeader.classList.add('hidden-sub');
      alignHeader.classList.add('active');
    });
  }

  if (btnBackGroup && mainHeader && alignHeader) {
    btnBackGroup.addEventListener('click', (e) => {
      e.stopPropagation();
      alignHeader.classList.remove('active');
      mainHeader.classList.remove('hidden-sub');
    });
  }

  const btnDeleteBatch = document.getElementById('btnDeleteSelectedBatch');
  if (btnDeleteBatch) {
    btnDeleteBatch.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedMultiRows.size === 0) return;
      beginUndoGroup('Batch Delete Layers');
      try {
        const rowsToDelete = Array.from(selectedMultiRows);
        rowsToDelete.forEach(row => {
          const layerId = row.dataset.layerId;
          row.classList.add('deleting');
          setTimeout(() => {
            row.remove();
            cleanupDeletedLayerData(layerId);
          }, 250);
        });
        setTimeout(() => {
          exitMultiSelectMode();
          calculateMaxDuration();
          syncThreeLayers();
          renderCanvasOverlay();
          saveCurrentProject();
        }, 270);
      } finally {
        endUndoGroup();
      }
    });
  }

  const btnGroup = document.getElementById('btnGroupSelected');
  if (btnGroup) {
    btnGroup.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedMultiRows.size === 0) return;
      beginUndoGroup('Group Layers');
      try {
        addTrackWithType('camera', `Group (${selectedMultiRows.size} layers)`);
        exitMultiSelectMode();
      } finally {
        endUndoGroup();
      }
    });
  }

  const btnMaskGroup = document.getElementById('btnMaskGroupSelected');
  if (btnMaskGroup) {
    btnMaskGroup.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedMultiRows.size === 0) return;
      beginUndoGroup('Mask Group');
      try {
        addTrackWithType('shape', `Mask Group`);
        exitMultiSelectMode();
      } finally {
        endUndoGroup();
      }
    });
  }

  const btnExcludeGroup = document.getElementById('btnExcludeGroupSelected');
  if (btnExcludeGroup) {
    btnExcludeGroup.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedMultiRows.size === 0) return;
      beginUndoGroup('Exclude Group');
      try {
        addTrackWithType('shape', `Exclude Group`);
        exitMultiSelectMode();
      } finally {
        endUndoGroup();
      }
    });
  }

  document.querySelectorAll('#multiHeaderAlign [data-align]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const alignType = btn.getAttribute('data-align');
      executeBatchAlign(alignType);
    });
  });

  const btnAlignStart = document.getElementById('btnBatchAlignStart');
  if (btnAlignStart) {
    btnAlignStart.addEventListener('click', (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Align Start');
      try {
        selectedMultiRows.forEach(row => {
          const clip = row.querySelector('.track-clip');
          if (clip) {
            clip.style.marginLeft = `${timelineOffset}px`;
          }
        });
        calculateMaxDuration();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    });
  }

  const btnStaircase = document.getElementById('btnBatchStaircase');
  if (btnStaircase) {
    btnStaircase.addEventListener('click', (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Staircase Alignment');
      try {
        const arr = Array.from(selectedMultiRows);
        let curStart = timelineOffset;
        arr.forEach(row => {
          const clip = row.querySelector('.track-clip');
          if (clip) {
            const w = parseFloat(clip.style.width) || clip.offsetWidth || 240;
            clip.style.marginLeft = `${curStart}px`;
            curStart += w;
          }
        });
        calculateMaxDuration();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    });
  }

  const btnAlignEnd = document.getElementById('btnBatchAlignEnd');
  if (btnAlignEnd) {
    btnAlignEnd.addEventListener('click', (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Align End');
      try {
        selectedMultiRows.forEach(row => {
          const clip = row.querySelector('.track-clip');
          if (clip) {
            const w = parseFloat(clip.style.width) || clip.offsetWidth || 240;
            clip.style.marginLeft = `${Math.max(0, timelineOffset - w)}px`;
          }
        });
        calculateMaxDuration();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    });
  }

  updateMultiSelectQuickButtons();
}

function updateMultiSelectQuickButtons() {
  if (!isMultiSelectMode || selectedMultiRows.size === 0) return;

  let minMargin = Infinity;
  let maxEnd = -Infinity;

  selectedMultiRows.forEach(row => {
    const clip = row.querySelector('.track-clip');
    if (clip) {
      const m = parseFloat(clip.style.marginLeft) || 0;
      const w = parseFloat(clip.style.width) || clip.offsetWidth || 300;
      if (m < minMargin) minMargin = m;
      if (m + w > maxEnd) maxEnd = m + w;
    }
  });

  const btnLeft = document.getElementById('btnBatchTrimLeft');
  const btnSplit = document.getElementById('btnBatchSplit');
  const btnRight = document.getElementById('btnBatchTrimRight');

  if (!btnLeft || !btnSplit || !btnRight) return;

  if (timelineOffset > maxEnd + 0.5) {
    btnSplit.style.display = 'none';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Panjangkan / Extend Semua Layer Terpilih ke Playhead";
    btnLeft.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="20" y1="3" x2="20" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h5" stroke-dasharray="2 2"/>
        <path d="M4 15.5h5" stroke-dasharray="2 2"/>
        <path d="M4 8.5v7" stroke-dasharray="2 2"/>
        <path d="M9 8.5h11v7H9"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeBatchExtendRightToPlayhead();
    };

    btnRight.title = "Geser Semua Layer Terpilih sampai ke Playhead (Move to Playhead)";
    btnRight.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="20" y1="3" x2="20" y2="21" stroke-width="1.9"/>
        <rect x="4" y="8.5" width="8" height="7" rx="1.5"/>
        <line x1="12" y1="12" x2="19" y2="12"/>
        <polyline points="16 9.5 19 12 16 14.5"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeBatchMoveRightToPlayhead();
    };

  } else if (timelineOffset < minMargin - 0.5) {
    btnSplit.style.display = 'none';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Geser Semua Layer Terpilih dari awal Playhead (Move to Playhead)";
    btnLeft.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="3" x2="4" y2="21" stroke-width="1.9"/>
        <rect x="12" y="8.5" width="8" height="7" rx="1.5"/>
        <line x1="12" y1="12" x2="5" y2="12"/>
        <polyline points="8 9.5 5 12 8 14.5"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeBatchMoveLeftToPlayhead();
    };

    btnRight.title = "Panjangkan / Extend Semua Layer Terpilih mundur ke Playhead";
    btnRight.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="3" x2="4" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h11v7H4"/>
        <path d="M15 8.5h5" stroke-dasharray="2 2"/>
        <path d="M15 15.5h5" stroke-dasharray="2 2"/>
        <path d="M20 8.5v7" stroke-dasharray="2 2"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeBatchExtendLeftToPlayhead();
    };

  } else {
    btnSplit.style.display = 'flex';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Potong Kiri Semua Layer Terpilih ke Playhead";
    btnLeft.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h4.5v7H4" stroke-dasharray="2 2"/>
        <path d="M15.5 8.5H20v7h-4.5"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Trim Left');
      try {
        selectedMultiRows.forEach(row => {
          executeTrimLeftOnRow(row, false);
        });
        calculateMaxDuration();
        updateMultiSelectQuickButtons();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    };

    btnSplit.title = "Bagi Semua Layer Terpilih di Playhead";
    btnSplit.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M8.5 8.5H4v7h4.5"/>
        <path d="M15.5 8.5H20v7h-4.5"/>
      </svg>
    `;
    btnSplit.onclick = (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Split');
      try {
        const rows = Array.from(selectedMultiRows);
        rows.forEach(row => {
          const res = executeSplitOnRow(row, false);
          if (res && res.newRow) {
            selectedMultiRows.add(res.newRow);
            res.newRow.classList.add('multi-selected');
          }
        });
        updateMultiSelectUI();
        calculateMaxDuration();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    };

    btnRight.title = "Potong Kanan Semua Layer Terpilih ke Playhead";
    btnRight.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M8.5 8.5H4v7h4.5"/>
        <path d="M20 8.5h-4.5v7H20" stroke-dasharray="2 2"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      beginUndoGroup('Batch Trim Right');
      try {
        selectedMultiRows.forEach(row => {
          executeTrimRightOnRow(row, false);
        });
        calculateMaxDuration();
        updateMultiSelectQuickButtons();
        syncThreeLayers();
      } finally {
        endUndoGroup();
      }
    };
  }
}

function executeBatchExtendRightToPlayhead() {
  beginUndoGroup('Batch Extend Right');
  try {
    selectedMultiRows.forEach(row => {
      const clip = row.querySelector('.track-clip');
      if (clip) {
        const curMargin = parseFloat(clip.style.marginLeft) || 0;
        const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
        if (timelineOffset >= curMargin + curWidth) {
          const newWidth = Math.max(20, timelineOffset - curMargin);
          clip.style.width = `${newWidth}px`;
        }
      }
    });
    calculateMaxDuration();
    updateMultiSelectQuickButtons();
    syncThreeLayers();
  } finally {
    endUndoGroup();
  }
}

function executeBatchMoveRightToPlayhead() {
  beginUndoGroup('Batch Move Right');
  try {
    selectedMultiRows.forEach(row => {
      const clip = row.querySelector('.track-clip');
      if (clip) {
        const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
        clip.style.marginLeft = `${Math.max(0, timelineOffset - curWidth)}px`;
      }
    });
    calculateMaxDuration();
    updateMultiSelectQuickButtons();
    syncThreeLayers();
  } finally {
    endUndoGroup();
  }
}

function executeBatchMoveLeftToPlayhead() {
  beginUndoGroup('Batch Move Left');
  try {
    selectedMultiRows.forEach(row => {
      const clip = row.querySelector('.track-clip');
      if (clip) {
        clip.style.marginLeft = `${Math.max(0, timelineOffset)}px`;
      }
    });
    calculateMaxDuration();
    updateMultiSelectQuickButtons();
    syncThreeLayers();
  } finally {
    endUndoGroup();
  }
}

function executeBatchExtendLeftToPlayhead() {
  beginUndoGroup('Batch Extend Left');
  try {
    selectedMultiRows.forEach(row => {
      const clip = row.querySelector('.track-clip');
      if (clip) {
        const curMargin = parseFloat(clip.style.marginLeft) || 0;
        const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
        const curEnd = curMargin + curWidth;
        if (timelineOffset <= curMargin) {
          const newMargin = Math.max(0, timelineOffset);
          const newWidth = Math.max(20, curEnd - newMargin);
          clip.style.marginLeft = `${newMargin}px`;
          clip.style.width = `${newWidth}px`;
        }
      }
    });
    calculateMaxDuration();
    updateMultiSelectQuickButtons();
    syncThreeLayers();
  } finally {
    endUndoGroup();
  }
}

function executeBatchAlign(type) {
  if (selectedMultiRows.size === 0) return;
  const rows = Array.from(selectedMultiRows);

  if (type === 'left') {
    let minMargin = Infinity;
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const m = parseFloat(clip.style.marginLeft) || 0;
        if (m < minMargin) minMargin = m;
      }
    });
    if (minMargin !== Infinity) {
      rows.forEach(r => {
        const clip = r.querySelector('.track-clip');
        if (clip) clip.style.marginLeft = `${minMargin}px`;
      });
    }
  } else if (type === 'center') {
    let sumCenter = 0;
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const m = parseFloat(clip.style.marginLeft) || 0;
        const w = parseFloat(clip.style.width) || clip.offsetWidth || 200;
        sumCenter += (m + w / 2);
      }
    });
    const avgCenter = sumCenter / rows.length;
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const w = parseFloat(clip.style.width) || clip.offsetWidth || 200;
        clip.style.marginLeft = `${Math.max(0, avgCenter - w / 2)}px`;
      }
    });
  } else if (type === 'right') {
    let maxEnd = 0;
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const m = parseFloat(clip.style.marginLeft) || 0;
        const w = parseFloat(clip.style.width) || clip.offsetWidth || 200;
        if (m + w > maxEnd) maxEnd = m + w;
      }
    });
    rows.forEach(r => {
      const clip = r.querySelector('.track-clip');
      if (clip) {
        const w = parseFloat(clip.style.width) || clip.offsetWidth || 200;
        clip.style.marginLeft = `${Math.max(0, maxEnd - w)}px`;
      }
    });
  } else if (type === 'dist-h') {
    if (rows.length > 2) {
      let minStart = Infinity, maxStart = 0;
      rows.forEach(r => {
        const clip = r.querySelector('.track-clip');
        if (clip) {
          const m = parseFloat(clip.style.marginLeft) || 0;
          if (m < minStart) minStart = m;
          if (m > maxStart) maxStart = m;
        }
      });
      const step = (maxStart - minStart) / (rows.length - 1);
      rows.forEach((r, idx) => {
        const clip = r.querySelector('.track-clip');
        if (clip) clip.style.marginLeft = `${minStart + idx * step}px`;
      });
    }
  }

  calculateMaxDuration();
}

function spawnFallingCutFragment(clip, discardedRect, direction = 'left') {
  if (!clip || !discardedRect || discardedRect.width <= 0) return;

  const fragment = document.createElement('div');
  fragment.className = `cut-physics-fragment dir-${direction}`;
  
  const computed = window.getComputedStyle(clip);
  fragment.style.left = `${discardedRect.left}px`;
  fragment.style.top = `${discardedRect.top}px`;
  fragment.style.width = `${discardedRect.width}px`;
  fragment.style.height = `${discardedRect.height}px`;
  
  if (computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    fragment.style.backgroundColor = computed.backgroundColor;
  }
  if (computed.background) fragment.style.background = computed.background;
  fragment.style.borderRadius = computed.borderRadius || '12px';
  fragment.style.borderLeft = computed.borderLeft;
  fragment.style.boxShadow = 'none';
  fragment.style.filter = 'none';

  const name = clip.querySelector('.track-clip-name')?.textContent || '';
  if (name && discardedRect.width > 35) {
    const span = document.createElement('span');
    span.textContent = name;
    span.style.color = computed.color || '#FFF2C2';
    span.style.fontWeight = '800';
    span.style.fontSize = '0.8rem';
    span.style.padding = '0 0.85rem';
    span.style.display = 'flex';
    span.style.alignItems = 'center';
    span.style.height = '100%';
    span.style.whiteSpace = 'nowrap';
    span.style.overflow = 'hidden';
    span.style.textOverflow = 'ellipsis';
    fragment.appendChild(span);
  }

  document.body.appendChild(fragment);
  setTimeout(() => fragment.remove(), 420);
}

function spawnCutFragment(row, marginLeft, width, direction = 'left') {
  if (!row || width <= 0) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const clipRect = clip.getBoundingClientRect();
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const ratio = clipRect.width / curWidth;
  const discardedPx = Math.max(1, width * ratio);

  spawnFallingCutFragment(clip, {
    left: clipRect.left,
    top: clipRect.top,
    width: discardedPx,
    height: clipRect.height
  }, direction);
}

function spawnSplitEffect(trackway, offset) {
  if (!trackway) return;
  const flash = document.createElement('div');
  flash.className = 'cut-split-flash';
  flash.style.left = `calc(50% - 52px + ${offset}px)`;
  trackway.appendChild(flash);
  setTimeout(() => flash.remove(), 260);
}

function executeTrimLeftOnRow(row, shouldRecord = true) {
  if (!row) return null;
  const clip = row.querySelector('.track-clip');
  const trackway = row.querySelector('.track-trackway');
  if (!clip || !trackway) return null;

  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  if (timelineOffset > curMargin && timelineOffset < curEnd) {
    if (shouldRecord) beginUndoGroup('Trim Left');
    try {
      const discardedWidth = timelineOffset - curMargin;
      const clipRect = clip.getBoundingClientRect();
      const ratio = clipRect.width / curWidth;
      const discardedPx = Math.max(1, discardedWidth * ratio);

      spawnFallingCutFragment(clip, {
        left: clipRect.left,
        top: clipRect.top,
        width: discardedPx,
        height: clipRect.height
      }, 'left');

      const newMargin = timelineOffset;
      const newWidth = Math.max(20, curEnd - timelineOffset);

      clip.style.marginLeft = `${newMargin}px`;
      clip.style.width = `${newWidth}px`;

      const recordData = {
        clip: clip,
        oldMargin: curMargin,
        oldWidth: curWidth,
        newMargin: newMargin,
        newWidth: newWidth
      };

      if (shouldRecord) calculateMaxDuration();

      syncThreeLayers();
      renderCanvasOverlay();
      return recordData;
    } finally {
      if (shouldRecord) endUndoGroup();
    }
  }
  return null;
}

function executeTrimRightOnRow(row, shouldRecord = true) {
  if (!row) return null;
  const clip = row.querySelector('.track-clip');
  const trackway = row.querySelector('.track-trackway');
  if (!clip || !trackway) return null;

  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  if (timelineOffset > curMargin && timelineOffset < curEnd) {
    if (shouldRecord) beginUndoGroup('Trim Right');
    try {
      const discardedWidth = curEnd - timelineOffset;
      const clipRect = clip.getBoundingClientRect();
      const ratio = clipRect.width / curWidth;
      const remainingPx = (timelineOffset - curMargin) * ratio;
      const discardedPx = Math.max(1, discardedWidth * ratio);

      spawnFallingCutFragment(clip, {
        left: clipRect.left + remainingPx,
        top: clipRect.top,
        width: discardedPx,
        height: clipRect.height
      }, 'right');

      const newWidth = Math.max(20, timelineOffset - curMargin);

      clip.style.width = `${newWidth}px`;

      const recordData = {
        clip: clip,
        oldMargin: curMargin,
        oldWidth: curWidth,
        newMargin: curMargin,
        newWidth: newWidth
      };

      if (shouldRecord) calculateMaxDuration();

      syncThreeLayers();
      renderCanvasOverlay();
      return recordData;
    } finally {
      if (shouldRecord) endUndoGroup();
    }
  }
  return null;
}

function executeSplitOnRow(row, shouldRecord = true) {
  if (!row) return null;
  const clip = row.querySelector('.track-clip');
  const trackway = row.querySelector('.track-trackway');
  if (!clip || !trackway) return null;

  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  if (timelineOffset > curMargin + 5 && timelineOffset < curEnd - 5) {
    if (shouldRecord) beginUndoGroup('Split Layer');
    try {
      const leftW = timelineOffset - curMargin;
      const rightW = curEnd - timelineOffset;

      spawnSplitEffect(trackway, timelineOffset);

      clip.style.width = `${leftW}px`;
      clip.classList.add('clip-split-snap');
      setTimeout(() => clip.classList.remove('clip-split-snap'), 280);

      const cat = row.dataset.category || 'text';
      const name = row.querySelector('.track-clip-name')?.textContent || 'Text Layer';
      const origId = row.dataset.layerId;
      const newId = 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

      const newRow = createTrackRowElement(cat, name, rightW, timelineOffset, newId);
      if (row.dataset.tagColor) newRow.dataset.tagColor = row.dataset.tagColor;
      if (row.dataset.shapeType) newRow.dataset.shapeType = row.dataset.shapeType;
      newRow.classList.add('split-slide-in');
      row.parentNode.insertBefore(newRow, row);
      bindTrackEvents(newRow);
      setTimeout(() => newRow.classList.remove('split-slide-in'), 360);

      const newClip = newRow.querySelector('.track-clip');
      if (newClip) {
        newClip.classList.add('clip-split-snap');
        if (row.dataset.tagColor && row.dataset.tagColor !== 'none') {
          newClip.style.borderLeft = `5px solid ${row.dataset.tagColor}`;
        }
        setTimeout(() => newClip.classList.remove('clip-split-snap'), 280);
      }

      if (origId && newId) {
        if (layerTransforms.has(origId)) layerTransforms.set(newId, JSON.parse(JSON.stringify(layerTransforms.get(origId))));
        if (layerKeyframes.has(origId)) layerKeyframes.set(newId, JSON.parse(JSON.stringify(layerKeyframes.get(origId))));
        if (layerFills.has(origId)) layerFills.set(newId, JSON.parse(JSON.stringify(layerFills.get(origId))));
        if (layerBorderShadow.has(origId)) layerBorderShadow.set(newId, JSON.parse(JSON.stringify(layerBorderShadow.get(origId))));
        if (layerShapeParams.has(origId)) layerShapeParams.set(newId, JSON.parse(JSON.stringify(layerShapeParams.get(origId))));
        if (layerCameraParams.has(origId)) layerCameraParams.set(newId, JSON.parse(JSON.stringify(layerCameraParams.get(origId))));
        if (layerMotionBlur.has(origId)) layerMotionBlur.set(newId, layerMotionBlur.get(origId));
      }

      const recordData = {
        origClip: clip,
        origWidth: curWidth,
        leftWidth: leftW,
        newRow: newRow
      };

      if (shouldRecord) calculateMaxDuration();

      syncThreeLayers();
      renderCanvasOverlay();
      return { recordData, newRow };
    } finally {
      if (shouldRecord) endUndoGroup();
    }
  }
  return null;
}

function executeExtendRightToPlayhead(row) {
  if (!row) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;

  if (timelineOffset >= curMargin + curWidth) {
    beginUndoGroup('Extend Right');
    try {
      const newWidth = Math.max(20, timelineOffset - curMargin);
      clip.style.width = `${newWidth}px`;
      calculateMaxDuration();
      updateInspectorQuickButtons();
      syncThreeLayers();
      renderCanvasOverlay();
    } finally {
      endUndoGroup();
    }
  }
}

function executeMoveRightToPlayhead(row) {
  if (!row) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;

  beginUndoGroup('Move Right');
  try {
    const newMargin = Math.max(0, timelineOffset - curWidth);
    clip.style.marginLeft = `${newMargin}px`;
    calculateMaxDuration();
    updateInspectorQuickButtons();
    syncThreeLayers();
    renderCanvasOverlay();
  } finally {
    endUndoGroup();
  }
}

function executeMoveLeftToPlayhead(row) {
  if (!row) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const curMargin = parseFloat(clip.style.marginLeft) || 0;

  beginUndoGroup('Move Left');
  try {
    const newMargin = Math.max(0, timelineOffset);
    clip.style.marginLeft = `${newMargin}px`;
    calculateMaxDuration();
    updateInspectorQuickButtons();
    syncThreeLayers();
    renderCanvasOverlay();
  } finally {
    endUndoGroup();
  }
}

function executeExtendLeftToPlayhead(row) {
  if (!row) return;
  const clip = row.querySelector('.track-clip');
  if (!clip) return;
  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  if (timelineOffset <= curMargin) {
    beginUndoGroup('Extend Left');
    try {
      const newMargin = Math.max(0, timelineOffset);
      const newWidth = Math.max(20, curEnd - newMargin);
      clip.style.marginLeft = `${newMargin}px`;
      clip.style.width = `${newWidth}px`;
      calculateMaxDuration();
      updateInspectorQuickButtons();
      syncThreeLayers();
      renderCanvasOverlay();
    } finally {
      endUndoGroup();
    }
  }
}

function createTrackRowElement(cat, name, width, marginLeft, customId = null) {
  const row = document.createElement('div');
  row.className = 'track-row';
  row.dataset.category = cat || 'media';
  row.dataset.layerId = customId || ('layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));

  row.innerHTML = `
    <button class="track-eye" title="Toggle Visibility / Tahan untuk Multi-Select">
      <span class="material-symbols-rounded">${isMultiSelectMode ? 'radio_button_unchecked' : 'visibility'}</span>
    </button>
    <div class="track-trackway" style="transform: translateX(-${timelineOffset}px);">
      <div class="track-clip" style="width: ${width}px; margin-left: ${marginLeft}px;">
        <div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </div>
        <span class="track-clip-name">${name}</span>
        <div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    </div>
    <button class="track-reorder-handle" title="Tahan & geser untuk atur urutan layer (Reorder)">
      <span class="material-symbols-rounded">menu</span>
    </button>
  `;

  return row;
}

function toggleEye(btn, shouldRecord = false) {
  const icon = btn.querySelector('.material-symbols-rounded');
  const trackway = btn.nextElementSibling;
  const row = btn.closest('.track-row');
  const isAudio = row && row.dataset.category === 'audio';

  if (isAudio) {
    const isMuted = icon.textContent.trim() === 'volume_off';
    if (isMuted) {
      icon.textContent = 'volume_up';
      icon.style.color = '#2ecc71';
      if (trackway) trackway.style.opacity = '1';
    } else {
      icon.textContent = 'volume_off';
      icon.style.color = 'rgba(255, 240, 194, 0.4)';
      if (trackway) trackway.style.opacity = '0.35';
    }
    syncAudioPlayback();
  } else {
    const isHidden = icon.textContent.trim() === 'visibility_off';
    if (isHidden) {
      icon.textContent = 'visibility';
      icon.style.color = 'var(--col-yellow)';
      if (trackway) trackway.style.opacity = '1';
    } else {
      icon.textContent = 'visibility_off';
      icon.style.color = 'rgba(255, 240, 194, 0.4)';
      if (trackway) trackway.style.opacity = '0.35';
    }
  }

  if (shouldRecord) {
    recordAction({
      type: 'TOGGLE_EYE',
      eyeBtn: btn
    });
  }

  syncThreeLayers();
  renderCanvasOverlay();
}

const SHAPE_ITEMS = [
  { icon: 'square', shapeType: 'square', filename: 'Shape_Kotak.svg', title: 'Kotak' },
  { icon: 'circle', shapeType: 'circle', filename: 'Shape_Bulat.svg', title: 'Bulat' },
  { icon: 'crop_square', shapeType: 'round', filename: 'Shape_Round.svg', title: 'Round' },
  { icon: 'change_history', shapeType: 'triangle', filename: 'Shape_Segitiga.svg', title: 'Segitiga' },
  { icon: 'horizontal_rule', shapeType: 'line', filename: 'Shape_Line.svg', title: 'Line' },
  { icon: 'arrow_right_alt', shapeType: 'arrow', filename: 'Shape_Panah.svg', title: 'Panah' }
];

let currentMediaTabFilter = 'foto'; // 'foto' | 'video' | 'audio'

const CATEGORY_ITEMS = {
  shape: [],
  media: [],
  camera: [
    { icon: 'videocam', name: 'Camera', filename: 'Camera_1', sub: 'Camera Layer', cat: 'camera' },
    { icon: 'crop_free', name: 'Null', filename: 'Null_1', sub: 'Null Object', cat: 'null' }
  ],
  text: [
    { icon: 'title', name: 'Judul Utama', filename: 'Heading_Title.txt', sub: 'Text Header' },
    { icon: 'subtitles', name: 'Subtitle Caption', filename: 'Subtitle_Text.txt', sub: 'Text Caption' },
    { icon: 'label', name: 'Badge Callout', filename: 'Badge_Callout.txt', sub: 'Text Pill' }
  ]
};

function renderCategoryItems(catKey) {
  const grid = document.getElementById('popoverItemsGrid') || document.getElementById('popoverItemsShelf');
  if (!grid) return;

  const popover = document.getElementById('addTrackPopover');
  if (popover) {
    popover.classList.remove('cat-shape', 'cat-media', 'cat-camera', 'cat-text');
    popover.classList.add('cat-' + catKey);
  }

  grid.innerHTML = '';
  grid.className = 'popover-items-grid';

  if (catKey === 'shape') {
    grid.className = 'popover-items-grid shape-tile-grid';

    SHAPE_ITEMS.forEach(shape => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shape-tile-btn';
      btn.title = shape.title;
      btn.innerHTML = `
        <span class="material-symbols-rounded">${shape.icon}</span>
        <span class="shape-tile-label">${shape.title}</span>
      `;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        addTrackWithType('shape', shape.filename, null, shape.shapeType);
        const popover = document.getElementById('addTrackPopover');
        const fab = document.getElementById('fabAddTrack');
        if (popover) popover.classList.remove('active');
        if (fab) fab.classList.remove('active');
      });

      grid.appendChild(btn);
    });
    return;
  }

  if (catKey === 'media') {
    grid.className = 'popover-items-grid media-shelf-grid';

    const allMedia = getGlobalMediaLibrary();
    let filteredList = [];
    let acceptTypes = 'image/*,video/*,audio/*';
    let emptyTitle = 'Media Masih Kosong';
    let emptySub = 'Klik Import atau drag & drop file ke sini untuk mengumpulkan media Anda';
    let emptyIcon = 'cloud_upload';

    if (currentMediaTabFilter === 'video') {
      filteredList = allMedia.filter(m => (m.type && m.type.startsWith('video')) || (m.name && /\.(mp4|webm|mov|mkv)$/i.test(m.name)));
      acceptTypes = 'video/*,.mp4,.webm,.mov,.mkv';
      emptyTitle = 'Media Video Masih Kosong';
      emptySub = 'Klik Import atau drag & drop file video (.mp4, .webm) ke sini';
      emptyIcon = 'movie';
    } else if (currentMediaTabFilter === 'audio') {
      filteredList = allMedia.filter(m => (m.type && m.type.startsWith('audio')) || (m.name && /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(m.name)));
      acceptTypes = 'audio/*,.mp3,.wav,.aac,.m4a,.ogg,.flac';
      emptyTitle = 'Media Audio Masih Kosong';
      emptySub = 'Klik Import atau drag & drop file musik (.mp3, .wav) ke sini';
      emptyIcon = 'audiotrack';
    } else {
      // 'foto'
      filteredList = allMedia.filter(m => !(m.type && m.type.startsWith('audio')) && !(m.name && /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(m.name)) && !(m.type && m.type.startsWith('video')) && !(m.name && /\.(mp4|webm|mov|mkv)$/i.test(m.name)));
      acceptTypes = 'image/*,.png,.jpg,.jpeg,.svg,.gif,.webp';
      emptyTitle = 'Media Foto Masih Kosong';
      emptySub = 'Klik Import atau drag & drop file foto ke sini';
      emptyIcon = 'add_photo_alternate';
    }

    // 1. Top Media Pool Header Strip: "Import" button + [Foto, Video, Audio] filter pills
    const headerStrip = document.createElement('div');
    headerStrip.className = 'media-pool-header-strip';
    headerStrip.innerHTML = `
      <input type="file" id="mediaPoolFileInput" accept="image/*,video/*,audio/*,.png,.jpg,.jpeg,.svg,.gif,.webp,.mp4,.webm,.mov,.mkv,.mp3,.wav,.aac,.m4a,.ogg,.flac" multiple style="display:none;">
      <button type="button" class="media-pool-import-btn" id="btnMediaPoolImport" title="Import Foto, Video, atau Audio">
        <span class="material-symbols-rounded" style="font-size:18px;">add</span>
        Import
      </button>
      <div class="media-filter-pills">
        <button type="button" class="media-filter-pill ${currentMediaTabFilter === 'foto' ? 'active' : ''}" data-filter="foto">Foto</button>
        <button type="button" class="media-filter-pill ${currentMediaTabFilter === 'video' ? 'active' : ''}" data-filter="video">Video</button>
        <button type="button" class="media-filter-pill ${currentMediaTabFilter === 'audio' ? 'active' : ''}" data-filter="audio">Audio</button>
      </div>
    `;

    const poolFileInput = headerStrip.querySelector('#mediaPoolFileInput');
    const btnImport = headerStrip.querySelector('#btnMediaPoolImport');
    const filterPills = headerStrip.querySelectorAll('.media-filter-pill');

    if (btnImport && poolFileInput) {
      btnImport.addEventListener('click', (e) => {
        e.stopPropagation();
        poolFileInput.click();
      });
      poolFileInput.addEventListener('change', () => {
        if (poolFileInput.files && poolFileInput.files.length > 0) {
          handleImportedFiles(poolFileInput.files);
        }
      });
    }

    filterPills.forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        currentMediaTabFilter = pill.dataset.filter || 'foto';
        renderCategoryItems('media');
      });
    });

    grid.appendChild(headerStrip);

    // 2. Main Gallery
    if (currentMediaTabFilter === 'audio') {
      const listCol = document.createElement('div');
      listCol.style.display = 'flex';
      listCol.style.flexDirection = 'column';
      listCol.style.gap = '8px';
      listCol.style.width = '100%';
      listCol.style.overflowY = 'auto';
      listCol.style.maxHeight = '180px';
      listCol.style.padding = '4px 0';

      if (!filteredList || filteredList.length === 0) {
        const emptyHint = document.createElement('div');
        emptyHint.style.cssText = 'color: var(--col-cream, #FAB778); font-size: 0.8rem; padding: 20px 10px; text-align: center; opacity: 0.75; font-weight: 600;';
        emptyHint.textContent = 'Belum ada file audio. Klik "Import" di atas untuk menambahkan musik.';
        listCol.appendChild(emptyHint);
      } else {
        filteredList.forEach(item => {
          const card = document.createElement('div');
          card.className = 'audio-shelf-card';
          card.innerHTML = `
            <div class="audio-shelf-icon">
              <span class="material-symbols-rounded">audiotrack</span>
            </div>
            <div class="audio-shelf-info">
              <span class="audio-shelf-title">${item.name}</span>
              <span class="audio-shelf-sub">Audio Clip \u2022 Klik untuk menambahkan ke timeline</span>
            </div>
          `;
          card.addEventListener('click', (e) => {
            e.stopPropagation();
            addTrackWithType('audio', item.name, item.url);
            const popover = document.getElementById('addTrackPopover');
            const fab = document.getElementById('fabAddTrack');
            if (popover) popover.classList.remove('active');
            if (fab) fab.classList.remove('active');
          });
          listCol.appendChild(card);
        });
      }

      grid.appendChild(listCol);
    } else {
      const itemsRow = document.createElement('div');
      itemsRow.className = 'media-shelf-items-row';

      if (!filteredList || filteredList.length === 0) {
        const emptyHint = document.createElement('div');
        emptyHint.style.cssText = 'color: var(--col-cream, #FAB778); font-size: 0.8rem; padding: 20px 10px; text-align: center; opacity: 0.75; font-weight: 600; width: 100%;';
        emptyHint.textContent = (currentMediaTabFilter === 'video')
          ? 'Belum ada file video. Klik "Import" di atas untuk menambahkan video.'
          : 'Belum ada file foto. Klik "Import" di atas untuk menambahkan foto.';
        itemsRow.appendChild(emptyHint);
      } else {
        filteredList.forEach(item => {
          const thumb = createMediaThumbnailElement(item, (mediaItem) => {
            const isVideoItem = (mediaItem.type && mediaItem.type.startsWith('video')) || (mediaItem.name && /\.(mp4|webm|mov|mkv)$/i.test(mediaItem.name));
            let finalMediaUrl = mediaItem.url;
            if (!isVideoItem && !finalMediaUrl && mediaItem.blob) {
              finalMediaUrl = URL.createObjectURL(mediaItem.blob);
              mediaItem.url = finalMediaUrl;
            }
            const trackUrl = isVideoItem ? (mediaItem.id || mediaItem.url) : (finalMediaUrl || mediaItem.id);
            addTrackWithType(isVideoItem ? 'video' : 'media', mediaItem.name, trackUrl);
            const popover = document.getElementById('addTrackPopover');
            const fab = document.getElementById('fabAddTrack');
            if (popover) popover.classList.remove('active');
            if (fab) fab.classList.remove('active');
          });
          itemsRow.appendChild(thumb);
        });
      }

      grid.appendChild(itemsRow);
    }
    return;
  }

  const items = CATEGORY_ITEMS[catKey] || CATEGORY_ITEMS.text;
  items.forEach(item => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shelf-item-card';
    card.innerHTML = `
      <span class="material-symbols-rounded insp-tile-icon">${item.icon}</span>
      <span class="insp-tile-label">${item.name}</span>
    `;

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      addTrackWithType(item.cat || catKey, item.filename, null, (item.cat === 'null' || item.name.toLowerCase().includes('null')) ? 'null' : null);
      const popover = document.getElementById('addTrackPopover');
      const fab = document.getElementById('fabAddTrack');
      if (popover) popover.classList.remove('active');
      if (fab) fab.classList.remove('active');
    });

    grid.appendChild(card);
  });
}

function ensureVideoConvertModal() {
  let modal = document.getElementById('videoConvertModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'videoConvertModal';
    modal.className = 'video-convert-modal';
    modal.innerHTML = `
      <div class="video-convert-box">
        <div class="convert-icon-wrap">
          <span class="material-symbols-rounded">autorenew</span>
        </div>
        <div class="convert-title">Mengonversi Video ke Frame Sequence</div>
        <div class="convert-sub" id="convertProgressText">Mempersiapkan ekstraksi frame...</div>
        <div class="convert-progress-track">
          <div class="convert-progress-fill" id="convertProgressFill" style="width: 0%;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  return modal;
}

function showVideoConvertProgress(pct, text) {
  const modal = ensureVideoConvertModal();
  modal.classList.add('active');
  const fill = document.getElementById('convertProgressFill');
  const txt = document.getElementById('convertProgressText');
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (txt) txt.textContent = text || `Mengekstrak frame... (${Math.round(pct)}%)`;
}

function hideVideoConvertProgress() {
  const modal = document.getElementById('videoConvertModal');
  if (modal) modal.classList.remove('active');
}

async function convertVideoToFrameSequence(file, onProgress) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    video.onloadedmetadata = async () => {
      const duration = (video.duration && isFinite(video.duration)) ? video.duration : 5;
      const targetFps = 30;
      const totalFrames = Math.max(1, Math.round(duration * targetFps));
      const stepSec = 1 / targetFps;

      const rawW = video.videoWidth || 1280;
      const rawH = video.videoHeight || 720;
      const aspect = (rawW && rawH) ? (rawW / rawH) : 1.7778;

      const maxDim = 1280;
      let drawW = rawW;
      let drawH = rawH;
      if (drawW > maxDim || drawH > maxDim) {
        if (drawW >= drawH) {
          drawW = maxDim;
          drawH = Math.round(maxDim / aspect);
        } else {
          drawH = maxDim;
          drawW = Math.round(maxDim * aspect);
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = drawW;
      canvas.height = drawH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const bitmaps = [];
      const frameBlobs = [];

      for (let i = 0; i < totalFrames; i++) {
        const time = i * stepSec;
        await new Promise((seekDone) => {
          const onSeek = () => {
            video.removeEventListener('seeked', onSeek);
            seekDone();
          };
          video.addEventListener('seeked', onSeek);
          video.currentTime = Math.min(duration, Math.max(0, time));
        });

        ctx.drawImage(video, 0, 0, drawW, drawH);

        const fCanvas = document.createElement('canvas');
        fCanvas.width = drawW;
        fCanvas.height = drawH;
        fCanvas.getContext('2d').drawImage(canvas, 0, 0);
        bitmaps.push(fCanvas);

        await new Promise(r => {
          canvas.toBlob(blob => {
            if (blob) frameBlobs.push(blob);
            r();
          }, 'image/jpeg', 0.85);
        });

        const pct = Math.round(((i + 1) / totalFrames) * 100);
        if (onProgress) {
          onProgress(pct, i + 1, totalFrames);
        }
      }

      const thumbDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      resolve({
        fps: targetFps,
        duration: duration,
        aspectRatio: aspect,
        frames: bitmaps,
        frameBlobs: frameBlobs,
        width: drawW,
        height: drawH,
        totalFrames: totalFrames,
        thumbnailUrl: thumbDataUrl,
        audioBlob: file,
        audioUrl: objectUrl,
        isReady: true
      });
    };

    video.onerror = (err) => {
      reject(err);
    };

    video.load();
  });
}

async function handleImportedFiles(fileList, forceCat) {
  if (!fileList || fileList.length === 0) return;

  let lastDetectedTab = null;

  for (const file of Array.from(fileList)) {
    const mime = file.type ? file.type.toLowerCase() : '';
    const name = file.name ? file.name.toLowerCase() : '';

    let cat = 'media';
    let fileMime = file.type;

    if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v|3gp)$/i.test(name)) {
      cat = 'video';
      fileMime = fileMime || 'video/mp4';
      lastDetectedTab = 'video';
    } else if (mime.startsWith('audio/') || /\.(mp3|wav|aac|m4a|ogg|flac|wma|opus)$/i.test(name)) {
      cat = 'audio';
      fileMime = fileMime || 'audio/mp3';
      lastDetectedTab = 'audio';
    } else {
      cat = 'media';
      fileMime = fileMime || 'image/png';
      if (!lastDetectedTab) lastDetectedTab = 'foto';
    }

    if (cat === 'video') {
      const mediaId = 'media_vid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const liveUrl = URL.createObjectURL(file);

      const tempVid = document.createElement('video');
      tempVid.src = liveUrl;
      tempVid.crossOrigin = 'anonymous';
      tempVid.muted = true;
      tempVid.playsInline = true;
      tempVid.preload = 'auto';

      tempVid.onloadeddata = () => {
        const rawW = tempVid.videoWidth || 1280;
        const rawH = tempVid.videoHeight || 720;
        const aspect = (rawW && rawH) ? (rawW / rawH) : 1.7778;

        let thumbUrl = '';
        try {
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = 240;
          thumbCanvas.height = Math.max(60, Math.round(240 / aspect));
          const ctx = thumbCanvas.getContext('2d');
          ctx.drawImage(tempVid, 0, 0, thumbCanvas.width, thumbCanvas.height);
          thumbUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);
        } catch(_) {}

        const mediaItem = {
          id: mediaId,
          name: file.name,
          type: fileMime || 'video/mp4',
          url: liveUrl,
          thumbnailUrl: thumbUrl,
          blob: file,
          duration: (tempVid.duration && isFinite(tempVid.duration)) ? tempVid.duration : 5,
          aspectRatio: aspect,
          width: rawW,
          height: rawH,
          createdAt: Date.now()
        };

        const list = getGlobalMediaLibrary();
        list.unshift(mediaItem);
        saveGlobalMediaLibrary(list);
        if (typeof saveMediaBinaryToIDB === 'function') saveMediaBinaryToIDB(mediaItem);

        mediaNaturalRatioMap.set(mediaId, aspect);
        mediaNaturalRatioMap.set(liveUrl, aspect);
        mediaNaturalRatioMap.set(file.name, aspect);

        currentMediaTabFilter = 'video';
        if (typeof syncAllMediaGrids === 'function') syncAllMediaGrids();
        if (typeof renderCategoryItems === 'function') renderCategoryItems('media');
      };
      continue;
    }

    if (cat === 'audio') {
      const objectUrl = URL.createObjectURL(file);
      if (typeof addGlobalMedia === 'function') {
        addGlobalMedia(objectUrl, file.name, fileMime, file);
      }
      continue;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        const aspect = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : 1.0;
        mediaNaturalRatioMap.set(dataUrl, aspect);
      };
      img.src = dataUrl;
      if (typeof addGlobalMedia === 'function') {
        addGlobalMedia(dataUrl, file.name, fileMime, file);
      }
    };
    reader.readAsDataURL(file);
  }

  if (lastDetectedTab) {
    currentMediaTabFilter = lastDetectedTab;
    setTimeout(() => {
      renderCategoryItems('media');
    }, 120);
  }
}

function addTrackWithType(category, customName, mediaUrl, shapeType) {
  const container = document.getElementById('trackRowsContainer');
  const viewport = document.getElementById('tracksViewport');
  if (!container) return null;

  let trackName = customName;
  if (!trackName) {
    if (category === 'shape') trackName = 'Shape_Kotak.svg';
    else if (category === 'null' || shapeType === 'null') trackName = 'Null_1';
    else if (category === 'media') trackName = 'Media_Photo.png';
    else if (category === 'video') trackName = 'Video_Clip.mp4';
    else if (category === 'audio') trackName = 'Audio_Track.mp3';
    else if (category === 'camera') trackName = 'Camera_1';
    else if (category === 'text') trackName = 'Heading_Title.txt';
    else trackName = 'New_Layer.png';
  }

  const widths = [360, 440, 520, 300, 480];
  const w = widths[Math.floor(Math.random() * widths.length)];
  const m = Math.max(0, timelineOffset);

  const isAudio = (category === 'audio');
  const defaultEyeIcon = isAudio ? 'volume_up' : 'visibility';

  const row = document.createElement('div');
  row.className = 'track-row adding';
  row.dataset.category = category || 'custom';
  if (shapeType) {
    row.dataset.shapeType = shapeType;
  }
  row.innerHTML = `
    <button class="track-eye" title="${isAudio ? 'Mute / Unmute Audio' : 'Toggle Visibility'} / Tahan untuk Multi-Select">
      <span class="material-symbols-rounded">${isMultiSelectMode ? 'radio_button_unchecked' : defaultEyeIcon}</span>
    </button>
    <div class="track-trackway" style="transform: translateX(-${timelineOffset}px);">
      <div class="track-clip" style="width: ${w}px; margin-left: ${m}px;" title="Klik untuk pilih / buka menu layer">
        <div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </div>
        <span class="track-clip-name">${trackName}</span>
        <div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    </div>
    <button class="track-reorder-handle" title="Tahan & geser untuk atur urutan layer (Reorder)">
      <span class="material-symbols-rounded">menu</span>
    </button>
  `;

  bindTrackEvents(row);
  setTimeout(() => row.classList.remove('adding'), 300);

  const id = row.dataset.layerId;
  if (mediaUrl && id) {
    const fill = getLayerFill(id);
    fill.type = 'media';
    fill.mediaUrl = mediaUrl;
    fill.color = null;
    fill.gradientType = null;

    if (mediaUrl && (mediaUrl.startsWith('video_pkg_') || mediaUrl.startsWith('pkg_') || videoFrameSequenceMap.has(mediaUrl))) {
      const seq = videoFrameSequenceMap.get(mediaUrl);
      const isStillConverting = !seq || !seq.isReady;
      if (isStillConverting) {
        const clipEl = row.querySelector('.track-clip');
        if (clipEl) {
          const pFill = document.createElement('div');
          pFill.className = 'track-clip-progress-fill';
          pFill.setAttribute('data-clip-progress-for', mediaUrl);
          const curPct = seq && seq.progress ? seq.progress : 0;
          pFill.style.width = `${curPct}%`;
          clipEl.appendChild(pFill);

          const pText = document.createElement('span');
          pText.className = 'track-clip-status-text';
          pText.setAttribute('data-clip-text-for', mediaUrl);
          pText.textContent = `${curPct}%`;
          clipEl.appendChild(pText);
        }
      }
      if (seq) {
        if (seq.aspectRatio) {
          mediaNaturalRatioMap.set(id, seq.aspectRatio);
          mediaNaturalRatioMap.set(mediaUrl, seq.aspectRatio);
          fill.aspectRatio = seq.aspectRatio;
        }
        if (seq.duration && isFinite(seq.duration)) {
          const targetWidth = Math.max(80, Math.round(seq.duration * PX_PER_SEC));
          const clipEl = row.querySelector('.track-clip');
          if (clipEl) clipEl.style.width = `${targetWidth}px`;
          calculateMaxDuration();
          rebuildTimeRuler(totalDuration);
        }
      }
      applyFillToMeshGlobal(id);
      applyTransformToThreeMesh(id, getLayerTransform(id));
      renderCanvasOverlay();
    } else if (isAudio) {
      const audio = new Audio(mediaUrl);
      audio.preload = 'auto';
      layerAudioMap.set(id, audio);
      audio.onloadedmetadata = () => {
        if (audio.duration && isFinite(audio.duration)) {
          const targetWidth = Math.max(80, Math.round(audio.duration * PX_PER_SEC));
          const clipEl = row.querySelector('.track-clip');
          if (clipEl) clipEl.style.width = `${targetWidth}px`;
          calculateMaxDuration();
          rebuildTimeRuler(totalDuration);
        }
      };
    } else if (category === 'video' || /\.(mp4|webm|mov|mkv|ogg|avi)$/i.test(mediaUrl) || mediaUrl.startsWith('data:video/')) {
      const vid = document.createElement('video');
      vid.src = mediaUrl;
      vid.crossOrigin = 'anonymous';
      vid.preload = 'auto';
      layerVideoMap.set(id, vid);
      vid.onloadedmetadata = () => {
        const aspect = (vid.videoWidth && vid.videoHeight) ? (vid.videoWidth / vid.videoHeight) : 1.0;
        mediaNaturalRatioMap.set(id, aspect);
        mediaNaturalRatioMap.set(mediaUrl, aspect);
        fill.aspectRatio = aspect;
        if (vid.duration && isFinite(vid.duration)) {
          const targetWidth = Math.max(80, Math.round(vid.duration * PX_PER_SEC));
          const clipEl = row.querySelector('.track-clip');
          if (clipEl) clipEl.style.width = `${targetWidth}px`;
          calculateMaxDuration();
          rebuildTimeRuler(totalDuration);
        }
        renderCanvasOverlay();
      };
    } else {
      const img = new Image();
      img.onload = () => {
        const aspect = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : 1.0;
        mediaNaturalRatioMap.set(id, aspect);
        mediaNaturalRatioMap.set(mediaUrl, aspect);
        fill.aspectRatio = aspect;
        applyFillToMeshGlobal(id);
        applyTransformToThreeMesh(id, getLayerTransform(id));
        renderCanvasOverlay();
        render3D();
      };
      img.src = mediaUrl;
      applyFillToMeshGlobal(id);
    }
  }

  container.prepend(row);
  if (viewport) viewport.scrollTop = 0;

  setTimeout(() => {
    row.classList.remove('adding');
  }, 340);

  calculateMaxDuration();

  recordAction({
    type: 'ADD_TRACK',
    element: row
  });

  syncThreeLayers();
  renderCanvasOverlay();

  return row;
}

function addTrack() {
  return addTrackWithType('media', 'Media_Clip.mp4');
}

// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// DETERMINISTIC OFFLINE HD VIDEO MUXER (ZERO LAG & 100% SMOOTH FPS)
// ══════════════════════════════════════════════════════════════

const WhammyVideo = (function() {
  function numToBytes(num, bytesCount) {
    const bytes = [];
    for (let i = bytesCount - 1; i >= 0; i--) {
      bytes.push((num >> (i * 8)) & 0xff);
    }
    return new Uint8Array(bytes);
  }

  function numToVarInt(num) {
    let len = 1;
    while (num >= (1 << (7 * len)) - 1 && len < 8) len++;
    const res = new Uint8Array(len);
    let val = num | (1 << (7 * len));
    for (let i = len - 1; i >= 0; i--) {
      res[i] = val & 0xff;
      val >>= 8;
    }
    return res;
  }

  function ebmlElement(id, data) {
    let idBytes;
    if (typeof id === 'number') {
      if (id <= 0xff) idBytes = new Uint8Array([id]);
      else if (id <= 0xffff) idBytes = new Uint8Array([id >> 8, id & 0xff]);
      else if (id <= 0xffffff) idBytes = new Uint8Array([id >> 16, (id >> 8) & 0xff, id & 0xff]);
      else idBytes = new Uint8Array([id >> 24, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
    } else {
      idBytes = id;
    }

    let payload;
    if (typeof data === 'string') {
      payload = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      payload = data;
    } else if (Array.isArray(data)) {
      let totalLen = 0;
      for (let i = 0; i < data.length; i++) totalLen += data[i].length;
      payload = new Uint8Array(totalLen);
      let off = 0;
      for (let i = 0; i < data.length; i++) {
        payload.set(data[i], off);
        off += data[i].length;
      }
    } else {
      payload = new Uint8Array(0);
    }

    const sizeBytes = numToVarInt(payload.length);
    const res = new Uint8Array(idBytes.length + sizeBytes.length + payload.length);
    res.set(idBytes, 0);
    res.set(sizeBytes, idBytes.length);
    res.set(payload, idBytes.length + sizeBytes.length);
    return res;
  }

  function parseWebPToVP8(dataUrl) {
    try {
      const binStr = atob(dataUrl.split(',')[1]);
      const len = binStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);

      if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70) {
        let offset = 12;
        while (offset < len - 8) {
          const fourCC = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
          const chunkSize = bytes[offset+4] | (bytes[offset+5] << 8) | (bytes[offset+6] << 16) | (bytes[offset+7] << 24);
          if (fourCC === 'VP8 ') {
            return bytes.subarray(offset + 8, offset + 8 + chunkSize);
          }
          offset += 8 + chunkSize + (chunkSize % 2);
        }
      }
    } catch(e) {}
    return null;
  }

  function toWebM(frames, width, height, fps) {
    const frameDurationMs = 1000 / fps;
    const totalDurationMs = frames.length * frameDurationMs;

    const ebmlHeader = ebmlElement(0x1a45dfa3, [
      ebmlElement(0x4286, new Uint8Array([1])),
      ebmlElement(0x42f7, new Uint8Array([1])),
      ebmlElement(0x42f2, new Uint8Array([4])),
      ebmlElement(0x42f3, new Uint8Array([8])),
      ebmlElement(0x4282, "webm"),
      ebmlElement(0x4287, new Uint8Array([2])),
      ebmlElement(0x4285, new Uint8Array([2]))
    ]);

    const timecodeScale = 1000000;
    const segmentInfo = ebmlElement(0x1549a966, [
      ebmlElement(0x2ad7b1, numToBytes(timecodeScale, 4)),
      ebmlElement(0x4d80, "FishToolStudio"),
      ebmlElement(0x5741, "FishToolStudio"),
      (function() {
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, totalDurationMs, false);
        return ebmlElement(0x4489, new Uint8Array(buf));
      })()
    ]);

    const videoTrack = ebmlElement(0xae, [
      ebmlElement(0xd7, new Uint8Array([1])),
      ebmlElement(0x73c5, new Uint8Array([1])),
      ebmlElement(0x83, new Uint8Array([1])),
      ebmlElement(0x86, "V_VP8"),
      ebmlElement(0xe0, [
        ebmlElement(0xb0, numToBytes(width, 2)),
        ebmlElement(0xba, numToBytes(height, 2))
      ])
    ]);
    const tracks = ebmlElement(0x1654ae6b, [videoTrack]);

    const clusters = [];
    const framesPerCluster = Math.max(1, Math.round(fps * 2));

    for (let c = 0; c < frames.length; c += framesPerCluster) {
      const clusterTimecode = Math.round(c * frameDurationMs);
      const clusterElements = [
        ebmlElement(0xe7, numToBytes(clusterTimecode, 4))
      ];

      const end = Math.min(frames.length, c + framesPerCluster);
      for (let f = c; f < end; f++) {
        const frameData = frames[f];
        const relTimecode = Math.round((f * frameDurationMs) - clusterTimecode);

        const blockHeader = new Uint8Array([
          0x81,
          (relTimecode >> 8) & 0xff,
          relTimecode & 0xff,
          0x80
        ]);

        const block = new Uint8Array(blockHeader.length + frameData.length);
        block.set(blockHeader, 0);
        block.set(frameData, blockHeader.length);

        clusterElements.push(ebmlElement(0xa3, block));
      }

      clusters.push(ebmlElement(0x1f43b675, clusterElements));
    }

    const segment = ebmlElement(0x18538067, [segmentInfo, tracks, ...clusters]);
    return new Blob([ebmlHeader, segment], { type: 'video/webm' });
  }

  return {
    parseWebPToVP8: parseWebPToVP8,
    toWebM: toWebM
  };
})();

// Fast Three.js Scene Evaluator for Offline Render (Runs in <0.2ms per frame, avoids all DOM lag)
function updateThreeSceneForExport(time) {
  const curTime = time !== undefined ? time : elapsed;
  applyActiveCameraPerspective(curTime);
  const rows = document.querySelectorAll('.track-row');
  rows.forEach((row, idx) => {
    const id = row.dataset.layerId;
    if (!id) return;

    const clip = row.querySelector('.track-clip');
    const eye = row.querySelector('.track-eye');
    const isHidden = eye && eye.querySelector('.material-symbols-rounded') && eye.querySelector('.material-symbols-rounded').textContent.trim() === 'visibility_off';

    const cat = row.dataset.category || 'media';
    const clipName = row.querySelector('.track-clip-name')?.textContent || '';
    const isVirtual = (cat === 'camera' || cat === 'null' || clipName.toLowerCase().startsWith('camera') || clipName.toLowerCase().startsWith('null'));

    const startSec = clip ? (parseFloat(clip.style.marginLeft) || 0) / PX_PER_SEC : 0;
    const durSec = clip ? (parseFloat(clip.style.width) || 300) / PX_PER_SEC : 5;
    const endSec = startSec + durSec;
    const isVisibleNow = !isVirtual && !isHidden && curTime >= startSec && curTime <= endSec;

    let mesh = meshLayerMap.get(id);
    if (mesh) {
      mesh.visible = isVisibleNow;
      if (isVisibleNow) {
        const wt = getLayerWorldTransform(id, new Set(), curTime);
        const order = rows.length - idx;
        const zEpsilon = order * 0.0001;

        applyTransformToThreeMesh(id, wt);

        if (mesh.material) {
          const fill = layerFills.get(id);
          let fillAlpha = 1;
          if (fill && fill.type === 'color') {
            const parsed = parseHexOrRgb(fill.color || '#FAB778');
            fillAlpha = (fill.alpha !== undefined) ? fill.alpha : (parsed.a !== undefined ? parsed.a : 1);
          }
          mesh.material.opacity = Math.max(0, Math.min(1, (wt.opacity / 100) * fillAlpha));
          mesh.material.needsUpdate = true;
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════
// IN-EDITOR LIVE PREVIEW HD FRAME-BY-FRAME VIDEO EXPORT ENGINE
// ══════════════════════════════════════════════════════════════
let exportFormat = 'h264';
let exportRes = 'source';
let exportFps = 'source';
let exportBitrate = 16;
let isExportRendering = false;
let exportCancelRequested = false;
let exportVideoBlob = null;
let exportVideoUrl = null;

function openMediaEncoder() {
  pausePlayback();
  saveCurrentProject();

  const modal = document.getElementById('exportModal');
  if (!modal) return;

  const durSec = calculateMaxDuration();
  const nameEl = document.getElementById('exportProjName');
  const durEl = document.getElementById('exportProjDuration');
  const titleInput = document.getElementById('activeTitle');
  if (nameEl && titleInput) nameEl.textContent = titleInput.textContent.trim() || 'My Project';
  if (durEl) {
    const m = Math.floor(durSec / 60);
    const s = Math.floor(durSec % 60);
    durEl.textContent = '00:' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  const progressBox = document.getElementById('exportProgressBox');
  const fill = document.getElementById('exportProgressFill');
  const pct = document.getElementById('lblExportPct');
  const status = document.getElementById('lblExportStatus');
  const btnRender = document.getElementById('btnStartExportRender');
  const btnDownload = document.getElementById('btnDownloadExportVideo');

  if (progressBox) progressBox.style.display = 'none';
  if (fill) fill.style.width = '0%';
  if (pct) pct.textContent = '0%';
  if (status) status.textContent = 'Ready to render';
  if (btnRender) {
    btnRender.textContent = 'RENDER VIDEO';
    btnRender.style.background = '#D06423';
  }
  if (btnDownload) btnDownload.style.display = 'none';

  modal.classList.add('active');
}

function closeExportModal() {
  const modal = document.getElementById('exportModal');
  if (modal) modal.classList.remove('active');
  if (isExportRendering) {
    exportCancelRequested = true;
  }
}

async function startLivePreviewRender() {
  if (!renderer3D || !scene3D || !camera3D) {
    alert('3D Canvas renderer belum siap.');
    return;
  }

  isExportRendering = true;
  exportCancelRequested = false;

  const btnRender = document.getElementById('btnStartExportRender');
  const btnDownload = document.getElementById('btnDownloadExportVideo');
  const progressBox = document.getElementById('exportProgressBox');
  const fill = document.getElementById('exportProgressFill');
  const pct = document.getElementById('lblExportPct');
  const status = document.getElementById('lblExportStatus');

  if (progressBox) progressBox.style.display = 'flex';
  if (btnRender) {
    btnRender.textContent = 'CANCEL';
    btnRender.style.background = '#B71C1C';
  }
  if (btnDownload) btnDownload.style.display = 'none';

  // 1. Calculate Exact HD Export Resolution (1080p / 4K / 720p)
  let exportW = 1920, exportH = 1080;
  const resKey = exportRes === 'source' ? (projectResolution || '1080p') : exportRes;
  const ratioKey = projectRatio || '16:9';

  if (resKey.toLowerCase().includes('4k')) {
    exportW = 3840; exportH = 2160;
  } else if (resKey.toLowerCase().includes('720')) {
    exportW = 1280; exportH = 720;
  } else {
    exportW = 1920; exportH = 1080;
  }

  if (ratioKey === '9:16') {
    const tmp = exportW; exportW = exportH; exportH = tmp;
  } else if (ratioKey === '1:1') {
    const minDim = Math.min(exportW, exportH);
    exportW = minDim; exportH = minDim;
  } else if (ratioKey === '4:5') {
    exportW = 1080; exportH = 1350;
  } else if (ratioKey === '4:3') {
    exportW = 1440; exportH = 1080;
  }

  // 2. Determine Duration & FPS
  const durSec = calculateMaxDuration();
  const fps = exportFps === 'source' ? (Number(projectFps) || 30) : Number(exportFps);
  const totalFrames = Math.max(1, Math.ceil(durSec * fps));

  const originalOffset = timelineOffset;

  // Save current preview container dimensions
  const container = document.getElementById('canvasVideo');
  const previewW = container ? (container.clientWidth || 360) : 360;
  const previewH = container ? (container.clientHeight || 640) : 640;

  // Temporarily scale WebGL renderer to FULL HD / 4K resolution
  renderer3D.setSize(exportW, exportH, false);
  renderer3D.setPixelRatio(1);
  camera3D.aspect = exportW / exportH;
  camera3D.updateProjectionMatrix();

  // Create 2D Canvas for High-Quality Frame Capture
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = exportW;
  captureCanvas.height = exportH;
  const captureCtx = captureCanvas.getContext('2d');

  // 3. Fast Deterministic Frame-By-Frame Render Loop with MP4 Muxer
  let isMp4Supported = typeof VideoEncoder !== 'undefined' && typeof Mp4Muxer !== 'undefined';
  let mp4Muxer = null;
  let videoEncoder = null;
  const frameDurationUs = Math.round(1_000_000 / fps);

  if (isMp4Supported && exportFormat !== 'vp9') {
    try {
      mp4Muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: {
          codec: 'avc',
          width: exportW,
          height: exportH
        },
        firstTimestampBehavior: 'offset',
        fastStart: 'in-memory'
      });

      let isFirstChunk = true;
      let lastTimestampUs = 0;

      videoEncoder = new VideoEncoder({
        output: (chunk, meta) => {
          let ts;
          if (isFirstChunk) {
            isFirstChunk = false;
            ts = 0;
            lastTimestampUs = 0;
          } else {
            ts = (typeof chunk.timestamp === 'number' && !isNaN(chunk.timestamp) && chunk.timestamp >= 0)
              ? chunk.timestamp
              : (lastTimestampUs + frameDurationUs);
            if (ts <= lastTimestampUs) {
              ts = lastTimestampUs + frameDurationUs;
            }
            lastTimestampUs = ts;
          }

          const dur = (chunk.duration !== null && chunk.duration !== undefined && !isNaN(chunk.duration) && chunk.duration > 0)
            ? chunk.duration
            : frameDurationUs;

          mp4Muxer.addVideoChunk(chunk, meta, ts, dur);
        },
        error: (e) => console.error('VideoEncoder error:', e)
      });

      // avc1.42001f = H.264 Baseline Profile Level 3.1 (Strictly monotonic timestamps, no B-frame reordering)
      videoEncoder.configure({
        codec: 'avc1.42001f',
        width: exportW,
        height: exportH,
        bitrate: Math.max(12_000_000, exportBitrate * 1_000_000),
        framerate: fps,
        latencyMode: 'realtime',
        avc: { format: 'avc' }
      });
    } catch(e) {
      console.warn('Native VideoEncoder init failed, falling back to WebM:', e);
      isMp4Supported = false;
      mp4Muxer = null;
      videoEncoder = null;
    }
  }

  const vp8Frames = [];

  for (let frame = 0; frame < totalFrames; frame++) {
    if (exportCancelRequested) {
      if (status) status.textContent = 'Render dibatalkan';
      if (btnRender) {
        btnRender.textContent = 'RENDER VIDEO';
        btnRender.style.background = '#D06423';
      }
      isExportRendering = false;

      // Restore preview dimensions
      camera3D.aspect = previewW / previewH;
      camera3D.updateProjectionMatrix();
      renderer3D.setSize(previewW, previewH);
      renderer3D.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      setTimelineOffset(originalOffset);
      return;
    }

    const frameTime = frame / fps;
    const hasAnyMotionBlur = isGlobalMotionBlurEnabled && Array.from(layerMotionBlur.values()).some(v => v === true);

    if (hasAnyMotionBlur) {
      captureCtx.clearRect(0, 0, exportW, exportH);
      if (projectBgColor !== 'transparent') {
        captureCtx.fillStyle = projectBgColor;
        captureCtx.fillRect(0, 0, exportW, exportH);
      }
      const samples = projectMotionBlurSamples || 6;
      const tune = projectMotionBlurTune || 0.5;
      const shutterDt = (tune / fps);

      for (let s = 0; s < samples; s++) {
        const sNorm = (samples > 1) ? (s / (samples - 1)) - 0.5 : 0;
        const subTime = Math.max(0, Math.min(totalDuration, frameTime + sNorm * shutterDt));
        updateThreeSceneForExport(subTime);
        renderer3D.setClearColor(0x000000, 0.0);
        renderer3D.render(scene3D, camera3D);
        captureCtx.globalAlpha = 1.0 / (s + 1);
        captureCtx.drawImage(renderer3D.domElement, 0, 0, exportW, exportH);
      }
      captureCtx.globalAlpha = 1.0;
    } else {
      // Fast scene update without DOM overhead
      updateThreeSceneForExport(frameTime);

      // Render WebGL frame
      renderer3D.render(scene3D, camera3D);

      // Blit to capture canvas
      captureCtx.drawImage(renderer3D.domElement, 0, 0, exportW, exportH);
    }

    if (isMp4Supported && videoEncoder) {
      // Direct WebCodecs GPU encoding for real MP4 with explicit duration
      const videoFrame = new VideoFrame(captureCanvas, {
        timestamp: Math.round((frame / fps) * 1_000_000),
        duration: frameDurationUs
      });
      videoEncoder.encode(videoFrame, { keyFrame: frame % Math.max(1, Math.round(fps * 2)) === 0 });
      videoFrame.close();
    } else {
      // Deterministic WebM fallback
      const dataUrl = captureCanvas.toDataURL('image/webp', 0.95);
      const vp8Chunk = WhammyVideo.parseWebPToVP8(dataUrl);
      if (vp8Chunk) vp8Frames.push(vp8Chunk);
    }

    // Update Progress UI every frame smoothly
    const curPct = Math.round(((frame + 1) / totalFrames) * 100);
    if (fill) fill.style.width = curPct + '%';
    if (pct) pct.textContent = curPct + '%';
    if (status) status.textContent = `Rendering frame ${frame + 1} / ${totalFrames} (${exportW}x${exportH} @ ${fps}fps)`;

    // Yield to browser event loop so UI stays completely fluid & responsive
    await new Promise(r => requestAnimationFrame(r));
  }

  if (status) status.textContent = 'Compiling smooth 60fps MP4 video...';

  if (isMp4Supported && videoEncoder && mp4Muxer) {
    await videoEncoder.flush();
    mp4Muxer.finalize();
    exportVideoBlob = new Blob([mp4Muxer.target.buffer], { type: 'video/mp4' });
    exportVideoUrl = URL.createObjectURL(exportVideoBlob);
  } else if (vp8Frames.length === totalFrames) {
    exportVideoBlob = WhammyVideo.toWebM(vp8Frames, exportW, exportH, fps);
    exportVideoUrl = URL.createObjectURL(exportVideoBlob);
  } else {
    // MediaRecorder Fallback
    const stream = captureCanvas.captureStream(0);
    const videoTrack = stream.getVideoTracks()[0];
    const chunks = [];
    const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm;codecs=vp9';
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 30000000 });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start();
    for (let f = 0; f < totalFrames; f++) {
      updateThreeSceneForExport(f / fps);
      renderer3D.render(scene3D, camera3D);
      captureCtx.drawImage(renderer3D.domElement, 0, 0, exportW, exportH);
      if (videoTrack) videoTrack.requestFrame();
      await new Promise(r => setTimeout(r, 1000 / fps));
    }
    await new Promise(r => {
      recorder.onstop = () => {
        exportVideoBlob = new Blob(chunks, { type: mime });
        exportVideoUrl = URL.createObjectURL(exportVideoBlob);
        r();
      };
      recorder.stop();
    });
  }

  isExportRendering = false;
  if (btnRender) {
    btnRender.textContent = 'RE-RENDER';
    btnRender.style.background = '#D06423';
  }
  const isMp4 = exportVideoBlob && exportVideoBlob.type.includes('mp4');
  if (status) status.textContent = `HD ${isMp4 ? 'MP4' : 'WebM'} Video Siap! (${exportW}x${exportH}, ${durSec}s, ${fps}fps)`;
  if (btnDownload) {
    btnDownload.style.display = 'inline-flex';
  }

  // Restore preview dimensions and aspect ratio
  camera3D.aspect = previewW / previewH;
  camera3D.updateProjectionMatrix();
  renderer3D.setSize(previewW, previewH);
  renderer3D.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  setTimelineOffset(originalOffset);
}

function initExportModalEvents() {
  const btnClose = document.getElementById('btnCloseExportModal');
  if (btnClose) btnClose.addEventListener('click', closeExportModal);

  const modal = document.getElementById('exportModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeExportModal();
    });
  }

  function initModalDropdown(triggerId, menuId, onSelect) {
    const trigger = document.getElementById(triggerId);
    const menu = document.getElementById(menuId);
    const wrap = trigger ? trigger.closest('.am-custom-select') : null;
    if (!trigger || !menu) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('#exportModal .am-custom-select').forEach(w => {
        if (w !== wrap) w.classList.remove('is-open');
      });
      document.querySelectorAll('#exportModal .am-custom-dropdown-menu').forEach(m => {
        if (m !== menu) m.classList.remove('active');
      });
      if (wrap) wrap.classList.toggle('is-open');
      menu.classList.toggle('active');
    });

    menu.querySelectorAll('.am-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.querySelectorAll('.am-dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        const valSpan = trigger.querySelector('.am-trigger-val');
        if (valSpan) valSpan.textContent = item.textContent.trim();
        if (wrap) wrap.classList.remove('is-open');
        menu.classList.remove('active');
        onSelect(item.dataset.value || item.textContent.trim());
      });
    });
  }

  initModalDropdown('triggerExportFormat', 'menuExportFormat', (val) => { exportFormat = val; });
  initModalDropdown('triggerExportRes', 'menuExportRes', (val) => { exportRes = val; });
  initModalDropdown('triggerExportFps', 'menuExportFps', (val) => { exportFps = val; });

  const sliderBitrate = document.getElementById('sliderExportBitrate');
  const lblBitrate = document.getElementById('lblExportBitrateVal');
  if (sliderBitrate && lblBitrate) {
    sliderBitrate.addEventListener('input', () => {
      exportBitrate = Number(sliderBitrate.value) || 16;
      lblBitrate.textContent = exportBitrate + ' Mbps';
    });
  }

  const btnStartRender = document.getElementById('btnStartExportRender');
  if (btnStartRender) {
    btnStartRender.addEventListener('click', () => {
      if (isExportRendering) {
        exportCancelRequested = true;
      } else {
        startLivePreviewRender();
      }
    });
  }

  const btnDownload = document.getElementById('btnDownloadExportVideo');
  if (btnDownload) {
    btnDownload.addEventListener('click', () => {
      if (!exportVideoUrl || !exportVideoBlob) return;
      const titleInput = document.getElementById('activeTitle');
      const projName = (titleInput && titleInput.textContent.trim()) || 'My_Project';
      const cleanName = projName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const isMp4 = exportVideoBlob.type.includes('mp4');
      const ext = isMp4 ? 'mp4' : 'webm';
      const a = document.createElement('a');
      a.href = exportVideoUrl;
      a.download = cleanName + '_HD.' + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
}

function initProjectSettingsModal() {
  const btnSettings = document.getElementById('btnProjectSettings');
  const modal = document.getElementById('projectSettingsModal');
  const btnClose = document.getElementById('btnProjSettingsClose');
  const btnSave = document.getElementById('btnProjSettingsSave');
  const lblDim = document.getElementById('lblEditCompositionSize');

  const resDropdownWrap = document.getElementById('wrapEditSelectResolution');
  const resCustomWrap = document.getElementById('editResCustomWrap');
  const customResW = document.getElementById('editCustomResW');
  const customResH = document.getElementById('editCustomResH');
  const btnLinkAspect = document.getElementById('editBtnLinkAspect');
  const bgSwatchBox = document.getElementById('editBgSwatchBox');

  let selectedResValue = projectResolution || '1080p';
  let selectedFpsValue = String(projectFps) || '30';
  let selectedBgValue = projectBgColor || '#000000';
  let selectedMotionBlurTune = projectMotionBlurTune || 1.0;
  let selectedMotionBlurSamples = projectMotionBlurSamples || 6;

  function closeAllDropdowns() {
    document.querySelectorAll('.am-custom-select').forEach(cs => cs.classList.remove('is-open'));
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.am-custom-select')) {
      closeAllDropdowns();
    }
  });

  function setupCustomDropdown(wrapId, triggerId, valId, menuId, onSelect) {
    const wrap = document.getElementById(wrapId);
    const trigger = document.getElementById(triggerId);
    const valSpan = document.getElementById(valId);
    const menu = document.getElementById(menuId);
    if (!wrap || !trigger || !menu) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrap.classList.contains('is-open');
      closeAllDropdowns();
      if (!isOpen) wrap.classList.add('is-open');
    });

    menu.querySelectorAll('.am-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.querySelectorAll('.am-dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        if (valSpan) {
          const textSpan = item.querySelector('span:not(.am-item-swatch)') || item;
          valSpan.textContent = textSpan.textContent.trim();
        }
        wrap.classList.remove('is-open');
        if (onSelect) onSelect(item.dataset.value, item);
      });
    });
  }

  setupCustomDropdown('wrapEditSelectResolution', 'triggerEditResolution', 'valEditResolution', 'menuEditResolution', (val) => {
    selectedResValue = val;
    updateDimensionLabel();
  });

  setupCustomDropdown('wrapEditSelectFps', 'triggerEditFps', 'valEditFps', 'menuEditFps', (val) => {
    selectedFpsValue = val;
  });

  setupCustomDropdown('wrapEditSelectBackground', 'triggerEditBackground', 'valEditBackground', 'menuEditBackground', (val) => {
    selectedBgValue = val;
    if (bgSwatchBox) {
      bgSwatchBox.style.background = val === 'transparent' ? '#ffffff' : val;
    }
  });

  setupCustomDropdown('wrapEditSelectMotionBlur', 'triggerEditMotionBlur', 'valEditMotionBlur', 'menuEditMotionBlur', (val, item) => {
    selectedMotionBlurTune = parseFloat(item.dataset.tune || val) || 1.0;
    selectedMotionBlurSamples = parseInt(item.dataset.samples) || 10;
  });

  setupCustomDropdown('wrapCodecFormat', 'triggerCodecFormat', 'valCodecFormat', 'menuCodecFormat');
  setupCustomDropdown('wrapCodecRes', 'triggerCodecRes', 'valCodecRes', 'menuCodecRes');
  setupCustomDropdown('wrapCodecFrameRate', 'triggerCodecFrameRate', 'valCodecFrameRate', 'menuCodecFrameRate');

  function updateDimensionLabel() {
    if (!lblDim) return;
    const selectedBox = document.querySelector('#editRatioSelector .am-ratio-box.selected');
    const ratio = selectedBox ? selectedBox.dataset.ratio : projectRatio;
    
    if (ratio === 'custom') {
      const w = parseInt(customResW?.value) || projectCustomWidth || 1080;
      const h = parseInt(customResH?.value) || projectCustomHeight || 1080;
      lblDim.innerHTML = `${w} &times; ${h}`;
      return;
    }

    let baseW = 1080, baseH = 1920;
    if (ratio === '16:9') { baseW = 1920; baseH = 1080; }
    else if (ratio === '9:16') { baseW = 1080; baseH = 1920; }
    else if (ratio === '4:5') { baseW = 1080; baseH = 1350; }
    else if (ratio === '1:1') { baseW = 1080; baseH = 1080; }
    else if (ratio === '4:3') { baseW = 1440; baseH = 1080; }

    if (selectedResValue === '720p') {
      baseW = Math.round(baseW * (720 / 1080));
      baseH = Math.round(baseH * (720 / 1080));
    } else if (selectedResValue === '4K') {
      baseW = Math.round(baseW * 2);
      baseH = Math.round(baseH * 2);
    }
    lblDim.innerHTML = `${baseW} &times; ${baseH}`;
  }

  if (btnSettings && modal) {
    btnSettings.addEventListener('click', () => {
      document.querySelectorAll('#editRatioSelector .am-ratio-box').forEach(box => {
        box.classList.toggle('selected', box.dataset.ratio === projectRatio);
      });

      if (customResW) customResW.value = projectCustomWidth || 1080;
      if (customResH) customResH.value = projectCustomHeight || 1080;

      if (projectRatio === 'custom') {
        if (resDropdownWrap) resDropdownWrap.style.display = 'none';
        if (resCustomWrap) resCustomWrap.style.display = 'flex';
      } else {
        if (resDropdownWrap) resDropdownWrap.style.display = 'flex';
        if (resCustomWrap) resCustomWrap.style.display = 'none';
      }

      selectedResValue = projectResolution || '1080p';
      selectedFpsValue = String(projectFps) || '30';
      selectedBgValue = projectBgColor || '#000000';

      const resItem = document.querySelector(`#menuEditResolution .am-dropdown-item[data-value="${selectedResValue}"]`);
      if (resItem) {
        document.querySelectorAll('#menuEditResolution .am-dropdown-item').forEach(i => i.classList.remove('selected'));
        resItem.classList.add('selected');
        const valSpan = document.getElementById('valEditResolution');
        if (valSpan) valSpan.textContent = resItem.textContent.trim();
      }

      const fpsItem = document.querySelector(`#menuEditFps .am-dropdown-item[data-value="${selectedFpsValue}"]`);
      if (fpsItem) {
        document.querySelectorAll('#menuEditFps .am-dropdown-item').forEach(i => i.classList.remove('selected'));
        fpsItem.classList.add('selected');
        const valSpan = document.getElementById('valEditFps');
        if (valSpan) valSpan.textContent = fpsItem.textContent.trim();
      }

      const bgItem = document.querySelector(`#menuEditBackground .am-dropdown-item[data-value="${selectedBgValue}"]`);
      if (bgItem) {
        document.querySelectorAll('#menuEditBackground .am-dropdown-item').forEach(i => i.classList.remove('selected'));
        bgItem.classList.add('selected');
        const valSpan = document.getElementById('valEditBackground');
        if (valSpan) {
          const textSpan = bgItem.querySelector('span:not(.am-item-swatch)') || bgItem;
          valSpan.textContent = textSpan.textContent.trim();
        }
      }

      if (bgSwatchBox) {
        bgSwatchBox.style.background = selectedBgValue === 'transparent' ? '#ffffff' : selectedBgValue;
      }

      selectedMotionBlurTune = projectMotionBlurTune !== undefined ? projectMotionBlurTune : 1.0;
      selectedMotionBlurSamples = projectMotionBlurSamples || 10;
      let mbItem = document.querySelector(`#menuEditMotionBlur .am-dropdown-item[data-tune="${selectedMotionBlurTune}"]`) || document.querySelector(`#menuEditMotionBlur .am-dropdown-item[data-value="${selectedMotionBlurTune}"]`);
      if (!mbItem) {
        mbItem = document.querySelector('#menuEditMotionBlur .am-dropdown-item[data-value="1.0"]') || document.querySelector('#menuEditMotionBlur .am-dropdown-item');
      }
      if (mbItem) {
        document.querySelectorAll('#menuEditMotionBlur .am-dropdown-item').forEach(i => i.classList.remove('selected'));
        mbItem.classList.add('selected');
        const valSpan = document.getElementById('valEditMotionBlur');
        if (valSpan) valSpan.textContent = mbItem.textContent.trim();
      }

      updateDimensionLabel();
      modal.classList.add('active');
    });
  }

  function closeModal() {
    if (modal) modal.classList.remove('active');
    closeAllDropdowns();
  }

  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.querySelectorAll('#editRatioSelector .am-ratio-box').forEach(box => {
    box.addEventListener('click', () => {
      document.querySelectorAll('#editRatioSelector .am-ratio-box').forEach(b => b.classList.remove('selected'));
      box.classList.add('selected');
      
      const ratio = box.dataset.ratio;
      if (ratio === 'custom') {
        if (resDropdownWrap) resDropdownWrap.style.display = 'none';
        if (resCustomWrap) resCustomWrap.style.display = 'flex';
      } else {
        if (resDropdownWrap) resDropdownWrap.style.display = 'flex';
        if (resCustomWrap) resCustomWrap.style.display = 'none';
      }
      updateDimensionLabel();
    });
  });

  if (btnLinkAspect) {
    btnLinkAspect.addEventListener('click', () => {
      btnLinkAspect.classList.toggle('active');
    });
  }

  if (customResW && customResH) {
    let prevW = parseInt(customResW.value) || 1080;
    let prevH = parseInt(customResH.value) || 1080;

    customResW.addEventListener('input', () => {
      const curW = parseInt(customResW.value) || 1080;
      if (btnLinkAspect && btnLinkAspect.classList.contains('active') && prevW > 0) {
        const aspect = prevH / prevW;
        customResH.value = Math.round(curW * aspect);
      }
      prevW = curW;
      prevH = parseInt(customResH.value) || 1080;
      updateDimensionLabel();
    });

    customResH.addEventListener('input', () => {
      const curH = parseInt(customResH.value) || 1080;
      if (btnLinkAspect && btnLinkAspect.classList.contains('active') && prevH > 0) {
        const aspect = prevW / prevH;
        customResW.value = Math.round(curH * aspect);
      }
      prevH = curH;
      prevW = parseInt(customResW.value) || 1080;
      updateDimensionLabel();
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', () => {
      const titleSpan = document.getElementById('activeTitle');
      const activeName = (titleSpan && titleSpan.textContent.trim()) || sessionStorage.getItem('activeProject') || 'Proyek Baru';

      const selectedRatio = document.querySelector('#editRatioSelector .am-ratio-box.selected')?.dataset.ratio || projectRatio;
      const customW = parseInt(customResW?.value) || 1080;
      const customH = parseInt(customResH?.value) || 1080;

      applyProjectConfig({
        name: activeName,
        ratio: selectedRatio,
        resolution: selectedRatio === 'custom' ? `${customW}x${customH}` : selectedResValue,
        customWidth: customW,
        customHeight: customH,
        fps: selectedFpsValue,
        backgroundColor: selectedBgValue,
        motionBlurTune: selectedMotionBlurTune,
        motionBlurSamples: selectedMotionBlurSamples
      });

      saveCurrentProject();
      closeModal();
    });
  }
}