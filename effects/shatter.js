(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function getCurrentTime(layer, currentSec) {
    if (typeof currentSec === 'number' && !isNaN(currentSec)) return currentSec;
    if (layer && typeof layer._currentSec === 'number' && !isNaN(layer._currentSec)) return layer._currentSec;
    if (layer && typeof layer._timeInClip === 'number' && !isNaN(layer._timeInClip)) return layer._timeInClip;
    if (typeof window !== 'undefined') {
      if (typeof window._currentRenderSec === 'number' && !isNaN(window._currentRenderSec)) return window._currentRenderSec;
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

  /* ── 3D Camera Resolution for Shatter (matching particle_engine.js) ───────── */
  let _camMemo = null;
  let _camMemoClearScheduled = false;

  function scheduleCamMemoClear() {
    if (_camMemoClearScheduled) return;
    _camMemoClearScheduled = true;
    Promise.resolve().then(() => {
      _camMemo = null;
      _camMemoClearScheduled = false;
    });
  }

  function resolveCameraState(curTime) {
    let compLayers = null;
    if (typeof window !== 'undefined') {
      if (window.currentActivePrecomp && Array.isArray(window.currentActivePrecomp.layers)) {
        compLayers = window.currentActivePrecomp.layers;
      } else if (window.currentProjectState && Array.isArray(window.currentProjectState.layers)) {
        compLayers = window.currentProjectState.layers;
      }
    }

    if (_camMemo && _camMemo.time === curTime && _camMemo.layers === compLayers) {
      return _camMemo.state;
    }

    const state = { found: false, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, zoom: 1.0, lens: 50 };
    if (compLayers) {
      let cam = null;
      for (let i = 0; i < compLayers.length; i++) {
        const l = compLayers[i];
        if (l && l.type === 'camera' && !l.hidden) { cam = l; break; }
      }
      if (cam) {
        const camEff = (typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function' && typeof curTime === 'number')
          ? window.getLayerEffectivePropsAtTime(cam, curTime, null, compLayers)
          : cam;
        state.found = true;
        state.posX = camEff.posX || 0;
        state.posY = camEff.posY || 0;
        state.posZ = camEff.posZ || 0;
        state.rotX = camEff.rotX || 0;
        state.rotY = camEff.rotY || 0;
        state.rotZ = camEff.rotZ !== undefined ? camEff.rotZ : (camEff.rotation || 0);
        state.zoom = (camEff.cameraZoom !== undefined ? camEff.cameraZoom : 100) / 100;
        state.lens = Math.max(1, camEff.cameraLens !== undefined ? camEff.cameraLens : 50);
      }
    }

    _camMemo = { time: curTime, layers: compLayers, state };
    scheduleCamMemoClear();
    return state;
  }

  function computeShatterCamera(w, h, curTime, fx, layer, unit) {
    let camPosX = 0, camPosY = 0, camPosZ = 0;
    let camRotX = 0, camRotY = 0, camRotZ = 0;
    let camZoom = 1.0;
    let camLens = 50;

    const useCamera = (fx.useCamera !== 0 && fx.useCamera !== false && fx.useCamera !== '0');
    if (useCamera && typeof window !== 'undefined') {
      const cam = resolveCameraState(curTime);
      if (cam && cam.found) {
        const isLayer3D = !!(layer && layer.is3D);
        if (!isLayer3D) {
          camPosX = cam.posX;
          camPosY = cam.posY;
          camPosZ = cam.posZ;
          camRotX = cam.rotX;
          camRotY = cam.rotY;
          camRotZ = cam.rotZ;
        }
        camZoom = cam.zoom;
        camLens = cam.lens;
      }
    }

    const totalRotX = camRotX + (fx.camRotX || 0);
    const totalRotY = camRotY + (fx.camRotY || 0);
    const totalRotZ = camRotZ + (fx.camRotZ || 0);

    const radZ = (-totalRotZ * Math.PI) / 180;
    const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
    const radY = (totalRotY * Math.PI) / 180;
    const cY = Math.cos(radY), sY = Math.sin(radY);
    const radX = (totalRotX * Math.PI) / 180;
    const cX = Math.cos(radX), sX = Math.sin(radX);

    // 3x3 Combined Camera Rotation Matrix (Roll Z -> Yaw Y -> Pitch X)
    const m00 = cY * cZ;
    const m01 = -cY * sZ;
    const m02 = sY;
    const m10 = cX * sZ + sX * sY * cZ;
    const m11 = cX * cZ - sX * sY * sZ;
    const m12 = -sX * cY;
    const m20 = sX * sZ - cX * sY * cZ;
    const m21 = sX * cZ + cX * sY * sZ;
    const m22 = cX * cY;

    const lensFactor = Math.max(0.01, camLens / 50);
    const totalZoom = Math.max(0.01, lensFactor * camZoom);
    const u = (unit > 0) ? unit : 1;
    const D = 1000 * lensFactor * u;

    // Camera translation is authored in comp px → convert to this buffer's px.
    camPosX *= u; camPosY *= u; camPosZ *= u;

    // Translation relative to camera center
    const tx = -(w * 0.5 + camPosX);
    const ty = -(h * 0.5 + camPosY);
    const tz = -(camPosZ + D);

    const kx = (2.0 * totalZoom) / w;
    const ky = (-2.0 * totalZoom) / h;

    // Standard OpenGL perspective depth mapping with near plane n = 0.02 * D, far plane f = 10.0 * D.
    // Nearer shards strictly have smaller NDC z (winning gl.LEQUAL depth test).
    // Near shards never get clipped by near plane (up to 98% travel towards camera).
    const un = 0.02;
    const uf = 10.0;
    const diff = uf - un;
    const A = (uf + un) / diff;
    const B = (-2.0 * un * uf) / diff;

    const cz = tx * m20 + ty * m21 + tz * m22;
    const projMat = new Float32Array([
      m00 * kx,       m10 * ky,       -(A * m20) / D,       -m20 / D,
      m01 * kx,       m11 * ky,       -(A * m21) / D,       -m21 / D,
      m02 * kx,       m12 * ky,       -(A * m22) / D,       -m22 / D,
      (tx * m00 + ty * m01 + tz * m02) * kx,
      (tx * m10 + ty * m11 + tz * m12) * ky,
      -(A * cz) / D + B,
      -cz / D
    ]);

    const camRotMat = new Float32Array([
      m00, m10, m20,
      m01, m11, m21,
      m02, m12, m22
    ]);

    return { projMat, camRotMat, D, totalZoom, totalRotX, totalRotY, totalRotZ, camPosX, camPosY, camPosZ };
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
        'uniform mat3 u_camRot;',
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
        '  v_normal = normalize(u_camRot * rotNormal);',
        '',
        // Physics: position = v0 * integral(e^-drag*t) + 0.5*g*t^2
        // The impulse integral gives smooth deceleration
        '  float forceScale = u_force * impulseFactor * 1.5;',
        '  vec3 trans = a_velocity * forceScale;',
        '  trans.y += 0.5 * u_gravity * t * t * 1200.0;',
        '',
        '  vec3 worldPos = a_center + rotPos + trans;',
        '  worldPos.z = min(worldPos.z, u_camDist * 0.96);',
        '',
        // Specular glint
        '  vec3 lightDir = normalize(vec3(0.35, 0.55, 0.85));',
        '  vec3 viewDir = vec3(0.0, 0.0, 1.0);',
        '  vec3 halfVec = normalize(lightDir + viewDir);',
        '  float spec = pow(max(0.0, dot(v_normal, halfVec)), 28.0);',
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
        camRot: gl.getUniformLocation(prog, 'u_camRot'),
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

  // ── GPU motion-blur accumulation resources (FBO sample target + running-mean composite) ──
  let _accFbo = null, _accTex = null, _accDepth = null, _accProg = null, _accQuad = null;
  let _accPosLoc = -1, _accTexLoc = null, _accW = 0, _accH = 0, _accFailed = false;

  function initAccumGL(w, h) {
    const gl = _gl;
    if (!gl || _accFailed) return false;
    try {
      if (!_accProg) {
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, 'attribute vec2 a_p; varying vec2 v_uv; void main(){ v_uv = a_p * 0.5 + 0.5; gl_Position = vec4(a_p, 0.0, 1.0); }');
        gl.compileShader(vs);
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, 'precision mediump float; varying vec2 v_uv; uniform sampler2D u_t; void main(){ gl_FragColor = texture2D(u_t, v_uv); }');
        gl.compileShader(fs);
        const pr = gl.createProgram();
        gl.attachShader(pr, vs);
        gl.attachShader(pr, fs);
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { _accFailed = true; return false; }
        _accProg = pr;
        _accPosLoc = gl.getAttribLocation(pr, 'a_p');
        _accTexLoc = gl.getUniformLocation(pr, 'u_t');
        _accQuad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, _accQuad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        _accFbo = gl.createFramebuffer();
        _accTex = gl.createTexture();
        _accDepth = gl.createRenderbuffer();
      }
      if (_accW !== w || _accH !== h) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, _accTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindRenderbuffer(gl.RENDERBUFFER, _accDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, _accFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, _accTex, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, _accDepth);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0);
        if (!ok) { _accFailed = true; return false; }
        _accW = w; _accH = h;
      }
      return true;
    } catch (e) {
      _accFailed = true;
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
    isExpanding: true,
    cameraDriven: true,
    selfBlur: true,
    motionTravel(layer, fx, info) {
      const force = Math.max(0, fx.force !== undefined ? Number(fx.force) : 162);
      const gravity = (fx.gravity !== undefined ? Number(fx.gravity) : 80) / 100;
      const spin = Math.max(0, fx.spin !== undefined ? Number(fx.spin) : 65);
      const dur = Math.max(0.2, fx.duration !== undefined ? Number(fx.duration) : 6.0);
      const clipStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
      const isAuto = (fx.autoAnimate === 1 || fx.autoAnimate === true || fx.autoAnimate === undefined);
      const pAt = (t) => {
        if (isAuto) return Math.max(0, Math.min(1, (t - clipStart) / dur));
        let v = fx.progress !== undefined ? fx.progress : 0;
        return Math.max(0, Math.min(100, Number(v) || 0)) / 100;
      };
      const e0 = pAt(info.t0);
      const e1 = pAt(info.t1);
      const dP = Math.abs(e1 - e0);
      const size = info.size || 500;
      const u = info.bufferScale || 1;
      return dP * (force * 2.8 + Math.abs(gravity) * 1200 + spin * 0.04 * size * 0.25) * u + (info.camTravelPx || 0);
    },
    description: 'Hardware WebGL 3D glass shatter explosion with true perspective projection, 3D camera tracking, realistic radial glass cracks, specular glints, and thickness extrusion',
    params: [
      { id: 'progress', label: 'Progress', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'autoAnimate', label: 'Auto Animate', type: 'switch', default: 1 },
      { id: 'duration', label: 'Explosion Duration', type: 'number', min: 0.2, max: 10, default: 6.0, unit: 's' },
      { id: 'force', label: 'Explosion Force', type: 'number', min: 10, max: 1000, default: 162 },
      { id: 'pieces', label: 'Glass Pieces', type: 'number', min: 12, max: 120, default: 58 },
      { id: 'thickness', label: 'Glass Thickness', type: 'number', min: 0, max: 50, default: 0, unit: 'px' },
      { id: 'spin', label: 'Tumble / Spin', type: 'number', min: 0, max: 300, default: 65 },
      { id: 'gravity', label: 'Gravity', type: 'number', min: -200, max: 400, default: 80 },
      { id: 'glint', label: 'Glass Shine', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'originX', label: 'Impact X', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'originY', label: 'Impact Y', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'pattern', label: 'Pattern', type: 'select', options: ['glass', 'hexagons'], default: 'glass' },
      { id: 'easing', label: 'Easing', type: 'select', options: ['ease-out', 'linear', 'ease-in-out'], default: 'ease-out' },
      { id: 'useCamera', label: 'Follow 3D Camera', type: 'switch', default: 1 },
      { id: 'camRotX', label: 'Manual Pitch (X)', type: 'angle', default: 0, unit: '°' },
      { id: 'camRotY', label: 'Manual Yaw (Y)', type: 'angle', default: 0, unit: '°' },
      { id: 'camRotZ', label: 'Manual Roll (Z)', type: 'angle', default: 0, unit: '°' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const unitScale = (bounds && typeof bounds.unitScale === 'number' && bounds.unitScale > 0)
        ? bounds.unitScale
        : (bounds && typeof bounds.bufferScale === 'number' && bounds.bufferScale > 0 ? bounds.bufferScale : (ctx.canvas && ctx.canvas.width ? ctx.canvas.width / 1920 : 1));

      const elW = el.videoWidth || el.naturalWidth || el.width || 0;
      const elH = el.videoHeight || el.naturalHeight || el.height || 0;
      if (elW <= 0 || elH <= 0) return;

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

      const isAuto = (fx.autoAnimate === 1 || fx.autoAnimate === true || fx.autoAnimate === undefined);
      const clipStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
      const animDur = Math.max(0.2, fx.duration !== undefined ? fx.duration : 6.0);
      const curTime = getCurrentTime(layer, currentSec);
      // Raw (un-eased) progress at any absolute time — auto mode or keyframed Progress param
      function progAt(t) {
        if (isAuto) return Math.max(0, Math.min(1, (t - clipStart) / animDur));
        let v = fx.progress !== undefined ? fx.progress : 0;
        if (typeof window !== 'undefined' && typeof window.getLayerEffectivePropsAtTime === 'function' && layer && fx.id) {
          try {
            const eff = window.getLayerEffectivePropsAtTime(layer, t);
            const f = eff && Array.isArray(eff.effects) ? eff.effects.find(e => e && e.id === fx.id) : null;
            if (f && f.progress !== undefined) v = f.progress;
          } catch (_) {}
        }
        return Math.max(0, Math.min(100, Number(v) || 0)) / 100;
      }

      // Motion blur follows the LAYER switch + central motion blur engine, like AE.
      const mbEng = (typeof window !== 'undefined') ? window.FishMotionBlurEngine : null;
      let shutterTimes = null;
      const isMbActive = mbEng
        ? (typeof mbEng.isEffectBlurActive === 'function' ? mbEng.isEffectBlurActive(layer) : mbEng.isLayerActive(layer))
        : false;
      if (isMbActive) {
        const shutter = (typeof mbEng.getShutter === 'function')
          ? mbEng.getShutter(null, curTime)
          : null;
        if (shutter && shutter.exposureTime > 0.0001) {
          shutterTimes = { t0: shutter.tStart, exposure: shutter.exposureTime };
        }
      }

      const prog = progAt(curTime);
      const easedProg = applyEasing(prog);

      // Intact state: render base image directly if no progress and no motion blur
      /* if (prog <= 0.001 && !shutterTimes) { ... bypass removed for true 3D perspective ... } */

      const rawForce = Math.max(0, fx.force !== undefined ? Number(fx.force) : 162);
      const force = rawForce * unitScale;
      const pieces = Math.max(12, Math.min(120, Math.round(fx.pieces !== undefined ? Number(fx.pieces) : 58)));
      const rawThickness = Math.max(0, (fx.thickness !== undefined ? Number(fx.thickness) : (fx.extrusion !== undefined ? Number(fx.extrusion) : 0)));
      const thickness = rawThickness * unitScale;
      const spin = Math.max(0, fx.spin !== undefined ? Number(fx.spin) : 65);
      const rawGravity = (fx.gravity !== undefined ? Number(fx.gravity) : 80) / 100;
      const gravity = rawGravity * unitScale;
      const glint = Math.max(0, Math.min(100, fx.glint !== undefined ? Number(fx.glint) : 0));
      const oxPercent = fx.originX !== undefined ? Number(fx.originX) : 0;
      const oyPercent = fx.originY !== undefined ? Number(fx.originY) : 0;
      const pattern = fx.pattern || 'glass';

      // Shutter sub-samples (eased progress values). Count adapts to shard travel + camera travel (~2px spacing)
      let sampleProgs = [easedProg];
      let sampleTimes = [curTime];
      if (shutterTimes) {
        const e0 = applyEasing(progAt(shutterTimes.t0));
        const e1 = applyEasing(progAt(shutterTimes.t0 + shutterTimes.exposure));
        const dP = Math.abs(e1 - e0);

        // Check shard travel AND camera travel over shutter
        let camTravel = 0;
        const cam0 = resolveCameraState(shutterTimes.t0);
        const cam1 = resolveCameraState(shutterTimes.t0 + shutterTimes.exposure);
        if (cam0 && cam1 && cam0.found && cam1.found) {
          camTravel = Math.hypot(cam1.posX - cam0.posX, cam1.posY - cam0.posY)
            + (Math.abs(cam1.rotX - cam0.rotX) + Math.abs(cam1.rotY - cam0.rotY) + Math.abs(cam1.rotZ - cam0.rotZ)) * Math.PI / 180 * Math.max(w, h) * 0.5;
        }

        const travel = dP * (force * 2.8 + Math.abs(gravity) * 1200 + spin * 0.04 * Math.max(w, h) * 0.25) + camTravel;
        if (travel > 1) {
          const cfg = (mbEng && typeof mbEng.getConfig === 'function') ? mbEng.getConfig() : null;
          const n = (cfg && cfg.samples) ? Math.max(2, Number(cfg.samples)) : 16;
          sampleProgs = [];
          sampleTimes = [];
          for (let si = 0; si < n; si++) {
            const ts = shutterTimes.t0 + ((si + 0.5) / n) * shutterTimes.exposure;
            sampleTimes.push(ts);
            sampleProgs.push(applyEasing(progAt(ts)));
          }
        } /* else if (prog <= 0.001 && camTravel < 0.5) { bypass removed } */
      }

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

            // True 3D Perspective Projection Matrix with 3D Camera integration
            const camRes = computeShatterCamera(w, h, curTime, fx, layer, unitScale);

            gl.uniformMatrix4fv(u.proj, false, camRes.projMat);
            if (u.camRot) gl.uniformMatrix3fv(u.camRot, false, camRes.camRotMat);
            gl.uniform1f(u.force, force);
            gl.uniform1f(u.spin, spin);
            gl.uniform1f(u.gravity, gravity);
            gl.uniform1f(u.thickness, thickness);
            gl.uniform1f(u.camDist, camRes.D);
            gl.uniform1f(u.glintAmount, glint);

            const STRIDE = 19 * 4;
            const bindShatterAttribs = () => {
              gl.bindBuffer(gl.ARRAY_BUFFER, _vbo);
              const set = (name, size, off) => {
                const loc = gl.getAttribLocation(progId, name);
                if (loc < 0) return;
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, off * 4);
              };
              set('a_pos', 3, 0);
              set('a_uv', 2, 3);
              set('a_center', 3, 5);
              set('a_velocity', 3, 8);
              set('a_rotAxis', 3, 11);
              set('a_rotSpeed', 1, 14);
              set('a_normal', 3, 15);
              set('a_isSide', 1, 18);
            };
            bindShatterAttribs();

            gl.uniform1f(u.mblurAlpha, 1.0);
            gl.uniform1f(u.motionBlur, 0.0);

            const nS = sampleProgs.length;
            if (nS === 1 || !initAccumGL(w, h)) {
              const midIdx = Math.floor(nS / 2);
              const midCam = computeShatterCamera(w, h, sampleTimes[midIdx], fx, layer, unitScale);
              gl.uniformMatrix4fv(u.proj, false, midCam.projMat);
              if (u.camRot) gl.uniformMatrix3fv(u.camRot, false, midCam.camRotMat);
              gl.uniform1f(u.camDist, midCam.D);
              gl.uniform1f(u.progress, sampleProgs[midIdx]);
              gl.drawArrays(gl.TRIANGLES, 0, _vertexCount);
              ctx.drawImage(_glCanvas, x, y, w, h);
              return;
            }

            // ── GPU shutter accumulation (AE-style running mean) ──
            // Each sample: full depth-correct pass into an FBO, then blended over the
            // running mean at w = 1/(si+1) via (CONSTANT_ALPHA, ONE_MINUS_CONSTANT_ALPHA).
            // Buffer stays near full brightness so 8-bit rounding never shifts hues
            // (old fixed 1/N additive sum quantized each sample to a few LSBs).
            // Everything stays on the GPU; only ONE readback happens at the end.
            for (let si = 0; si < nS; si++) {
              const subCam = computeShatterCamera(w, h, sampleTimes[si], fx, layer, unitScale);
              gl.bindFramebuffer(gl.FRAMEBUFFER, _accFbo);
              gl.viewport(0, 0, w, h);
              gl.clearColor(0, 0, 0, 0);
              gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
              gl.enable(gl.DEPTH_TEST);
              gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.useProgram(progId);
              if (si > 0) bindShatterAttribs();
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, _tex);
              gl.uniformMatrix4fv(u.proj, false, subCam.projMat);
              if (u.camRot) gl.uniformMatrix3fv(u.camRot, false, subCam.camRotMat);
              gl.uniform1f(u.camDist, subCam.D);
              gl.uniform1f(u.progress, sampleProgs[si]);
              gl.drawArrays(gl.TRIANGLES, 0, _vertexCount);

              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.viewport(0, 0, w, h);
              gl.disable(gl.DEPTH_TEST);
              gl.useProgram(_accProg);
              gl.bindBuffer(gl.ARRAY_BUFFER, _accQuad);
              gl.enableVertexAttribArray(_accPosLoc);
              gl.vertexAttribPointer(_accPosLoc, 2, gl.FLOAT, false, 0, 0);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, _accTex);
              gl.uniform1i(_accTexLoc, 1);
              if (si === 0) {
                gl.blendFunc(gl.ONE, gl.ZERO);
              } else {
                gl.blendColor(0, 0, 0, 1 / (si + 1));
                gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
              }
              gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
            gl.activeTexture(gl.TEXTURE0);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

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
      const camRes = computeShatterCamera(w, h, curTime, fx, layer, unitScale);
      const D = camRes.D;
      const totalZoom = camRes.totalZoom;

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

        // Apply camera rotation & translation to 3D center
        const relX = (cx - w * 0.5) + vx - camRes.camPosX;
        const relY = (cy - h * 0.5) + vy - camRes.camPosY;
        const relZ = vz - (camRes.camPosZ + D);

        const camRot = camRes.camRotMat;
        const rotX = relX * camRot[0] + relY * camRot[3] + relZ * camRot[6];
        const rotY = relX * camRot[1] + relY * camRot[4] + relZ * camRot[7];
        const rotZ = relX * camRot[2] + relY * camRot[5] + relZ * camRot[8];

        const eyeZ = Math.max(50, -rotZ);
        const scale = (D * totalZoom) / eyeZ;

        const rot = ((sIdx * 13) % 11 - 5) * (spin * 0.04) * ep - (camRes.totalRotZ * Math.PI / 180);

        ctx.save();
        ctx.translate(x + w * 0.5 + rotX * (scale / totalZoom), y + h * 0.5 + rotY * (scale / totalZoom));
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
