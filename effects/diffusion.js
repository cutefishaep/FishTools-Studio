(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgb01(hex) {
    let c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
  }

  let _glCanvas = null;
  let _gl = null;
  let _extractProg = null;
  let _extractUniforms = null;
  let _blurProg = null;
  let _blurUniforms = null;
  let _posBuf = null;
  let _uvBuf = null;
  let _origTex = null;
  let _bloomTex0 = null;
  let _bloomTex1 = null;
  let _bloomFBO0 = null;
  let _bloomFBO1 = null;
  let _fboW = 0;
  let _fboH = 0;
  let _glFailed = false;
  let _scratchCanvas = null;
  let _scratchCtx = null;

  let _diffBuf = null;
  let _diffCtx = null;
  let _threshBuf = null;
  let _threshCtx = null;

  function getDiffBuffer(w, h) {
    if (typeof document === 'undefined') return null;
    if (!_diffBuf) {
      _diffBuf = document.createElement('canvas');
      _diffCtx = _diffBuf.getContext('2d');
    }
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    if (_diffBuf.width !== rw || _diffBuf.height !== rh) {
      _diffBuf.width = rw;
      _diffBuf.height = rh;
    }
    return { canvas: _diffBuf, ctx: _diffCtx };
  }

  function initDiffGL() {
    if (_gl && _extractProg && _blurProg) return true;
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

      // Soft-knee Rec.709 highlight extraction with tint
      const extractFs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_image;',
        'uniform float u_threshold;',
        'uniform vec3 u_tint;',
        'void main(void) {',
        '  vec4 col = texture2D(u_image, v_uv);',
        '  if (col.a <= 0.001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  vec3 rgb = col.rgb / col.a;',
        '  float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));',
        '  float knee = 0.18;',
        '  float t = u_threshold;',
        '  float weight = smoothstep(t - knee, t + knee, lum);',
        '  vec3 bloom = rgb * weight * u_tint;',
        '  gl_FragColor = vec4(bloom * col.a, col.a * weight);',
        '}'
      ].join('\n');

      // 9-tap separable Gaussian blur (5 texture lookups with linear filtering)
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

      function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
      }

      const vsShader = compile(gl.VERTEX_SHADER, vs);
      const extShader = compile(gl.FRAGMENT_SHADER, extractFs);
      const bShader = compile(gl.FRAGMENT_SHADER, blurFs);
      if (!vsShader || !extShader || !bShader) { _glFailed = true; return false; }

      // Extract program
      const extProg = gl.createProgram();
      gl.attachShader(extProg, vsShader);
      gl.attachShader(extProg, extShader);
      gl.linkProgram(extProg);
      if (!gl.getProgramParameter(extProg, gl.LINK_STATUS)) { _glFailed = true; return false; }
      _extractProg = extProg;
      _extractUniforms = {
        image: gl.getUniformLocation(extProg, 'u_image'),
        threshold: gl.getUniformLocation(extProg, 'u_threshold'),
        tint: gl.getUniformLocation(extProg, 'u_tint')
      };

      // Blur program
      const blurProg = gl.createProgram();
      gl.attachShader(blurProg, vsShader);
      gl.attachShader(blurProg, bShader);
      gl.linkProgram(blurProg);
      if (!gl.getProgramParameter(blurProg, gl.LINK_STATUS)) { _glFailed = true; return false; }
      _blurProg = blurProg;
      _blurUniforms = {
        texture: gl.getUniformLocation(blurProg, 'u_texture'),
        delta: gl.getUniformLocation(blurProg, 'u_delta')
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

      _origTex = createTex();
      _bloomTex0 = createTex();
      _bloomTex1 = createTex();

      _bloomFBO0 = gl.createFramebuffer();
      _bloomFBO1 = gl.createFramebuffer();

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

    gl.bindTexture(gl.TEXTURE_2D, _bloomTex0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, _bloomFBO0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _bloomTex0, 0);

    gl.bindTexture(gl.TEXTURE_2D, _bloomTex1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, _bloomFBO1);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _bloomTex1, 0);
  }

  reg.register({
    id: 'diffusion',
    name: 'Diffusion',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Black Pro-Mist style highlight bloom and film diffusion glow',
    params: [
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, default: 40, unit: '%' },
      { id: 'radius', label: 'Radius', type: 'number', min: 2, max: 150, default: 30, unit: 'px' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 60, unit: '%' },
      { id: 'color', label: 'Color', type: 'color', default: '#ffffff' },
      { id: 'blendMode', label: 'Blend Mode', type: 'select', options: ['screen', 'lighter', 'soft-light'], default: 'screen' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      const intensity = Math.max(0, Math.min(100, fx && fx.intensity !== undefined ? Number(fx.intensity) : 40)) / 100;
      const radius = Math.max(1, fx && fx.radius !== undefined ? Number(fx.radius) : 30);
      const threshold = Math.max(0, Math.min(100, fx && fx.threshold !== undefined ? Number(fx.threshold) : 60)) / 100;
      const color = (fx && fx.color) ? fx.color : '#ffffff';
      const blendMode = (fx && fx.blendMode) || 'screen';

      // Always draw base image first
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}

      if (intensity <= 0.005) return;

      // GPU WebGL Highlight Extraction & Gaussian Dispersion Bloom
      if (!_glFailed && initDiffGL()) {
        try {
          const gl = _gl;
          const tintRgb = hexToRgb01(color);

          // Adaptive downscale for smooth bloom
          const downscale = radius <= 10 ? 1 : (radius <= 40 ? 2 : 4);
          const bw = Math.max(2, Math.round(w / downscale));
          const bh = Math.max(2, Math.round(h / downscale));

          if (_glCanvas.width !== bw || _glCanvas.height !== bh) {
            _glCanvas.width = bw;
            _glCanvas.height = bh;
          }

          resizeFBOs(gl, bw, bh);

          // 1. Upload source image to _origTex
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
            const sw = Math.min(1920, el.videoWidth || el.naturalWidth || el.width || bw);
            const sh = Math.min(1080, el.videoHeight || el.naturalHeight || el.height || bh);
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

          if (uploaded) {
            gl.viewport(0, 0, bw, bh);

            // Set up vertex attributes
            const posLoc = gl.getAttribLocation(_extractProg, 'a_pos');
            gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

            const uvLoc = gl.getAttribLocation(_extractProg, 'a_uv');
            gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
            gl.enableVertexAttribArray(uvLoc);
            gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

            // Pass 1: Extract soft-knee highlights into _bloomFBO0
            gl.useProgram(_extractProg);
            gl.bindFramebuffer(gl.FRAMEBUFFER, _bloomFBO0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _origTex);
            gl.uniform1i(_extractUniforms.image, 0);
            gl.uniform1f(_extractUniforms.threshold, threshold);
            gl.uniform3f(_extractUniforms.tint, tintRgb[0], tintRgb[1], tintRgb[2]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Pass 2: Separable Gaussian Blur (Horizontal Pass) into _bloomFBO1
            const effRadius = radius / downscale;
            const step = effRadius * 0.70;

            gl.useProgram(_blurProg);
            gl.bindFramebuffer(gl.FRAMEBUFFER, _bloomFBO1);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _bloomTex0);
            gl.uniform1i(_blurUniforms.texture, 0);
            gl.uniform2f(_blurUniforms.delta, step / bw, 0.0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Pass 3: Separable Gaussian Blur (Vertical Pass) into default framebuffer (_glCanvas)
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.bindTexture(gl.TEXTURE_2D, _bloomTex1);
            gl.uniform2f(_blurUniforms.delta, 0.0, step / bh);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Composite bloom over base image
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.globalCompositeOperation = blendMode;
            ctx.globalAlpha = Math.min(1.0, intensity * 1.25);
            try {
              ctx.drawImage(_glCanvas, x, y, w, h);
            } catch (_) {}
            ctx.restore();
            return;
          }
        } catch (_) {}
      }

      // Universal Canvas 2D Fallback with smooth luma extraction
      const buf = getDiffBuffer(w, h);
      if (!buf || !buf.ctx) return;
      const bCtx = buf.ctx;
      bCtx.clearRect(0, 0, w, h);

      try {
        bCtx.drawImage(el, 0, 0, w, h);
        const imgData = bCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const threshVal = threshold * 255;
        const knee = 35;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] <= 3) continue;
          const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          if (luma < threshVal - knee) {
            data[i + 3] = 0;
          } else {
            const factor = Math.min(1.0, Math.max(0.0, (luma - (threshVal - knee)) / (knee * 2)));
            data[i + 3] = Math.round(data[i + 3] * factor * factor);
          }
        }
        bCtx.putImageData(imgData, 0, 0);

        // Tint bloom if color is specified and not pure white
        if (color && color.toLowerCase() !== '#ffffff') {
          bCtx.save();
          bCtx.globalCompositeOperation = 'source-in';
          bCtx.fillStyle = color;
          bCtx.fillRect(0, 0, w, h);
          bCtx.restore();
        }

        if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
          if (!_threshBuf) {
            _threshBuf = document.createElement('canvas');
            _threshCtx = _threshBuf.getContext('2d');
          }
          if (_threshBuf.width !== w || _threshBuf.height !== h) {
            _threshBuf.width = w;
            _threshBuf.height = h;
          }
          _threshCtx.clearRect(0, 0, w, h);
          _threshCtx.drawImage(buf.canvas, 0, 0);

          bCtx.clearRect(0, 0, w, h);
          window.FishEffects.drawBlurred(bCtx, _threshBuf, w, h, radius);
        }

        ctx.save();
        ctx.globalCompositeOperation = blendMode;
        ctx.globalAlpha = Math.min(1.0, intensity);
        ctx.drawImage(buf.canvas, x, y, w, h);
        ctx.restore();
      } catch (_) {}
    }
  });
})(typeof window !== 'undefined' ? window : this);
