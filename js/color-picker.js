/**
 * FishTool Studio - Universal Color Picker Popover
 * Strictly compliant with AGENTS.md rules:
 * - Clean inline vector SVGs with currentColor
 * - Guaranteed contrast & dynamic textColor inversion
 * - No box-shadow, no text-shadow, flat solid theme tokens
 */
(function(global) {
  'use strict';

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function hsvToRgb(h, s, v) {
    h = (h % 360 + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;

    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (d !== 0) {
      if (max === r) {
        h = ((g - b) / d + (g < b ? 6 : 0));
      } else if (max === g) {
        h = ((b - r) / d + 2);
      } else {
        h = ((r - g) / d + 4);
      }
      h *= 60;
    }

    return { h: Math.round(h), s, v };
  }

  function rgbToHex(r, g, b) {
    const toHex = c => c.toString(16).padStart(2, '0').toUpperCase();
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return { r: 62, g: 130, b: 87 };
    let c = hex.replace('#', '').trim();
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    if (c.length !== 6) return { r: 62, g: 130, b: 87 };
    const num = parseInt(c, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  // Dynamic luminance contrast check per AGENTS.md rule
  function getContrastingTextColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    const y = (r * 299 + g * 587 + b * 114) / 1000;
    return y > 155 ? '#0d1109' : '#FFFFFF';
  }

  function parseColor(str, fallbackAlpha = 1) {
    let defA = typeof fallbackAlpha === 'number' ? fallbackAlpha : 1;
    if (!str) return { h: 140, s: 0.52, v: 0.51, a: defA };
    let a = defA;
    if (str.startsWith('rgba')) {
      const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (match) {
        const r = parseInt(match[1]);
        const g = parseInt(match[2]);
        const b = parseInt(match[3]);
        if (match[4] !== undefined) a = parseFloat(match[4]);
        const hsv = rgbToHsv(r, g, b);
        return { ...hsv, a: Math.max(0, Math.min(1, a)) };
      }
    }
    let c = str.replace('#', '').trim();
    if (c.length === 8) {
      const alphaHex = c.slice(6, 8);
      a = parseInt(alphaHex, 16) / 255;
      str = '#' + c.slice(0, 6);
    }
    const rgb = hexToRgb(str);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    return { ...hsv, a: Math.max(0, Math.min(1, a)) };
  }

  const DEFAULT_SWATCHES = [
    '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#3051FF', '#AF52DE',
    '#FFFFFF', '#C7C7CC', '#8E8E93', '#48484A', '#000000', '#5AC8FA', '#98CE7B'
  ];

  class ColorPickerComponent {
    constructor(options = {}) {
      this.isInline = !!options.isInline;
      this.rootEl = options.rootEl || null;
      this.activeTab = options.initialTab || 'palette';
      const initA = typeof options.initialAlpha === 'number' ? options.initialAlpha : (typeof options.opacity === 'number' ? options.opacity : 1);
      this.color = { h: 140, s: 0.52, v: 0.51, a: initA };
      this.onChange = options.onChange || null;
      this.onCommit = options.onCommit || null;
      this.onClose = options.onClose || null;
      this.savedSwatches = this._loadSavedSwatches();

      this._initDOM();
      this._bindEvents();
      if (options.initialColor) {
        this.setColor(options.initialColor, false, initA);
      }
    }

    _loadSavedSwatches() {
      try {
        const saved = localStorage.getItem('fishtool:custom-swatches');
        if (saved) return JSON.parse(saved);
      } catch (_) {}
      return [];
    }

    _saveSwatches() {
      try {
        localStorage.setItem('fishtool:custom-swatches', JSON.stringify(this.savedSwatches));
      } catch (_) {}
    }

    _initDOM() {
      let root = this.rootEl;

      if (root && root.querySelector('.color-picker-inner')) {
        this.el = root;
      } else {
        if (!root) {
          root = document.createElement('div');
          root.className = this.isInline ? 'color-picker-standalone' : 'popover-card color-picker-popover-card';
          if (!this.isInline) {
            root.id = 'popover-color-picker';
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-hidden', 'true');
            root.style.padding = '0';
            root.style.width = '326px';
            const tail = document.createElement('div');
            tail.className = 'popover-tail';
            tail.setAttribute('aria-hidden', 'true');
            root.appendChild(tail);
          }
        }

        const inner = document.createElement('div');
        inner.className = 'color-picker-inner';
        inner.innerHTML = `
        <div class="color-picker-main">
          <!-- Header Bar: Dynamic Contrast Bound -->
          <div class="color-picker-header">
            <span class="color-picker-header-label">#3E8257 (100%)</span>
            <button type="button" class="color-picker-add-btn" title="Save color to palette" aria-label="Save color">+</button>
          </div>

          <!-- Body Views -->
          <div class="color-picker-body">
            <!-- 1. Palette Grid View -->
            <div class="color-picker-view-palette" style="display: none;">
              <div class="color-picker-swatch-grid">
                ${DEFAULT_SWATCHES.map(hex => `<button type="button" class="color-picker-swatch-item" data-hex="${hex}" style="background-color: ${hex};" title="${hex}"></button>`).join('')}
              </div>
              <div class="color-picker-saved-section" style="display: none;">
                <span class="color-picker-saved-title">Custom</span>
                <div class="color-picker-saved-grid"></div>
              </div>
            </div>

            <!-- 2. Spectrum Wheel View -->
            <div class="color-picker-view-spectrum" style="display: none;">
              <!-- Saturation & Value Box -->
              <div class="color-picker-sv-box" title="Saturation / Value">
                <div class="color-picker-sv-white"></div>
                <div class="color-picker-sv-black"></div>
                <div class="color-picker-sv-cursor"></div>
              </div>

              <!-- Hue Wheel Ring -->
              <div class="color-picker-wheel-box">
                <div class="color-picker-wheel-ring">
                  <div class="color-picker-wheel-ring-mask"></div>
                  <div class="color-picker-wheel-cursor"></div>
                </div>
                <div class="color-picker-wheel-center">
                  <span class="color-picker-wheel-center-hex">#3E8257</span>
                  <span class="color-picker-wheel-center-pct">(100%)</span>
                </div>
                <div class="color-picker-wheel-arrow"></div>
              </div>

              <!-- Alpha Slider -->
              <div class="color-picker-alpha-box" title="Opacity">
                <div class="color-picker-alpha-fill"></div>
                <div class="color-picker-alpha-cursor"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Tool Sidebar (Inline Vector SVGs bound to currentColor) -->
        <nav class="color-picker-sidebar">
          <button type="button" class="color-picker-tab-btn" data-tab="eyedropper" title="Eyedropper" aria-label="Eyedropper">
            <span class="color-picker-tab-icon-wrap">
              <svg viewBox="0 0 24 24" class="color-picker-tab-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.5 8.5 L16 5a2.12 2.12 0 0 1 3 3L15.5 11.5" />
                <path d="M10.5 6.5 L17.5 13.5" />
                <path d="M12.5 8.5 L6.5 14.5 C5.8 15.2 5.3 16.1 5 17.1 L4 20 L6.9 19 C7.9 18.7 8.8 18.2 9.5 17.5 L15.5 11.5" />
              </svg>
            </span>
          </button>
          <button type="button" class="color-picker-tab-btn" data-tab="spectrum" title="Color Wheel & Sliders" aria-label="Color Wheel">
            <span class="color-picker-tab-icon-wrap">
              <svg viewBox="0 0 24 24" class="color-picker-tab-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
                <circle cx="15.5" cy="8.5" r="1.5" />
              </svg>
            </span>
          </button>
          <button type="button" class="color-picker-tab-btn" data-tab="palette" title="Color Palette" aria-label="Color Palette">
            <span class="color-picker-tab-icon-wrap">
              <svg viewBox="0 0 24 24" class="color-picker-tab-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
                <circle cx="13.5" cy="6.5" r="1" fill="currentColor" />
                <circle cx="17.5" cy="10.5" r="1" fill="currentColor" />
                <circle cx="8.5" cy="7.5" r="1" fill="currentColor" />
                <circle cx="6.5" cy="12.5" r="1" fill="currentColor" />
              </svg>
            </span>
          </button>
        </nav>
      `;
        root.appendChild(inner);
      }

      this.el = root;
      this.header = root.querySelector('.color-picker-header');
      this.headerLabel = root.querySelector('.color-picker-header-label');
      this.addBtn = root.querySelector('.color-picker-add-btn');
      this.paletteView = root.querySelector('.color-picker-view-palette');
      this.spectrumView = root.querySelector('.color-picker-view-spectrum');
      this.savedSection = root.querySelector('.color-picker-saved-section');
      this.savedGrid = root.querySelector('.color-picker-saved-grid');
      this.tabBtns = root.querySelectorAll('.color-picker-tab-btn');

      // Spectrum elements
      this.svBox = root.querySelector('.color-picker-sv-box');
      this.svCursor = root.querySelector('.color-picker-sv-cursor');
      this.wheelRing = root.querySelector('.color-picker-wheel-ring');
      this.wheelCursor = root.querySelector('.color-picker-wheel-cursor');
      this.wheelCenter = root.querySelector('.color-picker-wheel-center');
      this.wheelCenterHex = root.querySelector('.color-picker-wheel-center-hex');
      this.wheelCenterPct = root.querySelector('.color-picker-wheel-center-pct');
      this.alphaBox = root.querySelector('.color-picker-alpha-box');
      this.alphaFill = root.querySelector('.color-picker-alpha-fill');
      this.alphaCursor = root.querySelector('.color-picker-alpha-cursor');

      this._renderSavedSwatches();
      this.switchTab(this.activeTab);

      // Cache chip elements (inline mode: present in HTML; popover mode: absent)
      this.previewDot = root.querySelector('.color-picker-preview-dot');
      this.alphaEl    = root.querySelector('.color-picker-header-alpha');
    }

    _bindEvents() {
      // 1. Sidebar Tab Switching & Eyedropper
      this.el.querySelectorAll('[data-tab="eyedropper"], .color-picker-eyedropper-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pickFromScreen();
        });
      });

      this.tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tab = btn.dataset.tab;
          if (tab === 'eyedropper') {
            this.pickFromScreen();
          } else {
            this.switchTab(tab);
          }
        });
      });

      // 2. Add custom color to palette
      this.addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const hex = this.getHex();
        if (!this.savedSwatches.includes(hex)) {
          this.savedSwatches.push(hex);
          if (this.savedSwatches.length > 14) this.savedSwatches.shift();
          this._saveSwatches();
          this._renderSavedSwatches();
        }
      });

      // 3. Swatch clicks in palette
      this.el.addEventListener('click', (e) => {
        const swatch = e.target.closest('.color-picker-swatch-item');
        if (swatch && swatch.dataset.hex) {
          e.stopPropagation();
          this.setColor(swatch.dataset.hex, true);
        }
      });

      // 3b. Hold-to-delete on saved (custom) swatches — 600ms longpress
      this.el.addEventListener('pointerdown', (e) => {
        const swatch = e.target.closest('[data-is-saved="true"]');
        if (!swatch) return;
        e.stopPropagation();
        let moved = false;
        swatch.classList.add('is-hold-pending');

        const holdTimer = setTimeout(() => {
          if (moved) return;
          const hex = swatch.dataset.hex;
          this.savedSwatches = this.savedSwatches.filter(h => h !== hex);
          this._saveSwatches();
          this._renderSavedSwatches();
          cleanup();
        }, 600);

        const onMove = () => { moved = true; cleanup(); };
        const onUp = () => { cleanup(); };

        const cleanup = () => {
          clearTimeout(holdTimer);
          swatch.classList && swatch.classList.remove('is-hold-pending');
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove, { once: false });
        window.addEventListener('pointerup', onUp, { once: true });
      });

      // 4. Spectrum Drag Interactions
      this._bindSVDrag();
      this._bindWheelDrag();
      this._bindAlphaDrag();
    }

    _bindSVDrag() {
      const onMove = (e) => {
        const rect = this.svBox.getBoundingClientRect();
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        const s = clamp((clientX - rect.left) / rect.width, 0, 1);
        const v = clamp(1 - ((clientY - rect.top) / rect.height), 0, 1);
        this.color.s = s;
        this.color.v = v;
        this._updateUI();
        this._notifyChange();
      };

      this.svBox.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        try { this.svBox.setPointerCapture(e.pointerId); } catch (_) {}
        onMove(e);

        const onPointerMove = (ev) => { ev.stopPropagation(); onMove(ev); };
        const onPointerUp = (ev) => {
          try { this.svBox.releasePointerCapture(ev.pointerId); } catch (_) {}
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          if (this.onCommit) this.onCommit(this.getHex(), this.color.a);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    }

    _bindWheelDrag() {
      const onMove = (e) => {
        const rect = this.wheelRing.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        const dx = clientX - cx;
        const dy = clientY - cy;

        let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
        if (angle < 0) angle += 360;
        this.color.h = Math.round(angle % 360);
        this._updateUI();
        this._notifyChange();
      };

      this.wheelRing.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        try { this.wheelRing.setPointerCapture(e.pointerId); } catch (_) {}
        onMove(e);

        const onPointerMove = (ev) => { ev.stopPropagation(); onMove(ev); };
        const onPointerUp = (ev) => {
          try { this.wheelRing.releasePointerCapture(ev.pointerId); } catch (_) {}
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          if (this.onCommit) this.onCommit(this.getHex(), this.color.a);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    }

    _bindAlphaDrag() {
      const onMove = (e) => {
        const rect = this.alphaBox.getBoundingClientRect();
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const a = clamp(1 - ((clientY - rect.top) / rect.height), 0, 1);
        this.color.a = parseFloat(a.toFixed(2));
        this._updateUI();
        this._notifyChange();
      };

      this.alphaBox.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        try { this.alphaBox.setPointerCapture(e.pointerId); } catch (_) {}
        onMove(e);

        const onPointerMove = (ev) => { ev.stopPropagation(); onMove(ev); };
        const onPointerUp = (ev) => {
          try { this.alphaBox.releasePointerCapture(ev.pointerId); } catch (_) {}
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          if (this.onCommit) this.onCommit(this.getHex(), this.color.a);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    }

    switchTab(tab) {
      this.activeTab = tab;
      this.tabBtns.forEach(b => {
        b.classList.toggle('is-active', b.dataset.tab === tab);
      });

      const hasPreviewDot = !!this.el.querySelector('.color-picker-preview-dot');

      if (tab === 'palette') {
        if (this.header) this.header.style.display = 'flex';
        if (this.paletteView) this.paletteView.style.display = 'flex';
        if (this.spectrumView) this.spectrumView.style.display = 'none';
        this._updateUI();
      } else if (tab === 'spectrum') {
        if (this.header) this.header.style.display = hasPreviewDot ? 'flex' : 'none';
        if (this.paletteView) this.paletteView.style.display = 'none';
        if (this.spectrumView) this.spectrumView.style.display = 'flex';
        this._updateUI();
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => this._updateUI());
        }
      }
    }

    pickFromScreen() {
      if (typeof window !== 'undefined' && window.EyeDropper) {
        const dropper = new window.EyeDropper();
        dropper.open().then(res => {
          if (res && res.sRGBHex) {
            this.setColor(res.sRGBHex, true);
          }
        }).catch(() => {});
      } else {
        alert('Eyedropper API requires Chromium browser (Chrome / Edge).');
      }
    }

    setColor(colorStr, triggerChange = false, alphaOverride = null) {
      const currentAlpha = (typeof alphaOverride === 'number') ? alphaOverride : (this.color ? this.color.a : 1);
      this.color = parseColor(colorStr, currentAlpha);
      if (typeof alphaOverride === 'number') {
        this.color.a = Math.max(0, Math.min(1, alphaOverride));
      }
      this._updateUI();
      if (triggerChange) {
        this._notifyChange();
        if (this.onCommit) this.onCommit(this.getHex(), this.color.a, this.getRgbaString());
      }
    }

    getHex() {
      const rgb = hsvToRgb(this.color.h, this.color.s, this.color.v);
      return rgbToHex(rgb.r, rgb.g, rgb.b);
    }

    getRgbaString() {
      const rgb = hsvToRgb(this.color.h, this.color.s, this.color.v);
      return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.color.a})`;
    }

    _notifyChange() {
      const hex = this.getHex();
      if (this.onChange) this.onChange(hex, this.color.a, this.getRgbaString());
    }

    _renderSavedSwatches() {
      if (!this.savedSection || !this.savedGrid) return;
      if (this.savedSwatches.length === 0) {
        this.savedSection.style.display = 'none';
        return;
      }
      this.savedSection.style.display = 'flex';
      this.savedGrid.innerHTML = this.savedSwatches.map(hex => `
        <button type="button" class="color-picker-swatch-item color-picker-swatch-saved" data-hex="${hex}" data-is-saved="true" style="background-color: ${hex};" title="${hex} — hold to delete"></button>
      `).join('');
    }

    _updateUI() {
      const hex = this.getHex();
      const pct = Math.round(this.color.a * 100);
      const labelText = `${hex} (${pct}%)`;
      const textColor = getContrastingTextColor(hex);

      // 1. Header Bar: chip mode (inline) vs full-bg mode (popover)
      if (this.previewDot) {
        // Inline chip mode — only dot changes color, header stays neutral
        this.previewDot.style.backgroundColor = hex;
        if (this.header) this.header.style.backgroundColor = '';
        if (this.headerLabel) {
          if (this.alphaEl) {
            this.headerLabel.textContent = hex;
            this.alphaEl.textContent = `${pct}%`;
          } else {
            this.headerLabel.textContent = labelText;
          }
          this.headerLabel.style.color = '';
        }
        if (this.addBtn) this.addBtn.style.color = '';
      } else {
        // Popover mode — full header changes to current color
        if (this.header) this.header.style.backgroundColor = hex;
        if (this.headerLabel) {
          this.headerLabel.textContent = labelText;
          this.headerLabel.style.color = textColor;
        }
        if (this.addBtn) this.addBtn.style.color = textColor;
      }

      // 2. Highlight matching swatch
      this.el.querySelectorAll('.color-picker-swatch-item').forEach(s => {
        s.classList.toggle('is-selected', (s.dataset.hex || '').toLowerCase() === hex.toLowerCase());
      });

      // 3. Saturation & Value Box
      const pureHueRgb = hsvToRgb(this.color.h, 1, 1);
      this.svBox.style.backgroundColor = `rgb(${pureHueRgb.r}, ${pureHueRgb.g}, ${pureHueRgb.b})`;
      const svW = this.svBox.clientWidth || 58;
      const svH = this.svBox.clientHeight || 110;
      this.svCursor.style.left = (this.color.s * svW) + 'px';
      this.svCursor.style.top = ((1 - this.color.v) * svH) + 'px';
      this.svCursor.style.backgroundColor = hex;

      // 4. Hue Wheel Ring Cursor
      const wheelW = this.wheelRing.clientWidth || 106;
      const wheelH = this.wheelRing.clientHeight || 106;
      const cx = wheelW / 2;
      const cy = wheelH / 2;
      const rMid = (cx + (cx - 16)) / 2;
      const rad = ((this.color.h - 90) * Math.PI) / 180;
      const curX = cx + Math.cos(rad) * rMid;
      const curY = cy + Math.sin(rad) * rMid;
      this.wheelCursor.style.left = curX + 'px';
      this.wheelCursor.style.top = curY + 'px';
      this.wheelCursor.style.backgroundColor = `rgb(${pureHueRgb.r}, ${pureHueRgb.g}, ${pureHueRgb.b})`;

      // Wheel Center display
      this.wheelCenter.style.backgroundColor = hex;
      this.wheelCenterHex.textContent = hex;
      this.wheelCenterHex.style.color = textColor;
      this.wheelCenterPct.textContent = `(${pct}%)`;
      this.wheelCenterPct.style.color = textColor;

      // 5. Alpha Slider
      const alphaH = this.alphaBox.clientHeight || 110;
      this.alphaFill.style.background = `linear-gradient(to bottom, ${hex}, transparent)`;
      this.alphaCursor.style.top = ((1 - this.color.a) * alphaH) + 'px';
      this.alphaCursor.style.backgroundColor = hex;
    }
  }

  // Singleton Popover Manager integrated with js/popover.js
  let activePicker = null;
  let popoverEl = null;

  function ensureColorPickerPopover() {
    if (activePicker) return activePicker;

    popoverEl = document.getElementById('popover-color-picker');

    if (!popoverEl) {
      popoverEl = document.createElement('div');
      popoverEl.className = 'popover-card color-picker-popover-card';
      popoverEl.id = 'popover-color-picker';
      popoverEl.setAttribute('role', 'dialog');
      popoverEl.setAttribute('aria-hidden', 'true');
      popoverEl.style.padding = '0';
      popoverEl.style.width = '326px';

      const tail = document.createElement('div');
      tail.className = 'popover-tail';
      tail.setAttribute('aria-hidden', 'true');
      popoverEl.appendChild(tail);

      document.body.appendChild(popoverEl);
    }

    activePicker = new ColorPickerComponent({
      rootEl: popoverEl,
      isInline: false
    });

    popoverEl.addEventListener('popover:close', () => {
      if (activePicker && activePicker.onClose) {
        activePicker.onClose();
      }
    });

    return activePicker;
  }

  const FishColorPicker = {
    open(opts = {}) {
      const picker = ensureColorPickerPopover();

      picker.onChange = opts.onChange || null;
      picker.onCommit = opts.onCommit || null;
      picker.onClose = opts.onClose || null;

      if (opts.initialTab) {
        picker.switchTab(opts.initialTab);
      }
      const initialAlpha = (typeof opts.opacity === 'number') ? opts.opacity : ((typeof opts.alpha === 'number') ? opts.alpha : null);
      if (opts.color) {
        picker.setColor(opts.color, false, initialAlpha);
      } else if (initialAlpha !== null) {
        picker.color.a = Math.max(0, Math.min(1, initialAlpha));
        picker._updateUI();
      }

      // Delegate positioning, pointy tail placement, spring bounce, click-outside, and popstate to Popover
      if (window.Popover && opts.anchor) {
        window.Popover.open(opts.anchor, popoverEl);
      }
    },

    close() {
      if (window.Popover) {
        window.Popover.close();
      } else if (popoverEl) {
        popoverEl.classList.remove('is-open');
        popoverEl.setAttribute('aria-hidden', 'true');
      }
      if (activePicker && activePicker.onClose) {
        activePicker.onClose();
      }
    },

    mount(containerEl, options = {}) {
      const picker = new ColorPickerComponent({ ...options, isInline: true });
      containerEl.appendChild(picker.el);
      return picker;
    },

    ColorPickerComponent,
    hsvToRgb,
    rgbToHsv,
    rgbToHex,
    hexToRgb,
    getContrastingTextColor,
    parseColor
  };

  global.FishColorPicker = FishColorPicker;
})(typeof window !== 'undefined' ? window : this);
