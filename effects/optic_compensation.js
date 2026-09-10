(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // WebGL hardware acceleration pipeline state cached at module level
  let _glCanvas = null;
  let _gl = null;
  let _glProg = null;
  let _glUniforms = null;
  let _posBuf = null;
  let _uvBuf = null;
  let _glTex = null;
  let _lastEl = null;
  let _lastSrc = '';
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
    'uniform float u_k1;',
    'uniform float u_k2;',
    'uniform int u_reverse;',
    'uniform float u_aspect;',
    'uniform vec2 u_center;',
    '',
    '// Invert Brown-Conrady radial distortion: solves x * (1.0 + k1*x^2 + k2*x^4) = r for x >= 0',
    'float invertDistortion(float r_val, float k1, float k2) {',
    '  if (r_val <= 0.0001) return r_val;',
    '  float x = r_val / (1.0 + k1 * r_val * r_val);',
    '  for (int i = 0; i < 7; i++) {',
    '    float x2 = x * x;',
    '    float x4 = x2 * x2;',
    '    float f = x * (1.0 + k1 * x2 + k2 * x4) - r_val;',
    '    float f_prime = 1.0 + 3.0 * k1 * x2 + 5.0 * k2 * x4;',
    '    x = max(0.0, x - f / max(f_prime, 0.0001));',
    '  }',
    '  return x;',
    '}',
    '',
    'void main(void) {',
    '  // 1. Convert destination UV [0, 1] to centered coordinates [-1, 1]',
    '  vec2 p = v_uv * 2.0 - 1.0;',
    '',
    '  // 2. Offset by optical center position [-1, 1]',
    '  vec2 d = p - u_center;',
    '',
    '  // 3. Calculate isotropic radius r from center normalized by frame diagonal',
    '  float diag = sqrt(u_aspect * u_aspect + 1.0);',
    '  vec2 d_aspect = vec2(d.x * u_aspect, d.y);',
    '  float r = length(d_aspect) / diag;',
    '',
    '  if (r > 0.00001) {',
    '    float r_sample;',
    '    if (u_reverse == 1) {',
    '      // 6. If reverseLensDistortion, invert distortion via iterative Newton-Raphson',
    '      r_sample = invertDistortion(r, u_k1, u_k2);',
    '    } else {',
    '      // 4. Apply Brown-Conrady radial distortion: r_distorted = r * (1 + k1*r^2 + k2*r^4)',
    '      float r2 = r * r;',
    '      float r4 = r2 * r2;',
    '      r_sample = r * (1.0 + u_k1 * r2 + u_k2 * r4);',
    '    }',
    '',
    '    float scale = r_sample / r;',
    '    p = u_center + d * scale;',
    '  }',
    '',
    '  // 7. Map corrected centered coordinates back to texture UV [0, 1]',
    '  vec2 uv_sample = p * 0.5 + 0.5;',
    '',
    '  // 8. Out-of-bounds = transparent',
    '  if (uv_sample.x < 0.0 || uv_sample.x > 1.0 || uv_sample.y < 0.0 || uv_sample.y > 1.0) {',
    '    gl_FragColor = vec4(0.0);',
    '  } else {',
    '    gl_FragColor = texture2D(u_image, uv_sample);',
    '  }',
    '}'
  ].join('\n');

  function initWebGL() {
    if (typeof document === 'undefined') return false;
    if (_gl && _gl.isContextLost && _gl.isContextLost()) {
      _gl = null;
      _glProg = null;
      _glFailed = false;
    }
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
        antialias: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false
      };
      _gl = _glCanvas.getContext('webgl', opts) || _glCanvas.getContext('experimental-webgl', opts);
      if (!_gl) {
        _glFailed = true;
        return false;
      }

      function compileShader(type, src) {
        const s = _gl.createShader(type);
        _gl.shaderSource(s, src);
        _gl.compileShader(s);
        if (!_gl.getShaderParameter(s, _gl.COMPILE_STATUS)) {
          console.error('Optic Compensation GL Shader Error:', _gl.getShaderInfoLog(s));
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
        console.error('Optic Compensation GL Link Error:', _gl.getProgramInfoLog(prog));
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        image: _gl.getUniformLocation(prog, 'u_image'),
        k1: _gl.getUniformLocation(prog, 'u_k1'),
        k2: _gl.getUniformLocation(prog, 'u_k2'),
        reverse: _gl.getUniformLocation(prog, 'u_reverse'),
        aspect: _gl.getUniformLocation(prog, 'u_aspect'),
        center: _gl.getUniformLocation(prog, 'u_center')
      };

      // Fullscreen quad: [-1, 1] clip space and [0, 1] texture UV
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
      _gl.enable(_gl.BLEND);
      _gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

      return true;
    } catch (e) {
      console.warn('Optic Compensation WebGL initialization failed, fallback active:', e);
      _glFailed = true;
      return false;
    }
  }

  function hasValidDimensions(el) {
    if (!el) return false;
    if (el.tagName === 'VIDEO') {
      return el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0;
    }
    if (el.tagName === 'IMG') {
      return el.complete && el.naturalWidth > 0 && el.naturalHeight > 0;
    }
    if (typeof el.width === 'number' && typeof el.height === 'number') {
      return el.width > 0 && el.height > 0;
    }
    return true;
  }

  // Derive Brown-Conrady coefficients k1 and k2 from FOV and focal length
  function deriveDistortionCoefficients(fov, focalLength) {
    const fovClamped = Math.max(10, Math.min(170, fov));
    const focalClamped = Math.max(10, Math.min(200, focalLength));
    const halfFovRad = (fovClamped * Math.PI / 180) * 0.5;
    const focalScale = 50.0 / focalClamped;

    // Optical polynomial coefficients derived from rectilinear tan(theta) expansion
    const k1 = 0.65 * (halfFovRad * halfFovRad) * focalScale;
    const k2 = 0.35 * Math.pow(halfFovRad, 4) * (focalScale * focalScale);
    return { k1, k2 };
  }

  function renderWebGL(ctx, el, bounds, fx) {
    if (!initWebGL()) return false;
    if (!hasValidDimensions(el)) return false;

    const gl = _gl;
    const x = bounds && bounds.x !== undefined ? bounds.x : 0;
    const y = bounds && bounds.y !== undefined ? bounds.y : 0;
    const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
    const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

    if (_glCanvas.width !== w || _glCanvas.height !== h) {
      _glCanvas.width = w;
      _glCanvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(_glProg);

    const aPos = gl.getAttribLocation(_glProg, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const aUv = gl.getAttribLocation(_glProg, 'a_uv');
    gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, _glTex);

    const isStaticImg = (el.tagName === 'IMG');
    const src = el.src || '';
    if (!isStaticImg || _lastEl !== el || _lastSrc !== src) {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        _lastEl = el;
        _lastSrc = src;
      } catch (err) {
        return false;
      }
    }

    const fov = fx && fx.fov !== undefined ? Number(fx.fov) : 90;
    const reverse = (fx && (fx.reverseLensDistortion === 1 || fx.reverseLensDistortion === true || fx.reverseLensDistortion === '1')) ? 1 : 0;
    const focalLength = fx && fx.focalLength !== undefined ? Number(fx.focalLength) : 50;
    const centerX = fx && fx.centerX !== undefined ? Number(fx.centerX) : 0;
    const centerY = fx && fx.centerY !== undefined ? Number(fx.centerY) : 0;

    const { k1, k2 } = deriveDistortionCoefficients(fov, focalLength);
    const aspect = w / h;
    const cxNorm = Math.max(-1.0, Math.min(1.0, centerX / 100.0));
    const cyNorm = Math.max(-1.0, Math.min(1.0, centerY / 100.0));

    gl.uniform1i(_glUniforms.image, 0);
    gl.uniform1f(_glUniforms.k1, k1);
    gl.uniform1f(_glUniforms.k2, k2);
    gl.uniform1i(_glUniforms.reverse, reverse);
    gl.uniform1f(_glUniforms.aspect, aspect);
    gl.uniform2f(_glUniforms.center, cxNorm, cyNorm);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    try {
      ctx.drawImage(_glCanvas, 0, 0, w, h, x, y, w, h);
      return true;
    } catch (_) {
      return false;
    }
  }

  // JS Newton-Raphson inverse for Brown-Conrady model
  function invertDistortionJS(rVal, k1, k2) {
    if (rVal <= 0.0001) return rVal;
    let x = rVal / (1.0 + k1 * rVal * rVal);
    for (let i = 0; i < 7; i++) {
      const x2 = x * x;
      const x4 = x2 * x2;
      const f = x * (1.0 + k1 * x2 + k2 * x4) - rVal;
      const fPrime = 1.0 + 3.0 * k1 * x2 + 5.0 * k2 * x4;
      x = Math.max(0, x - f / Math.max(fPrime, 1e-6));
    }
    return x;
  }

  // Forward vertex displacement for 2D Mesh Fallback
  function forwardOpticVertex(px, py, k1, k2, reverse, aspect, cx, cy) {
    const diag = Math.sqrt(aspect * aspect + 1.0);
    const dx = px - cx;
    const dy = py - cy;
    const r = Math.sqrt((dx * aspect) * (dx * aspect) + dy * dy) / diag;
    if (r < 1e-6) return { x: px, y: py };

    let rDest;
    if (reverse) {
      // In reverse mode: WebGL uses invertDistortion for sample lookup,
      // so forward mesh vertex displacement applies direct polynomial
      rDest = r * (1.0 + k1 * r * r + k2 * r * r * r * r);
    } else {
      // In forward mode: WebGL uses direct polynomial for sample lookup,
      // so forward mesh vertex displacement applies inverse
      rDest = invertDistortionJS(r, k1, k2);
    }

    const scale = rDest / r;
    return {
      x: cx + dx * scale,
      y: cy + dy * scale
    };
  }

  function drawTexturedTriangle(ctx, img, sx0, sy0, sx1, sy1, sx2, sy2, dx0, dy0, dx1, dy1, dx2, dy2) {
    const denom = (sx0 * (sy1 - sy2) - sx1 * (sy0 - sy2) + sx2 * (sy0 - sy1));
    if (Math.abs(denom) < 1e-6) return;

    const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / denom;
    const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / denom;
    const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / denom;

    const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / denom;
    const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / denom;
    const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / denom;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dx0, dy0);
    ctx.lineTo(dx1, dy1);
    ctx.lineTo(dx2, dy2);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // 2D Mesh Fallback (Runs if WebGL is unavailable or fails)
  function renderCanvasMeshFallback(ctx, el, bounds, fx) {
    const x = bounds && bounds.x !== undefined ? bounds.x : 0;
    const y = bounds && bounds.y !== undefined ? bounds.y : 0;
    const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
    const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

    const fov = fx && fx.fov !== undefined ? Number(fx.fov) : 90;
    const reverse = fx && (fx.reverseLensDistortion === 1 || fx.reverseLensDistortion === true || fx.reverseLensDistortion === '1');
    const focalLength = fx && fx.focalLength !== undefined ? Number(fx.focalLength) : 50;
    const centerX = fx && fx.centerX !== undefined ? Number(fx.centerX) : 0;
    const centerY = fx && fx.centerY !== undefined ? Number(fx.centerY) : 0;

    const { k1, k2 } = deriveDistortionCoefficients(fov, focalLength);
    const aspect = w / h;
    const cxNorm = Math.max(-1.0, Math.min(1.0, centerX / 100.0));
    const cyNorm = Math.max(-1.0, Math.min(1.0, centerY / 100.0));

    const srcW = el.naturalWidth || el.videoWidth || el.width || w;
    const srcH = el.naturalHeight || el.videoHeight || el.height || h;

    const gridX = 20;
    const gridY = 20;

    // Compute deformed vertex mesh
    const pts = [];
    for (let j = 0; j <= gridY; j++) {
      pts[j] = [];
      const v = j / gridY;
      const py = v * 2.0 - 1.0;
      for (let i = 0; i <= gridX; i++) {
        const u = i / gridX;
        const px = u * 2.0 - 1.0;
        const warped = forwardOpticVertex(px, py, k1, k2, reverse, aspect, cxNorm, cyNorm);
        const dx = x + (warped.x * 0.5 + 0.5) * w;
        const dy = y + (warped.y * 0.5 + 0.5) * h;
        const sx = u * srcW;
        const sy = v * srcH;
        pts[j][i] = { dx, dy, sx, sy };
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // Render quads as pairs of textured triangles
    for (let j = 0; j < gridY; j++) {
      for (let i = 0; i < gridX; i++) {
        const p00 = pts[j][i];
        const p10 = pts[j][i + 1];
        const p01 = pts[j + 1][i];
        const p11 = pts[j + 1][i + 1];

        // Triangle 1: p00 - p10 - p01
        drawTexturedTriangle(
          ctx, el,
          p00.sx, p00.sy, p10.sx, p10.sy, p01.sx, p01.sy,
          p00.dx, p00.dy, p10.dx, p10.dy, p01.dx, p01.dy
        );

        // Triangle 2: p10 - p11 - p01
        drawTexturedTriangle(
          ctx, el,
          p10.sx, p10.sy, p11.sx, p11.sy, p01.sx, p01.sy,
          p10.dx, p10.dy, p11.dx, p11.dy, p01.dx, p01.dy
        );
      }
    }

    ctx.restore();
  }

  reg.register({
    id: 'optic-compensation',
    name: 'Optic Compensation',
    category: 'warp',
    icon: 'assets/FXPH.svg',
    description: 'Barrel and pincushion lens distortion correction like After Effects Optics Compensation',
    params: [
      { id: 'fov', label: 'Field of View', type: 'number', min: 10, max: 170, default: 90, unit: '°' },
      { id: 'reverseLensDistortion', label: 'Reverse Lens Distortion', type: 'switch', default: 0 },
      { id: 'focalLength', label: 'Focal Length', type: 'number', min: 10, max: 200, default: 50, unit: 'mm' },
      { id: 'centerX', label: 'Center X', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'centerY', label: 'Center Y', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      // Fast Path 1: GPU WebGL Hardware Acceleration
      if (renderWebGL(ctx, el, bounds, fx)) {
        return;
      }

      // Fallback Path 2: 2D Mesh Fallback
      try {
        renderCanvasMeshFallback(ctx, el, bounds, fx);
      } catch (err) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      }
    }
  });
})(typeof window !== 'undefined' ? window : this);
