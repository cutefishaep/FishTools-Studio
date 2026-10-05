/**
 * FishToolEngine - Custom High-Performance Micro-GPU 2.5D/3D Layer Engine
 * Dedicated 1-Quad hardware perspective blitter (< 8 KB).
 * Zero bloat, zero subdivision, zero seams, zero warping.
 * 144+ FPS hardware perspective via WebGL2/WebGL1.
 */
(function(window) {
  'use strict';

  const CAMERA_DISTANCE = 1000.0; // Standard 3D perspective focal distance in pixels
  const NEAR_PLANE = 20.0;        // Near clip plane: object clips out when within 20px of camera lens
  const MAX_Z = CAMERA_DISTANCE - NEAR_PLANE; // 980.0px: threshold where layer exits camera view

  function hexToRgba(hex, alpha) {
    let c = (hex || '#000000').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  function hexToRgb(hex) {
    let c = (hex || '#000000').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    const num = parseInt(c, 16) || 0;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  // 1. Minimal Vertex & Fragment Shaders (Supports 2D Quads and 3D Volumetric Meshes)
  const VS_SOURCE = `
    attribute vec3 a_position;
    attribute vec2 a_texCoord;
    attribute vec4 a_color;
    uniform mat4 u_matrix;
    uniform float u_lensDistort;
    varying vec2 v_texCoord;
    varying vec4 v_color;

    void main() {
      v_texCoord = a_texCoord;
      v_color = a_color;
      vec4 pos = u_matrix * vec4(a_position, 1.0);
      if (abs(u_lensDistort) > 0.001 && pos.w > 0.001) {
        vec2 ndc = pos.xy / pos.w;
        float r2 = dot(ndc, ndc);
        float warp = 1.0 + u_lensDistort * r2;
        pos.xy = ndc * warp * pos.w;
      }
      gl_Position = pos;
    }
  `;

  const FS_SOURCE = `
    precision mediump float;
    varying vec2 v_texCoord;
    varying vec4 v_color;
    uniform sampler2D u_texture;
    uniform float u_opacity;
    uniform float u_noDiscard;
    uniform int u_mode;

    void main() {
      if (u_mode == 1) {
        if (u_noDiscard < 0.5 && v_color.a <= 0.003) discard;
        gl_FragColor = v_color * u_opacity;
      } else {
        vec4 col = texture2D(u_texture, v_texCoord);
        // During motion-blur accumulation transparent texels must emit (0,0,0,0)
        // instead of discard, so the running-mean blend dilutes the mean and
        // trails stay symmetric (discard would freeze early-sample coverage).
        if (u_noDiscard < 0.5 && col.a <= 0.003) discard;
        vec4 tint = (v_color.a > 0.001 && (v_color.r > 0.001 || v_color.g > 0.001 || v_color.b > 0.001)) ? v_color : vec4(1.0, 1.0, 1.0, 1.0);
        gl_FragColor = col * tint * u_opacity;
      }
    }
  `;

  // Hardware-Accelerated Optical RGB Split Shaders (Single-Quad GPU channel offset)
  const RGB_SPLIT_VS = `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() {
      v_uv = a_uv;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const RGB_SPLIT_FS = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_delta;
    uniform float u_opacity;

    void main() {
      vec4 colG = texture2D(u_image, v_uv);
      vec4 colR = texture2D(u_image, v_uv + u_delta);
      vec4 colB = texture2D(u_image, v_uv - u_delta);
      float outA = max(colG.a, max(colR.a, colB.a));
      if (outA <= 0.003) discard;
      gl_FragColor = vec4(colR.r, colG.g, colB.b, outA) * u_opacity;
    }
  `;

  class FishToolEngineCore {
    constructor() {
      this.glCanvas = null;
      this.gl = null;
      this.program = null;
      this.buffers = null;
      this.locations = null;
      this.textureCache = new WeakMap();
      this.currentTexture = null;
      this.isReady = false;

      // Silhouette contour cache for true-shape extrusion (WeakMap<sourceEl, entry>)
      this._extrudeContourCache = new WeakMap();
      this._extrudeScratch = null;
      this._extrudeScratchCtx = null;

      // Shared-depth 3D scene motion blur: per-sample FBO + passthrough blit program
      this._sceneFbo = null;
      this._sceneFboTex = null;
      this._sceneFboDepth = null;
      this._sceneBlitProg = null;
      this._sceneBlitPosLoc = -1;
      this._sceneBlitTexLoc = null;
      this._sceneBlitQuad = null;
      this._sceneFboW = 0;
      this._sceneFboH = 0;
      this._sceneGLFailed = false;

      this._initGL();
    }

    _initGL() {
      try {
        this.glCanvas = document.createElement('canvas');
        this.glCanvas.width = 1920;
        this.glCanvas.height = 1080;

        const opts = {
          alpha: true,
          depth: true,
          premultipliedAlpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance'
        };

        this.gl = this.glCanvas.getContext('webgl2', opts) ||
                  this.glCanvas.getContext('webgl', opts) ||
                  this.glCanvas.getContext('experimental-webgl', opts);

        if (!this.gl) {
          console.warn('FishToolEngine: WebGL not supported, falling back to 2D.');
          return;
        }

        const gl = this.gl;

        // Compile Shaders
        const vs = this._compileShader(gl.VERTEX_SHADER, VS_SOURCE);
        const fs = this._compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          console.error('FishToolEngine Program Link Error:', gl.getProgramInfoLog(prog));
          return;
        }

        gl.disable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

        this.program = prog;

        // Attribute & Uniform Locations
        this.locations = {
          position: gl.getAttribLocation(prog, 'a_position'),
          texCoord: gl.getAttribLocation(prog, 'a_texCoord'),
          color: gl.getAttribLocation(prog, 'a_color'),
          matrix: gl.getUniformLocation(prog, 'u_matrix'),
          texture: gl.getUniformLocation(prog, 'u_texture'),
          opacity: gl.getUniformLocation(prog, 'u_opacity'),
          noDiscard: gl.getUniformLocation(prog, 'u_noDiscard'),
          mode: gl.getUniformLocation(prog, 'u_mode'),
          lensDistort: gl.getUniformLocation(prog, 'u_lensDistort')
        };

        // Compile Dedicated Hardware RGB Split Shader
        try {
          const rgbVs = this._compileShader(gl.VERTEX_SHADER, RGB_SPLIT_VS);
          const rgbFs = this._compileShader(gl.FRAGMENT_SHADER, RGB_SPLIT_FS);
          const rgbProg = gl.createProgram();
          gl.attachShader(rgbProg, rgbVs);
          gl.attachShader(rgbProg, rgbFs);
          gl.linkProgram(rgbProg);
          if (gl.getProgramParameter(rgbProg, gl.LINK_STATUS)) {
            this.rgbSplitProgram = rgbProg;
            this.rgbLocations = {
              pos: gl.getAttribLocation(rgbProg, 'a_pos'),
              uv: gl.getAttribLocation(rgbProg, 'a_uv'),
              image: gl.getUniformLocation(rgbProg, 'u_image'),
              delta: gl.getUniformLocation(rgbProg, 'u_delta'),
              opacity: gl.getUniformLocation(rgbProg, 'u_opacity')
            };
          }
        } catch (_) {}

        // Tessellated unit quad (N x N grid) centered at origin: [-0.5, 0.5].
        // Subdivision is required because the vertex shader applies non-linear lens distortion
        // per vertex; a bare 4-vertex quad would crease along its diagonal (warped text middle).
        const N = 10;
        const positions = new Float32Array((N + 1) * (N + 1) * 2);
        const texCoords = new Float32Array((N + 1) * (N + 1) * 2);
        const indices = new Uint16Array(N * N * 6);
        let pi = 0;
        for (let gy = 0; gy <= N; gy++) {
          for (let gx = 0; gx <= N; gx++) {
            positions[pi] = gx / N - 0.5;
            positions[pi + 1] = gy / N - 0.5;
            texCoords[pi] = gx / N;
            texCoords[pi + 1] = gy / N;
            pi += 2;
          }
        }
        let ii = 0;
        for (let gy = 0; gy < N; gy++) {
          for (let gx = 0; gx < N; gx++) {
            const i0 = gy * (N + 1) + gx;
            const i1 = i0 + 1;
            const i3 = i0 + (N + 1);
            const i2 = i3 + 1;
            indices[ii++] = i0; indices[ii++] = i1; indices[ii++] = i2;
            indices[ii++] = i0; indices[ii++] = i2; indices[ii++] = i3;
          }
        }
        this.quadIndexCount = indices.length;

        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const texBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        const idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        this.buffers = {
          position: posBuffer,
          texCoord: texBuffer,
          index: idxBuffer
        };

        // Dedicated dynamic buffers for 3D volumetric meshes (Box, Extrude, Pyramid, Sphere)
        this.meshBuffers = {
          position: gl.createBuffer(),
          texCoord: gl.createBuffer(),
          color: gl.createBuffer(),
          index: gl.createBuffer()
        };

        gl.useProgram(this.program);
        gl.uniform1i(this.locations.mode, 0);
        if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 0);
        gl.disableVertexAttribArray(this.locations.color);
        gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        this.isReady = true;
      } catch (err) {
        console.error('FishToolEngine Init Failed:', err);
      }
    }

    _compileShader(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('FishToolEngine Shader Compile Error:', gl.getShaderInfoLog(s));
      }
      return s;
    }

    _hasValidDimensions(el) {
      if (!el) return false;
      if (el.tagName === 'AUDIO' || (typeof HTMLAudioElement !== 'undefined' && el instanceof HTMLAudioElement)) {
        return false;
      }
      if (el.tagName === 'VIDEO') {
        return el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0;
      }
      if (el.tagName === 'IMG') {
        return el.complete && el.naturalWidth > 0 && el.naturalHeight > 0;
      }
      if (typeof el.width === 'number' && typeof el.height === 'number') {
        return el.width > 0 && el.height > 0;
      }
      return false;
    }

    _getOrCreateTexture(el) {
      if (!this._hasValidDimensions(el) || el === this.glCanvas) return null;
      const gl = this.gl;
      let tex = this.textureCache.get(el);

      if (!tex) {
        tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        // Pre-initialize with a 1x1 transparent RGBA pixel so texture is never incomplete (avoids solid white glitch)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        this.textureCache.set(el, tex);
      }

      gl.bindTexture(gl.TEXTURE_2D, tex);
      try {
        if (el.tagName === 'CANVAS' && (el.width <= 0 || el.height <= 0)) return tex;
        const isStaticImg = (el.tagName === 'IMG');
        const src = el.src || '';
        if (isStaticImg) {
          if (tex._uploadedSrc !== src) {
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
            if (src) tex._uploadedSrc = src;
          }
        } else if (el.tagName === 'CANVAS') {
          const ver = el._contentVersion;
          if (ver === undefined || tex._uploadedVersion !== ver) {
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
            if (ver !== undefined) tex._uploadedVersion = ver;
          }
        } else {
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        }
      } catch (_) {}

      return tex;
    }

    _getLensDistort(camera) {
      if (!camera) return 0.0;
      const camLens = camera.cameraLens !== undefined ? camera.cameraLens : 50;
      if (camLens < 50) {
        return Math.max(0.0, ((50 - camLens) / 50) * 0.45);
      } else if (camLens > 50) {
        return Math.min(0.0, -((camLens - 50) / 250) * 0.08);
      }
      return 0.0;
    }

    _getEffectProcessedElement(el, layer, bounds, currentSec = null) {
      if (!el || typeof document === 'undefined') return { el, padX: 0, padY: 0, origW: bounds.w || 100, origH: bounds.h || 100 };
      if (!window.FishEffects || typeof window.FishEffects.renderLayer !== 'function') {
        return { el, padX: 0, padY: 0, origW: bounds.w || 100, origH: bounds.h || 100 };
      }
      if (!Array.isArray(layer.effects) || layer.effects.length === 0) {
        return { el, padX: 0, padY: 0, origW: bounds.w || 100, origH: bounds.h || 100 };
      }
      const activeFx = layer.effects.filter(f => f && !f.disabled &&
        f.type !== 'tile' &&
        f.type !== 'rgb-split' &&
        f.type !== 'drop-shadow' &&
        f.type !== 'box_3d' &&
        f.type !== 'extrude_3d' &&
        f.type !== 'pyramid_3d' &&
        f.type !== 'sphere_3d'
      );
      if (activeFx.length === 0) {
        return { el, padX: 0, padY: 0, origW: bounds.w || 100, origH: bounds.h || 100 };
      }

      const nw = (el.naturalWidth || el.videoWidth || el.width || Math.abs(bounds.w) || 500);
      const nh = (el.naturalHeight || el.videoHeight || el.height || Math.abs(bounds.h) || 500);
      let w = Math.max(1, Math.round(nw));
      let h = Math.max(1, Math.round(nh));
      if (activeFx.some(f => f.type === 'particle-engine')) {
        const bw = Math.abs(bounds.absW || bounds.w || 0);
        const bh = Math.abs(bounds.absH || bounds.h || 0);
        if (bw >= 1 && bh >= 1) {
          const k = Math.min(1, 2048 / Math.max(bw, bh));
          w = Math.max(1, Math.round(bw * k));
          h = Math.max(1, Math.round(bh * k));
        }
      }

      let padX = 0;
      let padY = 0;
      const hasExpanding = activeFx.some(f => {
        const d = (window.FishEffectsRegistry && window.FishEffectsRegistry.get) ? window.FishEffectsRegistry.get(f.type) : null;
        if ((d && (d.isExpanding || d.category === 'warp')) || f.type === 'transform') return true;
        if (f.type === 'deep-glow' && (f.outLayer === 1 || f.outLayer === true || f.outLayer === '1' || f.outLayer === 'true' || f.outLayer === 'on')) return true;
        return false;
      });
      if (hasExpanding) {
        let maxRad = 80;
        const dg = activeFx.find(f => f.type === 'deep-glow' && (f.outLayer === 1 || f.outLayer === true || f.outLayer === '1' || f.outLayer === 'true' || f.outLayer === 'on'));
        if (dg && dg.radius !== undefined) maxRad = Math.max(maxRad, Number(dg.radius) || 80);
        const pad = Math.min(600, Math.ceil(maxRad * 1.1 + 24));
        padX = pad;
        padY = pad;
      }

      const fullW = w + padX * 2;
      const fullH = h + padY * 2;

      if (!this._fxCanvas) {
        this._fxCanvas = document.createElement('canvas');
        this._fxCtx = this._fxCanvas.getContext('2d');
      }
      if (this._fxCanvas.width !== fullW || this._fxCanvas.height !== fullH) {
        this._fxCanvas.width = fullW;
        this._fxCanvas.height = fullH;
      }
      this._fxCtx.clearRect(0, 0, fullW, fullH);

      const fakeLayer = Object.assign({}, layer, { effects: activeFx });
      const curSec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : ((layer && typeof layer._currentSec === 'number')
          ? layer._currentSec
          : ((typeof window !== 'undefined' && typeof window._currentRenderSec === 'number')
            ? window._currentRenderSec
            : ((typeof window !== 'undefined' && typeof window.currentPlaybackSec === 'number')
              ? window.currentPlaybackSec
              : 0)));
      // unitScale = effect-space px per comp px. Effects are rendered at media size here, then the quad
      // is scaled to the layer → comp-px distances must be expressed in media px.
      const bScaleFx = (bounds && bounds.bufferScale) || 1;
      const quadCompW = Math.abs(bounds && (bounds.absW || bounds.w) || 0) / bScaleFx;
      const unitScale = quadCompW > 0 ? (w / quadCompW) : 1;
      window.FishEffects.renderLayer(this._fxCtx, el, fakeLayer, { x: padX, y: padY, w, h, bufferScale: bScaleFx, unitScale }, curSec);
      return { el: this._fxCanvas, padX, padY, origW: w, origH: h };
    }

    /**
     * Compute 3D projected coordinates of a local point (lx, ly, lz)
     */
    projectPoint(lx, ly, lz = 0, params = {}) {
      const {
        cx = 0,
        cy = 0,
        posZ = 0,
        rotX = 0,
        rotY = 0,
        rotZ = 0,
        skewX = 0,
        skewY = 0,
        signX = 1,
        signY = 1,
        anchorX = 0,
        anchorY = 0,
        anchorZ = 0,
        perspective = CAMERA_DISTANCE
      } = params;

      // 1. Vector from anchor to local point in layer space
      let dx = (lx - anchorX) * signX;
      let dy = (ly - anchorY) * signY;
      let dz = lz - anchorZ;

      // 2. Local Skew
      if (skewX || skewY) {
        const tanX = Math.tan(((skewX || 0) * Math.PI) / 180);
        const tanY = Math.tan(((skewY || 0) * Math.PI) / 180);
        const sx = dx + tanX * dy;
        const sy = tanY * dx + dy;
        dx = sx;
        dy = sy;
      }

      // Anchor world coordinates (pivot point in 3D space)
      const anchorWorldX = cx + anchorX * signX;
      const anchorWorldY = cy + anchorY * signY;
      const anchorWorldZ = posZ + anchorZ;

      const camera = params.camera || null;

      // 3. Fast 2D (Only when rotX == 0, rotY == 0, posZ == 0, anchorZ == 0, and no camera)
      if (!rotX && !rotY && !posZ && !anchorZ && !camera) {
        let rx = dx, ry = dy;
        if (rotZ) {
          const radZ = (rotZ * Math.PI) / 180;
          const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);
          rx = dx * cosZ - dy * sinZ;
          ry = dx * sinZ + dy * cosZ;
        }
        return { x: anchorWorldX + rx, y: anchorWorldY + ry, z: 0, scale: 1, isBehind: false };
      }

      // 4. 3D Euler Rotations around anchor pivot: Rx -> Ry -> Rz
      const radX = (rotX * Math.PI) / 180;
      const radY = (rotY * Math.PI) / 180;
      const radZ = (rotZ * Math.PI) / 180;

      const cosX = Math.cos(radX), sinX = Math.sin(radX);
      const cosY = Math.cos(radY), sinY = Math.sin(radY);
      const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);

      const y1 = dy * cosX - dz * sinX;
      const z1 = dy * sinX + dz * cosX;
      const x1 = dx;

      const x2 = x1 * cosY + z1 * sinY;
      const z2 = -x1 * sinY + z1 * cosY;
      const y2 = y1;

      const x3 = x2 * cosZ - y2 * sinZ;
      const y3 = x2 * sinZ + y2 * cosZ;
      const z3 = z2 + anchorWorldZ;

      // 5. Perspective Projection
      const pDist = perspective || (CAMERA_DISTANCE * (params.bufferScale || 1));
      const pNear = params.near || (NEAR_PLANE * (params.bufferScale || 1));
      const maxZ = pDist - pNear;

      if (camera) {
        const bScale = params.bufferScale || 1;
        const camX = (camera.posX || 0) * bScale;
        const camY = (camera.posY || 0) * bScale;
        const camPosZ = (camera.posZ || 0) * bScale;
        const camRotX = camera.rotX || 0;
        const camRotY = camera.rotY || 0;
        const camRotZ = camera.rotZ !== undefined ? camera.rotZ : (camera.rotation || 0);
        const camLens = Math.max(1, camera.cameraLens !== undefined ? camera.cameraLens : 50);
        const camZoom = camera.cameraZoom !== undefined ? camera.cameraZoom : 100;
        const lensFactor = Math.max(0.01, camLens / 50);
        const zoomFactor = Math.max(0.01, camZoom / 100);
        const totalZoom = lensFactor * zoomFactor;
        const D = CAMERA_DISTANCE * lensFactor * bScale;

        const vw = params.vw || (params.bufferScale ? 1920 * params.bufferScale : 1920);
        const vh = params.vh || (params.bufferScale ? 1080 * params.bufferScale : 1080);
        let worldX = anchorWorldX + x3;
        let worldY = anchorWorldY + y3;
        let worldZ = z3;

        let relX = worldX - (vw / 2 + camX);
        let relY = worldY - (vh / 2 + camY);
        let relZ = (worldZ - camPosZ) - D;

        if (camRotZ) {
          const radZ = (-camRotZ * Math.PI) / 180;
          const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
          const nX = relX * cZ - relY * sZ, nY = relX * sZ + relY * cZ;
          relX = nX; relY = nY;
        }
        if (camRotY) {
          const radY = (camRotY * Math.PI) / 180;
          const cY = Math.cos(radY), sY = Math.sin(radY);
          const nX = relX * cY + relZ * sY, nZ = -relX * sY + relZ * cY;
          relX = nX; relZ = nZ;
        }
        if (camRotX) {
          const radX = (camRotX * Math.PI) / 180;
          const cX = Math.cos(radX), sX = Math.sin(radX);
          const nY = relY * cX - relZ * sX, nZ = relY * sX + relZ * cX;
          relY = nY; relZ = nZ;
        }

        const dist = -relZ;
        const isBehind = dist <= pNear;
        const projScale = (D * totalZoom) / Math.max(pNear, dist);
        let px = vw / 2 + relX * projScale;
        let py = vh / 2 + relY * projScale;

        const lensDistort = this._getLensDistort(camera);
        if (Math.abs(lensDistort) > 0.001) {
          const ndcX = (px - vw / 2) / (vw / 2);
          const ndcY = (py - vh / 2) / (vh / 2);
          const r2 = ndcX * ndcX + ndcY * ndcY;
          const warp = 1.0 + lensDistort * r2;
          px = vw / 2 + ndcX * warp * (vw / 2);
          py = vh / 2 + ndcY * warp * (vh / 2);
        }

        return {
          x: px,
          y: py,
          z: relZ + D,
          scale: projScale,
          isBehind
        };
      }

      const isBehind = z3 >= maxZ;
      const clampedZ = Math.min(z3, maxZ);
      const projScale = pDist / Math.max(pNear, pDist - clampedZ);

      return {
        x: anchorWorldX + x3 * projScale,
        y: anchorWorldY + y3 * projScale,
        z: z3,
        scale: projScale,
        isBehind
      };
    }

    /**
     * Compute rotation-aware cursor string matching screen orientation of handle from center
     */
    getHandleCursor(hx, hy, cx, cy) {
      const dx = hx - cx;
      const dy = hy - cy;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      const sector = Math.round(deg / 45) % 8;
      if (sector === 0 || sector === 4) return 'ew-resize';
      if (sector === 1 || sector === 5) return 'nwse-resize';
      if (sector === 2 || sector === 6) return 'ns-resize';
      if (sector === 3 || sector === 7) return 'nesw-resize';
      return 'crosshair';
    }

    /**
     * Compute exact local 2D contour points for any Shape geometry
     */
    getShapeLocalContour(shapeType, shapeProps = {}, w = 300, h = 300) {
      if (typeof window !== 'undefined' && window.FishShapesRegistry && typeof window.FishShapesRegistry.getContour === 'function') {
        return window.FishShapesRegistry.getContour(shapeType, shapeProps, w, h);
      }
      const sx = Math.max(1, w);
      const sy = Math.max(1, h);
      const rx = sx / 2;
      const ry = sy / 2;
      const pts = [];

      const baseW = (shapeProps.sizeX && Number(shapeProps.sizeX) > 0) ? Number(shapeProps.sizeX) : sx;
      const scaleR = sx / Math.max(1, baseW);

      switch (shapeType) {
        case 'circle': {
          const segs = 48;
          for (let i = 0; i < segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
          }
          break;
        }
        case 'rectangle': {
          let r = Number(shapeProps.roundness);
          if (isNaN(r) || r < 0) r = 0;
          r = Math.min(r * scaleR, rx, ry);
          if (r <= 0.5) {
            pts.push({ x: -rx, y: -ry }, { x: rx, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry });
          } else {
            const arcSegs = 6;
            for (let i = 0; i <= arcSegs; i++) {
              const a = -Math.PI / 2 + (i / arcSegs) * (Math.PI / 2);
              pts.push({ x: rx - r + Math.cos(a) * r, y: -ry + r + Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = (i / arcSegs) * (Math.PI / 2);
              pts.push({ x: rx - r + Math.cos(a) * r, y: ry - r + Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = Math.PI / 2 + (i / arcSegs) * (Math.PI / 2);
              pts.push({ x: -rx + r + Math.cos(a) * r, y: ry - r + Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = Math.PI + (i / arcSegs) * (Math.PI / 2);
              pts.push({ x: -rx + r + Math.cos(a) * r, y: -ry + r + Math.sin(a) * r });
            }
          }
          break;
        }
        case 'triangle': {
          const step = Math.max(3, parseInt(shapeProps.step || shapeProps.steps, 10) || 3);
          if (step === 3) {
            let r = Number(shapeProps.roundness);
            if (isNaN(r) || r < 0) r = 0;
            r = r * scaleR;
            if (r <= 0.5) {
              pts.push({ x: 0, y: -ry });
              pts.push({ x: rx, y: ry });
              pts.push({ x: -rx, y: ry });
            } else {
              const raw = [{ x: 0, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry }];
              const cornerR = Math.min(r, Math.min(sx, sy) * 0.25);
              for (let i = 0; i < 3; i++) {
                const pPrev = raw[(i + 2) % 3];
                const pCurr = raw[i];
                const pNext = raw[(i + 1) % 3];
                const v1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
                const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };
                const l1 = Math.hypot(v1.x, v1.y) || 1;
                const l2 = Math.hypot(v2.x, v2.y) || 1;
                const u1 = { x: v1.x / l1, y: v1.y / l1 };
                const u2 = { x: v2.x / l2, y: v2.y / l2 };
                const startPt = { x: pCurr.x + u1.x * cornerR, y: pCurr.y + u1.y * cornerR };
                const endPt = { x: pCurr.x + u2.x * cornerR, y: pCurr.y + u2.y * cornerR };
                pts.push(startPt);
                for (let k = 1; k <= 4; k++) {
                  const t = k / 5;
                  pts.push({
                    x: (1 - t) * (1 - t) * startPt.x + 2 * (1 - t) * t * pCurr.x + t * t * endPt.x,
                    y: (1 - t) * (1 - t) * startPt.y + 2 * (1 - t) * t * pCurr.y + t * t * endPt.y
                  });
                }
                pts.push(endPt);
              }
            }
          } else {
            for (let i = 0; i < step; i++) {
              const a = -Math.PI / 2 + (i / step) * Math.PI * 2;
              pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
            }
          }
          break;
        }
        case 'star': {
          const numPts = Math.max(3, parseInt(shapeProps.points, 10) || 5);
          let inR = Number(shapeProps.innerRadius);
          if (isNaN(inR) || inR <= 0) inR = 0.4;
          inR = Math.max(0.1, Math.min(0.9, inR));
          const total = numPts * 2;
          for (let i = 0; i < total; i++) {
            const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
            const radRatio = (i % 2 === 0) ? 1.0 : inR;
            pts.push({ x: Math.cos(a) * rx * radRatio, y: Math.sin(a) * ry * radRatio });
          }
          break;
        }
        case 'polygon': {
          const sides = Math.max(3, parseInt(shapeProps.sides, 10) || 6);
          for (let i = 0; i < sides; i++) {
            const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
            pts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
          }
          break;
        }
        case 'capsule': {
          const r = Math.min(rx, ry);
          const arcSegs = 8;
          if (rx >= ry) {
            for (let i = 0; i <= arcSegs; i++) {
              const a = -Math.PI / 2 + (i / arcSegs) * Math.PI;
              pts.push({ x: rx - r + Math.cos(a) * r, y: Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = Math.PI / 2 + (i / arcSegs) * Math.PI;
              pts.push({ x: -rx + r + Math.cos(a) * r, y: Math.sin(a) * r });
            }
          } else {
            for (let i = 0; i <= arcSegs; i++) {
              const a = (i / arcSegs) * Math.PI;
              pts.push({ x: Math.cos(a) * r, y: ry - r + Math.sin(a) * r });
            }
            for (let i = 0; i <= arcSegs; i++) {
              const a = Math.PI + (i / arcSegs) * Math.PI;
              pts.push({ x: Math.cos(a) * r, y: -ry + r + Math.sin(a) * r });
            }
          }
          break;
        }
        case 'heart': {
          const segs = 48;
          for (let i = 0; i < segs; i++) {
            const t = (i / segs) * Math.PI * 2;
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            pts.push({ x: (hx / 16) * rx, y: ((hy + 2) / 17) * ry });
          }
          break;
        }
        default: {
          pts.push({ x: -rx, y: -ry }, { x: rx, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry });
          break;
        }
      }
      return pts;
    }

    /**
     * Compute exact bounding quad, 8 handles, and center anchor
     */
    getBounds(layer, bufferScale = 1, camera = null, viewportW = null, viewportH = null) {
      const bw = (layer.scaleW !== undefined ? layer.scaleW : (layer.normW || 100)) * bufferScale;
      const bh = (layer.scaleH !== undefined ? layer.scaleH : (layer.normH || 100)) * bufferScale;
      const absW = Math.abs(bw);
      const absH = Math.abs(bh);
      const signX = Math.sign(bw) || 1;
      const signY = Math.sign(bh) || 1;

      const cx = (layer.posX || 0) * bufferScale;
      const cy = (layer.posY || 0) * bufferScale;
      const posZ = (layer.posZ || 0) * bufferScale;

      const rotZ = layer.rotZ !== undefined ? layer.rotZ : (layer.rotation || 0);
      const rotX = layer.rotX || 0;
      const rotY = layer.rotY || 0;
      const skewX = layer.skewX || 0;
      const skewY = layer.skewY || 0;

      const anchorX = (layer.anchorX || 0) * bufferScale;
      const anchorY = (layer.anchorY || 0) * bufferScale;
      const anchorZ = (layer.anchorZ || 0) * bufferScale;

      const has3DFx = Array.isArray(layer.effects) && layer.effects.some(f => f && !f.disabled && (f.type === 'box_3d' || f.type === 'extrude_3d' || f.type === 'pyramid_3d' || f.type === 'sphere_3d'));
      const is3D = !!layer.is3D || has3DFx || (layer.type === 'precomp' && !!layer.collapseTransformations) || layer.type === 'camera';
      const boxFx = Array.isArray(layer.effects) ? layer.effects.find(f => f && !f.disabled && f.type === 'box_3d') : null;
      const boxAngleX = (boxFx && boxFx.angleX !== undefined) ? Number(boxFx.angleX) : 0;
      const boxAngleY = (boxFx && boxFx.angleY !== undefined) ? Number(boxFx.angleY) : 0;
      const effectiveRotX = is3D ? (rotX + boxAngleX) : 0;
      const effectiveRotY = is3D ? (rotY + boxAngleY) : 0;
      const effectivePosZ = is3D ? posZ : 0;
      const effectiveAnchorZ = is3D ? anchorZ : 0;
      const effectiveCamera = is3D ? camera : null;

      const camLens = Math.max(1, effectiveCamera ? (effectiveCamera.cameraLens !== undefined ? effectiveCamera.cameraLens : 50) : 50);
      const camZoom = effectiveCamera ? (effectiveCamera.cameraZoom !== undefined ? effectiveCamera.cameraZoom : 100) : 100;
      const lensFactor = Math.max(0.01, camLens / 50);
      const zoomFactor = Math.max(0.01, camZoom / 100);
      const totalZoom = lensFactor * zoomFactor;

      const camDist = CAMERA_DISTANCE * lensFactor * bufferScale;
      const nearPlane = NEAR_PLANE * bufferScale;
      const maxZ = camDist - nearPlane;
      const lensDistort = this._getLensDistort(effectiveCamera);

      const vw = viewportW || (1920 * bufferScale);
      const vh = viewportH || (1080 * bufferScale);

      const boundsForMVP = {
        cx, cy,
        posZ: effectivePosZ,
        w: absW, h: absH,
        signX, signY,
        rotX: effectiveRotX,
        rotY: effectiveRotY,
        rotZ,
        skewX, skewY,
        anchorX, anchorY,
        anchorZ: effectiveAnchorZ,
        bufferScale
      };

      let mvp = null;
      if (is3D) {
        mvp = this._computeMVP(boundsForMVP, vw, vh, 0, effectiveCamera);
      }

      let pTL, pTR, pBR, pBL, pN, pE, pS, pW, pAnchor;
      let isBehindCamera = false;

      const transformParams = {
        cx, cy,
        posZ: effectivePosZ,
        rotX: effectiveRotX,
        rotY: effectiveRotY,
        rotZ,
        skewX, skewY, signX, signY,
        anchorX, anchorY,
        anchorZ: effectiveAnchorZ,
        perspective: camDist,
        near: nearPlane,
        bufferScale,
        camera: effectiveCamera,
        vw,
        vh
      };

      let projectLocalPoint = null;
      let projectQuad = null;

      if (mvp) {
        projectQuad = (u, v, zCoord = 0) => {
          const clipX = mvp[0] * u + mvp[4] * v + mvp[8] * zCoord + mvp[12];
          const clipY = mvp[1] * u + mvp[5] * v + mvp[9] * zCoord + mvp[13];
          const clipZ = mvp[2] * u + mvp[6] * v + mvp[10] * zCoord + mvp[14];
          const clipW = mvp[3] * u + mvp[7] * v + mvp[11] * zCoord + mvp[15];

          if (clipW <= 0.001) {
            return { x: 0, y: 0, z: clipZ, scale: 0, isBehind: true };
          }
          const invW = 1.0 / clipW;
          let ndcX = clipX * invW;
          let ndcY = clipY * invW;
          if (Math.abs(lensDistort) > 0.001) {
            const r2 = ndcX * ndcX + ndcY * ndcY;
            const warp = 1.0 + lensDistort * r2;
            ndcX *= warp;
            ndcY *= warp;
          }
          return {
            x: (ndcX * 0.5 + 0.5) * vw,
            y: (-ndcY * 0.5 + 0.5) * vh,
            z: clipZ,
            scale: invW * totalZoom,
            isBehind: false
          };
        };

        projectLocalPoint = (lx, ly, lz = 0) => projectQuad(absW ? lx / absW : 0, absH ? ly / absH : 0, lz);

        pTL = projectQuad(-0.5, -0.5, 0);
        pTR = projectQuad( 0.5, -0.5, 0);
        pBR = projectQuad( 0.5,  0.5, 0);
        pBL = projectQuad(-0.5,  0.5, 0);

        pN  = projectQuad( 0.0, -0.5, 0);
        pE  = projectQuad( 0.5,  0.0, 0);
        pS  = projectQuad( 0.0,  0.5, 0);
        pW  = projectQuad(-0.5,  0.0, 0);

        const uAnchor = absW ? anchorX / absW : 0;
        const vAnchor = absH ? anchorY / absH : 0;
        pAnchor = projectQuad(uAnchor, vAnchor, anchorZ);

        isBehindCamera = (posZ >= maxZ) || [pTL, pTR, pBR, pBL].every(p => !p || p.isBehind);
      } else if (is3D) {
        const halfW = absW / 2;
        const halfH = absH / 2;

        projectLocalPoint = (lx, ly, lz = 0) => this.projectPoint(lx, ly, lz, transformParams);

        pTL = this.projectPoint(-halfW, -halfH, 0, transformParams);
        pTR = this.projectPoint( halfW, -halfH, 0, transformParams);
        pBR = this.projectPoint( halfW,  halfH, 0, transformParams);
        pBL = this.projectPoint(-halfW,  halfH, 0, transformParams);

        pN  = this.projectPoint( 0,     -halfH, 0, transformParams);
        pE  = this.projectPoint( halfW,  0,     0, transformParams);
        pS  = this.projectPoint( 0,      halfH, 0, transformParams);
        pW  = this.projectPoint(-halfW,  0,     0, transformParams);

        pAnchor = this.projectPoint(anchorX, anchorY, anchorZ, transformParams);
        isBehindCamera = (posZ >= maxZ) || [pTL, pTR, pBR, pBL].every(p => !p || p.isBehind);
      } else {
        const halfW = absW / 2;
        const halfH = absH / 2;

        projectLocalPoint = (lx, ly, lz = 0) => this.projectPoint(lx, ly, lz, transformParams);

        pTL = this.projectPoint(-halfW, -halfH, 0, transformParams);
        pTR = this.projectPoint(halfW, -halfH, 0, transformParams);
        pBR = this.projectPoint(halfW, halfH, 0, transformParams);
        pBL = this.projectPoint(-halfW, halfH, 0, transformParams);

        pN = this.projectPoint(0, -halfH, 0, transformParams);
        pE = this.projectPoint(halfW, 0, 0, transformParams);
        pS = this.projectPoint(0, halfH, 0, transformParams);
        pW = this.projectPoint(-halfW, 0, 0, transformParams);

        pAnchor = this.projectPoint(anchorX, anchorY, anchorZ, transformParams);
        isBehindCamera = (posZ >= maxZ) || [pTL, pTR, pBR, pBL].every(p => !p || p.isBehind);
      }

      const corners = [pTL, pTR, pBR, pBL];
      let backCorners = null;
      let apexPoint = null;
      const all3DCorners = [pTL, pTR, pBR, pBL];

      if (mvp) {
        const active3DFx = Array.isArray(layer.effects)
          ? layer.effects.find(f => f && !f.disabled && (f.type === 'box_3d' || f.type === 'extrude_3d' || f.type === 'pyramid_3d'))
          : null;
        let meshD = 0;
        if (active3DFx) {
          const lDepth = (layer && layer.scaleZ !== undefined) ? layer.scaleZ : (layer && layer.depth !== undefined ? layer.depth : undefined);
          if (active3DFx.type === 'box_3d') {
            const defaultD = Math.round(Math.min(absW || 300, absH || 300));
            meshD = Math.max(1, lDepth !== undefined ? lDepth : (active3DFx.depth !== undefined ? active3DFx.depth : defaultD));
          } else if (active3DFx.type === 'extrude_3d') {
            meshD = Math.max(1, lDepth !== undefined ? lDepth : (active3DFx.extrudeDepth !== undefined ? active3DFx.extrudeDepth : 35));
          } else if (active3DFx.type === 'pyramid_3d') {
            meshD = Math.max(1, lDepth !== undefined ? lDepth : (active3DFx.height !== undefined ? active3DFx.height : 80));
          }
        }
        if (meshD > 0 && typeof projectQuad === 'function') {
          if (active3DFx && active3DFx.type === 'pyramid_3d') {
            const apexX = ((active3DFx.apexX !== undefined ? active3DFx.apexX : 50) / 100 - 0.5);
            const apexY = ((active3DFx.apexY !== undefined ? active3DFx.apexY : 0) / 100 - 0.5);
            apexPoint = projectQuad(apexX, apexY, meshD);
            if (apexPoint && !apexPoint.isBehind) all3DCorners.push(apexPoint);
          } else {
            const pTL_b = projectQuad(-0.5, -0.5, -meshD);
            const pTR_b = projectQuad( 0.5, -0.5, -meshD);
            const pBR_b = projectQuad( 0.5,  0.5, -meshD);
            const pBL_b = projectQuad(-0.5,  0.5, -meshD);
            backCorners = [pTL_b, pTR_b, pBR_b, pBL_b];
            [pTL_b, pTR_b, pBR_b, pBL_b].forEach(p => {
              if (p && !p.isBehind) all3DCorners.push(p);
            });
          }
        }
      }

      const validCorners = all3DCorners.filter(p => p && !p.isBehind);
      const minX = validCorners.length > 0 ? Math.min(...validCorners.map(p => p.x)) : pTL.x;
      const maxX = validCorners.length > 0 ? Math.max(...validCorners.map(p => p.x)) : pBR.x;
      const minY = validCorners.length > 0 ? Math.min(...validCorners.map(p => p.y)) : pTL.y;
      const maxY = validCorners.length > 0 ? Math.max(...validCorners.map(p => p.y)) : pBR.y;

      const screenCenterX = (pTL.x + pBR.x) / 2;
      const screenCenterY = (pTL.y + pBR.y) / 2;

      let shapeContour = null;
      let shapeContourLocal = null;
      if (layer.type === 'shape') {
        shapeContourLocal = this.getShapeLocalContour(layer.shapeType || 'rectangle', layer.shapeProps || {}, absW, absH);
        if (Array.isArray(shapeContourLocal) && typeof projectLocalPoint === 'function') {
          shapeContour = shapeContourLocal.map(pt => projectLocalPoint(pt.x, pt.y, 0));
        }
      }

      return {
        is3D,
        isBehindCamera,
        maxZ,
        cx, cy,
        posZ: effectivePosZ,
        anchorX, anchorY,
        anchorZ: effectiveAnchorZ,
        w: absW, h: absH,
        scaleW: bw, scaleH: bh,
        signX, signY,
        rotation: rotZ,
        rotX: effectiveRotX,
        rotY: effectiveRotY,
        rotZ,
        skewX, skewY,
        x: minX, y: minY,
        aabbW: maxX - minX,
        aabbH: maxY - minY,
        corners,
        backCorners,
        apexPoint,
        is3DBox: !!backCorners,
        shapeContour,
        shapeContourLocal,
        shapeType: layer.shapeType || null,
        shapeProps: layer.shapeProps || null,
        bufferScale,
        handles: [
          { type: 'nw', x: pTL.x, y: pTL.y, cursor: this.getHandleCursor(pTL.x, pTL.y, screenCenterX, screenCenterY) },
          { type: 'n',  x: pN.x,  y: pN.y,  cursor: this.getHandleCursor(pN.x,  pN.y,  screenCenterX, screenCenterY) },
          { type: 'ne', x: pTR.x, y: pTR.y, cursor: this.getHandleCursor(pTR.x, pTR.y, screenCenterX, screenCenterY) },
          { type: 'e',  x: pE.x,  y: pE.y,  cursor: this.getHandleCursor(pE.x,  pE.y,  screenCenterX, screenCenterY) },
          { type: 'se', x: pBR.x, y: pBR.y, cursor: this.getHandleCursor(pBR.x, pBR.y, screenCenterX, screenCenterY) },
          { type: 's',  x: pS.x,  y: pS.y,  cursor: this.getHandleCursor(pS.x,  pS.y,  screenCenterX, screenCenterY) },
          { type: 'sw', x: pBL.x, y: pBL.y, cursor: this.getHandleCursor(pBL.x, pBL.y, screenCenterX, screenCenterY) },
          { type: 'w',  x: pW.x,  y: pW.y,  cursor: this.getHandleCursor(pW.x,  pW.y,  screenCenterX, screenCenterY) },
          { type: 'anchor', x: pAnchor.x, y: pAnchor.y, cursor: 'move' }
        ],
        anchor: pAnchor,
        transformParams
      };
    }

    /**
     * Hit test a point against the transformed 3D quad
     */
    hitTest(bounds, px, py) {
      if (!bounds || bounds.isBehindCamera) return false;
      if (px < bounds.x || px > bounds.x + bounds.aabbW ||
          py < bounds.y || py > bounds.y + bounds.aabbH) {
        return false;
      }
      const poly = bounds.corners;
      if (!poly || poly.length < 3) return false;

      let hasPos = false, hasNeg = false;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const cross = (px - a.x) * (b.y - a.y) - (py - a.y) * (b.x - a.x);
        if (cross > 0) hasPos = true;
        if (cross < 0) hasNeg = true;
        if (hasPos && hasNeg) return false;
      }
      return true;
    }

    /**
     * Render layer onto destination 2D canvas with hardware 3D perspective
     */
    renderLayer(ctx, el, layer, bufferScale = 1, camera = null, currentSec = null) {
      if (!ctx || !el || !this._hasValidDimensions(el)) return;

      const bounds = this.getBounds(layer, bufferScale, camera);
      if (bounds.isBehindCamera) {
        return; // Clipped out of camera view: layer has passed behind camera near plane
      }
      const { absW = bounds.w, absH = bounds.h, signX, signY, is3D } = bounds;

      // 1. Fast Path: Pure 2D (Single native ctx.drawImage)
      if (!is3D || !this.isReady) {
        ctx.save();
        if (layer.opacity !== undefined && layer.opacity !== null) {
          const rawOp = Number(layer.opacity);
          ctx.globalAlpha = (rawOp > 1.0) ? Math.max(0, Math.min(1, rawOp / 100)) : Math.max(0, Math.min(1, rawOp));
        }
        if (layer.blendMode && layer.blendMode !== 'normal') {
          ctx.globalCompositeOperation = (layer.blendMode === 'mask') ? 'destination-in' : (layer.blendMode === 'exclude') ? 'destination-out' : layer.blendMode;
        }
        if (window.FishEffects && typeof window.FishEffects.applyToContext === 'function') {
          window.FishEffects.applyToContext(ctx, layer);
        }
        if (is3D && layer._dofBlur && layer._dofBlur > 0.5) {
          const curF = ctx.filter && ctx.filter !== 'none' ? ctx.filter : '';
          ctx.filter = (curF ? (curF + ' ') : '') + `blur(${layer._dofBlur.toFixed(1)}px)`;
        }
        const ax = (bounds.anchorX || 0) * signX;
        const ay = (bounds.anchorY || 0) * signY;
        ctx.translate(bounds.cx + ax, bounds.cy + ay);

        if (is3D && !this.isReady) {
          const posZ = bounds.posZ || 0;
          const camLens = Math.max(1, camera ? (camera.cameraLens !== undefined ? camera.cameraLens : 50) : 50);
          const camZoom = camera ? (camera.cameraZoom !== undefined ? camera.cameraZoom : 100) : 100;
          const lensFactor = Math.max(0.01, camLens / 50);
          const zoomFactor = Math.max(0.01, camZoom / 100);
          const totalZoom = lensFactor * zoomFactor;
          const camDist = CAMERA_DISTANCE * lensFactor * bufferScale;
          const nearPlane = NEAR_PLANE * bufferScale;
          const maxZ = camDist - nearPlane;
          const zScale = posZ ? (camDist / Math.max(nearPlane, camDist - Math.min(posZ, maxZ))) : 1;
          const finalScale = zScale * totalZoom;
          if (finalScale !== 1) {
            ctx.scale(finalScale, finalScale);
          }
          if (bounds.rotX || bounds.rotY) {
            const cosX = Math.cos(((bounds.rotX || 0) * Math.PI) / 180);
            const cosY = Math.cos(((bounds.rotY || 0) * Math.PI) / 180);
            ctx.scale(cosY, cosX);
          }
        }

        if (bounds.rotation) {
          ctx.rotate((bounds.rotation * Math.PI) / 180);
        }
        if (bounds.skewX || bounds.skewY) {
          const tanX = Math.tan(((bounds.skewX || 0) * Math.PI) / 180);
          const tanY = Math.tan(((bounds.skewY || 0) * Math.PI) / 180);
          ctx.transform(1, tanY, tanX, 1, 0, 0);
        }
        if (signX < 0 || signY < 0) {
          ctx.scale(signX, signY);
        }
        const drawX = -absW / 2 - (bounds.anchorX || 0);
        const drawY = -absH / 2 - (bounds.anchorY || 0);
        try {
          const curSec = (typeof currentSec === 'number' && !isNaN(currentSec))
            ? currentSec
            : ((layer && typeof layer._currentSec === 'number')
              ? layer._currentSec
              : ((typeof window !== 'undefined' && typeof window._currentRenderSec === 'number')
                ? window._currentRenderSec
                : ((typeof window !== 'undefined' && typeof window.currentPlaybackSec === 'number')
                  ? window.currentPlaybackSec
                  : 0)));
          if (window.FishEffects && typeof window.FishEffects.renderLayer === 'function') {
            window.FishEffects.renderLayer(ctx, el, layer, { x: drawX, y: drawY, w: absW, h: absH, bufferScale: bounds.bufferScale || bufferScale || 1, unitScale: bounds.bufferScale || bufferScale || 1 }, curSec);
          } else {
            ctx.drawImage(el, drawX, drawY, absW, absH);
          }

          if (window.FishEffects && typeof window.FishEffects.applyPostEffects === 'function') {
            window.FishEffects.applyPostEffects(ctx, el, layer, { x: drawX, y: drawY, w: absW, h: absH });
          }
        } catch (fxErr) {
          console.warn('[Engine] Effect render failed, falling back to base image:', fxErr);
          try { ctx.drawImage(el, drawX, drawY, absW, absH); } catch (drawErr) {
            console.warn('[Engine] Base image fallback draw failed:', drawErr);
          }
        }
        ctx.restore();
        return;
      }

      // 2. Hardware 3D Perspective Path: Single Quad GPU Draw
      const targetCanvas = ctx.canvas;
      const vw = targetCanvas ? targetCanvas.width : (bounds.cx * 2 || 1920);
      const vh = targetCanvas ? targetCanvas.height : (bounds.cy * 2 || 1080);

      // Edge-on guard around 90 deg: skip invisible edge-on slivers (only when true layer bounds are also sliver)
      if ((bounds.aabbW < 1.0 && bounds.w < 1.0) || (bounds.aabbH < 1.0 && bounds.h < 1.0)) {
        return;
      }

      // Pre-process 2D effects onto local offscreen canvas before 3D perspective projection
      const layerSec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : ((layer && typeof layer._currentSec === 'number') ? layer._currentSec : null);
      const processed = this._getEffectProcessedElement(el, layer, bounds, layerSec);
      const sourceEl = processed.el;

      // Calculate Full 4x4 MVP Matrix
      let mvp = this._computeMVP(bounds, vw, vh, 0, camera);
      if (!mvp) return;

      if (processed.padX > 0 || processed.padY > 0) {
        const sX = (processed.origW + processed.padX * 2) / processed.origW;
        const sY = (processed.origH + processed.padY * 2) / processed.origH;
        const scaledMVP = new Float32Array(mvp);
        scaledMVP[0] *= sX;
        scaledMVP[1] *= sX;
        scaledMVP[2] *= sX;
        scaledMVP[3] *= sX;
        scaledMVP[4] *= sY;
        scaledMVP[5] *= sY;
        scaledMVP[6] *= sY;
        scaledMVP[7] *= sY;
        mvp = scaledMVP;
      }

      const gl = this.gl;
      if (this.glCanvas.width !== vw || this.glCanvas.height !== vh) {
        this.glCanvas.width = vw;
        this.glCanvas.height = vh;
        gl.viewport(0, 0, vw, vh);
      }

      gl.viewport(0, 0, vw, vh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this.program);
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      // Bind quad buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.enableVertexAttribArray(this.locations.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

      // Upload/Bind texture
      const tex = this._getOrCreateTexture(sourceEl);
      if (!tex) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.locations.texture, 0);
      const rawLayerOp = (layer.opacity !== undefined && layer.opacity !== null) ? Number(layer.opacity) : 1.0;
      const normLayerOp = (rawLayerOp > 1.0) ? Math.max(0, Math.min(1, rawLayerOp / 100)) : Math.max(0, Math.min(1, rawLayerOp));
      gl.uniform1f(this.locations.opacity, normLayerOp);
      if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(camera));

      const tileFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f.type === 'tile' && !f.disabled)
        : null;

      const boxFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'box_3d')
        : null;
      const extrudeFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'extrude_3d')
        : null;
      const pyramidFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'pyramid_3d')
        : null;
      const sphereFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'sphere_3d')
        : null;

      if (boxFx || extrudeFx || pyramidFx || sphereFx) {
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        if (boxFx) this._draw3DBoxMesh(gl, mvp, boxFx, bounds, normLayerOp, layer);
        else if (extrudeFx) this._draw3DExtrudeMesh(gl, mvp, extrudeFx, bounds, normLayerOp, layer, sourceEl);
        else if (pyramidFx) this._draw3DPyramidMesh(gl, mvp, pyramidFx, bounds, normLayerOp, layer);
        else if (sphereFx) this._draw3DSphereMesh(gl, mvp, sphereFx, bounds, normLayerOp, layer);
        gl.disable(gl.DEPTH_TEST);
      } else {
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        this._drawQuadOrTile(gl, mvp, tileFx, vw, vh, bounds);
      }

      // Blit GL framebuffer onto target 2D canvas context
      this._blitGLToContext(ctx, layer, bounds, vw, vh, bufferScale);
    }

    _drawQuadOrTile(gl, mvp, tileFx, vw, vh, bounds) {
      if (tileFx) {
        const isMirror = (tileFx.mirror === 1 || tileFx.mirror === true || tileFx.mirror === '1' || tileFx.mirror === 'true' || tileFx.mirror === 'on');
        const tileScale = Math.max(5, (tileFx.scale !== undefined ? tileFx.scale : 100)) / 100;
        const rawOffX = ((tileFx.offsetX !== undefined ? tileFx.offsetX : 0) / 100);
        const rawOffY = ((tileFx.offsetY !== undefined ? tileFx.offsetY : 0) / 100);

        const periodX = isMirror ? (tileScale * 2) : tileScale;
        const periodY = isMirror ? (tileScale * 2) : tileScale;

        let offX = rawOffX % periodX;
        if (offX < 0) offX += periodX;

        let offY = rawOffY % periodY;
        if (offY < 0) offY += periodY;

        const spanX = Math.ceil(vw / Math.max(20, (bounds.w || 100) * tileScale));
        const spanY = Math.ceil(vh / Math.max(20, (bounds.h || 100) * tileScale));
        const countX = Math.min(16, Math.max(4, Math.ceil(spanX * 2.5)));
        const countY = Math.min(16, Math.max(4, Math.ceil(spanY * 2.5)));
        const tileMVP = new Float32Array(16);

        for (let j = -countY; j <= countY; j++) {
          for (let i = -countX; i <= countX; i++) {
            const flipX = isMirror && (Math.abs(i) % 2 === 1);
            const flipY = isMirror && (Math.abs(j) % 2 === 1);

            const dirX = flipX ? -1 : 1;
            const dirY = flipY ? -1 : 1;

            const sX = tileScale * dirX;
            const sY = tileScale * dirY;

            const shiftX = offX + i * tileScale;
            const shiftY = offY + j * tileScale;

            tileMVP[0] = mvp[0] * sX;
            tileMVP[1] = mvp[1] * sX;
            tileMVP[2] = mvp[2] * sX;
            tileMVP[3] = mvp[3] * sX;

            tileMVP[4] = mvp[4] * sY;
            tileMVP[5] = mvp[5] * sY;
            tileMVP[6] = mvp[6] * sY;
            tileMVP[7] = mvp[7] * sY;

            tileMVP[8] = mvp[8];
            tileMVP[9] = mvp[9];
            tileMVP[10] = mvp[10];
            tileMVP[11] = mvp[11];

            tileMVP[12] = mvp[12] + mvp[0] * shiftX + mvp[4] * shiftY;
            tileMVP[13] = mvp[13] + mvp[1] * shiftX + mvp[5] * shiftY;
            tileMVP[14] = mvp[14] + mvp[2] * shiftX + mvp[6] * shiftY;
            tileMVP[15] = mvp[15] + mvp[3] * shiftX + mvp[7] * shiftY;

            const maxRadiusW = Math.abs(tileMVP[3] * 0.5) + Math.abs(tileMVP[7] * 0.5);
            if (tileMVP[15] + maxRadiusW <= 0.001) continue;

            gl.uniformMatrix4fv(this.locations.matrix, false, tileMVP);
            gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);
          }
        }
      } else {
        gl.uniform1i(this.locations.mode, 0);
        gl.disableVertexAttribArray(this.locations.color);
        gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
        gl.uniformMatrix4fv(this.locations.matrix, false, mvp);
        gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);
      }
    }

    _draw3DBoxMesh(gl, mvp, boxFx, bounds, layerOpacity, layer = null) {
      const defaultDepth = bounds && (bounds.w || bounds.h)
        ? Math.round(Math.min(bounds.w || 300, bounds.h || 300))
        : 300;
      const lDepth = (layer && layer.scaleZ !== undefined) ? layer.scaleZ : ((layer && layer.depth !== undefined) ? layer.depth : ((boxFx && boxFx.depth !== undefined) ? boxFx.depth : null));
      const depth = Math.max(1, lDepth !== null ? lDepth : defaultDepth);
      const isSolidMode = boxFx && boxFx.sideMode === 'solid color';
      const defaultWhite = '#ffffff';
      let faceColor = (boxFx && boxFx.faceColor) || defaultWhite;
      if (isSolidMode && faceColor === defaultWhite && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const rawFaceOp = (boxFx && boxFx.faceOpacity !== undefined) ? boxFx.faceOpacity : 100;
      const faceOpacity = Math.max(0, Math.min(1, rawFaceOp / 100)) * (layerOpacity !== undefined ? layerOpacity : 1.0);
      const edgeColor = (boxFx && boxFx.edgeColor) || '#ffffff';
      const edgeOpacity = Math.max(0, Math.min(1, (boxFx && boxFx.edgeOpacity !== undefined ? boxFx.edgeOpacity : 0) / 100));
      const shading = Math.max(0, Math.min(1, (boxFx && boxFx.shading !== undefined ? boxFx.shading : 0) / 100));

      gl.uniformMatrix4fv(this.locations.matrix, false, mvp);

      // --- Pass 1: Front Face (Textured, at z = 0) ---
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
      gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);

      if (depth < 0.5) return;

      // --- Pass 2: 5 Shaded Faces (Back, Top, Bottom, Left, Right) ---
      const cBase = hexToRgb(faceColor);
      const mulTop = 1.0 + shading * 0.4;
      const mulRight = Math.max(0.15, 1.0 - shading * 0.25);
      const mulLeft = Math.max(0.15, 1.0 - shading * 0.35);
      const mulBot = Math.max(0.1, 1.0 - shading * 0.55);
      const mulBack = Math.max(0.1, 1.0 - shading * 0.45);

      const tintR = isSolidMode ? (cBase.r / 255) : 1.0;
      const tintG = isSolidMode ? (cBase.g / 255) : 1.0;
      const tintB = isSolidMode ? (cBase.b / 255) : 1.0;

      const makeCol = (m) => [
        Math.min(1.0, tintR * m),
        Math.min(1.0, tintG * m),
        Math.min(1.0, tintB * m),
        faceOpacity
      ];

      const cTop = makeCol(mulTop);
      const cRight = makeCol(mulRight);
      const cLeft = makeCol(mulLeft);
      const cBot = makeCol(mulBot);
      const cBack = makeCol(mulBack);

      const solidPositions = new Float32Array([
        // Back Face (z = -depth)
        -0.5, -0.5, -depth,
         0.5, -0.5, -depth,
         0.5,  0.5, -depth,
        -0.5,  0.5, -depth,

        // Top Face (y = -0.5)
        -0.5, -0.5,      0,
         0.5, -0.5,      0,
         0.5, -0.5, -depth,
        -0.5, -0.5, -depth,

        // Bottom Face (y = 0.5)
        -0.5,  0.5,      0,
         0.5,  0.5,      0,
         0.5,  0.5, -depth,
        -0.5,  0.5, -depth,

        // Left Face (x = -0.5)
        -0.5, -0.5,      0,
        -0.5,  0.5,      0,
        -0.5,  0.5, -depth,
        -0.5, -0.5, -depth,

        // Right Face (x = 0.5)
         0.5, -0.5,      0,
         0.5,  0.5,      0,
         0.5,  0.5, -depth,
         0.5, -0.5, -depth
      ]);

      const solidColors = new Float32Array([
        ...cBack, ...cBack, ...cBack, ...cBack,
        ...cTop, ...cTop, ...cTop, ...cTop,
        ...cBot, ...cBot, ...cBot, ...cBot,
        ...cLeft, ...cLeft, ...cLeft, ...cLeft,
        ...cRight, ...cRight, ...cRight, ...cRight
      ]);

      const solidTexCoords = new Float32Array([
        // Back Face (mirrored texture)
        1.0, 0.0,
        0.0, 0.0,
        0.0, 1.0,
        1.0, 1.0,

        // Top Face (maps texture across top surface)
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,

        // Bottom Face (maps texture across bottom surface)
        0.0, 1.0,
        1.0, 1.0,
        1.0, 0.0,
        0.0, 0.0,

        // Left Face (maps texture across left surface)
        0.0, 0.0,
        0.0, 1.0,
        1.0, 1.0,
        1.0, 0.0,

        // Right Face (maps texture across right surface)
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0,
        0.0, 0.0
      ]);

      const solidIndices = new Uint16Array([
        0, 1, 2,  0, 2, 3,
        4, 5, 6,  4, 6, 7,
        8, 9, 10,  8, 10, 11,
        12, 13, 14,  12, 14, 15,
        16, 17, 18,  16, 18, 19
      ]);

      gl.uniform1i(this.locations.mode, isSolidMode ? 1 : 0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, solidPositions, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, solidTexCoords, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, solidColors, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshBuffers.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, solidIndices, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, 30, gl.UNSIGNED_SHORT, 0);

      // --- Pass 3: 12 Wireframe Edge Lines ---
      if (edgeOpacity > 0) {
        const edgePositions = new Float32Array([
          // Front 4 edges (z = 0)
          -0.5, -0.5, 0,    0.5, -0.5, 0,
           0.5, -0.5, 0,    0.5,  0.5, 0,
           0.5,  0.5, 0,   -0.5,  0.5, 0,
          -0.5,  0.5, 0,   -0.5, -0.5, 0,

          // Back 4 edges (z = -depth)
          -0.5, -0.5, -depth,    0.5, -0.5, -depth,
           0.5, -0.5, -depth,    0.5,  0.5, -depth,
           0.5,  0.5, -depth,   -0.5,  0.5, -depth,
          -0.5,  0.5, -depth,   -0.5, -0.5, -depth,

          // 4 Connecting side edges
          -0.5, -0.5, 0,   -0.5, -0.5, -depth,
           0.5, -0.5, 0,    0.5, -0.5, -depth,
           0.5,  0.5, 0,    0.5,  0.5, -depth,
          -0.5,  0.5, 0,   -0.5,  0.5, -depth
        ]);

        const cEdge = hexToRgb(edgeColor);
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttrib4f(this.locations.color, cEdge.r / 255, cEdge.g / 255, cEdge.b / 255, edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, edgePositions, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.LINES, 0, 24);
      }

      // Restore standard 2D quad state for subsequent renders
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
    }

    /* ── True-shape silhouette extrusion (text / triangle / image cutouts) ────
     * Marching squares on the source alpha (≤176px readout) yields contour
     * segments in unit-quad space; side walls are built along the REAL outline
     * instead of the bounding box, so text extrudes as text and a triangle
     * extrudes as a triangle. Fully opaque rectangles (video, solids) keep the
     * cheap exact box walls ('box'); fully transparent ⇒ 'empty'.
     * Cached per source content-version (static images compute once). */
    _extractExtrudeContour(srcEl) {
      if (!srcEl || typeof document === 'undefined') return { kind: 'box', segs: null };
      const ew = Math.round(srcEl.naturalWidth || srcEl.videoWidth || srcEl.width || 0);
      const eh = Math.round(srcEl.naturalHeight || srcEl.videoHeight || srcEl.height || 0);
      if (ew < 2 || eh < 2) return { kind: 'box', segs: null };
      const ver = (srcEl._contentVersion !== undefined && srcEl._contentVersion !== null)
        ? srcEl._contentVersion
        : ((srcEl.tagName === 'IMG') ? ('img:' + (srcEl.src || '')) : -1);
      const MAXD = 256;
      const k = Math.min(1, MAXD / Math.max(ew, eh));
      const W = Math.max(8, Math.round(ew * k));
      const H = Math.max(8, Math.round(eh * k));
      const cached = this._extrudeContourCache.get(srcEl);
      if (cached && cached.ver === ver && cached.W === W && cached.H === H) return cached.res;
      let res = { kind: 'box', segs: null };
      try {
        if (!this._extrudeScratch) {
          this._extrudeScratch = document.createElement('canvas');
          this._extrudeScratchCtx = this._extrudeScratch.getContext('2d', { willReadFrequently: true });
        }
        const sc = this._extrudeScratch;
        const sx = this._extrudeScratchCtx;
        if (!sx) return res;
        if (sc.width !== W || sc.height !== H) { sc.width = W; sc.height = H; }
        sx.setTransform(1, 0, 0, 1, 0, 0);
        sx.globalCompositeOperation = 'source-over';
        sx.globalAlpha = 1;
        sx.clearRect(0, 0, W, H);
        sx.drawImage(srcEl, 0, 0, W, H);
        const px = sx.getImageData(0, 0, W, H).data;
        let opaque = 0, clear = 0;
        const total = W * H;
        for (let i = 3; i < px.length; i += 4) {
          const a = px[i];
          if (a > 250) opaque++;
          else if (a < 8) clear++;
        }
        if (clear === total) res = { kind: 'empty', segs: null };
        else if (opaque === total) res = { kind: 'box', segs: null };
        else {
          const segs = this._marchingSquaresAlpha(px, W, H);
          if (segs && segs.length >= 24) {
            // Inward-shifted UVs: the contour sits on ~50% alpha texels, which
            // would render ghostly semi-transparent walls. Sampling ~1.5px
            // inside the shape grabs fully opaque interior texels instead.
            res = { kind: 'contour', segs, uvs: this._inwardContourUvs(px, W, H, segs) };
          } else {
            res = { kind: 'box', segs: null };
          }
        }
      } catch (_) { res = { kind: 'box', segs: null }; }
      try { this._extrudeContourCache.set(srcEl, { ver, W, H, res }); } catch (_) {}
      return res;
    }

    /* Marching squares on alpha channel → flat [x1,y1,x2,y2 …] segments in
     * unit-quad space ([-0.5, 0.5], y down like texture v). Holes (O, A, …)
     * emerge automatically since every cell is independent. Pure function. */
    _marchingSquaresAlpha(px, W, H) {
      const T = 128;
      const segs = [];
      const at = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return 0;
        return px[((y * W) + x) * 4 + 3];
      };
      const mix = (v0, v1) => {
        if (v1 === v0) return 0.5;
        const t = (T - v0) / (v1 - v0);
        return t < 0 ? 0 : (t > 1 ? 1 : t);
      };
      // pixel-corner (ix,iy) integer grid 0..W,0..H → unit space (matches uv-0.5)
      const UX = ix => (ix / W) - 0.5;
      const UY = iy => (iy / H) - 0.5;
      const emit = (ax, ay, bx, by) => {
        const x1 = UX(ax), y1 = UY(ay), x2 = UX(bx), y2 = UY(by);
        const dx = x2 - x1, dy = y2 - y1;
        if (dx * dx + dy * dy < 1e-12) return;
        segs.push(x1, y1, x2, y2);
      };
      for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
          const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
          let idx = 0;
          if (a > T) idx |= 8;
          if (b > T) idx |= 4;
          if (c > T) idx |= 2;
          if (d > T) idx |= 1;
          if (idx === 0 || idx === 15) continue;
          // crossing points on the four cell edges (pixel-corner coords)
          const top = [x + mix(a, b), y];
          const right = [x + 1, y + mix(b, c)];
          const bot = [x + mix(d, c), y + 1];
          const left = [x, y + mix(a, d)];
          const S = (p, q) => emit(p[0], p[1], q[0], q[1]);
          switch (idx) {
            case 1: case 14: S(left, bot); break;
            case 2: case 13: S(bot, right); break;
            case 3: case 12: S(left, right); break;
            case 4: case 11: S(top, right); break;
            case 5: S(left, top); S(right, bot); break;
            case 6: case 9: S(top, bot); break;
            case 7: case 8: S(left, top); break;
            case 10: S(top, right); S(left, bot); break;
          }
        }
      }
      return segs;
    }

    /* Inward-shifted sample UVs for contour walls (flat [u1,v1,u2,v2 …],
     * parallel to segs). Probes both sides of each segment in the alpha grid
     * and shifts ~1.5px toward the more opaque side, so walls sample solid
     * interior texels instead of the ~50% edge texels. Pure function. */
    _inwardContourUvs(data, W, H, segs) {
      const at = (x, y) => {
        x = x < 0 ? 0 : (x > W - 1 ? W - 1 : Math.round(x));
        y = y < 0 ? 0 : (y > H - 1 ? H - 1 : Math.round(y));
        return data[((y * W) + x) * 4 + 3];
      };
      const out = new Float32Array(segs.length);
      for (let i = 0; i + 3 < segs.length; i += 4) {
        // unit space → pixel-corner coords (exact inverse of UX/UY mapping)
        const ax = (segs[i] + 0.5) * W, ay = (segs[i + 1] + 0.5) * H;
        const bx = (segs[i + 2] + 0.5) * W, by = (segs[i + 3] + 0.5) * H;
        let dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const nx = dy, ny = -dx;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const aPlus = at(mx + nx * 1.5, my + ny * 1.5);
        const aMinus = at(mx - nx * 1.5, my - ny * 1.5);
        const s = (aPlus >= aMinus) ? 1 : -1;
        const ox = (nx * s * 1.5) / W, oy = (ny * s * 1.5) / H;
        const cl = v => v < 0 ? 0 : (v > 1 ? 1 : v);
        out[i] = cl((ax / W) + ox); out[i + 1] = cl((ay / H) + oy);
        out[i + 2] = cl((bx / W) + ox); out[i + 3] = cl((by / H) + oy);
      }
      return out;
    }

    /* Contour side walls + back cap arrays. Front edge verts carry colFront,
     * back edge verts colBack (depth cue). uvSegs (optional, same layout as
     * segs) overrides geometric UVs for inward-shifted opaque sampling. Pure. */
    _buildExtrudeWallArrays(segs, uvSegs, depth, colFront, colBack) {
      const total = Math.floor(segs.length / 4);
      if (total < 1) return null;
      const MAXS = 4096;
      const stride = total > MAXS ? Math.ceil(total / MAXS) : 1;
      const order = [];
      for (let s = 0; s < total; s += stride) order.push(s);
      const S = order.length;
      const positions = new Float32Array(S * 18);
      const colors = new Float32Array(S * 24);
      const uvs = new Float32Array(S * 12);
      const edges = new Float32Array(S * 12);
      const pushC = (arr, o, col) => { arr[o] = col[0]; arr[o + 1] = col[1]; arr[o + 2] = col[2]; arr[o + 3] = col[3]; };
      let p = 0, c = 0, t = 0, e = 0;
      for (let k = 0; k < S; k++) {
        const s = order[k] * 4;
        const ax = segs[s], ay = segs[s + 1], bx = segs[s + 2], by = segs[s + 3];
        // Af, Bf, Bb | Af, Bb, Ab
        positions[p++] = ax; positions[p++] = ay; positions[p++] = 0;
        positions[p++] = bx; positions[p++] = by; positions[p++] = 0;
        positions[p++] = bx; positions[p++] = by; positions[p++] = -depth;
        positions[p++] = ax; positions[p++] = ay; positions[p++] = 0;
        positions[p++] = bx; positions[p++] = by; positions[p++] = -depth;
        positions[p++] = ax; positions[p++] = ay; positions[p++] = -depth;
        pushC(colors, c, colFront); c += 4;
        pushC(colors, c, colFront); c += 4;
        pushC(colors, c, colBack); c += 4;
        pushC(colors, c, colFront); c += 4;
        pushC(colors, c, colBack); c += 4;
        pushC(colors, c, colBack); c += 4;
        // Inward-shifted UVs when available (opaque interior sampling);
        // otherwise geometric UVs (exact contour location).
        const hasUv = uvSegs && uvSegs.length >= s + 4;
        const u1 = hasUv ? uvSegs[s] : ax + 0.5;
        const v1 = hasUv ? uvSegs[s + 1] : ay + 0.5;
        const u2 = hasUv ? uvSegs[s + 2] : bx + 0.5;
        const v2 = hasUv ? uvSegs[s + 3] : by + 0.5;
        uvs[t++] = u1; uvs[t++] = v1;
        uvs[t++] = u2; uvs[t++] = v2;
        uvs[t++] = u2; uvs[t++] = v2;
        uvs[t++] = u1; uvs[t++] = v1;
        uvs[t++] = u2; uvs[t++] = v2;
        uvs[t++] = u1; uvs[t++] = v1;
        edges[e++] = ax; edges[e++] = ay; edges[e++] = 0;
        edges[e++] = bx; edges[e++] = by; edges[e++] = 0;
        edges[e++] = ax; edges[e++] = ay; edges[e++] = -depth;
        edges[e++] = bx; edges[e++] = by; edges[e++] = -depth;
      }
      return { positions, colors, uvs, edges, count: S * 6, edgeCount: S * 4 };
    }

    /* Draw silhouette walls + textured back cap + contour edge lines. */
    _drawExtrudeContourSolid(gl, segs, uvSegs, depth, opts) {
      const built = this._buildExtrudeWallArrays(segs, uvSegs, depth, opts.colFront, opts.colBack);
      if (!built) return;
      gl.uniform1i(this.locations.mode, opts.solid ? 1 : 0);
      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, built.positions, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, built.uvs, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, built.colors, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, built.count);

      // Back cap (textured silhouette at z = -depth, same uv as front)
      const bp = new Float32Array([
        -0.5, -0.5, -depth,   0.5, -0.5, -depth,   0.5, 0.5, -depth,
        -0.5, -0.5, -depth,   0.5,  0.5, -depth,  -0.5, 0.5, -depth
      ]);
      const buv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
      const bc = new Float32Array(24);
      for (let i = 0; i < 6; i++) {
        bc[i * 4] = opts.colBack[0]; bc[i * 4 + 1] = opts.colBack[1];
        bc[i * 4 + 2] = opts.colBack[2]; bc[i * 4 + 3] = opts.colBack[3];
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, bp, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, buv, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, bc, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (opts.edgeOpacity > 0) {
        const cE = opts.edgeRgb;
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttrib4f(this.locations.color, cE.r / 255, cE.g / 255, cE.b / 255, opts.edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, built.edges, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, built.edgeCount);
      }
    }

    /* Restore standard 2D quad attrib state after a mesh draw. */
    _restoreMeshQuadState(gl) {
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
    }

    _draw3DExtrudeMesh(gl, mvp, extrudeFx, bounds, layerOpacity, layer = null, srcEl = null) {
      const defaultDepth = bounds && (bounds.w || bounds.h)
        ? Math.round(Math.min(bounds.w || 300, bounds.h || 300))
        : 300;
      const lDepth = (layer && layer.scaleZ !== undefined) ? layer.scaleZ : ((layer && layer.depth !== undefined) ? layer.depth : ((extrudeFx && extrudeFx.extrudeDepth !== undefined) ? extrudeFx.extrudeDepth : null));
      const depth = Math.max(1, lDepth !== null ? lDepth : defaultDepth);
      const isSolidMode = extrudeFx && extrudeFx.sideMode === 'solid color';
      const defaultWhite = '#ffffff';
      let faceColor = (extrudeFx && (extrudeFx.faceColor || extrudeFx.shadeColor)) || defaultWhite;
      if (isSolidMode && faceColor === defaultWhite && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const rawFaceOp = (extrudeFx && (extrudeFx.faceOpacity !== undefined ? extrudeFx.faceOpacity : extrudeFx.shadeOpacity)) !== undefined ? (extrudeFx.faceOpacity !== undefined ? extrudeFx.faceOpacity : extrudeFx.shadeOpacity) : 100;
      const faceOpacity = Math.max(0, Math.min(1, rawFaceOp / 100)) * (layerOpacity !== undefined ? layerOpacity : 1.0);
      const edgeColor = (extrudeFx && extrudeFx.edgeColor) || '#ffffff';
      const edgeOpacity = Math.max(0, Math.min(1, (extrudeFx && extrudeFx.edgeOpacity !== undefined ? extrudeFx.edgeOpacity : 0) / 100));
      const shading = Math.max(0, Math.min(1, (extrudeFx && extrudeFx.shading !== undefined ? extrudeFx.shading : 0) / 100));

      gl.uniformMatrix4fv(this.locations.matrix, false, mvp);

      // Front Face (Textured, at z = 0)
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
      gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);

      if (depth < 0.5) return;

      // 4 Extrusion Side Walls + Back Face
      const cBase = hexToRgb(faceColor);
      const mulTop = 1.0 + shading * 0.4;
      const mulRight = Math.max(0.15, 1.0 - shading * 0.25);
      const mulLeft = Math.max(0.15, 1.0 - shading * 0.35);
      const mulBot = Math.max(0.1, 1.0 - shading * 0.55);
      const mulBack = Math.max(0.1, 1.0 - shading * 0.45);

      const tintR = isSolidMode ? (cBase.r / 255) : 1.0;
      const tintG = isSolidMode ? (cBase.g / 255) : 1.0;
      const tintB = isSolidMode ? (cBase.b / 255) : 1.0;

      const makeCol = (m) => [
        Math.min(1.0, tintR * m),
        Math.min(1.0, tintG * m),
        Math.min(1.0, tintB * m),
        faceOpacity
      ];

      const cTop = makeCol(mulTop);
      const cRight = makeCol(mulRight);
      const cLeft = makeCol(mulLeft);
      const cBot = makeCol(mulBot);
      const cBack = makeCol(mulBack);

      // True-shape branch: text / triangle / cutout layers extrude their own
      // alpha outline (silhouette walls); opaque rectangles fall through to the
      // box walls below. Empty layers draw nothing but restore GL state.
      const contour = this._extractExtrudeContour(srcEl);
      const contourSegs = (contour && contour.kind === 'contour' && contour.segs) ? contour.segs : null;
      if (contourSegs && contourSegs.length >= 24) {
        this._drawExtrudeContourSolid(gl, contourSegs, contour.uvs, depth, {
          solid: isSolidMode,
          colFront: makeCol(1.0),
          colBack: makeCol(Math.max(0.1, 1.0 - shading * 0.45)),
          edgeRgb: hexToRgb(edgeColor),
          edgeOpacity
        });
        this._restoreMeshQuadState(gl);
        return;
      }
      if (contour && contour.kind === 'empty') {
        this._restoreMeshQuadState(gl);
        return;
      }

      const solidPositions = new Float32Array([
        // Back Face (z = -depth)
        -0.5, -0.5, -depth,
         0.5, -0.5, -depth,
         0.5,  0.5, -depth,
        -0.5,  0.5, -depth,

        // Top Face (y = -0.5)
        -0.5, -0.5,      0,
         0.5, -0.5,      0,
         0.5, -0.5, -depth,
        -0.5, -0.5, -depth,

        // Bottom Face (y = 0.5)
        -0.5,  0.5,      0,
         0.5,  0.5,      0,
         0.5,  0.5, -depth,
        -0.5,  0.5, -depth,

        // Left Face (x = -0.5)
        -0.5, -0.5,      0,
        -0.5,  0.5,      0,
        -0.5,  0.5, -depth,
        -0.5, -0.5, -depth,

        // Right Face (x = 0.5)
         0.5, -0.5,      0,
         0.5,  0.5,      0,
         0.5,  0.5, -depth,
         0.5, -0.5, -depth
      ]);

      const solidColors = new Float32Array([
        ...cBack, ...cBack, ...cBack, ...cBack,
        ...cTop, ...cTop, ...cTop, ...cTop,
        ...cBot, ...cBot, ...cBot, ...cBot,
        ...cLeft, ...cLeft, ...cLeft, ...cLeft,
        ...cRight, ...cRight, ...cRight, ...cRight
      ]);

      const solidTexCoords = new Float32Array([
        // Back Face
        1.0, 0.0,  0.0, 0.0,  0.0, 1.0,  1.0, 1.0,
        // Top Face
        0.0, 0.0,  1.0, 0.0,  1.0, 1.0,  0.0, 1.0,
        // Bottom Face
        0.0, 1.0,  1.0, 1.0,  1.0, 0.0,  0.0, 0.0,
        // Left Face
        0.0, 0.0,  0.0, 1.0,  1.0, 1.0,  1.0, 0.0,
        // Right Face
        1.0, 0.0,  1.0, 1.0,  0.0, 1.0,  0.0, 0.0
      ]);

      const solidIndices = new Uint16Array([
        0, 1, 2,  0, 2, 3,
        4, 5, 6,  4, 6, 7,
        8, 9, 10,  8, 10, 11,
        12, 13, 14,  12, 14, 15,
        16, 17, 18,  16, 18, 19
      ]);

      gl.uniform1i(this.locations.mode, isSolidMode ? 1 : 0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, solidPositions, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, solidTexCoords, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, solidColors, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshBuffers.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, solidIndices, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, 30, gl.UNSIGNED_SHORT, 0);

      if (edgeOpacity > 0) {
        const edgePositions = new Float32Array([
          -0.5, -0.5, 0,    0.5, -0.5, 0,
           0.5, -0.5, 0,    0.5,  0.5, 0,
           0.5,  0.5, 0,   -0.5,  0.5, 0,
          -0.5,  0.5, 0,   -0.5, -0.5, 0,
          -0.5, -0.5, -depth,    0.5, -0.5, -depth,
           0.5, -0.5, -depth,    0.5,  0.5, -depth,
           0.5,  0.5, -depth,   -0.5,  0.5, -depth,
          -0.5,  0.5, -depth,   -0.5, -0.5, -depth,
          -0.5, -0.5, 0,   -0.5, -0.5, -depth,
           0.5, -0.5, 0,    0.5, -0.5, -depth,
           0.5,  0.5, 0,    0.5,  0.5, -depth,
          -0.5,  0.5, 0,   -0.5,  0.5, -depth
        ]);

        const cEdge = hexToRgb(edgeColor);
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttrib4f(this.locations.color, cEdge.r / 255, cEdge.g / 255, cEdge.b / 255, edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, edgePositions, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.LINES, 0, 24);
      }

      // Restore standard 2D quad state for subsequent renders
      this._restoreMeshQuadState(gl);
    }

    _draw3DPyramidMesh(gl, mvp, pyramidFx, bounds, layerOpacity, layer = null) {
      const defaultDepth = bounds && (bounds.w || bounds.h)
        ? Math.round(Math.min(bounds.w || 300, bounds.h || 300))
        : 300;
      const lDepth = (layer && layer.scaleZ !== undefined) ? layer.scaleZ : ((layer && layer.depth !== undefined) ? layer.depth : ((pyramidFx && pyramidFx.height !== undefined) ? pyramidFx.height : null));
      const height = Math.max(0, lDepth !== null ? lDepth : defaultDepth);
      const apexX = ((pyramidFx && pyramidFx.apexX !== undefined ? pyramidFx.apexX : 50) / 100 - 0.5);
      const apexY = ((pyramidFx && pyramidFx.apexY !== undefined ? pyramidFx.apexY : 25) / 100 - 0.5);

      const isSolidMode = pyramidFx && pyramidFx.sideMode === 'solid color';
      const defaultWhite = '#ffffff';
      let faceColor = (pyramidFx && pyramidFx.faceColor) || defaultWhite;
      if (isSolidMode && faceColor === defaultWhite && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const rawFaceOp = (pyramidFx && pyramidFx.faceOpacity !== undefined) ? pyramidFx.faceOpacity : 100;
      const faceOpacity = Math.max(0, Math.min(1, rawFaceOp / 100)) * (layerOpacity !== undefined ? layerOpacity : 1.0);
      const edgeColor = (pyramidFx && pyramidFx.edgeColor) || '#ffffff';
      const edgeOpacity = Math.max(0, Math.min(1, (pyramidFx && pyramidFx.edgeOpacity !== undefined ? pyramidFx.edgeOpacity : (pyramidFx && pyramidFx.edgeWidth && pyramidFx.edgeWidth > 0 ? 70 : 0)) / 100));
      const shading = Math.max(0, Math.min(1, (pyramidFx && pyramidFx.shading !== undefined ? pyramidFx.shading : 0) / 100));

      gl.uniformMatrix4fv(this.locations.matrix, false, mvp);

      // Base at z = 0, Apex at z = height
      const positions = new Float32Array([
        // Face 1 (Front/Bottom): BL -> BR -> Apex
        -0.5, 0.5, 0,    0.5, 0.5, 0,    apexX, apexY, height,
        // Face 2 (Right): BR -> TR -> Apex
         0.5, 0.5, 0,    0.5, -0.5, 0,   apexX, apexY, height,
        // Face 3 (Back/Top): TR -> TL -> Apex
         0.5, -0.5, 0,  -0.5, -0.5, 0,   apexX, apexY, height,
        // Face 4 (Left): TL -> BL -> Apex
        -0.5, -0.5, 0,  -0.5, 0.5, 0,    apexX, apexY, height,
        // Base Face: TL -> TR -> BR -> BL
        -0.5, -0.5, 0,   0.5, -0.5, 0,   0.5, 0.5, 0,   -0.5, 0.5, 0
      ]);

      const texCoords = new Float32Array([
        // Face 1: BL -> BR -> Apex
        0.0, 1.0,   1.0, 1.0,   0.5, 0.5,
        // Face 2: BR -> TR -> Apex
        1.0, 1.0,   1.0, 0.0,   0.5, 0.5,
        // Face 3: TR -> TL -> Apex
        1.0, 0.0,   0.0, 0.0,   0.5, 0.5,
        // Face 4: TL -> BL -> Apex
        0.0, 0.0,   0.0, 1.0,   0.5, 0.5,
        // Base Face: TL -> TR -> BR -> BL
        0.0, 0.0,   1.0, 0.0,   1.0, 1.0,   0.0, 1.0
      ]);

      const cBase = hexToRgb(faceColor);
      const tintR = isSolidMode ? (cBase.r / 255) : 1.0;
      const tintG = isSolidMode ? (cBase.g / 255) : 1.0;
      const tintB = isSolidMode ? (cBase.b / 255) : 1.0;

      const makeCol = (m) => [
        Math.min(1.0, tintR * m),
        Math.min(1.0, tintG * m),
        Math.min(1.0, tintB * m),
        faceOpacity
      ];

      const mulFront = 1.0 + shading * 0.2;
      const mulRight = Math.max(0.15, 1.0 - shading * 0.25);
      const mulBack  = Math.max(0.1, 1.0 - shading * 0.45);
      const mulLeft  = Math.max(0.15, 1.0 - shading * 0.35);
      const mulBase  = Math.max(0.1, 1.0 - shading * 0.5);

      const col1 = makeCol(mulFront);
      const col2 = makeCol(mulRight);
      const col3 = makeCol(mulBack);
      const col4 = makeCol(mulLeft);
      const colBase = makeCol(mulBase);

      const colors = new Float32Array([
        ...col1, ...col1, ...col1,
        ...col2, ...col2, ...col2,
        ...col3, ...col3, ...col3,
        ...col4, ...col4, ...col4,
        ...colBase, ...colBase, ...colBase, ...colBase
      ]);

      const indices = new Uint16Array([
        0, 1, 2,
        3, 4, 5,
        6, 7, 8,
        9, 10, 11,
        12, 13, 14,  12, 14, 15
      ]);

      gl.uniform1i(this.locations.mode, isSolidMode ? 1 : 0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshBuffers.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, 18, gl.UNSIGNED_SHORT, 0);

      if (edgeOpacity > 0.01) {
        const edgePositions = new Float32Array([
          // Base 4 edges
          -0.5, -0.5, 0,   0.5, -0.5, 0,
           0.5, -0.5, 0,   0.5,  0.5, 0,
           0.5,  0.5, 0,  -0.5,  0.5, 0,
          -0.5,  0.5, 0,  -0.5, -0.5, 0,
          // 4 Ridge edges to apex
          -0.5, -0.5, 0,   apexX, apexY, height,
           0.5, -0.5, 0,   apexX, apexY, height,
           0.5,  0.5, 0,   apexX, apexY, height,
          -0.5,  0.5, 0,   apexX, apexY, height
        ]);

        const cEdge = hexToRgb(edgeColor);
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttrib4f(this.locations.color, cEdge.r / 255, cEdge.g / 255, cEdge.b / 255, edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, edgePositions, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.LINES, 0, 16);
      }

      // Restore standard 2D quad state for subsequent renders
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
    }

    _draw3DSphereMesh(gl, mvp, sphereFx, bounds, layerOpacity, layer = null) {
      const defaultDepth = bounds && (bounds.w || bounds.h)
        ? Math.round(Math.min(bounds.w || 300, bounds.h || 300)) * 0.5
        : 150;
      const lDepth = (layer && layer.scaleZ !== undefined) ? layer.scaleZ : ((layer && layer.depth !== undefined) ? layer.depth : null);
      const depthZ = Math.max(0.1, lDepth !== null ? lDepth : defaultDepth);

      const isSolidMode = sphereFx && (sphereFx.sideMode === 'solid color' || sphereFx.fillMode === 'solid color');
      const defaultWhite = '#ffffff';
      let faceColor = (sphereFx && (sphereFx.faceColor || sphereFx.color)) || defaultWhite;
      if (isSolidMode && faceColor === defaultWhite && layer && (layer.fillColor || layer.color)) {
        faceColor = layer.fillColor || layer.color;
      }
      const rawFaceOp = (sphereFx && sphereFx.faceOpacity !== undefined) ? sphereFx.faceOpacity : 100;
      const faceOpacity = Math.max(0, Math.min(1, rawFaceOp / 100)) * (layerOpacity !== undefined ? layerOpacity : 1.0);
      const shading = Math.max(0, Math.min(1, (sphereFx && sphereFx.shading !== undefined ? sphereFx.shading : (sphereFx && sphereFx.shadowOpacity !== undefined && sphereFx.shadowOpacity > 0 ? sphereFx.shadowOpacity : 0)) / 100));
      const edgeColor = (sphereFx && sphereFx.edgeColor) || '#ffffff';
      const edgeOpacity = Math.max(0, Math.min(1, (sphereFx && sphereFx.edgeOpacity !== undefined ? sphereFx.edgeOpacity : 0) / 100));

      gl.uniformMatrix4fv(this.locations.matrix, false, mvp);

      if (!this._sphereMeshBase) {
        const rings = 16;
        const sectors = 24;
        const basePos = [];
        const texCoords = [];
        const indices = [];

        for (let r = 0; r <= rings; r++) {
          const v = r / rings;
          const phi = v * Math.PI;
          for (let s = 0; s <= sectors; s++) {
            const u = s / sectors;
            const theta = u * Math.PI * 2;
            const x = -0.5 * Math.sin(phi) * Math.cos(theta);
            const y = -0.5 * Math.cos(phi);
            const zNorm = Math.sin(phi) * Math.sin(theta);
            basePos.push(x, y, zNorm);
            texCoords.push(u, v);
          }
        }

        for (let r = 0; r < rings; r++) {
          for (let s = 0; s < sectors; s++) {
            const first = r * (sectors + 1) + s;
            const second = first + sectors + 1;
            indices.push(first, second, first + 1);
            indices.push(second, second + 1, first + 1);
          }
        }

        this._sphereMeshBase = {
          basePos: new Float32Array(basePos),
          texCoords: new Float32Array(texCoords),
          indices: new Uint16Array(indices),
          count: indices.length,
          vertexCount: (rings + 1) * (sectors + 1)
        };
      }

      const base = this._sphereMeshBase;
      const vCount = base.vertexCount;
      const positions = new Float32Array(base.basePos.length);
      for (let i = 0; i < vCount; i++) {
        const idx = i * 3;
        positions[idx] = base.basePos[idx];
        positions[idx + 1] = base.basePos[idx + 1];
        positions[idx + 2] = base.basePos[idx + 2] * depthZ;
      }

      const cBase = hexToRgb(faceColor);
      const tintR = isSolidMode ? (cBase.r / 255) : 1.0;
      const tintG = isSolidMode ? (cBase.g / 255) : 1.0;
      const tintB = isSolidMode ? (cBase.b / 255) : 1.0;

      const colors = new Float32Array(vCount * 4);
      for (let i = 0; i < vCount; i++) {
        const cIdx = i * 4;
        let shadeFactor = 1.0;
        if (shading > 0.001) {
          const nz = Math.max(0, base.basePos[i * 3 + 2]);
          shadeFactor = Math.max(0.15, 1.0 - (1.0 - nz) * shading * 0.7);
        }
        colors[cIdx] = Math.min(1.0, tintR * shadeFactor);
        colors[cIdx + 1] = Math.min(1.0, tintG * shadeFactor);
        colors[cIdx + 2] = Math.min(1.0, tintB * shadeFactor);
        colors[cIdx + 3] = faceOpacity;
      }

      gl.uniform1i(this.locations.mode, isSolidMode ? 1 : 0);

      gl.enableVertexAttribArray(this.locations.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, base.texCoords, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(this.locations.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshBuffers.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, base.indices, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, base.count, gl.UNSIGNED_SHORT, 0);

      if (edgeOpacity > 0.01) {
        const cEdge = hexToRgb(edgeColor);
        gl.uniform1i(this.locations.mode, 1);
        gl.disableVertexAttribArray(this.locations.color);
        gl.disableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttrib4f(this.locations.color, cEdge.r / 255, cEdge.g / 255, cEdge.b / 255, edgeOpacity);
        gl.vertexAttrib2f(this.locations.texCoord, 0.0, 0.0);

        const edgePositions = [];
        const ringSegments = 32;
        for (let i = 0; i < ringSegments; i++) {
          const a1 = (i / ringSegments) * Math.PI * 2;
          const a2 = ((i + 1) / ringSegments) * Math.PI * 2;
          edgePositions.push(0.5 * Math.cos(a1), 0.5 * Math.sin(a1), 0);
          edgePositions.push(0.5 * Math.cos(a2), 0.5 * Math.sin(a2), 0);
          edgePositions.push(0.5 * Math.cos(a1), 0, depthZ * Math.sin(a1));
          edgePositions.push(0.5 * Math.cos(a2), 0, depthZ * Math.sin(a2));
        }

        const edgePosArr = new Float32Array(edgePositions);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, edgePosArr, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, edgePositions.length / 3);
      }

      // Restore standard 2D quad state for subsequent renders
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
    }

    _blitGLToContext(ctx, layer, bounds, vw, vh, bufferScale, cropRect = null) {
      try {
        ctx.save();
        if (layer.blendMode && layer.blendMode !== 'normal') {
          ctx.globalCompositeOperation = (layer.blendMode === 'mask') ? 'destination-in' : (layer.blendMode === 'exclude') ? 'destination-out' : layer.blendMode;
        }
        if (window.FishEffects && typeof window.FishEffects.applyToContext === 'function') {
          window.FishEffects.applyToContext(ctx, layer);
        }
        if (layer._dofBlur && layer._dofBlur > 0.5) {
          const curF = ctx.filter && ctx.filter !== 'none' ? ctx.filter : '';
          ctx.filter = (curF ? (curF + ' ') : '') + `blur(${layer._dofBlur.toFixed(1)}px)`;
        }
        const rgbSplitFx = Array.isArray(layer.effects)
          ? layer.effects.find(f => f.type === 'rgb-split' && !f.disabled && ((f.distance !== undefined ? f.distance : 8) > 0))
          : null;

        const dsFx = Array.isArray(layer.effects)
          ? layer.effects.find(f => f && !f.disabled && f.type === 'drop-shadow')
          : null;

        const hasCrop = !!(cropRect && cropRect.w > 0 && cropRect.h > 0 && (cropRect.w < vw || cropRect.h < vh));
        const sx = hasCrop ? Math.max(0, Math.floor(cropRect.x)) : 0;
        const sy = hasCrop ? Math.max(0, Math.floor(cropRect.y)) : 0;
        const sw = hasCrop ? Math.min(vw - sx, Math.ceil(cropRect.w)) : vw;
        const sh = hasCrop ? Math.min(vh - sy, Math.ceil(cropRect.h)) : vh;

        if (dsFx) {
          const op = Math.max(0, Math.min(1, (dsFx.opacity !== undefined ? dsFx.opacity : 75) / 100));
          const angle = ((dsFx.angle !== undefined ? dsFx.angle : 135) * Math.PI) / 180;
          const dist = (dsFx.distance !== undefined ? dsFx.distance : 15) * bufferScale;
          const blur = Math.max(0, (dsFx.blur !== undefined ? dsFx.blur : 10) * bufferScale);
          const ox = Math.cos(angle) * dist;
          const oy = Math.sin(angle) * dist;
          const color = dsFx.color || '#000000';

          if (op > 0 && (blur > 0 || dist > 0)) {
            ctx.save();
            ctx.shadowColor = hexToRgba(color, op);
            ctx.shadowBlur = blur;
            ctx.shadowOffsetX = ox;
            ctx.shadowOffsetY = oy;
            if (rgbSplitFx) {
              const offX = vw + blur * 2 + Math.abs(ox);
              ctx.shadowOffsetX = ox + offX;
              ctx.drawImage(this.glCanvas, sx, sy, sw, sh, sx - offX, sy, sw, sh);
            } else {
              ctx.drawImage(this.glCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
            }
            ctx.restore();
          } else if (!rgbSplitFx) {
            ctx.drawImage(this.glCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
          }
        } else if (!rgbSplitFx) {
          ctx.drawImage(this.glCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
        }

        if (rgbSplitFx && window.FishEffects && typeof window.FishEffects.renderRGBSplit === 'function') {
          if (!this._copyCanvas) {
            this._copyCanvas = document.createElement('canvas');
            this._copyCtx = this._copyCanvas.getContext('2d');
          }
          if (this._copyCanvas.width !== vw || this._copyCanvas.height !== vh) {
            this._copyCanvas.width = vw;
            this._copyCanvas.height = vh;
          }
          this._copyCtx.clearRect(0, 0, vw, vh);
          this._copyCtx.drawImage(this.glCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
          window.FishEffects.renderRGBSplit(ctx, this._copyCanvas, layer, { x: sx, y: sy, w: sw, h: sh }, rgbSplitFx);
        }

        if (window.FishEffects && typeof window.FishEffects.applyPostEffects === 'function') {
          window.FishEffects.applyPostEffects(ctx, this.glCanvas, layer, { x: sx, y: sy, w: sw, h: sh });
        }
        ctx.restore();
      } catch (_) {}
    }

    /**
     * Hardware WebGL Motion Blur for 3D Layers
     * Accumulates multi-sample motion blur directly in WebGL framebuffer via running
     * mean (sample i blends at 1/(i+1) over the previous mean), then 1 single blit!
     * Running mean keeps the buffer near full brightness: the old ONE,ONE additive
     * sum with per-sample opacity 1/N quantized each sample to a few LSBs of the
     * 8-bit framebuffer, whose rounding error shifted hues on trails.
     */
    render3DMotionBlur(ctx, el, layer, bufferScale = 1, camera = null, currentSec = null, compState = null) {
      if (!ctx || !el || !this._hasValidDimensions(el)) return;
      if (!this.isReady) {
        this.renderLayer(ctx, el, layer, bufferScale, camera, currentSec);
        return;
      }

      const pool = (compState && Array.isArray(compState.layers) && compState.layers)
        || ((typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) ? window.currentProjectState.layers : null);
      const evalSec = (typeof currentSec === 'number' && !isNaN(currentSec))
        ? currentSec
        : ((layer && typeof layer._currentSec === 'number') ? layer._currentSec : 0);
      const curEff = (typeof window.getLayerEffectivePropsAtTime === 'function')
        ? window.getLayerEffectivePropsAtTime(layer, evalSec, null, pool)
        : null;
      const animLayer = curEff ? Object.assign({}, layer, curEff) : layer;
      animLayer._currentSec = evalSec;

      const bounds = this.getBounds(animLayer, bufferScale, camera);
      if (bounds.isBehindCamera || ((bounds.aabbW < 1.0 && bounds.w < 1.0) || (bounds.aabbH < 1.0 && bounds.h < 1.0))) {
        return;
      }

      const mbEngine = window.FishMotionBlurEngine;
      const shutter = mbEngine && typeof mbEngine.getShutter === 'function'
        ? mbEngine.getShutter(compState, evalSec)
        : {
            exposureTime: (180 / 360) * (1 / ((typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60)),
            tStart: evalSec
          };
      const exposureTime = shutter.exposureTime;
      const tStart = shutter.tStart;

      const plan = mbEngine && typeof mbEngine.planSamples === 'function'
        ? mbEngine.planSamples(animLayer, bufferScale, camera, tStart, exposureTime, compState)
        : { n: 16 };
      const cfgSamples = (mbEngine && typeof mbEngine.getConfig === 'function') ? mbEngine.getConfig(compState).samples : 16;
      const samples = Math.max(2, plan.n || cfgSamples || 16);

      const targetCanvas = ctx.canvas;
      const vw = targetCanvas ? targetCanvas.width : (bounds.cx * 2 || 1920);
      const vh = targetCanvas ? targetCanvas.height : (bounds.cy * 2 || 1080);

      // Pre-process 2D effects onto local offscreen canvas if needed
      const processed = this._getEffectProcessedElement(el, animLayer, bounds, evalSec);
      const sourceEl = processed.el;

      const gl = this.gl;
      if (this.glCanvas.width !== vw || this.glCanvas.height !== vh) {
        this.glCanvas.width = vw;
        this.glCanvas.height = vh;
      }

      // Dynamic Bounding Box & Scissor Clamping: restrict rendering & clearing to moving layer AABB
      const cropRect = plan && plan.rect;
      const hasCrop = false; // Disabled: cropRect is in composition space but used in screen space, causing offsets
      const cropX = 0;
      const cropY = 0;
      const cropW = vw;
      const cropH = vh;

      gl.viewport(0, 0, vw, vh);
      if (hasCrop) {
        const glScissorY = Math.max(0, vh - (cropY + cropH));
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(cropX, glScissorY, cropW, cropH);
      } else {
        gl.disable(gl.SCISSOR_TEST);
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this.program);
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      // Bind quad buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.enableVertexAttribArray(this.locations.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

      // Upload/Bind texture ONCE for all samples
      const tex = this._getOrCreateTexture(sourceEl);
      if (!tex) {
        if (hasCrop) gl.disable(gl.SCISSOR_TEST);
        return;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.locations.texture, 0);
      if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(bounds.is3D ? camera : null));

      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      // Running mean: sample 0 copies at full strength (ONE, ZERO); sample i blends
      // at w = 1/(i+1) via (CONSTANT_ALPHA, ONE_MINUS_CONSTANT_ALPHA) with the
      // shader emitting the sample at FULL layer opacity. out = S*w + D*(1-w).
      // Depth test stays ON with a per-sample depth clear: mesh faces self-occlude
      // correctly inside every sample while samples still average independently.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      // u_noDiscard=1 during the loop: transparent texels emit (0,0,0,0) instead of
      // discard, so empty samples dilute the mean and trails stay symmetric.
      if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 1);

      const tileFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f.type === 'tile' && !f.disabled)
        : null;

      const boxFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'box_3d')
        : null;
      const extrudeFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'extrude_3d')
        : null;
      const pyramidFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'pyramid_3d')
        : null;
      const sphereFx = Array.isArray(layer.effects)
        ? layer.effects.find(f => f && !f.disabled && f.type === 'sphere_3d')
        : null;

      const camLayer = (camera && camera._rawCamera)
        || (camera && camera.type === 'camera' ? camera : null)
        || (pool && pool.find(l => l && l.type === 'camera' && !l.hidden))
        || null;

      let drawnSamples = 0;
      for (let s = 0; s < samples; s++) {
        const u = (s + 0.5) / samples;
        const subSec = tStart + u * exposureTime;

        const subCamera = (camLayer && typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(camLayer, subSec, null, pool)
          : camera;

        const srcLayer = layer._rawLayer || layer;
        const subEff = (typeof window.getLayerEffectivePropsAtTime === 'function')
          ? window.getLayerEffectivePropsAtTime(srcLayer, subSec, null, pool)
          : null;
        let subAnimLayer = subEff
          ? Object.assign({}, layer, subEff, { is3D: !!(srcLayer.is3D || bounds.is3D) })
          : Object.assign({}, animLayer, { is3D: !!(srcLayer.is3D || bounds.is3D) });
        subAnimLayer._currentSec = subSec;
        if (subAnimLayer.type === 'text' && window.FishMotionBlurEngine && typeof window.FishMotionBlurEngine.compensateTextPad === 'function') {
          subAnimLayer = window.FishMotionBlurEngine.compensateTextPad(layer, sourceEl, subAnimLayer);
        }

        const subBounds = this.getBounds(subAnimLayer, bufferScale, subCamera);
        if (subBounds.isBehindCamera) continue;

        // Fresh depth for every sample: self-occlusion inside the sample,
        // no occlusion leaking across samples of the blur average.
        gl.clear(gl.DEPTH_BUFFER_BIT);

        // The scene camera only transforms 3D layers. A 2D layer must keep identical placement with
        // blur on/off (effects like shatter/particles apply the camera inside their own texture).
        const mvpCamera = (subBounds.is3D || bounds.is3D) ? subCamera : null;
        let mvp = this._computeMVP(subBounds, vw, vh, 0, mvpCamera);
        if (!mvp) continue;

        if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(mvpCamera));

        if (processed.padX > 0 || processed.padY > 0) {
          const sX = (processed.origW + processed.padX * 2) / processed.origW;
          const sY = (processed.origH + processed.padY * 2) / processed.origH;
          const scaledMVP = new Float32Array(mvp);
          scaledMVP[0] *= sX; scaledMVP[1] *= sX; scaledMVP[2] *= sX; scaledMVP[3] *= sX;
          scaledMVP[4] *= sY; scaledMVP[5] *= sY; scaledMVP[6] *= sY; scaledMVP[7] *= sY;
          mvp = scaledMVP;
        }

        const rawOp = (subAnimLayer.opacity !== undefined && subAnimLayer.opacity !== null) ? Number(subAnimLayer.opacity) : 1.0;
        const normOp = (rawOp > 1.0) ? Math.max(0, Math.min(1, rawOp / 100)) : Math.max(0, Math.min(1, rawOp));
        gl.depthMask(normOp >= 0.999);
        if (drawnSamples === 0) {
          gl.blendFunc(gl.ONE, gl.ZERO);
          gl.uniform1f(this.locations.opacity, normOp);
        } else {
          const w = 1 / (drawnSamples + 1);
          gl.blendColor(0, 0, 0, w);
          gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
          gl.uniform1f(this.locations.opacity, normOp);
        }

        if (boxFx || extrudeFx || pyramidFx || sphereFx) {
          if (boxFx) this._draw3DBoxMesh(gl, mvp, boxFx, subBounds, normOp, subAnimLayer);
          else if (extrudeFx) this._draw3DExtrudeMesh(gl, mvp, extrudeFx, subBounds, normOp, subAnimLayer, sourceEl);
          else if (pyramidFx) this._draw3DPyramidMesh(gl, mvp, pyramidFx, subBounds, normOp, subAnimLayer);
          else if (sphereFx) this._draw3DSphereMesh(gl, mvp, sphereFx, subBounds, normOp, subAnimLayer);
        } else {
          this._drawQuadOrTile(gl, mvp, tileFx, vw, vh, subBounds);
        }
        drawnSamples++;
      }

      // Restore normal premultiplied compositing for single-pass draws
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
      if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 0);

      if (hasCrop) {
        gl.disable(gl.SCISSOR_TEST);
      }

      // Blit accumulated result to 2D canvas context ONCE with shadow / RGB split (clipped to cropRect)
      if (drawnSamples > 0) {
        this._blitGLToContext(ctx, animLayer, bounds, vw, vh, bufferScale, hasCrop ? { x: cropX, y: cropY, w: cropW, h: cropH } : null);
      }
    }

    /**
     * Per-sample FBO + passthrough blit program for shared-depth scene blur.
     * Each shutter sample renders into the FBO (normal blend + depth), then the
     * FBO is blended over the running mean in the default framebuffer.
     * WebGL1-core only (RGBA texture + depth renderbuffer). Returns false when
     * unavailable so callers can fall back to legacy per-layer passes.
     */
    _ensureSceneBlurGL(vw, vh) {
      const gl = this.gl;
      if (!gl || this._sceneGLFailed) return false;
      try {
        if (!this._sceneBlitProg) {
          const vs = this._compileShader(gl.VERTEX_SHADER,
            'attribute vec2 a_p; varying vec2 v_uv; void main(){ v_uv = a_p * 0.5 + 0.5; gl_Position = vec4(a_p, 0.0, 1.0); }');
          const fs = this._compileShader(gl.FRAGMENT_SHADER,
            'precision mediump float; varying vec2 v_uv; uniform sampler2D u_t; void main(){ gl_FragColor = texture2D(u_t, v_uv); }');
          const pr = gl.createProgram();
          gl.attachShader(pr, vs);
          gl.attachShader(pr, fs);
          gl.linkProgram(pr);
          if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
            this._sceneGLFailed = true;
            return false;
          }
          this._sceneBlitProg = pr;
          this._sceneBlitPosLoc = gl.getAttribLocation(pr, 'a_p');
          this._sceneBlitTexLoc = gl.getUniformLocation(pr, 'u_t');
          this._sceneBlitQuad = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, this._sceneBlitQuad);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
          this._sceneFbo = gl.createFramebuffer();
          this._sceneFboTex = gl.createTexture();
          this._sceneFboDepth = gl.createRenderbuffer();
        }
        if (this._sceneFboW !== vw || this._sceneFboH !== vh) {
          gl.bindTexture(gl.TEXTURE_2D, this._sceneFboTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vw, vh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.bindRenderbuffer(gl.RENDERBUFFER, this._sceneFboDepth);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, vw, vh);
          gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._sceneFboTex, 0);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._sceneFboDepth);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          this._sceneFboW = vw;
          this._sceneFboH = vh;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (!ok) { this._sceneGLFailed = true; return false; }
        return true;
      } catch (_) {
        this._sceneGLFailed = true;
        return false;
      }
    }

    /**
     * Shared-depth 3D scene motion blur for one consecutive run of plain 3D layers.
     * Every shutter sample draws ALL run members into the FBO with normal blending
     * and a shared depth buffer (true 3D penetration, like the static batch pass),
     * then the sample is blended over the running mean. Static members naturally
     * average to themselves. Returns true when handled (even when nothing was
     * visible), false when the caller should use legacy per-layer passes.
     * run: Array<{ item:{el,layer,animLayer}, bounds, blur:boolean }>
     */
    render3DSceneMotionBlur(ctx, run, bufferScale = 1, camera = null, currentSec = null, compState = null) {
      if (!ctx || !run || run.length === 0 || !this.isReady) return false;
      const gl = this.gl;
      if (!gl) return false;

      const pool = (compState && Array.isArray(compState.layers) && compState.layers)
        || ((typeof window !== 'undefined' && window.currentProjectState && Array.isArray(window.currentProjectState.layers)) ? window.currentProjectState.layers : null);
      const evalSec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : 0;

      const mbEngine = window.FishMotionBlurEngine;
      const shutter = mbEngine && typeof mbEngine.getShutter === 'function'
        ? mbEngine.getShutter(compState, evalSec)
        : { exposureTime: 0, tStart: evalSec };
      const exposureTime = shutter.exposureTime;
      const tStart = shutter.tStart;
      if (!(exposureTime > 0.0001)) return false;

      // Sample count: worst case over the moving members (static ones need none).
      let samples = 0;
      for (const m of run) {
        if (!m.blur) continue;
        const planeff = m.item.animLayer || m.item.layer;
        const n = (mbEngine && typeof mbEngine.planSamples === 'function')
          ? (mbEngine.planSamples(planeff, bufferScale, camera, tStart, exposureTime, compState).n || 0)
          : 0;
        if (n > samples) samples = n;
      }
      if (!(samples >= 2)) {
        const cfg = (mbEngine && typeof mbEngine.getConfig === 'function') ? mbEngine.getConfig(compState).samples : 16;
        samples = Math.max(2, cfg || 16);
      }

      const targetCanvas = ctx.canvas;
      const vw = targetCanvas ? targetCanvas.width : 1920;
      const vh = targetCanvas ? targetCanvas.height : 1080;
      if (vw <= 0 || vh <= 0) return false;
      if (this.glCanvas.width !== vw || this.glCanvas.height !== vh) {
        this.glCanvas.width = vw;
        this.glCanvas.height = vh;
      }
      if (!this._ensureSceneBlurGL(vw, vh)) return false;

      const camLayer = (camera && camera._rawCamera)
        || (camera && camera.type === 'camera' ? camera : null)
        || (pool && pool.find(l => l && l.type === 'camera' && !l.hidden))
        || null;
      const getEff = (typeof window !== 'undefined') ? window.getLayerEffectivePropsAtTime : null;

      // Accumulation buffer: default framebuffer, cleared once.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, vw, vh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      if (this.locations.noDiscard) {
        gl.useProgram(this.program);
        gl.uniform1f(this.locations.noDiscard, 1);
      }

      let completed = 0;
      for (let s = 0; s < samples; s++) {
        const subSec = tStart + ((s + 0.5) / samples) * exposureTime;
        const subCamera = (camLayer && typeof getEff === 'function')
          ? getEff(camLayer, subSec, null, pool)
          : camera;

        // One full scene sample into the FBO: normal blend + shared depth.
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._sceneFbo);
        gl.viewport(0, 0, vw, vh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.program);
        gl.uniform1i(this.locations.mode, 0);
        gl.disableVertexAttribArray(this.locations.color);
        gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.locations.position);
        gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.enableVertexAttribArray(this.locations.texCoord);
        gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

        let drawn = 0;
        for (let mi = 0; mi < run.length; mi++) {
          const m = run[mi];
          const srcEl = m.item.el;
          if (!srcEl || !this._hasValidDimensions(srcEl)) continue;
          const srcLayer = (m.item.layer && m.item.layer._rawLayer) || m.item.layer;
          const subEff = (typeof getEff === 'function' && srcLayer)
            ? getEff(srcLayer, subSec, null, pool)
            : null;
          let subAnimLayer = subEff
            ? Object.assign({}, m.item.layer, subEff)
            : Object.assign({}, (m.item.animLayer || m.item.layer));
          subAnimLayer._currentSec = subSec;
          if (subAnimLayer.type === 'text' && window.FishMotionBlurEngine && typeof window.FishMotionBlurEngine.compensateTextPad === 'function') {
            subAnimLayer = window.FishMotionBlurEngine.compensateTextPad(m.item.layer, srcEl, subAnimLayer);
          }
          const subBounds = this.getBounds(subAnimLayer, bufferScale, subCamera);
          if (subBounds.isBehindCamera || ((subBounds.aabbW < 1.0 && subBounds.w < 1.0) || (subBounds.aabbH < 1.0 && subBounds.h < 1.0))) continue;
          const mvpCamera = subBounds.is3D ? subCamera : null;
          const mvp = this._computeMVP(subBounds, vw, vh, mi * 0.00002, mvpCamera);
          if (!mvp) continue;
          const tex = this._getOrCreateTexture(srcEl);
          if (!tex) continue;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(this.locations.texture, 0);
          const rawOp = (subAnimLayer.opacity !== undefined && subAnimLayer.opacity !== null) ? Number(subAnimLayer.opacity) : 1.0;
          const normOp = (rawOp > 1.0) ? Math.max(0, Math.min(1, rawOp / 100)) : Math.max(0, Math.min(1, rawOp));
          gl.uniform1f(this.locations.opacity, normOp);
          gl.depthMask(normOp >= 0.999);
          if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(mvpCamera));
          gl.uniformMatrix4fv(this.locations.matrix, false, mvp);
          this._drawQuadOrTile(gl, mvp, null, vw, vh, subBounds);
          drawn++;
        }
        if (!drawn) continue;

        // Blend this sample over the running mean in the default framebuffer.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, vw, vh);
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(this._sceneBlitProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._sceneBlitQuad);
        gl.enableVertexAttribArray(this._sceneBlitPosLoc);
        gl.vertexAttribPointer(this._sceneBlitPosLoc, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._sceneFboTex);
        gl.uniform1i(this._sceneBlitTexLoc, 0);
        if (completed === 0) {
          gl.blendFunc(gl.ONE, gl.ZERO);
        } else {
          gl.blendColor(0, 0, 0, 1 / (completed + 1));
          gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        completed++;
      }

      // Restore standard state for subsequent draws
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(this.program);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
      if (this.locations.noDiscard) gl.uniform1f(this.locations.noDiscard, 0);

      // Members are effect-free by construction: plain blit (no shadow/split/post).
      if (completed > 0) {
        try { ctx.drawImage(this.glCanvas, 0, 0); } catch (_) { return false; }
      }
      return true;
    }

    /**
     * Batch membership rule for the shared 3D depth pass (single source of truth).
     * A layer joins a depth-shared run iff it is 3D with normal blending, no
     * effects/filters and no depth-of-field — mirrors AE's "2D breaks 3D space".
     * js/editor.js uses the same rule to group motion-blur scene passes.
     */
    isBatchable3D(layer, bounds) {
      if (!layer || !bounds || !bounds.is3D) return false;
      if (layer.blendMode && layer.blendMode !== 'normal') return false;
      if (Array.isArray(layer.effects) && layer.effects.some(f => f && !f.disabled)) return false;
      if (window.FishEffects && typeof window.FishEffects.buildFilter === 'function' && window.FishEffects.buildFilter(layer) !== '') return false;
      if (layer._dofBlur && layer._dofBlur > 0.5) return false;
      return true;
    }

    /**
     * Render a composition sequence with hardware Z-buffer penetration for 3D intersecting layers.
     * Batches consecutive 3D layers into a single WebGL depth pass (reducing drawImage overhead for mobile).
     * NOTE: batch membership rule lives in isBatchable3D (single source of truth,
     * shared with the motion-blur scene pass in js/editor.js).
     * @param {CanvasRenderingContext2D} ctx - Target 2D canvas context
     * @param {Array<{ el: HTMLElement, layer: Object, animLayer?: Object }>} renderList - Layers to draw
     * @param {number} bufferScale - Scale factor relative to composition base size
     */
    renderScene(ctx, renderList, bufferScale = 1, camera = null, currentSec = null) {
      if (!ctx || !renderList || renderList.length === 0) return;

      const has3D = renderList.some(item => {
        const b = this.getBounds(item.animLayer || item.layer, bufferScale, camera);
        return b.is3D;
      });

      // Pure 2D fast path: If no 3D layers exist and no camera exists, render directly with native 2D canvas drawImage
      if (!has3D || !this.isReady) {
        renderList.forEach(item => {
          const lSec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : ((item.animLayer && item.animLayer._currentSec) || (item.layer && item.layer._currentSec));
          this.renderLayer(ctx, item.el, item.animLayer || item.layer, bufferScale, null, lSec);
        });
        return;
      }

      const targetCanvas = ctx.canvas;
      const vw = targetCanvas ? targetCanvas.width : 1920;
      const vh = targetCanvas ? targetCanvas.height : 1080;

      let currentBatch = [];

      const flushBatch = () => {
        if (currentBatch.length === 0) return;
        this._renderBatch(ctx, currentBatch, vw, vh, bufferScale, camera);
        currentBatch = [];
      };

      renderList.forEach((item, idx) => {
        const layer = item.animLayer || item.layer;
        const b = this.getBounds(layer, bufferScale, camera);

        // In After Effects, 2D layers break 3D space:
        // Flush any preceding 3D layers in the depth buffer, composite the 2D layer, then resume 3D batching
        if (!this.isBatchable3D(layer, b)) {
          flushBatch();
          const lSec = (typeof currentSec === 'number' && !isNaN(currentSec)) ? currentSec : ((layer && layer._currentSec !== undefined) ? layer._currentSec : null);
          this.renderLayer(ctx, item.el, layer, bufferScale, b.is3D ? camera : null, lSec);
        } else {
          currentBatch.push({ ...item, batchIndex: idx });
        }
      });

      flushBatch();
    }

    _renderBatch(ctx, batch, vw, vh, bufferScale, camera = null) {
      if (!batch || batch.length === 0) return;
      const gl = this.gl;
      if (!gl) return;

      if (this.glCanvas.width !== vw || this.glCanvas.height !== vh) {
        this.glCanvas.width = vw;
        this.glCanvas.height = vh;
      }
      gl.viewport(0, 0, vw, vh);

      // Hardware depth testing enables true 3D spatial intersection
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.CULL_FACE);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      // Single buffer clear for all layers in 3D batch
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this.program);
      gl.uniform1i(this.locations.mode, 0);
      gl.disableVertexAttribArray(this.locations.color);
      gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);

      // Bind quad buffers once
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.enableVertexAttribArray(this.locations.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.enableVertexAttribArray(this.locations.texCoord);
      gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

      batch.forEach((item, i) => {
        const layer = item.animLayer || item.layer;
        const el = item.el;
        if (!el || !this._hasValidDimensions(el)) return;

        const bounds = this.getBounds(layer, bufferScale, camera);
        if (bounds.isBehindCamera || ((bounds.aabbW < 1.0 && bounds.w < 1.0) || (bounds.aabbH < 1.0 && bounds.h < 1.0))) {
          return;
        }

        const layerBias = (item.batchIndex !== undefined ? item.batchIndex : i) * 0.00002;
        const mvp = this._computeMVP(bounds, vw, vh, layerBias, camera);
        if (!mvp) return;

        const tex = this._getOrCreateTexture(el);
        if (!tex) return;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        const rawBatchOp = (layer.opacity !== undefined && layer.opacity !== null) ? Number(layer.opacity) : 1.0;
        const layerOpacity = (rawBatchOp > 1.0) ? Math.max(0, Math.min(1, rawBatchOp / 100)) : Math.max(0, Math.min(1, rawBatchOp));
        gl.uniform1f(this.locations.opacity, layerOpacity);
        gl.depthMask(layerOpacity >= 0.999);
        if (this.locations.lensDistort) gl.uniform1f(this.locations.lensDistort, this._getLensDistort(camera));
        gl.uniformMatrix4fv(this.locations.matrix, false, mvp);

        const bFx = Array.isArray(layer.effects) ? layer.effects.find(f => f && !f.disabled && f.type === 'box_3d') : null;
        const eFx = Array.isArray(layer.effects) ? layer.effects.find(f => f && !f.disabled && f.type === 'extrude_3d') : null;
        const pFx = Array.isArray(layer.effects) ? layer.effects.find(f => f && !f.disabled && f.type === 'pyramid_3d') : null;
        const sFx = Array.isArray(layer.effects) ? layer.effects.find(f => f && !f.disabled && f.type === 'sphere_3d') : null;

        if (bFx) this._draw3DBoxMesh(gl, mvp, bFx, bounds, layerOpacity, layer);
        else if (eFx) this._draw3DExtrudeMesh(gl, mvp, eFx, bounds, layerOpacity, layer, el);
        else if (pFx) this._draw3DPyramidMesh(gl, mvp, pFx, bounds, layerOpacity, layer);
        else if (sFx) this._draw3DSphereMesh(gl, mvp, sFx, bounds, layerOpacity, layer);
        else {
          gl.uniform1i(this.locations.mode, 0);
          gl.disableVertexAttribArray(this.locations.color);
          gl.vertexAttrib4f(this.locations.color, 1.0, 1.0, 1.0, 1.0);
          gl.enableVertexAttribArray(this.locations.position);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
          gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
          gl.enableVertexAttribArray(this.locations.texCoord);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
          gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
          gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);
        }
      });
      gl.depthMask(true);

      // Single hardware blit onto destination 2D canvas
      try {
        ctx.drawImage(this.glCanvas, 0, 0);
      } catch (_) {}

      gl.disable(gl.DEPTH_TEST);
    }

    /**
     * Hardware-Accelerated 1-Pass WebGL RGB Split Renderer
     * Samples R, G, B channels with GPU texture offsets and outputs in 1 draw call (< 0.2ms).
     * @param {CanvasRenderingContext2D} ctx - Target 2D canvas context
     * @param {HTMLElement} el - Source image/canvas/video
     * @param {Object} bounds - Target bounds {x, y, w, h}
     * @param {Object} fx - Effect parameters {distance, angle}
     * @returns {boolean} True if successfully rendered via WebGL
     */
    renderRGBSplit(ctx, el, bounds, fx) {
      if (!this.isReady || !this.rgbSplitProgram || !this.gl || !el || !this._hasValidDimensions(el) || el === this.glCanvas) return false;
      const gl = this.gl;
      const dist = fx && fx.distance !== undefined ? fx.distance : 8;
      if (dist <= 0) return false;

      const angle = ((fx && fx.angle !== undefined ? fx.angle : 0) * Math.PI) / 180;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;

      const x = bounds && bounds.x !== undefined ? bounds.x : 0;
      const y = bounds && bounds.y !== undefined ? bounds.y : 0;
      const w = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
      const h = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));

      if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
        this.glCanvas.width = w;
        this.glCanvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.rgbSplitProgram);

      if (!this._fsQuadBuffer) {
        this._fsQuadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._fsQuadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          -1.0, -1.0,
           1.0, -1.0,
           1.0,  1.0,
          -1.0,  1.0
        ]), gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fsQuadBuffer);
      gl.enableVertexAttribArray(this.rgbLocations.pos);
      gl.vertexAttribPointer(this.rgbLocations.pos, 2, gl.FLOAT, false, 0, 0);

      if (!this._fxTexCoordBuffer) {
        this._fxTexCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._fxTexCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          0.0, 1.0,
          1.0, 1.0,
          1.0, 0.0,
          0.0, 0.0
        ]), gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fxTexCoordBuffer);
      gl.enableVertexAttribArray(this.rgbLocations.uv);
      gl.vertexAttribPointer(this.rgbLocations.uv, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

      const tex = this._getOrCreateTexture(el);
      if (!tex) return false;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.rgbLocations.image, 0);
      gl.uniform2f(this.rgbLocations.delta, dx / w, -dy / h);
      gl.uniform1f(this.rgbLocations.opacity, 1.0);

      gl.drawElements(gl.TRIANGLES, this.quadIndexCount, gl.UNSIGNED_SHORT, 0);

      try {
        ctx.drawImage(this.glCanvas, 0, 0, w, h, x, y, w, h);
        return true;
      } catch (_) {
        return false;
      }
    }

    /**
     * Compute 4x4 Model-View-Perspective matrix mapping [-0.5, 0.5] quad to WebGL clip space
     */
    _computeMVP(bounds, vw, vh, layerBias = 0, camera = null) {
      const {
        cx, cy, posZ = 0,
        w, h, signX, signY,
        rotX = 0, rotY = 0, rotZ = 0,
        skewX = 0, skewY = 0,
        anchorX = 0, anchorY = 0, anchorZ = 0
      } = bounds;

      const bScale = bounds.bufferScale || 1;
      const camX = camera ? (camera.posX || 0) * bScale : 0;
      const camY = camera ? (camera.posY || 0) * bScale : 0;
      const camPosZ = camera ? (camera.posZ || 0) * bScale : 0;
      const camRotX = camera ? (camera.rotX || 0) : 0;
      const camRotY = camera ? (camera.rotY || 0) : 0;
      const camRotZ = camera ? (camera.rotZ !== undefined ? camera.rotZ : (camera.rotation || 0)) : 0;
      const camLens = Math.max(1, camera ? (camera.cameraLens !== undefined ? camera.cameraLens : 50) : 50);
      const camZoom = camera ? (camera.cameraZoom !== undefined ? camera.cameraZoom : 100) : 100;

      const lensFactor = Math.max(0.01, camLens / 50);
      const zoomFactor = Math.max(0.01, camZoom / 100);
      const totalZoom = lensFactor * zoomFactor;
      const D = CAMERA_DISTANCE * lensFactor * bScale;
      const NEAR = NEAR_PLANE * bScale;
      const FAR = 10000.0 * bScale;

      const radX = (rotX * Math.PI) / 180;
      const radY = (rotY * Math.PI) / 180;
      const radZ = (rotZ * Math.PI) / 180;
      const tanX = Math.tan(((skewX || 0) * Math.PI) / 180);
      const tanY = Math.tan(((skewY || 0) * Math.PI) / 180);

      const cosX = Math.cos(radX), sinX = Math.sin(radX);
      const cosY = Math.cos(radY), sinY = Math.sin(radY);
      const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);

      // 1. Local Basis Vectors in 3D layer space
      const sx = w * signX;
      const sy = h * signY;

      // Basis vector for vertex X input [-0.5, 0.5]
      let m00 = sx * (cosY * cosZ + tanY * (sinX * sinY * cosZ - cosX * sinZ));
      let m01 = sx * (cosY * sinZ + tanY * (sinX * sinY * sinZ + cosX * cosZ));
      let m02 = sx * (-sinY       + tanY * (sinX * cosY));

      // Basis vector for vertex Y input [-0.5, 0.5]
      let m10 = sy * (tanX * cosY * cosZ + (sinX * sinY * cosZ - cosX * sinZ));
      let m11 = sy * (tanX * cosY * sinZ + (sinX * sinY * sinZ + cosX * cosZ));
      let m12 = sy * (-tanX * sinY       + (sinX * cosY));

      // Basis vector for vertex Z
      let m20 = (cosX * sinY * cosZ + sinX * sinZ);
      let m21 = (cosX * sinY * sinZ - sinX * cosZ);
      let m22 = (cosX * cosY);

      // 2. Anchor World Position
      const anchorWorldX = cx + (bounds.anchorX || 0) * (signX || 1);
      const anchorWorldY = cy + (bounds.anchorY || 0) * (signY || 1);
      const anchorWorldZ = posZ + (bounds.anchorZ || 0);

      // Relative coordinates in camera space (camera eye at distance D in front of canvas)
      let rx = anchorWorldX - (vw / 2 + camX);
      let ry = anchorWorldY - (vh / 2 + camY);
      let rz = (anchorWorldZ - camPosZ) - D;

      // Apply camera inverse 3D rotation (Roll -> Yaw -> Pitch around Camera Eye)
      if (camRotX || camRotY || camRotZ) {
        if (camRotZ) {
          const radZ = (-camRotZ * Math.PI) / 180;
          const cZ = Math.cos(radZ), sZ = Math.sin(radZ);
          const nRx = rx * cZ - ry * sZ, nRy = rx * sZ + ry * cZ;
          rx = nRx; ry = nRy;

          const nb00 = m00 * cZ - m01 * sZ, nb01 = m00 * sZ + m01 * cZ;
          m00 = nb00; m01 = nb01;

          const nb10 = m10 * cZ - m11 * sZ, nb11 = m10 * sZ + m11 * cZ;
          m10 = nb10; m11 = nb11;

          const nb20 = m20 * cZ - m21 * sZ, nb21 = m20 * sZ + m21 * cZ;
          m20 = nb20; m21 = nb21;
        }
        if (camRotY) {
          const radY = (camRotY * Math.PI) / 180;
          const cY = Math.cos(radY), sY = Math.sin(radY);
          const nRx = rx * cY + rz * sY, nRz = -rx * sY + rz * cY;
          rx = nRx; rz = nRz;

          const nb00 = m00 * cY + m02 * sY, nb02 = -m00 * sY + m02 * cY;
          m00 = nb00; m02 = nb02;

          const nb10 = m10 * cY + m12 * sY, nb12 = -m10 * sY + m12 * cY;
          m10 = nb10; m12 = nb12;

          const nb20 = m20 * cY + m22 * sY, nb22 = -m20 * sY + m22 * cY;
          m20 = nb20; m22 = nb22;
        }
        if (camRotX) {
          const radX = (camRotX * Math.PI) / 180;
          const cX = Math.cos(radX), sX = Math.sin(radX);
          const nRy = ry * cX - rz * sX, nRz = ry * sX + rz * cX;
          ry = nRy; rz = nRz;

          const nb01 = m01 * cX - m02 * sX, nb02 = m01 * sX + m02 * cX;
          m01 = nb01; m02 = nb02;

          const nb11 = m11 * cX - m12 * sX, nb12 = m11 * sX + m12 * cX;
          m11 = nb11; m12 = nb12;

          const nb21 = m21 * cX - m22 * sX, nb22 = m21 * sX + m22 * cX;
          m21 = nb21; m22 = nb22;
        }
      }

      const wTrans = -rz / D;
      if (wTrans <= 0.001) {
        // If anchor point is behind camera lens, check if any corner of the quad is still in front
        const w0 = (-rz - 0.5 * m02 - 0.5 * m12) / D;
        const w1 = (-rz + 0.5 * m02 - 0.5 * m12) / D;
        const w2 = (-rz + 0.5 * m02 + 0.5 * m12) / D;
        const w3 = (-rz - 0.5 * m02 + 0.5 * m12) / D;
        if (Math.max(w0, w1, w2, w3) <= 0.001) return null; // Entire quad is behind camera lens
      }
      const safeWTrans = Math.max(0.001, wTrans);

      // Z Perspective Projection Parameters (maps distance [NEAR, FAR] monotonically to NDC [-1, 1])
      const a = (FAR + NEAR) / (FAR - NEAR);
      const b = (-2.0 * FAR * NEAR) / (D * (FAR - NEAR)) - (layerBias || 0);

      const out = new Float32Array(16);

      // Column 0 (X vertex [-0.5, 0.5])
      out[0] = m00 * (2.0 / vw) * totalZoom;
      out[1] = -m01 * (2.0 / vh) * totalZoom;
      out[2] = a * (-m02 / D);
      out[3] = -m02 / D;

      // Column 1 (Y vertex [-0.5, 0.5])
      out[4] = m10 * (2.0 / vw) * totalZoom;
      out[5] = -m11 * (2.0 / vh) * totalZoom;
      out[6] = a * (-m12 / D);
      out[7] = -m12 / D;

      // Column 2 (Z unit basis vector)
      const z0 = m20 * (2.0 / vw) * totalZoom;
      const z1 = -m21 * (2.0 / vh) * totalZoom;
      const z3 = -m22 / D;
      out[8] = z0;
      out[9] = z1;
      out[10] = a * z3;
      out[11] = z3;

      // Column 3 (Anchor Translation & W homogeneous component)
      out[12] = (2.0 * rx) / vw * totalZoom;
      out[13] = (-2.0 * ry) / vh * totalZoom;
      out[14] = a * safeWTrans + b;
      out[15] = safeWTrans;

      // 3. Anchor Offset Correction (Shift quad vertices relative to local anchor point)
      const uax = -(bounds.anchorX || 0) / bounds.w;
      const uay = -(bounds.anchorY || 0) / bounds.h;
      if (uax || uay) {
        const dX = uax * out[0] + uay * out[4];
        const dY = uax * out[1] + uay * out[5];
        const dW = uax * out[3] + uay * out[7];
        out[12] += dX;
        out[13] += dY;
        out[14] += a * dW;
        out[15] += dW;
      }
      if (anchorZ) {
        out[12] += (-anchorZ) * z0;
        out[13] += (-anchorZ) * z1;
        out[14] += a * ((-anchorZ) * z3);
        out[15] += (-anchorZ) * z3;
      }

      return out;
    }
  }

  const engine = new FishToolEngineCore();

  window.FishToolEngine = engine;
  window.LayerTransform = engine; // Seamless drop-in alias
})(window);
