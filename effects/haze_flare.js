(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgb(hex) {
    let c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return {
      r: ((num >> 16) & 255) / 255,
      g: ((num >> 8) & 255) / 255,
      b: (num & 255) / 255
    };
  }

  // --- WebGL 2.0 / 1.0 GPU Acceleration Engine ---
  let _glCanvas = null;
  let _gl = null;
  let _extractProg = null;
  let _blurProg = null;
  let _compProg = null;
  let _extractUniforms = null;
  let _blurUniforms = null;
  let _compUniforms = null;
  let _posBuf = null;
  let _uvBuf = null;
  let _srcTex = null;
  let _highTex = null;
  let _pingTex = null;
  let _pongTex = null;
  let _haloTex = null;
  let _highFBO = null;
  let _pingFBO = null;
  let _pongFBO = null;
  let _haloFBO = null;
  let _fboW = 0;
  let _fboH = 0;
  let _glFailed = false;

  function initHazeGL() {
    if (_gl && _extractProg && _blurProg && _compProg) return true;
    if (_glFailed || typeof document === 'undefined') return false;

    try {
      if (!_glCanvas) _glCanvas = document.createElement('canvas');
      const opts = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true };
      const gl = _glCanvas.getContext('webgl2', opts) ||
                 _glCanvas.getContext('webgl', opts) ||
                 _glCanvas.getContext('experimental-webgl', opts);
      if (!gl) { _glFailed = true; return false; }
      _gl = gl;

      const vs = [
        'attribute vec2 a_pos;',
        'attribute vec2 a_uv;',
        'varying vec2 v_uv;',
        'void main(void) {',
        '  v_uv = a_uv;',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n');

      // 1. Soft-shoulder Rec.709 highlight extraction
      const extractFs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_image;',
        'uniform float u_threshold;',
        'void main(void) {',
        '  vec4 col = texture2D(u_image, v_uv);',
        '  if (col.a <= 0.001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  vec3 rgb = col.rgb / max(0.001, col.a);',
        '  float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));',
        '  float knee = 0.16;',
        '  float t = u_threshold;',
        '  float weight = smoothstep(t - knee, t + knee, lum);',
        '  if (weight <= 0.0001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  gl_FragColor = vec4(rgb * weight * col.a, col.a * weight);',
        '}'
      ].join('\n');

      // 2. 9-tap separable Gaussian blur
      const blurFs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_texture;',
        'uniform vec2 u_delta;',
        'void main(void) {',
        '  vec4 col = texture2D(u_texture, v_uv) * 0.227027;',
        '  vec2 d1 = u_delta * 1.384615;',
        '  vec2 d2 = u_delta * 3.230769;',
        '  col += texture2D(u_texture, v_uv + d1) * 0.316216;',
        '  col += texture2D(u_texture, v_uv - d1) * 0.316216;',
        '  col += texture2D(u_texture, v_uv + d2) * 0.070270;',
        '  col += texture2D(u_texture, v_uv - d2) * 0.070270;',
        '  gl_FragColor = col;',
        '}'
      ].join('\n');

      // 3. Halation & Atmospheric Haze Composite
      const compFs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_bloom;',
        'uniform sampler2D u_halation;',
        'uniform vec3 u_tint;',
        'uniform vec3 u_warmthCol;',
        'uniform float u_halationAmt;',
        'uniform float u_amount;',
        'void main(void) {',
        '  vec4 bloom = texture2D(u_bloom, v_uv);',
        '  vec4 halo = texture2D(u_halation, v_uv);',
        '  // 35mm film halation is characteristic warm red-orange scatter at highlight borders',
        '  vec3 halationRgb = vec3(1.0, 0.24, 0.05) * halo.a * (u_halationAmt * 1.6);',
        '  // Atmospheric haze tinted and temperature-shifted',
        '  vec3 hazeRgb = bloom.rgb * u_tint * u_warmthCol;',
        '  vec3 combined = hazeRgb + halationRgb;',
        '  float alpha = clamp(bloom.a * 1.2 + halo.a * u_halationAmt, 0.0, 1.0) * u_amount;',
        '  gl_FragColor = vec4(combined * alpha, alpha);',
        '}'
      ].join('\n');

      function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
      }

      const vsShader = compile(gl.VERTEX_SHADER, vs);
      const extShader = compile(gl.FRAGMENT_SHADER, extractFs);
      const blrShader = compile(gl.FRAGMENT_SHADER, blurFs);
      const cmpShader = compile(gl.FRAGMENT_SHADER, compFs);
      if (!vsShader || !extShader || !blrShader || !cmpShader) {
        _glFailed = true;
        return false;
      }

      function link(fs) {
        const p = gl.createProgram();
        gl.attachShader(p, vsShader);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
      }

      _extractProg = link(extShader);
      _blurProg = link(blrShader);
      _compProg = link(cmpShader);
      if (!_extractProg || !_blurProg || !_compProg) {
        _glFailed = true;
        return false;
      }

      _extractUniforms = {
        image: gl.getUniformLocation(_extractProg, 'u_image'),
        threshold: gl.getUniformLocation(_extractProg, 'u_threshold')
      };

      _blurUniforms = {
        texture: gl.getUniformLocation(_blurProg, 'u_texture'),
        delta: gl.getUniformLocation(_blurProg, 'u_delta')
      };

      _compUniforms = {
        bloom: gl.getUniformLocation(_compProg, 'u_bloom'),
        halation: gl.getUniformLocation(_compProg, 'u_halation'),
        tint: gl.getUniformLocation(_compProg, 'u_tint'),
        warmthCol: gl.getUniformLocation(_compProg, 'u_warmthCol'),
        halationAmt: gl.getUniformLocation(_compProg, 'u_halationAmt'),
        amount: gl.getUniformLocation(_compProg, 'u_amount')
      };

      _posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

      _uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

      function createTex() {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return t;
      }

      _srcTex = createTex();
      _highTex = createTex();
      _pingTex = createTex();
      _pongTex = createTex();
      _haloTex = createTex();

      _highFBO = gl.createFramebuffer();
      _pingFBO = gl.createFramebuffer();
      _pongFBO = gl.createFramebuffer();
      _haloFBO = gl.createFramebuffer();

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      return true;
    } catch (_) {
      _glFailed = true;
      return false;
    }
  }

  function resizeFBOs(gl, w, h) {
    if (_fboW === w && _fboH === h) return;
    _fboW = w;
    _fboH = h;

    function setupFBO(fbo, tex) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }

    setupFBO(_highFBO, _highTex);
    setupFBO(_pingFBO, _pingTex);
    setupFBO(_pongFBO, _pongTex);
    setupFBO(_haloFBO, _haloTex);
  }

  // --- Universal 2D Buffers for Fallback ---
  let _threshBuf = null, _threshCtx = null;
  let _bloomBuf = null, _bloomCtx = null;
  let _haloBuf = null, _haloCtx = null;

  function getFallbackBuf(name, w, h) {
    if (typeof document === 'undefined') return null;
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    let c, x;
    if (name === 'thresh') {
      if (!_threshBuf) { _threshBuf = document.createElement('canvas'); _threshCtx = _threshBuf.getContext('2d', { willReadFrequently: true }); }
      c = _threshBuf; x = _threshCtx;
    } else if (name === 'bloom') {
      if (!_bloomBuf) { _bloomBuf = document.createElement('canvas'); _bloomCtx = _bloomBuf.getContext('2d'); }
      c = _bloomBuf; x = _bloomCtx;
    } else {
      if (!_haloBuf) { _haloBuf = document.createElement('canvas'); _haloCtx = _haloBuf.getContext('2d'); }
      c = _haloBuf; x = _haloCtx;
    }
    if (c.width !== rw || c.height !== rh) { c.width = rw; c.height = rh; }
    return { c, x };
  }

  reg.register({
    id: 'haze-flare',
    name: 'Haze / Flare',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Cinematic atmospheric diffusion haze with authentic 35mm film halation rim bleed and highlight roll-off without milky shadow fogging',
    params: [
      { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'highlight', label: 'Highlight Threshold', type: 'number', min: 0, max: 100, default: 65, unit: '%' },
      { id: 'bloom', label: 'Bloom Size', type: 'number', min: 5, max: 150, default: 45, unit: 'px' },
      { id: 'halation', label: 'Film Halation', type: 'number', min: 0, max: 100, default: 40, unit: '%' },
      { id: 'warmth', label: 'Warmth', type: 'number', min: -50, max: 50, default: 15 },
      { id: 'color', label: 'Tint', type: 'color', default: '#ffeedd' },
      { id: 'blendMode', label: 'Blend Mode', type: 'select', options: ['screen', 'lighter'], default: 'screen' },
      { id: 'hazeOnly', label: 'Haze Only', type: 'switch', default: false }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      const hazeOnly = !!(fx && fx.hazeOnly);
      if (!hazeOnly) {
        try { ctx.drawImage(el, bx, by, w, h); } catch (_) {}
      }

      const amount = Math.max(0, Math.min(100, fx && fx.amount !== undefined ? Number(fx.amount) : 50)) / 100;
      if (amount <= 0.005) return;

      const threshold = Math.max(0, Math.min(100, fx && fx.highlight !== undefined ? Number(fx.highlight) : (fx && fx.threshold !== undefined ? Number(fx.threshold) : 65))) / 100;
      const bloomSize = Math.max(5, Math.min(150, fx && fx.bloom !== undefined ? Number(fx.bloom) : 45));
      const halation = Math.max(0, Math.min(100, fx && fx.halation !== undefined ? Number(fx.halation) : 40)) / 100;
      const warmth = Math.max(-50, Math.min(50, fx && fx.warmth !== undefined ? Number(fx.warmth) : 15));
      const tintHex = (fx && fx.color) || (fx && fx.tint) || '#ffeedd';
      const blendMode = (fx && fx.blendMode) || 'screen';

      const tintRgb = hexToRgb(tintHex);
      const wNorm = warmth / 50;
      const warmthCol = {
        r: 1.0 + Math.max(0, wNorm) * 0.25 - Math.max(0, -wNorm) * 0.15,
        g: 1.0 + wNorm * 0.05,
        b: 1.0 - Math.max(0, wNorm) * 0.25 + Math.max(0, -wNorm) * 0.25
      };

      // --- 1. GPU WEBGL PIPELINE ---
      if (!_glFailed && initHazeGL()) {
        try {
          const gl = _gl;

          // Adaptive downscale for smooth wide bloom
          const downscale = bloomSize <= 20 ? 1 : (bloomSize <= 60 ? 2 : 4);
          const bw = Math.max(2, Math.round(w / downscale));
          const bh = Math.max(2, Math.round(h / downscale));

          if (_glCanvas.width !== bw || _glCanvas.height !== bh) {
            _glCanvas.width = bw;
            _glCanvas.height = bh;
          }

          resizeFBOs(gl, bw, bh);

          // Upload source layer to texture
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, _srcTex);
          let uploaded = false;
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
            uploaded = true;
          } catch (_) {
            const fb = getFallbackBuf('thresh', bw, bh);
            if (fb) {
              fb.x.clearRect(0, 0, bw, bh);
              fb.x.drawImage(el, 0, 0, bw, bh);
              try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fb.c);
                uploaded = true;
              } catch (_) {}
            }
          }

          if (uploaded) {
            gl.viewport(0, 0, bw, bh);

            const bindAttr = (prog) => {
              gl.useProgram(prog);
              const pLoc = gl.getAttribLocation(prog, 'a_pos');
              gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
              gl.enableVertexAttribArray(pLoc);
              gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

              const uLoc = gl.getAttribLocation(prog, 'a_uv');
              gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
              gl.enableVertexAttribArray(uLoc);
              gl.vertexAttribPointer(uLoc, 2, gl.FLOAT, false, 0, 0);
            };

            // Pass 1: Extract Highlights -> _highFBO
            bindAttr(_extractProg);
            gl.bindFramebuffer(gl.FRAMEBUFFER, _highFBO);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _srcTex);
            gl.uniform1i(_extractUniforms.image, 0);
            gl.uniform1f(_extractUniforms.threshold, threshold);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Pass 2: Tight Halation Rim Blur (around highlight boundaries)
            bindAttr(_blurProg);
            gl.uniform1i(_blurUniforms.texture, 0);

            const haloRadius = Math.max(2.0, (bloomSize / downscale) * 0.28);
            // Horizontal
            gl.bindFramebuffer(gl.FRAMEBUFFER, _pingFBO);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _highTex);
            gl.uniform2f(_blurUniforms.delta, haloRadius / bw, 0.0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            // Vertical -> _haloFBO
            gl.bindFramebuffer(gl.FRAMEBUFFER, _haloFBO);
            gl.bindTexture(gl.TEXTURE_2D, _pingTex);
            gl.uniform2f(_blurUniforms.delta, 0.0, haloRadius / bh);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Pass 3: Wide Multi-Octave Atmospheric Diffusion Bloom
            const bloomRadius = Math.max(3.0, (bloomSize / downscale) * 0.85);
            // Horizontal -> _pingFBO
            gl.bindFramebuffer(gl.FRAMEBUFFER, _pingFBO);
            gl.bindTexture(gl.TEXTURE_2D, _highTex);
            gl.uniform2f(_blurUniforms.delta, bloomRadius / bw, 0.0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            // Vertical -> _pongFBO
            gl.bindFramebuffer(gl.FRAMEBUFFER, _pongFBO);
            gl.bindTexture(gl.TEXTURE_2D, _pingTex);
            gl.uniform2f(_blurUniforms.delta, 0.0, bloomRadius / bh);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Pass 4: Final Composite to canvas
            bindAttr(_compProg);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _pongTex);
            gl.uniform1i(_compUniforms.bloom, 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, _haloTex);
            gl.uniform1i(_compUniforms.halation, 1);

            gl.uniform3f(_compUniforms.tint, tintRgb.r, tintRgb.g, tintRgb.b);
            gl.uniform3f(_compUniforms.warmthCol, warmthCol.r, warmthCol.g, warmthCol.b);
            gl.uniform1f(_compUniforms.halationAmt, halation);
            gl.uniform1f(_compUniforms.amount, amount);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Draw WebGL canvas onto target 2D context
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.globalCompositeOperation = blendMode;
            ctx.globalAlpha = 1.0;
            try {
              ctx.drawImage(_glCanvas, bx, by, w, h);
            } catch (_) {}
            ctx.restore();
            return;
          }
        } catch (_) {}
      }

      // --- 2. UNIVERSAL CANVAS 2D FALLBACK ---
      const thresh = getFallbackBuf('thresh', w, h);
      const bloomBuf = getFallbackBuf('bloom', w, h);
      const haloBuf = getFallbackBuf('halo', w, h);
      if (!thresh || !bloomBuf || !haloBuf) return;

      thresh.x.clearRect(0, 0, w, h);
      try {
        thresh.x.drawImage(el, 0, 0, w, h);
        const imgData = thresh.x.getImageData(0, 0, w, h);
        const d = imgData.data;
        const threshVal = threshold * 255;
        const knee = 35;

        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3];
          if (a <= 3) continue;
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

          if (luma < threshVal - knee) {
            d[i + 3] = 0;
          } else {
            const factor = Math.min(1.0, Math.max(0.0, (luma - (threshVal - knee)) / (knee * 2)));
            d[i + 3] = Math.round(a * factor * factor);
          }
        }
        thresh.x.putImageData(imgData, 0, 0);
      } catch (_) {
        return;
      }

      // Multi-Octave Diffusion Passes
      bloomBuf.x.clearRect(0, 0, w, h);
      const octaves = [
        { radius: bloomSize * 0.35, alpha: 0.55 },
        { radius: bloomSize * 0.85, alpha: 0.35 },
        { radius: bloomSize * 1.80, alpha: 0.20 }
      ];

      for (let i = 0; i < octaves.length; i++) {
        const oct = octaves[i];
        haloBuf.x.clearRect(0, 0, w, h);
        if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
          window.FishEffects.drawBlurred(haloBuf.x, thresh.c, w, h, oct.radius);
        } else {
          try {
            haloBuf.x.filter = `blur(${oct.radius.toFixed(1)}px)`;
            haloBuf.x.drawImage(thresh.c, 0, 0);
          } catch (_) {}
        }
        bloomBuf.x.save();
        bloomBuf.x.globalCompositeOperation = i === 0 ? 'source-over' : 'lighter';
        bloomBuf.x.globalAlpha = oct.alpha;
        bloomBuf.x.drawImage(haloBuf.c, 0, 0);
        bloomBuf.x.restore();
      }

      // Tint the diffusion bloom
      bloomBuf.x.save();
      bloomBuf.x.globalCompositeOperation = 'source-in';
      bloomBuf.x.fillStyle = tintHex;
      bloomBuf.x.fillRect(0, 0, w, h);
      bloomBuf.x.restore();

      // Film Halation Rim Bleed (tight red-orange scatter)
      if (halation > 0.05) {
        haloBuf.x.clearRect(0, 0, w, h);
        const rimRad = Math.max(3, bloomSize * 0.25);
        if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
          window.FishEffects.drawBlurred(haloBuf.x, thresh.c, w, h, rimRad);
        } else {
          try {
            haloBuf.x.filter = `blur(${rimRad.toFixed(1)}px)`;
            haloBuf.x.drawImage(thresh.c, 0, 0);
          } catch (_) {}
        }
        haloBuf.x.save();
        haloBuf.x.globalCompositeOperation = 'source-in';
        haloBuf.x.fillStyle = '#ff3c0e'; // 35mm film halation red-orange
        haloBuf.x.fillRect(0, 0, w, h);
        haloBuf.x.restore();

        // Blend halation onto bloom buffer
        bloomBuf.x.save();
        bloomBuf.x.globalCompositeOperation = 'lighter';
        bloomBuf.x.globalAlpha = halation * 1.4;
        bloomBuf.x.drawImage(haloBuf.c, 0, 0);
        bloomBuf.x.restore();
      }

      // Composite onto target canvas
      ctx.save();
      ctx.globalCompositeOperation = blendMode;
      ctx.globalAlpha = Math.min(1.0, amount * 1.3);
      try { ctx.drawImage(bloomBuf.c, bx, by, w, h); } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
