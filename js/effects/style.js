
(function() {
  const reg = (typeof FishEffects !== 'undefined' && FishEffects.registerEffect) 
    ? FishEffects.registerEffect 
    : function(def) {
        if (typeof EFFECTS_CATALOG !== 'undefined') EFFECTS_CATALOG.push(def);
      };
  reg({
    type: 'copy_background',
    name: 'Copy Background (Adjustment Layer)',
    icon: 'content_copy',
    category: 'style',
    desc: 'Menyalin komposisi seluruh layer di bawahnya untuk dijadikan Adjustment Layer.',
    defaultParams: { opacity: 100 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const alpha = params.opacity !== undefined ? Math.max(0, Math.min(1, params.opacity / 100)) : 1;
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.save();
    dstCtx.globalAlpha = alpha;
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'vignette',
    name: 'Vignette (Penggelapan Tepi Sinematik)',
    icon: 'vignette',
    category: 'style',
    desc: 'Penggelapan halus pada tepi sudut gambar untuk fokus sinematik.',
    defaultParams: { radius: 50, feather: 50, color: '#000000' }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const radPercent = (params.radius !== undefined ? params.radius : 50) / 100;
    const feather = (params.feather !== undefined ? params.feather : 50) / 100;
    const col = params.color || '#000000';

    dstCtx.clearRect(0, 0, width, height);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.hypot(cx, cy);
    const innerR = Math.max(0, maxR * radPercent * (1.0 - feather * 0.8));
    const outerR = Math.max(innerR + 1, maxR * Math.max(radPercent, 0.4));

    const g = dstCtx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, col);

    dstCtx.save();
    dstCtx.fillStyle = g;
    dstCtx.fillRect(0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'pixelate',
    name: 'Pixelate (Mosaik Piksel)',
    icon: 'apps',
    category: 'style',
    desc: 'Efek sensor mozaik piksel 8-bit bergaya retro.',
    defaultParams: { size: 16 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const sz = Math.max(2, Math.min(128, Math.round(params.size || 16)));
    dstCtx.clearRect(0, 0, width, height);

    const smallW = Math.max(1, Math.round(width / sz));
    const smallH = Math.max(1, Math.round(height / sz));

    const tempC = document.createElement('canvas');
    tempC.width = smallW;
    tempC.height = smallH;
    const tCtx = tempC.getContext('2d');
    tCtx.drawImage(srcCanvas, 0, 0, smallW, smallH);

    dstCtx.save();
    dstCtx.imageSmoothingEnabled = false;
    dstCtx.drawImage(tempC, 0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'checker',
    name: 'Checkerboard (Papan Catur)',
    icon: 'grid_view',
    category: 'style',
    desc: 'Pola kotak-kotak papan catur prosedural.',
    defaultParams: { size: 32, color1: '#000000', color2: '#FFFFFF', opacity: 50 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const sz = Math.max(4, Math.min(256, Math.round(params.size || 32)));
    const col1 = params.color1 || '#000000';
    const col2 = params.color2 || '#FFFFFF';
    const alpha = (params.opacity !== undefined ? params.opacity : 50) / 100;

    dstCtx.clearRect(0, 0, width, height);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);

    dstCtx.save();
    dstCtx.globalAlpha = alpha;
    for (let y = 0; y < height; y += sz) {
      for (let x = 0; x < width; x += sz) {
        const isEven = ((x / sz) + (y / sz)) % 2 === 0;
        dstCtx.fillStyle = isEven ? col1 : col2;
        dstCtx.fillRect(x, y, sz, sz);
      }
    }
    dstCtx.restore();
  });
  reg({
    type: 'stripes',
    name: 'Stripes (Garis-Garis Prosedural)',
    icon: 'view_week',
    category: 'style',
    desc: 'Pola garis-garis berulang dengan sudut dan lebar terukur.',
    defaultParams: { count: 20, width: 50, angle: 45, color: '#000000', opacity: 50 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const count = Math.max(2, Math.min(100, Math.round(params.count || 20)));
    const col = params.color || '#000000';
    const alpha = (params.opacity !== undefined ? params.opacity : 50) / 100;
    const angRad = ((params.angle || 45) * Math.PI) / 180;
    const stripeW = width / count;

    dstCtx.clearRect(0, 0, width, height);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);

    dstCtx.save();
    dstCtx.globalAlpha = alpha;
    dstCtx.translate(width / 2, height / 2);
    dstCtx.rotate(angRad);
    dstCtx.translate(-width, -height);

    dstCtx.fillStyle = col;
    const totalSpan = Math.max(width, height) * 3;
    for (let x = 0; x < totalSpan; x += stripeW * 2) {
      dstCtx.fillRect(x, 0, stripeW, totalSpan);
    }
    dstCtx.restore();
  });
  reg({
    type: 'noise',
    name: 'Noise / Film Grain (Bintik Film)',
    icon: 'grain',
    category: 'style',
    desc: 'Efek tekstur bintik noise film grain sinematik.',
    defaultParams: { amount: 25, animated: true }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const amt = (params.amount !== undefined ? params.amount : 25) / 100;
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);

    if (amt <= 0) return;

    try {
      const imgData = dstCtx.getImageData(0, 0, width, height);
      const data = imgData.data;
      const seed = Math.random() * 100;

      for (let i = 0; i < data.length; i += 4) {
        const n = (Math.random() - 0.5) * amt * 255;
        data[i] = Math.min(255, Math.max(0, data[i] + n));
        data[i+1] = Math.min(255, Math.max(0, data[i+1] + n));
        data[i+2] = Math.min(255, Math.max(0, data[i+2] + n));
      }
      dstCtx.putImageData(imgData, 0, 0);
    } catch (_) {}
  });
  reg({
    type: 'flicker',
    name: 'Flicker / Strobe (Kedipan Cepat)',
    icon: 'flash_on',
    category: 'style',
    desc: 'Kedipan kilatan cahaya cepat bergaya jedag-jedug AM.',
    defaultParams: { frequency: 15, strength: 50 }
  }, function(srcCanvas, dstCtx, params, width, height) {
    const freq = params.frequency || 15;
    const str = (params.strength !== undefined ? params.strength : 50) / 100;
    const t = (typeof elapsed !== 'undefined' ? elapsed : 0);
    const wave = (Math.sin(t * freq * Math.PI * 2) + 1.0) * 0.5;

    dstCtx.clearRect(0, 0, width, height);
    dstCtx.save();
    dstCtx.filter = `brightness(${Math.round((1.0 + wave * str) * 100)}%)`;
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);
    dstCtx.restore();
  });
  reg({
    type: 'wipe',
    name: 'Wipe (Transisi Tirai)',
    icon: 'swipe',
    category: 'style',
    desc: 'Transisi tirai linier dengan kelembutan bulu (feather).',
    defaultParams: { start: 0.0, end: 1.0, angle: 0, feather: 0 },
    paramsConfig: [
      { id: 'start', label: 'Start', min: -0.5, max: 1.5, step: 0.001, unit: '' },
      { id: 'end', label: 'End', min: -0.5, max: 1.5, step: 0.001, unit: '' },
      { id: 'angle', label: 'Angle', min: -360, max: 360, step: 0.5, unit: '°' },
      { id: 'feather', label: 'Feather', min: 0, max: 100, step: 0.1, unit: '' }
    ]
  }, function(srcCanvas, dstCtx, params, width, height) {
    let start = (params.start !== undefined) ? params.start : (params.from !== undefined ? params.from / 100 : 0.0);
    let end = (params.end !== undefined) ? params.end : (params.to !== undefined ? params.to / 100 : 1.0);
    if (start > 1.0 && end > 1.0) {
      start = start / 100.0;
      end = end / 100.0;
    }
    const angle = params.angle || 0;
    const feather = (params.feather || 0) / 100.0;

    const rad = (angle * Math.PI) / 180.0;
    const vx = Math.cos(rad);
    const vy = -Math.sin(rad);

    const sCtx = srcCanvas.getContext('2d');
    const imgData = sCtx.getImageData(0, 0, width, height);
    const data = imgData.data;

    if (feather <= 0.0001) {
      for (let y = 0; y < height; y++) {
        const vNorm = (y / height) - 0.5;
        const rowOffset = y * width;
        const pBase = vNorm * vy + 0.5;
        for (let x = 0; x < width; x++) {
          const uNorm = (x / width) - 0.5;
          const p = uNorm * vx + pBase;
          if (p < start || p > end) {
            data[(rowOffset + x) * 4 + 3] = 0;
          }
        }
      }
    } else {
      const invFeather = 1.0 / feather;
      for (let y = 0; y < height; y++) {
        const vNorm = (y / height) - 0.5;
        const rowOffset = y * width;
        const pBase = vNorm * vy + 0.5;
        for (let x = 0; x < width; x++) {
          const uNorm = (x / width) - 0.5;
          const p = uNorm * vx + pBase;

          let p0 = 1.0;
          if (p < start) {
            const e0 = start - feather;
            p0 = p <= e0 ? 0.0 : ((p - e0) * invFeather);
            p0 = p0 * p0 * (3 - 2 * p0);
          }

          let p1 = 1.0;
          if (p > end) {
            const e1 = end + feather;
            p1 = p >= e1 ? 0.0 : (1.0 - (p - end) * invFeather);
            p1 = p1 * p1 * (3 - 2 * p1);
          }

          const alphaFactor = p0 * p1;
          const idx = (rowOffset + x) * 4;
          if (alphaFactor <= 0) {
            data[idx + 3] = 0;
          } else if (alphaFactor < 1.0) {
            data[idx + 3] = (data[idx + 3] * alphaFactor) | 0;
          }
        }
      }
    }
    dstCtx.clearRect(0, 0, width, height);
    dstCtx.putImageData(imgData, 0, 0);
  });

  reg({
    type: 'gradient_overlay',
    name: 'Gradient Overlay (Hamparan Gradien)',
    icon: 'gradient',
    category: 'style',
    desc: 'Hamparan gradasi warna linear atau radial dengan blending.',
    defaultParams: { color1: '#ffffff', color2: '#000000', angle: 0, scale: 1.0, alpha: 1.0 },
    paramsConfig: [
      { id: 'angle', label: 'Angle', min: -360, max: 360, step: 1, unit: '°' },
      { id: 'scale', label: 'Scale', min: 0.1, max: 5, step: 0.01, unit: '' },
      { id: 'alpha', label: 'Alpha', min: 0, max: 1, step: 0.01, unit: '' }
    ]
  }, function(srcCanvas, dstCtx, params, width, height) {
    const angRad = ((params.angle || 0) * Math.PI) / 180;
    const col1 = params.color1 || '#ffffff';
    const col2 = params.color2 || '#000000';
    const alpha = params.alpha !== undefined ? params.alpha : 1.0;

    dstCtx.clearRect(0, 0, width, height);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height);

    dstCtx.save();
    dstCtx.globalCompositeOperation = 'source-atop';
    dstCtx.globalAlpha = Math.max(0, Math.min(1, alpha));

    const cx = width / 2;
    const cy = height / 2;
    const len = Math.hypot(cx, cy) * (params.scale || 1.0);
    const x1 = cx - Math.cos(angRad) * len;
    const y1 = cy - Math.sin(angRad) * len;
    const x2 = cx + Math.cos(angRad) * len;
    const y2 = cy + Math.sin(angRad) * len;

    const g = dstCtx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, col1);
    g.addColorStop(1, col2);

    dstCtx.fillStyle = g;
    dstCtx.fillRect(0, 0, width, height);
    dstCtx.restore();
  });

})();

