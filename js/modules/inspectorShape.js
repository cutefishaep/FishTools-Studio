function initEditShapeSubpanel() {
  const btnInspEditShape = document.getElementById('btnInspEditShape');
  const panelShape = document.getElementById('panelEditShape');
  const btnBackShape = document.getElementById('btnBackFromEditShape');
  const titleEl = document.getElementById('shapeSubpanelTitle');
  const contentEl = document.getElementById('shapeEditContent');

  if (!btnInspEditShape || !panelShape) return;

  function renderShapeControls(layerId) {
    if (!contentEl) return;
    contentEl.innerHTML = '';

    const row = document.querySelector(`.track-row[data-layer-id="${layerId}"]`);
    const clipName = row?.querySelector('.track-clip-name')?.textContent || '';
    let shapeType = row ? (row.dataset.shapeType || '') : '';

    if (!shapeType) {
      const lower = (clipName + '_' + (row?.dataset?.category || '')).toLowerCase();
      if (lower.includes('heart') || lower.includes('love')) shapeType = 'heart';
      else if (lower.includes('star-4') || lower.includes('bintang_4') || lower.includes('bintang 4')) shapeType = 'star-4';
      else if (lower.includes('star') || lower.includes('bintang')) shapeType = 'star';
      else if (lower.includes('hexagon') || lower.includes('segi_enam') || lower.includes('segi enam')) shapeType = 'hexagon';
      else if (lower.includes('circle') || lower.includes('bulat') || lower.includes('lingkaran')) shapeType = 'circle';
      else if (lower.includes('triangle') || lower.includes('segitiga')) shapeType = 'triangle';
      else if (lower.includes('round')) shapeType = 'round';
      else if (lower.includes('square') || lower.includes('kotak')) shapeType = 'square';
      else if (lower.includes('line') || lower.includes('garis')) shapeType = 'line';
      else if (lower.includes('arrow') || lower.includes('panah')) shapeType = 'arrow';
      else if (lower.includes('svg') || row?.dataset?.category === 'svg') shapeType = 'svg_path';
      else shapeType = 'square';
    }

    const titles = {
      square: 'Edit Shape: Kotak',
      circle: 'Edit Shape: Bulat',
      round: 'Edit Shape: Round',
      triangle: 'Edit Shape: Segitiga',
      heart: 'Edit Shape: Love',
      love: 'Edit Shape: Love',
      star: 'Edit Shape: Bintang',
      'star-4': 'Edit Shape: Bintang 4',
      hexagon: 'Edit Shape: Segi Enam',
      svg_path: 'Edit Shape: Vector SVG',
      line: 'Edit Shape: Garis',
      arrow: 'Edit Shape: Panah'
    };
    if (titleEl) titleEl.textContent = titles[shapeType] || 'Edit Shape';

    const p = getLayerShapeParams(layerId, shapeType);
    if (!p.renderMode) {
      p.renderMode = (shapeType === 'line' || shapeType === 'arrow') ? 'outline' : 'fill';
    }

    let _fillRaf = null;
    function requestDebouncedFillUpdate(id) {
      if (_fillRaf) cancelAnimationFrame(_fillRaf);
      _fillRaf = requestAnimationFrame(() => {
        _fillRaf = null;
        applyFillToMeshGlobal(id);
      });
    }

    function createRulerRow(label, min, max, val, unit, onValChange) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'shape-slider-row';

      const lbl = document.createElement('span');
      lbl.className = 'shape-slider-lbl';
      lbl.textContent = label;

      const rulerTrack = document.createElement('div');
      rulerTrack.className = 'shape-ruler-track';

      const centerMark = document.createElement('div');
      centerMark.className = 'controller-center-mark-w';
      rulerTrack.appendChild(centerMark);

      const valLabel = document.createElement('span');
      valLabel.className = 'shape-slider-val';
      valLabel.textContent = val + (unit || '');

      rowDiv.appendChild(lbl);
      rowDiv.appendChild(rulerTrack);
      rowDiv.appendChild(valLabel);

      if (window.FishUI && window.FishUI.createRuler) {
        const minVal = min !== undefined ? min : -Infinity;
        const maxVal = max !== undefined ? max : Infinity;
        
        const sens = (unit === 'px') ? 0.75 : ((unit === '%') ? 0.35 : 0.2);
        window.FishUI.createRuler({
          container: rulerTrack,
          min: minVal,
          max: maxVal,
          value: val,
          sensitivity: sens,
          onChange: (v) => {
            const rounded = Math.round(v);
            valLabel.textContent = rounded + (unit || '');
            onValChange(rounded);
            triggerAutoSave();
          }
        });
      }

      return rowDiv;
    }

    
    const list = document.createElement('div');
    list.className = 'shape-slider-list';

    if (shapeType === 'square' || shapeType === 'round' || shapeType === 'media') {
      const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
      const defW = projDim.width;
      const defH = projDim.height;
      const defShapeDim = Math.round(Math.min(projDim.width, projDim.height) * 0.38) || 400;
      const curX_px = p.sizeX_px !== undefined ? p.sizeX_px : defShapeDim;
      const curY_px = p.sizeY_px !== undefined ? p.sizeY_px : defShapeDim;
      p.sizeX_px = curX_px;
      p.sizeY_px = curY_px;

      list.appendChild(createRulerRow('Ukuran X', 1, 10000, curX_px, 'px', (v) => {
        p.sizeX_px = Math.max(1, Math.round(v));
        p.sizeX = (p.sizeX_px / defW) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Ukuran Y', 1, 10000, curY_px, 'px', (v) => {
        p.sizeY_px = Math.max(1, Math.round(v));
        p.sizeY = (p.sizeY_px / defH) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Rounded', 0, 500, p.rounded !== undefined ? p.rounded : (shapeType === 'round' ? 22 : 0), 'px', (v) => {
        p.rounded = Math.max(0, Math.round(v));
        requestDebouncedFillUpdate(layerId);
        render3D();
        triggerAutoSave();
      }));
    } else if (shapeType === 'circle') {
      const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
      const defW = projDim.width;
      const defH = projDim.height;
      const curX_px = p.sizeX_px !== undefined ? p.sizeX_px : (p.sizeX ? (p.sizeX / 100) * defW : 400);
      const curY_px = p.sizeY_px !== undefined ? p.sizeY_px : (p.sizeY ? (p.sizeY / 100) * defH : 400);
      p.sizeX_px = curX_px;
      p.sizeY_px = curY_px;

      list.appendChild(createRulerRow('Ukuran X', 1, 10000, curX_px, 'px', (v) => {
        p.sizeX_px = Math.max(1, Math.round(v));
        p.sizeX = (p.sizeX_px / defW) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Ukuran Y', 1, 10000, curY_px, 'px', (v) => {
        p.sizeY_px = Math.max(1, Math.round(v));
        p.sizeY = (p.sizeY_px / defH) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
    } else if (shapeType === 'triangle') {
      const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
      const defW = projDim.width;
      const defH = projDim.height;
      const curX_px = p.sizeX_px !== undefined ? p.sizeX_px : (p.sizeX ? (p.sizeX / 100) * defW : 400);
      const curY_px = p.sizeY_px !== undefined ? p.sizeY_px : (p.sizeY ? (p.sizeY / 100) * defH : 400);
      p.sizeX_px = curX_px;
      p.sizeY_px = curY_px;

      list.appendChild(createRulerRow('Ukuran X', 1, 10000, curX_px, 'px', (v) => {
        p.sizeX_px = Math.max(1, Math.round(v));
        p.sizeX = (p.sizeX_px / defW) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Ukuran Y', 1, 10000, curY_px, 'px', (v) => {
        p.sizeY_px = Math.max(1, Math.round(v));
        p.sizeY = (p.sizeY_px / defH) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Sudut / Step', 3, 30, p.step !== undefined ? p.step : 3, '', (v) => {
        p.step = Math.max(3, Math.round(v));
        requestDebouncedFillUpdate(layerId);
        render3D();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Inner Radius', 10, 100, p.innerRadius !== undefined ? p.innerRadius : 100, '%', (v) => {
        p.innerRadius = Math.max(10, Math.min(100, v));
        requestDebouncedFillUpdate(layerId);
        render3D();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Curve', 0, 100, p.curve !== undefined ? p.curve : 0, '%', (v) => {
        p.curve = Math.max(0, Math.min(100, v));
        requestDebouncedFillUpdate(layerId);
        render3D();
        triggerAutoSave();
      }));
    } else if (shapeType === 'heart' || shapeType === 'love') {
      const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
      const defW = projDim.width;
      const defH = projDim.height;
      const curX_px = p.sizeX_px !== undefined ? p.sizeX_px : (p.sizeX ? (p.sizeX / 100) * defW : 400);
      const curY_px = p.sizeY_px !== undefined ? p.sizeY_px : (p.sizeY ? (p.sizeY / 100) * defH : 400);
      p.sizeX_px = curX_px;
      p.sizeY_px = curY_px;

      list.appendChild(createRulerRow('Ukuran X', 1, 10000, curX_px, 'px', (v) => {
        p.sizeX_px = Math.max(1, Math.round(v));
        p.sizeX = (p.sizeX_px / defW) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Ukuran Y', 1, 10000, curY_px, 'px', (v) => {
        p.sizeY_px = Math.max(1, Math.round(v));
        p.sizeY = (p.sizeY_px / defH) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
    } else if (shapeType === 'star' || shapeType === 'star-4') {
      const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
      const defW = projDim.width;
      const defH = projDim.height;
      const curX_px = p.sizeX_px !== undefined ? p.sizeX_px : (p.sizeX ? (p.sizeX / 100) * defW : 400);
      const curY_px = p.sizeY_px !== undefined ? p.sizeY_px : (p.sizeY ? (p.sizeY / 100) * defH : 400);
      p.sizeX_px = curX_px;
      p.sizeY_px = curY_px;

      list.appendChild(createRulerRow('Ukuran X', 1, 10000, curX_px, 'px', (v) => {
        p.sizeX_px = Math.max(1, Math.round(v));
        p.sizeX = (p.sizeX_px / defW) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Ukuran Y', 1, 10000, curY_px, 'px', (v) => {
        p.sizeY_px = Math.max(1, Math.round(v));
        p.sizeY = (p.sizeY_px / defH) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Points / Step', 3, 30, p.step !== undefined ? p.step : (shapeType === 'star-4' ? 4 : 5), '', (v) => {
        p.step = Math.max(3, Math.round(v));
        requestDebouncedFillUpdate(layerId);
        render3D();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Inner Radius', 10, 90, p.innerRadius !== undefined ? p.innerRadius : (shapeType === 'star-4' ? 30 : 40), '%', (v) => {
        p.innerRadius = Math.max(10, Math.min(90, v));
        requestDebouncedFillUpdate(layerId);
        render3D();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Curve', 0, 100, p.curve !== undefined ? p.curve : 0, '%', (v) => {
        p.curve = Math.max(0, Math.min(100, v));
        requestDebouncedFillUpdate(layerId);
        render3D();
        triggerAutoSave();
      }));
    } else if (shapeType === 'hexagon') {
      const projDim = (typeof getProjectDimensions === 'function') ? getProjectDimensions() : { width: 1080, height: 1920 };
      const defW = projDim.width;
      const defH = projDim.height;
      const curX_px = p.sizeX_px !== undefined ? p.sizeX_px : (p.sizeX ? (p.sizeX / 100) * defW : 400);
      const curY_px = p.sizeY_px !== undefined ? p.sizeY_px : (p.sizeY ? (p.sizeY / 100) * defH : 400);
      p.sizeX_px = curX_px;
      p.sizeY_px = curY_px;

      list.appendChild(createRulerRow('Ukuran X', 1, 10000, curX_px, 'px', (v) => {
        p.sizeX_px = Math.max(1, Math.round(v));
        p.sizeX = (p.sizeX_px / defW) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      list.appendChild(createRulerRow('Ukuran Y', 1, 10000, curY_px, 'px', (v) => {
        p.sizeY_px = Math.max(1, Math.round(v));
        p.sizeY = (p.sizeY_px / defH) * 100;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        requestDebouncedFillUpdate(layerId);
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
    } else if (shapeType === 'line' || shapeType === 'arrow' || shapeType === 'svg_path') {
      list.appendChild(createRulerRow('Ketebalan', 2, 120, p.thickness !== undefined ? p.thickness : (shapeType === 'arrow' ? 16 : 14), 'px', (v) => {
        p.thickness = Math.max(2, v);
        requestDebouncedFillUpdate(layerId);
        render3D();
        triggerAutoSave();
      }));
      if (shapeType === 'arrow') {
        list.appendChild(createRulerRow('Kepala Panah', 10, 150, p.headSize !== undefined ? p.headSize : 34, 'px', (v) => {
          p.headSize = Math.max(10, v);
          requestDebouncedFillUpdate(layerId);
          render3D();
          triggerAutoSave();
        }));
      }
    }

    const isBuiltinShape = ['square', 'circle', 'round', 'triangle', 'heart', 'love', 'star', 'star-4', 'hexagon', 'line', 'arrow'].includes(shapeType);
    const isCustomSvg = !isBuiltinShape && (shapeType === 'svg_path' || shapeType === 'svg' || (row?.dataset?.category === 'svg') || !!(p.svgContent || p.svgUrl));
    const isPathJoystick = (shapeType === 'line' || shapeType === 'arrow');

    if (isCustomSvg) {
      
      const svgContainer = document.createElement('div');
      svgContainer.className = 'am-svg-inspector-container';

      
      const topSliders = document.createElement('div');
      topSliders.className = 'shape-slider-list';
      topSliders.appendChild(createRulerRow('Ukuran X', -Infinity, Infinity, p.sizeX !== undefined ? p.sizeX : 100, '%', (v) => {
        p.sizeX = v;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      topSliders.appendChild(createRulerRow('Ukuran Y', -Infinity, Infinity, p.sizeY !== undefined ? p.sizeY : 100, '%', (v) => {
        p.sizeY = v;
        applyTransformToThreeMesh(layerId, getLayerTransform(layerId));
        render3D();
        requestCanvasOverlayRender();
        triggerAutoSave();
      }));
      svgContainer.appendChild(topSliders);

      
      const modeRow = document.createElement('div');
      modeRow.className = 'shape-slider-row am-svg-mode-row';
      modeRow.style.justifyContent = 'space-between';
      modeRow.innerHTML = `
        <span class="shape-slider-lbl">Pewarnaan</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <button type="button" class="am-svg-mode-btn ${p.colorMode !== 'tint' ? 'active' : ''}" data-mode="original" style="padding: 4px 10px; border-radius: 8px; font-size: 0.72rem; font-weight:800; background: ${p.colorMode !== 'tint' ? 'var(--col-cream, #FAB778)' : 'rgba(255,242,194,0.1)'}; color: ${p.colorMode !== 'tint' ? '#4A1D05' : 'var(--col-yellow, #FFF2C2)'}; border: 1px solid rgba(255,242,194,0.25); cursor:pointer;">ASLI</button>
          <button type="button" class="am-svg-mode-btn ${p.colorMode === 'tint' ? 'active' : ''}" data-mode="tint" style="padding: 4px 10px; border-radius: 8px; font-size: 0.72rem; font-weight:800; background: ${p.colorMode === 'tint' ? 'var(--col-cream, #FAB778)' : 'rgba(255,242,194,0.1)'}; color: ${p.colorMode === 'tint' ? '#4A1D05' : 'var(--col-yellow, #FFF2C2)'}; border: 1px solid rgba(255,242,194,0.25); cursor:pointer;">SOLID TINT</button>
        </div>
      `;

      modeRow.querySelectorAll('.am-svg-mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          p.colorMode = btn.dataset.mode || 'original';
          renderShapeControls(layerId);
          applyFillToMeshGlobal(layerId);
          render3D();
          triggerAutoSave();
        });
      });
      svgContainer.appendChild(modeRow);

      
      if (p.colorMode === 'tint') {
        const tintRow = document.createElement('div');
        tintRow.className = 'shape-slider-row am-svg-tint-row';
        tintRow.style.justifyContent = 'space-between';
        tintRow.innerHTML = `
          <span class="shape-slider-lbl">Warna Tint</span>
          <div class="am-svg-tint-swatch" style="width:34px; height:34px; border-radius:8px; background:${p.tintColor || '#FAB778'}; border:2px solid rgba(255,242,194,0.5); cursor:pointer;"></div>
        `;
        const swatchEl = tintRow.querySelector('.am-svg-tint-swatch');
        if (swatchEl) {
          swatchEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openGlobalColorPicker) {
              window.openGlobalColorPicker({
                color: p.tintColor || '#FAB778',
                alpha: 1,
                anchorElement: swatchEl,
                onChange: (res) => {
                  const newCol = (typeof res === 'object' && res.hex) ? res.hex : (typeof res === 'string' ? res : '#FAB778');
                  p.tintColor = newCol;
                  swatchEl.style.background = newCol;
                  applyFillToMeshGlobal(layerId);
                  render3D();
                  triggerAutoSave();
                }
              });
            }
          });
        }
        svgContainer.appendChild(tintRow);
      }

      
      let svgXml = p.svgContent || '';
      let elements = [];
      let viewBoxInfo = '';
      if (svgXml) {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(svgXml, 'image/svg+xml');
          const rootSvg = doc.querySelector('svg');
          if (rootSvg) {
            viewBoxInfo = rootSvg.getAttribute('viewBox') || (rootSvg.getAttribute('width') + 'x' + rootSvg.getAttribute('height')) || 'Auto';
          }
          elements = Array.from(doc.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line'));
        } catch (_) {}
      }

      
      const infoHeader = document.createElement('div');
      infoHeader.className = 'am-svg-info-header';
      infoHeader.innerHTML = `
        <span class="am-svg-info-title">Elemen Vektor (${elements.length || 0})</span>
        <span class="am-svg-info-badge">viewBox: ${viewBoxInfo || 'Auto'}</span>
      `;
      svgContainer.appendChild(infoHeader);

      
      const elemList = document.createElement('div');
      elemList.className = 'am-svg-element-list';

      if (!p.hiddenElements) p.hiddenElements = {};
      if (!p.elementOverrides) p.elementOverrides = {};

      if (elements.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'am-svg-empty-msg';
        emptyMsg.textContent = 'Elemen vektor tunggal atau grafik SVG terpadu.';
        elemList.appendChild(emptyMsg);
      } else {
        elements.forEach((el, idx) => {
          const tag = el.tagName.toLowerCase();
          let iconName = 'gesture';
          if (tag === 'circle' || tag === 'ellipse') iconName = 'circle';
          else if (tag === 'rect') iconName = 'square';
          else if (tag === 'polygon' || tag === 'polyline') iconName = 'change_history';
          else if (tag === 'line') iconName = 'horizontal_rule';

          const elId = el.getAttribute('id') || el.getAttribute('class') || `${tag.charAt(0).toUpperCase() + tag.slice(1)} #${idx + 1}`;
          const isHidden = !!p.hiddenElements[idx];
          const rawFill = el.getAttribute('fill') || '#FAB778';
          const curFill = (p.elementOverrides[idx] && p.elementOverrides[idx].fill) ? p.elementOverrides[idx].fill : rawFill;

          const rowEl = document.createElement('div');
          rowEl.className = 'am-svg-element-row' + (isHidden ? ' is-hidden' : '');
          rowEl.innerHTML = `
            <div class="am-svg-elem-left">
              <span class="material-symbols-rounded am-svg-elem-icon">${iconName}</span>
              <span class="am-svg-elem-name">${elId}</span>
            </div>
            <div class="am-svg-elem-actions">
              <button type="button" class="am-svg-elem-swatch" title="Ganti Warna Elemen" style="background:${curFill};"></button>
              <button type="button" class="am-svg-elem-eye" title="${isHidden ? 'Tampilkan Elemen' : 'Sembunyikan Elemen'}">
                <span class="material-symbols-rounded" style="font-size:18px;">${isHidden ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
          `;

          
          const swatchBtn = rowEl.querySelector('.am-svg-elem-swatch');
          swatchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openGlobalColorPicker) {
              window.openGlobalColorPicker({
                color: curFill,
                alpha: 1,
                anchorElement: swatchBtn,
                onChange: (res) => {
                  const newCol = (typeof res === 'object' && res.hex) ? res.hex : (typeof res === 'string' ? res : '#FAB778');
                  if (!p.elementOverrides[idx]) p.elementOverrides[idx] = {};
                  p.elementOverrides[idx].fill = newCol;
                  swatchBtn.style.background = newCol;
                  applyFillToMeshGlobal(layerId);
                  render3D();
                  triggerAutoSave();
                }
              });
            }
          });

          
          const eyeBtn = rowEl.querySelector('.am-svg-elem-eye');
          eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nowHidden = !p.hiddenElements[idx];
            p.hiddenElements[idx] = nowHidden;
            rowEl.classList.toggle('is-hidden', nowHidden);
            eyeBtn.querySelector('.material-symbols-rounded').textContent = nowHidden ? 'visibility_off' : 'visibility';
            applyFillToMeshGlobal(layerId);
            render3D();
            triggerAutoSave();
          });

          elemList.appendChild(rowEl);
        });
      }

      svgContainer.appendChild(elemList);
      contentEl.appendChild(svgContainer);
      return;
    }

    if (!isPathJoystick) {
      
      const fillToggleRow = document.createElement('div');
      fillToggleRow.className = 'shape-slider-row';
      fillToggleRow.style.justifyContent = 'space-between';
      fillToggleRow.innerHTML = `
        <span class="shape-slider-lbl">Mode Render</span>
        <button type="button" class="am-shape-toggle-fill ${p.renderMode === 'outline' ? 'is-outline' : ''}" style="width: auto; min-width: 90px; flex-direction: row; gap: 6px; padding: 4px 12px; border-radius: 8px; font-size: 0.72rem;">
          <span class="material-symbols-rounded" style="font-size: 16px;">${p.renderMode === 'outline' ? 'crop_square' : 'format_color_fill'}</span>
          <span>${p.renderMode === 'outline' ? 'OUTLINE' : 'FILL'}</span>
        </button>
      `;
      const toggleBtn = fillToggleRow.querySelector('.am-shape-toggle-fill');
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        p.renderMode = (p.renderMode === 'outline' ? 'fill' : 'outline');
        toggleBtn.classList.toggle('is-outline', p.renderMode === 'outline');
        toggleBtn.querySelector('span:nth-child(2)').textContent = (p.renderMode === 'outline' ? 'OUTLINE' : 'FILL');
        toggleBtn.querySelector('.material-symbols-rounded').textContent = (p.renderMode === 'outline' ? 'crop_square' : 'format_color_fill');
        applyFillToMeshGlobal(layerId);
        renderCanvasOverlay();
        triggerAutoSave();
      });
      list.appendChild(fillToggleRow);
      contentEl.appendChild(list);
    }

    
    if (isPathJoystick) {
      if (!p.points || p.points.length < 2) {
        p.points = [{ x: -50, y: 0 }, { x: 50, y: 0 }];
      }

      let activePointIdx = Math.min(p.points.length - 1, Math.max(0, p.selectedPointIdx || 0));
      let activeEditorMode = 'move'; 

      const editorWrap = document.createElement('div');
      editorWrap.className = 'am-shape-editor-wrap';

      
      const leftBar = document.createElement('div');
      leftBar.className = 'am-shape-left-bar';

      const toolGroup = document.createElement('div');
      toolGroup.className = 'am-shape-tool-group';

      
      const btnMoveTool = document.createElement('button');
      btnMoveTool.type = 'button';
      btnMoveTool.className = 'am-shape-tool-btn' + (activeEditorMode === 'move' ? ' active' : '');
      btnMoveTool.title = 'Pindah Titik (Select / Move)';
      btnMoveTool.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="7" stroke-dasharray="2 2"></circle>
          <circle cx="12" cy="5" r="2" fill="currentColor"></circle>
          <circle cx="19" cy="12" r="2" fill="currentColor"></circle>
          <circle cx="12" cy="19" r="2" fill="currentColor"></circle>
          <circle cx="5" cy="12" r="2" fill="currentColor"></circle>
        </svg>
      `;

      
      const btnSlidersTool = document.createElement('button');
      btnSlidersTool.type = 'button';
      btnSlidersTool.className = 'am-shape-tool-btn' + (activeEditorMode === 'sliders' ? ' active' : '');
      btnSlidersTool.title = 'Pengaturan Ketebalan & Ukuran';
      btnSlidersTool.innerHTML = '<span class="material-symbols-rounded" style="font-size:20px;">tune</span>';

      
      const btnAddTool = document.createElement('button');
      btnAddTool.type = 'button';
      btnAddTool.className = 'am-shape-tool-btn' + (activeEditorMode === 'add' ? ' active' : '');
      btnAddTool.title = 'Tambah Titik Baru (+)';
      btnAddTool.innerHTML = '<span class="material-symbols-rounded" style="font-size:22px;">add_circle</span>';

      function setToolMode(mode) {
        activeEditorMode = mode;
        btnMoveTool.classList.toggle('active', mode === 'move');
        btnSlidersTool.classList.toggle('active', mode === 'sliders');
        btnAddTool.classList.toggle('active', mode === 'add');
        if (mode === 'sliders') {
          gestureView.style.display = 'none';
          slidersView.style.display = 'flex';
        } else {
          slidersView.style.display = 'none';
          gestureView.style.display = 'flex';
          updatePadHint();
        }
      }

      btnMoveTool.addEventListener('click', (e) => { e.stopPropagation(); setToolMode('move'); });
      btnSlidersTool.addEventListener('click', (e) => { e.stopPropagation(); setToolMode('sliders'); });
      btnAddTool.addEventListener('click', (e) => { e.stopPropagation(); setToolMode('add'); });

      toolGroup.appendChild(btnMoveTool);
      toolGroup.appendChild(btnSlidersTool);
      toolGroup.appendChild(btnAddTool);
      leftBar.appendChild(toolGroup);

      
      const centerPad = document.createElement('div');
      centerPad.className = 'am-shape-center-pad';

      
      const gestureView = document.createElement('div');
      gestureView.className = 'am-shape-gesture-view';
      gestureView.style.cssText = 'width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;';

      
      const brTL = document.createElement('div'); brTL.className = 'am-corner-bracket am-corner-tl';
      const brTR = document.createElement('div'); brTR.className = 'am-corner-bracket am-corner-tr';
      const brBL = document.createElement('div'); brBL.className = 'am-corner-bracket am-corner-bl';
      const brBR = document.createElement('div'); brBR.className = 'am-corner-bracket am-corner-br';
      gestureView.appendChild(brTL);
      gestureView.appendChild(brTR);
      gestureView.appendChild(brBL);
      gestureView.appendChild(brBR);

      const padHint = document.createElement('div');
      padHint.className = 'am-shape-pad-hint';
      gestureView.appendChild(padHint);

      function updatePadHint() {
        if (activeEditorMode === 'add') {
          padHint.textContent = 'Swipe here to position next point, then tap here to place it';
        } else {
          padHint.textContent = `Swipe to reposition point #${activePointIdx + 1}`;
        }
      }
      updatePadHint();

      centerPad.appendChild(gestureView);

      
      const slidersView = document.createElement('div');
      slidersView.className = 'am-shape-sliders-container';
      slidersView.style.display = 'none';

      slidersView.appendChild(createRulerRow('Ketebalan', 2, 120, p.thickness !== undefined ? p.thickness : (shapeType === 'arrow' ? 16 : 14), 'px', (v) => { p.thickness = Math.max(2, v); }));
      if (shapeType === 'arrow') {
        slidersView.appendChild(createRulerRow('Kepala Panah', 10, 150, p.headSize !== undefined ? p.headSize : 34, 'px', (v) => { p.headSize = Math.max(10, v); }));
      }

      centerPad.appendChild(slidersView);

      
      let isDraggingPad = false;
      let startX = 0, startY = 0;

      centerPad.addEventListener('pointerdown', (e) => {
        if (activeEditorMode === 'sliders') return;
        e.preventDefault();
        centerPad.setPointerCapture(e.pointerId);
        isDraggingPad = true;
        startX = e.clientX;
        startY = e.clientY;
      });

      centerPad.addEventListener('pointermove', (e) => {
        if (!isDraggingPad || activeEditorMode === 'sliders') return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;

        const curPt = p.points[activePointIdx];
        if (curPt) {
          curPt.x = (Number(curPt.x) || 0) + dx * 0.7;
          curPt.y = (Number(curPt.y) || 0) - dy * 0.7;
          applyFillToMeshGlobal(layerId);
          renderCanvasOverlay();
          updateRailNodes();
        }
      });

      const finishPadDrag = (e) => {
        if (!isDraggingPad || activeEditorMode === 'sliders') return;
        isDraggingPad = false;
        try { centerPad.releasePointerCapture(e.pointerId); } catch(_) {}

        if (activeEditorMode === 'add' && Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) {
          
          const lastPt = p.points[p.points.length - 1] || { x: 50, y: 0 };
          p.points.push({ x: (lastPt.x || 0) + 20, y: (lastPt.y || 0) + 20 });
          activePointIdx = p.points.length - 1;
          p.selectedPointIdx = activePointIdx;
          updateRailNodes();
          applyFillToMeshGlobal(layerId);
          renderCanvasOverlay();
        }
        triggerAutoSave();
      };

      centerPad.addEventListener('pointerup', finishPadDrag);
      centerPad.addEventListener('pointercancel', finishPadDrag);

      
      const rightRail = document.createElement('div');
      rightRail.className = 'am-shape-right-rail';

      const railTrack = document.createElement('div');
      railTrack.className = 'am-rail-track-line';
      rightRail.appendChild(railTrack);

      const railActiveSegment = document.createElement('div');
      railActiveSegment.className = 'am-rail-active-segment';
      rightRail.appendChild(railActiveSegment);

      function updateRailNodes() {
        rightRail.querySelectorAll('.am-rail-node, .am-rail-crosshair-icon').forEach(n => n.remove());

        const num = p.points.length;
        if (num === 0) return;

        const height = rightRail.clientHeight || 180;
        const topPad = 20;
        const bottomPad = 20;
        const usableH = Math.max(40, height - topPad - bottomPad);

        p.points.forEach((pt, idx) => {
          const pct = num > 1 ? (idx / (num - 1)) : 0.5;
          const topY = topPad + pct * usableH;

          const node = document.createElement('div');
          node.className = 'am-rail-node' + (idx === activePointIdx ? ' active' : '');
          node.style.top = `${topY}px`;
          node.title = `Titik #${idx + 1}`;

          node.addEventListener('click', (ev) => {
            ev.stopPropagation();
            activePointIdx = idx;
            p.selectedPointIdx = activePointIdx;
            updateRailNodes();
            updatePadHint();
            renderCanvasOverlay();
          });

          rightRail.appendChild(node);

          if (idx === activePointIdx) {
            const cross = document.createElement('span');
            cross.className = 'material-symbols-rounded am-rail-crosshair-icon';
            cross.style.top = `${topY}px`;
            cross.textContent = 'add';
            rightRail.appendChild(cross);

            
            if (idx > 0) {
              const prevPct = (idx - 1) / (num - 1);
              const prevY = topPad + prevPct * usableH;
              railActiveSegment.style.top = `${prevY}px`;
              railActiveSegment.style.height = `${topY - prevY}px`;
              railActiveSegment.style.display = 'block';
            } else {
              railActiveSegment.style.display = 'none';
            }
          }
        });
      }

      
      let isDraggingRail = false;
      rightRail.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        rightRail.setPointerCapture(e.pointerId);
        isDraggingRail = true;
        handleRailScrub(e);
      });

      rightRail.addEventListener('pointermove', (e) => {
        if (!isDraggingRail) return;
        handleRailScrub(e);
      });

      const finishRailScrub = (e) => {
        if (!isDraggingRail) return;
        isDraggingRail = false;
        try { rightRail.releasePointerCapture(e.pointerId); } catch(_) {}
        triggerAutoSave();
      };

      rightRail.addEventListener('pointerup', finishRailScrub);
      rightRail.addEventListener('pointercancel', finishRailScrub);

      function handleRailScrub(e) {
        const rect = rightRail.getBoundingClientRect();
        const relY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        const pct = relY / rect.height;
        const targetIdx = Math.round(pct * (p.points.length - 1));
        if (targetIdx !== activePointIdx && targetIdx >= 0 && targetIdx < p.points.length) {
          activePointIdx = targetIdx;
          p.selectedPointIdx = activePointIdx;
          updateRailNodes();
          updatePadHint();
          renderCanvasOverlay();
        }
      }

      editorWrap.appendChild(leftBar);
      editorWrap.appendChild(centerPad);
      editorWrap.appendChild(rightRail);
      contentEl.appendChild(editorWrap);

      setTimeout(() => {
        updateRailNodes();
      }, 40);
    }
  }

  btnInspEditShape.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectedTrackRow) return;
    const id = selectedTrackRow.dataset.layerId || 'default';
    openInspectorSubpanel(panelShape, 'subpanel-shape', () => {
      renderShapeControls(id);
    });
  });

  if (btnBackShape) {
    btnBackShape.addEventListener('click', (e) => {
      e.stopPropagation();
      closeInspectorSubpanel(panelShape);
    });
  }
}

window.initEditShapeSubpanel = initEditShapeSubpanel;
