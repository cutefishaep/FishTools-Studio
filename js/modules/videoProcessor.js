function parseMp4InfoFromBuffer(buffer) {
  try {
    const view = new DataView(buffer);
    function findBox(start, end, targetType) {
      let p = start;
      while (p + 8 <= end) {
        const size = view.getUint32(p);
        const type = String.fromCharCode(view.getUint8(p+4), view.getUint8(p+5), view.getUint8(p+6), view.getUint8(p+7));
        const boxSize = (size === 1) ? Number(view.getBigUint64(p + 8)) : (size === 0 ? end - p : size);
        if (type === targetType) return { pos: p, size: boxSize };
        if (boxSize <= 0) break;
        p += boxSize;
      }
      return null;
    }

    const moov = findBox(0, buffer.byteLength, 'moov');
    if (!moov) return null;

    let p = moov.pos + 8;
    const moovEnd = moov.pos + moov.size;
    let detectedFps = null;
    let detectedSampleCount = 0;
    let detectedRotation = 0;

    while (p < moovEnd) {
      const trak = findBox(p, moovEnd, 'trak');
      if (!trak) break;
      const trakEnd = trak.pos + trak.size;
      const tkhd = findBox(trak.pos + 8, trakEnd, 'tkhd');
      if (tkhd) {
        const version = view.getUint8(tkhd.pos + 8);
        const matrixOffset = (version === 1) ? (tkhd.pos + 8 + 32 + 16) : (tkhd.pos + 8 + 20 + 16);
        if (matrixOffset + 36 <= trakEnd) {
          const a = view.getInt32(matrixOffset) / 65536;
          const b = view.getInt32(matrixOffset + 4) / 65536;
          const c = view.getInt32(matrixOffset + 12) / 65536;
          const d = view.getInt32(matrixOffset + 16) / 65536;

          if (Math.round(a) === -1 && Math.round(d) === -1) detectedRotation = 180;
          else if (Math.round(a) === 0 && Math.round(b) === 1 && Math.round(c) === -1 && Math.round(d) === 0) detectedRotation = 90;
          else if (Math.round(a) === 0 && Math.round(b) === -1 && Math.round(c) === 1 && Math.round(d) === 0) detectedRotation = 270;
        }
      }

      const mdia = findBox(trak.pos + 8, trakEnd, 'mdia');
      let timescale = 0;
      let sampleCount = 0;
      let sampleDelta = 0;
      if (mdia) {
        const mdiaEnd = mdia.pos + mdia.size;
        const mdhd = findBox(mdia.pos + 8, mdiaEnd, 'mdhd');
        if (mdhd) {
          const version = view.getUint8(mdhd.pos + 8);
          timescale = version === 1 ? view.getUint32(mdhd.pos + 8 + 20) : view.getUint32(mdhd.pos + 8 + 12);
        }
        const minf = findBox(mdia.pos + 8, mdiaEnd, 'minf');
        if (minf) {
          const minfEnd = minf.pos + minf.size;
          const stbl = findBox(minf.pos + 8, minfEnd, 'stbl');
          if (stbl) {
            const stblEnd = stbl.pos + stbl.size;
            const stts = findBox(stbl.pos + 8, stblEnd, 'stts');
            if (stts) {
              const entryCount = view.getUint32(stts.pos + 12);
              if (entryCount > 0) {
                sampleCount = view.getUint32(stts.pos + 16);
                sampleDelta = view.getUint32(stts.pos + 20);
              }
            }
          }
        }
      }
      if (timescale && sampleDelta) {
        const rawFps = timescale / sampleDelta;
        if (rawFps >= 1 && rawFps <= 240) {
          detectedFps = Math.round(rawFps * 100) / 100;
          detectedSampleCount = sampleCount;
        }
      }
      p = trak.pos + trak.size;
    }

    return {
      fps: detectedFps,
      sampleCount: detectedSampleCount,
      rotation: detectedRotation
    };
  } catch (_) {}
  return null;
}

async function convertVideoToFrameSequence(file, onProgress) {
  return new Promise(async (resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let isDone = false;
    let nativeFps = null;
    let detectedSampleCount = 0;
    let detectedRotation = 0;
    try {
      const headerSlice = await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).arrayBuffer();
      const info = parseMp4InfoFromBuffer(headerSlice);
      if (info) {
        if (info.fps) nativeFps = info.fps;
        if (info.sampleCount) detectedSampleCount = info.sampleCount;
        if (info.rotation) detectedRotation = info.rotation;
      }
    } catch (_) {}

    const startExtraction = async () => {
      if (isDone) return;
      isDone = true;
      const duration = (video.duration && isFinite(video.duration) && video.duration > 0) ? video.duration : 5;
      const targetFps = nativeFps || (typeof projectFps !== 'undefined' && Number(projectFps) > 0 ? Number(projectFps) : 30);
      const totalFrames = detectedSampleCount > 0 ? detectedSampleCount : Math.max(1, Math.round(duration * targetFps));
      const exactDuration = totalFrames / targetFps;
      const stepSec = 1 / targetFps;

      const rawW = video.videoWidth || 1920;
      const rawH = video.videoHeight || 1080;

      let drawW = rawW;
      let drawH = rawH;
      if (detectedRotation === 90 || detectedRotation === 270) {
        drawW = rawH;
        drawH = rawW;
      }
      const aspect = (drawW && drawH) ? (drawW / drawH) : 1.7778;

      const canvas = document.createElement('canvas');
      canvas.width = drawW;
      canvas.height = drawH;
      const ctx = canvas.getContext('2d');

      function renderVideoFrameToCanvas() {
        ctx.clearRect(0, 0, drawW, drawH);
        if (detectedRotation !== 0) {
          ctx.save();
          ctx.translate(drawW / 2, drawH / 2);
          ctx.rotate((detectedRotation * Math.PI) / 180);
          ctx.drawImage(video, -rawW / 2, -rawH / 2, rawW, rawH);
          ctx.restore();
        } else {
          ctx.drawImage(video, 0, 0, drawW, drawH);
        }
      }

      const bitmaps = [];
      const frameBlobs = [];
      let lastValidBmp = null;
      let lastValidBlob = null;

      const seekTo = (t) => new Promise((seekDone) => {
        const clampedTime = Math.max(0, Math.min(Math.max(0, duration - 0.005), t));
        if (Math.abs(video.currentTime - clampedTime) < 0.001 && video.readyState >= 2) {
          return seekDone();
        }

        let finished = false;
        let timer = null;

        const complete = () => {
          if (finished) return;
          finished = true;
          if (timer) clearTimeout(timer);
          video.removeEventListener('seeked', complete);
          seekDone();
        };

        timer = setTimeout(complete, 250);
        video.addEventListener('seeked', complete, { once: true });

        try {
          video.currentTime = clampedTime;
        } catch(_) {
          complete();
        }
      });

      for (let i = 0; i < totalFrames; i++) {
        const time = i * stepSec;
        await seekTo(time);

        renderVideoFrameToCanvas();

        let bmp = null;
        let fBlob = null;
        try {
          fBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
        } catch(_) {}
        if (fBlob && typeof createImageBitmap === 'function') {
          try {
            bmp = await createImageBitmap(fBlob);
          } catch(_) {}
        } else if (typeof createImageBitmap === 'function') {
          try {
            bmp = await createImageBitmap(canvas);
          } catch(_) {}
        }

        if (!bmp || bmp.width === 0 || bmp.height === 0) {
          try {
            const fCanvas = document.createElement('canvas');
            fCanvas.width = drawW;
            fCanvas.height = drawH;
            fCanvas.getContext('2d').drawImage(canvas, 0, 0);
            bmp = fCanvas;
          } catch(_) {}
        }
        if (!bmp || bmp.width === 0) {
          bmp = lastValidBmp || bmp;
          fBlob = lastValidBlob || fBlob;
        } else {
          lastValidBmp = bmp;
          lastValidBlob = fBlob;
        }

        bitmaps.push(bmp);
        if (fBlob) frameBlobs.push(fBlob);
        if (typeof THREE !== 'undefined' && typeof renderer3D !== 'undefined' && renderer3D && bmp) {
          if (!window._dummyVideoPrewarmTex) {
             window._dummyVideoPrewarmTex = new THREE.Texture(document.createElement('canvas'));
             window._dummyVideoPrewarmTex.generateMipmaps = false;
             const mat = new THREE.MeshBasicMaterial({ map: window._dummyVideoPrewarmTex });
             window._dummyVideoPrewarmMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
             window._dummyVideoPrewarmScene = new THREE.Scene();
             window._dummyVideoPrewarmScene.add(window._dummyVideoPrewarmMesh);
             window._dummyVideoPrewarmCamera = new THREE.PerspectiveCamera();
          }
          window._dummyVideoPrewarmTex.image = bmp;
          window._dummyVideoPrewarmTex.needsUpdate = true;
          if (typeof renderer3D.initTexture === 'function') {
            renderer3D.initTexture(window._dummyVideoPrewarmTex);
          } else {
            renderer3D.render(window._dummyVideoPrewarmScene, window._dummyVideoPrewarmCamera);
          }
          
          await new Promise(r => requestAnimationFrame(r));
        }

        const pct = Math.round(((i + 1) / totalFrames) * 100);
        if (onProgress && (i % 2 === 0 || i === totalFrames - 1)) {
          onProgress(pct, i + 1, totalFrames);
        }
      }

      ctx.drawImage(video, 0, 0, drawW, drawH);
      const thumbDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      resolve({
        id: file.name,
        name: file.name,
        manifest: {
          fps: targetFps,
          width: drawW,
          height: drawH,
          duration: exactDuration,
          totalFrames: totalFrames,
          aspectRatio: aspect,
          sound: file.name.replace(/\.[^/.]+$/, '') + '.mp3',
          createdAt: Date.now()
        },
        fps: targetFps,
        duration: exactDuration,
        aspectRatio: aspect,
        frames: bitmaps,
        frameBlobs: frameBlobs,
        width: drawW,
        height: drawH,
        totalFrames: totalFrames,
        thumbnailUrl: thumbDataUrl,
        audioBlob: file,
        audioUrl: objectUrl,
        isReady: true
      });
    };

    if (video.readyState >= 1 && video.duration) {
      startExtraction();
    } else {
      video.onloadedmetadata = startExtraction;
      video.onloadeddata = startExtraction;
      video.onerror = (err) => {
        if (!isDone) {
          isDone = true;
          reject(err);
        }
      };
      video.load();
    }
  });
}

