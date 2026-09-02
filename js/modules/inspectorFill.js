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
        openGraphEditor(channel || getActiveKeyframeChannel() || 'position', document.getElementById('btnKeyframeGraph'));
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

  const btnInspColor = document.getElementById('btnInspColorFill');
  const panelColor = document.getElementById('panelColorFill');
  const btnBackColor = document.getElementById('btnBackFromColorFill');
  if (btnInspColor && toolsGrid && panelColor) {
    btnInspColor.addEventListener('click', (e) => {
      e.stopPropagation();
      openInspectorSubpanel(panelColor, 'subpanel-color', () => {
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
          updateMediaFitUI(fill.mediaFit || 'fit');
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
  const fillTabColor = document.getElementById('fillTabColor');
  const fillTabMedia = document.getElementById('fillTabMedia');
  const fillTabGradient = document.getElementById('fillTabGradient');
  function switchFillTab(name) {
    document.querySelectorAll('#colorFillTabs [data-fill-tab]').forEach(b => b.classList.toggle('active', b.dataset.fillTab === name));
    if (fillTabColor) fillTabColor.style.display = name === 'color' ? 'flex' : 'none';
    if (fillTabMedia) fillTabMedia.style.display = name === 'media' ? 'flex' : 'none';
    if (fillTabGradient) fillTabGradient.style.display = name === 'gradient' ? 'flex' : 'none';
    if (name === 'gradient' && selectedTrackRow) {
      if (typeof renderGradient === 'function') renderGradient();
      applyGradient();
    }
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

  window.getGlobalMediaLibrary = getGlobalMediaLibrary;
  window.addGlobalMedia = addGlobalMedia;
  window.removeGlobalMedia = removeGlobalMedia;
  window.syncAllMediaGrids = syncAllMediaGrids;
  window.createMediaThumbnailElement = createMediaThumbnailElement;

  const btnUploadMedia = document.getElementById('btnUploadMedia');
  const inputFillMedia = document.getElementById('inputFillMedia');

  if (btnUploadMedia && inputFillMedia) {
    btnUploadMedia.addEventListener('click', () => {
      inputFillMedia.value = '';
      inputFillMedia.click();
    });
    inputFillMedia.addEventListener('change', () => {
      const file = inputFillMedia.files && inputFillMedia.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          const item = addGlobalMedia(dataUrl, file.name, file.type, file);
          if (selectedTrackRow) {
            const id = selectedTrackRow.dataset.layerId || 'default';
            const fill = getLayerFill(id);
            fill.type = 'media';
            fill.mediaUrl = dataUrl || (item && item.url) || item?.id;
            fill.mediaId = item ? item.id : null;
            fill.mediaName = file.name;
            fill.color = null;
            fill.gradientType = null;
            if (typeof videoFrameSequenceMap !== 'undefined') videoFrameSequenceMap.delete(id);
            if (typeof sharedFrameSequenceTextureMap !== 'undefined') sharedFrameSequenceTextureMap.delete(id);
            if (typeof sharedFrameSequenceLastIndexMap !== 'undefined') sharedFrameSequenceLastIndexMap.delete(id);
            if (typeof layerFrameTextureMap !== 'undefined') layerFrameTextureMap.delete(id);
            if (typeof layerBaseCanvasMap !== 'undefined') layerBaseCanvasMap.delete(id);
            if (typeof layerBlurTextureCache !== 'undefined') {
              for (const k of Array.from(layerBlurTextureCache.keys())) {
                if (k.startsWith(id + '_')) {
                  const oldTex = layerBlurTextureCache.get(k);
                  if (oldTex) try { oldTex.dispose(); } catch(_) {}
                  layerBlurTextureCache.delete(k);
                }
              }
            }
            applyFillToMeshGlobal(id, true);
            if (typeof updateLayerEffectsFast === 'function') updateLayerEffectsFast(id);
            if (typeof render3D === 'function') render3D();
            triggerAutoSave();
          }
          inputFillMedia.value = '';
        };
        reader.readAsDataURL(file);
      }
    });
  }

  syncAllMediaGrids();

  const mediaFitButtons = document.querySelectorAll('#mediaFitModeBar .media-fit-btn');
  function updateMediaFitUI(mode) {
    const targetMode = mode || 'fit';
    mediaFitButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.fit === targetMode);
    });
  }

  mediaFitButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = btn.dataset.fit || 'fit';
      updateMediaFitUI(mode);
      if (selectedTrackRow) {
        const id = selectedTrackRow.dataset.layerId || 'default';
        const fill = getLayerFill(id);
        fill.mediaFit = mode;
        applyFillToMeshGlobal(id);
        applyTransformToThreeMesh(id, getLayerTransform(id));
        renderCanvasOverlay();
        render3D();
        triggerAutoSave();
      }
    });
  });

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
        handle.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedStopIdx = idx;
          renderGradient();
          const targetEl = (gradientStopsEl && gradientStopsEl.children[selectedStopIdx]) || handle;
          openStopColorPicker(targetEl);
        });
        handle.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          selectedStopIdx = idx;
          renderGradient();
          const targetEl = (gradientStopsEl && gradientStopsEl.children[selectedStopIdx]) || handle;
          openStopColorPicker(targetEl);
        });
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

  updateGradientTypeUI();
  renderGradient();

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
        openGraphEditor(channel, btnKfGraph);
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

window.initMoveTransformController = initMoveTransformController;
