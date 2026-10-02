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
    animation: 'bounce_1',      // legacy alias for animIn
    animSpeed: 1.0,
    animDecay: 7.0,
    animFreq: 3,
    animAmplitude: 0.6,
    animStagger: 0.5,
    animTarget: 'character',    // 'character' | 'word' | 'line'
    animDuration: 0.8,          // legacy alias for animInDuration
    animIn: 'bounce_1',         // 'none' | 'bounce_1' | 'bounce_2' | 'bounce_3' | 'bounce_4' | 'typewriter' | 'wave' | 'fade_up' | 'glitch'
    animInDuration: 0.8,        // in seconds
    animOut: 'none',            // 'none' | 'bounce_out' | 'slide_out' | 'fade_down' | 'shrink_drop'
    animOutDuration: 0.6,       // in seconds
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
    { id: 'typewriter',  label: 'Typewriter (Reverse)', desc: 'Sequential character vanish' }
  ];

  const ANIMATION_TYPES = ANIMATION_IN_TYPES;


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
      const shadowPad = p.longShadow ? (p.longShadowLength + 10) : (p.shadowEnabled ? (p.shadowBlur + Math.abs(p.shadowOffsetX) + 6) : 0);

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
    static renderTextToCanvas(layer, canvas, targetW, targetH, localSec = 0, clipDur = 5) {
      if (!canvas || typeof canvas.getContext !== 'function' || !layer) return canvas;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;

      const p = Object.assign({}, DEFAULT_TEXT_PROPS, layer.textProps || {});

      const baseFontSize = Number(p.fontSize) || 64;
      const resScale = Math.min(4.0, Math.max(1.0, Number(layer && layer._textResScale) || 1.0));
      const fontSize = baseFontSize * resScale;
      const letterSpacing = (p.letterSpacing || 0) * resScale;

      const font = (p.fontStyle || 'normal') + ' ' + (p.fontWeight || 'bold') + ' ' + fontSize + 'px ' + (p.fontFamily || 'Cal Sans');
      const measure = this.measureText(ctx, p.text || 'Text', font, letterSpacing, p.lineHeight);

      const padX = (p.badgeEnabled ? (p.badgePaddingX * 2 + 16) : 24) * resScale;
      const padY = (p.badgeEnabled ? (p.badgePaddingY * 2 + 16) : 16) * resScale;
      const shadowPad = (p.longShadow ? (p.longShadowLength + 10) : (p.shadowEnabled ? (p.shadowBlur + Math.abs(p.shadowOffsetX) + 6) : 0)) * resScale;

      const contentW = Math.max(Math.ceil((targetW || 0) * resScale), Math.ceil(measure.width  + padX + shadowPad * 2));
      const contentH = Math.max(Math.ceil((targetH || 0) * resScale), Math.ceil(measure.height + padY + shadowPad * 2));

      // Extra canvas padding so characters can animate/bounce freely outside the text box without clipping (AE style)
      const animPadX = Math.ceil(Math.max(fontSize * 2, 80 * resScale));
      const animPadY = Math.ceil(Math.max(fontSize * 3, 140 * resScale));

      if (layer) {
        layer._textPadX = animPadX;
        layer._textPadY = animPadY;
        layer._textNaturalW = contentW;
        layer._textNaturalH = contentH;
        layer._textResScaleApplied = resScale;
      }

      const reqW = contentW + animPadX * 2;
      const reqH = contentH + animPadY * 2;

      if (canvas.width !== reqW || canvas.height !== reqH) {
        canvas.width  = reqW;
        canvas.height = reqH;
      }

      ctx.clearRect(0, 0, reqW, reqH);
      ctx.save();

      const cx = reqW / 2;
      const cy = reqH / 2;

      const effectiveAnimIn = p.animIn || (p.animation && p.animation !== 'none' ? p.animation : 'bounce_1');
      const normIn = normalizeAnimIn(effectiveAnimIn);
      const inDur = Math.max(0.1, Number(p.animInDuration || p.animDuration) || 0.8);

      const effectiveAnimOut = p.animOut || 'none';
      const normOut = normalizeAnimOut(effectiveAnimOut);
      const outDur = Math.max(0.1, Number(p.animOutDuration) || 0.6);
      const outStartSec = Math.max(inDur, clipDur - outDur);

      const lines = measure.lines;
      const lineH = measure.lineHeight;
      const totalH = lines.length * lineH;
      const startY = cy - (totalH / 2) + (lineH / 2);

      let globalCharIndex = 0;
      const fullText = lines.join('');
      const totalChars = fullText.length || 1;

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
          const cw = ctx.measureText(line[i]).width + (p.letterSpacing || 0);
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

          let offX = 0;
          let offY = 0;
          let scaleX = 1.0;
          let scaleY = 1.0;
          let charAlpha = 1.0;
          let charRotation = 0;

          const normIn = normalizeAnimIn(effectiveAnimIn);
          const fontSize = p.fontSize || 64;

          // ── Spring parameters (shared by IN and OUT) ────────────────────────
          const animDecay     = Number(p.animDecay)     > 0 ? Number(p.animDecay)     : 7.0;
          const animFreq      = Number(p.animFreq)      > 0 ? Number(p.animFreq)      : 3;
          const animAmplitude = Number(p.animAmplitude) > 0 ? Number(p.animAmplitude) : 0.6;
          const animStagger   = Number(p.animStagger) >= 0  ? Number(p.animStagger)   : 0.5;
          const animTarget    = p.animTarget || 'character';

          // ── animTarget: stagger index per character / word / line ───────────
          let animIndex  = charIndex;
          let totalUnits = totalChars;
          if (animTarget === 'line') {
            animIndex  = lineIdx;
            totalUnits = lines.length;
          } else if (animTarget === 'word') {
            const fullTextUpToChar = lines.slice(0, lineIdx).join(' ') + (lineIdx > 0 ? ' ' : '') + line.slice(0, i);
            animIndex  = (fullTextUpToChar.match(/\s+/g) || []).length;
            totalUnits = (fullText.replace(/\s+/g, ' ').trim().match(/\s+/g) || []).length + 1;
          }

          // ── IN stagger ─────────────────────────────────────────────────────
          const stagger  = totalUnits > 1 ? (inDur * animStagger) / (totalUnits - 1) : 0;
          const myDelay  = stagger * animIndex;
          const t        = localSec - myDelay;

          // ── IN ANIMATION ───────────────────────────────────────────────────
          if (normIn === 'bounce_1' || normIn === 'bounce_3') {
            if (t <= 0) {
              charAlpha = 0;
            } else {
              const freq  = normIn === 'bounce_3' ? Math.max(0.5, animFreq  - 1) : animFreq;
              const decay = normIn === 'bounce_3' ? Math.max(0.5, animDecay - 2) : animDecay;
              const amplitude = fontSize * animAmplitude;
              const s = amplitude * Math.cos(freq * t * 2 * Math.PI) / Math.exp(decay * t);
              offY = s;
              charAlpha = Math.min(1.0, t / Math.max(0.005, stagger > 0 ? stagger * 0.8 : 0.03));
            }
          } else if (normIn === 'bounce_2' || normIn === 'bounce_4') {
            if (t <= 0) {
              scaleX = 0; scaleY = 0; charAlpha = 0;
            } else {
              const freq  = normIn === 'bounce_4' ? Math.max(0.5, animFreq  - 1) : animFreq;
              const decay = normIn === 'bounce_4' ? Math.max(0.5, animDecay - 2) : animDecay;
              const s  = Math.cos(freq * t * 2 * Math.PI) / Math.exp(decay * t);
              const sc = Math.max(0, Math.min(1.5, 1.0 - s));
              scaleX = sc; scaleY = sc;
              charAlpha = Math.min(1.0, t / Math.max(0.005, stagger > 0 ? stagger * 0.8 : 0.03));
            }
          } else if (normIn === 'wave' || p.animation === 'wave') {
            const wfreq = 5.0 * (p.animSpeed || 1.0);
            const phase = charIndex * 0.45;
            offY = Math.sin(localSec * wfreq + phase) * (fontSize * 0.15);
          } else if (normIn === 'glitch') {
            const quant = Math.floor(localSec * 18);
            const hash  = Math.sin(quant * 9999 + charIndex * 1337);
            const hash2 = Math.cos(quant * 4321 + charIndex * 777);
            if (Math.abs(hash) > 0.55) {
              offX = hash * fontSize * 0.15;
              offY = hash2 * fontSize * 0.08;
              charAlpha = 0.55 + Math.abs(hash) * 0.45;
              scaleX = 1.0 + hash * 0.08;
            }
          } else if (normIn === 'fade_up') {
            if (t <= 0) {
              charAlpha = 0; offY = 36;
            } else {
              const prog = Math.min(1.0, t / Math.max(0.005, stagger > 0 ? stagger * 0.8 : inDur));
              const ease = 1 - Math.pow(1 - prog, 2);
              offY = (1 - ease) * 36;
              charAlpha = ease;
            }
          }

          // ── OUT ANIMATION ──────────────────────────────────────────────────
          // AE-quality character exit transitions with damped spring anticipation
          if (normOut !== 'none' && normOut !== 'typewriter' && localSec >= outStartSec) {
            const tOutGlobal = localSec - outStartSec;
            const actualTotalStagger = totalUnits > 1 ? outDur * Math.min(0.55, animStagger) : 0;
            const outStagger = totalUnits > 1 ? actualTotalStagger / (totalUnits - 1) : 0;
            // Left-to-right stagger: first character exits first (matches IN direction)
            const outMyDelay = animIndex * outStagger;
            const tOut       = tOutGlobal - outMyDelay;
            const charDur    = Math.max(0.24, outDur - actualTotalStagger);

            if (tOut >= charDur) {
              charAlpha = 0;
            } else if (tOut > 0) {
              const prog = Math.min(1.0, tOut / charDur);

              if (normOut === 'bounce_out') {
                // Mirror of bounce_1 IN: damped cosine spring, reversed
                // Phase 1 (0→30%): anticipation windup — slight bounce UP using spring
                // Phase 2 (30→100%): accelerating gravity drop DOWN
                const amplitude = fontSize * animAmplitude;
                const antPhase = Math.min(1.0, prog / 0.30);
                // Damped spring anticipation: small upward bounce
                const antT = antPhase * 0.5; // compress spring time
                const springUp = amplitude * 0.35 * Math.cos(animFreq * antT * 2 * Math.PI) / Math.exp(animDecay * 0.6 * antT);
                const antY = -Math.abs(springUp) * Math.pow(Math.sin(Math.PI * antPhase), 2);

                // Gravity drop with exponential acceleration
                const dropProg = Math.max(0, (prog - 0.25) / 0.75);
                const dropY = fontSize * 1.8 * Math.pow(dropProg, 2.2);

                offY = antY + dropY;

                // Alpha: fully visible during anticipation, smooth exponential fade during drop
                if (prog <= 0.25) {
                  charAlpha = 1.0;
                } else {
                  charAlpha = Math.min(charAlpha, Math.max(0, 1.0 - Math.pow(dropProg, 1.4)));
                }

              } else if (normOut === 'shrink_drop') {
                // Mirror of bounce_2/bounce_4 IN: scale collapse with spring anticipation
                // Phase 1 (0→25%): anticipation swell — character briefly inflates
                // Phase 2 (25→100%): spring-driven snap collapse to zero
                const swellAmount = 0.18 * animAmplitude;

                // Swell: damped spring overshoot
                const antPhase = Math.min(1.0, prog / 0.25);
                const antT = antPhase * 0.3;
                const springPop = swellAmount * Math.cos(animFreq * antT * 2 * Math.PI) / Math.exp(animDecay * 0.5 * antT);
                const swell = Math.abs(springPop) * Math.pow(Math.sin(Math.PI * antPhase), 2);

                // Collapse: exponential snap matching IN spring character
                const snapProg = Math.max(0, (prog - 0.15) / 0.85);
                const collapse = 1.0 - Math.cos(Math.min(1.0, snapProg) * Math.PI * 0.5); // smooth cosine collapse
                const sc = Math.max(0, (1.0 + swell) * (1.0 - collapse));

                scaleX = sc;
                scaleY = sc;
                // Drop offset during collapse
                offY = fontSize * 0.3 * Math.pow(snapProg, 2.0);
                charAlpha = Math.min(charAlpha, Math.max(0, Math.min(1.0, sc * 1.5)));

              } else if (normOut === 'fade_down') {
                // Smooth gravity-eased vertical drop with cosine fade
                // Matches fade_up IN quality with proper easing curve
                const easeProg = 1.0 - Math.cos(prog * Math.PI * 0.5); // cosine ease-in
                offY = easeProg * fontSize * 0.6;
                charAlpha = Math.min(charAlpha, Math.max(0, 1.0 - Math.pow(prog, 1.5)));

              } else if (normOut === 'slide_out') {
                // Snappy inertia horizontal slide exit with spring windup
                // Phase 1 (0→20%): slight counter-slide (anticipation)
                // Phase 2 (20→100%): accelerating slide out
                const antPhase = Math.min(1.0, prog / 0.20);
                const counterSlide = -fontSize * 0.12 * Math.pow(Math.sin(Math.PI * antPhase), 2);

                const slideProg = Math.max(0, (prog - 0.15) / 0.85);
                const slideX = fontSize * 2.0 * Math.pow(slideProg, 2.0);

                offX = counterSlide + slideX;
                charAlpha = Math.min(charAlpha, Math.max(0, 1.0 - Math.pow(slideProg, 1.3)));

              } else if (normOut === 'wave') {
                const wfreq = 5.0 * (p.animSpeed || 1.0);
                const phase = charIndex * 0.45;
                offY = Math.sin(tOut * wfreq + phase) * (fontSize * 0.25) + Math.pow(prog, 2) * (fontSize * 0.8);
                charAlpha = Math.min(charAlpha, Math.max(0, 1.0 - Math.pow(prog, 1.4)));

              } else if (normOut === 'glitch') {
                const quant = Math.floor(tOut * 20);
                const hash = Math.sin(quant * 9999 + charIndex * 1337);
                const hash2 = Math.cos(quant * 4321 + charIndex * 777);
                if (Math.abs(hash) > 0.35) {
                  offX = hash * fontSize * 0.2;
                  offY = hash2 * fontSize * 0.12;
                  scaleX = 1.0 + hash * 0.1;
                }
                charAlpha = Math.min(charAlpha, Math.max(0, 1.0 - Math.pow(prog, 1.3)));
              }
            }
          }

          if (charAlpha <= 0.001) {
            curX += chW;
            continue;
          }

          // ── Per-character motion blur (stroboscopic multi-draw) ──────────────
          // When layer.motionBlur is on: compute char position at previous frames
          // from the spring formula, draw N ghost copies with decreasing alpha.
          // No filter:blur() — pure canvas multi-draw.
          const hasMB = !!(layer && layer.motionBlur);
          if (hasMB && (offX !== 0 || offY !== 0 || scaleX !== 1 || scaleY !== 1)) {
            const mbSamples = 4;
            const dt = 1 / Math.max(24, (typeof window !== 'undefined' && typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60);
            const normInMB = normalizeAnimIn(effectiveAnimIn);

            for (let mbI = mbSamples; mbI >= 1; mbI--) {
              const tPrev = t - dt * mbI;
              if (tPrev <= 0) continue;

              let mbOffX = 0, mbOffY = 0, mbSX = 1, mbSY = 1;

              if (normInMB === 'bounce_1' || normInMB === 'bounce_3') {
                const freq2  = normInMB === 'bounce_3' ? Math.max(0.5, animFreq - 1) : animFreq;
                const decay2 = normInMB === 'bounce_3' ? Math.max(0.5, animDecay - 2) : animDecay;
                const amp2   = fontSize * animAmplitude;
                mbOffY = amp2 * Math.cos(freq2 * tPrev * 2 * Math.PI) / Math.exp(decay2 * tPrev);
              } else if (normInMB === 'bounce_2' || normInMB === 'bounce_4') {
                const freq2  = normInMB === 'bounce_4' ? Math.max(0.5, animFreq - 1) : animFreq;
                const decay2 = normInMB === 'bounce_4' ? Math.max(0.5, animDecay - 2) : animDecay;
                const s2  = Math.cos(freq2 * tPrev * 2 * Math.PI) / Math.exp(decay2 * tPrev);
                const sc2 = Math.max(0, Math.min(1.5, 1.0 - s2));
                mbSX = sc2; mbSY = sc2;
              }

              // MB ghost OUT: matches OUT formulas
              const animOutMB = normOut;
              if (animOutMB !== 'none' && animOutMB !== 'typewriter') {
                const outDurMB     = Math.max(0.1, Number(p.animOutDuration) || 0.6);
                const outStartMB   = Math.max(inDur, clipDur - outDurMB);
                if (localSec >= outStartMB) {
                  const tOutGlobMB = (localSec - dt * mbI) - outStartMB;
                  const actualTotalStaggerMB = totalUnits > 1 ? outDurMB * Math.min(0.55, animStagger) : 0;
                  const outStaggerMB = totalUnits > 1 ? actualTotalStaggerMB / (totalUnits - 1) : 0;
                  const tOutMB     = tOutGlobMB - animIndex * outStaggerMB;
                  const charDurMB  = Math.max(0.24, outDurMB - actualTotalStaggerMB);
                  if (tOutMB > 0 && tOutMB < charDurMB) {
                    const pMB = Math.min(1.0, tOutMB / charDurMB);
                    if (animOutMB === 'bounce_out') {
                      const amplitude = fontSize * animAmplitude;
                      const antPhase = Math.min(1.0, pMB / 0.30);
                      const antT = antPhase * 0.5;
                      const springUp = amplitude * 0.35 * Math.cos(animFreq * antT * 2 * Math.PI) / Math.exp(animDecay * 0.6 * antT);
                      const antY = -Math.abs(springUp) * Math.pow(Math.sin(Math.PI * antPhase), 2);
                      const dropProg = Math.max(0, (pMB - 0.25) / 0.75);
                      const dropY = fontSize * 1.8 * Math.pow(dropProg, 2.2);
                      mbOffY += antY + dropY;
                    } else if (animOutMB === 'shrink_drop') {
                      const swellAmount = 0.18 * animAmplitude;
                      const antPhase = Math.min(1.0, pMB / 0.25);
                      const antT = antPhase * 0.3;
                      const springPop = swellAmount * Math.cos(animFreq * antT * 2 * Math.PI) / Math.exp(animDecay * 0.5 * antT);
                      const swell = Math.abs(springPop) * Math.pow(Math.sin(Math.PI * antPhase), 2);
                      const snapProg = Math.max(0, (pMB - 0.15) / 0.85);
                      const collapse = 1.0 - Math.cos(Math.min(1.0, snapProg) * Math.PI * 0.5);
                      const sc2 = Math.max(0, (1.0 + swell) * (1.0 - collapse));
                      mbSX = sc2; mbSY = sc2;
                      mbOffY += fontSize * 0.3 * Math.pow(snapProg, 2.0);
                    } else if (animOutMB === 'slide_out') {
                      const antPhase = Math.min(1.0, pMB / 0.20);
                      const counterSlide = -fontSize * 0.12 * Math.pow(Math.sin(Math.PI * antPhase), 2);
                      const slideProg = Math.max(0, (pMB - 0.15) / 0.85);
                      const slideX = fontSize * 2.0 * Math.pow(slideProg, 2.0);
                      mbOffX += counterSlide + slideX;
                    } else if (animOutMB === 'fade_down') {
                      const easeProg = 1.0 - Math.cos(pMB * Math.PI * 0.5);
                      mbOffY += easeProg * fontSize * 0.6;
                    } else if (animOutMB === 'wave') {
                      const wfreq = 5.0 * (p.animSpeed || 1.0);
                      const phase = charIndex * 0.45;
                      mbOffY += Math.sin((tOutMB) * wfreq + phase) * (fontSize * 0.25) + Math.pow(pMB, 2) * (fontSize * 0.8);
                    }
                  }
                }
              }

              const mbRenderX = curX + (chW / 2) + mbOffX;
              const mbRenderY = curY + mbOffY;
              const mbAlpha = charAlpha * (mbI / (mbSamples + 1)) * 0.35;

              ctx.save();
              ctx.globalAlpha = mbAlpha;
              ctx.translate(mbRenderX, mbRenderY);
              if (charRotation !== 0) ctx.rotate(charRotation * Math.PI / 180);
              if (mbSX !== 1.0 || mbSY !== 1.0) ctx.scale(mbSX, mbSY);
              ctx.font = font;
              ctx.fillStyle = p.textColor || 'var(--text-primary, #e8ffec)';
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
          } else if (p.shadowEnabled) {
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
      return canvas;
    }
  }

  // Export to global window
  window.FishTextEngine = FishTextEngine;
})(typeof window !== 'undefined' ? window : this);
