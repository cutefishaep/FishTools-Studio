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

  
  const sliderZoom = document.getElementById('sliderCameraZoom');
  const valZoom = document.getElementById('valCameraZoom');

  
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

    
    if (sliderZoom) sliderZoom.value = cp.zoom || 100;
    if (valZoom) valZoom.textContent = `${cp.zoom || 100}%`;

    
    if (toggleBokeh) toggleBokeh.checked = !!cp.bokehEnabled;
    if (bokehSettings) bokehSettings.style.display = cp.bokehEnabled ? 'flex' : 'none';

    
    const isAuto = cp.focusMode !== 'manual';
    if (btnModeAuto) btnModeAuto.classList.toggle('active', isAuto);
    if (btnModeManual) btnModeManual.classList.toggle('active', !isAuto);
    if (boxTargetLayer) boxTargetLayer.style.display = isAuto ? 'flex' : 'none';
    if (boxManualDist) boxManualDist.style.display = !isAuto ? 'flex' : 'none';

    
    populateFocusTargetLayers(id, cp.focusTargetId);

    
    if (sliderManualDist) sliderManualDist.value = cp.manualFocusDist || 100;
    if (valManualDist) valManualDist.textContent = `${cp.manualFocusDist || 100} px`;

    if (sliderBokehBlur) sliderBokehBlur.value = cp.bokehBlur !== undefined ? cp.bokehBlur : 50;
    if (valBokehBlur) valBokehBlur.textContent = `${cp.bokehBlur !== undefined ? cp.bokehBlur : 50}%`;

    if (sliderBokehRange) sliderBokehRange.value = cp.bokehRange !== undefined ? cp.bokehRange : 60;
    if (valBokehRange) valBokehRange.textContent = `${cp.bokehRange !== undefined ? cp.bokehRange : 60} px`;
  }
}

window.getLayerCameraParams = getLayerCameraParams;
window.initCameraControlSubpanel = initCameraControlSubpanel;
