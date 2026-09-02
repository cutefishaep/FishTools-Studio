function syncControllerUI() {
  if (!selectedTrackRow) return;
  const id = selectedTrackRow.dataset.layerId || 'default';
  const t = getLayerTransform(id);
  const exps = (typeof getLayerExpressions === 'function') ? getLayerExpressions(id) : {};

  
  const hasExpMove = !!(exps.posX || exps.posY || exps.posZ);
  const hasExpRot = !!(exps.rotZ || exps.rotX || exps.rotY);
  const hasExpScale = !!(exps.scaleW || exps.scaleH);
  const hasExpOpacity = !!exps.opacity;

  const cardMove = document.getElementById('card-move');
  const cardRotate = document.getElementById('card-rotate');
  const cardScale = document.getElementById('card-scale');
  const cardOpacity = document.getElementById('card-opacity');

  if (cardMove) cardMove.classList.toggle('is-expression-locked', hasExpMove);
  if (cardRotate) cardRotate.classList.toggle('is-expression-locked', hasExpRot);
  if (cardScale) cardScale.classList.toggle('is-expression-locked', hasExpScale);
  if (cardOpacity) cardOpacity.classList.toggle('is-expression-locked', hasExpOpacity);

  const curPanel = (typeof activeControllerPanel !== 'undefined') ? activeControllerPanel : 'move';
  const btnExp = document.getElementById('btnTransformExpression');
  if (btnExp) {
    const isExpActive = (curPanel === 'move' && hasExpMove) ||
                        (curPanel === 'rotate' && hasExpRot) ||
                        (curPanel === 'scale' && hasExpScale) ||
                        (curPanel === 'opacity' && hasExpOpacity);
    btnExp.classList.toggle('active', isExpActive);
  }

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
  if (typeof syncTextAnimUI === 'function') {
    syncTextAnimUI(id);
  }
  requestAllKeyframeMarkersRender();
  applyTransformToThreeMesh(id, t);
  requestCanvasOverlayRender();
  render3D();
}

let _kfMarkersRaf = null;
function requestAllKeyframeMarkersRender() {
  if (_kfMarkersRaf) return;
  _kfMarkersRaf = requestAnimationFrame(() => {
    _kfMarkersRaf = null;
    renderAllKeyframeMarkers();
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

  drawer.classList.remove(
    'subpanel-color', 'subpanel-border-shadow', 'subpanel-move',
    'subpanel-graph', 'subpanel-shape', 'subpanel-text',
    'subpanel-camera', 'subpanel-effects', 'subpanel-add-effect'
  );
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

  drawer.classList.remove(
    'subpanel-open', 'subpanel-color', 'subpanel-move',
    'subpanel-border-shadow', 'subpanel-graph', 'subpanel-shape',
    'subpanel-text', 'subpanel-camera', 'subpanel-effects', 'subpanel-add-effect', 'in-subpanel'
  );

  if (subpanelEl) subpanelEl.style.display = 'none';
  document.querySelectorAll('.inspector-subpanel').forEach(p => {
    p.style.display = 'none';
  });

  if (quickStrip) {
    quickStrip.style.display = '';
    quickStrip.style.removeProperty('display');
  }
  if (toolsGrid) {
    toolsGrid.style.display = '';
    toolsGrid.style.removeProperty('display');
  }

  if (onAfterClose) onAfterClose();
}
window.closeInspectorSubpanel = closeInspectorSubpanel;

let projectRatio = '9:16';
let projectResolution = '1080p';
let projectBgColor = '#000000';
let projectCustomWidth = 1080;
let projectCustomHeight = 1080;
