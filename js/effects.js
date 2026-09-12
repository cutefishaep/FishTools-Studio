/**
 * EFFECTS.JS - Modular Layer Effects Engine & Plugin Registry
 * Pure flat styling, zero blurs/gradients, 100% theme token binding.
 * Decoupled effect pipeline for FishTool Studio.
 * Loads and coordinates modular effects plugins from effects/*.js
 */

(function(global) {
  'use strict';

  // 1. Registry for modular effects plugins
  const registry = new Map();

  const FishEffectsRegistry = {
    /**
     * Register a new modular effect plugin definition
     * @param {Object} def - Effect plugin descriptor
     */
    register(def) {
      if (!def || !def.id) return;
      registry.set(def.id, {
        id: def.id,
        name: def.name || def.id,
        category: def.category || 'lightning',
        icon: def.icon || 'assets/FXPH.svg',
        description: def.description || '',
        params: Array.isArray(def.params) ? def.params : [],
        filter: typeof def.filter === 'function' ? def.filter : null,
        render: typeof def.render === 'function' ? def.render : null,
        renderPost: typeof def.renderPost === 'function' ? def.renderPost : null
      });
    },

    get(id) {
      return registry.get(id);
    },

    getAll() {
      return Array.from(registry.values());
    },

    getByCategory(cat) {
      return Array.from(registry.values()).filter(e => e.category === cat);
    },

    createInstance(id, customName) {
      const def = registry.get(id);
      if (!def) return null;
      const instance = {
        id: 'fx_' + id.replace(/[^a-z0-9]/gi, '_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: id,
        name: customName || def.name,
        isExpanded: true,
        disabled: false
      };
      def.params.forEach(p => {
        if (p.type === 'switch' || p.type === 'boolean') {
          instance[p.id] = (p.default !== undefined) ? p.default : 1;
        } else if (p.type === 'color') {
          instance[p.id] = p.default || '#ffffff';
        } else if (p.type === 'select') {
          instance[p.id] = p.default || (p.options && p.options[0] ? p.options[0] : 'normal');
        } else {
          instance[p.id] = p.default !== undefined ? p.default : 0;
        }
      });
      return instance;
    }
  };

  // Cache ruler tick marks vector SVG
  let cachedRulerTicksSVG = '';
  function getRulerTicksSVG() {
    if (cachedRulerTicksSVG) return cachedRulerTicksSVG;
    let lines = '';
    for (let i = 0; i <= 40; i++) {
      const pct = (i * 2.5).toFixed(1);
      const isMajor = i % 4 === 0;
      const isMid = i % 2 === 0;
      const y1 = isMajor ? 8 : (isMid ? 11 : 14);
      const y2 = isMajor ? 30 : (isMid ? 27 : 24);
      const opacity = isMajor ? '0.8' : (isMid ? '0.5' : '0.3');
      lines += `<line x1="${pct}%" y1="${y1}" x2="${pct}%" y2="${y2}" stroke="var(--border-panel)" stroke-width="1.2" opacity="${opacity}" vector-effect="non-scaling-stroke"/>`;
    }
    cachedRulerTicksSVG = `<svg class="effects-ruler-ticks" width="100%" height="100%">${lines}</svg>`;
    return cachedRulerTicksSVG;
  }

  // 2. Effects Engine Coordinator
  const FishEffects = {
    registry: FishEffectsRegistry,

    getParamIds(fx) {
      if (!fx) return [];
      const def = FishEffectsRegistry.get(fx.type);
      if (def && Array.isArray(def.params)) {
        return def.params.map(p => p.id);
      }
      return Object.keys(fx).filter(k => !['id', 'type', 'name', 'isExpanded', 'disabled'].includes(k));
    },

    ensureLayerEffects(layer) {
      if (!layer) return [];
      if (!Array.isArray(layer.effects)) {
        layer.effects = [];
        if (layer.hasBrightnessContrast) {
          layer.effects.push({
            id: 'fx_bc_' + (layer.id || Date.now()),
            type: 'brightness-contrast',
            name: 'Brightness / Contrast',
            isExpanded: true,
            disabled: !!layer.effectsDisabled,
            brightness: layer.brightness !== undefined ? layer.brightness : 0,
            contrast: layer.contrast !== undefined ? layer.contrast : 0
          });
        }
      }
      return layer.effects;
    },

    _filterSupported: null,
    isCanvasFilterSupported() {
      if (this._filterSupported !== null) return this._filterSupported;
      if (typeof document === 'undefined') {
        this._filterSupported = false;
        return false;
      }
      try {
        const c = document.createElement('canvas');
        c.width = 2; c.height = 2;
        const ctx = c.getContext('2d');
        if (!ctx || !('filter' in ctx)) {
          this._filterSupported = false;
          return false;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 2, 2);
        const c2 = document.createElement('canvas');
        c2.width = 2; c2.height = 2;
        const ctx2 = c2.getContext('2d');
        ctx2.filter = 'invert(100%)';
        ctx2.drawImage(c, 0, 0);
        const p = ctx2.getImageData(0, 0, 1, 1).data;
        this._filterSupported = (p[0] === 0 && p[1] === 0 && p[2] === 0);
      } catch (_) {
        this._filterSupported = false;
      }
      return this._filterSupported;
    },

    _blurCanvases: [],
    _getBlurCanvas(index, w, h) {
      if (!this._blurCanvases[index]) {
        const c = document.createElement('canvas');
        this._blurCanvases[index] = { canvas: c, ctx: c.getContext('2d') };
      }
      const entry = this._blurCanvases[index];
      const nw = Math.max(1, Math.round(w));
      const nh = Math.max(1, Math.round(h));
      if (entry.canvas.width !== nw || entry.canvas.height !== nh) {
        entry.canvas.width = nw;
        entry.canvas.height = nh;
      }
      return entry;
    },

    drawBlurred(targetCtx, srcEl, w, h, radius) {
      if (!targetCtx || !srcEl) return;
      const r = Math.max(0, Number(radius) || 0);
      const dw = Math.max(1, Math.round(w));
      const dh = Math.max(1, Math.round(h));
      if (r <= 0.5) {
        try { targetCtx.drawImage(srcEl, 0, 0, dw, dh); } catch (_) {}
        return;
      }

      if (this.isCanvasFilterSupported()) {
        targetCtx.save();
        targetCtx.filter = `blur(${r.toFixed(1)}px)`;
        try { targetCtx.drawImage(srcEl, 0, 0, dw, dh); } catch (_) {}
        targetCtx.restore();
        return;
      }

      // Universal Safari / WebKit Fallback: Multi-pass pyramidal downscale & upscale with bilinear smoothing
      const scaleDown = Math.max(0.02, Math.min(0.5, 1 / (1 + r * 0.35)));
      const sw = Math.max(2, Math.round(dw * scaleDown));
      const sh = Math.max(2, Math.round(dh * scaleDown));

      const b0 = this._getBlurCanvas(0, sw, sh);
      b0.ctx.imageSmoothingEnabled = true;
      b0.ctx.imageSmoothingQuality = 'high';
      b0.ctx.clearRect(0, 0, sw, sh);
      try { b0.ctx.drawImage(srcEl, 0, 0, sw, sh); } catch (_) { return; }

      const midW = Math.max(2, Math.round(sw * 0.75));
      const midH = Math.max(2, Math.round(sh * 0.75));
      const b1 = this._getBlurCanvas(1, midW, midH);
      b1.ctx.imageSmoothingEnabled = true;
      b1.ctx.imageSmoothingQuality = 'high';
      b1.ctx.clearRect(0, 0, midW, midH);
      try { b1.ctx.drawImage(b0.canvas, 0, 0, midW, midH); } catch (_) {}

      targetCtx.save();
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.imageSmoothingQuality = 'high';
      try {
        targetCtx.drawImage(b1.canvas, 0, 0, dw, dh);
      } catch (_) {
        try { targetCtx.drawImage(srcEl, 0, 0, dw, dh); } catch (_) {}
      }
      targetCtx.restore();
    },

    buildFilter(layer) {
      if (!layer || !this.isCanvasFilterSupported()) return '';
      const parts = [];

      if (Array.isArray(layer.effects) && layer.effects.length > 0) {
        for (let i = 0; i < layer.effects.length; i++) {
          const fx = layer.effects[i];
          if (!fx || fx.disabled === true) continue;
          const def = FishEffectsRegistry.get(fx.type);
          if (def && def.category === 'expression') continue;
          if (def && typeof def.render === 'function') continue;
          if (def && typeof def.filter === 'function') {
            const fStr = def.filter(fx);
            if (fStr) parts.push(fStr);
          }
        }
      } else if (layer.hasBrightnessContrast && layer.effectsDisabled !== true) {
        const def = FishEffectsRegistry.get('brightness-contrast');
        if (def && typeof def.render !== 'function' && typeof def.filter === 'function') {
          const fStr = def.filter(layer);
          if (fStr) parts.push(fStr);
        }
      }

      return parts.join(' ').trim();
    },

    applyToContext(ctx, layer) {
      if (!ctx || !layer || !this.isCanvasFilterSupported()) return;
      const filter = this.buildFilter(layer);
      if (filter) {
        ctx.filter = filter;
      }
    },

    renderRGBSplit(ctx, el, layer, bounds, fx) {
      const def = FishEffectsRegistry.get('rgb-split');
      if (def && typeof def.render === 'function') {
        def.render(ctx, el, layer, bounds, fx);
      } else if (ctx && el) {
        try { ctx.drawImage(el, bounds.x, bounds.y, bounds.w, bounds.h); } catch (_) {}
      }
    },

    renderTile(ctx, el, layer, bounds, fx, rgbSplitFx) {
      const def = FishEffectsRegistry.get('tile');
      if (def && typeof def.render === 'function') {
        def.render(ctx, el, layer, bounds, fx, rgbSplitFx);
      } else if (ctx && el) {
        try { ctx.drawImage(el, bounds.x, bounds.y, bounds.w, bounds.h); } catch (_) {}
      }
    },

    _pipelineCanvases: [],
    _getPipelineCanvas(index, w, h) {
      if (!this._pipelineCanvases[index]) {
        const c = document.createElement('canvas');
        this._pipelineCanvases[index] = { canvas: c, ctx: c.getContext('2d') };
      }
      const entry = this._pipelineCanvases[index];
      const nw = Math.max(1, Math.round(w));
      const nh = Math.max(1, Math.round(h));
      if (entry.canvas.width !== nw || entry.canvas.height !== nh) {
        entry.canvas.width = nw;
        entry.canvas.height = nh;
      }
      return entry;
    },

    renderLayer(ctx, el, layer, bounds, currentSec) {
      if (!ctx || !el) return;
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;
      const bw = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const bh = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));
      const normBounds = { x: bx, y: by, w: bw, h: bh };

      const effectiveSec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : (layer && typeof layer._currentSec === 'number' ? layer._currentSec : (typeof window !== 'undefined' ? (window.currentPlaybackSec !== undefined ? window.currentPlaybackSec : window.currentSec) : 0));

      const effects = Array.isArray(layer && layer.effects) ? layer.effects.filter(f => f && !f.disabled) : [];
      if (effects.length === 0) {
        try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
        return;
      }

      // Check legacy combo: tile + rgb-split
      const tileFx = effects.find(f => f.type === 'tile');
      const rgbSplitFx = effects.find(f => f.type === 'rgb-split' && ((f.distance !== undefined ? f.distance : 8) > 0));

      const renderEffects = effects.filter(f => {
        const def = FishEffectsRegistry.get(f.type);
        if (!def || def.category === 'expression') return false;
        return typeof def.render === 'function';
      });

      if (renderEffects.length === 0) {
        try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
        return;
      }

      // If tile is present with optional rgbSplit, use existing optimized renderTile
      if (tileFx && renderEffects.length === (rgbSplitFx ? 2 : 1)) {
        this.renderTile(ctx, el, layer, normBounds, tileFx, rgbSplitFx);
        return;
      }

      // Single custom render effect: draw straight into ctx
      if (renderEffects.length === 1) {
        const fx = renderEffects[0];
        const def = FishEffectsRegistry.get(fx.type);
        def.render(ctx, el, layer, normBounds, fx, effectiveSec);
        return;
      }

      // Multi-effect pipeline: chain through offscreen buffers
      const hasExpandingFx = renderEffects.some(f => f.type === 'transform' || f.type === 'tile' || f.type === 'wave-warp' || f.type === 'fsmb');
      let pipeW = bw;
      let pipeH = bh;
      let offX = 0;
      let offY = 0;

      if (hasExpandingFx) {
        const targetCanvas = ctx.canvas;
        const cw = targetCanvas ? targetCanvas.width : (bw * 2);
        const ch = targetCanvas ? targetCanvas.height : (bh * 2);
        pipeW = Math.max(bw, Math.min(cw, 3840));
        pipeH = Math.max(bh, Math.min(ch, 2160));
        offX = Math.round((pipeW - bw) / 2);
        offY = Math.round((pipeH - bh) / 2);
      }

      let currentSource = el;
      for (let i = 0; i < renderEffects.length; i++) {
        const fx = renderEffects[i];
        const def = FishEffectsRegistry.get(fx.type);
        const isLast = (i === renderEffects.length - 1);
        const buf = this._getPipelineCanvas(i % 2, pipeW, pipeH);
        const targetCtx = isLast ? ctx : buf.ctx;
        const targetBounds = isLast
          ? (hasExpandingFx ? { x: normBounds.x - offX, y: normBounds.y - offY, w: pipeW, h: pipeH } : normBounds)
          : { x: offX, y: offY, w: bw, h: bh };

        if (!isLast) {
          buf.ctx.clearRect(0, 0, pipeW, pipeH);
        }

        def.render(targetCtx, currentSource, layer, targetBounds, fx, effectiveSec);

        if (!isLast) {
          currentSource = buf.canvas;
        }
      }
    },

    loadEffectFromXML(xmlText) {
      if (!xmlText || typeof DOMParser === 'undefined') return null;
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'text/xml');
        const effectEl = doc.querySelector('effect');
        if (!effectEl) return null;

        const id = effectEl.getAttribute('id');
        const name = effectEl.getAttribute('name') || id;
        const category = effectEl.getAttribute('category') || 'lightning';
        const icon = effectEl.getAttribute('icon') || 'assets/FXPH.svg';
        const descEl = effectEl.querySelector('description');
        const description = descEl ? descEl.textContent.trim() : '';

        const params = [];
        const paramEls = effectEl.querySelectorAll('params > param');
        paramEls.forEach(p => {
          const pId = p.getAttribute('id');
          const pLabel = p.getAttribute('label') || pId;
          const pType = p.getAttribute('type') || 'number';
          const pMin = p.hasAttribute('min') ? parseFloat(p.getAttribute('min')) : -100;
          const pMax = p.hasAttribute('max') ? parseFloat(p.getAttribute('max')) : 100;
          const pUnit = p.getAttribute('unit') || '';
          let pDef = p.getAttribute('default');
          if (pType === 'number') pDef = pDef !== null ? parseFloat(pDef) : 0;
          else if (pType === 'switch' || pType === 'boolean') pDef = pDef === '0' || pDef === 'false' ? 0 : 1;

          const paramObj = { id: pId, label: pLabel, type: pType, min: pMin, max: pMax, default: pDef, unit: pUnit };
          if (p.hasAttribute('step')) {
            paramObj.step = parseFloat(p.getAttribute('step'));
          }
          if (p.hasAttribute('options')) {
            paramObj.options = p.getAttribute('options').split(',').map(s => s.trim());
          }
          params.push(paramObj);
        });

        const existing = FishEffectsRegistry.get(id);
        const def = {
          id,
          name,
          category,
          icon,
          description,
          params,
          filter: existing ? existing.filter : null,
          render: existing ? existing.render : null,
          renderPost: existing ? existing.renderPost : null
        };
        FishEffectsRegistry.register(def);
        return def;
      } catch (e) {
        console.error('[FishEffects:XML] Error parsing effect XML:', e);
        return null;
      }
    },

    applyPostEffects(ctx, el, layer, bounds) {
      if (!ctx || !layer || !Array.isArray(layer.effects) || layer.effects.length === 0) return;
      for (let i = 0; i < layer.effects.length; i++) {
        const fx = layer.effects[i];
        if (!fx || fx.disabled === true) continue;
        const def = FishEffectsRegistry.get(fx.type);
        if (def && def.category === 'expression') continue;
        if (def && typeof def.renderPost === 'function') {
          def.renderPost(ctx, el, layer, bounds, fx);
        }
      }
    },

    renderCardHTML(fx, layer, activeProperty, currentSec) {
      const def = FishEffectsRegistry.get(fx.type) || {
        name: fx.name || 'Effect',
        params: [
          { id: 'param', label: 'Parameter', min: -100, max: 100, default: 0, unit: '%' }
        ]
      };
      const isExpanded = fx.isExpanded !== false;
      const isDisabled = !!fx.disabled;
      const selectedProp = activeProperty || (typeof window !== 'undefined' && window.activeKeyframeProperty) || (def.params[0] ? `${fx.id}:${def.params[0].id}` : '');
      const ticksMarkup = getRulerTicksSVG();

      let eff = null;
      if (typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function' && layer) {
        const sec = (currentSec !== undefined && currentSec !== null) ? currentSec : ((Math.abs(window.timelinePanX || 0)) / (window.currentPixelsPerSecond || 80));
        eff = window.getLayerEffectivePropsAtTime(layer, sec);
      }

      const effFx = (eff && Array.isArray(eff.effects)) ? eff.effects.find(f => f.id === fx.id) : null;

      const controlsHTML = (def.params || []).map(p => {
        const type = p.type || 'number';

        if (type === 'switch' || type === 'boolean') {
          const propKey = `${fx.id}:${p.id}`;
          const hasKf = layer && layer.keyframes && (
            (layer.keyframes[propKey] && layer.keyframes[propKey].length > 0) ||
            (fx === layer.effects[0] && layer.keyframes[p.id] && layer.keyframes[p.id].length > 0)
          );
          const rawVal = (hasKf && effFx && effFx[p.id] !== undefined)
            ? effFx[p.id]
            : (fx[p.id] !== undefined ? fx[p.id] : (p.default !== undefined ? p.default : 1));
          const switchVal = (rawVal === 1 || rawVal === true || rawVal === '1' || rawVal === 'true' || rawVal === 'on') ? 1 : 0;

          return `
            <div class="effects-control-row effects-control-row-switch" data-param="${p.id}">
              <div class="effects-param-label-static">${p.label || p.id}</div>
              <div class="effects-segmented-group effects-switch-group" data-param="${p.id}">
                <button type="button" class="effects-segmented-btn ${switchVal === 0 ? 'is-active' : ''}" data-param="${p.id}" data-val="0" title="Off">Off</button>
                <button type="button" class="effects-segmented-btn ${switchVal === 1 ? 'is-active' : ''}" data-param="${p.id}" data-val="1" title="On">On</button>
              </div>
            </div>
          `;
        }

        if (type === 'select') {
          const selectVal = (fx[p.id] !== undefined ? fx[p.id] : (p.default || 'normal')).toLowerCase();
          const opts = Array.isArray(p.options) && p.options.length > 0 ? p.options : ['normal', 'multiply', 'overlay'];

          if (p.display === 'segmented') {
            const btns = opts.map(opt => `
              <button type="button" class="effects-segmented-btn ${selectVal === opt.toLowerCase() ? 'is-active' : ''}" data-param="${p.id}" data-val="${opt}" title="${opt}">
                ${opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            `).join('');

            return `
              <div class="effects-control-row effects-control-row-select" data-param="${p.id}">
                <div class="effects-param-label-static">${p.label || p.id}</div>
                <div class="effects-segmented-group" data-param="${p.id}">
                  ${btns}
                </div>
              </div>
            `;
          }

          const formatLabel = (str) => String(str).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const currentOpt = opts.find(o => o.toLowerCase() === selectVal) || opts[0] || selectVal;
          const currentLabel = formatLabel(currentOpt);
          const items = opts.map(opt => {
            const isSelected = opt.toLowerCase() === selectVal;
            const labelText = formatLabel(opt);
            return `<div class="custom-dropdown-item ${isSelected ? 'is-selected' : ''}" role="option" data-val="${opt}" title="${labelText}">${labelText}</div>`;
          }).join('');

          return `
            <div class="effects-control-row effects-control-row-select" data-param="${p.id}">
              <div class="effects-param-label-static">${p.label || p.id}</div>
              <div class="custom-dropdown effects-custom-dropdown" data-param="${p.id}" data-value="${currentOpt}">
                <button type="button" class="custom-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select ${p.label || p.id}">
                  <span class="custom-dropdown-label">${currentLabel}</span>
                  <svg class="custom-dropdown-arrow" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 10l5 5 5-5z"/>
                  </svg>
                </button>
                <div class="custom-dropdown-menu" role="listbox">
                  ${items}
                </div>
              </div>
            </div>
          `;
        }

        if (type === 'color') {
          const colorVal = (fx[p.id] !== undefined && fx[p.id]) ? fx[p.id] : (p.default || '#000000');
          return `
            <div class="effects-control-row effects-control-row-color" data-param="${p.id}">
              <div class="effects-param-label-static">${p.label || p.id}</div>
              <div class="effects-color-picker-wrap">
                <button type="button" class="effects-color-swatch-btn fx-swatch-btn-${p.id}" data-param="${p.id}" title="Pick ${p.label || p.id}">
                  <span class="effects-color-swatch-preview fx-swatch-preview-${p.id}" style="background-color: ${colorVal};"></span>
                </button>
                <input type="text" class="effects-color-hex-input fx-hex-${p.id}" data-param="${p.id}" value="${colorVal}" maxlength="7" spellcheck="false" title="Hex color">
              </div>
            </div>
          `;
        }

        if (type === 'curve') {
          const currentChan = fx.channel || 'rgb';
          let rawPts = null;
          if (currentChan === 'r') rawPts = fx.curveR;
          else if (currentChan === 'g') rawPts = fx.curveG;
          else if (currentChan === 'b') rawPts = fx.curveB;
          else rawPts = fx[p.id] || fx.points;

          if (!rawPts) rawPts = [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]];
          const pts = (Array.isArray(rawPts) ? rawPts : [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]])
            .map(pt => Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [Number(pt.x || 0), Number(pt.y || 0)])
            .sort((a, b) => a[0] - b[0]);

          const curveDef = FishEffectsRegistry.get('curve');
          const spline = (curveDef && typeof curveDef.buildSpline === 'function')
            ? curveDef.buildSpline(pts)
            : function(x) { return x; };

          let pathD = '';
          const steps = 30;
          for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            const vy = Math.max(0, Math.min(1, spline(u)));
            const sx = (u * 200).toFixed(1);
            const sy = ((1.0 - vy) * 200).toFixed(1);
            pathD += (s === 0 ? `M ${sx} ${sy}` : ` L ${sx} ${sy}`);
          }

          let strokeColor = 'var(--color-primary)';
          if (currentChan === 'r') strokeColor = 'var(--color-danger)';
          else if (currentChan === 'g') strokeColor = 'var(--color-primary)';
          else if (currentChan === 'b') strokeColor = '#60a5fa';

          const pointsMarkup = pts.map((pt, idx) => {
            const cx = (pt[0] * 200).toFixed(1);
            const cy = ((1.0 - pt[1]) * 200).toFixed(1);
            return `<circle class="effects-curve-point" data-index="${idx}" cx="${cx}" cy="${cy}" r="6" fill="${strokeColor}"></circle>`;
          }).join('');

          return `
            <div class="effects-control-row effects-control-row-curve" data-param="${p.id}">
              <div class="effects-curve-editor" data-effect-id="${fx.id}" data-param="${p.id}">
                <div class="effects-curve-header">
                  <div class="effects-curve-channels" data-effect-id="${fx.id}">
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'rgb' ? 'is-active' : ''}" data-channel="rgb" title="Master RGB">RGB</button>
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'r' ? 'is-active' : ''}" data-channel="r" title="Red Channel">R</button>
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'g' ? 'is-active' : ''}" data-channel="g" title="Green Channel">G</button>
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'b' ? 'is-active' : ''}" data-channel="b" title="Blue Channel">B</button>
                  </div>
                  <div class="effects-curve-presets-wrap">
                    <select class="effects-curve-presets-select" data-effect-id="${fx.id}" title="Curve Presets">
                      <option value="" disabled selected>Presets</option>
                      <option value="linear">Linear</option>
                      <option value="s_curve">S-Curve</option>
                      <option value="hard_contrast">Hard Contrast</option>
                      <option value="lift_blacks">Lift Blacks</option>
                      <option value="invert">Invert</option>
                    </select>
                  </div>
                </div>

                <div class="effects-curve-canvas-wrap">
                  <svg class="effects-curve-svg" viewBox="0 0 200 200" data-effect-id="${fx.id}" data-param="${p.id}">
                    <line x1="50" y1="0" x2="50" y2="200" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="100" y1="0" x2="100" y2="200" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="150" y1="0" x2="150" y2="200" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="0" y1="50" x2="200" y2="50" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="0" y1="100" x2="200" y2="100" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="0" y1="150" x2="200" y2="150" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4"/>
                    <line x1="0" y1="200" x2="200" y2="0" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.3"/>
                    <path class="effects-curve-path" d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round"/>
                    ${pointsMarkup}
                  </svg>
                </div>

                <div class="effects-curve-footer">
                  <span class="effects-curve-coord" data-effect-id="${fx.id}">In: 128 | Out: 128</span>
                  <button type="button" class="effects-curve-reset-btn" data-effect-id="${fx.id}" title="Reset Curve to Linear">Reset</button>
                </div>
              </div>
            </div>
          `;
        }

        if (type === 'angle') {
          const propKey = `${fx.id}:${p.id}`;
          const hasKf = layer && layer.keyframes && (
            (layer.keyframes[propKey] && layer.keyframes[propKey].length > 0) ||
            (fx === layer.effects[0] && layer.keyframes[p.id] && layer.keyframes[p.id].length > 0)
          );
          const rawVal = (hasKf && effFx && effFx[p.id] !== undefined)
            ? effFx[p.id]
            : (fx[p.id] !== undefined ? fx[p.id] : (p.default || 0));
          const angleVal = Math.round(rawVal);
          const isParamActive = (selectedProp === propKey) ||
            (!selectedProp && fx === layer.effects[0] && p.id === def.params[0].id) ||
            (selectedProp === p.id && (!layer.effects || fx === layer.effects[0]));
          const unit = p.unit || '°';
          const turns = Math.trunc(angleVal / 360);
          const rem = Math.round(angleVal % 360);
          const badgeText = (turns !== 0)
            ? `${turns}x ${rem >= 0 ? '+' : ''}${rem}°`
            : `${rem >= 0 ? '+' : ''}${rem}°`;

          return `
            <div class="effects-control-row" data-param="${p.id}">
              <button type="button" class="effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" title="Select ${p.label || p.id} for keyframing">
                ${p.label || p.id}
              </button>
              <div class="jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${p.id}" data-param="${p.id}" data-unit="${unit}" data-type="angle" data-is-angle="true" data-unlimited="true" role="slider" aria-valuenow="${angleVal}" aria-label="${p.label || p.id} Angle Scrubber">
                <div class="jog-wheel-ticks"></div>
                <div class="jog-wheel-needle"></div>
              </div>
              <button type="button" class="effects-param-value-btn fx-badge-${p.id}" data-param="${p.id}" title="Click to edit ${p.label || p.id} value">
                ${badgeText}
              </button>
            </div>
          `;
        }

        const min = fx.min !== undefined ? fx.min : (p.min !== undefined ? p.min : -100);
        const max = fx.max !== undefined ? fx.max : (p.max !== undefined ? p.max : 100);
        const propKey = `${fx.id}:${p.id}`;
        const hasKf = layer && layer.keyframes && (
          (layer.keyframes[propKey] && layer.keyframes[propKey].length > 0) ||
          (fx === layer.effects[0] && layer.keyframes[p.id] && layer.keyframes[p.id].length > 0)
        );
        const rawVal = (hasKf && effFx && effFx[p.id] !== undefined)
          ? effFx[p.id]
          : (fx[p.id] !== undefined ? fx[p.id] : (p.default || 0));
        const step = fx.step !== undefined ? fx.step : (p.step !== undefined ? p.step : 1);
        const unit = fx.unit !== undefined ? fx.unit : (p.unit || '%');
        const isDecimal = (step < 1) || unit === 'x' || unit.includes('.');
        const numVal = isDecimal
          ? Math.max(min, Math.min(max, Number(parseFloat(rawVal).toFixed(2))))
          : Math.max(min, Math.min(max, Math.round(rawVal)));
        const isParamActive = (selectedProp === propKey) ||
          (!selectedProp && fx === layer.effects[0] && p.id === def.params[0].id) ||
          (selectedProp === p.id && (!layer.effects || fx === layer.effects[0]));
        const formattedVal = isDecimal ? numVal.toFixed(2) : numVal;
        const badgeText = (numVal >= 0 && min < 0 ? '+' : '') + formattedVal + unit;

        return `
          <div class="effects-control-row" data-param="${p.id}">
            <button type="button" class="effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" title="Select ${p.label || p.id} for keyframing">
              ${p.label || p.id}
            </button>
            <div class="jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${p.id}" data-param="${p.id}" data-unit="${unit}" data-min="${min}" data-max="${max}" ${p.step ? `data-step="${p.step}"` : ''} role="slider" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${numVal}" aria-label="${p.label || p.id} Scrubber">
              <div class="jog-wheel-ticks"></div>
              <div class="jog-wheel-needle"></div>
            </div>
            <button type="button" class="effects-param-value-btn fx-badge-${p.id}" data-param="${p.id}" title="Click to edit ${p.label || p.id} value">
              ${badgeText}
            </button>
          </div>
        `;
      }).join('');

      return `
        <div class="effects-card ${isExpanded ? 'is-expanded' : ''}" data-effect-id="${fx.id}">
          <div class="effects-card-swipe-bg" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" class="effects-swipe-trash-icon"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            <span class="effects-swipe-label">Delete</span>
          </div>
          <div class="effects-card-header">
            <div class="effects-card-header-left">
              <button type="button" class="effects-card-caret-btn" title="Toggle Expand" aria-label="Toggle Expand">
                <svg viewBox="0 0 24 24" class="effects-card-caret"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
              </button>
              <span class="effects-card-title">${fx.name || def.name}</span>
            </div>

            <!-- Collapsed state actions: Eye toggle + Kebab menu + Drag handle -->
            <div class="effects-card-collapsed-actions">
              <button type="button" class="effects-card-eye-btn ${isDisabled ? '' : 'is-active'}" title="Enable/Disable Effect" aria-label="Toggle Effect">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
              </button>
              <button type="button" class="effects-card-kebab-btn" title="Effect Options" aria-label="Effect Options">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
              </button>
              <span class="effects-card-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
              </span>
            </div>

            <!-- Expanded state actions: Kebab menu + Trash delete -->
            <div class="effects-card-expanded-actions">
              <button type="button" class="effects-card-kebab-btn" title="Effect Options" aria-label="Effect Options">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
              </button>
              <button type="button" class="effects-card-delete-btn" title="Remove Effect" aria-label="Delete">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </div>
          </div>

          <!-- Kebab Popover Dropdown -->
          <div class="effects-kebab-menu">
            <button type="button" class="effects-kebab-item" data-action="details">Effect Details</button>
            <button type="button" class="effects-kebab-item" data-action="reset">Reset to Defaults</button>
            <button type="button" class="effects-kebab-item" data-action="duplicate">Duplicate</button>
            <button type="button" class="effects-kebab-item" data-action="copy">Copy Effect</button>
            <button type="button" class="effects-kebab-item effects-kebab-item-danger" data-action="delete" style="color: var(--color-danger, #ff453a);">Delete Effect</button>
          </div>

          <div class="effects-card-controls">
            ${controlsHTML}
          </div>
        </div>
      `;
    },

    bindCurveWidget(card, fx, layer) {
      const widget = card.querySelector('.effects-curve-editor');
      if (!widget) return;
      const svg = widget.querySelector('.effects-curve-svg');
      if (!svg) return;

      const curveDef = FishEffectsRegistry.get('curve');
      const presets = (curveDef && curveDef.presets) || {
        linear: [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]],
        s_curve: [[0, 0], [0.25, 0.18], [0.5, 0.5], [0.75, 0.82], [1, 1]],
        hard_contrast: [[0, 0], [0.25, 0.12], [0.5, 0.5], [0.75, 0.88], [1, 1]],
        lift_blacks: [[0, 0.12], [0.25, 0.28], [0.5, 0.5], [0.75, 0.75], [1, 1]],
        invert: [[0, 1], [0.25, 0.75], [0.5, 0.5], [0.75, 0.25], [1, 0]]
      };

      function getCurrentPoints() {
        const chan = fx.channel || 'rgb';
        let pts = null;
        if (chan === 'r') pts = fx.curveR;
        else if (chan === 'g') pts = fx.curveG;
        else if (chan === 'b') pts = fx.curveB;
        else pts = fx.curve || fx.points;

        if (!Array.isArray(pts) || pts.length < 2) {
          pts = JSON.parse(JSON.stringify(presets.linear));
        }
        return pts;
      }

      function setCurrentPoints(pts) {
        const chan = fx.channel || 'rgb';
        if (chan === 'r') fx.curveR = pts;
        else if (chan === 'g') fx.curveG = pts;
        else if (chan === 'b') fx.curveB = pts;
        else {
          fx.curve = pts;
          fx.points = pts;
        }
      }

      function updateSVG() {
        const pts = getCurrentPoints();
        const spline = (curveDef && typeof curveDef.buildSpline === 'function')
          ? curveDef.buildSpline(pts)
          : function(x) { return x; };

        let pathD = '';
        const steps = 30;
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const vy = Math.max(0, Math.min(1, spline(u)));
          const sx = (u * 200).toFixed(1);
          const sy = ((1.0 - vy) * 200).toFixed(1);
          pathD += (s === 0 ? `M ${sx} ${sy}` : ` L ${sx} ${sy}`);
        }

        const chan = fx.channel || 'rgb';
        let strokeColor = 'var(--color-primary)';
        if (chan === 'r') strokeColor = 'var(--color-danger)';
        else if (chan === 'g') strokeColor = 'var(--color-primary)';
        else if (chan === 'b') strokeColor = '#60a5fa';

        const pathEl = svg.querySelector('.effects-curve-path');
        if (pathEl) {
          pathEl.setAttribute('d', pathD);
          pathEl.setAttribute('stroke', strokeColor);
        }

        const oldPoints = svg.querySelectorAll('.effects-curve-point');
        oldPoints.forEach(p => p.remove());

        pts.forEach((pt, idx) => {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('class', 'effects-curve-point');
          circle.setAttribute('data-index', idx);
          circle.setAttribute('cx', (pt[0] * 200).toFixed(1));
          circle.setAttribute('cy', ((1.0 - pt[1]) * 200).toFixed(1));
          circle.setAttribute('r', '6');
          circle.setAttribute('fill', strokeColor);
          svg.appendChild(circle);
        });
      }

      // Channel Buttons
      widget.querySelectorAll('.effects-curve-chan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const chan = btn.dataset.channel || 'rgb';
          fx.channel = chan;
          widget.querySelectorAll('.effects-curve-chan-btn').forEach(b => b.classList.toggle('is-active', b === btn));
          updateSVG();
          if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
          if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-channel');
        });
      });

      // Presets Dropdown
      const presetsSel = widget.querySelector('.effects-curve-presets-select');
      if (presetsSel) {
        presetsSel.addEventListener('change', (e) => {
          e.stopPropagation();
          const pName = presetsSel.value;
          if (presets[pName]) {
            setCurrentPoints(JSON.parse(JSON.stringify(presets[pName])));
            updateSVG();
            if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
            if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-preset');
            if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
          }
          presetsSel.value = '';
        });
      }

      // Reset Button
      const resetBtn = widget.querySelector('.effects-curve-reset-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          setCurrentPoints(JSON.parse(JSON.stringify(presets.linear)));
          updateSVG();
          if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
          if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-reset');
          if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
        });
      }

      // Double-click to delete intermediate control points
      svg.addEventListener('dblclick', (e) => {
        const targetPt = e.target.closest('.effects-curve-point');
        if (!targetPt) return;
        const idx = parseInt(targetPt.dataset.index, 10);
        const pts = getCurrentPoints();
        if (pts.length > 2 && idx > 0 && idx < pts.length - 1) {
          e.stopPropagation();
          e.preventDefault();
          pts.splice(idx, 1);
          setCurrentPoints(pts);
          updateSVG();
          if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
          if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-point-delete');
          if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
        }
      });

      // Pointer Dragging on Points & Click to Add Point
      let activePointIdx = null;
      const coordEl = widget.querySelector('.effects-curve-coord');

      svg.addEventListener('pointerdown', (e) => {
        const targetPt = e.target.closest('.effects-curve-point');
        const pts = getCurrentPoints();
        const rect = svg.getBoundingClientRect();
        const rw = rect.width || 200;
        const rh = rect.height || 200;
        const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rw));
        const ny = Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / rh));

        if (targetPt) {
          activePointIdx = parseInt(targetPt.dataset.index, 10);
        } else {
          let closestIdx = 0;
          let minDist = Infinity;
          pts.forEach((pt, i) => {
            const d = Math.hypot(pt[0] - nx, pt[1] - ny);
            if (d < minDist) {
              minDist = d;
              closestIdx = i;
            }
          });
          if (minDist < 0.10) {
            activePointIdx = closestIdx;
          } else if (pts.length < 12 && nx > 0.02 && nx < 0.98) {
            // Click empty area to add a new point
            pts.push([Number(nx.toFixed(3)), Number(ny.toFixed(3))]);
            pts.sort((a, b) => a[0] - b[0]);
            setCurrentPoints(pts);
            activePointIdx = pts.findIndex(p => Math.abs(p[0] - nx) < 0.005 && Math.abs(p[1] - ny) < 0.005);
            updateSVG();
            if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
            if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-add-point');
          }
        }

        if (activePointIdx !== null) {
          e.stopPropagation();
          e.preventDefault();
          try { svg.setPointerCapture(e.pointerId); } catch (_) {}

          function onPointerMove(ev) {
            const r = svg.getBoundingClientRect();
            const rw_ = r.width || 200;
            const rh_ = r.height || 200;
            let x = Math.max(0, Math.min(1, (ev.clientX - r.left) / rw_));
            let y = Math.max(0, Math.min(1, 1.0 - (ev.clientY - r.top) / rh_));

            const curPts = getCurrentPoints();
            if (activePointIdx === 0) {
              x = 0;
            } else if (activePointIdx === curPts.length - 1) {
              x = 1;
            } else {
              const prevX = (curPts[activePointIdx - 1] ? curPts[activePointIdx - 1][0] : 0) + 0.015;
              const nextX = (curPts[activePointIdx + 1] ? curPts[activePointIdx + 1][0] : 1) - 0.015;
              x = Math.max(prevX, Math.min(nextX, x));
            }

            curPts[activePointIdx] = [Number(x.toFixed(3)), Number(y.toFixed(3))];
            setCurrentPoints(curPts);
            updateSVG();

            if (coordEl) {
              coordEl.textContent = `In: ${Math.round(x * 255)} | Out: ${Math.round(y * 255)}`;
            }

            if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
            if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-drag');
          }

          function onPointerUp(ev) {
            try { svg.releasePointerCapture(ev.pointerId); } catch (_) {}
            svg.removeEventListener('pointermove', onPointerMove);
            svg.removeEventListener('pointerup', onPointerUp);
            svg.removeEventListener('pointercancel', onPointerUp);
            activePointIdx = null;
            if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
          }

          svg.addEventListener('pointermove', onPointerMove);
          svg.addEventListener('pointerup', onPointerUp);
          svg.addEventListener('pointercancel', onPointerUp);
        }
      });

      // Hover coordinates
      svg.addEventListener('pointermove', (e) => {
        if (activePointIdx !== null) return;
        const rect = svg.getBoundingClientRect();
        const rw = rect.width || 200;
        const rh = rect.height || 200;
        const hx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rw));
        const hy = Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / rh));
        if (coordEl) {
          coordEl.textContent = `In: ${Math.round(hx * 255)} | Out: ${Math.round(hy * 255)}`;
        }
      });

      // Initial SVG render
      updateSVG();
    }
  };

  global.FishEffectsRegistry = FishEffectsRegistry;
  global.FishEffects = FishEffects;
})(typeof window !== 'undefined' ? window : this);
