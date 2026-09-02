function initExportModalEvents() {
  const btnClose = document.getElementById('btnCloseExportModal');
  if (btnClose) btnClose.addEventListener('click', closeExportModal);

  const modal = document.getElementById('exportModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeExportModal();
    });
  }
  const switcher = document.getElementById('exportTypeSwitcher');
  const panelVideo = document.getElementById('panelExportVideo');
  const panelPng = document.getElementById('panelExportPng');
  const panelFsp = document.getElementById('panelExportFsp');
  const btnRender = document.getElementById('btnStartExportRender');
  const btnDownloadVideo = document.getElementById('btnDownloadExportVideo');
  const btnDownloadPng = document.getElementById('btnDownloadCurrentPng');
  const btnDownloadFsp = document.getElementById('btnDownloadFspProject');

  function switchExportTab(type) {
    if (!switcher) return;
    switcher.querySelectorAll('.am-export-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });

    if (panelVideo) panelVideo.style.display = (type === 'video') ? 'flex' : 'none';
    if (panelPng) panelPng.style.display = (type === 'png') ? 'flex' : 'none';
    if (panelFsp) panelFsp.style.display = (type === 'fsp') ? 'flex' : 'none';

    if (btnRender) btnRender.style.display = (type === 'video' && !exportVideoUrl) ? 'flex' : (type === 'video' ? 'none' : 'none');
    if (btnDownloadVideo) btnDownloadVideo.style.display = (type === 'video' && exportVideoUrl) ? 'flex' : 'none';
    if (btnDownloadPng) btnDownloadPng.style.display = (type === 'png') ? 'flex' : 'none';
    if (btnDownloadFsp) btnDownloadFsp.style.display = (type === 'fsp') ? 'flex' : 'none';

    if (type === 'png') {
      updateExportPngPreview();
    }
  }

  if (switcher) {
    switcher.addEventListener('click', (e) => {
      const btn = e.target.closest('.am-export-type-btn');
      if (!btn) return;
      e.stopPropagation();
      switchExportTab(btn.dataset.type || 'video');
    });
  }

  window.switchExportTab = switchExportTab;
  function createZipBlob(fileEntries) {
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[i] = c;
    }

    function crc32(buf) {
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    const encoder = new TextEncoder();
    const fileRecords = [];
    let offset = 0;
    const chunks = [];

    for (const entry of fileEntries) {
      const filenameBytes = encoder.encode(entry.name);
      const dataBytes = (typeof entry.data === 'string') 
        ? encoder.encode(entry.data) 
        : (entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data));
      const crc = crc32(dataBytes);
      const size = dataBytes.length;
      const localHeader = new Uint8Array(30 + filenameBytes.length);
      const dv = new DataView(localHeader.buffer);
      dv.setUint32(0, 0x04034B50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, filenameBytes.length, true);
      dv.setUint16(28, 0, true);
      localHeader.set(filenameBytes, 30);

      chunks.push(localHeader);
      chunks.push(dataBytes);

      fileRecords.push({
        nameBytes: filenameBytes,
        crc: crc,
        size: size,
        offset: offset
      });

      offset += localHeader.length + dataBytes.length;
    }

    const centralDirStart = offset;
    let centralDirSize = 0;

    for (const rec of fileRecords) {
      const cdHeader = new Uint8Array(46 + rec.nameBytes.length);
      const dv = new DataView(cdHeader.buffer);
      dv.setUint32(0, 0x02014B50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint16(14, 0, true);
      dv.setUint32(16, rec.crc, true);
      dv.setUint32(20, rec.size, true);
      dv.setUint32(24, rec.size, true);
      dv.setUint16(28, rec.nameBytes.length, true);
      dv.setUint16(30, 0, true);
      dv.setUint16(32, 0, true);
      dv.setUint16(34, 0, true);
      dv.setUint16(36, 0, true);
      dv.setUint32(38, 0, true);
      dv.setUint32(42, rec.offset, true);
      cdHeader.set(rec.nameBytes, 46);

      chunks.push(cdHeader);
      centralDirSize += cdHeader.length;
    }
    const eocd = new Uint8Array(22);
    const dvEocd = new DataView(eocd.buffer);
    dvEocd.setUint32(0, 0x06054B50, true);
    dvEocd.setUint16(4, 0, true);
    dvEocd.setUint16(6, 0, true);
    dvEocd.setUint16(8, fileRecords.length, true);
    dvEocd.setUint16(10, fileRecords.length, true);
    dvEocd.setUint32(12, centralDirSize, true);
    dvEocd.setUint32(16, centralDirStart, true);
    dvEocd.setUint16(20, 0, true);

    chunks.push(eocd);

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return new Blob([out], { type: 'application/zip' });
  }
  function captureHighResPngDataUrl() {
    if (!renderer3D || !scene3D || !camera3D) return null;

    let targetW = 1080, targetH = 1920;
    if (typeof projectRatio !== 'undefined') {
      if (projectRatio === '16:9') { targetW = 1920; targetH = 1080; }
      else if (projectRatio === '9:16') { targetW = 1080; targetH = 1920; }
      else if (projectRatio === '1:1') { targetW = 1080; targetH = 1080; }
      else if (projectRatio === '4:5') { targetW = 1080; targetH = 1350; }
      else if (projectRatio === '4:3') { targetW = 1440; targetH = 1080; }
      else if (projectRatio === 'custom' && typeof projectCustomWidth !== 'undefined' && typeof projectCustomHeight !== 'undefined') {
        targetW = projectCustomWidth || 1080;
        targetH = projectCustomHeight || 1920;
      }
    }
    if (typeof projectResolution !== 'undefined') {
      if (projectResolution === '720p') {
        const factor = 720 / Math.min(targetW, targetH);
        targetW = Math.round(targetW * factor);
        targetH = Math.round(targetH * factor);
      } else if (projectResolution === '4k') {
        const factor = 2160 / Math.min(targetW, targetH);
        targetW = Math.round(targetW * factor);
        targetH = Math.round(targetH * factor);
      }
    }

    const prevW = renderer3D.domElement.width;
    const prevH = renderer3D.domElement.height;
    const prevAspect = camera3D.aspect;
    const prevDpr = renderer3D.getPixelRatio ? renderer3D.getPixelRatio() : 1;

    try {
      if (renderer3D.setPixelRatio) renderer3D.setPixelRatio(1);
      renderer3D.setSize(targetW, targetH, false);
      camera3D.aspect = targetW / targetH;
      camera3D.updateProjectionMatrix();

      if (typeof updateAllLayersInScene === 'function') {
        updateAllLayersInScene();
      } else if (typeof render3D === 'function') {
        render3D();
      }
      renderer3D.render(scene3D, camera3D);

      return renderer3D.domElement.toDataURL('image/png');
    } finally {
      if (typeof updateScene3DDimensions === 'function') {
        updateScene3DDimensions();
      } else {
        if (renderer3D.setPixelRatio) renderer3D.setPixelRatio(prevDpr);
        renderer3D.setSize(prevW, prevH, false);
        camera3D.aspect = prevAspect;
        camera3D.updateProjectionMatrix();
      }
      if (typeof render3D === 'function') render3D();
    }
  }

  function updateExportPngPreview() {
    const previewImg = document.getElementById('exportPngPreviewImg');
    const timecodeBadge = document.getElementById('exportPngTimecode');
    if (timecodeBadge) {
      const sec = (typeof currentTime !== 'undefined') ? currentTime : 0;
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      const f = Math.floor((sec % 1) * (projectFps || 30));
      timecodeBadge.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ':' + String(f).padStart(2, '0');
    }

    if (renderer3D && scene3D && camera3D && previewImg) {
      try {
        if (typeof render3D === 'function') render3D();
        const dataUrl = renderer3D.domElement.toDataURL('image/png');
        previewImg.src = dataUrl;
      } catch (err) {
        console.warn('PNG preview capture error', err);
      }
    }
  }
  if (btnDownloadPng) {
    btnDownloadPng.addEventListener('click', () => {
      if (!renderer3D || !scene3D || !camera3D) return;
      try {
        const dataUrl = captureHighResPngDataUrl();
        if (!dataUrl) throw new Error('Render buffer kosong');

        const titleInput = document.getElementById('activeTitle');
        const projName = (titleInput && titleInput.textContent.trim()) || 'FishTool_Frame';
        const cleanName = projName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const sec = (typeof currentTime !== 'undefined') ? currentTime.toFixed(2) : '0.00';

        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${cleanName}_frame_${sec}s.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (err) {
        alert('Gagal mengambil capture frame resolusi tinggi: ' + err.message);
      }
    });
  }
  if (btnDownloadFsp) {
    btnDownloadFsp.addEventListener('click', () => {
      saveCurrentProject();
      const titleInput = document.getElementById('activeTitle');
      const projName = (titleInput && titleInput.textContent.trim()) || 'FishTool_Project';
      const cleanName = projName.replace(/[^a-zA-Z0-9_-]/g, '_');

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

      const fullProjectData = {
        app: 'FishTool Studio',
        version: '2.0',
        fileExtension: '.fsp',
        format: 'zip-archive',
        id: currentProjectId || 'proj_' + Date.now(),
        name: projName,
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
        texts: Array.from(layerTexts.entries()),
        effects: Array.from(layerEffects.entries()),
        motionBlurTune: projectMotionBlurTune,
        motionBlurSamples: projectMotionBlurSamples,
        globalMotionBlur: isGlobalMotionBlurEnabled,
        motionBlurs: Array.from(layerMotionBlur.entries()),
        createdAt: new Date().toLocaleDateString(),
        exportedAt: new Date().toISOString()
      };

      const manifestData = {
        name: projName,
        app: 'FishTool Studio',
        version: '2.0',
        exportDate: new Date().toISOString(),
        layerCount: tracks.length,
        duration: totalDuration,
        fps: projectFps,
        ratio: projectRatio
      };

      const readmeText = `FishTool Studio Project Archive (.fsp)\n====================================\nProject Name: ${projName}\nExported At: ${new Date().toLocaleString()}\n\nThis .fsp file is a standard ZIP archive containing the complete project state and layers.\nTo inspect manually, rename to .zip and extract project.json.\n`;

      const zipBlob = createZipBlob([
        { name: 'project.json', data: JSON.stringify(fullProjectData, null, 2) },
        { name: 'manifest.json', data: JSON.stringify(manifestData, null, 2) },
        { name: 'README.txt', data: readmeText }
      ]);

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanName}.fsp`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
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
          const seq = fill && (videoFrameSequenceMap.get(fill.mediaUrl) || videoFrameSequenceMap.get(id) || (clipName && videoFrameSequenceMap.get(clipName)));
          if (seq && seq.frames && seq.frames.length > 0) {
            const clipOffset = parseFloat(row.dataset.mediaOffset || (fill && fill.mediaOffset) || 0) || 0;
            const localTime = Math.max(0, clipOffset + (curTime - startSec));
            const frameIndex = Math.min(seq.frames.length - 1, Math.max(0, Math.floor(localTime * (seq.fps || 30))));
            const currentFrame = seq.frames[frameIndex];
            if (currentFrame) {
              const sharedKey = id;
              let fTex = sharedFrameSequenceTextureMap.get(sharedKey);
              const needFlipY = false;
              if (!fTex) {
                fTex = new THREE.Texture(currentFrame);
                fTex.colorSpace = THREE.SRGBColorSpace;
                fTex.generateMipmaps = false;
                fTex.flipY = needFlipY;
                fTex.needsUpdate = true;
                sharedFrameSequenceTextureMap.set(sharedKey, fTex);
              } else {
                fTex.image = currentFrame;
                fTex.flipY = needFlipY;
                fTex.needsUpdate = true;
              }
              mesh.material.map = fTex;
            }
          }
          mesh.material.needsUpdate = true;
        }
      }
    }
  });
}
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
  const fspNameEl = document.getElementById('exportFspProjName');
  const durEl = document.getElementById('exportProjDuration');
  const titleInput = document.getElementById('activeTitle');
  const projName = (titleInput && titleInput.textContent.trim()) || 'My Project';
  if (nameEl) nameEl.textContent = projName;
  if (fspNameEl) fspNameEl.textContent = projName;
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

  if (typeof switchExportTab === 'function') {
    const activeTab = document.querySelector('#exportTypeSwitcher .am-export-type-btn.active');
    switchExportTab((activeTab && activeTab.dataset.type) || 'video');
  }

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
  const durSec = calculateMaxDuration();
  const fps = exportFps === 'source' ? (Number(projectFps) || 30) : Number(exportFps);
  const totalFrames = Math.max(1, Math.ceil(durSec * fps));

  const originalOffset = timelineOffset;
  const container = document.getElementById('canvasVideo');
  const previewW = container ? (container.clientWidth || 360) : 360;
  const previewH = container ? (container.clientHeight || 640) : 640;
  renderer3D.setSize(exportW, exportH, false);
  renderer3D.setPixelRatio(1);
  camera3D.aspect = exportW / exportH;
  camera3D.updateProjectionMatrix();
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = exportW;
  captureCanvas.height = exportH;
  const captureCtx = captureCanvas.getContext('2d');
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
      updateThreeSceneForExport(frameTime);
      renderer3D.render(scene3D, camera3D);
      captureCtx.drawImage(renderer3D.domElement, 0, 0, exportW, exportH);
    }

    if (isMp4Supported && videoEncoder) {
      const videoFrame = new VideoFrame(captureCanvas, {
        timestamp: Math.round((frame / fps) * 1_000_000),
        duration: frameDurationUs
      });
      videoEncoder.encode(videoFrame, { keyFrame: frame % Math.max(1, Math.round(fps * 2)) === 0 });
      videoFrame.close();
    } else {
      const dataUrl = captureCanvas.toDataURL('image/webp', 0.95);
      const vp8Chunk = WhammyVideo.parseWebPToVP8(dataUrl);
      if (vp8Chunk) vp8Frames.push(vp8Chunk);
    }
    const curPct = Math.round(((frame + 1) / totalFrames) * 100);
    if (fill) fill.style.width = curPct + '%';
    if (pct) pct.textContent = curPct + '%';
    if (status) status.textContent = `Rendering frame ${frame + 1} / ${totalFrames} (${exportW}x${exportH} @ ${fps}fps)`;
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
  camera3D.aspect = previewW / previewH;
  camera3D.updateProjectionMatrix();
  renderer3D.setSize(previewW, previewH);
  renderer3D.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  setTimelineOffset(originalOffset);
}
