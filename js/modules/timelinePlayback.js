function renderMarkerPin(sec, container) {
  var targetContainer = container || document.getElementById('rulerMarksWrapper') || document.getElementById('timeRulerMarks');
  if (!targetContainer) return;

  var pin = document.createElement('div');
  pin.className = 'timeline-marker-pin';
  pin.dataset.second = sec;
  pin.style.left = (sec * PX_PER_SEC) + 'px';
  pin.title = 'Marker: ' + formatTime(sec) + ' (Klik untuk melompat ke titik ini)';
  pin.innerHTML = '<div class="marker-diamond"></div><div class="marker-line"></div>';

  pin.addEventListener('click', function(e) {
    e.stopPropagation();
    setTimelineOffset(sec * PX_PER_SEC);
  });

  targetContainer.appendChild(pin);
}

function toggleMarkerAtCurrent() {
  var curSec = Math.round((timelineOffset / PX_PER_SEC) * 10) / 10;
  var existingIdx = markers.findIndex(function(m) { return Math.abs(m - curSec) <= 0.25; });

  if (existingIdx >= 0) {
    var removedSec = markers[existingIdx];
    markers.splice(existingIdx, 1);
    rebuildTimeRuler(totalDuration);
    updateMarkerButtonsUI(false);
    recordAction({ type: 'REMOVE_MARKER', second: removedSec });
    triggerAutoSave();
  } else {
    markers.push(curSec);
    markers.sort(function(a, b) { return a - b; });
    rebuildTimeRuler(totalDuration);
    updateMarkerButtonsUI(true);
    recordAction({ type: 'ADD_MARKER', second: curSec });
    triggerAutoSave();
  }
}

function removeMarker(sec) {
  var idx = markers.findIndex(function(m) { return Math.abs(m - sec) <= 0.25; });
  if (idx >= 0) {
    var removedSec = markers[idx];
    markers.splice(idx, 1);
    rebuildTimeRuler(totalDuration);
    updateMarkerButtonsUI(false);
    recordAction({ type: 'REMOVE_MARKER', second: removedSec });
    triggerAutoSave();
  }
}

function updateMarkerButtonsUI(isActive) {
  document.querySelectorAll('[title="Bookmark"]').forEach(function(btn) {
    btn.classList.toggle('btn-marker-active', isActive);
  });
}

function skipPrevious() {
  var cur = elapsed;
  var stops = new Set([0]);
  markers.forEach(function(m) { stops.add(m); });

  if (selectedTrackRow) {
    var id = selectedTrackRow.dataset.layerId;
    if (id) {
      var kfs = layerKeyframes.get(id) || [];
      kfs.forEach(function(k) { stops.add(k.time); });
      var clip = selectedTrackRow.querySelector('.track-clip');
      if (clip) {
        var startSec = (parseFloat(clip.style.marginLeft) || 0) / PX_PER_SEC;
        var durSec = (parseFloat(clip.style.width) || 300) / PX_PER_SEC;
        stops.add(startSec);
        stops.add(startSec + durSec);
      }
    }
  }

  var prevStops = Array.from(stops).filter(function(s) { return s < cur - 0.05; }).sort(function(a, b) { return a - b; });
  if (prevStops.length > 0) {
    setTimelineOffset(prevStops[prevStops.length - 1] * PX_PER_SEC);
  } else {
    setTimelineOffset(0);
  }
}

function skipNext() {
  var cur = elapsed;
  var maxSec = calculateMaxDuration();
  var stops = new Set([maxSec]);
  markers.forEach(function(m) { stops.add(m); });

  if (selectedTrackRow) {
    var id = selectedTrackRow.dataset.layerId;
    if (id) {
      var kfs = layerKeyframes.get(id) || [];
      kfs.forEach(function(k) { stops.add(k.time); });
      var clip = selectedTrackRow.querySelector('.track-clip');
      if (clip) {
        var startSec = (parseFloat(clip.style.marginLeft) || 0) / PX_PER_SEC;
        var durSec = (parseFloat(clip.style.width) || 300) / PX_PER_SEC;
        stops.add(startSec);
        stops.add(startSec + durSec);
      }
    }
  }

  var nextStops = Array.from(stops).filter(function(s) { return s > cur + 0.05; }).sort(function(a, b) { return a - b; });
  if (nextStops.length > 0) {
    setTimelineOffset(nextStops[0] * PX_PER_SEC);
  } else {
    setTimelineOffset(maxSec * PX_PER_SEC);
  }
}

function syncAudioPlayback() {
  var rows = document.querySelectorAll('.track-row');
  rows.forEach(function(row) {
    var layerId = row.dataset.layerId;
    var cat = row.dataset.category;
    var clip = row.querySelector('.track-clip');
    if (!clip || !layerId) return;

    var fill = getLayerFill(layerId);
    var clipNameEl = row.querySelector('.track-clip-name');
    var clipName = clipNameEl ? clipNameEl.textContent.trim() : '';

    var audioUrl = null;
    if (cat === 'audio') {
      audioUrl = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(fill ? fill.mediaUrl : null) : (fill ? fill.mediaUrl : null);
    } else {
      var seq = videoFrameSequenceMap.get(fill && fill.mediaUrl) || videoFrameSequenceMap.get(layerId) || (clipName && videoFrameSequenceMap.get(clipName));
      if (seq && (seq.audioUrl || seq.audioBlob)) {
        if (!seq.audioUrl && seq.audioBlob) {
          seq.audioUrl = URL.createObjectURL(seq.audioBlob);
        }
        audioUrl = seq.audioUrl;
      }
    }

    var isValidAudioUri = typeof audioUrl === 'string' && audioUrl.length > 5 && !audioUrl.startsWith('video_pkg_') && !audioUrl.startsWith('pkg_') && !audioUrl.startsWith('[') && (audioUrl.startsWith('http://') || audioUrl.startsWith('https://') || audioUrl.startsWith('blob:') || audioUrl.startsWith('data:audio/') || audioUrl.startsWith('data:video/'));

    if (!isValidAudioUri) {
      var existingAudio = layerAudioMap.get(layerId);
      if (existingAudio && !existingAudio.paused) {
        existingAudio.pause();
      }
      return;
    }

    var audio = layerAudioMap.get(layerId);
    if (!audio || audio.src !== audioUrl) {
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      audio = new Audio(audioUrl);
      audio.preload = 'auto';
      layerAudioMap.set(layerId, audio);
    }

    var eye = row.querySelector('.track-eye .material-symbols-rounded');
    var isMuted = eye && (eye.textContent.trim() === 'volume_off' || eye.textContent.trim() === 'visibility_off');

    var marginLeft = parseFloat(clip.style.marginLeft) || 0;
    var width = parseFloat(clip.style.width) || clip.offsetWidth || 300;
    var startTime = marginLeft / PX_PER_SEC;
    var clipDuration = width / PX_PER_SEC;

    audio.muted = !!isMuted;

    var inRange = (elapsed >= startTime && elapsed < startTime + clipDuration);
    var clipOffset = parseFloat(row.dataset.mediaOffset || (fill && fill.mediaOffset) || 0) || 0;
    var currentAudioTime = Math.max(0, clipOffset + (elapsed - startTime));

    if (playing && inRange && !isMuted) {
      if (Math.abs(audio.currentTime - currentAudioTime) > 0.35) {
        audio.currentTime = currentAudioTime;
      }
      if (audio.paused) {
        audio.play().catch(function() {});
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
      if (!playing && Math.abs(audio.currentTime - currentAudioTime) > 0.05) {
        audio.currentTime = currentAudioTime;
      }
    }
  });
}

function syncVideoPlayback(isScrubbing) {
  isScrubbing = isScrubbing || false;
  var metrics = (typeof layerMetricsCache !== 'undefined' && layerMetricsCache.size > 0) ? layerMetricsCache : null;
  if (metrics) {
    metrics.forEach(function(metric) {
      var id = metric.id;
      var fill = getLayerFill(id);
      if (!fill || fill.type !== 'media' || !fill.mediaUrl) return;
      var isFrameSeq = (fill.mediaUrl.startsWith('video_pkg_') || fill.mediaUrl.startsWith('pkg_') || videoFrameSequenceMap.has(fill.mediaUrl) || videoFrameSequenceMap.has(id) || (metric.clipName && videoFrameSequenceMap.has(metric.clipName)));
      if (isFrameSeq) {
        applyFillToMeshGlobal(id);
      }
    });
    return;
  }

  var rows = document.querySelectorAll('.track-row');
  rows.forEach(function(row) {
    var layerId = row.dataset.layerId;
    if (!layerId) return;

    var fill = getLayerFill(layerId);
    if (!fill || fill.type !== 'media' || !fill.mediaUrl) return;

    var clipNameEl = row.querySelector('.track-clip-name');
    var clipName = clipNameEl ? clipNameEl.textContent.trim() : '';
    var isFrameSeq = (fill.mediaUrl.startsWith('video_pkg_') || fill.mediaUrl.startsWith('pkg_') || videoFrameSequenceMap.has(fill.mediaUrl) || videoFrameSequenceMap.has(layerId) || (clipName && videoFrameSequenceMap.has(clipName)));
    if (isFrameSeq) {
      applyFillToMeshGlobal(layerId);
    }
  });
}

function togglePlayPause() {
  playing ? pausePlayback() : startPlayback();
}

function startPlayback() {
  var maxSec = calculateMaxDuration();
  if (elapsed >= maxSec) {
    setTimelineOffset(0);
  }

  playing = true;
  setPlayIcons('pause');
  if (typeof refreshTrackMetricsCache === 'function') {
    refreshTrackMetricsCache();
  }

  syncAudioPlayback();
  syncVideoPlayback();

  var startPlaybackTime = elapsed;
  var startPerformanceNow = performance.now();

  function tick(now) {
    if (!playing) return;
    var curElapsed = startPlaybackTime + (now - startPerformanceNow) / 1000;
    if (curElapsed >= totalDuration) {
      setTimelineOffset(totalDuration * PX_PER_SEC);
      pausePlayback();
      return;
    }

    setTimelineOffset(curElapsed * PX_PER_SEC);
    animFrameId = requestAnimationFrame(tick);
  }

  animFrameId = requestAnimationFrame(tick);
}

function pausePlayback() {
  playing = false;
  setPlayIcons('play_arrow');
  if (animFrameId) cancelAnimationFrame(animFrameId);
  var video = document.getElementById('canvasVideo');
  if (video && typeof video.pause === 'function') {
    video.pause();
  }
  layerAudioMap.forEach(function(audio) {
    if (audio && typeof audio.pause === 'function' && !audio.paused) {
      audio.pause();
    }
  });
  if (selectedTrackRow && typeof renderCanvasOverlay === 'function') {
    renderCanvasOverlay();
  }
}

function setPlayIcons(iconName) {
  document.querySelectorAll('.play-icon').forEach(function(icon) {
    icon.textContent = iconName;
  });
}

function formatTime(s) {
  var totalFrames = Math.floor((s || 0) * projectFps);
  var frame = totalFrames % projectFps;
  var totalSecs = Math.floor(s || 0);
  var m = String(Math.floor(totalSecs / 60)).padStart(2, '0');
  var sec = String(totalSecs % 60).padStart(2, '0');
  var f = String(frame).padStart(2, '0');
  return m + ':' + sec + ':' + f;
}

function renderTimecode() {
  var display = document.getElementById('timecodeDisplay');
  if (display) {
    display.textContent = formatTime(elapsed);
  }
}

window.renderMarkerPin = renderMarkerPin;
window.toggleMarkerAtCurrent = toggleMarkerAtCurrent;
window.removeMarker = removeMarker;
window.updateMarkerButtonsUI = updateMarkerButtonsUI;
window.skipPrevious = skipPrevious;
window.skipNext = skipNext;
window.syncAudioPlayback = syncAudioPlayback;
window.syncVideoPlayback = syncVideoPlayback;
window.togglePlayPause = togglePlayPause;
window.startPlayback = startPlayback;
window.pausePlayback = pausePlayback;
window.setPlayIcons = setPlayIcons;
window.formatTime = formatTime;
window.renderTimecode = renderTimecode;
