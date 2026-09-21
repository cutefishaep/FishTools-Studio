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
  let _streakProg = null;
  let _compProg = null;
  let _extractUniforms = null;
  let _streakUniforms = null;
  let _compUniforms = null;
  let _posBuf = null;
  let _uvBuf = null;
  let _srcTex = null;
  let _coreTex = null;
  let _pingTex = null;
  let _pongTex = null;
  let _coreFBO = null;
  let _pingFBO = null;
  let _pongFBO = null;
  let _fboW = 0;
  let _fboH = 0;
  let _glFailed = false;

  function initAnaGL() {
    if (_gl && _extractProg && _streakProg && _compProg) return true;
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

      // 1. Strict Rec.709 specular highlight extraction with smooth shoulder
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
        '  float knee = 0.12;',
        '  float t = u_threshold;',
        '  float weight = smoothstep(t - knee, t + knee, lum);',
        '  if (weight <= 0.0001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  // Specular core punch: hottest highlights pull to pure white',
        '  float spec = smoothstep(0.85, 1.0, lum) * 1.5;',
        '  vec3 highlight = mix(rgb, vec3(1.0), spec) * weight;',
        '  gl_FragColor = vec4(highlight * col.a, col.a * weight);',
        '}'
      ].join('\n');

      // 2. Anamorphic 1D directional horizontal streak blur with exponential decay
      const streakFs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_texture;',
        'uniform vec2 u_delta;',
        'uniform float u_decay;',
        'void main(void) {',
        '  vec4 col = texture2D(u_texture, v_uv) * 0.227027;',
        '  vec2 d1 = u_delta * 1.384615;',
        '  vec2 d2 = u_delta * 3.230769;',
        '  col += texture2D(u_texture, v_uv + d1) * (0.316216 * u_decay);',
        '  col += texture2D(u_texture, v_uv - d1) * (0.316216 * u_decay);',
        '  col += texture2D(u_texture, v_uv + d2) * (0.070270 * u_decay * u_decay);',
        '  col += texture2D(u_texture, v_uv - d2) * (0.070270 * u_decay * u_decay);',
        '  gl_FragColor = col;',
        '}'
      ].join('\n');

      // 3. Flare composite shader: chromatic fringe + tinted wings + white-hot specular core
      const compFs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_streak;',
        'uniform sampler2D u_core;',
        'uniform vec3 u_tint;',
        'uniform float u_chromatic;',
        'uniform float u_coreGlow;',
        'uniform float u_intensity;',
        'uniform vec2 u_texel;',
        'void main(void) {',
        '  vec2 shift = vec2(u_chromatic * 10.0 * u_texel.x, 0.0);',
        '  float r = texture2D(u_streak, v_uv - shift).r;',
        '  float g = texture2D(u_streak, v_uv).g;',
        '  float b = texture2D(u_streak, v_uv + shift).b;',
        '  float a = (r + g + b) / 3.0;',
        '  vec3 streakRgb = mix(vec3(a), vec3(r, g, b), min(1.0, u_chromatic * 1.8));',
        '  // White-hot core preservation: wings get tint, intense center stays white',
        '  float hot = clamp((r + g + b) / 3.0 - 0.55, 0.0, 0.45) / 0.45;',
        '  vec3 tintedStreak = mix(streakRgb * u_tint, vec3(1.0), hot * 0.85);',
        '  // Specular core hotspot',
        '  vec4 coreCol = texture2D(u_core, v_uv);',
        '  vec3 finalRgb = tintedStreak + coreCol.rgb * (u_coreGlow * 1.5);',
        '  float finalA = clamp(a * 1.35 + coreCol.a * u_coreGlow, 0.0, 1.0) * u_intensity;',
        '  gl_FragColor = vec4(finalRgb * finalA, finalA);',
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
      const strShader = compile(gl.FRAGMENT_SHADER, streakFs);
      const cmpShader = compile(gl.FRAGMENT_SHADER, compFs);
      if (!vsShader || !extShader || !strShader || !cmpShader) {
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
      _streakProg = link(strShader);
      _compProg = link(cmpShader);
      if (!_extractProg || !_streakProg || !_compProg) {
        _glFailed = true;
        return false;
      }

      _extractUniforms = {
        image: gl.getUniformLocation(_extractProg, 'u_image'),
        threshold: gl.getUniformLocation(_extractProg, 'u_threshold')
      };

      _streakUniforms = {
        texture: gl.getUniformLocation(_streakProg, 'u_texture'),
        delta: gl.getUniformLocation(_streakProg, 'u_delta'),
        decay: gl.getUniformLocation(_streakProg, 'u_decay')
      };

      _compUniforms = {
        streak: gl.getUniformLocation(_compProg, 'u_streak'),
        core: gl.getUniformLocation(_compProg, 'u_core'),
        tint: gl.getUniformLocation(_compProg, 'u_tint'),
        chromatic: gl.getUniformLocation(_compProg, 'u_chromatic'),
        coreGlow: gl.getUniformLocation(_compProg, 'u_coreGlow'),
        intensity: gl.getUniformLocation(_compProg, 'u_intensity'),
        texel: gl.getUniformLocation(_compProg, 'u_texel')
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
      _coreTex = createTex();
      _pingTex = createTex();
      _pongTex = createTex();

      _coreFBO = gl.createFramebuffer();
      _pingFBO = gl.createFramebuffer();
      _pongFBO = gl.createFramebuffer();

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

    setupFBO(_coreFBO, _coreTex);
    setupFBO(_pingFBO, _pingTex);
    setupFBO(_pongFBO, _pongTex);
  }

  // --- Universal 2D Buffers for Fallback ---
  let _threshBuf = null, _threshCtx = null;
  let _streakBufA = null, _streakCtxA = null;
  let _streakBufB = null, _streakCtxB = null;

  function getFallbackBuf(name, w, h) {
    if (typeof document === 'undefined') return null;
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    let c, x;
    if (name === 'thresh') {
      if (!_threshBuf) { _threshBuf = document.createElement('canvas'); _threshCtx = _threshBuf.getContext('2d', { willReadFrequently: true }); }
      c = _threshBuf; x = _threshCtx;
    } else if (name === 'a') {
      if (!_streakBufA) { _streakBufA = document.createElement('canvas'); _streakCtxA = _streakBufA.getContext('2d'); }
      c = _streakBufA; x = _streakCtxA;
    } else {
      if (!_streakBufB) { _streakBufB = document.createElement('canvas'); _streakCtxB = _streakBufB.getContext('2d'); }
      c = _streakBufB; x = _streakCtxB;
    }
    if (c.width !== rw || c.height !== rh) { c.width = rw; c.height = rh; }
    return { c, x };
  }

  reg.register({
    id: 'anamorphic-flare',
    name: 'Anamorphic Flare',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Authentic Hollywood Panavision/Cooke style anamorphic streak flare with specular isolation, exponential horizontal falloff, chromatic dispersion, and white-hot core',
    params: [
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, default: 60, unit: '%' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 70, unit: '%' },
      { id: 'length', label: 'Streak Length', type: 'number', min: 10, max: 100, default: 80, unit: '%' },
      { id: 'thickness', label: 'Thickness', type: 'number', min: 1, max: 25, default: 3, unit: 'px' },
      { id: 'coreGlow', label: 'Core Glow', type: 'number', min: 0, max: 100, default: 40, unit: '%' },
      { id: 'tint', label: 'Tint', type: 'color', default: '#3a86ff' },
      { id: 'chromatic', label: 'Chromatic Fringe', type: 'number', min: 0, max: 100, default: 35, unit: '%' },
      { id: 'blendMode', label: 'Blend', type: 'select', options: ['screen', 'lighter', 'soft-light'], default: 'screen' },
      { id: 'flareOnly', label: 'Flare Only', type: 'switch', default: false }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      const flareOnly = !!(fx && fx.flareOnly);
      if (!flareOnly) {
        try { ctx.drawImage(el, bx, by, w, h); } catch (_) {}
      }

      const intensity = Math.max(0, Math.min(100, fx && fx.intensity !== undefined ? Number(fx.intensity) : 60)) / 100;
      if (intensity <= 0.005) return;

      const threshold = Math.max(0, Math.min(100, fx && fx.threshold !== undefined ? Number(fx.threshold) : 70)) / 100;
      const lengthPct = Math.max(10, Math.min(100, fx && fx.length !== undefined ? Number(fx.length) : 80)) / 100;
      const thickness = Math.max(1, Math.min(25, fx && fx.thickness !== undefined ? Number(fx.thickness) : 3));
      const coreGlow = Math.max(0, Math.min(100, fx && fx.coreGlow !== undefined ? Number(fx.coreGlow) : 40)) / 100;
      const tintHex = (fx && fx.tint) || '#3a86ff';
      const chromatic = Math.max(0, Math.min(100, fx && fx.chromatic !== undefined ? Number(fx.chromatic) : 35)) / 100;
      const blendMode = (fx && fx.blendMode) || 'screen';

      // --- 1. GPU WEBGL PIPELINE ---
      if (!_glFailed && initAnaGL()) {
        try {
          const gl = _gl;
          const tintRgb = hexToRgb(tintHex);

          // Horizontal resolution can be adaptive; vertical matches thin streak
          const bw = Math.min(1920, w);
          // Scale vertical down slightly for thin optical streak sampling
          const vScale = Math.max(1, Math.min(4, Math.round(8 / thickness)));
          const bh = Math.max(2, Math.round(h / vScale));

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

            // Bind attributes
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

            // Pass 1: Extract specular highlights -> _coreFBO
            bindAttr(_extractProg);
            gl.bindFramebuffer(gl.FRAMEBUFFER, _coreFBO);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _srcTex);
            gl.uniform1i(_extractUniforms.image, 0);
            gl.uniform1f(_extractUniforms.threshold, threshold);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Pass 2: Progressive Horizontal Streak Blur (Ping-Pong)
            bindAttr(_streakProg);
            gl.uniform1i(_streakUniforms.texture, 0);

            let srcTex = _coreTex;
            let dstFBO = _pingFBO;
            let dstTex = _pingTex;

            // Decay factor: higher length = slower decay = longer beam across screen
            const decay = 0.65 + lengthPct * 0.33; // 0.68 .. 0.98
            const passes = Math.min(8, Math.max(3, Math.round(lengthPct * 8)));
            let stepSpread = 1.0;

            for (let p = 0; p < passes; p++) {
              gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, srcTex);

              const dx = (stepSpread * (1.0 + p * 0.75)) / bw;
              gl.uniform2f(_streakUniforms.delta, dx, 0.0);
              gl.uniform1f(_streakUniforms.decay, decay);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

              // Swap ping-pong
              srcTex = dstTex;
              dstFBO = (dstFBO === _pingFBO) ? _pongFBO : _pingFBO;
              dstTex = (dstTex === _pingTex) ? _pongTex : _pingTex;
              stepSpread *= 2.2;
            }

            // Pass 3: Final Composite to canvas
            bindAttr(_compProg);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            gl.uniform1i(_compUniforms.streak, 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, _coreTex);
            gl.uniform1i(_compUniforms.core, 1);

            gl.uniform3f(_compUniforms.tint, tintRgb.r, tintRgb.g, tintRgb.b);
            gl.uniform1f(_compUniforms.chromatic, chromatic);
            gl.uniform1f(_compUniforms.coreGlow, coreGlow);
            gl.uniform1f(_compUniforms.intensity, intensity);
            gl.uniform2f(_compUniforms.texel, 1.0 / bw, 1.0 / bh);

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
      const streakA = getFallbackBuf('a', w, h);
      const streakB = getFallbackBuf('b', w, h);
      if (!thresh || !streakA || !streakB) return;

      thresh.x.clearRect(0, 0, w, h);
      try {
        thresh.x.drawImage(el, 0, 0, w, h);
        const imgData = thresh.x.getImageData(0, 0, w, h);
        const d = imgData.data;
        const threshVal = threshold * 255;
        const knee = 30;

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
            // Specular core boost to white
            if (luma > 220) {
              const bst = (luma - 220) / 35;
              d[i] = Math.min(255, Math.round(r + bst * (255 - r)));
              d[i + 1] = Math.min(255, Math.round(g + bst * (255 - g)));
              d[i + 2] = Math.min(255, Math.round(b + bst * (255 - b)));
            }
          }
        }
        thresh.x.putImageData(imgData, 0, 0);
      } catch (_) {
        return;
      }

      // Progressive horizontal offset expansion
      streakA.x.clearRect(0, 0, w, h);
      streakA.x.drawImage(thresh.c, 0, 0);

      const decay = 0.65 + lengthPct * 0.32;
      const offsets = [2, 6, 18, 54, 150, 400, 950];
      const maxPass = Math.min(offsets.length, Math.max(3, Math.round(lengthPct * offsets.length)));

      let curSrc = streakA;
      let curDst = streakB;

      for (let p = 0; p < maxPass; p++) {
        const off = offsets[p];
        curDst.x.clearRect(0, 0, w, h);
        curDst.x.save();
        curDst.x.globalAlpha = 1.0;
        curDst.x.drawImage(curSrc.c, 0, 0);
        curDst.x.globalCompositeOperation = 'lighter';
        curDst.x.globalAlpha = decay;
        curDst.x.drawImage(curSrc.c, -off, 0);
        curDst.x.drawImage(curSrc.c, off, 0);
        curDst.x.restore();

        const tmp = curSrc;
        curSrc = curDst;
        curDst = tmp;
      }

      // Vertical thickness blur (thin razor beam)
      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function' && thickness > 1.5) {
        curDst.x.clearRect(0, 0, w, h);
        window.FishEffects.drawBlurred(curDst.x, curSrc.c, w, h, thickness * 0.5);
        curSrc = curDst;
      }

      // Tint the streak
      streakA.x.clearRect(0, 0, w, h);
      streakA.x.save();
      streakA.x.drawImage(curSrc.c, 0, 0);
      streakA.x.globalCompositeOperation = 'source-in';
      streakA.x.fillStyle = tintHex;
      streakA.x.fillRect(0, 0, w, h);
      streakA.x.restore();

      // Add specular core
      if (coreGlow > 0.05) {
        streakA.x.save();
        streakA.x.globalCompositeOperation = 'lighter';
        streakA.x.globalAlpha = coreGlow * 1.3;
        streakA.x.drawImage(thresh.c, 0, 0);
        streakA.x.restore();
      }

      // Composite onto main context
      ctx.save();
      ctx.globalCompositeOperation = blendMode;
      ctx.globalAlpha = Math.min(1.0, intensity * 1.25);
      try { ctx.drawImage(streakA.c, bx, by, w, h); } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
