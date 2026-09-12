// One-click clipboard copy utility for demo code modules
    function copySnippet(btn, codeId) {
      const el = document.getElementById(codeId);
      if (!el) return;
      const text = el.innerText || el.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const originalHtml = btn.innerHTML;
        btn.classList.add('is-copied');
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Copied!';
        setTimeout(() => {
          btn.classList.remove('is-copied');
          btn.innerHTML = originalHtml;
        }, 2000);
      }).catch(() => {
        // Fallback for non-https/legacy contexts
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        btn.classList.add('is-copied');
        btn.innerHTML = 'Copied!';
        setTimeout(() => {
          btn.classList.remove('is-copied');
          btn.innerHTML = 'Copy';
        }, 2000);
      });
    }

    function demoSwitchFillTab(btn, tab) {
      if (!btn) return;
      const parent = btn.closest('.fill-category-bar');
      if (parent) {
        parent.querySelectorAll('.fill-tab-btn').forEach(b => {
          b.classList.remove('is-active');
        });
        btn.classList.add('is-active');
      }
      const noneView = document.getElementById('demo-fill-tab-none');
      const colorView = document.getElementById('demo-fill-tab-color');
      const gradView = document.getElementById('demo-fill-tab-gradient');
      const mediaView = document.getElementById('demo-fill-tab-media');
      if (noneView) noneView.classList.toggle('is-active', tab === 'none');
      if (colorView) colorView.classList.toggle('is-active', tab === 'color');
      if (gradView) gradView.classList.toggle('is-active', tab === 'gradient');
      if (mediaView) mediaView.classList.toggle('is-active', tab === 'media');
    }

    function demoPickColor(hex) {
      const banner = document.getElementById('demo-color-banner');
      const text = document.getElementById('demo-color-banner-text');
      if (banner) {
        banner.style.backgroundColor = hex;
        const r = parseInt(hex.slice(1, 3), 16) || 0;
        const g = parseInt(hex.slice(3, 5), 16) || 0;
        const b = parseInt(hex.slice(5, 7), 16) || 0;
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        banner.style.color = (yiq >= 150) ? '#141814' : '#ffffff';
      }
      if (text) text.textContent = `${hex.toUpperCase()} (100%)`;
      const tiles = document.querySelectorAll('#demo-fill-tab-color .fill-color-palette-tile');
      tiles.forEach(t => {
        t.classList.toggle('is-active', t.style.backgroundColor.toLowerCase() === hex.toLowerCase());
      });
    }

    // Demo Interactive Drawer Category Switcher
    document.addEventListener('switch:change', (e) => {
      if (e.detail && e.detail.track && e.detail.track.closest('#demo-drawer-interactive-box')) {
        const cat = e.detail.value;
        const mediaPool = document.getElementById('demo-add-layer-media-pool');
        const controlPanel = document.getElementById('demo-add-layer-control-panel');
        const shapePanel = document.getElementById('demo-add-layer-shape-panel');
        if (mediaPool) mediaPool.style.display = (cat === 'media') ? '' : 'none';
        if (controlPanel) controlPanel.style.display = (cat === 'control') ? '' : 'none';
        if (shapePanel) shapePanel.style.display = (cat === 'shape') ? '' : 'none';
      }
    });

    // Interactive Demo Split Handle Resizer
    (function initDemoSplitResizer() {
      const handle = document.getElementById('demo-timeline-split-handle');
      const container = document.getElementById('demo-split-container');
      if (!handle || !container) return;

      let isDragging = false;

      handle.addEventListener('pointerdown', (e) => {
        isDragging = true;
        handle.classList.add('is-dragging');
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
      });

      handle.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const rect = container.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        let percent = (offsetX / rect.width) * 100;
        percent = Math.max(20, Math.min(80, percent));
        container.style.setProperty('--demo-left-w', percent + '%');
      });

      const stopDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('is-dragging');
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      };

      handle.addEventListener('pointerup', stopDrag);
      handle.addEventListener('pointercancel', stopDrag);
    })();

    // Interactive Demo Mobile Preview Split Handle Resizer
    (function initDemoMobileSplitResizer() {
      const handle = document.getElementById('demo-preview-split-handle');
      const container = document.getElementById('demo-mobile-split-container');
      if (!handle || !container) return;

      let isDragging = false;
      let startY = 0;
      let startH = 0;

      handle.addEventListener('pointerdown', (e) => {
        isDragging = true;
        startY = e.clientY;
        const topEl = container.firstElementChild;
        startH = topEl ? topEl.getBoundingClientRect().height : (container.getBoundingClientRect().height * 0.5);
        handle.classList.add('is-dragging');
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
      });

      handle.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const rect = container.getBoundingClientRect();
        const deltaY = e.clientY - startY;
        const minH = 36;
        const maxH = rect.height - 36;
        const clampedH = Math.max(minH, Math.min(maxH, startH + deltaY));
        const percent = (clampedH / rect.height) * 100;
        container.style.setProperty('--demo-top-h', percent.toFixed(1) + '%');
      });

      const stopDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('is-dragging');
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      };

      handle.addEventListener('pointerup', stopDrag);
      handle.addEventListener('pointercancel', stopDrag);
    })();

    // Interactive Demo Timeline Sandbox Manager
    (function initDemoTimelineSandbox() {
      const rulerTrack = document.getElementById('demo-timeline-ruler-track');
      const layersTrack = document.getElementById('demo-timeline-layers-track');
      const timecodeEl = document.getElementById('demo-playhead-current-time');
      const rulerViewport = document.getElementById('demo-timeline-ruler-viewport');
      const layersViewport = document.getElementById('demo-timeline-layers-viewport');

      if (!rulerTrack || !layersTrack || !timecodeEl) return;

      const totalSeconds = 30;
      const pixelsPerSecond = 80;

      // 1. Generate Symmetrical 10-Grid Subdivisions
      let rulerHtml = '';
      for (let s = 0; s <= totalSeconds; s++) {
        const mins = String(Math.floor(s / 60)).padStart(2, '0');
        const secs = String(s % 60).padStart(2, '0');
        const timeStr = `${mins}:${secs}`;

        let ticksHtml = '';
        for (let i = 0; i < 10; i++) {
          let tickClass = 'minor';
          if (i === 0) tickClass = 'major';
          else if (i === 5) tickClass = 'medium';
          ticksHtml += `<div class="ruler-tick-cell"><div class="ruler-tick ${tickClass}"></div></div>`;
        }

        rulerHtml += `
          <div class="ruler-second-mark" style="width: ${pixelsPerSecond}px;">
            <span class="ruler-second-text">${timeStr}</span>
            <div class="ruler-ticks-row">
              ${ticksHtml}
            </div>
          </div>
        `;
      }
      rulerTrack.innerHTML = rulerHtml;

      // 2. High-Performance GPU-Accelerated Motion beneath Fixed Center Playhead
      let panX = 0;
      let lastRenderedPanX = null;
      let lastDisplayedMs = -1;
      let rafScheduled = false;

      const minPanX = -(totalSeconds * pixelsPerSecond);
      const maxPanX = 0;

      function formatTimecode(ms) {
        const totalSec = ms / 1000;
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(Math.floor(totalSec % 60)).padStart(2, '0');
        const tenths = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');
        return `00:${mins}:${secs}:${tenths}`;
      }

      function renderTimeline() {
        rafScheduled = false;
        if (panX === lastRenderedPanX) return;
        lastRenderedPanX = panX;

        const panStr = `translate3d(${panX.toFixed(2)}px, 0, 0)`;
        rulerTrack.style.transform = panStr;
        layersTrack.style.transform = panStr;

        const currentMs = Math.round((Math.abs(panX) / pixelsPerSecond) * 1000);
        if (currentMs !== lastDisplayedMs) {
          lastDisplayedMs = currentMs;
          timecodeEl.textContent = formatTimecode(currentMs);
        }
      }

      function scheduleRender() {
        if (!rafScheduled) {
          rafScheduled = true;
          requestAnimationFrame(renderTimeline);
        }
      }

      function updateTimelinePosition(newPanX, immediate = false) {
        panX = Math.max(minPanX, Math.min(maxPanX, newPanX));
        if (immediate) {
          renderTimeline();
        } else {
          scheduleRender();
        }
      }

      function shiftTimelineMs(deltaMs) {
        const currentMs = Math.round((Math.abs(panX) / pixelsPerSecond) * 1000);
        const targetMs = Math.max(0, Math.min(totalSeconds * 1000, currentMs + deltaMs));
        const targetPanX = -(targetMs / 1000) * pixelsPerSecond;
        updateTimelinePosition(targetPanX);
      }

      // Pointer drag scrubbing & vertical layer panning
      let isPanning = false;
      let startX = 0;
      let startY = 0;
      let startPanX = 0;
      let startScrollTop = 0;
      let isLayersDrag = false;

      function onPanStart(e) {
        if (e.target.closest('.timeline-clip-block') || e.target.closest('.timeline-layer-ctrl-pill')) return;
        isPanning = true;
        startX = e.clientX;
        startY = e.clientY;
        startPanX = panX;
        if (layersViewport) {
          startScrollTop = layersViewport.scrollTop;
          isLayersDrag = layersViewport.contains(e.target);
        } else {
          isLayersDrag = false;
        }
        if (rulerViewport) rulerViewport.classList.add('is-dragging');
        if (layersViewport) layersViewport.classList.add('is-dragging');
      }

      function onPanMove(e) {
        if (!isPanning) return;
        const deltaX = e.clientX - startX;
        updateTimelinePosition(startPanX + deltaX);

        if (isLayersDrag && layersViewport) {
          const deltaY = e.clientY - startY;
          layersViewport.scrollTop = startScrollTop - deltaY;
        }
      }

      function onPanEnd() {
        if (!isPanning) return;
        isPanning = false;
        isLayersDrag = false;
        if (rulerViewport) rulerViewport.classList.remove('is-dragging');
        if (layersViewport) layersViewport.classList.remove('is-dragging');
      }

      [rulerViewport, layersViewport].forEach(vp => {
        if (!vp) return;
        vp.addEventListener('pointerdown', onPanStart);
      });

      window.addEventListener('pointermove', onPanMove);
      window.addEventListener('pointerup', onPanEnd);
      window.addEventListener('pointercancel', onPanEnd);

      // Clip selection, eye hide/show toggle, and trim handle drag in demo
      if (layersViewport) {
        layersViewport.addEventListener('click', (e) => {
          const eyeBtn = e.target.closest('.timeline-layer-eye-btn');
          if (eyeBtn) {
            e.stopPropagation();
            const pillSlot = eyeBtn.closest('.timeline-lane-pill-slot');
            const pill = eyeBtn.closest('.timeline-layer-ctrl-pill');
            if (pillSlot && pill) {
              const trackIdx = parseInt(pillSlot.dataset.trackIndex || '0', 10);
              const lanes = layersViewport.querySelectorAll('.timeline-track-lane');
              const lane = lanes[trackIdx];
              const isHidden = pill.classList.toggle('is-hidden');
              if (lane) {
                const clip = lane.querySelector('.timeline-clip-block');
                if (clip) clip.classList.toggle('is-hidden', isHidden);
              }
              eyeBtn.setAttribute('title', isHidden ? 'Show Layer' : 'Hide Layer');
              eyeBtn.innerHTML = isHidden 
                ? `<span class="svg-icon svg-icon-eye-off" aria-hidden="true"></span>`
                : `<span class="svg-icon svg-icon-eye" aria-hidden="true"></span>`;
            }
            return;
          }
          if (e.target.closest('.timeline-clip-handle') || e.target.closest('.timeline-layer-ctrl-pill')) return;
          const clip = e.target.closest('.timeline-clip-block');
          if (clip) {
            e.stopPropagation();
            const wasSelected = clip.classList.contains('is-selected');
            layersViewport.querySelectorAll('.timeline-clip-block').forEach(c => c.classList.remove('is-selected'));
            if (!wasSelected) clip.classList.add('is-selected');
          } else {
            layersViewport.querySelectorAll('.timeline-clip-block').forEach(c => c.classList.remove('is-selected'));
          }
        });

        // Interactive dragging for trim handles in demo
        layersViewport.querySelectorAll('.timeline-clip-block').forEach(clip => {
          const leftH = clip.querySelector('.handle-left');
          const rightH = clip.querySelector('.handle-right');

          if (leftH) {
            leftH.addEventListener('pointerdown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              leftH.setPointerCapture(e.pointerId);
              const startX = e.clientX;
              const initLeft = parseFloat(clip.style.left) || 0;
              const initWidth = parseFloat(clip.style.width) || 200;
              const fixedRight = initLeft + initWidth;

              function onMove(me) {
                const deltaX = me.clientX - startX;
                let newLeft = Math.max(0, initLeft + deltaX);
                let newWidth = fixedRight - newLeft;
                if (newWidth < 36) {
                  newWidth = 36;
                  newLeft = fixedRight - 36;
                }
                clip.style.left = `${newLeft}px`;
                clip.style.width = `${newWidth}px`;
              }

              function onUp(ue) {
                leftH.releasePointerCapture(ue.pointerId);
                leftH.removeEventListener('pointermove', onMove);
                leftH.removeEventListener('pointerup', onUp);
                leftH.removeEventListener('pointercancel', onUp);
              }

              leftH.addEventListener('pointermove', onMove);
              leftH.addEventListener('pointerup', onUp);
              leftH.addEventListener('pointercancel', onUp);
            });
          }

          if (rightH) {
            rightH.addEventListener('pointerdown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              rightH.setPointerCapture(e.pointerId);
              const startX = e.clientX;
              const initWidth = parseFloat(clip.style.width) || 200;

              function onMove(me) {
                const deltaX = me.clientX - startX;
                let newWidth = Math.max(36, initWidth + deltaX);
                clip.style.width = `${newWidth}px`;
              }

              function onUp(ue) {
                rightH.releasePointerCapture(ue.pointerId);
                rightH.removeEventListener('pointermove', onMove);
                rightH.removeEventListener('pointerup', onUp);
                rightH.removeEventListener('pointercancel', onUp);
              }

              rightH.addEventListener('pointermove', onMove);
              rightH.addEventListener('pointerup', onUp);
              rightH.addEventListener('pointercancel', onUp);
            });
          }
        });
      }


      // 0.1s (100ms / 1 Ruler Tick) precision scrolling on the Ruler Viewport
      if (rulerViewport) {
        rulerViewport.addEventListener('wheel', (e) => {
          e.preventDefault();
          const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
          if (delta === 0) return;
          const stepMs = e.shiftKey ? 1000 : 100;
          const deltaMs = (delta > 0 ? 1 : -1) * stepMs;
          shiftTimelineMs(deltaMs);
        }, { passive: false });
      }

      // Horizontal mouse wheel scrubbing on Layers Viewport
      if (layersViewport) {
        layersViewport.addEventListener('wheel', (e) => {
          if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            e.preventDefault();
            const delta = e.deltaX !== 0 ? -e.deltaX : -e.deltaY;
            updateTimelinePosition(panX + delta);
          }
        }, { passive: false });
      }

      // Playback Controls (Play / Pause Toggle)
      let isPlaying = false;
      let playAnimationId = null;
      let lastTime = 0;

      const playBtn = document.getElementById('demo-btn-play');
      const prevBtn = document.getElementById('demo-btn-prev');
      const nextBtn = document.getElementById('demo-btn-next');

      function updatePlayButtonUI() {
        if (!playBtn) return;
        playBtn.classList.toggle('is-playing', isPlaying);
        playBtn.setAttribute('title', isPlaying ? 'Pause' : 'Play');
        playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      }

      function stepPlay(timestamp) {
        if (!isPlaying) return;
        if (!lastTime) lastTime = timestamp;
        const deltaSec = (timestamp - lastTime) / 1000;
        lastTime = timestamp;

        const speed = (typeof window.timelinePlaybackSpeed === 'number' && window.timelinePlaybackSpeed > 0)
          ? window.timelinePlaybackSpeed
          : 1.0;
        let nextPan = panX - (deltaSec * pixelsPerSecond * speed);
        if (nextPan <= minPanX) {
          nextPan = maxPanX;
        }
        updateTimelinePosition(nextPan, true);
        playAnimationId = requestAnimationFrame(stepPlay);
      }

      if (playBtn) {
        playBtn.addEventListener('click', () => {
          isPlaying = !isPlaying;
          updatePlayButtonUI();
          if (isPlaying) {
            lastTime = performance.now();
            playAnimationId = requestAnimationFrame(stepPlay);
          } else {
            cancelAnimationFrame(playAnimationId);
            lastTime = 0;
          }
        });
      }

      if (prevBtn) {
        prevBtn.addEventListener('click', () => {
          updateTimelinePosition(0);
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          shiftTimelineMs(2000);
        });
      }

      // Initial alignment
      updateTimelinePosition(0);
    })();

    // Interactive Zoom Stepper Controller (+, 100%, -)
    (function initZoomStepper() {
      const zoomLevels = [50, 75, 100, 125, 150, 175, 200];
      let currentIdx = 2; // Default 100%

      const plusBtn = document.getElementById('demo-zoom-plus');
      const minusBtn = document.getElementById('demo-zoom-minus');
      const valEl = document.getElementById('demo-zoom-val');

      function updateZoom() {
        if (!valEl) return;
        valEl.textContent = `${zoomLevels[currentIdx]}%`;
      }

      if (plusBtn) {
        plusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentIdx < zoomLevels.length - 1) {
            currentIdx++;
            updateZoom();
          }
        });
      }

      if (minusBtn) {
        minusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentIdx > 0) {
            currentIdx--;
            updateZoom();
          }
        });
      }

      if (valEl) {
        valEl.addEventListener('click', (e) => {
          e.stopPropagation();
          currentIdx = 2; // Reset to 100%
          updateZoom();
        });
      }
    })();

    // Numeric Value Input Popover Live Input Showcase
    (function initDemoValuePopover() {
      const triggerBtn = document.querySelector('[data-popover-target="demo-popover-value-input"]');
      const inputEl = document.querySelector('#demo-popover-value-input .popover-value-field');
      if (triggerBtn && inputEl) {
        inputEl.addEventListener('input', () => {
          triggerBtn.textContent = `🔢 Value: ${inputEl.value || 0}`;
        });
      }
    })();

    // Modular Context Menu & Press-Hold Action Showcase
    (function initDemoContextMenu() {
      const target = document.getElementById('demo-context-target');
      const feedback = document.getElementById('demo-context-feedback');
      const titleEl = document.getElementById('demo-target-project-name');
      if (!target) return;

      function getDemoItems() {
        return [
          {
            label: 'Rename',
            icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
            action: () => {
              const newName = prompt('Enter new project name:', titleEl ? titleEl.textContent : '');
              if (newName && newName.trim() && titleEl) {
                titleEl.textContent = newName.trim();
                if (feedback) feedback.textContent = 'Project renamed!';
                setTimeout(() => { if (feedback) feedback.textContent = ''; }, 2500);
              }
            }
          },
          {
            label: 'Duplicate',
            icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
            action: () => {
              if (feedback) feedback.textContent = 'Project duplicated!';
              setTimeout(() => { if (feedback) feedback.textContent = ''; }, 2500);
            }
          },
          { divider: true },
          {
            label: 'Remove project',
            icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
            danger: true,
            action: () => {
              if (feedback) feedback.textContent = 'Project removed!';
              setTimeout(() => { if (feedback) feedback.textContent = ''; }, 2500);
            }
          }
        ];
      }

      if (window.ContextMenu) {
        window.ContextMenu.bindTrigger(target.parentElement, '#demo-context-target', () => getDemoItems());
      }

      window.triggerDemoContextMenu = function (e) {
        if (!window.ContextMenu) return;
        const rect = target.getBoundingClientRect();
        window.ContextMenu.open({
          x: rect.left + 30,
          y: rect.bottom - 10,
          items: getDemoItems(),
          target: target
        });
      };
    })();

    // Modular Canvas Wireframe & Selection Bounding Box Showcase
    (function initDemoWireframe() {
      const canvas = document.getElementById('demo-wireframe-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const statusEl = document.getElementById('demo-wireframe-status');
      const toggleBtn = document.getElementById('demo-wireframe-toggle-btn');

      let bounds = { x: 40, y: 30, w: 200, h: 130 };
      let isSelected = true;
      let activeOp = null;
      let activeHandleType = null;
      let startPointer = { x: 0, y: 0 };
      let startBounds = { x: 0, y: 0, w: 0, h: 0 };

      function getCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
          dprScale: scaleX
        };
      }

      function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const style = getComputedStyle(document.documentElement);
        const panelBg = style.getPropertyValue('--bg-panel').trim() || '#161c12';
        const panelInnerBg = style.getPropertyValue('--bg-panel-inner').trim() || '#1d2518';
        const primaryColor = style.getPropertyValue('--color-primary').trim() || '#98ce7b';
        const textMuted = style.getPropertyValue('--text-muted').trim() || '#6c7a65';

        // Draw sample layer container
        ctx.fillStyle = panelBg;
        ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);

        ctx.fillStyle = panelInnerBg;
        ctx.fillRect(bounds.x + 8, bounds.y + 8, Math.max(0, bounds.w - 16), Math.max(0, bounds.h - 16));

        // Draw sample label inside
        ctx.fillStyle = primaryColor;
        ctx.font = 'bold 12px "Cal Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SAMPLE LAYER', bounds.x + bounds.w / 2, bounds.y + bounds.h / 2 - 8);

        ctx.fillStyle = textMuted;
        ctx.font = '10px "Cal Sans", monospace';
        ctx.fillText(`${Math.round(bounds.w)} × ${Math.round(bounds.h)} px`, bounds.x + bounds.w / 2, bounds.y + bounds.h / 2 + 10);

        // Render Motion Path & frame-by-frame dots if active in demo
        if (isMotionPathDemoActive && window.CanvasWireframe && typeof window.CanvasWireframe.drawMotionPath === 'function') {
          const sampleKfLayer = {
            posX: bounds.x + bounds.w / 2,
            posY: bounds.y + bounds.h / 2,
            keyframes: {
              move: [
                { time: 0.0, value: { posX: 60, posY: 160 }, easing: [0.42, 0.0, 0.58, 1.0] },
                { time: 1.0, value: { posX: bounds.x + bounds.w / 2, posY: bounds.y + bounds.h / 2 }, easing: [0.42, 0.0, 0.58, 1.0] },
                { time: 2.0, value: { posX: 410, posY: 50 }, easing: [0.25, 0.1, 0.25, 1.0] }
              ]
            }
          };
          window.CanvasWireframe.drawMotionPath(ctx, sampleKfLayer, {
            fps: 30,
            currentSec: 1.0,
            bufferScale: 1
          });
        }

        // Render wireframe bounding box + center anchor + 8 handles if selected
        if (isSelected && window.CanvasWireframe) {
          window.CanvasWireframe.draw(ctx, bounds, {
            showAnchor: !isSelectAllMode,
            showHandles: !isSelectAllMode
          });
        }

        if (statusEl) {
          statusEl.textContent = isSelected
            ? (isSelectAllMode
                ? `Select All: (x: ${Math.round(bounds.x)}, y: ${Math.round(bounds.y)}, w: ${Math.round(bounds.w)}, h: ${Math.round(bounds.h)}) [Box Only]`
                : `Individual: (x: ${Math.round(bounds.x)}, y: ${Math.round(bounds.y)}, w: ${Math.round(bounds.w)}, h: ${Math.round(bounds.h)}) [Anchor + Handles]`)
            : 'Layer: Deselected';
        }

        if (toggleBtn) {
          toggleBtn.textContent = isSelected ? 'Deselect' : 'Select';
        }
      }

      let isMotionPathDemoActive = false;
      let isSelectAllMode = false;

      window.demoWireframeToggleSelectAllMode = function() {
        isSelectAllMode = !isSelectAllMode;
        const btn = document.getElementById('demo-wireframe-mode-btn');
        if (btn) {
          btn.textContent = isSelectAllMode ? 'Select All Mode: On' : 'Select All Mode: Off';
          btn.classList.toggle('is-active', isSelectAllMode);
        }
        render();
      };

      window.demoWireframeToggleMotionPath = function() {
        isMotionPathDemoActive = !isMotionPathDemoActive;
        const btn = document.getElementById('demo-wireframe-motion-btn');
        if (btn) {
          btn.textContent = isMotionPathDemoActive ? 'Motion Path: On' : 'Motion Path: Off';
          btn.classList.toggle('is-active', isMotionPathDemoActive);
        }
        render();
      };

      window.demoWireframeSetBounds = function(x, y, w, h) {
        bounds = { x, y, w, h };
        isSelected = true;
        render();
      };

      window.demoWireframeSetCamera = function() {
        const pad = 16;
        bounds = {
          x: pad,
          y: pad,
          w: canvas.width - pad * 2,
          h: canvas.height - pad * 2,
          cx: canvas.width / 2,
          cy: canvas.height / 2,
          isCamera: true,
          name: 'Camera 1'
        };
        isSelected = true;
        render();
      };

      window.demoWireframeToggleSelect = function() {
        isSelected = !isSelected;
        render();
      };

      // Hover feedback for handles, anchor, and layer
      canvas.addEventListener('pointermove', (e) => {
        if (activeOp) return;
        const coords = getCoords(e);
        if (isSelected && window.CanvasWireframe) {
          const hitTolerance = Math.max(12, Math.round(12 * coords.dprScale));
          const h = window.CanvasWireframe.hitTestHandle(bounds, coords.x, coords.y, hitTolerance);
          if (h) {
            canvas.style.cursor = h.cursor;
            return;
          }
          if (window.CanvasWireframe.hitTest(bounds, coords.x, coords.y)) {
            canvas.style.cursor = 'move';
            return;
          }
        }
        canvas.style.cursor = 'default';
      });

      // Pointerdown: Direct Drag / Scale Start
      canvas.addEventListener('pointerdown', (e) => {
        const coords = getCoords(e);
        if (isSelected && window.CanvasWireframe) {
          const hitTolerance = Math.max(12, Math.round(12 * coords.dprScale));
          const hitH = window.CanvasWireframe.hitTestHandle(bounds, coords.x, coords.y, hitTolerance);

          if (hitH && hitH.type !== 'anchor') {
            activeOp = 'scale';
            activeHandleType = hitH.type;
            startPointer = { x: coords.x, y: coords.y };
            startBounds = { ...bounds };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
          }

          if (hitH?.type === 'anchor' || window.CanvasWireframe.hitTest(bounds, coords.x, coords.y)) {
            activeOp = 'move';
            startPointer = { x: coords.x, y: coords.y };
            startBounds = { ...bounds };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
          }
        }

        // Empty canvas click
        isSelected = false;
        render();
      });

      window.addEventListener('pointermove', (e) => {
        if (!activeOp) return;
        const coords = getCoords(e);
        const deltaX = coords.x - startPointer.x;
        const deltaY = coords.y - startPointer.y;

        if (activeOp === 'move') {
          bounds.x = startBounds.x + deltaX;
          bounds.y = startBounds.y + deltaY;
          render();
        } else if (activeOp === 'scale') {
          let newX = startBounds.x;
          let newY = startBounds.y;
          let newW = startBounds.w;
          let newH = startBounds.h;
          const minSize = 20;

          switch (activeHandleType) {
            case 'e': newW = Math.max(minSize, startBounds.w + deltaX); break;
            case 'w': newW = Math.max(minSize, startBounds.w - deltaX); newX = startBounds.x + (startBounds.w - newW); break;
            case 's': newH = Math.max(minSize, startBounds.h + deltaY); break;
            case 'n': newH = Math.max(minSize, startBounds.h - deltaY); newY = startBounds.y + (startBounds.h - newH); break;
            case 'se': newW = Math.max(minSize, startBounds.w + deltaX); newH = Math.max(minSize, startBounds.h + deltaY); break;
            case 'sw': newW = Math.max(minSize, startBounds.w - deltaX); newX = startBounds.x + (startBounds.w - newW); newH = Math.max(minSize, startBounds.h + deltaY); break;
            case 'ne': newW = Math.max(minSize, startBounds.w + deltaX); newH = Math.max(minSize, startBounds.h - deltaY); newY = startBounds.y + (startBounds.h - newH); break;
            case 'nw': newW = Math.max(minSize, startBounds.w - deltaX); newX = startBounds.x + (startBounds.w - newW); newH = Math.max(minSize, startBounds.h - deltaY); newY = startBounds.y + (startBounds.h - newH); break;
          }

          bounds = { x: newX, y: newY, w: newW, h: newH };
          render();
        }
      });

      const onEnd = (e) => {
        if (!activeOp) return;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        activeOp = null;
        activeHandleType = null;
      };

      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);

      // Synchronize immediately on theme changes
      const observer = new MutationObserver(() => {
        render();
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      render();
    })();

    let demoMoveAnchorSubmode = 'move';
    function demoTransformSetMode(mode) {
      const controller = document.getElementById('demo-transform-controller');
      if (!controller) return;

      const moveBtn = document.getElementById('demo-btn-tool-move');
      if (mode === 'move' && moveBtn && moveBtn.classList.contains('is-active')) {
        demoMoveAnchorSubmode = demoMoveAnchorSubmode === 'move' ? 'anchor' : 'move';
        const svgMove = moveBtn.querySelector('.svg-tool-move');
        const svgAnchor = moveBtn.querySelector('.svg-tool-anchor');
        const promptEl = document.querySelector('#demo-pane-move .transform-swipe-prompt');
        const topBtn = document.getElementById('demo-btn-mode-move');

        if (demoMoveAnchorSubmode === 'anchor') {
          if (svgMove) svgMove.style.display = 'none';
          if (svgAnchor) svgAnchor.style.display = '';
          moveBtn.title = 'Move Anchor Point - Click to toggle Move Layer';
          moveBtn.setAttribute('aria-label', 'Move Anchor');
          if (promptEl) promptEl.textContent = 'Swipe here to move anchor';
          if (topBtn) topBtn.textContent = 'Mode: Move Anchor';
        } else {
          if (svgMove) svgMove.style.display = '';
          if (svgAnchor) svgAnchor.style.display = 'none';
          moveBtn.title = 'Move Layer (Position) - Click to toggle Move Anchor';
          moveBtn.setAttribute('aria-label', 'Move Layer');
          if (promptEl) promptEl.textContent = 'Swipe here to move layer';
          if (topBtn) topBtn.textContent = 'Mode: Move Layer';
        }
        return;
      }

      controller.querySelectorAll('.transform-tool-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.getAttribute('onclick')?.includes(mode));
      });
      controller.querySelectorAll('.transform-pane').forEach(pane => {
        pane.classList.toggle('is-active', pane.id === `demo-pane-${mode}`);
      });
    }

    function demoTransformToggleGraph() {
      const controller = document.getElementById('demo-transform-controller');
      if (!controller) return;
      alert('Graph View: Toggles cubic bezier easing graph editor.');
    }

    function demoToggleAccordion(headerEl) {
      const card = headerEl.closest('.blend-group-card');
      if (!card) return;
      const isExpanded = card.classList.contains('is-expanded');
      document.querySelectorAll('#demo-blend-modes-list .blend-group-card').forEach(c => {
        if (c !== card) c.classList.remove('is-expanded');
      });
      card.classList.toggle('is-expanded', !isExpanded);
    }

    function demoSelectBlend(mode, modeName, btnEl) {
      const isNormal = mode === 'normal';
      const normalStatus = document.getElementById('demo-status-normal');
      const normalCard = document.getElementById('demo-card-normal');

      if (normalStatus) normalStatus.style.display = isNormal ? '' : 'none';
      if (normalCard) normalCard.classList.toggle('is-selected-group', isNormal);

      document.querySelectorAll('#demo-blend-modes-list .blend-item-btn, #demo-blend-modes-list .blend-mask-tile').forEach(b => {
        b.classList.remove('is-selected');
      });

      document.querySelectorAll('#demo-blend-modes-list .blend-group-card:not(#demo-card-normal)').forEach(card => {
        const statusSpan = card.querySelector('.blend-group-status');
        if (btnEl && card.contains(btnEl) && !isNormal) {
          card.classList.add('is-selected-group');
          btnEl.classList.add('is-selected');
          if (statusSpan) {
            statusSpan.style.display = '';
            statusSpan.innerHTML = `${modeName} <span class="blend-check-badge"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="var(--color-primary)"/><path d="M8 12.5l2.5 2.5 5.5-5.5" stroke="var(--bg-canvas)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
          }
        } else {
          card.classList.remove('is-selected-group');
          if (statusSpan) {
            statusSpan.style.display = 'none';
            statusSpan.textContent = '';
          }
        }
      });
    }

    (function initDemoBlendSlider() {
      const slider = document.getElementById('demo-blend-slider');
      const fill = document.getElementById('demo-blend-slider-fill');
      const thumb = document.getElementById('demo-blend-slider-thumb');
      const badge = document.getElementById('demo-blend-badge');
      if (!slider) return;

      function updateSlider(e) {
        const rect = slider.getBoundingClientRect();
        if (!rect.width) return;
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const pct = Math.round(ratio * 100);
        if (fill) fill.style.width = pct + '%';
        if (thumb) thumb.style.left = pct + '%';
        if (badge) badge.textContent = pct + '%';
        slider.setAttribute('aria-valuenow', pct);
      }

      slider.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { slider.setPointerCapture(e.pointerId); } catch (_) {}
        updateSlider(e);

        function onMove(ev) { updateSlider(ev); }
        function onUp(ev) {
          try { slider.releasePointerCapture(ev.pointerId); } catch (_) {}
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    })();

    function demoFilterCategories(input) {
      const q = (input.value || '').trim().toLowerCase();
      const catGrid = document.getElementById('demo-effects-category-grid');
      const itemsView = document.getElementById('demo-effects-items-view');
      if (!q) {
        if (catGrid) catGrid.style.display = 'grid';
        if (itemsView) itemsView.style.display = 'none';
        return;
      }
      if ('brightness/contrast'.includes(q) || 'brightness'.includes(q) || 'contrast'.includes(q) || 'tile'.includes(q) || 'wave warp'.includes(q) || 'warp'.includes(q) || 'transform'.includes(q) || 'oscillate'.includes(q) || 'swing'.includes(q)) {
        if (catGrid) catGrid.style.display = 'none';
        if (itemsView) itemsView.style.display = 'flex';
      } else if ('lightning'.includes(q) || 'warp'.includes(q) || 'movement'.includes(q) || 'layer'.includes(q) || 'expression'.includes(q)) {
        if (catGrid) catGrid.style.display = 'grid';
        if (itemsView) itemsView.style.display = 'none';
      } else {
        if (catGrid) catGrid.style.display = 'none';
        if (itemsView) itemsView.style.display = 'none';
      }
    }

    // Interactive Demo: Unified 2D & 3D Perspective Transform
    (function init3DTransformDemo() {
      const canvas = document.getElementById('demo-transform-3d-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      const sliderX = document.getElementById('demo-slider-rotx');
      const sliderY = document.getElementById('demo-slider-roty');
      const sliderZ = document.getElementById('demo-slider-rotz');
      const valX = document.getElementById('demo-val-rotx');
      const valY = document.getElementById('demo-val-roty');
      const valZ = document.getElementById('demo-val-rotz');
      const resetBtn = document.getElementById('demo-btn-reset-3d');

      // Create a crisp test card offscreen canvas
      const testCard = document.createElement('canvas');
      testCard.width = 160;
      testCard.height = 160;
      const tctx = testCard.getContext('2d');
      tctx.fillStyle = '#1c2415';
      tctx.fillRect(0, 0, 160, 160);
      tctx.strokeStyle = '#98ce7b';
      tctx.lineWidth = 2;
      tctx.strokeRect(4, 4, 152, 152);
      tctx.fillStyle = '#98ce7b';
      tctx.font = 'bold 16px sans-serif';
      tctx.textAlign = 'center';
      tctx.fillText('3D PERSPECTIVE', 80, 75);
      tctx.font = '11px sans-serif';
      tctx.fillStyle = '#a6b09d';
      tctx.fillText('FishTool Studio', 80, 95);

      // Native CSS 3D Quad Elements
      const cssCard = document.getElementById('demo-css3d-card');
      const cssInnerCanvas = document.getElementById('demo-css3d-inner-canvas');
      const cssWireCanvas = document.getElementById('demo-css3d-wireframe-canvas');
      if (cssInnerCanvas) {
        const cctx = cssInnerCanvas.getContext('2d');
        cctx.drawImage(testCard, 0, 0, 160, 160);
      }
      const wireCtx = cssWireCanvas ? cssWireCanvas.getContext('2d') : null;

      function renderDemo() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const rx = parseInt(sliderX?.value || 0, 10);
        const ry = parseInt(sliderY?.value || 0, 10);
        const rz = parseInt(sliderZ?.value || 0, 10);

        if (valX) valX.textContent = `${rx}°`;
        if (valY) valY.textContent = `${ry}°`;
        if (valZ) valZ.textContent = `${rz}°`;

        const layer = {
          posX: canvas.width / 2,
          posY: canvas.height / 2,
          posZ: 0,
          scaleW: 120,
          scaleH: 120,
          rotX: rx,
          rotY: ry,
          rotZ: rz,
          skewX: 0,
          skewY: 0
        };

        // 1. Render Canvas 2D Mesh
        if (window.LayerTransform) {
          window.LayerTransform.renderLayer(ctx, testCard, layer);
          const bounds = window.LayerTransform.getBounds(layer);
          if (window.CanvasWireframe) {
            window.CanvasWireframe.draw(ctx, bounds);
          }
        }

        // 2. Render Native CSS 3D Quad (0 Subdivision, 100% vector-sharp)
        if (cssCard) {
          cssCard.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
        }
        if (wireCtx && cssWireCanvas) {
          wireCtx.clearRect(0, 0, cssWireCanvas.width, cssWireCanvas.height);
          if (window.LayerTransform && window.CanvasWireframe) {
            const cssLayer = {
              posX: cssWireCanvas.width / 2,
              posY: cssWireCanvas.height / 2,
              posZ: 0,
              scaleW: 110,
              scaleH: 110,
              rotX: rx,
              rotY: ry,
              rotZ: rz,
              skewX: 0,
              skewY: 0
            };
            const b = window.LayerTransform.getBounds(cssLayer);
            window.CanvasWireframe.draw(wireCtx, b);
          }
        }
      }

      sliderX?.addEventListener('input', renderDemo);
      sliderY?.addEventListener('input', renderDemo);
      sliderZ?.addEventListener('input', renderDemo);

      resetBtn?.addEventListener('click', () => {
        if (sliderX) sliderX.value = 0;
        if (sliderY) sliderY.value = 0;
        if (sliderZ) sliderZ.value = 0;
        renderDemo();
      });

      renderDemo();
    })();

    // Interactive Demo: Modular Keyframes & Graph Editor
    (function initKeyframesAndGraphDemo() {
      // 1. Keyframe property filter demonstration
      const propBtns = document.querySelectorAll('#demo-kf-property-switch .segmented-switch-item');
      const markers = document.querySelectorAll('#demo-clip-keyframes .timeline-keyframe-marker');
      const brightMarkers = document.querySelectorAll('#demo-clip-keyframes-bright .timeline-keyframe-marker');

      propBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const prop = btn.dataset.prop;
          propBtns.forEach(b => {
            const isSel = (b === btn);
            b.classList.toggle('is-active', isSel);
            b.classList.toggle('is-selected', isSel);
            b.setAttribute('aria-selected', isSel ? 'true' : 'false');
          });

          markers.forEach(m => {
            const matches = (prop !== 'none' && m.dataset.prop === prop);
            m.classList.toggle('is-active-prop', matches);
            m.classList.toggle('is-other-prop', !matches);
          });

          // Bright unselected clip always stays hollow outline with adaptive dark stroke
          brightMarkers.forEach(m => {
            m.classList.remove('is-active-prop');
            m.classList.add('is-other-prop');
          });
        });
      });

      // 2. Interactive Cubic Bezier Graph Editor
      const frame = document.getElementById('demo-graph-canvas-frame');
      const svg = document.getElementById('demo-graph-svg-layer');
      const t1 = document.getElementById('demo-graph-tangent-1');
      const t2 = document.getElementById('demo-graph-tangent-2');
      const curve = document.getElementById('demo-graph-curve-path');
      const p1Handle = document.getElementById('demo-graph-handle-1');
      const p2Handle = document.getElementById('demo-graph-handle-2');
      const btnReverse = document.getElementById('demo-btn-graph-reverse');
      const btnOvershoot = document.getElementById('demo-btn-toggle-overshoot');
      const chkOvershoot = document.getElementById('demo-chk-overshoot');
      const svgChkOvershoot = document.getElementById('demo-svg-chk-overshoot');
      const readout = document.getElementById('demo-easing-readout');

      if (!svg || !p1Handle || !p2Handle) return;

      let easing = [0.0, 0.0, 1.0, 1.0];
      let isOvershoot = false;

      const SVG_W = 260;
      const SVG_H = 170;
      const PAD_X = 28;
      const dashedRect = document.getElementById('demo-graph-dashed-boundary-rect');

      function getBounds() {
        const padY = isOvershoot ? 40 : 24;
        const minX = PAD_X;
        const maxX = SVG_W - PAD_X;
        const yStart = SVG_H - padY;
        const yEnd = padY;
        const rangeY = yStart - yEnd;
        return { minX, maxX, yStart, yEnd, rangeY };
      }

      function updateUI() {
        const { minX, maxX, yStart, yEnd, rangeY } = getBounds();
        const sx1 = minX + easing[0] * (maxX - minX);
        const sy1 = yStart - easing[1] * rangeY;
        const sx2 = minX + easing[2] * (maxX - minX);
        const sy2 = yStart - easing[3] * rangeY;

        if (dashedRect) {
          dashedRect.setAttribute('x', minX);
          dashedRect.setAttribute('y', yEnd);
          dashedRect.setAttribute('width', maxX - minX);
          dashedRect.setAttribute('height', yStart - yEnd);
        }

        p1Handle.setAttribute('cx', sx1.toFixed(1));
        p1Handle.setAttribute('cy', sy1.toFixed(1));
        p2Handle.setAttribute('cx', sx2.toFixed(1));
        p2Handle.setAttribute('cy', sy2.toFixed(1));

        t1.setAttribute('x1', minX);
        t1.setAttribute('y1', yStart);
        t1.setAttribute('x2', sx1.toFixed(1));
        t1.setAttribute('y2', sy1.toFixed(1));

        t2.setAttribute('x1', maxX);
        t2.setAttribute('y1', yEnd);
        t2.setAttribute('x2', sx2.toFixed(1));
        t2.setAttribute('y2', sy2.toFixed(1));

        curve.setAttribute('d', `M ${minX} ${yStart} C ${sx1.toFixed(1)} ${sy1.toFixed(1)}, ${sx2.toFixed(1)} ${sy2.toFixed(1)}, ${maxX} ${yEnd}`);

        if (readout) {
          readout.textContent = `(${easing[0].toFixed(2)}, ${easing[1].toFixed(2)}, ${easing[2].toFixed(2)}, ${easing[3].toFixed(2)})`;
        }
      }

      function setupHandle(handleEl, idx) {
        handleEl.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}

          function onMove(ev) {
            const rect = svg.getBoundingClientRect();
            const sx = ((ev.clientX - rect.left) / rect.width) * SVG_W;
            const sy = ((ev.clientY - rect.top) / rect.height) * SVG_H;
            const { minX, maxX, yStart, rangeY } = getBounds();
            let bx = (sx - minX) / (maxX - minX);
            let by = (yStart - sy) / rangeY;
            bx = Math.max(0, Math.min(1, bx));
            if (!isOvershoot) {
              by = Math.max(0, Math.min(1, by));
            } else {
              by = Math.max(-0.45, Math.min(1.45, by));
            }

            if (idx === 1) {
              easing[0] = Number(bx.toFixed(3));
              easing[1] = Number(by.toFixed(3));
            } else {
              easing[2] = Number(bx.toFixed(3));
              easing[3] = Number(by.toFixed(3));
            }
            updateUI();
          }

          function onUp(ev) {
            try { handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
          }

          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onUp);
        });
      }

      setupHandle(p1Handle, 1);
      setupHandle(p2Handle, 2);

      btnReverse?.addEventListener('click', () => {
        easing = [
          Number((1 - easing[2]).toFixed(3)),
          Number((1 - easing[3]).toFixed(3)),
          Number((1 - easing[0]).toFixed(3)),
          Number((1 - easing[1]).toFixed(3))
        ];
        updateUI();
      });

      btnOvershoot?.addEventListener('click', () => {
        isOvershoot = !isOvershoot;
        if (chkOvershoot) chkOvershoot.classList.toggle('is-checked', isOvershoot);
        if (svgChkOvershoot) svgChkOvershoot.style.display = isOvershoot ? '' : 'none';
        if (frame) frame.classList.toggle('is-overshoot', isOvershoot);
        updateUI();
      });

      updateUI();
    })();

    // Mount Color Picker Showcase
    (function() {
      const inlineEl = document.getElementById('demo-color-picker-inline');
      if (inlineEl && window.FishColorPicker) {
        window.FishColorPicker.mount(inlineEl, {
          initialColor: '#3D4CF5',
          initialTab: 'spectrum',
          onChange: (hex) => {
            const swatch = document.getElementById('demo-color-swatch');
            if (swatch) swatch.style.backgroundColor = hex;
          }
        });
      }
    })();

    // Mount Audio Beatmark Controller Showcase
    (function() {
      const canvas = document.getElementById('demo-beatmark-waveform-canvas');
      const wrapper = document.getElementById('demo-beatmark-waveform-wrapper');
      const needle = document.getElementById('demo-beatmark-waveform-needle');
      const pins = document.getElementById('demo-beatmark-waveform-pins');
      const btnAdd = document.getElementById('demo-btn-add-beatmark-giant');
      const btnPlay = document.getElementById('demo-btn-beatmark-play');
      const btnDelete = document.getElementById('demo-btn-beatmark-delete');
      const countBadge = document.getElementById('demo-beatmark-count');
      const timeDisplay = document.getElementById('demo-beatmark-time');
      const playIcon = document.getElementById('demo-beatmark-play-icon');

      if (!canvas || !wrapper || !needle) return;

      let currentPct = 35;
      let demoPins = [20, 55];
      let isPlaying = false;
      let playTimer = null;

      function renderWaveform() {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const numBars = 72;
        const step = canvas.width / numBars;
        const barWidth = step * 0.65;
        const midY = canvas.height / 2;
        const activeIdx = Math.floor((currentPct / 100) * numBars);

        const cs = getComputedStyle(canvas);
        const primaryColor = cs.getPropertyValue('--color-primary').trim() || '#98ce7b';
        const mutedColor = cs.getPropertyValue('--border-panel').trim() || '#2a3321';

        for (let i = 0; i < numBars; i++) {
          const t = i / numBars;
          const peak = 0.2 + 0.7 * Math.abs(Math.sin(t * 16) * Math.cos(t * 7 + 1.2));
          const h = Math.max(3 * dpr, peak * canvas.height * 0.8);
          const x = i * step + (step - barWidth) / 2;
          ctx.fillStyle = (i <= activeIdx) ? primaryColor : mutedColor;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, midY - h / 2, barWidth, h, 2 * dpr);
          } else {
            ctx.rect(x, midY - h / 2, barWidth, h);
          }
          ctx.fill();
        }
      }

      function updateUI() {
        needle.style.left = `${currentPct}%`;
        const totalSec = 10;
        const curSec = (currentPct / 100) * totalSec;
        const m = Math.floor(curSec / 60);
        const s = Math.floor(curSec % 60);
        const f = Math.floor((curSec % 1) * 60);
        if (timeDisplay) {
          timeDisplay.textContent = `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
        }
        if (countBadge) {
          countBadge.textContent = `${demoPins.length} beatmark${demoPins.length === 1 ? '' : 's'}`;
        }
        if (pins) {
          pins.innerHTML = demoPins.map(p => `<div class="beatmark-wf-pin" style="left: ${p}%;"></div>`).join('');
        }
        renderWaveform();
      }

      let isDragging = false;
      function seekAtEvent(e) {
        const rect = wrapper.getBoundingClientRect();
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        currentPct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
        updateUI();
      }

      wrapper.addEventListener('pointerdown', (e) => {
        isDragging = true;
        try { wrapper.setPointerCapture(e.pointerId); } catch (_) {}
        seekAtEvent(e);
      });
      wrapper.addEventListener('pointermove', (e) => {
        if (isDragging) seekAtEvent(e);
      });
      const endDrag = (e) => {
        if (isDragging) {
          isDragging = false;
          try { wrapper.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      };
      wrapper.addEventListener('pointerup', endDrag);
      wrapper.addEventListener('pointercancel', endDrag);

      btnAdd?.addEventListener('click', () => {
        btnAdd.classList.add('is-pressed');
        setTimeout(() => btnAdd.classList.remove('is-pressed'), 120);
        const rounded = Math.round(currentPct * 10) / 10;
        const exists = demoPins.findIndex(p => Math.abs(p - rounded) <= 2);
        if (exists === -1) {
          demoPins.push(rounded);
          demoPins.sort((a, b) => a - b);
        }
        updateUI();
      });

      btnDelete?.addEventListener('click', () => {
        const rounded = Math.round(currentPct * 10) / 10;
        const idx = demoPins.findIndex(p => Math.abs(p - rounded) <= 3);
        if (idx !== -1) {
          demoPins.splice(idx, 1);
          updateUI();
        }
      });

      btnPlay?.addEventListener('click', () => {
        isPlaying = !isPlaying;
        if (isPlaying) {
          if (playIcon) playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
          playTimer = setInterval(() => {
            currentPct += 0.8;
            if (currentPct >= 100) currentPct = 0;
            updateUI();
          }, 33);
        } else {
          if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
          clearInterval(playTimer);
        }
      });

      window.addEventListener('resize', renderWaveform);
      setTimeout(updateUI, 100);
    })();

    // Mount Template Editor Showcase Helper
    window.openDemoTemplateEditor = function() {
      if (!window.currentProjectState) {
        window.currentProjectState = {
          name: 'Demo Preset Template',
          aspectRatio: '16:9',
          resolution: '1080p',
          fps: 60,
          duration: 10,
          layers: [
            { id: 'demo_l1', name: 'Intro Background.mp4', type: 'video', startSec: 0, durationSec: 4.5, thumbUrl: '' },
            { id: 'demo_l2', name: 'Main Character Photo.jpg', type: 'image', startSec: 2.0, durationSec: 5.0, thumbUrl: '' },
            { id: 'demo_l3', name: 'Outro Clip.mp4', type: 'video', startSec: 6.0, durationSec: 4.0, thumbUrl: '' }
          ]
        };
      }
      if (window.FishTemplateEditor) {
        window.FishTemplateEditor.open();
      }
    };

    window.closeWelcomeModal = function() {
      const checkbox = document.getElementById('welcome-dismiss-checkbox');
      if (checkbox && checkbox.checked) {
        try { localStorage.setItem('oft_seen_welcome_v1', '1'); } catch (_) {}
      }
      if (window.Modal) window.Modal.close();
    };

    window.openDonateFromWelcome = function() {
      const checkbox = document.getElementById('welcome-dismiss-checkbox');
      if (checkbox && checkbox.checked) {
        try { localStorage.setItem('oft_seen_welcome_v1', '1'); } catch (_) {}
      }
      if (window.Modal) window.Modal.open('modal-donate');
    };

    window.toggleQrisDisplay = function() {
      const content = document.getElementById('donate-qris-content');
      const arrow = document.getElementById('qris-arrow-icon');
      if (!content) return;
      const isHidden = content.style.display === 'none' || !content.style.display;
      if (isHidden) {
        content.style.display = 'flex';
        if (arrow) arrow.classList.add('is-open');
      } else {
        content.style.display = 'none';
        if (arrow) arrow.classList.remove('is-open');
      }
    };

    window.testOFTSProgressDemo = function() {
      if (!window.Modal) return;
      const fill = document.getElementById('ofts-progress-fill');
      const pctEl = document.getElementById('ofts-progress-percent');
      const statEl = document.getElementById('ofts-progress-status');
      if (fill) fill.style.width = '0%';
      if (pctEl) pctEl.textContent = '0%';
      if (statEl) statEl.textContent = 'Packing project...';
      window.Modal.open('modal-ofts-progress');
      let p = 0;
      const iv = setInterval(() => {
        p += 10;
        if (fill) fill.style.width = p + '%';
        if (pctEl) pctEl.textContent = p + '%';
        if (statEl) {
          if (p < 30) statEl.textContent = 'Preparing media archive...';
          else if (p < 90) statEl.textContent = 'Compressing (DEFLATE 9)...';
          else statEl.textContent = 'Complete!';
        }
        if (p >= 100) {
          clearInterval(iv);
          setTimeout(() => {
            if (window.Modal && window.Modal.activeModal && window.Modal.activeModal.id === 'modal-ofts-progress') {
              window.Modal.close();
            }
          }, 450);
        }
      }, 160);
    };
