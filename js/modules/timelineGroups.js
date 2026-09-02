function executeGroupSelectedLayers() {
  if (selectedMultiRows.size === 0) return;
  var rows = Array.from(selectedMultiRows);
  var container = document.getElementById('trackRowsContainer');
  if (!container) return;

  var allRows = Array.from(container.querySelectorAll('.track-row'));
  rows.sort(function(a, b) { return allRows.indexOf(a) - allRows.indexOf(b); });

  beginUndoGroup('Group Layers');
  try {
    var minMargin = Infinity;
    var maxEnd = -Infinity;

    rows.forEach(function(r) {
      var clip = r.querySelector('.track-clip');
      var m = clip ? (parseFloat(clip.style.marginLeft) || 0) : 0;
      var w = clip ? (parseFloat(clip.style.width) || clip.offsetWidth || 300) : 300;
      if (m < minMargin) minMargin = m;
      if (m + w > maxEnd) maxEnd = m + w;
    });

    if (minMargin === Infinity) minMargin = 0;
    if (maxEnd <= minMargin) maxEnd = minMargin + 300;

    var groupWidth = maxEnd - minMargin;
    var groupMargin = minMargin;

    var groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    var groupNum = 1;
    document.querySelectorAll('.track-row[data-category="group"]').forEach(function() { groupNum++; });
    var groupName = 'Group ' + groupNum;

    var groupLayers = [];
    var transforms = [];
    var keyframes = [];
    var fills = [];
    var borderShadows = [];
    var shapeParams = [];
    var cameraParams = [];
    var texts = [];
    var effects = [];
    var motionBlurs = [];

    rows.forEach(function(r) {
      var id = r.dataset.layerId;
      var clip = r.querySelector('.track-clip');
      var clipNameEl = r.querySelector('.track-clip-name');
      var clipName = clipNameEl ? clipNameEl.textContent.trim() : 'Layer';
      var m = clip ? (parseFloat(clip.style.marginLeft) || 0) : 0;
      var w = clip ? (parseFloat(clip.style.width) || clip.offsetWidth || 300) : 300;
      var eye = r.querySelector('.track-eye .material-symbols-rounded');
      var isHidden = eye && (eye.textContent.trim() === 'visibility_off' || eye.textContent.trim() === 'volume_off');

      var relativeMargin = Math.max(0, m - minMargin);

      groupLayers.push({
        layerId: id,
        category: r.dataset.category || 'media',
        shapeType: r.dataset.shapeType || '',
        name: clipName,
        tagColor: r.dataset.tagColor || 'none',
        marginLeft: relativeMargin,
        width: w,
        isHidden: !!isHidden,
        dataset: Object.assign({}, r.dataset)
      });

      var t = (typeof getLayerTransform === 'function') ? getLayerTransform(id) : (layerTransforms.get(id) || null);
      if (t) transforms.push([id, JSON.parse(JSON.stringify(t))]);

      var minMarginSec = minMargin / (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 50);
      if (layerKeyframes.has(id)) {
        var rawKfs = layerKeyframes.get(id) || [];
        var shiftedKfs = rawKfs.map(function(k) {
          return Object.assign({}, k, { time: Math.max(0, Math.round((k.time - minMarginSec) * 1000) / 1000) });
        });
        keyframes.push([id, JSON.parse(JSON.stringify(shiftedKfs))]);
        layerKeyframes.set(id, shiftedKfs);
      }

      var f = (typeof getLayerFill === 'function') ? getLayerFill(id) : (layerFills.get(id) || null);
      if (f) {
        var clonedF = JSON.parse(JSON.stringify(f));
        if (clonedF.type === 'media' && clonedF.mediaUrl) {
          var list = (typeof getGlobalMediaLibrary === 'function') ? getGlobalMediaLibrary() : [];
          var match = list.find(function(mi) { return mi.url === clonedF.mediaUrl || mi.id === clonedF.mediaUrl; });
          if (match && match.id) {
            clonedF.mediaUrl = match.id;
          }
        }
        fills.push([id, clonedF]);
      }

      var b = (typeof getLayerBorderShadow === 'function') ? getLayerBorderShadow(id) : (layerBorderShadow.get(id) || null);
      if (b) borderShadows.push([id, JSON.parse(JSON.stringify(b))]);

      var sp = (typeof getLayerShapeParams === 'function') ? getLayerShapeParams(id, r.dataset.shapeType || 'square') : (layerShapeParams.get(id) || null);
      if (sp) shapeParams.push([id, JSON.parse(JSON.stringify(sp))]);

      if (layerCameraParams.has(id)) cameraParams.push([id, JSON.parse(JSON.stringify(layerCameraParams.get(id)))]);
      if (layerTexts.has(id)) texts.push([id, JSON.parse(JSON.stringify(layerTexts.get(id)))]);
      if (typeof layerEffects !== 'undefined' && layerEffects.has(id)) effects.push([id, JSON.parse(JSON.stringify(layerEffects.get(id)))]);
      if (layerMotionBlur.has(id)) motionBlurs.push([id, layerMotionBlur.get(id)]);
    });

    var groupData = {
      id: groupId,
      name: groupName,
      layers: groupLayers,
      transforms: transforms,
      keyframes: keyframes,
      fills: fills,
      borderShadows: borderShadows,
      shapeParams: shapeParams,
      cameraParams: cameraParams,
      texts: texts,
      effects: effects,
      motionBlurs: motionBlurs,
      resolution: '1080p',
      fps: projectFps || '30',
      backgroundColor: 'transparent'
    };

    layerGroupData.set(groupId, groupData);

    var insertRef = rows[0];

    rows.forEach(function(r) {
      var lid = r.dataset.layerId;
      r.remove();
      var mesh = meshLayerMap.get(lid);
      if (mesh && scene3D) scene3D.remove(mesh);
      meshLayerMap.delete(lid);
    });

    var groupRow = document.createElement('div');
    groupRow.className = 'track-row adding';
    groupRow.dataset.category = 'group';
    groupRow.dataset.layerId = groupId;

    groupRow.innerHTML = '<button class="track-eye" title="Toggle Visibility / Tahan untuk Multi-Select"><span class="material-symbols-rounded">visibility</span></button><div class="track-trackway" style="transform: translateX(-' + timelineOffset + 'px);"><div class="track-clip" style="width: ' + groupWidth + 'px; margin-left: ' + groupMargin + 'px;" title="Klik untuk pilih Group / Buka Inspector"><div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div><span class="track-clip-name">' + groupName + '</span><div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div></div></div><button class="track-reorder-handle" title="Tahan &amp; geser untuk atur urutan layer (Reorder)"><span class="material-symbols-rounded">menu</span></button>';

    if (insertRef && insertRef.parentNode === container) {
      container.insertBefore(groupRow, insertRef);
    } else {
      container.insertBefore(groupRow, container.firstChild);
    }

    layerTransforms.set(groupId, {
      posX: 0, posY: 0, posZ: 0,
      rotX: 0, rotY: 0, rotZ: 0,
      scaleW: 100, scaleH: 100,
      opacity: 100,
      blendMode: 'normal',
      isLinked: true
    });
    layerKeyframes.set(groupId, []);
    layerFills.set(groupId, { type: 'color', color: '#FAB778' });
    layerBorderShadow.set(groupId, {
      stroke: { enabled: false, color: '#FAB778', width: 0, align: 'center', alpha: 100 },
      shadow: { enabled: false, color: '#000000', size: 0, alpha: 0, posX: 0, posY: 0 }
    });

    bindTrackEvents(groupRow);
    setTimeout(function() { groupRow.classList.remove('adding'); }, 280);

    exitMultiSelectMode();
    syncThreeLayers();
    applyFillToMeshGlobal(groupId);
    selectTrack(groupRow);
    calculateMaxDuration();
    render3D();
    triggerAutoSave();
  } finally {
    endUndoGroup();
  }
}

function enterGroupContext(groupId) {
  if (!groupId) return;
  var groupData = layerGroupData.get(groupId);
  if (!groupData) return;

  deselectTrack();

  var currentSnapshot = captureProjectSnapshot();
  var currentTitleEl = document.getElementById('activeTitle');
  var parentName = activeGroupContext ? activeGroupContext.groupName : ((currentTitleEl && currentTitleEl.textContent.trim()) || 'My Project');

  groupNavigationStack.push({
    groupId: activeGroupContext ? activeGroupContext.groupId : null,
    snapshot: currentSnapshot,
    title: parentName
  });

  activeGroupContext = {
    groupId: groupId,
    groupName: groupData.name || 'Group'
  };

  var btnBack = document.getElementById('btnBack');
  var projectTitleGroup = document.getElementById('projectTitleGroup');
  var breadcrumbNav = document.getElementById('groupBreadcrumbNav');
  var parentNameLabel = document.getElementById('groupParentProjectName');
  var groupNavTitle = document.getElementById('groupNavTitle');
  var btnExport = document.getElementById('btnExport');
  var btnProjectSettings = document.getElementById('btnProjectSettings');
  var btnGroupSettings = document.getElementById('btnGroupSettings');

  if (btnBack) btnBack.style.display = 'none';
  if (projectTitleGroup) projectTitleGroup.style.display = 'none';
  if (btnExport) btnExport.style.display = 'none';
  if (btnProjectSettings) btnProjectSettings.style.display = 'none';

  if (breadcrumbNav) breadcrumbNav.style.display = 'flex';
  if (parentNameLabel) parentNameLabel.textContent = parentName;
  if (groupNavTitle) groupNavTitle.textContent = groupData.name || 'Group';
  if (btnGroupSettings) btnGroupSettings.style.display = 'inline-flex';

  var container = document.getElementById('trackRowsContainer');
  if (container) {
    container.innerHTML = '';

    if (groupData.transforms) groupData.transforms.forEach(function(entry) { layerTransforms.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    if (groupData.keyframes) groupData.keyframes.forEach(function(entry) { layerKeyframes.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    if (groupData.fills) groupData.fills.forEach(function(entry) { layerFills.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    if (groupData.borderShadows) groupData.borderShadows.forEach(function(entry) { layerBorderShadow.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    if (groupData.shapeParams) groupData.shapeParams.forEach(function(entry) { layerShapeParams.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    if (groupData.cameraParams) groupData.cameraParams.forEach(function(entry) { layerCameraParams.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    if (groupData.texts) groupData.texts.forEach(function(entry) {
      layerTexts.set(entry[0], JSON.parse(JSON.stringify(entry[1])));
      if (entry[1] && entry[1].font) loadGoogleFont(entry[1].font);
    });
    if (typeof layerEffects !== 'undefined' && groupData.effects) {
      groupData.effects.forEach(function(entry) { layerEffects.set(entry[0], JSON.parse(JSON.stringify(entry[1]))); });
    }
    if (groupData.motionBlurs) groupData.motionBlurs.forEach(function(entry) { layerMotionBlur.set(entry[0], entry[1]); });

    (groupData.layers || []).forEach(function(tr) {
      var row = document.createElement('div');
      row.className = 'track-row';
      row.dataset.category = tr.category || 'media';
      row.dataset.layerId = tr.layerId;
      if (tr.shapeType) row.dataset.shapeType = tr.shapeType;
      if (tr.tagColor) row.dataset.tagColor = tr.tagColor;
      if (tr.dataset) Object.keys(tr.dataset).forEach(function(k) { row.dataset[k] = tr.dataset[k]; });

      var isAudio = (tr.category === 'audio');
      var defaultEye = isAudio ? (tr.isHidden ? 'volume_off' : 'volume_up') : (tr.isHidden ? 'visibility_off' : 'visibility');
      var tagStyle = (tr.tagColor && tr.tagColor !== 'none') ? 'border-left: 5px solid ' + tr.tagColor + ';' : '';

      row.innerHTML = '<button class="track-eye" title="' + (isAudio ? 'Mute / Unmute' : 'Toggle Visibility') + '"><span class="material-symbols-rounded">' + defaultEye + '</span></button><div class="track-trackway" style="transform: translateX(-' + timelineOffset + 'px);' + (tr.isHidden ? ' opacity: 0.35;' : '') + '"><div class="track-clip" style="width: ' + tr.width + 'px; margin-left: ' + tr.marginLeft + 'px; ' + tagStyle + '" title="Klik untuk pilih / buka menu layer"><div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div><span class="track-clip-name">' + tr.name + '</span><div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div></div></div><button class="track-reorder-handle" title="Tahan &amp; geser untuk atur urutan layer (Reorder)"><span class="material-symbols-rounded">menu</span></button>';

      bindTrackEvents(row);
      container.appendChild(row);
    });
  }

  syncThreeLayers();
  (groupData.layers || []).forEach(function(tr) {
    if (tr.layerId) {
      applyFillToMeshGlobal(tr.layerId);
      applyTransformToThreeMesh(tr.layerId, getLayerTransform(tr.layerId));
    }
  });
  calculateMaxDuration();
  render3D();
  renderCanvasOverlay();
}

function saveActiveGroupState() {
  if (!activeGroupContext || !activeGroupContext.groupId) return;
  var groupId = activeGroupContext.groupId;
  var gd = layerGroupData.get(groupId);
  if (!gd) return;

  var currentSnap = captureProjectSnapshot();
  gd.name = activeGroupContext.groupName || gd.name;
  gd.layers = currentSnap.tracks || [];
  gd.transforms = currentSnap.transforms || [];
  gd.keyframes = currentSnap.keyframes || [];
  gd.fills = currentSnap.fills || [];
  gd.borderShadows = currentSnap.borderShadows || [];
  gd.shapeParams = currentSnap.shapeParams || [];
  gd.cameraParams = currentSnap.cameraParams || [];
  gd.texts = Array.from(layerTexts.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; });
  if (typeof layerEffects !== 'undefined') {
    gd.effects = Array.from(layerEffects.entries()).map(function(entry) { return [entry[0], JSON.parse(JSON.stringify(entry[1]))]; });
  }
  gd.motionBlurs = currentSnap.motionBlurs || [];
}

function exitGroupContext() {
  if (groupNavigationStack.length === 0) return;
  deselectTrack();

  saveActiveGroupState();
  var exitingGroupId = activeGroupContext ? activeGroupContext.groupId : null;
  var exitingGd = exitingGroupId ? JSON.parse(JSON.stringify(layerGroupData.get(exitingGroupId) || null)) : null;

  var parentContext = groupNavigationStack.pop();
  activeGroupContext = parentContext.groupId ? { groupId: parentContext.groupId, groupName: parentContext.title } : null;

  if (!activeGroupContext) {
    var btnBack = document.getElementById('btnBack');
    var projectTitleGroup = document.getElementById('projectTitleGroup');
    var breadcrumbNav = document.getElementById('groupBreadcrumbNav');
    var btnExport = document.getElementById('btnExport');
    var btnProjectSettings = document.getElementById('btnProjectSettings');
    var btnGroupSettings = document.getElementById('btnGroupSettings');

    if (breadcrumbNav) breadcrumbNav.style.display = 'none';
    if (btnGroupSettings) btnGroupSettings.style.display = 'none';

    if (btnBack) btnBack.style.display = 'inline-flex';
    if (projectTitleGroup) projectTitleGroup.style.display = 'inline-flex';
    if (btnExport) btnExport.style.display = 'flex';
    if (btnProjectSettings) btnProjectSettings.style.display = 'inline-flex';
  } else {
    var parentNameLabel = document.getElementById('groupParentProjectName');
    var groupNavTitle = document.getElementById('groupNavTitle');
    if (parentNameLabel) parentNameLabel.textContent = parentContext.title || 'My Project';
    if (groupNavTitle) groupNavTitle.textContent = activeGroupContext.groupName || 'Group';
  }

  if (parentContext.snapshot && exitingGroupId && exitingGd) {
    if (!parentContext.snapshot.layerGroupData) parentContext.snapshot.layerGroupData = [];
    var idx = parentContext.snapshot.layerGroupData.findIndex(function(entry) { return entry[0] === exitingGroupId; });
    if (idx >= 0) {
      parentContext.snapshot.layerGroupData[idx] = [exitingGroupId, exitingGd];
    } else {
      parentContext.snapshot.layerGroupData.push([exitingGroupId, exitingGd]);
    }
  }

  restoreProjectSnapshot(parentContext.snapshot);

  if (exitingGroupId && exitingGd) {
    layerGroupData.set(exitingGroupId, exitingGd);
  }

  if (typeof invalidateGroupCache === 'function' && exitingGroupId) {
    invalidateGroupCache(exitingGroupId);
  }

  syncThreeLayers();
  layerGroupData.forEach(function(val, gId) {
    applyFillToMeshGlobal(gId);
  });
  render3D();
  renderCanvasOverlay();
  triggerAutoSave();
}

function handleEditGroupClick(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  if (!selectedTrackRow) return;
  var id = selectedTrackRow.dataset.layerId;
  var cat = selectedTrackRow.dataset.category;
  if (id && (cat === 'group' || id.startsWith('group_') || (typeof layerGroupData !== 'undefined' && layerGroupData.has(id)))) {
    enterGroupContext(id);
  }
}

function initGroupControls() {
  var btnGroupParent = document.getElementById('btnGroupNavParent');
  if (btnGroupParent) {
    btnGroupParent.onclick = function(e) {
      e.stopPropagation();
      exitGroupContext();
    };
  }

  var groupNavTitle = document.getElementById('groupNavTitle');
  if (groupNavTitle) {
    groupNavTitle.oninput = function() {
      if (activeGroupContext) {
        var newName = groupNavTitle.textContent.trim() || 'Group';
        activeGroupContext.groupName = newName;
        var gd = layerGroupData.get(activeGroupContext.groupId);
        if (gd) gd.name = newName;

        if (activeGroupContext.parentLayersSnapshot) {
          activeGroupContext.parentLayersSnapshot.forEach(function(r) {
            if (r.layerId === activeGroupContext.groupId) r.clipName = newName;
          });
        }

        document.querySelectorAll('.track-row[data-layer-id="' + activeGroupContext.groupId + '"] .track-clip-name, .track-row[data-source-group-id="' + activeGroupContext.groupId + '"] .track-clip-name').forEach(function(el) {
          el.textContent = newName;
        });

        if (typeof renderMediaLibraryTab === 'function' && typeof currentMediaTabFilter !== 'undefined' && currentMediaTabFilter === 'composition') {
          renderMediaLibraryTab('composition');
        }
      }
    };
    groupNavTitle.onblur = function() {
      if (activeGroupContext && !groupNavTitle.textContent.trim()) {
        groupNavTitle.textContent = activeGroupContext.groupName || 'Group';
      }
      triggerAutoSave();
    };
    groupNavTitle.onkeydown = function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        groupNavTitle.blur();
      }
    };
  }

  var btnEditGroup = document.getElementById('btnInspEditGroup');
  if (btnEditGroup) {
    btnEditGroup.onclick = handleEditGroupClick;
  }

  initGroupSettingsModal();
}

function initGroupSettingsModal() {
  var modal = document.getElementById('groupSettingsModal');
  var btnTrigger = document.getElementById('btnGroupSettings');
  var btnClose = document.getElementById('btnGroupSettingsClose');
  var btnSave = document.getElementById('btnGroupSettingsSave');

  if (!modal) return;

  var tempResolution = '1080p';
  var tempFps = '30';
  var tempBgColor = 'transparent';

  var triggerRes = document.getElementById('triggerGroupResolution');
  var menuRes = document.getElementById('menuGroupResolution');
  var valRes = document.getElementById('valGroupResolution');

  var triggerFps = document.getElementById('triggerGroupFps');
  var menuFps = document.getElementById('menuGroupFps');
  var valFps = document.getElementById('valGroupFps');

  var triggerBg = document.getElementById('triggerGroupBackground');
  var menuBg = document.getElementById('menuGroupBackground');
  var valBg = document.getElementById('valGroupBackground');
  var bgSwatch = document.getElementById('groupBgSwatchBox');

  function openGroupSettings() {
    if (!activeGroupContext) return;
    var gd = layerGroupData.get(activeGroupContext.groupId);
    if (!gd) return;

    tempResolution = gd.resolution || '1080p';
    tempFps = gd.fps || projectFps || '30';
    tempBgColor = gd.backgroundColor || 'transparent';

    if (valRes) valRes.textContent = tempResolution.toUpperCase();
    if (valFps) valFps.textContent = tempFps + ' fps';
    if (valBg) valBg.textContent = (tempBgColor === 'transparent') ? 'Transparent' : (tempBgColor === '#000000' ? 'Black' : tempBgColor);
    if (bgSwatch) {
      if (tempBgColor === 'transparent') {
        bgSwatch.style.background = 'repeating-conic-gradient(#808080 0% 25%, #ffffff 0% 50%) 50% / 8px 8px';
      } else {
        bgSwatch.style.background = tempBgColor;
      }
    }

    modal.style.display = 'flex';
  }
  window.openGroupSettingsModal = openGroupSettings;

  function closeGroupSettings() {
    modal.style.display = 'none';
    if (menuRes) menuRes.classList.remove('open');
    if (menuFps) menuFps.classList.remove('open');
    if (menuBg) menuBg.classList.remove('open');
  }

  if (btnTrigger) {
    btnTrigger.addEventListener('click', function(e) {
      e.stopPropagation();
      openGroupSettings();
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', function(e) {
      e.stopPropagation();
      closeGroupSettings();
    });
  }

  if (triggerRes && menuRes) {
    triggerRes.addEventListener('click', function(e) {
      e.stopPropagation();
      menuRes.classList.toggle('open');
      if (menuFps) menuFps.classList.remove('open');
      if (menuBg) menuBg.classList.remove('open');
    });
    menuRes.querySelectorAll('.am-dropdown-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        tempResolution = item.dataset.value;
        if (valRes) valRes.textContent = item.textContent.trim();
        menuRes.classList.remove('open');
      });
    });
  }

  if (triggerFps && menuFps) {
    triggerFps.addEventListener('click', function(e) {
      e.stopPropagation();
      menuFps.classList.toggle('open');
      if (menuRes) menuRes.classList.remove('open');
      if (menuBg) menuBg.classList.remove('open');
    });
    menuFps.querySelectorAll('.am-dropdown-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        tempFps = item.dataset.value;
        if (valFps) valFps.textContent = item.textContent.trim();
        menuFps.classList.remove('open');
      });
    });
  }

  if (triggerBg && menuBg) {
    triggerBg.addEventListener('click', function(e) {
      e.stopPropagation();
      menuBg.classList.toggle('open');
      if (menuRes) menuRes.classList.remove('open');
      if (menuFps) menuFps.classList.remove('open');
    });
    menuBg.querySelectorAll('.am-dropdown-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        tempBgColor = item.dataset.value;
        var lastSpan = item.querySelector('span:last-child');
        if (valBg) valBg.textContent = lastSpan ? lastSpan.textContent : item.textContent.trim();
        if (bgSwatch) {
          if (tempBgColor === 'transparent') {
            bgSwatch.style.background = 'repeating-conic-gradient(#808080 0% 25%, #ffffff 0% 50%) 50% / 8px 8px';
          } else {
            bgSwatch.style.background = tempBgColor;
          }
        }
        menuBg.classList.remove('open');
      });
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', function(e) {
      e.stopPropagation();
      if (activeGroupContext) {
        var gd = layerGroupData.get(activeGroupContext.groupId);
        if (gd) {
          gd.resolution = tempResolution;
          gd.fps = tempFps;
          gd.backgroundColor = tempBgColor;
        }
      }
      closeGroupSettings();
      render3D();
      triggerAutoSave();
    });
  }
}

window.executeGroupSelectedLayers = executeGroupSelectedLayers;
window.enterGroupContext = enterGroupContext;
window.saveActiveGroupState = saveActiveGroupState;
window.exitGroupContext = exitGroupContext;
window.handleEditGroupClick = handleEditGroupClick;
window.initGroupControls = initGroupControls;
window.initGroupSettingsModal = initGroupSettingsModal;
