(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // --- WebGL GPU Engine for Optical Camera Lens Bokeh Blur ---
  let _glCanvas = null;
  let _gl = null;
  let _progs = {};
  let _posBuf = null;
  let _uvBuf = null;
  let _tex = null;
  let _glFailed = false;
  let _scratchCanvas = null;
  let _scratchCtx = null;

  function initGLContext() {
    if (_gl && _posBuf && _uvBuf && _tex) return true;
    if (_glFailed || typeof document === 'undefined') return false;

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
      console.warn('[CameraLensBlur GL] WebGL context initialization failed:', e);
      _glFailed = true;
      return false;
    }
  }

  function compileShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[CameraLensBlur GL] Shader compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function getProgramForSampleCount(gl, sampleCount) {
    if (_progs[sampleCount]) return _progs[sampleCount];

    const vsSource = [
      'attribute vec2 a_pos;',
      'attribute vec2 a_uv;',
      'varying vec2 v_uv;',
      'void main(void) {',
      '  v_uv = a_uv;',
      '  gl_Position = vec4(a_pos, 0.0, 1.0);',
      '}'
    ].join('\n');

    // Optical Camera Lens Bokeh Fragment Shader:
    // - Polygonal iris diaphragm geometry with blade curvature and continuous aspect ratio
    // - Specular highlight extraction with linear HDR energy gathering & tone mapping
    // - Spherical aberration diffraction rim (outer edge ringing / soap-bubble bokeh)
    // - Longitudinal/axial chromatic aberration fringing (RGB dispersion)
    // - Sub-texel radial dither using interleaved gradient noise to eliminate banding
    const fsSource = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'varying vec2 v_uv;',
      'uniform sampler2D u_image;',
      'uniform vec2 u_texelSize;',
      'uniform float u_radius;',
      'uniform float u_sides;',
      'uniform float u_curvature;',
      'uniform float u_rotation;',
      'uniform float u_aspectRatio;',
      'uniform float u_diffraction;',
      'uniform float u_gain;',
      'uniform float u_threshold;',
      'uniform float u_fringe;',
      '#define TOTAL_SAMPLES ' + sampleCount,
      'const float PI = 3.141592653589793;',
      'const float TWO_PI = 6.283185307179586;',
      'const float GOLDEN_ANGLE = 2.399963229728653;',
      'void main(void) {',
      '  if (u_radius <= 0.001) {',
      '    gl_FragColor = texture2D(u_image, v_uv);',
      '    return;',
      '  }',
      '  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
      '  float radialJitter = (ign - 0.5) / float(TOTAL_SAMPLES);',
      '  vec3 accumColor = vec3(0.0);',
      '  float accumAlpha = 0.0;',
      '  float totalWeight = 0.0;',
      '  float delta = (u_sides >= 3.0) ? (TWO_PI / u_sides) : 0.0;',
      '  float cosHalfSide = (u_sides >= 3.0) ? cos(PI / u_sides) : 1.0;',
      '  for (int i = 0; i < TOTAL_SAMPLES; i++) {',
      '    float fi = float(i);',
      '    float frac = clamp((fi + 0.5) / float(TOTAL_SAMPLES) + radialJitter, 0.001, 0.999);',
      '    float radiusFraction = sqrt(frac);',
      '    float theta = fi * GOLDEN_ANGLE;',
      '    float R_shape = 1.0;',
      '    if (u_sides >= 3.0) {',
      '      float phi = theta - u_rotation + 62.83185307;',
      '      float psi = mod(phi + delta * 0.5, delta) - delta * 0.5;',
      '      float R_poly = cosHalfSide / max(0.001, cos(psi));',
      '      R_shape = mix(R_poly, 1.0, u_curvature);',
      '    }',
      '    float r = radiusFraction * R_shape * u_radius;',
      '    vec2 dir = vec2(cos(theta) * u_aspectRatio, sin(theta)) * r;',
      '    vec2 sampleOffset = dir * u_texelSize;',
      '    float edgeRing = 1.0 + u_diffraction * smoothstep(0.65, 0.98, radiusFraction);',
      '    vec4 sCol;',
      '    if (u_fringe > 0.001) {',
      '      vec2 fringeDir = sampleOffset * (u_fringe * 0.07);',
      '      float rC = texture2D(u_image, v_uv + sampleOffset + fringeDir).r;',
      '      vec4 gC = texture2D(u_image, v_uv + sampleOffset);',
      '      float bC = texture2D(u_image, v_uv + sampleOffset - fringeDir).b;',
      '      sCol = vec4(rC, gC.g, bC, gC.a);',
      '    } else {',
      '      sCol = texture2D(u_image, v_uv + sampleOffset);',
      '    }',
      '    float a = sCol.a;',
      '    vec3 rgb = (a > 0.001) ? (sCol.rgb / a) : sCol.rgb;',
      '    vec3 lin = pow(max(vec3(0.0), rgb), vec3(2.2));',
      '    float lum = dot(lin, vec3(0.2126, 0.7152, 0.0722));',
      '    float thresh = u_threshold * 0.85;',
      '    float excess = max(0.0, lum - thresh);',
      '    float bloom = pow(excess / max(0.02, 1.0 - thresh), 1.5) * (u_gain * 3.5);',
      '    vec3 sampleVal = lin * (1.0 + bloom);',
      '    float w = edgeRing * a;',
      '    accumColor += sampleVal * w;',
      '    accumAlpha += a * edgeRing;',
      '    totalWeight += w;',
      '  }',
      '  if (totalWeight > 0.0001) {',
      '    vec3 avgLin = accumColor / totalWeight;',
      '    vec3 compressed = avgLin / (vec3(1.0) + avgLin * 0.15);',
      '    vec3 finalRgb = pow(max(vec3(0.0), compressed), vec3(1.0 / 2.2));',
      '    float finalAlpha = clamp(accumAlpha / totalWeight, 0.0, 1.0);',
      '    gl_FragColor = vec4(finalRgb * finalAlpha, finalAlpha);',
      '  } else {',
      '    gl_FragColor = texture2D(u_image, v_uv);',
      '  }',
      '}'
    ].join('\n');

    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[CameraLensBlur GL] Program link error:', gl.getProgramInfoLog(prog));
      return null;
    }

    const uniforms = {
      image: gl.getUniformLocation(prog, 'u_image'),
      texelSize: gl.getUniformLocation(prog, 'u_texelSize'),
      radius: gl.getUniformLocation(prog, 'u_radius'),
      sides: gl.getUniformLocation(prog, 'u_sides'),
      curvature: gl.getUniformLocation(prog, 'u_curvature'),
      rotation: gl.getUniformLocation(prog, 'u_rotation'),
      aspectRatio: gl.getUniformLocation(prog, 'u_aspectRatio'),
      diffraction: gl.getUniformLocation(prog, 'u_diffraction'),
      gain: gl.getUniformLocation(prog, 'u_gain'),
      threshold: gl.getUniformLocation(prog, 'u_threshold'),
      fringe: gl.getUniformLocation(prog, 'u_fringe')
    };

    _progs[sampleCount] = { program: prog, uniforms: uniforms };
    return _progs[sampleCount];
  }

  function getSidesForShape(shape) {
    if (typeof shape === 'number') return shape;
    const s = String(shape || '').toLowerCase().trim();
    switch (s) {
      case 'circle': return 0.0;
      case 'triangle': return 3.0;
      case 'square': return 4.0;
      case 'pentagon': return 5.0;
      case 'hexagon': return 6.0;
      case 'heptagon': return 7.0;
      case 'octagon': return 8.0;
      case 'decagon': return 10.0;
      default: return 6.0;
    }
  }

  reg.register({
    id: 'camera-lens-blur',
    name: 'Camera Lens Blur',
    category: 'layer',
    icon: 'assets/FXPH.svg',
    description: 'Optical camera lens bokeh blur with polygonal iris blades, diffraction ring, specular highlights, and chromatic fringe',
    params: [
      { id: 'radius', label: 'Radius', type: 'number', min: 0, max: 100, default: 20, unit: 'px' },
      { id: 'irisShape', label: 'Iris Shape', type: 'select', options: ['hexagon', 'pentagon', 'octagon', 'circle', 'triangle', 'square', 'heptagon', 'decagon'], default: 'hexagon' },
      { id: 'bladeCurvature', label: 'Curvature', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'rotation', label: 'Rotation', type: 'number', min: 0, max: 360, default: 0, unit: '°' },
      { id: 'aspectRatio', label: 'Aspect Ratio', type: 'number', min: 50, max: 200, default: 100, unit: '%' },
      { id: 'diffraction', label: 'Edge Ring', type: 'number', min: 0, max: 100, default: 35, unit: '%' },
      { id: 'highlightGain', label: 'Gain', type: 'number', min: 0, max: 200, default: 75, unit: '%' },
      { id: 'highlightThreshold', label: 'Threshold', type: 'number', min: 0, max: 100, default: 50, unit: '%' },
      { id: 'chromaticAberration', label: 'Fringe', type: 'number', min: 0, max: 100, default: 20, unit: '%' },
      { id: 'quality', label: 'Quality', type: 'select', options: ['normal', 'high', 'ultra'], default: 'high' }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));

      const r = Math.max(0, fx.radius !== undefined ? Number(fx.radius) : 20);
      if (r <= 0.001) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const sides = getSidesForShape(fx.irisShape !== undefined ? fx.irisShape : 'hexagon');
      const curvature = Math.max(0, Math.min(1, (fx.bladeCurvature !== undefined ? Number(fx.bladeCurvature) : 0) / 100.0));
      const rotationRad = ((fx.rotation !== undefined ? Number(fx.rotation) : 0) % 360) * Math.PI / 180.0;
      const aspect = Math.max(0.1, (fx.aspectRatio !== undefined ? Number(fx.aspectRatio) : 100) / 100.0);
      const diffraction = Math.max(0, (fx.diffraction !== undefined ? Number(fx.diffraction) : 35) / 100.0) * 1.5;

      // Backwards compatibility with legacy bloom parameter
      const gainRaw = fx.highlightGain !== undefined ? Number(fx.highlightGain) : (fx.bloom !== undefined ? Number(fx.bloom) * 2.5 : 75);
      const gain = Math.max(0, gainRaw / 100.0);
      const threshold = Math.max(0, Math.min(1, (fx.highlightThreshold !== undefined ? Number(fx.highlightThreshold) : 50) / 100.0));
      const fringe = Math.max(0, Math.min(1, (fx.chromaticAberration !== undefined ? Number(fx.chromaticAberration) : 20) / 100.0));

      const quality = String(fx.quality || 'high').toLowerCase();
      let sampleCount = 64;
      if (quality === 'ultra') sampleCount = 96;
      else if (quality === 'normal') sampleCount = 48;

      // --- WebGL Fast Path ---
      if (!_glFailed && initGLContext()) {
        try {
          const gl = _gl;
          const progBundle = getProgramForSampleCount(gl, sampleCount);
          if (!progBundle) throw new Error('Program compilation returned null');

          const prog = progBundle.program;
          const u = progBundle.uniforms;

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
            const sw = Math.min(2048, el.videoWidth || el.naturalWidth || el.width || w);
            const sh = Math.min(2048, el.videoHeight || el.naturalHeight || el.height || h);
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

          if (!uploaded) throw new Error('CameraLensBlur texture upload failed');

          gl.uniform1i(u.image, 0);
          gl.uniform2f(u.texelSize, 1.0 / w, 1.0 / h);
          gl.uniform1f(u.radius, r);
          gl.uniform1f(u.sides, sides);
          gl.uniform1f(u.curvature, curvature);
          gl.uniform1f(u.rotation, rotationRad);
          gl.uniform1f(u.aspectRatio, aspect);
          gl.uniform1f(u.diffraction, diffraction);
          gl.uniform1f(u.gain, gain);
          gl.uniform1f(u.threshold, threshold);
          gl.uniform1f(u.fringe, fringe);

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
          console.warn('[CameraLensBlur] WebGL render error, falling back to 2D:', err);
        }
      }

      // --- Canvas 2D Fallback Path ---
      try {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = w;
        offCanvas.height = h;
        const offCtx = offCanvas.getContext('2d');
        if (!offCtx) {
          ctx.drawImage(el, x, y, w, h);
          return;
        }

        // Draw base blurred image
        if (typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.isCanvasFilterSupported === 'function' && window.FishEffects.isCanvasFilterSupported()) {
          offCtx.filter = `blur(${Math.round(r)}px)`;
          offCtx.drawImage(el, 0, 0, w, h);
          offCtx.filter = 'none';

          // Extract highlights and render multi-point aperture bokeh shapes
          if (gain > 0.05) {
            const hCanvas = document.createElement('canvas');
            hCanvas.width = Math.max(1, Math.floor(w / 2));
            hCanvas.height = Math.max(1, Math.floor(h / 2));
            const hCtx = hCanvas.getContext('2d');
            if (hCtx) {
              const bVal = 1.0 + gain * 1.5;
              const cVal = 1.0 + (threshold * 2.0);
              hCtx.filter = `brightness(${bVal.toFixed(2)}) contrast(${cVal.toFixed(2)})`;
              hCtx.drawImage(el, 0, 0, hCanvas.width, hCanvas.height);
              hCtx.filter = 'none';

              // Composite bokeh highlight pass using polygon iris distribution
              offCtx.save();
              offCtx.globalAlpha = Math.min(1.0, gain * 0.7);
              offCtx.globalCompositeOperation = 'screen';

              const stepCount = Math.max(6, Math.round(sides >= 3 ? sides : 8));
              const bokehR = r * 0.75;

              for (let s = 0; s < stepCount; s++) {
                const angle = rotationRad + (s * 2 * Math.PI / stepCount);
                const ox = Math.cos(angle) * bokehR * aspect;
                const oy = Math.sin(angle) * bokehR;
                offCtx.drawImage(hCanvas, ox, oy, w, h);
              }
              offCtx.restore();
            }
          }
        } else {
          offCtx.drawImage(el, 0, 0, w, h);
        }

        ctx.drawImage(offCanvas, x, y, w, h);
      } catch (err) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      }
    }
  });
})(typeof window !== 'undefined' ? window : this);
