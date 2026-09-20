(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // WebGL hardware acceleration pipeline state for Turbulent Displace
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
    '',
    'uniform sampler2D u_image;',
    'uniform vec2 u_resolution;',
    'uniform float u_amount;',
    'uniform float u_size;',
    'uniform vec2 u_offset;',
    'uniform int u_complexity;',
    'uniform float u_evolution;',
    'uniform int u_dispType;',
    'uniform int u_pinning;',
    'uniform int u_tile;',
    '',
    '// Ashima Arts / Stefan Gustavson Simplex 3D Noise Engine',
    'vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }',
    'vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }',
    '',
    'float snoise(vec3 v) {',
    '  const vec2 C = vec2(1.0/6.0, 1.0/3.0);',
    '  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);',
    '',
    '  vec3 i  = floor(v + dot(v, C.yyy));',
    '  vec3 x0 = v - i + dot(i, C.xxx);',
    '',
    '  vec3 g = step(x0.yzx, x0.xyz);',
    '  vec3 l = 1.0 - g;',
    '  vec3 i1 = min(g.xyz, l.zxy);',
    '  vec3 i2 = max(g.xyz, l.zxy);',
    '',
    '  vec3 x1 = x0 - i1 + 1.0 * C.xxx;',
    '  vec3 x2 = x0 - i2 + 2.0 * C.xxx;',
    '  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;',
    '',
    '  i = mod(i, 289.0);',
    '  vec4 p = permute(permute(permute(',
    '             i.z + vec4(0.0, i1.z, i2.z, 1.0))',
    '           + i.y + vec4(0.0, i1.y, i2.y, 1.0))',
    '           + i.x + vec4(0.0, i1.x, i2.x, 1.0));',
    '',
    '  float n_ = 0.142857142857; // 1.0/7.0',
    '  vec3  ns = n_ * D.wyz - D.xzx;',
    '',
    '  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);',
    '',
    '  vec4 x_ = floor(j * ns.z);',
    '  vec4 y_ = floor(j - 7.0 * x_);',
    '',
    '  vec4 x = x_ * ns.x + ns.yyyy;',
    '  vec4 y = y_ * ns.x + ns.yyyy;',
    '  vec4 h = 1.0 - abs(x) - abs(y);',
    '',
    '  vec4 b0 = vec4(x.xy, y.xy);',
    '  vec4 b1 = vec4(x.zw, y.zw);',
    '',
    '  vec4 s0 = floor(b0)*2.0 + 1.0;',
    '  vec4 s1 = floor(b1)*2.0 + 1.0;',
    '  vec4 sh = -step(h, vec4(0.0));',
    '',
    '  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;',
    '  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;',
    '',
    '  vec3 p0 = vec3(a0.xy, h.x);',
    '  vec3 p1 = vec3(a0.zw, h.y);',
    '  vec3 p2 = vec3(a1.xy, h.z);',
    '  vec3 p3 = vec3(a1.zw, h.w);',
    '',
    '  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));',
    '  p0 *= norm.x;',
    '  p1 *= norm.y;',
    '  p2 *= norm.z;',
    '  p3 *= norm.w;',
    '',
    '  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);',
    '  m = m * m;',
    '  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));',
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
    'vec2 getPinningFactor(vec2 uv, int pinning) {',
    '  if (pinning == 0) return vec2(1.0);',
    '  vec2 d = min(uv, 1.0 - uv);',
    '  float margin = 0.08;',
    '  float fx = smoothstep(0.0, margin, d.x);',
    '  float fy = smoothstep(0.0, margin, d.y);',
    '  if (pinning == 1) return vec2(fx * fy);',
    '  if (pinning == 2) return vec2(fx);',
    '  if (pinning == 3) return vec2(fy);',
    '  return vec2(1.0);',
    '}',
    '',
    '// Authentic After Effects Multi-Octave Displacement Engine',
    'vec2 calculateAEDisplacement(vec2 coord, float evo, int octaves, int dispType) {',
    '  vec2 disp = vec2(0.0);',
    '  float amp = 1.0;',
    '  float freq = 1.0;',
    '  float totalAmp = 0.0;',
    '  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);',
    '  vec2 c = coord;',
    '  const vec3 OFFSET_Y = vec3(31.416, 59.265, 17.331);',
    '  const float EPS = 0.015;',
    '',
    '  for (int o = 0; o < 8; o++) {',
    '    if (o >= octaves) break;',
    '    vec3 p1 = vec3(c * freq, evo * 0.15 + float(o) * 1.731);',
    '    vec3 p2 = p1 + OFFSET_Y;',
    '    float n1 = snoise(p1);',
    '    float n2 = snoise(p2);',
    '    vec2 octDisp = vec2(0.0);',
    '',
    '    if (dispType == 0) {',
    '      // 0: Turbulent (continuous ridge folds with no tearing)',
    '      float r1 = abs(n1) * 2.0 - 1.0;',
    '      float r2 = abs(n2) * 2.0 - 1.0;',
    '      octDisp = vec2(r1, r2);',
    '    } else if (dispType == 1) {',
    '      // 1: Turbulent Smoother (pure smooth organic liquid flow)',
    '      octDisp = vec2(n1, n2);',
    '    } else if (dispType == 2) {',
    '      // 2: Bulge (gradient outward displacement with crease)',
    '      float n1_dx = snoise(p1 + vec3(EPS, 0.0, 0.0));',
    '      float n1_dy = snoise(p1 + vec3(0.0, EPS, 0.0));',
    '      vec2 grad = (vec2(n1_dx, n1_dy) - n1) / EPS;',
    '      float r = abs(n1) * 2.0 - 1.0;',
    '      octDisp = clamp(grad * 0.5, -1.5, 1.5) * (0.5 + 0.5 * r);',
    '    } else if (dispType == 3) {',
    '      // 3: Bulge Smoother',
    '      float n1_dx = snoise(p1 + vec3(EPS, 0.0, 0.0));',
    '      float n1_dy = snoise(p1 + vec3(0.0, EPS, 0.0));',
    '      vec2 grad = (vec2(n1_dx, n1_dy) - n1) / EPS;',
    '      octDisp = clamp(grad * 0.5, -1.5, 1.5);',
    '    } else if (dispType == 4) {',
    '      // 4: Twist (creased rotational vortex)',
    '      float n1_dx = snoise(p1 + vec3(EPS, 0.0, 0.0));',
    '      float n1_dy = snoise(p1 + vec3(0.0, EPS, 0.0));',
    '      vec2 grad = (vec2(n1_dx, n1_dy) - n1) / EPS;',
    '      vec2 curl = vec2(grad.y, -grad.x);',
    '      float r = abs(n1) * 2.0 - 1.0;',
    '      octDisp = clamp(curl * 0.5, -1.5, 1.5) * (0.5 + 0.5 * r);',
    '    } else if (dispType == 5) {',
    '      // 5: Twist Smoother',
    '      float n1_dx = snoise(p1 + vec3(EPS, 0.0, 0.0));',
    '      float n1_dy = snoise(p1 + vec3(0.0, EPS, 0.0));',
    '      vec2 grad = (vec2(n1_dx, n1_dy) - n1) / EPS;',
    '      octDisp = clamp(vec2(grad.y, -grad.x) * 0.5, -1.5, 1.5);',
    '    } else if (dispType == 6) {',
    '      // 6: Horizontal Displacement',
    '      octDisp = vec2(abs(n1) * 2.0 - 1.0, 0.0);',
    '    } else if (dispType == 7) {',
    '      // 7: Vertical Displacement',
    '      octDisp = vec2(0.0, abs(n2) * 2.0 - 1.0);',
    '    } else if (dispType == 8) {',
    '      // 8: Cross',
    '      octDisp = vec2(abs(n1) * 2.0 - 1.0, -(abs(n2) * 2.0 - 1.0));',
    '    }',
    '',
    '    disp += octDisp * amp;',
    '    totalAmp += amp;',
    '    amp *= 0.5;',
    '    freq *= 2.0;',
    '    c = rot * c;',
    '  }',
    '',
    '  return disp / max(totalAmp, 0.001);',
    '}',
    '',
    'void main(void) {',
    '  vec2 pixelPos = v_uv * u_resolution;',
    '  vec2 center = u_resolution * 0.5;',
    '  vec2 sampleCoord = (pixelPos - (center + u_offset)) / max(u_size, 1.0);',
    '  vec2 disp = calculateAEDisplacement(sampleCoord, u_evolution, u_complexity, u_dispType);',
    '  vec2 pin = getPinningFactor(v_uv, u_pinning);',
    '  vec2 displacedPixel = pixelPos + (disp * u_amount * pin);',
    '  vec2 srcUV = displacedPixel / u_resolution;',
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

  function initTurbulentGL() {
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

      function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error('[TurbulentDisplace GL] Shader compile error:', gl.getShaderInfoLog(s));
          return null;
        }
        return s;
      }

      const vs = compileShader(gl.VERTEX_SHADER, VS_SOURCE);
      const fs = compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
      if (!vs || !fs) {
        _glFailed = true;
        return false;
      }

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('[TurbulentDisplace GL] Program link error:', gl.getProgramInfoLog(prog));
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        image: gl.getUniformLocation(prog, 'u_image'),
        resolution: gl.getUniformLocation(prog, 'u_resolution'),
        amount: gl.getUniformLocation(prog, 'u_amount'),
        size: gl.getUniformLocation(prog, 'u_size'),
        offset: gl.getUniformLocation(prog, 'u_offset'),
        complexity: gl.getUniformLocation(prog, 'u_complexity'),
        evolution: gl.getUniformLocation(prog, 'u_evolution'),
        dispType: gl.getUniformLocation(prog, 'u_dispType'),
        pinning: gl.getUniformLocation(prog, 'u_pinning'),
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
      console.warn('[TurbulentDisplace GL] WebGL init failed, will use fallback:', e);
      _glFailed = true;
      return false;
    }
  }

  reg.register({
    id: 'turbulent-displace',
    name: 'Turbulent Displace',
    category: 'warp',
    icon: 'assets/FXPH.svg',
    description: 'After Effects style organic fractal turbulence displacement with multi-octave FBM, smooth liquid flow, and pin options',
    isExpanding: true,
    params: [
      {
        id: 'displacementType',
        label: 'Displacement',
        type: 'select',
        default: 'turbulent',
        options: [
          'turbulent',
          'turbulent_smoother',
          'bulge',
          'bulge_smoother',
          'twist',
          'twist_smoother',
          'horizontal',
          'vertical',
          'cross'
        ]
      },
      { id: 'amount', label: 'Amount', type: 'number', min: -500, max: 500, default: 50, unit: 'px' },
      { id: 'size', label: 'Size', type: 'number', min: 2, max: 1000, default: 100, unit: 'px' },
      { id: 'offset_x', label: 'Offset X', type: 'number', min: -2000, max: 2000, default: 0, unit: 'px' },
      { id: 'offset_y', label: 'Offset Y', type: 'number', min: -2000, max: 2000, default: 0, unit: 'px' },
      { id: 'complexity', label: 'Complexity', type: 'number', min: 1, max: 8, default: 1, step: 1 },
      { id: 'evolution', label: 'Evolution', type: 'number', min: 0, max: 3600, default: 0, unit: '°' },
      { id: 'evolutionSpeed', label: 'Evolution Speed', type: 'number', min: -10, max: 10, default: 1, step: 0.1, unit: 'x' },
      { id: 'pinning', label: 'Pinning', type: 'select', default: 'none', options: ['none', 'all', 'horizontal', 'vertical'] },
      { id: 'tile', label: 'Mirror Edges', type: 'switch', default: 0 }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      const rawAmount = fx && fx.amount !== undefined ? fx.amount : 50;
      if (Math.abs(rawAmount) < 0.05) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const rawSize = Math.max(2, fx && fx.size !== undefined ? fx.size : 100);
      const baseRefW = Math.abs((layer && layer.scaleW) || (layer && layer.mediaWidth) || w);
      const bufferScale = baseRefW > 0 ? (w / baseRefW) : 1;
      const effectiveAmount = rawAmount * bufferScale;
      const effectiveSize = rawSize * bufferScale;

      const rawType = (fx && fx.displacementType ? String(fx.displacementType) : 'turbulent').toLowerCase();
      let typeInt = 0; // 0: turbulent
      if (rawType === 'turbulent_smoother' || rawType === 'turbulent-smoother' || rawType === 'smooth') typeInt = 1;
      else if (rawType === 'bulge') typeInt = 2;
      else if (rawType === 'bulge_smoother' || rawType === 'bulge-smoother') typeInt = 3;
      else if (rawType === 'twist') typeInt = 4;
      else if (rawType === 'twist_smoother' || rawType === 'twist-smoother') typeInt = 5;
      else if (rawType === 'horizontal' || rawType === 'h') typeInt = 6;
      else if (rawType === 'vertical' || rawType === 'v') typeInt = 7;
      else if (rawType === 'cross') typeInt = 8;

      const rawPin = (fx && fx.pinning ? String(fx.pinning) : 'none').toLowerCase();
      let pinInt = 0; // none
      if (rawPin === 'all') pinInt = 1;
      else if (rawPin === 'horizontal' || rawPin === 'h') pinInt = 2;
      else if (rawPin === 'vertical' || rawPin === 'v') pinInt = 3;

      const offX = (fx && fx.offset_x !== undefined ? fx.offset_x : 0) * bufferScale;
      const offY = (fx && fx.offset_y !== undefined ? fx.offset_y : 0) * bufferScale;
      const complexity = Math.max(1, Math.min(8, parseInt(fx && fx.complexity !== undefined ? fx.complexity : 1, 10) || 1));
      const evoDeg = fx && fx.evolution !== undefined ? fx.evolution : 0;
      const evoSpeed = fx && fx.evolutionSpeed !== undefined ? fx.evolutionSpeed : 1;
      const isTile = !!(fx && (fx.tile === 1 || fx.tile === true || fx.tile === '1' || fx.tile === 'true' || fx.tile === 'on'));

      let curSec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : ((layer && typeof layer._currentSec === 'number')
          ? layer._currentSec
          : ((typeof window !== 'undefined' && typeof window._currentRenderSec === 'number')
            ? window._currentRenderSec
            : ((typeof window !== 'undefined' && typeof window.currentPlaybackSec === 'number')
              ? window.currentPlaybackSec
              : 0)));

      const layerStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
      const sourceOffset = (layer && layer.sourceOffsetSec !== undefined) ? layer.sourceOffsetSec : 0;
      const t = curSec - (layerStart - sourceOffset);

      // Continuous evolution angle in radians
      const evolutionRad = (evoDeg * Math.PI / 180) + (t * evoSpeed * Math.PI * 0.5);

      // =========================================================================
      // FAST PATH: Hardware WebGL Single-Pass Shader
      // =========================================================================
      if (!_glFailed && initTurbulentGL()) {
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

          gl.viewport(0, 0, rw, rh);
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
            const sw = Math.min(1920, el.videoWidth || el.naturalWidth || el.width || rw);
            const sh = Math.min(1080, el.videoHeight || el.naturalHeight || el.height || rh);
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
            gl.uniform2f(u.resolution, rw, rh);
            gl.uniform1f(u.amount, effectiveAmount);
            gl.uniform1f(u.size, effectiveSize);
            gl.uniform2f(u.offset, offX, offY);
            gl.uniform1i(u.complexity, complexity);
            gl.uniform1f(u.evolution, evolutionRad);
            gl.uniform1i(u.dispType, typeInt);
            gl.uniform1i(u.pinning, pinInt);
            gl.uniform1i(u.tile, isTile ? 1 : 0);

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
        } catch (err) {
          console.warn('[TurbulentDisplace] WebGL render failed, falling back to 2D:', err);
        }
      }

      // Fallback: draw base image
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
    }
  });
})(typeof window !== 'undefined' ? window : this);
