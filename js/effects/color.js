
(function() {
  const reg = (typeof FishEffects !== 'undefined' && FishEffects.registerEffect) 
    ? FishEffects.registerEffect 
    : function(def) {
        if (typeof EFFECTS_CATALOG !== 'undefined') EFFECTS_CATALOG.push(def);
      };
  reg({
    type: 'hue_saturation',
    name: 'Hue / Saturation (Warna & Kejenuhan)',
    icon: 'palette',
    category: 'color',
    desc: 'Ubah nada warna (hue shift), saturasi kejenuhan, dan kecerahan.',
    defaultParams: { hue: 0, saturation: 100, lightness: 100 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const h = params.hue || 0;
    const s = params.saturation !== undefined ? params.saturation : 100;
    const l = params.lightness !== undefined ? params.lightness : 100;

    dstCtx.clearRect(0, 0, width, height);
    dstCtx.save();
    let filter = '';
    if (h !== 0) filter += ` hue-rotate(${h}deg)`;
    if (s !== 100) filter += ` saturate(${s}%)`;
    if (l !== 100) filter += ` brightness(${l}%)`;
    if (filter) dstCtx.filter = filter.trim();
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'brightness_contrast',
    name: 'Brightness & Contrast (Kecerahan & Kontras)',
    icon: 'brightness_6',
    category: 'color',
    desc: 'Atur intensitas pencahayaan dan kontras ketajaman visual warna.',
    defaultParams: { brightness: 100, contrast: 100 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const b = params.brightness !== undefined ? params.brightness : 100;
    const c = params.contrast !== undefined ? params.contrast : 100;

    dstCtx.clearRect(0, 0, width, height);
    dstCtx.save();
    let filter = '';
    if (b !== 100) filter += ` brightness(${b}%)`;
    if (c !== 100) filter += ` contrast(${c}%)`;
    if (filter) dstCtx.filter = filter.trim();
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
  });
  function processExposureGamma(srcCanvas, dstCtx, params, width, height) {
    const exp = params.exposure !== undefined ? params.exposure : 0;
    const gamma = (params.gamma !== undefined && params.gamma > 0.001) ? params.gamma : 1.0;
    const offset = params.offset !== undefined ? params.offset : 0;

    const sCtx = srcCanvas.getContext('2d');
    const imgData = sCtx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const expMult = Math.pow(2.0, exp);
    const invGamma = 1.0 / gamma;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      let r = data[i] / 255.0;
      let g = data[i + 1] / 255.0;
      let b = data[i + 2] / 255.0;

      if (offset !== 0) {
        r += offset;
        g += offset;
        b += offset;
      }
      if (gamma !== 1.0) {
        r = Math.pow(Math.max(0, r), invGamma);
        g = Math.pow(Math.max(0, g), invGamma);
        b = Math.pow(Math.max(0, b), invGamma);
      }
      if (exp !== 0) {
        r *= expMult;
        g *= expMult;
        b *= expMult;
      }

      data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    }
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.putImageData(imgData, 0, 0);
  }

  reg({
    type: 'exposure',
    name: 'Exposure / Gamma (Paparan & Gamma)',
    icon: 'wb_sunny',
    category: 'color',
    desc: 'Kontrol paparan cahaya langsung, kurva gamma, dan offset warna.',
    defaultParams: { exposure: 0, gamma: 1.0, offset: 0 },
    paramsConfig: [
      { id: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.01, unit: '' },
      { id: 'gamma', label: 'Gamma', min: 0.1, max: 4, step: 0.01, unit: '' },
      { id: 'offset', label: 'Offset', min: -1, max: 1, step: 0.01, unit: '' }
    ]
  }, processExposureGamma);

  reg({
    type: 'lift',
    name: 'Exposure / Gamma (Lift)',
    icon: 'wb_sunny',
    category: 'color',
    desc: 'Kontrol paparan cahaya langsung dan kurva gamma.',
    defaultParams: { exposure: 0, gamma: 1.0, offset: 0 },
    paramsConfig: [
      { id: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.01, unit: '' },
      { id: 'gamma', label: 'Gamma', min: 0.1, max: 4, step: 0.01, unit: '' },
      { id: 'offset', label: 'Offset', min: -1, max: 1, step: 0.01, unit: '' }
    ]
  }, processExposureGamma);

  reg({
    type: 'satvib',
    name: 'Saturation / Vibrance (Saturasi & Vibrance)',
    icon: 'palette',
    category: 'color',
    desc: 'Atur saturasi dan vibrance untuk memperkaya warna.',
    defaultParams: { saturation: 0, vib: 1.0 },
    paramsConfig: [
      { id: 'saturation', label: 'Saturation', min: -1, max: 2, step: 0.01, unit: '' },
      { id: 'vib', label: 'Vibrance', min: 1, max: 2, step: 0.01, unit: '' }
    ]
  }, function(srcCanvas, dstCtx, params, width, height) {
    const sat = params.saturation !== undefined ? params.saturation : 0;
    const vib = params.vib !== undefined ? params.vib : 1.0;

    const sCtx = srcCanvas.getContext('2d');
    const imgData = sCtx.getImageData(0, 0, width, height);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const maxVal = Math.max(r, g, b);
      const avg = (r + g + b) / 3;
      const amt = ((Math.abs(maxVal - avg) * 2 / 255) * (vib - 1)) + (sat);

      data[i] = Math.max(0, Math.min(255, Math.round(r + (r - avg) * amt)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g + (g - avg) * amt)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b + (b - avg) * amt)));
    }
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.putImageData(imgData, 0, 0);
  });

  reg({
    type: 'lightglow',
    name: 'Light Glow (Pendaran Cahaya Halus)',
    icon: 'flare',
    category: 'color',
    desc: 'Pendaran cahaya lembut sinematik dengan threshold.',
    defaultParams: { strength: 0.25, threshold: 0.7, intensity: 1.0, color: '#3d4cf5', blend: 0.25, halo: 0.0, alpha: 0.75 },
    paramsConfig: [
      { id: 'strength', label: 'Strength', min: 0, max: 2, step: 0.01, unit: '' },
      { id: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, unit: '' },
      { id: 'intensity', label: 'Intensity', min: 0, max: 5, step: 0.01, unit: '' },
      { id: 'blend', label: 'Blend', min: 0, max: 1, step: 0.01, unit: '' },
      { id: 'alpha', label: 'Alpha', min: 0, max: 1, step: 0.01, unit: '' }
    ]
  }, function(srcCanvas, dstCtx, params, width, height) {
    const strength = params.strength !== undefined ? params.strength : 0.25;
    const intensity = params.intensity !== undefined ? params.intensity : 1.0;
    const col = params.color || '#3d4cf5';
    const alpha = params.alpha !== undefined ? params.alpha : 0.75;
    const rad = Math.max(1, Math.round(strength * 30));

    dstCtx.clearRect(0, 0, width, height);
    dstCtx.save();
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.save();
    dstCtx.filter = `blur(${rad}px)`;
    dstCtx.globalAlpha = Math.min(1.0, alpha * intensity);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
    dstCtx.restore();
  });

  reg({
    type: 'glow',
    name: 'Glow / Aura (Pancaran Cahaya Neon)',
    icon: 'flare',
    category: 'color',
    desc: 'Pancaran aura cahaya neon berpendar di sekeliling layer.',
    defaultParams: { radius: 15, color: '#FAB778', intensity: 100 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const rad = Math.max(1, params.radius || 15);
    const col = params.color || '#FAB778';
    const intensity = (params.intensity !== undefined ? params.intensity : 100) / 100;

    dstCtx.clearRect(0, 0, width, height);
    dstCtx.save();
    dstCtx.filter = `drop-shadow(0 0 ${rad}px ${col})`;
    dstCtx.globalAlpha = Math.min(1.0, intensity);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    if (intensity > 1.0) {
      dstCtx.globalAlpha = intensity - 1.0;
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    }
    dstCtx.restore();
  });
  reg({
    type: 'rgb_split',
    name: 'RGB Split (Pemisahan Kanal RGB / Glitch)',
    icon: 'grain',
    category: 'color',
    desc: 'Pemisahan kanal warna Red-Green-Blue bergaya glitch chromatic aberration.',
    defaultParams: { distance: 8, angle: 0 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const dist = params.distance !== undefined ? params.distance : 8;
    const angRad = ((params.angle || 0) * Math.PI) / 180;
    const dx = Math.cos(angRad) * dist;
    const dy = Math.sin(angRad) * dist;

    dstCtx.clearRect(0, 0, width, height);
    if (dist <= 0) {
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
      return;
    }

    try {
      const tempC = document.createElement('canvas');
      tempC.width = width;
      tempC.height = height;
      const tCtx = tempC.getContext('2d');
      tCtx.drawImage(srcCanvas, 0, 0, width, height);

      const srcImgData = tCtx.getImageData(0, 0, width, height);
      const sData = srcImgData.data;

      const outImgData = dstCtx.createImageData(width, height);
      const oData = outImgData.data;

      const idxOffsetR = (Math.round(dy) * width + Math.round(dx)) * 4;
      const idxOffsetB = (-Math.round(dy) * width - Math.round(dx)) * 4;

      const totalPx = width * height;
      for (let i = 0; i < totalPx; i++) {
        const idx = i * 4;
        const iR = idx + idxOffsetR;
        const iB = idx + idxOffsetB;

        oData[idx] = (iR >= 0 && iR < sData.length) ? sData[iR] : sData[idx];
        oData[idx+1] = sData[idx+1];
        oData[idx+2] = (iB >= 0 && iB < sData.length) ? sData[iB+2] : sData[idx+2];
        oData[idx+3] = Math.max(sData[idx+3], (iR >= 0 && iR < sData.length) ? sData[iR+3] : 0, (iB >= 0 && iB < sData.length) ? sData[iB+3] : 0);
      }
      dstCtx.putImageData(outImgData, 0, 0);
    } catch (_) {
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    }
  });
  reg({
    type: 'grayscale',
    name: 'Grayscale (Hitam Putih)',
    icon: 'tonality',
    category: 'color',
    desc: 'Filter hitam-putih monokrom klasik.',
    defaultParams: { amount: 100 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const a = params.amount !== undefined ? params.amount : 100;
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.save();
    dstCtx.filter = `grayscale(${a}%)`;
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'invert',
    name: 'Invert Color (Warna Negatif)',
    icon: 'invert_colors',
    category: 'color',
    desc: 'Pembalikan warna negatif RGB.',
    defaultParams: { amount: 100 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const a = params.amount !== undefined ? params.amount : 100;
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.save();
    dstCtx.filter = `invert(${a}%)`;
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'sepia',
    name: 'Sepia (Nuansa Retro)',
    icon: 'photo_filter',
    category: 'color',
    desc: 'Filter warna klasik kecokelatan retro vintage.',
    defaultParams: { amount: 80 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const a = params.amount !== undefined ? params.amount : 80;
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.save();
    dstCtx.filter = `sepia(${a}%)`;
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'posterize',
    name: 'Posterize (Kuantisasi Warna)',
    icon: 'burst_mode',
    category: 'color',
    desc: 'Banding warna poster grafis retro dengan tingkatan level warna terbatas.',
    defaultParams: { levels: 4 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const levels = Math.max(2, Math.min(32, params.levels || 4));
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);

    try {
      const imgData = dstCtx.getImageData(0, 0, width, height);
      const data = imgData.data;
      const step = 255 / (levels - 1);

      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.round(Math.round(data[i] / step) * step);
        data[i+1] = Math.round(Math.round(data[i+1] / step) * step);
        data[i+2] = Math.round(Math.round(data[i+2] / step) * step);
      }
      dstCtx.putImageData(imgData, 0, 0);
    } catch (_) {}
  });
  reg({
    type: 'threshold',
    name: 'Threshold (Ambang Batas B&W)',
    icon: 'contrast',
    category: 'color',
    desc: 'Ubah gambar menjadi hitam & putih mutlak berdasarkan nilai kecerahan.',
    defaultParams: { threshold: 50 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const th = ((params.threshold !== undefined ? params.threshold : 50) / 100) * 255;
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);

    try {
      const imgData = dstCtx.getImageData(0, 0, width, height);
      const data = imgData.data;

      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        const val = lum >= th ? 255 : 0;
        data[i] = val;
        data[i+1] = val;
        data[i+2] = val;
      }
      dstCtx.putImageData(imgData, 0, 0);
    } catch (_) {}
  });

})();

