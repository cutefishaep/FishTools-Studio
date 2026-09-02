
(function() {
  const reg = (typeof FishEffects !== 'undefined' && FishEffects.registerEffect) 
    ? FishEffects.registerEffect 
    : function(def) {
        if (typeof EFFECTS_CATALOG !== 'undefined') EFFECTS_CATALOG.push(def);
      };
  const LUT_SIZE = 2048;
  const LUT_MASK = 2047;
  const LUT_RAD_TO_IDX = LUT_SIZE / (Math.PI * 2);
  const SIN_LUT = new Float32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    SIN_LUT[i] = Math.sin((i / LUT_SIZE) * Math.PI * 2);
  }

  function fastSin(rad) {
    return SIN_LUT[((rad * LUT_RAD_TO_IDX) | 0) & LUT_MASK];
  }

  function fastCos(rad) {
    return SIN_LUT[(((rad + (Math.PI * 0.5)) * LUT_RAD_TO_IDX) | 0) & LUT_MASK];
  }
  function sampleFastBilinear(sData, w, h, x, y) {
    if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
    if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
    
    const x0 = x | 0, y0 = y | 0;
    const x1 = (x0 + 1 < w) ? (x0 + 1) : x0;
    const y1 = (y0 + 1 < h) ? (y0 + 1) : y0;

    const fx = ((x - x0) * 256) | 0;
    const fy = ((y - y0) * 256) | 0;
    const fx1 = 256 - fx;
    const fy1 = 256 - fy;

    const w00 = (fx1 * fy1) >> 8;
    const w10 = (fx * fy1) >> 8;
    const w01 = (fx1 * fy) >> 8;
    const w11 = (fx * fy) >> 8;

    const i00 = (y0 * w + x0) * 4;
    const i10 = (y0 * w + x1) * 4;
    const i01 = (y1 * w + x0) * 4;
    const i11 = (y1 * w + x1) * 4;

    const r = (w00 * sData[i00] + w10 * sData[i10] + w01 * sData[i01] + w11 * sData[i11]) >> 8;
    const g = (w00 * sData[i00+1] + w10 * sData[i10+1] + w01 * sData[i01+1] + w11 * sData[i11+1]) >> 8;
    const b = (w00 * sData[i00+2] + w10 * sData[i10+2] + w01 * sData[i01+2] + w11 * sData[i11+2]) >> 8;
    const a = (w00 * sData[i00+3] + w10 * sData[i10+3] + w01 * sData[i01+3] + w11 * sData[i11+3]) >> 8;

    return (a << 24) | (b << 16) | (g << 8) | r;
  }
  reg({
    type: 'wave_warp',
    name: 'Wave Warp',
    category: 'distort',
    desc: 'Distorsi gelombang dinamis untuk efek kain bendera berkibar atau riak air.',
    defaultParams: { spacing: 20, magnitude: 4, phase: 0, angle: 0, warpAngle: 90 },
    paramsConfig: [
      { id: 'phase', label: 'Phase', min: -1000, max: 1000, step: 0.01, unit: '' },
      { id: 'angle', label: 'Angle', min: -1800, max: 1800, step: 0.5, unit: '°' },
      { id: 'spacing', label: 'Spacing', min: 0.1, max: 500, step: 0.1, unit: 'px' },
      { id: 'magnitude', label: 'Magnitude', min: 0, max: 60, step: 0.1, unit: 'px' },
      { id: 'warpAngle', label: 'Warp Angle', min: -180, max: 180, step: 0.5, unit: '°' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const sData32 = new Uint32Array(sData.buffer);
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const radA1 = (p.angle || 0) * (Math.PI / 180);
    const radA2 = ((p.angle || 0) + (p.warpAngle !== undefined ? p.warpAngle : 90)) * (Math.PI / 180);
    const space = Math.max(0.1, p.spacing !== undefined ? p.spacing : 20);
    const mag = (p.magnitude !== undefined ? p.magnitude : 4);
    const phaseRad = (p.phase || 0) * (Math.PI * 2);

    const cosA1 = Math.cos(radA1), sinA1 = -Math.sin(radA1);
    const cosA2 = Math.cos(radA2), sinA2 = -Math.sin(radA2);
    const spaceFactor = space * 4.0;
    const colStep = (cosA1 / w) * spaceFactor;

    for (let y = 0; y < h; y++) {
      const ny = y / h;
      const rowProj = ny * sinA1 * spaceFactor + phaseRad;
      const rowOffset = y * w;
      let proj = rowProj;

      for (let x = 0; x < w; x++) {
        const wave = fastSin(proj);
        proj += colStep;

        const sx = x + cosA2 * mag * wave;
        const sy = y + sinA2 * mag * wave;

        if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
          const isx = sx | 0, isy = sy | 0;
          if (isx === sx && isy === sy) {
            dData32[rowOffset + x] = sData32[isy * w + isx];
          } else {
            dData32[rowOffset + x] = sampleFastBilinear(sData, w, h, sx, sy);
          }
        } else {
          dData32[rowOffset + x] = sampleFastBilinear(sData, w, h, sx, sy);
        }
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'tiles',
    name: 'Tiles',
    category: 'distort',
    desc: 'Pengulangan kisi ubin dengan opsi Mirror untuk efek transisi mulus.',
    defaultParams: { crop: 1.0, scale: 1.0, offset: 0, phase: 0, mirror: 1, angle: 0 },
    paramsConfig: [
      { id: 'crop', label: 'Crop / Scale', min: 0.005, max: 20.0, step: 0.005, unit: 'x' },
      { id: 'offset', label: 'Offset', min: -100.0, max: 100.0, step: 0.005, unit: '' },
      { id: 'mirror', label: 'Mirror', min: 0, max: 1, step: 1, unit: '' },
      { id: 'angle', label: 'Angle', min: -1800.0, max: 1800.0, step: 0.5, unit: '°' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const sData32 = new Uint32Array(sData.buffer);
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const scale = Math.max(0.005, (p.crop !== undefined ? p.crop : (p.scale !== undefined ? p.scale : 1.0)));
    const offs = (p.offset !== undefined ? p.offset : (p.phase !== undefined ? p.phase : 0.0));
    const isMirror = (p.mirror === 1 || p.mirror === true || p.mirror === '1' || p.mirror === 'true');
    const isVertOffs = (p.vertoffs === 1 || p.vertoffs === true || p.vertoffs === '1' || p.vertoffs === 'true');
    const angRad = (p.angle || 0) * (Math.PI / 180);
    const cosA = Math.cos(angRad), sinA = Math.sin(angRad);
    const aspect = w / h;
    const invW = 1 / w, invH = 1 / h;
    const wm1 = w - 1;
    const hm1 = h - 1;
    const invScale = 1.0 / scale;

    for (let y = 0; y < h; y++) {
      const ny = (y * invH) - 0.5;
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const nx = (x * invW) - 0.5;

        const nu = nx * aspect;
        const nv = ny;
        const ru = (nu * cosA - nv * sinA) * invScale;
        const rv = (nu * sinA + nv * cosA) * invScale;
        let pu = (ru / aspect) + 0.5;
        let pv = rv + 0.5;

        if (isVertOffs) {
          if ((Math.floor(pu) & 1) !== 0) pv += offs;
        } else {
          if ((Math.floor(pv) & 1) !== 0) pu += offs;
        }

        let u, v;
        if (isMirror) {
          u = Math.abs((((pu - 1) % 2) + 2) % 2 - 1);
          v = Math.abs((((pv - 1) % 2) + 2) % 2 - 1);
        } else {
          u = ((pu % 1) + 1) % 1;
          v = ((pv % 1) + 1) % 1;
        }

        const sx = Math.max(0, Math.min(wm1, (u * wm1) | 0));
        const sy = Math.max(0, Math.min(hm1, (v * hm1) | 0));
        dData32[rowOffset + x] = sData32[sy * w + sx];
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'swirl',
    name: 'Swirl',
    category: 'distort',
    desc: 'Pusaran spiral konsentris pada titik tertentu.',
    defaultParams: { radius: 50, strength: 180, centerX: 50, centerY: 50 },
    paramsConfig: [
      { id: 'strength', label: 'Strength', min: -1800, max: 1800, step: 1, unit: '°' },
      { id: 'radius', label: 'Radius', min: 0, max: 500, step: 1, unit: '%' },
      { id: 'centerX', label: 'Center X', min: -200, max: 200, step: 1, unit: '%' },
      { id: 'centerY', label: 'Center Y', min: -200, max: 200, step: 1, unit: '%' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const sData32 = new Uint32Array(sData.buffer);
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const cx = ((p.centerX !== undefined ? p.centerX : 50) / 100) * w;
    const cy = ((p.centerY !== undefined ? p.centerY : 50) / 100) * h;
    const rad = ((p.radius !== undefined ? p.radius : 50) / 100) * (Math.min(w, h) * 0.5);
    const radSq = rad * rad;
    const invRad = rad > 0 ? 1 / rad : 0;
    const str = (p.strength !== undefined ? p.strength : 180) * (Math.PI / 180);

    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      const dySq = dy * dy;
      const rowOffset = y * w;

      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const distSq = dx * dx + dySq;

        if (distSq >= radSq || distSq === 0) {
          dData32[rowOffset + x] = sData32[rowOffset + x];
          continue;
        }

        const dist = Math.sqrt(distSq);
        const factor = (rad - dist) * invRad;
        const theta = factor * factor * str;
        const cosT = fastCos(theta), sinT = fastSin(theta);
        const sx = cx + (dx * cosT - dy * sinT);
        const sy = cy + (dx * sinT + dy * cosT);

        dData32[rowOffset + x] = sampleFastBilinear(sData, w, h, sx, sy);
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'pinch_bulge',
    name: 'Pinch / Bulge',
    category: 'distort',
    desc: 'Efek mencubit (pinch) atau menggembungkan (bulge) lensa.',
    defaultParams: { radius: 50, strength: -90, centerX: 50, centerY: 50 },
    paramsConfig: [
      { id: 'strength', label: 'Strength', min: -200, max: 200, step: 1, unit: '%' },
      { id: 'radius', label: 'Radius', min: 0, max: 500, step: 1, unit: '%' },
      { id: 'centerX', label: 'Center X', min: -200, max: 200, step: 1, unit: '%' },
      { id: 'centerY', label: 'Center Y', min: -200, max: 200, step: 1, unit: '%' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const sData32 = new Uint32Array(sData.buffer);
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const cx = ((p.centerX !== undefined ? p.centerX : 50) / 100) * w;
    const cy = ((p.centerY !== undefined ? p.centerY : 50) / 100) * h;
    const rad = ((p.radius !== undefined ? p.radius : 50) / 100) * (Math.min(w, h) * 0.5);
    const radSq = rad * rad;
    const invRad = rad > 0 ? 1 / rad : 0;
    const str = (p.strength !== undefined ? p.strength : -90) / 100;
    const exponent = str > 0 ? (1 + str * 1.8) : (1 / Math.max(0.01, 1 - str * 1.8));

    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      const dySq = dy * dy;
      const rowOffset = y * w;

      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const distSq = dx * dx + dySq;

        if (distSq >= radSq || distSq === 0) {
          dData32[rowOffset + x] = sData32[rowOffset + x];
          continue;
        }

        const dist = Math.sqrt(distSq);
        const normDist = dist * invRad;
        const factor = Math.pow(normDist, exponent);
        const ratio = factor / normDist;
        const sx = cx + dx * ratio;
        const sy = cy + dy * ratio;

        dData32[rowOffset + x] = sampleFastBilinear(sData, w, h, sx, sy);
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'bend',
    name: 'Bend',
    category: 'distort',
    desc: 'Melengkungkan layer seperti lembaran lentur.',
    defaultParams: { bend: 45, anchor: 50 },
    paramsConfig: [
      { id: 'bend', label: 'Bend Angle', min: -1800, max: 1800, step: 0.5, unit: '°' },
      { id: 'anchor', label: 'Anchor Position', min: 0, max: 100, step: 0.1, unit: '%' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const bendDeg = (p.bend !== undefined ? p.bend : 45);
    const anchorY = ((p.anchor !== undefined ? p.anchor : 50) / 100) * h;
    const bendRad = (bendDeg * Math.PI) / 180;
    const curveAmount = (bendDeg / 180) * (w * 0.4);

    for (let y = 0; y < h; y++) {
      const ny = (y - anchorY) / h;
      const curveX = curveAmount * (ny * ny);
      const rowOffset = y * w;

      for (let x = 0; x < w; x++) {
        const sx = x - curveX;
        const sy = y - fastSin((x / w - 0.5) * bendRad) * (Math.abs(bendDeg) * 0.4);

        dData32[rowOffset + x] = sampleFastBilinear(sData, w, h, sx, sy);
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'circular_ripple',
    name: 'Circular Ripple',
    category: 'distort',
    desc: 'Riak gelombang air konsentris memancar keluar.',
    defaultParams: { frequency: 20, amplitude: 10, phase: 0, radius: 80 },
    paramsConfig: [
      { id: 'phase', label: 'Phase', min: -1000, max: 1000, step: 0.01, unit: '' },
      { id: 'frequency', label: 'Frequency', min: 0, max: 200, step: 0.1, unit: 'Hz' },
      { id: 'amplitude', label: 'Amplitude', min: -200, max: 200, step: 0.1, unit: 'px' },
      { id: 'radius', label: 'Radius', min: 0, max: 500, step: 1, unit: '%' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const sData32 = new Uint32Array(sData.buffer);
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const cx = w * 0.5, cy = h * 0.5;
    const amp = (p.amplitude !== undefined ? p.amplitude : 10);
    const freq = (p.frequency !== undefined ? p.frequency : 20);
    const phaseRad = (p.phase || 0) * (Math.PI * 2);
    const maxRad = ((p.radius !== undefined ? p.radius : 80) / 100) * (Math.min(w, h) * 0.5);
    const maxRadSq = maxRad * maxRad;
    const invMaxRad = maxRad > 0 ? 1 / maxRad : 0;
    const freqFactor = freq * 0.1;

    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      const dySq = dy * dy;
      const rowOffset = y * w;

      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const distSq = dx * dx + dySq;

        if (distSq >= maxRadSq || distSq === 0) {
          dData32[rowOffset + x] = sData32[rowOffset + x];
          continue;
        }

        const dist = Math.sqrt(distSq);
        const falloff = 1.0 - (dist * invMaxRad);
        const wave = fastSin(dist * freqFactor - phaseRad) * amp * falloff;
        const ratio = wave / dist;
        const sx = x + dx * ratio;
        const sy = y + dy * ratio;

        dData32[rowOffset + x] = sampleFastBilinear(sData, w, h, sx, sy);
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'mirror',
    name: 'Mirror',
    category: 'distort',
    desc: 'Mencerminkan separuh layar melintasi garis sumbu.',
    defaultParams: { axis: 0, position: 50 },
    paramsConfig: [
      { id: 'axis', label: 'Axis (0:H, 1:V)', min: 0, max: 1, step: 1, unit: '' },
      { id: 'position', label: 'Position', min: -100, max: 200, step: 0.1, unit: '%' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData32 = new Uint32Array(srcImg.data.buffer);
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const isHorizontal = (p.axis === 'horizontal' || p.axis === 0 || p.axis === '0');
    const pos = (p.position !== undefined ? p.position : 50) / 100;

    if (isHorizontal) {
      const splitX = (pos * w) | 0;
      for (let y = 0; y < h; y++) {
        const rowOffset = y * w;
        for (let x = 0; x < w; x++) {
          const sx = (x < splitX) ? x : Math.max(0, (splitX * 2 - x - 1));
          dData32[rowOffset + x] = sData32[rowOffset + sx];
        }
      }
    } else {
      const splitY = (pos * h) | 0;
      for (let y = 0; y < h; y++) {
        const sy = (y < splitY) ? y : Math.max(0, (splitY * 2 - y - 1));
        const srcOffset = sy * w;
        const rowOffset = y * w;
        for (let x = 0; x < w; x++) {
          dData32[rowOffset + x] = sData32[srcOffset + x];
        }
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'pixelate',
    name: 'Pixelate / Mosaic',
    category: 'distort',
    desc: 'Efek mosaik pixel art retro.',
    defaultParams: { size: 16 },
    paramsConfig: [
      { id: 'size', label: 'Pixel Size', min: 1, max: 500, step: 1, unit: 'px' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData32 = new Uint32Array(srcImg.data.buffer);
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const bSize = Math.max(1, (p.size || 16) | 0);

    for (let by = 0; by < h; by += bSize) {
      const cy = Math.min(h - 1, by + (bSize >> 1));
      const rowStart = cy * w;
      for (let bx = 0; bx < w; bx += bSize) {
        const cx = Math.min(w - 1, bx + (bSize >> 1));
        const centerColor = sData32[rowStart + cx];

        const maxY = Math.min(h, by + bSize);
        const maxX = Math.min(w, bx + bSize);

        for (let y = by; y < maxY; y++) {
          const rowOffset = y * w;
          for (let x = bx; x < maxX; x++) {
            dData32[rowOffset + x] = centerColor;
          }
        }
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'turbulent_displace',
    name: 'Turbulent Displace',
    category: 'distort',
    desc: 'Peredaman acak turbulensi noise untuk asap, api, atau kabut.',
    defaultParams: { amount: 15, size: 40, evolution: 0 },
    paramsConfig: [
      { id: 'evolution', label: 'Evolution', min: -1000, max: 1000, step: 0.01, unit: '°' },
      { id: 'amount', label: 'Amount', min: 0, max: 200, step: 0.1, unit: 'px' },
      { id: 'size', label: 'Noise Size', min: 1, max: 500, step: 1, unit: 'px' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const amount = (p.amount !== undefined ? p.amount : 15);
    const size = Math.max(1, p.size || 40);
    const evoRad = (p.evolution || 0) * (Math.PI / 180);
    const freq = 1 / size;

    for (let y = 0; y < h; y++) {
      const yf1 = y * freq + evoRad;
      const yf2 = y * freq * 1.7 - evoRad;
      const rowOffset = y * w;

      for (let x = 0; x < w; x++) {
        const xf1 = x * freq;
        const xf2 = x * freq * 1.7;

        const n1 = fastSin(xf1 + yf1) + fastCos(xf2 - yf2);
        const n2 = fastCos(xf1 - yf1) + fastSin(xf2 + yf2);

        const sx = x + n1 * (amount * 0.5);
        const sy = y + n2 * (amount * 0.5);

        dData32[rowOffset + x] = sampleFastBilinear(sData, w, h, sx, sy);
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'spherize',
    name: 'Spherize',
    category: 'distort',
    desc: 'Membungkus gambar melengkung ke bola 3D.',
    defaultParams: { radius: 60, strength: 75 },
    paramsConfig: [
      { id: 'strength', label: 'Strength', min: -200, max: 200, step: 1, unit: '%' },
      { id: 'radius', label: 'Radius', min: 1, max: 500, step: 1, unit: '%' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const sData32 = new Uint32Array(sData.buffer);
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const cx = w * 0.5, cy = h * 0.5;
    const rad = ((p.radius !== undefined ? p.radius : 60) / 100) * (Math.min(w, h) * 0.5);
    const radSq = rad * rad;
    const str = (p.strength !== undefined ? p.strength : 75) / 100;
    const zFactor = (1.0 - str * 0.8);
    const radOverPi = rad / Math.PI;

    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      const dySq = dy * dy;
      const rowOffset = y * w;

      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const distSq = dx * dx + dySq;

        if (distSq >= radSq || distSq === 0) {
          dData32[rowOffset + x] = sData32[rowOffset + x];
          continue;
        }

        const dist = Math.sqrt(distSq);
        const z = Math.sqrt(radSq - distSq);
        const r = Math.atan2(dist, z * zFactor);
        const scale = (r * radOverPi) / dist;
        const sx = cx + dx * scale;
        const sy = cy + dy * scale;

        dData32[rowOffset + x] = sampleFastBilinear(sData, w, h, sx, sy);
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'stretch',
    name: 'Stretch',
    category: 'distort',
    desc: 'Meregangkan sumbu koordinat horizontal atau vertikal.',
    defaultParams: { scaleX: 100, scaleY: 100 },
    paramsConfig: [
      { id: 'scaleX', label: 'Stretch X', min: 1, max: 1000, step: 0.1, unit: '%' },
      { id: 'scaleY', label: 'Stretch Y', min: 1, max: 1000, step: 0.1, unit: '%' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const dData32 = new Uint32Array(dstImg.data.buffer);

    const invSx = 1 / Math.max(0.01, (p.scaleX || 100) / 100);
    const invSy = 1 / Math.max(0.01, (p.scaleY || 100) / 100);
    const cx = w * 0.5, cy = h * 0.5;

    for (let y = 0; y < h; y++) {
      const sy = cy + (y - cy) * invSy;
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const sx = cx + (x - cx) * invSx;
        dData32[rowOffset + x] = sampleFastBilinear(sData, w, h, sx, sy);
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });
  reg({
    type: 'rgb_split',
    name: 'RGB Split',
    category: 'distort',
    desc: 'Pemisahan kanal warna chromatic aberration bergaya glitch.',
    defaultParams: { distance: 8, angle: 0 },
    paramsConfig: [
      { id: 'distance', label: 'Distance', min: -100, max: 100, step: 0.1, unit: 'px' },
      { id: 'angle', label: 'Angle', min: -1800, max: 1800, step: 0.5, unit: '°' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const sCtx = srcCanvas.getContext('2d');
    const srcImg = sCtx.getImageData(0, 0, w, h);
    const dstImg = dstCtx.createImageData(w, h);
    const sData = srcImg.data;
    const dData = dstImg.data;

    const dist = (p.distance !== undefined ? p.distance : 8);
    const angRad = (p.angle || 0) * (Math.PI / 180);
    const offX = fastCos(angRad) * dist;
    const offY = fastSin(angRad) * dist;

    const iOffX = offX | 0;
    const iOffY = offY | 0;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const centerI = (rowOffset + x) * 4;

        const rx = Math.max(0, Math.min(w - 1, x + iOffX));
        const ry = Math.max(0, Math.min(h - 1, y + iOffY));
        const ri = (ry * w + rx) * 4;

        const bx = Math.max(0, Math.min(w - 1, x - iOffX));
        const by = Math.max(0, Math.min(h - 1, y - iOffY));
        const bi = (by * w + bx) * 4;

        dData[centerI] = sData[ri];
        dData[centerI + 1] = sData[centerI + 1];
        dData[centerI + 2] = sData[bi + 2];
        dData[centerI + 3] = Math.max(sData[centerI + 3], sData[ri + 3], sData[bi + 3]);
      }
    }
    dstCtx.putImageData(dstImg, 0, 0);
  });

  reg({
    type: 'raster_transform',
    name: 'Transform (Transformasi Efek)',
    category: 'distort',
    desc: 'Skala, posisi, dan rotasi internal raster di dalam rantai efek layer.',
    defaultParams: { scale: 1.0, angle: 0, offsetX: 0, offsetY: 0, alpha: 1.0 },
    paramsConfig: [
      { id: 'scale', label: 'Scale', min: 0.05, max: 10, step: 0.01, unit: '' },
      { id: 'angle', label: 'Angle', min: -360, max: 360, step: 0.5, unit: '°' },
      { id: 'offsetX', label: 'Offset X', min: -1000, max: 1000, step: 1, unit: 'px' },
      { id: 'offsetY', label: 'Offset Y', min: -1000, max: 1000, step: 1, unit: 'px' },
      { id: 'alpha', label: 'Alpha', min: 0, max: 1, step: 0.01, unit: '' }
    ]
  }, function(srcCanvas, dstCtx, p, w, h) {
    const scale = (p.scale !== undefined && p.scale > 0.001) ? p.scale : 1.0;
    const angleRad = ((p.angle || 0) * Math.PI) / 180;
    const offX = p.offsetX !== undefined ? p.offsetX : ((p.offset && p.offset.x !== undefined) ? p.offset.x : 0);
    const offY = p.offsetY !== undefined ? p.offsetY : ((p.offset && p.offset.y !== undefined) ? p.offset.y : 0);
    const alpha = p.alpha !== undefined ? p.alpha : 1.0;

    dstCtx.clearRect(0, 0, w, h);
    dstCtx.save();
    dstCtx.translate(w / 2 + offX, h / 2 + offY);
    if (angleRad !== 0) dstCtx.rotate(angleRad);
    if (scale !== 1.0) dstCtx.scale(scale, scale);
    dstCtx.globalAlpha = Math.max(0, Math.min(1, alpha));
    dstCtx.drawImage(srcCanvas, -w / 2, -h / 2, w, h);
    dstCtx.restore();
  });

})();

