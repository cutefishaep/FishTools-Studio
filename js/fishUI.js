/**
 * FishUI - Modular Controller Component Suite for FishTool Studio
 * Provides programmatic, reusable controller widgets:
 * 1. FishUI.createRuler({ ... }) -> Infinite & Bounded Tick Ruler
 * 2. FishUI.createRotationDial({ ... }) -> 360deg Multi-turn Rotational Dial Wheel
 * 3. FishUI.createSlider({ ... }) -> Smooth Linear Value Slider
 * 4. FishUI.createMovePad({ ... }) -> 2D Swipe Touchpad / Joystick
 * 5. FishUI.popover -> Universal Floating Popover Engine
 * 6. FishUI.openColorPicker -> Global Color & Gradient Picker
 */

(function(global) {
  'use strict';

  // Helper to resolve DOM element from string selector or element
  function resolveElement(el) {
    if (!el) return null;
    if (typeof el === 'string') return document.querySelector(el) || document.getElementById(el);
    return el;
  }

  // ════════════════════════════════════════════════════════════════
  // 1. FishRulerSlider - Infinite / Bounded Tick Mark Ruler Slider
  // ════════════════════════════════════════════════════════════════
  class FishRulerSlider {
    constructor(options = {}) {
      this.container = resolveElement(options.container);
      this.vertical = !!options.vertical;
      this.spacing = options.spacing || 10;
      this.min = options.min !== undefined ? options.min : -Infinity;
      this.max = options.max !== undefined ? options.max : Infinity;
      if (options.sensitivity !== undefined) {
        this.sensitivity = options.sensitivity;
      } else if (isFinite(this.min) && isFinite(this.max)) {
        const range = this.max - this.min;
        this.sensitivity = Math.max(0.005, Math.min(2, range / 180));
      } else {
        this.sensitivity = 1.0;
      }
      this.step = options.step || 1;
      this.value = options.value !== undefined ? options.value : 0;
      this.offset = options.offset !== undefined ? options.offset : (this.sensitivity !== 0 ? this.value / this.sensitivity : this.value);
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;

      this.isDragging = false;
      this.prevCoord = 0;
      this.canvas = null;
      this.ctx = null;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.rafId = null;
      this.resizeObserver = null;

      if (this.container) {
        this.init();
      }
    }

    init() {
      this.container.classList.add('fish-ui-ruler-container');
      if (this.vertical) this.container.classList.add('vertical');
      this.container.innerHTML = '';

      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none; display:block;';
      this.container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this.updateDimensions();
      this.bindEvents();
      this.render();

      if (window.ResizeObserver && this.container) {
        this.resizeObserver = new ResizeObserver(() => {
          this.updateDimensions();
          this.render();
        });
        this.resizeObserver.observe(this.container);
      }
    }

    updateDimensions() {
      if (!this.container || !this.canvas) return false;
      const rect = this.container.getBoundingClientRect();
      const parentWidth = this.container.parentElement ? this.container.parentElement.clientWidth : 0;
      const clientW = rect.width || this.container.clientWidth || parentWidth || window.innerWidth || 360;
      const clientH = rect.height || this.container.clientHeight || (this.vertical ? 180 : 48);

      const w = Math.max(20, Math.round(clientW));
      const h = Math.max(20, Math.round(clientH));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const newCanvasW = Math.round(w * dpr);
      const newCanvasH = Math.round(h * dpr);

      let changed = false;
      if (this.canvas.width !== newCanvasW || this.canvas.height !== newCanvasH) {
        this.canvas.width = newCanvasW;
        this.canvas.height = newCanvasH;
        changed = true;
      }

      this.width = w;
      this.height = h;
      this.dpr = dpr;
      return changed;
    }

    bindEvents() {
      const onDown = (e) => {
        e.preventDefault();
        this.isDragging = true;
        const pt = e.touches ? e.touches[0] : e;
        this.prevCoord = this.vertical ? pt.clientY : pt.clientX;
        this.updateDimensions();
        this.render();

        const onMove = (me) => {
          if (!this.isDragging) return;
          me.preventDefault();
          const mpt = me.touches ? me.touches[0] : me;
          const curCoord = this.vertical ? mpt.clientY : mpt.clientX;
          const delta = curCoord - this.prevCoord;
          this.prevCoord = curCoord;

          const valChange = (this.vertical ? -delta : delta) * this.sensitivity;
          let nextVal = this.value + valChange;
          if (this.min !== -Infinity) nextVal = Math.max(this.min, nextVal);
          if (this.max !== Infinity) nextVal = Math.min(this.max, nextVal);

          this.value = nextVal;
          this.offset = this.sensitivity !== 0 ? this.value / this.sensitivity : this.value;
          this.render();

          if (this.onChange) {
            this.onChange(this.value, valChange);
          }
        };

        const onUp = () => {
          this.isDragging = false;
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('touchmove', onMove);
          window.removeEventListener('touchend', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
      };

      this.container.addEventListener('mousedown', onDown);
      this.container.addEventListener('touchstart', onDown, { passive: false });

      // Wheel scrub support
      this.container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = (this.vertical ? e.deltaY : (e.deltaX || e.deltaY));
        if (Math.abs(delta) < 0.5) return;
        const valChange = (this.vertical ? -delta : delta) * 0.25 * this.sensitivity;
        let nextVal = this.value + valChange;
        if (this.min !== -Infinity) nextVal = Math.max(this.min, nextVal);
        if (this.max !== Infinity) nextVal = Math.min(this.max, nextVal);

        this.value = nextVal;
        this.offset = this.sensitivity !== 0 ? this.value / this.sensitivity : this.value;
        this.render();

        if (this.onChange) {
          this.onChange(this.value, valChange);
        }
      }, { passive: false });
    }

    render() {
      if (!this.ctx || this.width <= 0 || this.height <= 0) return;
      const ctx = this.ctx;
      const dpr = this.dpr;
      const w = this.width;
      const h = this.height;
      const spacing = this.spacing;
      const offset = this.offset;

      ctx.clearRect(0, 0, w * dpr, h * dpr);
      ctx.save();
      ctx.scale(dpr, dpr);

      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';

      if (this.vertical) {
        const half = h / 2;
        const minI = Math.floor((-half - spacing - offset) / spacing);
        const maxI = Math.ceil((half + spacing - offset) / spacing);

        for (let i = minI; i <= maxI; i++) {
          const y = Math.round(half + i * spacing + offset) + 0.5;
          if (y < -2 || y > h + 2) continue;

          const mod = ((i % 10) + 10) % 10;
          let tickLen = 8;
          let alpha = 0.35;
          if (mod === 0) {
            tickLen = 22;
            alpha = 0.95;
          } else if (mod === 5) {
            tickLen = 14;
            alpha = 0.65;
          }

          ctx.strokeStyle = `rgba(255, 242, 194, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(w - tickLen, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      } else {
        const half = w / 2;
        const minI = Math.floor((-half - spacing - offset) / spacing);
        const maxI = Math.ceil((half + spacing - offset) / spacing);

        for (let i = minI; i <= maxI; i++) {
          const x = Math.round(half + i * spacing + offset) + 0.5;
          if (x < -2 || x > w + 2) continue;

          const mod = ((i % 10) + 10) % 10;
          let tickLen = 8;
          let alpha = 0.35;
          if (mod === 0) {
            tickLen = 22;
            alpha = 0.95;
          } else if (mod === 5) {
            tickLen = 14;
            alpha = 0.65;
          }

          ctx.strokeStyle = `rgba(255, 242, 194, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(x, h - tickLen);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    setValue(val, updateOffset = true) {
      this.value = val;
      if (updateOffset) {
        this.offset = this.sensitivity !== 0 ? val / this.sensitivity : val;
      }
      this.render();
    }

    setOffset(offset) {
      this.offset = offset;
      this.render();
    }

    getValue() {
      return this.value;
    }

    destroy() {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this.container) {
        this.container.innerHTML = '';
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 2. FishRotationDial - 360deg Multi-turn Rotational Dial Wheel
  // ════════════════════════════════════════════════════════════════
  class FishRotationDial {
    constructor(options = {}) {
      this.container = resolveElement(options.container);
      this.dialKnob = resolveElement(options.knob);
      this.trailPath = resolveElement(options.trail);
      this.trailOverlayPath = resolveElement(options.trailOverlay);
      this.valLabel = resolveElement(options.valLabel);
      this.multiplierLabel = resolveElement(options.multiplierLabel);

      this.cx = options.cx || 90;
      this.cy = options.cy || 90;
      this.radius = options.radius || 72;
      this.value = options.value !== undefined ? options.value : 0;
      this.step = options.step || 1;
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;

      this.isDragging = false;
      this.prevPointerAngle = 0;

      if (this.container) {
        this.init();
      }
    }

    init() {
      this.bindEvents();
      this.render(this.value);
    }

    bindEvents() {
      const onDown = (e) => {
        e.preventDefault();
        this.isDragging = true;
        const rect = this.container.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const pt = e.touches ? e.touches[0] : e;
        this.prevPointerAngle = Math.atan2(pt.clientY - cy, pt.clientX - cx) * (180 / Math.PI);

        let pendingDelta = 0;
        let rafId = null;

        const onMove = (me) => {
          if (!this.isDragging) return;
          me.preventDefault();
          const mpt = me.touches ? me.touches[0] : me;
          const curPointerAngle = Math.atan2(mpt.clientY - cy, mpt.clientX - cx) * (180 / Math.PI);
          let delta = curPointerAngle - this.prevPointerAngle;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          this.prevPointerAngle = curPointerAngle;
          pendingDelta += delta;

          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              this.value = Math.round(this.value + pendingDelta);
              pendingDelta = 0;
              this.render(this.value);

              if (this.onChange) {
                const absDeg = Math.abs(this.value);
                const turns = Math.floor(absDeg / 360);
                const remainder = absDeg % 360;
                this.onChange(this.value, turns, remainder);
              }
            });
          }
        };

        const onUp = () => {
          this.isDragging = false;
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('touchmove', onMove);
          window.removeEventListener('touchend', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
      };

      this.container.addEventListener('mousedown', onDown);
      this.container.addEventListener('touchstart', onDown, { passive: false });
    }

    render(deg) {
      const curRot = deg !== undefined ? deg : this.value;
      const absDeg = Math.abs(curRot);
      const turns = Math.floor(absDeg / 360);
      const remainder = absDeg % 360;
      const sign = curRot < 0 ? '-' : '+';

      // 1. Multiplier badge (e.g. 2×)
      if (this.multiplierLabel) {
        if (turns > 0) {
          this.multiplierLabel.textContent = `${turns}×`;
          this.multiplierLabel.style.display = 'block';
        } else {
          this.multiplierLabel.textContent = '';
          this.multiplierLabel.style.display = 'none';
        }
      }

      // 2. Degree value text
      if (this.valLabel) {
        const dispDeg = turns > 0 ? Math.round(remainder) : Math.round(absDeg);
        this.valLabel.textContent = `${sign}${dispDeg}°`;
      }

      // 3. Knob position on perimeter (Percentage based: always precise even when initially hidden)
      const radiusPct = (this.radius / (this.cx * 2)) * 100;
      const rad = ((curRot - 90) * Math.PI) / 180;
      const leftPct = 50 + radiusPct * Math.cos(rad);
      const topPct = 50 + radiusPct * Math.sin(rad);

      if (this.dialKnob) {
        this.dialKnob.style.left = `${leftPct}%`;
        this.dialKnob.style.top = `${topPct}%`;
        this.dialKnob.style.transform = 'translate(-50%, -50%)';
      }

      // 4. Primary and overlay SVG Arc Trails
      const fullCirclePath = `M ${this.cx} ${this.cy - this.radius} A ${this.radius} ${this.radius} 0 1 1 ${this.cx} ${this.cy + this.radius} A ${this.radius} ${this.radius} 0 1 1 ${this.cx} ${this.cy - this.radius}`;
      const startX = this.cx;
      const startY = this.cy - this.radius;

      if (this.trailPath) {
        if (absDeg < 0.5) {
          this.trailPath.setAttribute('d', '');
        } else if (absDeg >= 360) {
          this.trailPath.setAttribute('d', fullCirclePath);
        } else {
          const sweep = curRot > 0 ? 1 : 0;
          const endRad = ((curRot - 90) * Math.PI) / 180;
          const endX = this.cx + this.radius * Math.cos(endRad);
          const endY = this.cy + this.radius * Math.sin(endRad);
          const largeArc = absDeg > 180 ? 1 : 0;
          this.trailPath.setAttribute('d', `M ${startX} ${startY} A ${this.radius} ${this.radius} 0 ${largeArc} ${sweep} ${endX} ${endY}`);
        }
      }

      // overlay dihapus: trail mentok 1 putaran, tidak menebal lagi
      if (this.trailOverlayPath) {
        this.trailOverlayPath.setAttribute('d', '');
      }
    }

    setValue(deg) {
      this.value = deg;
      this.render(this.value);
    }

    getValue() {
      return this.value;
    }

    reset() {
      this.setValue(0);
    }

    destroy() {
      if (this.container) {
        this.container.innerHTML = '';
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 3. FishLinearSlider - Sleek Continuous / Stepped Linear Slider
  // ════════════════════════════════════════════════════════════════
  class FishLinearSlider {
    constructor(options = {}) {
      this.container = resolveElement(options.container);
      this.inputEl = resolveElement(options.input);
      this.min = options.min !== undefined ? options.min : 0;
      this.max = options.max !== undefined ? options.max : 100;
      this.step = options.step !== undefined ? options.step : 1;
      this.unit = options.unit || '%';
      this.value = options.value !== undefined ? options.value : 100;
      this.valLabel = resolveElement(options.valLabel);
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;

      if (this.inputEl) {
        this.bindEvents();
      } else if (this.container) {
        this.renderDOM();
      }
    }

    renderDOM() {
      this.container.innerHTML = `
        <div class="fish-ui-linear-slider-wrap">
          <input type="range" class="controller-slider fish-ui-slider" min="${this.min}" max="${this.max}" step="${this.step}" value="${this.value}">
          ${this.valLabel ? '' : `<span class="fish-ui-slider-val">${this.value}${this.unit}</span>`}
        </div>
      `;
      this.inputEl = this.container.querySelector('input[type="range"]');
      if (!this.valLabel) {
        this.valLabel = this.container.querySelector('.fish-ui-slider-val');
      }
      this.bindEvents();
    }

    bindEvents() {
      if (!this.inputEl) return;
      this.inputEl.addEventListener('input', () => {
        this.value = parseFloat(this.inputEl.value) || 0;
        this.updateLabel();
        if (this.onChange) {
          this.onChange(this.value);
        }
      });
    }

    updateLabel() {
      if (this.valLabel) {
        this.valLabel.textContent = `${this.value}${this.unit}`;
      }
    }

    setValue(val) {
      this.value = Math.max(this.min, Math.min(this.max, val));
      if (this.inputEl) {
        this.inputEl.value = this.value;
      }
      this.updateLabel();
    }

    getValue() {
      return this.value;
    }

    destroy() {
      if (this.container) this.container.innerHTML = '';
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 4. FishMovePad - 2D Swipe Touchpad / Joystick Controller
  // ════════════════════════════════════════════════════════════════
  class FishMovePad {
    constructor(options = {}) {
      this.container = resolveElement(options.container);
      this.sensitivityX = options.sensitivityX !== undefined ? options.sensitivityX : 2.0;
      this.sensitivityY = options.sensitivityY !== undefined ? options.sensitivityY : 2.0;
      this.invertY = options.invertY !== undefined ? options.invertY : true;
      this.onMove = typeof options.onMove === 'function' ? options.onMove : null;
      this.onEnd = typeof options.onEnd === 'function' ? options.onEnd : null;

      this.isDragging = false;
      this.prevX = 0;
      this.prevY = 0;

      if (this.container) {
        this.bindEvents();
      }
    }

    bindEvents() {
      const onDown = (e) => {
        e.preventDefault();
        this.isDragging = true;
        const pt = e.touches ? e.touches[0] : e;
        this.prevX = pt.clientX;
        this.prevY = pt.clientY;

        let pendingDx = 0;
        let pendingDy = 0;
        let rafId = null;

        const onMove = (me) => {
          if (!this.isDragging) return;
          me.preventDefault();
          const mpt = me.touches ? me.touches[0] : me;
          const rawDx = mpt.clientX - this.prevX;
          const rawDy = mpt.clientY - this.prevY;
          this.prevX = mpt.clientX;
          this.prevY = mpt.clientY;

          pendingDx += rawDx * this.sensitivityX;
          pendingDy += (this.invertY ? -rawDy : rawDy) * this.sensitivityY;

          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              const curDx = pendingDx;
              const curDy = pendingDy;
              pendingDx = 0;
              pendingDy = 0;
              if (this.onMove) {
                this.onMove({ dx: curDx, dy: curDy });
              }
            });
          }
        };

        const onUp = () => {
          this.isDragging = false;
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('touchmove', onMove);
          window.removeEventListener('touchend', onUp);

          if (this.onEnd) {
            this.onEnd();
          }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
      };

      this.container.addEventListener('mousedown', onDown);
      this.container.addEventListener('touchstart', onDown, { passive: false });
    }

    destroy() {
      if (this.container) this.container.innerHTML = '';
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 5. Bezier Easing & Keyframe Math Helpers
  // ════════════════════════════════════════════════════════════════
  function solveCubicBezier(p1x, p1y, p2x, p2y, t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const x = 3 * (1 - s) * (1 - s) * s * p1x + 3 * (1 - s) * s * s * p2x + s * s * s;
      const dx = 3 * (1 - s) * (1 - s) * p1x + 6 * (1 - s) * s * (p2x - p1x) + 3 * s * s * (1 - p2x);
      const diff = x - t;
      if (Math.abs(diff) < 1e-4) break;
      if (Math.abs(dx) > 1e-5) {
        s -= diff / dx;
      } else {
        break;
      }
    }
    return 3 * (1 - s) * (1 - s) * s * p1y + 3 * (1 - s) * s * s * p2y + s * s * s;
  }

  const DEFAULT_GRAPH_PRESETS = [
    { name: 'Linear', cp1x: 0.33, cp1y: 0.33, cp2x: 0.67, cp2y: 0.67 },
    { name: 'Ease In', cp1x: 0.42, cp1y: 0.0, cp2x: 1.0, cp2y: 1.0 },
    { name: 'Ease Out', cp1x: 0.0, cp1y: 0.0, cp2x: 0.58, cp2y: 1.0 },
    { name: 'S-Curve (Ease In Out)', cp1x: 0.42, cp1y: 0.0, cp2x: 0.58, cp2y: 1.0 },
    { name: 'Overshoot / Bounce', cp1x: 0.34, cp1y: 1.45, cp2x: 0.64, cp2y: 1.0 },
    { name: 'Anticipation / Back', cp1x: 0.36, cp1y: -0.35, cp2x: 0.64, cp2y: 1.0 }
  ];

  function interpolateKeyframes(keyframes, time, property, defaultValue = 0) {
    if (!keyframes || keyframes.length === 0) return defaultValue;

    const validKfs = keyframes.filter(k => k[property] !== undefined);
    if (validKfs.length === 0) return defaultValue;
    if (validKfs.length === 1) return validKfs[0][property];

    // Before first keyframe
    if (time <= validKfs[0].time) return validKfs[0][property];

    // After last keyframe
    if (time >= validKfs[validKfs.length - 1].time) {
      return validKfs[validKfs.length - 1][property];
    }

    // Between keyframes
    for (let i = 0; i < validKfs.length - 1; i++) {
      const kf1 = validKfs[i];
      const kf2 = validKfs[i + 1];
      if (time >= kf1.time && time <= kf2.time) {
        const dt = kf2.time - kf1.time;
        if (dt <= 0) return kf2[property];
        let progress = (time - kf1.time) / dt;

        // Apply easing curve if defined
        const easing = kf1[`easing_${property}`] || kf1.easing;
        if (easing && easing.cp1x !== undefined) {
          progress = solveCubicBezier(easing.cp1x, easing.cp1y, easing.cp2x, easing.cp2y, progress);
        }

        const v1 = kf1[property];
        const v2 = kf2[property];
        return v1 + (v2 - v1) * progress;
      }
    }

    return defaultValue;
  }

  // ════════════════════════════════════════════════════════════════
  // 6. FishKeyframeController - Modular Diamond Toggle & Navigation
  // ════════════════════════════════════════════════════════════════
  class FishKeyframeController {
    constructor(options = {}) {
      this.toggleBtn = resolveElement(options.toggleButton);
      this.prevBtn = resolveElement(options.prevButton);
      this.nextBtn = resolveElement(options.nextButton);
      this.graphBtn = resolveElement(options.graphButton);

      this.getChannel = typeof options.getChannel === 'function' ? options.getChannel : () => options.channel || 'default';
      this.getLayerId = typeof options.getLayerId === 'function' ? options.getLayerId : () => options.layerId || 'default';
      this.getCurrentTime = typeof options.getCurrentTime === 'function' ? options.getCurrentTime : () => 0;
      this.getKeyframes = typeof options.getKeyframes === 'function' ? options.getKeyframes : () => [];
      this.getCurrentValue = typeof options.getCurrentValue === 'function' ? options.getCurrentValue : () => null;

      this.onToggle = typeof options.onToggle === 'function' ? options.onToggle : null;
      this.onSeek = typeof options.onSeek === 'function' ? options.onSeek : null;
      this.onOpenGraph = typeof options.onOpenGraph === 'function' ? options.onOpenGraph : null;

      this.tolerance = options.tolerance !== undefined ? options.tolerance : 0.15;

      this.init();
    }

    init() {
      if (this.toggleBtn) {
        this.toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleKeyframe();
        });
      }

      if (this.prevBtn) {
        this.prevBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.seekPrev();
        });
      }

      if (this.nextBtn) {
        this.nextBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.seekNext();
        });
      }

      if (this.graphBtn) {
        this.graphBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openGraph();
        });
      }

      this.updateUI();
    }

    hasKeyframeAt(time, channel) {
      const layerId = this.getLayerId();
      const kfs = this.getKeyframes(layerId);
      const ch = channel || this.getChannel();
      if (!kfs || !kfs.length) return false;

      return kfs.some(k => {
        if (Math.abs(k.time - time) > this.tolerance) return false;
        return k[ch] !== undefined;
      });
    }

    getKeyframeAt(time) {
      const layerId = this.getLayerId();
      const kfs = this.getKeyframes(layerId);
      if (!kfs || !kfs.length) return null;
      return kfs.find(k => Math.abs(k.time - time) <= this.tolerance) || null;
    }

    toggleKeyframe() {
      const layerId = this.getLayerId();
      const ch = this.getChannel();
      const time = this.getCurrentTime();
      const val = this.getCurrentValue(layerId, ch);
      const hasKf = this.hasKeyframeAt(time, ch);

      if (this.onToggle) {
        this.onToggle({
          layerId,
          channel: ch,
          time,
          value: val,
          isRemove: hasKf,
          existingKeyframe: this.getKeyframeAt(time)
        });
      }

      this.updateUI();
    }

    seekPrev() {
      const layerId = this.getLayerId();
      const ch = this.getChannel();
      const time = this.getCurrentTime();
      const kfs = (this.getKeyframes(layerId) || []).filter(k => k[ch] !== undefined && k.time < time - 0.05);

      if (kfs.length > 0) {
        kfs.sort((a, b) => a.time - b.time);
        const target = kfs[kfs.length - 1];
        if (this.onSeek) this.onSeek(target.time);
      }
    }

    seekNext() {
      const layerId = this.getLayerId();
      const ch = this.getChannel();
      const time = this.getCurrentTime();
      const kfs = (this.getKeyframes(layerId) || []).filter(k => k[ch] !== undefined && k.time > time + 0.05);

      if (kfs.length > 0) {
        kfs.sort((a, b) => a.time - b.time);
        const target = kfs[0];
        if (this.onSeek) this.onSeek(target.time);
      }
    }

    openGraph() {
      const layerId = this.getLayerId();
      const ch = this.getChannel();
      const time = this.getCurrentTime();
      const allKfs = (this.getKeyframes(layerId) || []).filter(k => k[ch] !== undefined);
      allKfs.sort((a, b) => a.time - b.time);

      let kf1 = null, kf2 = null;
      for (let i = 0; i < allKfs.length - 1; i++) {
        if (time >= allKfs[i].time - 0.05 && time <= allKfs[i + 1].time + 0.05) {
          kf1 = allKfs[i];
          kf2 = allKfs[i + 1];
          break;
        }
      }

      if (this.onOpenGraph) {
        this.onOpenGraph({ layerId, channel: ch, kf1, kf2 });
      }
    }

    updateUI() {
      const time = this.getCurrentTime();
      const ch = this.getChannel();
      const hasKf = this.hasKeyframeAt(time, ch);

      if (this.toggleBtn) {
        const symbol = this.toggleBtn.querySelector('.diamond-icon-symbol') || this.toggleBtn.querySelector('svg path');
        if (hasKf) {
          this.toggleBtn.classList.add('is-on-keyframe');
          if (symbol) symbol.setAttribute('d', 'M7 12 L17 12');
        } else {
          this.toggleBtn.classList.remove('is-on-keyframe');
          if (symbol) symbol.setAttribute('d', 'M12 7 L12 17 M7 12 L17 12');
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 7. FishGraphEditor - Reusable Bezier Graph Easing Component
  // ════════════════════════════════════════════════════════════════
  class FishGraphEditor {
    constructor(options = {}) {
      this.canvas = resolveElement(options.canvas);
      this.container = resolveElement(options.container);
      this.toggleGridBtn = resolveElement(options.toggleGridButton);
      this.toggleOvershootBtn = resolveElement(options.toggleOvershootButton);
      this.libraryBtn = resolveElement(options.libraryButton);
      this.saveLibraryBtn = resolveElement(options.saveLibraryButton);
      this.closeLibraryBtn = resolveElement(options.closeLibraryButton);
      this.libraryOverlay = resolveElement(options.libraryOverlay);
      this.libraryList = resolveElement(options.libraryList);
      this.backBtn = resolveElement(options.backButton);

      this.cp1 = options.cp1 || { x: 0.33, y: 0.33 };
      this.cp2 = options.cp2 || { x: 0.67, y: 0.67 };
      this.isOvershoot = !!options.isOvershoot;
      this.showGrid = options.showGrid !== undefined ? options.showGrid : true;
      this.storageKey = options.storageKey || 'fishGraphLibrary';

      this.onCurveChange = typeof options.onCurveChange === 'function' ? options.onCurveChange : null;
      this.onApply = typeof options.onApply === 'function' ? options.onApply : null;
      this.onClose = typeof options.onClose === 'function' ? options.onClose : null;

      this.dragging = null;
      this.activeContext = null;

      this.init();
    }

    init() {
      if (this.canvas) {
        this.initCanvasInteraction();
      }

      if (this.toggleGridBtn) {
        this.toggleGridBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showGrid = !this.showGrid;
          this.updateButtonsUI();
          this.render();
        });
      }

      if (this.toggleOvershootBtn) {
        this.toggleOvershootBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.isOvershoot = !this.isOvershoot;
          if (this.isOvershoot) {
            if (this.cp1.y <= 1.0 && this.cp1.y >= 0 && this.cp2.y <= 1.0 && this.cp2.y >= 0) {
              this.cp1 = { x: 0.34, y: 1.35 };
              this.cp2 = { x: 0.64, y: 1.0 };
            }
          } else {
            this.cp1.y = Math.max(0, Math.min(1, this.cp1.y));
            this.cp2.y = Math.max(0, Math.min(1, this.cp2.y));
          }
          this.updateButtonsUI();
          this.notifyChange();
          this.render();
        });
      }

      if (this.libraryBtn) {
        this.libraryBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openLibrary();
        });
      }

      if (this.closeLibraryBtn) {
        this.closeLibraryBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeLibrary();
        });
      }

      if (this.libraryOverlay) {
        this.libraryOverlay.addEventListener('click', (e) => {
          if (e.target === this.libraryOverlay) {
            this.closeLibrary();
          }
        });
      }

      if (this.saveLibraryBtn) {
        this.saveLibraryBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.saveCurrentPreset();
        });
      }

      if (this.backBtn) {
        this.backBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close();
        });
      }

      if (window.ResizeObserver && this.canvas && this.canvas.parentElement) {
        const ro = new ResizeObserver(() => {
          if (this.container && this.container.style.display !== 'none') {
            this.render();
          }
        });
        ro.observe(this.canvas.parentElement);
      }
    }

    initCanvasInteraction() {
      const canvas = this.canvas;
      const HANDLE_R = 26;

      const canvasPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { cx: src.clientX - rect.left, cy: src.clientY - rect.top };
      };

      const getDims = () => {
        const isOver = !!this.isOvershoot;
        const padX = 22;
        const padY = isOver ? 24 : 18;
        const W = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 300;
        const H = canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || 200;
        const gw = Math.max(10, W - padX * 2);
        const gh = Math.max(10, H - padY * 2);
        const YMIN = isOver ? -0.5 : 0.0;
        const YMAX = isOver ? 1.5 : 1.0;
        const YRANGE = YMAX - YMIN;
        return { padX, padY, gw, gh, YMIN, YMAX, YRANGE, isOver };
      };

      const toNorm = (cx, cy) => {
        const { padX, padY, gw, gh, YMIN, YMAX, YRANGE, isOver } = getDims();
        let t = Math.max(0, Math.min(1, (cx - padX) / gw));
        let v;
        if (!isOver) {
          v = Math.max(0, Math.min(1, 1 - (cy - padY) / gh));
        } else {
          v = Math.max(YMIN, Math.min(YMAX, YMIN + (1 - (cy - padY) / gh) * YRANGE));
        }

        if (this.showGrid) {
          const snapThresholdX = 10 / Math.max(100, gw);
          const snapThresholdY = 10 / Math.max(100, gh);
          const snapStepsX = [0, 0.25, 0.333, 0.5, 0.667, 0.75, 1.0];
          for (let s of snapStepsX) {
            if (Math.abs(t - s) <= snapThresholdX) {
              t = s;
              break;
            }
          }
          const snapStepsY = isOver ? [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5] : [0, 0.25, 0.333, 0.5, 0.667, 0.75, 1.0];
          for (let s of snapStepsY) {
            if (Math.abs(v - s) <= snapThresholdY) {
              v = s;
              break;
            }
          }
        }
        return { t, v };
      };

      const isNear = (cx, cy, hx, hy) => {
        const { padX, padY, gw, gh, YMIN, YRANGE } = getDims();
        const hcx = padX + hx * gw;
        const hcy = padY + (1 - (hy - YMIN) / YRANGE) * gh;
        return Math.hypot(cx - hcx, cy - hcy) <= HANDLE_R;
      };

      const onDown = (e) => {
        e.preventDefault();
        const { cx, cy } = canvasPos(e);
        if (isNear(cx, cy, this.cp1.x, this.cp1.y)) {
          this.dragging = 'cp1';
          if (e.pointerId !== undefined) canvas.setPointerCapture(e.pointerId);
        } else if (isNear(cx, cy, this.cp2.x, this.cp2.y)) {
          this.dragging = 'cp2';
          if (e.pointerId !== undefined) canvas.setPointerCapture(e.pointerId);
        }
      };

      const onMove = (me) => {
        if (!this.dragging) return;
        me.preventDefault();
        const { cx, cy } = canvasPos(me);
        const { t, v } = toNorm(cx, cy);
        if (this.dragging === 'cp1') {
          this.cp1 = { x: t, y: v };
        } else {
          this.cp2 = { x: t, y: v };
        }
        this.updateButtonsUI();
        this.notifyChange();
        this.render();
      };

      const onUp = (e) => {
        if (this.dragging) {
          this.notifyChange();
        }
        this.dragging = null;
        if (e.pointerId !== undefined) {
          try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      };

      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
    }

    render() {
      const canvas = this.canvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 300;
      const H = canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || 200;
      if (W <= 0 || H <= 0) return;

      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = '#6E2B05';
      ctx.fillRect(0, 0, W, H);

      const isOver = !!this.isOvershoot;
      const padX = 22;
      const padY = isOver ? 24 : 18;
      const gw = W - padX * 2;
      const gh = H - padY * 2;
      const YMIN = isOver ? -0.5 : 0.0;
      const YMAX = isOver ? 1.5 : 1.0;
      const YRANGE = YMAX - YMIN;

      const toScreenX = (normX) => padX + normX * gw;
      const toScreenY = (normY) => padY + (1 - (normY - YMIN) / YRANGE) * gh;

      // Draw Grid
      if (this.showGrid) {
        ctx.strokeStyle = 'rgba(255, 242, 194, 0.1)';
        ctx.lineWidth = 1;
        [0, 0.25, 0.5, 0.75, 1.0].forEach(t => {
          const x = toScreenX(t);
          ctx.beginPath();
          ctx.moveTo(x, padY);
          ctx.lineTo(x, padY + gh);
          ctx.stroke();
        });
        const yTicks = isOver ? [-0.5, 0, 0.5, 1.0, 1.5] : [0, 0.25, 0.5, 0.75, 1.0];
        yTicks.forEach(v => {
          const y = toScreenY(v);
          ctx.beginPath();
          ctx.moveTo(padX, y);
          ctx.lineTo(padX + gw, y);
          ctx.stroke();
        });
      }

      // Bezier Curve
      const startX = toScreenX(0);
      const startY = toScreenY(0);
      const endX = toScreenX(1);
      const endY = toScreenY(1);
      const cp1X = toScreenX(this.cp1.x);
      const cp1Y = toScreenY(this.cp1.y);
      const cp2X = toScreenX(this.cp2.x);
      const cp2Y = toScreenY(this.cp2.y);

      // Tangent lines
      ctx.strokeStyle = 'rgba(250, 183, 120, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(cp1X, cp1Y);
      ctx.moveTo(endX, endY);
      ctx.lineTo(cp2X, cp2Y);
      ctx.stroke();

      // Main Curve
      ctx.strokeStyle = '#FAB778';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY);
      ctx.stroke();

      // Control Point 1 handle
      ctx.fillStyle = '#FFF2C2';
      ctx.strokeStyle = '#FAB778';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cp1X, cp1Y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Control Point 2 handle
      ctx.beginPath();
      ctx.arc(cp2X, cp2Y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    notifyChange() {
      const curveData = {
        cp1: { ...this.cp1 },
        cp2: { ...this.cp2 },
        isOvershoot: this.isOvershoot,
        cubicBezierString: `cubic-bezier(${this.cp1.x.toFixed(2)}, ${this.cp1.y.toFixed(2)}, ${this.cp2.x.toFixed(2)}, ${this.cp2.y.toFixed(2)})`,
        context: this.activeContext
      };
      if (this.onCurveChange) {
        this.onCurveChange(curveData);
      }
      if (this.onApply && this.activeContext) {
        this.onApply({ ...curveData, ...this.activeContext });
      }
    }

    updateButtonsUI() {
      if (this.toggleGridBtn) {
        this.toggleGridBtn.classList.toggle('active', !!this.showGrid);
      }
      if (this.toggleOvershootBtn) {
        this.toggleOvershootBtn.classList.toggle('active', !!this.isOvershoot);
      }
    }

    open(context = {}) {
      this.activeContext = context;
      if (context.cp1) this.cp1 = { ...context.cp1 };
      if (context.cp2) this.cp2 = { ...context.cp2 };
      if (context.isOvershoot !== undefined) this.isOvershoot = !!context.isOvershoot;

      if (this.container) {
        this.container.style.display = 'flex';
      }
      this.updateButtonsUI();
      requestAnimationFrame(() => this.render());
    }

    close() {
      if (this.container) {
        this.container.style.display = 'none';
      }
      if (this.onClose) this.onClose(this.activeContext);
      this.activeContext = null;
    }

    openLibrary() {
      if (!this.libraryOverlay) return;
      this.libraryOverlay.classList.add('active');
      this.renderLibraryList();
    }

    closeLibrary() {
      if (this.libraryOverlay) this.libraryOverlay.classList.remove('active');
    }

    renderLibraryList() {
      if (!this.libraryList) return;
      this.libraryList.innerHTML = '';

      DEFAULT_GRAPH_PRESETS.forEach(item => {
        const el = document.createElement('div');
        el.className = 'graph-library-item';
        el.innerHTML = `<span class="graph-library-item-name">${item.name}</span>`;
        el.addEventListener('click', () => {
          this.cp1 = { x: item.cp1x, y: item.cp1y };
          this.cp2 = { x: item.cp2x, y: item.cp2y };
          this.isOvershoot = (item.cp1y > 1.01 || item.cp1y < -0.01 || item.cp2y > 1.01 || item.cp2y < -0.01);
          this.closeLibrary();
          this.updateButtonsUI();
          this.notifyChange();
          this.render();
        });
        this.libraryList.appendChild(el);
      });

      // User saved presets from LocalStorage
      try {
        const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        saved.forEach((item, idx) => {
          const el = document.createElement('div');
          el.className = 'graph-library-item';
          el.innerHTML = `
            <span class="graph-library-item-name">${item.name}</span>
            <button type="button" class="graph-library-item-delete"><span class="material-symbols-rounded">delete</span></button>
          `;
          el.querySelector('.graph-library-item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            saved.splice(idx, 1);
            localStorage.setItem(this.storageKey, JSON.stringify(saved));
            this.renderLibraryList();
          });
          el.addEventListener('click', () => {
            this.cp1 = { x: item.cp1x, y: item.cp1y };
            this.cp2 = { x: item.cp2x, y: item.cp2y };
            this.isOvershoot = (item.cp1y > 1.01 || item.cp1y < -0.01 || item.cp2y > 1.01 || item.cp2y < -0.01);
            this.closeLibrary();
            this.updateButtonsUI();
            this.notifyChange();
            this.render();
          });
          this.libraryList.appendChild(el);
        });
      } catch (_) {}
    }

    saveCurrentPreset() {
      const name = prompt('Nama preset graph:');
      if (!name || !name.trim()) return;
      try {
        const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        saved.push({
          name: name.trim(),
          cp1x: this.cp1.x,
          cp1y: this.cp1.y,
          cp2x: this.cp2.x,
          cp2y: this.cp2.y
        });
        localStorage.setItem(this.storageKey, JSON.stringify(saved));
        this.renderLibraryList();
      } catch (_) {}
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 8. FishGraphPopover - Compact Floating Speech-Bubble Easing Popover
  // ════════════════════════════════════════════════════════════════
  class FishGraphPopover {
    constructor() {
      this.popoverEl = null;
      this.cardEl = null;
      this.tailEl = null;
      this.graphEditor = null;
      this.currentAnchor = null;
      this.activeCallback = null;
      this.activeCloseCallback = null;
      this.initDOM();
    }

    initDOM() {
      if (this.popoverEl) return;
      this.popoverEl = document.createElement('div');
      this.popoverEl.className = 'fish-universal-popover am-graph-popover';
      this.popoverEl.id = 'fishGraphPopover';
      this.popoverEl.innerHTML = `
        <div class="fish-popover-tail"></div>
        <div class="fish-popover-card am-graph-card-inner">
          <div class="am-graph-header">
            <span class="am-graph-title" id="graphPopoverTitle">Easing Graph</span>
            <div class="keyframe-controls-group graph-controls-group" style="margin-right:0;">
              <button type="button" class="keyframe-graph-btn" id="btnGraphPopoverLibrary" title="Preset Library">
                <span class="material-symbols-rounded">folder_open</span>
              </button>
              <button type="button" class="keyframe-graph-btn active" id="btnGraphPopoverGrid" title="Grid & Snapping">
                <span class="material-symbols-rounded">grid_4x4</span>
              </button>
              <button type="button" class="keyframe-graph-btn" id="btnGraphPopoverOvershoot" title="Overshoot Curve">
                <span class="material-symbols-rounded">trending_up</span>
              </button>
            </div>
          </div>
          <div class="am-graph-canvas-box" id="graphPopoverCanvasBox">
            <canvas id="graphPopoverCanvas" width="260" height="150"></canvas>
          </div>
          <div class="am-graph-lib-menu" id="graphPopoverLibMenu" style="display:none;">
            <div class="am-graph-lib-header">
              <span>Graph Presets</span>
              <button type="button" id="btnSaveGraphPopoverPreset" class="am-graph-save-btn" title="Simpan">+ Simpan</button>
            </div>
            <div class="am-graph-lib-items" id="graphPopoverLibItems"></div>
          </div>
        </div>
      `;

      const attach = () => {
        if (document.body && !document.getElementById('fishGraphPopover')) {
          document.body.appendChild(this.popoverEl);
        }
      };
      if (document.body) attach();
      else document.addEventListener('DOMContentLoaded', attach);

      this.cardEl = this.popoverEl.querySelector('.fish-popover-card');
      this.tailEl = this.popoverEl.querySelector('.fish-popover-tail');

      // Dismiss on click outside or clicking the curve trigger button
      document.addEventListener('pointerdown', (e) => {
        if (!this.isOpen()) return;
        if (this.popoverEl.contains(e.target)) return;
        if (this.currentAnchor && this.currentAnchor.contains(e.target)) {
          e.stopPropagation();
          e.preventDefault();
          this.close();
          return;
        }
        this.close();
      }, true);

      // Dismiss on Escape
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen()) {
          this.close();
        }
      });

      // Library toggle inside popover
      const btnLib = this.popoverEl.querySelector('#btnGraphPopoverLibrary');
      const libMenu = this.popoverEl.querySelector('#graphPopoverLibMenu');
      if (btnLib && libMenu) {
        btnLib.addEventListener('click', (e) => {
          e.stopPropagation();
          const isShow = libMenu.style.display !== 'none';
          libMenu.style.display = isShow ? 'none' : 'flex';
          btnLib.classList.toggle('active', !isShow);
          if (!isShow) this.renderLibraryList();
        });
      }

      // Save preset button
      const btnSave = this.popoverEl.querySelector('#btnSaveGraphPopoverPreset');
      if (btnSave) {
        btnSave.addEventListener('click', (e) => {
          e.stopPropagation();
          this.saveCurrentPreset();
        });
      }

      // Create internal FishGraphEditor
      this.graphEditor = new FishGraphEditor({
        canvas: this.popoverEl.querySelector('#graphPopoverCanvas'),
        toggleGridButton: this.popoverEl.querySelector('#btnGraphPopoverGrid'),
        toggleOvershootButton: this.popoverEl.querySelector('#btnGraphPopoverOvershoot'),
        onCurveChange: (data) => {
          if (this.activeCallback) this.activeCallback(data);
        }
      });
    }

    isOpen() {
      return this.popoverEl && this.popoverEl.classList.contains('active');
    }

    position(anchorEl) {
      if (!this.popoverEl) return;
      anchorEl = resolveElement(anchorEl);
      this.currentAnchor = anchorEl || null;

      const popoverWidth = this.popoverEl.offsetWidth || 275;
      const popoverHeight = this.popoverEl.offsetHeight || 215;

      let rect = null;
      if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
        const r = anchorEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.top > 0 || r.left > 0 || r.bottom > 0)) {
          rect = r;
        }
      }

      if (!rect) {
        const activeSubpanel = document.querySelector('.inspector-subpanel:not([style*="display: none"])') ||
                              document.getElementById('panelMoveTransform') ||
                              document.getElementById('layerInspectorDrawer') ||
                              document.querySelector('.timeline-panel');
        if (activeSubpanel) {
          const r = activeSubpanel.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.top > 0 || r.left > 0 || r.bottom > 0)) {
            rect = r;
          }
        }
      }

      if (rect) {
        let top, left;

        if (rect.top > popoverHeight + 14) {
          top = rect.top - popoverHeight - 10;
          this.popoverEl.classList.add('arrow-bottom');
          this.popoverEl.classList.remove('arrow-top');
        } else if (rect.bottom + popoverHeight + 10 < window.innerHeight) {
          top = rect.bottom + 10;
          this.popoverEl.classList.add('arrow-top');
          this.popoverEl.classList.remove('arrow-bottom');
        } else {
          top = Math.max(10, window.innerHeight - popoverHeight - 120);
          this.popoverEl.classList.remove('arrow-top', 'arrow-bottom');
        }

        left = rect.left + (rect.width / 2) - (popoverWidth / 2);
        left = Math.max(8, Math.min(window.innerWidth - popoverWidth - 8, left));

        const arrowLeft = Math.max(16, Math.min(popoverWidth - 16, (rect.left + rect.width / 2) - left));
        this.popoverEl.style.setProperty('--arrow-left', `${arrowLeft}px`);

        this.popoverEl.style.top = `${Math.round(top)}px`;
        this.popoverEl.style.left = `${Math.round(left)}px`;
      } else {
        this.popoverEl.classList.remove('arrow-bottom', 'arrow-top');
        const top = Math.max(10, window.innerHeight - popoverHeight - 120);
        const left = Math.max(8, window.innerWidth - popoverWidth - 24);
        this.popoverEl.style.top = `${Math.round(top)}px`;
        this.popoverEl.style.left = `${Math.round(left)}px`;
      }
    }

    open({ anchorElement, title, cp1, cp2, isOvershoot, onCurveChange, onClose }) {
      if (!this.popoverEl) this.initDOM();
      const resolvedAnchor = resolveElement(anchorElement);
      if (this.isOpen() && this.currentAnchor && (this.currentAnchor === resolvedAnchor || this.currentAnchor.contains(resolvedAnchor))) {
        this.close();
        return;
      }
      this.currentAnchor = resolvedAnchor || null;
      this.activeCallback = onCurveChange || null;
      this.activeCloseCallback = onClose || null;

      const titleEl = this.popoverEl.querySelector('#graphPopoverTitle');
      if (titleEl) titleEl.textContent = title || 'Easing Graph';

      const libMenu = this.popoverEl.querySelector('#graphPopoverLibMenu');
      if (libMenu) libMenu.style.display = 'none';
      const btnLib = this.popoverEl.querySelector('#btnGraphPopoverLibrary');
      if (btnLib) btnLib.classList.remove('active');

      this.popoverEl.classList.add('active');
      this.position(resolvedAnchor);

      if (this.graphEditor) {
        this.graphEditor.open({ cp1, cp2, isOvershoot });
      }
    }

    close() {
      if (!this.isOpen()) return;
      this.popoverEl.classList.remove('active');
      if (this.activeCloseCallback) {
        this.activeCloseCallback();
      }
      this.activeCallback = null;
      this.activeCloseCallback = null;
    }

    renderLibraryList() {
      const container = this.popoverEl.querySelector('#graphPopoverLibItems');
      if (!container) return;
      container.innerHTML = '';

      DEFAULT_GRAPH_PRESETS.forEach(item => {
        const row = document.createElement('div');
        row.className = 'am-graph-lib-item';
        row.innerHTML = `<span>${item.name}</span>`;
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.graphEditor) {
            this.graphEditor.cp1 = { x: item.cp1x, y: item.cp1y };
            this.graphEditor.cp2 = { x: item.cp2x, y: item.cp2y };
            this.graphEditor.isOvershoot = (item.cp1y > 1.01 || item.cp1y < -0.01 || item.cp2y > 1.01 || item.cp2y < -0.01);
            this.graphEditor.updateButtonsUI();
            this.graphEditor.notifyChange();
            this.graphEditor.render();
          }
          const libMenu = this.popoverEl.querySelector('#graphPopoverLibMenu');
          if (libMenu) libMenu.style.display = 'none';
          const btnLib = this.popoverEl.querySelector('#btnGraphPopoverLibrary');
          if (btnLib) btnLib.classList.remove('active');
        });
        container.appendChild(row);
      });

      // Local storage saved
      try {
        const saved = JSON.parse(localStorage.getItem('fishGraphLibrary') || '[]');
        saved.forEach((item, idx) => {
          const row = document.createElement('div');
          row.className = 'am-graph-lib-item';
          row.innerHTML = `
            <span>${item.name}</span>
            <button type="button" class="am-graph-lib-del"><span class="material-symbols-rounded">delete</span></button>
          `;
          row.querySelector('.am-graph-lib-del').addEventListener('click', (e) => {
            e.stopPropagation();
            saved.splice(idx, 1);
            localStorage.setItem('fishGraphLibrary', JSON.stringify(saved));
            this.renderLibraryList();
          });
          row.addEventListener('click', () => {
            if (this.graphEditor) {
              this.graphEditor.cp1 = { x: item.cp1x, y: item.cp1y };
              this.graphEditor.cp2 = { x: item.cp2x, y: item.cp2y };
              this.graphEditor.isOvershoot = (item.cp1y > 1.01 || item.cp1y < -0.01 || item.cp2y > 1.01 || item.cp2y < -0.01);
              this.graphEditor.updateButtonsUI();
              this.graphEditor.notifyChange();
              this.graphEditor.render();
            }
            const libMenu = this.popoverEl.querySelector('#graphPopoverLibMenu');
            if (libMenu) libMenu.style.display = 'none';
            const btnLib = this.popoverEl.querySelector('#btnGraphPopoverLibrary');
            if (btnLib) btnLib.classList.remove('active');
          });
          container.appendChild(row);
        });
      } catch (_) {}
    }

    saveCurrentPreset() {
      const name = prompt('Nama preset graph:');
      if (!name || !name.trim()) return;
      if (!this.graphEditor) return;
      try {
        const saved = JSON.parse(localStorage.getItem('fishGraphLibrary') || '[]');
        saved.push({
          name: name.trim(),
          cp1x: this.graphEditor.cp1.x,
          cp1y: this.graphEditor.cp1.y,
          cp2x: this.graphEditor.cp2.x,
          cp2y: this.graphEditor.cp2.y
        });
        localStorage.setItem('fishGraphLibrary', JSON.stringify(saved));
        this.renderLibraryList();
      } catch (_) {}
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 9. FishTopTabs — Shared Top Switch API (Color & Fill + Move & Transform)
  // Single source style: edit .fish-top-tabs / --fish-tab-* in global.css
  // Usage: FishUI.createTopTabs({ container: '#colorFillTabs', onSwitch: (id, btn)=>{} })
  // ════════════════════════════════════════════════════════════════
  class FishTopTabs {
    constructor(options = {}) {
      this.container = resolveElement(options.container);
      this.btnSelector = options.btnSelector || '.controller-switch-btn';
      this.activeClass = options.activeClass || 'active';
      // data attributes priority: data-target-panel > data-fill-tab > data-bs-tab > data-tab
      this.onSwitch = typeof options.onSwitch === 'function' ? options.onSwitch : null;
      this.defaultTab = options.defaultTab || null;
      if (this.container) {
        this.init();
      }
    }
    init() {
      // Global style: add fish-top-tabs class (single source edit → global apply)
      this.container.classList.add('fish-top-tabs');
      const btns = this.container.querySelectorAll(this.btnSelector);
      btns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tabId = btn.dataset.targetPanel || btn.dataset.fillTab || btn.dataset.bsTab || btn.dataset.tab || btn.id || btn.textContent.trim();
          this.setActive(btn);
          if (this.onSwitch) this.onSwitch(tabId, btn);
        });
      });
      if (this.defaultTab) {
        this.setActive(this.defaultTab);
      }
    }
    setActive(tabOrBtn) {
      const btns = this.container.querySelectorAll(this.btnSelector);
      btns.forEach(b => b.classList.remove(this.activeClass));
      let target = null;
      if (typeof tabOrBtn === 'string') {
        target = this.container.querySelector(`[data-target-panel="${tabOrBtn}"]`) ||
                 this.container.querySelector(`[data-fill-tab="${tabOrBtn}"]`) ||
                 this.container.querySelector(`[data-bs-tab="${tabOrBtn}"]`) ||
                 this.container.querySelector(`[data-tab="${tabOrBtn}"]`) ||
                 this.container.querySelector(`#${tabOrBtn}`);
      } else {
        target = tabOrBtn;
      }
      if (target) target.classList.add(this.activeClass);
    }
    getActive() {
      const active = this.container.querySelector(`${this.btnSelector}.${this.activeClass}`);
      if (!active) return null;
      return active.dataset.targetPanel || active.dataset.fillTab || active.dataset.bsTab || active.dataset.tab || active.id;
    }
    destroy() {
      // remove listeners not tracked individually - simple clear
      const btns = this.container.querySelectorAll(this.btnSelector);
      btns.forEach(btn => {
        const clone = btn.cloneNode(true);
        btn.parentNode.replaceChild(clone, btn);
      });
    }
  }

  let globalGraphPopoverInstance = null;
  function openGlobalGraphPopover(options) {
    if (!globalGraphPopoverInstance) {
      globalGraphPopoverInstance = new FishGraphPopover();
    }
    globalGraphPopoverInstance.open(options);
    return globalGraphPopoverInstance;
  }

  // ════════════════════════════════════════════════════════════════
  // 8.5. FishExpressionPopover - Compact Floating Speech-Bubble Expression Popover
  // ════════════════════════════════════════════════════════════════
  class FishExpressionPopover {
    constructor() {
      this.popoverEl = null;
      this.cardEl = null;
      this.tailEl = null;
      this.currentAnchor = null;
      this.activeApplyCallback = null;
      this.activeClearCallback = null;
      this.activeCloseCallback = null;
      this.initDOM();
    }

    initDOM() {
      if (this.popoverEl) return;
      this.popoverEl = document.createElement('div');
      this.popoverEl.className = 'fish-universal-popover am-expression-popover';
      this.popoverEl.id = 'fishExpressionPopover';
      this.popoverEl.innerHTML = `
        <div class="fish-popover-tail"></div>
        <div class="fish-popover-card am-expression-card-inner">
          <div class="am-expression-header">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="am-expression-badge">(fx)</span>
              <span class="am-expression-title" id="expressionPopoverTitle">Expression</span>
            </div>
            <div class="keyframe-controls-group expression-controls-group" style="margin-right:0;">
              <button type="button" class="keyframe-graph-btn" id="btnExpressionPopoverPresets" title="Preset Expression">
                <span class="material-symbols-rounded">folder_open</span>
              </button>
              <button type="button" class="keyframe-graph-btn" id="btnExpressionPopoverClose" title="Tutup">
                <span class="material-symbols-rounded">close</span>
              </button>
            </div>
          </div>

          <div class="am-expression-body">
            <!-- Code Input Box -->
            <div class="am-expression-code-wrap">
              <textarea id="expressionPopoverCode" rows="3" placeholder="Contoh: value + wiggle(4, 20)" spellcheck="false"></textarea>
            </div>

            <!-- Action Buttons Footer -->
            <div class="am-expression-footer">
              <button type="button" id="btnExpressionPopoverClear" class="am-expression-btn-clear">Hapus (fx)</button>
              <button type="button" id="btnExpressionPopoverApply" class="am-expression-btn-apply">Terapkan (fx)</button>
            </div>
          </div>

          <!-- Presets Drawer Menu -->
          <div class="am-expression-lib-menu" id="expressionPopoverLibMenu" style="display:none;">
            <div class="am-expression-lib-header">
              <span>Expression Library</span>
            </div>
            <div class="am-expression-lib-items" id="expressionPopoverLibItems"></div>
          </div>
        </div>
      `;

      const attach = () => {
        if (document.body && !document.getElementById('fishExpressionPopover')) {
          document.body.appendChild(this.popoverEl);
        }
      };
      if (document.body) attach();
      else document.addEventListener('DOMContentLoaded', attach);

      this.cardEl = this.popoverEl.querySelector('.fish-popover-card');
      this.tailEl = this.popoverEl.querySelector('.fish-popover-tail');

      // Dismiss on click outside
      document.addEventListener('pointerdown', (e) => {
        if (!this.isOpen()) return;
        if (this.popoverEl.contains(e.target)) return;
        if (this.currentAnchor && this.currentAnchor.contains(e.target)) {
          e.stopPropagation();
          e.preventDefault();
          this.close();
          return;
        }
        this.close();
      }, true);

      // Dismiss on Escape
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen()) {
          this.close();
        }
      });

      // Close button
      this.popoverEl.querySelector('#btnExpressionPopoverClose').addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });

      // Presets menu toggle
      const btnPresets = this.popoverEl.querySelector('#btnExpressionPopoverPresets');
      const libMenu = this.popoverEl.querySelector('#expressionPopoverLibMenu');
      if (btnPresets && libMenu) {
        btnPresets.addEventListener('click', (e) => {
          e.stopPropagation();
          const isShow = libMenu.style.display !== 'none';
          libMenu.style.display = isShow ? 'none' : 'flex';
          btnPresets.classList.toggle('active', !isShow);
        });
      }

      // Apply button
      this.popoverEl.querySelector('#btnExpressionPopoverApply').addEventListener('click', (e) => {
        e.stopPropagation();
        const codeInput = this.popoverEl.querySelector('#expressionPopoverCode');
        const code = codeInput ? codeInput.value.trim() : '';
        if (this.activeApplyCallback) {
          this.activeApplyCallback(code);
        }
        this.close();
      });

      // Clear button
      this.popoverEl.querySelector('#btnExpressionPopoverClear').addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.activeClearCallback) {
          this.activeClearCallback();
        }
        this.close();
      });
    }

    position(anchorEl) {
      if (!this.popoverEl) return;
      anchorEl = resolveElement(anchorEl);
      this.currentAnchor = anchorEl || null;

      const popoverWidth = this.popoverEl.offsetWidth || 280;
      const popoverHeight = this.popoverEl.offsetHeight || 220;

      if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
        const rect = anchorEl.getBoundingClientRect();
        let top, left;

        if (rect.top > popoverHeight + 14) {
          top = rect.top - popoverHeight - 10;
          this.popoverEl.classList.add('arrow-bottom');
          this.popoverEl.classList.remove('arrow-top');
        } else {
          top = rect.bottom + 10;
          this.popoverEl.classList.add('arrow-top');
          this.popoverEl.classList.remove('arrow-bottom');
        }

        left = rect.left + (rect.width / 2) - (popoverWidth / 2);
        left = Math.max(8, Math.min(window.innerWidth - popoverWidth - 8, left));

        const arrowLeft = Math.max(16, Math.min(popoverWidth - 16, (rect.left + rect.width / 2) - left));
        this.popoverEl.style.setProperty('--arrow-left', `${arrowLeft}px`);

        this.popoverEl.style.top = `${Math.round(top)}px`;
        this.popoverEl.style.left = `${Math.round(left)}px`;
      } else {
        this.popoverEl.classList.remove('arrow-bottom', 'arrow-top');
        const top = Math.max(60, window.innerHeight - popoverHeight - 120);
        const left = Math.max(8, window.innerWidth - popoverWidth - 24);
        this.popoverEl.style.top = `${Math.round(top)}px`;
        this.popoverEl.style.left = `${Math.round(left)}px`;
      }
    }

    open({ anchorElement, title, currentCode, presets, onApply, onClear, onClose }) {
      if (!this.popoverEl) this.initDOM();
      const resolvedAnchor = resolveElement(anchorElement);
      if (this.isOpen() && this.currentAnchor && (this.currentAnchor === resolvedAnchor || this.currentAnchor.contains(resolvedAnchor))) {
        this.close();
        return;
      }
      this.currentAnchor = resolvedAnchor || null;
      this.activeApplyCallback = onApply || null;
      this.activeClearCallback = onClear || null;
      this.activeCloseCallback = onClose || null;

      const titleEl = this.popoverEl.querySelector('#expressionPopoverTitle');
      if (titleEl) titleEl.textContent = title || 'Expression';

      const codeInput = this.popoverEl.querySelector('#expressionPopoverCode');
      if (codeInput) codeInput.value = currentCode || '';

      const libMenu = this.popoverEl.querySelector('#expressionPopoverLibMenu');
      if (libMenu) libMenu.style.display = 'none';
      const btnPresets = this.popoverEl.querySelector('#btnExpressionPopoverPresets');
      if (btnPresets) btnPresets.classList.remove('active');

      const defaultPresets = presets || [
        { label: '🌊 wiggle(5, 30)', code: 'wiggle(5, 30)' },
        { label: '🏀 bounce()', code: 'bounce(20, 6, 5)' },
        { label: '🔄 time * 180', code: 'time * 180' },
        { label: '🔁 loopOut()', code: 'loopOut("pingpong")' },
        { label: '💫 linear()', code: 'linear(time, 0, 2, 0, 100)' }
      ];

      const libItems = this.popoverEl.querySelector('#expressionPopoverLibItems');
      if (libItems) {
        libItems.innerHTML = '';
        defaultPresets.forEach(p => {
          const row = document.createElement('div');
          row.className = 'am-expression-lib-item';
          row.innerHTML = `<span style="font-weight:700; color:#FFF2C2;">${p.label}</span><code style="font-size:0.7rem; color:#FAB778;">${p.code}</code>`;
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (codeInput) codeInput.value = p.code;
            if (libMenu) libMenu.style.display = 'none';
            if (btnPresets) btnPresets.classList.remove('active');
          });
          libItems.appendChild(row);
        });
      }

      this.popoverEl.classList.add('active');
      this.position(resolvedAnchor);
    }

    close() {
      if (!this.isOpen()) return;
      this.popoverEl.classList.remove('active');
      if (this.activeCloseCallback) {
        this.activeCloseCallback();
      }
      this.activeApplyCallback = null;
      this.activeClearCallback = null;
      this.activeCloseCallback = null;
    }

    isOpen() {
      return this.popoverEl && this.popoverEl.classList.contains('active');
    }
  }

  let globalExpressionPopoverInstance = null;
  function openGlobalExpressionPopover(options = {}) {
    if (!globalExpressionPopoverInstance) {
      globalExpressionPopoverInstance = new FishExpressionPopover();
    }
    globalExpressionPopoverInstance.open(options);
    return globalExpressionPopoverInstance;
  }

  // ════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════
  // Export Global Suite: window.FishUI
  // ════════════════════════════════════════════════════════════════
  const FishUI = {
    RulerSlider: FishRulerSlider,
    RotationDial: FishRotationDial,
    LinearSlider: FishLinearSlider,
    MovePad: FishMovePad,
    KeyframeController: FishKeyframeController,
    GraphEditor: FishGraphEditor,
    GraphPopover: FishGraphPopover,
    ExpressionPopover: FishExpressionPopover,
    TopTabs: FishTopTabs,

    // Factory initializers
    createRuler: (opts) => new FishRulerSlider(opts),
    createRotationDial: (opts) => new FishRotationDial(opts),
    createSlider: (opts) => new FishLinearSlider(opts),
    createMovePad: (opts) => new FishMovePad(opts),
    createKeyframeController: (opts) => new FishKeyframeController(opts),
    createGraphEditor: (opts) => new FishGraphEditor(opts),
    openGraphPopover: (opts) => openGlobalGraphPopover(opts),
    openExpressionPopover: (opts) => openGlobalExpressionPopover(opts),
    createTopTabs: (opts) => new FishTopTabs(opts),
    updateTopTabsStyle: (vars) => {
      if (!vars || typeof vars !== 'object') return;
      Object.entries(vars).forEach(([k, v]) => {
        const key = k.startsWith('--') ? k : `--${k}`;
        document.documentElement.style.setProperty(key, v);
      });
    },

    // Utilities
    solveCubicBezier: solveCubicBezier,
    interpolateKeyframes: interpolateKeyframes,
    getPresetEasing: (name) => DEFAULT_GRAPH_PRESETS.find(p => p.name.toLowerCase() === (name || '').toLowerCase()) || null,

    // Linked access to Popover and ColorPicker engines
    get popover() {
      return global.FishPopover;
    },
    get openColorPicker() {
      return global.openGlobalColorPicker;
    }
  };

  global.FishUI = FishUI;
  global.FishRulerSlider = FishRulerSlider;
  global.FishRotationDial = FishRotationDial;
  global.FishLinearSlider = FishLinearSlider;
  global.FishMovePad = FishMovePad;
  global.FishKeyframeController = FishKeyframeController;
  global.FishGraphEditor = FishGraphEditor;
  global.FishGraphPopover = FishGraphPopover;
  global.FishExpressionPopover = FishExpressionPopover;
  global.FishTopTabs = FishTopTabs;
  global.openGlobalGraphPopover = openGlobalGraphPopover;
  global.openGlobalExpressionPopover = openGlobalExpressionPopover;

})(typeof window !== 'undefined' ? window : this);
