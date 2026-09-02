let _dynamicGoogleFontsCatalog = null;
let _isFetchingGoogleFontsCatalog = false;

async function getGoogleFontsCatalog() {
  if (_dynamicGoogleFontsCatalog && _dynamicGoogleFontsCatalog.length > 0) {
    return _dynamicGoogleFontsCatalog;
  }
  if (_isFetchingGoogleFontsCatalog) {
    while (_isFetchingGoogleFontsCatalog) {
      await new Promise(r => setTimeout(r, 80));
    }
    return _dynamicGoogleFontsCatalog || [];
  }

  _isFetchingGoogleFontsCatalog = true;
  try {
    const res = await fetch('https://raw.githubusercontent.com/jonathantneal/google-fonts-complete/master/google-fonts.json');
    if (res.ok) {
      const data = await res.json();
      const list = Object.keys(data).map(fontName => {
        const item = data[fontName] || {};
        let cat = item.category || 'sans-serif';
        if (cat !== 'display' && cat !== 'handwriting' && cat !== 'monospace' && cat !== 'serif' && cat !== 'sans-serif') {
          cat = 'sans-serif';
        }
        return {
          name: fontName,
          category: cat,
          preview: fontName
        };
      });
      if (list && list.length > 50) {
        _dynamicGoogleFontsCatalog = list;
        _isFetchingGoogleFontsCatalog = false;
        return _dynamicGoogleFontsCatalog;
      }
    }
  } catch (err) {
    console.warn('Online Google Fonts catalog fetch failed, loading comprehensive built-in catalog', err);
  }

  
  _dynamicGoogleFontsCatalog = [
    
    { name: 'Poppins', category: 'sans-serif', preview: 'Poppins' },
    { name: 'Montserrat', category: 'sans-serif', preview: 'Montserrat' },
    { name: 'Plus Jakarta Sans', category: 'sans-serif', preview: 'Plus Jakarta Sans' },
    { name: 'Inter', category: 'sans-serif', preview: 'Inter' },
    { name: 'Roboto', category: 'sans-serif', preview: 'Roboto' },
    { name: 'Open Sans', category: 'sans-serif', preview: 'Open Sans' },
    { name: 'Lato', category: 'sans-serif', preview: 'Lato' },
    { name: 'Oswald', category: 'sans-serif', preview: 'Oswald' },
    { name: 'Raleway', category: 'sans-serif', preview: 'Raleway' },
    { name: 'Nunito', category: 'sans-serif', preview: 'Nunito' },
    { name: 'Rubik', category: 'sans-serif', preview: 'Rubik' },
    { name: 'Work Sans', category: 'sans-serif', preview: 'Work Sans' },
    { name: 'DM Sans', category: 'sans-serif', preview: 'DM Sans' },
    { name: 'Outfit', category: 'sans-serif', preview: 'Outfit' },
    { name: 'Ubuntu', category: 'sans-serif', preview: 'Ubuntu' },
    { name: 'Quicksand', category: 'sans-serif', preview: 'Quicksand' },
    { name: 'Manrope', category: 'sans-serif', preview: 'Manrope' },
    { name: 'Barlow', category: 'sans-serif', preview: 'Barlow' },
    { name: 'Josefin Sans', category: 'sans-serif', preview: 'Josefin Sans' },
    { name: 'Kanit', category: 'sans-serif', preview: 'Kanit' },
    { name: 'Space Grotesk', category: 'sans-serif', preview: 'Space Grotesk' },
    { name: 'Sora', category: 'sans-serif', preview: 'Sora' },

    
    { name: 'Playfair Display', category: 'serif', preview: 'Playfair Display' },
    { name: 'Merriweather', category: 'serif', preview: 'Merriweather' },
    { name: 'Lora', category: 'serif', preview: 'Lora' },
    { name: 'PT Serif', category: 'serif', preview: 'PT Serif' },
    { name: 'Cinzel', category: 'serif', preview: 'Cinzel' },
    { name: 'Cormorant Garamond', category: 'serif', preview: 'Cormorant Garamond' },
    { name: 'EB Garamond', category: 'serif', preview: 'EB Garamond' },
    { name: 'Bitter', category: 'serif', preview: 'Bitter' },
    { name: 'Spectral', category: 'serif', preview: 'Spectral' },
    { name: 'Bodoni Moda', category: 'serif', preview: 'Bodoni Moda' },
    { name: 'Libre Baskerville', category: 'serif', preview: 'Libre Baskerville' },
    { name: 'DM Serif Display', category: 'serif', preview: 'DM Serif Display' },
    { name: 'Fraunces', category: 'serif', preview: 'Fraunces' },

    
    { name: 'Bebas Neue', category: 'display', preview: 'Bebas Neue' },
    { name: 'Anton', category: 'display', preview: 'Anton' },
    { name: 'Bangers', category: 'display', preview: 'Bangers' },
    { name: 'Righteous', category: 'display', preview: 'Righteous' },
    { name: 'Alfa Slab One', category: 'display', preview: 'Alfa Slab One' },
    { name: 'Lobster', category: 'display', preview: 'Lobster' },
    { name: 'Abril Fatface', category: 'display', preview: 'Abril Fatface' },
    { name: 'Permanent Marker', category: 'display', preview: 'Permanent Marker' },
    { name: 'Shrikhand', category: 'display', preview: 'Shrikhand' },
    { name: 'Russo One', category: 'display', preview: 'Russo One' },
    { name: 'Fredoka One', category: 'display', preview: 'Fredoka One' },
    { name: 'Audiowide', category: 'display', preview: 'Audiowide' },
    { name: 'Press Start 2P', category: 'display', preview: 'Press Start 2P' },
    { name: 'Luckiest Guy', category: 'display', preview: 'Luckiest Guy' },
    { name: 'Staatliches', category: 'display', preview: 'Staatliches' },
    { name: 'Chango', category: 'display', preview: 'Chango' },

    
    { name: 'Caveat', category: 'handwriting', preview: 'Caveat' },
    { name: 'Dancing Script', category: 'handwriting', preview: 'Dancing Script' },
    { name: 'Pacifico', category: 'handwriting', preview: 'Pacifico' },
    { name: 'Great Vibes', category: 'handwriting', preview: 'Great Vibes' },
    { name: 'Sacramento', category: 'handwriting', preview: 'Sacramento' },
    { name: 'Satisfy', category: 'handwriting', preview: 'Satisfy' },
    { name: 'Indie Flower', category: 'handwriting', preview: 'Indie Flower' },
    { name: 'Shadows Into Light', category: 'handwriting', preview: 'Shadows Into Light' },
    { name: 'Kaushan Script', category: 'handwriting', preview: 'Kaushan Script' },
    { name: 'Alex Brush', category: 'handwriting', preview: 'Alex Brush' },
    { name: 'Rock Salt', category: 'handwriting', preview: 'Rock Salt' },
    { name: 'Allura', category: 'handwriting', preview: 'Allura' },
    { name: 'Parisienne', category: 'handwriting', preview: 'Parisienne' },

    
    { name: 'JetBrains Mono', category: 'monospace', preview: 'JetBrains Mono' },
    { name: 'Fira Code', category: 'monospace', preview: 'Fira Code' },
    { name: 'Roboto Mono', category: 'monospace', preview: 'Roboto Mono' },
    { name: 'Source Code Pro', category: 'monospace', preview: 'Source Code Pro' },
    { name: 'Space Mono', category: 'monospace', preview: 'Space Mono' },
    { name: 'Inconsolata', category: 'monospace', preview: 'Inconsolata' },
    { name: 'IBM Plex Mono', category: 'monospace', preview: 'IBM Plex Mono' },
    { name: 'VT323', category: 'monospace', preview: 'VT323' },
    { name: 'Share Tech Mono', category: 'monospace', preview: 'Share Tech Mono' }
  ];

  _isFetchingGoogleFontsCatalog = false;
  return _dynamicGoogleFontsCatalog;
}

function openFontGalleryPopover(anchorEl, currentFont, onSelectFont) {
  let card = document.createElement('div');
  card.className = 'fish-font-gallery-popover-card';

  card.innerHTML = `
    <div class="font-gallery-search-row">
      <span class="material-symbols-rounded" style="font-size:18px; color:var(--col-yellow); opacity:0.7;">search</span>
      <input type="text" class="font-gallery-search-input" id="fontSearchInput" placeholder="Cari seluruh font Google...">
    </div>
    <div class="font-gallery-cats-row" id="fontCategoryTabs">
      <button type="button" class="font-cat-pill active" data-cat="all">Semua</button>
      <button type="button" class="font-cat-pill" data-cat="sans-serif">Sans-Serif</button>
      <button type="button" class="font-cat-pill" data-cat="serif">Serif</button>
      <button type="button" class="font-cat-pill" data-cat="display">Display</button>
      <button type="button" class="font-cat-pill" data-cat="handwriting">Handwriting</button>
      <button type="button" class="font-cat-pill" data-cat="monospace">Monospace</button>
    </div>
    <div class="font-gallery-list" id="fontGalleryList">
      <div style="color:rgba(255,242,194,0.6); font-size:0.78rem; text-align:center; padding:24px; font-weight:600;">
        <span class="material-symbols-rounded" style="font-size:24px; animation:spin 1s linear infinite; display:block; margin:0 auto 6px auto;">progress_activity</span>
        Memuat katalog Google Fonts...
      </div>
    </div>
  `;

  const listEl = card.querySelector('#fontGalleryList');
  const searchInput = card.querySelector('#fontSearchInput');
  const catTabs = card.querySelector('#fontCategoryTabs');

  let activeCat = 'all';
  let searchQuery = '';
  let fullCatalog = [];
  let pageLimit = 40;
  let isUnloaded = false;

  function renderList() {
    if (isUnloaded || !listEl) return;
    listEl.innerHTML = '';

    const filtered = fullCatalog.filter(f => {
      const matchCat = (activeCat === 'all' || f.category === activeCat);
      const matchQuery = !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchQuery;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="color:rgba(255,242,194,0.5); font-size:0.75rem; text-align:center; padding:20px;">Tidak ada font "${searchQuery}" ditemukan</div>`;
      return;
    }

    const itemsToRender = filtered.slice(0, pageLimit);
    itemsToRender.forEach(font => {
      const item = document.createElement('div');
      const isCur = (font.name.toLowerCase() === (currentFont || '').toLowerCase());
      item.className = 'font-gallery-item' + (isCur ? ' active' : '');

      item.innerHTML = `
        <div class="font-item-meta">
          <span class="font-item-name">${font.name}</span>
          <span class="font-item-sample">${font.preview || font.name}</span>
        </div>
        ${isCur ? '<span class="material-symbols-rounded" style="font-size:18px; color:var(--col-yellow);">check</span>' : ''}
      `;

      item.addEventListener('mouseenter', () => {
        if (typeof loadGoogleFont === 'function') {
          loadGoogleFont(font.name).then(() => {
            const nameSpan = item.querySelector('.font-item-name');
            const sampleSpan = item.querySelector('.font-item-sample');
            if (nameSpan) nameSpan.style.fontFamily = `'${font.name}', sans-serif`;
            if (sampleSpan) sampleSpan.style.fontFamily = `'${font.name}', sans-serif`;
          });
        }
      });

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof loadGoogleFont === 'function') {
          loadGoogleFont(font.name).then(() => {
            if (onSelectFont) onSelectFont(font.name);
            if (window.FishPopover) window.FishPopover.close();
          });
        } else {
          if (onSelectFont) onSelectFont(font.name);
          if (window.FishPopover) window.FishPopover.close();
        }
      });

      listEl.appendChild(item);
    });

    if (filtered.length > pageLimit) {
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.type = 'button';
      loadMoreBtn.style.cssText = 'background:rgba(255,242,194,0.12); border:1px solid rgba(255,242,194,0.2); color:#FFF2C2; border-radius:8px; padding:6px; font-size:0.75rem; font-weight:700; cursor:pointer; margin:4px 0;';
      loadMoreBtn.textContent = `Muat lebih banyak (${filtered.length - pageLimit} font tersisa)`;
      loadMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pageLimit += 40;
        renderList();
      });
      listEl.appendChild(loadMoreBtn);
    }
  }

  
  getGoogleFontsCatalog().then(cat => {
    if (isUnloaded) return;
    fullCatalog = cat || [];
    renderList();
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      pageLimit = 40;
      renderList();
    });
  }

  if (catTabs) {
    catTabs.querySelectorAll('.font-cat-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        catTabs.querySelectorAll('.font-cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeCat = pill.dataset.cat;
        pageLimit = 40;
        renderList();
      });
    });
  }

  if (window.FishPopover) {
    window.FishPopover.show({
      anchorElement: anchorEl,
      content: card,
      className: 'fish-font-popover-wrapper',
      onClose: () => {
        
        isUnloaded = true;
        fullCatalog = [];
        if (card) {
          card.innerHTML = '';
          card = null;
        }
      }
    });
  }
}

function initEditTextSubpanel() {
  const btnInspEditText = document.getElementById('btnInspEditText');
  const panelText = document.getElementById('panelEditText');
  const btnBackText = document.getElementById('btnBackFromEditText');
  const btnBrowseFont = document.getElementById('btnBrowseFontGallery');
  const fontLabel = document.getElementById('currentFontNameLabel');

  const textInput = document.getElementById('textInputArea');
  const sliderSize = document.getElementById('sliderTextSize');
  const valSize = document.getElementById('valTextSize');

  const alignSegmented = document.getElementById('textAlignSegmented');
  const btnBold = document.getElementById('btnToggleBold');
  const btnItalic = document.getElementById('btnToggleItalic');
  const btnUnderline = document.getElementById('btnToggleUnderline');
  const btnUppercase = document.getElementById('btnToggleUppercase');

  const sliderSpacing = document.getElementById('sliderTextLetterSpacing');
  const sliderLineHeight = document.getElementById('sliderTextLineHeight');
  const valSpacingLeading = document.getElementById('valTextSpacingLeading');

  function syncTextUI(layerId) {
    if (!layerId) return;
    const tData = (typeof getLayerText === 'function') ? getLayerText(layerId) : { content: 'Heading Title', font: 'Poppins', size: 48, align: 'center', bold: true, italic: false, underline: false, uppercase: false, letterSpacing: 0, lineHeight: 1.2 };

    if (fontLabel) fontLabel.textContent = tData.font || 'Poppins';
    if (textInput) textInput.value = tData.content || '';

    if (sliderSize) sliderSize.value = tData.size || 48;
    if (valSize) valSize.textContent = `${tData.size || 48} px`;

    if (alignSegmented) {
      alignSegmented.querySelectorAll('.text-format-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.align === (tData.align || 'center'));
      });
    }

    if (btnBold) btnBold.classList.toggle('active', !!tData.bold);
    if (btnItalic) btnItalic.classList.toggle('active', !!tData.italic);
    if (btnUnderline) btnUnderline.classList.toggle('active', !!tData.underline);
    if (btnUppercase) btnUppercase.classList.toggle('active', !!tData.uppercase);

    if (sliderSpacing) sliderSpacing.value = tData.letterSpacing || 0;
    if (sliderLineHeight) sliderLineHeight.value = tData.lineHeight !== undefined ? tData.lineHeight : 1.2;
    if (valSpacingLeading) {
      valSpacingLeading.textContent = `${tData.letterSpacing || 0}px \u2022 ${(tData.lineHeight !== undefined ? tData.lineHeight : 1.2)}x`;
    }

    if (typeof syncTextAnimUI === 'function') {
      syncTextAnimUI(layerId);
    }
  }

  
  
  
  let activeTextParamChannel = 'textAnimOffset';
  let textOffsetRulerInstance = null;
  let textStartRulerInstance = null;
  let textEndRulerInstance = null;
  let textSizeRulerInstance = null;
  let textTrackingRulerInstance = null;

  function getActiveTextChannel() {
    const activeBtn = document.querySelector('#panelEditText .text-param-btn.active');
    if (activeBtn && activeBtn.dataset.channel) {
      return activeBtn.dataset.channel;
    }
    return activeTextParamChannel || 'textAnimOffset';
  }
  window.getActiveTextChannel = getActiveTextChannel;

  function recordTextKeyframe(id, channel, value) {
    if (!id) return;
    const kfs = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(id)) || [];
    const hasExistingChannelKf = kfs.some(k => k[channel] !== undefined);
    if (!hasExistingChannelKf) {
      updateTextKeyframeUI();
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
    updateTextKeyframeUI();
    triggerAutoSave();
  }

  function updateTextKeyframeUI() {
    if (!selectedTrackRow) return;
    const id = selectedTrackRow.dataset.layerId || 'default';
    const ch = getActiveTextChannel();
    if (!ch) return;
    const curTime = (typeof elapsed !== 'undefined') ? elapsed : 0;
    const hasKf = (typeof hasKeyframeForChannel === 'function') ? hasKeyframeForChannel(id, curTime, ch) : false;
    const btn = document.getElementById('btnToggleTextKeyframe');
    if (!btn) return;
    const sym = btn.querySelector('.diamond-icon-symbol');
    if (hasKf) {
      btn.classList.add('is-on-keyframe');
      btn.classList.add('has-keyframe');
      if (sym) sym.setAttribute('d', 'M7 12 L17 12');
    } else {
      btn.classList.remove('is-on-keyframe');
      btn.classList.remove('has-keyframe');
      if (sym) sym.setAttribute('d', 'M12 7 L12 17 M7 12 L17 12');
    }
  }

  
  document.querySelectorAll('#panelEditText .text-param-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('#panelEditText .text-param-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTextParamChannel = btn.dataset.channel || 'textAnimOffset';
      updateTextKeyframeUI();
      if (selectedTrackRow) {
        syncTextAnimUI(selectedTrackRow.dataset.layerId);
      }
    });
  });

  
  document.querySelectorAll('#textStudioTabs .controller-switch-btn').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('#textStudioTabs .controller-switch-btn').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      const tab = tabBtn.dataset.textTab;
      const paneAnim = document.getElementById('textTabPaneAnimator');
      const paneTypo = document.getElementById('textTabPaneTypography');
      if (tab === 'animator') {
        if (paneAnim) paneAnim.style.display = 'flex';
        if (paneTypo) paneTypo.style.display = 'none';
        const offsetBtn = document.getElementById('btnTextOffsetParam');
        if (offsetBtn) {
          document.querySelectorAll('#panelEditText .text-param-btn').forEach(b => b.classList.remove('active'));
          offsetBtn.classList.add('active');
          activeTextParamChannel = 'textAnimOffset';
        }
      } else {
        if (paneAnim) paneAnim.style.display = 'none';
        if (paneTypo) paneTypo.style.display = 'flex';
        const sizeBtn = document.getElementById('btnTextSizeParam');
        if (sizeBtn) {
          document.querySelectorAll('#panelEditText .text-param-btn').forEach(b => b.classList.remove('active'));
          sizeBtn.classList.add('active');
          activeTextParamChannel = 'textSize';
        }
      }
      updateTextKeyframeUI();
      if (selectedTrackRow) syncTextAnimUI(selectedTrackRow.dataset.layerId);
    });
  });

  const selectAnimProp = document.getElementById('selectTextAnimProperty');
  const selectAnimShape = document.getElementById('selectTextAnimShape');
  const selectAnimBasedOn = document.getElementById('selectTextAnimBasedOn');
  const chkAnimRandomize = document.getElementById('chkTextAnimRandomize');

  function syncTextAnimUI(layerId) {
    if (!layerId) return;
    const animators = (typeof layerTextAnimators !== 'undefined' && layerTextAnimators.get(layerId)) || [];
    const activeAnim = animators.find(a => a.enabled !== false) || getOrCreateActiveAnim(layerId);
    const sel = (activeAnim && activeAnim.selector) || {};
    const tData = getLayerText(layerId);

    let startVal = sel.start !== undefined ? sel.start : 0;
    let endVal = sel.end !== undefined ? sel.end : 100;
    let offsetVal = sel.offset !== undefined ? sel.offset : 0;
    let sizeVal = tData.size || 48;
    let trackingVal = tData.letterSpacing || 0;

    const kfs = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(layerId)) || [];
    const curTime = (typeof elapsed !== 'undefined') ? elapsed : 0;

    if (kfs.length > 0 && typeof evalKeyframeChannelAtTime === 'function') {
      if (kfs.some(k => k.textAnimStart !== undefined)) {
        startVal = evalKeyframeChannelAtTime(kfs, 'textAnimStart', curTime);
      }
      if (kfs.some(k => k.textAnimEnd !== undefined)) {
        endVal = evalKeyframeChannelAtTime(kfs, 'textAnimEnd', curTime);
      }
      if (kfs.some(k => k.textAnimOffset !== undefined)) {
        offsetVal = evalKeyframeChannelAtTime(kfs, 'textAnimOffset', curTime);
      }
      if (kfs.some(k => k.textSize !== undefined)) {
        sizeVal = evalKeyframeChannelAtTime(kfs, 'textSize', curTime);
      }
      if (kfs.some(k => k.textTracking !== undefined)) {
        trackingVal = evalKeyframeChannelAtTime(kfs, 'textTracking', curTime);
      }
    }

    const valOffset = document.getElementById('valTextAnimOffset');
    const valStart = document.getElementById('valTextAnimStart');
    const valEnd = document.getElementById('valTextAnimEnd');
    const valSize = document.getElementById('valTextSize');
    const valTrack = document.getElementById('valTextLetterSpacing');

    if (valOffset) valOffset.textContent = `${Math.round(offsetVal)}%`;
    if (valStart) valStart.textContent = `${Math.round(startVal)}%`;
    if (valEnd) valEnd.textContent = `${Math.round(endVal)}%`;
    if (valSize) valSize.textContent = `${Math.round(sizeVal)}`;
    if (valTrack) valTrack.textContent = `${Math.round(trackingVal)}`;

    if (textOffsetRulerInstance) textOffsetRulerInstance.setValue(offsetVal);
    if (textStartRulerInstance) textStartRulerInstance.setValue(startVal);
    if (textEndRulerInstance) textEndRulerInstance.setValue(endVal);
    if (textSizeRulerInstance) textSizeRulerInstance.setValue(sizeVal);
    if (textTrackingRulerInstance) textTrackingRulerInstance.setValue(trackingVal);

    if (selectAnimShape) selectAnimShape.value = sel.shape || 'square';
    if (selectAnimBasedOn) selectAnimBasedOn.value = sel.basedOn || 'characters';
    if (chkAnimRandomize) chkAnimRandomize.checked = !!sel.randomizeOrder;

    if (selectAnimProp && activeAnim.properties) {
      if (activeAnim.properties.position) selectAnimProp.value = 'position';
      else if (activeAnim.properties.scale !== undefined) selectAnimProp.value = 'scale';
      else if (activeAnim.properties.rotation !== undefined) selectAnimProp.value = 'rotation';
      else if (activeAnim.properties.tracking !== undefined) selectAnimProp.value = 'tracking';
      else if (activeAnim.properties.charOffset !== undefined) selectAnimProp.value = 'charOffset';
      else selectAnimProp.value = 'opacity';
    }

    
    updateTextKeyframeUI();

    const activeCh = getActiveTextChannel();
    const exps = (typeof getLayerExpressions === 'function') ? getLayerExpressions(layerId) : {};
    const btnTextExp = document.getElementById('btnTextExpression');
    if (btnTextExp) btnTextExp.classList.toggle('active', !!(exps[activeCh] || exps.textAnimStart || exps.textAnimOffset));
  }

  function getOrCreateActiveAnim(layerId) {
    const animators = getLayerTextAnimators(layerId);
    if (animators.length === 0) {
      animators.push({
        id: 'anim_' + Date.now(),
        name: 'Range Animator',
        enabled: true,
        selector: { start: 0, end: 100, offset: 0, shape: 'square', basedOn: 'characters' },
        properties: { opacity: 0 }
      });
    }
    return animators[0];
  }

  function updateActiveAnimSelector(mutator) {
    if (!selectedTrackRow) return;
    const id = selectedTrackRow.dataset.layerId;
    const a = getOrCreateActiveAnim(id);
    a.selector = a.selector || {};
    mutator(a.selector);
    applyTextChange(id);
  }

  if (selectAnimProp) {
    selectAnimProp.addEventListener('change', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const a = getOrCreateActiveAnim(id);
      const val = selectAnimProp.value;
      if (val === 'position') a.properties = { position: { x: 0, y: 60 } };
      else if (val === 'scale') a.properties = { scale: 0 };
      else if (val === 'rotation') a.properties = { rotation: 90 };
      else if (val === 'tracking') a.properties = { tracking: 30 };
      else if (val === 'charOffset') a.properties = { charOffset: 30 };
      else a.properties = { opacity: 0 };
      applyTextChange(id);
    });
  }

  if (selectAnimShape) {
    selectAnimShape.addEventListener('change', () => {
      updateActiveAnimSelector(s => s.shape = selectAnimShape.value);
    });
  }
  if (selectAnimBasedOn) {
    selectAnimBasedOn.addEventListener('change', () => {
      updateActiveAnimSelector(s => s.basedOn = selectAnimBasedOn.value);
    });
  }
  if (chkAnimRandomize) {
    chkAnimRandomize.addEventListener('change', () => {
      updateActiveAnimSelector(s => s.randomizeOrder = chkAnimRandomize.checked);
    });
  }

  
  if (window.FishUI && window.FishUI.createRuler) {
    textOffsetRulerInstance = window.FishUI.createRuler({
      container: '#textOffsetRuler',
      min: -100,
      max: 100,
      sensitivity: 0.35,
      value: 0,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId;
        const rounded = Math.round(val);
        updateActiveAnimSelector(s => s.offset = rounded);
        const lbl = document.getElementById('valTextAnimOffset');
        if (lbl) lbl.textContent = `${rounded}%`;

        document.querySelectorAll('#panelEditText .text-param-btn').forEach(b => b.classList.remove('active'));
        const b = document.getElementById('btnTextOffsetParam');
        if (b) b.classList.add('active');
        activeTextParamChannel = 'textAnimOffset';

        recordTextKeyframe(id, 'textAnimOffset', rounded);
        applyTextChange(id);
      }
    });

    textStartRulerInstance = window.FishUI.createRuler({
      container: '#textStartRuler',
      min: 0,
      max: 100,
      sensitivity: 0.35,
      value: 0,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId;
        const rounded = Math.max(0, Math.min(100, Math.round(val)));
        updateActiveAnimSelector(s => s.start = rounded);
        const lbl = document.getElementById('valTextAnimStart');
        if (lbl) lbl.textContent = `${rounded}%`;

        document.querySelectorAll('#panelEditText .text-param-btn').forEach(b => b.classList.remove('active'));
        const b = document.getElementById('btnTextStartParam');
        if (b) b.classList.add('active');
        activeTextParamChannel = 'textAnimStart';

        recordTextKeyframe(id, 'textAnimStart', rounded);
        applyTextChange(id);
      }
    });

    textEndRulerInstance = window.FishUI.createRuler({
      container: '#textEndRuler',
      min: 0,
      max: 100,
      sensitivity: 0.35,
      value: 100,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId;
        const rounded = Math.max(0, Math.min(100, Math.round(val)));
        updateActiveAnimSelector(s => s.end = rounded);
        const lbl = document.getElementById('valTextAnimEnd');
        if (lbl) lbl.textContent = `${rounded}%`;

        document.querySelectorAll('#panelEditText .text-param-btn').forEach(b => b.classList.remove('active'));
        const b = document.getElementById('btnTextEndParam');
        if (b) b.classList.add('active');
        activeTextParamChannel = 'textAnimEnd';

        recordTextKeyframe(id, 'textAnimEnd', rounded);
        applyTextChange(id);
      }
    });

    textSizeRulerInstance = window.FishUI.createRuler({
      container: '#textSizeRuler',
      min: 10,
      max: 220,
      sensitivity: 0.4,
      value: 48,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId;
        const rounded = Math.max(10, Math.min(220, Math.round(val)));
        const tData = getLayerText(id);
        tData.size = rounded;
        const lbl = document.getElementById('valTextSize');
        if (lbl) lbl.textContent = rounded;

        document.querySelectorAll('#panelEditText .text-param-btn').forEach(b => b.classList.remove('active'));
        const b = document.getElementById('btnTextSizeParam');
        if (b) b.classList.add('active');
        activeTextParamChannel = 'textSize';

        recordTextKeyframe(id, 'textSize', rounded);
        applyTextChange(id);
      }
    });

    textTrackingRulerInstance = window.FishUI.createRuler({
      container: '#textTrackingRuler',
      min: -10,
      max: 80,
      sensitivity: 0.35,
      value: 0,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId;
        const rounded = Math.round(val);
        const tData = getLayerText(id);
        tData.letterSpacing = rounded;
        const lbl = document.getElementById('valTextLetterSpacing');
        if (lbl) lbl.textContent = rounded;

        document.querySelectorAll('#panelEditText .text-param-btn').forEach(b => b.classList.remove('active'));
        const b = document.getElementById('btnTextTrackingParam');
        if (b) b.classList.add('active');
        activeTextParamChannel = 'textTracking';

        recordTextKeyframe(id, 'textTracking', rounded);
        applyTextChange(id);
      }
    });
  }

  
  let globalTextKfController = null;
  if (window.FishUI && window.FishUI.createKeyframeController) {
    globalTextKfController = window.FishUI.createKeyframeController({
      toggleButton: '#btnToggleTextKeyframe',
      graphButton: '#btnTextKeyframeGraph',
      getChannel: () => getActiveTextChannel(),
      getLayerId: () => selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default',
      getCurrentTime: () => (typeof elapsed !== 'undefined' ? elapsed : 0),
      getKeyframes: (layerId) => (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(layerId)) || [],
      getCurrentValue: (layerId, ch) => {
        const anims = (typeof layerTextAnimators !== 'undefined' && layerTextAnimators.get(layerId)) || [];
        const a = anims[0] || {};
        const sel = a.selector || {};
        const tData = (typeof getLayerText === 'function') ? getLayerText(layerId) : {};
        if (ch === 'textAnimOffset') return sel.offset !== undefined ? sel.offset : 0;
        if (ch === 'textAnimStart') return sel.start !== undefined ? sel.start : 0;
        if (ch === 'textAnimEnd') return sel.end !== undefined ? sel.end : 100;
        if (ch === 'textSize') return tData.size || 48;
        if (ch === 'textTracking') return tData.letterSpacing || 0;
        return sel.start || 0;
      },
      onToggle: () => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        if (!layerKeyframes.has(id)) layerKeyframes.set(id, []);
        const kfs = layerKeyframes.get(id);
        const curTime = (typeof elapsed !== 'undefined') ? elapsed : 0;
        const activeCh = getActiveTextChannel();
        const a = getOrCreateActiveAnim(id);
        const sel = a.selector || {};
        const tData = getLayerText(id);

        let curVal = 0;
        if (activeCh === 'textAnimOffset') curVal = sel.offset !== undefined ? sel.offset : 0;
        else if (activeCh === 'textAnimStart') curVal = sel.start !== undefined ? sel.start : 0;
        else if (activeCh === 'textAnimEnd') curVal = sel.end !== undefined ? sel.end : 100;
        else if (activeCh === 'textSize') curVal = tData.size || 48;
        else if (activeCh === 'textTracking') curVal = tData.letterSpacing || 0;

        const hasKf = (typeof hasKeyframeForChannel === 'function') ? hasKeyframeForChannel(id, curTime, activeCh) : false;
        let target = (typeof getKeyframeAt === 'function') ? getKeyframeAt(id, curTime) : null;

        if (hasKf && target) {
          delete target[activeCh];
          if (Object.keys(target).filter(k => k !== 'time' && !k.startsWith('easing')).length === 0) {
            const idx = kfs.indexOf(target);
            if (idx >= 0) kfs.splice(idx, 1);
          }
        } else {
          recordTextKeyframe(id, activeCh, curVal);
        }

        syncTextAnimUI(id);
        applyTextChange(id);
        if (typeof renderAllKeyframeMarkers === 'function') renderAllKeyframeMarkers();
        updateTextKeyframeUI();
        if (typeof updateKeyframeUI === 'function') updateKeyframeUI();
        triggerAutoSave();
      },
      onOpenGraph: ({ channel }) => {
        const activeCh = channel || getActiveTextChannel();
        if (typeof openGraphEditor === 'function') {
          openGraphEditor(activeCh, document.getElementById('btnTextKeyframeGraph'));
        }
      }
    });
  }

  
  const btnTextExp = document.getElementById('btnTextExpression');
  if (btnTextExp) {
    btnTextExp.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const exps = getLayerExpressions(id);
      const curCode = exps['textAnimStart'] || exps['textAnimOffset'] || '';

      const presets = [
        { label: '⌨️ Auto Typewriter', code: 'time * 60' },
        { label: '🌊 Infinite Wave', code: 'time * 120' },
        { label: '⚡ Jitter Noise', code: 'wiggle(4, 25)' },
        { label: '🔁 Loop PingPong', code: 'loopOut("pingpong")' },
        { label: '💫 Linear Fade', code: 'linear(time, 0, 2, 0, 100)' }
      ];

      if (window.FishUI && window.FishUI.openExpressionPopover) {
        window.FishUI.openExpressionPopover({
          anchorElement: btnTextExp,
          title: 'Text Animation (fx)',
          currentCode: curCode,
          presets: presets,
          onApply: (code) => {
            setLayerExpression(id, 'textAnimStart', code);
            syncTextAnimUI(id);
            applyTextChange(id);
            triggerAutoSave();
          },
          onClear: () => {
            clearLayerExpression(id, 'textAnimStart');
            clearLayerExpression(id, 'textAnimOffset');
            syncTextAnimUI(id);
            applyTextChange(id);
            triggerAutoSave();
          }
        });
      }
    });
  }

  
  
  
  const btnExp = document.getElementById('btnTransformExpression');
  if (btnExp) {
    btnExp.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const curPanel = (typeof activeControllerPanel !== 'undefined') ? activeControllerPanel : 'move';

      let propKey = 'posX';
      let propLabel = 'Position (X, Y)';
      if (curPanel === 'rotate') {
        const axis = activeRotationAxis || 'Z';
        propKey = 'rot' + axis;
        propLabel = `Rotation ${axis}`;
      } else if (curPanel === 'scale') {
        propKey = 'scaleW';
        propLabel = 'Scale (W, H)';
      } else if (curPanel === 'opacity') {
        propKey = 'opacity';
        propLabel = 'Opacity';
      }

      const exps = getLayerExpressions(id);
      const curCode = exps[propKey] || (curPanel === 'move' && exps.posY) || (curPanel === 'scale' && exps.scaleH) || '';

      const presets = [
        { label: '🌊 wiggle(5, 30)', code: 'wiggle(5, 30)' },
        { label: '🏀 bounce()', code: 'bounce(20, 6, 5)' },
        { label: '🔄 time * 180', code: 'time * 180' },
        { label: '🔁 loopOut()', code: 'loopOut("pingpong")' },
        { label: '💫 linear()', code: 'linear(time, 0, 2, 0, 100)' }
      ];

      if (window.FishUI && window.FishUI.openExpressionPopover) {
        window.FishUI.openExpressionPopover({
          anchorElement: btnExp,
          title: `${propLabel} (fx)`,
          currentCode: curCode,
          presets: presets,
          onApply: (code) => {
            if (curPanel === 'move') {
              setLayerExpression(id, 'posX', code);
              setLayerExpression(id, 'posY', code);
            } else if (curPanel === 'rotate') {
              const axis = activeRotationAxis || 'Z';
              setLayerExpression(id, 'rot' + axis, code);
            } else if (curPanel === 'scale') {
              setLayerExpression(id, 'scaleW', code);
              setLayerExpression(id, 'scaleH', code);
            } else if (curPanel === 'opacity') {
              setLayerExpression(id, 'opacity', code);
            }
            syncControllerUI();
            render3D();
            triggerAutoSave();
          },
          onClear: () => {
            if (curPanel === 'move') {
              clearLayerExpression(id, 'posX');
              clearLayerExpression(id, 'posY');
              clearLayerExpression(id, 'posZ');
            } else if (curPanel === 'rotate') {
              clearLayerExpression(id, 'rotZ');
              clearLayerExpression(id, 'rotX');
              clearLayerExpression(id, 'rotY');
            } else if (curPanel === 'scale') {
              clearLayerExpression(id, 'scaleW');
              clearLayerExpression(id, 'scaleH');
            } else if (curPanel === 'opacity') {
              clearLayerExpression(id, 'opacity');
            }
            syncControllerUI();
            render3D();
            triggerAutoSave();
          }
        });
      }
    });
  }

  function applyTextChange(layerId) {
    if (!layerId) return;
    applyFillToMeshGlobal(layerId);
    if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
    render3D();
    triggerAutoSave();
  }

  if (btnInspEditText && panelText) {
    btnInspEditText.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      openInspectorSubpanel(panelText, 'subpanel-text', () => {
        syncTextUI(id);
      });
    });
  }

  if (btnBackText && panelText) {
    btnBackText.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInspectorSubpanel(panelText);
    });
  }

  if (btnBrowseFont) {
    btnBrowseFont.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const tData = getLayerText(id);
      openFontGalleryPopover(btnBrowseFont, tData.font, (newFont) => {
        tData.font = newFont;
        if (fontLabel) fontLabel.textContent = newFont;
        applyTextChange(id);
      });
    });
  }

  if (textInput) {
    textInput.addEventListener('input', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const tData = getLayerText(id);
      tData.content = textInput.value;

      const clipName = selectedTrackRow.querySelector('.track-clip-name');
      if (clipName) {
        const firstLine = textInput.value.trim().split('\n')[0] || 'Text Layer';
        clipName.textContent = firstLine.length > 22 ? firstLine.slice(0, 20) + '...' : firstLine;
      }

      applyTextChange(id);
    });
  }

  if (sliderSize) {
    sliderSize.addEventListener('input', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const tData = getLayerText(id);
      tData.size = parseFloat(sliderSize.value) || 48;
      if (valSize) valSize.textContent = `${tData.size} px`;
      applyTextChange(id);
    });
  }

  if (alignSegmented) {
    alignSegmented.querySelectorAll('.text-format-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId;
        const tData = getLayerText(id);
        alignSegmented.querySelectorAll('.text-format-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tData.align = btn.dataset.align;
        applyTextChange(id);
      });
    });
  }

  const bindToggle = (btn, prop) => {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const tData = getLayerText(id);
      tData[prop] = !tData[prop];
      btn.classList.toggle('active', tData[prop]);
      applyTextChange(id);
    });
  };

  bindToggle(btnBold, 'bold');
  bindToggle(btnItalic, 'italic');
  bindToggle(btnUnderline, 'underline');
  bindToggle(btnUppercase, 'uppercase');

  if (sliderSpacing) {
    sliderSpacing.addEventListener('input', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const tData = getLayerText(id);
      tData.letterSpacing = parseInt(sliderSpacing.value) || 0;
      if (valSpacingLeading) valSpacingLeading.textContent = `${tData.letterSpacing}px \u2022 ${(tData.lineHeight !== undefined ? tData.lineHeight : 1.2)}x`;
      applyTextChange(id);
    });
  }

  if (sliderLineHeight) {
    sliderLineHeight.addEventListener('input', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId;
      const tData = getLayerText(id);
      tData.lineHeight = parseFloat(sliderLineHeight.value) || 1.2;
      if (valSpacingLeading) valSpacingLeading.textContent = `${tData.letterSpacing || 0}px \u2022 ${(tData.lineHeight)}x`;
      applyTextChange(id);
    });
  }
}

window.getGoogleFontsCatalog = getGoogleFontsCatalog;
window.openFontGalleryPopover = openFontGalleryPopover;
window.initEditTextSubpanel = initEditTextSubpanel;
