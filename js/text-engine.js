/**
 * OpenFishTools Studio - FishTextEngine
 * High-performance, modular canvas text rendering and animation engine.
 * Supports typography, outlines, long shadows, drop shadows, neon glow,
 * background badge pills, and deterministic character-level animations.
 */
(function(window) {
  'use strict';

  const DEFAULT_TEXT_PROPS = {
    text: 'FISH TOOL',
    fontFamily: 'Cal Sans, Inter, sans-serif',
    fontSize: 64,
    fontWeight: '700',
    fontStyle: 'normal',
    textAlign: 'center',       // 'left' | 'center' | 'right'
    textBaseline: 'middle',
    letterSpacing: 2,
    lineHeight: 1.2,
    boxWidth: 500,
    boxHeight: 180,
    fillColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 0,
    strokeJoin: 'round',
    shadowEnabled: false,
    shadowColor: 'rgba(0, 0, 0, 0.6)',
    shadowBlur: 8,
    shadowOffsetX: 4,
    shadowOffsetY: 4,
    longShadow: false,
    longShadowColor: 'rgba(0, 0, 0, 0.4)',
    longShadowLength: 24,
    longShadowAngle: 45,        // in degrees
    neonGlow: false,
    neonGlowColor: '#98ce7b',
    neonGlowBlur: 16,
    badgeEnabled: false,
    badgeColor: '#1a2215',
    badgePaddingX: 20,
    badgePaddingY: 10,
    badgeRadius: 12,
    animation: 'bounce_1',      // legacy alias for animIn
    animSpeed: 1.0,
    animDecay: 7.0,
    animFreq: 3,
    animAmplitude: 0.6,
    animStagger: 0.5,
    animTarget: 'character',    // 'character' | 'word' | 'line'
    animDuration: 0.8,          // legacy alias for animInDuration
    animIn: 'bounce_1',         // 'none' | 'bounce_1' | 'bounce_2' | 'bounce_3' | 'bounce_4' | 'typewriter' | 'wave' | 'fade_up' | 'glitch' | 'custom'
    animInDuration: 0.8,        // in seconds
    animOut: 'none',            // 'none' | 'bounce_out' | 'slide_out' | 'fade_down' | 'shrink_drop' | 'custom'
    animOutDuration: 0.6,       // in seconds
    // ── Text Animator ("Animate From", AE Range Selector style) ──
    // Neutral defaults = no effect. Applied per glyph on top of IN/OUT presets.
    animPosX: 0,                // px offset at start of IN / end of OUT
    animPosY: 0,                // px
    animRotation: 0,            // degrees
    animScale: 100,             // percent
    animOpacity: 100,           // percent
    animEase: 'ease_out',       // 'ease_out' | 'ease_in_out' | 'back' | 'elastic' | 'linear'
    presetId: 'default'
  };

  // ─── Text Preset Registry ─────────────────────────────────────────────────
  // Presets live in text/[name].js — each file calls FishTextEngine.registerPreset({...})
  // after text-engine.js loads. No presets are hardcoded here.
  const _textPresetRegistry = [];

  // ─── Animation Type Definitions ──────────────────────────────────────────
  function normalizeAnimIn(anim) {
    if (!anim || anim === 'none') return 'none';
    if (anim === 'bounce_1' || anim === 'bounce_pop' || anim === 'bounce_out') return 'bounce_1';
    if (anim === 'bounce_2' || anim === 'pop_in' || anim === 'bounce_drop' || anim === 'pop_out') return 'bounce_2';
    if (anim === 'bounce_3' || anim === 'overshoot_slide' || anim === 'wave_out') return 'bounce_3';
    if (anim === 'bounce_4' || anim === 'elastic_wobble' || anim === 'shrink_drop') return 'bounce_4';
    if (anim === 'fade_down') return 'fade_up';
    return anim;
  }

  function normalizeAnimOut(anim) {
    if (!anim || anim === 'none') return 'none';
    if (anim === 'bounce_1' || anim === 'bounce_drop' || anim === 'bounce_out') return 'bounce_out';
    if (anim === 'bounce_2' || anim === 'bounce_pop' || anim === 'pop_out' || anim === 'shrink_drop') return 'shrink_drop';
    if (anim === 'bounce_3' || anim === 'wave_drop') return 'bounce_out';
    if (anim === 'bounce_4' || anim === 'wave_pop') return 'shrink_drop';
    if (anim === 'fade_up' || anim === 'fade_down') return 'fade_down';
    if (anim === 'slide_out') return 'slide_out';
    if (anim === 'wave') return 'wave';
    if (anim === 'glitch') return 'glitch';
    if (anim === 'typewriter') return 'typewriter';
    return anim;
  }

  const ANIMATION_IN_TYPES = [
    { id: 'bounce_1', label: 'Bounce 1 (Stagger 20ms)', desc: 'AE Cosine Pop: delay 20ms, freq 3, decay 7, amp 50' },
    { id: 'bounce_2', label: 'Bounce 2 (Inertial 0.10s)', desc: 'AE Linear Spring: dur 0.10s, frame retard, freq 2, decay 9' },
    { id: 'bounce_3', label: 'Bounce 3 (Stagger 60ms)', desc: 'AE Cosine Pop: delay 60ms, freq 2, decay 8, amp 50' },
    { id: 'bounce_4', label: 'Bounce 4 (Inertial 0.25s)', desc: 'AE Linear Spring: dur 0.25s, frame retard, freq 1, decay 8' },
    { id: 'wave',       label: 'Kinetic Wave', desc: 'Fluid sinusoidal wave motion' },
    { id: 'typewriter', label: 'Typewriter',   desc: 'Sequential character typing with cursor' },
    { id: 'fade_up',    label: 'Fade Up',      desc: 'Smooth vertical cascade fade-in' },
    { id: 'glitch',     label: 'Glitch',       desc: 'High-energy digital displacement' },
    { id: 'custom',     label: 'Custom (Animator)', desc: 'Pure Animate From: position, rotation, scale, opacity' },
    { id: 'none',       label: 'None',         desc: 'Static crisp typography' }
  ];

  const ANIMATION_OUT_TYPES = [
    { id: 'none',        label: 'None',                 desc: 'Static until end of clip' },
    { id: 'bounce_out',  label: 'Bounce Drop (Outro)',  desc: 'Windup anticipation & spring drop' },
    { id: 'shrink_drop', label: 'Bounce Pop (Scale)',   desc: 'Anticipation swell & scale snap' },
    { id: 'slide_out',   label: 'Slide Out',            desc: 'Snappy inertia slide exit' },
    { id: 'fade_down',   label: 'Fade Down',            desc: 'Smooth gravity drop & fade away' },
    { id: 'wave',        label: 'Kinetic Wave Out',     desc: 'Fluid sinusoidal wave exit' },
    { id: 'glitch',      label: 'Digital Glitch Out',   desc: 'High-energy digital displacement vanish' },
    { id: 'typewriter',  label: 'Typewriter (Reverse)', desc: 'Sequential character vanish' },
    { id: 'custom',      label: 'Custom (Animator)',    desc: 'Pure Animate To: position, rotation, scale, opacity' }
  ];

  const ANIMATION_TYPES = ANIMATION_IN_TYPES;

  // Range-based types: per-glyph IN/OUT window where the Text Animator applies
  const UNIT_IN_TYPES  = { bounce_1: 1, bounce_2: 1, bounce_3: 1, bounce_4: 1, fade_up: 1, custom: 1 };
  const UNIT_OUT_TYPES = { bounce_out: 1, shrink_drop: 1, slide_out: 1, fade_down: 1, custom: 1 };

  // ─── Easing helpers (AE-style ease curves) ───────────────────────────────
  const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
  const smoothstep = (a, b, v) => {
    const x = clamp01((v - a) / (b - a));
    return x * x * (3 - 2 * x);
  };
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
  const easeOutQuint = (x) => 1 - Math.pow(1 - x, 5);

  const TEXT_EASES = {
    linear:      (x) => x,
    ease_out:    (x) => easeOutQuint(x),                                  // AE expo-style ease out
    ease_in_out: (x) => x * x * x * (x * (x * 6 - 15) + 10),              // smootherstep (Easy Ease)
    back:        (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    elastic:     (x) => (x <= 0 ? 0 : (x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1))
  };

  /**
   * Extra padding (unscaled px) so stroke / shadow / glow / long shadow never clip at buffer edge.
   */
  function computeEffectPad(p) {
    const longPad   = p.longShadow ? (Number(p.longShadowLength) || 0) + 10 : 0;
    const shadowPad = p.shadowEnabled
      ? (Number(p.shadowBlur) || 0) + Math.max(Math.abs(Number(p.shadowOffsetX) || 0), Math.abs(Number(p.shadowOffsetY) || 0)) + 6
      : 0;
    const glowPad   = p.neonGlow ? (Number(p.neonGlowBlur) || 0) * 1.5 + 4 : 0;
    const strokePad = (Number(p.strokeWidth) || 0) > 0 ? (Number(p.strokeWidth) / 2 + 2) : 0;
    return Math.max(longPad, shadowPad, glowPad) + strokePad;
  }

  /**
   * Build timing config shared by every glyph in one render pass.
   * AE Range Selector model: total IN duration = spread (offset sweep) + per-unit duration.
   * Large per-unit duration vs small step => many glyphs animate simultaneously (smooth overlap).
   */
  function buildAnimConfig(p, normIn, normOut, inDur, outDur, outStartSec, totalUnits, fontSize, resScale = 1) {
    const animStagger = Number(p.animStagger) >= 0 ? Number(p.animStagger) : 0.5;
    const spreadRatio = Math.min(0.85, Math.max(0, animStagger));
    const inSpread = totalUnits > 1 ? inDur * spreadRatio : 0;
    const inUnitDur = Math.max(inDur * 0.15, inDur - inSpread);
    const inStep = totalUnits > 1 ? inSpread / (totalUnits - 1) : 0;

    const outSpread = totalUnits > 1 ? outDur * Math.min(0.55, spreadRatio) : 0;
    const outUnitDur = Math.max(0.24, outDur - outSpread);
    const outStep = totalUnits > 1 ? outSpread / (totalUnits - 1) : 0;

    const aPosX = Number(p.animPosX) || 0;
    const aPosY = Number(p.animPosY) || 0;
    const aRot  = Number(p.animRotation) || 0;
    const aScl  = p.animScale !== undefined && p.animScale !== '' ? Number(p.animScale) : 100;
    const aOp   = p.animOpacity !== undefined && p.animOpacity !== '' ? Number(p.animOpacity) : 100;
    const hasAnimator = aPosX !== 0 || aPosY !== 0 || aRot !== 0 || aScl !== 100 || aOp !== 100;

    return {
      normIn, normOut, inDur, outDur, outStartSec, fontSize,
      inStep, inUnitDur,
      inFadeDur: Math.max(0.05, inUnitDur * 0.35),
      outStep, outUnitDur,
      decay: Number(p.animDecay) > 0 ? Number(p.animDecay) : 7.0,
      freq: Number(p.animFreq) > 0 ? Number(p.animFreq) : 3,
      amp: Number(p.animAmplitude) > 0 ? Number(p.animAmplitude) : 0.6,
      speed: Number(p.animSpeed) || 1.0,
      hasAnimator,
      aPosX: aPosX * resScale,
      aPosY: aPosY * resScale,
      aRot,
      aScl: (isFinite(aScl) ? aScl : 100) / 100,
      aOp: clamp01((isFinite(aOp) ? aOp : 100) / 100),
      ease: TEXT_EASES[p.animEase] || TEXT_EASES.ease_out
    };
  }

  /**
   * Evaluate one glyph's transform at absolute clip time `sec`.
   * Single source for main draw + motion blur ghosts (guaranteed identical motion).
   */
  function evalGlyphAnim(cfg, sec, animIndex, charIndex) {
    const st = { offX: 0, offY: 0, scaleX: 1, scaleY: 1, alpha: 1, rot: 0 };
    const { normIn, normOut, fontSize } = cfg;
    let animatorAmt = 0; // 1 = full "Animate From" state, 0 = rest

    // ── IN ──────────────────────────────────────────────────────────────
    if (normIn === 'wave') {
      const wfreq = 5.0 * cfg.speed;
      st.offY = Math.sin(sec * wfreq + charIndex * 0.45) * (fontSize * 0.15);
    } else if (normIn === 'glitch') {
      const quant = Math.floor(sec * 18);
      const hash  = Math.sin(quant * 9999 + charIndex * 1337);
      const hash2 = Math.cos(quant * 4321 + charIndex * 777);
      if (Math.abs(hash) > 0.55) {
        st.offX = hash * fontSize * 0.15;
        st.offY = hash2 * fontSize * 0.08;
        st.alpha = 0.55 + Math.abs(hash) * 0.45;
        st.scaleX = 1.0 + hash * 0.08;
      }
    } else if (UNIT_IN_TYPES[normIn]) {
      const t = sec - cfg.inStep * animIndex;
      const d = cfg.inUnitDur;
      if (cfg.hasAnimator) animatorAmt = 1 - cfg.ease(clamp01(t / d));
      if (normIn === 'custom') {
        // Pure animator: glyph holds "Animate From" state until its range starts
      } else if (t <= 0) {
        st.alpha = 0;
        return st;
      } else if (t < d) {
        const u = t / d;
        // Taper: spring residue eases to exactly 0 (value + velocity) at unit end -> no snap
        const tail = 1 - smoothstep(0.5, 1, u);
        st.alpha = smoothstep(0, 1, t / cfg.inFadeDur);

        if (normIn === 'bounce_1' || normIn === 'bounce_3') {
          const freq  = normIn === 'bounce_3' ? Math.max(0.5, cfg.freq - 1)  : cfg.freq;
          const decay = normIn === 'bounce_3' ? Math.max(0.5, cfg.decay - 2) : cfg.decay;
          const spring = Math.cos(freq * t * 2 * Math.PI) / Math.exp(decay * t);
          st.offY = fontSize * cfg.amp * spring * tail;
        } else if (normIn === 'bounce_2' || normIn === 'bounce_4') {
          const freq  = normIn === 'bounce_4' ? Math.max(0.5, cfg.freq - 1)  : cfg.freq;
          const decay = normIn === 'bounce_4' ? Math.max(0.5, cfg.decay - 2) : cfg.decay;
          const spring = Math.cos(freq * t * 2 * Math.PI) / Math.exp(decay * t);
          const sc = Math.max(0, Math.min(1.5, 1.0 - spring * tail));
          st.scaleX = sc; st.scaleY = sc;
        } else {
          // fade_up: expo-like ease-out rise, fade finishes before motion settles
          st.offY = (1 - easeOutQuint(u)) * fontSize * 0.5;
          st.alpha = easeOutCubic(clamp01(u / 0.6));
        }
      }
    }

    // ── OUT (additive on top of IN, so no jump at outStart) ─────────────
    if (normOut !== 'none' && normOut !== 'typewriter' && sec >= cfg.outStartSec) {
      const tOut = (sec - cfg.outStartSec) - animIndex * cfg.outStep;
      const d = cfg.outUnitDur;
      if (cfg.hasAnimator && UNIT_OUT_TYPES[normOut] && tOut > 0) {
        // Mirror ease for exit: slow start -> fast end
        animatorAmt += 1 - cfg.ease(1 - clamp01(tOut / d));
      }
      if (normOut === 'custom') {
        // Pure animator exit: hold final "Animate To" state
      } else if (tOut >= d) {
        st.alpha = 0;
      } else if (tOut > 0) {
        const prog = Math.min(1.0, tOut / d);

        if (normOut === 'bounce_out') {
          // Phase 1: spring anticipation windup UP, Phase 2: accelerating gravity drop
          const amplitude = fontSize * cfg.amp;
          const antPhase = Math.min(1.0, prog / 0.30);
          const antT = antPhase * 0.5;
          const springUp = amplitude * 0.35 * Math.cos(cfg.freq * antT * 2 * Math.PI) / Math.exp(cfg.decay * 0.6 * antT);
          const antY = -Math.abs(springUp) * Math.pow(Math.sin(Math.PI * antPhase), 2);
          const dropProg = Math.max(0, (prog - 0.25) / 0.75);
          st.offY += antY + fontSize * 1.8 * Math.pow(dropProg, 2.2);
          if (prog > 0.25) st.alpha = Math.min(st.alpha, Math.max(0, 1.0 - Math.pow(dropProg, 1.4)));

        } else if (normOut === 'shrink_drop') {
          // Anticipation swell then smooth cosine collapse
          const swellAmount = 0.18 * cfg.amp;
          const antPhase = Math.min(1.0, prog / 0.25);
          const antT = antPhase * 0.3;
          const springPop = swellAmount * Math.cos(cfg.freq * antT * 2 * Math.PI) / Math.exp(cfg.decay * 0.5 * antT);
          const swell = Math.abs(springPop) * Math.pow(Math.sin(Math.PI * antPhase), 2);
          const snapProg = Math.max(0, (prog - 0.15) / 0.85);
          const collapse = 1.0 - Math.cos(Math.min(1.0, snapProg) * Math.PI * 0.5);
          const sc = Math.max(0, (1.0 + swell) * (1.0 - collapse));
          st.scaleX *= sc; st.scaleY *= sc;
          st.offY += fontSize * 0.3 * Math.pow(snapProg, 2.0);
          st.alpha = Math.min(st.alpha, Math.max(0, Math.min(1.0, sc * 1.5)));

        } else if (normOut === 'fade_down') {
          const easeProg = 1.0 - Math.cos(prog * Math.PI * 0.5);
          st.offY += easeProg * fontSize * 0.6;
          st.alpha = Math.min(st.alpha, Math.max(0, 1.0 - Math.pow(prog, 1.5)));

        } else if (normOut === 'slide_out') {
          const antPhase = Math.min(1.0, prog / 0.20);
          const counterSlide = -fontSize * 0.12 * Math.pow(Math.sin(Math.PI * antPhase), 2);
          const slideProg = Math.max(0, (prog - 0.15) / 0.85);
          st.offX += counterSlide + fontSize * 2.0 * Math.pow(slideProg, 2.0);
          st.alpha = Math.min(st.alpha, Math.max(0, 1.0 - Math.pow(slideProg, 1.3)));

        } else if (normOut === 'wave') {
          // Wave amplitude ramps in from 0 so exit starts seamlessly
          const wfreq = 5.0 * cfg.speed;
          const ramp = smoothstep(0, 0.3, prog);
          st.offY += Math.sin(tOut * wfreq + charIndex * 0.45) * (fontSize * 0.25) * ramp + Math.pow(prog, 2) * (fontSize * 0.8);
          st.alpha = Math.min(st.alpha, Math.max(0, 1.0 - Math.pow(prog, 1.4)));

        } else if (normOut === 'glitch') {
          const quant = Math.floor(tOut * 20);
          const hash = Math.sin(quant * 9999 + charIndex * 1337);
          const hash2 = Math.cos(quant * 4321 + charIndex * 777);
          if (Math.abs(hash) > 0.35) {
            st.offX += hash * fontSize * 0.2;
            st.offY += hash2 * fontSize * 0.12;
            st.scaleX *= 1.0 + hash * 0.1;
          }
          st.alpha = Math.min(st.alpha, Math.max(0, 1.0 - Math.pow(prog, 1.3)));
        }
      }
    }

    // ── Text Animator (Animate From / To) ──────────────────────────────
    if (animatorAmt !== 0) {
      const a = animatorAmt;
      st.offX += cfg.aPosX * a;
      st.offY += cfg.aPosY * a;
      st.rot  += cfg.aRot * a;
      const sc = Math.max(0, 1 + (cfg.aScl - 1) * a);
      st.scaleX *= sc; st.scaleY *= sc;
      st.alpha *= clamp01(1 - (1 - cfg.aOp) * clamp01(a));
    }

    return st;
  }


  class FishTextEngine {
    // Registry access — consumed by editor.js renderTextPresetsGrid / addTextLayer
    static get PRESETS() { return _textPresetRegistry; }
    static get ANIMATIONS() { return ANIMATION_IN_TYPES; }
    static get ANIMATION_IN_TYPES() { return ANIMATION_IN_TYPES; }
    static get ANIMATION_OUT_TYPES() { return ANIMATION_OUT_TYPES; }
    static get DEFAULT_PROPS() { return DEFAULT_TEXT_PROPS; }

    /**
     * Register a text preset from an external text/[name].js plugin file.
     * @param {{ id:string, name:string, desc:string, props:object }} preset
     */
    static registerPreset(preset) {
      if (!preset || !preset.id) return;
      // Prevent duplicate registration
      const existing = _textPresetRegistry.findIndex(p => p.id === preset.id);
      if (existing >= 0) {
        _textPresetRegistry[existing] = preset;
      } else {
        _textPresetRegistry.push(preset);
      }
    }

    static getDefaultProps() {
      return Object.assign({}, DEFAULT_TEXT_PROPS);
    }

    static getPresets() {
      return _textPresetRegistry;
    }

    static getPreset(presetId) {
      return _textPresetRegistry.find(p => p.id === presetId) || _textPresetRegistry[0] || null;
    }

    /**
     * Measure text dimensions accurately across multiple lines.
     */
    static measureText(ctx, text, font, letterSpacing = 0, lineHeightMultiplier = 1.2) {
      ctx.save();
      ctx.font = font;
      const lines = String(text || '').split('\n');
      let maxWidth = 0;
      const fontSize = parseFloat(font) || 64;
      const lineH = fontSize * lineHeightMultiplier;

      lines.forEach(line => {
        let w = 0;
        if (letterSpacing > 0) {
          for (let i = 0; i < line.length; i++) {
            w += ctx.measureText(line[i]).width + letterSpacing;
          }
        } else {
          w = ctx.measureText(line).width;
        }
        if (w > maxWidth) maxWidth = w;
      });

      ctx.restore();
      return {
        width: Math.ceil(maxWidth),
        height: Math.ceil(lines.length * lineH),
        lineHeight: lineH,
        lines
      };
    }

    /**
     * Calculate dynamic tight bounding dimensions for text layer (no fixed box locking).
     */
    static getNaturalSize(layer) {
      if (!layer) return { width: 320, height: 100 };
      const p = Object.assign({}, DEFAULT_TEXT_PROPS, layer.textProps || {});
      const font = (p.fontStyle || 'normal') + ' ' + (p.fontWeight || 'bold') + ' ' + (p.fontSize || 64) + 'px ' + (p.fontFamily || 'Cal Sans');
      
      if (!this._measureCanvas) {
        this._measureCanvas = document.createElement('canvas');
        this._measureCtx = this._measureCanvas.getContext('2d');
      }
      const ctx = this._measureCtx;
      const measure = this.measureText(ctx, p.text || 'Text', font, p.letterSpacing || 0, p.lineHeight || 1.15);

      const padX = p.badgeEnabled ? (p.badgePaddingX * 2 + 16) : 24;
      const padY = p.badgeEnabled ? (p.badgePaddingY * 2 + 16) : 16;
      const shadowPad = computeEffectPad(p);

      const w = Math.max(40, Math.ceil(measure.width + padX + shadowPad * 2));
      const h = Math.max(30, Math.ceil(measure.height + padY + shadowPad * 2));

      return {
        width: w,
        height: h,
        textWidth: measure.width,
        textHeight: measure.height,
        lines: measure.lines,
        lineHeight: measure.lineHeight
      };
    }

    /**
     * Authentic After Effects inertia decay bounce & spring expressions.
     * Evaluates live scale, squash & stretch, translation offset, and alpha at localSec.
     */
    static getAnimTransform(layer, localSec = 0, clipDur = 5) {
      // Staggered character-level animations are evaluated per-glyph inside renderTextToCanvas,
      // preserving layer layout and typography without whole-box distortion.
      return { scaleX: 1.0, scaleY: 1.0, offX: 0, offY: 0, alpha: 1.0 };
    }

    /**
     * Render Text to an offscreen buffer canvas with dynamic resolution.
     */
    static renderTextToCanvas(layer, canvas, targetW, targetH, localSec = 0, clipDur = 5, isSubSample = false) {
      if (!canvas || typeof canvas.getContext !== 'function' || !layer) return canvas;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;

      const p = Object.assign({}, DEFAULT_TEXT_PROPS, layer.textProps || {});

      const MAX_BUFFER_DIM = 2048;
      const baseFontSize = Number(p.fontSize) || 64;
      let resScale = Math.min(2.5, Math.max(1.0, Number(layer && layer._textResScale) || 1.0));

      // Guard: clamp effective font size to 240px to prevent buffer texture explosion
      if (baseFontSize * resScale > 240) {
        resScale = Math.max(1.0, 240 / baseFontSize);
      }

      const effectiveAnimIn = p.animIn || (p.animation && p.animation !== 'none' ? p.animation : 'bounce_1');
      const normIn = normalizeAnimIn(effectiveAnimIn);
      const inDur = Math.max(0.1, Number(p.animInDuration || p.animDuration) || 0.8);

      const effectiveAnimOut = p.animOut || 'none';
      const normOut = normalizeAnimOut(effectiveAnimOut);
      const outDur = Math.max(0.1, Number(p.animOutDuration) || 0.6);
      const outStartSec = Math.max(inDur, clipDur - outDur);

      // Fast-path: if text is static or resting in steady state and properties did not change, bypass re-rendering
      const isContinuous = (normIn === 'wave' || normIn === 'glitch' || normOut === 'wave' || normOut === 'glitch');
      const timeKey = isSubSample
        ? ('sub_' + Math.round(localSec * 24000))
        : (isContinuous
            ? Math.round(localSec * 60)
            : (normIn === 'none' && normOut === 'none'
                ? 'static'
                : ((localSec >= inDur && (normOut === 'none' || localSec < outStartSec))
                    ? 'steady'
                    : Math.round(localSec * 60))));

      const pKey = JSON.stringify(p);
      const renderKey = `${pKey}_${resScale}_${targetW}_${targetH}_${timeKey}_mb${layer && layer.motionBlur ? 1 : 0}`;

      if (!layer._textDirty && canvas._lastRenderKey === renderKey && canvas.width > 0 && canvas.height > 0) {
        return canvas;
      }

      let fontSize = baseFontSize * resScale;
      let letterSpacing = (p.letterSpacing || 0) * resScale;

      let font = (p.fontStyle || 'normal') + ' ' + (p.fontWeight || 'bold') + ' ' + fontSize + 'px ' + (p.fontFamily || 'Cal Sans');
      let measure = this.measureText(ctx, p.text || 'Text', font, letterSpacing, p.lineHeight);

      let padX = (p.badgeEnabled ? (p.badgePaddingX * 2 + 16) : 24) * resScale;
      let padY = (p.badgeEnabled ? (p.badgePaddingY * 2 + 16) : 16) * resScale;
      let shadowPad = computeEffectPad(p) * resScale;

      let contentW = Math.max(Math.ceil((targetW || 0) * resScale), Math.ceil(measure.width  + padX + shadowPad * 2));
      let contentH = Math.max(Math.ceil((targetH || 0) * resScale), Math.ceil(measure.height + padY + shadowPad * 2));

      // Extra canvas padding so characters can animate/bounce freely outside the text box without clipping (AE style)
      // Clamped to safe range to avoid GPU texture overflow
      let animPadX = Math.min(120, Math.ceil(Math.max(fontSize * 0.75, 40 * resScale)));
      let animPadY = Math.min(160, Math.ceil(Math.max(fontSize * 1.0, 60 * resScale)));

      let reqW = contentW + animPadX * 2;
      let reqH = contentH + animPadY * 2;

      // Safe hardware texture clamp: automatically downscale resScale if buffer dimensions exceed MAX_BUFFER_DIM
      if (reqW > MAX_BUFFER_DIM || reqH > MAX_BUFFER_DIM) {
        const factor = Math.min(MAX_BUFFER_DIM / reqW, MAX_BUFFER_DIM / reqH);
        resScale = Math.max(0.5, resScale * factor);
        fontSize = baseFontSize * resScale;
        letterSpacing = (p.letterSpacing || 0) * resScale;
        font = (p.fontStyle || 'normal') + ' ' + (p.fontWeight || 'bold') + ' ' + fontSize + 'px ' + (p.fontFamily || 'Cal Sans');
        measure = this.measureText(ctx, p.text || 'Text', font, letterSpacing, p.lineHeight);
        padX *= factor;
        padY *= factor;
        shadowPad *= factor;
        contentW = Math.max(Math.ceil((targetW || 0) * resScale), Math.ceil(measure.width + padX + shadowPad * 2));
        contentH = Math.max(Math.ceil((targetH || 0) * resScale), Math.ceil(measure.height + padY + shadowPad * 2));
        animPadX = Math.min(120, Math.ceil(Math.max(fontSize * 0.75, 40 * resScale)));
        animPadY = Math.min(160, Math.ceil(Math.max(fontSize * 1.0, 60 * resScale)));
        reqW = Math.min(MAX_BUFFER_DIM, contentW + animPadX * 2);
        reqH = Math.min(MAX_BUFFER_DIM, contentH + animPadY * 2);
      }

      if (layer) {
        layer._textPadX = animPadX;
        layer._textPadY = animPadY;
        layer._textNaturalW = contentW;
        layer._textNaturalH = contentH;
        layer._textResScaleApplied = resScale;
      }

      reqW = Math.max(1, Math.min(MAX_BUFFER_DIM, reqW));
      reqH = Math.max(1, Math.min(MAX_BUFFER_DIM, reqH));

      if (canvas.width !== reqW || canvas.height !== reqH) {
        canvas.width  = reqW;
        canvas.height = reqH;
      }

      ctx.clearRect(0, 0, reqW, reqH);
      ctx.save();

      const cx = reqW / 2;
      const cy = reqH / 2;

      const lines = measure.lines;
      const lineH = measure.lineHeight;
      const totalH = lines.length * lineH;
      const startY = cy - (totalH / 2) + (lineH / 2);

      let globalCharIndex = 0;
      const fullText = lines.join('');
      const totalChars = fullText.length || 1;

      // ── animTarget: precompute stagger unit index per glyph (character / word / line) ──
      const animTarget = p.animTarget || 'character';
      const unitIndexByChar = [];
      let totalUnits = totalChars;
      if (animTarget === 'line') {
        lines.forEach((line, li) => { for (let i = 0; i < line.length; i++) unitIndexByChar.push(li); });
        totalUnits = lines.length;
      } else if (animTarget === 'word') {
        let wCount = 0;
        let prevWs = false;
        lines.forEach((line, li) => {
          if (li > 0 && !prevWs) { wCount++; prevWs = true; } // line break acts as separator
          for (let i = 0; i < line.length; i++) {
            const ws = /\s/.test(line[i]);
            if (ws && !prevWs) wCount++;
            prevWs = ws;
            unitIndexByChar.push(wCount);
          }
        });
        totalUnits = (unitIndexByChar.length ? unitIndexByChar[unitIndexByChar.length - 1] : 0) + 1;
      } else {
        for (let i = 0; i < fullText.length; i++) unitIndexByChar.push(i);
      }

      const animCfg = buildAnimConfig(p, normIn, normOut, inDur, outDur, outStartSec, totalUnits, fontSize, resScale);

      // Motion blur flag (respects global master switch in More Settings > Motion Blur)
      const gmb = (typeof window !== 'undefined' && window.currentProjectState && window.currentProjectState.motionBlur) || null;
      const hasMB = !!(layer && layer.motionBlur) && !(gmb && gmb.enabled === false);
      const mbDt = hasMB
        ? 1 / Math.max(24, (typeof window !== 'undefined' && typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60)
        : 0;

      // Typewriter IN progress
      let isTypewriter = (normIn === 'typewriter' || p.animation === 'typewriter');
      let visibleChars = totalChars;
      if (isTypewriter) {
        const prog = Math.min(1.0, Math.max(0, localSec / inDur));
        visibleChars = Math.floor(prog * totalChars);
      }

      // Typewriter OUT: chars vanish right-to-left using global progress (no per-char stagger)
      let isTypewriterOut = (normOut === 'typewriter');
      let visibleCharsOut = totalChars;
      if (isTypewriterOut && localSec >= outStartSec) {
        const outProg = Math.min(1.0, (localSec - outStartSec) / outDur);
        visibleCharsOut = Math.floor((1 - outProg) * totalChars);
      }

      // 1. Draw Badge Background Pill / Box if enabled
      if (p.badgeEnabled) {
        ctx.save();
        const boxW = measure.width + p.badgePaddingX * 2 * resScale;
        const boxH = measure.height + p.badgePaddingY * 2 * resScale;
        const bx = cx - boxW / 2;
        const by = cy - boxH / 2;
        const rad = Math.min((p.badgeRadius !== undefined ? p.badgeRadius : 12) * resScale, boxH / 2);

        let badgeAlpha = 1.0;
        if (normIn !== 'none' && localSec < inDur) {
          badgeAlpha = Math.min(1.0, Math.max(0, localSec / Math.max(0.05, inDur * 0.4)));
        } else if (normOut !== 'none' && localSec >= outStartSec) {
          const outProg = Math.min(1.0, Math.max(0, (localSec - outStartSec) / outDur));
          badgeAlpha = Math.max(0, 1.0 - Math.pow(outProg, 1.6));
        }
        ctx.globalAlpha = badgeAlpha;

        ctx.fillStyle = p.badgeColor || '#1a2215';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(bx, by, boxW, boxH, rad);
        } else {
          ctx.rect(bx, by, boxW, boxH);
        }
        ctx.fill();
        ctx.restore();
      }

      // 2. Prepare text lines and layout
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = p.strokeJoin || 'round';

      lines.forEach((line, lineIdx) => {
        const curY = startY + lineIdx * lineH;

        // Calculate line width for alignment
        let lineWidth = 0;
        const charWidths = [];
        for (let i = 0; i < line.length; i++) {
          const cw = ctx.measureText(line[i]).width + letterSpacing;
          charWidths.push(cw);
          lineWidth += cw;
        }

        let curX = cx - (lineWidth / 2);
        if (p.textAlign === 'left') curX = cx - (measure.width / 2);
        else if (p.textAlign === 'right') curX = cx + (measure.width / 2) - lineWidth;

        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          const chW = charWidths[i];
          const charIndex = globalCharIndex++;

          // Skip invisible characters in typewriter IN
          if (isTypewriter && charIndex > visibleChars) {
            continue;
          }
          // Typewriter OUT: hide chars from end
          if (isTypewriterOut && charIndex >= visibleCharsOut) {
            curX += chW;
            continue;
          }

          // ── Unified glyph animation (IN + OUT) — AE-style overlapping range ──
          const animIndex = unitIndexByChar[charIndex] !== undefined ? unitIndexByChar[charIndex] : charIndex;
          const anim = evalGlyphAnim(animCfg, localSec, animIndex, charIndex);
          const offX = anim.offX;
          const offY = anim.offY;
          const scaleX = anim.scaleX;
          const scaleY = anim.scaleY;
          const charAlpha = anim.alpha;
          const charRotation = anim.rot;

          if (charAlpha <= 0.001) {
            curX += chW;
            continue;
          }

          // ── Per-character motion blur (fallback when FishMotionBlurEngine is not present) ──
          // When FishMotionBlurEngine is available, it handles full multi-sampled accumulation.
          if (!isSubSample && !(typeof window !== 'undefined' && window.FishMotionBlurEngine) && hasMB && (offX !== 0 || offY !== 0 || scaleX !== 1 || scaleY !== 1 || charRotation !== 0)) {
            const mbSamples = 4;
            for (let mbI = mbSamples; mbI >= 1; mbI--) {
              const g = evalGlyphAnim(animCfg, Math.max(0, localSec - mbDt * 0.5 * (mbI / mbSamples)), animIndex, charIndex);
              if (g.alpha <= 0.001) continue;
              const mbAlpha = Math.min(charAlpha, g.alpha) * (1 - mbI / (mbSamples + 1)) * 0.35;

              ctx.save();
              ctx.globalAlpha = mbAlpha;
              ctx.translate(curX + (chW / 2) + g.offX, curY + g.offY);
              if (g.rot !== 0) ctx.rotate(g.rot * Math.PI / 180);
              if (g.scaleX !== 1.0 || g.scaleY !== 1.0) ctx.scale(g.scaleX, g.scaleY);
              ctx.font = font;
              ctx.fillStyle = p.fillColor || '#ffffff';
              ctx.fillText(ch, -(chW / 2), 0);
              ctx.restore();
            }
          }

          ctx.save();
          ctx.globalAlpha = charAlpha;

          const renderX = curX + (chW / 2) + offX;
          const renderY = curY + offY;

          ctx.translate(renderX, renderY);
          if (charRotation !== 0) ctx.rotate(charRotation * Math.PI / 180);
          if (scaleX !== 1.0 || scaleY !== 1.0) {
            ctx.scale(scaleX, scaleY);
          }

          // A. Draw Long Shadow (Extruded multi-step flat shadow)
          if (p.longShadow && p.longShadowLength > 0) {
            ctx.save();
            ctx.fillStyle = p.longShadowColor || 'rgba(0, 0, 0, 0.4)';
            const rad = ((p.longShadowAngle !== undefined ? p.longShadowAngle : 45) * Math.PI) / 180;
            const cosA = Math.cos(rad);
            const sinA = Math.sin(rad);
            const steps = Math.min(80, Math.round(p.longShadowLength * resScale));
            for (let s = 1; s <= steps; s++) {
              const sx = s * cosA;
              const sy = s * sinA;
              ctx.fillText(ch, -(chW / 2) + sx, sy);
            }
            ctx.restore();
          }

          // B. Draw Drop Shadow / Neon Glow
          if (p.neonGlow) {
            ctx.save();
            ctx.shadowColor = p.neonGlowColor || '#98ce7b';
            ctx.shadowBlur = (p.neonGlowBlur || 16) * resScale;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.fillStyle = p.fillColor || '#ffffff';
            ctx.fillText(ch, -(chW / 2), 0);
            ctx.fillText(ch, -(chW / 2), 0); // Double pass for intense neon
            ctx.restore();
          }
          if (p.shadowEnabled) {
            ctx.save();
            ctx.shadowColor = p.shadowColor || 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = (p.shadowBlur || 8) * resScale;
            ctx.shadowOffsetX = (p.shadowOffsetX || 4) * resScale;
            ctx.shadowOffsetY = (p.shadowOffsetY || 4) * resScale;
            ctx.fillStyle = p.fillColor || '#ffffff';
            ctx.fillText(ch, -(chW / 2), 0);
            ctx.restore();
          }

          // C. Draw Stroke / Outline
          if (p.strokeWidth > 0) {
            ctx.save();
            ctx.strokeStyle = p.strokeColor || '#000000';
            ctx.lineWidth = p.strokeWidth * resScale;
            ctx.strokeText(ch, -(chW / 2), 0);
            ctx.restore();
          }

          // D. Draw Fill Text
          ctx.fillStyle = p.fillColor || '#ffffff';
          ctx.fillText(ch, -(chW / 2), 0);

          ctx.restore();

          curX += chW;
        }

        // Draw Typewriter cursor if still typing
        if ((normIn === 'typewriter' || p.animation === 'typewriter') && localSec < inDur) {
          const blink = Math.floor(localSec * 4) % 2 === 0;
          if (blink && lineIdx === lines.length - 1) {
            ctx.save();
            ctx.fillStyle = p.fillColor || '#98ce7b';
            ctx.fillRect(curX + 4 * resScale, curY - fontSize * 0.4, 4 * resScale, fontSize * 0.8);
            ctx.restore();
          }
        }
      });

      ctx.restore();
      canvas._lastRenderKey = renderKey;
      canvas._contentVersion = (canvas._contentVersion || 0) + 1;
      if (layer && !isSubSample) layer._textDirty = false;
      return canvas;
    }
  }

  FishTextEngine.normalizeAnimIn = normalizeAnimIn;
  FishTextEngine.normalizeAnimOut = normalizeAnimOut;

  // Export to global window
  window.FishTextEngine = FishTextEngine;
})(typeof window !== 'undefined' ? window : this);
