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
      const registeredDef = {
        ...def,
        id: def.id,
        name: def.name || def.id,
        category: def.category || 'lightning',
        icon: def.icon || 'assets/FXPH.svg',
        description: def.description || '',
        params: Array.isArray(def.params) ? def.params : [],
        filter: typeof def.filter === 'function' ? def.filter : null,
        render: typeof def.render === 'function' ? def.render : null,
        renderPost: typeof def.renderPost === 'function' ? def.renderPost : null,
        onButtonClick: typeof def.onButtonClick === 'function' ? def.onButtonClick : null,
        isExpanding: !!def.isExpanding,
        isExclusive3D: !!def.isExclusive3D
      };
      registry.set(def.id, registeredDef);

      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
          window.dispatchEvent(new CustomEvent('fisheffects:registered', { detail: registeredDef }));
        } catch (_) {}
      }
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
        if (p.type === 'button' || p.type === 'action') {
          return;
        } else if (p.type === 'switch' || p.type === 'boolean') {
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

  // WebGL High-Performance Studio Blur Engine (GPU Accelerated, Safari & WebKit 100% Fidelity)
  let _blurGLCanvas = null;
  let _blurGL = null;
  let _blurGLProg = null;
  let _blurGLUniforms = null;
  let _blurGLPosBuf = null;
  let _blurGLUvBuf = null;
  let _blurGLTex0 = null;
  let _blurGLTex1 = null;
  let _blurGLFBO0 = null;
  let _blurGLFBO1 = null;
  let _blurGLW = 0;
  let _blurGLH = 0;
  let _blurGLFailed = false;
  let _blurScratchCanvas = null;
  let _blurScratchCtx = null;

  function initBlurGL() {
    if (_blurGL && _blurGLProg) return true;
    if (_blurGLFailed || typeof document === 'undefined') return false;
    try {
      if (!_blurGLCanvas) _blurGLCanvas = document.createElement('canvas');
      const opts = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true };
      const gl = _blurGLCanvas.getContext('webgl2', opts) ||
                 _blurGLCanvas.getContext('webgl', opts) ||
                 _blurGLCanvas.getContext('experimental-webgl', opts);
      if (!gl) { _blurGLFailed = true; return false; }
      _blurGL = gl;

      const vs = [
        'attribute vec2 a_pos;',
        'attribute vec2 a_uv;',
        'varying vec2 v_uv;',
        'void main(void) {',
        '  v_uv = a_uv;',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n');

      // 9-tap separable Gaussian blur with linear sampling (5 lookups)
      const fs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_texture;',
        'uniform vec2 u_delta;',
        'void main(void) {',
        '  vec4 col = texture2D(u_texture, v_uv) * 0.2270270270;',
        '  vec2 d1 = u_delta * 1.3846153846;',
        '  vec2 d2 = u_delta * 3.2307692308;',
        '  col += texture2D(u_texture, v_uv + d1) * 0.3162162162;',
        '  col += texture2D(u_texture, v_uv - d1) * 0.3162162162;',
        '  col += texture2D(u_texture, v_uv + d2) * 0.0702702703;',
        '  col += texture2D(u_texture, v_uv - d2) * 0.0702702703;',
        '  gl_FragColor = col;',
        '}'
      ].join('\n');

      function compile(t, s) {
        const sh = gl.createShader(t);
        gl.shaderSource(sh, s);
        gl.compileShader(sh);
        return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
      }

      const vShader = compile(gl.VERTEX_SHADER, vs);
      const fShader = compile(gl.FRAGMENT_SHADER, fs);
      if (!vShader || !fShader) { _blurGLFailed = true; return false; }

      const prog = gl.createProgram();
      gl.attachShader(prog, vShader);
      gl.attachShader(prog, fShader);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { _blurGLFailed = true; return false; }

      _blurGLProg = prog;
      _blurGLUniforms = {
        texture: gl.getUniformLocation(prog, 'u_texture'),
        delta: gl.getUniformLocation(prog, 'u_delta')
      };

      _blurGLPosBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _blurGLPosBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

      _blurGLUvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _blurGLUvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

      function createFBOTexture() {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const fbo = gl.createFramebuffer();
        return { tex, fbo };
      }

      const fbo0 = createFBOTexture();
      _blurGLTex0 = fbo0.tex;
      _blurGLFBO0 = fbo0.fbo;

      const fbo1 = createFBOTexture();
      _blurGLTex1 = fbo1.tex;
      _blurGLFBO1 = fbo1.fbo;

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      return true;
    } catch (_) {
      _blurGLFailed = true;
      return false;
    }
  }

  // 2. Effects Engine Coordinator
  const FishEffects = {
    registry: FishEffectsRegistry,

    getParamIds(fx) {
      if (!fx) return [];
      const def = FishEffectsRegistry.get(fx.type);
      if (def && Array.isArray(def.params)) {
        return def.params.filter(p => p.type !== 'button' && p.type !== 'action').map(p => p.id);
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

    drawBlurred(targetCtx, srcEl, w, h, radius, dx, dy) {
      if (!targetCtx || !srcEl) return;
      const r = Math.max(0, Number(radius) || 0);
      const dw = Math.max(1, Math.round(w));
      const dh = Math.max(1, Math.round(h));
      const ox = (dx !== undefined && !isNaN(dx)) ? Math.round(dx) : 0;
      const oy = (dy !== undefined && !isNaN(dy)) ? Math.round(dy) : 0;
      if (r <= 0.5) {
        try { targetCtx.drawImage(srcEl, ox, oy, dw, dh); } catch (_) {}
        return;
      }

      // 1. WebGL Fast GPU Separable Gaussian Blur (100% smooth, Safari & Chrome compatible)
      if (!_blurGLFailed && initBlurGL()) {
        try {
          const gl = _blurGL;
          const prog = _blurGLProg;
          const u = _blurGLUniforms;

          // Adaptive downscaling for massive radii:
          const downscale = r <= 4 ? 1 : (r <= 16 ? 2 : 4);
          const bw = Math.max(2, Math.round(dw / downscale));
          const bh = Math.max(2, Math.round(dh / downscale));

          if (_blurGLCanvas.width !== bw || _blurGLCanvas.height !== bh) {
            _blurGLCanvas.width = bw;
            _blurGLCanvas.height = bh;
          }

          gl.useProgram(prog);

          if (_blurGLW !== bw || _blurGLH !== bh) {
            _blurGLW = bw;
            _blurGLH = bh;

            gl.bindTexture(gl.TEXTURE_2D, _blurGLTex0);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, _blurGLFBO0);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _blurGLTex0, 0);

            gl.bindTexture(gl.TEXTURE_2D, _blurGLTex1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, _blurGLFBO1);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _blurGLTex1, 0);
          }

          // Upload source image to Tex0
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, _blurGLTex0);
          let uploaded = false;
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcEl);
            uploaded = true;
          } catch (_) {
            if (!_blurScratchCanvas) {
              _blurScratchCanvas = document.createElement('canvas');
              _blurScratchCtx = _blurScratchCanvas.getContext('2d');
            }
            const sw = Math.min(1920, srcEl.videoWidth || srcEl.naturalWidth || srcEl.width || bw);
            const sh = Math.min(1080, srcEl.videoHeight || srcEl.naturalHeight || srcEl.height || bh);
            if (_blurScratchCanvas.width !== sw || _blurScratchCanvas.height !== sh) {
              _blurScratchCanvas.width = sw;
              _blurScratchCanvas.height = sh;
            }
            _blurScratchCtx.clearRect(0, 0, sw, sh);
            _blurScratchCtx.drawImage(srcEl, 0, 0, sw, sh);
            try {
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, _blurScratchCanvas);
              uploaded = true;
            } catch (_) {}
          }

          if (uploaded) {
            gl.viewport(0, 0, bw, bh);

            const posLoc = gl.getAttribLocation(prog, 'a_pos');
            gl.bindBuffer(gl.ARRAY_BUFFER, _blurGLPosBuf);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

            const uvLoc = gl.getAttribLocation(prog, 'a_uv');
            gl.bindBuffer(gl.ARRAY_BUFFER, _blurGLUvBuf);
            gl.enableVertexAttribArray(uvLoc);
            gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

            gl.uniform1i(u.texture, 0);

            const effRadius = r / downscale;
            const passes = downscale === 4 ? 2 : 1;
            const step = (effRadius / passes) * 0.70;

            let srcTex = _blurGLTex0;
            let dstFBO = _blurGLFBO1;
            let dstTex = _blurGLTex1;

            for (let p = 0; p < passes; p++) {
              // Horizontal Pass
              gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO);
              gl.bindTexture(gl.TEXTURE_2D, srcTex);
              gl.uniform2f(u.delta, step / bw, 0.0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

              // Vertical Pass
              const isFinal = (p === passes - 1);
              if (isFinal) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.bindTexture(gl.TEXTURE_2D, dstTex);
                gl.uniform2f(u.delta, 0.0, step / bh);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              } else {
                gl.bindFramebuffer(gl.FRAMEBUFFER, srcTex === _blurGLTex0 ? _blurGLFBO0 : _blurGLFBO1);
                gl.bindTexture(gl.TEXTURE_2D, dstTex);
                gl.uniform2f(u.delta, 0.0, step / bh);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                // swap
                const tmp = srcTex; srcTex = dstTex; dstTex = tmp;
                dstFBO = (dstTex === _blurGLTex1) ? _blurGLFBO1 : _blurGLFBO0;
              }
            }

            targetCtx.save();
            targetCtx.imageSmoothingEnabled = true;
            targetCtx.imageSmoothingQuality = 'high';
            targetCtx.drawImage(_blurGLCanvas, ox, oy, dw, dh);
            targetCtx.restore();
            return;
          }
        } catch (_) {}
      }

      // 2. Native Canvas2D Filter fallback (if supported in Chrome/Firefox)
      if (this.isCanvasFilterSupported()) {
        targetCtx.save();
        targetCtx.filter = `blur(${r.toFixed(1)}px)`;
        try { targetCtx.drawImage(srcEl, ox, oy, dw, dh); } catch (_) {}
        targetCtx.restore();
        return;
      }

      // 3. Multi-Step Smooth Cascade Fallback (for non-WebGL environments)
      const steps = Math.min(3, Math.max(1, Math.round(Math.log2(1 + r * 0.2))));
      let curW = dw;
      let curH = dh;
      let prevCanvas = srcEl;

      for (let s = 0; s < steps; s++) {
        curW = Math.max(4, Math.round(curW * 0.5));
        curH = Math.max(4, Math.round(curH * 0.5));
        const entry = this._getBlurCanvas(s, curW, curH);
        entry.ctx.imageSmoothingEnabled = true;
        entry.ctx.imageSmoothingQuality = 'high';
        entry.ctx.clearRect(0, 0, curW, curH);
        entry.ctx.drawImage(prevCanvas, 0, 0, curW, curH);
        prevCanvas = entry.canvas;
      }

      targetCtx.save();
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.imageSmoothingQuality = 'high';
      targetCtx.drawImage(prevCanvas, ox, oy, dw, dh);
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

    isEffectIdentity(fx) {
      if (!fx || fx.disabled) return true;
      const type = fx.type;
      if (type === 'wave-warp') {
        return Math.abs(fx.waveHeight !== undefined ? fx.waveHeight : 25) < 0.05;
      }
      if (type === 'hue-shift') {
        const rawHue = fx.hue !== undefined ? Number(fx.hue) : 0;
        const normAngle = ((rawHue % 360) + 360) % 360;
        return Math.abs(normAngle) < 0.1 || Math.abs(normAngle - 360) < 0.1;
      }
      if (type === 'transform') {
        const s = fx.scale !== undefined ? Number(fx.scale) : 100;
        const r = fx.rotation !== undefined ? Number(fx.rotation) : 0;
        const x = fx.posX !== undefined ? Number(fx.posX) : 0;
        const y = fx.posY !== undefined ? Number(fx.posY) : 0;
        const sk = fx.skew !== undefined ? Number(fx.skew) : 0;
        const op = fx.opacity !== undefined ? Number(fx.opacity) : 100;
        return s === 100 && r === 0 && x === 0 && y === 0 && sk === 0 && op === 100;
      }
      if (type === 'brightness-contrast' || type === 'brightness_contrast') {
        return (!fx.brightness) && (!fx.contrast);
      }
      if (type === 'fast-box-blur' || type === 'fast_box_blur') {
        return !fx.radius || fx.radius <= 0.1;
      }
      if (type === 'gaussian-blur' || type === 'gaussian_blur') {
        return !fx.blur || fx.blur <= 0.1;
      }
      if (type === 'drop-shadow') {
        const op = fx.opacity !== undefined ? fx.opacity : 75;
        const blur = fx.blur !== undefined ? fx.blur : 10;
        const dist = fx.distance !== undefined ? fx.distance : 15;
        return op <= 0 || (blur <= 0 && dist <= 0);
      }
      return false;
    },

    hasNonIdentityEffects(layer) {
      if (!layer || !Array.isArray(layer.effects) || layer.effects.length === 0) return false;
      return layer.effects.some(fx => !this.isEffectIdentity(fx));
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
        : (layer && typeof layer._currentSec === 'number'
          ? layer._currentSec
          : (typeof window !== 'undefined'
            ? (typeof window._currentRenderSec === 'number' && !isNaN(window._currentRenderSec)
              ? window._currentRenderSec
              : (window.currentPlaybackSec !== undefined ? window.currentPlaybackSec : window.currentSec))
            : 0));

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
        if (typeof def.render !== 'function') return false;
        return !this.isEffectIdentity(f);
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
      const hasExpandingFx = renderEffects.some(f => {
        const d = FishEffectsRegistry.get(f.type);
        return (d && (d.isExpanding || d.category === 'warp')) || f.type === 'transform' || f.type === 'tile' || f.type === 'fsmb';
      });
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

      // Mobile / editor.html layout lock: 3D Element requires desktop workstation
      const isMobileEditor = (typeof window !== 'undefined') && (
        (window.location && window.location.pathname && window.location.pathname.includes('editor.html')) ||
        (typeof document !== 'undefined' && !document.querySelector('.desktop-workstation, .desktop-viewport')) ||
        (typeof window.isDesktopLayout === 'function' && !window.isDesktopLayout()) ||
        (typeof window.innerWidth === 'number' && window.innerWidth <= 600)
      );
      const is3DElement = (fx.type === '3d-element' || def.id === '3d-element');

      if (isMobileEditor && is3DElement) {
        return `
        <div class="effects-card fx-${fx.id} ${isExpanded ? 'is-expanded' : ''} ${isDisabled ? 'is-disabled' : ''}" data-effect-id="${fx.id}" data-effect-type="${fx.type}">
          <div class="effects-card-header">
            <div class="effects-card-left">
              <button type="button" class="effects-card-toggle-btn" title="Toggle Controls" aria-label="Toggle Controls">
                <svg viewBox="0 0 24 24" class="effects-card-caret"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
              </button>
              <span class="effects-card-title">${fx.name || def.name}</span>
            </div>
            <div class="effects-card-actions">
              <button type="button" class="effects-card-eye-btn ${isDisabled ? '' : 'is-active'}" title="Enable/Disable Effect" aria-label="Toggle Effect">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
              </button>
              <button type="button" class="effects-card-delete-btn" title="Remove Effect" aria-label="Delete">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </div>
          </div>
          <div class="effects-card-controls">
            <div class="effects-control-row effects-control-row-mobile-lock">
              <div class="fx-mobile-lock">Switch to desktop view to edit this effects</div>
            </div>
          </div>
        </div>
        `;
      }

      let eff = null;
      if (typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function' && layer) {
        const sec = (currentSec !== undefined && currentSec !== null) ? currentSec : ((Math.abs(window.timelinePanX || 0)) / (window.currentPixelsPerSecond || 80));
        eff = window.getLayerEffectivePropsAtTime(layer, sec);
      }

      const effFx = (eff && Array.isArray(eff.effects)) ? eff.effects.find(f => f.id === fx.id) : null;

      const processedParams = new Set();
      const controlsHTMLArr = [];
      const paramsList = def.params || [];
      const sec = (currentSec !== undefined && currentSec !== null) ? currentSec : 0;
      const tol = 0.04;

      for (let i = 0; i < paramsList.length; i++) {
        const p = paramsList[i];
        if (processedParams.has(p.id)) continue;

        const type = p.type || 'number';

        if (type === 'switch' || type === 'boolean') {
          processedParams.add(p.id);
          const propKey = `${fx.id}:${p.id}`;
          const hasKf = layer && layer.keyframes && (
            (layer.keyframes[propKey] && layer.keyframes[propKey].length > 0) ||
            (fx === layer.effects[0] && layer.keyframes[p.id] && layer.keyframes[p.id].length > 0)
          );
          const rawVal = (hasKf && effFx && effFx[p.id] !== undefined)
            ? effFx[p.id]
            : (fx[p.id] !== undefined ? fx[p.id] : (p.default !== undefined ? p.default : 1));
          const switchVal = (rawVal === 1 || rawVal === true || rawVal === '1' || rawVal === 'true' || rawVal === 'on') ? 1 : 0;

          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-switch" data-param="${p.id}">
              <div class="effects-param-label-col">
                <span class="effects-param-label" title="${p.label || p.id}">${p.label || p.id}</span>
              </div>
              <div class="effects-param-val-col">
                <div class="effects-segmented-group effects-switch-group" data-param="${p.id}">
                  <button type="button" class="effects-segmented-btn ${switchVal === 0 ? 'is-active' : ''}" data-param="${p.id}" data-val="0" title="Off">Off</button>
                  <button type="button" class="effects-segmented-btn ${switchVal === 1 ? 'is-active' : ''}" data-param="${p.id}" data-val="1" title="On">On</button>
                </div>
              </div>
            </div>
          `);
          continue;
        }

        if (type === 'select') {
          processedParams.add(p.id);
          const rawSelectVal = fx[p.id] !== undefined ? fx[p.id] : (p.default !== undefined ? p.default : 'normal');
          const selectVal = String(rawSelectVal).toLowerCase();
          const rawOpts = Array.isArray(p.options) && p.options.length > 0 ? p.options : ['normal', 'multiply', 'overlay'];
          const opts = rawOpts.map(o => {
            if (typeof o === 'object' && o !== null) {
              return { value: String(o.value !== undefined ? o.value : ''), label: String(o.label || o.value || '') };
            }
            const s = String(o);
            return { value: s, label: s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) };
          });

          if (p.display === 'segmented') {
            const btns = opts.map(opt => `
              <button type="button" class="effects-segmented-btn ${selectVal === opt.value.toLowerCase() ? 'is-active' : ''}" data-param="${p.id}" data-val="${opt.value}" title="${opt.label}">
                ${opt.label}
              </button>
            `).join('');

            controlsHTMLArr.push(`
              <div class="effects-control-row effects-control-row-select" data-param="${p.id}">
                <div class="effects-param-label-col">
                  <span class="effects-param-label" title="${p.label || p.id}">${p.label || p.id}</span>
                </div>
                <div class="effects-param-val-col">
                  <div class="effects-segmented-group" data-param="${p.id}">
                    ${btns}
                  </div>
                </div>
              </div>
            `);
            continue;
          }

          const matchedOpt = opts.find(o => o.value.toLowerCase() === selectVal) || opts[0];
          const currentVal = matchedOpt ? matchedOpt.value : selectVal;
          const currentLabel = matchedOpt ? matchedOpt.label : selectVal;

          const items = opts.map(opt => {
            const isSelected = opt.value.toLowerCase() === selectVal;
            return `<div class="custom-dropdown-item ${isSelected ? 'is-selected' : ''}" role="option" data-val="${opt.value}" title="${opt.label}">${opt.label}</div>`;
          }).join('');

          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-select" data-param="${p.id}">
              <div class="effects-param-label-col">
                <span class="effects-param-label" title="${p.label || p.id}">${p.label || p.id}</span>
              </div>
              <div class="effects-param-val-col">
                <div class="custom-dropdown effects-custom-dropdown" data-param="${p.id}" data-value="${currentVal}">
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
            </div>
          `);
          continue;
        }

        if (type === 'color') {
          processedParams.add(p.id);
          const colorVal = (fx[p.id] !== undefined && fx[p.id]) ? fx[p.id] : (p.default || '#000000');
          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-color" data-param="${p.id}">
              <div class="effects-param-label-col">
                <span class="effects-param-label" title="${p.label || p.id}">${p.label || p.id}</span>
              </div>
              <div class="effects-param-val-col">
                <div class="effects-color-picker-wrap">
                  <button type="button" class="effects-color-swatch-btn fx-swatch-btn-${p.id}" data-param="${p.id}" title="Pick ${p.label || p.id}">
                    <span class="effects-color-swatch-preview fx-swatch-preview-${p.id}" style="background-color: ${colorVal};"></span>
                  </button>
                  <input type="text" class="effects-color-hex-input fx-hex-${p.id}" data-param="${p.id}" value="${colorVal}" maxlength="7" spellcheck="false" title="Hex color">
                </div>
              </div>
            </div>
          `);
          continue;
        }

        if (type === 'curve') {
          processedParams.add(p.id);
          const currentChan = fx.channel || 'rgb';
          let rawPts = null;
          if (currentChan === 'r') rawPts = fx.curveR;
          else if (currentChan === 'g') rawPts = fx.curveG;
          else if (currentChan === 'b') rawPts = fx.curveB;
          else rawPts = fx[p.id] || fx.points;

          if (!rawPts) rawPts = [[0, 0], [1, 1]];
          const pts = (Array.isArray(rawPts) ? rawPts : [[0, 0], [1, 1]])
            .map(pt => Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [Number(pt.x || 0), Number(pt.y || 0)])
            .sort((a, b) => a[0] - b[0]);

          const curveDef = FishEffectsRegistry.get('curve');
          const spline = (curveDef && typeof curveDef.buildSpline === 'function')
            ? curveDef.buildSpline(pts)
            : function(x) { return x; };

          const contrast = (fx && fx.contrast !== undefined) ? Number(fx.contrast) : 0;
          const c = Math.max(-1, Math.min(1, contrast / 100.0));

          let pathD = '';
          const steps = 30;
          for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            let vy = Math.max(0, Math.min(1, spline(u)));
            if (c !== 0) {
              vy = vy - c * 0.22 * Math.sin(Math.PI * 2 * vy);
              vy = Math.max(0, Math.min(1, vy));
            }
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
            return `<circle class="effects-curve-point" data-index="${idx}" cx="${cx}" cy="${cy}" r="5.5" fill="${strokeColor}"></circle>`;
          }).join('');

          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-curve" data-param="${p.id}">
              <div class="effects-curve-editor" data-effect-id="${fx.id}" data-param="${p.id}">
                <div class="effects-curve-header">
                  <div class="effects-curve-channels" data-effect-id="${fx.id}">
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'rgb' ? 'is-active' : ''}" data-channel="rgb" title="Master RGB">RGB</button>
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'r' ? 'is-active' : ''}" data-channel="r" title="Red Channel">R</button>
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'g' ? 'is-active' : ''}" data-channel="g" title="Green Channel">G</button>
                    <button type="button" class="effects-curve-chan-btn ${currentChan === 'b' ? 'is-active' : ''}" data-channel="b" title="Blue Channel">B</button>
                  </div>
                  <div class="effects-curve-presets-bar">
                    <button type="button" class="effects-curve-preset-pill" data-preset="s_curve" title="Smooth S-Curve Contrast">S-Curve</button>
                    <button type="button" class="effects-curve-preset-pill" data-preset="hard_contrast" title="Hard Contrast S-Curve">Hard S</button>
                    <button type="button" class="effects-curve-preset-pill" data-preset="lift_blacks" title="Lifted Blacks Film Tone">Film</button>
                    <button type="button" class="effects-curve-preset-pill" data-preset="linear" title="Reset to Flat Linear">Linear</button>
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
                  <div class="effects-curve-footer-actions">
                    <span class="effects-curve-tip">Double-click point to delete</span>
                    <button type="button" class="effects-curve-reset-btn" data-effect-id="${fx.id}" title="Reset Curve to Linear">Reset</button>
                  </div>
                </div>
              </div>
            </div>
          `);
          continue;
        }

        // Hidden params — skip UI rendering entirely (used for sceneData etc.)
        if (type === 'hidden') {
          processedParams.add(p.id);
          continue;
        }

        // Button params — render a clickable action button
        if (type === 'button') {
          processedParams.add(p.id);
          const btnLabel = p.buttonLabel || p.label || p.id;
          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-button" data-param="${p.id}">
              <div class="effects-param-val-col" style="width:100%">
                <button type="button" class="effects-action-btn fx-action-btn-${p.id}" data-param="${p.id}" data-effect-id="${fx.id}" title="${btnLabel}">${btnLabel}</button>
              </div>
            </div>
          `);
          continue;
        }

        // Coordinate pair detection (e.g. offset_x/offset_y, posX/posY, point_x/point_y, anchorX/anchorY)
        let pairY = null;
        if (p.id.endsWith('_x')) {
          const yId = p.id.slice(0, -2) + '_y';
          pairY = paramsList.find(o => o.id === yId);
        } else if (p.id.endsWith('-x')) {
          const yId = p.id.slice(0, -2) + '-y';
          pairY = paramsList.find(o => o.id === yId);
        } else if (p.id.endsWith('X') && p.id.length > 1) {
          const yId = p.id.slice(0, -1) + 'Y';
          pairY = paramsList.find(o => o.id === yId);
        }

        if (pairY && (p.type || 'number') === (pairY.type || 'number')) {
          processedParams.add(p.id);
          processedParams.add(pairY.id);

          const propKeyX = `${fx.id}:${p.id}`;
          const propKeyY = `${fx.id}:${pairY.id}`;

          const isParamActive = (selectedProp === propKeyX) || (selectedProp === propKeyY) ||
            (!selectedProp && fx === layer.effects[0] && p.id === paramsList[0].id) ||
            (selectedProp === p.id && (!layer.effects || fx === layer.effects[0]));

          const pairLabel = (p.label || p.id).replace(/\s*([_ -]?[Xx])\b.*$/, '').trim() || (p.label || p.id);

          // Values for X
          const minX = fx.min !== undefined ? fx.min : (p.min !== undefined ? p.min : -100);
          const maxX = fx.max !== undefined ? fx.max : (p.max !== undefined ? p.max : 100);
          const stepX = fx.step !== undefined ? fx.step : (p.step !== undefined ? p.step : 1);
          const unitX = fx.unit !== undefined ? fx.unit : (p.unit !== undefined ? p.unit : '');
          const isDecimalX = (stepX < 1) || unitX === 'x' || unitX.includes('.');
          const rawValX = (effFx && effFx[p.id] !== undefined) ? effFx[p.id] : (fx[p.id] !== undefined ? fx[p.id] : (p.default || 0));
          const numValX = isDecimalX
            ? Math.max(minX, Math.min(maxX, Number(parseFloat(rawValX).toFixed(2))))
            : Math.max(minX, Math.min(maxX, Math.round(rawValX)));
          const formattedValX = isDecimalX ? numValX.toFixed(2) : numValX;
          const badgeTextX = (numValX >= 0 && minX < 0 ? '+' : '') + formattedValX + unitX;
          const trackWidthX = (maxX > minX) ? Math.max(0, Math.min(100, ((numValX - minX) / (maxX - minX)) * 100)).toFixed(1) : 0;

          // Values for Y
          const minY = fx.min !== undefined ? fx.min : (pairY.min !== undefined ? pairY.min : -100);
          const maxY = fx.max !== undefined ? fx.max : (pairY.max !== undefined ? pairY.max : 100);
          const stepY = fx.step !== undefined ? fx.step : (pairY.step !== undefined ? pairY.step : 1);
          const unitY = fx.unit !== undefined ? fx.unit : (pairY.unit !== undefined ? pairY.unit : '');
          const isDecimalY = (stepY < 1) || unitY === 'x' || unitY.includes('.');
          const rawValY = (effFx && effFx[pairY.id] !== undefined) ? effFx[pairY.id] : (fx[pairY.id] !== undefined ? fx[pairY.id] : (pairY.default || 0));
          const numValY = isDecimalY
            ? Math.max(minY, Math.min(maxY, Number(parseFloat(rawValY).toFixed(2))))
            : Math.max(minY, Math.min(maxY, Math.round(rawValY)));
          const formattedValY = isDecimalY ? numValY.toFixed(2) : numValY;
          const badgeTextY = (numValY >= 0 && minY < 0 ? '+' : '') + formattedValY + unitY;
          const trackWidthY = (maxY > minY) ? Math.max(0, Math.min(100, ((numValY - minY) / (maxY - minY)) * 100)).toFixed(1) : 0;

          controlsHTMLArr.push(`
            <div class="effects-control-row effects-control-row-pair" data-param="${p.id},${pairY.id}">
              <div class="effects-param-label-col">
                <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" title="Select ${pairLabel} for keyframing">
                  ${pairLabel}
                </button>
              </div>
              <div class="effects-param-val-col">
                <div class="effects-param-pair">
                  <div class="effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${p.id}" data-param="${p.id}" data-unit="${unitX}" data-min="${minX}" data-max="${maxX}" ${p.step ? `data-step="${p.step}"` : ''} role="slider" aria-valuemin="${minX}" aria-valuemax="${maxX}" aria-valuenow="${numValX}" aria-label="${p.label || p.id} Scrubber">
                    <div class="effects-pill-track fx-track-${p.id}" style="width: ${trackWidthX}%;"></div>
                    <div class="jog-wheel-ticks" style="display:none;"></div>
                    <div class="jog-wheel-needle" style="display:none;"></div>
                    <span class="effects-axis-badge">X</span>
                    <span class="effects-param-pill-val fx-badge-${p.id}" data-param="${p.id}" title="Click to edit ${p.label || p.id} value">${badgeTextX}</span>
                  </div>
                  <div class="effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${pairY.id}" data-param="${pairY.id}" data-unit="${unitY}" data-min="${minY}" data-max="${maxY}" ${pairY.step ? `data-step="${pairY.step}"` : ''} role="slider" aria-valuemin="${minY}" aria-valuemax="${maxY}" aria-valuenow="${numValY}" aria-label="${pairY.label || pairY.id} Scrubber">
                    <div class="effects-pill-track fx-track-${pairY.id}" style="width: ${trackWidthY}%;"></div>
                    <div class="jog-wheel-ticks" style="display:none;"></div>
                    <div class="jog-wheel-needle" style="display:none;"></div>
                    <span class="effects-axis-badge">Y</span>
                    <span class="effects-param-pill-val fx-badge-${pairY.id}" data-param="${pairY.id}" title="Click to edit ${pairY.label || pairY.id} value">${badgeTextY}</span>
                  </div>
                </div>
              </div>
            </div>
          `);
          continue;
        }

        // Single number or angle parameter
        processedParams.add(p.id);
        const propKey = `${fx.id}:${p.id}`;
        const isParamActive = (selectedProp === propKey) ||
          (!selectedProp && fx === layer.effects[0] && p.id === paramsList[0].id) ||
          (selectedProp === p.id && (!layer.effects || fx === layer.effects[0]));

        if (type === 'angle') {
          const rawVal = (effFx && effFx[p.id] !== undefined) ? effFx[p.id] : (fx[p.id] !== undefined ? fx[p.id] : (p.default || 0));
          const angleVal = Math.round(rawVal);
          const unit = p.unit || '°';
          const turns = Math.trunc(angleVal / 360);
          const rem = Math.round(angleVal % 360);
          const badgeText = (turns !== 0)
            ? `${turns}x ${rem >= 0 ? '+' : ''}${rem}°`
            : `${rem >= 0 ? '+' : ''}${rem}°`;
          const normAngle = ((angleVal % 360) + 360) % 360;
          const trackWidth = ((normAngle / 360) * 100).toFixed(1);

          controlsHTMLArr.push(`
            <div class="effects-control-row" data-param="${p.id}">
              <div class="effects-param-label-col">
                <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" title="Select ${p.label || p.id} for keyframing">
                  ${p.label || p.id}
                </button>
              </div>
              <div class="effects-param-val-col">
                <div class="effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${p.id}" data-param="${p.id}" data-unit="${unit}" data-type="angle" data-is-angle="true" data-unlimited="true" role="slider" aria-valuenow="${angleVal}" aria-label="${p.label || p.id} Angle Scrubber">
                  <div class="effects-pill-track fx-track-${p.id}" style="width: ${trackWidth}%;"></div>
                  <div class="jog-wheel-ticks" style="display:none;"></div>
                  <div class="jog-wheel-needle" style="display:none;"></div>
                  <span class="effects-param-pill-val fx-badge-${p.id}" data-param="${p.id}" title="Click to edit ${p.label || p.id} value">${badgeText}</span>
                </div>
              </div>
            </div>
          `);
          continue;
        }

        // Standard number
        const min = fx.min !== undefined ? fx.min : (p.min !== undefined ? p.min : -100);
        const max = fx.max !== undefined ? fx.max : (p.max !== undefined ? p.max : 100);
        const step = fx.step !== undefined ? fx.step : (p.step !== undefined ? p.step : 1);
        const unit = fx.unit !== undefined ? fx.unit : (p.unit || '%');
        const isDecimal = (step < 1) || unit === 'x' || unit.includes('.');
        const rawVal = (effFx && effFx[p.id] !== undefined) ? effFx[p.id] : (fx[p.id] !== undefined ? fx[p.id] : (p.default || 0));
        const numVal = isDecimal
          ? Math.max(min, Math.min(max, Number(parseFloat(rawVal).toFixed(2))))
          : Math.max(min, Math.min(max, Math.round(rawVal)));
        const formattedVal = isDecimal ? numVal.toFixed(2) : numVal;
        const badgeText = (numVal >= 0 && min < 0 ? '+' : '') + formattedVal + unit;
        const trackWidth = (max > min) ? Math.max(0, Math.min(100, ((numVal - min) / (max - min)) * 100)).toFixed(1) : 0;

        controlsHTMLArr.push(`
          <div class="effects-control-row" data-param="${p.id}">
            <div class="effects-param-label-col">
              <button type="button" class="effects-param-label effects-param-select-btn fx-param-btn-${p.id} ${isParamActive ? 'is-active' : ''}" data-param="${p.id}" title="Select ${p.label || p.id} for keyframing">
                ${p.label || p.id}
              </button>
            </div>
            <div class="effects-param-val-col">
              <div class="effects-param-pill jog-wheel-container is-horizontal effects-ruler-scrubber fx-scrubber-${p.id}" data-param="${p.id}" data-unit="${unit}" data-min="${min}" data-max="${max}" ${p.step ? `data-step="${p.step}"` : ''} role="slider" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${numVal}" aria-label="${p.label || p.id} Scrubber">
                <div class="effects-pill-track fx-track-${p.id}" style="width: ${trackWidth}%;"></div>
                <div class="jog-wheel-ticks" style="display:none;"></div>
                <div class="jog-wheel-needle" style="display:none;"></div>
                <span class="effects-param-pill-val fx-badge-${p.id}" data-param="${p.id}" title="Click to edit ${p.label || p.id} value">${badgeText}</span>
              </div>
            </div>
          </div>
        `);
      }
      const controlsHTML = controlsHTMLArr.join('');

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

            <!-- Header Right Actions: Eye toggle, Kebab menu, Delete, and Drag handle (always visible) -->
            <div class="effects-card-actions">
              <button type="button" class="effects-card-eye-btn ${isDisabled ? '' : 'is-active'}" title="Enable/Disable Effect" aria-label="Toggle Effect">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
              </button>
              <button type="button" class="effects-card-kebab-btn" title="Effect Options" aria-label="Effect Options">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
              </button>
              <button type="button" class="effects-card-delete-btn" title="Remove Effect" aria-label="Delete">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
              <span class="effects-card-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
              </span>
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
        linear: [[0, 0], [1, 1]],
        s_curve: [[0, 0], [0.25, 0.18], [0.75, 0.82], [1, 1]],
        hard_contrast: [[0, 0], [0.25, 0.10], [0.5, 0.5], [0.75, 0.90], [1, 1]],
        lift_blacks: [[0, 0.14], [0.25, 0.28], [0.75, 0.82], [1, 0.96]],
        invert: [[0, 1], [1, 0]]
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

        const contrast = (fx && fx.contrast !== undefined) ? Number(fx.contrast) : 0;
        const c = Math.max(-1, Math.min(1, contrast / 100.0));

        let pathD = '';
        const steps = 30;
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          let vy = Math.max(0, Math.min(1, spline(u)));
          if (c !== 0) {
            vy = vy - c * 0.22 * Math.sin(Math.PI * 2 * vy);
            vy = Math.max(0, Math.min(1, vy));
          }
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
          circle.setAttribute('r', '5.5');
          circle.setAttribute('fill', strokeColor);
          svg.appendChild(circle);
        });

        // Highlight matching preset button
        widget.querySelectorAll('.effects-curve-preset-pill').forEach(pill => {
          const pName = pill.dataset.preset;
          const targetPts = presets[pName];
          if (targetPts && targetPts.length === pts.length) {
            const matches = targetPts.every((tp, i) => Math.abs(tp[0] - pts[i][0]) < 0.02 && Math.abs(tp[1] - pts[i][1]) < 0.02);
            pill.classList.toggle('is-active', matches);
          } else {
            pill.classList.remove('is-active');
          }
        });
      }

      widget._updateCurveSVG = updateSVG;

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

      // Preset Pills
      widget.querySelectorAll('.effects-curve-preset-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          const pName = pill.dataset.preset;
          if (presets[pName]) {
            setCurrentPoints(JSON.parse(JSON.stringify(presets[pName])));
            updateSVG();
            if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
            if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-preset');
            if (typeof window.saveCurrentProjectLayers === 'function') window.saveCurrentProjectLayers();
          }
        });
      });

      // Reset Button
      const resetBtn = widget.querySelector('.effects-curve-reset-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          setCurrentPoints(JSON.parse(JSON.stringify(presets.linear)));
          if (fx.contrast !== undefined) {
            fx.contrast = 0;
            const track = card.querySelector('.fx-track-contrast');
            const badge = card.querySelector('.fx-badge-contrast');
            if (track) track.style.width = '50%';
            if (badge) badge.textContent = '0%';
          }
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
          if (minDist < 0.16) {
            activePointIdx = closestIdx;
          } else if (pts.length < 5 && nx > 0.04 && nx < 0.96) {
            // Click empty area to add a new point (max 5 points)
            pts.push([Number(nx.toFixed(3)), Number(ny.toFixed(3))]);
            pts.sort((a, b) => a[0] - b[0]);
            setCurrentPoints(pts);
            activePointIdx = pts.findIndex(p => Math.abs(p[0] - nx) < 0.005 && Math.abs(p[1] - ny) < 0.005);
            updateSVG();
            if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
            if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-add-point');
          } else {
            activePointIdx = closestIdx;
          }
        }

        if (activePointIdx !== null) {
          e.stopPropagation();
          e.preventDefault();
          window.isTransformInteracting = true;
          try { svg.setPointerCapture(e.pointerId); } catch (_) {}
          const cachedRect = svg.getBoundingClientRect();

          function onPointerMove(ev) {
            const r = cachedRect || svg.getBoundingClientRect();
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
              const prevX = (curPts[activePointIdx - 1] ? curPts[activePointIdx - 1][0] : 0) + 0.02;
              const nextX = (curPts[activePointIdx + 1] ? curPts[activePointIdx + 1][0] : 1) - 0.02;
              x = Math.max(prevX, Math.min(nextX, x));
            }

            curPts[activePointIdx] = [Number(x.toFixed(3)), Number(y.toFixed(3))];
            setCurrentPoints(curPts);
            updateSVG();

            if (coordEl) {
              coordEl.textContent = `In: ${Math.round(x * 255)} | Out: ${Math.round(y * 255)}`;
            }

            const isPlaying = typeof window.isAnyPlaybackActive === 'function' ? window.isAnyPlaybackActive() : !!window.isTimelinePlaying;
            if (!isPlaying) {
              if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
              if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-drag');
            }
          }

          function onPointerUp(ev) {
            try { svg.releasePointerCapture(ev.pointerId); } catch (_) {}
            window.isTransformInteracting = false;
            svg.removeEventListener('pointermove', onPointerMove);
            svg.removeEventListener('pointerup', onPointerUp);
            svg.removeEventListener('pointercancel', onPointerUp);
            activePointIdx = null;
            if (typeof window.invalidatePreviewCacheForLayer === 'function') window.invalidatePreviewCacheForLayer(layer);
            if (typeof window.redrawComposition === 'function') window.redrawComposition('curve-drag-end');
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
