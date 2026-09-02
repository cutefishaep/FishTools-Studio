function handleLayerOptionAction(action) {
  if (action === 'paste') {
    pasteLayerFromClipboard();
    return;
  }
  if (action === 'select-all') {
    if (typeof selectAllLayers === 'function') selectAllLayers();
    return;
  }
  if (action === 'select-other') {
    if (typeof selectOtherLayers === 'function') selectOtherLayers();
    return;
  }

  if (!selectedTrackRow) return;
  var id = selectedTrackRow.dataset.layerId;
  if (!id) return;

  var t = getLayerTransform(id);

  var aspect = 9 / 16;
  if (projectRatio === '16:9') aspect = 16 / 9;
  else if (projectRatio === '1:1') aspect = 1.0;
  else if (projectRatio === '4:5') aspect = 4 / 5;
  else if (projectRatio === '4:3') aspect = 4 / 3;
  else if (projectRatio === 'custom') {
    var cw = projectCustomWidth || 1080;
    var ch = projectCustomHeight || 1080;
    aspect = cw / ch;
  }

  var worldH = 4.1421356;
  var worldW = worldH * aspect;

  var cat = selectedTrackRow.dataset.category || 'media';
  var shapeType = selectedTrackRow.dataset.shapeType || '';
  if (!shapeType) {
    var clipNameEl = selectedTrackRow.querySelector('.track-clip-name');
    var clipNameText = clipNameEl ? clipNameEl.textContent : '';
    var lower = (clipNameText + '_' + cat).toLowerCase();
    if (lower.includes('circle') || lower.includes('bulat')) shapeType = 'circle';
    else if (lower.includes('triangle') || lower.includes('segitiga')) shapeType = 'triangle';
    else if (lower.includes('round')) shapeType = 'round';
    else if (lower.includes('square') || lower.includes('kotak')) shapeType = 'square';
    else if (lower.includes('star') || lower.includes('bintang')) shapeType = 'star';
    else if (cat === 'shape') shapeType = 'square';
    else shapeType = 'media';
  }

  var sizeX = 100, sizeY = 100;
  if (typeof getLayerShapeParams === 'function') {
    var sp = getLayerShapeParams(id, shapeType === 'media' ? 'square' : shapeType);
    if (sp.sizeX !== undefined) sizeX = sp.sizeX;
    if (sp.sizeY !== undefined) sizeY = sp.sizeY;
  }

  var baseDim = (shapeType === 'media' || cat === 'media' || cat === 'video') ? 4.0 : 1.6;
  var baseW = baseDim;
  var baseH = baseDim;

  if (shapeType === 'media' || cat === 'media' || cat === 'video') {
    var mediaAspect = getMediaAspectRatio(id);
    if (mediaAspect >= 1) {
      baseW = baseDim;
      baseH = baseDim / mediaAspect;
    } else {
      baseW = baseDim * mediaAspect;
      baseH = baseDim;
    }
  }

  var shapeBaseW = baseW * (Math.abs(sizeX) / 100);
  var shapeBaseH = baseH * (Math.abs(sizeY) / 100);

  var stretchW = (worldW / shapeBaseW) * 100;
  var stretchH = (worldH / shapeBaseH) * 100;

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
      var curW = (t.scaleW !== undefined && t.scaleW !== 0) ? t.scaleW : 100;
      t.scaleW = -curW;
      recordTransformChange(id, t);
      applyTransformToThreeMesh(id, t);
      syncControllerUI();
      render3D();
      break;
    }
    case 'flip-v': {
      var curH = (t.scaleH !== undefined && t.scaleH !== 0) ? t.scaleH : 100;
      t.scaleH = -curH;
      recordTransformChange(id, t);
      applyTransformToThreeMesh(id, t);
      syncControllerUI();
      render3D();
      break;
    }
    case 'fit-comp': {
      var fitScale = Math.min(stretchW, stretchH);
      var signW = (t.scaleW && t.scaleW < 0) ? -1 : 1;
      var signH = (t.scaleH && t.scaleH < 0) ? -1 : 1;
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
      var fillScale = Math.max(stretchW, stretchH);
      var signW = (t.scaleW && t.scaleW < 0) ? -1 : 1;
      var signH = (t.scaleH && t.scaleH < 0) ? -1 : 1;
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
      var signW = (t.scaleW && t.scaleW < 0) ? -1 : 1;
      var signH = (t.scaleH && t.scaleH < 0) ? -1 : 1;
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

function copySelectedLayer(row) {
  var targetRow = row || selectedTrackRow;
  if (!targetRow) return;
  var id = targetRow.dataset.layerId;
  if (!id) return;

  var cat = targetRow.dataset.category || 'media';
  var shapeType = targetRow.dataset.shapeType || '';
  var clip = targetRow.querySelector('.track-clip');
  var clipNameEl = targetRow.querySelector('.track-clip-name');
  var clipName = clipNameEl ? clipNameEl.textContent.trim() : 'Layer';
  var tagColor = targetRow.dataset.tagColor || 'none';

  var w = clip ? parseFloat(clip.style.width) || 300 : 300;
  var m = clip ? parseFloat(clip.style.marginLeft) || 0 : 0;

  var fill = getLayerFill(id);
  var videoSeq = (typeof videoFrameSequenceMap !== 'undefined') ? (videoFrameSequenceMap.get(id) || (fill && videoFrameSequenceMap.get(fill.mediaUrl)) || videoFrameSequenceMap.get(clipName)) : null;

  clipboardLayerData = {
    category: cat,
    shapeType: shapeType,
    name: clipName,
    tagColor: tagColor,
    width: w,
    marginLeft: m,
    mediaOffset: targetRow.dataset.mediaOffset || (fill && fill.mediaOffset) || '0',
    mediaNaturalRatio: (typeof mediaNaturalRatioMap !== 'undefined' ? mediaNaturalRatioMap.get(id) : null),
    sourceGroupId: (cat === 'group') ? id : null,
    transform: JSON.parse(JSON.stringify(getLayerTransform(id))),
    keyframes: JSON.parse(JSON.stringify(layerKeyframes.get(id) || [])),
    fill: JSON.parse(JSON.stringify(fill || { type: 'color', color: '#FAB778' })),
    borderShadow: JSON.parse(JSON.stringify(getLayerBorderShadow(id) || {})),
    shapeParams: JSON.parse(JSON.stringify(layerShapeParams.get(id) || {})),
    cameraParams: JSON.parse(JSON.stringify(layerCameraParams.get(id) || {})),
    motionBlur: !!layerMotionBlur.get(id),
    videoSeq: videoSeq
  };
}

function duplicateSelectedLayer(row) {
  var targetRow = row || selectedTrackRow;
  if (!targetRow) return;
  copySelectedLayer(targetRow);
  pasteLayerFromClipboard(true, targetRow);
}

function pasteLayerFromClipboard(isDuplicate, insertAfterRow) {
  isDuplicate = isDuplicate || false;
  insertAfterRow = insertAfterRow || null;
  if (!clipboardLayerData) return;

  var data = clipboardLayerData;
  var newId = (data.category === 'group')
    ? ('group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5))
    : ('layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));

  var container = document.getElementById('trackRowsContainer');
  if (!container) return;

  var baseName = data.name || 'Layer';
  var newName = isDuplicate ? (baseName + ' Copy') : baseName;

  var row = document.createElement('div');
  row.className = 'track-row adding';
  row.dataset.category = data.category || 'media';
  row.dataset.layerId = newId;
  if (data.mediaOffset) row.dataset.mediaOffset = data.mediaOffset;
  if (data.shapeType) row.dataset.shapeType = data.shapeType;
  if (data.tagColor && data.tagColor !== 'none') row.dataset.tagColor = data.tagColor;

  var isAudio = (data.category === 'audio');
  var defaultEyeIcon = isAudio ? 'volume_up' : 'visibility';

  var m = data.marginLeft;
  if (!isDuplicate) {
    m = Math.max(0, Math.round(elapsed * PX_PER_SEC));
  }
  var w = data.width || 300;

  var tagStyle = (data.tagColor && data.tagColor !== 'none') ? 'border-left: 5px solid ' + data.tagColor + ';' : '';

  row.innerHTML = '<button class="track-eye" title="' + (isAudio ? 'Mute / Unmute Audio' : 'Toggle Visibility') + ' / Tahan untuk Multi-Select"><span class="material-symbols-rounded">' + (isMultiSelectMode ? 'radio_button_unchecked' : defaultEyeIcon) + '</span></button><div class="track-trackway" style="transform: translateX(-' + timelineOffset + 'px);"><div class="track-clip" style="width: ' + w + 'px; margin-left: ' + m + 'px; ' + tagStyle + '" title="Klik untuk pilih / buka menu layer"><div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div><span class="track-clip-name">' + newName + '</span><div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div></div></div><button class="track-reorder-handle" title="Tahan &amp; geser untuk atur urutan layer (Reorder)"><span class="material-symbols-rounded">menu</span></button>';

  if (insertAfterRow && insertAfterRow.parentNode === container) {
    container.insertBefore(row, insertAfterRow.nextSibling);
  } else {
    container.insertBefore(row, container.firstChild);
  }

  layerTransforms.set(newId, JSON.parse(JSON.stringify(data.transform)));
  layerKeyframes.set(newId, JSON.parse(JSON.stringify(data.keyframes)));
  layerFills.set(newId, JSON.parse(JSON.stringify(data.fill)));
  layerBorderShadow.set(newId, JSON.parse(JSON.stringify(data.borderShadow)));
  layerShapeParams.set(newId, JSON.parse(JSON.stringify(data.shapeParams)));
  layerCameraParams.set(newId, JSON.parse(JSON.stringify(data.cameraParams)));
  layerMotionBlur.set(newId, data.motionBlur);

  if (data.mediaNaturalRatio && typeof mediaNaturalRatioMap !== 'undefined') {
    mediaNaturalRatioMap.set(newId, data.mediaNaturalRatio);
  }

  if (data.videoSeq && typeof videoFrameSequenceMap !== 'undefined') {
    videoFrameSequenceMap.set(newId, data.videoSeq);
    videoFrameSequenceMap.set(newName, data.videoSeq);
  }

  if (data.category === 'group' && data.sourceGroupId) {
    cloneGroupData(data.sourceGroupId, newId, newName);
  }

  bindTrackEvents(row);
  setTimeout(function() { row.classList.remove('adding'); }, 300);
  syncThreeLayers();
  applyFillToMeshGlobal(newId);
  selectTrack(row);
  calculateMaxDuration();
  triggerAutoSave();
}

function closeLayerContextMenu() {
  var popup = document.getElementById('layerOptionsPopup');
  if (!popup) return;
  popup.classList.remove('active');
  popup.style.display = 'none';
  popup.style.pointerEvents = 'none';
  popup.style.visibility = 'hidden';
  popup.style.left = '-9999px';
  popup.style.top = '-9999px';
  popup.querySelectorAll('.pop-menu-item, button, .color-tag-btn').forEach(function(el) {
    el.style.pointerEvents = 'none';
  });
}

function openLayerContextMenu(e, targetRow) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  var popup = document.getElementById('layerOptionsPopup');
  if (!popup) return;

  var allItems = popup.querySelectorAll('.pop-menu-item');
  var allDividers = popup.querySelectorAll('.pop-menu-divider');
  var colorSection = document.getElementById('popMenuColorSection');

  if (targetRow) {
    selectTrack(targetRow);

    allItems.forEach(function(item) {
      item.style.display = 'block';
      item.style.opacity = '1';
      item.style.pointerEvents = 'auto';
    });
    allDividers.forEach(function(div) { div.style.display = 'block'; });
    if (colorSection) {
      colorSection.style.display = 'flex';
      colorSection.classList.remove('hidden');
    }

    var pasteBtn = document.getElementById('popMenuPasteBtn');
    if (pasteBtn) {
      pasteBtn.style.opacity = clipboardLayerData ? '1' : '0.45';
      pasteBtn.style.pointerEvents = clipboardLayerData ? 'auto' : 'none';
    }
  } else {
    allItems.forEach(function(item) {
      var act = item.dataset.action;
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
        item.style.pointerEvents = 'none';
      }
    });
    allDividers.forEach(function(div) { div.style.display = 'none'; });
    if (colorSection) {
      colorSection.style.display = 'none';
      colorSection.classList.add('hidden');
    }
  }

  popup.style.display = 'flex';
  popup.style.pointerEvents = 'auto';
  popup.style.visibility = 'visible';
  popup.classList.add('active');

  var mouseX = (e && e.clientX !== undefined) ? e.clientX : 100;
  var mouseY = (e && e.clientY !== undefined) ? e.clientY : 100;

  var popupW = 195;
  var popupH = targetRow ? 295 : 105;

  var left = Math.max(10, Math.min(window.innerWidth - popupW - 12, mouseX));
  var top = Math.max(10, Math.min(window.innerHeight - popupH - 12, mouseY));

  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

function handleLayerColorTag(color) {
  if (!selectedTrackRow) return;
  if (typeof pushUndoState === 'function') {
    pushUndoState();
  }
  var row = selectedTrackRow;
  row.dataset.tagColor = color;

  var clip = row.querySelector('.track-clip');
  if (clip) {
    if (color === 'none' || !color) {
      clip.style.borderLeft = '';
    } else {
      clip.style.borderLeft = '5px solid ' + color;
    }
  }

  document.querySelectorAll('.color-tag-btn').forEach(function(btn) {
    btn.classList.toggle('selected', btn.dataset.color === color);
  });

  triggerAutoSave();
}

function initLayerOptionsPopup() {
  var popup = document.getElementById('layerOptionsPopup');
  if (!popup) return;

  popup.addEventListener('click', function(e) {
    e.stopPropagation();
    var item = e.target.closest('.pop-menu-item');
    var colorBtn = e.target.closest('.color-tag-btn');

    if (item) {
      var action = item.dataset.action;
      closeLayerContextMenu();
      handleLayerOptionAction(action);
    } else if (colorBtn) {
      var color = colorBtn.dataset.color;
      closeLayerContextMenu();
      handleLayerColorTag(color);
    }
  });

  window.addEventListener('keydown', function(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName) || (document.activeElement && document.activeElement.isContentEditable)) {
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
        var btnDeleteBatch = document.getElementById('btnDeleteSelectedBatch');
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
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (typeof selectAllLayers === 'function') {
        selectAllLayers();
      }
    }
  });
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
    var a = layerAudioMap.get(layerId);
    if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
    layerAudioMap.delete(layerId);
  }
  var m = meshLayerMap.get(layerId);
  if (m) {
    scene3D.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
    meshLayerMap.delete(layerId);
  }

  if (layerId.startsWith('group_') || (typeof layerGroupData !== 'undefined' && layerGroupData.has(layerId))) {
    var remainingTracks = Array.from(document.querySelectorAll('.track-row[data-layer-id="' + layerId + '"], .track-row[data-source-group-id="' + layerId + '"]')).filter(function(r) { return !r.classList.contains('deleting') && r.dataset.layerId !== layerId; });
    if (remainingTracks.length === 0) {
      if (typeof layerGroupData !== 'undefined') {
        layerGroupData.delete(layerId);
      }
      if (typeof renderMediaLibraryTab === 'function' && typeof currentMediaTabFilter !== 'undefined' && currentMediaTabFilter === 'composition') {
        renderMediaLibraryTab('composition');
      }
    }
  }
}

function deleteSelectedTrack() {
  if (!selectedTrackRow) return;
  var rowToDelete = selectedTrackRow;
  var layerId = rowToDelete.dataset.layerId;
  deselectTrack();

  var nextSib = rowToDelete.nextSibling;
  rowToDelete.classList.add('deleting');

  setTimeout(function() {
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

window.handleLayerOptionAction = handleLayerOptionAction;
window.copySelectedLayer = copySelectedLayer;
window.duplicateSelectedLayer = duplicateSelectedLayer;
window.pasteLayerFromClipboard = pasteLayerFromClipboard;
window.closeLayerContextMenu = closeLayerContextMenu;
window.openLayerContextMenu = openLayerContextMenu;
window.handleLayerColorTag = handleLayerColorTag;
window.initLayerOptionsPopup = initLayerOptionsPopup;
window.cleanupDeletedLayerData = cleanupDeletedLayerData;
window.deleteSelectedTrack = deleteSelectedTrack;
