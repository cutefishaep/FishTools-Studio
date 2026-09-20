/**
 * TURBULENT DISPLACE (WebGPU WGSL Driver) - effects/wgpu/turbulent_displace.js
 * Hardware WebGPU shader pipeline for Turbulent Displace with bit-exact WebGL parity.
 */
(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  const WGSL_TURBULENT_FS = /* wgsl */ `
    struct TurbUniforms {
      resX: f32,
      resY: f32,
      amount: f32,
      size: f32,
      offsetX: f32,
      offsetY: f32,
      complexity: f32,
      evolution: f32,
      dispType: u32,
      pinning: u32,
      tile: u32,
      pad0: u32,
    };

    @group(0) @binding(0) var u_sampler: sampler;
    @group(0) @binding(1) var u_texture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> u_params: TurbUniforms;

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
    };

    fn permute4(x: vec4<f32>) -> vec4<f32> {
      return (((x * 34.0) + vec4<f32>(1.0)) * x) % vec4<f32>(289.0);
    }

    fn taylorInvSqrt4(r: vec4<f32>) -> vec4<f32> {
      return vec4<f32>(1.79284291400159) - vec4<f32>(0.85373472095314) * r;
    }

    fn snoise(v: vec3<f32>) -> f32 {
      let C = vec2<f32>(1.0 / 6.0, 1.0 / 3.0);
      let D = vec4<f32>(0.0, 0.5, 1.0, 2.0);

      var i = floor(v + vec3<f32>(dot(v, vec3<f32>(C.y))));
      let x0 = v - i + vec3<f32>(dot(i, vec3<f32>(C.x)));

      let g = step(x0.yzx, x0.xyz);
      let l = vec3<f32>(1.0) - g;
      let i1 = min(g.xyz, l.zxy);
      let i2 = max(g.xyz, l.zxy);

      let x1 = x0 - i1 + vec3<f32>(C.x);
      let x2 = x0 - i2 + vec3<f32>(2.0 * C.x);
      let x3 = x0 - vec3<f32>(1.0) + vec3<f32>(3.0 * C.x);

      i = i % vec3<f32>(289.0);
      let p = permute4(permute4(permute4(
                vec4<f32>(i.z) + vec4<f32>(0.0, i1.z, i2.z, 1.0))
              + vec4<f32>(i.y) + vec4<f32>(0.0, i1.y, i2.y, 1.0))
              + vec4<f32>(i.x) + vec4<f32>(0.0, i1.x, i2.x, 1.0));

      let n_ = 0.142857142857;
      let ns = n_ * D.wyz - D.xzx;

      let j = p - 49.0 * floor(p * ns.z * ns.z);

      let x_ = floor(j * ns.z);
      let y_ = floor(j - 7.0 * x_);

      let x = x_ * ns.x + vec4<f32>(ns.y);
      let y = y_ * ns.x + vec4<f32>(ns.y);
      let h = vec4<f32>(1.0) - abs(x) - abs(y);

      let b0 = vec4<f32>(x.xy, y.xy);
      let b1 = vec4<f32>(x.zw, y.zw);

      let s0 = floor(b0) * 2.0 + vec4<f32>(1.0);
      let s1 = floor(b1) * 2.0 + vec4<f32>(1.0);
      let sh = -step(h, vec4<f32>(0.0));

      let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
      let a1 = b1.xzyw + s1.xzyw * sh.zzww;

      var p0 = vec3<f32>(a0.xy, h.x);
      var p1 = vec3<f32>(a0.zw, h.y);
      var p2 = vec3<f32>(a1.xy, h.z);
      var p3 = vec3<f32>(a1.zw, h.w);

      let norm = taylorInvSqrt4(vec4<f32>(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;

      var m = max(vec4<f32>(0.6) - vec4<f32>(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4<f32>(0.0));
      m = m * m;
      return 42.0 * dot(m * m, vec4<f32>(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
    }

    fn mirrorUV(uv: vec2<f32>) -> vec2<f32> {
      var m = uv % vec2<f32>(2.0, 2.0);
      if (m.x < 0.0) { m.x += 2.0; }
      if (m.y < 0.0) { m.y += 2.0; }
      let stepVal = vec2<f32>(select(0.0, 1.0, m.x >= 1.0), select(0.0, 1.0, m.y >= 1.0));
      let f = mix(m, vec2<f32>(2.0) - m, stepVal);
      return clamp(f, vec2<f32>(0.0005), vec2<f32>(0.9995));
    }

    fn getPinningFactor(uv: vec2<f32>, pinning: u32) -> vec2<f32> {
      if (pinning == 0u) { return vec2<f32>(1.0, 1.0); }
      let d = min(uv, vec2<f32>(1.0) - uv);
      let margin = 0.08;
      let fx = smoothstep(0.0, margin, d.x);
      let fy = smoothstep(0.0, margin, d.y);
      if (pinning == 1u) { return vec2<f32>(fx * fy); }
      if (pinning == 2u) { return vec2<f32>(fx); }
      if (pinning == 3u) { return vec2<f32>(fy); }
      return vec2<f32>(1.0, 1.0);
    }

    fn calculateAEDisplacement(coord: vec2<f32>, evo: f32, octaves: i32, dispType: u32) -> vec2<f32> {
      var disp = vec2<f32>(0.0, 0.0);
      var amp = 1.0;
      var freq = 1.0;
      var totalAmp = 0.0;
      let rot = mat2x2<f32>(vec2<f32>(0.80, -0.60), vec2<f32>(0.60, 0.80));
      var c = coord;
      let OFFSET_Y = vec3<f32>(31.416, 59.265, 17.331);
      let EPS = 0.015;

      for (var o: i32 = 0; o < 8; o++) {
        if (o >= octaves) { break; }
        let p1 = vec3<f32>(c * freq, evo * 0.15 + f32(o) * 1.731);
        let p2 = p1 + OFFSET_Y;
        let n1 = snoise(p1);
        let n2 = snoise(p2);
        var octDisp = vec2<f32>(0.0, 0.0);

        if (dispType == 0u) {
          let r1 = abs(n1) * 2.0 - 1.0;
          let r2 = abs(n2) * 2.0 - 1.0;
          octDisp = vec2<f32>(r1, r2);
        } else if (dispType == 1u) {
          octDisp = vec2<f32>(n1, n2);
        } else if (dispType == 2u) {
          let n1_dx = snoise(p1 + vec3<f32>(EPS, 0.0, 0.0));
          let n1_dy = snoise(p1 + vec3<f32>(0.0, EPS, 0.0));
          let grad = (vec2<f32>(n1_dx, n1_dy) - vec2<f32>(n1)) / EPS;
          let r = abs(n1) * 2.0 - 1.0;
          octDisp = clamp(grad * 0.5, vec2<f32>(-1.5), vec2<f32>(1.5)) * (0.5 + 0.5 * r);
        } else if (dispType == 3u) {
          let n1_dx = snoise(p1 + vec3<f32>(EPS, 0.0, 0.0));
          let n1_dy = snoise(p1 + vec3<f32>(0.0, EPS, 0.0));
          let grad = (vec2<f32>(n1_dx, n1_dy) - vec2<f32>(n1)) / EPS;
          octDisp = clamp(grad * 0.5, vec2<f32>(-1.5), vec2<f32>(1.5));
        } else if (dispType == 4u) {
          let n1_dx = snoise(p1 + vec3<f32>(EPS, 0.0, 0.0));
          let n1_dy = snoise(p1 + vec3<f32>(0.0, EPS, 0.0));
          let grad = (vec2<f32>(n1_dx, n1_dy) - vec2<f32>(n1)) / EPS;
          let curl = vec2<f32>(grad.y, -grad.x);
          let r = abs(n1) * 2.0 - 1.0;
          octDisp = clamp(curl * 0.5, vec2<f32>(-1.5), vec2<f32>(1.5)) * (0.5 + 0.5 * r);
        } else if (dispType == 5u) {
          let n1_dx = snoise(p1 + vec3<f32>(EPS, 0.0, 0.0));
          let n1_dy = snoise(p1 + vec3<f32>(0.0, EPS, 0.0));
          let grad = (vec2<f32>(n1_dx, n1_dy) - vec2<f32>(n1)) / EPS;
          octDisp = clamp(vec2<f32>(grad.y, -grad.x) * 0.5, vec2<f32>(-1.5), vec2<f32>(1.5));
        } else if (dispType == 6u) {
          octDisp = vec2<f32>(abs(n1) * 2.0 - 1.0, 0.0);
        } else if (dispType == 7u) {
          octDisp = vec2<f32>(0.0, abs(n2) * 2.0 - 1.0);
        } else if (dispType == 8u) {
          octDisp = vec2<f32>(abs(n1) * 2.0 - 1.0, -(abs(n2) * 2.0 - 1.0));
        }

        disp += octDisp * amp;
        totalAmp += amp;
        amp *= 0.5;
        freq *= 2.0;
        c = rot * c;
      }

      return disp / max(totalAmp, 0.001);
    }

    @fragment
    fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
      let resolution = vec2<f32>(u_params.resX, u_params.resY);
      let pixelPos = in.uv * resolution;
      let center = resolution * 0.5;
      let offset = vec2<f32>(u_params.offsetX, u_params.offsetY);
      let sampleCoord = (pixelPos - (center + offset)) / max(u_params.size, 1.0);

      let disp = calculateAEDisplacement(sampleCoord, u_params.evolution, i32(u_params.complexity), u_params.dispType);
      let pin = getPinningFactor(in.uv, u_params.pinning);
      let displacedPixel = pixelPos + (disp * u_params.amount * pin);
      var srcUV = displacedPixel / resolution;

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
        label: 'Turbulent_VS',
        code: gpu.fullscreenVS
      });

      const fsModule = device.createShaderModule({
        label: 'Turbulent_FS',
        code: WGSL_TURBULENT_FS
      });

      _bindGroupLayout = device.createBindGroupLayout({
        label: 'Turbulent_BGL',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
        ]
      });

      const pipelineLayout = device.createPipelineLayout({
        label: 'Turbulent_Layout',
        bindGroupLayouts: [_bindGroupLayout]
      });

      _pipeline = device.createRenderPipeline({
        label: 'Turbulent_Pipeline',
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
        label: 'Turbulent_Uniforms',
        size: 48, // 12 x 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });

      return _pipeline;
    } catch (e) {
      console.warn('[Turbulent:WebGPU] Failed to initialize pipeline:', e);
      return null;
    }
  }

  const _uniformBufferData = new ArrayBuffer(48);
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

    const amount = (fx && typeof fx.amount === 'number') ? fx.amount : 50;
    if (Math.abs(amount) < 0.05) {
      try { ctx.drawImage(el, x, y, w, h); } catch (_) {}
      return true;
    }

    const size = Math.max(1, (fx && typeof fx.size === 'number') ? fx.size : 100);
    const complexity = Math.min(8, Math.max(1, (fx && typeof fx.complexity === 'number') ? Math.round(fx.complexity) : 3));
    const evolution = (fx && typeof fx.evolution === 'number') ? (fx.evolution * Math.PI / 180) : 0;
    const offsetX = (fx && typeof fx.offsetX === 'number') ? fx.offsetX : 0;
    const offsetY = (fx && typeof fx.offsetY === 'number') ? fx.offsetY : 0;

    const rawType = (fx && fx.dispType ? String(fx.dispType) : 'turbulent').toLowerCase().replace(/[\s_]+/g, '-');
    let dispTypeInt = 0;
    if (rawType === 'turbulent-smoother' || rawType === 'smoother') dispTypeInt = 1;
    else if (rawType === 'bulge') dispTypeInt = 2;
    else if (rawType === 'bulge-smoother') dispTypeInt = 3;
    else if (rawType === 'twist') dispTypeInt = 4;
    else if (rawType === 'twist-smoother') dispTypeInt = 5;
    else if (rawType === 'horizontal') dispTypeInt = 6;
    else if (rawType === 'vertical') dispTypeInt = 7;
    else if (rawType === 'cross') dispTypeInt = 8;

    const rawPinning = (fx && fx.pinning ? String(fx.pinning) : 'none').toLowerCase();
    let pinningInt = 0;
    if (rawPinning === 'all') pinningInt = 1;
    else if (rawPinning === 'horizontal' || rawPinning === 'horiz') pinningInt = 2;
    else if (rawPinning === 'vertical' || rawPinning === 'vert') pinningInt = 3;

    const isTile = !!(fx && (fx.tile === 1 || fx.tile === true || fx.tile === '1' || fx.tile === 'true'));

    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));

    // Upload source at native resolution directly with zero DOM allocations
    const upload = gpu.uploadSourceToTexture(el, 'turb_src');
    if (!upload || !upload.texture) return false;
    const srcTex = upload.texture;

    _f32View[0] = rw;
    _f32View[1] = rh;
    _f32View[2] = amount;
    _f32View[3] = size;
    _f32View[4] = offsetX;
    _f32View[5] = offsetY;
    _f32View[6] = complexity;
    _f32View[7] = evolution;
    _u32View[8] = dispTypeInt;
    _u32View[9] = pinningInt;
    _u32View[10] = isTile ? 1 : 0;
    _u32View[11] = 0; // padding

    device.queue.writeBuffer(_uniformBuffer, 0, _uniformBufferData);

    const sampler = gpu.getSampler('linear_clamp');
    const bindGroup = device.createBindGroup({
      label: 'Turbulent_BindGroup',
      layout: _bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: srcTex.createView() },
        { binding: 2, resource: { buffer: _uniformBuffer } }
      ]
    });

    const { canvas: offCanvas, ctx: offCtx } = gpu.getOffscreenCanvas(rw, rh, 'turbulent-displace');
    if (!offCtx) return false;

    const commandEncoder = device.createCommandEncoder({ label: 'Turbulent_Encoder' });
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

  reg.registerBackend('turbulent-displace', 'wgpu', {
    render: renderWebGPU,
    renderPost: renderWebGPU
  });
})(typeof window !== 'undefined' ? window : globalThis);
