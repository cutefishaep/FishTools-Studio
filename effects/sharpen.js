(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // --- WebGL GPU Engine for Boris FX Sapphire S_Sharpen ---
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

  function initSharpenGL() {
    if (_gl && _glProg) return true;
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

      const vsSource = [
        'attribute vec2 a_pos;',
        'attribute vec2 a_uv;',
        'varying vec2 v_uv;',
        'void main(void) {',
        '  v_uv = a_uv;',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n');

      // Boris FX Sapphire S_Sharpen Shader:
      // Multi-scale octave decomposition (Tiny, Small, Medium, Large)
      // Edge Thresholding to suppress dark/light halo ringing
      // Independent YCbCr Luma & Chroma frequency amplification
      const fsSource = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_image;',
        'uniform vec2 u_texelSize;',
        'uniform float u_amp;',
        'uniform float u_width;',
        'uniform float u_edgeThresh;',
        'uniform float u_scaleTiny;',
        'uniform float u_scaleSmall;',
        'uniform float u_scaleMed;',
        'uniform float u_scaleLarge;',
        'uniform float u_lumaAmp;',
        'uniform float u_chromaAmp;',
        '',
        '// ITU-R BT.601 RGB <-> YCbCr conversions',
        'vec3 rgb2ycbcr(vec3 c) {',
        '  float y  =  0.299 * c.r + 0.587 * c.g + 0.114 * c.b;',
        '  float cb = -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b;',
        '  float cr =  0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b;',
        '  return vec3(y, cb, cr);',
        '}',
        'vec3 ycbcr2rgb(vec3 ycc) {',
        '  float r = ycc.x + 1.402 * ycc.z;',
        '  float g = ycc.x - 0.344136 * ycc.y - 0.714136 * ycc.z;',
        '  float b = ycc.x + 1.772 * ycc.y;',
        '  return clamp(vec3(r, g, b), 0.0, 1.0);',
        '}',
        '',
        '// Box sample around uv at radius r',
        'vec3 sampleRadius(vec2 uv, float r) {',
        '  vec2 offset = u_texelSize * r;',
        '  vec3 c0 = texture2D(u_image, uv + vec2(-offset.x, -offset.y)).rgb;',
        '  vec3 c1 = texture2D(u_image, uv + vec2( offset.x, -offset.y)).rgb;',
        '  vec3 c2 = texture2D(u_image, uv + vec2(-offset.x,  offset.y)).rgb;',
        '  vec3 c3 = texture2D(u_image, uv + vec2( offset.x,  offset.y)).rgb;',
        '  return (c0 + c1 + c2 + c3) * 0.25;',
        '}',
        '',
        'void main(void) {',
        '  vec4 centerRGBA = texture2D(u_image, v_uv);',
        '  if (u_amp <= 0.001) {',
        '    gl_FragColor = centerRGBA;',
        '    return;',
        '  }',
        '',
        '  vec3 centerRGB = centerRGBA.rgb;',
        '  vec3 centerYCbCr = rgb2ycbcr(centerRGB);',
        '',
        '  // Multi-scale octave sampling based on sharpen width',
        '  float w = max(0.5, u_width);',
        '  vec3 bTiny  = sampleRadius(v_uv, w * 0.75);',
        '  vec3 bSmall = sampleRadius(v_uv, w * 1.5);',
        '  vec3 bMed   = sampleRadius(v_uv, w * 3.0);',
        '  vec3 bLarge = sampleRadius(v_uv, w * 6.0);',
        '',
        '  vec3 yccTiny  = rgb2ycbcr(bTiny);',
        '  vec3 yccSmall = rgb2ycbcr(bSmall);',
        '  vec3 yccMed   = rgb2ycbcr(bMed);',
        '  vec3 yccLarge = rgb2ycbcr(bLarge);',
        '',
        '  // High-frequency detail extraction per octave',
        '  float dTiny  = (centerYCbCr.x - yccTiny.x)  * u_scaleTiny;',
        '  float dSmall = (yccTiny.x     - yccSmall.x) * u_scaleSmall;',
        '  float dMed   = (yccSmall.x    - yccMed.x)   * u_scaleMed;',
        '  float dLarge = (yccMed.x      - yccLarge.x) * u_scaleLarge;',
        '',
        '  float detailY = (dTiny * 0.45 + dSmall * 0.35 + dMed * 0.15 + dLarge * 0.05);',
        '',
        '  // Sapphire Edge Thresholding: suppress dark/light halos on harsh edges',
        '  float absDiff = abs(detailY);',
        '  float haloSuppression = 1.0;',
        '  if (u_edgeThresh > 0.0001) {',
        '    haloSuppression = clamp(1.0 - max(0.0, absDiff - u_edgeThresh) / (u_edgeThresh * 1.5 + 0.001), 0.0, 1.0);',
        '  }',
        '',
        '  // Apply Luma & Chroma Sharpening',
        '  float finalY = centerYCbCr.x + detailY * u_amp * u_lumaAmp * haloSuppression;',
        '',
        '  // Chroma high frequencies',
        '  vec2 chromaDetail = (centerYCbCr.yz - yccSmall.yz) * u_amp * u_chromaAmp * haloSuppression;',
        '  vec2 finalChroma = centerYCbCr.yz + chromaDetail;',
        '',
        '  vec3 finalRGB = ycbcr2rgb(vec3(finalY, finalChroma));',
        '  gl_FragColor = vec4(finalRGB, centerRGBA.a);',
        '}'
      ].join('\n');

      function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error('[S_Sharpen GL] Shader compile error:', gl.getShaderInfoLog(s));
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
        console.error('[S_Sharpen GL] Program link error:', gl.getProgramInfoLog(prog));
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        image: gl.getUniformLocation(prog, 'u_image'),
        texelSize: gl.getUniformLocation(prog, 'u_texelSize'),
        amp: gl.getUniformLocation(prog, 'u_amp'),
        width: gl.getUniformLocation(prog, 'u_width'),
        edgeThresh: gl.getUniformLocation(prog, 'u_edgeThresh'),
        scaleTiny: gl.getUniformLocation(prog, 'u_scaleTiny'),
        scaleSmall: gl.getUniformLocation(prog, 'u_scaleSmall'),
        scaleMed: gl.getUniformLocation(prog, 'u_scaleMed'),
        scaleLarge: gl.getUniformLocation(prog, 'u_scaleLarge'),
        lumaAmp: gl.getUniformLocation(prog, 'u_lumaAmp'),
        chromaAmp: gl.getUniformLocation(prog, 'u_chromaAmp')
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
      console.warn('[S_Sharpen GL] WebGL init failed:', e);
      _glFailed = true;
      return false;
    }
  }

  reg.register({
    id: 'sharpen',
    name: 'Sharpen',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Boris FX Sapphire S_Sharpen: multi-scale detail decomposition with edge threshold halo suppression and luma/chroma separation',
    params: [
      { id: 'sharpenAmp',    label: 'Sharpen Amp',          type: 'number', min: 0,   max: 10,  default: 1.0,  step: 0.1 },
      { id: 'sharpenWidth',  label: 'Sharpen Width',        type: 'number', min: 0.1, max: 20,  default: 1.0,  step: 0.1, unit: 'px' },
      { id: 'edgeThreshold', label: 'Edge Threshold',       type: 'number', min: 0,   max: 1.0, default: 0.15, step: 0.01 },
      { id: 'scaleTiny',     label: 'Scale Tiny Details',   type: 'number', min: 0,   max: 10,  default: 3.0,  step: 0.1 },
      { id: 'scaleSmall',    label: 'Scale Small Details',  type: 'number', min: 0,   max: 10,  default: 1.5,  step: 0.1 },
      { id: 'scaleMedium',   label: 'Scale Medium Details', type: 'number', min: 0,   max: 10,  default: 1.0,  step: 0.1 },
      { id: 'scaleLarge',    label: 'Scale Large Details',  type: 'number', min: 0,   max: 10,  default: 2.0,  step: 0.1 },
      { id: 'sharpenLuma',   label: 'Sharpen Luma',         type: 'number', min: 0,   max: 3.0, default: 1.0,  step: 0.1 },
      { id: 'sharpenChroma', label: 'Sharpen Chroma',       type: 'number', min: 0,   max: 3.0, default: 0.0,  step: 0.1 }
    ],
    render(ctx, el, layer, bounds, fx) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      // Synchronize backward-compatible amount parameter
      const sharpenAmp = Math.max(0, Number(
        fx.sharpenAmp !== undefined ? fx.sharpenAmp :
        (fx.amp !== undefined ? fx.amp :
        (fx.amount !== undefined ? (Number(fx.amount) / 25.0) : 1.0))
      ));
      if (fx.sharpenAmp === undefined) fx.sharpenAmp = sharpenAmp;

      if (sharpenAmp <= 0.001) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const sharpenWidth  = Math.max(0.1, Number(fx.sharpenWidth  !== undefined ? fx.sharpenWidth  : (fx.width !== undefined ? fx.width : 1.0)));
      const edgeThreshold = Math.max(0,   Number(fx.edgeThreshold !== undefined ? fx.edgeThreshold : (fx.edge_threshold !== undefined ? fx.edge_threshold : 0.15)));
      const scaleTiny     = Math.max(0,   Number(fx.scaleTiny     !== undefined ? fx.scaleTiny     : 3.0));
      const scaleSmall    = Math.max(0,   Number(fx.scaleSmall    !== undefined ? fx.scaleSmall    : 1.5));
      const scaleMedium   = Math.max(0,   Number(fx.scaleMedium   !== undefined ? fx.scaleMedium   : 1.0));
      const scaleLarge    = Math.max(0,   Number(fx.scaleLarge    !== undefined ? fx.scaleLarge    : 2.0));
      const sharpenLuma   = Math.max(0,   Number(fx.sharpenLuma   !== undefined ? fx.sharpenLuma   : 1.0));
      const sharpenChroma = Math.max(0,   Number(fx.sharpenChroma !== undefined ? fx.sharpenChroma : 0.0));

      // --- WebGL Fast Path ---
      if (!_glFailed && initSharpenGL()) {
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

          if (!uploaded) throw new Error('Sharpen texture upload failed');
          gl.uniform1i(u.image, 0);

          gl.uniform2f(u.texelSize, 1.0 / w, 1.0 / h);
          gl.uniform1f(u.amp, sharpenAmp);
          gl.uniform1f(u.width, sharpenWidth);
          gl.uniform1f(u.edgeThresh, edgeThreshold);
          gl.uniform1f(u.scaleTiny, scaleTiny);
          gl.uniform1f(u.scaleSmall, scaleSmall);
          gl.uniform1f(u.scaleMed, scaleMedium);
          gl.uniform1f(u.scaleLarge, scaleLarge);
          gl.uniform1f(u.lumaAmp, sharpenLuma);
          gl.uniform1f(u.chromaAmp, sharpenChroma);

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
          console.warn('[S_Sharpen] WebGL render error, falling back:', err);
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

        offCtx.drawImage(el, 0, 0, w, h);
        const imgData = offCtx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const copy = new Uint8ClampedArray(d);

        const stride = w * 4;
        const k = sharpenAmp * sharpenLuma * 0.4;
        const thresh255 = edgeThreshold * 255;

        for (let py = 1; py < h - 1; py++) {
          const row = py * stride;
          for (let px = 1; px < w - 1; px++) {
            const idx = row + px * 4;

            // Center luminance
            const cy = 0.299 * copy[idx] + 0.587 * copy[idx + 1] + 0.114 * copy[idx + 2];

            // 4-point cross blur luminance
            const topY    = 0.299 * copy[idx - stride] + 0.587 * copy[idx - stride + 1] + 0.114 * copy[idx - stride + 2];
            const botY    = 0.299 * copy[idx + stride] + 0.587 * copy[idx + stride + 1] + 0.114 * copy[idx + stride + 2];
            const leftY   = 0.299 * copy[idx - 4]      + 0.587 * copy[idx - 3]          + 0.114 * copy[idx - 2];
            const rightY  = 0.299 * copy[idx + 4]      + 0.587 * copy[idx + 5]          + 0.114 * copy[idx + 6];
            const avgY = (topY + botY + leftY + rightY) * 0.25;

            const diff = cy - avgY;
            const absDiff = Math.abs(diff);

            // Edge threshold halo suppression
            let supp = 1.0;
            if (thresh255 > 0.01) {
              supp = Math.max(0, Math.min(1, 1.0 - Math.max(0, absDiff - thresh255) / (thresh255 * 1.5 + 0.001)));
            }

            const boost = diff * k * supp;
            d[idx]     = Math.max(0, Math.min(255, copy[idx]     + boost));
            d[idx + 1] = Math.max(0, Math.min(255, copy[idx + 1] + boost));
            d[idx + 2] = Math.max(0, Math.min(255, copy[idx + 2] + boost));
          }
        }

        offCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(offCanvas, x, y, w, h);
      } catch (_) {
        try { ctx.drawImage(el, x, y, w, h); } catch (e) {}
      }
    }
  });
})(typeof window !== 'undefined' ? window : this);
