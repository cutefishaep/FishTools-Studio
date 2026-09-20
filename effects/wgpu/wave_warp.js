/**
 * WAVE WARP (WebGPU WGSL Driver) - effects/wgpu/wave_warp.js
 * Hardware WebGPU shader pipeline for Wave Warp with bit-exact WebGL parity.
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
      waveWidth: f32,
      dirRad: f32,
      phaseRad: f32,
      waveType: u32,
      tile: u32,
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

    fn getWaveVal(dist: f32, width: f32, phase: f32, wType: u32) -> f32 {
      let p = (dist / max(width, 0.0001)) * 6.28318530718 + phase;
      if (wType == 1u) {
        let s = clamp(sin(p), -1.0, 1.0);
        return asin(s) * 0.63661977236;
      } else if (wType == 2u) {
        if (sin(p) >= 0.0) { return 1.0; } else { return -1.0; }
      } else if (wType == 3u) {
        let norm = fract(p / 6.28318530718);
        return norm * 2.0 - 1.0;
      } else if (wType == 4u) {
        let norm = fract(p / 6.28318530718);
        let d = (norm - 0.5) * 2.0;
        return sqrt(max(0.0, 1.0 - d * d)) * 2.0 - 1.0;
      } else if (wType == 5u) {
        let norm = fract(p / 6.28318530718);
        let d = (norm - 0.5) * 2.0;
        return sqrt(max(0.0, 1.0 - d * d));
      } else if (wType == 6u) {
        let cycle = p / 6.28318530718;
        return pseudoNoise1D(floor(cycle));
      } else if (wType == 7u) {
        let cycle = p / 6.28318530718;
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

      let dist = p.x * cos(u_params.dirRad) + p.y * sin(u_params.dirRad);
      let wave = getWaveVal(dist, u_params.waveWidth, u_params.phaseRad, u_params.waveType);
      let dy = wave * u_params.waveHeight;

      let srcPixel = pixelPos + vec2<f32>(dy * sin(u_params.dirRad), -dy * cos(u_params.dirRad));
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

  let _uniformBuffer = null;
  let _bindGroupLayout = null;
  let _pipeline = null;

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

      _uniformBuffer = device.createBuffer({
        label: 'WaveWarp_Uniforms',
        size: 32, // 8 x 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });

      return _pipeline;
    } catch (e) {
      console.warn('[WaveWarp:WebGPU] Failed to initialize pipeline:', e);
      return null;
    }
  }

  function renderWebGPU(ctx, el, layer, bounds, fx, gpu) {
    if (!gpu || !gpu.isReady || !gpu.device) return false;
    const device = gpu.device;
    const pipe = initPipeline(gpu);
    if (!pipe) return false;

    const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
    const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));
    const x = bounds && bounds.x !== undefined ? bounds.x : 0;
    const y = bounds && bounds.y !== undefined ? bounds.y : 0;

    const height = fx && fx.waveHeight !== undefined ? fx.waveHeight : 25;
    if (Math.abs(height) < 0.05) {
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      return true;
    }

    const width = Math.max(10, fx && fx.waveWidth !== undefined ? fx.waveWidth : 120);
    const baseRefW = Math.abs((layer && layer.scaleW) || (layer && layer.mediaWidth) || w);
    const bufferScale = baseRefW > 0 ? (w / baseRefW) : 1;
    const effectiveHeight = height * bufferScale;
    const effectiveWidth = Math.max(1, width * bufferScale);

    const rawType = (fx && fx.waveType ? String(fx.waveType) : 'sine').toLowerCase().replace(/[\s_]+/g, '-');
    const dirDeg = fx && fx.direction !== undefined ? fx.direction : 0;
    const speed = fx && fx.speed !== undefined ? fx.speed : 1;
    const phaseDeg = fx && fx.phase !== undefined ? fx.phase : 0;

    let curSec = 0;
    if (typeof window !== 'undefined') {
      if (typeof window._currentRenderSec === 'number' && !isNaN(window._currentRenderSec)) curSec = window._currentRenderSec;
      else if (typeof window.currentPlaybackSec === 'number') curSec = window.currentPlaybackSec;
      else if (typeof window.currentSec === 'number') curSec = window.currentSec;
      else if (typeof window.getCurrentPlayheadTime === 'function') curSec = window.getCurrentPlayheadTime();
    }
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

    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));

    const srcTex = gpu.getTexture('wave_src', rw, rh, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT);
    if (!srcTex) return false;

    try {
      device.queue.copyExternalImageToTexture(
        { source: el, flipY: false },
        { texture: srcTex },
        [rw, rh]
      );
    } catch (_) {
      try {
        const scratch = document.createElement('canvas');
        scratch.width = rw;
        scratch.height = rh;
        const sctx = scratch.getContext('2d');
        sctx.drawImage(el, 0, 0, rw, rh);
        device.queue.copyExternalImageToTexture(
          { source: scratch, flipY: false },
          { texture: srcTex },
          [rw, rh]
        );
      } catch (err2) {
        return false;
      }
    }

    // Prepare Uniform Buffer
    const uniformBufferData = new ArrayBuffer(32);
    const f32View = new Float32Array(uniformBufferData);
    const u32View = new Uint32Array(uniformBufferData);

    f32View[0] = rw;
    f32View[1] = rh;
    f32View[2] = effectiveHeight;
    f32View[3] = effectiveWidth;
    f32View[4] = dirRad;
    f32View[5] = phaseRad;
    u32View[6] = typeInt;
    u32View[7] = isTile ? 1 : 0;

    device.queue.writeBuffer(_uniformBuffer, 0, uniformBufferData);

    const sampler = gpu.getSampler('linear_clamp');
    const bindGroup = device.createBindGroup({
      label: 'WaveWarp_BindGroup',
      layout: _bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcTex.createView() },
        { binding: 2, resource: { buffer: _uniformBuffer } }
      ]
    });

    const { canvas: offCanvas, ctx: offCtx } = gpu.getOffscreenCanvas(rw, rh);
    if (!offCtx) return false;

    const commandEncoder = device.createCommandEncoder({ label: 'WaveWarp_Encoder' });
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

    device.queue.submit([commandEncoder.finish()]);

    // Blit rendered frame back to 2D context
    ctx.drawImage(offCanvas, x, y, w, h);
    return true;
  }

  reg.registerBackend('wave-warp', 'wgpu', {
    renderPost: renderWebGPU
  });
})(typeof window !== 'undefined' ? window : globalThis);
