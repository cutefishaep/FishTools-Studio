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
      fills: Array.from(layerFills.entries()).map(([k, fill]) => {
        if (fill && fill.type === 'media') {
          const list = (typeof getGlobalMediaLibrary === 'function') ? getGlobalMediaLibrary() : [];
          const match = list.find(m => m.id === fill.mediaId || m.url === fill.mediaUrl || m.id === fill.mediaUrl);
          if (match && match.id) {
            return [k, { ...fill, mediaUrl: match.id, mediaId: match.id }];
          }
        }
        return [k, fill];
      }),
      borderShadows: Array.from(layerBorderShadow.entries()),
      shapeParams: Array.from(layerShapeParams.entries()),
      cameraParams: Array.from(layerCameraParams.entries()),
      effects: Array.from(layerEffects.entries()),
      groups: Array.from(layerGroupData.entries()).map(([k, gd]) => {
        if (!gd) return [k, gd];
        const clonedGd = JSON.parse(JSON.stringify(gd));
        if (clonedGd.fills && Array.isArray(clonedGd.fills)) {
          const list = (typeof getGlobalMediaLibrary === 'function') ? getGlobalMediaLibrary() : [];
          clonedGd.fills = clonedGd.fills.map(([cid, fill]) => {
            if (fill && fill.type === 'media' && fill.mediaUrl) {
              const match = list.find(m => m.url === fill.mediaUrl || m.id === fill.mediaUrl);
              if (match && match.id) {
                return [cid, { ...fill, mediaUrl: match.id }];
              }
            }
            return [cid, fill];
          });
        }
        return [k, clonedGd];
      }),
      motionBlurTune: projectMotionBlurTune,
      motionBlurSamples: projectMotionBlurSamples,
      globalMotionBlur: isGlobalMotionBlurEnabled,
      motionBlurs: Array.from(layerMotionBlur.entries()),
      createdAt: cfg.createdAt || new Date().toLocaleDateString(),
      updatedAt: new Date().toLocaleString()
    };
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
    try {
      let allProjects = [];
      const stored = localStorage.getItem('fishTool_savedProjects');
      if (stored) {
        try { allProjects = JSON.parse(stored); } catch(e) { allProjects = []; }
      }
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
    const urlParams = new URLSearchParams(window.location.search);
    const qId = urlParams.get('project');
    const pathMatch = window.location.pathname.match(/\/editor\/([^\/\?]+)/);
    const pId = pathMatch ? pathMatch[1] : null;
    const rawId = qId || pId || sessionStorage.getItem('activeProjectId');
    const rawName = sessionStorage.getItem('activeProject');
    const importedRaw = sessionStorage.getItem('importedProjectData');
    let proj = null;

    if (importedRaw) {
      try {
        proj = JSON.parse(importedRaw);
        sessionStorage.removeItem('importedProjectData');
      } catch (e) {
        console.warn('Error parsing importedProjectData', e);
      }
    }

    if (!proj && rawId) {
      const stored = localStorage.getItem('fishTool_savedProjects');
      if (stored) {
        try {
          const allProjects = JSON.parse(stored);
          proj = allProjects.find(p => (p.id && p.id === rawId) || (rawName && p.name === rawName));
        } catch (e) {}
      }
    }

    if (!proj) {
      const rawCfg = sessionStorage.getItem('projectConfig');
      if (rawCfg) {
        try { proj = JSON.parse(rawCfg); } catch(e) {}
      }
    }

    if (!proj) return false;

    if (window.FishLoading) window.FishLoading.update(28, 'Membaca track timeline & keyframe...');

    applyProjectConfig(proj);
    if (!proj.tracks || !Array.isArray(proj.tracks) || proj.tracks.length === 0) {
      return false;
    }

    const container = document.getElementById('trackRowsContainer');
    if (!container) return false;

    if (window.FishLoading) window.FishLoading.update(45, 'Menyusun konfigurasi layer & efek...');

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
    if (typeof getGlobalMediaLibrary === 'function') {
      const mediaLib = getGlobalMediaLibrary();
      layerFills.forEach((fill) => {
        if (fill && fill.type === 'media' && (!fill.mediaUrl || fill.mediaUrl === '[IDB_MEDIA]')) {
          const match = mediaLib.find(m => m.id === fill.mediaId || m.name === fill.mediaName);
          if (match) {
            fill.mediaUrl = match.url || match.id;
            if (match.id) fill.mediaId = match.id;
          }
        }
      });
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
    } else if (proj.tracks && Array.isArray(proj.tracks)) {
      proj.tracks.forEach(tr => {
        if (tr && tr.borderShadow) {
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

    layerTexts.clear();
    if (proj.texts && proj.texts.length) {
      proj.texts.forEach(([k, v]) => {
        layerTexts.set(k, v);
        if (v && v.font) loadGoogleFont(v.font);
      });
    }

    layerMotionBlur.clear();
    if (proj.motionBlurs && proj.motionBlurs.length) {
      proj.motionBlurs.forEach(([k, v]) => layerMotionBlur.set(k, v));
    }

    if (typeof layerEffects !== 'undefined') {
      layerEffects.clear();
      if (proj.effects && proj.effects.length) {
        proj.effects.forEach(([k, v]) => layerEffects.set(k, v));
      }
    }

    layerGroupData.clear();
    if (proj.groups && proj.groups.length) {
      proj.groups.forEach(([k, v]) => layerGroupData.set(k, v));
    }

    if (proj.markers && Array.isArray(proj.markers)) {
      markers = [...proj.markers];
    } else {
      markers = [];
    }

    proj.tracks.forEach(tr => {
      if (!tr) return;
      const row = document.createElement('div');
      row.className = 'track-row';
      row.dataset.category = tr.category || 'media';
      row.dataset.layerId = tr.layerId;
      row.dataset.tagColor = tr.colorTag || 'none';
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
        if (fill && fill.mediaUrl && !fill.mediaUrl.startsWith('video_pkg_') && !fill.mediaUrl.startsWith('pkg_')) {
          const resolvedAudio = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(fill.mediaUrl) : fill.mediaUrl;
          if (resolvedAudio && (resolvedAudio.startsWith('http://') || resolvedAudio.startsWith('https://') || resolvedAudio.startsWith('blob:') || resolvedAudio.startsWith('data:'))) {
            const audio = new Audio(resolvedAudio);
            audio.preload = 'auto';
            layerAudioMap.set(tr.layerId, audio);
          }
        }
      } else if (tr.category === 'video' || (layerFills.get(tr.layerId) && layerFills.get(tr.layerId).mediaUrl && (/\.(mp4|webm|mov|mkv|avi)$/i.test(tr.name || '') || /\.(mp4|webm|mov|mkv|avi)$/i.test(layerFills.get(tr.layerId).mediaUrl) || layerFills.get(tr.layerId).mediaUrl.startsWith('data:video/')))) {
       }
    });

    renderAllKeyframeMarkers();
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
        }
      }
    });
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
          img.src = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(fill.mediaUrl) : fill.mediaUrl;
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
    if (window.FishLoading) window.FishLoading.update(68, 'Menyiapkan 3D viewport & kamera...');
    syncThreeLayers();
    if (typeof rebuildTimeRuler === 'function') {
      rebuildTimeRuler(totalDuration);
    }
    render3D();
    return true;
  } catch (e) {
    console.warn('Could not load saved project', e);
    return false;
  }
}

function goBack() {
  if (typeof pausePlayback === 'function') pausePlayback();
  saveCurrentProject();
  window.location.href = 'index.html';
}

async function initPersistentStoragePrompt() {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) {
    return;
  }
  try {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) {
      console.log('✓ Storage is already persistent');
      return;
    }
    const dismissed = localStorage.getItem('fishTool_persistentPromptDismissed');
    if (dismissed) return;

    const modal = document.getElementById('persistentStorageModal');
    const btnEnable = document.getElementById('btnEnablePersistentStorage');
    const btnDismiss = document.getElementById('btnDismissPersistentStorage');
    const btnClose = document.getElementById('btnClosePersistentModal');

    if (!modal) return;

    setTimeout(() => {
      modal.style.display = 'flex';
    }, 1200);

    const closeModal = () => {
      modal.style.display = 'none';
    };

    if (btnEnable) {
      btnEnable.onclick = async () => {
        try {
          const granted = await navigator.storage.persist();
          if (granted) {
            console.log('✓ Persistent storage granted');
          } else {
            console.log('ℹ Persistent storage not granted, standard storage active');
          }
        } catch(e) {}
        closeModal();
      };
    }

    if (btnDismiss) {
      btnDismiss.onclick = () => {
        localStorage.setItem('fishTool_persistentPromptDismissed', '1');
        closeModal();
      };
    }

    if (btnClose) {
      btnClose.onclick = () => {
        closeModal();
      };
    }
  } catch (err) {
    console.warn('Persistent storage check failed', err);
  }
}
window.initPersistentStoragePrompt = initPersistentStoragePrompt;

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      initPersistentStoragePrompt();
    });
  } else {
    initPersistentStoragePrompt();
  }
}

