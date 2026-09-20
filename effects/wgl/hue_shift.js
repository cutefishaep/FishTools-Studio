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
  let _scratchCanvas = null;
  let _scratchCtx = null;
  let _glFailed = false;

  function initHueShiftGL() {
    if (_gl && _glProg) return true;
    if (_glFailed || typeof document === 'undefined') return false;

    try {
      _glCanvas = document.createElement('canvas');
      _glCanvas.width = 256;
      _glCanvas.height = 256;

      const gl = _glCanvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        antialias: false
      });

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
        'uniform float u_angle;',
        '',
        'void main(void) {',
        '  vec4 col = texture2D(u_image, v_uv);',
        '  if (col.a <= 0.001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '',
        '  vec3 rgb = col.rgb / max(0.0001, col.a);',
        '  float c = cos(u_angle);',
        '  float s = sin(u_angle);',
        '',
        '  // Standard W3C Rec.709 hueRotate matrix',
        '  mat3 m = mat3(',
        '    0.213 + c * 0.787 - s * 0.213,',
        '    0.213 - c * 0.213 + s * 0.143,',
        '    0.213 - c * 0.213 - s * 0.787,',
        '',
        '    0.715 - c * 0.715 - s * 0.715,',
        '    0.715 + c * 0.285 + s * 0.140,',
        '    0.715 - c * 0.715 + s * 0.715,',
        '',
        '    0.072 - c * 0.072 + s * 0.928,',
        '    0.072 - c * 0.072 - s * 0.283,',
        '    0.072 + c * 0.928 + s * 0.072',
        '  );',
        '',
        '  vec3 rotated = clamp(m * rgb, 0.0, 1.0) * col.a;',
        '  gl_FragColor = vec4(rotated, col.a);',
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
        angle: gl.getUniformLocation(prog, 'u_angle')
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
    id: 'hue-shift',
    name: 'Hue Shift',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Rotate color wheel angle across full spectrum with GPU acceleration',
    params: [
      { id: 'hue', label: 'Hue Angle', type: 'angle', default: 0, unit: '°' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      // Video readiness guard for Safari WebKit CoreAnimation
      if (el.tagName === 'VIDEO' && (el.readyState < 2 || !el.videoWidth || !el.videoHeight)) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const rawHue = fx && fx.hue !== undefined ? Number(fx.hue) : 0;
      const normAngle = ((rawHue % 360) + 360) % 360;

      // Identity pass: 0° rotation requires no shader overhead
      if (Math.abs(normAngle) < 0.1 || Math.abs(normAngle - 360) < 0.1) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      if (!_glFailed && initHueShiftGL()) {
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
            // Safari WebKit HTMLVideoElement fallback buffer
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
            const angleRad = (normAngle * Math.PI) / 180;
            gl.uniform1i(u.image, 0);
            gl.uniform1f(u.angle, angleRad);

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
        } catch (err) {}
      }

      // Canvas2D filter fallback if WebGL unavailable
      try {
        if (typeof ctx.filter === 'string') {
          ctx.save();
          ctx.filter = `hue-rotate(${normAngle.toFixed(1)}deg)`;
          ctx.drawImage(el, x, y, w, h);
          ctx.restore();
          return;
        }
      } catch (_) {}

      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
    }
  });
})(typeof window !== 'undefined' ? window : this);
