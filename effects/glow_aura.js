(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // WebGL GPU Engine for Boris FX Sapphire S_GlowAura
  let _glCanvas = null;
  let _gl = null;
  let _auraProg = null;
  let _posBuf = null;
  let _uvBuf = null;
  let _rawTex = null;
  let _blurTex = null;
  let _uni = null;
  let _glFailed = false;

  // Offscreen canvas pool for GPU texture generation
  let _maskCanvas = null;
  let _maskCtx = null;
  let _blurCanvas = null;
  let _blurCtx = null;
  let _fallbackCanvas = null;
  let _fallbackCtx = null;

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
        'attribute vec2 a_uv;',
        'varying vec2 v_uv;',
        'void main(void) {',
        '  v_uv = a_uv;',
        '  gl_Position = vec4(a_pos, 0.0, 1.0);',
        '}'
      ].join('\n');

      // Authentic Boris FX Sapphire S_GlowAura Shader:
      // 1. Follows the gradient field of the source cutout contour (Analytic edge normal field).
      // 2. Smooth controllable Archimedean twist curvature (No high-frequency jitter/hypersensitivity).
      // 3. Exact Boris FX Sapphire S_GlowAura RGB Phase Formula (Rainbow Prism Presence & Sapphire Classic).
      // 4. Glow Under Source:
      //    - ON: Aura renders behind, layer is 100% crisp and un-tinted on top.
      //    - OFF: Glow blends over layer with Screen/Lighter, adapting to layer luminance/threshold.
      const fs = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_rawMask;',
        'uniform sampler2D u_blurMask;',
        'uniform vec2 u_resolution;',
        'uniform float u_twist;',
        'uniform float u_frequency;',
        'uniform float u_intensity;',
        'uniform float u_animPhase;',
        'uniform float u_threshold;',
        'uniform int u_colorStyle;',     // 0 = Rainbow Prism, 1 = Sapphire Classic
        'uniform int u_glowUnderSource;', // 1 = Aura under source, 0 = Aura over source
        '',
        '// Exact Boris FX Sapphire S_GlowAura RGB Phase Formula',
        'vec3 getSapphireGlowColor(float phi, int style) {',
        '  float pr, pg, pb;',
        '  if (style == 1) {',
        '    // Sapphire Classic Default: Blue/Cyan -> Navy -> Deep Red -> Gold -> Cream White',
        '    pr = 0.2;',
        '    pg = 0.1;',
        '    pb = 0.0;',
        '  } else {',
        '    // Sapphire Prism Presence (Official Rainbow Preset): Gold -> Coral -> Hot Pink -> Magenta -> Violet -> Royal Blue -> Turquoise -> Neon Green',
        '    pr = 0.800003;',
        '    pg = -1.770004;',
        '    pb = 1.610001;',
        '  }',
        '  const float TWO_PI = 6.2831853;',
        '  return vec3(',
        '    0.5 + 0.5 * cos(TWO_PI * (phi + pr)),',
        '    0.5 + 0.5 * cos(TWO_PI * (phi + pg)),',
        '    0.5 + 0.5 * cos(TWO_PI * (phi + pb))',
        '  );',
        '}',
        '',
        'void main(void) {',
        '  vec2 uv = v_uv;',
        '  vec4 rawCol = texture2D(u_rawMask, uv);',
        '  vec4 blurCol = texture2D(u_blurMask, uv);',
        '  float rawAlpha = rawCol.a;',
        '  float blurAlpha = blurCol.a;',
        '',
        '  // If inside cutout and glowUnderSource is active, skip completely to keep subject 100% clean',
        '  if (u_glowUnderSource == 1 && rawAlpha >= 0.98) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '',
        '  // Outside aura reach',
        '  if (blurAlpha <= 0.003) {',
        '    gl_FragColor = vec4(0.0);',
        '    return;',
        '  }',
        '',
        '  // Compute smooth analytic gradient normal of the blurred alpha field',
        '  vec2 texel = 1.0 / u_resolution;',
        '  float aL = texture2D(u_blurMask, uv - vec2(texel.x * 2.5, 0.0)).a;',
        '  float aR = texture2D(u_blurMask, uv + vec2(texel.x * 2.5, 0.0)).a;',
        '  float aT = texture2D(u_blurMask, uv - vec2(0.0, texel.y * 2.5)).a;',
        '  float aB = texture2D(u_blurMask, uv + vec2(0.0, texel.y * 2.5)).a;',
        '  vec2 normal = vec2(aR - aL, aB - aT);',
        '  float nLen = length(normal);',
        '  float contourAngle = (nLen > 0.0001) ? atan(normal.y, normal.x) : 0.0;',
        '',
        '  // Continuous, silky distance value (0.0 at edge, 1.0 at outer bound)',
        '  float d = clamp(1.0 - blurAlpha, 0.0, 1.0);',
        '',
        '  // Smooth Archimedean Twist curvature (balanced, natural sensitivity)',
        '  float twistOffset = u_twist * d * 0.28;',
        '  float rayStreak = 0.68 + 0.32 * cos((contourAngle + twistOffset) * 12.0 - u_animPhase * 0.5);',
        '',
        '  // Continuous wave phase across distance',
        '  float wavePhase = d * u_frequency - u_animPhase;',
        '  vec3 col = getSapphireGlowColor(wavePhase, u_colorStyle);',
        '',
        '  // Base radiance falloff',
        '  float falloff = pow(blurAlpha, 0.82) * rayStreak * u_intensity;',
        '',
        '  if (u_glowUnderSource == 1 && rawAlpha > 0.02) {',
        '    // Feather out edge inside cutout so original subject is never obscured',
        '    falloff *= clamp(1.0 - rawAlpha * 1.5, 0.0, 1.0);',
        '  } else if (u_glowUnderSource == 0 && rawAlpha > 0.05) {',
        '    // Glow Over Source: modulate by layer luminance & threshold (brightest areas glow strongest)',
        '    float luma = dot(rawCol.rgb, vec3(0.299, 0.587, 0.114));',
        '    float threshMod = u_threshold > 0.0 ? clamp((luma - u_threshold) / max(0.01, 1.0 - u_threshold), 0.0, 1.0) : luma;',
        '    falloff *= mix(0.4, 1.25, threshMod);',
        '  }',
        '',
        '  // Soft core highlight right along the cutout perimeter',
        '  float coreLight = pow(blurAlpha, 3.0) * 0.25;',
        '  col += vec3(coreLight);',
        '',
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
        rawMask: gl.getUniformLocation(prog, 'u_rawMask'),
        blurMask: gl.getUniformLocation(prog, 'u_blurMask'),
        resolution: gl.getUniformLocation(prog, 'u_resolution'),
        twist: gl.getUniformLocation(prog, 'u_twist'),
        frequency: gl.getUniformLocation(prog, 'u_frequency'),
        intensity: gl.getUniformLocation(prog, 'u_intensity'),
        animPhase: gl.getUniformLocation(prog, 'u_animPhase'),
        threshold: gl.getUniformLocation(prog, 'u_threshold'),
        colorStyle: gl.getUniformLocation(prog, 'u_colorStyle'),
        glowUnderSource: gl.getUniformLocation(prog, 'u_glowUnderSource')
      };

      _posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

      _uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

      _rawTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, _rawTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      _blurTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, _blurTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      return true;
    } catch (_) {
      _glFailed = true;
      return false;
    }
  }

  // Prepares raw cutout mask and smooth blurred distance gradient canvas
  function prepareMasks(el, targetW, targetH, pad, glowWidth) {
    const bw = Math.round(targetW + pad * 2);
    const bh = Math.round(targetH + pad * 2);

    if (!_maskCanvas) {
      _maskCanvas = document.createElement('canvas');
      _maskCtx = _maskCanvas.getContext('2d');
      _blurCanvas = document.createElement('canvas');
      _blurCtx = _blurCanvas.getContext('2d');
    }
    if (_maskCanvas.width !== bw || _maskCanvas.height !== bh) {
      _maskCanvas.width = bw;
      _maskCanvas.height = bh;
      _blurCanvas.width = bw;
      _blurCanvas.height = bh;
    }

    _maskCtx.clearRect(0, 0, bw, bh);
    _blurCtx.clearRect(0, 0, bw, bh);

    try {
      _maskCtx.drawImage(el, pad, pad, targetW, targetH);
    } catch (_) {
      return null;
    }

    // Hardware accelerated smooth separable blur generates the continuous gradient field
    const blurRadius = Math.max(2, Math.round(glowWidth * 0.45));
    _blurCtx.save();
    _blurCtx.filter = `blur(${blurRadius}px)`;
    _blurCtx.drawImage(_maskCanvas, 0, 0);
    _blurCtx.restore();

    return {
      rawCanvas: _maskCanvas,
      blurCanvas: _blurCanvas,
      bw,
      bh
    };
  }

  // Sapphire RGB formula helper for 2D fallback
  function getSapphireRGB(phi, isClassic) {
    const pr = isClassic ? 0.2 : 0.800003;
    const pg = isClassic ? 0.1 : -1.770004;
    const pb = isClassic ? 0.0 : 1.610001;
    const TWO_PI = 6.2831853;
    const r = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(TWO_PI * (phi + pr))));
    const g = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(TWO_PI * (phi + pg))));
    const b = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(TWO_PI * (phi + pb))));
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  reg.register({
    id: 'glow-aura',
    name: 'Glow Aura',
    category: 'layer',
    isExpanding: true,
    icon: 'assets/FXPH.svg',
    description: 'Boris FX Sapphire S_GlowAura: rotating rainbow spiral rays and aura contours following cutout gradient',
    params: [
      { id: 'glowWidth',        label: 'Glow Width',        type: 'number', min: 5,   max: 400, default: 35,  unit: 'px' },
      { id: 'twist',            label: 'Twist',             type: 'number', min: -10, max: 10,  default: 3.3, step: 0.1 },
      { id: 'frequency',        label: 'Frequency',         type: 'number', min: 0.5, max: 20,  default: 3.6, step: 0.2 },
      { id: 'colorStyle',       label: 'Color Style',       type: 'select', options: ['rainbow', 'classic'], default: 'rainbow' },
      { id: 'threshold',        label: 'Threshold',         type: 'number', min: 0,   max: 100, default: 31,  unit: '%' },
      { id: 'intensity',        label: 'Brightness',        type: 'number', min: 0,   max: 300, default: 128, unit: '%' },
      { id: 'speed',            label: 'Phase Speed',       type: 'number', min: -10, max: 10,  default: 0.8, step: 0.1 },
      { id: 'glowUnderSource',  label: 'Glow Under Source', type: 'switch', default: 1 },
      { id: 'blendMode',        label: 'Blend Mode',        type: 'select', options: ['screen', 'lighter', 'source-over'], default: 'screen' }
    ],
    render(ctx, el, layer, bounds, fx, currentSec) {
      if (!ctx || !el) return;
      const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
      const by = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w  = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width  : 500));
      const h  = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 500));

      const curSec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : (layer && typeof layer._currentSec === 'number'
          ? layer._currentSec
          : (typeof window !== 'undefined'
            ? (typeof window._currentRenderSec === 'number' && !isNaN(window._currentRenderSec)
              ? window._currentRenderSec
              : (window.currentPlaybackSec !== undefined ? window.currentPlaybackSec : (window.currentSec || 0)))
            : 0));

      const glowWidth = Math.max(5, Number(
        fx.glowWidth !== undefined ? fx.glowWidth :
        (fx.radius !== undefined ? fx.radius :
        (fx.thick !== undefined ? fx.thick :
        (fx.thickness !== undefined ? fx.thickness : 35)))
      ));
      if (fx.glowWidth === undefined) fx.glowWidth = glowWidth;
      if (fx.radius === undefined) fx.radius = glowWidth;

      const speed     = Number(fx.speed !== undefined ? fx.speed : (fx.phaseSpeed !== undefined ? fx.phaseSpeed : (fx.twistSpeed !== undefined ? fx.twistSpeed : 0.8)));
      const twist     = Math.max(-10, Math.min(10, Number(fx.twist !== undefined ? fx.twist : 3.3)));
      const frequency = Math.max(0.2, Number(fx.frequency !== undefined ? fx.frequency : 3.6));
      const threshold = Math.max(0, Math.min(1, Number(fx.threshold !== undefined ? fx.threshold : 31) / 100));
      const intensity = Math.max(0, Math.min(5, Number(fx.intensity !== undefined ? fx.intensity : (fx.brightness !== undefined ? fx.brightness : 128)) / 100));
      const colorStyleStr = (fx.colorStyle || 'rainbow').toLowerCase();
      const isClassic = colorStyleStr === 'classic';
      const colorStyleInt = isClassic ? 1 : 0;
      const glowUnderSource = (fx.glowUnderSource === undefined || fx.glowUnderSource === 1 || fx.glowUnderSource === true || fx.glowUnderSource === '1') ? 1 : 0;
      const blend = fx.blendMode || 'screen';

      const animPhase = speed * curSec * 1.5;

      // Ample padding so aura never clips to layer boundaries
      const pad = Math.ceil(glowWidth * 1.8 + 40);
      const bw  = Math.round(w + pad * 2);
      const bh  = Math.round(h + pad * 2);

      const maskInfo = prepareMasks(el, w, h, pad, glowWidth);
      if (!maskInfo) {
        try { ctx.drawImage(el, bx, by, w, h); } catch (_) {}
        return;
      }

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

          const uvl = gl.getAttribLocation(_auraProg, 'a_uv');
          gl.bindBuffer(gl.ARRAY_BUFFER, _uvBuf);
          gl.enableVertexAttribArray(uvl);
          gl.vertexAttribPointer(uvl, 2, gl.FLOAT, false, 0, 0);

          // Bind Texture 0: Raw cutout mask
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, _rawTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskInfo.rawCanvas);
          gl.uniform1i(_uni.rawMask, 0);

          // Bind Texture 1: Continuous blurred distance field
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, _blurTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskInfo.blurCanvas);
          gl.uniform1i(_uni.blurMask, 1);

          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);

          gl.uniform2f(_uni.resolution, bw, bh);
          gl.uniform1f(_uni.twist, twist);
          gl.uniform1f(_uni.frequency, frequency);
          gl.uniform1f(_uni.intensity, intensity);
          gl.uniform1f(_uni.animPhase, animPhase);
          gl.uniform1f(_uni.threshold, threshold);
          gl.uniform1i(_uni.colorStyle, colorStyleInt);
          gl.uniform1i(_uni.glowUnderSource, glowUnderSource);

          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // Render ordering:
          // In Sapphire S_GlowAura:
          // If glowUnderSource == 1:
          // 1. Draw aura behind
          // 2. Draw 100% crisp clean source on top
          // If glowUnderSource == 0:
          // 1. Draw source
          // 2. Draw aura over source with blend mode ('screen' / 'lighter')
          if (glowUnderSource === 1) {
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.globalCompositeOperation = blend !== 'normal' ? blend : 'screen';
            ctx.globalAlpha = 1.0;
            try {
              ctx.drawImage(_glCanvas, bx - pad, by - pad, bw, bh);
            } catch (_) {}
            ctx.restore();

            try {
              ctx.drawImage(el, bx, by, w, h);
            } catch (_) {}
          } else {
            try {
              ctx.drawImage(el, bx, by, w, h);
            } catch (_) {}

            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.globalCompositeOperation = blend !== 'normal' ? blend : 'screen';
            ctx.globalAlpha = 1.0;
            try {
              ctx.drawImage(_glCanvas, bx - pad, by - pad, bw, bh);
            } catch (_) {}
            ctx.restore();
          }

          return;
        } catch (e) {
          console.warn('[GlowAura] WebGL error, fallback to 2D:', e);
        }
      }

      // --- Canvas 2D Fallback Path ---
      if (!_fallbackCanvas) {
        _fallbackCanvas = document.createElement('canvas');
        _fallbackCtx = _fallbackCanvas.getContext('2d');
      }
      if (_fallbackCanvas.width !== bw || _fallbackCanvas.height !== bh) {
        _fallbackCanvas.width = bw;
        _fallbackCanvas.height = bh;
      }
      _fallbackCtx.clearRect(0, 0, bw, bh);

      const numSteps = 16;
      _fallbackCtx.save();
      _fallbackCtx.globalCompositeOperation = 'lighter';
      const cX = bw / 2;
      const cY = bh / 2;

      for (let i = 1; i <= numSteps; i++) {
        const step = i / numSteps;
        const scale = 1.0 + step * (glowWidth / Math.max(w, h)) * 1.5;
        const rot = twist * step * 0.15 + (animPhase * 0.05);
        const phi = step * frequency - animPhase;
        const rgb = getSapphireRGB(phi, isClassic);
        const alpha = Math.pow(1.0 - step, 1.25) * (0.8 / numSteps) * intensity;

        _fallbackCtx.save();
        _fallbackCtx.translate(cX, cY);
        _fallbackCtx.rotate(rot);
        _fallbackCtx.scale(scale, scale);
        _fallbackCtx.translate(-cX, -cY);
        _fallbackCtx.globalAlpha = alpha;
        _fallbackCtx.drawImage(maskInfo.rawCanvas, 0, 0);
        _fallbackCtx.restore();
      }
      _fallbackCtx.restore();

      if (glowUnderSource === 1) {
        ctx.save();
        ctx.globalCompositeOperation = blend !== 'normal' ? blend : 'screen';
        ctx.globalAlpha = 1.0;
        try {
          ctx.drawImage(_fallbackCanvas, bx - pad, by - pad, bw, bh);
        } catch (_) {}
        ctx.restore();

        try {
          ctx.drawImage(el, bx, by, w, h);
        } catch (_) {}
      } else {
        try {
          ctx.drawImage(el, bx, by, w, h);
        } catch (_) {}

        ctx.save();
        ctx.globalCompositeOperation = blend !== 'normal' ? blend : 'screen';
        ctx.globalAlpha = 1.0;
        try {
          ctx.drawImage(_fallbackCanvas, bx - pad, by - pad, bw, bh);
        } catch (_) {}
        ctx.restore();
      }
    }
  });
})(typeof window !== 'undefined' ? window : this);
