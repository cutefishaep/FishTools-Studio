/**
 * FishTool Studio - Modular Template & Preset Editor Engine
 * Pure Flat & High Performance: 100% Theme Token Binding, No Blur, No Shadows
 */
(function() {
  'use strict';

  function formatTimeCS(sec) {
    const s = Math.max(0, parseFloat(sec) || 0);
    const mins = String(Math.floor(s / 60)).padStart(2, '0');
    const secs = String(Math.floor(s % 60)).padStart(2, '0');
    const cs = String(Math.floor((s % 1) * 100)).padStart(2, '0');
    return `${mins}:${secs}:${cs}`;
  }

  const TemplateEditor = {
    isOpen: false,
    isPlaying: false,
    currentTime: 0,
    duration: 5,
    activeSlotIndex: 0,
    slots: [],
    _rafId: null,
    _lastTime: 0,
    _isDraggingScrubber: false,
    _initialized: false,
    _elements: {},

    init() {
      if (this._initialized) return;
      this._buildDOM();
      this._bindEvents();
      this._initialized = true;
    },

    _buildDOM() {
      if (document.getElementById('template-editor-overlay')) return;

      const overlay = document.createElement('div');
      overlay.id = 'template-editor-overlay';
      overlay.className = 'template-editor-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Template editor');

      overlay.innerHTML = `
        <div class="template-shell">
          <header class="template-topbar">
            <div class="template-topbar-inner">
              <button type="button" class="template-nav-btn" id="template-btn-back" title="Back to Projects" aria-label="Back to Projects">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 19H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>
                  <polyline points="14 16 10 12 14 8"/>
                  <line x1="10" y1="12" x2="21" y2="12"/>
                </svg>
              </button>
              <span class="template-topbar-title">Template editor</span>
              <button type="button" class="template-btn-next" id="template-btn-next">Next</button>
            </div>
          </header>

          <main class="template-body">
            <!-- Left / Player Section -->
            <section class="template-player-col">
              <!-- Video / Canvas Preview Area -->
              <div class="template-preview-box" id="template-preview-box">
                <canvas class="template-preview-canvas" id="template-preview-canvas" width="1280" height="720"></canvas>
                <div class="template-play-overlay" id="template-play-overlay">
                  <div class="template-play-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                </div>
              </div>

              <!-- Scrubber & Timeline Section -->
              <div class="template-scrubber-section">
                <div class="template-scrubber-wrap" id="template-scrubber-wrap">
                  <div class="template-time-bubble" id="template-time-bubble">00:00:00</div>
                  <div class="template-scrubber-track" id="template-scrubber-track">
                    <div class="template-scrubber-media-range" id="template-scrubber-media-range"></div>
                    <div class="template-scrubber-fill" id="template-scrubber-fill"></div>
                    <div class="template-scrubber-thumb" id="template-scrubber-thumb">
                      <div class="template-thumb-groove"></div>
                      <div class="template-thumb-groove"></div>
                      <div class="template-thumb-groove"></div>
                    </div>
                  </div>
                </div>
                <div class="template-time-labels">
                  <span id="template-time-current">00:00:00</span>
                  <span id="template-time-total">00:05:00</span>
                </div>
              </div>
            </section>

            <!-- Right / Replace Media Section -->
            <section class="template-replace-col">
              <div class="template-replace-header">
                <h2 class="template-replace-title">Replace media</h2>
                <span class="template-replace-count" id="template-replace-count">0 items</span>
              </div>
              <div class="template-media-grid" id="template-media-grid"></div>
            </section>
          </main>
        </div>

        <!-- Hidden file input for media replacement -->
        <input type="file" id="template-media-file-input" accept="image/*,video/*,.mp4,.png,.jpg,.jpeg,.webp,.mov" style="display: none;" aria-hidden="true">

      `;

      document.body.appendChild(overlay);

      // Modular Popover for Next button (using universal js/popover.js)
      if (!document.getElementById('popover-template-next')) {
        const popoverEl = document.createElement('div');
        popoverEl.className = 'popover-card is-menu-popover export-popover-card';
        popoverEl.id = 'popover-template-next';
        popoverEl.setAttribute('role', 'dialog');
        popoverEl.setAttribute('aria-hidden', 'true');
        popoverEl.innerHTML = `
          <div class="popover-tail" aria-hidden="true"></div>
          <div class="popover-menu-list">
            <!-- 1. Open Timeline (at top per user requirement) -->
            <button type="button" class="popover-menu-item" id="btn-template-open-timeline" title="Open Timeline">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4" y1="6" x2="20" y2="6"/>
                <line x1="4" y1="12" x2="14" y2="12"/>
                <line x1="4" y1="18" x2="18" y2="18"/>
              </svg>
              <span>Open Timeline</span>
            </button>
            <div class="popover-menu-divider"></div>
            <!-- 2. Export Current As .PNG -->
            <button type="button" class="popover-menu-item" id="btn-template-export-png" title="Export Current Frame as PNG">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
              <span>Export Current As .PNG</span>
            </button>
            <!-- 3. Image Sequence (.ZIP) -->
            <button type="button" class="popover-menu-item" id="btn-template-export-sequence" title="Export Full Image Sequence as ZIP">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10H8v-2h6v2zm4-4H8v-2h10v2z"/>
              </svg>
              <span>Image Sequence (.ZIP)</span>
            </button>
            <!-- 4. Export Video (.MP4) -->
            <button type="button" class="popover-menu-item" id="btn-template-export-video" title="Open Video Export Settings">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
              <span>Export Video (.MP4)</span>
            </button>
          </div>
        `;
        document.body.appendChild(popoverEl);
      }

      this._elements = {
        overlay,
        canvas: overlay.querySelector('#template-preview-canvas'),
        previewBox: overlay.querySelector('#template-preview-box'),
        playOverlay: overlay.querySelector('#template-play-overlay'),
        scrubberWrap: overlay.querySelector('#template-scrubber-wrap'),
        scrubberTrack: overlay.querySelector('#template-scrubber-track'),
        mediaRange: overlay.querySelector('#template-scrubber-media-range'),
        scrubberFill: overlay.querySelector('#template-scrubber-fill'),
        scrubberThumb: overlay.querySelector('#template-scrubber-thumb'),
        timeBubble: overlay.querySelector('#template-time-bubble'),
        timeCurrent: overlay.querySelector('#template-time-current'),
        timeTotal: overlay.querySelector('#template-time-total'),
        replaceCount: overlay.querySelector('#template-replace-count'),
        mediaGrid: overlay.querySelector('#template-media-grid'),
        fileInput: overlay.querySelector('#template-media-file-input'),
        btnBack: overlay.querySelector('#template-btn-back'),
        btnNext: overlay.querySelector('#template-btn-next')
      };
    },

    _bindEvents() {
      const el = this._elements;
      if (!el.overlay) return;

      // Back button -> Navigate back to index.html (Projects hub)
      el.btnBack.addEventListener('click', () => {
        this.pause();
        window.location.href = 'index.html';
      });

      // Next button -> toggles popover-template-next anchored via js/popover.js
      el.btnNext.setAttribute('data-popover-placement', 'bottom');
      el.btnNext.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pause();
        if (window.Popover) {
          window.Popover.toggle(el.btnNext, 'popover-template-next');
        }
      });

      // Popover menu items
      const btnOpenTimeline = document.getElementById('btn-template-open-timeline');
      if (btnOpenTimeline) {
        btnOpenTimeline.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.Popover) window.Popover.close();
          this.close();
        });
      }

      const btnExpPNG = document.getElementById('btn-template-export-png');
      if (btnExpPNG) {
        btnExpPNG.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.Popover) window.Popover.close();
          const mainBtn = document.getElementById('btn-export-png');
          if (mainBtn) mainBtn.click();
        });
      }

      const btnExpSeq = document.getElementById('btn-template-export-sequence');
      if (btnExpSeq) {
        btnExpSeq.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.Popover) window.Popover.close();
          const mainBtn = document.getElementById('btn-export-sequence');
          if (mainBtn) mainBtn.click();
        });
      }

      const btnExpVideo = document.getElementById('btn-template-export-video');
      if (btnExpVideo) {
        btnExpVideo.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.Popover) window.Popover.close();
          const mainBtn = document.getElementById('btn-export-video-modal');
          if (mainBtn) mainBtn.click();
        });
      }

      // Preview box click -> toggle play/pause
      el.previewBox.addEventListener('click', () => {
        this.togglePlay();
      });

      // Space key to toggle play/pause while template editor is open
      window.addEventListener('keydown', (e) => {
        if (!this.isOpen) return;
        if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          this.togglePlay();
        }
      }, true);

      // Scrubber pointer events (fluid & constrained drag)
      const track = el.scrubberTrack;
      const wrap = el.scrubberWrap;

      const updateScrubFromPointer = (clientX) => {
        const rect = track.getBoundingClientRect();
        if (rect.width <= 0) return;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        this.seek(pct * this.duration);
      };

      wrap.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.pause();
        this._isDraggingScrubber = true;
        wrap.setPointerCapture(e.pointerId);
        updateScrubFromPointer(e.clientX);
      });

      wrap.addEventListener('pointermove', (e) => {
        if (!this._isDraggingScrubber) return;
        e.preventDefault();
        updateScrubFromPointer(e.clientX);
      });

      const stopScrub = (e) => {
        if (this._isDraggingScrubber) {
          this._isDraggingScrubber = false;
          try { wrap.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      };

      wrap.addEventListener('pointerup', stopScrub);
      wrap.addEventListener('pointercancel', stopScrub);

      // File input change handler for media replacement
      el.fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        await this._handleFileReplacement(file);
        el.fileInput.value = '';
      });

      // Native browser back button (popstate support)
      window.addEventListener('popstate', (e) => {
        if (this.isOpen) {
          if (window.Popover && window.Popover.activePopover && window.Popover.activePopover.id === 'popover-template-next') {
            window.Popover.close(false);
          } else {
            this.close(true);
          }
        }
      });
    },

    open() {
      this.init();
      const el = this._elements;
      if (!el.overlay) return;

      this._collectReplaceableSlots();
      this._syncDuration();
      this.currentTime = 0;
      this.isPlaying = false;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      if (el.playOverlay) {
        el.playOverlay.classList.remove('is-hidden');
      }

      this._updatePreviewBoxAspect();
      this._renderMediaGrid();
      if (this.slots.length > 0) {
        this.selectSlot(0, false);
      } else {
        this._updateScrubberUI();
      }
      this.renderFrame();

      el.overlay.classList.add('is-open');
      this.isOpen = true;

      // Push history state for native back button / Android gesture
      try {
        history.pushState({ templateEditorOpen: true }, '');
      } catch (_) {}
    },

    close(fromPopstate = false) {
      if (!this.isOpen) return;
      this.pause();
      window.isTimelinePlaying = false;
      if (window.Popover && window.Popover.activePopover && window.Popover.activePopover.id === 'popover-template-next') {
        window.Popover.close(false);
      }
      const el = this._elements;
      el.overlay.classList.remove('is-open');
      this.isOpen = false;

      if (!fromPopstate) {
        try {
          if (history.state && history.state.templateEditorOpen) {
            history.back();
          }
        } catch (_) {}
      }

      // Sync back to editor timeline
      if (typeof window.seekTimelineToTime === 'function') {
        window.seekTimelineToTime(this.currentTime, true);
      }
      if (typeof window.redrawComposition === 'function') {
        window.redrawComposition('template-editor-close');
      }
    },

    _updatePreviewBoxAspect() {
      const el = this._elements;
      const state = window.currentProjectState || {};
      const aspect = state.aspectRatio || '16:9';
      let canvasW = 1280;
      let canvasH = 720;

      if (aspect === '9:16') {
        canvasW = 720;
        canvasH = 1280;
      } else if (aspect === '1:1') {
        canvasW = 1080;
        canvasH = 1080;
      } else if (aspect === '4:5') {
        canvasW = 864;
        canvasH = 1080;
      } else if (aspect === '4:3') {
        canvasW = 1280;
        canvasH = 960;
      }

      el.canvas.width = canvasW;
      el.canvas.height = canvasH;
    },

    _syncDuration() {
      let dur = 0;
      if (typeof window.getProjectTotalDuration === 'function') {
        dur = window.getProjectTotalDuration();
      } else if (window.currentProjectState && window.currentProjectState.duration) {
        dur = window.currentProjectState.duration;
      }
      if (!dur || dur <= 0) {
        (this.slots || []).forEach(s => {
          const end = (s.startSec || 0) + (s.durationSec || 0);
          if (end > dur) dur = end;
        });
      }
      this.duration = Math.max(0.5, dur || 5);
      if (this._elements.timeTotal) {
        this._elements.timeTotal.textContent = formatTimeCS(this.duration);
      }
    },

    _collectReplaceableSlots() {
      this.slots = [];
      const state = window.currentProjectState;
      if (!state) return;

      const pps = window.currentPixelsPerSecond || 80;

      const traverse = (layers) => {
        if (!Array.isArray(layers)) return;
        layers.forEach((layer) => {
          // Audio and fixed template videos are strictly excluded from Replace Media
          if (layer.type === 'audio') return;
          if (layer.dataUrl && (layer.dataUrl.startsWith('data:audio') || /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(layer.dataUrl))) return;
          if (layer.type === 'video' && !layer.isReplaceableSlot) return;

          const isMedia = layer.type === 'image' || layer.fillType === 'media' || layer.isReplaceableSlot;
          if (isMedia) {
            const startSec = layer.startSec !== undefined ? layer.startSec : ((layer.startPx || 0) / pps);
            const durSec = layer.durationSec !== undefined ? layer.durationSec : ((layer.widthPx || 320) / pps);
            let slotType = 'image';
            if (layer.type === 'video' || (layer.dataUrl && (layer.dataUrl.startsWith('data:video') || /\.(mp4|webm|mov)(\?.*)?$/i.test(layer.dataUrl)))) {
              slotType = 'video';
            }
            const defaultName = slotType === 'video' ? 'Video' : 'Image';
            this.slots.push({
              layerId: layer.id,
              mediaId: layer.mediaId || layer.fillMediaId || null,
              name: layer.name || defaultName,
              type: slotType,
              thumbUrl: layer.thumbUrl || (layer.dataUrl || layer.fillMediaUrl || ''),
              dataUrl: layer.dataUrl || layer.fillMediaUrl || '',
              startSec: startSec,
              durationSec: durSec,
              fillType: layer.fillType
            });
          }
          if (Array.isArray(layer.layers)) {
            traverse(layer.layers);
          }
        });
      };

      traverse(state.layers || []);
    },

    _renderMediaGrid() {
      const grid = this._elements.mediaGrid;
      grid.innerHTML = '';

      if (this._elements.replaceCount) {
        this._elements.replaceCount.textContent = `${this.slots.length} ${this.slots.length === 1 ? 'item' : 'items'}`;
      }

      if (this.slots.length === 0) {
        grid.innerHTML = '<div class="template-media-empty">No replaceable media layers found in this project.</div>';
        return;
      }

      this.slots.forEach((slot, idx) => {
        const card = document.createElement('div');
        card.className = 'template-media-card' + (idx === this.activeSlotIndex ? ' is-active' : '');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Replace ' + slot.name);

        const isVideo = slot.type === 'video';
        const typeIcon = isVideo
          ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';

        const replaceSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4"/><polyline points="16 3 20 7 16 11"/><path d="M4 17h16"/><polyline points="8 13 4 17 8 21"/></svg>';

        const thumbHtml = slot.thumbUrl
          ? ('<img class="template-card-thumb" src="' + slot.thumbUrl + '" alt="' + slot.name + '" />')
          : ('<div class="template-card-fallback">' + slot.type.toUpperCase() + '</div>');

        card.innerHTML = thumbHtml +
          '<div class="template-card-badge-type">' + typeIcon + '</div>' +
          '<div class="template-card-replace-icon" role="button" tabindex="0" title="Replace ' + slot.name + '" aria-label="Replace ' + slot.name + '">' + replaceSvg + '</div>' +
          '<div class="template-card-duration">' + formatTimeCS(slot.durationSec) + '</div>';

        const replaceBtn = card.querySelector('.template-card-replace-icon');
        if (replaceBtn) {
          replaceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openMediaPicker(idx);
          });
          replaceBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              this.openMediaPicker(idx);
            }
          });
        }

        card.addEventListener('click', () => {
          if (this.activeSlotIndex === idx) {
            this.openMediaPicker(idx);
          } else {
            this.selectSlot(idx, false);
          }
        });

        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (this.activeSlotIndex === idx) {
              this.openMediaPicker(idx);
            } else {
              this.selectSlot(idx, false);
            }
          }
        });

        grid.appendChild(card);
      });
    },

    openMediaPicker(idx) {
      if (idx !== undefined && idx !== null && idx >= 0 && idx < this.slots.length) {
        if (this.activeSlotIndex !== idx) {
          this.selectSlot(idx, false);
        }
      }
      if (this._elements.fileInput) {
        this._elements.fileInput.accept = 'image/*,video/*,.mp4,.png,.jpg,.jpeg,.webp,.mov';
        this._elements.fileInput.value = '';
        this._elements.fileInput.click();
      }
    },

    selectSlot(idx, triggerPicker = false) {
      if (idx < 0 || idx >= this.slots.length) return;
      this.activeSlotIndex = idx;

      // Update active border on slot cards (only active card shows replace icon)
      const cards = this._elements.mediaGrid.querySelectorAll('.template-media-card');
      cards.forEach((c, i) => c.classList.toggle('is-active', i === idx));

      const slot = this.slots[idx];
      if (slot) {
        const startSec = Math.max(0, slot.startSec !== undefined ? slot.startSec : 0);
        const durSec = Math.max(0.1, slot.durationSec !== undefined ? slot.durationSec : 1);

        // Highlight appearance span on the scrubber track (Alight Motion style)
        if (this._elements.mediaRange && this.duration > 0) {
          const startPct = Math.max(0, Math.min(100, (startSec / this.duration) * 100));
          const widthPct = Math.max(0.5, Math.min(100 - startPct, (durSec / this.duration) * 100));
          this._elements.mediaRange.style.left = startPct + '%';
          this._elements.mediaRange.style.width = widthPct + '%';
          this._elements.mediaRange.style.display = 'block';
        }
      }

      this.renderFrame();

      if (triggerPicker) {
        this.openMediaPicker(idx);
      }
    },

    async _handleFileReplacement(file) {
      const slot = this.slots[this.activeSlotIndex];
      if (!slot) return;

      const state = window.currentProjectState;
      if (!state || !Array.isArray(state.layers)) return;

      const findLayerRecursive = (layers, id) => {
        if (!Array.isArray(layers)) return null;
        for (let l of layers) {
          if (l.id === id) return l;
          if (Array.isArray(l.layers)) {
            const found = findLayerRecursive(l.layers, id);
            if (found) return found;
          }
        }
        return null;
      };

      const layer = findLayerRecursive(state.layers, slot.layerId);
      if (!layer) return;

      const isVideoFile = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
      const isAudioFile = file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
      const isImageFile = file.type.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(file.name);

      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });

      if (!dataUrl) return;

      // Update layer properties
      layer.name = file.name || layer.name;
      layer.dataUrl = dataUrl;

      // Detach old audio/media element if attached
      if (window.FishAudioEngine) {
        try {
          const oldEntry = window.layerMediaCache && (window.layerMediaCache.get(layer.id) || (layer.mediaId && window.layerMediaCache.get(layer.mediaId)));
          if (oldEntry && oldEntry.el) {
            window.FishAudioEngine.detachMediaElement(oldEntry.el);
            if (!oldEntry.el.paused) oldEntry.el.pause();
          }
        } catch (_) {}
      }

      // Clear video / image media cache
      if (window.layerMediaCache) {
        window.layerMediaCache.delete(layer.id);
        if (layer.mediaId) window.layerMediaCache.delete(layer.mediaId);
      }

      if (isVideoFile) {
        layer.type = 'video';
        // Measure video dimensions and extract poster frame
        await new Promise((resolve) => {
          const vid = document.createElement('video');
          vid.preload = 'auto';
          vid.muted = true;
          vid.onloadeddata = () => {
            layer.mediaWidth = vid.videoWidth || 1280;
            layer.mediaHeight = vid.videoHeight || 720;
            if (vid.duration && !layer.isDurationExplicit) {
              layer.mediaDuration = vid.duration;
            }
            // Capture thumbnail
            const c = document.createElement('canvas');
            c.width = 160;
            c.height = Math.round(160 * ((vid.videoHeight || 720) / (vid.videoWidth || 1280)));
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.drawImage(vid, 0, 0, c.width, c.height);
              layer.thumbUrl = c.toDataURL('image/jpeg', 0.85);
            }
            resolve();
          };
          vid.onerror = () => resolve();
          vid.src = dataUrl;
        });
      } else if (isAudioFile) {
        layer.type = 'audio';
        layer.thumbUrl = '';
        delete layer.layers;
        delete layer._precompBufferCanvas;
        // Measure audio duration
        await new Promise((resolve) => {
          const aud = new Audio();
          aud.preload = 'metadata';
          aud.onloadedmetadata = () => {
            if (isFinite(aud.duration) && aud.duration > 0) {
              layer.mediaDuration = aud.duration;
              if (!layer.isDurationExplicit) {
                layer.durationSec = aud.duration;
                const pps = window.currentPixelsPerSecond || 80;
                layer.widthPx = Math.round(aud.duration * pps);
              }
            }
            resolve();
          };
          aud.onerror = () => resolve();
          aud.src = dataUrl;
        });
        if (typeof window.getOrLoadLayerMedia === 'function') {
          const mediaEntry = window.getOrLoadLayerMedia(layer);
          if (mediaEntry && mediaEntry.el) {
            mediaEntry.el.src = dataUrl;
            mediaEntry.el.load();
          }
        }
      } else {
        layer.type = 'image';
        layer.thumbUrl = dataUrl;
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            layer.mediaWidth = img.naturalWidth || 1280;
            layer.mediaHeight = img.naturalHeight || 720;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = dataUrl;
        });
      }

      if (layer.fillType === 'media') {
        layer.fillMediaUrl = dataUrl;
        layer.fillMediaName = file.name;
        layer._fillDirty = true;
        layer._fillMediaImg = null;
      }

      // Sync slot thumbnail in UI
      slot.type = layer.type;
      slot.thumbUrl = layer.thumbUrl || (layer.type === 'audio' ? '' : dataUrl);
      slot.dataUrl = dataUrl;
      slot.name = file.name;
      if (layer.mediaDuration) {
        slot.durationSec = layer.mediaDuration;
      }

      const activeCard = this._elements.mediaGrid.children[this.activeSlotIndex];
      if (activeCard) {
        const isAudio = slot.type === 'audio';
        const isVideo = slot.type === 'video';
        const typeBadge = activeCard.querySelector('.template-card-badge-type');
        if (typeBadge) {
          typeBadge.innerHTML = isAudio
            ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'
            : (isVideo
              ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>');
        }
        const durEl = activeCard.querySelector('.template-card-duration');
        if (durEl) {
          durEl.textContent = formatTimeCS(slot.durationSec);
        }
        let imgEl = activeCard.querySelector('.template-card-thumb');
        let fb = activeCard.querySelector('.template-card-fallback');
        if (isAudio) {
          if (imgEl) imgEl.remove();
          if (!fb) {
            fb = document.createElement('div');
            activeCard.insertBefore(fb, activeCard.firstChild);
          }
          fb.className = 'template-card-fallback template-card-audio-fallback';
          fb.title = slot.name;
          fb.innerHTML = `
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" style="margin-bottom: 2px;">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
            <span style="max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.65rem;">${slot.name || 'AUDIO'}</span>
          `;
        } else {
          if (fb) fb.remove();
          if (!imgEl) {
            imgEl = document.createElement('img');
            imgEl.className = 'template-card-thumb';
            activeCard.insertBefore(imgEl, activeCard.firstChild);
          }
          imgEl.src = slot.thumbUrl;
        }
      }

      // Persist to IndexedDB
      if (typeof window.invalidatePreviewCacheForLayer === 'function') {
        window.invalidatePreviewCacheForLayer(layer);
      }
      if (typeof window.saveCurrentProjectLayers === 'function') {
        await window.saveCurrentProjectLayers(true);
      }
      if (window.FishDatabase && state.id) {
        try {
          await window.FishDatabase.saveProject(state);
        } catch (_) {}
      }

      // Redraw canvas
      if (typeof window.redrawComposition === 'function') {
        window.redrawComposition('template-media-replaced');
      }
      this.renderFrame();
    },

    seek(timeSec) {
      this.currentTime = Math.max(0, Math.min(this.duration, timeSec));
      this._updateScrubberUI();
      if (typeof window.seekTimelineToTime === 'function') {
        window.seekTimelineToTime(this.currentTime, true);
      }
      if (window.FishAudioEngine && !this.isPlaying) {
        const pps = window.currentPixelsPerSecond || 80;
        const layers = window.currentProjectState ? (window.currentProjectState.layers || []) : [];
        window.FishAudioEngine.syncPlayback(layers, this.currentTime, pps);
        window.FishAudioEngine.pauseAll();
      }
      this.renderFrame();
    },

    _updateScrubberUI() {
      const el = this._elements;
      const pct = this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
      el.scrubberFill.style.width = pct + '%';
      el.scrubberThumb.style.left = pct + '%';
      
      // Clamp bubble within track range
      const clampedPct = Math.max(7, Math.min(93, pct));
      el.timeBubble.style.left = clampedPct + '%';

      const timeStr = formatTimeCS(this.currentTime);
      el.timeBubble.textContent = timeStr;
      el.timeCurrent.textContent = timeStr;
    },

    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    },

    play() {
      if (this.isPlaying) return;
      this.isPlaying = true;
      window.isTimelinePlaying = true;
      if (this._elements.playOverlay) {
        this._elements.playOverlay.classList.add('is-hidden');
      }
      this._lastTime = performance.now();
      this._playTickCount = 0;

      if (window.FishAudioEngine) {
        if (!window.FishAudioEngine.isUnlocked) {
          window.FishAudioEngine.unlock();
        }
      }

      if (this.currentTime >= this.duration - 0.05) {
        this.currentTime = 0;
      }

      const loop = (now) => {
        if (!this.isPlaying) return;
        try {
          const delta = (now - this._lastTime) / 1000;
          this._lastTime = now;

          this.currentTime += delta;
          if (this.currentTime >= this.duration) {
            this.currentTime = 0; // loop
          }

          this._updateScrubberUI();
          if (typeof window.seekTimelineToTime === 'function') {
            window.seekTimelineToTime(this.currentTime, false);
          }

          this._playTickCount++;
          if (window.FishAudioEngine && (this._playTickCount === 1 || this._playTickCount % 4 === 0)) {
            const pps = window.currentPixelsPerSecond || 80;
            const layers = window.currentProjectState ? (window.currentProjectState.layers || []) : [];
            window.FishAudioEngine.syncPlayback(layers, this.currentTime, pps);
          }

          this.renderFrame();
        } catch (err) {
          console.warn('Template playback loop error:', err);
        }

        this._rafId = requestAnimationFrame(loop);
      };

      this._rafId = requestAnimationFrame(loop);
    },

    pause() {
      if (!this.isPlaying) return;
      this.isPlaying = false;
      window.isTimelinePlaying = false;
      if (this._elements.playOverlay) {
        this._elements.playOverlay.classList.remove('is-hidden');
      }
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }

      if (window.FishAudioEngine) {
        window.FishAudioEngine.pauseAll();
      }

      const layers = window.currentProjectState ? (window.currentProjectState.layers || []) : [];
      layers.forEach(layer => {
        if (layer.type === 'video' || layer.type === 'audio') {
          const media = window.getOrLoadLayerMedia ? window.getOrLoadLayerMedia(layer) : (window.layerMediaCache ? window.layerMediaCache.get(layer.mediaId || layer.id) : null);
          if (media && media.el && !media.el.paused) {
            try { media.el.pause(); } catch (_) {}
          }
        }
      });
    },

    renderFrame() {
      const canvas = this._elements.canvas;
      if (!canvas) return;
      const state = window.currentProjectState || {};

      if (typeof window.renderCanvasFrame === 'function') {
        window.renderCanvasFrame(
          canvas,
          state.bgColor || '#000000',
          canvas.width,
          canvas.height,
          'template-frame',
          this.currentTime
        );
      } else {
        // Fallback: draw from editor canvas
        const srcCanvas = document.getElementById('editor-active-canvas');
        if (srcCanvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(srcCanvas, 0, 0, canvas.width, canvas.height);
        }
      }
    }
  };

  window.FishTemplateEditor = TemplateEditor;

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TemplateEditor.init());
  } else {
    TemplateEditor.init();
  }
})();