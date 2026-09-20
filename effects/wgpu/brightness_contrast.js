/**
 * BRIGHTNESS & CONTRAST (WebGPU WGSL Driver) - effects/wgpu/brightness_contrast.js
 * Hardware WebGPU shader pipeline for Brightness & Contrast with bit-exact WebGL parity.
 */
(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  const WGSL_BC_FS = /* wgsl */ `
    struct BCUniforms {
      brightness: f32,
      contrast: f32,
      pad0: f32,
      pad1: f32,
    };

    @group(0) @binding(0) var u_sampler: sampler;
    @group(0) @binding(1) var u_texture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> u_params: BCUniforms;

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
      var rgb = (unmultRgb - 0.5) * (1.0 + u_params.contrast / 100.0) + 0.5;
      rgb = rgb + (u_params.brightness / 100.0);
      let clamped = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
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
        label: 'BC_VS',
        code: gpu.fullscreenVS
      });

      const fsModule = device.createShaderModule({
        label: 'BC_FS',
        code: WGSL_BC_FS
      });

      _bindGroupLayout = device.createBindGroupLayout({
        label: 'BC_BGL',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
        ]
      });

      const pipelineLayout = device.createPipelineLayout({
        label: 'BC_Layout',
        bindGroupLayouts: [_bindGroupLayout]
      });

      _pipeline = device.createRenderPipeline({
        label: 'BC_Pipeline',
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
        label: 'BC_Uniforms',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });

      return _pipeline;
    } catch (e) {
      console.warn('[BrightnessContrast:WebGPU] Failed to initialize pipeline:', e);
      return null;
    }
  }

  function renderWebGPU(ctx, el, layer, bounds, fx, arg6, arg7) {
    const gpu = (arg6 && arg6.device) ? arg6 : ((arg7 && arg7.device) ? arg7 : (window && window.FishGPU));
    if (!gpu || !gpu.isReady || !gpu.device) return false;
    const device = gpu.device;
    const pipe = initPipeline(gpu);
    if (!pipe) return false;

    const bw = Math.max(1, Math.round(bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100)));
    const bh = Math.max(1, Math.round(bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100)));
    const bx = bounds && bounds.x !== undefined ? bounds.x : 0;
    const by = bounds && bounds.y !== undefined ? bounds.y : 0;

    const b = (fx && typeof fx.brightness === 'number') ? fx.brightness : 0;
    const c = (fx && typeof fx.contrast === 'number') ? fx.contrast : 0;

    if (Math.abs(b) < 0.01 && Math.abs(c) < 0.01) {
      try { ctx.drawImage(el, bx, by, bw, bh); } catch (_) {}
      return true;
    }

    const upload = gpu.uploadSourceToTexture(el, 'bc_src');
    if (!upload || !upload.texture) return false;
    const srcTex = upload.texture;

    const uniformData = new Float32Array([b, c, 0, 0]);
    device.queue.writeBuffer(_uniformBuffer, 0, uniformData);

    const sampler = gpu.getSampler('linear_clamp');
    const bindGroup = device.createBindGroup({
      label: 'BC_BindGroup',
      layout: _bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcTex.createView() },
        { binding: 2, resource: { buffer: _uniformBuffer } }
      ]
    });

    const { canvas: offCanvas, ctx: offCtx } = gpu.getOffscreenCanvas(bw, bh, 'brightness-contrast');
    if (!offCtx) return false;

    const commandEncoder = device.createCommandEncoder({ label: 'BC_Encoder' });
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

    ctx.drawImage(offCanvas, bx, by, bw, bh);
    return true;
  }

  reg.registerBackend('brightness-contrast', 'wgpu', {
    render: renderWebGPU,
    renderPost: renderWebGPU
  });
  reg.registerBackend('brightness_contrast', 'wgpu', {
    render: renderWebGPU,
    renderPost: renderWebGPU
  });
})(typeof window !== 'undefined' ? window : globalThis);
