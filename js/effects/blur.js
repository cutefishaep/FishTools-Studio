
(function() {
  const reg = (typeof FishEffects !== 'undefined' && FishEffects.registerEffect) 
    ? FishEffects.registerEffect 
    : function(def) {
        if (typeof EFFECTS_CATALOG !== 'undefined') EFFECTS_CATALOG.push(def);
      };
  reg({
    type: 'gaussian_blur',
    name: 'Gaussian Blur (Buram Gaussian)',
    icon: 'blur_on',
    category: 'blur',
    desc: 'Efek blur merata ke segala arah dengan transisi halus sinematik.',
    defaultParams: { strength: 12 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const s = Math.max(0, Math.min(80, params.strength !== undefined ? params.strength : 12));
    dstCtx.clearRect(0, 0, width, height);
    if (s <= 0) {
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
      return;
    }
    dstCtx.save();
    dstCtx.filter = `blur(${s}px)`;
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'box_blur',
    name: 'Box Blur (Buram Kotak)',
    icon: 'blur_linear',
    category: 'blur',
    desc: 'Blur kotak berkecepatan tinggi dengan radius terukur.',
    defaultParams: { size: 10 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const sz = Math.max(0, Math.min(60, params.size !== undefined ? params.size : 10));
    dstCtx.clearRect(0, 0, width, height);
    if (sz <= 0) {
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
      return;
    }
    dstCtx.save();
    dstCtx.filter = `blur(${Math.round(sz * 0.8)}px)`;
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'directional_blur',
    name: 'Directional Blur (Buram Arah)',
    icon: 'navigation',
    category: 'blur',
    desc: 'Blur searah garis sudut kemiringan tertentu (motion streak).',
    defaultParams: { strength: 15, angle: 0 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const strength = Math.max(0, Math.min(100, params.strength !== undefined ? params.strength : 15));
    const angleRad = ((params.angle || 0) * Math.PI) / 180;
    dstCtx.clearRect(0, 0, width, height);
    if (strength <= 0) {
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
      return;
    }

    const passes = Math.min(16, Math.max(4, Math.round(strength * 0.4)));
    const stepDist = strength / passes;
    const dx = Math.cos(angleRad) * stepDist;
    const dy = Math.sin(angleRad) * stepDist;

    dstCtx.save();
    dstCtx.globalAlpha = 1.0 / passes;
    for (let i = -passes / 2; i <= passes / 2; i++) {
      dstCtx.drawImage(srcCanvas, i * dx, i * dy, width, height);
    }
    dstCtx.restore();
  });
  reg({
    type: 'zoom_blur',
    name: 'Zoom Blur (Buram Zoom Radial)',
    icon: 'center_focus_strong',
    category: 'blur',
    desc: 'Blur radial memusat dengan efek zoom kecepatan tinggi dari titik tengah.',
    defaultParams: { strength: 15, centerX: 50, centerY: 50 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const strength = Math.max(0, Math.min(80, params.strength !== undefined ? params.strength : 15));
    const cx = ((params.centerX !== undefined ? params.centerX : 50) / 100) * width;
    const cy = ((params.centerY !== undefined ? params.centerY : 50) / 100) * height;

    dstCtx.clearRect(0, 0, width, height);
    if (strength <= 0) {
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
      return;
    }

    const passes = 12;
    const scaleFactor = 1.0 + (strength * 0.008);
    dstCtx.save();
    dstCtx.globalAlpha = 1.0 / passes;
    for (let i = 0; i < passes; i++) {
      const s = 1.0 + (i / passes) * (scaleFactor - 1.0);
      dstCtx.save();
      dstCtx.translate(cx, cy);
      dstCtx.scale(s, s);
      dstCtx.translate(-cx, -cy);
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
      dstCtx.restore();
    }
    dstCtx.restore();
  });
  reg({
    type: 'spin_blur',
    name: 'Spin Blur (Buram Putar)',
    icon: 'sync',
    category: 'blur',
    desc: 'Blur radial memutar mengelilingi titik pusat.',
    defaultParams: { angle: 10, centerX: 50, centerY: 50 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const angle = Math.max(0, Math.min(45, params.angle !== undefined ? params.angle : 10));
    const cx = ((params.centerX !== undefined ? params.centerX : 50) / 100) * width;
    const cy = ((params.centerY !== undefined ? params.centerY : 50) / 100) * height;

    dstCtx.clearRect(0, 0, width, height);
    if (angle <= 0) {
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
      return;
    }

    const passes = 12;
    const angleStepRad = ((angle * Math.PI) / 180) / passes;
    dstCtx.save();
    dstCtx.globalAlpha = 1.0 / passes;
    for (let i = -passes / 2; i <= passes / 2; i++) {
      dstCtx.save();
      dstCtx.translate(cx, cy);
      dstCtx.rotate(i * angleStepRad);
      dstCtx.translate(-cx, -cy);
      dstCtx.drawImage(srcCanvas, 0, 0, width, height);
      dstCtx.restore();
    }
    dstCtx.restore();
  });
  reg({
    type: 'sharpen',
    name: 'Sharpen (Pertajam Detail)',
    icon: 'details',
    category: 'blur',
    desc: 'Tingkatkan ketajaman detail kontras dan kejernihan tekstur tepi layer.',
    defaultParams: { strength: 60 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const strength = (params.strength !== undefined ? params.strength : 60) / 100;
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);

    if (strength <= 0) return;

    try {
      const imgData = dstCtx.getImageData(0, 0, width, height);
      const data = imgData.data;
      const srcData = new Uint8ClampedArray(data);

      const kCenter = 1.0 + (4 * strength);
      const kEdge = -strength;

      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        for (let x = 1; x < width - 1; x++) {
          const idx = (row + x) * 4;
          const up = idx - (width * 4);
          const down = idx + (width * 4);
          const left = idx - 4;
          const right = idx + 4;

          data[idx] = Math.min(255, Math.max(0, (srcData[idx] * kCenter) + (srcData[up] + srcData[down] + srcData[left] + srcData[right]) * kEdge));
          data[idx+1] = Math.min(255, Math.max(0, (srcData[idx+1] * kCenter) + (srcData[up+1] + srcData[down+1] + srcData[left+1] + srcData[right+1]) * kEdge));
          data[idx+2] = Math.min(255, Math.max(0, (srcData[idx+2] * kCenter) + (srcData[up+2] + srcData[down+2] + srcData[left+2] + srcData[right+2]) * kEdge));
        }
      }
      dstCtx.putImageData(imgData, 0, 0);
    } catch (_) {}
  });

  reg({
    type: 'unsharpmask',
    name: 'Unsharp Mask (Penajam Masking)',
    icon: 'center_focus_strong',
    category: 'blur',
    desc: 'Penajaman presisi tinggi dengan ambang batas kontras dan kekuatan masker.',
    defaultParams: { strength: 0.2, amount: 0.5, threshold: 0.2 },
    paramsConfig: [
      { id: 'strength', label: 'Strength', min: 0, max: 2, step: 0.01, unit: '' },
      { id: 'amount', label: 'Amount', min: 0, max: 2, step: 0.01, unit: '' },
      { id: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, unit: '' }
    ]
  }, function(srcCanvas, dstCtx, params, width, height) {
    const amount = params.amount !== undefined ? params.amount : 0.5;
    const strength = params.strength !== undefined ? params.strength : 0.2;
    const thresh = (params.threshold !== undefined ? params.threshold : 0.2) * 255;

    const blurRad = Math.max(1, Math.round(strength * 10));

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.filter = `blur(${blurRad}px)`;
    tCtx.drawImage(srcCanvas, 0, 0, width, height);

    const sCtx = srcCanvas.getContext('2d');
    const srcData = sCtx.getImageData(0, 0, width, height);
    const blurData = tCtx.getImageData(0, 0, width, height);
    const s = srcData.data;
    const b = blurData.data;

    for (let i = 0; i < s.length; i += 4) {
      if (s[i + 3] === 0) continue;
      const lumS = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
      const lumB = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      const diff = Math.abs(lumS - lumB);

      if (diff >= thresh) {
        s[i] = Math.max(0, Math.min(255, Math.round(s[i] * (1 + amount) - b[i] * amount)));
        s[i + 1] = Math.max(0, Math.min(255, Math.round(s[i + 1] * (1 + amount) - b[i + 1] * amount)));
        s[i + 2] = Math.max(0, Math.min(255, Math.round(s[i + 2] * (1 + amount) - b[i + 2] * amount)));
      }
    }
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.putImageData(srcData, 0, 0);
  });

})();

