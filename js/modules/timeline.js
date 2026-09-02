function initTimelineZoomAndPreventWebZoom() {
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const isOverTimeline = e.target.closest('#timelineRuler, #timeRulerMarks, .timeline-panel, .timeline-track-area, #timelineTracks, .track-row');
      if (isOverTimeline) {
        const zoomFactor = e.deltaY < 0 ? 1.12 : (1 / 1.12);
        zoomTimeline(zoomFactor);
      }
    }
  }, { passive: false });

  window.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
  const ruler = document.getElementById('timelineRuler') || document.getElementById('timeRulerMarks');
  if (ruler) {
    ruler.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const zoomFactor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
      zoomTimeline(zoomFactor);
    }, { passive: false });
  }
  const timelinePanel = document.querySelector('.timeline-panel') || document.querySelector('.timeline-track-area') || document.getElementById('timelineTracks');
  if (timelinePanel) {
    let initialTouchDistance = null;

    timelinePanel.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 2) {
        initialTouchDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    timelinePanel.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length === 2 && initialTouchDistance !== null) {
        e.preventDefault();
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const ratio = currentDist / initialTouchDistance;
        if (Math.abs(ratio - 1.0) > 0.04) {
          zoomTimeline(ratio > 1 ? 1.06 : 0.94);
          initialTouchDistance = currentDist;
        }
      }
    }, { passive: false });

    timelinePanel.addEventListener('touchend', (e) => {
      if (!e.touches || e.touches.length < 2) {
        initialTouchDistance = null;
      }
    }, { passive: true });
  }
}


let clipboardLayerData = null;

function calculateMaxDuration() {
  let maxPx = 0;
  document.querySelectorAll('.track-row').forEach(row => {
    const clip = row.querySelector('.track-clip');
    if (clip) {
      const margin = parseFloat(clip.style.marginLeft) || 0;
      let width    = parseFloat(clip.style.width);
      if (!width || isNaN(width)) {
        width = clip.offsetWidth || 300;
      }
      const endPx  = margin + width;
      if (endPx > maxPx) maxPx = endPx;
    }
  });

  maxPx = Math.max(200, maxPx);
  totalDuration = Math.ceil(maxPx / PX_PER_SEC);
  rebuildTimeRuler(totalDuration);
  renderTimecode();
  return totalDuration;
}

function rebuildTimeRuler(maxSecs) {
  const rulerMarks = document.getElementById('timeRulerMarks');
  if (!rulerMarks) return;

  rulerMarks.innerHTML = '';
  rulerMarks.style.minWidth = `${maxSecs * PX_PER_SEC + 600}px`;

  const wrapper = document.createElement('div');
  wrapper.className = 'ruler-marks-wrapper';
  wrapper.id = 'rulerMarksWrapper';
  let stepSec = 1.0;
  if (PX_PER_SEC >= 220) {
    stepSec = 0.25;
  } else if (PX_PER_SEC >= 115) {
    stepSec = 0.5;
  } else if (PX_PER_SEC >= 55) {
    stepSec = 1.0;
  } else if (PX_PER_SEC >= 28) {
    stepSec = 2.0;
  } else {
    stepSec = 5.0;
  }

  const stepPx = stepSec * PX_PER_SEC;

  for (let s = 0; s <= maxSecs; s = Math.round((s + stepSec) * 100) / 100) {
    const timeText = (typeof formatTime === 'function') ? formatTime(s) : `${s}`;
    const span = document.createElement('span');
    span.className = 'ruler-mark';
    span.style.width = `${stepPx}px`;
    span.innerHTML = `<span class="ruler-mark-text">${timeText}</span>`;
    wrapper.appendChild(span);
  }

  markers.forEach(sec => {
    if (sec <= maxSecs) {
      renderMarkerPin(sec, wrapper);
    }
  });

  rulerMarks.appendChild(wrapper);
}

function setTimelineOffset(newOffset, isScrubbing = false) {
  const maxOffset = totalDuration * PX_PER_SEC;
  timelineOffset = Math.max(0, Math.min(maxOffset, newOffset));
  const fps = Number(projectFps) || 30;
  const rawElapsed = timelineOffset / PX_PER_SEC;
  elapsed = Math.round(rawElapsed * fps) / fps;
  renderTimecode();

  const rulerMarks = document.getElementById('timeRulerMarks');
  if (rulerMarks) {
    rulerMarks.style.transform = `translateX(-${timelineOffset}px)`;
  }

  document.querySelectorAll('.track-trackway').forEach(tw => {
    tw.style.transform = `translateX(-${timelineOffset}px)`;
  });

  if (!playing) {
    const isAtMarker = markers.some(m => Math.abs(m - elapsed) <= 0.25);
    updateMarkerButtonsUI(isAtMarker);
  }

  document.querySelectorAll('.track-row').forEach(row => {
    const id = row.dataset.layerId;
    if (id) {
      const wt = (typeof getLayerWorldTransform === 'function') ? getLayerWorldTransform(id, new Set(), elapsed) : getLayerTransform(id);
      applyTransformToThreeMesh(id, wt);
      const fill = getLayerFill(id);
      const cat = row.dataset.category;
      const kfs = (typeof layerKeyframes !== 'undefined' && layerKeyframes.get(id)) || [];
      const exps = (typeof getLayerExpressions === 'function') ? getLayerExpressions(id) : {};
      let hasEffectKf = false;
      for (let i = 0; i < kfs.length; i++) {
        const k = kfs[i];
        for (const p in k) {
          if (p.startsWith('fx_')) {
            hasEffectKf = true;
            break;
          }
        }
        if (hasEffectKf) break;
      }
      const hasTextKf = kfs.some(k => k.textAnimStart !== undefined || k.textAnimEnd !== undefined || k.textAnimOffset !== undefined || k.textSize !== undefined || k.textTracking !== undefined);
      const hasTextExp = !!(exps.textAnimStart || exps.textAnimOffset || exps.textAnimEnd);
      const animators = (typeof layerTextAnimators !== 'undefined' && layerTextAnimators.get(id)) || [];
      const hasTextAnim = (cat === 'text') && (hasTextKf || hasTextExp || (animators.length > 0 && animators.some(a => a.enabled !== false)));
      const clip = row.querySelector('.track-clip');
      const clipName = row.querySelector('.track-clip-name')?.textContent.trim() || '';
      const clipMargin = parseFloat(clip?.style?.marginLeft) || 0;
      const clipWidth = parseFloat(clip?.style?.width) || 300;
      const layerStartSec = clipMargin / PX_PER_SEC;
      const layerEndSec = (clipMargin + clipWidth) / PX_PER_SEC;
      const isLayerActiveAtTime = (elapsed >= layerStartSec - 0.05 && elapsed <= layerEndSec + 0.05);

      const effects = (typeof getLayerEffects === 'function') ? getLayerEffects(id) : [];
      const hasCopyBg = effects.some(e => e && e.enabled !== false && (e.type === 'copy_background' || e.type === 'copybackground'));

      if ((hasEffectKf || hasCopyBg) && isLayerActiveAtTime) {
        const mesh = (typeof meshLayerMap !== 'undefined') ? meshLayerMap.get(id) : null;
        if (mesh && mesh.material) {
          const tex = (typeof getBlurredTextureForLayer === 'function') ? getBlurredTextureForLayer(id, 0) : null;
          if (tex) {
            if (mesh.material.type === 'ShaderMaterial' && mesh.material.uniforms && mesh.material.uniforms.map) {
              mesh.material.uniforms.map.value = tex;
            } else {
              mesh.material.map = tex;
              if (mesh.material.color) mesh.material.color = new THREE.Color('#FFFFFF');
              mesh.material.needsUpdate = true;
            }
          }
        }
      } else if (isLayerActiveAtTime && (hasTextAnim || (fill && fill.type === 'media' && (videoFrameSequenceMap.has(fill.mediaUrl) || videoFrameSequenceMap.has(id) || (clipName && videoFrameSequenceMap.has(clipName)))))) {
        applyFillToMeshGlobal(id);
      }
    }
  });

  if (selectedTrackRow && !playing) {
    updateInspectorQuickButtons();
    syncControllerUI();
    if (typeof syncEffectControllersUI === 'function') {
      syncEffectControllersUI(selectedTrackRow.dataset.layerId);
    }
  }

  if (!isScrubbing && !playing) {
    try {
      document.querySelectorAll('.track-row').forEach(row => {
        const id = row.dataset.layerId;
        if (!id) return;
        const skfs = layerKeyframes.get(id);
        if (skfs && skfs.some(k=>k.strokeSize!==undefined||k.strokeColor!==undefined||k.shadowSize!==undefined||k.shadowAlpha!==undefined||k.shadowPosX!==undefined||k.shadowPosY!==undefined||k.shadowColor!==undefined)) {
          applyFillToMeshGlobal(id);
        }
      });
    } catch(e) {}

    if (isMultiSelectMode) {
      updateMultiSelectQuickButtons();
    }

    renderAllKeyframeMarkers();
  }

  const pg = document.getElementById('panelGraphEditor');
  if (pg && pg.style.display !== 'none' && !isScrubbing && !playing) {
    renderGraphCanvas();
  }

  render3D();
  if (selectedTrackRow && typeof renderCanvasOverlay === 'function' && !isScrubbing && !playing) {
    renderCanvasOverlay();
  }
  if (!playing) {
    syncAudioPlayback();
  }
  syncVideoPlayback(isScrubbing);
}

const layerAudioMap = new Map();

let _isGestureActive = false;
let _undoGroupDepth = 0;
let _undoGroupInitialSnapshot = null;

let isProgrammaticScrolling = false;

function initTimelineScrollAndScrub() {
  const viewport = document.getElementById('tracksViewport');
  const timecode = document.getElementById('timecodeDisplay');
  if (!viewport) return;

  let isDown = false;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let startScrollTop = 0;
  let downTimestamp = 0;
  let isRowTarget = false;
  let scrubRafId = null;
  let pendingScrubOffset = null;

  function scheduleScrub(offset) {
    if (playing) {
      pausePlayback();
    }
    pendingScrubOffset = offset;
    if (!scrubRafId) {
      scrubRafId = requestAnimationFrame(() => {
        scrubRafId = null;
        if (pendingScrubOffset !== null) {
          setTimelineOffset(pendingScrubOffset, true);
        }
      });
    }
  }

  viewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, .track-eye, .track-del-btn, .timeline-marker-pin, .clip-extend-handle, .clip-keyframe-marker, .clip-keyframes-container, .layer-options-popup')) return;

    if (playing) {
      pausePlayback();
    }
    isDown = true;
    viewport.classList.add('is-dragging');
    startX = e.pageX;
    startY = e.pageY;
    startOffset = timelineOffset;
    startScrollTop = viewport.scrollTop;
    downTimestamp = performance.now();
    isRowTarget = !!e.target.closest('.track-clip');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const dx = e.pageX - startX;
    const dy = e.pageY - startY;

    scheduleScrub(startOffset - dx);

    if (!selectedTrackRow) {
      viewport.scrollTop = startScrollTop - dy;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isDown) {
      const dx = Math.abs(e.pageX - startX);
      const dy = Math.abs(e.pageY - startY);

      isDown = false;
      viewport.classList.remove('is-dragging');

      if (scrubRafId) {
        cancelAnimationFrame(scrubRafId);
        scrubRafId = null;
      }
      setTimelineOffset(timelineOffset, false);
      if (!isRowTarget && dx < 6 && dy < 6) {
        if (selectedTrackRow) {
          deselectTrack();
        }
      }
    }
  });

  viewport.addEventListener('touchstart', (e) => {
    if (e.target.closest('button, .track-eye, .track-del-btn, .timeline-marker-pin, .clip-extend-handle, .clip-keyframe-marker, .clip-keyframes-container, .layer-options-popup')) return;
    const touch = e.touches[0];
    isDown = true;
    startX = touch.pageX;
    startY = touch.pageY;
    startOffset = timelineOffset;
    startScrollTop = viewport.scrollTop;
    downTimestamp = performance.now();
    isRowTarget = !!e.target.closest('.track-clip');
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (!isDown) return;
    const touch = e.touches[0];
    const dx = touch.pageX - startX;
    const dy = touch.pageY - startY;

    scheduleScrub(startOffset - dx);

    if (!selectedTrackRow) {
      viewport.scrollTop = startScrollTop - dy;
    }
  }, { passive: true });

  viewport.addEventListener('touchend', (e) => {
    if (isDown) {
      const touch = e.changedTouches ? e.changedTouches[0] : null;
      const curX = touch ? touch.pageX : startX;
      const curY = touch ? touch.pageY : startY;
      const dx = Math.abs(curX - startX);
      const dy = Math.abs(curY - startY);

      isDown = false;

      if (scrubRafId) {
        cancelAnimationFrame(scrubRafId);
        scrubRafId = null;
      }
      setTimelineOffset(timelineOffset, false);
      if (!isRowTarget && dx < 8 && dy < 8) {
        if (selectedTrackRow) {
          deselectTrack();
        }
      }
    }
  });

  viewport.addEventListener('wheel', (e) => {
    if (selectedTrackRow || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      setTimelineOffset(timelineOffset + (e.deltaX || e.deltaY));
    } else {
      viewport.scrollTop += e.deltaY;
    }
  }, { passive: false });

  if (timecode) {
    timecode.addEventListener('click', () => {
      setTimelineOffset(timelineOffset + 5 * PX_PER_SEC);
    });
  }
}

function initPreviewControls() {
  const desktopMenuBtn = document.getElementById('btnDesktopMenu');
  const desktopPopover = document.getElementById('desktopMenuPopover');

  const mobileMenuBtn  = document.getElementById('btnMobileMenu');
  const mobilePopover  = document.getElementById('mobileMenuPopover');

  if (desktopMenuBtn && desktopPopover) {
    desktopMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = desktopPopover.classList.toggle('active');
      desktopMenuBtn.classList.toggle('active', isActive);
    });
  }

  if (mobileMenuBtn && mobilePopover) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isActive = mobilePopover.classList.toggle('active');
      mobileMenuBtn.classList.toggle('active', isActive);
    });
  }

  document.addEventListener('click', (e) => {
    if (desktopPopover && !desktopPopover.contains(e.target) && !desktopMenuBtn?.contains(e.target)) {
      desktopPopover.classList.remove('active');
      desktopMenuBtn?.classList.remove('active');
    }
    if (mobilePopover && !mobilePopover.contains(e.target) && !mobileMenuBtn?.contains(e.target)) {
      mobilePopover.classList.remove('active');
      mobileMenuBtn?.classList.remove('active');
    }
  });

  const qualityBtns = [
    document.getElementById('btnToggleQualityDesktop'),
    document.getElementById('btnToggleQualityMobile')
  ];
  qualityBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', toggleLowerQuality);
  });

  const gridBtns = [
    document.getElementById('btnToggleGridDesktop'),
    document.getElementById('btnToggleGridMobile')
  ];
  gridBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', toggleGrid);
  });

  const zoomInBtns = [
    document.getElementById('btnZoomInDesktop'),
    document.getElementById('btnZoomInMobile')
  ];
  zoomInBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', zoomIn);
  });

  const zoomOutBtns = [
    document.getElementById('btnZoomOutDesktop'),
    document.getElementById('btnZoomOutMobile')
  ];
  zoomOutBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', zoomOut);
  });

  const zoomResetBtns = [
    document.getElementById('btnZoomResetDesktop'),
    document.getElementById('btnZoomResetMobile')
  ];
  zoomResetBtns.forEach(btn => {
    if (btn) btn.addEventListener('click', zoomReset);
  });
  const undoBtns = [
    document.getElementById('btnUndoDesktop'),
    document.getElementById('btnUndoMobile'),
    ...document.querySelectorAll('[title="Undo"]')
  ];
  undoBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        undo();
      });
    }
  });

  const redoBtns = [
    document.getElementById('btnRedoDesktop'),
    document.getElementById('btnRedoMobile'),
    ...document.querySelectorAll('[title="Redo"]')
  ];
  redoBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        redo();
      });
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, [contenteditable="true"]')) return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    }
  });
  const controllerArea = document.getElementById('layerInspectorDrawer');
  if (controllerArea) {
    const onGestureStart = (e) => {
      if (e.target.closest('#move-pad, #dial-area, .fish-ui-ruler-container, .controller-wheel-row, .am-slider, .color-grid-item, .pop-menu-item, .graph-handle, .kf-diamond')) {
        if (!_isGestureActive) {
          pushUndoState();
          _isGestureActive = true;
        }
      }
    };
    controllerArea.addEventListener('pointerdown', onGestureStart, { capture: true });
    controllerArea.addEventListener('touchstart', onGestureStart, { capture: true, passive: true });
  }

  window.addEventListener('pointerup', () => { _isGestureActive = false; });
  window.addEventListener('touchend', () => { _isGestureActive = false; });
  window.addEventListener('mouseup', () => { _isGestureActive = false; });
}

function toggleLowerQuality() {
  isLowQuality = !isLowQuality;
  
  const videoLayer   = document.getElementById('canvasVideo');
  const qualityBadge = document.getElementById('canvasQualityBadge');

  if (videoLayer) videoLayer.classList.toggle('low-quality', isLowQuality);
  if (qualityBadge) qualityBadge.classList.toggle('active', isLowQuality);

  const qualityBtns = [
    document.getElementById('btnToggleQualityDesktop'),
    document.getElementById('btnToggleQualityMobile')
  ];
  qualityBtns.forEach(btn => {
    if (btn) btn.classList.toggle('active', isLowQuality);
  });
  try {
    if (typeof renderer3D !== 'undefined' && renderer3D) {
      const ratio = isLowQuality ? 0.5 : Math.min(window.devicePixelRatio || 1, 2);
      renderer3D.setPixelRatio(ratio);
      const container = document.getElementById('canvasVideo');
      if (container) {
        const w = container.clientWidth || 360;
        const h = container.clientHeight || 640;
        renderer3D.setSize(w, h);
      }
    }
    if (typeof pendingTextureRenders !== 'undefined') {
      pendingTextureRenders.forEach((h) => { try{ cancelAnimationFrame(h); }catch(e){} });
      pendingTextureRenders.clear();
    }
    document.querySelectorAll('.track-row').forEach(row => {
      const id = row.dataset.layerId;
      if (id) {
        const mesh = typeof meshLayerMap !== 'undefined' ? meshLayerMap.get(id) : null;
        if (mesh && mesh.material && mesh.material.map) {
          try { mesh.material.map.dispose(); } catch(e) {}
          mesh.material.map = null;
        }
        if (typeof applyFillToMeshGlobal === 'function') applyFillToMeshGlobal(id);
      }
    });
    if (typeof render3D === 'function') render3D();
    if (typeof renderCanvasOverlay === 'function') renderCanvasOverlay();
  } catch(e) { console.warn('low quality toggle', e); }
}

function toggleGrid() {
  isGridOn = !isGridOn;

  const gridOverlay = document.getElementById('canvasGridOverlay');
  if (gridOverlay) gridOverlay.classList.toggle('active', isGridOn);

  const gridBtns = [
    document.getElementById('btnToggleGridDesktop'),
    document.getElementById('btnToggleGridMobile')
  ];
  gridBtns.forEach(btn => {
    if (btn) btn.classList.toggle('active', isGridOn);
  });
}

function zoomIn() {
  if (zoomIndex < zoomLevels.length - 1) {
    zoomIndex++;
    applyZoom();
  }
}

function zoomOut() {
  if (zoomIndex > 0) {
    zoomIndex--;
    applyZoom();
  }
}

function zoomReset() {
  zoomIndex = 2;
  applyZoom();
}

function applyZoom() {
  const currentZoom = zoomLevels[zoomIndex];
  const canvasWrap = document.getElementById('canvasWrap');
  
  if (canvasWrap) {
    canvasWrap.style.transform = `scale(${currentZoom})`;
    canvasWrap.style.transformOrigin = 'center center';
  }

  const zoomText = `${Math.round(currentZoom * 100)}%`;
  const labels = [
    document.getElementById('zoomValueDesktop'),
    document.getElementById('zoomValueMobile')
  ];
  labels.forEach(l => {
    if (l) l.textContent = zoomText;
  });
}

let selectedTrackRow = null;

function updateInspectorQuickButtons() {
  if (!selectedTrackRow) return;
  const clip = selectedTrackRow.querySelector('.track-clip');
  if (!clip) return;

  const curMargin = parseFloat(clip.style.marginLeft) || 0;
  const curWidth = parseFloat(clip.style.width) || clip.offsetWidth || 300;
  const curEnd = curMargin + curWidth;

  const btnLeft = document.getElementById('btnInspTrimLeft');
  const btnSplit = document.getElementById('btnInspSplit');
  const btnRight = document.getElementById('btnInspTrimRight');

  if (!btnLeft || !btnSplit || !btnRight) return;

  if (timelineOffset > curEnd + 0.5) {
    btnSplit.style.display = 'none';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Panjangkan / Extend Layer sampai ke Playhead";
    btnLeft.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="20" y1="3" x2="20" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h5" stroke-dasharray="2 2"/>
        <path d="M4 15.5h5" stroke-dasharray="2 2"/>
        <path d="M4 8.5v7" stroke-dasharray="2 2"/>
        <path d="M9 8.5h11v7H9"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeExtendRightToPlayhead(selectedTrackRow);
    };

    btnRight.title = "Geser Layer sampai ke Playhead (Move to Playhead)";
    btnRight.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="20" y1="3" x2="20" y2="21" stroke-width="1.9"/>
        <rect x="4" y="8.5" width="8" height="7" rx="1.5"/>
        <line x1="12" y1="12" x2="19" y2="12"/>
        <polyline points="16 9.5 19 12 16 14.5"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeMoveRightToPlayhead(selectedTrackRow);
    };

  } else if (timelineOffset < curMargin - 0.5) {
    btnSplit.style.display = 'none';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Geser Layer dari awal Playhead (Move to Playhead)";
    btnLeft.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="3" x2="4" y2="21" stroke-width="1.9"/>
        <rect x="12" y="8.5" width="8" height="7" rx="1.5"/>
        <line x1="12" y1="12" x2="5" y2="12"/>
        <polyline points="8 9.5 5 12 8 14.5"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeMoveLeftToPlayhead(selectedTrackRow);
    };

    btnRight.title = "Panjangkan / Extend Layer mundur ke Playhead";
    btnRight.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="3" x2="4" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h11v7H4"/>
        <path d="M15 8.5h5" stroke-dasharray="2 2"/>
        <path d="M15 15.5h5" stroke-dasharray="2 2"/>
        <path d="M20 8.5v7" stroke-dasharray="2 2"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeExtendLeftToPlayhead(selectedTrackRow);
    };

  } else {
    btnSplit.style.display = 'flex';
    btnLeft.style.display = 'flex';
    btnRight.style.display = 'flex';

    btnLeft.title = "Potong Sisi Kiri (Trim Left to Playhead)";
    btnLeft.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M4 8.5h4.5v7H4" stroke-dasharray="2 2"/>
        <path d="M15.5 8.5H20v7h-4.5"/>
      </svg>
    `;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      executeTrimLeftOnRow(selectedTrackRow, true);
    };

    btnSplit.title = "Bagi / Split di Posisi Playhead";
    btnSplit.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M8.5 8.5H4v7h4.5"/>
        <path d="M15.5 8.5H20v7h-4.5"/>
      </svg>
    `;
    btnSplit.onclick = (e) => {
      e.stopPropagation();
      executeSplitOnRow(selectedTrackRow, true);
    };

    btnRight.title = "Potong Sisi Kanan (Trim Right to Playhead)";
    btnRight.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="3" x2="12" y2="21" stroke-width="1.9"/>
        <path d="M8.5 8.5H4v7h4.5"/>
        <path d="M20 8.5h-4.5v7H20" stroke-dasharray="2 2"/>
      </svg>
    `;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      executeTrimRightOnRow(selectedTrackRow, true);
    };
  }
}

function snappyScrollTo(element, targetTop, duration = 110) {
  const startTop = element.scrollTop;
  const change = targetTop - startTop;
  if (Math.abs(change) < 1) return;

  const startTime = performance.now();
  isProgrammaticScrolling = true;

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3);

    element.scrollTop = startTop + change * easeProgress;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.scrollTop = targetTop;
      setTimeout(() => {
        isProgrammaticScrolling = false;
      }, 40);
    }
  }

  requestAnimationFrame(step);
}

function selectTrack(row) {
  if (!row) return;

  if (selectedTrackRow && selectedTrackRow !== row) {
    selectedTrackRow.classList.remove('selected');
    if (typeof closeInspectorSubpanel === 'function') {
      closeInspectorSubpanel();
    }
  }

  selectedTrackRow = row;
  row.classList.add('selected');

  const clip = row.querySelector('.track-clip');
  if (clip && !clip.querySelector('.clip-extend-handle')) {
    const leftH = document.createElement('div');
    leftH.className = 'clip-extend-handle handle-left';
    leftH.title = 'Tarik untuk memanjangkan awal layer';
    leftH.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    clip.prepend(leftH);

    const rightH = document.createElement('div');
    rightH.className = 'clip-extend-handle handle-right';
    rightH.title = 'Tarik untuk memanjangkan akhir layer';
    rightH.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    clip.appendChild(rightH);

    bindTrackEvents(row);
  }

  const addTrackPopover = document.getElementById('addTrackPopover');
  const fabAdd = document.getElementById('fabAddTrack');
  if (addTrackPopover) addTrackPopover.classList.remove('active');
  if (fabAdd) fabAdd.classList.remove('active');

  const topBar = document.getElementById('layerTopContextBar');
  const nameEl = document.getElementById('topInspLayerName');
  const iconEl = document.getElementById('topInspLayerIcon');
  const clipName = row.querySelector('.track-clip-name');

  if (nameEl && clipName) {
    nameEl.textContent = clipName.textContent.trim();
  }

  if (iconEl) {
    const cat = row.dataset.category || 'media';
    if (cat === 'shape') iconEl.textContent = 'interests';
    else if (cat === 'camera') iconEl.textContent = 'videocam';
    else if (cat === 'text') iconEl.textContent = 'title';
    else iconEl.textContent = 'perm_media';
  }

  if (topBar) {
    topBar.classList.add('active');
  }

  const currentTagColor = row.dataset.tagColor || 'none';
  document.querySelectorAll('.color-tag-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.getAttribute('data-color') === currentTagColor);
  });

  const btnTopLink = document.getElementById('topBtnInspLink');
  if (btnTopLink) {
    let isLinked = false;
    try {
      isLinked = !!(row.dataset.linkedTo && JSON.parse(row.dataset.linkedTo).length > 0);
    } catch (_) {}
    btnTopLink.classList.toggle('active', isLinked);
  }

  const btnTopMotionBlur = document.getElementById('topBtnInspMotionBlur');
  if (btnTopMotionBlur) {
    const layerId = row.dataset.layerId || 'default';
    const isMbOn = !!layerMotionBlur.get(layerId);
    btnTopMotionBlur.classList.toggle('active', isMbOn);
    btnTopMotionBlur.title = isMbOn ? 'Motion Blur: ON' : 'Motion Blur: OFF';
  }

  const drawer = document.getElementById('layerInspectorDrawer');
  const panelMove = document.getElementById('panelMoveTransform');
  const panelColor = document.getElementById('panelColorFill');
  const panelGraph = document.getElementById('panelGraphEditor');
  const toolsGrid = document.querySelector('.inspector-tools-grid');
  const quickStrip = document.querySelector('.inspector-quick-strip');

  const panelBorderShadow = document.getElementById('panelBorderShadow');
  if (panelMove) {
    panelMove.style.display = 'none';
    panelMove.classList.remove('slide-in', 'slide-out');
  }
  if (panelColor) {
    panelColor.style.display = 'none';
    panelColor.classList.remove('slide-in', 'slide-out');
  }
  if (panelBorderShadow) {
    panelBorderShadow.style.display = 'none';
    panelBorderShadow.classList.remove('slide-in', 'slide-out');
  }
  if (panelGraph) {
    panelGraph.style.display = 'none';
    panelGraph.classList.remove('slide-in', 'slide-out');
  }
  if (quickStrip) quickStrip.style.display = 'flex';
  if (toolsGrid) toolsGrid.style.display = 'grid';

  if (window.FishPopover) {
    window.FishPopover.close();
  }

  if (drawer) {
    drawer.classList.remove(
      'subpanel-open', 'subpanel-color', 'subpanel-move', 'subpanel-border-shadow',
      'subpanel-graph', 'subpanel-shape', 'subpanel-text', 'subpanel-camera',
      'subpanel-effects', 'subpanel-add-effect', 'in-subpanel'
    );
    drawer.classList.add('active');
  }

  const cat = row.dataset.category || 'media';
  const clipText = clipName ? clipName.textContent.trim() : '';
  const isCamera = (cat === 'camera' || clipText.toLowerCase().startsWith('camera'));
  const isNull = (cat === 'null' || clipText.toLowerCase().startsWith('null'));
  const isAdjustment = (cat === 'adjustment');
  const isGroup = (cat === 'group' || (row.dataset.layerId && row.dataset.layerId.startsWith('group_')) || (typeof layerGroupData !== 'undefined' && layerGroupData.has(row.dataset.layerId)));
  const isShape = (cat === 'shape' || cat === 'svg' || (row.dataset.shapeType && row.dataset.shapeType !== 'null') || clipText.toLowerCase().endsWith('.svg')) && !isAdjustment;

  if (iconEl) {
    if (isAdjustment) iconEl.textContent = 'tune';
    else if (isGroup) iconEl.textContent = 'folder_open';
    else if (isShape) iconEl.textContent = 'interests';
    else if (isCamera) iconEl.textContent = 'videocam';
    else if (cat === 'text') iconEl.textContent = 'title';
    else iconEl.textContent = 'perm_media';
  }
  const allTileBtns = toolsGrid ? Array.from(toolsGrid.querySelectorAll('.insp-tile-btn')) : [];
  if (isCamera) {
    if (toolsGrid) {
      toolsGrid.classList.remove('single-item');
      toolsGrid.classList.add('camera-layout');
    }
    allTileBtns.forEach(btn => {
      if (btn.id === 'btnInspMoveTransform' || btn.id === 'btnInspCameraControl') {
        btn.style.display = 'flex';
      } else {
        btn.style.display = 'none';
      }
    });
  } else if (isNull) {
    if (toolsGrid) {
      toolsGrid.classList.remove('camera-layout');
      toolsGrid.classList.add('single-item');
    }
    allTileBtns.forEach(btn => {
      if (btn.id === 'btnInspMoveTransform') {
        btn.style.display = 'flex';
      } else {
        btn.style.display = 'none';
      }
    });
  } else {
    if (toolsGrid) {
      toolsGrid.classList.remove('single-item', 'camera-layout');
    }
    allTileBtns.forEach(btn => {
      if (btn.id === 'btnInspCameraControl') {
        btn.style.display = 'none';
      } else if (btn.id === 'btnInspColorFill') {
        btn.style.display = isAdjustment ? 'none' : 'flex';
      } else if (btn.id === 'btnInspEditGroup') {
        btn.style.display = isGroup ? 'flex' : 'none';
      } else if (btn.id === 'btnInspEditShape') {
        btn.style.display = (isShape && !isGroup && !isAdjustment) ? 'flex' : 'none';
      } else if (btn.id === 'btnInspEditText') {
        btn.style.display = (cat === 'text' && !isGroup) ? 'flex' : 'none';
      } else {
        btn.style.display = 'flex';
      }
    });
  }

  updateInspectorQuickButtons();
  syncControllerUI();
  if (typeof syncBorderShadowUI === 'function') syncBorderShadowUI();
  renderAllKeyframeMarkers();
  requestCanvasOverlayRender();

  const viewport = document.getElementById('tracksViewport');
  if (viewport) {
    viewport.classList.add('drawer-open');
    viewport.classList.add('locked-vertical');
    
    requestAnimationFrame(() => {
      const drawerEl = document.getElementById('layerInspectorDrawer');
      const drawerHeight = (drawerEl && drawerEl.offsetHeight) || 220;
      
      const viewportRect = viewport.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      
      const currentRelativeRowTop = rowRect.top - viewportRect.top;
      const rowHeight = rowRect.height || 34;
      
      const visibleTop = 28;
      const visibleBottom = Math.max(visibleTop + 60, viewportRect.height - drawerHeight);
      const visibleCenter = visibleTop + (visibleBottom - visibleTop) / 2;
      
      const desiredRelativeRowTop = visibleCenter - (rowHeight / 2);
      
      const deltaScroll = currentRelativeRowTop - desiredRelativeRowTop;
      const targetScrollTop = Math.max(0, viewport.scrollTop + deltaScroll);
      
      snappyScrollTo(viewport, targetScrollTop, 110);
    });
  }
}

function deselectTrack() {
  if (selectedTrackRow) {
    selectedTrackRow.classList.remove('selected');
    selectedTrackRow = null;
  }
  const topBar = document.getElementById('layerTopContextBar');
  if (topBar) {
    topBar.classList.remove('active');
  }
  closeLayerContextMenu();
  const drawer = document.getElementById('layerInspectorDrawer');
  if (drawer) {
    drawer.classList.remove(
      'active', 'subpanel-open', 'subpanel-color', 'subpanel-move',
      'subpanel-border-shadow', 'subpanel-graph', 'subpanel-shape',
      'subpanel-text', 'subpanel-camera', 'subpanel-effects', 'subpanel-add-effect', 'in-subpanel'
    );
  }
  document.querySelectorAll('.inspector-subpanel').forEach(p => {
    p.style.display = 'none';
    p.classList.remove('slide-in', 'slide-out');
  });
  const toolsGrid = document.querySelector('.inspector-tools-grid');
  const quickStrip = document.querySelector('.inspector-quick-strip');
  if (quickStrip) quickStrip.style.display = 'flex';
  if (toolsGrid) toolsGrid.style.display = 'grid';

  if (window.FishPopover) {
    window.FishPopover.close();
  }
  if (window.FishUI && window.FishUI.EffectsPopover && typeof window.FishUI.EffectsPopover.close === 'function') {
    window.FishUI.EffectsPopover.close();
  }
  renderCanvasOverlay();
  renderAllKeyframeMarkers();
  updateKeyframeUI();

  const viewport = document.getElementById('tracksViewport');
  if (viewport) {
    viewport.classList.remove('drawer-open');
    viewport.classList.remove('locked-vertical');
  }
}

function initTrackReorder(row, handle) {
  let isDragging = false;
  let startPointerY = 0;
  let initialIndex = 0;
  let targetIndex = 0;
  const container = document.getElementById('trackRowsContainer');
  if (!container) return;

  const onPointerDown = (e) => {
    e.stopPropagation();
    isDragging = true;
    startPointerY = e.pageY || (e.touches && e.touches[0].pageY) || 0;

    const allRows = Array.from(container.querySelectorAll('.track-row'));
    initialIndex = allRows.indexOf(row);
    targetIndex = initialIndex;

    const rowStep = (allRows.length > 1) 
      ? Math.abs(allRows[1].offsetTop - allRows[0].offsetTop)
      : 44.5;

    row.classList.add('dragging-reorder');
    row.style.transform = 'translateY(0px)';

    allRows.forEach(r => {
      if (r !== row) {
        r.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)';
      }
    });

    const onPointerMove = (me) => {
      if (!isDragging) return;
      const currentY = me.pageY || (me.touches && me.touches[0].pageY) || 0;
      const deltaY = currentY - startPointerY;
      row.style.transform = `translateY(${deltaY}px)`;

      const steps = Math.round(deltaY / rowStep);
      const newTargetIndex = Math.max(0, Math.min(initialIndex + steps, allRows.length - 1));

      if (newTargetIndex !== targetIndex) {
        targetIndex = newTargetIndex;

        allRows.forEach((r, idx) => {
          if (r === row) return;

          if (initialIndex < targetIndex) {
            if (idx > initialIndex && idx <= targetIndex) {
              r.style.transform = `translateY(-${rowStep}px)`;
            } else {
              r.style.transform = 'translateY(0px)';
            }
          } else if (initialIndex > targetIndex) {
            if (idx >= targetIndex && idx < initialIndex) {
              r.style.transform = `translateY(${rowStep}px)`;
            } else {
              r.style.transform = 'translateY(0px)';
            }
          } else {
            r.style.transform = 'translateY(0px)';
          }
        });
      }
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      row.classList.remove('dragging-reorder');

      allRows.forEach(r => {
        r.style.transition = 'none';
        r.style.transform = '';
      });

      if (targetIndex !== initialIndex) {
        const currentRows = Array.from(container.querySelectorAll('.track-row'));
        const targetElement = currentRows[targetIndex];
        if (targetIndex > initialIndex) {
          container.insertBefore(row, targetElement.nextSibling);
        } else {
          container.insertBefore(row, targetElement);
        }
      }

      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
    };

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
  };

  handle.addEventListener('mousedown', onPointerDown);
  handle.addEventListener('touchstart', onPointerDown, { passive: false });
}

let currentProjectId = sessionStorage.getItem('activeProjectId') || ('proj_' + Date.now());
document.addEventListener('click', (e) => {
  const btnEdit = e.target.closest('#btnInspEditGroup');
  if (btnEdit) {
    handleEditGroupClick(e);
    return;
  }
  const btnParent = e.target.closest('#btnGroupNavParent');
  if (btnParent) {
    e.stopPropagation();
    exitGroupContext();
    return;
  }
  const btnSettings = e.target.closest('#btnGroupSettings');
  if (btnSettings) {
    e.stopPropagation();
    if (typeof openGroupSettingsModal === 'function') {
      openGroupSettingsModal();
    }
    return;
  }
});

if (typeof document !== 'undefined') {
  const _tryInitGroupControls = () => {
    if (typeof initGroupControls === 'function') initGroupControls();
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_tryInitGroupControls, 0);
  } else {
    document.addEventListener('DOMContentLoaded', _tryInitGroupControls);
  }
}

