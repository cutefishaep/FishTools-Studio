(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // --- WebGL GPU Engine for Spiral Glow Aura ---
  let _glCanvas = null;
  let _gl = null;
  let _auraProg = null;
  let _posBuf = null;
  let _uni = null;
  let _glFailed = false;

  const MAX_BLOBS = 16;

  function initGL() {
    if (_gl && _auraProg) return true;
    if (_glFailed || typeof document === 'undefined') return false;

    try {
      if (!_glCanvas) _glCanvas = document.createElement('canvas');
      const opts = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true };
      const gl = _glCanvas.getContext('webgl2', opts) ||
                 _glCanvas.getContext('webgl', opts) ||
                 _glCanvas.getContext('experimental-webgl', opts);
      if (!gl) { _glFailed = true; return false; }
      _gl = gl;

      const vs = [
        'attribute vec2 a_pos;',
        'void main(void) {',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n');

      // Boris FX Sapphire S_GlowAura WebGL Shader:
      // 1. Geometric coordinate twirl bends wavefronts into dramatic Archimedean spirals.
      // 2. Smooth Euclidean rounded-box SDF eliminates Chebyshev tile creases.
      // 3. Aura renders IN FRONT across the layer surface and radiates outward into space.
      // 4. Liquid phasor superposition merges multiple whirlpools seamlessly without blowout.
      const fs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'uniform vec2 u_resolution;',
        'uniform int u_numBlobs;',
        'uniform vec4 u_blobs[' + MAX_BLOBS + '];', // x, y, hw, hh in buffer pixels
        'uniform float u_blobBright[' + MAX_BLOBS + '];',
        'uniform float u_glowWidth;',
        'uniform float u_twist;',
        'uniform float u_frequency;',
        'uniform float u_intensity;',
        'uniform float u_animPhase;',
        'void main(void) {',
        '  vec2 pt = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);',
        '  float minDist = 99999.0;',
        '  float sumX = 0.0;',
        '  float sumY = 0.0;',
        '  float totalWeight = 0.0;',
        '  for (int i = 0; i < ' + MAX_BLOBS + '; i++) {',
        '    if (i >= u_numBlobs) break;',
        '    vec4 b = u_blobs[i];',
        '    float bBright = u_blobBright[i];',
        '    vec2 d = pt - b.xy;',
        '    float r = length(d);',
        '    float theta = atan(d.y, d.x);',
        '    // Spatial twist: normalized gentle curvature independent of glowWidth',
        '    float twist_angle = u_twist * (r * 0.0016) * bBright;',
        '    float theta_un = theta - twist_angle;',
        '    vec2 un = b.xy + r * vec2(cos(theta_un), sin(theta_un));',
        '    // Smooth Euclidean rounded-box SDF (zero Chebyshev tile creases)',
        '    float rc = min(16.0, min(b.z, b.w) * 0.4);',
        '    vec2 q = abs(un - b.xy) - max(vec2(0.0), b.zw - vec2(rc));',
        '    float dist = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - rc;',
        '    if (dist < minDist) {',
        '      minDist = dist;',
        '    }',
        '    if (dist > u_glowWidth) continue;',
        '    // Wave phase propagation: spatial frequency is decoupled from glowWidth reach',
        '    float phi = 6.2831853 * (u_frequency * 0.01) * dist - u_animPhase;',
        '    float norm = clamp(1.0 - (max(0.0, dist) / u_glowWidth), 0.0, 1.0);',
        '    float w = norm * norm * bBright;',
        '    sumX += w * cos(phi);',
        '    sumY += w * sin(phi);',
        '    totalWeight += w;',
        '  }',
        '  if (totalWeight <= 0.0001 || minDist > u_glowWidth) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  // IN FRONT: Full intensity across layer surface, smooth cosine falloff outside',
        '  float T = clamp(max(0.0, minDist) / u_glowWidth, 0.0, 1.0);',
        '  float falloff = pow(cos(T * 1.5707963), 1.35) * u_intensity;',
        '  if (falloff <= 0.001) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '  // Combined fluid wave phase from interfering whirlpools',
        '  float combinedPhase = atan(sumY, sumX);',
        '  // Boris FX Sapphire S_GlowAura color wave formula (warm gold/orange -> white -> cyan/blue)',
        '  vec3 col = 0.5 + 0.5 * cos(vec3(combinedPhase) + vec3(1.2566, 0.6283, 0.0));',
        '  gl_FragColor = vec4(col * falloff, falloff);',
        '}'
      ].join('\n');

      function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
      }

      const vsShader = compile(gl.VERTEX_SHADER, vs);
      const fsShader = compile(gl.FRAGMENT_SHADER, fs);
      if (!vsShader || !fsShader) { _glFailed = true; return false; }

      const prog = gl.createProgram();
      gl.attachShader(prog, vsShader);
      gl.attachShader(prog, fsShader);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { _glFailed = true; return false; }
      _auraProg = prog;

      _uni = {
        resolution: gl.getUniformLocation(prog, 'u_resolution'),
        numBlobs: gl.getUniformLocation(prog, 'u_numBlobs'),
        blobs: gl.getUniformLocation(prog, 'u_blobs'),
        blobBright: gl.getUniformLocation(prog, 'u_blobBright'),
        glowWidth: gl.getUniformLocation(prog, 'u_glowWidth'),
        twist: gl.getUniformLocation(prog, 'u_twist'),
        frequency: gl.getUniformLocation(prog, 'u_frequency'),
        intensity: gl.getUniformLocation(prog, 'u_intensity'),
        animPhase: gl.getUniformLocation(prog, 'u_animPhase')
      };

      _posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      return true;
    } catch (_) {
      _glFailed = true;
      return false;
    }
  }

  // Offscreen canvas for analyzing bright object clusters
  let _analysisCanvas = null;
  let _analysisCtx = null;

  function findBrightBlobs(el, targetW, targetH, thresholdNorm, pad) {
    const AW = 160;
    const AH = Math.max(16, Math.round((targetH / targetW) * AW));
    if (!_analysisCanvas) {
      _analysisCanvas = document.createElement('canvas');
      _analysisCtx = _analysisCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (_analysisCanvas.width !== AW || _analysisCanvas.height !== AH) {
      _analysisCanvas.width = AW;
      _analysisCanvas.height = AH;
    }
    _analysisCtx.clearRect(0, 0, AW, AH);
    try {
      _analysisCtx.drawImage(el, 0, 0, AW, AH);
    } catch (_) {
      return [];
    }

    let imgData;
    try {
      imgData = _analysisCtx.getImageData(0, 0, AW, AH);
    } catch (_) {
      return [];
    }
    const data = imgData.data;
    const threshVal = thresholdNorm * 255;
    const visited = new Uint8Array(AW * AH);

    const blobs = [];
    const scaleX = targetW / AW;
    const scaleY = targetH / AH;

    for (let y = 0; y < AH; y += 2) {
      for (let x = 0; x < AW; x += 2) {
        const idx = y * AW + x;
        if (visited[idx]) continue;
        const p = idx * 4;
        const a = data[p + 3];
        if (a < 30) continue;
        const lum = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
        if (lum < threshVal) continue;

        // BFS to find connected bright region
        const q = [x, y];
        visited[idx] = 1;
        let count = 0, sumLum = 0;
        let minX = x, maxX = x, minY = y, maxY = y;

        while (q.length > 0) {
          const cy = q.pop();
          const cx = q.pop();
          count++;
          const cLum = 0.2126 * data[(cy * AW + cx) * 4] + 0.7152 * data[(cy * AW + cx) * 4 + 1] + 0.0722 * data[(cy * AW + cx) * 4 + 2];
          sumLum += cLum;

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const neighbors = [cx - 2, cy, cx + 2, cy, cx, cy - 2, cx, cy + 2];
          for (let ni = 0; ni < 8; ni += 2) {
            const nx = neighbors[ni];
            const ny = neighbors[ni + 1];
            if (nx >= 0 && nx < AW && ny >= 0 && ny < AH) {
              const nIdx = ny * AW + nx;
              if (!visited[nIdx]) {
                const np = nIdx * 4;
                if (data[np + 3] >= 30) {
                  const nLum = 0.2126 * data[np] + 0.7152 * data[np + 1] + 0.0722 * data[np + 2];
                  if (nLum >= threshVal) {
                    visited[nIdx] = 1;
                    q.push(nx, ny);
                  }
                }
              }
            }
          }
        }

        if (count >= 4) {
          // Exact geometric bounding center: GUARANTEES zero offset between aura and layer
          const centerX = ((minX + maxX) / 2) * scaleX + pad;
          const centerY = ((minY + maxY) / 2) * scaleY + pad;
          const halfW = Math.max(4, ((maxX - minX) / 2) * scaleX);
          const halfH = Math.max(4, ((maxY - minY) / 2) * scaleY);
          const avgBright = Math.min(1.0, Math.max(0.2, (sumLum / (count * 255))));
          blobs.push({ cx: centerX, cy: centerY, hw: halfW, hh: halfH, brightness: avgBright, area: count });
          if (blobs.length >= MAX_BLOBS * 2) break;
        }
      }
      if (blobs.length >= MAX_BLOBS * 2) break;
    }

    // Sort by area descending
    blobs.sort((a, b) => b.area - a.area);

    // Filter out duplicate bounding boxes while preserving distinct child buttons and multiple centers
    const filtered = [];
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      let isDuplicate = false;
      for (let j = 0; j < filtered.length; j++) {
        const p = filtered[j];
        if (Math.abs(p.cx - b.cx) < 8 && Math.abs(p.cy - b.cy) < 8 &&
            Math.abs(p.hw - b.hw) < 8 && Math.abs(p.hh - b.hh) < 8) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        filtered.push(b);
      }
    }

    const result = filtered.slice(0, MAX_BLOBS);

    // If no distinct blobs found, fall back to center of target layer
    if (result.length === 0) {
      result.push({
        cx: targetW / 2 + pad,
        cy: targetH / 2 + pad,
        hw: targetW * 0.5,
        hh: targetH * 0.5,
        brightness: 1.0,
        area: 1
      });
    }
    return result;
  }

  reg.register({
    id: 'glow-aura',
    name: 'Glow Aura',
    category: 'layer',
    isExpanding: true,
    icon: 'assets/FXPH.svg',
    description: 'Boris FX Sapphire S_GlowAura: rotating rainbow spiral pinwheels centered on bright objects with liquid wavefront merging',
    params: [
      { id: 'glowWidth', label: 'Glow Width', type: 'number', min: 5,   max: 400, default: 58,  unit: 'px' },
      { id: 'speed',     label: 'Speed',      type: 'number', min: -10, max: 10,  default: 2.0, step: 0.1 },
      { id: 'twist',     label: 'Twist',      type: 'number', min: -10, max: 10,  default: 5.0, step: 0.1 },
      { id: 'frequency', label: 'Frequency',  type: 'number', min: 0.5, max: 30,  default: 5.5, step: 0.5 },
      { id: 'threshold', label: 'Threshold',  type: 'number', min: 0,   max: 100, default: 49,  unit: '%' },
      { id: 'intensity', label: 'Intensity',  type: 'number', min: 0,   max: 200, default: 121, unit: '%' },
      { id: 'blendMode', label: 'Blend',      type: 'select', options: ['screen', 'lighter', 'source-over'], default: 'screen' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w  = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width  : 500));
      const h  = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      // Extract playback time for continuous speed/twist animation
      const curSec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : (layer && typeof layer._currentSec === 'number'
          ? layer._currentSec
          : (typeof window !== 'undefined'
            ? (typeof window._currentRenderSec === 'number' && !isNaN(window._currentRenderSec)
              ? window._currentRenderSec
              : (window.currentPlaybackSec !== undefined ? window.currentPlaybackSec : (window.currentSec || 0)))
            : 0));

      // Synchronize parameter aliases (glowWidth <-> radius <-> thick)
      const glowWidth = Math.max(5, Number(
        fx.glowWidth !== undefined ? fx.glowWidth :
        (fx.radius !== undefined ? fx.radius :
        (fx.thick !== undefined ? fx.thick :
        (fx.thickness !== undefined ? fx.thickness : 58)))
      ));
      if (fx.glowWidth === undefined) fx.glowWidth = glowWidth;
      if (fx.radius === undefined) fx.radius = glowWidth;

      const speed     = Number(fx.speed !== undefined ? fx.speed : (fx.phaseSpeed !== undefined ? fx.phaseSpeed : (fx.twistSpeed !== undefined ? fx.twistSpeed : 2.0)));
      const twist     = Math.max(-10, Math.min(10, Number(fx.twist !== undefined ? fx.twist : (fx.twirl !== undefined ? fx.twirl / 50 : 5.0))));
      const frequency = Math.max(0.2, Number(fx.frequency !== undefined ? fx.frequency : 5.5));
      const threshold = Math.max(0, Math.min(1, Number(fx.threshold !== undefined ? fx.threshold : 49) / 100));
      const intensity = Math.max(0, Math.min(3, Number(fx.intensity !== undefined ? fx.intensity : (fx.brightness !== undefined ? fx.brightness : 121)) / 100));
      const blend     = fx.blendMode || 'screen';

      const animPhase = speed * curSec * 6.2831853;

      // Always draw base layer first
      try { ctx.drawImage(el, bx, by, w, h); } catch (_) {}
      if (intensity <= 0.001) return;

      // Determine padding:
      // If adjustment layer or full-screen layer, the canvas already contains the surrounding space (pad = 0)
      const isFullCanvas = (layer && layer.type === 'adjustment') || (bx === 0 && by === 0 && ctx.canvas && w >= ctx.canvas.width * 0.9);
      const pad = isFullCanvas ? 0 : Math.ceil(glowWidth * 1.5 + 24);
      const bw  = Math.round(w + pad * 2);
      const bh  = Math.round(h + pad * 2);

      // Detect bright blobs / centers mapped into buffer coordinates
      const blobs = findBrightBlobs(el, w, h, threshold, pad);
      if (!blobs || blobs.length === 0) return;

      // --- WebGL Fast Path ---
      if (!_glFailed && initGL()) {
        try {
          const gl = _gl;
          if (_glCanvas.width !== bw || _glCanvas.height !== bh) {
            _glCanvas.width = bw;
            _glCanvas.height = bh;
          }

          gl.viewport(0, 0, bw, bh);
          gl.useProgram(_auraProg);

          const pl = gl.getAttribLocation(_auraProg, 'a_pos');
          gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
          gl.enableVertexAttribArray(pl);
          gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);

          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);

          // Pack blob uniforms
          const blobData = new Float32Array(MAX_BLOBS * 4);
          const blobBright = new Float32Array(MAX_BLOBS);
          for (let i = 0; i < blobs.length && i < MAX_BLOBS; i++) {
            blobData[i * 4 + 0] = blobs[i].cx;
            blobData[i * 4 + 1] = blobs[i].cy;
            blobData[i * 4 + 2] = blobs[i].hw;
            blobData[i * 4 + 3] = blobs[i].hh;
            blobBright[i]       = blobs[i].brightness;
          }

          gl.uniform2f(_uni.resolution, bw, bh);
          gl.uniform1i(_uni.numBlobs, Math.min(blobs.length, MAX_BLOBS));
          gl.uniform4fv(_uni.blobs, blobData);
          gl.uniform1fv(_uni.blobBright, blobBright);
          gl.uniform1f(_uni.glowWidth, glowWidth);
          gl.uniform1f(_uni.twist, twist);
          gl.uniform1f(_uni.frequency, frequency);
          gl.uniform1f(_uni.intensity, intensity);
          gl.uniform1f(_uni.animPhase, animPhase);

          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // Composite aura ON TOP (IN FRONT) of base layer with blend mode (screen / lighter)
          ctx.save();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.globalCompositeOperation = blend !== 'normal' ? blend : 'screen';
          ctx.globalAlpha = 1.0;
          try {
            ctx.drawImage(_glCanvas, bx - pad, by - pad, bw, bh);
          } catch (_) {}
          ctx.restore();
          return;
        } catch (e) {
          console.warn('[GlowAura] WebGL render error:', e);
        }
      }

      // --- Canvas 2D Fallback Path ---
      const offCanvas = document.createElement('canvas');
      offCanvas.width = bw;
      offCanvas.height = bh;
      const offCtx = offCanvas.getContext('2d');
      if (!offCtx) return;

      const imgData = offCtx.createImageData(bw, bh);
      const d = imgData.data;

      // Unified liquid wave phasor combination across pixels
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          let minDist = 99999.0;
          let sumX = 0.0;
          let sumY = 0.0;
          let totalWeight = 0.0;

          for (let i = 0; i < blobs.length && i < MAX_BLOBS; i++) {
            const b = blobs[i];
            const dx = x - b.cx;
            const dy = y - b.cy;
            const r = Math.hypot(dx, dy);
            const theta = Math.atan2(dy, dx);

            // Spatial twist: normalized gentle curvature independent of glowWidth
            const twist_angle = twist * (r * 0.0016) * b.brightness;
            const theta_un = theta - twist_angle;
            const ux = b.cx + r * Math.cos(theta_un);
            const uy = b.cy + r * Math.sin(theta_un);

            const rc = Math.min(16, Math.min(b.hw, b.hh) * 0.4);
            const qx = Math.max(0, Math.abs(ux - b.cx) - Math.max(0, b.hw - rc));
            const qy = Math.max(0, Math.abs(uy - b.cy) - Math.max(0, b.hh - rc));
            const dist = Math.hypot(qx, qy) - rc;

            if (dist < minDist) minDist = dist;
            if (dist > glowWidth) continue;

            const phi = 2.0 * Math.PI * (frequency * 0.01) * dist - animPhase;
            const norm = Math.max(0, Math.min(1, 1.0 - (Math.max(0, dist) / glowWidth)));
            const w = norm * norm * b.brightness;

            sumX += w * Math.cos(phi);
            sumY += w * Math.sin(phi);
            totalWeight += w;
          }

          if (totalWeight > 0.0001 && minDist <= glowWidth) {
            const T = Math.max(0, Math.min(1, Math.max(0, minDist) / glowWidth));
            const falloff = Math.pow(Math.cos(T * Math.PI * 0.5), 1.35) * intensity;

            if (falloff > 0.001) {
              const combinedPhase = Math.atan2(sumY, sumX);
              const cr = 0.5 + 0.5 * Math.cos(combinedPhase + 1.2566);
              const cg = 0.5 + 0.5 * Math.cos(combinedPhase + 0.6283);
              const cb = 0.5 + 0.5 * Math.cos(combinedPhase);

              const pIdx = (y * bw + x) * 4;
              d[pIdx]     = Math.min(255, cr * falloff * 255);
              d[pIdx + 1] = Math.min(255, cg * falloff * 255);
              d[pIdx + 2] = Math.min(255, cb * falloff * 255);
              d[pIdx + 3] = Math.min(255, falloff * 255);
            }
          }
        }
      }

      offCtx.putImageData(imgData, 0, 0);

      ctx.save();
      ctx.globalCompositeOperation = blend !== 'normal' ? blend : 'screen';
      ctx.globalAlpha = 1.0;
      try {
        ctx.drawImage(offCanvas, bx - pad, by - pad, bw, bh);
      } catch (_) {}
      ctx.restore();
    }
  });
})(typeof window !== 'undefined' ? window : this);
