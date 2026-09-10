(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function getCurrentTime(layer, currentSec) {
    if (typeof currentSec === 'number' && !isNaN(currentSec)) return currentSec;
    if (layer && typeof layer._currentSec === 'number' && !isNaN(layer._currentSec)) return layer._currentSec;
    if (layer && typeof layer._timeInClip === 'number' && !isNaN(layer._timeInClip)) return layer._timeInClip;
    if (typeof window !== 'undefined') {
      if (typeof window.currentPlaybackSec === 'number' && !isNaN(window.currentPlaybackSec)) return window.currentPlaybackSec;
      if (typeof window.currentSec === 'number' && !isNaN(window.currentSec)) return window.currentSec;
      if (typeof window.getCurrentPlayheadTime === 'function') {
        const pt = window.getCurrentPlayheadTime();
        if (typeof pt === 'number' && !isNaN(pt)) return pt;
      }
      const pps = window.currentPixelsPerSecond || 80;
      const panX = window.timelinePanX !== undefined ? Math.min(0, window.timelinePanX) : 0;
      return Math.max(0, -panX) / pps;
    }
    return 0;
  }

  // Generate authentic glass fracture shards (radial + concentric spiderweb crack model)
  function generateGlassShards(w, h, pieceCount, originXPercent, originYPercent, pattern) {
    const ox = w * (0.5 + (originXPercent || 0) / 200);
    const oy = h * (0.5 + (originYPercent || 0) / 200);
    const maxR = Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy)) * 1.05;

    const shards = [];

    if (pattern === 'hexagons') {
      const hexR = Math.max(24, Math.min(130, Math.sqrt((w * h) / Math.max(8, pieceCount)) * 0.7));
      const hDist = hexR * Math.sqrt(3);
      const vDist = hexR * 1.5;
      const cols = Math.ceil(w / hDist) + 2;
      const rows = Math.ceil(h / vDist) + 2;

      for (let r = -1; r <= rows; r++) {
        const yCenter = r * vDist;
        const xOffset = (r % 2 === 0) ? 0 : hDist / 2;
        for (let c = -1; c <= cols; c++) {
          const xCenter = c * hDist + xOffset;
          const pts = [];
          for (let a = 0; a < 6; a++) {
            const ang = (Math.PI / 180) * (60 * a + 30);
            const px = Math.max(0, Math.min(w, xCenter + hexR * Math.cos(ang)));
            const py = Math.max(0, Math.min(h, yCenter + hexR * Math.sin(ang)));
            pts.push([px, py]);
          }
          shards.push({ points: pts });
        }
      }
      return shards;
    }

    // Realistic Radial Glass Shards Model
    const numRays = Math.max(10, Math.min(26, Math.round(Math.sqrt(pieceCount) * 2.3)));
    const numRings = Math.max(4, Math.min(9, Math.round(Math.sqrt(pieceCount) * 1.0)));

    const ringR = [0];
    for (let j = 1; j <= numRings; j++) {
      const fraction = j / numRings;
      ringR.push(maxR * Math.pow(fraction, 1.6));
    }

    let seed = 987654321;
    function rnd() {
      seed = (1103515245 * seed + 12345) & 0x7fffffff;
      return seed / 2147483648;
    }

    const rayAngles = [];
    const twoPi = Math.PI * 2;
    const rayStep = twoPi / numRays;
    for (let i = 0; i < numRays; i++) {
      const baseAng = i * rayStep;
      const jitter = (rnd() - 0.5) * rayStep * 0.45;
      rayAngles.push(baseAng + jitter);
    }

    const grid = [];
    for (let j = 0; j <= numRings; j++) {
      grid[j] = [];
      const r = ringR[j];
      for (let i = 0; i < numRays; i++) {
        if (j === 0) {
          grid[0][i] = [ox, oy];
        } else {
          const ang = rayAngles[i] + (rnd() - 0.5) * 0.08;
          const rawX = ox + r * Math.cos(ang);
          const rawY = oy + r * Math.sin(ang);
          grid[j][i] = [Math.max(0, Math.min(w, rawX)), Math.max(0, Math.min(h, rawY))];
        }
      }
    }

    for (let j = 0; j < numRings; j++) {
      for (let i = 0; i < numRays; i++) {
        const nextI = (i + 1) % numRays;
        if (j === 0) {
          shards.push({ points: [grid[0][i], grid[1][i], grid[1][nextI]] });
        } else {
          shards.push({ points: [grid[j][i], grid[j + 1][i], grid[j + 1][nextI], grid[j][nextI]] });
        }
      }
    }

    return shards;
  }

  // WebGL 3D Native Engine Singleton
  let _glCanvas = null;
  let _gl = null;
  let _glProg = null;
  let _glUniforms = null;
  let _vbo = null;
  let _tex = null;
  let _glFailed = false;

  let _cachedMeshKey = '';
  let _vertexCount = 0;

  function initShatterGL() {
    if (_gl && _glProg) return true;
    if (_glFailed) return false;
    if (typeof document === 'undefined') return false;

    try {
      if (!_glCanvas) {
        _glCanvas = document.createElement('canvas');
      }

      const opts = {
        alpha: true,
        depth: true,
        stencil: false,
        antialias: true,
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
        'attribute vec3 a_pos;',
        'attribute vec2 a_uv;',
        'attribute vec3 a_center;',
        'attribute vec3 a_velocity;',
        'attribute vec3 a_rotAxis;',
        'attribute float a_rotSpeed;',
        'attribute vec3 a_normal;',
        'attribute float a_isSide;',
        '',
        'uniform mat4 u_proj;',
        'uniform float u_progress;',
        'uniform float u_force;',
        'uniform float u_spin;',
        'uniform float u_gravity;',
        'uniform float u_thickness;',
        'uniform float u_camDist;',
        'uniform float u_motionBlur;',
        'uniform float u_dt;',
        '',
        'varying vec2 v_uv;',
        'varying vec3 v_normal;',
        'varying float v_isSide;',
        'varying float v_glint;',
        'varying float v_mblurAlpha;',
        '',
        'vec3 rotateAxis(vec3 v, vec3 k, float theta) {',
        '  float c = cos(theta);',
        '  float s = sin(theta);',
        '  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);',
        '}',
        '',
        'void main(void) {',
        '  v_uv = a_uv;',
        '  v_isSide = a_isSide;',
        '  v_mblurAlpha = 1.0;',
        '',
        '  float t = u_progress;',
        '',
        // Exponential drag deceleration: velocity decays over time
        // v(t) = v0 * e^(-drag*t), position = v0/drag * (1 - e^(-drag*t))
        '  float drag = 2.2;',
        '  float impulse = 1.0 - exp(-drag * t);',
        '  float impulseFactor = impulse / drag;',
        '',
        '  float rotAngle = a_rotSpeed * (u_spin * 0.08) * impulse;',
        '',
        '  vec3 localPos = a_pos - a_center;',
        '  if (a_pos.z < -0.001) {',
        '    localPos.z -= u_thickness;',
        '  }',
        '',
        '  vec3 rotPos = rotateAxis(localPos, a_rotAxis, rotAngle);',
        '  vec3 rotNormal = normalize(rotateAxis(a_normal, a_rotAxis, rotAngle));',
        '  v_normal = rotNormal;',
        '',
        // Physics: position = v0 * integral(e^-drag*t) + 0.5*g*t^2
        // The impulse integral gives smooth deceleration
        '  float forceScale = u_force * impulseFactor * 1.5;',
        '  vec3 trans = a_velocity * forceScale;',
        '  trans.y += 0.5 * u_gravity * t * t * 1200.0;',
        '',
        '  vec3 worldPos = a_center + rotPos + trans;',
        '  worldPos.z = min(worldPos.z, u_camDist * 0.88);',
        '',
        // Specular glint
        '  vec3 lightDir = normalize(vec3(0.35, 0.55, 0.85));',
        '  vec3 viewDir = vec3(0.0, 0.0, 1.0);',
        '  vec3 halfVec = normalize(lightDir + viewDir);',
        '  float spec = pow(max(0.0, dot(rotNormal, halfVec)), 28.0);',
        '  v_glint = spec;',
        '',
        '  gl_Position = u_proj * vec4(worldPos, 1.0);',
        '}'
      ].join('\n');

      const fsSource = [
        'precision highp float;',
        '',
        'varying vec2 v_uv;',
        'varying vec3 v_normal;',
        'varying float v_isSide;',
        'varying float v_glint;',
        'varying float v_mblurAlpha;',
        '',
        'uniform sampler2D u_image;',
        'uniform float u_glintAmount;',
        'uniform float u_mblurAlpha;',
        '',
        'void main(void) {',
        '  vec4 texColor = texture2D(u_image, v_uv);',
        '  if (texColor.a <= 0.001) {',
        '    discard;',
        '  }',
        '',
        '  vec4 baseColor = texColor;',
        '  if (v_isSide > 0.7) {',
        '    baseColor = mix(texColor * 0.5, vec4(0.72, 0.86, 0.94, 0.95), 0.35);',
        '  } else if (v_isSide > 0.3) {',
        '    baseColor = texColor * 0.7;',
        '  }',
        '',
        '  vec3 glintColor = vec3(1.0, 1.0, 1.0) * (v_glint * (u_glintAmount / 100.0) * 1.4);',
        '  float rim = pow(1.0 - max(0.0, abs(v_normal.z)), 2.5) * 0.3;',
        '  vec3 finalRgb = baseColor.rgb + glintColor + vec3(rim * 0.6, rim * 0.7, rim * 0.85);',
        '',
        '  float alpha = baseColor.a * u_mblurAlpha;',
        '  gl_FragColor = vec4(clamp(finalRgb, 0.0, 1.0) * alpha, alpha);',
        '}'
      ].join('\n');

      function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error('[Shatter GL] Shader error:', gl.getShaderInfoLog(s));
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
        console.error('[Shatter GL] Link error:', gl.getProgramInfoLog(prog));
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        proj: gl.getUniformLocation(prog, 'u_proj'),
        progress: gl.getUniformLocation(prog, 'u_progress'),
        force: gl.getUniformLocation(prog, 'u_force'),
        spin: gl.getUniformLocation(prog, 'u_spin'),
        gravity: gl.getUniformLocation(prog, 'u_gravity'),
        thickness: gl.getUniformLocation(prog, 'u_thickness'),
        camDist: gl.getUniformLocation(prog, 'u_camDist'),
        image: gl.getUniformLocation(prog, 'u_image'),
        glintAmount: gl.getUniformLocation(prog, 'u_glintAmount'),
        motionBlur: gl.getUniformLocation(prog, 'u_motionBlur'),
        dt: gl.getUniformLocation(prog, 'u_dt'),
        mblurAlpha: gl.getUniformLocation(prog, 'u_mblurAlpha')
      };

      _vbo = gl.createBuffer();
      _tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, _tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      return true;
    } catch (e) {
      console.warn('[Shatter GL] Init failed, using fallback:', e);
      _glFailed = true;
      return false;
    }
  }

  // Rebuild 3D Shard Mesh and upload to GPU VBO
  function rebuildMesh(w, h, pieces, oxPercent, oyPercent, pattern) {
    const gl = _gl;
    if (!gl || !_vbo) return;

    const rawShards = generateGlassShards(w, h, pieces, oxPercent, oyPercent, pattern);
    const ox = w * (0.5 + (oxPercent || 0) / 200);
    const oy = h * (0.5 + (oyPercent || 0) / 200);

    const vertexData = [];
    const FLOATS_PER_VERTEX = 19;

    let shardIdx = 0;
    rawShards.forEach(s => {
      const rawPts = s.points;
      const cleaned = [];
      for (let k = 0; k < rawPts.length; k++) {
        const p = rawPts[k];
        const last = cleaned[cleaned.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5) {
          cleaned.push(p);
        }
      }
      if (cleaned.length > 2 && Math.hypot(cleaned[0][0] - cleaned[cleaned.length - 1][0], cleaned[0][1] - cleaned[cleaned.length - 1][1]) < 0.5) {
        cleaned.pop();
      }

      let area = 0;
      for (let k = 0; k < cleaned.length; k++) {
        const nextK = (k + 1) % cleaned.length;
        area += cleaned[k][0] * cleaned[nextK][1] - cleaned[nextK][0] * cleaned[k][1];
      }
      if (Math.abs(area) < 2.0 || cleaned.length < 3) return;

      shardIdx++;

      let cx = 0, cy = 0;
      cleaned.forEach(pt => { cx += pt[0]; cy += pt[1]; });
      cx /= cleaned.length;
      cy /= cleaned.length;

      const dx = cx - ox;
      const dy = cy - oy;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);

      const speed = 1.0 + (0.6 / (1.0 + dist / (Math.min(w, h) * 0.25)));
      const vx = Math.cos(angle) * speed + ((shardIdx * 19) % 13 - 6) / 6 * 0.3;
      const vy = Math.sin(angle) * speed + ((shardIdx * 23) % 13 - 6) / 6 * 0.3;
      const vz = (((shardIdx * 31) % 11) / 10 * 1.6 + 0.45) * speed;

      let rx = ((shardIdx * 17) % 19 - 9) / 9;
      let ry = ((shardIdx * 29) % 19 - 9) / 9;
      let rz = ((shardIdx * 41) % 19 - 9) / 9;
      const rLen = Math.hypot(rx, ry, rz) || 1;
      rx /= rLen; ry /= rLen; rz /= rLen;

      const rotSpeed = 1.0 + ((shardIdx * 13) % 7) / 7 * 0.8;

      function pushVertex(px, py, pz, nx, ny, nz, isSide) {
        vertexData.push(
          px, py, pz,
          px / w, py / h,
          cx, cy, 0,
          vx, vy, vz,
          rx, ry, rz,
          rotSpeed,
          nx, ny, nz,
          isSide
        );
      }

      // 1. Front Face Triangles
      for (let k = 1; k < cleaned.length - 1; k++) {
        const p0 = cleaned[0];
        const p1 = cleaned[k];
        const p2 = cleaned[k + 1];
        pushVertex(p0[0], p0[1], 0.0, 0, 0, 1, 0.0);
        pushVertex(p1[0], p1[1], 0.0, 0, 0, 1, 0.0);
        pushVertex(p2[0], p2[1], 0.0, 0, 0, 1, 0.0);
      }

      // 2. Back Face Triangles
      for (let k = 1; k < cleaned.length - 1; k++) {
        const p0 = cleaned[0];
        const p1 = cleaned[k + 1];
        const p2 = cleaned[k];
        pushVertex(p0[0], p0[1], -1.0, 0, 0, -1, 0.5);
        pushVertex(p1[0], p1[1], -1.0, 0, 0, -1, 0.5);
        pushVertex(p2[0], p2[1], -1.0, 0, 0, -1, 0.5);
      }

      // 3. Extruded Glass Side Edges
      for (let k = 0; k < cleaned.length; k++) {
        const pa = cleaned[k];
        const pb = cleaned[(k + 1) % cleaned.length];
        const edx = pb[0] - pa[0];
        const edy = pb[1] - pa[1];
        const elen = Math.hypot(edx, edy);
        if (elen < 0.1) continue;

        const enx = edy / elen;
        const eny = -edx / elen;

        // Quad: (pa0, pb0, pb1), (pa0, pb1, pa1)
        pushVertex(pa[0], pa[1], 0.0, enx, eny, 0, 1.0);
        pushVertex(pb[0], pb[1], 0.0, enx, eny, 0, 1.0);
        pushVertex(pb[0], pb[1], -1.0, enx, eny, 0, 1.0);

        pushVertex(pa[0], pa[1], 0.0, enx, eny, 0, 1.0);
        pushVertex(pb[0], pb[1], -1.0, enx, eny, 0, 1.0);
        pushVertex(pa[0], pa[1], -1.0, enx, eny, 0, 1.0);
      }
    });

    _vertexCount = vertexData.length / FLOATS_PER_VERTEX;
    gl.bindBuffer(gl.ARRAY_BUFFER, _vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData), gl.STATIC_DRAW);
  }

  reg.register({
    id: 'shatter',
    name: 'Shatter',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Hardware WebGL 3D glass shatter explosion with true perspective projection, realistic radial glass cracks, specular glints, and thickness extrusion',
    params: [
      { id: 'progress', label: 'Progress', type: 'number', min: 0, max: 100, default: 20, unit: '%' },
      { id: 'autoAnimate', label: 'Auto Animate', type: 'switch', default: 0 },
      { id: 'duration', label: 'Explosion Duration', type: 'number', min: 0.2, max: 10, default: 2.0, unit: 's' },
      { id: 'force', label: 'Explosion Force', type: 'number', min: 10, max: 1000, default: 350 },
      { id: 'pieces', label: 'Glass Pieces', type: 'number', min: 12, max: 120, default: 48 },
      { id: 'thickness', label: 'Glass Thickness', type: 'number', min: 0, max: 50, default: 12, unit: 'px' },
      { id: 'spin', label: 'Tumble / Spin', type: 'number', min: 0, max: 300, default: 140 },
      { id: 'gravity', label: 'Gravity', type: 'number', min: -200, max: 400, default: 80 },
      { id: 'glint', label: 'Glass Shine', type: 'number', min: 0, max: 100, default: 75, unit: '%' },
      { id: 'originX', label: 'Impact X', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'originY', label: 'Impact Y', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'pattern', label: 'Pattern', type: 'select', options: ['glass', 'hexagons'], default: 'glass' },
      { id: 'motionBlur', label: 'Motion Blur', type: 'number', min: 0, max: 100, default: 60, unit: '%' },
      { id: 'easing', label: 'Easing', type: 'select', options: ['ease-out', 'linear', 'ease-in-out'], default: 'ease-out' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const elW = el.videoWidth || el.naturalWidth || el.width || 0;
      const elH = el.videoHeight || el.naturalHeight || el.height || 0;
      if (elW <= 0 || elH <= 0) return;

      let prog = Math.max(0, Math.min(100, fx.progress !== undefined ? fx.progress : 20)) / 100;
      if (fx.autoAnimate === 1 || fx.autoAnimate === true) {
        const curTime = getCurrentTime(layer, currentSec);
        const start = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
        const dur = Math.max(0.2, fx.duration || 2.0);
        prog = Math.max(0, Math.min(1.0, (curTime - start) / dur));
      }

      // Apply easing curve for smooth AE-like animation
      const easingType = fx.easing || 'ease-out';
      function applyEasing(t) {
        if (easingType === 'ease-out') {
          // Cubic ease-out: fast initial burst, smooth deceleration
          return 1.0 - Math.pow(1.0 - t, 3.0);
        } else if (easingType === 'ease-in-out') {
          // Smooth S-curve
          return t < 0.5
            ? 4.0 * t * t * t
            : 1.0 - Math.pow(-2.0 * t + 2.0, 3.0) / 2.0;
        }
        return t; // linear
      }

      const easedProg = applyEasing(prog);

      // Intact state: render base image directly
      if (prog <= 0.001) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const force = Math.max(0, fx.force !== undefined ? Number(fx.force) : 350);
      const pieces = Math.max(12, Math.min(120, Math.round(fx.pieces !== undefined ? Number(fx.pieces) : 48)));
      const thickness = Math.max(0, (fx.thickness !== undefined ? Number(fx.thickness) : (fx.extrusion !== undefined ? Number(fx.extrusion) : 12)));
      const spin = Math.max(0, fx.spin !== undefined ? Number(fx.spin) : 140);
      const gravity = (fx.gravity !== undefined ? Number(fx.gravity) : 80) / 100;
      const glint = Math.max(0, Math.min(100, fx.glint !== undefined ? Number(fx.glint) : 75));
      const oxPercent = fx.originX !== undefined ? Number(fx.originX) : 0;
      const oyPercent = fx.originY !== undefined ? Number(fx.originY) : 0;
      const pattern = fx.pattern || 'glass';
      const motionBlur = Math.max(0, Math.min(100, fx.motionBlur !== undefined ? Number(fx.motionBlur) : 60)) / 100;

      // Motion blur: number of temporal sub-samples and time spread
      // More samples = smoother blur but heavier; 1 sample = no blur
      const mblurSamples = motionBlur > 0.01 ? Math.max(2, Math.min(8, Math.round(motionBlur * 8))) : 1;
      // Time spread: how far back in time to sample (fraction of current eased progress)
      const mblurSpread = motionBlur * 0.12;

      // NATIVE WEBGL 3D PIPELINE
      if (!_glFailed && initShatterGL()) {
        try {
          const gl = _gl;
          const progId = _glProg;
          const u = _glUniforms;

          if (_glCanvas.width !== w || _glCanvas.height !== h) {
            _glCanvas.width = w;
            _glCanvas.height = h;
          }

          // Check if mesh needs rebuild
          const meshKey = `${w}_${h}_${pieces}_${oxPercent}_${oyPercent}_${pattern}`;
          if (_cachedMeshKey !== meshKey) {
            rebuildMesh(w, h, pieces, oxPercent, oyPercent, pattern);
            _cachedMeshKey = meshKey;
          }

          if (_vertexCount > 0) {
            gl.viewport(0, 0, w, h);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

            gl.useProgram(progId);

            // Upload active texture slice
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
            gl.uniform1i(u.image, 0);

            // True 3D Perspective Projection Matrix
            const D = Math.max(w, h) * 1.25;
            const projMat = new Float32Array([
              2.0 / w,      0,            0,         0,
              0,            -2.0 / h,     0,         0,
              0,            0,            -1.0 / D,  -1.0 / D,
              -1.0,         1.0,          0,         1.0
            ]);

            gl.uniformMatrix4fv(u.proj, false, projMat);
            gl.uniform1f(u.force, force);
            gl.uniform1f(u.spin, spin);
            gl.uniform1f(u.gravity, gravity);
            gl.uniform1f(u.thickness, thickness);
            gl.uniform1f(u.camDist, D);
            gl.uniform1f(u.glintAmount, glint);

            gl.bindBuffer(gl.ARRAY_BUFFER, _vbo);
            const STRIDE = 19 * 4;

            const aPos = gl.getAttribLocation(progId, 'a_pos');
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, STRIDE, 0);

            const aUv = gl.getAttribLocation(progId, 'a_uv');
            gl.enableVertexAttribArray(aUv);
            gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, STRIDE, 3 * 4);

            const aCenter = gl.getAttribLocation(progId, 'a_center');
            gl.enableVertexAttribArray(aCenter);
            gl.vertexAttribPointer(aCenter, 3, gl.FLOAT, false, STRIDE, 5 * 4);

            const aVel = gl.getAttribLocation(progId, 'a_velocity');
            gl.enableVertexAttribArray(aVel);
            gl.vertexAttribPointer(aVel, 3, gl.FLOAT, false, STRIDE, 8 * 4);

            const aRotAxis = gl.getAttribLocation(progId, 'a_rotAxis');
            gl.enableVertexAttribArray(aRotAxis);
            gl.vertexAttribPointer(aRotAxis, 3, gl.FLOAT, false, STRIDE, 11 * 4);

            const aRotSpd = gl.getAttribLocation(progId, 'a_rotSpeed');
            gl.enableVertexAttribArray(aRotSpd);
            gl.vertexAttribPointer(aRotSpd, 1, gl.FLOAT, false, STRIDE, 14 * 4);

            const aNorm = gl.getAttribLocation(progId, 'a_normal');
            gl.enableVertexAttribArray(aNorm);
            gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, STRIDE, 15 * 4);

            const aSide = gl.getAttribLocation(progId, 'a_isSide');
            gl.enableVertexAttribArray(aSide);
            gl.vertexAttribPointer(aSide, 1, gl.FLOAT, false, STRIDE, 18 * 4);

            // Multi-pass temporal motion blur accumulation
            const sampleAlpha = 1.0 / mblurSamples;
            for (let si = 0; si < mblurSamples; si++) {
              // Sample time spread: from (prog - spread) to prog
              const sampleT = mblurSamples === 1
                ? easedProg
                : applyEasing(Math.max(0, prog - mblurSpread + (mblurSpread * si / (mblurSamples - 1))));

              if (si > 0) {
                // Don't clear depth/color between blur passes — accumulate
                gl.depthMask(false);
              } else {
                gl.depthMask(true);
              }

              gl.uniform1f(u.progress, sampleT);
              gl.uniform1f(u.mblurAlpha, sampleAlpha);
              gl.uniform1f(u.motionBlur, motionBlur);

              gl.drawArrays(gl.TRIANGLES, 0, _vertexCount);
            }

            gl.depthMask(true);

            ctx.drawImage(_glCanvas, x, y, w, h);
            return;
          }
        } catch (err) {
          console.warn('[Shatter] WebGL execution error, using fallback:', err);
        }
      }

      // 2D CANVAS PERSPECTIVE FALLBACK (No ugly wireframe, authentic glass shard clipping)
      const rawShards = generateGlassShards(w, h, pieces, oxPercent, oyPercent, pattern);
      const ox = w * (0.5 + oxPercent / 200);
      const oy = h * (0.5 + oyPercent / 200);
      const D = Math.max(w, h) * 1.2;

      ctx.save();
      let sIdx = 0;
      rawShards.forEach(s => {
        sIdx++;
        const pts = s.points;
        if (pts.length < 3) return;

        let cx = 0, cy = 0;
        pts.forEach(p => { cx += p[0]; cy += p[1]; });
        cx /= pts.length; cy /= pts.length;

        const dx = cx - ox;
        const dy = cy - oy;
        const dist = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        const spd = 1.0 + (0.5 / (1.0 + dist / (Math.min(w, h) * 0.25)));

        // Use eased progress for smooth deceleration
        const ep = easedProg;
        const vx = (Math.cos(ang) * spd + ((sIdx * 17) % 9 - 4) / 9 * 0.3) * force * ep * 1.4;
        const vy = (Math.sin(ang) * spd + ((sIdx * 23) % 9 - 4) / 9 * 0.3) * force * ep * 1.4 + 0.5 * gravity * ep * ep * 1200;
        const vz = (((sIdx * 29) % 11) / 10 * 1.5 + 0.4) * force * ep;

        const eyeZ = Math.max(50, D - vz);
        const scale = D / eyeZ;

        const rot = ((sIdx * 13) % 11 - 5) * (spin * 0.04) * ep;

        ctx.save();
        ctx.translate(x + cx + vx * scale, y + cy + vy * scale);
        ctx.scale(scale, scale);
        ctx.rotate(rot);

        ctx.beginPath();
        pts.forEach((p, idx) => {
          const lx = p[0] - cx;
          const ly = p[1] - cy;
          if (idx === 0) ctx.moveTo(lx, ly);
          else ctx.lineTo(lx, ly);
        });
        ctx.closePath();
        ctx.clip();

        try {
          ctx.drawImage(el, -cx, -cy, w, h);
        } catch (_) {}

        ctx.restore();
      });
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
