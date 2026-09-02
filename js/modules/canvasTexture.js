function renderLayerTexture(id, fill, bs, onDone) {
  const strokeEnabledTmp2 = bs && bs.stroke && bs.stroke.enabled;
  const shadowEnabledTmp2 = bs && bs.shadow && bs.shadow.enabled;
  const shadowSizeTmp = shadowEnabledTmp2 ? (bs.shadow.size || 4) : 0;
  const isHeavyShadow = shadowEnabledTmp2 && shadowSizeTmp > 18;
  const isVeryHeavyShadow = shadowEnabledTmp2 && shadowSizeTmp > 45;
  let baseCanvas;
  if (typeof isLowQuality !== 'undefined' && isLowQuality) baseCanvas = 512;
  else if (isVeryHeavyShadow) baseCanvas = 384;
  else if (isHeavyShadow) baseCanvas = 512;
  else baseCanvas = 1024;
  const scaleFactor = baseCanvas / 1024;
  let requiredPad2 = 64 * scaleFactor;
  if (strokeEnabledTmp2) requiredPad2 = Math.max(requiredPad2, (bs.stroke.size || 4) * 4 * scaleFactor + 24 * scaleFactor);
  if (shadowEnabledTmp2) {
    const blur2 = (bs.shadow.size || 4) * 2.5 * scaleFactor;
    const off2 = Math.max(Math.abs(bs.shadow.posX || 3), Math.abs(bs.shadow.posY || 3)) * 1.5 * scaleFactor;
    requiredPad2 = Math.max(requiredPad2, blur2 + off2 + 24 * scaleFactor);
  }
  requiredPad2 = Math.min(512 * scaleFactor, Math.ceil(requiredPad2));
  const rowTmp = document.querySelector(`.track-row[data-layer-id="${id}"]`);
  let catTmp = rowTmp ? (rowTmp.dataset.category || 'media') : 'media';
  let clipName = rowTmp?.querySelector('.track-clip-name')?.textContent || '';
  let shapeType = rowTmp ? (rowTmp.dataset.shapeType || '') : '';

  if (!rowTmp && typeof layerGroupData !== 'undefined') {
    if (layerGroupData.has(id)) {
      catTmp = 'group';
      shapeType = 'group';
      clipName = layerGroupData.get(id).name || 'Group';
    } else {
      for (const [_, gData] of layerGroupData.entries()) {
        if (gData && gData.layers) {
          const found = gData.layers.find(l => l.layerId === id);
          if (found) {
            catTmp = found.category || catTmp;
            shapeType = found.shapeType || shapeType;
            clipName = found.name || clipName;
            break;
          }
        }
      }
    }
  }

  if (!shapeType) {
    const lower = (clipName + '_' + catTmp).toLowerCase();
    if (lower.includes('camera')) shapeType = 'camera';
    else if (lower.includes('null')) shapeType = 'null';
    else if (lower.includes('heart') || lower.includes('love')) shapeType = 'heart';
    else if (lower.includes('star-4') || lower.includes('bintang_4') || lower.includes('bintang 4')) shapeType = 'star-4';
    else if (lower.includes('star') || lower.includes('bintang')) shapeType = 'star';
    else if (lower.includes('hexagon') || lower.includes('segi_enam') || lower.includes('segi enam')) shapeType = 'hexagon';
    else if (lower.includes('circle') || lower.includes('bulat') || lower.includes('lingkaran')) shapeType = 'circle';
    else if (lower.includes('round') || lower.includes('persegi_panjang_bulat') || lower.includes('persegi panjang bulat')) shapeType = 'round';
    else if (lower.includes('kotak') || lower.includes('square') || lower.includes('rectangle') || lower.includes('persegi')) shapeType = 'square';
    else if (lower.includes('triangle') || lower.includes('segitiga')) shapeType = 'triangle';
    else if (catTmp === 'shape') shapeType = 'square';
    else shapeType = 'media';
  }

  const sp = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(id, (shapeType === 'media' || shapeType === 'line' || shapeType === 'arrow') ? 'square' : shapeType) : null;
  let canvasW = baseCanvas;
  let canvasH = baseCanvas;

  if ((shapeType === 'square' || shapeType === 'round' || shapeType === 'media' || !shapeType) && sp && sp.sizeX_px && sp.sizeY_px) {
    const aspect = sp.sizeX_px / sp.sizeY_px;
    if (aspect >= 1) {
      canvasW = baseCanvas;
      canvasH = Math.max(16, Math.round(baseCanvas / aspect));
    } else {
      canvasW = Math.max(16, Math.round(baseCanvas * aspect));
      canvasH = baseCanvas;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasW, canvasH);

  const shapeW = canvasW;
  const shapeH = canvasH;
  const pad = 0;
  const cx = canvasW / 2;
  const cy = canvasH / 2;

  if (shapeType === 'camera' || shapeType === 'null' || shapeType === 'audio' || shapeType === 'sound' || catTmp === 'camera' || catTmp === 'null' || catTmp === 'audio' || catTmp === 'sound' || clipName.toLowerCase().startsWith('camera') || clipName.toLowerCase().startsWith('null') || /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(clipName)) {
    if (onDone) onDone(canvas);
    return;
  }

  if (shapeType === 'group' || catTmp === 'group') {
    const gd = (typeof layerGroupData !== 'undefined') ? layerGroupData.get(id) : null;
    renderGroupCompositeTexture(id, gd, baseCanvas, onDone);
    return;
  }

  const shadowEnabled = bs && bs.shadow && bs.shadow.enabled;
  const strokeEnabled = bs && bs.stroke && bs.stroke.enabled;

  function applyShadowContext() {
    if (shadowEnabled) {
      const p = parseHexOrRgbLocal(bs.shadow.color || '#000000');
      const shadowAlpha = (bs.shadow.alpha !== undefined ? bs.shadow.alpha : 100) / 100;
      ctx.shadowColor = `rgba(${p.r}, ${p.g}, ${p.b}, ${shadowAlpha})`;
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
  if (shapeType === 'text' || catTmp === 'text') {
    const tData = (typeof getLayerText === 'function') ? getLayerText(id) : { content: 'Heading Title', font: 'Poppins', size: 48, align: 'center', bold: true, italic: false, underline: false, uppercase: false, letterSpacing: 0, lineHeight: 1.2 };
    const content = tData.content || 'Heading Title';
    const textToDraw = tData.uppercase ? content.toUpperCase() : content;
    const lines = textToDraw.split('\n');

    let rawSize = tData.size || 48;
    let rawTracking = tData.letterSpacing || 0;
    const kfsText = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(id)) || [];
    const curTimeText = (typeof elapsed !== 'undefined') ? elapsed : 0;
    if (kfsText.length > 0 && typeof evalKeyframeChannelAtTime === 'function') {
      if (kfsText.some(k => k.textSize !== undefined)) {
        rawSize = evalKeyframeChannelAtTime(kfsText, 'textSize', curTimeText);
      }
      if (kfsText.some(k => k.textTracking !== undefined)) {
        rawTracking = evalKeyframeChannelAtTime(kfsText, 'textTracking', curTimeText);
      }
    }

    const fontSize = Math.max(10, rawSize) * 2 * scaleFactor;
    const fontName = tData.font || 'Poppins';
    const isBold = !!tData.bold;
    const isItalic = !!tData.italic;
    const isUnderline = !!tData.underline;
    const align = tData.align || 'center';
    const baseLetterSpacing = rawTracking * scaleFactor;
    const lineHeightRatio = (tData.lineHeight !== undefined ? tData.lineHeight : 1.2);
    const lineSpacingPx = fontSize * lineHeightRatio;

    ctx.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : 'normal '}${fontSize}px "${fontName}", sans-serif`;

    const totalTextH = (lines.length - 1) * lineSpacingPx + fontSize;
    const startY = cy - (totalTextH / 2) + (fontSize / 2);

    applyShadowContext();

    let fillStyle = '#FAB778';
    if (fill.type === 'color' && fill.color) {
      fillStyle = fill.color;
    } else if (fill.type === 'gradient') {
      const g = ctx.createLinearGradient(0, cy - totalTextH / 2, 0, cy + totalTextH / 2);
      if (fill.gradientStops && fill.gradientStops.length) {
        fill.gradientStops.forEach(st => g.addColorStop(st.offset, st.color));
      } else {
        g.addColorStop(0, '#FFFFFF');
        g.addColorStop(1, '#FAB778');
      }
      fillStyle = g;
    }
    ctx.fillStyle = fillStyle;
    const animators = (typeof layerTextAnimators !== 'undefined' && layerTextAnimators.get(id)) || [];
    const hasActiveAnimators = animators.length > 0 && animators.some(a => a.enabled !== false);
    const curTime = (typeof elapsed !== 'undefined') ? elapsed : 0;
    const kfs = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(id)) || [];
    const allChars = textToDraw.split('');
    const totalChars = Math.max(1, allChars.length);
    const allWords = textToDraw.split(/\s+/).filter(Boolean);
    const totalWords = Math.max(1, allWords.length);

    let globalCharIdx = 0;
    let globalWordIdx = 0;

    lines.forEach((lineText, lineIdx) => {
      const lineY = startY + lineIdx * lineSpacingPx;
      const chars = lineText.split('');
      const wordsInLine = lineText.split(/\s+/).filter(Boolean);
      const charWidths = chars.map(c => ctx.measureText(c).width);
      let lineW = charWidths.reduce((a, b) => a + b, 0) + (chars.length - 1) * baseLetterSpacing;

      let startX = cx - (lineW / 2);
      if (align === 'left') startX = 40 * scaleFactor;
      else if (align === 'right') startX = canvasW - 40 * scaleFactor - lineW;

      let currentX = startX;

      chars.forEach((char, charInLineIdx) => {
        const cWidth = charWidths[charInLineIdx];
        const isSpace = /\s/.test(char);
        if (isSpace && charInLineIdx > 0 && !/\s/.test(chars[charInLineIdx - 1])) {
          globalWordIdx++;
        }

        let charNorm = totalChars > 1 ? (globalCharIdx / (totalChars - 1)) : 0;
        let unitIdx = globalCharIdx;
        let totalUnits = totalChars;

        let deltaX = 0;
        let deltaY = 0;
        let scaleMult = 1.0;
        let rotDeg = 0;
        let opacityMult = 1.0;
        let trackingAdd = 0;
        let charOffsetVal = 0;
        let blurVal = 0;

        if (hasActiveAnimators) {
          animators.forEach(anim => {
            if (anim.enabled === false) return;
            const sel = anim.selector || {};
            const basedOn = sel.basedOn || 'characters';

            if (basedOn === 'words') {
              unitIdx = globalWordIdx;
              totalUnits = totalWords;
              charNorm = totalWords > 1 ? (globalWordIdx / (totalWords - 1)) : 0;
            } else if (basedOn === 'lines') {
              unitIdx = lineIdx;
              totalUnits = Math.max(1, lines.length);
              charNorm = lines.length > 1 ? (lineIdx / (lines.length - 1)) : 0;
            }

            const w = evalRangeSelectorWeight(unitIdx, totalUnits, charNorm, sel, curTime, kfs, id);
            const props = anim.properties || {};
            if (props.position) {
              deltaX += (props.position.x || 0) * (1 - w) * scaleFactor;
              deltaY += (props.position.y || 0) * (1 - w) * scaleFactor;
            }
            if (props.scale !== undefined) {
              const targetScale = props.scale / 100;
              scaleMult *= (targetScale + (1 - targetScale) * w);
            }
            if (props.rotation !== undefined) {
              rotDeg += (props.rotation || 0) * (1 - w);
            }
            if (props.opacity !== undefined) {
              const targetOp = props.opacity / 100;
              opacityMult *= (targetOp + (1 - targetOp) * w);
            }
            if (props.tracking !== undefined) {
              trackingAdd += (props.tracking || 0) * (1 - w) * scaleFactor;
            }
            if (props.charOffset !== undefined && props.charOffset > 0 && w < 0.99) {
              charOffsetVal = Math.round(props.charOffset * (1 - w));
            }
          });
        }
        let glyphToDraw = char;
        if (charOffsetVal > 0 && !isSpace) {
          const glyphCharset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
          const code = (char.charCodeAt(0) + charOffsetVal + Math.floor(curTime * 15)) % glyphCharset.length;
          glyphToDraw = glyphCharset[code] || char;
        }

        const charDrawX = currentX + (cWidth / 2) + deltaX;
        const charDrawY = lineY + deltaY;

        ctx.save();
        ctx.translate(charDrawX, charDrawY);
        if (rotDeg !== 0) ctx.rotate((rotDeg * Math.PI) / 180);
        if (scaleMult !== 1.0) ctx.scale(Math.max(0.01, scaleMult), Math.max(0.01, scaleMult));
        ctx.globalAlpha = Math.max(0, Math.min(1, opacityMult));

        if (fill.type === 'gradient') {
          const g = ctx.createLinearGradient(0, -fontSize / 2, 0, fontSize / 2);
          if (fill.gradientStops && fill.gradientStops.length) {
            fill.gradientStops.forEach(st => {
              let col = st.color;
              if (st.alpha !== undefined && st.alpha < 1) {
                const p = typeof parseHexOrRgbLocal === 'function' ? parseHexOrRgbLocal(col) : { r: 250, g: 183, b: 120 };
                col = `rgba(${p.r}, ${p.g}, ${p.b}, ${st.alpha})`;
              }
              g.addColorStop(Math.max(0, Math.min(1, st.offset)), col);
            });
          } else {
            g.addColorStop(0, '#FFFFFF');
            g.addColorStop(1, '#FAB778');
          }
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = fillStyle;
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyphToDraw, 0, 0);

        if (strokeEnabled) {
          applyStrokeContext('center');
          ctx.strokeText(glyphToDraw, 0, 0);
        }

        if (isUnderline && !isSpace) {
          ctx.lineWidth = Math.max(2, fontSize * 0.07);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.beginPath();
          ctx.moveTo(-cWidth / 2, fontSize * 0.45);
          ctx.lineTo(cWidth / 2, fontSize * 0.45);
          ctx.stroke();
        }

        ctx.restore();

        currentX += cWidth + baseLetterSpacing + trackingAdd;
        globalCharIdx++;
      });
    });

    if (onDone) onDone(canvas);
    return;
  }
  const makeShapePath = () => {
    ctx.beginPath();

    switch (shapeType) {
      case 'circle': {
        const p = getLayerShapeParams(id, 'circle');
        const rx = Math.max(1, shapeW / 2);
        const ry = Math.max(1, shapeH / 2);
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        break;
      }
      case 'square': {
        const p = getLayerShapeParams(id, 'square');
        const w = shapeW;
        const h = shapeH;
        const x = cx - w / 2;
        const y = cy - h / 2;
        const maxR = Math.min(w, h) / 2;
        const rawRounded = (p.rounded !== undefined) ? p.rounded : 0;
        const minShapeDim = Math.min(p.sizeX_px || 400, p.sizeY_px || 400);
        const r = Math.max(0, Math.min(maxR, (rawRounded / minShapeDim) * Math.min(w, h)));

        if (r > 0 && typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, w, h, r);
        } else if (r > 0) {
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + r);
          ctx.lineTo(x + w, y + h - r);
          ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          ctx.lineTo(x + r, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
        } else {
          ctx.rect(x, y, w, h);
        }
        break;
      }
      case 'round': {
        const p = getLayerShapeParams(id, 'round');
        const w = shapeW;
        const h = shapeH;
        const x = cx - w / 2;
        const y = cy - h / 2;
        const maxR = Math.min(w, h) / 2;
        const rawRounded = (p.rounded !== undefined) ? p.rounded : 22;
        const minShapeDim = Math.min(p.sizeX_px || 400, p.sizeY_px || 400);
        const r = Math.max(0, Math.min(maxR, (rawRounded / minShapeDim) * Math.min(w, h)));

        if (r > 0 && typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, w, h, r);
        } else if (r > 0) {
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + r);
          ctx.lineTo(x + w, y + h - r);
          ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          ctx.lineTo(x + r, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
        } else {
          ctx.rect(x, y, w, h);
        }
        break;
      }
      case 'triangle':
      case 'polygon': {
        const p = getLayerShapeParams(id, 'triangle');
        const numSides = Math.max(3, Math.round(p.step || p.pointsCount || 3));
        const outerR = Math.min(shapeW, shapeH) / 2;
        const innerPct = (p.innerRadius !== undefined ? p.innerRadius : 100) / 100;
        const innerR = outerR * Math.max(0.05, Math.min(1.0, innerPct));
        const isStarMode = innerPct < 0.98;
        const curve = Math.max(0, Math.min(1, (p.curve || 0) / 100));

        const totalPoints = isStarMode ? (numSides * 2) : numSides;
        const angleStep = (2 * Math.PI) / totalPoints;
        const startAngle = -Math.PI / 2;

        const pts = [];
        for (let i = 0; i < totalPoints; i++) {
          const angle = startAngle + i * angleStep;
          const r = (isStarMode && (i % 2 === 1)) ? innerR : outerR;
          const px = cx + Math.cos(angle) * r;
          const py = cy + Math.sin(angle) * r;
          pts.push({ x: px, y: py });
        }

        if (pts.length >= 3) {
          if (curve > 0) {
            const cornerR = Math.min(outerR, innerR) * 0.45 * curve;
            const p0 = pts[0];
            const p1 = pts[1];
            ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
            for (let i = 1; i <= pts.length; i++) {
              const pCurr = pts[i % pts.length];
              const pNext = pts[(i + 1) % pts.length];
              ctx.arcTo(pCurr.x, pCurr.y, pNext.x, pNext.y, cornerR);
            }
            ctx.closePath();
          } else {
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
              ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.closePath();
          }
        }
        break;
      }
      case 'heart':
      case 'love': {
        const p = getLayerShapeParams(id, 'heart');
        const w = shapeW * 0.9;
        const h = shapeH * 0.9;
        
        const topY = cy - h * 0.45;
        const botY = cy + h * 0.45;
        const midY = cy - h * 0.15;
        
        ctx.moveTo(cx, botY);
        ctx.bezierCurveTo(cx - w * 0.55, cy + h * 0.15, cx - w * 0.55, topY, cx - w * 0.26, topY);
        ctx.bezierCurveTo(cx - w * 0.08, topY, cx, cy - h * 0.35, cx, midY);
        ctx.bezierCurveTo(cx, cy - h * 0.35, cx + w * 0.08, topY, cx + w * 0.26, topY);
        ctx.bezierCurveTo(cx + w * 0.55, topY, cx + w * 0.55, cy + h * 0.15, cx, botY);
        ctx.closePath();
        break;
      }
      case 'star': {
        const p = getLayerShapeParams(id, 'star');
        const outerR = Math.min(shapeW, shapeH) / 2;
        const innerPct = (p.innerRadius !== undefined ? p.innerRadius : 40) / 100;
        const innerR = outerR * Math.max(0.05, Math.min(1.0, innerPct));
        const numPoints = Math.max(3, Math.round(p.step || p.pointsCount || 5));
        const totalPoints = numPoints * 2;
        const angleStep = (2 * Math.PI) / totalPoints;
        const startAngle = -Math.PI / 2;
        const curve = Math.max(0, Math.min(1, (p.curve || 0) / 100));

        const pts = [];
        for (let i = 0; i < totalPoints; i++) {
          const angle = startAngle + i * angleStep;
          const r = (i % 2 === 1) ? innerR : outerR;
          const px = cx + Math.cos(angle) * r;
          const py = cy + Math.sin(angle) * r;
          pts.push({ x: px, y: py });
        }

        if (pts.length >= 3) {
          if (curve > 0) {
            const cornerR = Math.min(outerR, innerR) * 0.45 * curve;
            const p0 = pts[0];
            const p1 = pts[1];
            ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
            for (let i = 1; i <= pts.length; i++) {
              const pCurr = pts[i % pts.length];
              const pNext = pts[(i + 1) % pts.length];
              ctx.arcTo(pCurr.x, pCurr.y, pNext.x, pNext.y, cornerR);
            }
            ctx.closePath();
          } else {
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
              ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.closePath();
          }
        }
        break;
      }
      case 'star-4': {
        const p = getLayerShapeParams(id, 'star-4');
        const outerR = Math.min(shapeW, shapeH) / 2;
        const innerR = outerR * ((p.innerRadius || 30) / 100);
        const numPoints = 4;
        let rot = -Math.PI / 2;
        const step = Math.PI / numPoints;
        ctx.moveTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
        for (let i = 0; i < numPoints; i++) {
          let x = cx + Math.cos(rot) * outerR;
          let y = cy + Math.sin(rot) * outerR;
          ctx.lineTo(x, y);
          rot += step;
          x = cx + Math.cos(rot) * innerR;
          y = cy + Math.sin(rot) * innerR;
          ctx.lineTo(x, y);
          rot += step;
        }
        ctx.closePath();
        break;
      }
      case 'hexagon': {
        const p = getLayerShapeParams(id, 'hexagon');
        const r = Math.min(shapeW, shapeH) / 2;
        const sides = Math.max(3, Math.round(p.sides || 6));
        for (let i = 0; i < sides; i++) {
          const angle = (i * 2 * Math.PI / sides) - (Math.PI / 2);
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        break;
      }
      case 'svg_path':
      case 'svg': {
        const p = getLayerShapeParams(id, 'svg_path');
        if (p.points && p.points.length >= 2) {
          const canvasPts = p.points.map(pt => ({
            x: cx + ((Number(pt.x) || 0) / 100) * (shapeW / 2),
            y: cy - ((Number(pt.y) || 0) / 100) * (shapeH / 2)
          }));
          ctx.moveTo(canvasPts[0].x, canvasPts[0].y);
          for (let i = 1; i < canvasPts.length; i++) {
            ctx.lineTo(canvasPts[i].x, canvasPts[i].y);
          }
          if (p.isClosed !== false) ctx.closePath();
        } else {
          ctx.rect(pad, pad, shapeW, shapeH);
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
  if (fill.type === 'media' && fill.mediaUrl) {
    if (fill.mediaUrl.startsWith('video_pkg_') || fill.mediaUrl.startsWith('pkg_') || videoFrameSequenceMap.has(fill.mediaUrl)) {
      if (onDone) onDone(canvas);
      return;
    }

    let imgSrc = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(fill.mediaUrl) : fill.mediaUrl;

    if (!imgSrc || imgSrc.startsWith('content://') || imgSrc.startsWith('file://')) {
      canvas.width = Math.min(2048, Math.max(512, Math.round(shapeW)));
      canvas.height = Math.min(2048, Math.max(512, Math.round(shapeH)));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      applyShadowContext();
      ctx.fillStyle = '#FAB778';
      makeShapePath();
      ctx.fill();
      if (strokeEnabled) {
        applyStrokeContext('center');
        makeShapePath();
        ctx.stroke();
      }
      if (onDone) onDone(canvas);
      return;
    }

    const p = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(id, 'svg_path') : null;
    if (p && (p.svgContent || (imgSrc && imgSrc.includes('image/svg+xml')) || (p.svgUrl && p.svgUrl.includes('image/svg+xml')))) {
      let rawSvg = p.svgContent;
      if (!rawSvg && imgSrc && imgSrc.includes('data:image/svg+xml')) {
        try {
          rawSvg = decodeURIComponent(imgSrc.split(',')[1] || '');
        } catch(_) {}
      }
      if (rawSvg) {
        if (!p.svgContent) p.svgContent = rawSvg;
        if ((p.hiddenElements && Object.keys(p.hiddenElements).length > 0) || (p.elementOverrides && Object.keys(p.elementOverrides).length > 0) || p.colorMode === 'tint') {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
            const elements = Array.from(doc.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line'));
            elements.forEach((el, idx) => {
              if (p.hiddenElements && p.hiddenElements[idx]) {
                el.setAttribute('display', 'none');
                el.setAttribute('visibility', 'hidden');
              } else {
                if (p.colorMode === 'tint' && p.tintColor) {
                  if (el.getAttribute('fill') && el.getAttribute('fill') !== 'none') {
                    el.setAttribute('fill', p.tintColor);
                  }
                } else if (p.elementOverrides && p.elementOverrides[idx]) {
                  const ov = p.elementOverrides[idx];
                  if (ov.fill) el.setAttribute('fill', ov.fill);
                  if (ov.stroke) el.setAttribute('stroke', ov.stroke);
                }
              }
            });
            const serializer = new XMLSerializer();
            const modifiedSvg = serializer.serializeToString(doc);
            imgSrc = 'data:image/svg+xml;utf8,' + encodeURIComponent(modifiedSvg);
          } catch(e) {
            console.warn('SVG element override error', e);
          }
        }
      }
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const natW = img.naturalWidth || 1024;
      const natH = img.naturalHeight || 1024;
      const natAspect = (natW && natH) ? (natW / natH) : 1.0;
      const prevAspect = mediaNaturalRatioMap.get(id);
      mediaNaturalRatioMap.set(id, natAspect);
      if (fill.mediaUrl) mediaNaturalRatioMap.set(fill.mediaUrl, natAspect);
      if (fill.mediaId) mediaNaturalRatioMap.set(fill.mediaId, natAspect);
      const sp = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(id, 'square') : null;

      const mediaFit = fill.mediaFit || 'fit';
      const maxDim = Math.max(natW, natH);
      const targetSize = Math.min(2048, Math.max(1024, maxDim));
      let targetW = targetSize;
      let targetH = targetSize;

      if (sp && sp.sizeX_px && sp.sizeY_px) {
        const aspect = sp.sizeX_px / sp.sizeY_px;
        if (aspect >= 1) {
          targetW = targetSize;
          targetH = Math.round(targetSize / aspect);
        } else {
          targetW = Math.round(targetSize * aspect);
          targetH = targetSize;
        }
      } else if (sp && sp.sizeX && sp.sizeY) {
        const aspect = sp.sizeX / sp.sizeY;
        if (aspect >= 1) {
          targetW = targetSize;
          targetH = Math.round(targetSize / aspect);
        } else {
          targetW = Math.round(targetSize * aspect);
          targetH = targetSize;
        }
      } else {
        if (natAspect >= 1) {
          targetW = targetSize;
          targetH = Math.round(targetSize / natAspect);
        } else {
          targetW = Math.round(targetSize * natAspect);
          targetH = targetSize;
        }
      }

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, targetW, targetH);

      applyShadowContext();
      ctx.save();
      ctx.beginPath();

      const rawRounded = (sp && sp.rounded !== undefined) ? sp.rounded : (shapeType === 'round' ? 22 : 0);
      const maxR = Math.min(targetW, targetH) / 2;
      const r = (sp && sp.sizeX_px && sp.sizeY_px)
        ? Math.min(maxR, (rawRounded / Math.min(sp.sizeX_px, sp.sizeY_px)) * Math.min(targetW, targetH))
        : Math.min(maxR, (rawRounded / 100) * maxR);

      if (shapeType === 'circle') {
        ctx.ellipse(targetW / 2, targetH / 2, targetW / 2, targetH / 2, 0, 0, Math.PI * 2);
        ctx.clip();
      } else if (r > 0) {
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(0, 0, targetW, targetH, r);
        } else {
          ctx.moveTo(r, 0);
          ctx.lineTo(targetW - r, 0);
          ctx.quadraticCurveTo(targetW, 0, targetW, r);
          ctx.lineTo(targetW, targetH - r);
          ctx.quadraticCurveTo(targetW, targetH, targetW - r, targetH);
          ctx.lineTo(r, targetH);
          ctx.quadraticCurveTo(0, targetH, 0, targetH - r);
          ctx.lineTo(0, r);
          ctx.quadraticCurveTo(0, 0, r, 0);
          ctx.closePath();
        }
        ctx.clip();
      }

      if (mediaFit === 'fill' || mediaFit === 'crop') {
        const scale = Math.max(targetW / natW, targetH / natH);
        const w = natW * scale;
        const h = natH * scale;
        const x = (targetW - w) / 2;
        const y = (targetH - h) / 2;
        ctx.drawImage(img, x, y, w, h);
      } else if (mediaFit === 'fit') {
        const scale = Math.min(targetW / natW, targetH / natH);
        const w = natW * scale;
        const h = natH * scale;
        const x = (targetW - w) / 2;
        const y = (targetH - h) / 2;
        ctx.drawImage(img, x, y, w, h);
      } else {
        ctx.drawImage(img, 0, 0, targetW, targetH);
      }
      ctx.restore();

      if (strokeEnabled) {
        applyStrokeContext('center');
        if (r > 0 && typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(0, 0, targetW, targetH, r);
          ctx.stroke();
        } else {
          ctx.strokeRect(0, 0, targetW, targetH);
        }
      }
      if (onDone) onDone(canvas);
      applyTransformToThreeMesh(id, getLayerTransform(id));
      if (typeof requestDebouncedRender3D === 'function') requestDebouncedRender3D();
      else if (typeof render3D === 'function') render3D();
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
    img.src = imgSrc;
    return;
  }
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
    const curShapeP = getLayerShapeParams(id, shapeType);
    const isOutlineOnly = curShapeP && curShapeP.renderMode === 'outline';
    if (isOutlineOnly) {
      ctx.strokeStyle = fillStyle;
      ctx.lineWidth = Math.max(2, (curShapeP.thickness || 14) * scaleFactor);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      makeShapePath();
      ctx.stroke();
    } else {
      makeShapePath();
      ctx.fill();
    }
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
const layerActiveTextureMap = new Map();


function getBlurredTextureForLayer(id, blurPx) {
  let baseCanvas = layerBaseCanvasMap.get(id);
  const effects = (typeof getLayerEffects === 'function') ? getLayerEffects(id) : [];
  const curTime = (typeof elapsed !== 'undefined') ? elapsed : 0;
  const hasCopyBg = effects.some(eff => eff && eff.enabled !== false && (eff.type === 'copy_background' || eff.type === 'copybackground'));
  if (hasCopyBg) {
    const mesh = (typeof meshLayerMap !== 'undefined') ? meshLayerMap.get(id) : null;
    const captured = (typeof captureBackgroundBehindMesh === 'function') ? captureBackgroundBehindMesh(mesh, id) : null;
    baseCanvas = captured || getCompositeBackgroundCanvasBelowLayer(id, curTime);
  }

  if (!baseCanvas) return null;
  const kfs = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(id)) || [];

  function getAnimParam(eff, paramKey, defaultVal) {
    let val = (eff.params && eff.params[paramKey] !== undefined) ? eff.params[paramKey] : defaultVal;
    if (kfs.length > 0 && typeof evalKeyframeChannelAtTime === 'function') {
      const c1 = 'fx_' + (eff.id || '') + '_' + paramKey;
      const c2 = 'fx_' + (eff.type || '') + '_' + paramKey;
      const c3 = 'fx_' + paramKey;
      
      let targetChannel = null;
      for (let i = 0; i < kfs.length; i++) {
        const k = kfs[i];
        if (k[c1] !== undefined) { targetChannel = c1; break; }
        if (k[c2] !== undefined) { targetChannel = c2; break; }
        if (k[c3] !== undefined) { targetChannel = c3; break; }
      }

      if (targetChannel) {
        val = evalKeyframeChannelAtTime(kfs, targetChannel, curTime);
      }
    }
    return val;
  }

  const animatedEffects = effects.map(eff => {
    if (!eff || eff.enabled === false) return eff;
    const cloned = { ...eff, params: { ...(eff.params || {}) } };
    if (eff.params && kfs.length > 0 && typeof evalKeyframeChannelAtTime === 'function') {
      Object.keys(eff.params).forEach(pk => {
        cloned.params[pk] = getAnimParam(eff, pk, eff.params[pk]);
      });
    }
    return cloned;
  });
  if (typeof FishEffects !== 'undefined' && typeof FishEffects.applyCustomEffectProcessors === 'function') {
    baseCanvas = FishEffects.applyCustomEffectProcessors(baseCanvas, animatedEffects, id);
  }

  const qBlur = Math.min(64, Math.max(0, Math.round(blurPx || 0)));
  const effKey = animatedEffects.map(e => e.id + '_' + e.enabled + '_' + JSON.stringify(e.params)).join(';');
  const key = id + '_' + qBlur + '_' + effKey + '_' + (kfs.length > 0 ? Math.round(curTime * 100) : 0);
  
  if (!hasCopyBg) {
    let cached = layerBlurTextureCache.get(key);
    if (cached) return cached;
  }

  if (layerBlurTextureCache.size > 80) {
    const firstKey = layerBlurTextureCache.keys().next().value;
    const oldT = layerBlurTextureCache.get(firstKey);
    if (oldT) try { oldT.dispose(); } catch(_) {}
    layerBlurTextureCache.delete(firstKey);
  }

  if (qBlur > 0) {
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = baseCanvas.width;
    blurCanvas.height = baseCanvas.height;
    const bCtx = blurCanvas.getContext('2d');
    bCtx.imageSmoothingEnabled = true;
    bCtx.imageSmoothingQuality = 'medium';
    bCtx.filter = `blur(${qBlur}px)`;
    bCtx.drawImage(baseCanvas, 0, 0);
    baseCanvas = blurCanvas;
  }

  let tex = hasCopyBg ? layerActiveTextureMap.get(id) : null;
  if (!tex) {
    tex = new THREE.CanvasTexture(baseCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (hasCopyBg) layerActiveTextureMap.set(id, tex);
  } else {
    if (tex.image !== baseCanvas) {
      tex.image = baseCanvas;
    }
    tex.needsUpdate = true;
  }
  if (!hasCopyBg) layerBlurTextureCache.set(key, tex);
  return tex;
}
let pendingEffectRaf = null;
let pendingEffectLayerId = null;

function updateLayerEffectsFast(id) {
  pendingEffectLayerId = id;
  if (pendingEffectRaf) return;
  pendingEffectRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(() => {
    pendingEffectRaf = null;
    const targetId = pendingEffectLayerId;
    const mesh = meshLayerMap.get(targetId);
    if (!mesh || !mesh.material) return;

    if (!layerBaseCanvasMap.has(targetId)) {
      applyFillToMeshGlobal(targetId);
      return;
    }
    for (const k of Array.from(layerBlurTextureCache.keys())) {
      if (k.startsWith(targetId + '_')) {
        const oldTex = layerBlurTextureCache.get(k);
        if (oldTex) try { oldTex.dispose(); } catch(_) {}
        layerBlurTextureCache.delete(k);
      }
    }

    const tex = getBlurredTextureForLayer(targetId, 0);
    if (tex) {
      if (mesh.material.type === 'ShaderMaterial' && mesh.material.uniforms && mesh.material.uniforms.map) {
        mesh.material.uniforms.map.value = tex;
      } else {
        mesh.material.map = tex;
        if (mesh.material.color) mesh.material.color = new THREE.Color('#FFFFFF');
        mesh.material.transparent = true;
        mesh.material.needsUpdate = true;
      }
    }
    if (typeof render3D === 'function') render3D();
  }) : null;
}
window.updateLayerEffectsFast = updateLayerEffectsFast;
const videoFrameSequenceMap = new Map();
const layerFrameTextureMap = new Map();
const layerLastRenderedFrameIndex = new Map();
const sharedFrameSequenceTextureMap = new Map();
const sharedFrameSequenceLastIndexMap = new Map();

function applyFillToMeshGlobal(id, force = false) {
  const mesh = meshLayerMap.get(id);
  if (!mesh || !mesh.material) return;
  const isPlaying = (typeof playing !== 'undefined' && playing);
  if (!mesh.visible && isPlaying && !force) return;

  const fill = getLayerFill(id);
  if (!fill) return;
  const bs = (typeof getLayerBorderShadow === 'function') ? getLayerBorderShadow(id) : null;
  const t = getLayerTransform(id);
  const transformOpacity = (t && t.opacity !== undefined) ? (t.opacity / 100) : 1;

  const metric = (typeof layerMetricsCache !== 'undefined') ? layerMetricsCache.get(id) : null;
  const clipName = metric ? metric.clipName : '';
  const isPkg = fill.mediaUrl && (fill.mediaUrl.startsWith('video_pkg_') || fill.mediaUrl.startsWith('pkg_'));
  const seq = videoFrameSequenceMap.get(fill.mediaUrl) || videoFrameSequenceMap.get(id) || (clipName && videoFrameSequenceMap.get(clipName));
  if (seq || isPkg) {
    if (!seq || !seq.isReady || !seq.frames || seq.frames.length === 0) {
      mesh.material.opacity = transformOpacity;
      return;
    }
    const startTime = metric ? metric.startSec : 0;
    const clipOffset = metric ? metric.mediaOffset : (fill && fill.mediaOffset ? fill.mediaOffset : 0);
    const localTime = Math.max(0, clipOffset + (elapsed - startTime));
    const fps = Number(seq.fps) || (typeof projectFps !== 'undefined' ? Number(projectFps) : 30) || 30;
    const frameIndex = Math.min(seq.frames.length - 1, Math.max(0, Math.floor(localTime * fps)));

    const sharedKey = id;
    const lastIndex = sharedFrameSequenceLastIndexMap.get(sharedKey);
    let fTex = sharedFrameSequenceTextureMap.get(sharedKey);

    if (fTex && lastIndex === frameIndex) {
      mesh.material.opacity = transformOpacity;
      return;
    }

    let currentFrame = seq.frames[frameIndex] || seq.frames[0];
    if (!currentFrame) {
      mesh.material.opacity = transformOpacity;
      return;
    }

    const needFlipY = false;

    if (!fTex) {
      fTex = new THREE.Texture(currentFrame);
      fTex.colorSpace = THREE.SRGBColorSpace;
      fTex.minFilter = THREE.LinearFilter;
      fTex.magFilter = THREE.LinearFilter;
      fTex.generateMipmaps = false;
      fTex.flipY = needFlipY;
      fTex.needsUpdate = true;
      sharedFrameSequenceTextureMap.set(sharedKey, fTex);
      sharedFrameSequenceLastIndexMap.set(sharedKey, frameIndex);
    } else {
      fTex.image = currentFrame;
      fTex.generateMipmaps = false;
      fTex.flipY = needFlipY;
      fTex.needsUpdate = true;
      sharedFrameSequenceLastIndexMap.set(sharedKey, frameIndex);
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

    renderLayerTexture(id, fill, bs, (canvas) => {
      layerBaseCanvasMap.set(id, canvas);
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
      const effects = (typeof getLayerEffects === 'function') ? getLayerEffects(id) : [];
      const hasCopyBg = effects.some(e => e && e.enabled !== false && (e.type === 'copy_background' || e.type === 'copybackground'));

      const fillAlpha = (() => {
        if (fill && fill.type === 'color') {
          const p = typeof parseHexOrRgbLocal === 'function' ? parseHexOrRgbLocal(fill.color || '#FAB778') : {a:1};
          return (fill.alpha !== undefined) ? fill.alpha : (p.a !== undefined ? p.a : 1);
        }
        return 1;
      })();
      const targetOpacity = Math.max(0, Math.min(1, transformOpacity * fillAlpha));

      if (hasCopyBg) {
        if (mesh.material.type !== 'ShaderMaterial' && typeof createAdjustmentLayerMaterial === 'function') {
          mesh.material = createAdjustmentLayerMaterial(tex, targetOpacity);
        } else if (mesh.material.uniforms && mesh.material.uniforms.map) {
          mesh.material.uniforms.map.value = tex;
          mesh.material.uniforms.opacity.value = targetOpacity;
        }
      } else {
        if (mesh.material.type === 'ShaderMaterial' && typeof createMotionBlurMaterial === 'function') {
          mesh.material = createMotionBlurMaterial();
        }
        mesh.material.map = tex;
        mesh.material.color = new THREE.Color('#FFFFFF');
        mesh.material.transparent = true;
        mesh.material.depthTest = true;
        mesh.material.depthWrite = true;
        mesh.material.alphaTest = 0.02;
        mesh.material.side = THREE.DoubleSide;
        mesh.material.opacity = targetOpacity;
        mesh.material.needsUpdate = true;
      }
      if (typeof requestDebouncedRender3D === 'function') requestDebouncedRender3D();
      else if (typeof render3D === 'function') render3D();
    });
  });
  pendingTextureRenders.set(id, handle);
}

function getTextLayerDimensions(id) {
  const tData = (typeof getLayerText === 'function') ? getLayerText(id) : { content: 'Heading Title', font: 'Poppins', size: 48, align: 'center', bold: true, italic: false, underline: false, uppercase: false, letterSpacing: 0, lineHeight: 1.2 };
  const content = tData.content || 'Heading Title';
  const textToDraw = tData.uppercase ? content.toUpperCase() : content;
  const lines = textToDraw.split('\n');

  const canvas = (typeof document !== 'undefined' && document.createElement) ? document.createElement('canvas') : null;
  const ctx = canvas ? canvas.getContext('2d') : null;
  const fontSize = Math.max(10, (tData.size || 48)) * 2;
  const fontName = tData.font || 'Poppins';
  const isBold = !!tData.bold;
  const isItalic = !!tData.italic;
  const letterSpacing = (tData.letterSpacing || 0);
  const lineHeightRatio = (tData.lineHeight !== undefined ? tData.lineHeight : 1.2);
  const lineSpacingPx = fontSize * lineHeightRatio;

  let maxW = 100;
  if (ctx) {
    ctx.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : 'normal '}${fontSize}px "${fontName}", sans-serif`;
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = `${letterSpacing}px`;
    }
    lines.forEach(l => {
      const w = ctx.measureText(l).width + (l.length * letterSpacing);
      if (w > maxW) maxW = w;
    });
  } else {
    maxW = content.length * fontSize * 0.6;
  }

  const totalH = (lines.length - 1) * lineSpacingPx + fontSize;
  const paddedW = Math.max(40, maxW + 28);
  const paddedH = Math.max(20, totalH + 16);

  const unitsW = (paddedW / 1024) * 4.0;
  const unitsH = (paddedH / 1024) * 4.0;

  return {
    widthUnits: unitsW,
    heightUnits: unitsH,
    pixelWidth: paddedW,
    pixelHeight: paddedH
  };
}

function evalRangeSelectorWeight(unitIdx, totalUnits, normPos, selector, curTime = 0, kfs = [], layerId = '') {
  if (!selector) return 1;

  let startPct = selector.start !== undefined ? selector.start : 0;
  let endPct = selector.end !== undefined ? selector.end : 100;
  let offsetPct = selector.offset !== undefined ? selector.offset : 0;

  if (kfs && kfs.length > 0 && typeof evalKeyframeChannelAtTime === 'function') {
    if (kfs.some(k => k.textAnimStart !== undefined)) {
      startPct = evalKeyframeChannelAtTime(kfs, 'textAnimStart', curTime);
    }
    if (kfs.some(k => k.textAnimEnd !== undefined)) {
      endPct = evalKeyframeChannelAtTime(kfs, 'textAnimEnd', curTime);
    }
    if (kfs.some(k => k.textAnimOffset !== undefined)) {
      offsetPct = evalKeyframeChannelAtTime(kfs, 'textAnimOffset', curTime);
    }
  }

  let s = (startPct + offsetPct) / 100;
  let e = (endPct + offsetPct) / 100;

  if (s > e) {
    const tmp = s;
    s = e;
    e = tmp;
  }

  let u = normPos;
  if (selector.randomizeOrder) {
    const seed = (selector.seed || 1234) + (layerId && layerId.charCodeAt ? layerId.charCodeAt(0) : 0);
    const pseudoRand = Math.abs(Math.sin((unitIdx + 1) * 9301 + seed * 49297) * 233280) % 1;
    u = pseudoRand;
  }

  const shape = (selector.shape || 'square').toLowerCase();
  const easeHigh = (selector.easeHigh !== undefined ? selector.easeHigh : 0) / 100;
  const easeLow = (selector.easeLow !== undefined ? selector.easeLow : 0) / 100;

  let rawWeight = 0;
  const span = e - s;

  if (span <= 1e-5) {
    rawWeight = (u >= s) ? 1 : 0;
  } else if (u < s) {
    rawWeight = (shape === 'ramp_down' || shape === 'rampdown') ? 1 : 0;
  } else if (u > e) {
    rawWeight = (shape === 'ramp_up' || shape === 'rampup' || shape === 'square') ? 1 : 0;
  } else {
    const prog = (u - s) / span;

    switch (shape) {
      case 'square':
        rawWeight = 1;
        break;
      case 'ramp_up':
      case 'rampup':
        rawWeight = prog;
        break;
      case 'ramp_down':
      case 'rampdown':
        rawWeight = 1 - prog;
        break;
      case 'triangle':
        rawWeight = prog <= 0.5 ? (prog * 2) : (2 - prog * 2);
        break;
      case 'round':
        rawWeight = Math.sin(prog * Math.PI);
        break;
      case 'smooth':
        rawWeight = 0.5 - 0.5 * Math.cos(prog * Math.PI);
        break;
      default:
        rawWeight = 1;
        break;
    }
  }

  if (easeHigh !== 0 || easeLow !== 0) {
    if (rawWeight > 0 && rawWeight < 1) {
      if (easeHigh > 0) rawWeight = Math.pow(rawWeight, 1 + easeHigh * 2);
      else if (easeHigh < 0) rawWeight = Math.pow(rawWeight, 1 / (1 - easeHigh * 2));
    }
  }

  const amount = (selector.amount !== undefined ? selector.amount : 100) / 100;
  return Math.max(0, Math.min(1, rawWeight * amount));
}

