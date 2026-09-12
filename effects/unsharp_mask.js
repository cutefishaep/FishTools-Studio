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
  let _origTex = null;
  let _blurTex = null;
  let _glFailed = false;
  let _scratchCanvas = null;
  let _scratchCtx = null;

  let _blurCanvas = null;
  let _blurCtx = null;

  function getBlurCanvas(w, h) {
    if (typeof document === 'undefined') return null;
    if (!_blurCanvas) {
      _blurCanvas = document.createElement('canvas');
      _blurCtx = _blurCanvas.getContext('2d');
    }
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    if (_blurCanvas.width !== rw || _blurCanvas.height !== rh) {
      _blurCanvas.width = rw;
      _blurCanvas.height = rh;
    }
    return { canvas: _blurCanvas, ctx: _blurCtx };
  }

  function initUnsharpGL() {
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
        'uniform sampler2D u_orig;',
        'uniform sampler2D u_blur;',
        'uniform float u_amount;',
        'uniform float u_threshold;',
        '',
        'void main(void) {',
        '  vec4 origCol = texture2D(u_orig, v_uv);',
        '  vec4 blurCol = texture2D(u_blur, v_uv);',
        '  vec3 diff = origCol.rgb - blurCol.rgb;',
        '  float lumDiff = dot(abs(diff), vec3(0.299, 0.587, 0.114));',
        '  float mult = u_amount / 100.0;',
        '  if (lumDiff >= u_threshold) {',
        '    vec3 sharpened = origCol.rgb + diff * mult;',
        '    gl_FragColor = vec4(clamp(sharpened, 0.0, 1.0), origCol.a);',
        '  } else {',
        '    gl_FragColor = origCol;',
        '  }',
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
        console.error('[UnsharpMask GL] Program link error:', gl.getProgramInfoLog(prog));
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        orig: gl.getUniformLocation(prog, 'u_orig'),
        blur: gl.getUniformLocation(prog, 'u_blur'),
        amount: gl.getUniformLocation(prog, 'u_amount'),
        threshold: gl.getUniformLocation(prog, 'u_threshold')
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

      _origTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, _origTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      _blurTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, _blurTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      return true;
    } catch (e) {
      console.warn('[UnsharpMask GL] WebGL init failed:', e);
      _glFailed = true;
      return false;
    }
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

      // Generate blurred copy in offscreen canvas
      const blurEntry = getBlurCanvas(w, h);
      if (!blurEntry || !blurEntry.ctx) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }
      const bCtx = blurEntry.ctx;
      bCtx.clearRect(0, 0, w, h);
      if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.drawBlurred === 'function') {
        window.FishEffects.drawBlurred(bCtx, el, w, h, radius);
      } else {
        bCtx.save();
        try { bCtx.filter = `blur(${radius.toFixed(1)}px)`; } catch (_) {}
        try { bCtx.drawImage(el, 0, 0, w, h); } catch (_) {}
        bCtx.restore();
      }

      if (!_glFailed && initUnsharpGL()) {
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
          gl.uniform1i(u.orig, 0);

          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, _blurTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blurEntry.canvas);
          gl.uniform1i(u.blur, 1);

          gl.uniform1f(u.amount, amount);
          gl.uniform1f(u.threshold, threshold);

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
          console.warn('[UnsharpMask] WebGL render error:', err);
        }
      }

      // Fallback direct draw
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
    }
  });
})(typeof window !== 'undefined' ? window : this);
