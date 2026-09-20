/**
 * WARP (WebGPU WGSL Driver) - effects/wgpu/warp.js
 * Hardware WebGPU shader pipeline for Warp (Arc, Bulge, Twist, Fisheye, Squeeze)
 * with bit-exact WebGL parity.
 */
(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  const WGSL_WARP_FS = /* wgsl */ `
    struct WarpUniforms {
      bend: f32,
      distortH: f32,
      distortV: f32,
      aspect: f32,
      style: u32,
      pad0: u32,
      pad1: u32,
      pad2: u32,
    };

    @group(0) @binding(0) var u_sampler: sampler;
    @group(0) @binding(1) var u_texture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> u_params: WarpUniforms;

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
    };

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
      var p = in.uv * 2.0 - 1.0;

      // 1. Perspective Distort H & V (Inverse mapping)
      if (abs(u_params.distortH) > 0.001) {
        let factor = 1.0 - u_params.distortH * 0.5 * p.y;
        if (factor <= 0.02) {
          return vec4<f32>(0.0, 0.0, 0.0, 0.0);
        }
        p.x = p.x / factor;
      }
      if (abs(u_params.distortV) > 0.001) {
        let factor = 1.0 + u_params.distortV * 0.5 * p.x;
        if (factor <= 0.02) {
          return vec4<f32>(0.0, 0.0, 0.0, 0.0);
        }
        p.y = p.y / factor;
      }

      var p_src = p;
      let b = u_params.bend;
      let aspect = u_params.aspect;

      if (abs(b) > 0.001) {
        if (u_params.style == 0u) {
          // ARC
          let arch = max(0.0, 1.0 - p.x * p.x);
          p_src.y = p_src.y + b * 0.55 * arch;
          let taper = 1.0 - b * 0.25 * p.y;
          if (taper > 0.05) {
            p_src.x = p_src.x / taper;
          }
        } else if (u_params.style == 1u) {
          // BULGE
          let ap = vec2<f32>(p.x * max(aspect, 1.0), p.y * max(1.0 / aspect, 1.0));
          let r = length(ap);
          let R = 1.35;
          if (r < R) {
            let d = 1.0 - (r / R);
            let d2 = d * d;
            let scale = max(0.08, 1.0 - b * 0.65 * d2);
            p_src = p * scale;
          }
        } else if (u_params.style == 2u) {
          // TWIST
          let ap = vec2<f32>(p.x * max(aspect, 1.0), p.y * max(1.0 / aspect, 1.0));
          let r = length(ap);
          let R = 1.5;
          if (r < R) {
            let t = 1.0 - (r / R);
            let falloff = t * t * (3.0 - 2.0 * t);
            let angle = -b * 3.141592653589793 * 2.5 * falloff;
            let cosA = cos(angle);
            let sinA = sin(angle);
            let rotAp = vec2<f32>(ap.x * cosA - ap.y * sinA, ap.x * sinA + ap.y * cosA);
            p_src = vec2<f32>(rotAp.x / max(aspect, 1.0), rotAp.y / max(1.0 / aspect, 1.0));
          }
        } else if (u_params.style == 3u) {
          // FISHEYE (Boundary-Anchored Full-Frame After Effects Warp)
          let k = select(-b * 0.65, -b * 1.6, b < 0.0);
          let fx = k * (1.0 - p.y * p.y);
          let fy = k * (1.0 - p.x * p.x);
          let oneMinusAbsX = 1.0 - abs(p.x);
          let oneMinusAbsY = 1.0 - abs(p.y);
          p_src.x = p.x * (1.0 + fx * oneMinusAbsX * oneMinusAbsX);
          p_src.y = p.y * (1.0 + fy * oneMinusAbsY * oneMinusAbsY);
        } else if (u_params.style == 4u) {
          // SQUEEZE
          let waistX = 1.0 - b * 0.6 * (1.0 - p.y * p.y);
          let waistY = 1.0 + b * 0.3 * (1.0 - p.x * p.x);
          p_src.x = p_src.x / max(0.08, waistX);
          p_src.y = p_src.y / max(0.08, waistY);
        }
      }

      var uv_src = p_src * 0.5 + 0.5;
      if (u_params.style == 3u) {
        uv_src = clamp(uv_src, vec2<f32>(0.0), vec2<f32>(1.0));
        return textureSample(u_texture, u_sampler, uv_src);
      } else {
        if (uv_src.x < 0.0 || uv_src.x > 1.0 || uv_src.y < 0.0 || uv_src.y > 1.0) {
          return vec4<f32>(0.0, 0.0, 0.0, 0.0);
        }
        return textureSample(u_texture, u_sampler, uv_src);
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
        label: 'Warp_VS',
        code: gpu.fullscreenVS
      });

      const fsModule = device.createShaderModule({
        label: 'Warp_FS',
        code: WGSL_WARP_FS
      });

      _bindGroupLayout = device.createBindGroupLayout({
        label: 'Warp_BGL',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
        ]
      });

      const pipelineLayout = device.createPipelineLayout({
        label: 'Warp_Layout',
        bindGroupLayouts: [_bindGroupLayout]
      });

      _pipeline = device.createRenderPipeline({
        label: 'Warp_Pipeline',
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
        label: 'Warp_Uniforms',
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });

      return _pipeline;
    } catch (e) {
      console.warn('[Warp:WebGPU] Failed to initialize pipeline:', e);
      return null;
    }
  }

  const _uniformBufferData = new ArrayBuffer(32);
  const _f32View = new Float32Array(_uniformBufferData);
  const _u32View = new Uint32Array(_uniformBufferData);

  function renderWebGPU(ctx, el, layer, bounds, fx, arg6, arg7) {
    const gpu = (arg6 && arg6.device) ? arg6 : ((arg7 && arg7.device) ? arg7 : (window && window.FishGPU));
    if (!gpu || !gpu.isReady || !gpu.device) return false;
    const device = gpu.device;
    const pipe = initPipeline(gpu);
    if (!pipe) return false;

    const w = Math.max(1, bounds && bounds.w !== undefined ? bounds.w : (ctx.canvas ? ctx.canvas.width : 100));
    const h = Math.max(1, bounds && bounds.h !== undefined ? bounds.h : (ctx.canvas ? ctx.canvas.height : 100));
    const x = bounds && bounds.x !== undefined ? bounds.x : 0;
    const y = bounds && bounds.y !== undefined ? bounds.y : 0;

    const bend = (fx && fx.bend !== undefined ? fx.bend : 30) / 100;
    const distortH = (fx && fx.distortH !== undefined ? fx.distortH : 0) / 100;
    const distortV = (fx && fx.distortV !== undefined ? fx.distortV : 0) / 100;

    if (Math.abs(bend) < 0.001 && Math.abs(distortH) < 0.001 && Math.abs(distortV) < 0.001) {
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      return true;
    }

    const styleStr = (fx && fx.warpStyle ? fx.warpStyle : 'arc').toLowerCase();
    let styleInt = 0;
    if (styleStr === 'bulge') styleInt = 1;
    else if (styleStr === 'twist') styleInt = 2;
    else if (styleStr === 'fisheye') styleInt = 3;
    else if (styleStr === 'squeeze') styleInt = 4;

    const aspect = w / h;
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));

    // Upload source at native resolution directly
    const upload = gpu.uploadSourceToTexture(el, 'warp_src');
    if (!upload || !upload.texture) return false;
    const srcTex = upload.texture;

    _f32View[0] = bend;
    _f32View[1] = distortH;
    _f32View[2] = distortV;
    _f32View[3] = aspect;
    _u32View[4] = styleInt;
    _u32View[5] = 0;
    _u32View[6] = 0;
    _u32View[7] = 0;

    device.queue.writeBuffer(_uniformBuffer, 0, _uniformBufferData);

    const sampler = gpu.getSampler('linear_clamp');
    const bindGroup = device.createBindGroup({
      label: 'Warp_BindGroup',
      layout: _bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcTex.createView() },
        { binding: 2, resource: { buffer: _uniformBuffer } }
      ]
    });

    const { canvas: offCanvas, ctx: offCtx } = gpu.getOffscreenCanvas(rw, rh, 'warp');
    if (!offCtx) return false;

    const commandEncoder = device.createCommandEncoder({ label: 'Warp_Encoder' });
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

    ctx.drawImage(offCanvas, x, y, w, h);
    return true;
  }

  reg.registerBackend('warp', 'wgpu', {
    render: renderWebGPU,
    renderPost: renderWebGPU
  });
})(typeof window !== 'undefined' ? window : globalThis);
