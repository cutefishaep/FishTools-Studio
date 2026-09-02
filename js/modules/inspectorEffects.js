let _currentCatalogCategory = 'all';
let _currentCatalogSearch = '';

function openAddEffectCatalog() {
  const panelEffects = document.getElementById('panelEffects');
  const panelAddEffect = document.getElementById('panelAddEffect');
  const drawer = document.getElementById('layerInspectorDrawer');
  if (!panelAddEffect || !drawer) return;

  if (panelEffects) panelEffects.style.display = 'none';
  panelAddEffect.style.display = 'flex';
  drawer.classList.remove('subpanel-effects');
  drawer.classList.add('subpanel-add-effect', 'subpanel-open', 'in-subpanel');

  _currentCatalogCategory = 'all';
  _currentCatalogSearch = '';

  const inputSearch = document.getElementById('inputEffectCatalogSearch');
  const btnClearSearch = document.getElementById('btnClearEffectCatalogSearch');
  if (inputSearch) {
    inputSearch.value = '';
    if (btnClearSearch) btnClearSearch.style.display = 'none';
  }

  
  const tabs = document.querySelectorAll('#effectCatalogTabs .effect-cat-tab');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.cat === 'all'));

  renderEffectCatalogGrid('all', '');
}
window.openAddEffectCatalog = openAddEffectCatalog;

function closeAddEffectCatalog() {
  const panelEffects = document.getElementById('panelEffects');
  const panelAddEffect = document.getElementById('panelAddEffect');
  const drawer = document.getElementById('layerInspectorDrawer');
  if (!panelAddEffect || !drawer) return;

  panelAddEffect.style.display = 'none';
  if (panelEffects) {
    panelEffects.style.display = 'flex';
    drawer.classList.remove('subpanel-add-effect');
    drawer.classList.add('subpanel-effects', 'subpanel-open', 'in-subpanel');
    const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
    renderAppliedEffectsStack(id);
  } else {
    closeInspectorSubpanel(panelAddEffect);
  }
}
window.closeAddEffectCatalog = closeAddEffectCatalog;

function getEffectIconName(type) {
  switch(type) {
    case 'wave_warp': return 'waves';
    case 'tiles': return 'grid_view';
    case 'swirl': return 'cyclone';
    case 'pinch_bulge': return 'pinch';
    case 'bend': return 'gesture';
    case 'circular_ripple': return 'water';
    case 'mirror': return 'flip';
    case 'pixelate': return 'apps';
    case 'turbulent_displace': return 'grain';
    case 'spherize': return 'lens';
    case 'stretch': return 'fit_screen';
    case 'rgb_split': return 'splitscreen';
    default: return 'auto_fix_high';
  }
}

function renderEffectCatalogGrid(activeCategory = 'all', searchQuery = '') {
  const grid = document.getElementById('effectCatalogGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const catalog = (typeof EFFECTS_CATALOG !== 'undefined') ? EFFECTS_CATALOG : [];
  const q = (searchQuery || '').trim().toLowerCase();

  const filtered = catalog.filter(eff => {
    if (!eff) return false;
    const matchesCat = (activeCategory === 'all' || eff.category === activeCategory);
    const matchesSearch = !q || (eff.name && eff.name.toLowerCase().includes(q)) || (eff.desc && eff.desc.toLowerCase().includes(q)) || (eff.type && eff.type.toLowerCase().includes(q));
    return matchesCat && matchesSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 16px; color: rgba(255,242,194,0.5); text-align: center; gap: 8px;">
        <span class="material-symbols-rounded" style="font-size: 32px; color: rgba(255,242,194,0.3);">search_off</span>
        <span style="font-size: 0.85rem; font-weight: 700;">Tidak ada efek yang cocok</span>
      </div>
    `;
    return;
  }

  filtered.forEach(eff => {
    const card = document.createElement('div');
    card.className = 'effect-catalog-card';
    card.innerHTML = `
      <div class="effect-card-fx-box">FX</div>
      <span class="effect-card-name">${eff.name || eff.type}</span>
    `;

    card.addEventListener('click', () => {
      const currentLayerId = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
      const effects = getLayerEffects(currentLayerId);
      const newEffect = {
        id: 'fx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: eff.type,
        name: eff.name,
        icon: 'FX',
        enabled: true,
        params: JSON.parse(JSON.stringify(eff.defaultParams || {}))
      };
      effects.push(newEffect);
      setLayerEffects(currentLayerId, effects);

      closeAddEffectCatalog();
      applyFillToMeshGlobal(currentLayerId);
      render3D();
      triggerAutoSave();
    });

    grid.appendChild(card);
  });
}




let activeEffectParamChannel = null;
let globalEffectKfController = null;

function getActiveEffectChannel() {
  if (activeEffectParamChannel) return activeEffectParamChannel;
  const activePill = document.querySelector('#appliedEffectsStack .effect-ruler-lbl-pill.active');
  if (activePill && activePill.dataset.channel) {
    return activePill.dataset.channel;
  }
  return null;
}
window.getActiveEffectChannel = getActiveEffectChannel;

function getEffectCurrentValue(layerId, ch) {
  const effects = (typeof getLayerEffects === 'function') ? getLayerEffects(layerId) : [];
  if (!effects || !effects.length) return 0;
  if (!ch) {
    const firstEff = effects[0];
    if (firstEff && firstEff.params) {
      const keys = Object.keys(firstEff.params);
      return keys.length > 0 ? (firstEff.params[keys[0]] || 0) : 0;
    }
    return 0;
  }
  for (const eff of effects) {
    if (!eff || !eff.params) continue;
    if (eff.id && ch.includes(eff.id)) {
      const pKey = ch.split(eff.id + '_')[1];
      if (pKey && eff.params[pKey] !== undefined) return eff.params[pKey];
    }
    if (eff.type && ch.includes(eff.type)) {
      const pKey = ch.split(eff.type + '_')[1];
      if (pKey && eff.params[pKey] !== undefined) return eff.params[pKey];
    }
    const pKey = ch.replace(/^fx_/, '');
    if (eff.params[pKey] !== undefined) return eff.params[pKey];
    for (const k of Object.keys(eff.params)) {
      if (ch.endsWith('_' + k) || ch === ('fx_' + k)) {
        return eff.params[k];
      }
    }
  }
  return 0;
}

function recordEffectKeyframe(id, channel, value) {
  if (!id || !channel) return;
  const kfs = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(id)) || [];
  const hasExistingChannelKf = kfs.some(k => k[channel] !== undefined);
  if (!hasExistingChannelKf) {
    updateEffectKeyframeUI();
    return;
  }
  if (!layerKeyframes.has(id)) layerKeyframes.set(id, []);
  const layerKfList = layerKeyframes.get(id);
  const curTime = (typeof elapsed !== 'undefined') ? elapsed : 0;
  const hasKf = (typeof hasKeyframeForChannel === 'function') ? hasKeyframeForChannel(id, curTime, channel) : false;
  let target = (typeof getKeyframeAt === 'function') ? getKeyframeAt(id, curTime) : null;
  if (hasKf && target) {
    target[channel] = value;
  } else {
    if (!target) {
      target = { time: Math.round(curTime * 100) / 100 };
      layerKfList.push(target);
    }
    target[channel] = value;
    layerKfList.sort((a, b) => a.time - b.time);
  }
  if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
  updateEffectKeyframeUI();
  triggerAutoSave();
}
window.recordEffectKeyframe = recordEffectKeyframe;

function updateEffectKeyframeUI() {
  const diamondBtn = document.getElementById('btnToggleEffectKeyframe');
  if (!diamondBtn) return;
  const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
  const channel = getActiveEffectChannel();
  const curTime = (typeof elapsed !== 'undefined') ? elapsed : 0;
  const hasKf = (channel && typeof hasKeyframeForChannel === 'function') ? hasKeyframeForChannel(id, curTime, channel) : false;
  const symbol = diamondBtn.querySelector('.diamond-icon-symbol');
  if (hasKf) {
    diamondBtn.classList.add('is-on-keyframe');
    if (symbol) symbol.setAttribute('d', 'M7 12 L17 12');
  } else {
    diamondBtn.classList.remove('is-on-keyframe');
    if (symbol) symbol.setAttribute('d', 'M12 7 L12 17 M7 12 L17 12');
  }
}
window.updateEffectKeyframeUI = updateEffectKeyframeUI;

function syncEffectControllersUI(id) {
  if (!id) {
    id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
  }
  const panelEffects = document.getElementById('panelEffects');
  if (!panelEffects || panelEffects.style.display === 'none') return;

  const effects = (typeof getLayerEffects === 'function') ? getLayerEffects(id) : [];
  if (!effects || effects.length === 0) return;

  const kfs = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(id)) || [];
  const curTime = (typeof elapsed !== 'undefined') ? elapsed : 0;

  effects.forEach(eff => {
    if (!eff || !eff.params) return;
    Object.keys(eff.params).forEach(paramKey => {
      const chKey = 'fx_' + eff.id + '_' + paramKey;
      let val = eff.params[paramKey];
      if (kfs.length > 0 && typeof evalKeyframeChannelAtTime === 'function') {
        const c1 = chKey;
        const c2 = 'fx_' + eff.type + '_' + paramKey;
        const c3 = 'fx_' + paramKey;
        if (kfs.some(k => k[c1] !== undefined)) val = evalKeyframeChannelAtTime(kfs, c1, curTime);
        else if (kfs.some(k => k[c2] !== undefined)) val = evalKeyframeChannelAtTime(kfs, c2, curTime);
        else if (kfs.some(k => k[c3] !== undefined)) val = evalKeyframeChannelAtTime(kfs, c3, curTime);
      }
      
      const row = document.querySelector(`#appliedEffectsStack .effect-ruler-lbl-pill[data-channel="${chKey}"]`)?.closest('.effect-ruler-row');
      if (row) {
        const valPill = row.querySelector('.effect-ruler-val-pill');
        if (valPill) {
          const unit = valPill.textContent.replace(/^[-\d.]+/, '');
          valPill.textContent = (Math.round(val * 100) / 100) + unit;
        }
      }
    });
  });
  updateEffectKeyframeUI();
}
window.syncEffectControllersUI = syncEffectControllersUI;

function initEffectsSubpanel() {
  const btnInspEffects = document.getElementById('btnInspEffects');
  const panelEffects = document.getElementById('panelEffects');
  const btnBackEffects = document.getElementById('btnBackFromEffects');
  const btnClearAllEffects = document.getElementById('btnClearAllEffects');
  const btnOpenAddEffect = document.getElementById('btnOpenAddEffectDrawer') || document.getElementById('btnOpenAddEffectPopover');
  const btnBackFromAddEffect = document.getElementById('btnBackFromAddEffect');
  const inputSearch = document.getElementById('inputEffectCatalogSearch');
  const btnClearSearch = document.getElementById('btnClearEffectCatalogSearch');
  const btnKf = document.getElementById('btnToggleEffectKeyframe');
  const btnGraph = document.getElementById('btnEffectGraph');

  function getOrSelectTargetChannel() {
    let ch = getActiveEffectChannel();
    if (!ch) {
      const firstPill = document.querySelector('#appliedEffectsStack .effect-ruler-lbl-pill');
      if (firstPill && firstPill.dataset.channel) {
        document.querySelectorAll('#appliedEffectsStack .effect-ruler-lbl-pill').forEach(p => p.classList.remove('active'));
        firstPill.classList.add('active');
        activeEffectParamChannel = firstPill.dataset.channel;
        ch = activeEffectParamChannel;
      }
    }
    return ch;
  }

  function handleEffectKeyframeToggle() {
    const ch = getOrSelectTargetChannel();
    if (!ch) return;

    const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
    const curTime = (typeof elapsed !== 'undefined') ? elapsed : 0;
    const val = getEffectCurrentValue(id, ch);
    if (!layerKeyframes.has(id)) layerKeyframes.set(id, []);
    const kfs = layerKeyframes.get(id);
    const hasKf = (typeof hasKeyframeForChannel === 'function') ? hasKeyframeForChannel(id, curTime, ch) : false;

    if (hasKf) {
      const target = (typeof getKeyframeAt === 'function') ? getKeyframeAt(id, curTime) : null;
      if (target) {
        delete target[ch];
        const remainingProps = Object.keys(target).filter(k => k !== 'time' && !k.startsWith('easing_') && !k.startsWith('expression_'));
        if (remainingProps.length === 0) {
          const idx = kfs.indexOf(target);
          if (idx !== -1) kfs.splice(idx, 1);
        }
      }
    } else {
      let target = (typeof getKeyframeAt === 'function') ? getKeyframeAt(id, curTime) : null;
      if (!target) {
        target = { time: Math.round(curTime * 100) / 100 };
        kfs.push(target);
      }
      target[ch] = val;
      kfs.sort((a, b) => a.time - b.time);
    }
    if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
    updateEffectKeyframeUI();
    triggerAutoSave();
  }

  function handleEffectGraphOpen() {
    const ch = getOrSelectTargetChannel();
    if (!ch) return;
    const anchor = document.getElementById('btnEffectGraph');
    if (typeof openGraphEditor === 'function') {
      openGraphEditor(ch, anchor);
    }
  }

  
  if (btnKf) {
    btnKf.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleEffectKeyframeToggle();
    };
  }
  if (btnGraph) {
    btnGraph.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleEffectGraphOpen();
    };
  }

  if (btnInspEffects && panelEffects) {
    btnInspEffects.addEventListener('click', (e) => {
      e.stopPropagation();
      activeEffectParamChannel = null; 
      openInspectorSubpanel(panelEffects, 'subpanel-effects', () => {
        const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
        renderAppliedEffectsStack(id);
        updateEffectKeyframeUI();
      });
    });
  }

  if (btnBackEffects && panelEffects) {
    btnBackEffects.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInspectorSubpanel(panelEffects);
    });
  }

  if (btnClearAllEffects) {
    btnClearAllEffects.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      setLayerEffects(id, []);
      activeEffectParamChannel = null;

      
      if (layerKeyframes.has(id)) {
        const kfs = layerKeyframes.get(id);
        kfs.forEach(k => {
          Object.keys(k).forEach(prop => {
            if (prop.startsWith('fx_') || prop.startsWith('easing_fx_')) {
              delete k[prop];
            }
          });
        });
        for (let i = kfs.length - 1; i >= 0; i--) {
          const remainingProps = Object.keys(kfs[i]).filter(p => p !== 'time' && !p.startsWith('easing_') && !p.startsWith('expression_'));
          if (remainingProps.length === 0) {
            kfs.splice(i, 1);
          }
        }
      }

      renderAppliedEffectsStack(id);
      if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
      applyFillToMeshGlobal(id);
      render3D();
      triggerAutoSave();
      updateEffectKeyframeUI();
    });
  }

  if (btnOpenAddEffect) {
    btnOpenAddEffect.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddEffectCatalog();
    });
  }

  if (btnBackFromAddEffect) {
    btnBackFromAddEffect.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAddEffectCatalog();
    });
  }

  
  if (inputSearch) {
    inputSearch.addEventListener('input', (e) => {
      _currentCatalogSearch = e.target.value;
      if (btnClearSearch) {
        btnClearSearch.style.display = _currentCatalogSearch.length > 0 ? 'flex' : 'none';
      }
      renderEffectCatalogGrid(_currentCatalogCategory, _currentCatalogSearch);
    });
  }

  if (btnClearSearch && inputSearch) {
    btnClearSearch.addEventListener('click', (e) => {
      e.stopPropagation();
      inputSearch.value = '';
      _currentCatalogSearch = '';
      btnClearSearch.style.display = 'none';
      renderEffectCatalogGrid(_currentCatalogCategory, '');
      inputSearch.focus();
    });
  }

  
  const tabsContainer = document.getElementById('effectCatalogTabs');
  if (tabsContainer) {
    tabsContainer.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.effect-cat-tab');
      if (!tabBtn) return;
      e.stopPropagation();

      tabsContainer.querySelectorAll('.effect-cat-tab').forEach(t => t.classList.remove('active'));
      tabBtn.classList.add('active');

      _currentCatalogCategory = tabBtn.dataset.cat || 'all';
      renderEffectCatalogGrid(_currentCatalogCategory, _currentCatalogSearch);
    });
  }
}

function renderAppliedEffectsStack(layerId) {
  const stack = document.getElementById('appliedEffectsStack');
  if (!stack) return;
  stack.innerHTML = '';

  const effects = (typeof getLayerEffects === 'function') ? getLayerEffects(layerId) : [];

  if (effects.length === 0) {
    stack.innerHTML = `
      <div style="text-align:center; padding: 36px 16px; color: rgba(255,242,194,0.6); font-size: 0.84rem; font-style: italic;">
        Belum ada efek pada layer ini.<br>Klik tombol <strong>+</strong> di pojok kanan atas untuk menambahkan.
      </div>
    `;
    updateEffectKeyframeUI();
    return;
  }

  effects.forEach((eff, idx) => {
    const card = document.createElement('div');
    card.className = 'applied-effect-card' + (eff.enabled ? '' : ' disabled');

    
    const header = document.createElement('div');
    header.className = 'effect-card-header';
    header.innerHTML = `
      <div class="effect-header-left">
        <div class="effect-fx-badge">FX</div>
        <span class="effect-card-title">${eff.name}</span>
      </div>
      <div class="effect-header-actions">
        <button type="button" class="effect-action-btn btn-toggle-fx" title="${eff.enabled ? 'Nonaktifkan Efek' : 'Aktifkan Efek'}">
          <span class="material-symbols-rounded" style="font-size:18px;">${eff.enabled ? 'visibility' : 'visibility_off'}</span>
        </button>
        <button type="button" class="effect-action-btn btn-delete-effect" title="Hapus Efek">
          <span class="material-symbols-rounded" style="font-size:18px;">delete</span>
        </button>
      </div>
    `;

    const btnToggle = header.querySelector('.btn-toggle-fx');
    btnToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      eff.enabled = !eff.enabled;
      card.classList.toggle('disabled', !eff.enabled);
      btnToggle.innerHTML = `<span class="material-symbols-rounded" style="font-size:18px;">${eff.enabled ? 'visibility' : 'visibility_off'}</span>`;
      applyFillToMeshGlobal(layerId);
      render3D();
      triggerAutoSave();
    });

    const btnDelete = header.querySelector('.btn-delete-effect');
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      const removedEff = effects.splice(idx, 1)[0];
      setLayerEffects(layerId, effects);

      
      if (removedEff && layerKeyframes.has(layerId)) {
        const kfs = layerKeyframes.get(layerId);
        const effId = removedEff.id;
        const effType = removedEff.type;
        kfs.forEach(k => {
          Object.keys(k).forEach(prop => {
            if (prop.startsWith('fx_' + effId + '_') || prop.startsWith('fx_' + effType + '_') || prop.startsWith('easing_fx_' + effId + '_') || prop.startsWith('easing_fx_' + effType + '_')) {
              delete k[prop];
            }
          });
        });
        for (let i = kfs.length - 1; i >= 0; i--) {
          const remainingProps = Object.keys(kfs[i]).filter(p => p !== 'time' && !p.startsWith('easing_') && !p.startsWith('expression_'));
          if (remainingProps.length === 0) {
            kfs.splice(i, 1);
          }
        }
      }

      if (activeEffectParamChannel && (activeEffectParamChannel.includes(eff.id) || activeEffectParamChannel.includes(eff.type))) {
        activeEffectParamChannel = null;
      }

      renderAppliedEffectsStack(layerId);
      if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
      applyFillToMeshGlobal(layerId);
      render3D();
      triggerAutoSave();
      updateEffectKeyframeUI();
    });

    card.appendChild(header);

    
    const body = document.createElement('div');
    body.className = 'effect-card-body';
    eff.params = eff.params || {};
    const p = eff.params;

    const effDef = (typeof FishEffects !== 'undefined' && FishEffects.getEffectDefinition) 
      ? FishEffects.getEffectDefinition(eff.type) 
      : ((typeof EFFECTS_CATALOG !== 'undefined') ? EFFECTS_CATALOG.find(e => e.type === eff.type) : null);

    if (effDef && effDef.paramsConfig && effDef.paramsConfig.length) {
      effDef.paramsConfig.forEach(cfg => {
        const val = p[cfg.id] !== undefined ? p[cfg.id] : (effDef.defaultParams ? effDef.defaultParams[cfg.id] : 0);
        const channelKey = 'fx_' + eff.id + '_' + cfg.id;
        if (cfg.type === 'color' || cfg.id === 'color' || cfg.id === 'color1' || cfg.id === 'color2' || cfg.id === 'tint') {
          body.appendChild(createEffectColorPickerRow(cfg.id, cfg.label || cfg.id, val || '#FFFFFF', (c) => {
            p[cfg.id] = c;
          }, eff.id, channelKey));
        } else {
          body.appendChild(createEffectRulerRow(cfg.id, cfg.label || cfg.id, cfg.min, cfg.max, val, cfg.step || 1, cfg.unit || '', (v) => {
            p[cfg.id] = v;
          }, eff.id, channelKey));
        }
      });
    } else {
      if (eff.type === 'copy_background') {
        body.appendChild(createEffectRulerRow('opacity', 'Opasitas', 0, 100, p.opacity !== undefined ? p.opacity : 100, 1, '%', (v) => { p.opacity = v; }, eff.id, 'fx_' + eff.id + '_opacity'));
      } else if (eff.type === 'gaussian_blur') {
        body.appendChild(createEffectRulerRow('strength', 'Kekuatan', 0, 80, p.strength !== undefined ? p.strength : 12, 1, 'px', (v) => { p.strength = v; }, eff.id, 'fx_' + eff.id + '_strength'));
      } else if (eff.type === 'hue_saturation') {
        body.appendChild(createEffectRulerRow('hue', 'Hue', -180, 180, p.hue || 0, 1, '°', (v) => { p.hue = v; }, eff.id, 'fx_' + eff.id + '_hue'));
        body.appendChild(createEffectRulerRow('saturation', 'Saturasi', 0, 300, p.saturation !== undefined ? p.saturation : 100, 5, '%', (v) => { p.saturation = v; }, eff.id, 'fx_' + eff.id + '_saturation'));
        body.appendChild(createEffectRulerRow('lightness', 'Kecerahan', 0, 200, p.lightness !== undefined ? p.lightness : 100, 5, '%', (v) => { p.lightness = v; }, eff.id, 'fx_' + eff.id + '_lightness'));
      } else if (eff.type === 'brightness_contrast') {
        body.appendChild(createEffectRulerRow('brightness', 'Brightness', 0, 250, p.brightness !== undefined ? p.brightness : 100, 5, '%', (v) => { p.brightness = v; }, eff.id, 'fx_' + eff.id + '_brightness'));
        body.appendChild(createEffectRulerRow('contrast', 'Contrast', 0, 250, p.contrast !== undefined ? p.contrast : 100, 5, '%', (v) => { p.contrast = v; }, eff.id, 'fx_' + eff.id + '_contrast'));
      } else if (eff.type === 'lightglow' || eff.type === 'glow') {
        body.appendChild(createEffectRulerRow('strength', 'Strength', 0, 2, p.strength !== undefined ? p.strength : (p.radius ? p.radius/20 : 0.25), 0.01, '', (v) => { p.strength = v; }, eff.id, 'fx_' + eff.id + '_strength'));
        body.appendChild(createEffectRulerRow('threshold', 'Threshold', 0, 1, p.threshold !== undefined ? p.threshold : 0.5, 0.01, '', (v) => { p.threshold = v; }, eff.id, 'fx_' + eff.id + '_threshold'));
        body.appendChild(createEffectRulerRow('intensity', 'Intensity', 0, 5, p.intensity !== undefined ? p.intensity : 1.0, 0.01, '', (v) => { p.intensity = v; }, eff.id, 'fx_' + eff.id + '_intensity'));
        body.appendChild(createEffectColorPickerRow('color', 'Warna Glow', p.color || '#ff5566', (c) => { p.color = c; }, eff.id, 'fx_' + eff.id + '_color'));
        body.appendChild(createEffectRulerRow('alpha', 'Alpha', 0, 1, p.alpha !== undefined ? p.alpha : 0.75, 0.01, '', (v) => { p.alpha = v; }, eff.id, 'fx_' + eff.id + '_alpha'));
      } else if (eff.type === 'gradient_overlay') {
        body.appendChild(createEffectColorPickerRow('color1', 'Warna 1', p.color1 || '#ffffff', (c) => { p.color1 = c; }, eff.id, 'fx_' + eff.id + '_color1'));
        body.appendChild(createEffectColorPickerRow('color2', 'Warna 2', p.color2 || '#000000', (c) => { p.color2 = c; }, eff.id, 'fx_' + eff.id + '_color2'));
        body.appendChild(createEffectRulerRow('angle', 'Angle', -360, 360, p.angle || 0, 1, '°', (v) => { p.angle = v; }, eff.id, 'fx_' + eff.id + '_angle'));
        body.appendChild(createEffectRulerRow('scale', 'Scale', 0.1, 5, p.scale !== undefined ? p.scale : 1.0, 0.01, '', (v) => { p.scale = v; }, eff.id, 'fx_' + eff.id + '_scale'));
        body.appendChild(createEffectRulerRow('alpha', 'Alpha', 0, 1, p.alpha !== undefined ? p.alpha : 1.0, 0.01, '', (v) => { p.alpha = v; }, eff.id, 'fx_' + eff.id + '_alpha'));
      } else if (eff.type === 'vignette') {
        body.appendChild(createEffectRulerRow('radius', 'Radius', 10, 100, p.radius || 50, 1, '%', (v) => { p.radius = v; }, eff.id, 'fx_' + eff.id + '_radius'));
        body.appendChild(createEffectRulerRow('feather', 'Feather', 0, 100, p.feather !== undefined ? p.feather : 50, 1, '%', (v) => { p.feather = v; }, eff.id, 'fx_' + eff.id + '_feather'));
        body.appendChild(createEffectColorPickerRow('color', 'Warna', p.color || '#000000', (c) => { p.color = c; }, eff.id, 'fx_' + eff.id + '_color'));
      } else if (eff.type === 'tint' || eff.type === 'solid_color') {
        body.appendChild(createEffectColorPickerRow('color', 'Warna Tint', p.color || p.tint || '#FAB778', (c) => { p.color = c; p.tint = c; }, eff.id, 'fx_' + eff.id + '_color'));
        body.appendChild(createEffectRulerRow('amount', 'Intensitas', 0, 100, p.amount !== undefined ? p.amount : (p.intensity ? p.intensity*100 : 100), 1, '%', (v) => { p.amount = v; p.intensity = v/100; }, eff.id, 'fx_' + eff.id + '_amount'));
      } else if (eff.type === 'grayscale' || eff.type === 'invert' || eff.type === 'sepia') {
        body.appendChild(createEffectRulerRow('amount', 'Intensitas', 0, 100, p.amount !== undefined ? p.amount : 100, 1, '%', (v) => { p.amount = v; }, eff.id, 'fx_' + eff.id + '_amount'));
      } else if (eff.type === 'drop_shadow') {
        body.appendChild(createEffectRulerRow('size', 'Ukuran', 0, 50, p.size || 12, 1, 'px', (v) => { p.size = v; }, eff.id, 'fx_' + eff.id + '_size'));
        body.appendChild(createEffectColorPickerRow('color', 'Warna Shadow', p.color || '#000000', (c) => { p.color = c; }, eff.id, 'fx_' + eff.id + '_color'));
      }
    }

    function createEffectColorPickerRow(paramId, label, val, onChange, effId, channelKey) {
      const row = document.createElement('div');
      row.className = 'effect-ruler-row';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';

      const chKey = channelKey || ('fx_' + (effId || 'fx') + '_' + paramId);

      const lbl = document.createElement('div');
      lbl.className = 'effect-ruler-lbl-pill selectable';
      lbl.textContent = label;
      lbl.dataset.channel = chKey;
      lbl.dataset.param = paramId;
      lbl.dataset.effectId = effId || '';

      if (activeEffectParamChannel && activeEffectParamChannel === chKey) {
        lbl.classList.add('active');
      }

      lbl.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasActive = lbl.classList.contains('active');
        document.querySelectorAll('#appliedEffectsStack .effect-ruler-lbl-pill').forEach(p => p.classList.remove('active'));
        if (!wasActive) {
          lbl.classList.add('active');
          activeEffectParamChannel = chKey;
        } else {
          activeEffectParamChannel = null;
        }
        updateEffectKeyframeUI();
        if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
      });

      const colorBtnContainer = document.createElement('div');
      colorBtnContainer.style.flex = '1';
      colorBtnContainer.style.display = 'flex';
      colorBtnContainer.style.alignItems = 'center';
      colorBtnContainer.style.gap = '10px';
      colorBtnContainer.style.padding = '0 6px';

      const colorThumb = document.createElement('div');
      colorThumb.className = 'effect-color-thumb';
      colorThumb.style.width = '38px';
      colorThumb.style.height = '24px';
      colorThumb.style.borderRadius = '6px';
      colorThumb.style.border = '2px solid rgba(255, 242, 194, 0.4)';
      colorThumb.style.backgroundColor = val || '#FFFFFF';
      colorThumb.style.cursor = 'pointer';
      colorThumb.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';

      const hexVal = document.createElement('div');
      hexVal.style.fontSize = '0.78rem';
      hexVal.style.fontWeight = '700';
      hexVal.style.color = 'var(--col-cream, #FFF2C2)';
      hexVal.style.fontFamily = 'monospace';
      hexVal.textContent = (String(val || '#FFFFFF')).toUpperCase();

      colorThumb.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('#appliedEffectsStack .effect-ruler-lbl-pill').forEach(p => p.classList.remove('active'));
        lbl.classList.add('active');
        activeEffectParamChannel = chKey;

        if (typeof openGlobalColorPicker === 'function') {
          openGlobalColorPicker({
            anchorElement: colorThumb,
            anchor: colorThumb,
            color: val || '#FFFFFF',
            initialColor: val || '#FFFFFF',
            onChange: (colorData) => {
              const newHex = (typeof colorData === 'string') ? colorData : (colorData && colorData.hex ? colorData.hex : '#FFFFFF');
              val = newHex;
              colorThumb.style.backgroundColor = newHex;
              hexVal.textContent = String(newHex).toUpperCase();
              onChange(newHex);
              recordEffectKeyframe(layerId, chKey, newHex);
              if (typeof setLayerEffects === 'function') setLayerEffects(layerId, effects);
              if (typeof updateLayerEffectsFast === 'function') updateLayerEffectsFast(layerId);
              if (typeof applyFillToMeshGlobal === 'function') applyFillToMeshGlobal(layerId, true);
              if (typeof render3D === 'function') render3D();
              triggerAutoSave();
              updateEffectKeyframeUI();
            }
          });
        }
      });

      colorBtnContainer.appendChild(colorThumb);
      colorBtnContainer.appendChild(hexVal);

      row.appendChild(lbl);
      row.appendChild(colorBtnContainer);

      return row;
    }

    function createEffectRulerRow(paramId, label, min, max, val, step, unit, onChange, effId, channelKey) {
      const row = document.createElement('div');
      row.className = 'effect-ruler-row';

      const chKey = channelKey || ('fx_' + (effId || 'fx') + '_' + paramId);

      const lbl = document.createElement('div');
      lbl.className = 'effect-ruler-lbl-pill selectable';
      lbl.textContent = label;
      lbl.dataset.channel = chKey;
      lbl.dataset.param = paramId;
      lbl.dataset.effectId = effId || '';

      
      if (activeEffectParamChannel && activeEffectParamChannel === chKey) {
        lbl.classList.add('active');
      }

      lbl.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasActive = lbl.classList.contains('active');
        document.querySelectorAll('#appliedEffectsStack .effect-ruler-lbl-pill').forEach(p => p.classList.remove('active'));
        if (!wasActive) {
          lbl.classList.add('active');
          activeEffectParamChannel = chKey;
        } else {
          activeEffectParamChannel = null;
        }
        updateEffectKeyframeUI();
        if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
      });

      const rulerTrack = document.createElement('div');
      rulerTrack.className = 'effect-ruler-track';

      const centerMark = document.createElement('div');
      centerMark.className = 'controller-center-mark-w';
      rulerTrack.appendChild(centerMark);

      const valPill = document.createElement('div');
      valPill.className = 'effect-ruler-val-pill';
      valPill.textContent = val + (unit || '');

      row.appendChild(lbl);
      row.appendChild(rulerTrack);
      row.appendChild(valPill);

      if (window.FishUI && window.FishUI.createRuler) {
        const minVal = (min !== undefined && min !== -Infinity) ? min : -1000;
        const maxVal = (max !== undefined && max !== Infinity) ? max : 1000;
        const range = Math.max(1, maxVal - minVal);
        
        let sens = 0.5;
        if (step && step <= 0.01) {
          sens = 0.005;
        } else if (step && step < 1) {
          sens = 0.05;
        } else if (range > 1000) {
          sens = Math.min(2.5, Math.max(0.2, range / 500));
        } else {
          sens = Math.max(0.08, range / 280);
        }

        const decimals = (step && step < 1) ? Math.min(3, (String(step).split('.')[1] || '').length) : 0;

        window.FishUI.createRuler({
          container: rulerTrack,
          min: minVal,
          max: maxVal,
          value: val,
          step: step || 1,
          sensitivity: sens,
          onChange: (v) => {
            const formatted = decimals > 0 ? Number(v.toFixed(decimals)) : Math.round(v);
            valPill.textContent = formatted + (unit || '');
            
            
            document.querySelectorAll('#appliedEffectsStack .effect-ruler-lbl-pill').forEach(p => p.classList.remove('active'));
            lbl.classList.add('active');
            activeEffectParamChannel = chKey;

            onChange(formatted);
            recordEffectKeyframe(layerId, chKey, formatted);

            if (typeof setLayerEffects === 'function') {
              setLayerEffects(layerId, effects);
            }
            if (typeof updateLayerEffectsFast === 'function') {
              updateLayerEffectsFast(layerId);
            }
            if (typeof applyFillToMeshGlobal === 'function') {
              applyFillToMeshGlobal(layerId, true);
            }
            if (typeof render3D === 'function') {
              render3D();
            }
            triggerAutoSave();
            updateEffectKeyframeUI();
          }
        });
      }

      return row;
    }

    card.appendChild(body);
    stack.appendChild(card);
  });
  updateEffectKeyframeUI();
}

window.openAddEffectCatalog = openAddEffectCatalog;
window.closeAddEffectCatalog = closeAddEffectCatalog;
window.getEffectIconName = getEffectIconName;
window.renderEffectCatalogGrid = renderEffectCatalogGrid;
window.getActiveEffectChannel = getActiveEffectChannel;
window.getEffectCurrentValue = getEffectCurrentValue;
window.recordEffectKeyframe = recordEffectKeyframe;
window.updateEffectKeyframeUI = updateEffectKeyframeUI;
window.syncEffectControllersUI = syncEffectControllersUI;
window.initEffectsSubpanel = initEffectsSubpanel;
window.renderAppliedEffectsStack = renderAppliedEffectsStack;

if (typeof document !== "undefined") {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(initEffectsSubpanel, 50);
  } else {
    document.addEventListener("DOMContentLoaded", initEffectsSubpanel);
  }
}
