
document.addEventListener('DOMContentLoaded', () => {
  renderRecentProjects();

  const modal = document.getElementById('newProjectModal');
  const btnNew = document.getElementById('btnNewProject') || document.querySelector('.btn-new');
  const btnClose = document.getElementById('btnModalClose');
  const btnCreate = document.getElementById('btnModalCreate');
  const inputName = document.getElementById('inputProjectName');
  const btnInputClear = document.getElementById('btnInputClear');
  const lblDim = document.getElementById('lblCompositionSize');

  // Auto-open modal if redirected from direct editor access (?openModal=true)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openModal') === 'true' || window.location.hash === '#new') {
      if (modal) {
        modal.classList.add('active');
        if (inputName) {
          setTimeout(() => {
            inputName.focus();
            inputName.select();
          }, 120);
        }
      }
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  } catch (e) {}

  const resDropdownWrap = document.getElementById('wrapSelectResolution');
  const resCustomWrap = document.getElementById('resCustomWrap');
  const customResW = document.getElementById('customResW');
  const customResH = document.getElementById('customResH');
  const btnLinkAspect = document.getElementById('btnLinkAspect');
  const bgSwatchBox = document.getElementById('bgSwatchBox');

  let selectedResValue = '1080p';
  let selectedFpsValue = '30';
  let selectedBgValue = '#000000';

  if (btnNew && modal) {
    btnNew.addEventListener('click', () => {
      modal.classList.add('active');
      if (inputName) {
        setTimeout(() => {
          inputName.focus();
          inputName.select();
        }, 100);
      }
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

  if (btnInputClear && inputName) {
    btnInputClear.addEventListener('click', () => {
      inputName.value = '';
      inputName.focus();
    });
  }

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

  setupCustomDropdown('wrapSelectResolution', 'triggerResolution', 'valResolution', 'menuResolution', (val) => {
    selectedResValue = val;
    updateDimensionLabel();
  });

  setupCustomDropdown('wrapSelectFps', 'triggerFps', 'valFps', 'menuFps', (val) => {
    selectedFpsValue = val;
  });

  setupCustomDropdown('wrapSelectBackground', 'triggerBackground', 'valBackground', 'menuBackground', (val, item) => {
    selectedBgValue = val;
    if (bgSwatchBox) {
      bgSwatchBox.style.background = val === 'transparent' ? '#ffffff' : val;
    }
  });

  function updateDimensionLabel() {
    if (!lblDim) return;
    const selectedBox = document.querySelector('#ratioSelector .am-ratio-box.selected');
    const ratio = selectedBox ? selectedBox.dataset.ratio : '9:16';
    
    if (ratio === 'custom') {
      const w = parseInt(customResW?.value) || 1080;
      const h = parseInt(customResH?.value) || 1080;
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

  document.querySelectorAll('#ratioSelector .am-ratio-box').forEach(box => {
    box.addEventListener('click', () => {
      document.querySelectorAll('#ratioSelector .am-ratio-box').forEach(b => b.classList.remove('selected'));
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

  if (btnCreate) {
    btnCreate.addEventListener('click', () => {
      const name = (inputName && inputName.value.trim()) || 'New Project 1';
      const selectedRatio = document.querySelector('#ratioSelector .am-ratio-box.selected')?.dataset.ratio || '9:16';
      const id = 'proj_' + Date.now();

      const config = {
        id,
        name,
        ratio: selectedRatio,
        resolution: selectedRatio === 'custom' ? `${customResW?.value || 1080}x${customResH?.value || 1080}` : selectedResValue,
        customWidth: parseInt(customResW?.value) || 1080,
        customHeight: parseInt(customResH?.value) || 1080,
        fps: selectedFpsValue,
        backgroundColor: selectedBgValue,
        motionBlurTune: 0.5,
        motionBlurSamples: 6,
        globalMotionBlur: true,
        createdAt: new Date().toLocaleDateString(),
        updatedAt: new Date().toLocaleString()
      };

      saveRecentProject(config);

      sessionStorage.setItem('activeProjectId', id);
      sessionStorage.setItem('activeProject', name);
      sessionStorage.setItem('projectConfig', JSON.stringify(config));
      closeModal();
      window.location.href = 'editor.html?project=' + id;
    });
  }

  // ── Import Project Modal & Converter (.fsp ZIP / JSON / Alight Motion XML) ──
  const btnImport = document.getElementById('btnImportProject') || document.querySelector('.btn-import');
  const importModal = document.getElementById('importChoiceModal');
  const btnImportFspOption = document.getElementById('btnImportFspOption');
  const btnImportAmXmlOption = document.getElementById('btnImportAmXmlOption');
  const btnCancelImportChoice = document.getElementById('btnCancelImportChoice');

  function openImportModal() {
    if (importModal) {
      importModal.classList.add('active');
    }
  }

  function closeImportModal() {
    if (importModal) {
      importModal.classList.remove('active');
    }
  }

  if (btnCancelImportChoice) {
    btnCancelImportChoice.addEventListener('click', closeImportModal);
  }

  if (importModal) {
    importModal.addEventListener('click', (e) => {
      if (e.target === importModal) closeImportModal();
    });
  }

  // Common project loader for both .fsp and .xml
  async function processAndLoadProject(projectData, fallbackName) {
    if (!projectData) {
      throw new Error('Format file proyek tidak valid atau data rusak.');
    }

    const projId = projectData.id || 'proj_' + Date.now();
    projectData.id = projId;
    if (!projectData.name) {
      projectData.name = (fallbackName || 'Imported Project').replace(/\.(fsp|zip|json|xml)$/i, '');
    }

    // 1. Save to recent projects
    const recentMeta = {
      id: projId,
      name: projectData.name,
      ratio: projectData.ratio || '9:16',
      resolution: projectData.resolution || '1080p',
      fps: projectData.fps || '30',
      backgroundColor: projectData.backgroundColor || '#000000',
      customWidth: projectData.customWidth || 1080,
      customHeight: projectData.customHeight || 1920,
      createdAt: projectData.createdAt || new Date().toLocaleDateString(),
      updatedAt: new Date().toLocaleString()
    };

    saveRecentProject(recentMeta);

    // 2. Save full high-capacity project to IndexedDB
    try {
      const req = indexedDB.open('FishTool_Studio_DB', 2);
      req.onupgradeneeded = (evt) => {
        const db = evt.target.result;
        if (!db.objectStoreNames.contains('saved_projects')) {
          db.createObjectStore('saved_projects', { keyPath: 'id' });
        }
      };
      req.onsuccess = (evt) => {
        const db = evt.target.result;
        try {
          const tx = db.transaction('saved_projects', 'readwrite');
          tx.objectStore('saved_projects').put(projectData);
        } catch (err) {}
      };
    } catch (idbErr) {}

    // 3. Stage for editor
    sessionStorage.setItem('activeProjectId', projId);
    sessionStorage.setItem('activeProject', projectData.name);
    sessionStorage.setItem('projectConfig', JSON.stringify(recentMeta));
    sessionStorage.setItem('importedProjectData', JSON.stringify(projectData));

    closeImportModal();
    window.location.href = 'editor.html?project=' + projId;
  }

  // 1. File input for .fsp / .zip / .json
  const fspFileInput = document.createElement('input');
  fspFileInput.type = 'file';
  fspFileInput.accept = '.fsp,.zip,.json';
  fspFileInput.style.display = 'none';
  document.body.appendChild(fspFileInput);

  fspFileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const projectData = extractProjectFromImportBuffer(arrayBuffer, file.name);
      await processAndLoadProject(projectData, file.name);
    } catch (err) {
      console.error('Import .fsp error', err);
      alert('Gagal mengimpor proyek .fsp: ' + (err.message || 'File tidak dikenali'));
    }
  });

  // 2. File input for Alight Motion XML (.xml)
  const amXmlFileInput = document.createElement('input');
  amXmlFileInput.type = 'file';
  amXmlFileInput.accept = '.xml,text/xml';
  amXmlFileInput.style.display = 'none';
  document.body.appendChild(amXmlFileInput);

  amXmlFileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const projectData = convertAlightMotionXmlToFishProject(text, file.name);
      await processAndLoadProject(projectData, file.name);
    } catch (err) {
      console.error('Convert AM XML error', err);
      alert('Gagal mengonversi Alight Motion XML: ' + (err.message || 'Format XML tidak sesuai'));
    }
  });

  if (btnImport) {
    btnImport.addEventListener('click', () => {
      openImportModal();
    });
  }

  if (btnImportFspOption) {
    btnImportFspOption.addEventListener('click', () => {
      fspFileInput.value = '';
      fspFileInput.click();
    });
  }

  if (btnImportAmXmlOption) {
    btnImportAmXmlOption.addEventListener('click', () => {
      amXmlFileInput.value = '';
      amXmlFileInput.click();
    });
  }
});


// ── Pure JS PKZip 2.0 & JSON Project Extractor ──
function extractProjectFromImportBuffer(arrayBuffer, filename) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const decoder = new TextDecoder();

  // 1. Try finding PKZip End of Central Directory (0x06054B50)
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054B50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const cdOffset = dv.getUint32(eocdOffset + 16, true);
    const totalEntries = dv.getUint16(eocdOffset + 10, true);
    let ptr = cdOffset;

    for (let i = 0; i < totalEntries; i++) {
      if (dv.getUint32(ptr, true) !== 0x02014B50) break;
      const fnLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOffset = dv.getUint32(ptr + 42, true);

      const fnBytes = bytes.subarray(ptr + 46, ptr + 46 + fnLen);
      const fn = decoder.decode(fnBytes);

      if (fn.toLowerCase().endsWith('project.json') || fn.toLowerCase().endsWith('.json')) {
        if (dv.getUint32(localOffset, true) === 0x04034B50) {
          const compMethod = dv.getUint16(localOffset + 8, true);
          const uncompSize = dv.getUint32(localOffset + 22, true);
          const localFnLen = dv.getUint16(localOffset + 26, true);
          const localExtraLen = dv.getUint16(localOffset + 28, true);
          const dataStart = localOffset + 30 + localFnLen + localExtraLen;
          const fileData = bytes.subarray(dataStart, dataStart + uncompSize);

          if (compMethod === 0) { // Uncompressed store
            try {
              return JSON.parse(decoder.decode(fileData));
            } catch (e) {}
          }
        }
      }
      ptr += 46 + fnLen + extraLen + commentLen;
    }
  }

  // 2. Direct JSON or UTF-8 Text Fallback
  try {
    const text = decoder.decode(bytes);
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      const candidate = text.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(candidate);
      if (parsed && (parsed.tracks || parsed.ratio || parsed.transforms || parsed.app)) {
        return parsed;
      }
    }
  } catch (e) {}

  return null;
}

function renderRecentProjects() {
  const container = document.getElementById('recentProjectsContainer');
  const countBadge = document.getElementById('recentCountBadge');
  if (!container) return;

  let projects = [];
  try {
    const raw = localStorage.getItem('fishTool_savedProjects') || localStorage.getItem('fishTool_recentProjects');
    if (raw) projects = JSON.parse(raw);
  } catch (e) {
    projects = [];
  }

  if (countBadge) {
    countBadge.textContent = `${projects.length} items`;
  }

  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div class="empty-projects-state" id="emptyProjectsState">
        <span class="material-symbols-rounded">folder_open</span>
        <span class="empty-title">Belum ada proyek</span>
        <span class="empty-sub">Klik "New Project" untuk mulai berkarya</span>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  projects.forEach((proj) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'project-card-wrapper';
    wrapper.dataset.id = proj.id || proj.name;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'project-swipe-delete-btn';
    delBtn.title = 'Hapus Proyek';
    delBtn.innerHTML = `<span class="material-symbols-rounded">delete</span>`;

    const card = document.createElement('div');
    card.className = 'project-card';
    card.title = `Buka ${proj.name}`;
    card.innerHTML = `
      <div class="project-info">
        <span class="project-name">${proj.name}</span>
        <span class="project-meta">${proj.resolution || '1080p'} &middot; ${proj.fps || '30'}FPS &middot; ${proj.ratio || '9:16'}</span>
      </div>
      <div class="project-thumb">
        <span class="material-symbols-rounded">movie</span>
      </div>
    `;

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProjectItem(proj.id || proj.name, wrapper);
    });

    let startX = 0;
    let startY = 0;
    let currentTranslateX = 0;
    let isSwiping = false;
    let isOpen = false;

    const onPointerDown = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;
      isSwiping = false;
      card.style.transition = 'none';

      const onPointerMove = (me) => {
        const mpt = me.touches ? me.touches[0] : me;
        const dx = mpt.clientX - startX;
        const dy = mpt.clientY - startY;

        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
          isSwiping = true;
          me.preventDefault();
          const baseOffset = isOpen ? -76 : 0;
          const newX = Math.min(10, Math.max(-130, baseOffset + dx));
          currentTranslateX = newX;
          card.style.transform = `translateX(${newX}px)`;
        }
      };

      const onPointerUp = () => {
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);

        card.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)';

        if (currentTranslateX < -110) {
          deleteProjectItem(proj.id || proj.name, wrapper);
        } else if (currentTranslateX < -35) {
          card.style.transform = 'translateX(-76px)';
          isOpen = true;
        } else {
          card.style.transform = 'translateX(0px)';
          isOpen = false;
        }
      };

      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    };

    card.addEventListener('mousedown', onPointerDown);
    card.addEventListener('touchstart', onPointerDown, { passive: false });

    card.addEventListener('click', () => {
      if (isSwiping) return;
      if (isOpen) {
        card.style.transform = 'translateX(0px)';
        isOpen = false;
        return;
      }
      openProject(proj.name, proj);
    });

    wrapper.appendChild(delBtn);
    wrapper.appendChild(card);
    container.appendChild(wrapper);
  });
}

function deleteProjectItem(idOrName, wrapperEl) {
  if (wrapperEl) {
    wrapperEl.classList.add('deleting');
  }

  setTimeout(() => {
    try {
      let saved = [];
      const raw = localStorage.getItem('fishTool_savedProjects');
      if (raw) saved = JSON.parse(raw);
      saved = saved.filter(p => p.id !== idOrName && p.name !== idOrName);
      localStorage.setItem('fishTool_savedProjects', JSON.stringify(saved));
      localStorage.setItem('fishTool_recentProjects', JSON.stringify(saved));
    } catch (e) {
      console.warn('Could not delete project', e);
    }
    renderRecentProjects();
  }, 260);
}

function saveRecentProject(config) {
  try {
    let projects = [];
    const raw = localStorage.getItem('fishTool_savedProjects') || localStorage.getItem('fishTool_recentProjects');
    if (raw) projects = JSON.parse(raw);
    projects = projects.filter(p => (p.id && config.id) ? p.id !== config.id : p.name !== config.name);
    projects.unshift(config);
    if (projects.length > 20) projects.pop();
    localStorage.setItem('fishTool_savedProjects', JSON.stringify(projects));
    localStorage.setItem('fishTool_recentProjects', JSON.stringify(projects));
  } catch (e) {
    console.warn('Could not save recent projects', e);
  }
}

function openProject(name, config) {
  const id = (config && config.id) ? config.id : ('proj_' + Date.now());
  sessionStorage.setItem('activeProject', name);
  sessionStorage.setItem('activeProjectId', id);
  if (config) {
    sessionStorage.setItem('projectConfig', JSON.stringify(config));
  }
  window.location.href = 'editor.html?project=' + id;
}
