function getLayerBorderShadow(id) {
  if (!layerBorderShadow.has(id)) {
    layerBorderShadow.set(id, {
      stroke: {
        enabled: false,
        color: '#000000',
        size: 4.0,
        cap: 'butt',
        align: 'center'
      },
      shadow: {
        enabled: false,
        color: '#000000',
        size: 4,
        alpha: 100,
        posX: 3,
        posY: 3
      }
    });
  }
  const base = layerBorderShadow.get(id);
  const kfs = layerKeyframes.get(id);
  if (!kfs || kfs.length === 0) return base;
  const hasAny = (ch) => kfs.some(k => k[ch] !== undefined);
  if (!hasAny('strokeColor') && !hasAny('strokeSize') && !hasAny('shadowColor') && !hasAny('shadowSize') && !hasAny('shadowAlpha') && !hasAny('shadowPosX') && !hasAny('shadowPosY')) {
    return base;
  }
  function interpChannel(channel, defaultVal, isColor) {
    const relevant = kfs.filter(k => k[channel] !== undefined);
    if (relevant.length === 0) return defaultVal;
    if (relevant.length === 1 || elapsed <= relevant[0].time) return relevant[0][channel];
    const last = relevant[relevant.length - 1];
    if (elapsed >= last.time) return last[channel];
    for (let i = 0; i < relevant.length - 1; i++) {
      const k1 = relevant[i], k2 = relevant[i+1];
      if (elapsed >= k1.time && elapsed <= k2.time) {
        const span = k2.time - k1.time;
        const rawT = span > 0 ? (elapsed - k1.time) / span : 0;
        const easing = k1['easing_' + channel] || k1.easing;
        let t = rawT;
        if (easing && easing.cp1x !== undefined) t = solveCubicBezier(easing.cp1x, easing.cp1y, easing.cp2x, easing.cp2y, rawT);
        if (isColor) {
          const c1 = parseHexOrRgbLocal(k1[channel]);
          const c2 = parseHexOrRgbLocal(k2[channel]);
          const r = Math.round(c1.r + (c2.r - c1.r) * t);
          const g = Math.round(c1.g + (c2.g - c1.g) * t);
          const b = Math.round(c1.b + (c2.b - c1.b) * t);
          return `rgb(${r},${g},${b})`;
        }
        return k1[channel] + (k2[channel] - k1[channel]) * t;
      }
    }
    return defaultVal;
  }
  return {
    stroke: {
      enabled: base.stroke.enabled,
      color: hasAny('strokeColor') ? interpChannel('strokeColor', base.stroke.color, true) : base.stroke.color,
      size: hasAny('strokeSize') ? interpChannel('strokeSize', base.stroke.size) : base.stroke.size,
      cap: base.stroke.cap,
      align: base.stroke.align
    },
    shadow: {
      enabled: base.shadow.enabled,
      color: hasAny('shadowColor') ? interpChannel('shadowColor', base.shadow.color, true) : base.shadow.color,
      size: hasAny('shadowSize') ? interpChannel('shadowSize', base.shadow.size) : base.shadow.size,
      alpha: hasAny('shadowAlpha') ? interpChannel('shadowAlpha', base.shadow.alpha) : base.shadow.alpha,
      posX: hasAny('shadowPosX') ? interpChannel('shadowPosX', base.shadow.posX) : base.shadow.posX,
      posY: hasAny('shadowPosY') ? interpChannel('shadowPosY', base.shadow.posY) : base.shadow.posY
    }
  };
}

function getActiveBorderShadowChannel() {
  const panel = document.getElementById('panelBorderShadow');
  if (!panel || panel.style.display === 'none') return null;
  const activeTab = document.querySelector('#borderShadowTabs .controller-switch-btn.active');
  const tab = activeTab ? activeTab.dataset.bsTab : 'stroke';
  if (tab === 'stroke') {
    
    const activeParam = document.querySelector('#bsTabStroke .bs-param-btn.active');
    if (activeParam && activeParam.id === 'btnStrokeSizeParam') return 'strokeSize';
    return 'strokeColor';
  } else {
    const activeParam = document.querySelector('#bsTabShadow .bs-param-btn.active');
    if (activeParam) {
      if (activeParam.id === 'btnShadowColorTrigger') return 'shadowColor';
      if (activeParam.id === 'btnShadowSizeParam') return 'shadowSize';
      if (activeParam.id === 'btnShadowAlphaParam') return 'shadowAlpha';
      if (activeParam.id === 'btnShadowPosParam') return activeShadowAxis === 'X' ? 'shadowPosX' : 'shadowPosY';
    }
    return 'shadowSize';
  }
}

function cleanupBorderShadowKeyframes(id, channels) {
  const kfs = layerKeyframes.get(id);
  if (!kfs || !kfs.length) return;
  let changed = false;
  for (let i = kfs.length - 1; i >= 0; i--) {
    const kf = kfs[i];
    let touched = false;
    channels.forEach(ch => {
      if (kf[ch] !== undefined) {
        delete kf[ch];
        touched = true;
      }
      const eKey = 'easing_' + ch;
      if (kf[eKey] !== undefined) {
        delete kf[eKey];
        touched = true;
      }
    });
    
    if (touched) changed = true;
    const hasMeaningful = ['posX','posY','posZ','rotX','rotY','rotZ','scaleW','scaleH','opacity','strokeColor','strokeSize','shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].some(p => kf[p] !== undefined);
    if (!hasMeaningful) {
      
      kfs.splice(i, 1);
      changed = true;
    } else if (kf.easing) {
      const hasAnyEasing = Object.keys(kf).some(k => k.startsWith('easing_'));
      if (!hasAnyEasing) delete kf.easing;
    }
  }
  if (changed) {
    renderAllKeyframeMarkers();
    updateBorderShadowKeyframeUI();
  }
}

function syncBorderShadowDisabledUI() {
  const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : null;
  const strokePane = document.getElementById('bsTabStroke');
  const shadowPane = document.getElementById('bsTabShadow');
  if (!id) {
    if (strokePane) strokePane.classList.add('is-disabled');
    if (shadowPane) shadowPane.classList.add('is-disabled');
    return;
  }
  const base = layerBorderShadow.get(id) || (typeof getLayerBorderShadow === 'function' ? getLayerBorderShadow(id) : null);
  if (!base) return;
  if (strokePane) strokePane.classList.toggle('is-disabled', !base.stroke.enabled);
  if (shadowPane) shadowPane.classList.toggle('is-disabled', !base.shadow.enabled);
}

function recordBorderShadowKeyframe(id, channel, value) {
  
  const base = layerBorderShadow.get(id);
  if (base) {
    const isStrokeChannel = ['strokeColor','strokeSize'].includes(channel);
    const isShadowChannel = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(channel);
    if (isStrokeChannel && !base.stroke.enabled) return;
    if (isShadowChannel && !base.shadow.enabled) return;
  }
  const kfs = layerKeyframes.get(id) || [];
  const hasExistingChannelKf = kfs.some(k => k[channel] !== undefined);
  if (!hasExistingChannelKf) {
    updateBorderShadowKeyframeUI();
    return;
  }
  if (!layerKeyframes.has(id)) layerKeyframes.set(id, []);
  const layerKfList = layerKeyframes.get(id);
  const hasKf = hasKeyframeForChannel(id, elapsed, channel);
  let target = getKeyframeAt(id, elapsed);
  if (hasKf && target) {
    target[channel] = value;
  } else {
    if (!target) { target = { time: Math.round(elapsed * 100) / 100 }; layerKfList.push(target); }
    target[channel] = value;
    layerKfList.sort((a,b)=>a.time-b.time);
  }
  renderAllKeyframeMarkers();
  updateBorderShadowKeyframeUI();
  triggerAutoSave();
}

function updateBorderShadowKeyframeUI() {
  if (!selectedTrackRow) return;
  const id = selectedTrackRow.dataset.layerId || 'default';
  const ch = getActiveBorderShadowChannel();
  if (!ch) return;
  const hasKf = hasKeyframeForChannel(id, elapsed, ch);
  const btn = document.getElementById('btnToggleBorderShadowKeyframe');
  if (!btn) return;
  const sym = btn.querySelector('.diamond-icon-symbol');
  if (hasKf) { btn.classList.add('is-on-keyframe'); if(sym) sym.setAttribute('d','M7 12 L17 12'); }
  else { btn.classList.remove('is-on-keyframe'); if(sym) sym.setAttribute('d','M12 7 L12 17 M7 12 L17 12'); }
}

let activeShadowAxis = 'X';
let strokeSizeRulerInstance = null;
let shadowSizeRulerInstance = null;
let shadowAlphaRulerInstance = null;
let shadowPosRulerInstance = null;

function parseHexOrRgbLocal(str) {
  if (!str) return { r: 0, g: 0, b: 0, a: 1 };
  if (typeof parseHexOrRgb === 'function') {
    try { return parseHexOrRgb(str); } catch (_) {}
  }
  const s = String(str).trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a: 1 };
  }
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) {
    return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function initBorderShadowController() {
  const btnInspBS = document.getElementById('btnInspBorderShadow');
  const panelBS = document.getElementById('panelBorderShadow');
  const btnBackBS = document.getElementById('btnBackFromBorderShadow');
  const drawer = document.getElementById('layerInspectorDrawer');
  const toolsGrid = document.querySelector('.inspector-tools-grid');
  const quickStrip = document.querySelector('.inspector-quick-strip');

  
  if (btnInspBS && panelBS) {
    btnInspBS.addEventListener('click', (e) => {
      e.stopPropagation();
      openInspectorSubpanel(panelBS, 'subpanel-border-shadow', () => {
        syncBorderShadowUI();
        
        const activeTab = document.querySelector('#borderShadowTabs .controller-switch-btn.active');
        const tab = activeTab ? activeTab.dataset.bsTab : 'stroke';
        if (tab === 'stroke') {
          document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
          const b = document.getElementById('btnStrokeSizeParam');
          if (b) b.classList.add('active');
        } else {
          document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
          const b = document.getElementById('btnShadowSizeParam');
          if (b) b.classList.add('active');
        }
        setTimeout(() => {
          updateBorderShadowKeyframeUI();
          renderAllKeyframeMarkers();
        }, 10);
      });
    });
  }

  
  if (btnBackBS && panelBS) {
    btnBackBS.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInspectorSubpanel(panelBS);
    });
  }

  
  document.querySelectorAll('#borderShadowTabs button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = btn.dataset.bsTab || 'stroke';
      document.querySelectorAll('#borderShadowTabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const strokePane = document.getElementById('bsTabStroke');
      const shadowPane = document.getElementById('bsTabShadow');
      if (strokePane) strokePane.style.display = tab === 'stroke' ? 'flex' : 'none';
      if (shadowPane) shadowPane.style.display = tab === 'shadow' ? 'flex' : 'none';
      
      if (tab === 'stroke') {
        document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const b = document.getElementById('btnStrokeSizeParam');
        if (b) b.classList.add('active');
      } else {
        document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const b = document.getElementById('btnShadowSizeParam');
        if (b) b.classList.add('active');
      }
      setTimeout(() => {
        updateBorderShadowKeyframeUI();
        renderAllKeyframeMarkers();
      }, 10);
    });
  });

  
  const toggleStroke = document.getElementById('toggleStrokeEnabled');
  if (toggleStroke) {
    toggleStroke.addEventListener('change', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      
      getLayerBorderShadow(id);
      const base = layerBorderShadow.get(id);
      if (!base) return;
      base.stroke.enabled = toggleStroke.checked;
      if (!toggleStroke.checked) {
        
        base.stroke.size = 4.0;
        base.stroke.color = '#000000';
        base.stroke.cap = 'butt';
        base.stroke.align = 'center';
        cleanupBorderShadowKeyframes(id, ['strokeColor','strokeSize']);
      }
      
      syncBorderShadowUI();
      renderAllKeyframeMarkers();
      updateBorderShadowKeyframeUI();
      applyBorderShadowToMesh(id);
      triggerAutoSave();
    });
  }

  const toggleShadow = document.getElementById('toggleShadowEnabled');
  if (toggleShadow) {
    toggleShadow.addEventListener('change', () => {
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      getLayerBorderShadow(id);
      const base = layerBorderShadow.get(id);
      if (!base) return;
      base.shadow.enabled = toggleShadow.checked;
      if (!toggleShadow.checked) {
        
        base.shadow.size = 4;
        base.shadow.alpha = 100;
        base.shadow.posX = 3;
        base.shadow.posY = 3;
        base.shadow.color = '#000000';
        cleanupBorderShadowKeyframes(id, ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY']);
      }
      syncBorderShadowUI();
      renderAllKeyframeMarkers();
      updateBorderShadowKeyframeUI();
      applyBorderShadowToMesh(id);
      triggerAutoSave();
    });
  }

  
  if (window.FishUI && window.FishUI.createRuler) {
    
    strokeSizeRulerInstance = window.FishUI.createRuler({
      container: '#strokeSizeRuler',
      min: 0,
      max: 100,
      sensitivity: 0.25,
      value: 4.0,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        if (!base.stroke.enabled) {
          
          if (strokeSizeRulerInstance) strokeSizeRulerInstance.setValue(base.stroke.size);
          return;
        }
        const bs = getLayerBorderShadow(id);
        const rounded = Math.max(0, Math.round(val * 2) / 2);
        bs.stroke.size = rounded;
        const lbl = document.getElementById('valStrokeSize');
        if (lbl) lbl.textContent = rounded.toFixed(1);
        
        document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const sizeBtn = document.getElementById('btnStrokeSizeParam');
        if (sizeBtn) sizeBtn.classList.add('active');
        
        recordBorderShadowKeyframe(id, 'strokeSize', rounded);
        applyBorderShadowToMesh(id);
        triggerAutoSave();
        updateBorderShadowKeyframeUI();
      }
    });

    
    shadowSizeRulerInstance = window.FishUI.createRuler({
      container: '#shadowSizeRuler',
      min: 0,
      max: 100,
      sensitivity: 0.4,
      value: 4,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        if (!base.shadow.enabled) {
          if (shadowSizeRulerInstance) shadowSizeRulerInstance.setValue(base.shadow.size);
          return;
        }
        const bs = getLayerBorderShadow(id);
        const rounded = Math.max(0, Math.round(val));
        bs.shadow.size = rounded;
        const lbl = document.getElementById('valShadowSize');
        if (lbl) lbl.textContent = rounded;
        document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const btn = document.getElementById('btnShadowSizeParam');
        if (btn) btn.classList.add('active');
        recordBorderShadowKeyframe(id, 'shadowSize', rounded);
        applyBorderShadowToMesh(id);
        triggerAutoSave();
        updateBorderShadowKeyframeUI();
      }
    });

    
    shadowAlphaRulerInstance = window.FishUI.createRuler({
      container: '#shadowAlphaRuler',
      min: 0,
      max: 100,
      sensitivity: 0.5,
      value: 100,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        if (!base.shadow.enabled) {
          if (shadowAlphaRulerInstance) shadowAlphaRulerInstance.setValue(base.shadow.alpha);
          return;
        }
        const bs = getLayerBorderShadow(id);
        const rounded = Math.max(0, Math.min(100, Math.round(val)));
        bs.shadow.alpha = rounded;
        const lbl = document.getElementById('valShadowAlpha');
        if (lbl) lbl.textContent = `${rounded}%`;
        document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const btn = document.getElementById('btnShadowAlphaParam');
        if (btn) btn.classList.add('active');
        recordBorderShadowKeyframe(id, 'shadowAlpha', rounded);
        applyBorderShadowToMesh(id);
        triggerAutoSave();
        updateBorderShadowKeyframeUI();
      }
    });

    
    shadowPosRulerInstance = window.FishUI.createRuler({
      container: '#shadowPosRuler',
      min: -150,
      max: 150,
      sensitivity: 0.5,
      value: 3,
      onChange: (val) => {
        if (!selectedTrackRow) return;
        const id = selectedTrackRow.dataset.layerId || 'default';
        const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        if (!base.shadow.enabled) {
          if (shadowPosRulerInstance) shadowPosRulerInstance.setValue(activeShadowAxis === 'X' ? base.shadow.posX : base.shadow.posY);
          return;
        }
        const bs = getLayerBorderShadow(id);
        const rounded = Math.round(val);
        document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
        const posBtn = document.getElementById('btnShadowPosParam');
        if (posBtn) posBtn.classList.add('active');
        if (activeShadowAxis === 'X') {
          bs.shadow.posX = rounded;
          const lblX = document.getElementById('valShadowPosX');
          if (lblX) lblX.textContent = rounded;
          recordBorderShadowKeyframe(id, 'shadowPosX', rounded);
        } else {
          bs.shadow.posY = rounded;
          const lblY = document.getElementById('valShadowPosY');
          if (lblY) lblY.textContent = rounded;
          recordBorderShadowKeyframe(id, 'shadowPosY', rounded);
        }
        applyBorderShadowToMesh(id);
        triggerAutoSave();
        updateBorderShadowKeyframeUI();
      }
    });
  }

  
  const btnStrokeColor = document.getElementById('btnStrokeColorSwatch');
  if (btnStrokeColor) {
    btnStrokeColor.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
      if (!base.stroke.enabled) return;
      const bs = getLayerBorderShadow(id);
      
      document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
      updateBorderShadowKeyframeUI();
      renderAllKeyframeMarkers();
      if (window.openGlobalColorPicker) {
        window.openGlobalColorPicker({
          color: bs.stroke.color || '#000000',
          alpha: 1,
          anchorElement: btnStrokeColor,
          onChange: (res) => {
            bs.stroke.color = res.hex || '#000000';
            const box = document.getElementById('strokeColorBox');
            if (box) box.style.background = bs.stroke.color;
            
            document.querySelectorAll('#bsTabStroke .bs-param-btn').forEach(b=>b.classList.remove('active'));
            recordBorderShadowKeyframe(id, 'strokeColor', bs.stroke.color);
            applyBorderShadowToMesh(id);
            triggerAutoSave();
            updateBorderShadowKeyframeUI();
            renderAllKeyframeMarkers();
          }
        });
      }
    });
  }

  const btnShadowColorTrigger = document.getElementById('btnShadowColorTrigger');
  const btnShadowColorSwatch = document.getElementById('btnShadowColorSwatch');
  const openShadowColor = (anchor) => {
    if (!selectedTrackRow) return;
    const id = selectedTrackRow.dataset.layerId || 'default';
    const baseChk = layerBorderShadow.get(id) || getLayerBorderShadow(id);
    if (!baseChk.shadow.enabled) return;
    const bs = getLayerBorderShadow(id);
    
    document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
    const colorBtn = document.getElementById('btnShadowColorTrigger');
    if (colorBtn) colorBtn.classList.add('active');
    updateBorderShadowKeyframeUI();
    renderAllKeyframeMarkers();
    if (window.openGlobalColorPicker) {
      window.openGlobalColorPicker({
        color: bs.shadow.color || '#000000',
        alpha: (bs.shadow.alpha !== undefined ? bs.shadow.alpha / 100 : 1),
        anchorElement: anchor,
        onChange: (res) => {
          bs.shadow.color = res.hex || '#000000';
          if (res.alpha !== undefined) {
            bs.shadow.alpha = Math.round(res.alpha * 100);
            const lblA = document.getElementById('valShadowAlpha');
            if (lblA) lblA.textContent = `${bs.shadow.alpha}%`;
            if (shadowAlphaRulerInstance) shadowAlphaRulerInstance.setValue(bs.shadow.alpha);
            recordBorderShadowKeyframe(id, 'shadowAlpha', bs.shadow.alpha);
          }
          const box = document.getElementById('shadowColorBox');
          if (box) box.style.background = bs.shadow.color;
          const p = parseHexOrRgbLocal(bs.shadow.color);
          const rgbText = document.getElementById('shadowRgbText');
          if (rgbText) rgbText.textContent = `${p.r} ${p.g} ${p.b}`;
          
          document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b=>b.classList.remove('active'));
          if (colorBtn) colorBtn.classList.add('active');
          recordBorderShadowKeyframe(id, 'shadowColor', bs.shadow.color);
          applyBorderShadowToMesh(id);
          triggerAutoSave();
          updateBorderShadowKeyframeUI();
          renderAllKeyframeMarkers();
        }
      });
    }
  };

  if (btnShadowColorTrigger) {
    btnShadowColorTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      
      document.querySelectorAll('#bsTabShadow .bs-param-btn').forEach(b => b.classList.remove('active'));
      btnShadowColorTrigger.classList.add('active');
      updateBorderShadowKeyframeUI();
    });
  }
  if (btnShadowColorSwatch) {
    btnShadowColorSwatch.addEventListener('click', (e) => {
      e.stopPropagation();
      
      openShadowColor(btnShadowColorSwatch);
    });
  }

  
  document.querySelectorAll('#strokeCapGroup button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
      if (!base.stroke.enabled) return;
      const bs = getLayerBorderShadow(id);
      bs.stroke.cap = btn.dataset.cap || 'butt';
      document.querySelectorAll('#strokeCapGroup button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyBorderShadowToMesh(id);
      triggerAutoSave();
    });
  });

  document.querySelectorAll('#strokeAlignGroup button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedTrackRow) return;
      const id = selectedTrackRow.dataset.layerId || 'default';
      const base = layerBorderShadow.get(id) || getLayerBorderShadow(id);
      if (!base.stroke.enabled) return;
      const bs = getLayerBorderShadow(id);
      bs.stroke.align = btn.dataset.align || 'center';
      document.querySelectorAll('#strokeAlignGroup button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyBorderShadowToMesh(id);
      triggerAutoSave();
    });
  });

  
  document.querySelectorAll('#bsTabStroke .bs-param-btn, #bsTabShadow .bs-param-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      
      const pane = btn.closest('.bs-tab-pane');
      if (pane) {
        pane.querySelectorAll('.bs-param-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });

  
  const btnAxisX = document.getElementById('btnShadowAxisX');
  const btnAxisY = document.getElementById('btnShadowAxisY');
  if (btnAxisX && btnAxisY) {
    btnAxisX.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedTrackRow) {
        const idAx = selectedTrackRow.dataset.layerId || 'default';
        const baseAx = layerBorderShadow.get(idAx) || getLayerBorderShadow(idAx);
        if (!baseAx.shadow.enabled) return;
      }
      activeShadowAxis = 'X';
      btnAxisX.classList.add('active');
      btnAxisY.classList.remove('active');
      if (selectedTrackRow && shadowPosRulerInstance) {
        const id = selectedTrackRow.dataset.layerId || 'default';
        const bs = getLayerBorderShadow(id);
        shadowPosRulerInstance.setValue(bs.shadow.posX);
      }
      updateBorderShadowKeyframeUI();
    });

    btnAxisY.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedTrackRow) {
        const idAy = selectedTrackRow.dataset.layerId || 'default';
        const baseAy = layerBorderShadow.get(idAy) || getLayerBorderShadow(idAy);
        if (!baseAy.shadow.enabled) return;
      }
      activeShadowAxis = 'Y';
      btnAxisY.classList.add('active');
      btnAxisX.classList.remove('active');
      if (selectedTrackRow && shadowPosRulerInstance) {
        const id = selectedTrackRow.dataset.layerId || 'default';
        const bs = getLayerBorderShadow(id);
        shadowPosRulerInstance.setValue(bs.shadow.posY);
      }
      updateBorderShadowKeyframeUI();
    });
  }

  
  document.querySelectorAll('#bsTabStroke .bs-param-btn, #bsTabShadow .bs-param-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(() => {
        updateBorderShadowKeyframeUI();
        renderAllKeyframeMarkers();
      }, 10);
    });
  });
  document.querySelectorAll('#borderShadowTabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(updateBorderShadowKeyframeUI, 10);
    });
  });

  
  const btnBSKf = document.getElementById('btnToggleBorderShadowKeyframe');
  const btnBSGraph = document.getElementById('btnBorderShadowGraph');
  if (btnBSKf) {
    if (window.FishUI && window.FishUI.createKeyframeController) {
      window.FishUI.createKeyframeController({
        toggleButton: '#btnToggleBorderShadowKeyframe',
        graphButton: '#btnBorderShadowGraph',
        getChannel: () => getActiveBorderShadowChannel() || 'strokeSize',
        getLayerId: () => selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default',
        getCurrentTime: () => elapsed,
        getKeyframes: (layerId) => layerKeyframes.get(layerId) || [],
        getCurrentValue: (layerId, ch) => {
          const bs = getLayerBorderShadow(layerId);
          if (ch === 'strokeColor') return bs.stroke.color;
          if (ch === 'strokeSize') return bs.stroke.size;
          if (ch === 'shadowColor') return bs.shadow.color;
          if (ch === 'shadowSize') return bs.shadow.size;
          if (ch === 'shadowAlpha') return bs.shadow.alpha;
          if (ch === 'shadowPosX') return bs.shadow.posX;
          if (ch === 'shadowPosY') return bs.shadow.posY;
          return null;
        },
        onToggle: () => {
          const ch = getActiveBorderShadowChannel() || 'strokeSize';
          const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
          const baseChk = layerBorderShadow.get(id) || getLayerBorderShadow(id);
          const isStrokeCh = ['strokeColor','strokeSize'].includes(ch);
          const isShadowCh = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
          if (isStrokeCh && !baseChk.stroke.enabled) return;
          if (isShadowCh && !baseChk.shadow.enabled) return;
          const bs = getLayerBorderShadow(id);
          let val;
          if (ch === 'strokeColor') val = bs.stroke.color;
          else if (ch === 'strokeSize') val = bs.stroke.size;
          else if (ch === 'shadowColor') val = bs.shadow.color;
          else if (ch === 'shadowSize') val = bs.shadow.size;
          else if (ch === 'shadowAlpha') val = bs.shadow.alpha;
          else if (ch === 'shadowPosX') val = bs.shadow.posX;
          else if (ch === 'shadowPosY') val = bs.shadow.posY;
          if (hasKeyframeForChannel(id, elapsed, ch)) {
            const ex = getKeyframeAt(id, elapsed);
            if (ex) {
              delete ex[ch];
              const eKey = 'easing_' + ch;
              if (ex[eKey] !== undefined) delete ex[eKey];
              if (ex.easing) {
                const hasAnyEasing = Object.keys(ex).some(k => k.startsWith('easing_'));
                if (!hasAnyEasing) delete ex.easing;
              }
              const hasAny = ['strokeColor','strokeSize','shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY','posX','posY','posZ','rotX','rotY','rotZ','scaleW','scaleH','opacity'].some(p=>ex[p]!==undefined);
              if (!hasAny) {
                const kfs = layerKeyframes.get(id);
                const idx = kfs.indexOf(ex);
                if (idx!==-1) kfs.splice(idx,1);
              }
            }
          } else {
            recordBorderShadowKeyframe(id, ch, val);
            return;
          }
          updateBorderShadowKeyframeUI();
          renderAllKeyframeMarkers();
          triggerAutoSave();
        },
        onOpenGraph: ({ channel }) => {
          const ch = channel || getActiveBorderShadowChannel() || 'strokeSize';
          const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
          const baseChk = layerBorderShadow.get(id) || getLayerBorderShadow(id);
          const isStrokeCh = ['strokeColor','strokeSize'].includes(ch);
          const isShadowCh = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
          if (isStrokeCh && !baseChk.stroke.enabled) return;
          if (isShadowCh && !baseChk.shadow.enabled) return;
          const anchor = document.getElementById('btnBorderShadowGraph');
          openGraphEditor(ch, anchor);
        }
      });
    } else {
      btnBSKf.addEventListener('click', (e) => {
        e.stopPropagation();
        const ch = getActiveBorderShadowChannel() || 'strokeSize';
        const id = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
        const baseChk = layerBorderShadow.get(id) || getLayerBorderShadow(id);
        const isStrokeCh = ['strokeColor','strokeSize'].includes(ch);
        const isShadowCh = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
        if (isStrokeCh && !baseChk.stroke.enabled) return;
        if (isShadowCh && !baseChk.shadow.enabled) return;
        const bs = getLayerBorderShadow(id);
        let val;
        if (ch === 'strokeColor') val = bs.stroke.color;
        else if (ch === 'strokeSize') val = bs.stroke.size;
        else if (ch === 'shadowColor') val = bs.shadow.color;
        else if (ch === 'shadowSize') val = bs.shadow.size;
        else if (ch === 'shadowAlpha') val = bs.shadow.alpha;
        else if (ch === 'shadowPosX') val = bs.shadow.posX;
        else if (ch === 'shadowPosY') val = bs.shadow.posY;
        if (hasKeyframeForChannel(id, elapsed, ch)) {
          const ex = getKeyframeAt(id, elapsed);
          if (ex) {
            delete ex[ch];
            const eKey = 'easing_' + ch;
            if (ex[eKey] !== undefined) delete ex[eKey];
          }
        } else {
          recordBorderShadowKeyframe(id, ch, val);
        }
        updateBorderShadowKeyframeUI();
        renderAllKeyframeMarkers();
        triggerAutoSave();
      });
      if (btnBSGraph) {
        btnBSGraph.addEventListener('click', (e) => {
          e.stopPropagation();
          const ch = getActiveBorderShadowChannel() || 'strokeSize';
          const idG = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
          const baseChkG = layerBorderShadow.get(idG) || getLayerBorderShadow(idG);
          const isStrokeChG = ['strokeColor','strokeSize'].includes(ch);
          const isShadowChG = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
          if (isStrokeChG && !baseChkG.stroke.enabled) return;
          if (isShadowChG && !baseChkG.shadow.enabled) return;
          const anchor = document.getElementById('btnBorderShadowGraph');
          openGraphEditor(ch, anchor);
        });
      }
    }
  } else if (btnBSGraph) {
    btnBSGraph.addEventListener('click', (e) => {
      e.stopPropagation();
      const ch = getActiveBorderShadowChannel() || 'strokeSize';
      const idG2 = selectedTrackRow ? (selectedTrackRow.dataset.layerId || 'default') : 'default';
      const baseChkG2 = layerBorderShadow.get(idG2) || getLayerBorderShadow(idG2);
      const isStrokeChG2 = ['strokeColor','strokeSize'].includes(ch);
      const isShadowChG2 = ['shadowColor','shadowSize','shadowAlpha','shadowPosX','shadowPosY'].includes(ch);
      if (isStrokeChG2 && !baseChkG2.stroke.enabled) return;
      if (isShadowChG2 && !baseChkG2.shadow.enabled) return;
      const anchor = document.getElementById('btnBorderShadowGraph');
      openGraphEditor(ch, anchor);
    });
  }
}

function syncBorderShadowUI() {
  if (!selectedTrackRow) return;
  const id = selectedTrackRow.dataset.layerId || 'default';
  const bs = getLayerBorderShadow(id);
  const base = layerBorderShadow.get(id) || bs;

  
  const toggleStroke = document.getElementById('toggleStrokeEnabled');
  if (toggleStroke) toggleStroke.checked = !!base.stroke.enabled;

  const strokeBox = document.getElementById('strokeColorBox');
  if (strokeBox) strokeBox.style.background = bs.stroke.color || '#000000';

  const valStrokeSize = document.getElementById('valStrokeSize');
  if (valStrokeSize) valStrokeSize.textContent = Number(bs.stroke.size || 4).toFixed(1);
  if (strokeSizeRulerInstance) strokeSizeRulerInstance.setValue(bs.stroke.size || 4);

  document.querySelectorAll('#strokeCapGroup button').forEach(b => {
    b.classList.toggle('active', b.dataset.cap === (bs.stroke.cap || 'butt'));
  });
  document.querySelectorAll('#strokeAlignGroup button').forEach(b => {
    b.classList.toggle('active', b.dataset.align === (bs.stroke.align || 'center'));
  });

  
  const toggleShadow = document.getElementById('toggleShadowEnabled');
  if (toggleShadow) toggleShadow.checked = !!base.shadow.enabled;

  const shadowBox = document.getElementById('shadowColorBox');
  if (shadowBox) shadowBox.style.background = bs.shadow.color || '#000000';

  const p = parseHexOrRgbLocal(bs.shadow.color || '#000000');
  const rgbText = document.getElementById('shadowRgbText');
  if (rgbText) rgbText.textContent = `${p.r} ${p.g} ${p.b}`;

  const valShadowSize = document.getElementById('valShadowSize');
  if (valShadowSize) valShadowSize.textContent = bs.shadow.size !== undefined ? bs.shadow.size : 4;
  if (shadowSizeRulerInstance) shadowSizeRulerInstance.setValue(bs.shadow.size !== undefined ? bs.shadow.size : 4);

  const valShadowAlpha = document.getElementById('valShadowAlpha');
  if (valShadowAlpha) valShadowAlpha.textContent = `${bs.shadow.alpha !== undefined ? bs.shadow.alpha : 100}%`;
  if (shadowAlphaRulerInstance) shadowAlphaRulerInstance.setValue(bs.shadow.alpha !== undefined ? bs.shadow.alpha : 100);

  const valPosX = document.getElementById('valShadowPosX');
  const valPosY = document.getElementById('valShadowPosY');
  if (valPosX) valPosX.textContent = bs.shadow.posX !== undefined ? bs.shadow.posX : 3;
  if (valPosY) valPosY.textContent = bs.shadow.posY !== undefined ? bs.shadow.posY : 3;

  if (shadowPosRulerInstance) {
    shadowPosRulerInstance.setValue(activeShadowAxis === 'X' ? (bs.shadow.posX || 3) : (bs.shadow.posY || 3));
  }

  
  syncBorderShadowDisabledUI();
}

function applyBorderShadowToMesh(id) {
  applyFillToMeshGlobal(id);
}

window.getLayerBorderShadow = getLayerBorderShadow;
window.getActiveBorderShadowChannel = getActiveBorderShadowChannel;
window.cleanupBorderShadowKeyframes = cleanupBorderShadowKeyframes;
window.syncBorderShadowDisabledUI = syncBorderShadowDisabledUI;
window.recordBorderShadowKeyframe = recordBorderShadowKeyframe;
window.updateBorderShadowKeyframeUI = updateBorderShadowKeyframeUI;
window.parseHexOrRgbLocal = parseHexOrRgbLocal;
window.initBorderShadowController = initBorderShadowController;
window.syncBorderShadowUI = syncBorderShadowUI;
window.applyBorderShadowToMesh = applyBorderShadowToMesh;
