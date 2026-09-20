(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // WebGL hardware acceleration pipeline state
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
    'uniform vec2 u_center;',
    'uniform float u_amount;',
    'uniform float u_redShift;',
    'uniform float u_blueShift;',
    'uniform float u_falloff;',
    'uniform float u_aspect;',
    '',
    'void main(void) {',
    '  vec2 d = v_uv - u_center;',
    '  vec2 dAspect = vec2(d.x * u_aspect, d.y);',
    '  float distSq = dot(dAspect, dAspect);',
    '',
    '  vec2 maxD = vec2(max(u_center.x, 1.0 - u_center.x) * u_aspect, max(u_center.y, 1.0 - u_center.y));',
    '  float maxDistSq = max(0.0001, dot(maxD, maxD));',
    '  float rSq = clamp(distSq / maxDistSq, 0.0, 1.0);',
    '',
    '  // Falloff: blend between uniform (1.0) and edge-weighted (rSq)',
    '  float weight = mix(1.0, rSq, u_falloff);',
    '',
    '  float ca = u_amount * 0.8 * weight;',
    '  float sR = 1.0 - u_redShift * ca;',
    '  float sB = 1.0 - u_blueShift * ca;',
    '',
    '  vec2 uvR = clamp(u_center + d * sR, 0.0, 1.0);',
    '  vec2 uvG = v_uv;',
    '  vec2 uvB = clamp(u_center + d * sB, 0.0, 1.0);',
    '',
    '  vec4 colR = texture2D(u_image, uvR);',
    '  vec4 colG = texture2D(u_image, uvG);',
    '  vec4 colB = texture2D(u_image, uvB);',
    '',
    '  float alpha = max(colG.a, max(colR.a, colB.a));',
    '  gl_FragColor = vec4(colR.r, colG.g, colB.b, alpha);',
    '}'
  ].join('\n');

  function initCAGL() {
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
          console.error('[ChromaticAberration GL] Compile error:', gl.getShaderInfoLog(s));
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
        console.error('[ChromaticAberration GL] Link error:', gl.getProgramInfoLog(prog));
        _glFailed = true;
        return false;
      }

      _glProg = prog;
      _glUniforms = {
        image: gl.getUniformLocation(prog, 'u_image'),
        center: gl.getUniformLocation(prog, 'u_center'),
        amount: gl.getUniformLocation(prog, 'u_amount'),
        redShift: gl.getUniformLocation(prog, 'u_redShift'),
        blueShift: gl.getUniformLocation(prog, 'u_blueShift'),
        falloff: gl.getUniformLocation(prog, 'u_falloff'),
        aspect: gl.getUniformLocation(prog, 'u_aspect')
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
      console.warn('[ChromaticAberration GL] Init failed, falling back to Canvas 2D:', e);
      _glFailed = true;
      return false;
    }
  }

  // Module-level cached Canvas 2D offscreen buffer for fallback processing
  let _offCanvas = null;
  let _offCtx = null;

  function getOffscreenBuffer(w, h) {
    if (typeof document === 'undefined') return null;
    if (!_offCanvas) {
      _offCanvas = document.createElement('canvas');
      _offCtx = _offCanvas.getContext('2d', { willReadFrequently: true }) || _offCanvas.getContext('2d');
    }
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    if (_offCanvas.width !== rw || _offCanvas.height !== rh) {
      _offCanvas.width = rw;
      _offCanvas.height = rh;
    }
    return { canvas: _offCanvas, ctx: _offCtx };
  }

  // Bilinear interpolation channel sampler with safe boundary clamping
  function sampleChannelBilinear(src, pw, ph, sx, sy, ch) {
    if (sx < 0) sx = 0;
    else if (sx > pw - 1) sx = pw - 1;
    if (sy < 0) sy = 0;
    else if (sy > ph - 1) sy = ph - 1;

    const x0 = sx | 0;
    const y0 = sy | 0;
    const x1 = x0 < pw - 1 ? x0 + 1 : x0;
    const y1 = y0 < ph - 1 ? y0 + 1 : y0;

    const fx = sx - x0;
    const fy = sy - y0;

    const r0 = y0 * pw;
    const r1 = y1 * pw;

    const c00 = src[(r0 + x0) * 4 + ch];
    const c10 = src[(r0 + x1) * 4 + ch];
    const c01 = src[(r1 + x0) * 4 + ch];
    const c11 = src[(r1 + x1) * 4 + ch];

    const top = c00 + (c10 - c00) * fx;
    const bot = c01 + (c11 - c01) * fx;
    return top + (bot - top) * fy;
  }

  reg.register({
    id: 'chromatic-aberration',
    name: 'Chromatic Aberration',
    category: 'lightning',
    icon: 'assets/FXPH.svg',
    description: 'Realistic radial lens chromatic aberration with edge-weighted color fringing',
    params: [
      { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, default: 15 },
      { id: 'redShift', label: 'Red Shift', type: 'number', min: -50, max: 50, default: 3 },
      { id: 'blueShift', label: 'Blue Shift', type: 'number', min: -50, max: 50, default: -3 },
      { id: 'falloff', label: 'Falloff', type: 'number', min: 0, max: 100, default: 70, unit: '%' },
      { id: 'centerX', label: 'Center X', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
      { id: 'centerY', label: 'Center Y', type: 'number', min: -100, max: 100, default: 0, unit: '%' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      const amount = Math.max(0, Math.min(100, fx && fx.amount !== undefined ? Number(fx.amount) : 15));
      const redShift = Math.max(-50, Math.min(50, fx && fx.redShift !== undefined ? Number(fx.redShift) : 3));
      const blueShift = Math.max(-50, Math.min(50, fx && fx.blueShift !== undefined ? Number(fx.blueShift) : -3));
      const falloff = Math.max(0, Math.min(100, fx && fx.falloff !== undefined ? Number(fx.falloff) : 70));
      const centerX = Math.max(-100, Math.min(100, fx && fx.centerX !== undefined ? Number(fx.centerX) : 0));
      const centerY = Math.max(-100, Math.min(100, fx && fx.centerY !== undefined ? Number(fx.centerY) : 0));

      // If no chromatic aberration strength or channel shifts, draw base image directly
      if (amount <= 0.001 || (Math.abs(redShift) <= 0.001 && Math.abs(blueShift) <= 0.001)) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      // 1. Primary Hardware Acceleration: WebGL Shader Pipeline (< 0.2ms)
      if (!_glFailed && initCAGL()) {
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

          if (!uploaded) throw new Error('CA texture upload failed');
          gl.uniform1i(u.image, 0);

          const uvCenterX = 0.5 + (centerX / 100) * 0.5;
          const uvCenterY = 0.5 + (centerY / 100) * 0.5;
          gl.uniform2f(u.center, uvCenterX, uvCenterY);
          gl.uniform1f(u.amount, amount / 100);
          gl.uniform1f(u.redShift, redShift / 100);
          gl.uniform1f(u.blueShift, blueShift / 100);
          gl.uniform1f(u.falloff, falloff / 100);
          gl.uniform1f(u.aspect, w / h);

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
        } catch (glErr) {
          console.warn('[ChromaticAberration] WebGL execution failed, using Canvas 2D fallback:', glErr);
        }
      }

      // 2. High-Performance Canvas 2D Pixel Manipulation Fallback
      // Performance optimization: constrain max processing dimension to 1280px for 60fps responsiveness
      const maxDim = 1280;
      let pw = w;
      let ph = h;
      if (pw > maxDim || ph > maxDim) {
        const s = Math.min(maxDim / pw, maxDim / ph);
        pw = Math.max(1, Math.round(pw * s));
        ph = Math.max(1, Math.round(ph * s));
      }

      const buf = getOffscreenBuffer(pw, ph);
      if (!buf || !buf.ctx) {
        try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
        return;
      }

      const bCtx = buf.ctx;
      bCtx.clearRect(0, 0, pw, ph);

      // Step 1: Draw source to offscreen buffer and get ImageData
      try {
        bCtx.drawImage(el, 0, 0, pw, ph);
      } catch (_) {
        return;
      }

      const srcImgData = bCtx.getImageData(0, 0, pw, ph);
      const src = srcImgData.data;
      const dstImgData = bCtx.createImageData(pw, ph);
      const dst = dstImgData.data;

      // Optical center in pixel coordinates
      const cx = pw * 0.5 + (centerX / 100) * (pw * 0.5);
      const cy = ph * 0.5 + (centerY / 100) * (ph * 0.5);
      const aspect = pw / ph;

      // Step 2 & 3: Distance and falloff calculation
      const maxDx = Math.max(cx, pw - cx) * aspect;
      const maxDy = Math.max(cy, ph - cy);
      const maxDistSq = Math.max(1, maxDx * maxDx + maxDy * maxDy);
      const invMaxDistSq = 1.0 / maxDistSq;

      const fo = falloff / 100;
      const invFo = 1.0 - fo;
      const caBase = (amount / 100) * 0.8;
      const redShiftFactor = redShift / 100;
      const blueShiftFactor = blueShift / 100;

      // Pixel manipulation loop with typed arrays
      for (let py = 0; py < ph; py++) {
        const dy = py - cy;
        const dySq = dy * dy;
        const rowOffset = py * pw;

        for (let px = 0; px < pw; px++) {
          const dx = px - cx;
          const dxAspect = dx * aspect;
          const distSq = dxAspect * dxAspect + dySq;
          const rSq = Math.min(1.0, distSq * invMaxDistSq);
          const weight = invFo + fo * rSq;
          const ca = caBase * weight;

          const sR = 1.0 - redShiftFactor * ca;
          const sB = 1.0 - blueShiftFactor * ca;

          const sRx = cx + dx * sR;
          const sRy = cy + dy * sR;
          const sBx = cx + dx * sB;
          const sBy = cy + dy * sB;

          const idx = (rowOffset + px) * 4;

          // Step 4: Sample red channel from radial scaled position
          dst[idx] = sampleChannelBilinear(src, pw, ph, sRx, sRy, 0);

          // Step 5: Keep green channel at original position
          dst[idx + 1] = src[idx + 1];

          // Step 6: Sample blue channel from opposite scaled position
          dst[idx + 2] = sampleChannelBilinear(src, pw, ph, sBx, sBy, 2);

          // Alpha compositing
          const aG = src[idx + 3];
          if (aG === 255) {
            dst[idx + 3] = 255;
          } else {
            const aR = sampleChannelBilinear(src, pw, ph, sRx, sRy, 3);
            const aB = sampleChannelBilinear(src, pw, ph, sBx, sBy, 3);
            dst[idx + 3] = Math.max(aG, Math.max(aR, aB));
          }
        }
      }

      // Step 7: Write result back to offscreen buffer
      bCtx.putImageData(dstImgData, 0, 0);

      // Step 8: Draw result to main ctx
      try {
        ctx.drawImage(buf.canvas, x, y, w, h);
      } catch (_) {}
    }
  });
})(typeof window !== 'undefined' ? window : this);
