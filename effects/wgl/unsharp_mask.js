(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let _glCanvas = null;
  let _gl = null;
  let _blurProg = null;
  let _blurUniforms = null;
  let _unsharpProg = null;
  let _unsharpUniforms = null;
  let _posBuf = null;
  let _uvBuf = null;
  let _origTex = null;
  let _blurTex0 = null;
  let _blurTex1 = null;
  let _blurFBO0 = null;
  let _blurFBO1 = null;
  let _fboW = 0;
  let _fboH = 0;
  let _glFailed = false;
  let _scratchCanvas = null;
  let _scratchCtx = null;

  let _fallbackCanvas = null;
  let _fallbackCtx = null;

  function getFallbackCanvas(w, h) {
    if (typeof document === 'undefined') return null;
    if (!_fallbackCanvas) {
      _fallbackCanvas = document.createElement('canvas');
      _fallbackCtx = _fallbackCanvas.getContext('2d');
    }
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    if (_fallbackCanvas.width !== rw || _fallbackCanvas.height !== rh) {
      _fallbackCanvas.width = rw;
      _fallbackCanvas.height = rh;
    }
    return { canvas: _fallbackCanvas, ctx: _fallbackCtx };
  }

  function initUnsharpGL() {
    if (_gl && _unsharpProg && _blurProg) return true;
    if (_glFailed || typeof document === 'undefined') return false;

    try {
      if (!_glCanvas) {
        _glCanvas = document.createElement('canvas');
      }

      const opts = {
        alpha: true,
        depth: false,
        stencil: false,
        antialias: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false
      };

      const gl = _glCanvas.getContext('webgl2', opts) ||
                 _glCanvas.getContext('webgl', opts) ||
                 _glCanvas.getContext('experimental-webgl', opts);

      if (!gl) {
        _glFailed = true;
        return false;
      }
      _gl = gl;

      const vsSource = [
        'attribute vec2 a_pos;',
        'attribute vec2 a_uv;',
        'varying vec2 v_uv;',
        'void main(void) {',
        '  v_uv = a_uv;',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n');

      // 9-tap separable Gaussian blur (5 texture lookups with linear filtering)
      const blurFsSource = [
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

      // Studio Unsharp Mask with Rec.709 Luminance and Hermite smoothstep thresholding
      const unsharpFsSource = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_orig;',
        'uniform sampler2D u_blur;',
        'uniform float u_amount;',
        'uniform float u_threshold;',
        '',
        'void main(void) {',
        '  vec4 origCol = texture2D(u_orig, v_uv);',
        '  vec4 blurCol = texture2D(u_blur, v_uv);',
        '  vec3 diff = origCol.rgb - blurCol.rgb;',
        '  float lumDiff = dot(abs(diff), vec3(0.2126, 0.7152, 0.0722));',
        '  float mult = u_amount / 100.0;',
        '  float factor = smoothstep(u_threshold, u_threshold + 0.03, lumDiff);',
        '  vec3 sharpened = origCol.rgb + diff * (mult * factor);',
        '  gl_FragColor = vec4(clamp(sharpened, 0.0, 1.0), origCol.a);',
        '}'
      ].join('\n');

      function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error('[UnsharpMask GL] Shader compile error:', gl.getShaderInfoLog(s));
          return null;
        }
        return s;
      }

      const vs = compileShader(gl.VERTEX_SHADER, vsSource);
      const blurFs = compileShader(gl.FRAGMENT_SHADER, blurFsSource);
      const unsharpFs = compileShader(gl.FRAGMENT_SHADER, unsharpFsSource);
      if (!vs || !blurFs || !unsharpFs) {
        _glFailed = true;
        return false;
      }

      // Blur program
      const blurProg = gl.createProgram();
      gl.attachShader(blurProg, vs);
      gl.attachShader(blurProg, blurFs);
      gl.linkProgram(blurProg);
      if (!gl.getProgramParameter(blurProg, gl.LINK_STATUS)) {
        _glFailed = true;
        return false;
      }
      _blurProg = blurProg;
      _blurUniforms = {
        texture: gl.getUniformLocation(blurProg, 'u_texture'),
        delta: gl.getUniformLocation(blurProg, 'u_delta')
      };

      // Unsharp program
      const unsharpProg = gl.createProgram();
      gl.attachShader(unsharpProg, vs);
      gl.attachShader(unsharpProg, unsharpFs);
      gl.linkProgram(unsharpProg);
      if (!gl.getProgramParameter(unsharpProg, gl.LINK_STATUS)) {
        _glFailed = true;
        return false;
      }
      _unsharpProg = unsharpProg;
      _unsharpUniforms = {
        orig: gl.getUniformLocation(unsharpProg, 'u_orig'),
        blur: gl.getUniformLocation(unsharpProg, 'u_blur'),
        amount: gl.getUniformLocation(unsharpProg, 'u_amount'),
        threshold: gl.getUniformLocation(unsharpProg, 'u_threshold')
      };

      const positions = new Float32Array([
        -1.0,  1.0,
        -1.0, -1.0,
         1.0,  1.0,
         1.0, -1.0
      ]);
      const texCoords = new Float32Array([
        0.0, 0.0,
        0.0, 1.0,
        1.0, 0.0,
        1.0, 1.0
      ]);

      _posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

      _uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

      function createLinearTexture() {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return tex;
      }

      _origTex = createLinearTexture();
      _blurTex0 = createLinearTexture();
      _blurTex1 = createLinearTexture();

      _blurFBO0 = gl.createFramebuffer();
      _blurFBO1 = gl.createFramebuffer();

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      return true;
    } catch (e) {
      console.warn('[UnsharpMask GL] WebGL init failed:', e);
      _glFailed = true;
      return false;
    }
  }

  function resizeFBOs(gl, w, h) {
    if (_fboW === w && _fboH === h) return;
    _fboW = w;
    _fboH = h;

    gl.bindTexture(gl.TEXTURE_2D, _blurTex0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, _blurFBO0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _blurTex0, 0);

    gl.bindTexture(gl.TEXTURE_2D, _blurTex1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, _blurFBO1);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _blurTex1, 0);
  }

  reg.register({
    id: 'unsharp-mask',
    name: 'Unsharp Mask',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'High-pass photographic edge sharpening using Gaussian unsharp masking',
    params: [
      { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 500, default: 100, unit: '%' },
      { id: 'radius', label: 'Radius', type: 'number', min: 0.5, max: 50, default: 2.0, step: 0.1, unit: 'px' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 0, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      const amount = Math.max(0, fx && fx.amount !== undefined ? Number(fx.amount) : 100);
      const radius = Math.max(0.2, fx && fx.radius !== undefined ? Number(fx.radius) : 2.0);
      const threshold = Math.max(0, Math.min(100, fx && fx.threshold !== undefined ? Number(fx.threshold) : 0)) / 100;

      if (amount <= 0.5) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      // Fast GPU In-VRAM Separable Gaussian Unsharp Engine
      if (!_glFailed && initUnsharpGL()) {
        try {
          const gl = _gl;

          if (_glCanvas.width !== w || _glCanvas.height !== h) {
            _glCanvas.width = w;
            _glCanvas.height = h;
          }

          resizeFBOs(gl, w, h);

          // 1. Upload original layer texture
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, _origTex);

          let uploaded = false;
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
            uploaded = true;
          } catch (_) {
            if (!_scratchCanvas) {
              _scratchCanvas = document.createElement('canvas');
              _scratchCtx = _scratchCanvas.getContext('2d');
            }
            const sw = Math.min(1920, el.videoWidth || el.naturalWidth || el.width || w);
            const sh = Math.min(1080, el.videoHeight || el.naturalHeight || el.height || h);
            if (_scratchCanvas.width !== sw || _scratchCanvas.height !== sh) {
              _scratchCanvas.width = sw;
              _scratchCanvas.height = sh;
            }
            _scratchCtx.clearRect(0, 0, sw, sh);
            _scratchCtx.drawImage(el, 0, 0, sw, sh);
            try {
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, _scratchCanvas);
              uploaded = true;
            } catch (_) {}
          }

          if (!uploaded) throw new Error('Unsharp mask upload failed');

          gl.viewport(0, 0, w, h);

          // Vertex attribute setup
          const posLocBlur = gl.getAttribLocation(_blurProg, 'a_pos');
          gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
          gl.enableVertexAttribArray(posLocBlur);
          gl.vertexAttribPointer(posLocBlur, 2, gl.FLOAT, false, 0, 0);

          const uvLocBlur = gl.getAttribLocation(_blurProg, 'a_uv');
          gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
          gl.enableVertexAttribArray(uvLocBlur);
          gl.vertexAttribPointer(uvLocBlur, 2, gl.FLOAT, false, 0, 0);

          // 2. In-VRAM Separable Gaussian Blur (Horizontal Pass)
          gl.useProgram(_blurProg);
          gl.bindFramebuffer(gl.FRAMEBUFFER, _blurFBO0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, _origTex);
          gl.uniform1i(_blurUniforms.texture, 0);
          gl.uniform2f(_blurUniforms.delta, (radius * 0.70) / w, 0.0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // 3. In-VRAM Separable Gaussian Blur (Vertical Pass)
          gl.bindFramebuffer(gl.FRAMEBUFFER, _blurFBO1);
          gl.bindTexture(gl.TEXTURE_2D, _blurTex0);
          gl.uniform2f(_blurUniforms.delta, 0.0, (radius * 0.70) / h);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // 4. Final Unsharp Mask Combine Pass directly to default framebuffer
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.useProgram(_unsharpProg);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, _origTex);
          gl.uniform1i(_unsharpUniforms.orig, 0);

          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, _blurTex1);
          gl.uniform1i(_unsharpUniforms.blur, 1);

          gl.uniform1f(_unsharpUniforms.amount, amount);
          gl.uniform1f(_unsharpUniforms.threshold, threshold);

          const posLocUnsharp = gl.getAttribLocation(_unsharpProg, 'a_pos');
          gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
          gl.enableVertexAttribArray(posLocUnsharp);
          gl.vertexAttribPointer(posLocUnsharp, 2, gl.FLOAT, false, 0, 0);

          const uvLocUnsharp = gl.getAttribLocation(_unsharpProg, 'a_uv');
          gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
          gl.enableVertexAttribArray(uvLocUnsharp);
          gl.vertexAttribPointer(uvLocUnsharp, 2, gl.FLOAT, false, 0, 0);

          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          ctx.drawImage(_glCanvas, x, y, w, h);
          return;
        } catch (err) {
          console.warn('[UnsharpMask] WebGL render error:', err);
        }
      }

      // Universal Fallback (Canvas 2D with FishEffects Gaussian blur)
      const fb = getFallbackCanvas(w, h);
      if (fb && fb.ctx && typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
        fb.ctx.clearRect(0, 0, w, h);
        window.FishEffects.drawBlurred(fb.ctx, el, w, h, radius);
        try {
          ctx.drawImage(el, x, y, w, h);
          ctx.save();
          ctx.globalAlpha = Math.min(1.0, amount / 100);
          ctx.globalCompositeOperation = 'overlay';
          ctx.drawImage(fb.canvas, x, y, w, h);
          ctx.restore();
          return;
        } catch (_) {}
      }

      // Fallback direct draw
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
    }
  });
})(typeof window !== 'undefined' ? window : this);
