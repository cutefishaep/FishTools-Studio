/**
 * INVERT (WebGPU WGSL Driver) - effects/wgpu/invert.js
 * Hardware WebGPU shader pipeline for Invert effect with bit-exact WebGL parity.
 */
(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  const WGSL_INVERT_FS = /* wgsl */ `
    struct InvertUniforms {
      amount: f32,
      pad0: f32,
      pad1: f32,
      pad2: f32,
    };

    @group(0) @binding(0) var u_sampler: sampler;
    @group(0) @binding(1) var u_texture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> u_params: InvertUniforms;

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
    };

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
      let color = textureSample(u_texture, u_sampler, in.uv);
      if (color.a <= 0.0001) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
      }
      let unmultRgb = color.rgb / color.a;
      let amt = u_params.amount / 100.0;
      let invRgb = mix(unmultRgb, vec3<f32>(1.0) - unmultRgb, amt);
      let clamped = clamp(invRgb, vec3<f32>(0.0), vec3<f32>(1.0));
      return vec4<f32>(clamped * color.a, color.a);
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
        label: 'Invert_VS',
        code: gpu.fullscreenVS
      });

      const fsModule = device.createShaderModule({
        label: 'Invert_FS',
        code: WGSL_INVERT_FS
      });

      _bindGroupLayout = device.createBindGroupLayout({
        label: 'Invert_BGL',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
        ]
      });

      const pipelineLayout = device.createPipelineLayout({
        label: 'Invert_Layout',
        bindGroupLayouts: [_bindGroupLayout]
      });

      _pipeline = device.createRenderPipeline({
        label: 'Invert_Pipeline',
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
        label: 'Invert_Uniforms',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });

      return _pipeline;
    } catch (e) {
      console.warn('[Invert:WebGPU] Failed to initialize pipeline:', e);
      return null;
    }
  }

  function renderWebGPU(ctx, el, layer, bounds, fx, gpu) {
    if (!gpu || !gpu.isReady || !gpu.device) return false;
    const device = gpu.device;
    const pipe = initPipeline(gpu);
    if (!pipe) return false;

    const bw = Math.max(1, Math.round(bounds.w || el.naturalWidth || el.videoWidth || el.width || 100));
    const bh = Math.max(1, Math.round(bounds.h || el.naturalHeight || el.videoHeight || el.height || 100));

    // Upload source image/element to GPU texture
    const srcTex = gpu.getTexture('invert_src', bw, bh, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT);
    if (!srcTex) return false;

    try {
      device.queue.copyExternalImageToTexture(
        { source: el, flipY: false },
        { texture: srcTex },
        [bw, bh]
      );
    } catch (_) {
      // Fallback if copyExternalImageToTexture cannot sample raw element directly
      try {
        const scratch = document.createElement('canvas');
        scratch.width = bw;
        scratch.height = bh;
        const sctx = scratch.getContext('2d');
        sctx.drawImage(el, 0, 0, bw, bh);
        device.queue.copyExternalImageToTexture(
          { source: scratch, flipY: false },
          { texture: srcTex },
          [bw, bh]
        );
      } catch (err2) {
        return false;
      }
    }

    // Write parameters
    const amt = (fx && typeof fx.amount === 'number') ? fx.amount : 100.0;
    const uniformData = new Float32Array([amt, 0, 0, 0]);
    device.queue.writeBuffer(_uniformBuffer, 0, uniformData);

    const sampler = gpu.getSampler('linear_clamp');
    const bindGroup = device.createBindGroup({
      label: 'Invert_BindGroup',
      layout: _bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcTex.createView() },
        { binding: 2, resource: { buffer: _uniformBuffer } }
      ]
    });

    const { canvas: offCanvas, ctx: offCtx } = gpu.getOffscreenCanvas(bw, bh);
    if (!offCtx) return false;

    const commandEncoder = device.createCommandEncoder({ label: 'Invert_Encoder' });
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
    ctx.drawImage(offCanvas, bounds.x, bounds.y, bounds.w, bounds.h);
    return true;
  }

  reg.registerBackend('invert', 'wgpu', {
    renderPost: renderWebGPU
  });
})(typeof window !== 'undefined' ? window : globalThis);
