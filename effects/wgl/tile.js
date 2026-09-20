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
  let _glTex = null;
  let _scratchCanvas = null;
  let _scratchCtx = null;
  let _glFailed = false;

  const VS_SOURCE = [
    'attribute vec2 a_pos;',
    'attribute vec2 a_uv;',
    'varying vec2 v_uv;',
    'void main(void) {',
    '  v_uv = a_uv;',
    '  gl_Position = vec4(a_pos, 0.0, 1.0);',
    '}'
  ].join('\n');

  const FS_SOURCE = [
    'precision highp float;',
    'varying vec2 v_uv;',
    'uniform sampler2D u_image;',
    'uniform vec2 u_resolution;',
    'uniform vec2 u_origin;',
    'uniform vec2 u_tileSize;',
    'uniform int u_mirror;',
    '',
    'vec2 mirrorUV(vec2 coord) {',
    '  vec2 m = mod(coord, 2.0);',
    '  if (m.x < 0.0) m.x += 2.0;',
    '  if (m.y < 0.0) m.y += 2.0;',
    '  vec2 f = mix(m, 2.0 - m, step(1.0, m));',
    '  return clamp(f, 0.0005, 0.9995);',
    '}',
    '',
    'vec2 repeatUV(vec2 coord) {',
    '  vec2 m = fract(coord);',
    '  if (m.x < 0.0) m.x += 1.0;',
    '  if (m.y < 0.0) m.y += 1.0;',
    '  return clamp(m, 0.0005, 0.9995);',
    '}',
    '',
    'void main(void) {',
    '  vec2 pixelPos = v_uv * u_resolution;',
    '  vec2 tileCoord = (pixelPos - u_origin) / u_tileSize;',
    '  vec2 sampleUV;',
    '  if (u_mirror == 1) {',
    '    sampleUV = mirrorUV(tileCoord);',
    '  } else {',
    '    sampleUV = repeatUV(tileCoord);',
    '  }',
    '  gl_FragColor = texture2D(u_image, sampleUV);',
    '}'
  ].join('\n');

  function initWebGL() {
    if (typeof document === 'undefined') return false;
    if (_gl && _glProg) return true;
    if (_glFailed) return false;

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
      _gl = _glCanvas.getContext('webgl2', opts) ||
            _glCanvas.getContext('webgl', opts) ||
            _glCanvas.getContext('experimental-webgl', opts);

      if (!_gl) {
        _glFailed = true;
        return false;
      }

      function compileShader(type, src) {
        const s = _gl.createShader(type);
        _gl.shaderSource(s, src);
        _gl.compileShader(s);
        if (!_gl.getShaderParameter(s, _gl.COMPILE_STATUS)) {
          console.error('[Tile GL] Shader compile error:', _gl.getShaderInfoLog(s));
          return null;
        }
        return s;
      }

      const vs = compileShader(_gl.VERTEX_SHADER, VS_SOURCE);
      const fs = compileShader(_gl.FRAGMENT_SHADER, FS_SOURCE);
      if (!vs || !fs) {
        _glFailed = true;
        return false;
      }

      const prog = _gl.createProgram();
      _gl.attachShader(prog, vs);
      _gl.attachShader(prog, fs);
      _gl.linkProgram(prog);
      if (!_gl.getProgramParameter(prog, _gl.LINK_STATUS)) {
        console.error('[Tile GL] Link error:', _gl.getProgramInfoLog(prog));
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        image: _gl.getUniformLocation(prog, 'u_image'),
        resolution: _gl.getUniformLocation(prog, 'u_resolution'),
        origin: _gl.getUniformLocation(prog, 'u_origin'),
        tileSize: _gl.getUniformLocation(prog, 'u_tileSize'),
        mirror: _gl.getUniformLocation(prog, 'u_mirror')
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

      _posBuf = _gl.createBuffer();
      _gl.bindBuffer(_gl.ARRAY_BUFFER, _posBuf);
      _gl.bufferData(_gl.ARRAY_BUFFER, positions, _gl.STATIC_DRAW);

      _uvBuf = _gl.createBuffer();
      _gl.bindBuffer(_gl.ARRAY_BUFFER, _uvBuf);
      _gl.bufferData(_gl.ARRAY_BUFFER, texCoords, _gl.STATIC_DRAW);

      _glTex = _gl.createTexture();
      _gl.bindTexture(_gl.TEXTURE_2D, _glTex);
      _gl.texParameteri(_gl.TEXTURE_2D, _gl.TEXTURE_WRAP_S, _gl.CLAMP_TO_EDGE);
      _gl.texParameteri(_gl.TEXTURE_2D, _gl.TEXTURE_WRAP_T, _gl.CLAMP_TO_EDGE);
      _gl.texParameteri(_gl.TEXTURE_2D, _gl.TEXTURE_MIN_FILTER, _gl.LINEAR);
      _gl.texParameteri(_gl.TEXTURE_2D, _gl.TEXTURE_MAG_FILTER, _gl.LINEAR);

      _gl.disable(_gl.DEPTH_TEST);
      _gl.disable(_gl.BLEND);

      return true;
    } catch (e) {
      console.warn('[Tile GL] WebGL initialization failed, fallback active:', e);
      _glFailed = true;
      return false;
    }
  }

  function uploadSource(gl, el, w, h) {
    gl.bindTexture(gl.TEXTURE_2D, _glTex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      return true;
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
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  function renderTileWebGL(ctx, el, layer, bounds, fx) {
    if (!ctx || !el) return false;
    if (_glFailed || !initWebGL()) return false;

    const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
    const by = bounds && bounds.y !== undefined ? bounds.y : 0;
    const bw = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
    const bh = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

    const isMirror = !(fx && (fx.mirror === 0 || fx.mirror === false || fx.mirror === '0' || fx.mirror === 'false' || fx.mirror === 'off'));
    const scale = Math.max(5, (fx && fx.scale !== undefined ? Number(fx.scale) : 100)) / 100;
    const tw = Math.max(1, bw * scale);
    const th = Math.max(1, bh * scale);

    const offX = (((fx && fx.offsetX !== undefined ? Number(fx.offsetX) : 0)) / 100) * tw;
    const offY = (((fx && fx.offsetY !== undefined ? Number(fx.offsetY) : 0)) / 100) * th;

    // Fast-path: Identity 100% scale without offset or mirror
    if (Math.abs(scale - 1.0) < 0.001 && Math.abs(offX) < 0.01 && Math.abs(offY) < 0.01) {
      try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
      return true;
    }

    try {
      const gl = _gl;
      if (_glCanvas.width !== bw || _glCanvas.height !== bh) {
        _glCanvas.width = bw;
        _glCanvas.height = bh;
      }

      if (!uploadSource(gl, el, bw, bh)) return false;

      gl.viewport(0, 0, bw, bh);
      gl.useProgram(_glProg);

      const posLoc = gl.getAttribLocation(_glProg, 'a_pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      const uvLoc = gl.getAttribLocation(_glProg, 'a_uv');
      gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, _glTex);

      // Centered coordinate mapping
      const originX = (bw * 0.5) - (tw * 0.5) + offX;
      const originY = (bh * 0.5) - (th * 0.5) + offY;

      gl.uniform1i(_glUniforms.image, 0);
      gl.uniform2f(_glUniforms.resolution, bw, bh);
      gl.uniform2f(_glUniforms.origin, originX, originY);
      gl.uniform2f(_glUniforms.tileSize, tw, th);
      gl.uniform1i(_glUniforms.mirror, isMirror ? 1 : 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      ctx.drawImage(_glCanvas, bx, by, bw, bh);
      return true;
    } catch (err) {
      console.warn('[Tile GL] Render failed, falling back:', err);
      return false;
    }
  }

  reg.registerBackend('tile', 'wgl', {
    render: renderTileWebGL
  });
})(typeof window !== 'undefined' ? window : this);
