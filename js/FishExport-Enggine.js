/**
 * FishExport-Enggine.js
 * FishTools Studio — Offline Frame-by-Frame Video Export Engine
 *
 * Architecture: True deterministic render loop. Time t = i/fps (never wall-clock).
 * No dropped frames regardless of render speed. Each frame gets exact timestamp.
 *
 * Priority chain:
 *   1. WebCodecs + Mp4Muxer   → .mp4 (H.264 on Chrome/Edge/Safari, VP9 on Firefox)
 *   2. FFmpeg.wasm frame seq  → .mp4 (universal CPU fallback)
 *
 * Public API:
 *   window.FishExportEngine.export(options) → Promise<void>
 *   options: { preset, customName, onProgress }
 */

(function () {
  'use strict';

  // ── Resolution Map (mirrors editor.js resMap) ─────────────────────────────────
  const RES_MAP = {
    '4K':   { '16:9': [3840, 2160], '9:16': [2160, 3840], '1:1': [3840, 3840], '4:3': [2880, 2160], '3:4': [2160, 2880], '21:9': [5120, 2160] },
    '2K':   { '16:9': [2560, 1440], '9:16': [1440, 2560], '1:1': [2560, 2560], '4:3': [1920, 1440], '3:4': [1440, 1920], '21:9': [3440, 1440] },
    '1080p':{ '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440], '21:9': [2560, 1080] },
    '720p': { '16:9': [1280, 720],  '9:16': [720, 1280],  '1:1': [720, 720],   '4:3': [960, 720],   '3:4': [720, 960],   '21:9': [1720, 720]  },
    '480p': { '16:9': [854, 480],   '9:16': [480, 854],   '1:1': [480, 480],   '4:3': [640, 480],   '3:4': [480, 640],   '21:9': [1148, 480]  },
    '360p': { '16:9': [640, 360],   '9:16': [360, 640],   '1:1': [360, 360],   '4:3': [480, 360],   '3:4': [360, 480],   '21:9': [864, 360]   }
  };

  // ── State ──────────────────────────────────────────────────────────────────────
  let isCancelled = false;
  let ffmpegInstance = null;

  // ── High-Visibility Full Logger ───────────────────────────────────────────────
  function logExport(stage, msg, data) {
    var ts = (performance.now() / 1000).toFixed(2) + 's';
    var prefix = '%c[FishExport:' + stage + ' @ ' + ts + '] ' + msg;
    if (data !== undefined) {
      console.log(prefix, 'color:#22c55e;font-weight:bold;', data);
    } else {
      console.log(prefix, 'color:#22c55e;font-weight:bold;');
    }
  }

  function logExportInfo(stage, msg, data) {
    var ts = (performance.now() / 1000).toFixed(2) + 's';
    var prefix = '%c[FishExport:' + stage + ' @ ' + ts + '] ' + msg;
    if (data !== undefined) {
      console.info(prefix, 'color:#38bdf8;font-weight:bold;', data);
    } else {
      console.info(prefix, 'color:#38bdf8;font-weight:bold;');
    }
  }

  function logExportWarn(stage, msg, data) {
    var ts = (performance.now() / 1000).toFixed(2) + 's';
    var prefix = '%c[FishExport:' + stage + ' @ ' + ts + '] ⚠️ ' + msg;
    if (data !== undefined) {
      console.warn(prefix, 'color:#f59e0b;font-weight:bold;', data);
    } else {
      console.warn(prefix, 'color:#f59e0b;font-weight:bold;');
    }
  }

  function logExportError(stage, msg, data) {
    var ts = (performance.now() / 1000).toFixed(2) + 's';
    var prefix = '%c[FishExport:' + stage + ' @ ' + ts + '] ❌ ' + msg;
    if (data !== undefined) {
      console.error(prefix, 'color:#ef4444;font-weight:bold;', data);
    } else {
      console.error(prefix, 'color:#ef4444;font-weight:bold;');
    }
  }

  // ── Progress UI Helpers ────────────────────────────────────────────────────────
  function showProgress(title, pct, stage, engineBadge) {
    window.isExporting = true;
    if (window.PreviewCacheManager && typeof window.PreviewCacheManager.stopIdleWorker === 'function') {
      window.PreviewCacheManager.stopIdleWorker();
    }
    isCancelled = false;
    var overlay = document.getElementById('editor-export-progress-overlay');
    var titleEl = document.getElementById('export-progress-title');
    var badgeEl = document.getElementById('export-engine-badge');
    var fillEl  = document.getElementById('export-progress-fill');
    var pctEl   = document.getElementById('export-progress-percent');
    var stageEl = document.getElementById('export-progress-stage');
    if (titleEl)  titleEl.textContent  = title || 'Exporting video';
    if (badgeEl)  badgeEl.textContent  = (engineBadge || 'GPU').toUpperCase();
    if (fillEl)   fillEl.style.width   = Math.min(100, Math.max(0, pct || 0)) + '%';
    if (pctEl)    pctEl.textContent    = Math.round(pct || 0) + '%';
    if (stageEl)  stageEl.textContent  = stage || '';
    if (overlay)  overlay.style.display = 'flex';
  }

  function updateProgress(pct, stage, onProgress) {
    var clamped = Math.min(100, Math.max(0, pct));
    var fillEl  = document.getElementById('export-progress-fill');
    var pctEl   = document.getElementById('export-progress-percent');
    var stageEl = document.getElementById('export-progress-stage');
    if (fillEl)  fillEl.style.width  = clamped + '%';
    if (pctEl)   pctEl.textContent   = Math.round(clamped) + '%';
    if (stage && stageEl) stageEl.textContent = stage;
    if (typeof onProgress === 'function') onProgress(clamped, stage);
  }

  function hideProgress() {
    window.isExporting = false;
    isCancelled = false;
    var overlay = document.getElementById('editor-export-progress-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function cleanupExportResources() {
    isCancelled = true;
    window.isExporting = false;
    try {
      var allExportCanvases = document.querySelectorAll('canvas[style*="left:-99999px"], canvas.export-temp-canvas');
      allExportCanvases.forEach(function(c) {
        if (c && c.parentNode) c.parentNode.removeChild(c);
      });
    } catch (_) {}
    if (ffmpegInstance && typeof ffmpegInstance.FS === 'function') {
      var tempFiles = ['v_temp.mp4', 'a_temp.wav', 'out_merged.mp4', 'output.mp4', 'audio.wav', 'rec_in.webm', 'rec_out.mp4'];
      tempFiles.forEach(function(f) {
        try { ffmpegInstance.FS('unlink', f); } catch (_) {}
      });
    }
  }

  // Hook cancel button
  document.addEventListener('DOMContentLoaded', function() {
    var btn = document.getElementById('btn-export-cancel');
    if (btn) {
      btn.addEventListener('click', function() {
        if (window.FishExportEngine && typeof window.FishExportEngine.cancel === 'function') {
          window.FishExportEngine.cancel();
        } else if (typeof window._cancelEditorExport === 'function') {
          window._cancelEditorExport();
        }
      });
    }
  });

  // ── Project Dimensions ─────────────────────────────────────────────────────────
  function getProjectDims() {
    var ps  = window.currentProjectState || {};
    var res = ps.resolution || '1080p';
    var ar  = ps.aspectRatio || '16:9';
    var dim = (RES_MAP[res] && RES_MAP[res][ar]) || [1920, 1080];
    var w = dim[0] - (dim[0] % 2);
    var h = dim[1] - (dim[1] % 2);
    return { w: w, h: h };
  }

  // ── FFmpeg Lazy Loader ─────────────────────────────────────────────────────────
  async function getFFmpeg() {
    if (ffmpegInstance && ffmpegInstance.isLoaded()) return ffmpegInstance;
    if (!window.FFmpeg || typeof window.FFmpeg.createFFmpeg !== 'function') {
      await new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = new URL('vendor/ffmpeg/ffmpeg.min.js', document.baseURI || window.location.href).href;
        s.onload = function() {
          if (window.FFmpeg && typeof window.FFmpeg.createFFmpeg === 'function') resolve();
          else reject(new Error('[FishExport] FFmpeg script did not register window.FFmpeg'));
        };
        s.onerror = function() { reject(new Error('[FishExport] Failed to load vendor/ffmpeg/ffmpeg.min.js')); };
        document.head.appendChild(s);
      });
    }
    try { delete window.createFFmpegCore; } catch (_) {}
    var createFFmpeg = window.FFmpeg.createFFmpeg;
    var coreUrl = new URL('vendor/ffmpeg/ffmpeg-core.js', document.baseURI || window.location.href).href;
    ffmpegInstance = createFFmpeg({ mainName: 'main', corePath: coreUrl, log: false });
    await ffmpegInstance.load();
    return ffmpegInstance;
  }

  // ── Video Frame Cache Helpers ──────────────────────────────────────────────────
  async function ensureVideosCached(onProgress) {
    var ps = window.currentProjectState || {};
    var layers = ps.layers || [];
    var videoLayers = layers.filter(function(l) { return l.type === 'video' && !l.hidden; });
    if (videoLayers.length === 0 || !window.VideoFrameExtractor) return true;
    showProgress('Preparing Export...', 0, 'Checking video cache...');
    try {
      var ok = await window.VideoFrameExtractor.ensureLayersCached(
        videoLayers,
        function(pct, msg) { updateProgress(pct, msg, onProgress); },
        function() { return isCancelled; }
      );
      if (!ok || isCancelled) { hideProgress(); return false; }
      return true;
    } catch (_) { return true; }
  }

  async function prepareFrameAtTime(t, videoLayers, pps) {
    if (!videoLayers || videoLayers.length === 0) return;
    var fetches = [];
    for (var i = 0; i < videoLayers.length; i++) {
      var vl = videoLayers[i];
      var start = vl.startSec !== undefined ? vl.startSec : ((vl.startPx || 0) / pps);
      var dur   = vl.durationSec !== undefined ? vl.durationSec : ((vl.widthPx || 400) / pps);
      if (t < start || t >= start + dur) continue;

      var eff   = (typeof getLayerEffectivePropsAtTime === 'function') ? getLayerEffectivePropsAtTime(vl, t) : vl;
      var speed = (eff && eff.speed > 0) ? eff.speed : (vl.speed > 0 ? vl.speed : 1);
      var clip  = Math.max(0, (vl.sourceOffsetSec || 0) + (t - start) * speed);

      var cached = false;
      if (window.VideoFrameExtractor) {
        var sk = window.VideoFrameExtractor._getSourceKey
          ? window.VideoFrameExtractor._getSourceKey(vl)
          : (vl.mediaId || vl.dataUrl || vl.id);
        var src = window.VideoFrameExtractor.getSourceCache && window.VideoFrameExtractor.getSourceCache(sk);
        if (src) {
          var fIdx = Math.round(clip * (src.fps || 60));
          if (src.frames && src.frames.has(fIdx)) { cached = true; }
          else if (src.cachedFrameIndices && src.cachedFrameIndices.has(fIdx)) {
            fetches.push(window.VideoFrameExtractor.fetchFrameFromDBAsync(src, fIdx));
            cached = true;
          }
        }
      }
      if (!cached && window.getOrLoadLayerMedia) {
        var media = window.getOrLoadLayerMedia(vl);
        if (media && media.el && media.el.tagName === 'VIDEO') {
          fetches.push(seekVideoToTime(media.el, clip));
        }
      }
    }
    if (fetches.length) {
      await Promise.race([
        Promise.all(fetches),
        new Promise(function(resolve) { setTimeout(resolve, 300); })
      ]);
    }
  }

  function seekVideoToTime(video, target) {
    if (!video || !isFinite(target) || isNaN(target)) return Promise.resolve();
    var dur = isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
    var t = Math.max(0, Math.min(dur - 0.001, target));
    if (Math.abs(video.currentTime - t) < 0.005) return Promise.resolve();
    return new Promise(function(resolve) {
      var done = false;
      var timer = setTimeout(function() { if (!done) { done = true; resolve(); } }, window.isExporting ? 150 : 1200);
      var finish = function() {
        if (done) return; done = true;
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        video.removeEventListener('error', finish);
        resolve();
      };
      video.addEventListener('seeked', finish, { once: true });
      video.addEventListener('error', finish, { once: true });
      try { video.currentTime = t; } catch (_) { finish(); }
    });
  }

  // ── Standalone Pure PCM 16-Bit WAV Encoder ───────────────────────────────────
  function audioBufferToWav(buffer) {
    if (!buffer) return null;
    var numChannels = buffer.numberOfChannels;
    var sampleRate = buffer.sampleRate;
    var format = 1; // PCM
    var bitDepth = 16;
    var bytesPerSample = bitDepth / 8;
    var blockAlign = numChannels * bytesPerSample;
    var length = buffer.length;
    var dataSize = length * blockAlign;
    var headerSize = 44;
    var totalSize = headerSize + dataSize;
    var arrayBuffer = new ArrayBuffer(totalSize);
    var view = new DataView(arrayBuffer);

    function writeString(offset, string) {
      for (var i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    var channels = [];
    for (var c = 0; c < numChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }

    var offset = 44;
    for (var i = 0; i < length; i++) {
      for (var ch = 0; ch < numChannels; ch++) {
        var sample = channels[ch][i];
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  // ── Flatten Playable Audio Layers (Traverses precomps & groups) ─────────────
  function flattenPlayableAudioLayers(layers, parentOffsetSec, parentSpeed, parentMuted, parentGain, pixelsPerSecond) {
    parentOffsetSec = parentOffsetSec || 0;
    parentSpeed = parentSpeed || 1.0;
    parentGain = parentGain || 1.0;
    pixelsPerSecond = pixelsPerSecond || 80;
    var result = [];
    (layers || []).forEach(function(layer) {
      if (layer.hidden) return;
      var isMuted = parentMuted || !!layer.isMuted || !!layer.muted;
      var layerSpeed = (layer.speed !== undefined && layer.speed > 0 ? layer.speed : 1.0);
      var effectiveSpeed = parentSpeed * layerSpeed;
      var layerVol = (layer.volume !== undefined ? Number(layer.volume) : 1.0);
      var effectiveGain = parentGain * (isFinite(layerVol) ? layerVol : 1.0);
      var lStart = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pixelsPerSecond);
      var lDur = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pixelsPerSecond);

      if (layer.type === 'video' || layer.type === 'audio') {
        if (!isMuted) {
          result.push({
            layer: layer,
            rootStartSec: parentOffsetSec + (lStart / parentSpeed),
            rootDurSec: lDur / parentSpeed,
            sourceOffsetSec: layer.sourceOffsetSec || 0,
            effectiveSpeed: effectiveSpeed,
            effectiveGain: effectiveGain
          });
        }
      } else if (layer.type === 'precomp' && Array.isArray(layer.layers)) {
        var precompRootStart = parentOffsetSec + ((lStart - (layer.sourceOffsetSec || 0)) / parentSpeed);
        var nested = flattenPlayableAudioLayers(layer.layers, precompRootStart, effectiveSpeed, isMuted, effectiveGain, pixelsPerSecond);
        for (var ni = 0; ni < nested.length; ni++) result.push(nested[ni]);
      }
    });
    return result;
  }

  // ── Locate Media Blob for a Layer ──────────────────────────────────────────
  async function getLayerBlob(layer) {
    if (!layer) return null;
    // 1. Try layer.dataUrl
    if (layer.dataUrl && typeof layer.dataUrl === 'string' && !layer.dataUrl.startsWith('data:image')) {
      try {
        var r = await fetch(layer.dataUrl);
        if (r.ok) return await r.blob();
      } catch (_) {}
    }
    // 2. Try window._activeMediaMap or window.importedMediaMap
    var mediaId = layer.mediaId;
    if (mediaId) {
      if (window._activeMediaMap && window._activeMediaMap.has(mediaId)) {
        var mItem = window._activeMediaMap.get(mediaId);
        if (mItem) {
          if (mItem.blob) return mItem.blob;
          if (mItem.buffer) return new Blob([mItem.buffer], { type: mItem.mimeType || 'video/mp4' });
          if (mItem.dataUrl) {
            try {
              var r2 = await fetch(mItem.dataUrl);
              if (r2.ok) return await r2.blob();
            } catch (_) {}
          }
        }
      }
      if (window.importedMediaMap && window.importedMediaMap.has(mediaId)) {
        var impItem = window.importedMediaMap.get(mediaId);
        if (impItem) {
          if (impItem.blob) return impItem.blob;
          if (impItem.buffer) return new Blob([impItem.buffer], { type: impItem.mimeType || 'video/mp4' });
          if (impItem.dataUrl) {
            try {
              var r3 = await fetch(impItem.dataUrl);
              if (r3.ok) return await r3.blob();
            } catch (_) {}
          }
        }
      }
      if (window.FishDatabase && typeof window.FishDatabase.getMedia === 'function') {
        try {
          var dbItem = await window.FishDatabase.getMedia(mediaId);
          if (dbItem) {
            if (dbItem.blob) return dbItem.blob;
            if (dbItem.buffer) return new Blob([dbItem.buffer], { type: dbItem.mimeType || 'video/mp4' });
            if (dbItem.dataUrl) {
              var r4 = await fetch(dbItem.dataUrl);
              if (r4.ok) return await r4.blob();
            }
          }
        } catch (_) {}
      }
    }
    // 3. Try DOM media element in layerMediaCache
    if (window.getOrLoadLayerMedia) {
      try {
        var med = window.getOrLoadLayerMedia(layer);
        if (med && med.el && med.el.src) {
          var r5 = await fetch(med.el.src);
          if (r5.ok) return await r5.blob();
        }
      } catch (_) {}
    }
    return null;
  }

  // ── HTML5 Media Element Fast Audio Capture Fallback (Safari WebKit) ─────────
  function captureAudioFromMediaElement(blob) {
    return new Promise(function(resolve) {
      if (!blob) return resolve(null);
      var blobUrl = URL.createObjectURL(blob);
      var video = document.createElement('video');
      video.src = blobUrl;
      video.muted = false;
      video.crossOrigin = 'anonymous';
      video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0.001;pointer-events:none;';
      document.body.appendChild(video);

      var cleanup = function() {
        try { video.pause(); } catch (_) {}
        try { if (video.parentNode) video.parentNode.removeChild(video); } catch (_) {}
        try { URL.revokeObjectURL(blobUrl); } catch (_) {}
      };

      var timer = setTimeout(function() { cleanup(); resolve(null); }, 12000);

      video.onloadedmetadata = async function() {
        try {
          var AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx || typeof MediaRecorder === 'undefined') {
            clearTimeout(timer); cleanup(); resolve(null); return;
          }
          var actx = new AudioCtx({ sampleRate: 44100 });
          var srcNode = actx.createMediaElementSource(video);
          var destNode = actx.createMediaStreamDestination();
          srcNode.connect(destNode);

          var mimeType = MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '');

          var recorder = new MediaRecorder(destNode.stream, mimeType ? { mimeType: mimeType } : {});
          var chunks = [];
          recorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = async function() {
            clearTimeout(timer);
            cleanup();
            try { actx.close(); } catch (_) {}
            if (chunks.length > 0) {
              var recBlob = new Blob(chunks, { type: mimeType || 'audio/mp4' });
              var decCtx = new AudioCtx();
              try {
                var ab = await recBlob.arrayBuffer();
                var decBuf = await decCtx.decodeAudioData(ab);
                resolve(decBuf);
              } catch (_) { resolve(null); }
              finally { try { decCtx.close(); } catch (_) {} }
            } else {
              resolve(null);
            }
          };

          recorder.start(100);
          video.playbackRate = 8;
          video.currentTime = 0;
          video.onended = function() { recorder.stop(); };
          await video.play().catch(function() { recorder.stop(); });
        } catch (ex) {
          clearTimeout(timer); cleanup(); resolve(null);
        }
      };
      video.onerror = function() { clearTimeout(timer); cleanup(); resolve(null); };
    });
  }

  // ── Robust Layer Audio Decoder (Cross-Browser including Safari) ─────────────
  async function decodeLayerAudio(layer) {
    if (!layer) return null;
    if (layer._decodedAudioBuffer) return layer._decodedAudioBuffer;

    var blob = await getLayerBlob(layer);
    if (!blob) {
      logExportWarn('Audio', 'Could not locate media blob for layer: ' + (layer.name || layer.id));
      return null;
    }

    // 1. Try window.decodeAudioFromBlob (built into editor.js)
    if (typeof window.decodeAudioFromBlob === 'function') {
      try {
        var b = await window.decodeAudioFromBlob(blob);
        if (b && b.numberOfChannels > 0) {
          layer._decodedAudioBuffer = b;
          return b;
        }
      } catch (e) {
        logExportWarn('Audio', 'decodeAudioFromBlob attempt failed:', e);
      }
    }

    // 2. Standard AudioContext.decodeAudioData
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        var actx = new AudioCtx();
        try {
          var ab = await blob.arrayBuffer();
          var b2 = await actx.decodeAudioData(ab.slice(0));
          if (b2 && b2.numberOfChannels > 0) {
            layer._decodedAudioBuffer = b2;
            return b2;
          }
        } finally {
          try { actx.close(); } catch (_) {}
        }
      } catch (_) {}

      // Safari audio/mp4 container recast
      try {
        var actx2 = new AudioCtx();
        try {
          var ab2 = await blob.arrayBuffer();
          var recastBlob = new Blob([ab2], { type: 'audio/mp4' });
          var b3 = await actx2.decodeAudioData(await recastBlob.arrayBuffer());
          if (b3 && b3.numberOfChannels > 0) {
            layer._decodedAudioBuffer = b3;
            return b3;
          }
        } finally {
          try { actx2.close(); } catch (_) {}
        }
      } catch (_) {}
    }

    // 3. Try FFmpeg extraction fallback
    if (typeof window.FFmpeg !== 'undefined' || !!document.querySelector('script[src*="ffmpeg"]')) {
      try {
        var ffmpeg = await getFFmpeg();
        var inName = 'ain_' + Date.now() + '.mp4';
        var outName = 'aout_' + Date.now() + '.wav';
        ffmpeg.FS('writeFile', inName, new Uint8Array(await blob.arrayBuffer()));
        await ffmpeg.run('-i', inName, '-vn', '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', outName);
        var wavBytes = ffmpeg.FS('readFile', outName);
        try { ffmpeg.FS('unlink', inName); } catch (_) {}
        try { ffmpeg.FS('unlink', outName); } catch (_) {}
        var actx3 = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        var b4 = await actx3.decodeAudioData(wavBytes.buffer);
        try { actx3.close(); } catch (_) {}
        if (b4 && b4.numberOfChannels > 0) {
          layer._decodedAudioBuffer = b4;
          return b4;
        }
      } catch (_) {}
    }

    // 4. HTMLMediaElement accelerated capture (Safari WebKit video tag audio tap)
    try {
      var b5 = await captureAudioFromMediaElement(blob);
      if (b5 && b5.numberOfChannels > 0) {
        layer._decodedAudioBuffer = b5;
        return b5;
      }
    } catch (_) {}

    return null;
  }

  // ── Audio Offline Mixdown ──────────────────────────────────────────────────
  async function mixAudioBuffer(totalDur) {
    var ps     = window.currentProjectState || {};
    var layers = ps.layers || [];
    var pps    = window.currentPixelsPerSecond || 80;

    var playableItems = flattenPlayableAudioLayers(layers, 0, 1.0, false, 1.0, pps);
    logExportInfo('Audio:Mix', 'Found ' + playableItems.length + ' playable audio/video track(s) across timeline layers.');
    if (playableItems.length === 0 || totalDur <= 0) return null;

    var SR = 44100;
    var AudioCtxClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioCtxClass) return null;

    var ctx   = new AudioCtxClass(2, Math.ceil(totalDur * SR), SR);
    var count = 0;

    for (var i = 0; i < playableItems.length; i++) {
      var item = playableItems[i];
      var layer = item.layer;
      try {
        logExportInfo('Audio:Mix', 'Decoding audio for track ' + (i + 1) + '/' + playableItems.length + ': "' + (layer.name || layer.id) + '"...');
        var decoded = await decodeLayerAudio(layer);
        if (!decoded) {
          logExportWarn('Audio:Mix', '↳ Track has no audio stream or could not be decoded: "' + (layer.name || layer.id) + '"');
          continue;
        }

        var src  = ctx.createBufferSource();
        src.buffer = decoded;
        var gain = ctx.createGain();
        var vol  = item.effectiveGain !== undefined ? item.effectiveGain : 1.0;
        gain.gain.value = isFinite(vol) ? vol : 1.0;
        src.connect(gain);
        gain.connect(ctx.destination);

        var startSec  = Math.max(0, item.rootStartSec !== undefined ? item.rootStartSec : 0);
        var offsetSec = Math.max(0, item.sourceOffsetSec !== undefined ? item.sourceOffsetSec : 0);
        var durSec    = item.rootDurSec !== undefined ? item.rootDurSec : (totalDur - startSec);
        src.start(startSec, offsetSec, durSec);
        count++;
        logExportInfo('Audio:Mix', '✅ Mixed track ' + (i + 1) + ': "' + (layer.name || layer.id) + '" (start=' + startSec.toFixed(2) + 's, dur=' + durSec.toFixed(2) + 's, vol=' + vol.toFixed(2) + ')');
      } catch (err) {
        logExportWarn('Audio:Mix', 'Error mixing layer "' + (layer.name || layer.id) + '":', err);
      }
    }

    if (count === 0) {
      logExportWarn('Audio:Mix', 'No active audio streams were successfully decoded.');
      return null;
    }

    logExportInfo('Audio:Mix', 'Rendering offline audio mixdown (' + count + ' track(s), ' + totalDur.toFixed(2) + 's)...');
    var rendered = await ctx.startRendering();
    var wavBlob  = audioBufferToWav(rendered);
    logExport('Audio:Mix', '✅ Offline mixdown complete! Rendered ' + rendered.duration.toFixed(2) + 's @ ' + rendered.sampleRate + 'Hz (' + (wavBlob ? (wavBlob.size / 1024).toFixed(1) + ' KB WAV' : 'raw buffer') + ')');
    return { buffer: rendered, wavBlob: wavBlob };
  }

  // ── Download Helper ────────────────────────────────────────────────────────────
  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
  }

  function sanitizeName(raw) {
    return (raw || 'New_Project').trim().replace(/\.(mp4|webm)$/i, '').replace(/[\/\\?%*:|"<>]/g, '_') || 'New_Project';
  }

  // ── WebCodecs Active Probe ─────────────────────────────────────────────────────
  function probeEncoder(config, meta) {
    if (typeof VideoEncoder === 'undefined') {
      logExportWarn('Probe', 'VideoEncoder API is undefined in window');
      return Promise.resolve(false);
    }
    var profileTag = config.codec + ' (' + config.width + 'x' + config.height + ', latency=' + config.latencyMode + ', hw=' + config.hardwareAcceleration + ')';
    logExportInfo('Probe', '🔍 Performing test encode for ' + profileTag + '...');
    return new Promise(function(resolve) {
      var settled = false, enc = null, frame = null, bmp = null;
      var cleanup = function() {
        try { if (bmp && typeof bmp.close === 'function') bmp.close(); } catch (_) {}
        try { if (frame) frame.close(); } catch (_) {}
        try { if (enc && enc.state !== 'closed') enc.close(); } catch (_) {}
      };
      var done = function(ok, reason) {
        if (settled) return;
        settled = true;
        cleanup();
        if (ok) {
          logExport('Probe', '✅ Hardware probe PASSED for ' + profileTag);
        } else {
          var fb = (meta && meta.fallbackTarget) ? (' ↳ Falling back to: ' + meta.fallbackTarget) : '';
          logExportWarn('Probe', 'ℹ️ Profile check not accepted: ' + profileTag + ' (' + (reason || 'task rejected by GPU driver') + ').' + fb);
        }
        resolve(ok);
      };
      try {
        enc = new VideoEncoder({
          output: function(chunk) {
            if (chunk && chunk.byteLength > 0) done(true);
          },
          error: function(e) {
            var msg = e ? (e.message || (typeof e === 'string' ? e : 'Encoding task failed')) : 'Encoding task failed';
            done(false, msg);
          }
        });
        enc.configure(config);
        var c = document.createElement('canvas');
        c.width = config.width;
        c.height = config.height;
        var pctx = c.getContext('2d');
        if (pctx) {
          pctx.fillStyle = '#000000';
          pctx.fillRect(0, 0, config.width, config.height);
        }
        var onBmp = function(b) {
          bmp = b;
          try {
            frame = new VideoFrame(bmp, { timestamp: 0, duration: 16666 });
            enc.encode(frame, { keyFrame: true });
            enc.flush().then(function() { done(true); }).catch(function(flErr) { done(false, flErr ? flErr.message : 'flush failed'); });
          } catch (encEx) { done(false, encEx ? encEx.message : 'encode threw'); }
        };
        if (typeof createImageBitmap === 'function') {
          createImageBitmap(c).then(onBmp).catch(function(bmpErr) {
            try {
              frame = new VideoFrame(c, { timestamp: 0, duration: 16666 });
              enc.encode(frame, { keyFrame: true });
              enc.flush().then(function() { done(true); }).catch(function(flErr2) { done(false, flErr2 ? flErr2.message : 'flush failed'); });
            } catch (ex2) { done(false, ex2 ? ex2.message : 'canvas encode threw'); }
          });
        } else {
          frame = new VideoFrame(c, { timestamp: 0, duration: 16666 });
          enc.encode(frame, { keyFrame: true });
          enc.flush().then(function() { done(true); }).catch(function(flErr3) { done(false, flErr3 ? flErr3.message : 'flush failed'); });
        }
      } catch (setupErr) { done(false, setupErr ? setupErr.message : 'setup threw'); }
      setTimeout(function() { done(false, 'timeout 1500ms'); }, 1500);
    });
  }

  // ── WebCodecs In-Memory Audio Encoding (AAC) ──────────────────────────────────
  async function encodeAudioIntoMuxer(audioBuffer, muxer) {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
    var audioCfg = {
      codec: 'mp4a.40.2',
      numberOfChannels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      bitrate: 192000
    };
    try {
      var check = await AudioEncoder.isConfigSupported(audioCfg);
      if (!check || !check.supported) return false;
    } catch (_) { return false; }

    var encErr = null;
    var aEnc = new AudioEncoder({
      output: function(chunk, meta) {
        try { muxer.addAudioChunk(chunk, meta); } catch (e) { encErr = e; }
      },
      error: function(e) { encErr = e; }
    });
    aEnc.configure(audioCfg);

    var sampleRate = audioBuffer.sampleRate;
    var numChannels = audioBuffer.numberOfChannels;
    var totalFrames = audioBuffer.length;
    var chunkSize = 1024;
    var ch0 = audioBuffer.getChannelData(0);
    var ch1 = numChannels > 1 ? audioBuffer.getChannelData(1) : ch0;

    for (var offset = 0; offset < totalFrames; offset += chunkSize) {
      if (encErr || isCancelled) break;
      var chunkFrames = Math.min(chunkSize, totalFrames - offset);
      var planarData = new Float32Array(chunkFrames * numChannels);
      planarData.set(ch0.subarray(offset, offset + chunkFrames), 0);
      if (numChannels > 1) {
        planarData.set(ch1.subarray(offset, offset + chunkFrames), chunkFrames);
      }
      var audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: sampleRate,
        numberOfFrames: chunkFrames,
        numberOfChannels: numChannels,
        timestamp: Math.round((offset / sampleRate) * 1000000),
        data: planarData
      });
      aEnc.encode(audioData);
      audioData.close();
    }

    if (!encErr && !isCancelled) {
      await aEnc.flush();
    }
    try { aEnc.close(); } catch (_) {}
    return !encErr && !isCancelled;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PATH 1: WebCodecs + Mp4Muxer (primary — deterministic frame-by-frame)
  // ─────────────────────────────────────────────────────────────────────────────
  async function exportViaWebCodecs(options) {
    var preset     = options.preset     || 'normal';
    var customName = options.customName || '';
    var onProgress = options.onProgress;

    logExportInfo('WebCodecs', 'Initializing Tier 1 WebCodecs pipeline...');
    if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') {
      logExportWarn('WebCodecs', 'VideoEncoder or Mp4Muxer missing in window. WebCodecs unavailable.');
      return false;
    }
    if (typeof window.renderCanvasFrame !== 'function') {
      logExportWarn('WebCodecs', 'window.renderCanvasFrame is missing. Cannot render frames.');
      return false;
    }

    var dims = getProjectDims();
    var baseW = dims.w, baseH = dims.h;
    var ps    = window.currentProjectState || {};
    var fps   = parseInt(ps.fps || 60, 10);
    var totalDur = Math.max(0.5, typeof window.getProjectTotalDuration === 'function'
      ? window.getProjectTotalDuration() : (ps.defaultDuration || 5));
    var totalFrames = Math.max(1, Math.round(totalDur * fps));
    var pps   = window.currentPixelsPerSecond || 80;

    var videoBps    = 25000000;
    var bitrateMode = 'variable';
    if (preset === 'light')  { videoBps = 16000000; bitrateMode = 'variable'; }
    if (preset === 'detail') { videoBps = 50000000; bitrateMode = 'constant'; }

    var totalPixels = baseW * baseH;
    var is4K = totalPixels > (1920 * 1080);
    var h264Level = is4K ? '33' : '2a'; // Level 5.1 for 4K (>2M px), Level 4.2 for <=1080p (including 1080x1920 vertical)

    var candidates = [
      { codec: 'avc1.4200' + h264Level, muxerCodec: 'avc', name: 'H.264 Baseline' },
      { codec: 'avc1.4d40' + h264Level, muxerCodec: 'avc', name: 'H.264 Main' },
      { codec: 'avc1.42e0' + h264Level, muxerCodec: 'avc', name: 'H.264 Constrained' },
      { codec: 'avc1.6400' + h264Level, muxerCodec: 'avc', name: 'H.264 High' },
      { codec: 'vp09.00.10.08', muxerCodec: 'vp9', name: 'VP9 Profile 0' },
      { codec: 'vp09.02.10.10', muxerCodec: 'vp9', name: 'VP9 Profile 2' }
    ];

    var chosenCodec = null, chosenConfig = null;
    var hwModes  = ['prefer-hardware', 'no-preference'];
    var brModes  = bitrateMode === 'variable' ? ['variable'] : [bitrateMode, 'variable'];
    var latModes = ['quality', 'realtime']; // Offline render defaults to quality; realtime is fallback

    logExportInfo('WebCodecs', 'Testing ' + candidates.length + ' H.264/VP9 candidate profiles at ' + baseW + 'x' + baseH + ' @ ' + fps + 'fps (' + (videoBps/1000000).toFixed(1) + ' Mbps)...');

    outer:
    for (var ci = 0; ci < candidates.length; ci++) {
      var cand = candidates[ci];
      var nextCand = (ci + 1 < candidates.length) ? candidates[ci + 1] : null;
      var nextCandLabel = nextCand ? (nextCand.name + ' [' + nextCand.codec + ']') : 'Tier 2 GPU MediaRecorder';

      logExportInfo('WebCodecs:Probe', 'Checking candidate ' + (ci + 1) + '/' + candidates.length + ': ' + cand.name + ' (' + cand.codec + ')...');

      for (var hi = 0; hi < hwModes.length; hi++) {
        var hw = hwModes[hi];
        for (var bi = 0; bi < brModes.length; bi++) {
          var br = brModes[bi];
          for (var li = 0; li < latModes.length; li++) {
            var lat = latModes[li];

            var nextLat = (li + 1 < latModes.length) ? ('latency=' + latModes[li + 1]) : null;
            var nextHw  = (hi + 1 < hwModes.length) ? ('hw=' + hwModes[hi + 1]) : null;
            var fallbackTarget = nextLat || nextHw || ('next candidate: ' + nextCandLabel);

            var cfg = {
              codec: cand.codec, width: baseW, height: baseH,
              bitrate: videoBps, bitrateMode: br,
              framerate: fps, latencyMode: lat,
              hardwareAcceleration: hw
            };
            try {
              var check = await VideoEncoder.isConfigSupported(cfg);
              if (check && check.supported) {
                var verified = await probeEncoder(cfg, {
                  candidate: cand,
                  fallbackTarget: fallbackTarget
                });
                if (verified) {
                  chosenCodec = cand;
                  chosenConfig = cfg;
                  logExport('WebCodecs:Probe', '🎯 Selected working profile: ' + cand.name + ' (' + cand.codec + ') [latency=' + lat + ', hw=' + hw + ']. Proceeding with GPU pipeline.');
                  break outer;
                }
              }
            } catch (_) {}
          }
        }
      }
      logExportWarn('WebCodecs:Probe', 'Profile ' + cand.name + ' (' + cand.codec + ') could not be initialized by GPU driver. ↳ Falling back to: ' + nextCandLabel);
    }

    if (!chosenCodec || !chosenConfig) {
      logExportWarn('WebCodecs', '⚠️ All ' + candidates.length + ' WebCodecs profiles failed capability probe for ' + baseW + 'x' + baseH + '. ↳ Gracefully falling back to Tier 2: GPU MediaRecorder...');
      return false;
    }

    logExport('WebCodecs', 'Codec selected & configured: ' + chosenCodec.codec + ' (' + chosenConfig.width + 'x' + chosenConfig.height + ', latency=' + chosenConfig.latencyMode + ', hw=' + chosenConfig.hardwareAcceleration + ')');

    showProgress('Exporting video', 0, 'Preparing...', 'GPU');
    var cacheOk = await ensureVideosCached(onProgress);
    if (!cacheOk) {
      logExportWarn('WebCodecs', 'ensureVideosCached returned false');
      return false;
    }
    if (isCancelled) { logExportInfo('WebCodecs', 'Export cancelled by user'); return true; }

    window.isExporting = true;
    var exportCanvas = document.createElement('canvas');
    exportCanvas.width  = baseW;
    exportCanvas.height = baseH;
    exportCanvas.style.cssText = 'position:fixed;left:-99999px;top:-99999px;pointer-events:none;opacity:0;z-index:-1;';
    document.body.appendChild(exportCanvas);

    try {
      updateProgress(3, 'Mixing audio...', onProgress);
      logExportInfo('WebCodecs:Audio', 'Mixing audio tracks (duration=' + totalDur.toFixed(2) + 's)...');
      var audioResult = null;
      try { audioResult = await mixAudioBuffer(totalDur); } catch (aErr) { logExportWarn('WebCodecs:Audio', 'Audio mix error:', aErr); }
      if (isCancelled) { hideProgress(); return true; }

      var canWebCodecsAudio = false;
      if (audioResult && audioResult.buffer && typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined') {
        try {
          var aCheck = await AudioEncoder.isConfigSupported({
            codec: 'mp4a.40.2',
            numberOfChannels: audioResult.buffer.numberOfChannels,
            sampleRate: audioResult.buffer.sampleRate,
            bitrate: 192000
          });
          canWebCodecsAudio = !!(aCheck && aCheck.supported);
        } catch (_) {}
      }
      var hasAudio = !!(audioResult && audioResult.buffer && audioResult.buffer.duration > 0.01);
      // Single-threaded FFmpeg.wasm is bundled and requires NO SharedArrayBuffer (works universally in Safari, Chrome, Firefox)
      var canFfmpegMerge = hasAudio;

      logExportInfo('WebCodecs:Audio', 'Audio status: ' + (hasAudio ? (audioResult.buffer.duration.toFixed(2) + 's, ' + audioResult.buffer.numberOfChannels + 'ch @ ' + audioResult.buffer.sampleRate + 'Hz') : 'no audio') + ' | Native AAC WebCodecs=' + canWebCodecsAudio + ' | Fast FFmpeg Remux=' + canFfmpegMerge);

      // Only bypass Tier 1 if project has audio, but browser lacks BOTH WebCodecs AudioEncoder AND FFmpeg remuxer:
      if (hasAudio && !canWebCodecsAudio && !canFfmpegMerge) {
        logExportWarn('WebCodecs:Audio', '⚠️ Project has audio, but no audio muxer available. ↳ Falling back to Tier 2: GPU MediaRecorder...');
        return false;
      }

      var muxerOptions = {
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: chosenCodec.muxerCodec, width: baseW, height: baseH },
        firstTimestampBehavior: 'offset',
        fastStart: 'in-memory'
      };
      if (canWebCodecsAudio) {
        muxerOptions.audio = {
          codec: 'aac',
          numberOfChannels: audioResult.buffer.numberOfChannels,
          sampleRate: audioResult.buffer.sampleRate
        };
      }
      var muxer = new Mp4Muxer.Muxer(muxerOptions);
      logExportInfo('WebCodecs:Muxer', 'Mp4Muxer initialized (video=' + chosenCodec.muxerCodec + ', audio=' + (canWebCodecsAudio ? 'aac' : 'none') + ')');

      var frameDurMicros = Math.round(1000000 / fps);
      var encError = null;
      var lastTs   = -1;
      var chunksCount = 0;
      var totalBytesEncoded = 0;

      var encoder = new VideoEncoder({
        output: function(chunk, meta) {
          try {
            var data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            var ts  = (Number.isFinite(chunk.timestamp) && chunk.timestamp >= 0) ? chunk.timestamp : 0;
            var dur = (Number.isFinite(chunk.duration)  && chunk.duration  >  0) ? chunk.duration  : frameDurMicros;
            muxer.addVideoChunkRaw(data, chunk.type, ts, dur, meta);
            chunksCount++;
            totalBytesEncoded += chunk.byteLength;
            if (chunksCount === 1) {
              logExport('WebCodecs:Chunk', 'First chunk received! type=' + chunk.type + ', size=' + (chunk.byteLength / 1024).toFixed(1) + ' KB, ts=' + ts);
            }
          } catch (e) {
            encError = e;
            logExportError('WebCodecs:Chunk', 'Chunk processing error:', e);
          }
        },
        error: function(e) {
          encError = e;
          logExportError('WebCodecs:Encoder', 'VideoEncoder runtime error event:', e);
        }
      });
      encoder.configure(chosenConfig);
      logExport('WebCodecs', 'VideoEncoder instance configured successfully.');

      var videoLayers = (ps.layers || []).filter(function(l) { return l.type === 'video' && !l.hidden; });
      for (var vi = 0; vi < videoLayers.length; vi++) {
        if (window.getOrLoadLayerMedia) {
          var m = window.getOrLoadLayerMedia(videoLayers[vi]);
          if (m && m.el && m.el.tagName === 'VIDEO') {
            try { m.el.pause(); m.el.playbackRate = 1.0; } catch (_) {}
          }
        }
      }

      // ── Deterministic Frame Loop (t = i/fps, NOT wall clock) ─────────────────
      logExportInfo('WebCodecs:Render', 'Starting frame loop: ' + totalFrames + ' frames @ ' + fps + 'fps (step=' + frameDurMicros + 'µs)');
      for (var i = 0; i < totalFrames; i++) {
        if (isCancelled) {
          logExportInfo('WebCodecs', 'Render cancelled at frame ' + i);
          try { encoder.close(); } catch (_) {}
          hideProgress();
          return true;
        }
        if (encError) {
          logExportError('WebCodecs', 'Encoder failed at frame ' + i + ': ' + (encError ? (encError.message || encError) : 'unknown') + '. ↳ Aborting Tier 1 and gracefully falling back to Tier 2: GPU MediaRecorder...');
          try { encoder.close(); } catch (_) {}
          return false;
        }

        var t = i / fps; // EXACT — never performance.now()

        await prepareFrameAtTime(t, videoLayers, pps);
        window.renderCanvasFrame(exportCanvas, ps.bgColor, baseW, baseH, 'export-video', t);

        // Non-blocking GPU event-loop yield:
        // Never call flush() mid-stream (causes WebKit VideoToolbox deadlock).
        // If queue exceeds 30, yield 8ms so GPUProcess dispatches pending chunks without stalling.
        if (encoder.encodeQueueSize > 30) {
          await new Promise(function(r) { setTimeout(r, 8); });
        }
        if (encError || isCancelled) break;

        var frameTs = Math.max(lastTs + 1, Math.round((i / fps) * 1000000));
        lastTs = frameTs;

        var bmp = null;
        var vFrame = null;
        try {
          if (typeof createImageBitmap === 'function') {
            bmp = await createImageBitmap(exportCanvas);
            vFrame = new VideoFrame(bmp, { timestamp: frameTs, duration: frameDurMicros });
            bmp.close();
          } else {
            vFrame = new VideoFrame(exportCanvas, { timestamp: frameTs, duration: frameDurMicros });
          }
        } catch (vfErr) {
          logExportError('WebCodecs:Frame', 'VideoFrame creation error at frame ' + i + ':', vfErr);
          encError = vfErr;
          break;
        }

        var isKey = (i === 0) || ((i % (fps * 2)) === 0);
        try {
          encoder.encode(vFrame, { keyFrame: isKey });
        } catch (encodeErr) {
          logExportError('WebCodecs:Encode', 'encoder.encode threw at frame ' + i + ':', encodeErr);
          encError = encodeErr;
        }
        vFrame.close();

        // RAM eviction: drop old frames behind playhead
        if (window.VideoFrameExtractor && videoLayers.length > 0) {
          for (var vei = 0; vei < videoLayers.length; vei++) {
            var vl = videoLayers[vei];
            var sk = window.VideoFrameExtractor._getSourceKey ? window.VideoFrameExtractor._getSourceKey(vl) : (vl.mediaId || vl.dataUrl || vl.id);
            var sc = window.VideoFrameExtractor.getSourceCache && window.VideoFrameExtractor.getSourceCache(sk);
            if (sc && sc.frames && sc.frames.size > 20) {
              var curF = Math.round(t * (sc.fps || fps));
              sc.frames.forEach(function(bmp2, fi) {
                if (fi < curF - 5) {
                  sc.frames.delete(fi);
                  if (bmp2 && typeof bmp2.close === 'function') try { bmp2.close(); } catch (_) {}
                }
              });
            }
          }
        }

        var pct = 5 + Math.round((i / totalFrames) * 88);
        updateProgress(pct, (i + 1) + ' / ' + totalFrames, onProgress);
        if (i === 0) {
          logExportInfo('WebCodecs:Render', 'Frame 0/' + totalFrames + ' submitted (forced keyframe)');
        } else if (i % Math.max(1, Math.min(30, Math.round(fps))) === 0 || i === totalFrames - 1) {
          logExportInfo('WebCodecs:Render', 'Frame ' + (i + 1) + '/' + totalFrames + ' (' + Math.round(((i + 1) / totalFrames) * 100) + '%) | t=' + t.toFixed(2) + 's | queue=' + encoder.encodeQueueSize + ' | chunks=' + chunksCount + ' | encoded=' + (totalBytesEncoded / 1024 / 1024).toFixed(2) + ' MB');
        }
        if (i % 6 === 0) await new Promise(function(r) { setTimeout(r, 0); });
      }

      if (isCancelled) {
        logExportInfo('WebCodecs', 'Export cancelled by user');
        try { encoder.close(); } catch (_) {}
        hideProgress();
        return true;
      }
      if (encError) {
        logExportError('WebCodecs', 'Encoder failed before finalize: ' + (encError ? (encError.message || encError) : 'unknown') + '. ↳ Aborting Tier 1 and gracefully falling back to Tier 2: GPU MediaRecorder...');
        try { encoder.close(); } catch (_) {}
        return false;
      }

      if (canWebCodecsAudio && audioResult && audioResult.buffer) {
        updateProgress(93, 'Encoding audio...', onProgress);
        logExportInfo('WebCodecs:Audio', 'Encoding in-memory AAC audio into muxer...');
        await encodeAudioIntoMuxer(audioResult.buffer, muxer);
        logExport('WebCodecs:Audio', 'Audio encoding finished.');
      }

      updateProgress(96, 'Finalizing video...', onProgress);
      logExportInfo('WebCodecs:Flush', 'Flushing VideoEncoder (' + chunksCount + ' chunks received)...');
      try {
        await Promise.race([
          encoder.flush(),
          new Promise(function(_, reject) { setTimeout(function() { reject(new Error('encoder.flush() timed out after 10s')); }, 10000); })
        ]);
        logExport('WebCodecs:Flush', 'VideoEncoder queue flushed successfully.');
      } catch (flushErr) {
        logExportError('WebCodecs:Flush', 'Encoder flush failed:', flushErr);
        try { encoder.close(); } catch (_) {}
        return false;
      }

      logExportInfo('WebCodecs:Muxer', 'Finalizing Mp4Muxer container...');
      muxer.finalize();
      var videoBuffer = muxer.target.buffer;
      logExport('WebCodecs:Muxer', 'Mp4Muxer finalized! Container size: ' + (videoBuffer.byteLength / 1024 / 1024).toFixed(2) + ' MB');
      var finalBlob   = null;

      if (canWebCodecsAudio) {
        // Audio already muxed inside videoBuffer via WebCodecs AAC
        finalBlob = new Blob([videoBuffer], { type: 'video/mp4' });
      } else if (hasAudio && canFfmpegMerge && audioResult && audioResult.wavBlob && audioResult.wavBlob.size > 100) {
        var ffmpegOk = false;
        try {
          updateProgress(95, 'Merging audio into MP4...', onProgress);
          logExportInfo('WebCodecs:AudioMerge', 'Merging AAC audio via fast FFmpeg remux (-c:v copy -c:a aac)...');
          var ffmpeg = await getFFmpeg();
          try { ffmpeg.FS('unlink', 'v_temp.mp4'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'a_temp.wav'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'out_merged.mp4'); } catch (_) {}
          ffmpeg.FS('writeFile', 'v_temp.mp4', new Uint8Array(videoBuffer));
          ffmpeg.FS('writeFile', 'a_temp.wav', new Uint8Array(await audioResult.wavBlob.arrayBuffer()));
          await ffmpeg.run('-i', 'v_temp.mp4', '-i', 'a_temp.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-strict', '-2', '-shortest', 'out_merged.mp4');
          var merged = ffmpeg.FS('readFile', 'out_merged.mp4');
          if (merged && merged.length > 0) {
            finalBlob = new Blob([merged.buffer], { type: 'video/mp4' });
            ffmpegOk = true;
            logExport('WebCodecs:AudioMerge', 'Audio merge complete! Final file size: ' + (finalBlob.size / 1024 / 1024).toFixed(2) + ' MB');
          }
          try { ffmpeg.FS('unlink', 'v_temp.mp4'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'a_temp.wav'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'out_merged.mp4'); } catch (_) {}
        } catch (mergeErr) {
          logExportWarn('WebCodecs:AudioMerge', 'Audio merge via FFmpeg failed:', mergeErr);
        }
        if (!ffmpegOk) {
          logExportWarn('WebCodecs', '⚠️ Audio merge could not be completed. Falling back to video without audio to preserve crisp frames.');
          finalBlob = new Blob([videoBuffer], { type: 'video/mp4' });
        }
      } else if (hasAudio) {
        logExportWarn('WebCodecs', '⚠️ Audio track could not be prepared. Exporting video without audio.');
        finalBlob = new Blob([videoBuffer], { type: 'video/mp4' });
      } else {
        finalBlob = new Blob([videoBuffer], { type: 'video/mp4' });
      }

      var outFileName = sanitizeName(customName || ps.name) + '.mp4';
      logExport('WebCodecs:Download', 'Triggering file download: ' + outFileName + ' (' + (finalBlob.size / 1024 / 1024).toFixed(2) + ' MB)');
      updateProgress(100, 'Complete!', onProgress);
      triggerDownload(finalBlob, outFileName);
      setTimeout(hideProgress, 600);
      return true;

    } catch (err) {
      logExportError('WebCodecs', 'Fatal error in exportViaWebCodecs:', err);
      return false;
    } finally {
      window.isExporting = false;
      try { if (exportCanvas && exportCanvas.parentNode) exportCanvas.parentNode.removeChild(exportCanvas); } catch (_) {}
      try {
        if (typeof window.redrawComposition === 'function') window.redrawComposition('exportFinished');
      } catch (_) {}
    }
  }

  // ── PATH 2: FFmpeg.wasm frame sequence (CPU fallback) ─────────────────────
  async function exportViaFFmpeg(options) {
    var preset     = options.preset     || 'normal';
    var customName = options.customName || '';
    var onProgress = options.onProgress;

    logExportInfo('FFmpeg', 'Starting Tier 3 Universal FFmpeg CPU fallback...');
    if (typeof window.renderCanvasFrame !== 'function') {
      logExportError('FFmpeg', 'renderCanvasFrame not available');
      return;
    }

    showProgress('Exporting video', 0, 'Initializing...', 'CPU');
    var cacheOk = await ensureVideosCached(onProgress);
    if (!cacheOk) {
      logExportWarn('FFmpeg', 'ensureVideosCached failed');
      return;
    }

    var ffmpeg;
    try {
      logExportInfo('FFmpeg', 'Loading FFmpeg WebAssembly core...');
      ffmpeg = await getFFmpeg();
      ffmpeg.setLogger(function(m) {
        if (m && m.message && !m.message.startsWith('frame=')) {
          console.log('%c[FishExport:FFmpegCore]', 'color:#94a3b8;', m.message);
        }
      });
      logExport('FFmpeg', 'FFmpeg loaded successfully.');
    } catch (err) {
      logExportError('FFmpeg', 'Failed to load FFmpeg WebAssembly:', err);
      hideProgress();
      alert('[FishExport] Failed to load FFmpeg WebAssembly. Check vendor files.');
      return;
    }
    if (isCancelled) { logExportInfo('FFmpeg', 'Cancelled by user'); hideProgress(); return; }

    var ps          = window.currentProjectState || {};
    var fps         = parseInt(ps.fps || 60, 10);
    var totalDur    = Math.max(0.5, typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : (ps.defaultDuration || 5));
    var totalFrames = Math.max(1, Math.round(totalDur * fps));
    var dims        = getProjectDims();
    var baseW = dims.w, baseH = dims.h;
    var pps   = window.currentPixelsPerSecond || 80;

    logExportInfo('FFmpeg', 'Exporting ' + totalFrames + ' frames @ ' + fps + 'fps (' + baseW + 'x' + baseH + ', ' + totalDur.toFixed(2) + 's, preset=' + preset + ')');
    window.isExporting = true;

    try {
      updateProgress(5, 'Mixing audio...', onProgress);
      var audioResult = null;
      try { audioResult = await mixAudioBuffer(totalDur); } catch (aErr) { logExportWarn('FFmpeg:Audio', 'Audio mix error:', aErr); }
      var wavBlob = audioResult ? (audioResult.wavBlob || audioResult) : null;
      var hasAudio = false;
      if (wavBlob && wavBlob.size > 100) {
        try {
          ffmpeg.FS('writeFile', 'audio.wav', new Uint8Array(await wavBlob.arrayBuffer()));
          hasAudio = true;
          logExportInfo('FFmpeg:Audio', 'Audio written to virtual FS: audio.wav (' + (wavBlob.size / 1024).toFixed(1) + ' KB)');
        } catch (_) {}
      }
      if (isCancelled) { logExportInfo('FFmpeg', 'Cancelled by user'); hideProgress(); return; }

      var exportCanvas = document.createElement('canvas');
      exportCanvas.width  = baseW;
      exportCanvas.height = baseH;
      var videoLayers = (ps.layers || []).filter(function(l) { return l.type === 'video' && !l.hidden; });
      var created = [];

      logExportInfo('FFmpeg:Render', 'Rendering ' + totalFrames + ' frames to JPEG frame sequence in virtual FS...');
      for (var i = 0; i < totalFrames; i++) {
        if (isCancelled) {
          logExportInfo('FFmpeg', 'Cancelled during frame rendering at frame ' + i);
          created.forEach(function(f) { try { ffmpeg.FS('unlink', f); } catch (_) {} });
          if (hasAudio) try { ffmpeg.FS('unlink', 'audio.wav'); } catch (_) {}
          hideProgress();
          return;
        }

        var t = i / fps; // deterministic

        await prepareFrameAtTime(t, videoLayers, pps);
        window.renderCanvasFrame(exportCanvas, ps.bgColor, baseW, baseH, 'export-video', t);

        var blob  = await new Promise(function(r) { exportCanvas.toBlob(r, 'image/jpeg', 0.90); });
        var bytes = new Uint8Array(await blob.arrayBuffer());
        var name  = 'frame_' + String(i).padStart(5, '0') + '.jpg';
        ffmpeg.FS('writeFile', name, bytes);
        created.push(name);

        var pct = 10 + Math.round((i / totalFrames) * 60);
        updateProgress(pct, (i + 1) + ' / ' + totalFrames, onProgress);
        if (i === 0) {
          logExportInfo('FFmpeg:Render', 'Frame 0/' + totalFrames + ' written to FS');
        } else if (i % Math.max(1, Math.round(totalFrames / 5)) === 0 || i === totalFrames - 1) {
          logExportInfo('FFmpeg:Render', 'Frame ' + (i + 1) + '/' + totalFrames + ' (' + Math.round(((i + 1) / totalFrames) * 100) + '%) written to FS');
        }
        if (i % 3 === 0) await new Promise(function(r) { setTimeout(r, 0); });
      }

      if (isCancelled) {
        created.forEach(function(f) { try { ffmpeg.FS('unlink', f); } catch (_) {} });
        if (hasAudio) try { ffmpeg.FS('unlink', 'audio.wav'); } catch (_) {}
        hideProgress();
        return;
      }

      updateProgress(71, 'Encoding MP4...', onProgress);
      await new Promise(function(r) { setTimeout(r, 100); });

      var args = ['-framerate', String(fps), '-i', 'frame_%05d.jpg'];
      if (hasAudio) args.push('-i', 'audio.wav');

      if (preset === 'light') {
        args.push('-c:v', 'libx264', '-r', String(fps), '-vsync', 'cfr', '-crf', '22', '-b:v', '16M', '-maxrate', '20M', '-bufsize', '20M', '-preset', 'ultrafast', '-tune', 'fastdecode', '-pix_fmt', 'yuv420p');
      } else if (preset === 'detail') {
        args.push('-c:v', 'libx264', '-r', String(fps), '-vsync', 'cfr', '-b:v', '50M', '-maxrate', '50M', '-bufsize', '50M', '-preset', 'ultrafast', '-tune', 'fastdecode', '-pix_fmt', 'yuv420p');
      } else {
        args.push('-c:v', 'libx264', '-r', String(fps), '-vsync', 'cfr', '-crf', '18', '-b:v', '25M', '-maxrate', '30M', '-bufsize', '30M', '-preset', 'ultrafast', '-tune', 'fastdecode', '-pix_fmt', 'yuv420p');
      }
      if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
      args.push('output.mp4');

      logExportInfo('FFmpeg:Encode', 'Executing command: ffmpeg ' + args.join(' '));

      ffmpeg.setProgress(function(p) {
        var ratio = p.ratio;
        if (ratio >= 0 && ratio <= 1) {
          updateProgress(72 + Math.round(ratio * 24), 'Encoding MP4 (' + Math.round(ratio * 100) + '%)...', onProgress);
        }
      });

      try {
        await ffmpeg.run.apply(ffmpeg, args);
      } catch (encErr) {
        var isExit0 = encErr && (encErr.status === 0 || String(encErr).includes('exit(0)'));
        var hasOut  = false;
        try { var testOut = ffmpeg.FS('readFile', 'output.mp4'); if (testOut && testOut.length > 0) hasOut = true; } catch (_) {}
        if (!isExit0 && !hasOut) throw encErr;
      }

      if (isCancelled) {
        created.forEach(function(f) { try { ffmpeg.FS('unlink', f); } catch (_) {} });
        if (hasAudio) try { ffmpeg.FS('unlink', 'audio.wav'); } catch (_) {}
        try { ffmpeg.FS('unlink', 'output.mp4'); } catch (_) {}
        hideProgress();
        return;
      }

      updateProgress(98, 'Finalizing...', onProgress);
      var out  = ffmpeg.FS('readFile', 'output.mp4');
      var outBlob = new Blob([out.buffer], { type: 'video/mp4' });

      created.forEach(function(f) { try { ffmpeg.FS('unlink', f); } catch (_) {} });
      if (hasAudio) try { ffmpeg.FS('unlink', 'audio.wav'); } catch (_) {}
      try { ffmpeg.FS('unlink', 'output.mp4'); } catch (_) {}

      var outFileName = sanitizeName(customName || ps.name) + '.mp4';
      logExport('FFmpeg:Complete', 'Export finished! File size: ' + (outBlob.size / 1024 / 1024).toFixed(2) + ' MB | Download: ' + outFileName);
      updateProgress(100, 'Complete!', onProgress);
      triggerDownload(outBlob, outFileName);
      setTimeout(hideProgress, 600);

    } catch (err) {
      logExportError('FFmpeg', 'Fatal error:', err);
      hideProgress();
      alert('Export failed: ' + (err.message || err));
    } finally {
      window.isExporting = false;
      try {
        if (typeof window.redrawComposition === 'function') window.redrawComposition('exportFinished');
      } catch (_) {}
    }
  }

  // ── PATH 2: Hardware-Accelerated MediaRecorder (Safari & Chrome GPU Fallback)
  async function exportViaMediaRecorder(options) {
    var preset     = options.preset     || 'normal';
    var customName = options.customName || '';
    var onProgress = options.onProgress;

    logExportInfo('MediaRecorder', 'Starting Tier 2 GPU MediaRecorder export...');
    if (typeof MediaRecorder === 'undefined') {
      logExportWarn('MediaRecorder', 'MediaRecorder is undefined in this browser');
      return false;
    }
    if (typeof window.renderCanvasFrame !== 'function') {
      logExportWarn('MediaRecorder', 'renderCanvasFrame not available');
      return false;
    }

    var mimeCandidates = [
      'video/mp4;codecs=avc1.64002a,mp4a.40.2',
      'video/mp4;codecs=avc1.4d402a,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    var selectedMime = '';
    for (var m = 0; m < mimeCandidates.length; m++) {
      if (MediaRecorder.isTypeSupported(mimeCandidates[m])) {
        selectedMime = mimeCandidates[m];
        break;
      }
    }
    if (!selectedMime) {
      logExportWarn('MediaRecorder', 'No supported MIME type found among candidates');
      return false;
    }
    logExportInfo('MediaRecorder', 'Selected MIME format: ' + selectedMime);

    var dims = getProjectDims();
    var baseW = dims.w, baseH = dims.h;
    var ps    = window.currentProjectState || {};
    var fps   = parseInt(ps.fps || 60, 10);
    var totalDur = Math.max(0.5, typeof window.getProjectTotalDuration === 'function'
      ? window.getProjectTotalDuration() : (ps.defaultDuration || 5));
    var totalFrames = Math.max(1, Math.round(totalDur * fps));
    var pps   = window.currentPixelsPerSecond || 80;

    showProgress('Exporting video', 0, 'Preparing...', 'GPU');
    var cacheOk = await ensureVideosCached(onProgress);
    if (!cacheOk) {
      logExportWarn('MediaRecorder', 'ensureVideosCached failed');
      return false;
    }
    if (isCancelled) { logExportInfo('MediaRecorder', 'Cancelled by user'); return true; }

    window.isExporting = true;

    var audioResult = null;
    try { audioResult = await mixAudioBuffer(totalDur); } catch (aErr) { logExportWarn('MediaRecorder:Audio', 'Audio mix error:', aErr); }
    if (isCancelled) { hideProgress(); return true; }

    var exportCanvas = document.createElement('canvas');
    exportCanvas.width  = baseW;
    exportCanvas.height = baseH;
    exportCanvas.style.cssText = 'position:fixed;top:0;left:0;width:' + baseW + 'px;height:' + baseH + 'px;opacity:0.01;pointer-events:none;z-index:-1;';
    document.body.appendChild(exportCanvas);

    if (typeof exportCanvas.captureStream !== 'function') {
      logExportWarn('MediaRecorder', 'exportCanvas.captureStream is not supported in this browser (e.g. Safari). Skipping Tier 2.');
      try { if (exportCanvas.parentNode) exportCanvas.parentNode.removeChild(exportCanvas); } catch (_) {}
      return false;
    }

    var stream = exportCanvas.captureStream(fps);
    var vTrack = stream.getVideoTracks()[0];
    if (vTrack && typeof vTrack.applyConstraints === 'function') {
      await vTrack.applyConstraints({ frameRate: { ideal: fps, max: fps } }).catch(function() {});
    }

    var audioCtx = null;
    var audioSource = null;
    if (audioResult && audioResult.buffer) {
      var AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass({ sampleRate: audioResult.buffer.sampleRate || 44100 });
        if (audioCtx.state === 'suspended') {
          try { await audioCtx.resume(); } catch (_) {}
        }
        var dest = audioCtx.createMediaStreamDestination();
        audioSource = audioCtx.createBufferSource();
        audioSource.buffer = audioResult.buffer;
        audioSource.connect(dest);
        var aTrack = dest.stream.getAudioTracks()[0];
        if (aTrack) stream.addTrack(aTrack);
      }
    }
    logExportInfo('MediaRecorder:Audio', 'Audio track attached: ' + (audioResult && audioResult.buffer ? 'yes' : 'no'));

    var videoBps = 25000000;
    if (preset === 'light')  videoBps = 16000000;
    if (preset === 'detail') videoBps = 50000000;

    var recorder = new MediaRecorder(stream, {
      mimeType: selectedMime,
      videoBitsPerSecond: videoBps,
      audioBitsPerSecond: 192000
    });

    var recordedChunks = [];
    recorder.ondataavailable = function(e) {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    var videoLayers = (ps.layers || []).filter(function(l) { return l.type === 'video' && !l.hidden; });
    var savedMuted = new Map();
    for (var vi = 0; vi < videoLayers.length; vi++) {
      if (window.getOrLoadLayerMedia) {
        var med = window.getOrLoadLayerMedia(videoLayers[vi]);
        if (med && med.el) {
          savedMuted.set(med.el, med.el.muted);
          med.el.muted = true;
          med.el._preSeeked = false;
        }
      }
    }

    var initialVideos = [];
    for (var i = 0; i < videoLayers.length; i++) {
      var vl = videoLayers[i];
      var start = vl.startSec !== undefined ? vl.startSec : ((vl.startPx || 0) / pps);
      var dur = vl.durationSec !== undefined ? vl.durationSec : ((vl.widthPx || 400) / pps);
      if (start <= 0 && dur > 0 && window.getOrLoadLayerMedia) {
        var m = window.getOrLoadLayerMedia(vl);
        if (m && m.el && m.el.tagName === 'VIDEO') {
          initialVideos.push({ layer: vl, el: m.el });
        }
      }
    }

    for (var iv = 0; iv < initialVideos.length; iv++) {
      try {
        initialVideos[iv].el.currentTime = initialVideos[iv].layer.sourceOffsetSec || 0;
        initialVideos[iv].el.playbackRate = 1.0;
      } catch (_) {}
    }

    await Promise.all(initialVideos.map(function(item) {
      return new Promise(function(resolve) {
        if (item.el.readyState >= 2 && !item.el.seeking) return resolve();
        var done = false;
        var onR = function() { if (!done) { done = true; item.el.removeEventListener('canplay', onR); item.el.removeEventListener('seeked', onR); resolve(); } };
        item.el.addEventListener('canplay', onR, { once: true });
        item.el.addEventListener('seeked', onR, { once: true });
        setTimeout(onR, 600);
      });
    }));

    window.renderCanvasFrame(exportCanvas, ps.bgColor, baseW, baseH, 'export-video', 0);
    await Promise.all(initialVideos.map(function(item) { return item.el.play().catch(function() {}); }));
    await new Promise(function(r) { requestAnimationFrame(r); });

    if (isCancelled) {
      try { if (exportCanvas.parentNode) exportCanvas.parentNode.removeChild(exportCanvas); } catch (_) {}
      hideProgress();
      return true;
    }

    try {
      logExportInfo('MediaRecorder', 'Starting live capture recording (' + (videoBps/1000000).toFixed(1) + ' Mbps, duration=' + totalDur.toFixed(2) + 's)...');
      await new Promise(function(resolve, reject) {
        var rafId = null;
        var finished = false;
        var onFinish = function() {
          if (finished) return;
          finished = true;
          if (rafId) cancelAnimationFrame(rafId);
          resolve();
        };

        recorder.onstop = onFinish;
        recorder.onerror = function(e) {
          if (finished) return;
          finished = true;
          if (rafId) cancelAnimationFrame(rafId);
          reject(e);
        };

        recorder.start(250);
        if (audioSource) {
          try { audioSource.start(0); } catch (_) {}
        }

        var startTime = performance.now();

        function recordFrame() {
          if (isCancelled) {
            onFinish();
            return;
          }

          var elapsedSec = (performance.now() - startTime) / 1000;

          if (elapsedSec >= totalDur) {
            updateProgress(98, 'Finalizing...', onProgress);
            window.renderCanvasFrame(exportCanvas, ps.bgColor, baseW, baseH, 'export-video', totalDur);
            setTimeout(function() {
              try { recorder.stop(); } catch (_) { onFinish(); }
            }, 80);
            return;
          }

          var pct = 5 + Math.min(92, Math.round((elapsedSec / totalDur) * 92));
          var curFrame = Math.min(totalFrames, Math.round((elapsedSec / totalDur) * totalFrames));
          updateProgress(pct, curFrame + ' / ' + totalFrames, onProgress);

          for (var vi = 0; vi < videoLayers.length; vi++) {
            var vl = videoLayers[vi];
            var s = vl.startSec !== undefined ? vl.startSec : ((vl.startPx || 0) / pps);
            var d = vl.durationSec !== undefined ? vl.durationSec : ((vl.widthPx || 400) / pps);
            var med = window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(vl) : null;
            if (!med || !med.el) continue;
            var el = med.el;

            var vlEff = (typeof window.getLayerEffectivePropsAtTime === 'function') ? window.getLayerEffectivePropsAtTime(vl, elapsedSec) : vl;
            var lSpd = (vlEff && vlEff.speed !== undefined && vlEff.speed > 0) ? vlEff.speed : ((vl.speed !== undefined && vl.speed > 0) ? vl.speed : 1.0);

            if (elapsedSec >= s && elapsedSec < s + d) {
              var targetT = Math.max(0, (vl.sourceOffsetSec || 0) + (elapsedSec - s) * lSpd);
              if (el.paused) {
                try {
                  el.currentTime = targetT;
                  el.playbackRate = lSpd;
                  el.play().catch(function() {});
                } catch (_) {}
              } else {
                var drift = el.currentTime - targetT;
                if (drift < -0.04) {
                  el.playbackRate = lSpd * 1.05;
                } else if (drift > 0.04) {
                  el.playbackRate = lSpd * 0.95;
                } else if (el.playbackRate !== lSpd) {
                  el.playbackRate = lSpd;
                }
              }
            } else {
              if (!el.paused) {
                try { el.playbackRate = 1.0; el.pause(); } catch (_) {}
              }
              if (elapsedSec < s && (s - elapsedSec) <= 0.5 && !el._preSeeked) {
                el._preSeeked = true;
                try { el.currentTime = vl.sourceOffsetSec || 0; } catch (_) {}
              }
            }
          }

          window.renderCanvasFrame(exportCanvas, ps.bgColor, baseW, baseH, 'export-video', elapsedSec);
          if (vTrack && typeof vTrack.requestFrame === 'function') {
            try { vTrack.requestFrame(); } catch (_) {}
          }
          rafId = requestAnimationFrame(recordFrame);
        }

        rafId = requestAnimationFrame(recordFrame);
      });

      if (isCancelled) {
        logExportInfo('MediaRecorder', 'Cancelled by user');
        hideProgress();
        return true;
      }

      var isMp4 = selectedMime.toLowerCase().includes('mp4');
      var outBlob = new Blob(recordedChunks, { type: selectedMime });
      var finalBlob = outBlob;
      logExport('MediaRecorder:Record', 'Recording finished. Chunks: ' + recordedChunks.length + ', Raw size: ' + (outBlob.size / 1024 / 1024).toFixed(2) + ' MB');

      // In Safari, isMp4 is true (native MP4 container). On Chromium/Firefox, repackage WebM to MP4 via FFmpeg:
      if (!isMp4) {
        try {
          updateProgress(96, 'Packaging MP4 container...', onProgress);
          logExportInfo('MediaRecorder:Muxer', 'Repackaging WebM into MP4 via FFmpeg copy...');
          var ffmpeg = await getFFmpeg();
          try { ffmpeg.FS('unlink', 'rec_in.webm'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'rec_out.mp4'); } catch (_) {}
          ffmpeg.FS('writeFile', 'rec_in.webm', new Uint8Array(await outBlob.arrayBuffer()));
          await ffmpeg.run('-i', 'rec_in.webm', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', 'rec_out.mp4');
          var testBytes = ffmpeg.FS('readFile', 'rec_out.mp4');
          if (testBytes && testBytes.length > 0) {
            finalBlob = new Blob([testBytes.buffer], { type: 'video/mp4' });
            logExport('MediaRecorder:Muxer', 'Repackaged to MP4: ' + (finalBlob.size / 1024 / 1024).toFixed(2) + ' MB');
          }
          try { ffmpeg.FS('unlink', 'rec_in.webm'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'rec_out.mp4'); } catch (_) {}
        } catch (_) {}
      }

      var ext = finalBlob.type.includes('webm') ? '.webm' : '.mp4';
      var outFileName = sanitizeName(customName || ps.name) + ext;
      logExport('MediaRecorder:Download', 'Triggering file download: ' + outFileName + ' (' + (finalBlob.size / 1024 / 1024).toFixed(2) + ' MB)');
      updateProgress(100, 'Complete!', onProgress);
      triggerDownload(finalBlob, outFileName);
      setTimeout(hideProgress, 600);
      return true;

    } catch (mrErr) {
      logExportError('MediaRecorder', 'Error in exportViaMediaRecorder:', mrErr);
      return false;
    } finally {
      window.isExporting = false;
      try { if (exportCanvas.parentNode) exportCanvas.parentNode.removeChild(exportCanvas); } catch (_) {}
      savedMuted.forEach(function(wasMuted, el) { try { el.muted = wasMuted; } catch (_) {} });
      if (audioCtx) { try { audioCtx.close(); } catch (_) {} }
      try {
        if (typeof window.redrawComposition === 'function') window.redrawComposition('exportFinished');
      } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────
  async function doExport(options) {
    options = options || {};
    var ps  = window.currentProjectState || {};
    var dims = getProjectDims();
    var fps = parseInt(ps.fps || 60, 10);
    var totalDur = Math.max(0.5, typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : (ps.defaultDuration || 5));
    var totalFrames = Math.max(1, Math.round(totalDur * fps));

    console.log('%c[FishExport] 🎬 EXPORT STARTED', 'background:#059669;color:#ffffff;font-size:13px;font-weight:bold;padding:4px 8px;border-radius:4px;');
    logExportInfo('Init', 'Project: "' + (ps.name || 'Untitled') + '" | Resolution: ' + dims.w + 'x' + dims.h + ' (' + (ps.resolution || '1080p') + ' ' + (ps.aspectRatio || '16:9') + ') | FPS: ' + fps + ' | Duration: ' + totalDur.toFixed(2) + 's (' + totalFrames + ' frames)');
    logExportInfo('Init', 'Layers: ' + (ps.layers ? ps.layers.length : 0) + ' total | Preset: ' + (options.preset || 'normal'));

    if (window.isExporting) {
      logExportWarn('Init', 'Export already in progress. Aborting duplicate request.');
      return;
    }
    isCancelled = false;

    // 1. Tier 1: WebCodecs + Mp4Muxer deterministic frame-by-frame (.mp4)
    var handled = false;
    logExportInfo('Pipeline', 'Attempting Tier 1: GPU WebCodecs + Mp4Muxer...');
    try {
      handled = await exportViaWebCodecs(options);
    } catch (wcErr) {
      logExportWarn('Pipeline', 'Tier 1 WebCodecs threw an unexpected exception: ' + (wcErr ? (wcErr.message || wcErr) : 'unknown') + '. ↳ Gracefully falling back to Tier 2: GPU MediaRecorder...');
    }

    if (handled) {
      logExport('Pipeline', '✅ Tier 1 WebCodecs export finished successfully.');
      return;
    }
    if (isCancelled) {
      logExportInfo('Pipeline', 'Export cancelled by user.');
      return;
    }

    // 2. Tier 2: Native GPU MediaRecorder (.mp4 on Safari 14.1+, .webm on others)
    logExportWarn('Pipeline', 'ℹ️ Tier 1 WebCodecs did not complete. ↳ Gracefully falling back to Tier 2: GPU MediaRecorder...');
    try {
      handled = await exportViaMediaRecorder(options);
    } catch (mrErr) {
      logExportWarn('Pipeline', 'Tier 2 MediaRecorder threw an unexpected exception: ' + (mrErr ? (mrErr.message || mrErr) : 'unknown') + '. ↳ Gracefully falling back to Tier 3: Universal FFmpeg CPU fallback...');
    }

    if (handled) {
      logExport('Pipeline', '✅ Tier 2 MediaRecorder export finished successfully.');
      return;
    }
    if (isCancelled) {
      logExportInfo('Pipeline', 'Export cancelled by user.');
      return;
    }

    // 3. Tier 3: Universal FFmpeg CPU frame sequence (.mp4)
    logExportWarn('Pipeline', 'ℹ️ Tier 2 MediaRecorder did not complete. ↳ Gracefully falling back to Tier 3: Universal FFmpeg CPU fallback...');
    try {
      await exportViaFFmpeg(options);
      logExport('Pipeline', '✅ Tier 3 FFmpeg CPU export finished successfully.');
    } catch (ffErr) {
      logExportError('Pipeline', 'Tier 3 FFmpeg failed:', ffErr);
      hideProgress();
      alert('Video export failed. Please try a different preset or browser.');
    }
  }

  // ── Expose Global ──────────────────────────────────────────────────────────────
  window.FishExportEngine = {
    export:  doExport,
    cancel:  function() {
      isCancelled = true;
      window.isExportCancelled = true;
      window.isExporting = false;
      if (typeof window._cancelEditorExport === 'function') {
        if (!window._isCancellingEditor) {
          window._isCancellingEditor = true;
          try { window._cancelEditorExport(); } catch (_) {}
          window._isCancellingEditor = false;
        }
      }
      cleanupExportResources();
      if (typeof window.cleanupAllStudioCaches === 'function') {
        window.cleanupAllStudioCaches('export_cancelled').catch(function() {});
      }
      setTimeout(hideProgress, 300);
    },
    cleanup: cleanupExportResources,
    get version() {
      return (typeof window !== 'undefined' && window.OFT_VERSION) ? window.OFT_VERSION : '';
    }
  };

  console.info('[FishExport-Enggine] Offline deterministic render engine ready.');
})();
