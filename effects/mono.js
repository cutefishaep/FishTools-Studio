(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  function hexToRgb(hex) {
    let c = (hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

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

  function initMonoGL() {
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
        'uniform float u_intensity;',
        'uniform float u_tintAmt;',
        'uniform vec3 u_tintRgb;',
        'uniform float u_contrast;',
        'uniform float u_brightness;',
        '',
        'void main(void) {',
        '  vec4 color = texture2D(u_image, v_uv);',
        '  if (color.a <= 0.0001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  vec3 rgb = color.rgb / color.a;',
        '  float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));',
        '  vec3 m = mix(rgb, vec3(lum), u_intensity);',
        '  if (u_tintAmt > 0.0) {',
        '    m = mix(m, vec3(lum) * u_tintRgb, u_tintAmt);',
        '  }',
        '  if (u_contrast != 0.0) {',
        '    float cFactor = (259.0 * (u_contrast * 255.0 + 255.0)) / max(1.0, 255.0 * (259.0 - u_contrast * 255.0));',
        '    m = cFactor * (m - 0.5) + 0.5;',
        '  }',
        '  if (u_brightness != 0.0) {',
        '    m += u_brightness / 255.0;',
        '  }',
        '  m = clamp(m, 0.0, 1.0);',
        '  gl_FragColor = vec4(m * color.a, color.a);',
        '}'
      ].join('\n');

      function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
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
        intensity: gl.getUniformLocation(prog, 'u_intensity'),
        tintAmt: gl.getUniformLocation(prog, 'u_tintAmt'),
        tintRgb: gl.getUniformLocation(prog, 'u_tintRgb'),
        contrast: gl.getUniformLocation(prog, 'u_contrast'),
        brightness: gl.getUniformLocation(prog, 'u_brightness')
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

  let offCanvas = null;
  let offCtx = null;

  reg.register({
    id: 'mono',
    name: 'Mono',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Black & White monochrome with optional duotone tint, contrast, and brightness',
    params: [
      { id: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, default: 100, unit: '%' },
      { id: 'tintColor', label: 'Tint Color', type: 'color', default: '#ffffff' },
      { id: 'tintAmount', label: 'Tint Amount', type: 'number', min: 0, max: 100, default: 0, unit: '%' },
      { id: 'contrast', label: 'Contrast', type: 'number', min: -100, max: 100, default: 0 },
      { id: 'brightness', label: 'Brightness', type: 'number', min: -100, max: 100, default: 0 }
    ],
    filter(fx) {
      const tintAmt = fx.tintAmount !== undefined ? fx.tintAmount : 0;
      if (tintAmt <= 0 && !fx.contrast && !fx.brightness) {
        const intensity = fx.intensity !== undefined ? fx.intensity : 100;
        return `grayscale(${intensity}%)`;
      }
      return '';
    },
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 500));
      const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const intensity = Math.max(0, Math.min(1, (fx.intensity !== undefined ? fx.intensity : 100) / 100));
      const tintAmt = Math.max(0, Math.min(1, (fx.tintAmount !== undefined ? fx.tintAmount : 0) / 100));
      const tintRgb = hexToRgb(fx.tintColor || '#ffffff');
      const contrast = (fx.contrast || 0) / 100;
      const brightness = (fx.brightness || 0);

      // Identity pass
      if (intensity <= 0.001 && tintAmt <= 0.001 && contrast === 0 && brightness === 0) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      // Fast GPU WebGL Pass
      if (!_glFailed && initMonoGL()) {
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

          if (uploaded) {
            gl.uniform1i(u.image, 0);
            gl.uniform1f(u.intensity, intensity);
            gl.uniform1f(u.tintAmt, tintAmt);
            gl.uniform3f(u.tintRgb, tintRgb[0] / 255, tintRgb[1] / 255, tintRgb[2] / 255);
            gl.uniform1f(u.contrast, contrast);
            gl.uniform1f(u.brightness, brightness);

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
        } catch (glErr) {}
      }

      // Fast path: pure grayscale with no tint/contrast (only if browser supports ctx.filter)
      if (tintAmt <= 0 && contrast === 0 && brightness === 0 && typeof window !== 'undefined' && window.FishEffects && typeof window.FishEffects.isCanvasFilterSupported === 'function' && window.FishEffects.isCanvasFilterSupported()) {
        ctx.save();
        ctx.filter = `grayscale(${Math.round(intensity * 100)}%)`;
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        ctx.restore();
        return;
      }

      // Buffer for pixel tint/contrast processing
      if (!offCanvas) {
        offCanvas = document.createElement('canvas');
        offCtx = offCanvas.getContext('2d');
      }
      const pw = Math.min(1280, Math.round(w));
      const ph = Math.min(720, Math.round(h));
      if (offCanvas.width !== pw || offCanvas.height !== ph) {
        offCanvas.width = pw;
        offCanvas.height = ph;
      }
      offCtx.clearRect(0, 0, pw, ph);
      try {
        offCtx.drawImage(el, 0, 0, pw, ph);
      } catch (_) {
        return;
      }

      const imgData = offCtx.getImageData(0, 0, pw, ph);
      const d = imgData.data;
      const len = d.length;

      const cFactor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
      const tr = tintRgb[0] / 255;
      const tg = tintRgb[1] / 255;
      const tb = tintRgb[2] / 255;

      for (let i = 0; i < len; i += 4) {
        const a = d[i + 3];
        if (a === 0) continue;

        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        // Rec. 709 Luminance
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Blend with original colors by intensity
        let mr = r + (lum - r) * intensity;
        let mg = g + (lum - g) * intensity;
        let mb = b + (lum - b) * intensity;

        // Apply tint
        if (tintAmt > 0) {
          mr = mr * (1 - tintAmt) + (lum * tr) * tintAmt;
          mg = mg * (1 - tintAmt) + (lum * tg) * tintAmt;
          mb = mb * (1 - tintAmt) + (lum * tb) * tintAmt;
        }

        // Apply contrast & brightness
        if (contrast !== 0) {
          mr = cFactor * (mr - 128) + 128;
          mg = cFactor * (mg - 128) + 128;
          mb = cFactor * (mb - 128) + 128;
        }
        if (brightness !== 0) {
          mr += brightness;
          mg += brightness;
          mb += brightness;
        }

        d[i] = Math.max(0, Math.min(255, mr));
        d[i + 1] = Math.max(0, Math.min(255, mg));
        d[i + 2] = Math.max(0, Math.min(255, mb));
      }

      offCtx.putImageData(imgData, 0, 0);

      ctx.save();
      try {
        ctx.drawImage(offCanvas, x, y, w, h);
      } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
