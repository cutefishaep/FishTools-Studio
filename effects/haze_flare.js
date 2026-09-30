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
  let _hazeTex = null;
  let _reachTex = null;
  let _highFBO = null;
  let _pingFBO = null;
  let _pongFBO = null;
  let _hazeFBO = null;
  let _reachFBO = null;
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

      // 1. Spillage-driven highlight extraction with matte box shading
      const extractFs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_image;',
        'uniform float u_spillage;',
        'uniform float u_matteSize;',
        'uniform float u_matteShade;',
        'void main(void) {',
        '  vec4 col = texture2D(u_image, v_uv);',
        '  if (col.a <= 0.001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  vec3 rgb = col.rgb / max(0.001, col.a);',
        '  float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));',
        '  // Spillage determines threshold and knee:',
        '  // Low spillage = high threshold (~0.88), tight knee (~0.08)',
        '  // High spillage = low threshold (~0.22), wide soft knee (~0.35)',
        '  float thresh = mix(0.88, 0.22, u_spillage);',
        '  float knee = mix(0.08, 0.35, u_spillage);',
        '  float weight = smoothstep(thresh - knee, thresh + knee, lum);',
        '  if (weight <= 0.0001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  // Matte box lens hood boundary shading',
        '  if (u_matteSize > 0.001 && u_matteShade > 0.001) {',
        '    vec2 dist = abs(v_uv - 0.5) * 2.0;',
        '    float edge = max(dist.x, dist.y);',
        '    float boxLimit = 1.0 - u_matteSize * 0.45;',
        '    float shade = 1.0 - smoothstep(boxLimit, 1.0, edge) * u_matteShade;',
        '    weight *= shade;',
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

      // 3. Magic Bullet Looks Haze/Flare Composite (Haze + Horizontal Reach + Inverted Reflection Ghost)
      const compFs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_haze;',
        'uniform sampler2D u_reach;',
        'uniform vec3 u_tint;',
        'uniform float u_reachAmt;',
        'uniform float u_exposure;',
        'uniform float u_reflection;',
        'uniform float u_reflExposure;',
        'void main(void) {',
        '  vec4 haze = texture2D(u_haze, v_uv);',
        '  vec4 reach = texture2D(u_reach, v_uv);',
        '  vec3 primaryRgb = (haze.rgb + reach.rgb * (u_reachAmt * 1.5)) * u_tint;',
        '  float primaryA = clamp(haze.a + reach.a * u_reachAmt, 0.0, 1.0);',
        '  vec3 finalRgb = primaryRgb;',
        '  float finalA = primaryA;',
        '  // Secondary inverted reflection ghost (reflected through optical center 1.0 - v_uv)',
        '  if (u_reflection > 0.001) {',
        '    vec2 reflUv = vec2(1.0 - v_uv.x, 1.0 - v_uv.y);',
        '    vec4 reflHaze = texture2D(u_haze, reflUv);',
        '    vec4 reflReach = texture2D(u_reach, reflUv);',
        '    vec3 reflRgb = (reflHaze.rgb + reflReach.rgb * (u_reachAmt * 1.5)) * u_tint;',
        '    float reflA = clamp(reflHaze.a + reflReach.a * u_reachAmt, 0.0, 1.0);',
        '    float reflGain = u_reflection * u_reflExposure;',
        '    finalRgb += reflRgb * reflGain;',
        '    finalA = clamp(finalA + reflA * reflGain, 0.0, 1.0);',
        '  }',
        '  finalA = clamp(finalA * u_exposure, 0.0, 1.0);',
        '  finalRgb *= u_exposure;',
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
        spillage: gl.getUniformLocation(_extractProg, 'u_spillage'),
        matteSize: gl.getUniformLocation(_extractProg, 'u_matteSize'),
        matteShade: gl.getUniformLocation(_extractProg, 'u_matteShade')
      };

      _blurUniforms = {
        texture: gl.getUniformLocation(_blurProg, 'u_texture'),
        delta: gl.getUniformLocation(_blurProg, 'u_delta')
      };

      _compUniforms = {
        haze: gl.getUniformLocation(_compProg, 'u_haze'),
        reach: gl.getUniformLocation(_compProg, 'u_reach'),
        tint: gl.getUniformLocation(_compProg, 'u_tint'),
        reachAmt: gl.getUniformLocation(_compProg, 'u_reachAmt'),
        exposure: gl.getUniformLocation(_compProg, 'u_exposure'),
        reflection: gl.getUniformLocation(_compProg, 'u_reflection'),
        reflExposure: gl.getUniformLocation(_compProg, 'u_reflExposure')
      };

      _posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

      _uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW);

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
      _hazeTex = createTex();
      _reachTex = createTex();

      _highFBO = gl.createFramebuffer();
      _pingFBO = gl.createFramebuffer();
      _pongFBO = gl.createFramebuffer();
      _hazeFBO = gl.createFramebuffer();
      _reachFBO = gl.createFramebuffer();

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
    setupFBO(_hazeFBO, _hazeTex);
    setupFBO(_reachFBO, _reachTex);
  }

  // --- Universal 2D Buffers for Fallback ---
  let _threshBuf = null, _threshCtx = null;
  let _hazeBuf = null, _hazeCtx = null;
  let _reachBuf = null, _reachCtx = null;

  function getFallbackBuf(name, w, h) {
    if (typeof document === 'undefined') return null;
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    let c, x;
    if (name === 'thresh') {
      if (!_threshBuf) { _threshBuf = document.createElement('canvas'); _threshCtx = _threshBuf.getContext('2d', { willReadFrequently: true }); }
      c = _threshBuf; x = _threshCtx;
    } else if (name === 'haze') {
      if (!_hazeBuf) { _hazeBuf = document.createElement('canvas'); _hazeCtx = _hazeBuf.getContext('2d'); }
      c = _hazeBuf; x = _hazeCtx;
    } else {
      if (!_reachBuf) { _reachBuf = document.createElement('canvas'); _reachCtx = _reachBuf.getContext('2d'); }
      c = _reachBuf; x = _reachCtx;
    }
    if (c.width !== rw || c.height !== rh) { c.width = rw; c.height = rh; }
    return { c, x };
  }

  reg.register({
    id: 'haze-flare',
    name: 'Haze / Flare',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Magic Bullet Looks style optical diffusion haze with light spillage, softness control, horizontal reach flare, matte box shading, and secondary inverted reflection bounce',
    params: [
      { id: 'spillage', label: 'Spillage', type: 'number', min: 0, max: 100, default: 40, unit: '%' },
      { id: 'softness', label: 'Softness', type: 'number', min: 5, max: 150, default: 50, unit: 'px' },
      { id: 'reach', label: 'Reach', type: 'number', min: 0, max: 100, default: 40, unit: '%' },
      { id: 'exposure', label: 'Exposure', type: 'number', min: 0, max: 200, default: 100, unit: '%' },
      { id: 'reflection', label: 'Reflection', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'reflectionExposure', label: 'Reflection Exposure', type: 'number', min: 0, max: 200, default: 80, unit: '%' },
      { id: 'matteBoxSize', label: 'Matte Box Size', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'matteBoxShade', label: 'Matte Box Shade', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'tint', label: 'Tint', type: 'color', default: '#ffeedd' },
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

      // Read parameters with fallback aliases for backward compatibility
      const spillage = Math.max(0, Math.min(100, fx && fx.spillage !== undefined ? Number(fx.spillage) : (fx && fx.highlight !== undefined ? 100 - Number(fx.highlight) : 40))) / 100;
      const softness = Math.max(5, Math.min(150, fx && fx.softness !== undefined ? Number(fx.softness) : (fx && fx.bloom !== undefined ? Number(fx.bloom) : 50)));
      const reach = Math.max(0, Math.min(100, fx && fx.reach !== undefined ? Number(fx.reach) : 40)) / 100;
      const expVal = fx && fx.exposure !== undefined ? Number(fx.exposure) : (fx && fx.amount !== undefined ? Number(fx.amount) * 2 : 100);
      const exposure = Math.max(0, Math.min(200, expVal)) / 100;
      if (exposure <= 0.005) return;

      const reflection = Math.max(0, Math.min(100, fx && fx.reflection !== undefined ? Number(fx.reflection) : 0)) / 100;
      const reflExposure = Math.max(0, Math.min(200, fx && fx.reflectionExposure !== undefined ? Number(fx.reflectionExposure) : 80)) / 100;
      const matteBoxSize = Math.max(0, Math.min(100, fx && fx.matteBoxSize !== undefined ? Number(fx.matteBoxSize) : 0)) / 100;
      const matteBoxShade = Math.max(0, Math.min(100, fx && fx.matteBoxShade !== undefined ? Number(fx.matteBoxShade) : 50)) / 100;
      const tintHex = (fx && fx.tint) || (fx && fx.color) || '#ffeedd';
      const blendMode = (fx && fx.blendMode) || 'screen';

      const tintRgb = hexToRgb(tintHex);

      // --- 1. GPU WEBGL PIPELINE ---
      if (!_glFailed && initHazeGL()) {
        try {
          const gl = _gl;

          // Adaptive downscale for smooth wide haze bloom
          const downscale = softness <= 20 ? 1 : (softness <= 60 ? 2 : 4);
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
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
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

            const bindClear = (fbo) => {
              gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
              gl.clearColor(0, 0, 0, 0);
              gl.clear(gl.COLOR_BUFFER_BIT);
            };

            // Pass 1: Extract Highlights via Spillage & Matte Box -> _highFBO
            bindAttr(_extractProg);
            bindClear(_highFBO);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _srcTex);
            gl.uniform1i(_extractUniforms.image, 0);
            gl.uniform1f(_extractUniforms.spillage, spillage);
            gl.uniform1f(_extractUniforms.matteSize, matteBoxSize);
            gl.uniform1f(_extractUniforms.matteShade, matteBoxShade);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            bindAttr(_blurProg);
            gl.uniform1i(_blurUniforms.texture, 0);

            // Pass 2: Spherical Haze Diffusion (Multi-octave Separable Blur)
            // Octave 1: Inner core glow (_highTex -> _pingFBO (H) -> _pongFBO (V))
            const r1 = Math.max(1.5, (softness / downscale) * 0.45);
            bindClear(_pingFBO);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _highTex);
            gl.uniform2f(_blurUniforms.delta, r1 / bw, 0.0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            bindClear(_pongFBO);
            gl.bindTexture(gl.TEXTURE_2D, _pingTex);
            gl.uniform2f(_blurUniforms.delta, 0.0, r1 / bh);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Octave 2: Wide atmospheric wash (_pongTex -> _pingFBO (H) -> _hazeFBO (V))
            const r2 = Math.max(3.0, (softness / downscale) * 1.15);
            bindClear(_pingFBO);
            gl.bindTexture(gl.TEXTURE_2D, _pongTex);
            gl.uniform2f(_blurUniforms.delta, r2 / bw, 0.0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            bindClear(_hazeFBO);
            gl.bindTexture(gl.TEXTURE_2D, _pingTex);
            gl.uniform2f(_blurUniforms.delta, 0.0, r2 / bh);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Pass 3: Horizontal Reach Flare Streak
            bindClear(_reachFBO);
            if (reach > 0.01) {
              const reachRad1 = Math.max(2.0, (reach * 35.0) / downscale);
              bindClear(_pingFBO);
              gl.bindTexture(gl.TEXTURE_2D, _highTex);
              gl.uniform2f(_blurUniforms.delta, reachRad1 / bw, 0.0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

              const reachRad2 = Math.max(4.0, (reach * 90.0) / downscale);
              bindClear(_reachFBO);
              gl.bindTexture(gl.TEXTURE_2D, _pingTex);
              gl.uniform2f(_blurUniforms.delta, reachRad2 / bw, 0.0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }

            // Pass 4: Composite -> default framebuffer (_glCanvas)
            bindAttr(_compProg);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _hazeTex);
            gl.uniform1i(_compUniforms.haze, 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, _reachTex);
            gl.uniform1i(_compUniforms.reach, 1);

            gl.uniform3f(_compUniforms.tint, tintRgb.r, tintRgb.g, tintRgb.b);
            gl.uniform1f(_compUniforms.reachAmt, reach);
            gl.uniform1f(_compUniforms.exposure, exposure);
            gl.uniform1f(_compUniforms.reflection, reflection);
            gl.uniform1f(_compUniforms.reflExposure, reflExposure);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Composite WebGL flare canvas onto 2D ctx
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
      const hazeBuf = getFallbackBuf('haze', w, h);
      const reachBuf = getFallbackBuf('reach', w, h);
      if (!thresh || !hazeBuf || !reachBuf) return;

      thresh.x.clearRect(0, 0, w, h);
      try {
        thresh.x.drawImage(el, 0, 0, w, h);
        const imgData = thresh.x.getImageData(0, 0, w, h);
        const d = imgData.data;
        const threshVal = (0.88 - spillage * 0.66) * 255;
        const knee = Math.max(10, Math.round((0.08 + spillage * 0.27) * 255));

        for (let y = 0; y < h; y++) {
          const dyNorm = Math.abs((y / h) - 0.5) * 2.0;
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const a = d[idx + 3];
            if (a <= 3) continue;
            const r = d[idx];
            const g = d[idx + 1];
            const b = d[idx + 2];
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            if (luma < threshVal - knee) {
              d[idx + 3] = 0;
            } else {
              let factor = Math.min(1.0, Math.max(0.0, (luma - (threshVal - knee)) / (knee * 2)));
              factor = factor * factor;

              // Matte box lens hood boundary shading
              if (matteBoxSize > 0.01 && matteBoxShade > 0.01) {
                const dxNorm = Math.abs((x / w) - 0.5) * 2.0;
                const edge = Math.max(dxNorm, dyNorm);
                const boxLimit = 1.0 - matteBoxSize * 0.45;
                if (edge > boxLimit) {
                  const shade = 1.0 - Math.min(1.0, (edge - boxLimit) / (1.0 - boxLimit)) * matteBoxShade;
                  factor *= shade;
                }
              }

              d[idx + 3] = Math.round(a * factor);
            }
          }
        }
        thresh.x.putImageData(imgData, 0, 0);
      } catch (_) {
        return;
      }

      // Spherical Haze Diffusion
      hazeBuf.x.clearRect(0, 0, w, h);
      const rad = Math.max(3, softness * 0.6);
      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
        window.FishEffects.drawBlurred(hazeBuf.x, thresh.c, w, h, rad);
      } else {
        try {
          hazeBuf.x.filter = `blur(${rad.toFixed(1)}px)`;
          hazeBuf.x.drawImage(thresh.c, 0, 0);
        } catch (_) {}
      }

      // Horizontal Reach Flare Stretch
      reachBuf.x.clearRect(0, 0, w, h);
      if (reach > 0.01) {
        reachBuf.x.drawImage(thresh.c, 0, 0);
        const offsets = [4, 16, 48, 120, 300];
        const count = Math.min(offsets.length, Math.max(2, Math.round(reach * offsets.length)));
        reachBuf.x.save();
        reachBuf.x.globalCompositeOperation = 'lighter';
        for (let i = 0; i < count; i++) {
          const off = offsets[i];
          reachBuf.x.globalAlpha = 0.55 / (i + 1);
          reachBuf.x.drawImage(thresh.c, -off, 0);
          reachBuf.x.drawImage(thresh.c, off, 0);
        }
        reachBuf.x.restore();
      }

      // Tint Haze Buffer
      hazeBuf.x.save();
      if (reach > 0.01) {
        hazeBuf.x.globalCompositeOperation = 'lighter';
        hazeBuf.x.globalAlpha = reach * 1.5;
        hazeBuf.x.drawImage(reachBuf.c, 0, 0);
      }
      hazeBuf.x.globalCompositeOperation = 'source-in';
      hazeBuf.x.fillStyle = tintHex;
      hazeBuf.x.fillRect(0, 0, w, h);
      hazeBuf.x.restore();

      // Secondary inverted reflection ghost (1.0 - uv across optical center)
      if (reflection > 0.005 && reflExposure > 0.005) {
        hazeBuf.x.save();
        hazeBuf.x.globalCompositeOperation = 'lighter';
        hazeBuf.x.globalAlpha = Math.min(1.0, reflection * reflExposure);
        hazeBuf.x.translate(w, h);
        hazeBuf.x.scale(-1, -1);
        hazeBuf.x.drawImage(hazeBuf.c, 0, 0);
        hazeBuf.x.restore();
      }

      // Composite onto target canvas
      ctx.save();
      ctx.globalCompositeOperation = blendMode;
      ctx.globalAlpha = Math.min(1.0, exposure);
      try { ctx.drawImage(hazeBuf.c, bx, by, w, h); } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
