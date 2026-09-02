const GLOBAL_MEDIA_STORAGE_KEY = 'fishTool_globalMediaLibrary';
let _globalMediaMemoryCache = null;
let _globalMediaDbInitPromise = null;

function initGlobalMediaLibrary() {
    if (_globalMediaMemoryCache !== null && _globalMediaDbInitPromise) return _globalMediaDbInitPromise;
    if (_globalMediaMemoryCache === null) _globalMediaMemoryCache = [];
    try {
      const stored = localStorage.getItem(GLOBAL_MEDIA_STORAGE_KEY);
      if (stored) _globalMediaMemoryCache = JSON.parse(stored);
    } catch (e) {}
    _globalMediaDbInitPromise = new Promise((resolve) => {
      getMediaDB().then((db) => {
        if (!db) { resolve(); return; }
        try {
          const tx = db.transaction('media_items', 'readonly');
          const store = tx.objectStore('media_items');
          const req = store.getAll();
          req.onsuccess = async () => {
            if (req.result && req.result.length > 0) {
              const idbItems = req.result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
              idbItems.forEach(item => {
                if (item.blob && (item.blob instanceof Blob || item.blob.size)) {
                  item.url = URL.createObjectURL(item.blob);
                }
                const existingIdx = _globalMediaMemoryCache.findIndex(m => m.id === item.id || m.name === item.name);
                if (existingIdx >= 0) {
                  _globalMediaMemoryCache[existingIdx] = { ..._globalMediaMemoryCache[existingIdx], ...item };
                } else {
                  _globalMediaMemoryCache.push(item);
                }
              });
              if (typeof syncAllMediaGrids === 'function') syncAllMediaGrids();
              await loadAllVideoPackagesFromIDB();
              document.querySelectorAll('.track-row').forEach(row => {
                const id = row.dataset.layerId;
                if (id) {
                  const fill = getLayerFill(id);
                  if (fill && fill.type === 'media') {
                    const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
                    const match = _globalMediaMemoryCache.find(m => m.url === fill.mediaUrl || m.id === fill.mediaUrl || (clipName && m.name === clipName));
                    if (match && match.url && fill.mediaUrl !== match.url) {
                      fill.mediaUrl = match.url;
                      applyFillToMeshGlobal(id);
                      applyTransformToThreeMesh(id, getLayerTransform(id));
                    }
                  }
                }
              });
              if (typeof layerGroupData !== 'undefined') {
                for (const [gId, gd] of layerGroupData.entries()) {
                  if (!gd || !gd.fills) continue;
                  let groupChanged = false;
                  gd.fills.forEach(([cid, fill]) => {
                    if (fill && fill.type === 'media') {
                      const match = _globalMediaMemoryCache.find(m => m.url === fill.mediaUrl || m.id === fill.mediaUrl);
                      if (match && match.url) {
                        fill.mediaUrl = match.url;
                        groupChanged = true;
                      }
                    }
                  });
                  if (groupChanged && typeof invalidateGroupCache === 'function') {
                    invalidateGroupCache(gId);
                  }
                }
              }
            }
            resolve();
          };
          req.onerror = () => resolve();
        } catch (err) {
          console.warn('IndexedDB load error', err);
          resolve();
        }
      });
    });

    window.initGlobalMediaLibraryPromise = _globalMediaDbInitPromise;
    return _globalMediaDbInitPromise;
}

initGlobalMediaLibrary();

  function getGlobalMediaLibrary() {
    if (_globalMediaMemoryCache === null) {
      initGlobalMediaLibrary();
    }
    return _globalMediaMemoryCache || [];
  }

  function saveGlobalMediaLibrary(list) {
    _globalMediaMemoryCache = list || [];
    getMediaDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction('media_items', 'readwrite');
        const store = tx.objectStore('media_items');
        store.clear();
        (list || []).forEach(item => {
          store.put(item);
        });
      } catch (err) {
        console.warn('Failed saving to IndexedDB', err);
      }
    });
    try {
      const seen = new Set();
      const cleanList = [];
      (list || []).forEach(item => {
        if (item && item.id && !seen.has(item.name || item.id)) {
          seen.add(item.name || item.id);
          cleanList.push(item);
        }
      });
      const lightList = cleanList.slice(0, 16).map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        createdAt: item.createdAt,
        thumbnailUrl: item.thumbnailUrl || '',
        url: (item.url && item.url.startsWith('data:') && item.url.length < 300000) ? item.url : (item.url || '')
      }));
      localStorage.setItem(GLOBAL_MEDIA_STORAGE_KEY, JSON.stringify(lightList));
    } catch (e) {
    }
  }

  function addGlobalMedia(dataUrlOrBlob, name, type, fileBlob) {
    const list = getGlobalMediaLibrary();
    const isBlob = (dataUrlOrBlob instanceof Blob) || (fileBlob instanceof Blob);
    const blobObj = isBlob ? (fileBlob || dataUrlOrBlob) : null;
    const liveUrl = (typeof dataUrlOrBlob === 'string') ? dataUrlOrBlob : (blobObj ? URL.createObjectURL(blobObj) : '');

    const existingIdx = list.findIndex(m => (m.name === name) || (m.url === liveUrl && liveUrl !== ''));
    if (existingIdx >= 0) {
      const item = list.splice(existingIdx, 1)[0];
      item.url = liveUrl || item.url;
      if (blobObj) item.blob = blobObj;
      list.unshift(item);
      saveGlobalMediaLibrary(list);
      syncAllMediaGrids();
      return item;
    }

    const newItem = {
      id: 'media_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      url: liveUrl,
      blob: blobObj,
      name: name || ('Media_' + (list.length + 1)),
      type: type || 'image',
      createdAt: Date.now()
    };
    list.unshift(newItem);
    saveGlobalMediaLibrary(list);
    syncAllMediaGrids();
    return newItem;
  }

  function removeGlobalMedia(mediaId) {
    const list = getGlobalMediaLibrary();
    const removedItem = list.find(m => m.id === mediaId || m.name === mediaId);
    const updatedList = list.filter(m => m.id !== mediaId && m.name !== mediaId);
    saveGlobalMediaLibrary(updatedList);
    syncAllMediaGrids();
    getMediaDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction('video_packages', 'readwrite');
        tx.objectStore('video_packages').delete(mediaId);
      } catch(_) {}
    });

    if (removedItem) {
      const removedUrl = removedItem.url;
      const removedName = removedItem.name;
      const rows = Array.from(document.querySelectorAll('.track-row'));
      rows.forEach(row => {
        const id = row.dataset.layerId;
        const fill = id ? getLayerFill(id) : null;
        const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';

        const isMatch = (
          (fill && fill.type === 'media' && (fill.mediaUrl === mediaId || fill.mediaUrl === removedUrl)) ||
          (clipName && (clipName === removedName || clipName === mediaId)) ||
          (row.dataset.mediaId === mediaId)
        );

        if (isMatch && id) {
          const mesh = meshLayerMap.get(id);
          if (mesh && scene3D) {
            scene3D.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
            meshLayerMap.delete(id);
          }
          const audio = layerAudioMap.get(id);
          if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            layerAudioMap.delete(id);
          }
          layerFills.delete(id);
          layerTransforms.delete(id);
          layerKeyframes.delete(id);
          layerMotionBlur.delete(id);
          layerFrameTextureMap.delete(id);
          layerLastRenderedFrameIndex.delete(id);
          videoFrameSequenceMap.delete(mediaId);
          if (removedUrl) videoFrameSequenceMap.delete(removedUrl);
          if (removedName) videoFrameSequenceMap.delete(removedName);
          row.remove();
        }
      });

      if (selectedTrackRow && !document.contains(selectedTrackRow)) {
        selectedTrackRow = null;
        renderCanvasOverlay();
      }

      calculateMaxDuration();
      rebuildTimeRuler(totalDuration);
      syncThreeLayers();
      render3D();
      triggerAutoSave();
    }
  }

  function syncAllMediaGrids() {
    const mediaList = getGlobalMediaLibrary();
    const mediaGrid = document.getElementById('uploadedMediaGrid');
    if (mediaGrid) {
      mediaGrid.innerHTML = `
        <button type="button" id="btnUploadMedia" class="media-upload-tile-btn" title="Upload Media">
          <span class="material-symbols-rounded">add</span>
        </button>
      `;
      const btnUpload = mediaGrid.querySelector('#btnUploadMedia');
      const inputFillMedia = document.getElementById('inputFillMedia');
      if (btnUpload && inputFillMedia) {
        btnUpload.addEventListener('click', (e) => {
          e.stopPropagation();
          inputFillMedia.value = '';
          inputFillMedia.click();
        });
      }

      if (mediaList && mediaList.length > 0) {
        mediaList.forEach(item => {
          const thumb = createMediaThumbnailElement(item, (mediaItem) => {
            if (selectedTrackRow) {
              const id = selectedTrackRow.dataset.layerId || 'default';
              const fill = getLayerFill(id);
              fill.type = 'media';
              fill.mediaUrl = mediaItem.url || (typeof resolveMediaUrl === 'function' ? resolveMediaUrl(mediaItem.id) : '') || mediaItem.id;
              fill.mediaId = mediaItem.id;
              fill.mediaName = mediaItem.name;
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
          });
          mediaGrid.appendChild(thumb);
        });
      }
    }
    const popover = document.getElementById('addTrackPopover');
    const activeTab = document.querySelector('#popoverCategoryTabs .cat-tab-btn.active');
    if (popover && popover.classList.contains('active') && activeTab && activeTab.dataset.cat === 'media') {
      renderCategoryItems('media');
    }
  }

  function promptDeleteMedia(mediaItem, anchorEl) {
    if (window.FishPopover) {
      window.FishPopover.confirmDelete({
        anchorElement: anchorEl,
        onConfirm: () => {
          removeGlobalMedia(mediaItem.id);
        }
      });
    }
  }

  function createMediaThumbnailElement(item, onClick) {
    const btn = document.createElement('div');
    btn.className = 'media-thumb-item';
    btn.dataset.itemId = item.id;
    btn.title = item.isConverting ? `Sedang memproses ${item.name}...` : `${item.name}\n(Klik untuk gunakan, Tahan lama / Klik Kanan untuk hapus)`;

    if (item.isConverting) {
      btn.style.cssText = 'position:relative; width:80px; height:80px; min-width:80px; border-radius:12px; background:#22130c; border:1px solid rgba(255,242,194,0.25); overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:wait; box-sizing:border-box;';
      btn.innerHTML = `
        <div class="media-thumb-progress-fill" style="position:absolute; top:0; left:0; bottom:0; width:${item.progress || 0}%; background:#D06423; opacity:0.65; transition:width 0.15s ease-out;"></div>
        <div style="position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none;">
          <span class="media-thumb-pct" style="font-size:14px; font-weight:700; color:#FFF2C2;">${item.progress || 0}%</span>
        </div>
      `;
      return btn;
    }

    const isVideo = (item.type && item.type.startsWith('video')) || (item.name && /\.(mp4|webm|mov|mkv)$/i.test(item.name));
    if (isVideo) {
      if (item.thumbnailUrl || (item.url && item.url.startsWith('data:image/'))) {
        const img = document.createElement('img');
        img.src = item.thumbnailUrl || item.url;
        img.alt = item.name;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '12px';
        btn.appendChild(img);
      } else {
        const vid = document.createElement('video');
        vid.src = item.url;
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'metadata';
        vid.style.width = '100%';
        vid.style.height = '100%';
        vid.style.objectFit = 'cover';
        vid.style.borderRadius = '12px';
        btn.appendChild(vid);
      }

      const playBadge = document.createElement('div');
      playBadge.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.3); pointer-events:none; border-radius:12px;';
      playBadge.innerHTML = '<span class="material-symbols-rounded" style="font-size:22px; color:#FFF2C2;">play_circle</span>';
      btn.appendChild(playBadge);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;
      btn.appendChild(img);
    }
    const delBadge = document.createElement('button');
    delBadge.type = 'button';
    delBadge.className = 'media-del-badge';
    delBadge.title = 'Hapus Media';
    delBadge.innerHTML = '<span class="material-symbols-rounded" style="font-size:14px;">close</span>';
    delBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      removeGlobalMedia(item.id);
    });
    btn.appendChild(delBadge);
    let pressTimer = null;
    let isLongPress = false;

    const startPress = (e) => {
      isLongPress = false;
      btn.classList.add('holding-delete');
      pressTimer = setTimeout(() => {
        isLongPress = true;
        btn.classList.remove('holding-delete');
        if (navigator.vibrate) navigator.vibrate(35);
        promptDeleteMedia(item, btn);
      }, 450);
    };

    const cancelPress = () => {
      clearTimeout(pressTimer);
      btn.classList.remove('holding-delete');
    };

    btn.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        cancelPress();
        promptDeleteMedia(item, btn);
        return;
      }
      startPress(e);
    });

    btn.addEventListener('touchstart', startPress, { passive: true });
    btn.addEventListener('touchend', cancelPress);
    btn.addEventListener('touchmove', cancelPress);
    btn.addEventListener('mouseup', cancelPress);
    btn.addEventListener('mouseleave', cancelPress);

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelPress();
      promptDeleteMedia(item, btn);
    });

    btn.addEventListener('click', (e) => {
      if (isLongPress) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (onClick) onClick(item);
    });

    return btn;
  }

async function saveVideoPackageToIDB(pkg) {
  const db = await getMediaDB();
  if (!db || !pkg) return;
  const pkgId = pkg.id || ('video_pkg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
  pkg.id = pkgId;
  try {
    const tx = db.transaction('video_packages', 'readwrite');
    const store = tx.objectStore('video_packages');
    store.put({
      id: pkgId,
      name: pkg.name || 'Video Clip',
      manifest: {
        fps: pkg.fps || 30,
        width: pkg.width || 1280,
        height: pkg.height || 720,
        duration: pkg.duration || 5,
        totalFrames: pkg.totalFrames || (pkg.frames ? pkg.frames.length : 0),
        aspectRatio: pkg.aspectRatio || 1.7778,
        createdAt: Date.now()
      },
      frames: (pkg.frameBlobs && pkg.frameBlobs.length > 0) ? pkg.frameBlobs : (pkg.frames || []),
      audioBlob: pkg.audioBlob || null
    });
  } catch (e) {
    console.warn('Failed saving video package to IDB', e);
  }
}

async function loadAllVideoPackagesFromIDB() {
  const db = await getMediaDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('video_packages', 'readonly');
      const store = tx.objectStore('video_packages');
      const req = store.getAll();
      req.onsuccess = async () => {
        const pkgs = req.result || [];
        if (typeof FishLoading !== 'undefined' && typeof FishLoading.log === 'function') {
          FishLoading.log(`[IDB] Ditemukan ${pkgs.length} paket video tersimpan.`, 'info');
        }
        await Promise.all(pkgs.map(async (pkg) => {
          if (!pkg || !pkg.id) return;
          if (pkg.audioBlob) {
            pkg.audioUrl = URL.createObjectURL(pkg.audioBlob);
          }
          if (pkg.frames && pkg.frames.length > 0) {
            if (typeof FishLoading !== 'undefined' && typeof FishLoading.log === 'function') {
              FishLoading.log(`[IDB] Memuat ${pkg.frames.length} frame tersimpan: ${pkg.name || pkg.id}...`, 'info');
            }
            const loadedFrames = [];
            const BATCH_SIZE = 24;
            for (let i = 0; i < pkg.frames.length; i += BATCH_SIZE) {
              const chunk = pkg.frames.slice(i, i + BATCH_SIZE);
              const decodedChunk = await Promise.all(
                chunk.map(async (f) => {
                  if (typeof ImageBitmap !== 'undefined' && f instanceof ImageBitmap) {
                    return f;
                  }
                  if (f instanceof Blob) {
                    try {
                      return await createImageBitmap(f);
                    } catch(_) {
                      return null;
                    }
                  }
                  return f;
                })
              );
              decodedChunk.forEach(b => { if (b) loadedFrames.push(b); });
              if (typeof FishLoading !== 'undefined' && typeof FishLoading.update === 'function') {
                const decPct = 35 + Math.round((loadedFrames.length / pkg.frames.length) * 8);
                FishLoading.update(decPct, `Membaca frame database (${loadedFrames.length}/${pkg.frames.length})...`);
              }
              await new Promise(r => setTimeout(r, 0));
            }

            if (loadedFrames.length > 0) {
              const seq = {
                fps: pkg.manifest?.fps || 30,
                duration: pkg.manifest?.duration || 5,
                aspectRatio: pkg.manifest?.aspectRatio || 1.7778,
                frames: loadedFrames,
                width: pkg.manifest?.width || 1280,
                height: pkg.manifest?.height || 720,
                totalFrames: loadedFrames.length,
                audioUrl: pkg.audioUrl,
                isReady: true
              };
              videoFrameSequenceMap.set(pkg.id, seq);
              if (pkg.name) videoFrameSequenceMap.set(pkg.name, seq);
              if (typeof FishLoading !== 'undefined' && typeof FishLoading.log === 'function') {
                FishLoading.log(`[IDB] ${loadedFrames.length} frame siap instan tanpa ekstrak ulang!`, 'success');
              }
            }
          } else if (pkg.audioBlob) {
            if (typeof convertVideoToFrameSequence === 'function') {
              try {
                if (typeof FishLoading !== 'undefined' && typeof FishLoading.log === 'function') {
                  FishLoading.log(`[IDB] Frame belum tersimpan, mengekstrak: ${pkg.name || pkg.id}`, 'info');
                }
                const seq = await convertVideoToFrameSequence(pkg.audioBlob);
                videoFrameSequenceMap.set(pkg.id, seq);
                if (pkg.name) videoFrameSequenceMap.set(pkg.name, seq);
                saveVideoPackageToIDB(seq);
              } catch(_) {}
            }
          }
        }));
        resolve();
      };
      req.onerror = () => resolve();
    } catch (e) {
      console.warn('Error loading video packages from IDB:', e);
      resolve();
    }
  });
}

function initTrackRows() {
  const loaded = loadSavedProject();
  if (!loaded) {
    document.querySelectorAll('.track-row').forEach((row, idx) => {
      if (!row.dataset.layerId) {
        row.dataset.layerId = 'layer_' + (idx + 1);
      }
      bindTrackEvents(row);
    });
    renderAllKeyframeMarkers();
  }
  saveCurrentProject();
}

function bindTrackEvents(row) {
  if (!row) return;
  if (row._eventsBound) return;
  row._eventsBound = true;

  if (!row.dataset.layerId) {
    const existing = document.querySelectorAll('.track-row');
    const idx = Array.from(existing).indexOf(row);
    row.dataset.layerId = 'layer_' + (idx >= 0 ? idx + 1 : Date.now());
  }

  if (row.dataset.tagColor && row.dataset.tagColor !== 'none') {
    const clip = row.querySelector('.track-clip');
    if (clip) clip.style.borderLeft = `5px solid ${row.dataset.tagColor}`;
  }

  renderKeyframeMarkersOnClip(row);

  const eyeBtn = row.querySelector('.track-eye');
  if (eyeBtn) {
    let eyeLongPressTimer = null;
    let isLongPressTriggered = false;
    let startX = 0;
    let startY = 0;
    let hasSwiped = false;

    const onEyePointerDown = (e) => {
      e.stopPropagation();
      isLongPressTriggered = false;
      hasSwiped = false;
      const pt = (e.touches && e.touches[0]) || e;
      startX = pt.clientX;
      startY = pt.clientY;

      if (!isMultiSelectMode) {
        eyeLongPressTimer = setTimeout(() => {
          isLongPressTriggered = true;
          enterMultiSelectMode(row);
          if (navigator.vibrate) navigator.vibrate(25);
        }, 220);
      }

      const onEyePointerMove = (me) => {
        const mpt = (me.touches && me.touches[0]) || me;
        const curX = mpt.clientX;
        const curY = mpt.clientY;
        const dist = Math.hypot(curX - startX, curY - startY);

        if (dist > 8) {
          if (!isMultiSelectMode && !isLongPressTriggered) {
            clearTimeout(eyeLongPressTimer);
            isLongPressTriggered = true;
            enterMultiSelectMode(row);
          }

          hasSwiped = true;
          const el = document.elementFromPoint(curX, curY);
          if (el) {
            const targetRow = el.closest('.track-row');
            if (targetRow && !selectedMultiRows.has(targetRow)) {
              selectedMultiRows.add(targetRow);
              targetRow.classList.add('multi-selected');
              const eye = targetRow.querySelector('.track-eye .material-symbols-rounded');
              if (eye) {
                eye.textContent = 'check';
                eye.style.color = '#082618';
              }
              if (navigator.vibrate) navigator.vibrate(12);
              updateMultiSelectUI();
            }
          }
        }
      };

      const onEyePointerUp = () => {
        clearTimeout(eyeLongPressTimer);
        window.removeEventListener('mousemove', onEyePointerMove);
        window.removeEventListener('mouseup', onEyePointerUp);
        window.removeEventListener('touchmove', onEyePointerMove);
        window.removeEventListener('touchend', onEyePointerUp);

        if (!hasSwiped && !isLongPressTriggered) {
          if (isMultiSelectMode) {
            toggleRowMultiSelect(row);
          } else {
            toggleEye(eyeBtn, true);
          }
        }
      };

      window.addEventListener('mousemove', onEyePointerMove);
      window.addEventListener('mouseup', onEyePointerUp);
      window.addEventListener('touchmove', onEyePointerMove, { passive: false });
      window.addEventListener('touchend', onEyePointerUp);
    };

    eyeBtn.addEventListener('mousedown', onEyePointerDown);
    eyeBtn.addEventListener('touchstart', onEyePointerDown, { passive: false });
  }

  const handle = row.querySelector('.track-reorder-handle');
  if (handle) {
    initTrackReorder(row, handle);
  }

  const clip = row.querySelector('.track-clip');
  if (clip) {
    let longPressTimer = null;
    let isHolding = false;
    let didScrub = false;
    let startX = 0;
    let startY = 0;
    let startMargin = 0;
    let startOffset = 0;
    let startScrollTop = 0;

    const onPointerDown = (e) => {
      if (e.target.closest('.clip-extend-handle') || e.target.closest('.clip-keyframe-marker') || e.target.closest('.clip-keyframes-container')) return;

      e.stopPropagation();
      const viewport = document.getElementById('tracksViewport');
      const pointerX = e.pageX || (e.touches && e.touches[0].pageX) || 0;
      const pointerY = e.pageY || (e.touches && e.touches[0].pageY) || 0;
      startX = pointerX;
      startY = pointerY;
      startMargin = parseFloat(clip.style.marginLeft) || 0;
      startOffset = timelineOffset;
      startScrollTop = viewport ? viewport.scrollTop : 0;
      isHolding = false;
      didScrub = false;

      longPressTimer = setTimeout(() => {
        isHolding = true;
        clip.classList.add('clip-holding');
        if (navigator.vibrate) navigator.vibrate(20);
      }, 220);

      const onPointerMove = (me) => {
        const curX = me.pageX || (me.touches && me.touches[0].pageX) || 0;
        const curY = me.pageY || (me.touches && me.touches[0].pageY) || 0;
        const dx = curX - startX;
        const dy = curY - startY;

        if (!isHolding) {
          if (Math.abs(dx) > 3 || (!selectedTrackRow && Math.abs(dy) > 3)) {
            clearTimeout(longPressTimer);
            didScrub = true;
          }
          if (didScrub) {
            me.preventDefault();
            setTimelineOffset(startOffset - dx);
            if (viewport && !selectedTrackRow) {
              viewport.scrollTop = startScrollTop - dy;
            }
          }
          return;
        }

        me.preventDefault();
        const newMargin = Math.max(0, startMargin + dx);
        clip.style.marginLeft = `${newMargin}px`;
        renderKeyframeMarkersOnClip(row);
        render3D();
        if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
      };

      const onPointerUp = () => {
        clearTimeout(longPressTimer);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);

        if (isHolding) {
          isHolding = false;
          clip.classList.remove('clip-holding');
          const finalMargin = parseFloat(clip.style.marginLeft) || 0;
          if (Math.abs(finalMargin - startMargin) > 2) {
            recordAction({
              type: 'MOVE_CLIP',
              clip: clip,
              oldMargin: startMargin,
              newMargin: finalMargin
            });
            calculateMaxDuration();
          }
          renderKeyframeMarkersOnClip(row);
          render3D();
          if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
        } else if (!didScrub) {
          if (isMultiSelectMode) {
            toggleRowMultiSelect(row);
          } else {
            selectTrack(row);
          }
        }
      };

      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    };

    clip.addEventListener('mousedown', onPointerDown);
    clip.addEventListener('touchstart', onPointerDown, { passive: false });

    const handleLeft = row.querySelector('.clip-extend-handle.handle-left');
    const handleRight = row.querySelector('.clip-extend-handle.handle-right');

    if (handleLeft) {
      const onLeftHandleDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const pointerX = e.pageX || (e.touches && e.touches[0].pageX) || 0;
        const startX = pointerX;
        const startMargin = parseFloat(clip.style.marginLeft) || 0;
        const startWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
        const startEnd = startMargin + startWidth;

        const startMediaOffset = parseFloat(row.dataset.mediaOffset || 0) || 0;
        const onLeftMove = (me) => {
          const curX = me.pageX || (me.touches && me.touches[0].pageX) || 0;
          const dx = curX - startX;
          const newMargin = Math.max(0, Math.min(startEnd - 20, startMargin + dx));
          const newWidth = startEnd - newMargin;
          clip.style.marginLeft = `${newMargin}px`;
          clip.style.width = `${newWidth}px`;
          const deltaSec = (newMargin - startMargin) / PX_PER_SEC;
          const updatedOffset = Math.max(0, startMediaOffset + deltaSec);
          row.dataset.mediaOffset = String(updatedOffset);
          const fill = (typeof getLayerFill === 'function') ? getLayerFill(row.dataset.layerId) : null;
          if (fill) fill.mediaOffset = updatedOffset;
          renderKeyframeMarkersOnClip(row);
          render3D();
          if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
        };

        const onLeftUp = () => {
          window.removeEventListener('mousemove', onLeftMove);
          window.removeEventListener('mouseup', onLeftUp);
          window.removeEventListener('touchmove', onLeftMove);
          window.removeEventListener('touchend', onLeftUp);

          const finalMargin = parseFloat(clip.style.marginLeft) || 0;
          const finalWidth = parseFloat(clip.style.width) || 300;
          const deltaSec = (finalMargin - startMargin) / PX_PER_SEC;
          const finalOffset = Math.max(0, startMediaOffset + deltaSec);
          row.dataset.mediaOffset = String(finalOffset);
          const fill = (typeof getLayerFill === 'function') ? getLayerFill(row.dataset.layerId) : null;
          if (fill) fill.mediaOffset = finalOffset;

          if (Math.abs(finalMargin - startMargin) > 2) {
            recordAction({
              type: 'TRIM_CLIP',
              clip: clip,
              oldMargin: startMargin,
              oldWidth: startWidth,
              newMargin: finalMargin,
              newWidth: finalWidth
            });
            calculateMaxDuration();
            updateInspectorQuickButtons();
          }
          renderKeyframeMarkersOnClip(row);
          render3D();
          if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
        };

        window.addEventListener('mousemove', onLeftMove);
        window.addEventListener('mouseup', onLeftUp);
        window.addEventListener('touchmove', onLeftMove, { passive: false });
        window.addEventListener('touchend', onLeftUp);
      };

      handleLeft.addEventListener('mousedown', onLeftHandleDown);
      handleLeft.addEventListener('touchstart', onLeftHandleDown, { passive: false });
    }

    if (handleRight) {
      const onRightHandleDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (typeof playing !== 'undefined' && playing && typeof pausePlayback === 'function') {
          pausePlayback();
        }
        const pointerX = e.pageX || (e.touches && e.touches[0].pageX) || 0;
        const startX = pointerX;
        const startMargin = parseFloat(clip.style.marginLeft) || 0;
        const startWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;

        const layerId = row.dataset.layerId;
        const fill = (typeof getLayerFill === 'function') ? getLayerFill(layerId) : null;
        const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
        const seq = (typeof videoFrameSequenceMap !== 'undefined') ? (videoFrameSequenceMap.get(fill?.mediaUrl) || videoFrameSequenceMap.get(layerId) || (clipName && videoFrameSequenceMap.get(clipName))) : null;
        const maxVideoDurationSec = (seq && seq.duration) ? seq.duration : null;
        const currentMediaOffset = parseFloat(row.dataset.mediaOffset || 0) || 0;
        const maxAllowedWidth = maxVideoDurationSec ? Math.max(20, (maxVideoDurationSec - currentMediaOffset) * (typeof PX_PER_SEC !== 'undefined' ? PX_PER_SEC : 100)) : Infinity;

        const onRightMove = (me) => {
          const curX = me.pageX || (me.touches && me.touches[0].pageX) || 0;
          const dx = curX - startX;
          const newWidth = Math.max(20, Math.min(maxAllowedWidth, startWidth + dx));
          clip.style.width = `${newWidth}px`;
          renderKeyframeMarkersOnClip(row);
          render3D();
          if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
        };

        const onRightUp = () => {
          window.removeEventListener('mousemove', onRightMove);
          window.removeEventListener('mouseup', onRightUp);
          window.removeEventListener('touchmove', onRightMove);
          window.removeEventListener('touchend', onRightUp);

          const finalWidth = parseFloat(clip.style.width) || 300;
          if (Math.abs(finalWidth - startWidth) > 2) {
            recordAction({
              type: 'TRIM_CLIP',
              clip: clip,
              oldMargin: startMargin,
              oldWidth: startWidth,
              newMargin: startMargin,
              newWidth: finalWidth
            });
            calculateMaxDuration();
            updateInspectorQuickButtons();
          }
          renderKeyframeMarkersOnClip(row);
          render3D();
          if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
        };

        window.addEventListener('mousemove', onRightMove);
        window.addEventListener('mouseup', onRightUp);
        window.addEventListener('touchmove', onRightMove, { passive: false });
        window.addEventListener('touchend', onRightUp);
      };

      handleRight.addEventListener('mousedown', onRightHandleDown);
      handleRight.addEventListener('touchstart', onRightHandleDown, { passive: false });
    }
  }

  row.addEventListener('contextmenu', (e) => {
    openLayerContextMenu(e, row);
  });
}

let currentMediaTabFilter = 'foto';

var CATEGORY_ITEMS = {
  shape: [],
  media: [],
  camera: [
    { icon: 'videocam', name: 'Camera', filename: 'Camera_1', sub: 'Camera Layer', cat: 'camera' },
    { icon: 'crop_free', name: 'Null', filename: 'Null_1', sub: 'Null Object', cat: 'null' }
  ],
  text: [
    { icon: 'title', name: 'Judul Utama', filename: 'Heading_Title.txt', sub: 'Text Header' },
    { icon: 'subtitles', name: 'Subtitle Caption', filename: 'Subtitle_Text.txt', sub: 'Text Caption' },
    { icon: 'label', name: 'Badge Callout', filename: 'Badge_Callout.txt', sub: 'Text Pill' }
  ]
};
