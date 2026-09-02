function captureProjectSnapshot() {
  var tracks = [];
  document.querySelectorAll('.track-row').forEach(function(row) {
    var clip = row.querySelector('.track-clip');
    var clipName = row.querySelector('.track-clip-name');
    var eyeBtn = row.querySelector('.track-eye');
    var isHidden = eyeBtn && eyeBtn.querySelector('.material-symbols-rounded') && eyeBtn.querySelector('.material-symbols-rounded').textContent.trim() === 'visibility_off';

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
      dataset: Object.assign({}, row.dataset)
    });
  });

  return {
    tracks: tracks,
    transforms: Array.from(layerTransforms.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }),
    keyframes: Array.from(layerKeyframes.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }),
    fills: Array.from(layerFills.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }),
    borderShadows: Array.from(layerBorderShadow.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }),
    shapeParams: Array.from(layerShapeParams.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }),
    cameraParams: Array.from(layerCameraParams.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }),
    texts: (typeof layerTexts !== 'undefined') ? Array.from(layerTexts.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }) : [],
    effects: (typeof layerEffects !== 'undefined') ? Array.from(layerEffects.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }) : [],
    layerGroupData: (typeof layerGroupData !== 'undefined') ? Array.from(layerGroupData.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }) : [],
    expressions: Array.from(layerExpressions.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }),
    textAnimators: Array.from(layerTextAnimators.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; }),
    motionBlurs: Array.from(layerMotionBlur.entries()),
    markers: markers.slice(),
    isGlobalMotionBlurEnabled: isGlobalMotionBlurEnabled,
    projectMotionBlurTune: projectMotionBlurTune,
    projectMotionBlurSamples: projectMotionBlurSamples,
    selectedLayerId: selectedTrackRow ? selectedTrackRow.dataset.layerId : null,
    isMultiSelectMode: !!isMultiSelectMode,
    selectedMultiRowIds: Array.from(selectedMultiRows).map(function(r) { return r.dataset.layerId; }).filter(Boolean)
  };
}

function restoreProjectSnapshot(snapshot) {
  if (!snapshot) return;

  layerTransforms.clear();
  if (snapshot.transforms) {
    snapshot.transforms.forEach(function(entry) { layerTransforms.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
  }

  layerKeyframes.clear();
  if (snapshot.keyframes) {
    snapshot.keyframes.forEach(function(entry) { layerKeyframes.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
  }

  layerFills.clear();
  if (snapshot.fills) {
    snapshot.fills.forEach(function(entry) { layerFills.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
  }

  layerBorderShadow.clear();
  if (snapshot.borderShadows) {
    snapshot.borderShadows.forEach(function(entry) { layerBorderShadow.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
  }

  layerShapeParams.clear();
  if (snapshot.shapeParams) {
    snapshot.shapeParams.forEach(function(entry) { layerShapeParams.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
  }

  layerCameraParams.clear();
  if (snapshot.cameraParams) {
    snapshot.cameraParams.forEach(function(entry) { layerCameraParams.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
  }

  if (typeof layerTexts !== 'undefined') {
    layerTexts.clear();
    if (snapshot.texts) {
      snapshot.texts.forEach(function(entry) { layerTexts.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    }
  }

  if (typeof layerEffects !== 'undefined') {
    layerEffects.clear();
    if (snapshot.effects) {
      snapshot.effects.forEach(function(entry) { layerEffects.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    }
  }

  if (typeof layerGroupData !== 'undefined') {
    layerGroupData.clear();
    if (snapshot.layerGroupData) {
      snapshot.layerGroupData.forEach(function(entry) { layerGroupData.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    }
  }

  layerExpressions.clear();
  if (snapshot.expressions) {
    snapshot.expressions.forEach(function(entry) { layerExpressions.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
  }

  layerTextAnimators.clear();
  if (snapshot.textAnimators) {
    snapshot.textAnimators.forEach(function(entry) { layerTextAnimators.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
  }

  layerMotionBlur.clear();
  if (snapshot.motionBlurs) {
    snapshot.motionBlurs.forEach(function(entry) { layerMotionBlur.set(entry[0], entry[1]); });
  }

  if (snapshot.markers) {
    markers = snapshot.markers.slice();
  }

  if (snapshot.isGlobalMotionBlurEnabled !== undefined) {
    isGlobalMotionBlurEnabled = snapshot.isGlobalMotionBlurEnabled;
    var btnD = document.getElementById('btnToggleGlobalMotionBlurDesktop');
    var btnM = document.getElementById('btnToggleGlobalMotionBlurMobile');
    if (btnD) btnD.classList.toggle('active', isGlobalMotionBlurEnabled);
    if (btnM) btnM.classList.toggle('active', isGlobalMotionBlurEnabled);
  }

  if (snapshot.projectMotionBlurTune !== undefined) {
    projectMotionBlurTune = snapshot.projectMotionBlurTune;
  }
  if (snapshot.projectMotionBlurSamples !== undefined) {
    projectMotionBlurSamples = snapshot.projectMotionBlurSamples;
  }

  var container = document.getElementById('trackRowsContainer');
  if (container && snapshot.tracks) {
    var currentRows = Array.from(container.querySelectorAll('.track-row'));
    var currentIds = currentRows.map(function(r) { return r.dataset.layerId; });
    var snapIds = snapshot.tracks.map(function(t) { return t.layerId; });

    var idsMatch = (currentIds.length === snapIds.length) && currentIds.every(function(id, idx) { return id === snapIds[idx]; });

    if (idsMatch) {
      snapshot.tracks.forEach(function(tr, i) {
        var row = currentRows[i];
        row.dataset.tagColor = tr.colorTag || 'none';
        row.dataset.isMask = tr.isMask ? 'true' : 'false';
        row.classList.toggle('is-mask-layer', !!tr.isMask);
        row.classList.toggle('linked-parent', !!tr.isLinked);

        var clip = row.querySelector('.track-clip');
        if (clip) {
          clip.style.width = tr.width + 'px';
          clip.style.marginLeft = tr.marginLeft + 'px';
          if (tr.colorTag && tr.colorTag !== 'none') {
            clip.style.borderLeft = '5px solid ' + tr.colorTag;
          } else {
            clip.style.borderLeft = '';
          }
        }
        var nameEl = row.querySelector('.track-clip-name');
        if (nameEl && tr.name) nameEl.textContent = tr.name;

        var eye = row.querySelector('.track-eye .material-symbols-rounded');
        if (eye && !isMultiSelectMode) {
          var isAudio = tr.category === 'audio';
          eye.textContent = tr.isHidden ? (isAudio ? 'volume_off' : 'visibility_off') : (isAudio ? 'volume_up' : 'visibility');
        }
        var tw = row.querySelector('.track-trackway');
        if (tw) {
          tw.style.transform = 'translateX(-' + timelineOffset + 'px)';
          tw.style.opacity = tr.isHidden ? '0.35' : '1';
        }
      });
    } else {
      container.innerHTML = '';
      snapshot.tracks.forEach(function(tr) {
        var row = document.createElement('div');
        row.className = 'track-row' + (tr.isLinked ? ' linked-parent' : '') + (tr.isMask ? ' is-mask-layer' : '');
        row.dataset.layerId = tr.layerId;
        row.dataset.category = tr.category || 'media';
        row.dataset.tagColor = tr.colorTag || 'none';
        if (tr.dataset) {
          Object.keys(tr.dataset).forEach(function(k) { row.dataset[k] = tr.dataset[k]; });
        }
        if (tr.linkedTo && tr.linkedTo.length > 0) row.dataset.linkedTo = JSON.stringify(tr.linkedTo);
        if (tr.parentBind) row.dataset.parentBind = JSON.stringify(tr.parentBind);
        if (tr.linkedFrom && tr.linkedFrom.length > 0) row.dataset.linkedFrom = JSON.stringify(tr.linkedFrom);

        var isMulti = isMultiSelectMode;
        var tagStyle = (tr.colorTag && tr.colorTag !== 'none') ? 'border-left: 5px solid ' + tr.colorTag + ';' : '';
        var isAudio = tr.category === 'audio';
        var defaultEye = isAudio ? 'volume_up' : 'visibility';
        var hiddenEye = isAudio ? 'volume_off' : 'visibility_off';

        row.innerHTML = '<button class="track-eye" title="Toggle Visibility / Tahan untuk Multi-Select"><span class="material-symbols-rounded">' + (isMulti ? 'radio_button_unchecked' : (tr.isHidden ? hiddenEye : defaultEye)) + '</span></button><div class="track-trackway" style="transform: translateX(-' + timelineOffset + 'px);' + (tr.isHidden ? ' opacity: 0.35;' : '') + '"><div class="track-clip" style="width: ' + tr.width + 'px; margin-left: ' + tr.marginLeft + 'px; ' + tagStyle + '" title="Klik untuk pilih / buka menu layer"><div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div><span class="track-clip-name">' + tr.name + '</span><div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div></div></div><button class="track-reorder-handle" title="Tahan &amp; geser untuk atur urutan layer (Reorder)"><span class="material-symbols-rounded">menu</span></button>';
        bindTrackEvents(row);
        container.appendChild(row);
      });
    }
  }

  if (snapshot.isMultiSelectMode) {
    if (!isMultiSelectMode) {
      isMultiSelectMode = true;
      document.body.classList.add('multi-select-mode');
    }
    selectedMultiRows.clear();
    document.querySelectorAll('.track-row').forEach(function(r) {
      r.classList.remove('multi-selected');
      var eye = r.querySelector('.track-eye .material-symbols-rounded');
      if (eye) eye.textContent = 'radio_button_unchecked';
    });
    if (snapshot.selectedMultiRowIds) {
      snapshot.selectedMultiRowIds.forEach(function(id) {
        var r = document.querySelector('.track-row[data-layer-id="' + id + '"]');
        if (r) {
          selectedMultiRows.add(r);
          r.classList.add('multi-selected');
          var eye = r.querySelector('.track-eye .material-symbols-rounded');
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
      var rowToSelect = document.querySelector('.track-row[data-layer-id="' + snapshot.selectedLayerId + '"]');
      if (rowToSelect && rowToSelect !== selectedTrackRow) {
        selectTrack(rowToSelect);
      }
    } else if (selectedTrackRow) {
      deselectTrack();
    }
  }

  syncThreeLayers();
  layerFills.forEach(function(val, fid) {
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

function beginUndoGroup(name) {
  name = name || 'Operation';
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
  var hasUndo = (undoStack.length > 0);
  var hasRedo = (redoStack.length > 0);

  var undoSelectors = ['[title="Undo"]', '#btnUndoDesktop', '#btnUndoMobile', '.undo-btn'];
  undoSelectors.forEach(function(sel) {
    document.querySelectorAll(sel).forEach(function(btn) {
      btn.disabled = !hasUndo;
      btn.style.opacity = hasUndo ? '1.0' : '0.4';
      btn.style.pointerEvents = hasUndo ? 'auto' : 'none';
      btn.classList.toggle('disabled', !hasUndo);
    });
  });

  var redoSelectors = ['[title="Redo"]', '#btnRedoDesktop', '#btnRedoMobile', '.redo-btn'];
  redoSelectors.forEach(function(sel) {
    document.querySelectorAll(sel).forEach(function(btn) {
      btn.disabled = !hasRedo;
      btn.style.opacity = hasRedo ? '1.0' : '0.4';
      btn.style.pointerEvents = hasRedo ? 'auto' : 'none';
      btn.classList.toggle('disabled', !hasRedo);
    });
  });
}

function undo() {
  if (undoStack.length === 0) return;
  var current = captureProjectSnapshot();
  redoStack.push(current);
  if (redoStack.length > 60) redoStack.shift();

  var prev = undoStack.pop();
  restoreProjectSnapshot(prev);
  updateUndoRedoUI();
}

function redo() {
  if (redoStack.length === 0) return;
  var current = captureProjectSnapshot();
  undoStack.push(current);
  if (undoStack.length > 60) undoStack.shift();

  var next = redoStack.pop();
  restoreProjectSnapshot(next);
  updateUndoRedoUI();
}

window.captureProjectSnapshot = captureProjectSnapshot;
window.restoreProjectSnapshot = restoreProjectSnapshot;
window.beginUndoGroup = beginUndoGroup;
window.endUndoGroup = endUndoGroup;
window.executeWithUndoGroup = executeWithUndoGroup;
window.pushUndoState = pushUndoState;
window.recordAction = recordAction;
window.updateUndoRedoUI = updateUndoRedoUI;
window.undo = undo;
window.redo = redo;
