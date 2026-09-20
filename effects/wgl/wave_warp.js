(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // Hardware WebGL Pipeline for Wave Warp
  // Single-pass analytical fragment shader + In-GPU FBO multi-pass ping-pong
  let _glCanvas = null;
  let _gl = null;
  let _glProg = null;
  let _glUniforms = null;
  let _posBuf = null;
  let _uvBuf = null;
  let _texSource = null;
  let _tex0 = null;
  let _tex1 = null;
  let _fbo = null;
  let _texWidth = 0;
  let _texHeight = 0;
  let _scratchCanvas = null;
  let _scratchCtx = null;
  let _glFailed = false;

  function initWaveGL() {
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
        '',
        'uniform sampler2D u_image;',
        'uniform vec2 u_resolution;',
        'uniform float u_waveHeight;',
        'uniform float u_invWidth;',
        'uniform vec2 u_dirVec;',
        'uniform float u_phaseRad;',
        'uniform int u_waveType;',
        'uniform int u_tile;',
        '',
        'float pseudoNoise1D(float k) {',
        '  float s = sin(k * 127.1 + 311.7) * 43758.5453123;',
        '  return fract(s) * 2.0 - 1.0;',
        '}',
        '',
        'float smoothNoise1D(float u) {',
        '  float i0 = floor(u);',
        '  float f = fract(u);',
        '  float q = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
        '  float a = pseudoNoise1D(i0);',
        '  float b = pseudoNoise1D(i0 + 1.0);',
        '  return a + (b - a) * q;',
        '}',
        '',
        'float getWaveVal(float dist, float invWidth, float phase, int wType) {',
        '  float p = dist * invWidth + phase;',
        '  if (wType == 1) {', // triangle
        '    float s = clamp(sin(p), -1.0, 1.0);',
        '    return asin(s) * 0.63661977236;',
        '  } else if (wType == 2) {', // square
        '    return sin(p) >= 0.0 ? 1.0 : -1.0;',
        '  } else if (wType == 3) {', // sawtooth
        '    float norm = fract(p * 0.15915494309);',
        '    return norm * 2.0 - 1.0;',
        '  } else if (wType == 4) {', // circle
        '    float norm = fract(p * 0.15915494309);',
        '    float d = (norm - 0.5) * 2.0;',
        '    return sqrt(max(0.0, 1.0 - d * d)) * 2.0 - 1.0;',
        '  } else if (wType == 5) {', // semicircle
        '    float norm = fract(p * 0.15915494309);',
        '    float d = (norm - 0.5) * 2.0;',
        '    return sqrt(max(0.0, 1.0 - d * d));',
        '  } else if (wType == 6) {', // noise
        '    float cycle = p * 0.15915494309;',
        '    return pseudoNoise1D(floor(cycle));',
        '  } else if (wType == 7) {', // smooth-noise
        '    float cycle = p * 0.15915494309;',
        '    return smoothNoise1D(cycle);',
        '  }',
        '  return sin(p);', // 0: sine
        '}',
        '',
        'vec2 mirrorUV(vec2 uv) {',
        '  vec2 m = mod(uv, 2.0);',
        '  if (m.x < 0.0) m.x += 2.0;',
        '  if (m.y < 0.0) m.y += 2.0;',
        '  vec2 f = mix(m, 2.0 - m, step(1.0, m));',
        '  return clamp(f, 0.0005, 0.9995);',
        '}',
        '',
        'void main(void) {',
        '  vec2 pixelPos = v_uv * u_resolution;',
        '  vec2 center = u_resolution * 0.5;',
        '  vec2 p = pixelPos - center;',
        '',
        '  float dist = dot(p, u_dirVec);',
        '  float wave = getWaveVal(dist, u_invWidth, u_phaseRad, u_waveType);',
        '  float dy = wave * u_waveHeight;',
        '',
        '  vec2 srcPixel = pixelPos + vec2(dy * u_dirVec.y, -dy * u_dirVec.x);',
        '  vec2 srcUV = srcPixel / u_resolution;',
        '',
        '  if (u_tile == 1) {',
        '    srcUV = mirrorUV(srcUV);',
        '    gl_FragColor = texture2D(u_image, srcUV);',
        '  } else {',
        '    if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {',
        '      gl_FragColor = vec4(0.0);',
        '    } else {',
        '      gl_FragColor = texture2D(u_image, srcUV);',
        '    }',
        '  }',
        '}'
      ].join('\n');

      function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error('[WaveWarp GL] Shader compile error:', gl.getShaderInfoLog(s));
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
        console.error('[WaveWarp GL] Program link error:', gl.getProgramInfoLog(prog));
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        image: gl.getUniformLocation(prog, 'u_image'),
        resolution: gl.getUniformLocation(prog, 'u_resolution'),
        waveHeight: gl.getUniformLocation(prog, 'u_waveHeight'),
        invWidth: gl.getUniformLocation(prog, 'u_invWidth'),
        dirVec: gl.getUniformLocation(prog, 'u_dirVec'),
        phaseRad: gl.getUniformLocation(prog, 'u_phaseRad'),
        waveType: gl.getUniformLocation(prog, 'u_waveType'),
        tile: gl.getUniformLocation(prog, 'u_tile')
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

      function createTex() {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return tex;
      }

      _texSource = createTex();
      _tex0 = createTex();
      _tex1 = createTex();
      _fbo = gl.createFramebuffer();

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      return true;
    } catch (e) {
      console.warn('[WaveWarp GL] WebGL init failed, will use Canvas2D fallback:', e);
      _glFailed = true;
      return false;
    }
  }

  function ensureTextureStorage(gl, rw, rh) {
    if (_texWidth !== rw || _texHeight !== rh) {
      gl.bindTexture(gl.TEXTURE_2D, _tex0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, _tex1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      _texWidth = rw;
      _texHeight = rh;
    }
  }

  function uploadToTexSource(gl, el) {
    gl.bindTexture(gl.TEXTURE_2D, _texSource);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      return true;
    } catch (_) {
      if (!_scratchCanvas) {
        _scratchCanvas = document.createElement('canvas');
        _scratchCtx = _scratchCanvas.getContext('2d');
      }
      const sw = Math.min(1920, el.videoWidth || el.naturalWidth || el.width || 100);
      const sh = Math.min(1080, el.videoHeight || el.naturalHeight || el.height || 100);
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

  function setWaveUniforms(gl, u, fx, rw, rh, w, layer, currentSec) {
    const height = fx && fx.waveHeight !== undefined ? fx.waveHeight : 25;
    const width = Math.max(10, fx && fx.waveWidth !== undefined ? fx.waveWidth : 120);
    const baseRefW = Math.abs((layer && layer.scaleW) || (layer && layer.mediaWidth) || w);
    const bufferScale = baseRefW > 0 ? (w / baseRefW) : 1;
    const effectiveHeight = height * bufferScale;
    const effectiveWidth = Math.max(1, width * bufferScale);

    const rawType = (fx && fx.waveType ? String(fx.waveType) : 'sine').toLowerCase().replace(/[\s_]+/g, '-');
    const dirDeg = fx && fx.direction !== undefined ? fx.direction : 0;
    const speed = fx && fx.speed !== undefined ? fx.speed : 1;
    const phaseDeg = fx && fx.phase !== undefined ? fx.phase : 0;

    let curSec = 0;
    if (typeof currentSec === 'number' && !isNaN(currentSec)) curSec = currentSec;
    else if (layer && typeof layer._currentSec === 'number') curSec = layer._currentSec;
    else if (typeof window !== 'undefined') {
      if (typeof window._currentRenderSec === 'number' && !isNaN(window._currentRenderSec)) curSec = window._currentRenderSec;
      else if (typeof window.currentPlaybackSec === 'number') curSec = window.currentPlaybackSec;
      else if (typeof window.currentSec === 'number') curSec = window.currentSec;
      else if (typeof window.getCurrentPlayheadTime === 'function') curSec = window.getCurrentPlayheadTime();
      else if (window.currentFrame !== undefined && window.currentFps) curSec = window.currentFrame / window.currentFps;
      else if (window.timelinePanX !== undefined) curSec = Math.abs(window.timelinePanX) / (window.currentPixelsPerSecond || 80);
    }
    const layerStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
    const sourceOffset = (layer && layer.sourceOffsetSec !== undefined) ? layer.sourceOffsetSec : 0;
    const t = curSec - (layerStart - sourceOffset);

    const phaseRad = (phaseDeg * Math.PI / 180) - (t * speed * Math.PI * 2);
    const dirRad = (dirDeg * Math.PI) / 180;
    const isTile = !!(fx && (fx.tile === 1 || fx.tile === true || fx.tile === '1' || fx.tile === 'true' || fx.tile === 'on'));

    let typeInt = 0; // sine
    if (rawType === 'triangle') typeInt = 1;
    else if (rawType === 'square') typeInt = 2;
    else if (rawType === 'sawtooth') typeInt = 3;
    else if (rawType === 'circle') typeInt = 4;
    else if (rawType === 'semicircle' || rawType === 'semi-circle') typeInt = 5;
    else if (rawType === 'noise') typeInt = 6;
    else if (rawType === 'smooth-noise' || rawType === 'smoothnoise' || rawType === 'noisesmooth' || rawType === 'noise-smooth') typeInt = 7;

    const invWidth = (Math.PI * 2) / effectiveWidth;
    const dirCos = Math.cos(dirRad);
    const dirSin = Math.sin(dirRad);

    gl.uniform1i(u.image, 0);
    gl.uniform2f(u.resolution, rw, rh);
    gl.uniform1f(u.waveHeight, effectiveHeight);
    gl.uniform1f(u.invWidth, invWidth);
    gl.uniform2f(u.dirVec, dirCos, dirSin);
    gl.uniform1f(u.phaseRad, phaseRad);
    gl.uniform1i(u.waveType, typeInt);
    gl.uniform1i(u.tile, isTile ? 1 : 0);
  }

  function renderWaveWarpBatch(ctx, el, layer, bounds, fxArray, currentSec) {
    if (!ctx || !el || !Array.isArray(fxArray) || fxArray.length === 0) return false;
    const activeFx = fxArray.filter(f => f && !f.disabled && Math.abs(f.waveHeight !== undefined ? f.waveHeight : 25) >= 0.05);
    const x = bounds && bounds.x !== undefined ? bounds.x : 0;
    const y = bounds && bounds.y !== undefined ? bounds.y : 0;
    const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
    const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

    if (activeFx.length === 0) {
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      return true;
    }

    if (!_glFailed && initWaveGL()) {
      try {
        const gl = _gl;
        const prog = _glProg;
        const u = _glUniforms;
        const rw = Math.max(1, Math.round(w));
        const rh = Math.max(1, Math.round(h));

        if (_glCanvas.width !== rw || _glCanvas.height !== rh) {
          _glCanvas.width = rw;
          _glCanvas.height = rh;
        }

        if (!uploadToTexSource(gl, el)) return false;

        gl.viewport(0, 0, rw, rh);
        gl.useProgram(prog);

        const posLoc = gl.getAttribLocation(prog, 'a_pos');
        gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const uvLoc = gl.getAttribLocation(prog, 'a_uv');
        gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

        const passCount = activeFx.length;
        if (passCount > 1) {
          ensureTextureStorage(gl, rw, rh);
        }

        for (let i = 0; i < passCount; i++) {
          const isLast = (i === passCount - 1);
          let readTex;
          let writeTex;

          if (i === 0) {
            readTex = _texSource;
            writeTex = isLast ? null : _tex0;
          } else {
            readTex = (i % 2 === 1) ? _tex0 : _tex1;
            writeTex = isLast ? null : ((i % 2 === 1) ? _tex1 : _tex0);
          }

          if (writeTex === null) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, _fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, writeTex, 0);
          }

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, readTex);

          setWaveUniforms(gl, u, activeFx[i], rw, rh, w, layer, currentSec);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        ctx.drawImage(_glCanvas, x, y, w, h);
        return true;
      } catch (err) {
        console.warn('[WaveWarp GL Batch] WebGL render failed:', err);
      }
    }
    return false;
  }

  // Reusable offscreen buffer for Canvas2D fallback
  let _waveBuf = null;
  let _waveBufCtx = null;

  function getWaveBuffer(w, h) {
    if (typeof document === 'undefined') return null;
    if (!_waveBuf) {
      _waveBuf = document.createElement('canvas');
      _waveBufCtx = _waveBuf.getContext('2d');
    }
    const rw = Math.max(1, Math.ceil(w));
    const rh = Math.max(1, Math.ceil(h));
    if (_waveBuf.width !== rw || _waveBuf.height !== rh) {
      _waveBuf.width = rw;
      _waveBuf.height = rh;
    }
    return { canvas: _waveBuf, ctx: _waveBufCtx };
  }

  function renderWaveWarp(ctx, el, layer, bounds, fx, currentSec) {
    if (!ctx || !el) return;
    if (renderWaveWarpBatch(ctx, el, layer, bounds, [fx], currentSec)) {
      return;
    }

    // =========================================================================
    // FALLBACK: Canvas2D Strip Slicing with Solid Overlap
    // =========================================================================
    const x = bounds && bounds.x !== undefined ? bounds.x : 0;
    const y = bounds && bounds.y !== undefined ? bounds.y : 0;
    const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
    const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

    const height = fx && fx.waveHeight !== undefined ? fx.waveHeight : 25;
    if (Math.abs(height) < 0.05) {
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      return;
    }

    const width = Math.max(10, fx && fx.waveWidth !== undefined ? fx.waveWidth : 120);
    const baseRefW = Math.abs((layer && layer.scaleW) || (layer && layer.mediaWidth) || w);
    const bufferScale = baseRefW > 0 ? (w / baseRefW) : 1;
    const effectiveHeight = height * bufferScale;

    const rawType = (fx && fx.waveType ? String(fx.waveType) : 'sine').toLowerCase().replace(/[\s_]+/g, '-');
    const dirDeg = fx && fx.direction !== undefined ? fx.direction : 0;
    const speed = fx && fx.speed !== undefined ? fx.speed : 1;
    const phaseDeg = fx && fx.phase !== undefined ? fx.phase : 0;

    let curSec = 0;
    if (typeof currentSec === 'number' && !isNaN(currentSec)) curSec = currentSec;
    else if (layer && typeof layer._currentSec === 'number') curSec = layer._currentSec;
    const layerStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
    const sourceOffset = (layer && layer.sourceOffsetSec !== undefined) ? layer.sourceOffsetSec : 0;
    const t = curSec - (layerStart - sourceOffset);
    const phaseRad = (phaseDeg * Math.PI / 180) - (t * speed * Math.PI * 2);
    const dirRad = (dirDeg * Math.PI) / 180;
    const isTile = !!(fx && (fx.tile === 1 || fx.tile === true || fx.tile === '1' || fx.tile === 'true' || fx.tile === 'on'));

    function pseudoNoise1D(k) {
      const s = Math.sin(k * 127.1 + 311.7) * 43758.5453123;
      return (s - Math.floor(s)) * 2 - 1;
    }

    function smoothNoise1D(u) {
      const i0 = Math.floor(u);
      const f = u - i0;
      const q = f * f * f * (f * (f * 6 - 15) + 10);
      const a = pseudoNoise1D(i0);
      const b = pseudoNoise1D(i0 + 1);
      return a + (b - a) * q;
    }

    function getWave(val) {
      const p = (val / width) * Math.PI * 2 + phaseRad;
      if (rawType === 'triangle') {
        const s = Math.max(-1, Math.min(1, Math.sin(p)));
        return Math.asin(s) * (2 / Math.PI);
      } else if (rawType === 'square') {
        return Math.sin(p) >= 0 ? 1 : -1;
      } else if (rawType === 'sawtooth') {
        const norm = ((p / (Math.PI * 2)) % 1 + 1) % 1;
        return norm * 2 - 1;
      } else if (rawType === 'circle') {
        const norm = ((p / (Math.PI * 2)) % 1 + 1) % 1;
        return Math.sqrt(Math.max(0, 1 - Math.pow((norm - 0.5) * 2, 2))) * 2 - 1;
      } else if (rawType === 'semicircle' || rawType === 'semi-circle') {
        const norm = ((p / (Math.PI * 2)) % 1 + 1) % 1;
        return Math.sqrt(Math.max(0, 1 - Math.pow((norm - 0.5) * 2, 2)));
      } else if (rawType === 'noise') {
        const cycle = p / (Math.PI * 2);
        return pseudoNoise1D(Math.floor(cycle));
      } else if (rawType === 'smooth-noise' || rawType === 'smoothnoise' || rawType === 'noisesmooth' || rawType === 'noise-smooth') {
        const cycle = p / (Math.PI * 2);
        return smoothNoise1D(cycle);
      }
      return Math.sin(p);
    }

    const cosA = Math.abs(Math.cos(dirRad));
    const sinA = Math.abs(Math.sin(dirRad));
    const spanW = Math.ceil(w * cosA + h * sinA);
    const spanH = Math.ceil(w * sinA + h * cosA);

    const padY = Math.ceil(Math.abs(effectiveHeight) * 2) + (isTile ? 24 : 4);
    const totalW = Math.ceil(spanW + (isTile ? padY * 2 : 4));
    const totalH = Math.ceil(spanH + padY * 2);

    const buf = getWaveBuffer(totalW, totalH);
    if (!buf || !buf.ctx) {
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      return;
    }

    const bCanvas = buf.canvas;
    const bCtx = buf.ctx;

    bCtx.clearRect(0, 0, totalW, totalH);
    bCtx.save();
    bCtx.imageSmoothingEnabled = true;
    bCtx.imageSmoothingQuality = 'high';
    const halfTotalW = Math.round(totalW / 2);
    const halfTotalH = Math.round(totalH / 2);
    bCtx.translate(halfTotalW, halfTotalH);
    bCtx.rotate(-dirRad);

    const halfW = Math.round(w / 2);
    const halfH = Math.round(h / 2);

    try {
      if (!isTile) {
        bCtx.drawImage(el, -halfW, -halfH, w, h);
      } else {
        const maxDim = Math.max(totalW, totalH);
        const rangeX = Math.max(1, Math.ceil(maxDim / w));
        const rangeY = Math.max(1, Math.ceil(maxDim / h));

        for (let j = -rangeY; j <= rangeY; j++) {
          for (let i = -rangeX; i <= rangeX; i++) {
            const flipX = (Math.abs(i) % 2 === 1);
            const flipY = (Math.abs(j) % 2 === 1);
            const tx = i * w - halfW;
            const ty = j * h - halfH;

            if (!flipX && !flipY) {
              bCtx.drawImage(el, tx, ty, w, h);
            } else {
              bCtx.save();
              bCtx.translate(tx + (flipX ? w : 0), ty + (flipY ? h : 0));
              bCtx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
              bCtx.drawImage(el, 0, 0, w, h);
              bCtx.restore();
            }
          }
        }
      }
    } catch (_) {
      bCtx.restore();
      try { ctx.drawImage(el, x, y, w, h); } catch (e) {}
      return;
    }
    bCtx.restore();

    const cx = Math.round(x + w / 2);
    const cy = Math.round(y + h / 2);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (isTile) {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    }
    ctx.translate(cx, cy);
    ctx.rotate(dirRad);

    const sliceW = 2;
    const overlap = 1.0;
    const startSx = isTile ? 0 : Math.max(0, Math.floor((totalW - spanW) / 2));
    const endSx = isTile ? totalW : Math.min(totalW, Math.ceil((totalW + spanW) / 2));

    for (let sx = startSx; sx < endSx; sx += sliceW) {
      const sw = Math.min(sliceW, endSx - sx);
      const u = (sx + sw / 2) - halfTotalW;
      const wave = getWave(u);
      const dy = wave * effectiveHeight;

      ctx.drawImage(
        bCanvas,
        sx, 0, sw, totalH,
        sx - halfTotalW, -halfTotalH + dy, sw + overlap, totalH
      );
    }

    ctx.restore();
  }

  reg.register({
    id: 'wave-warp',
    name: 'Wave Warp',
    category: 'warp',
    icon: 'assets/FXPH.svg',
    description: 'After Effects style wave distortion with true 360° arbitrary direction and continuous sine/triangle/square warping',
    isExpanding: true,
    params: [
      { id: 'waveType', label: 'Wave Type', type: 'select', default: 'sine', options: ['sine', 'triangle', 'square', 'sawtooth', 'circle', 'semicircle', 'noise', 'smooth-noise'] },
      { id: 'waveHeight', label: 'Wave Height', type: 'number', min: 0, max: 1000, default: 25, unit: 'px' },
      { id: 'waveWidth', label: 'Wave Width', type: 'number', min: 10, max: 4000, default: 120, unit: 'px' },
      { id: 'direction', label: 'Direction', type: 'number', min: -360, max: 360, default: 0, unit: '°' },
      { id: 'speed', label: 'Wave Speed', type: 'number', min: -10, max: 10, default: 1, step: 0.05, unit: 'x' },
      { id: 'phase', label: 'Phase', type: 'number', min: 0, max: 360, default: 0, unit: '°' },
      { id: 'tile', label: 'Tile', type: 'switch', default: 0 }
    ],
    render: renderWaveWarp,
    renderBatch: renderWaveWarpBatch
  });

  reg.registerBackend('wave-warp', 'wgl', {
    render: renderWaveWarp,
    renderBatch: renderWaveWarpBatch
  });
})(typeof window !== 'undefined' ? window : this);
