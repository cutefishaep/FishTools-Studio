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

  // ── Progress UI Helpers ────────────────────────────────────────────────────────
  function showProgress(title, pct, stage) {
    window.isExporting = true;
    isCancelled = false;
    var overlay = document.getElementById('editor-export-progress-overlay');
    var titleEl = document.getElementById('export-progress-title');
    var fillEl  = document.getElementById('export-progress-fill');
    var pctEl   = document.getElementById('export-progress-percent');
    var stageEl = document.getElementById('export-progress-stage');
    if (titleEl)  titleEl.textContent  = title || 'Exporting video...';
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

  // Hook cancel button
  document.addEventListener('DOMContentLoaded', function() {
    var btn = document.getElementById('btn-export-cancel');
    if (btn) {
      btn.addEventListener('click', function() {
        isCancelled = true;
        window.isExporting = false;
        updateProgress(0, 'Cancelling...');
        setTimeout(hideProgress, 300);
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
      throw new Error('[FishExport] FFmpeg library not loaded');
    }
    try { delete window.createFFmpegCore; } catch (_) {}
    var createFFmpeg = window.FFmpeg.createFFmpeg;
    var coreUrl = new URL('vendor/ffmpeg/ffmpeg-core.js?v=' + Date.now(), document.baseURI || window.location.href).href;
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
    if (fetches.length) await Promise.all(fetches);
  }

  function seekVideoToTime(video, target) {
    if (!video || !isFinite(target) || isNaN(target)) return Promise.resolve();
    var dur = isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
    var t = Math.max(0, Math.min(dur, target));
    if (Math.abs(video.currentTime - t) < 0.002 && !video.seeking) return Promise.resolve();
    return new Promise(function(resolve) {
      var done = false;
      var timer = setTimeout(function() { if (!done) { done = true; resolve(); } }, window.isExporting ? 1200 : 2500);
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

  // ── Audio Offline Mixdown ──────────────────────────────────────────────────────
  async function mixAudioBuffer(totalDur) {
    var ps     = window.currentProjectState || {};
    var layers = ps.layers || [];
    var pps    = window.currentPixelsPerSecond || 80;
    var audio  = layers.filter(function(l) {
      return !l.hidden && (l.type === 'audio' || (l.type === 'video' && !l.isMuted));
    });
    if (audio.length === 0 || totalDur <= 0) return null;

    var SR = 44100;
    var AudioCtxClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioCtxClass) return null;

    var ctx   = new AudioCtxClass(2, Math.ceil(totalDur * SR), SR);
    var count = 0;

    for (var i = 0; i < audio.length; i++) {
      var layer = audio[i];
      var tempUrl = null;
      try {
        var url = layer.dataUrl;
        if (!url && layer.mediaId && window.FishDatabase) {
          var item = await window.FishDatabase.getMedia(layer.mediaId);
          if (item && item.blob) { tempUrl = URL.createObjectURL(item.blob); url = tempUrl; }
        }
        if (!url) continue;

        var resp    = await fetch(url);
        var buf     = await resp.arrayBuffer();
        var decoded = null;
        try { decoded = await ctx.decodeAudioData(buf); } catch (_) {}
        if (!decoded) continue;

        var src  = ctx.createBufferSource();
        src.buffer = decoded;
        var gain = ctx.createGain();
        var vol  = layer.volume !== undefined ? Number(layer.volume) : 1.0;
        gain.gain.value = isFinite(vol) ? vol : 1.0;
        src.connect(gain);
        gain.connect(ctx.destination);

        var startSec  = Math.max(0, layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps));
        var offsetSec = Math.max(0, layer.sourceOffsetSec || 0);
        var durSec    = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 400) / pps);
        src.start(startSec, offsetSec, durSec);
        count++;
      } catch (_) {}
      finally { if (tempUrl) try { URL.revokeObjectURL(tempUrl); } catch (_) {} }
    }

    if (count === 0) return null;
    var rendered = await ctx.startRendering();
    var encoder  = window.audioBufferToWav || (typeof audioBufferToWav === 'function' ? audioBufferToWav : null);
    return encoder ? encoder(rendered) : null;
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
  function probeEncoder(config) {
    if (typeof VideoEncoder === 'undefined') return Promise.resolve(false);
    return new Promise(function(resolve) {
      var settled = false, enc = null, frame = null;
      var cleanup = function() {
        try { if (frame) frame.close(); } catch (_) {}
        try { if (enc)   enc.close();   } catch (_) {}
      };
      var done = function(ok) {
        if (settled) return; settled = true; cleanup(); resolve(ok);
      };
      try {
        enc = new VideoEncoder({
          output: function() { done(true); },
          error:  function() { done(false); }
        });
        enc.configure(config);
        var c = document.createElement('canvas');
        c.width = config.width; c.height = config.height;
        frame = new VideoFrame(c, { timestamp: 0, duration: 16666 });
        enc.encode(frame, { keyFrame: true });
        enc.flush().then(function() { done(true); }).catch(function() { done(false); });
      } catch (_) { done(false); }
      setTimeout(function() { done(false); }, 150);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PATH 1: WebCodecs + Mp4Muxer (primary — deterministic frame-by-frame)
  // ─────────────────────────────────────────────────────────────────────────────
  async function exportViaWebCodecs(options) {
    var preset     = options.preset     || 'normal';
    var customName = options.customName || '';
    var onProgress = options.onProgress;

    if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') return false;
    if (typeof window.renderCanvasFrame !== 'function') return false;

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

    var candidates = [
      { codec: 'avc1.42002a', muxerCodec: 'avc' },
      { codec: 'avc1.420033', muxerCodec: 'avc' },
      { codec: 'avc1.42e02a', muxerCodec: 'avc' },
      { codec: 'avc1.4d402a', muxerCodec: 'avc' },
      { codec: 'avc1.64002a', muxerCodec: 'avc' },
      { codec: 'vp09.00.10.08', muxerCodec: 'vp9' },
      { codec: 'vp09.02.10.10', muxerCodec: 'vp9' }
    ];

    var chosenCodec = null, chosenConfig = null;
    var hwModes  = ['no-preference', 'prefer-software', 'prefer-hardware'];
    var brModes  = bitrateMode === 'variable' ? ['variable'] : [bitrateMode, 'variable'];
    var latModes = ['realtime', 'quality'];

    outer:
    for (var ci = 0; ci < candidates.length; ci++) {
      var cand = candidates[ci];
      for (var hi = 0; hi < hwModes.length; hi++) {
        for (var bi = 0; bi < brModes.length; bi++) {
          for (var li = 0; li < latModes.length; li++) {
            var cfg = {
              codec: cand.codec, width: baseW, height: baseH,
              bitrate: videoBps, bitrateMode: brModes[bi],
              framerate: fps, latencyMode: latModes[li],
              hardwareAcceleration: hwModes[hi]
            };
            if (cand.codec.startsWith('avc1')) cfg.avc = { format: 'avc' };
            try {
              var check = await VideoEncoder.isConfigSupported(cfg);
              if (check && check.supported) {
                var verified = await probeEncoder(cfg);
                if (verified) { chosenCodec = cand; chosenConfig = cfg; break outer; }
              }
            } catch (_) {}
          }
        }
      }
    }

    if (!chosenCodec || !chosenConfig) return false;

    showProgress('Exporting video...', 0, 'Preparing...');
    var cacheOk = await ensureVideosCached(onProgress);
    if (!cacheOk) return false;
    if (isCancelled) return true;

    window.isExporting = true;
    var exportCanvas = document.createElement('canvas');
    exportCanvas.width  = baseW;
    exportCanvas.height = baseH;

    try {
      updateProgress(3, 'Mixing audio...', onProgress);
      var wavBlob = null;
      try { wavBlob = await mixAudioBuffer(totalDur); } catch (_) {}
      if (isCancelled) { hideProgress(); return true; }

      var muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: chosenCodec.muxerCodec, width: baseW, height: baseH },
        firstTimestampBehavior: 'offset',
        fastStart: 'in-memory'
      });

      var frameDurMicros = Math.round(1000000 / fps);
      var encError = null;
      var lastTs   = -1;

      var encoder = new VideoEncoder({
        output: function(chunk, meta) {
          try {
            var data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            // Use chunk.timestamp directly — it is set from VideoFrame.timestamp (i/fps * 1e6)
            // which is deterministic and monotonically increasing. Trust it.
            var ts  = (Number.isFinite(chunk.timestamp) && chunk.timestamp >= 0) ? chunk.timestamp : 0;
            var dur = (Number.isFinite(chunk.duration)  && chunk.duration  >  0) ? chunk.duration  : frameDurMicros;
            muxer.addVideoChunkRaw(data, chunk.type, ts, dur, meta);
          } catch (e) { encError = e; }
        },
        error: function(e) { encError = e; }
      });
      encoder.configure(chosenConfig);

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
      for (var i = 0; i < totalFrames; i++) {
        if (isCancelled || encError) {
          try { encoder.close(); } catch (_) {}
          hideProgress();
          return true;
        }

        var t = i / fps; // EXACT — never performance.now()

        await prepareFrameAtTime(t, videoLayers, pps);
        window.renderCanvasFrame(exportCanvas, ps.bgColor, baseW, baseH, 'export-video', t);

        // Backpressure guard
        while (encoder.encodeQueueSize > 2) {
          await new Promise(function(r) {
            var settled = false;
            var onDeq = function() {
              if (!settled) { settled = true; encoder.removeEventListener('dequeue', onDeq); r(); }
            };
            encoder.addEventListener('dequeue', onDeq);
            setTimeout(onDeq, 8);
          });
        }

        var frameTs = Math.round((i / fps) * 1000000);
        var vFrame  = null;
        try {
          vFrame = new VideoFrame(exportCanvas, { timestamp: frameTs, duration: frameDurMicros });
        } catch (_) {
          if (encoder.encodeQueueSize > 0) {
            await new Promise(function(r) {
              var d = false;
              var onD = function() { if (!d) { d = true; encoder.removeEventListener('dequeue', onD); r(); } };
              encoder.addEventListener('dequeue', onD);
              setTimeout(onD, 40);
            });
          }
          try {
            vFrame = new VideoFrame(exportCanvas, { timestamp: frameTs, duration: frameDurMicros });
          } catch (_2) {
            var bmp = await createImageBitmap(exportCanvas);
            vFrame = new VideoFrame(bmp, { timestamp: frameTs, duration: frameDurMicros });
            bmp.close();
          }
        }

        var isKey = (i % (fps * 2)) === 0;
        encoder.encode(vFrame, { keyFrame: isKey });
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
        updateProgress(pct, 'Rendering frame ' + (i + 1) + ' / ' + totalFrames, onProgress);
        if (i % 6 === 0) await new Promise(function(r) { setTimeout(r, 0); });
      }

      if (isCancelled || encError) {
        try { encoder.close(); } catch (_) {}
        hideProgress();
        return true;
      }

      updateProgress(95, 'Finalizing...', onProgress);
      await encoder.flush();
      muxer.finalize();

      var videoBuffer = muxer.target.buffer;
      var finalBlob   = null;

      // Merge audio via FFmpeg stream copy
      if (wavBlob && wavBlob.size > 100) {
        try {
          var ffmpeg = await getFFmpeg();
          try { ffmpeg.FS('unlink', 'v_temp.mp4'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'a_temp.wav'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'out_merged.mp4'); } catch (_) {}
          ffmpeg.FS('writeFile', 'v_temp.mp4', new Uint8Array(videoBuffer));
          ffmpeg.FS('writeFile', 'a_temp.wav', new Uint8Array(await wavBlob.arrayBuffer()));
          await ffmpeg.run('-i', 'v_temp.mp4', '-i', 'a_temp.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-strict', '-2', '-shortest', 'out_merged.mp4');
          var merged = ffmpeg.FS('readFile', 'out_merged.mp4');
          finalBlob = new Blob([merged.buffer], { type: 'video/mp4' });
          try { ffmpeg.FS('unlink', 'v_temp.mp4'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'a_temp.wav'); } catch (_) {}
          try { ffmpeg.FS('unlink', 'out_merged.mp4'); } catch (_) {}
        } catch (mergeErr) {
          console.warn('[FishExport:AudioMerge] Audio merge failed, video only:', mergeErr);
          finalBlob = new Blob([videoBuffer], { type: 'video/mp4' });
        }
      } else {
        finalBlob = new Blob([videoBuffer], { type: 'video/mp4' });
      }

      updateProgress(100, 'Complete!', onProgress);
      triggerDownload(finalBlob, sanitizeName(customName || ps.name) + '.mp4');
      setTimeout(hideProgress, 600);
      return true;

    } catch (err) {
      console.error('[FishExport:WebCodecs] Fatal error:', err);
      return false;
    } finally {
      window.isExporting = false;
      try {
        if (typeof window.redrawComposition === 'function') window.redrawComposition('exportFinished');
      } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PATH 2: FFmpeg.wasm frame sequence (CPU fallback)
  // ─────────────────────────────────────────────────────────────────────────────
  async function exportViaFFmpeg(options) {
    var preset     = options.preset     || 'normal';
    var customName = options.customName || '';
    var onProgress = options.onProgress;

    if (typeof window.renderCanvasFrame !== 'function') {
      console.error('[FishExport:FFmpeg] renderCanvasFrame not available');
      return;
    }

    showProgress('Exporting video (FFmpeg CPU)...', 0, 'Initializing FFmpeg...');
    var cacheOk = await ensureVideosCached(onProgress);
    if (!cacheOk) return;

    var ffmpeg;
    try {
      ffmpeg = await getFFmpeg();
    } catch (err) {
      hideProgress();
      alert('[FishExport] Failed to load FFmpeg WebAssembly. Check vendor files.');
      return;
    }
    if (isCancelled) { hideProgress(); return; }

    var ps          = window.currentProjectState || {};
    var fps         = parseInt(ps.fps || 60, 10);
    var totalDur    = Math.max(0.5, typeof window.getProjectTotalDuration === 'function' ? window.getProjectTotalDuration() : (ps.defaultDuration || 5));
    var totalFrames = Math.max(1, Math.round(totalDur * fps));
    var dims        = getProjectDims();
    var baseW = dims.w, baseH = dims.h;
    var pps   = window.currentPixelsPerSecond || 80;

    window.isExporting = true;

    try {
      updateProgress(5, 'Mixing audio...', onProgress);
      var wavBlob = null;
      try { wavBlob = await mixAudioBuffer(totalDur); } catch (_) {}
      var hasAudio = false;
      if (wavBlob && wavBlob.size > 100) {
        try {
          ffmpeg.FS('writeFile', 'audio.wav', new Uint8Array(await wavBlob.arrayBuffer()));
          hasAudio = true;
        } catch (_) {}
      }
      if (isCancelled) { hideProgress(); return; }

      var exportCanvas = document.createElement('canvas');
      exportCanvas.width  = baseW;
      exportCanvas.height = baseH;
      var videoLayers = (ps.layers || []).filter(function(l) { return l.type === 'video' && !l.hidden; });
      var created = [];

      for (var i = 0; i < totalFrames; i++) {
        if (isCancelled) {
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
        updateProgress(pct, 'Rendering frame ' + (i + 1) + ' / ' + totalFrames, onProgress);
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

      // -framerate: force CFR input rate (JPEG sequence has no timestamps — without this → VFR → speed-up bug)
      // -r: force CFR output rate (locks container to exact project fps)
      // -vsync cfr: strictly enforce constant frame rate in output stream
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

      updateProgress(100, 'Complete!', onProgress);
      triggerDownload(outBlob, sanitizeName(customName || ps.name) + '.mp4');
      setTimeout(hideProgress, 600);

    } catch (err) {
      console.error('[FishExport:FFmpeg] Fatal error:', err);
      hideProgress();
      alert('Export failed: ' + (err.message || err));
    } finally {
      window.isExporting = false;
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
    if (window.isExporting) {
      console.warn('[FishExport] Export already in progress.');
      return;
    }
    isCancelled = false;

    // Primary: WebCodecs deterministic frame-by-frame (.mp4)
    var handled = false;
    try {
      handled = await exportViaWebCodecs(options);
    } catch (wcErr) {
      console.warn('[FishExport] WebCodecs failed, FFmpeg fallback:', wcErr);
    }

    if (!handled) {
      // Fallback: FFmpeg CPU frame sequence (.mp4)
      await exportViaFFmpeg(options);
    }
  }

  // ── Expose Global ──────────────────────────────────────────────────────────────
  window.FishExportEngine = {
    export:  doExport,
    cancel:  function() { isCancelled = true; window.isExporting = false; setTimeout(hideProgress, 300); },
    version: '0.4.8'
  };

  console.info('[FishExport-Enggine] v0.4.8 loaded. Offline deterministic render engine ready.');
})();
