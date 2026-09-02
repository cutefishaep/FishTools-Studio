CATEGORY_ITEMS = {
  shape: [],
  media: [],
  camera: [
    { icon: 'videocam', name: 'Camera', filename: 'Camera_1', sub: 'Camera Layer', cat: 'camera' },
    { icon: 'crop_free', name: 'Null', filename: 'Null_1', sub: 'Null Object', cat: 'null' }
  ],
  text: [
    { icon: 'title', name: 'Judul Utama', filename: 'Heading_Title.txt', content: 'Judul Utama', font: 'Poppins', size: 52, bold: true },
    { icon: 'subtitles', name: 'Subtitle Caption', filename: 'Subtitle_Text.txt', content: 'Keterangan subtitle di sini...', font: 'Montserrat', size: 36, bold: false },
    { icon: 'label', name: 'Badge Callout', filename: 'Badge_Callout.txt', content: 'BADGE CALLOUT', font: 'Bebas Neue', size: 44, bold: true, uppercase: true }
  ]
};

function renderCategoryItems(catKey) {
  const grid = document.getElementById('popoverItemsGrid') || document.getElementById('popoverItemsShelf');
  if (!grid) return;

  const popover = document.getElementById('addTrackPopover');
  if (popover) {
    popover.classList.remove('cat-shape', 'cat-media', 'cat-camera', 'cat-text');
    popover.classList.add('cat-' + catKey);
  }

  grid.innerHTML = '';
  grid.className = 'popover-items-grid';

  if (catKey === 'shape') {
    grid.className = 'popover-items-grid shape-shelf-wrap';

    const track = document.createElement('div');
    track.className = 'shape-horizontal-track';

    SHAPE_PICKER_ITEMS.forEach(shape => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'shape-shelf-tile';
      tile.title = `Tambah ${shape.title || 'Bentuk'}`;
      tile.innerHTML = `
        <div class="shape-tile-preview">
          <span class="material-symbols-rounded">${shape.icon}</span>
        </div>
        <span class="shape-tile-title">${shape.title}</span>
      `;
      tile.addEventListener('click', (e) => {
        e.stopPropagation();
        addTrackWithType('shape', `${shape.title || 'Shape'}.svg`, null, shape.shapeType || shape.type || 'square');
        const popover = document.getElementById('addTrackPopover');
        const fab = document.getElementById('fabAddTrack');
        if (popover) popover.classList.remove('active');
        if (fab) fab.classList.remove('active');
      });
      track.appendChild(tile);
    });

    grid.appendChild(track);
    const dotsContainer = document.createElement('div');
    dotsContainer.className = 'shape-dots-indicator';

    function updateDots() {
      dotsContainer.innerHTML = '';
      const maxScroll = track.scrollWidth - track.clientWidth;
      if (maxScroll <= 8) {
        dotsContainer.style.display = 'none';
        return;
      }
      dotsContainer.style.display = 'flex';
      const numPages = Math.max(2, Math.ceil(track.scrollWidth / (track.clientWidth || 1)));
      const curPage = Math.min(numPages - 1, Math.max(0, Math.round((track.scrollLeft / maxScroll) * (numPages - 1))));

      for (let i = 0; i < numPages; i++) {
        const dot = document.createElement('span');
        dot.className = 'shape-dot' + (i === curPage ? ' active' : '');
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetLeft = (i / (numPages - 1)) * maxScroll;
          track.scrollTo({ left: targetLeft, behavior: 'smooth' });
        });
        dotsContainer.appendChild(dot);
      }
    }

    track.addEventListener('scroll', () => {
      const maxScroll = track.scrollWidth - track.clientWidth;
      if (maxScroll <= 8) return;
      const numPages = dotsContainer.children.length;
      if (numPages <= 1) return;
      const curPage = Math.min(numPages - 1, Math.max(0, Math.round((track.scrollLeft / maxScroll) * (numPages - 1))));
      Array.from(dotsContainer.children).forEach((dot, idx) => {
        dot.classList.toggle('active', idx === curPage);
      });
    });

    grid.appendChild(dotsContainer);
    setTimeout(updateDots, 60);

    return;
  }

  if (catKey === 'media') {
    grid.className = 'popover-items-grid media-shelf-grid';

    const allMedia = getGlobalMediaLibrary();
    let filteredList = [];
    let acceptTypes = 'image/*,video/*,audio/*';
    let emptyTitle = 'Media Masih Kosong';
    let emptySub = 'Klik Import atau drag & drop file ke sini untuk mengumpulkan media Anda';
    let emptyIcon = 'cloud_upload';

    if (currentMediaTabFilter === 'video') {
      filteredList = allMedia.filter(m => (m.type && m.type.startsWith('video')) || (m.name && /\.(mp4|webm|mov|mkv)$/i.test(m.name)));
      acceptTypes = 'video/*,.mp4,.webm,.mov,.mkv';
      emptyTitle = 'Media Video Masih Kosong';
      emptySub = 'Klik Import atau drag & drop file video (.mp4, .webm) ke sini';
      emptyIcon = 'movie';
    } else if (currentMediaTabFilter === 'audio') {
      filteredList = allMedia.filter(m => (m.type && m.type.startsWith('audio')) || (m.name && /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(m.name)));
      acceptTypes = 'audio/*,.mp3,.wav,.aac,.m4a,.ogg,.flac';
      emptyTitle = 'Media Audio Masih Kosong';
      emptySub = 'Klik Import atau drag & drop file musik (.mp3, .wav) ke sini';
      emptyIcon = 'audiotrack';
    } else if (currentMediaTabFilter === 'vector') {
      filteredList = allMedia.filter(m => (m.type === 'image/svg+xml') || (m.name && /\.svg$/i.test(m.name)));
      acceptTypes = '.svg,image/svg+xml';
      emptyTitle = 'Media Vektor Masih Kosong';
      emptySub = 'Klik Import atau drag & drop file grafis SVG (.svg) ke sini';
      emptyIcon = 'gesture';
    } else {
      filteredList = allMedia.filter(m => !(m.type && m.type.startsWith('audio')) && !(m.name && /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(m.name)) && !(m.type && m.type.startsWith('video')) && !(m.name && /\.(mp4|webm|mov|mkv)$/i.test(m.name)) && !(m.type === 'image/svg+xml') && !(m.name && /\.svg$/i.test(m.name)));
      acceptTypes = 'image/*,.png,.jpg,.jpeg,.gif,.webp';
      emptyTitle = 'Media Foto Masih Kosong';
      emptySub = 'Klik Import atau drag & drop file foto ke sini';
      emptyIcon = 'add_photo_alternate';
    }
    const headerStrip = document.createElement('div');
    headerStrip.className = 'media-pool-header-strip';
    headerStrip.innerHTML = `
      <input type="file" id="mediaPoolFileInput" accept="image/*,video/*,audio/*,.png,.jpg,.jpeg,.svg,.gif,.webp,.mp4,.webm,.mov,.mkv,.mp3,.wav,.aac,.m4a,.ogg,.flac" multiple style="display:none;">
      <div class="media-filter-pills">
        <button type="button" class="media-filter-pill ${currentMediaTabFilter === 'foto' ? 'active' : ''}" data-filter="foto">Foto</button>
        <button type="button" class="media-filter-pill ${currentMediaTabFilter === 'video' ? 'active' : ''}" data-filter="video">Video</button>
        <button type="button" class="media-filter-pill ${currentMediaTabFilter === 'audio' ? 'active' : ''}" data-filter="audio">Audio</button>
        <button type="button" class="media-filter-pill ${currentMediaTabFilter === 'vector' ? 'active' : ''}" data-filter="vector">Vector</button>
        <button type="button" class="media-filter-pill ${currentMediaTabFilter === 'composition' ? 'active' : ''}" data-filter="composition">Composition</button>
      </div>
    `;

    const poolFileInput = headerStrip.querySelector('#mediaPoolFileInput');
    const filterPills = headerStrip.querySelectorAll('.media-filter-pill');

    if (poolFileInput) {
      poolFileInput.addEventListener('change', () => {
        if (poolFileInput.files && poolFileInput.files.length > 0) {
          handleImportedFiles(poolFileInput.files);
        }
      });
    }

    filterPills.forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        currentMediaTabFilter = pill.dataset.filter || 'foto';
        renderCategoryItems('media');
      });
    });

    grid.appendChild(headerStrip);
    if (currentMediaTabFilter === 'composition') {
      const compWrap = document.createElement('div');
      compWrap.className = 'composition-shelf-list';
      compWrap.style.display = 'flex';
      compWrap.style.flexWrap = 'wrap';
      compWrap.style.gap = '10px';
      compWrap.style.width = '100%';
      compWrap.style.overflowY = 'auto';
      compWrap.style.maxHeight = '185px';
      compWrap.style.padding = '4px 2px';
      const activeGroupIds = new Set();
      document.querySelectorAll('.track-row').forEach(r => {
        if (!r.classList.contains('deleting')) {
          if (r.dataset.layerId) activeGroupIds.add(r.dataset.layerId);
          if (r.dataset.sourceGroupId) activeGroupIds.add(r.dataset.sourceGroupId);
        }
      });
      if (typeof activeGroupContext !== 'undefined' && activeGroupContext && activeGroupContext.groupId) {
        activeGroupIds.add(activeGroupContext.groupId);
      }

      Array.from(layerGroupData.keys()).forEach(gId => {
        if (!activeGroupIds.has(gId)) {
          layerGroupData.delete(gId);
        }
      });

      const groups = Array.from(layerGroupData.entries());
      if (groups.length === 0) {
        const emptyHint = document.createElement('div');
        emptyHint.style.cssText = 'color: var(--col-cream, #FAB778); font-size: 0.8rem; padding: 20px 10px; text-align: center; opacity: 0.75; font-weight: 600; width: 100%;';
        emptyHint.textContent = 'Belum ada Composition / Group. Pilih beberapa layer lalu klik tombol Group untuk membuat.';
        compWrap.appendChild(emptyHint);
      } else {
        groups.forEach(([gId, gData]) => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'comp-shelf-pill-card';
          card.style.cssText = 'position: relative; background: #4A1D05; border: 1.5px solid rgba(250, 183, 120, 0.4); border-radius: 8px; color: #FFF2C2; font-family: inherit; font-size: 0.85rem; font-weight: 800; padding: 10px 18px; min-width: 140px; cursor: pointer; text-align: center; transition: all 0.15s ease; user-select: none;';
          card.textContent = gData.name || 'Group';
          card.dataset.groupId = gId;
          card.title = 'Klik untuk menambah ke timeline / Klik kanan untuk opsi hapus';

          card.addEventListener('mouseenter', () => {
            card.style.background = '#642808';
            card.style.borderColor = '#FAB778';
            card.style.transform = 'translateY(-2px)';
          });
          card.addEventListener('mouseleave', () => {
            card.style.background = '#4A1D05';
            card.style.borderColor = 'rgba(250, 183, 120, 0.4)';
            card.style.transform = 'translateY(0)';
          });
          card.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof addGroupTrackFromComposition === 'function') {
              addGroupTrackFromComposition(gId);
            }
            const popover = document.getElementById('addTrackPopover');
            const fab = document.getElementById('fabAddTrack');
            if (popover) popover.classList.remove('active');
            if (fab) fab.classList.remove('active');
          });
          card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showCompositionCardContextMenu(e, gId, gData.name || 'Group');
          });

          compWrap.appendChild(card);
        });
      }

      grid.appendChild(compWrap);
    } else if (currentMediaTabFilter === 'audio') {
      const listCol = document.createElement('div');
      listCol.style.display = 'flex';
      listCol.style.flexDirection = 'column';
      listCol.style.gap = '8px';
      listCol.style.width = '100%';
      listCol.style.overflowY = 'auto';
      listCol.style.maxHeight = '180px';
      listCol.style.padding = '4px 0';
      const addAudioTile = document.createElement('div');
      addAudioTile.className = 'audio-shelf-card audio-add-card';
      addAudioTile.style.cssText = 'border: 1.5px dashed rgba(250, 183, 120, 0.5); cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: rgba(0,0,0,0.3); transition: all 0.15s ease; user-select: none;';
      addAudioTile.title = 'Import File Musik / Audio Baru';
      addAudioTile.innerHTML = `
        <div class="audio-shelf-icon" style="background: rgba(250, 183, 120, 0.2); width: 38px; height: 38px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
          <span class="material-symbols-rounded" style="color: #FAB778; font-size: 24px;">add</span>
        </div>
        <div class="audio-shelf-info">
          <span class="audio-shelf-title" style="color: #FAB778; font-weight: 700; font-size: 0.85rem;">Import Audio / Musik</span>
          <span class="audio-shelf-sub" style="font-size: 0.72rem; opacity: 0.7;">Klik untuk upload file audio baru (.mp3, .wav, .m4a)</span>
        </div>
      `;
      addAudioTile.addEventListener('click', (e) => {
        e.stopPropagation();
        if (poolFileInput) poolFileInput.click();
      });
      listCol.appendChild(addAudioTile);

      if (filteredList && filteredList.length > 0) {
        filteredList.forEach(item => {
          const card = document.createElement('div');
          card.className = 'audio-shelf-card';
          card.innerHTML = `
            <div class="audio-shelf-icon">
              <span class="material-symbols-rounded">audiotrack</span>
            </div>
            <div class="audio-shelf-info">
              <span class="audio-shelf-title">${item.name}</span>
              <span class="audio-shelf-sub">Audio Clip \u2022 Klik untuk menambahkan ke timeline</span>
            </div>
          `;
          card.addEventListener('click', (e) => {
            e.stopPropagation();
            addTrackWithType('audio', item.name, item.url);
            const popover = document.getElementById('addTrackPopover');
            const fab = document.getElementById('fabAddTrack');
            if (popover) popover.classList.remove('active');
            if (fab) fab.classList.remove('active');
          });
          listCol.appendChild(card);
        });
      }

      grid.appendChild(listCol);
    } else {
      const itemsRow = document.createElement('div');
      itemsRow.className = 'media-shelf-items-row';
      const addTile = document.createElement('button');
      addTile.type = 'button';
      addTile.className = 'media-pool-add-tile';
      addTile.title = 'Import File Baru (Foto, Video, Audio, SVG)';
      addTile.innerHTML = `
        <div class="media-add-tile-inner">
          <span class="material-symbols-rounded" style="font-size:32px; color:#FAB778;">add</span>
        </div>
      `;
      addTile.addEventListener('click', (e) => {
        e.stopPropagation();
        if (poolFileInput) poolFileInput.click();
      });
      itemsRow.appendChild(addTile);

      if (filteredList && filteredList.length > 0) {
        filteredList.forEach(item => {
          const thumb = createMediaThumbnailElement(item, (mediaItem) => {
            const isVideoItem = (mediaItem.type && mediaItem.type.startsWith('video')) || (mediaItem.name && /\.(mp4|webm|mov|mkv)$/i.test(mediaItem.name));
            const isSvgItem = (mediaItem.type === 'image/svg+xml') || (mediaItem.name && /\.svg$/i.test(mediaItem.name));
            let finalMediaUrl = mediaItem.url;
            if (!isVideoItem && !finalMediaUrl && mediaItem.blob) {
              finalMediaUrl = URL.createObjectURL(mediaItem.blob);
              mediaItem.url = finalMediaUrl;
            }
            const trackUrl = isVideoItem ? (mediaItem.id || mediaItem.url) : (finalMediaUrl || mediaItem.id);

            if (isSvgItem) {
              const newRow = addTrackWithType('shape', mediaItem.name, trackUrl, 'svg_path');
              if (newRow) {
                const layerId = newRow.dataset.layerId;
                const p = getLayerShapeParams(layerId, 'svg_path');
                p.svgUrl = trackUrl;
                p.svgContent = mediaItem.svgContent || '';
                const fill = (typeof getLayerFill === 'function') ? getLayerFill(layerId) : null;
                if (fill) {
                  fill.type = 'media';
                  fill.mediaUrl = trackUrl;
                }
                applyFillToMeshGlobal(layerId);
                render3D();
              }
            } else {
              addTrackWithType('shape', mediaItem.name, trackUrl, 'square');
            }

            const popover = document.getElementById('addTrackPopover');
            const fab = document.getElementById('fabAddTrack');
            if (popover) popover.classList.remove('active');
            if (fab) fab.classList.remove('active');
          });
          itemsRow.appendChild(thumb);
        });
      }

      grid.appendChild(itemsRow);
    }
    return;
  }

  if (catKey === 'camera') {
    grid.className = 'popover-items-grid camera-shelf-grid';
    const items = CATEGORY_ITEMS.camera || [];
    items.forEach(item => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'camera-shelf-card';
      card.innerHTML = `
        <span class="material-symbols-rounded">${item.icon}</span>
        <span class="insp-tile-label">${item.name}</span>
      `;

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        addTrackWithType(item.cat || catKey, item.filename, null, (item.cat === 'null' || item.name.toLowerCase().includes('null')) ? 'null' : null);
        const popover = document.getElementById('addTrackPopover');
        const fab = document.getElementById('fabAddTrack');
        if (popover) popover.classList.remove('active');
        if (fab) fab.classList.remove('active');
      });

      grid.appendChild(card);
    });
    return;
  }

  const items = CATEGORY_ITEMS[catKey] || [];
  items.forEach(item => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shelf-item-card';
    card.innerHTML = `
      <span class="material-symbols-rounded insp-tile-icon">${item.icon}</span>
      <span class="insp-tile-label">${item.name}</span>
    `;

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      addTrackWithType(item.cat || catKey, item.filename, null, (item.cat === 'null' || item.name.toLowerCase().includes('null')) ? 'null' : null);
      const popover = document.getElementById('addTrackPopover');
      const fab = document.getElementById('fabAddTrack');
      if (popover) popover.classList.remove('active');
      if (fab) fab.classList.remove('active');
    });

    grid.appendChild(card);
  });
}

async function handleImportedFiles(fileList, forceCat) {
  if (!fileList || fileList.length === 0) return;

  let lastDetectedTab = null;

  for (const file of Array.from(fileList)) {
    const mime = file.type ? file.type.toLowerCase() : '';
    const name = file.name ? file.name.toLowerCase() : '';

    let cat = 'media';
    let fileMime = file.type;

    if (mime === 'image/svg+xml' || /\.svg$/i.test(name) || forceCat === 'svg') {
      cat = 'svg';
      fileMime = 'image/svg+xml';
      lastDetectedTab = 'vector';
    } else if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v|3gp)$/i.test(name)) {
      cat = 'video';
      fileMime = fileMime || 'video/mp4';
      lastDetectedTab = 'video';
    } else if (mime.startsWith('audio/') || /\.(mp3|wav|aac|m4a|ogg|flac|wma|opus)$/i.test(name)) {
      cat = 'audio';
      fileMime = fileMime || 'audio/mp3';
      lastDetectedTab = 'audio';
    } else {
      cat = 'media';
      fileMime = fileMime || 'image/png';
      if (!lastDetectedTab) lastDetectedTab = 'foto';
    }

    if (cat === 'svg') {
      const reader = new FileReader();
      reader.onload = () => {
        const svgText = reader.result;
        const mediaId = 'media_svg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgText);

        let parsedPoints = [];
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(svgText, 'image/svg+xml');
          const poly = doc.querySelector('polygon, polyline');
          if (poly) {
            const rawPts = (poly.getAttribute('points') || '').trim().split(/[\s,]+/);
            for (let i = 0; i < rawPts.length - 1; i += 2) {
              const px = (parseFloat(rawPts[i]) || 0) - 50;
              const py = 50 - (parseFloat(rawPts[i + 1]) || 0);
              parsedPoints.push({ x: px, y: py });
            }
          }
        } catch (_) {}

        if (parsedPoints.length < 2) {
          parsedPoints = [{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }];
        }

        const isFromShapePicker = (forceCat === 'svg');
        const newRow = addTrackWithType(isFromShapePicker ? 'shape' : 'media', file.name, dataUrl, isFromShapePicker ? 'svg_path' : null);
        if (newRow) {
          const layerId = newRow.dataset.layerId;
          const p = getLayerShapeParams(layerId, 'svg_path');
          p.points = parsedPoints;
          p.svgContent = svgText;
          p.svgUrl = dataUrl;
          const fill = (typeof getLayerFill === 'function') ? getLayerFill(layerId) : null;
          if (fill) {
            fill.type = 'media';
            fill.mediaUrl = dataUrl;
          }
          applyFillToMeshGlobal(layerId);
          render3D();
        }

        if (typeof addGlobalMedia === 'function') {
          addGlobalMedia(dataUrl, file.name, 'image/svg+xml', file);
        }
      };
      reader.readAsText(file);
      continue;
    }

    if (cat === 'video') {
      const placeholderId = 'converting_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const convertingItem = {
        id: placeholderId,
        name: file.name,
        type: 'video_converting',
        isConverting: true,
        progress: 0,
        createdAt: Date.now()
      };

      const list = getGlobalMediaLibrary();
      const dupIdx = list.findIndex(m => m.name === file.name);
      if (dupIdx >= 0) list.splice(dupIdx, 1);
      list.unshift(convertingItem);
      saveGlobalMediaLibrary(list);

      currentMediaTabFilter = 'video';
      if (typeof syncAllMediaGrids === 'function') syncAllMediaGrids();
      if (typeof renderCategoryItems === 'function') renderCategoryItems('media');

      try {
        const pkg = await convertVideoToFrameSequence(file, (pct, cur, total) => {
          convertingItem.progress = pct;
          const fillEls = document.querySelectorAll(`.media-thumb-item[data-item-id="${placeholderId}"] .media-thumb-progress-fill`);
          const pctEls = document.querySelectorAll(`.media-thumb-item[data-item-id="${placeholderId}"] .media-thumb-pct`);
          fillEls.forEach(el => el.style.width = pct + '%');
          pctEls.forEach(el => el.textContent = pct + '%');
        });

        const mediaId = 'video_pkg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        pkg.id = mediaId;
        pkg.name = file.name;
        videoFrameSequenceMap.set(mediaId, pkg);
        videoFrameSequenceMap.set(file.name, pkg);
        videoFrameSequenceMap.set(pkg.audioUrl, pkg);

        convertingItem.id = mediaId;
        convertingItem.type = 'video_package';
        convertingItem.url = mediaId;
        convertingItem.thumbnailUrl = pkg.thumbnailUrl;
        convertingItem.blob = file;
        convertingItem.duration = pkg.duration;
        convertingItem.aspectRatio = pkg.aspectRatio;
        convertingItem.width = pkg.width;
        convertingItem.height = pkg.height;
        convertingItem.audioUrl = pkg.audioUrl;
        convertingItem.isConverting = false;

        saveGlobalMediaLibrary(list);
        if (typeof saveMediaBinaryToIDB === 'function') saveMediaBinaryToIDB(convertingItem);
        if (typeof saveVideoPackageToIDB === 'function') saveVideoPackageToIDB(pkg);

        mediaNaturalRatioMap.set(mediaId, pkg.aspectRatio);
        mediaNaturalRatioMap.set(file.name, pkg.aspectRatio);

        if (typeof syncAllMediaGrids === 'function') syncAllMediaGrids();
        if (typeof renderCategoryItems === 'function') renderCategoryItems('media');
      } catch(err) {
        console.error('Failed converting video to frame sequence:', err);
        const curList = getGlobalMediaLibrary();
        const errIdx = curList.findIndex(m => m.id === placeholderId);
        if (errIdx >= 0) curList.splice(errIdx, 1);
        saveGlobalMediaLibrary(curList);
        if (typeof syncAllMediaGrids === 'function') syncAllMediaGrids();
        if (typeof renderCategoryItems === 'function') renderCategoryItems('media');
        alert('Gagal mengekstrak frame video: ' + err.message);
      }
      continue;
    }

    if (cat === 'audio') {
      const objectUrl = URL.createObjectURL(file);
      if (typeof addGlobalMedia === 'function') {
        addGlobalMedia(objectUrl, file.name, fileMime, file);
      }
      continue;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        const aspect = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : 1.0;
        mediaNaturalRatioMap.set(dataUrl, aspect);
      };
      img.src = dataUrl;
      if (typeof addGlobalMedia === 'function') {
        addGlobalMedia(dataUrl, file.name, fileMime, file);
      }
    };
    reader.readAsDataURL(file);
  }

  if (lastDetectedTab) {
    currentMediaTabFilter = lastDetectedTab;
    setTimeout(() => {
      renderCategoryItems('media');
    }, 120);
  }
}

function addTrackWithType(category, customName, mediaUrl, shapeType, extraData) {
  const container = document.getElementById('trackRowsContainer');
  const viewport = document.getElementById('tracksViewport');
  if (!container) return null;

  if (category === 'media' || category === 'video') {
    category = 'shape';
    if (!shapeType) shapeType = 'square';
  }

  let trackName = customName;
  if (!trackName) {
    if (category === 'shape') trackName = 'Shape_Kotak.svg';
    else if (category === 'null' || shapeType === 'null') trackName = 'Null_1';
    else if (category === 'audio') trackName = 'Audio_Track.mp3';
    else if (category === 'camera') trackName = 'Camera_1';
    else if (category === 'text') trackName = (extraData && extraData.content) ? extraData.content : 'Heading_Title.txt';
    else trackName = 'New_Layer.png';
  }

  const widths = [360, 440, 520, 300, 480];
  const w = widths[Math.floor(Math.random() * widths.length)];
  const m = Math.max(0, timelineOffset);

  const isAudio = (category === 'audio');
  const defaultEyeIcon = isAudio ? 'volume_up' : 'visibility';

  const row = document.createElement('div');
  row.className = 'track-row adding';
  row.dataset.category = category || 'custom';
  if (shapeType) {
    row.dataset.shapeType = shapeType;
  }
  row.innerHTML = `
    <button class="track-eye" title="${isAudio ? 'Mute / Unmute Audio' : 'Toggle Visibility'} / Tahan untuk Multi-Select">
      <span class="material-symbols-rounded">${isMultiSelectMode ? 'radio_button_unchecked' : defaultEyeIcon}</span>
    </button>
    <div class="track-trackway" style="transform: translateX(-${timelineOffset}px);">
      <div class="track-clip" style="width: ${w}px; margin-left: ${m}px;" title="Klik untuk pilih / buka menu layer">
        <div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </div>
        <span class="track-clip-name">${trackName}</span>
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
  setTimeout(() => row.classList.remove('adding'), 300);

  const id = row.dataset.layerId;

  if (category === 'text' && id) {
    const tData = (typeof getLayerText === 'function') ? getLayerText(id) : null;
    if (tData) {
      if (extraData && extraData.content) {
        tData.content = extraData.content;
        tData.font = extraData.font || 'Poppins';
        tData.size = extraData.size || 48;
        tData.bold = extraData.bold !== undefined ? extraData.bold : true;
        tData.uppercase = !!extraData.uppercase;
      }
      if (tData.font && typeof loadGoogleFont === 'function') {
        loadGoogleFont(tData.font);
      }
    }
  }

  if (mediaUrl && id) {
    const fill = getLayerFill(id);
    fill.type = 'media';
    fill.mediaUrl = mediaUrl;
    fill.mediaFit = fill.mediaFit || 'fit';
    fill.color = null;
    fill.gradientType = null;

    const isPkg = mediaUrl && (mediaUrl.startsWith('video_pkg_') || mediaUrl.startsWith('pkg_'));
    if (isPkg || videoFrameSequenceMap.has(mediaUrl) || videoFrameSequenceMap.has(id)) {
      const seq = videoFrameSequenceMap.get(mediaUrl) || videoFrameSequenceMap.get(id);
      if (seq) {
        if (seq.aspectRatio) {
          mediaNaturalRatioMap.set(id, seq.aspectRatio);
          mediaNaturalRatioMap.set(mediaUrl, seq.aspectRatio);
          fill.aspectRatio = seq.aspectRatio;
        }
        const sp = getLayerShapeParams(id, 'square');
        if (sp && seq.width && seq.height) {
          sp.sizeX_px = seq.width;
          sp.sizeY_px = seq.height;
          const defW = (typeof projectWidth !== 'undefined' ? projectWidth : 1080);
          const defH = (typeof projectHeight !== 'undefined' ? projectHeight : 1080);
          sp.sizeX = (sp.sizeX_px / defW) * 100;
          sp.sizeY = (sp.sizeY_px / defH) * 100;
        }
        if (seq.duration && isFinite(seq.duration)) {
          const targetWidth = Math.max(80, Math.round(seq.duration * PX_PER_SEC));
          const clipEl = row.querySelector('.track-clip');
          if (clipEl) clipEl.style.width = `${targetWidth}px`;
          calculateMaxDuration();
          rebuildTimeRuler(totalDuration);
        }
      }
      applyFillToMeshGlobal(id);
      applyTransformToThreeMesh(id, getLayerTransform(id));
      renderCanvasOverlay();
    } else if (isAudio) {
      const resolvedAudio = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(mediaUrl) : mediaUrl;
      if (resolvedAudio) {
        const audio = new Audio(resolvedAudio);
        audio.preload = 'auto';
        layerAudioMap.set(id, audio);
        audio.onloadedmetadata = () => {
          if (audio.duration && isFinite(audio.duration)) {
            const targetWidth = Math.max(80, Math.round(audio.duration * PX_PER_SEC));
            const clipEl = row.querySelector('.track-clip');
            if (clipEl) clipEl.style.width = `${targetWidth}px`;
            calculateMaxDuration();
            rebuildTimeRuler(totalDuration);
          }
        };
      }
    } else {
      const resolvedImg = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(mediaUrl) : mediaUrl;
      if (resolvedImg) {
        const img = new Image();
        img.onload = () => {
          const aspect = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : 1.0;
          mediaNaturalRatioMap.set(id, aspect);
          mediaNaturalRatioMap.set(mediaUrl, aspect);
          fill.aspectRatio = aspect;
          const sp = getLayerShapeParams(id, 'square');
          if (sp) {
            sp.sizeX_px = img.naturalWidth;
            sp.sizeY_px = img.naturalHeight;
            const defW = (typeof projectWidth !== 'undefined' ? projectWidth : 1080);
            const defH = (typeof projectHeight !== 'undefined' ? projectHeight : 1080);
            sp.sizeX = (sp.sizeX_px / defW) * 100;
            sp.sizeY = (sp.sizeY_px / defH) * 100;
          }
          applyFillToMeshGlobal(id);
          applyTransformToThreeMesh(id, getLayerTransform(id));
          renderCanvasOverlay();
          render3D();
        };
        img.src = resolvedImg;
      }
      applyFillToMeshGlobal(id);
    }
  } else if (id && category === 'shape') {
    const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
    const defShapeDim = Math.round(Math.min(projDim.width, projDim.height) * 0.38) || 400;
    const sp = getLayerShapeParams(id, shapeType || 'square');
    if (sp) {
      sp.sizeX_px = defShapeDim;
      sp.sizeY_px = defShapeDim;
      sp.sizeX = (defShapeDim / projDim.width) * 100;
      sp.sizeY = (defShapeDim / projDim.height) * 100;
    }
    applyFillToMeshGlobal(id);
    applyTransformToThreeMesh(id, getLayerTransform(id));
    renderCanvasOverlay();
    render3D();
  }

  container.prepend(row);
  if (viewport) viewport.scrollTop = 0;

  setTimeout(() => {
    row.classList.remove('adding');
  }, 340);

  calculateMaxDuration();

  recordAction({
    type: 'ADD_TRACK',
    element: row
  });

  syncThreeLayers();
  renderCanvasOverlay();

  return row;
}

function addTrack() {
  return addTrackWithType('media', 'Media_Clip.mp4');
}

function addGroupTrackFromComposition(srcGroupId) {
  const newGroupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const src = layerGroupData.get(srcGroupId);
  const groupName = src ? src.name : 'Group';
  cloneGroupData(srcGroupId, newGroupId, groupName);

  const container = document.getElementById('trackRowsContainer');
  if (!container) return;

  const w = 300;
  const m = Math.max(0, timelineOffset);

  const row = document.createElement('div');
  row.className = 'track-row adding';
  row.dataset.category = 'group';
  row.dataset.layerId = newGroupId;

  row.innerHTML = `
    <button class="track-eye" title="Toggle Visibility / Tahan untuk Multi-Select">
      <span class="material-symbols-rounded">visibility</span>
    </button>
    <div class="track-trackway" style="transform: translateX(-${timelineOffset}px);">
      <div class="track-clip" style="width: ${w}px; margin-left: ${m}px;" title="Klik untuk pilih Group / Buka Inspector">
        <div class="clip-extend-handle handle-left" title="Tarik untuk memanjangkan awal layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </div>
        <span class="track-clip-name">${groupName}</span>
        <div class="clip-extend-handle handle-right" title="Tarik untuk memanjangkan akhir layer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    </div>
    <button class="track-reorder-handle" title="Tahan & geser untuk atur urutan layer (Reorder)">
      <span class="material-symbols-rounded">menu</span>
    </button>
  `;

  layerTransforms.set(newGroupId, {
    posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, scaleW: 100, scaleH: 100, opacity: 100, blendMode: 'normal', isLinked: true
  });
  layerKeyframes.set(newGroupId, []);
  layerFills.set(newGroupId, { type: 'color', color: '#FAB778' });
  layerBorderShadow.set(newGroupId, {
    stroke: { enabled: false, color: '#FAB778', width: 0, align: 'center', alpha: 100 },
    shadow: { enabled: false, color: '#000000', size: 0, alpha: 0, posX: 0, posY: 0 }
  });

  bindTrackEvents(row);
  container.prepend(row);
  setTimeout(() => row.classList.remove('adding'), 300);

  syncThreeLayers();
  applyFillToMeshGlobal(newGroupId);
  selectTrack(row);
  calculateMaxDuration();
  render3D();
  triggerAutoSave();
}
window.addGroupTrackFromComposition = addGroupTrackFromComposition;

function showCompositionCardContextMenu(e, gId, groupName) {
  const existing = document.getElementById('compCardContextMenu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'compCardContextMenu';
  menu.style.cssText = `
    position: fixed;
    z-index: 999999;
    background: #3A1705;
    border: 1.5px solid #FAB778;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 175px;
    box-sizing: border-box;
  `;

  const mouseX = e.clientX || (e.touches && e.touches[0].clientX) || 100;
  const mouseY = e.clientY || (e.touches && e.touches[0].clientY) || 100;
  menu.style.left = `${Math.min(window.innerWidth - 185, Math.max(10, mouseX))}px`;
  menu.style.top = `${Math.min(window.innerHeight - 80, Math.max(10, mouseY))}px`;

  const btnDelete = document.createElement('button');
  btnDelete.type = 'button';
  btnDelete.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 8px 12px;
    color: #FF6B6B;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 800;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
    width: 100%;
    box-sizing: border-box;
  `;
  btnDelete.innerHTML = `
    <span class="material-symbols-rounded" style="font-size: 18px; color: #FF6B6B;">delete</span>
    <span>Hapus Komposisi</span>
  `;

  btnDelete.addEventListener('mouseenter', () => {
    btnDelete.style.background = 'rgba(255, 107, 107, 0.18)';
  });
  btnDelete.addEventListener('mouseleave', () => {
    btnDelete.style.background = 'transparent';
  });

  btnDelete.addEventListener('click', (ev) => {
    ev.stopPropagation();
    menu.remove();
    deleteCompositionAndTimelineTracks(gId);
  });

  menu.appendChild(btnDelete);
  document.body.appendChild(menu);

  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('pointerdown', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', closeMenu), 50);
}
window.showCompositionCardContextMenu = showCompositionCardContextMenu;

function deleteCompositionAndTimelineTracks(gId) {
  if (!gId) return;
  if (typeof activeGroupContext !== 'undefined' && activeGroupContext && activeGroupContext.groupId === gId) {
    if (typeof exitGroupContext === 'function') exitGroupContext();
  }
  const rows = Array.from(document.querySelectorAll(`.track-row[data-layer-id="${gId}"], .track-row[data-source-group-id="${gId}"]`));
  rows.forEach(row => {
    const lId = row.dataset.layerId;
    if (typeof cleanupDeletedLayerData === 'function') {
      cleanupDeletedLayerData(lId);
    }
    row.remove();
  });
  if (typeof layerGroupData !== 'undefined') {
    layerGroupData.delete(gId);
  }
  if (typeof syncThreeLayers === 'function') syncThreeLayers();
  if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
  if (typeof calculateMaxDuration === 'function') calculateMaxDuration();
  if (typeof render3D === 'function') render3D();
  if (typeof saveCurrentProject === 'function') saveCurrentProject();
  if (typeof renderMediaLibraryTab === 'function' && typeof currentMediaTabFilter !== 'undefined' && currentMediaTabFilter === 'composition') {
    renderMediaLibraryTab('composition');
  }
}
window.deleteCompositionAndTimelineTracks = deleteCompositionAndTimelineTracks;

document.addEventListener('DOMContentLoaded', () => {
  initTimelineZoomAndPreventWebZoom();
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  });

  const title = sessionStorage.getItem('activeProject') || 'My Project';
  const titleEl = document.getElementById('activeTitle');
  if (titleEl) {
    titleEl.textContent = title;
    
    titleEl.addEventListener('input', () => {
      const newTitle = titleEl.textContent.trim() || 'My Project';
      sessionStorage.setItem('activeProject', newTitle);
      triggerAutoSave();
    });

    titleEl.addEventListener('blur', () => {
      if (!titleEl.textContent.trim()) {
        titleEl.textContent = 'My Project';
        sessionStorage.setItem('activeProject', 'My Project');
      }
      triggerAutoSave();
    });

    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleEl.blur();
      }
    });
  }

  const topLayerNameEl = document.getElementById('topInspLayerName');
  if (topLayerNameEl) {
    topLayerNameEl.addEventListener('input', () => {
      if (selectedTrackRow) {
        const clipName = selectedTrackRow.querySelector('.track-clip-name');
        const newName = topLayerNameEl.textContent.trim() || 'Layer';
        if (clipName) {
          clipName.textContent = newName;
        }

        const lId = selectedTrackRow.dataset.layerId;
        const srcGId = selectedTrackRow.dataset.sourceGroupId;
        if (lId && typeof layerGroupData !== 'undefined' && layerGroupData.has(lId)) {
          layerGroupData.get(lId).name = newName;
        }
        if (srcGId && typeof layerGroupData !== 'undefined' && layerGroupData.has(srcGId)) {
          layerGroupData.get(srcGId).name = newName;
        }
        const navTitle = document.getElementById('groupNavTitle');
        if (navTitle && typeof activeGroupContext !== 'undefined' && activeGroupContext && (activeGroupContext.groupId === lId || activeGroupContext.groupId === srcGId)) {
          navTitle.textContent = newName;
        }
        if (typeof renderMediaLibraryTab === 'function' && typeof currentMediaTabFilter !== 'undefined' && currentMediaTabFilter === 'composition') {
          renderMediaLibraryTab('composition');
        }
        triggerAutoSave();
      }
    });

    topLayerNameEl.addEventListener('blur', () => {
      if (selectedTrackRow) {
        const clipName = selectedTrackRow.querySelector('.track-clip-name');
        if (!topLayerNameEl.textContent.trim()) {
          const fallback = selectedTrackRow.dataset.category ? (selectedTrackRow.dataset.category.charAt(0).toUpperCase() + selectedTrackRow.dataset.category.slice(1) + ' Layer') : 'Layer';
          topLayerNameEl.textContent = fallback;
          if (clipName) clipName.textContent = fallback;
        }
        const lId = selectedTrackRow.dataset.layerId;
        const srcGId = selectedTrackRow.dataset.sourceGroupId;
        const finalName = topLayerNameEl.textContent.trim();
        if (lId && typeof layerGroupData !== 'undefined' && layerGroupData.has(lId)) {
          layerGroupData.get(lId).name = finalName;
        }
        if (srcGId && typeof layerGroupData !== 'undefined' && layerGroupData.has(srcGId)) {
          layerGroupData.get(srcGId).name = finalName;
        }
        triggerAutoSave();
      }
    });

    topLayerNameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        topLayerNameEl.blur();
      }
    });
  }

  try {
    const rawCfg = sessionStorage.getItem('projectConfig');
    if (rawCfg) {
      const cfg = JSON.parse(rawCfg);
      applyProjectConfig(cfg);
    }
  } catch (e) {
    console.warn('Could not parse project config', e);
  }

  const btnBack = document.querySelector('.btn-back');
  if (btnBack) btnBack.addEventListener('click', goBack);

  document.querySelectorAll('.btn-play-main').forEach(btn => {
    btn.addEventListener('click', togglePlayPause);
  });

  document.querySelectorAll('[title="Skip ke awal"], [title="Skip Previous"]').forEach(btn => {
    btn.addEventListener('click', skipPrevious);
  });

  document.querySelectorAll('[title="Skip ke akhir"], [title="Skip Next"]').forEach(btn => {
    btn.addEventListener('click', skipNext);
  });

  document.querySelectorAll('[title="Bookmark"]').forEach(btn => {
    btn.addEventListener('click', toggleMarkerAtCurrent);
  });

  document.querySelectorAll('[title="Undo"]').forEach(btn => {
    btn.addEventListener('click', undo);
  });

  document.querySelectorAll('[title="Redo"]').forEach(btn => {
    btn.addEventListener('click', redo);
  });

  const btnExport = document.querySelector('.btn-export');
  if (btnExport) btnExport.addEventListener('click', openMediaEncoder);

  const fabAdd = document.getElementById('fabAddTrack') || document.querySelector('.fab-add');
  const addTrackPopover = document.getElementById('addTrackPopover');
  const btnAddTrackClose = document.getElementById('btnAddTrackClose');

  if (fabAdd && addTrackPopover) {
    renderCategoryItems('shape');

    fabAdd.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = addTrackPopover.classList.toggle('active');
      fabAdd.classList.toggle('active', isActive);
    });

    if (btnAddTrackClose) {
      btnAddTrackClose.addEventListener('click', (e) => {
        e.stopPropagation();
        addTrackPopover.classList.remove('active');
        fabAdd.classList.remove('active');
      });
    }

    document.querySelectorAll('.cat-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cat = btn.getAttribute('data-cat') || 'shape';
        if (cat === 'text') {
          addTrackWithType('text', 'Teks_1.txt', null, null);
          addTrackPopover.classList.remove('active');
          fabAdd.classList.remove('active');
          return;
        }
        document.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCategoryItems(cat);
      });
    });

    document.addEventListener('click', (e) => {
      if (!addTrackPopover.contains(e.target) && !fabAdd.contains(e.target)) {
        addTrackPopover.classList.remove('active');
        fabAdd.classList.remove('active');
      }
    });
  }
  const btnTopLink = document.getElementById('topBtnInspLink');
  if (btnTopLink) {
    btnTopLink.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const currentTrackId = selectedTrackRow.dataset.layerId;
      if (!currentTrackId) return;

      const project = getProjectFromDOM();
      const currentTrack = project.tracks.find(t => t.id === currentTrackId) || {
        id: currentTrackId,
        linkedTo: selectedTrackRow.dataset.linkedTo ? JSON.parse(selectedTrackRow.dataset.linkedTo) : []
      };

      const linkedParentId = (currentTrack.linkedTo && currentTrack.linkedTo[0]) || (selectedTrackRow.dataset.linkedTo ? JSON.parse(selectedTrackRow.dataset.linkedTo)[0] : null);
      const card = document.createElement('div');
      card.className = 'fish-link-popover-card';

      const list = document.createElement('div');
      list.className = 'fish-link-list';
      const rows = document.querySelectorAll('.track-row');
      rows.forEach(r => {
        const trId = r.dataset.layerId;
        if (!trId) return;

        const isCurrent = (trId === currentTrackId);
        const isLinked = (linkedParentId === trId);

        const clip = r.querySelector('.track-clip');
        const trName = clip?.querySelector('.track-clip-name')?.textContent || r.dataset.category || `Layer ${trId}`;

        const item = document.createElement('div');
        item.className = 'fish-link-item' + (isCurrent ? ' disabled' : '') + (isLinked ? ' active' : '');

        item.innerHTML = `
          <span class="fish-link-name">${trName}</span>
          ${isLinked ? '<span class="material-symbols-rounded fish-link-check">check</span>' : ''}
        `;

        if (!isCurrent) {
          item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (isLinked) {
              const childWorld = getLayerWorldTransform(currentTrackId);
              const childT = getLayerTransform(currentTrackId);
              childT.posX = Math.round(childWorld.posX * 100) / 100;
              childT.posY = Math.round(childWorld.posY * 100) / 100;
              childT.posZ = Math.round(childWorld.posZ * 100) / 100;
              childT.rotX = Math.round(childWorld.rotX * 100) / 100;
              childT.rotY = Math.round(childWorld.rotY * 100) / 100;
              childT.rotZ = Math.round(childWorld.rotZ * 100) / 100;
              childT.scaleW = Math.round(childWorld.scaleW * 100) / 100;
              childT.scaleH = Math.round(childWorld.scaleH * 100) / 100;

              currentTrack.linkedTo = [];
              delete selectedTrackRow.dataset.linkedTo;
              delete selectedTrackRow.dataset.parentBind;
              saveProjectToDOM(project);
              triggerAutoSave();

              btnTopLink.classList.remove('active');
              applyTransformToThreeMesh(currentTrackId, getLayerTransform(currentTrackId));
              syncControllerUI();
              render3D();
              requestCanvasOverlayRender();
            } else {
              const parentWorld = getLayerWorldTransform(trId);
              const childWorld = getLayerWorldTransform(currentTrackId);

              const childT = getLayerTransform(currentTrackId);
              childT.posX = Math.round(childWorld.posX * 100) / 100;
              childT.posY = Math.round(childWorld.posY * 100) / 100;
              childT.posZ = Math.round(childWorld.posZ * 100) / 100;
              childT.rotX = Math.round(childWorld.rotX * 100) / 100;
              childT.rotY = Math.round(childWorld.rotY * 100) / 100;
              childT.rotZ = Math.round(childWorld.rotZ * 100) / 100;
              childT.scaleW = Math.round(childWorld.scaleW * 100) / 100;
              childT.scaleH = Math.round(childWorld.scaleH * 100) / 100;

              const bindPose = {
                posX: Math.round(parentWorld.posX * 100) / 100,
                posY: Math.round(parentWorld.posY * 100) / 100,
                posZ: Math.round(parentWorld.posZ * 100) / 100,
                rotX: Math.round(parentWorld.rotX * 100) / 100,
                rotY: Math.round(parentWorld.rotY * 100) / 100,
                rotZ: Math.round(parentWorld.rotZ * 100) / 100,
                scaleW: Math.round(parentWorld.scaleW * 100) / 100,
                scaleH: Math.round(parentWorld.scaleH * 100) / 100
              };

              currentTrack.linkedTo = [trId];
              selectedTrackRow.dataset.linkedTo = JSON.stringify([trId]);
              selectedTrackRow.dataset.parentBind = JSON.stringify(bindPose);
              saveProjectToDOM(project);
              triggerAutoSave();

              btnTopLink.classList.add('active');
              applyTransformToThreeMesh(currentTrackId, childT);
              syncControllerUI();
              render3D();
              requestCanvasOverlayRender();
            }
            if (window.FishPopover) window.FishPopover.close();
          });
        }

        list.appendChild(item);
      });

      card.appendChild(list);
      if (window.FishPopover) {
        window.FishPopover.show({
          anchorElement: btnTopLink,
          content: card,
          className: 'fish-link-popover-wrapper',
          onClose: null
        });
      }
    });
  }
  const btnTopBack = document.getElementById('topBtnInspBack');
  if (btnTopBack) {
    btnTopBack.addEventListener('click', (e) => {
      e.stopPropagation();
      deselectTrack();
    });
  }

  const btnTopDelete = document.getElementById('topBtnInspDelete');
  if (btnTopDelete) {
    btnTopDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSelectedTrack();
    });
  }

  const btnTopMotionBlur = document.getElementById('topBtnInspMotionBlur');
  if (btnTopMotionBlur) {
    btnTopMotionBlur.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const cur = !!layerMotionBlur.get(id);
      layerMotionBlur.set(id, !cur);
      btnTopMotionBlur.classList.toggle('active', !cur);
      btnTopMotionBlur.title = !cur ? 'Motion Blur: ON' : 'Motion Blur: OFF';
      render3D();
      triggerAutoSave();
    });
  }

  const btnGlobalMbD = document.getElementById('btnToggleGlobalMotionBlurDesktop');
  if (btnGlobalMbD) {
    btnGlobalMbD.addEventListener('click', (e) => {
      e.stopPropagation();
      isGlobalMotionBlurEnabled = !isGlobalMotionBlurEnabled;
      btnGlobalMbD.classList.toggle('active', isGlobalMotionBlurEnabled);
      const btnM = document.getElementById('btnToggleGlobalMotionBlurMobile');
      if (btnM) btnM.classList.toggle('active', isGlobalMotionBlurEnabled);
      render3D();
      triggerAutoSave();
    });
  }

  const btnGlobalMbM = document.getElementById('btnToggleGlobalMotionBlurMobile');
  if (btnGlobalMbM) {
    btnGlobalMbM.addEventListener('click', (e) => {
      e.stopPropagation();
      isGlobalMotionBlurEnabled = !isGlobalMotionBlurEnabled;
      btnGlobalMbM.classList.toggle('active', isGlobalMotionBlurEnabled);
      const btnD = document.getElementById('btnToggleGlobalMotionBlurDesktop');
      if (btnD) btnD.classList.toggle('active', isGlobalMotionBlurEnabled);
      render3D();
      triggerAutoSave();
    });
  }

  const btnTopMore = document.getElementById('topBtnInspMore');
  const layerOptionsPopup = document.getElementById('layerOptionsPopup');
  if (btnTopMore && layerOptionsPopup) {
    btnTopMore.addEventListener('click', (e) => {
      e.stopPropagation();
      if (layerOptionsPopup.classList.contains('active')) {
        closeLayerContextMenu();
        return;
      }
      openLayerContextMenu(e, selectedTrackRow || null);
    });
  }

  document.addEventListener('pointerdown', (e) => {
    if (layerOptionsPopup && layerOptionsPopup.classList.contains('active') && !layerOptionsPopup.contains(e.target) && e.target !== btnTopMore) {
      closeLayerContextMenu();
    }
  });

  document.addEventListener('click', (e) => {
    if (layerOptionsPopup && layerOptionsPopup.classList.contains('active') && !layerOptionsPopup.contains(e.target) && e.target !== btnTopMore) {
      closeLayerContextMenu();
    }
  });

  const timelinePanel = document.getElementById('timelinePanel');
  if (timelinePanel) {
    timelinePanel.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.track-row');
      openLayerContextMenu(e, r || null);
    });

    timelinePanel.addEventListener('dragover', (e) => {
      e.preventDefault();
      timelinePanel.classList.add('drag-over');
    });
    timelinePanel.addEventListener('dragleave', (e) => {
      e.preventDefault();
      timelinePanel.classList.remove('drag-over');
    });
    timelinePanel.addEventListener('drop', (e) => {
      e.preventDefault();
      timelinePanel.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImportedFiles(e.dataTransfer.files);
      }
    });
  }

  const tracksViewport = document.getElementById('tracksViewport');
  if (tracksViewport) {
    tracksViewport.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.track-row');
      openLayerContextMenu(e, r || null);
    });
  }

  const previewStage = document.getElementById('previewStage');
  if (previewStage) {
    previewStage.addEventListener('contextmenu', (e) => {
      openLayerContextMenu(e, selectedTrackRow || null);
    });

    let prevDownPos = { x: 0, y: 0 };
    let prevDownTime = 0;
    previewStage.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, .top-nav, .mobile-editor-controls, #layerInspectorDrawer, #layerTopContextBar, #layerOptionsPopup')) return;
      prevDownPos = { x: e.pageX, y: e.pageY };
      prevDownTime = performance.now();
    });

    previewStage.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, .top-nav, .mobile-editor-controls, #layerInspectorDrawer, #layerTopContextBar, #layerOptionsPopup')) return;
      const dx = Math.abs(e.pageX - prevDownPos.x);
      const dy = Math.abs(e.pageY - prevDownPos.y);
      if (dx < 6 && dy < 6) {
        if (selectedTrackRow && !e.target.closest('.transform-handle, .rot-handle, .corner-handle, .edge-handle')) {
          deselectTrack();
        }
      }
    });
  }

  initLayerOptionsPopup();

  initMultiSelectControls();

  initPreviewControls();
  initProjectSettingsModal();

  initTrackRows();

  initTimelineScrollAndScrub();

  initThreeEngine();
  calculateMaxDuration();
  setTimelineOffset(0);
  updateUndoRedoUI();
  initMoveTransformController();
  initBorderShadowController();
  initEditShapeSubpanel();
  initEditTextSubpanel();
  initCameraControlSubpanel();
  if (typeof initEffectsSubpanel === 'function') initEffectsSubpanel();
  initExportModalEvents();

  if (window.FishLoading && typeof window.FishLoading.startFullPreloadAndWarmUp === 'function') {
    window.FishLoading.startFullPreloadAndWarmUp();
  }
});
