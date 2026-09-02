/* ════════════════════════════════════════════════════════════
   colorPicker.js — Alight Motion Style Global Color Picker Component
   FishTools Studio
   ════════════════════════════════════════════════════════════ */

// Color Conversion Helpers
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s, v };
}

function rgbToHex(r, g, b) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseHexOrRgb(colorStr) {
  if (!colorStr) return { r: 255, g: 255, b: 255, a: 1 };
  colorStr = colorStr.trim();
  if (colorStr.startsWith('#')) {
    let hex = colorStr.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.substr(0, 2), 16) || 0,
        g: parseInt(hex.substr(2, 2), 16) || 0,
        b: parseInt(hex.substr(4, 2), 16) || 0,
        a: 1
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.substr(0, 2), 16) || 0,
        g: parseInt(hex.substr(2, 2), 16) || 0,
        b: parseInt(hex.substr(4, 2), 16) || 0,
        a: Math.round((parseInt(hex.substr(6, 2), 16) / 255) * 100) / 100
      };
    }
  } else if (colorStr.startsWith('rgb')) {
    const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match) {
      return {
        r: parseInt(match[1], 10),
        g: parseInt(match[2], 10),
        b: parseInt(match[3], 10),
        a: match[4] !== undefined ? parseFloat(match[4]) : 1
      };
    }
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

// Preset Palette Swatches (Matching FishTool Studio Warm Theme & Essentials)
const PALETTE_SWATCHES = [
  '#FFFFFF', '#FFF2C2', '#FAB778', '#D06423', '#9E4310', '#541F05', '#000000',
  '#EB5757', '#F2994A', '#F2C94C', '#27AE60', '#2D9CDB', '#BB6BD9', '#FF8A65'
];

// ════════════════════════════════════════════════════════════
// Universal Floating Popover Engine (window.FishPopover)
// ════════════════════════════════════════════════════════════
class UniversalFishPopover {
  constructor() {
    this.popoverEl = null;
    this.cardEl = null;
    this.tailEl = null;
    this.activeCloseCallback = null;
    this.currentAnchor = null;
    this.initDOM();
  }

  initDOM() {
    if (document.getElementById('fishUniversalPopover')) {
      this.popoverEl = document.getElementById('fishUniversalPopover');
      this.cardEl = this.popoverEl.querySelector('.fish-popover-card');
      this.tailEl = this.popoverEl.querySelector('.fish-popover-tail');
      return;
    }

    this.popoverEl = document.createElement('div');
    this.popoverEl.id = 'fishUniversalPopover';
    this.popoverEl.className = 'fish-universal-popover';

    this.popoverEl.innerHTML = `
      <!-- Speech Bubble Tail (Behind Card: z-index 1) -->
      <div class="fish-popover-tail"></div>
      <!-- Inner Card Container (Above Tail: z-index 2) -->
      <div class="fish-popover-card" id="fishPopoverCard"></div>
    `;

    const attach = () => {
      if (!this.popoverEl.parentElement && document.body) {
        document.body.appendChild(this.popoverEl);
      }
    };
    if (document.body) attach();
    else document.addEventListener('DOMContentLoaded', attach);

    this.cardEl = this.popoverEl.querySelector('.fish-popover-card');
    this.tailEl = this.popoverEl.querySelector('.fish-popover-tail');

    // Dismiss on click outside (No blur overlay)
    document.addEventListener('pointerdown', (e) => {
      if (!this.isOpen()) return;
      if (this.popoverEl.contains(e.target)) return;
      if (this.currentAnchor && this.currentAnchor.contains(e.target)) return;
      this.close();
    }, true);

    // Dismiss on Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });
  }

  isOpen() {
    return this.popoverEl && this.popoverEl.classList.contains('active');
  }

  position(anchorEl) {
    if (!this.popoverEl) return;
    if (typeof anchorEl === 'string') {
      anchorEl = document.querySelector(anchorEl);
    }
    if (anchorEl && (!anchorEl.isConnected || (anchorEl.getBoundingClientRect && anchorEl.getBoundingClientRect().width === 0 && anchorEl.getBoundingClientRect().height === 0))) {
      anchorEl = document.getElementById('btnEditGradientStopColor') || document.getElementById('gradientBar') || anchorEl;
    }

    this.currentAnchor = anchorEl || null;

    const popoverWidth = this.popoverEl.offsetWidth || 310;
    const popoverHeight = this.popoverEl.offsetHeight || 200;

    if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
      const rect = anchorEl.getBoundingClientRect();
      const anchorCy = rect.top + rect.height / 2;

      // Clear all arrow classes first
      this.popoverEl.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right');

      // Calculate available space in each direction
      const spaceAbove = rect.top - 8;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceLeft = rect.left - 8;
      const spaceRight = window.innerWidth - rect.right - 8;

      let top, left;
      let arrowClass;

      // Decide direction based on available space (prefer the side with most room)
      if (spaceBelow >= spaceAbove && spaceBelow > 60) {
        // Popover BELOW anchor (arrow points up from popover)
        top = rect.bottom + 10;
        arrowClass = 'arrow-top';
      } else if (spaceAbove >= spaceBelow && spaceAbove > 60) {
        // Popover ABOVE anchor (arrow points down from popover)
        top = rect.top - popoverHeight - 10;
        arrowClass = 'arrow-bottom';
      } else if (spaceRight >= spaceLeft && spaceRight > 60) {
        // Popover RIGHT of anchor (arrow points left from popover)
        top = anchorCy - popoverHeight / 2;
        left = rect.right + 10;
        arrowClass = 'arrow-left';
      } else {
        // Popover LEFT of anchor (arrow points right from popover)
        top = anchorCy - popoverHeight / 2;
        left = rect.left - popoverHeight - 10;
        arrowClass = 'arrow-right';
      }

      // Clamp vertical position
      top = Math.max(8, Math.min(window.innerHeight - popoverHeight - 8, top));

      if (arrowClass === 'arrow-top' || arrowClass === 'arrow-bottom') {
        // Center horizontally on anchor
        left = rect.left + (rect.width / 2) - (popoverWidth / 2);
        left = Math.max(8, Math.min(window.innerWidth - popoverWidth - 8, left));
        const arrowLeft = Math.max(16, Math.min(popoverWidth - 16, (rect.left + rect.width / 2) - left));
        this.popoverEl.style.setProperty('--arrow-left', `${arrowLeft}px`);
        this.popoverEl.style.setProperty('--arrow-top', '50%');
        // Transform origin for scale animation (from the tail)
        this.popoverEl.style.transformOrigin = `center ${arrowClass === 'arrow-top' ? '0%' : '100%'}`;
      } else {
        // Center vertically on anchor (for left/right arrows)
        top = rect.top + (rect.height / 2) - (popoverHeight / 2);
        top = Math.max(8, Math.min(window.innerHeight - popoverHeight - 8, top));
        const arrowTop = Math.max(16, Math.min(popoverHeight - 16, (rect.top + rect.height / 2) - top));
        this.popoverEl.style.setProperty('--arrow-top', `${arrowTop}px`);
        this.popoverEl.style.setProperty('--arrow-left', '50%');
        // Transform origin for scale animation (from the tail)
        this.popoverEl.style.transformOrigin = `${arrowClass === 'arrow-left' ? '0%' : '100%'} center`;
      }

      this.popoverEl.classList.add(arrowClass);
      this.popoverEl.style.top = `${Math.round(top)}px`;
      this.popoverEl.style.left = `${Math.round(left)}px`;
    } else {
      this.popoverEl.classList.remove('arrow-bottom', 'arrow-top', 'arrow-left', 'arrow-right');
      const top = Math.max(60, window.innerHeight - popoverHeight - 120);
      const left = Math.max(8, window.innerWidth - popoverWidth - 24);
      this.popoverEl.style.top = `${Math.round(top)}px`;
      this.popoverEl.style.left = `${Math.round(left)}px`;
    }
  }

  show({ anchorElement, content, className, onClose }) {
    if (!this.popoverEl) this.initDOM();
    this.activeCloseCallback = onClose || null;

    this.cardEl.innerHTML = '';
    if (typeof content === 'string') {
      this.cardEl.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      this.cardEl.appendChild(content);
    }

    this.cardEl.className = className ? `fish-popover-card ${className}` : 'fish-popover-card';
    this.popoverEl.classList.add('active');

    this.position(anchorElement);
    requestAnimationFrame(() => {
      this.position(anchorElement);
    });
  }

  confirmDelete({ anchorElement, onConfirm }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fish-popover-delete-btn';
    btn.innerHTML = `
      <span class="material-symbols-rounded">delete</span>
      <span>Hapus</span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
      if (onConfirm) onConfirm();
    });

    this.show({
      anchorElement,
      content: btn,
      className: 'popover-confirm-delete-card',
      onClose: null
    });
  }

  close() {
    if (!this.popoverEl) return;
    this.popoverEl.classList.remove('active');
    this.currentAnchor = null;
    if (this.activeCloseCallback) {
      this.activeCloseCallback();
      this.activeCloseCallback = null;
    }
  }
}

// Global Singleton Popover Engine
const globalFishPopover = new UniversalFishPopover();
if (typeof window !== 'undefined') {
  window.FishPopover = globalFishPopover;
  window.openFishPopover = (opts) => globalFishPopover.show(opts);
  window.closeFishPopover = () => globalFishPopover.close();
}

class FishColorPicker {
  constructor() {
    this.h = 0;
    this.s = 1;
    this.v = 1;
    this.a = 1;
    this.currentView = 'wheel'; // 'wheel' | 'palette'
    this.activeCallback = null;
    this.activeCompleteCallback = null;
    this.currentAnchor = null;
    this.isDraggingSV = false;
    this.isDraggingHue = false;
    this.isDraggingAlpha = false;

    this.initDOM();
  }

  initDOM() {
    this.cardInner = document.createElement('div');
    this.cardInner.className = 'am-cp-card-inner';

    this.cardInner.innerHTML = `
      <!-- Top Color Banner Bar with Label & Add '+' Button -->
      <div class="am-cp-top-bar" id="amCpTopBar">
        <span class="am-cp-top-label" id="amCpTopLabel">#C37BB6 (100%)</span>
        <button type="button" class="am-cp-add-preset-btn" id="amCpBtnAddPreset" title="Simpan ke Palette Presets">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>

      <!-- Main Body (Controls + Right Tabs) -->
      <div class="am-cp-body-wrap">
        <!-- Main Area (Pure Controls Row) -->
        <div class="am-cp-main-area">
          <!-- Views Container -->
          <div class="am-cp-view-container">
            <!-- 1. Wheel + SV Box View -->
            <div class="am-cp-wheel-view" id="amCpWheelView">
              <!-- SV Box (Rectangle on the left) -->
              <div class="am-cp-sv-box" id="amCpSvBox">
                <div class="am-cp-sv-gradients">
                  <div class="am-cp-sv-white-gradient"></div>
                  <div class="am-cp-sv-black-gradient"></div>
                </div>
                <div class="am-cp-sv-thumb" id="amCpSvThumb"></div>
              </div>

              <!-- Hue Ring Wheel with Clean Solid Preview Center -->
              <div class="am-cp-hue-container" id="amCpHueContainer">
                <div class="am-cp-hue-ring" id="amCpHueRing"></div>
                <div class="am-cp-hue-inner-cutout" id="amCpInnerCutout"></div>
                <div class="am-cp-hue-thumb" id="amCpHueThumb"></div>
              </div>

              <!-- Alpha Vertical Slider -->
              <div class="am-cp-alpha-track-wrap" id="amCpAlphaWrap">
                <div class="am-cp-alpha-track" id="amCpAlphaTrack">
                  <div class="am-cp-alpha-gradient-overlay" id="amCpAlphaOverlay"></div>
                </div>
                <div class="am-cp-alpha-thumb" id="amCpAlphaThumb"></div>
              </div>
            </div>

            <!-- 2. Palette Swatches View -->
            <div class="am-cp-palette-view" id="amCpPaletteView">
              <div class="am-cp-swatches-grid" id="amCpSwatchesGrid"></div>
            </div>
          </div>
        </div>

        <!-- Right Sidebar Navigation Tabs -->
        <div class="am-cp-sidebar-tabs">
          <!-- Eyedropper Tab -->
          <button type="button" class="am-cp-tab-btn" id="amCpTabEyedropper" title="Eyedropper / Ambil Warna Layar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="m14 7 3 3"/>
              <path d="M19.5 4.5a2.121 2.121 0 0 1 0 3L7.5 19.5 3 21l1.5-4.5L16.5 4.5a2.121 2.121 0 0 1 3 0Z"/>
            </svg>
          </button>

          <!-- Wheel / SV Mode Tab (Active default) -->
          <button type="button" class="am-cp-tab-btn active" id="amCpTabWheel" title="Color Wheel & Saturation Box">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4"/>
              <circle cx="16" cy="8" r="2.5"/>
            </svg>
          </button>

          <!-- Palette Swatches Tab -->
          <button type="button" class="am-cp-tab-btn" id="amCpTabPalette" title="Color Palette Presets">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
              <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
              <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
              <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Cache elements
    this.topBar = this.cardInner.querySelector('#amCpTopBar');
    this.topLabel = this.cardInner.querySelector('#amCpTopLabel');
    this.btnAddPreset = this.cardInner.querySelector('#amCpBtnAddPreset');

    this.innerCutout = this.cardInner.querySelector('#amCpInnerCutout');

    this.wheelView = this.cardInner.querySelector('#amCpWheelView');
    this.paletteView = this.cardInner.querySelector('#amCpPaletteView');

    if (this.wheelView) {
      this.wheelView.classList.add('active');
      this.wheelView.style.display = 'flex';
    }
    if (this.paletteView) {
      this.paletteView.classList.remove('active');
      this.paletteView.style.display = 'none';
    }

    this.svBox = this.cardInner.querySelector('#amCpSvBox');
    this.svThumb = this.cardInner.querySelector('#amCpSvThumb');

    this.hueRing = this.cardInner.querySelector('#amCpHueRing');
    this.hueThumb = this.cardInner.querySelector('#amCpHueThumb');

    this.alphaTrack = this.cardInner.querySelector('#amCpAlphaTrack');
    this.alphaOverlay = this.cardInner.querySelector('#amCpAlphaOverlay');
    this.alphaThumb = this.cardInner.querySelector('#amCpAlphaThumb');

    this.tabEyedropper = this.cardInner.querySelector('#amCpTabEyedropper');
    this.tabWheel = this.cardInner.querySelector('#amCpTabWheel');
    this.tabPalette = this.cardInner.querySelector('#amCpTabPalette');

    this.swatchesGrid = this.cardInner.querySelector('#amCpSwatchesGrid');

    this.initSwatches();
    this.bindEvents();
  }

  initSwatches() {
    this.swatchesGrid.innerHTML = '';
    PALETTE_SWATCHES.forEach((col, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'am-cp-swatch-btn';
      btn.style.backgroundColor = col;
      btn.dataset.color = col;
      btn.title = `${col} (Klik untuk pilih, tekan lama untuk hapus)`;

      let longPressTimer = null;
      let isLongPressed = false;

      const onStart = () => {
        isLongPressed = false;
        longPressTimer = setTimeout(() => {
          isLongPressed = true;
          if (navigator.vibrate) navigator.vibrate(25);
          btn.style.transform = 'scale(0.85)';
          // Hapus warna dari palette presets
          PALETTE_SWATCHES.splice(index, 1);
          this.initSwatches();
          this.updatePreviewAndValues();
        }, 500);
      };

      const onEnd = () => {
        clearTimeout(longPressTimer);
      };

      btn.addEventListener('mousedown', onStart);
      btn.addEventListener('touchstart', onStart, { passive: true });
      btn.addEventListener('mouseup', onEnd);
      btn.addEventListener('mouseleave', onEnd);
      btn.addEventListener('touchend', onEnd);
      btn.addEventListener('touchcancel', onEnd);

      // Context menu (klik kanan) juga menghapus swatch
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        PALETTE_SWATCHES.splice(index, 1);
        this.initSwatches();
        this.updatePreviewAndValues();
      });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLongPressed) return;
        this.setColor(col, this.a);
        this.notifyChange();
      });

      this.swatchesGrid.appendChild(btn);
    });
  }

  bindEvents() {
    // Outside pointerdown dismiss listener
    this._outsideClickListener = (e) => {
      if (!this.isOpen()) return;
      if (this.cardInner && this.cardInner.contains(e.target)) return;
      if (window.FishPopover && window.FishPopover.popoverEl && window.FishPopover.popoverEl.contains(e.target)) return;
      if (this.currentAnchor && (this.currentAnchor === e.target || this.currentAnchor.contains(e.target))) return;
      this.close();
    };
    document.addEventListener('pointerdown', this._outsideClickListener, true);

    // Tab buttons
    this.tabWheel.addEventListener('click', (e) => {
      e.stopPropagation();
      this.switchView('wheel');
    });

    this.tabPalette.addEventListener('click', (e) => {
      e.stopPropagation();
      this.switchView('palette');
    });

    // Add current color to Presets '+' button
    if (this.btnAddPreset) {
      this.btnAddPreset.addEventListener('click', (e) => {
        e.stopPropagation();
        const hex = this.getHex();
        const existingIdx = PALETTE_SWATCHES.indexOf(hex);
        if (existingIdx !== -1) {
          PALETTE_SWATCHES.splice(existingIdx, 1);
        }
        PALETTE_SWATCHES.unshift(hex);
        if (PALETTE_SWATCHES.length > 21) PALETTE_SWATCHES.pop();
        this.initSwatches();
        this.updatePreviewAndValues();

        // Visual feedback pulse animation
        this.btnAddPreset.style.transform = 'translateY(-50%) scale(1.35)';
        setTimeout(() => {
          if (this.btnAddPreset) this.btnAddPreset.style.transform = 'translateY(-50%) scale(1)';
        }, 150);
      });
    }

    this.tabEyedropper.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.pickEyeDropper();
    });

    // 1. SV Box Drag
    const onSVDown = (e) => {
      e.preventDefault();
      this.isDraggingSV = true;
      this.updateSVFromPointer(e);

      const onSVMove = (me) => {
        if (!this.isDraggingSV) return;
        me.preventDefault();
        this.updateSVFromPointer(me);
      };

      const onSVUp = () => {
        this.isDraggingSV = false;
        window.removeEventListener('mousemove', onSVMove);
        window.removeEventListener('mouseup', onSVUp);
        window.removeEventListener('touchmove', onSVMove);
        window.removeEventListener('touchend', onSVUp);
      };

      window.addEventListener('mousemove', onSVMove);
      window.addEventListener('mouseup', onSVUp);
      window.addEventListener('touchmove', onSVMove, { passive: false });
      window.addEventListener('touchend', onSVUp);
    };
    this.svBox.addEventListener('mousedown', onSVDown);
    this.svBox.addEventListener('touchstart', onSVDown, { passive: false });

    // 2. Hue Wheel Drag
    const onHueDown = (e) => {
      e.preventDefault();
      this.isDraggingHue = true;
      this.updateHueFromPointer(e);

      const onHueMove = (me) => {
        if (!this.isDraggingHue) return;
        me.preventDefault();
        this.updateHueFromPointer(me);
      };

      const onHueUp = () => {
        this.isDraggingHue = false;
        window.removeEventListener('mousemove', onHueMove);
        window.removeEventListener('mouseup', onHueUp);
        window.removeEventListener('touchmove', onHueMove);
        window.removeEventListener('touchend', onHueUp);
      };

      window.addEventListener('mousemove', onHueMove);
      window.addEventListener('mouseup', onHueUp);
      window.addEventListener('touchmove', onHueMove, { passive: false });
      window.addEventListener('touchend', onHueUp);
    };
    this.hueRing.addEventListener('mousedown', onHueDown);
    this.hueRing.addEventListener('touchstart', onHueDown, { passive: false });

    // 3. Alpha Slider Drag
    const onAlphaDown = (e) => {
      e.preventDefault();
      this.isDraggingAlpha = true;
      this.updateAlphaFromPointer(e);

      const onAlphaMove = (me) => {
        if (!this.isDraggingAlpha) return;
        me.preventDefault();
        this.updateAlphaFromPointer(me);
      };

      const onAlphaUp = () => {
        this.isDraggingAlpha = false;
        window.removeEventListener('mousemove', onAlphaMove);
        window.removeEventListener('mouseup', onAlphaUp);
        window.removeEventListener('touchmove', onAlphaMove);
        window.removeEventListener('touchend', onAlphaUp);
      };

      window.addEventListener('mousemove', onAlphaMove);
      window.addEventListener('mouseup', onAlphaUp);
      window.addEventListener('touchmove', onAlphaMove, { passive: false });
      window.addEventListener('touchend', onAlphaUp);
    };
    this.alphaTrack.addEventListener('mousedown', onAlphaDown);
    this.alphaTrack.addEventListener('touchstart', onAlphaDown, { passive: false });
  }

  updateSVFromPointer(e) {
    const rect = this.svBox.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

    this.s = x / rect.width;
    this.v = 1 - (y / rect.height);

    this.renderSVThumb();
    this.updatePreviewAndValues();
    this.notifyChange();
  }

  updateHueFromPointer(e) {
    const rect = this.hueRing.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = clientX - cx;
    const dy = clientY - cy;

    let deg = Math.atan2(dy, dx) * (180 / Math.PI);
    deg = (deg + 360) % 360;
    // CSS conic-gradient `from 0deg` puts 0deg at top (red), but atan2 puts 0deg at right.
    // Offset by +90deg to align: atan2's 0deg (right) -> CSS 90deg (right)
    this.h = (deg + 90) % 360;

    this.renderHueThumb();
    this.renderSVBackground();
    this.updatePreviewAndValues();
    this.notifyChange();
  }

  updateAlphaFromPointer(e) {
    const rect = this.alphaTrack.getBoundingClientRect();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    // Top = 100% (alpha 1), Bottom = 0% (alpha 0)
    this.a = Math.round((1 - (y / rect.height)) * 100) / 100;

    this.renderAlphaThumb();
    this.updatePreviewAndValues();
    this.notifyChange();
  }

  switchView(viewName) {
    this.currentView = viewName;
    if (viewName === 'wheel') {
      this.tabWheel.classList.add('active');
      this.tabPalette.classList.remove('active');
      this.wheelView.classList.add('active');
      this.paletteView.classList.remove('active');
      this.wheelView.style.display = 'flex';
      this.paletteView.style.display = 'none';
      this.render();
    } else {
      this.tabPalette.classList.add('active');
      this.tabWheel.classList.remove('active');
      this.paletteView.classList.add('active');
      this.wheelView.classList.remove('active');
      this.wheelView.style.display = 'none';
      this.paletteView.style.display = 'flex';
    }
  }

  async pickEyeDropper() {
    if (window.EyeDropper) {
      try {
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        if (result && result.sRGBHex) {
          this.setColor(result.sRGBHex, this.a);
          this.notifyChange();
        }
      } catch (err) {
        console.warn('EyeDropper cancelled or not allowed', err);
      }
    } else {
      alert('Fitur EyeDropper browser tidak didukung di browser ini. Gunakan panel roda warna.');
    }
  }

  setColor(colorStr, alphaVal) {
    const parsed = parseHexOrRgb(colorStr);
    const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
    this.h = hsv.h;
    this.s = hsv.s;
    this.v = hsv.v;
    if (alphaVal !== undefined) {
      this.a = Math.max(0, Math.min(1, alphaVal));
    } else {
      this.a = parsed.a !== undefined ? parsed.a : 1;
    }
    this.render();
  }

  getHex() {
    const rgb = hsvToRgb(this.h, this.s, this.v);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  getRgbaString() {
    const rgb = hsvToRgb(this.h, this.s, this.v);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this.a})`;
  }

  render() {
    this.renderSVBackground();
    this.renderSVThumb();
    this.renderHueThumb();
    this.renderAlphaThumb();
    this.updatePreviewAndValues();
  }

  renderSVBackground() {
    const pureHue = hsvToRgb(this.h, 1, 1);
    const hex = rgbToHex(pureHue.r, pureHue.g, pureHue.b);
    this.svBox.style.backgroundColor = hex;
  }

  renderSVThumb() {
    const w = this.svBox ? (this.svBox.clientWidth || 72) : 72;
    const h = this.svBox ? (this.svBox.clientHeight || 72) : 72;
    const pad = 8;
    const x = Math.max(pad, Math.min(w - pad, this.s * w));
    const y = Math.max(pad, Math.min(h - pad, (1 - this.v) * h));
    if (this.svThumb) {
      this.svThumb.style.left = `${x}px`;
      this.svThumb.style.top = `${y}px`;
    }
  }

  renderHueThumb() {
    const size = this.hueRing ? (this.hueRing.clientWidth || 116) : 116;
    const innerSize = this.innerCutout ? (this.innerCutout.clientWidth || 66) : 66;
    const radius = (size / 2 + innerSize / 2) / 2;
    const rad = ((this.h - 90) * Math.PI) / 180;
    const cx = size / 2;
    const cy = size / 2;
    const x = cx + radius * Math.cos(rad);
    const y = cy + radius * Math.sin(rad);

    if (this.hueThumb) {
      this.hueThumb.style.left = `${x}px`;
      this.hueThumb.style.top = `${y}px`;
      this.hueThumb.style.backgroundColor = 'transparent';
      this.hueThumb.style.borderColor = '#FFFFFF';
    }
  }

  renderAlphaThumb() {
    const h = this.alphaTrack ? (this.alphaTrack.clientHeight || 96) : 96;
    const pad = 4;
    const y = Math.max(pad, Math.min(h - pad, (1 - this.a) * h));
    if (this.alphaThumb) {
      this.alphaThumb.style.top = `${y}px`;
    }

    const rgb = hsvToRgb(this.h, this.s, this.v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    if (this.alphaOverlay) {
      this.alphaOverlay.style.background = `linear-gradient(to bottom, ${hex} 0%, rgba(${rgb.r},${rgb.g},${rgb.b},0) 100%)`;
    }
  }

  updatePreviewAndValues() {
    const hex = this.getHex();
    const pct = Math.round(this.a * 100);
    const rgb = hsvToRgb(this.h, this.s, this.v);

    // Update alpha overlay gradient with the live picked color
    const h = this.alphaTrack ? (this.alphaTrack.clientHeight || 96) : 96;
    const pad = 4;
    const y = Math.max(pad, Math.min(h - pad, (1 - this.a) * h));
    if (this.alphaThumb) {
      this.alphaThumb.style.top = `${y}px`;
    }
    if (this.alphaOverlay) {
      this.alphaOverlay.style.background = `linear-gradient(to bottom, ${hex} 0%, rgba(${rgb.r},${rgb.g},${rgb.b},0) 100%)`;
    }

    // Update Top Bar text and '+' button
    if (this.topLabel) {
      this.topLabel.textContent = `${hex} (${pct}%)`;
    }

    // Center cutout clean solid color swatch preview
    if (this.innerCutout) {
      let swatchBg = hex;
      if (this.a < 1) {
        swatchBg = `linear-gradient(rgba(${rgb.r},${rgb.g},${rgb.b},${this.a}), rgba(${rgb.r},${rgb.g},${rgb.b},${this.a})), repeating-conic-gradient(#808080 0% 25%, #FFF 0% 50%) 50% / 6px 6px`;
      }
      this.innerCutout.style.backgroundColor = hex;
      this.innerCutout.style.background = swatchBg;
    }

    // Mark matching swatch in palette if any
    if (this.swatchesGrid) {
      const swatches = this.swatchesGrid.querySelectorAll('.am-cp-swatch-btn');
      swatches.forEach(s => {
        s.classList.toggle('selected', s.dataset.color.toUpperCase() === hex.toUpperCase());
      });
    }
  }

  notifyChange() {
    if (this.activeCallback) {
      this.activeCallback({
        hex: this.getHex(),
        alpha: this.a,
        rgba: this.getRgbaString(),
        hsv: { h: this.h, s: this.s, v: this.v }
      });
    }
  }

  isOpen() {
    return window.FishPopover ? window.FishPopover.isOpen() : false;
  }

  open({ color, alpha, anchorElement, onChange, onComplete }) {
    this.activeCallback = onChange || null;
    this.activeCompleteCallback = onComplete || null;

    this.setColor(color || '#FFFFFF', alpha !== undefined ? alpha : 1);
    this.switchView('wheel');

    if (window.FishPopover) {
      const fallbackAnchor = anchorElement || document.getElementById('btnEditGradientStopColor') || document.getElementById('gradientBar');
      window.FishPopover.show({
        anchorElement: fallbackAnchor,
        content: this.cardInner,
        className: 'am-color-picker-card-wrapper',
        onClose: () => {
          if (this.activeCompleteCallback) {
            this.activeCompleteCallback({
              hex: this.getHex(),
              alpha: this.a,
              rgba: this.getRgbaString()
            });
          }
        }
      });
    }
  }

  close() {
    if (window.FishPopover) {
      window.FishPopover.close();
    }
  }
}

// Global Singleton Instance
let globalPickerInstance = null;

function getGlobalColorPicker() {
  if (!globalPickerInstance) {
    globalPickerInstance = new FishColorPicker();
  }
  return globalPickerInstance;
}

function openGlobalColorPicker(options) {
  const picker = getGlobalColorPicker();
  picker.open(options);
  return picker;
}

if (typeof window !== 'undefined') {
  window.FishColorPicker = FishColorPicker;
  window.getGlobalColorPicker = getGlobalColorPicker;
  window.openGlobalColorPicker = openGlobalColorPicker;
  window.hsvToRgb = hsvToRgb;
  window.rgbToHsv = rgbToHsv;
  window.rgbToHex = rgbToHex;
  window.parseHexOrRgb = parseHexOrRgb;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FishColorPicker,
    getGlobalColorPicker,
    openGlobalColorPicker,
    hsvToRgb,
    rgbToHsv,
    rgbToHex,
    parseHexOrRgb
  };
}

