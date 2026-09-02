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
  const drawer = document.getElementById('layerInspectorDrawer');
  const panelMove = document.getElementById('panelMoveTransform');
  if (drawer) {
    if (drawer.classList.contains('subpanel-move') || drawer.classList.contains('subpanel-graph')) {
      return true;
    }
    const otherSubpanels = ['subpanel-effects', 'subpanel-add-effect', 'subpanel-border-shadow', 'subpanel-text', 'subpanel-color', 'subpanel-camera', 'subpanel-edit-shape', 'subpanel-shape'];
    if (otherSubpanels.some(cls => drawer.classList.contains(cls))) {
      return false;
    }
  }
  return !!(panelMove && panelMove.style.display !== 'none' && panelMove.offsetParent !== null);
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

function hasKeyframeForChannel(id, time, channel, tolerance = 0.035) {
  if (!channel) return false;
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

function getKeyframeAt(id, time, tolerance = 0.035) {
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
  if (typeof updateBorderShadowKeyframeUI === 'function') {
    try { updateBorderShadowKeyframeUI(); } catch(e) {}
  }
  if (typeof updateTextKeyframeUI === 'function') {
    try { updateTextKeyframeUI(); } catch(e) {}
  }
  if (typeof updateEffectKeyframeUI === 'function') {
    try { updateEffectKeyframeUI(); } catch(e) {}
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
  let activeChannel = null;
  const drawer = document.getElementById('layerInspectorDrawer');
  const isBorderPanel = isRowSelected && ((drawer && drawer.classList.contains('subpanel-border-shadow')) || (document.getElementById('panelBorderShadow') && document.getElementById('panelBorderShadow').style.display !== 'none' && document.getElementById('panelBorderShadow').offsetParent !== null));
  const isTextPanel = isRowSelected && ((drawer && drawer.classList.contains('subpanel-text')) || (document.getElementById('panelEditText') && document.getElementById('panelEditText').style.display !== 'none' && document.getElementById('panelEditText').offsetParent !== null));
  const isEffectsPanel = isRowSelected && ((drawer && drawer.classList.contains('subpanel-effects')) || (document.getElementById('panelEffects') && document.getElementById('panelEffects').style.display !== 'none' && document.getElementById('panelEffects').offsetParent !== null));
  const isMovePanel = isRowSelected && isTransformPanelOpen();

  if (isRowSelected) {
    if (isBorderPanel) {
      activeChannel = (typeof getActiveBorderShadowChannel === 'function') ? getActiveBorderShadowChannel() : null;
    } else if (isTextPanel) {
      activeChannel = (typeof getActiveTextChannel === 'function') ? getActiveTextChannel() : null;
    } else if (isEffectsPanel) {
      activeChannel = (typeof getActiveEffectChannel === 'function') ? getActiveEffectChannel() : null;
    } else if (isMovePanel) {
      activeChannel = (typeof getActiveKeyframeChannel === 'function') ? getActiveKeyframeChannel() : null;
    }
  }

  const frag = document.createDocumentFragment();
  let lastRenderedPx = -9999;
  const minSpacingPx = isRowSelected ? 2.5 : 4.0;

  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i];
    const kfPx = (kf.time * PX_PER_SEC) - clipMargin;
    if (kfPx < -8 || kfPx > clipWidth + 8) continue;
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

    const canInteract = isRowSelected && isMatchingChannel;
    const isActive = canInteract && Math.abs(kf.time - elapsed) <= 0.035;
    if (!isActive && !canInteract && (kfPx - lastRenderedPx) < minSpacingPx) {
      continue;
    }
    lastRenderedPx = kfPx;

    const marker = document.createElement('div');
    marker.className = 'clip-keyframe-marker' + 
      (isActive ? ' is-active' : '') + 
      (isMatchingChannel ? ' is-channel-keyframe can-drag' : ' is-other-channel is-locked');
    
    marker.style.left = `${kfPx}px`;
    marker.title = `Keyframe: ${kf.time.toFixed(2)}s${isMatchingChannel ? ` (${activeChannel})` : ''}`;
    marker.innerHTML = `
      <svg viewBox="0 0 16 32" preserveAspectRatio="none" class="keyframe-diamond-svg">
        <path d="M8 1 L15 16 L8 31 L1 16 Z" class="diamond-shape"/>
      </svg>
    `;

    if (!canInteract) {
      marker.style.pointerEvents = 'none';
      frag.appendChild(marker);
      continue;
    }
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
            setTimelineOffset(kf.time * PX_PER_SEC, false);
            if (typeof applyFillToMeshGlobal === 'function') applyFillToMeshGlobal(id);
            if (typeof render3D === 'function') render3D();
            if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
            if (typeof syncControllerUI === 'function') syncControllerUI();
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
            if (typeof applyFillToMeshGlobal === 'function') applyFillToMeshGlobal(id);
            if (typeof render3D === 'function') render3D();
            if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
            syncControllerUI();
            triggerAutoSave();
          } else {
            setTimelineOffset(kf.time * PX_PER_SEC, false);
          }
        };

        window.addEventListener('mousemove', onKfMove);
        window.addEventListener('mouseup', onKfUp);
        window.addEventListener('touchmove', onKfMove, { passive: false });
        window.addEventListener('touchend', onKfUp);
      };

      marker.addEventListener('mousedown', onKfDown);
      marker.addEventListener('touchstart', onKfDown, { passive: false });

      frag.appendChild(marker);
    }
  container.appendChild(frag);
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
  const channel = getActiveKeyframeChannel();
  const kfs = layerKeyframes.get(id) || [];
  
  const hasExistingChannelKeyframes = kfs.some(k => {
    if (channel === 'position') return k.posX !== undefined || k.posY !== undefined || k.posZ !== undefined;
    if (channel === 'rotX') return k.rotX !== undefined;
    if (channel === 'rotY') return k.rotY !== undefined;
    if (channel === 'rotZ') return k.rotZ !== undefined;
    if (channel === 'scale') return k.scaleW !== undefined || k.scaleH !== undefined;
    if (channel === 'opacity') return k.opacity !== undefined;
    return false;
  });

  if (channel && hasExistingChannelKeyframes) {
    if (!layerKeyframes.has(id)) layerKeyframes.set(id, []);
    const layerKfList = layerKeyframes.get(id);
    const hasKfAtCurTime = hasKeyframeForChannel(id, elapsed, channel);
    let target = getKeyframeAt(id, elapsed);
    
    if (hasKfAtCurTime && target) {
      if (channel === 'rotX') target.rotX = t.rotX;
      else if (channel === 'rotY') target.rotY = t.rotY;
      else if (channel === 'rotZ') target.rotZ = t.rotZ;
      else if (channel === 'scale') { target.scaleW = t.scaleW; target.scaleH = t.scaleH; }
      else if (channel === 'opacity') target.opacity = t.opacity;
      else if (channel === 'position') { target.posX = t.posX; target.posY = t.posY; target.posZ = t.posZ; }
    } else {
      if (!target) {
        target = { time: Math.round(elapsed * 100) / 100 };
        layerKfList.push(target);
      }
      if (channel === 'rotX') target.rotX = t.rotX;
      else if (channel === 'rotY') target.rotY = t.rotY;
      else if (channel === 'rotZ') target.rotZ = t.rotZ;
      else if (channel === 'scale') { target.scaleW = t.scaleW; target.scaleH = t.scaleH; }
      else if (channel === 'opacity') target.opacity = t.opacity;
      else if (channel === 'position') { target.posX = t.posX; target.posY = t.posY; target.posZ = t.posZ; }
      layerKfList.sort((a, b) => a.time - b.time);
    }
    requestAllKeyframeMarkersRender();
    updateKeyframeUI();
  } else {
    if (kfs.length > 0) {
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
const mediaNaturalRatioMap = new Map();

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
  const camDist = Math.max(0.5, (camera3D ? camera3D.position.z : 5) - (posZ / 200));
  const fovRad = ((camera3D ? camera3D.fov : 45) * Math.PI) / 180;
  const visH = 2 * Math.tan(fovRad / 2) * camDist;
  const pxPerUnit = h / visH;

  const curX = w / 2 + (posX / 200) * pxPerUnit;
  const curY = h / 2 - (posY / 200) * pxPerUnit;
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
  if (typeof getLayerShapeParams === 'function') {
    const sp = getLayerShapeParams(id, (shapeType === 'media' || shapeType === 'line' || shapeType === 'arrow') ? 'square' : (shapeType || 'svg_path'));
    if (sp && sp.sizeX !== undefined) sizeX = sp.sizeX;
    if (sp && sp.sizeY !== undefined) sizeY = sp.sizeY;
  }
  const WORLD_SCREEN_H = 4.1421356;
  const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
  const refH = projDim.height;
  let baseW = WORLD_SCREEN_H;
  let baseH = WORLD_SCREEN_H;
  let sp = null;
  const isGroup = (shapeType === 'group' || cat === 'group' || (typeof layerGroupData !== 'undefined' && layerGroupData.has(id)));

  if (isGroup) {
    baseW = WORLD_SCREEN_H * (projDim.width / projDim.height);
    baseH = WORLD_SCREEN_H;
  } else {
    sp = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(id, (shapeType === 'media' || shapeType === 'line' || shapeType === 'arrow') ? 'square' : (shapeType || 'svg_path')) : null;
    if (sp && sp.sizeX_px !== undefined && sp.sizeY_px !== undefined) {
      baseW = WORLD_SCREEN_H * (sp.sizeX_px / refH);
      baseH = WORLD_SCREEN_H * (sp.sizeY_px / refH);
    } else if (shapeType === 'text' || cat === 'text') {
      const textDim = (typeof getTextLayerDimensions === 'function') ? getTextLayerDimensions(id) : { widthUnits: 2.0, heightUnits: 0.8 };
      baseW = textDim.widthUnits;
      baseH = textDim.heightUnits;
    } else if (isVideoOrMedia || shapeType === 'media') {
      const mediaFit = fill?.mediaFit || 'fit';
      if (mediaFit === 'fit') {
        const aspect = getMediaAspectRatio(id, wt.mediaUrl || fill?.mediaUrl);
        baseW = WORLD_SCREEN_H * aspect;
        baseH = WORLD_SCREEN_H;
      } else {
        baseW = WORLD_SCREEN_H;
        baseH = WORLD_SCREEN_H;
      }
    } else {
      baseW = 1.6;
      baseH = 1.6;
    }
  }

  const rawW = baseW * (isGroup ? 1 : (sp && sp.sizeX_px ? 1 : (Math.abs(sizeX) / 100))) * (Math.abs(scaleW) / 100) * pxPerUnit;
  const rawH = baseH * (isGroup ? 1 : (sp && sp.sizeY_px ? 1 : (Math.abs(sizeY) / 100))) * (Math.abs(scaleH) / 100) * pxPerUnit;
  const marginPx = 0;
  const bw = Math.max(4, rawW);
  const bh = Math.max(4, rawH);
  const radZ = (rotZ * Math.PI) / 180;
  const radX = (rotX * Math.PI) / 180;
  const radY = (rotY * Math.PI) / 180;

  const hw = (bw / 2) * Math.max(0.08, Math.abs(Math.cos(radY)));
  const hh = (bh / 2) * Math.max(0.08, Math.abs(Math.cos(radX)));

  const cosZ = Math.cos(radZ);
  const sinZ = Math.sin(radZ);
  const p1 = { x: curX - hw * cosZ + hh * sinZ, y: curY - hw * sinZ - hh * cosZ };
  const p2 = { x: curX + hw * cosZ + hh * sinZ, y: curY + hw * sinZ - hh * cosZ };
  const p3 = { x: curX + hw * cosZ - hh * sinZ, y: curY + hw * sinZ + hh * cosZ };
  const p4 = { x: curX - hw * cosZ - hh * sinZ, y: curY - hw * sinZ + hh * cosZ };
  const pTopMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const pRightMid = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
  const pBotMid = { x: (p3.x + p4.x) / 2, y: (p3.y + p4.y) / 2 };
  const pLeftMid = { x: (p4.x + p1.x) / 2, y: (p4.y + p1.y) / 2 };

  let svgContent = '';
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
      framePoints.forEach(pt => {
        if (!pt.isKeyframe) {
          trajSvg += `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="1.6" fill="#FAB778" opacity="0.8" />`;
        }
      });
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
  if (shapeType === 'line' || shapeType === 'arrow') {
    const sp = getLayerShapeParams(id, shapeType);
    const pts = (sp.points && sp.points.length >= 2) ? sp.points : [{ x: -50, y: 0 }, { x: 50, y: 0 }];
    const activeIdx = sp.selectedPointIdx || 0;
    const baseDim = baseW || 1.6;
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
    screenPts.forEach((spt, idx) => {
      const isActive = (idx === activeIdx);
      const r = isActive ? 6.5 : 4.5;
      const fillCol = isActive ? '#FFF2C2' : '#FAB778';
      svgContent += `
        <circle cx="${spt.x.toFixed(1)}" cy="${spt.y.toFixed(1)}" r="${r}" fill="${fillCol}" stroke="#4A1D05" stroke-width="1.8" />
      `;
    });
  } else if (shapeType === 'camera' || cat === 'camera') {
    svgContent += `
      <polygon points="${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} ${p4.x.toFixed(1)},${p4.y.toFixed(1)}" fill="none" stroke="#FAB778" stroke-width="2.0" opacity="0.95" stroke-dasharray="6,4" stroke-linejoin="round" />
      <path d="M ${(curX - 12).toFixed(1)} ${(curY - 7).toFixed(1)} L ${(curX + 4).toFixed(1)} ${(curY - 7).toFixed(1)} L ${(curX + 4).toFixed(1)} ${(curY + 7).toFixed(1)} L ${(curX - 12).toFixed(1)} ${(curY + 7).toFixed(1)} Z M ${(curX + 4).toFixed(1)} ${(curY - 3.5).toFixed(1)} L ${(curX + 12).toFixed(1)} ${(curY - 8).toFixed(1)} L ${(curX + 12).toFixed(1)} ${(curY + 8).toFixed(1)} L ${(curX + 4).toFixed(1)} ${(curY + 3.5).toFixed(1)} Z" fill="#FAB778" opacity="0.9" />
    `;
  } else if (shapeType === 'null' || cat === 'null') {
    svgContent += `
      <polygon points="${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} ${p4.x.toFixed(1)},${p4.y.toFixed(1)}" fill="none" stroke="#FAB778" stroke-width="1.8" opacity="0.9" stroke-dasharray="5,4" stroke-linejoin="round" />
    `;
  } else {
    svgContent += `
      <polygon points="${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} ${p4.x.toFixed(1)},${p4.y.toFixed(1)}" data-handle="move" fill="rgba(250, 183, 120, 0.001)" stroke="#FAB778" stroke-width="1.8" opacity="0.95" stroke-linejoin="round" style="cursor: move; pointer-events: all;" />
    `;
  }
  svgContent += `
    <g data-handle="corner-tl" style="cursor: nwse-resize; pointer-events: all;">
      <circle cx="${p1.x.toFixed(1)}" cy="${p1.y.toFixed(1)}" r="12" fill="transparent" />
      <circle cx="${p1.x.toFixed(1)}" cy="${p1.y.toFixed(1)}" r="4.8" fill="#FAB778" stroke="#4A1D05" stroke-width="1.6" />
    </g>
    <g data-handle="corner-tr" style="cursor: nesw-resize; pointer-events: all;">
      <circle cx="${p2.x.toFixed(1)}" cy="${p2.y.toFixed(1)}" r="12" fill="transparent" />
      <circle cx="${p2.x.toFixed(1)}" cy="${p2.y.toFixed(1)}" r="4.8" fill="#FAB778" stroke="#4A1D05" stroke-width="1.6" />
    </g>
    <g data-handle="corner-br" style="cursor: nwse-resize; pointer-events: all;">
      <circle cx="${p3.x.toFixed(1)}" cy="${p3.y.toFixed(1)}" r="12" fill="transparent" />
      <circle cx="${p3.x.toFixed(1)}" cy="${p3.y.toFixed(1)}" r="4.8" fill="#FAB778" stroke="#4A1D05" stroke-width="1.6" />
    </g>
    <g data-handle="corner-bl" style="cursor: nesw-resize; pointer-events: all;">
      <circle cx="${p4.x.toFixed(1)}" cy="${p4.y.toFixed(1)}" r="12" fill="transparent" />
      <circle cx="${p4.x.toFixed(1)}" cy="${p4.y.toFixed(1)}" r="4.8" fill="#FAB778" stroke="#4A1D05" stroke-width="1.6" />
    </g>
  `;
  svgContent += `
    <g data-handle="edge-top" style="cursor: ns-resize; pointer-events: all;">
      <rect x="${(pTopMid.x - 10).toFixed(1)}" y="${(pTopMid.y - 10).toFixed(1)}" width="20" height="20" fill="transparent" />
      <rect x="${(pTopMid.x - 3.5).toFixed(1)}" y="${(pTopMid.y - 3.5).toFixed(1)}" width="7" height="7" rx="1.5" fill="#FFF2C2" stroke="#4A1D05" stroke-width="1.3" />
    </g>
    <g data-handle="edge-right" style="cursor: ew-resize; pointer-events: all;">
      <rect x="${(pRightMid.x - 10).toFixed(1)}" y="${(pRightMid.y - 10).toFixed(1)}" width="20" height="20" fill="transparent" />
      <rect x="${(pRightMid.x - 3.5).toFixed(1)}" y="${(pRightMid.y - 3.5).toFixed(1)}" width="7" height="7" rx="1.5" fill="#FFF2C2" stroke="#4A1D05" stroke-width="1.3" />
    </g>
    <g data-handle="edge-bottom" style="cursor: ns-resize; pointer-events: all;">
      <rect x="${(pBotMid.x - 10).toFixed(1)}" y="${(pBotMid.y - 10).toFixed(1)}" width="20" height="20" fill="transparent" />
      <rect x="${(pBotMid.x - 3.5).toFixed(1)}" y="${(pBotMid.y - 3.5).toFixed(1)}" width="7" height="7" rx="1.5" fill="#FFF2C2" stroke="#4A1D05" stroke-width="1.3" />
    </g>
    <g data-handle="edge-left" style="cursor: ew-resize; pointer-events: all;">
      <rect x="${(pLeftMid.x - 10).toFixed(1)}" y="${(pLeftMid.y - 10).toFixed(1)}" width="20" height="20" fill="transparent" />
      <rect x="${(pLeftMid.x - 3.5).toFixed(1)}" y="${(pLeftMid.y - 3.5).toFixed(1)}" width="7" height="7" rx="1.5" fill="#FFF2C2" stroke="#4A1D05" stroke-width="1.3" />
    </g>
  `;
  svgContent += `
    <g data-handle="move" style="cursor: move; pointer-events: all;">
      <circle cx="${curX.toFixed(1)}" cy="${curY.toFixed(1)}" r="14" fill="transparent" />
      <line x1="${(curX - 8).toFixed(1)}" y1="${curY.toFixed(1)}" x2="${(curX + 8).toFixed(1)}" y2="${curY.toFixed(1)}" stroke="#FAB778" stroke-width="1.6" />
      <line x1="${curX.toFixed(1)}" y1="${(curY - 8).toFixed(1)}" x2="${curX.toFixed(1)}" y2="${(curY + 8).toFixed(1)}" stroke="#FAB778" stroke-width="1.6" />
      <circle cx="${curX.toFixed(1)}" cy="${curY.toFixed(1)}" r="3.8" fill="none" stroke="#FAB778" stroke-width="1.4" />
    </g>
  `;

  if (svgContent !== _lastOverlaySvg) {
    _lastOverlaySvg = svgContent;
    overlay.innerHTML = svgContent;
  }
}

function initViewportInteractions() {
  const canvasScreen = document.getElementById('canvasScreen') || document.getElementById('canvasWrap');
  if (!canvasScreen) return;

  let isDragging = false;
  let dragMode = null;
  let activeLayerId = null;
  let startX = 0, startY = 0;
  let startTransform = null;
  let startShapeParams = null;
  let startRect = null;

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const handleEl = e.target.closest ? e.target.closest('[data-handle]') : null;
    const handleType = handleEl ? handleEl.dataset.handle : null;

    if (handleType && typeof selectedTrackRow !== 'undefined' && selectedTrackRow) {
      activeLayerId = selectedTrackRow.dataset.layerId || 'default';
      dragMode = handleType;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startTransform = { ...getLayerTransform(activeLayerId) };
      const shapeType = selectedTrackRow.dataset.shapeType || 'square';
      startShapeParams = (typeof getLayerShapeParams === 'function') ? { ...getLayerShapeParams(activeLayerId, shapeType) } : {};
      startRect = canvasScreen.getBoundingClientRect();

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const rect = canvasScreen.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    if (typeof THREE !== 'undefined' && typeof camera3D !== 'undefined' && camera3D && typeof meshLayerMap !== 'undefined') {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera3D);

      const trackRows = Array.from(document.querySelectorAll('.track-row'));
      const candidateMeshes = [];
      trackRows.forEach(row => {
        const id = row.dataset.layerId;
        if (id && meshLayerMap.has(id)) {
          const m = meshLayerMap.get(id);
          if (m && m.visible) {
            m.userData = m.userData || {};
            m.userData.layerId = id;
            m.userData.trackRow = row;
            candidateMeshes.push(m);
          }
        }
      });

      const intersects = raycaster.intersectObjects(candidateMeshes, true);
      if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        while (hitObj && !hitObj.userData?.layerId && hitObj.parent) {
          hitObj = hitObj.parent;
        }
        const hitId = hitObj?.userData?.layerId || [...meshLayerMap.entries()].find(([k, v]) => v === hitObj)?.[0];
        if (hitId) {
          const targetRow = document.querySelector(`.track-row[data-layer-id="${hitId}"]`);
          if (targetRow) {
            if (typeof selectTrackRow === 'function') {
              selectTrackRow(targetRow);
            } else {
              targetRow.click();
            }

            activeLayerId = hitId;
            dragMode = 'move';
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startTransform = { ...getLayerTransform(hitId) };
            const shapeType = targetRow.dataset.shapeType || 'square';
            startShapeParams = (typeof getLayerShapeParams === 'function') ? { ...getLayerShapeParams(hitId, shapeType) } : {};
            startRect = rect;

            window.addEventListener('pointermove', onPointerMove, { passive: false });
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    }
  }

  function onPointerMove(e) {
    if (!isDragging || !activeLayerId || !startTransform) return;
    e.preventDefault();

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const rect = startRect || canvasScreen.getBoundingClientRect();
    const h = rect.height;
    const fovRad = ((typeof camera3D !== 'undefined' && camera3D ? camera3D.fov : 45) * Math.PI) / 180;
    const dist = Math.max(0.5, ((typeof camera3D !== 'undefined' && camera3D) ? camera3D.position.z : 5) - (startTransform.posZ / 200));
    const visH = 2 * Math.tan(fovRad / 2) * dist;
    const pxPerUnit = h / visH;
    const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };

    if (dragMode === 'move') {
      const dWorldX = dx / pxPerUnit;
      const dWorldY = -dy / pxPerUnit;
      const t = getLayerTransform(activeLayerId);
      t.posX = Math.round(startTransform.posX + dWorldX * 200);
      t.posY = Math.round(startTransform.posY + dWorldY * 200);
      applyTransformToThreeMesh(activeLayerId, t);
      render3D();
      renderCanvasOverlay();
      if (typeof syncControllerUI === 'function') syncControllerUI();
    } else if (dragMode && dragMode.startsWith('corner-')) {
      let scaleFactor = 1.0;
      if (dragMode === 'corner-tl') scaleFactor = 1 + (-dx - dy) / 200;
      else if (dragMode === 'corner-tr') scaleFactor = 1 + (dx - dy) / 200;
      else if (dragMode === 'corner-br') scaleFactor = 1 + (dx + dy) / 200;
      else if (dragMode === 'corner-bl') scaleFactor = 1 + (-dx + dy) / 200;
      scaleFactor = Math.max(0.05, scaleFactor);

      const targetRow = document.querySelector(`.track-row[data-layer-id="${activeLayerId}"]`);
      const shapeType = targetRow ? (targetRow.dataset.shapeType || 'square') : 'square';
      const sp = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(activeLayerId, shapeType) : null;
      if (sp && sp.sizeX_px !== undefined && sp.sizeY_px !== undefined && startShapeParams && startShapeParams.sizeX_px) {
        sp.sizeX_px = Math.max(10, Math.round(startShapeParams.sizeX_px * scaleFactor));
        sp.sizeY_px = Math.max(10, Math.round(startShapeParams.sizeY_px * scaleFactor));
      } else {
        const t = getLayerTransform(activeLayerId);
        t.scaleW = Math.max(5, Math.round(startTransform.scaleW * scaleFactor));
        t.scaleH = Math.max(5, Math.round(startTransform.scaleH * scaleFactor));
      }
      applyTransformToThreeMesh(activeLayerId, getLayerTransform(activeLayerId));
      render3D();
      renderCanvasOverlay();
      if (typeof syncControllerUI === 'function') syncControllerUI();
    } else if (dragMode === 'edge-left' || dragMode === 'edge-right') {
      const sign = (dragMode === 'edge-right') ? 1 : -1;
      const dWorldX = (dx * sign) / pxPerUnit;
      const dPx = dWorldX * (projDim.height / 4.1421356);

      const targetRow = document.querySelector(`.track-row[data-layer-id="${activeLayerId}"]`);
      const shapeType = targetRow ? (targetRow.dataset.shapeType || 'square') : 'square';
      const sp = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(activeLayerId, shapeType) : null;
      if (sp && sp.sizeX_px !== undefined && startShapeParams && startShapeParams.sizeX_px) {
        sp.sizeX_px = Math.max(10, Math.round(startShapeParams.sizeX_px + dPx * 2));
      } else {
        const t = getLayerTransform(activeLayerId);
        t.scaleW = Math.max(5, Math.round(startTransform.scaleW + (dx * sign) * 0.75));
      }
      applyTransformToThreeMesh(activeLayerId, getLayerTransform(activeLayerId));
      render3D();
      renderCanvasOverlay();
      if (typeof syncControllerUI === 'function') syncControllerUI();
    } else if (dragMode === 'edge-top' || dragMode === 'edge-bottom') {
      const sign = (dragMode === 'edge-bottom') ? 1 : -1;
      const dWorldY = (dy * sign) / pxPerUnit;
      const dPx = dWorldY * (projDim.height / 4.1421356);

      const targetRow = document.querySelector(`.track-row[data-layer-id="${activeLayerId}"]`);
      const shapeType = targetRow ? (targetRow.dataset.shapeType || 'square') : 'square';
      const sp = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(activeLayerId, shapeType) : null;
      if (sp && sp.sizeY_px !== undefined && startShapeParams && startShapeParams.sizeY_px) {
        sp.sizeY_px = Math.max(10, Math.round(startShapeParams.sizeY_px + dPx * 2));
      } else {
        const t = getLayerTransform(activeLayerId);
        t.scaleH = Math.max(5, Math.round(startTransform.scaleH + (dy * sign) * 0.75));
      }
      applyTransformToThreeMesh(activeLayerId, getLayerTransform(activeLayerId));
      render3D();
      renderCanvasOverlay();
      if (typeof syncControllerUI === 'function') syncControllerUI();
    }
  }

  function onPointerUp() {
    if (isDragging && activeLayerId) {
      if (typeof applyFillToMeshGlobal === 'function') applyFillToMeshGlobal(activeLayerId);
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }
    isDragging = false;
    dragMode = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  canvasScreen.addEventListener('pointerdown', onPointerDown);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initViewportInteractions);
} else {
  initViewportInteractions();
}

