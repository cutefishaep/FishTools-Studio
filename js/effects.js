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

    buildFilter(layer) {
      if (!layer) return '';
      const parts = [];

      if (Array.isArray(layer.effects) && layer.effects.length > 0) {
        for (let i = 0; i < layer.effects.length; i++) {
          const fx = layer.effects[i];
          if (!fx || fx.disabled === true) continue;
          const def = FishEffectsRegistry.get(fx.type);
          if (def && def.category === 'expression') continue;
          if (def && typeof def.filter === 'function') {
            const fStr = def.filter(fx);
            if (fStr) parts.push(fStr);
          }
        }
      } else if (layer.hasBrightnessContrast && layer.effectsDisabled !== true) {
        const def = FishEffectsRegistry.get('brightness-contrast');
        if (def && typeof def.filter === 'function') {
          const fStr = def.filter(layer);
          if (fStr) parts.push(fStr);
        }
      }

      return parts.join(' ').trim();
    },

    applyToContext(ctx, layer) {
      if (!ctx || !layer) return;
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
    }
  };

  global.FishEffectsRegistry = FishEffectsRegistry;
  global.FishEffects = FishEffects;
})(typeof window !== 'undefined' ? window : this);
