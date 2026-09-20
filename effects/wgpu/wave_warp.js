/**
 * WAVE WARP (WebGPU WGSL Driver) - effects/wgpu/wave_warp.js
 * Hardware WebGPU shader pipeline for Wave Warp with bit-exact WebGL parity,
 * zero-trig per-pixel fragment shader, and in-GPU multi-pass batching.
 */
(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  const WGSL_WAVE_WARP_FS = /* wgsl */ `
    struct WaveUniforms {
      resX: f32,
      resY: f32,
      waveHeight: f32,
      invWidthTwoPi: f32,
      dirCos: f32,
      dirSin: f32,
      phaseRad: f32,
      waveType: u32,
      tile: u32,
      pad0: u32,
      pad1: u32,
      pad2: u32,
    };

    @group(0) @binding(0) var u_sampler: sampler;
    @group(0) @binding(1) var u_texture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> u_params: WaveUniforms;

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
    };

    fn pseudoNoise1D(k: f32) -> f32 {
      let s = sin(k * 127.1 + 311.7) * 43758.5453123;
      return fract(s) * 2.0 - 1.0;
    }

    fn smoothNoise1D(u: f32) -> f32 {
      let i0 = floor(u);
      let f = fract(u);
      let q = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      let a = pseudoNoise1D(i0);
      let b = pseudoNoise1D(i0 + 1.0);
      return a + (b - a) * q;
    }

    fn getWaveVal(dist: f32, invWidthTwoPi: f32, phase: f32, wType: u32) -> f32 {
      let p = dist * invWidthTwoPi + phase;
      if (wType == 1u) {
        let s = clamp(sin(p), -1.0, 1.0);
        return asin(s) * 0.63661977236;
      } else if (wType == 2u) {
        if (sin(p) >= 0.0) { return 1.0; } else { return -1.0; }
      } else if (wType == 3u) {
        let norm = fract(p * 0.15915494309);
        return norm * 2.0 - 1.0;
      } else if (wType == 4u) {
        let norm = fract(p * 0.15915494309);
        let d = (norm - 0.5) * 2.0;
        return sqrt(max(0.0, 1.0 - d * d)) * 2.0 - 1.0;
      } else if (wType == 5u) {
        let norm = fract(p * 0.15915494309);
        let d = (norm - 0.5) * 2.0;
        return sqrt(max(0.0, 1.0 - d * d));
      } else if (wType == 6u) {
        let cycle = p * 0.15915494309;
        return pseudoNoise1D(floor(cycle));
      } else if (wType == 7u) {
        let cycle = p * 0.15915494309;
        return smoothNoise1D(cycle);
      }
      return sin(p);
    }

    fn mirrorUV(uv: vec2<f32>) -> vec2<f32> {
      var m = uv % vec2<f32>(2.0, 2.0);
      if (m.x < 0.0) { m.x += 2.0; }
      if (m.y < 0.0) { m.y += 2.0; }
      let stepVal = vec2<f32>(select(0.0, 1.0, m.x >= 1.0), select(0.0, 1.0, m.y >= 1.0));
      let f = mix(m, vec2<f32>(2.0) - m, stepVal);
      return clamp(f, vec2<f32>(0.0005), vec2<f32>(0.9995));
    }

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
      let resolution = vec2<f32>(u_params.resX, u_params.resY);
      let pixelPos = in.uv * resolution;
      let center = resolution * 0.5;
      let p = pixelPos - center;

      let dirVec = vec2<f32>(u_params.dirCos, u_params.dirSin);
      let dist = dot(p, dirVec);
      let wave = getWaveVal(dist, u_params.invWidthTwoPi, u_params.phaseRad, u_params.waveType);
      let dy = wave * u_params.waveHeight;

      let srcPixel = pixelPos + vec2<f32>(dy * u_params.dirSin, -dy * u_params.dirCos);
      var srcUV = srcPixel / resolution;

      if (u_params.tile == 1u) {
        srcUV = mirrorUV(srcUV);
        return textureSample(u_texture, u_sampler, srcUV);
      } else {
        if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) {
          return vec4<f32>(0.0, 0.0, 0.0, 0.0);
        } else {
          return textureSample(u_texture, u_sampler, srcUV);
        }
      }
    }
  `;

  let _bindGroupLayout = null;
  let _pipeline = null;
  const _uniformBuffers = [];

  function getUniformBuffer(device, index) {
    if (!_uniformBuffers[index]) {
      _uniformBuffers[index] = device.createBuffer({
        label: `WaveWarp_Uniforms_${index}`,
        size: 48, // 12 x 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
    }
    return _uniformBuffers[index];
  }

  function initPipeline(gpu) {
    if (_pipeline && gpu.device) return _pipeline;
    const device = gpu.device;
    if (!device) return null;

    try {
      const vsModule = device.createShaderModule({
        label: 'WaveWarp_VS',
        code: gpu.fullscreenVS
      });

      const fsModule = device.createShaderModule({
        label: 'WaveWarp_FS',
        code: WGSL_WAVE_WARP_FS
      });

      _bindGroupLayout = device.createBindGroupLayout({
        label: 'WaveWarp_BGL',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
        ]
      });

      const pipelineLayout = device.createPipelineLayout({
        label: 'WaveWarp_Layout',
        bindGroupLayouts: [_bindGroupLayout]
      });

      _pipeline = device.createRenderPipeline({
        label: 'WaveWarp_Pipeline',
        layout: pipelineLayout,
        vertex: {
          module: vsModule,
          entryPoint: 'vs_main'
        },
        fragment: {
          module: fsModule,
          entryPoint: 'fs_main',
          targets: [{
            format: gpu.canvasFormat,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' }
            }
          }]
        },
        primitive: {
          topology: 'triangle-list'
        }
      });

      return _pipeline;
    } catch (e) {
      console.warn('[WaveWarp:WebGPU] Failed to initialize pipeline:', e);
      return null;
    }
  }

  const _uniformBufferData = new ArrayBuffer(48);
  const _f32View = new Float32Array(_uniformBufferData);
  const _u32View = new Uint32Array(_uniformBufferData);

  function fillUniformData(fx, rw, rh, w, layer, effectiveSec) {
    const height = fx && fx.waveHeight !== undefined ? fx.waveHeight : 25;
    const width = Math.max(10, fx && fx.waveWidth !== undefined ? fx.waveWidth : 120);
    const baseRefW = Math.abs((layer && layer.scaleW) || (layer && layer.mediaWidth) || w);
    const bufferScale = baseRefW > 0 ? (w / baseRefW) : 1;
    const effectiveHeight = height * bufferScale;
    const effectiveWidth = Math.max(1, width * bufferScale);

    const rawType = (fx && fx.waveType ? String(fx.waveType) : 'sine').toLowerCase().replace(/[\s_]+/g, '-');
    const dirDeg = fx && fx.direction !== undefined ? fx.direction : 0;
    const speed = fx && fx.speed !== undefined ? fx.speed : 1;
    const phaseDeg = fx && fx.phase !== undefined ? fx.phase : 0;

    const curSec = (typeof effectiveSec === 'number' && !isNaN(effectiveSec))
      ? effectiveSec
      : (window.FishEffects ? window.FishEffects.resolveCurrentTime(layer) : 0);

    const layerStart = (layer && layer.startSec !== undefined) ? layer.startSec : 0;
    const sourceOffset = (layer && layer.sourceOffsetSec !== undefined) ? layer.sourceOffsetSec : 0;
    const t = curSec - (layerStart - sourceOffset);

    const phaseRad = (phaseDeg * Math.PI / 180) - (t * speed * Math.PI * 2);
    const dirRad = (dirDeg * Math.PI) / 180;
    const isTile = !!(fx && (fx.tile === 1 || fx.tile === true || fx.tile === '1' || fx.tile === 'true' || fx.tile === 'on'));

    let typeInt = 0; // sine
    if (rawType === 'triangle') typeInt = 1;
    else if (rawType === 'square') typeInt = 2;
    else if (rawType === 'sawtooth') typeInt = 3;
    else if (rawType === 'circle') typeInt = 4;
    else if (rawType === 'semicircle' || rawType === 'semi-circle') typeInt = 5;
    else if (rawType === 'noise') typeInt = 6;
    else if (rawType === 'smooth-noise' || rawType === 'smoothnoise' || rawType === 'noisesmooth' || rawType === 'noise-smooth') typeInt = 7;

    const invWidthTwoPi = (Math.PI * 2) / effectiveWidth;
    const dirCos = Math.cos(dirRad);
    const dirSin = Math.sin(dirRad);

    _f32View[0] = rw;
    _f32View[1] = rh;
    _f32View[2] = effectiveHeight;
    _f32View[3] = invWidthTwoPi;
    _f32View[4] = dirCos;
    _f32View[5] = dirSin;
    _f32View[6] = phaseRad;
    _u32View[7] = typeInt;
    _u32View[8] = isTile ? 1 : 0;
    _u32View[9] = 0;
    _u32View[10] = 0;
    _u32View[11] = 0;
  }

  function renderWebGPUBatch(ctx, el, layer, bounds, fxArray, arg6, arg7) {
    const gpu = (arg6 && arg6.device) ? arg6 : ((arg7 && arg7.device) ? arg7 : (window && window.FishGPU));
    const effectiveSec = (typeof arg6 === 'number') ? arg6 : (typeof arg7 === 'number' ? arg7 : null);
    if (!gpu || !gpu.isReady || !gpu.device || !ctx || !el || !Array.isArray(fxArray) || fxArray.length === 0) return false;
    const activeFx = fxArray.filter(f => f && !f.disabled && Math.abs(f.waveHeight !== undefined ? f.waveHeight : 25) >= 0.05);
    const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
    const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));
    const x = bounds && bounds.x !== undefined ? bounds.x : 0;
    const y = bounds && bounds.y !== undefined ? bounds.y : 0;

    if (activeFx.length === 0) {
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      return true;
    }

    const device = gpu.device;
    const pipe = initPipeline(gpu);
    if (!pipe) return false;

    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));

    // 1. Upload source at native resolution directly with zero DOM allocations
    const upload = gpu.uploadSourceToTexture(el, 'wave_src');
    if (!upload || !upload.texture) return false;
    const srcTex = upload.texture;

    const sampler = gpu.getSampler('linear_clamp');
    const { canvas: offCanvas, ctx: offCtx } = gpu.getOffscreenCanvas(rw, rh, 'wave-warp');
    if (!offCtx) return false;

    const commandEncoder = device.createCommandEncoder({ label: 'WaveWarp_BatchEncoder' });

    if (activeFx.length === 1) {
      // Single pass: straight to offCanvas
      const uBuf = getUniformBuffer(device, 0);
      fillUniformData(activeFx[0], rw, rh, w, layer, effectiveSec);
      device.queue.writeBuffer(uBuf, 0, _uniformBufferData);

      const bindGroup = device.createBindGroup({
        label: 'WaveWarp_BG_0',
        layout: _bindGroupLayout,
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: srcTex.createView() },
          { binding: 2, resource: { buffer: uBuf } }
        ]
      });

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: offCtx.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 }
        }]
      });
      renderPass.setPipeline(pipe);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(3, 1, 0, 0);
      renderPass.end();
    } else {
      // Multi-pass in-GPU ping-pong
      const pingTex = gpu.getTexture(
        'wave_ping',
        rw,
        rh,
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
        gpu.canvasFormat
      );
      if (!pingTex) return false;

      let currentSrcView = srcTex.createView();
      let currentDstView = pingTex.createView();

      for (let i = 0; i < activeFx.length; i++) {
        const isLast = (i === activeFx.length - 1);
        const uBuf = getUniformBuffer(device, i);
        fillUniformData(activeFx[i], rw, rh, w, layer, effectiveSec);
        device.queue.writeBuffer(uBuf, 0, _uniformBufferData);

        const bindGroup = device.createBindGroup({
          label: `WaveWarp_BG_${i}`,
          layout: _bindGroupLayout,
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: currentSrcView },
            { binding: 2, resource: { buffer: uBuf } }
          ]
        });

        const targetView = isLast ? offCtx.getCurrentTexture().createView() : currentDstView;
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: targetView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
          }]
        });
        renderPass.setPipeline(pipe);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(3, 1, 0, 0);
        renderPass.end();

        if (!isLast) {
          currentSrcView = pingTex.createView();
        }
      }
    }

    device.queue.submit([commandEncoder.finish()]);
    ctx.drawImage(offCanvas, x, y, w, h);
    return true;
  }

  function renderWebGPU(ctx, el, layer, bounds, fx, arg6, arg7) {
    return renderWebGPUBatch(ctx, el, layer, bounds, [fx], arg6, arg7);
  }

  reg.registerBackend('wave-warp', 'wgpu', {
    render: renderWebGPU,
    renderPost: renderWebGPU,
    renderBatch: renderWebGPUBatch
  });
})(typeof window !== 'undefined' ? window : globalThis);
