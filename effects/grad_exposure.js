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

  function initGradGL() {
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
        'uniform vec2 u_resolution;',
        'uniform float u_exposure;',
        'uniform float u_angleRad;',
        'uniform float u_softness;',
        'uniform float u_offset;',
        '',
        'void main(void) {',
        '  vec4 col = texture2D(u_image, v_uv);',
        '  vec2 p = (v_uv - 0.5) * u_resolution;',
        '  float diag = length(u_resolution) * 0.5;',
        '  float dist = p.x * cos(u_angleRad) + p.y * sin(u_angleRad);',
        '  float normDist = (dist / max(1.0, diag)) - (u_offset / 100.0);',
        '  float span = max(0.02, u_softness / 100.0);',
        '  float t = smoothstep(-span, span, normDist);',
        '  float ev = (u_exposure / 100.0) * t * 2.5;',
        '  float mult = pow(2.0, ev);',
        '  gl_FragColor = vec4(clamp(col.rgb * mult, 0.0, 1.0), col.a);',
        '}'
      ].join('\n');

      function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error('[GradExposure GL] Shader compile error:', gl.getShaderInfoLog(s));
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
        console.error('[GradExposure GL] Program link error:', gl.getProgramInfoLog(prog));
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        image: gl.getUniformLocation(prog, 'u_image'),
        resolution: gl.getUniformLocation(prog, 'u_resolution'),
        exposure: gl.getUniformLocation(prog, 'u_exposure'),
        angleRad: gl.getUniformLocation(prog, 'u_angleRad'),
        softness: gl.getUniformLocation(prog, 'u_softness'),
        offset: gl.getUniformLocation(prog, 'u_offset')
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
      console.warn('[GradExposure GL] WebGL init failed:', e);
      _glFailed = true;
      return false;
    }
  }

  reg.register({
    id: 'grad-exposure',
    name: 'Grad Exposure',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Graduated neutral density exposure ramp with angle, softness, and position controls',
    params: [
      { id: 'exposure', label: 'Exposure', type: 'number', min: -100, max: 100, default: 35, unit: '%' },
      { id: 'angle', label: 'Angle', type: 'angle', min: -360, max: 360, default: 0, unit: '°' },
      { id: 'softness', label: 'Softness', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'offset', label: 'Position', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      const exposure = fx && fx.exposure !== undefined ? Number(fx.exposure) : 35;
      const angleDeg = fx && fx.angle !== undefined ? Number(fx.angle) : 0;
      const softness = Math.max(1, fx && fx.softness !== undefined ? Number(fx.softness) : 50);
      const offset = fx && fx.offset !== undefined ? Number(fx.offset) : 0;

      if (Math.abs(exposure) <= 0.5) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const angleRad = (angleDeg * Math.PI) / 180;

      if (!_glFailed && initGradGL()) {
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

          if (!uploaded) throw new Error('Grad exposure texture upload failed');
          gl.uniform1i(u.image, 0);

          gl.uniform2f(u.resolution, w, h);
          gl.uniform1f(u.exposure, exposure);
          gl.uniform1f(u.angleRad, angleRad);
          gl.uniform1f(u.softness, softness);
          gl.uniform1f(u.offset, offset);

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
        } catch (err) {
          console.warn('[GradExposure] WebGL render error:', err);
        }
      }

      // Fallback direct draw
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
    }
  });
})(typeof window !== 'undefined' ? window : this);
