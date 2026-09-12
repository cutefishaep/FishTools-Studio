(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  let _glCanvas = null;
  let _gl = null;
  let _glProg = null;
  let _glUniforms = null;
  let _posBuf = null;
  let _uvBuf = null;
  let _tex = null;
  let _glFailed = false;
  let _scratchCanvas = null;
  let _scratchCtx = null;

  function initBCGL() {
    if (_gl && _glProg) return true;
    if (_glFailed) return false;
    if (typeof document === 'undefined') return false;

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

      const fsSource = [
        'precision highp float;',
        'varying vec2 v_uv;',
        'uniform sampler2D u_image;',
        'uniform float u_brightness;',
        'uniform float u_contrast;',
        '',
        'void main(void) {',
        '  vec4 color = texture2D(u_image, v_uv);',
        '  if (color.a <= 0.0001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  vec3 rgb = color.rgb / color.a;',
        '  rgb = (rgb - 0.5) * (1.0 + u_contrast / 100.0) + 0.5;',
        '  rgb = rgb + (u_brightness / 100.0);',
        '  rgb = clamp(rgb, 0.0, 1.0);',
        '  gl_FragColor = vec4(rgb * color.a, color.a);',
        '}'
      ].join('\n');

      function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          return null;
        }
        return s;
      }

      const vs = compileShader(gl.VERTEX_SHADER, vsSource);
      const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) {
        _glFailed = true;
        return false;
      }

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        image: gl.getUniformLocation(prog, 'u_image'),
        brightness: gl.getUniformLocation(prog, 'u_brightness'),
        contrast: gl.getUniformLocation(prog, 'u_contrast')
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

      _tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, _tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      return true;
    } catch (e) {
      _glFailed = true;
      return false;
    }
  }

  reg.register({
    id: 'brightness-contrast',
    name: 'Brightness / Contrast',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Adjust luminance and tonal contrast',
    params: [
      { id: 'brightness', label: 'Brightness', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'contrast', label: 'Contrast', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    filter(fx) {
      const b = 1 + (fx.brightness || 0) / 100;
      const c = 1 + (fx.contrast || 0) / 100;
      return `brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)})`;
    },
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      // Video readiness guard
      if (el.tagName === 'VIDEO' && (el.readyState < 2 || !el.videoWidth || !el.videoHeight)) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const brightness = fx && fx.brightness !== undefined ? Number(fx.brightness) : 0;
      const contrast = fx && fx.contrast !== undefined ? Number(fx.contrast) : 0;

      // Identity pass
      if (Math.abs(brightness) < 0.001 && Math.abs(contrast) < 0.001) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      // Fast GPU WebGL Pass
      if (!_glFailed && initBCGL()) {
        try {
          const gl = _gl;
          const prog = _glProg;
          const u = _glUniforms;

          if (_glCanvas.width !== w || _glCanvas.height !== h) {
            _glCanvas.width = w;
            _glCanvas.height = h;
          }

          gl.viewport(0, 0, w, h);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);

          gl.useProgram(prog);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, _tex);

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

          if (uploaded) {
            gl.uniform1i(u.image, 0);
            gl.uniform1f(u.brightness, brightness);
            gl.uniform1f(u.contrast, contrast);

            const posLoc = gl.getAttribLocation(prog, 'a_pos');
            gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

            const uvLoc = gl.getAttribLocation(prog, 'a_uv');
            gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
            gl.enableVertexAttribArray(uvLoc);
            gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            ctx.drawImage(_glCanvas, x, y, w, h);
            return;
          }
        } catch (glErr) {}
      }

      // Canvas 2D Fallback: if browser supports filter
      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.isCanvasFilterSupported === 'function' && window.FishEffects.isCanvasFilterSupported()) {
        ctx.save();
        const b = 1 + brightness / 100;
        const c = 1 + contrast / 100;
        ctx.filter = `brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)})`;
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        ctx.restore();
        return;
      }

      // Direct fallback
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
    }
  });
})(typeof window !== 'undefined' ? window : this);
