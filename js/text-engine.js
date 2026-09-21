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
    if (anim === 'bounce_1' || anim === 'bounce_pop') return 'bounce_1';
    if (anim === 'bounce_2' || anim === 'pop_in' || anim === 'bounce_drop') return 'bounce_2';
    if (anim === 'bounce_3' || anim === 'overshoot_slide') return 'bounce_3';
    if (anim === 'bounce_4' || anim === 'elastic_wobble') return 'bounce_4';
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
    { id: 'none',        label: 'None',        desc: 'Static until end of clip' },
    { id: 'bounce_out',  label: 'Bounce Out',  desc: 'Windup anticipation & spring snap collapse' },
    { id: 'slide_out',   label: 'Slide Out',   desc: 'Snappy inertia slide exit' },
    { id: 'fade_down',   label: 'Fade Down',   desc: 'Gravity drop & fade away' },
    { id: 'shrink_drop', label: 'Shrink Drop', desc: 'Scale-down fall through floor' }
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
      const p = Object.assign({}, DEFAULT_TEXT_PROPS, layer.textProps || {});
      const effectiveAnimIn = p.animIn || (p.animation && p.animation !== 'none' ? p.animation : 'bounce_pop');
      const inDur = Math.max(0.1, Number(p.animInDuration || p.animDuration) || 0.8);
      const effectiveAnimOut = p.animOut || 'none';
      const outDur = Math.max(0.1, Number(p.animOutDuration) || 0.6);
      const clipDuration = Math.max(0.5, Number(clipDur) || 5.0);
      const outStartSec = Math.max(inDur, clipDuration - outDur);

      let scaleX = 1.0;
      let scaleY = 1.0;
      let offX = 0;
      let offY = 0;
      let alpha = 1.0;

      // 1. IN ANIMATION (Intro)
      if (localSec < inDur && effectiveAnimIn !== 'none') {
        const pIn = Math.min(1.0, Math.max(0, localSec / inDur));
        const normalizedIn = normalizeAnimIn(effectiveAnimIn);

        if (normalizedIn === 'fade_up') {
          const ease = 1 - Math.pow(1 - pIn, 2);
          offY = (1 - ease) * 36;
          alpha = ease;
        } else if (normalizedIn.startsWith('bounce_') || normalizedIn === 'wave' || normalizedIn === 'typewriter' || normalizedIn === 'glitch') {
          // Staggered character-level animations are evaluated per-glyph inside drawText,
          // preserving layer layout and typography without whole-box distortion.
          scaleX = 1.0;
          scaleY = 1.0;
          offX = 0;
          offY = 0;
          alpha = 1.0;
        }
      }
      // 2. OUT ANIMATION (Outro)
      else if (localSec >= outStartSec && effectiveAnimOut !== 'none') {
        const tOut = localSec - outStartSec;
        const pOut = Math.min(1.0, Math.max(0, tOut / outDur));

        if (effectiveAnimOut === 'bounce_out') {
          // AE Windup Crouch then Explosive Collapse
          if (pOut < 0.25) {
            const u = pOut / 0.25;
            const squash = Math.sin(u * Math.PI);
            scaleX = 1.0 + squash * 0.24;
            scaleY = 1.0 - squash * 0.22;
            offY = squash * 14;
            alpha = 1.0;
          } else {
            const u = (pOut - 0.25) / 0.75;
            const launch = Math.pow(u, 2.5);
            scaleX = Math.max(0, (1 - launch) * 0.82);
            scaleY = Math.max(0, (1 - launch) * 1.45);
            offY = -launch * 80;
            alpha = Math.max(0, 1 - u * 1.6);
          }
        } else if (effectiveAnimOut === 'slide_out') {
          if (pOut < 0.20) {
            const u = pOut / 0.20;
            offX = -Math.sin(u * Math.PI) * 18;
            alpha = 1.0;
          } else {
            const u = (pOut - 0.20) / 0.80;
            offX = Math.pow(u, 2) * 240;
            alpha = Math.max(0, 1 - u * 1.5);
          }
        } else if (effectiveAnimOut === 'fade_down') {
          offY = Math.pow(pOut, 2) * 50;
          alpha = Math.max(0, 1 - pOut);
        } else if (effectiveAnimOut === 'shrink_drop') {
          const s = Math.max(0, 1 - Math.pow(pOut, 2));
          scaleX = s;
          scaleY = s;
          offY = pOut * 60;
          alpha = Math.max(0, 1 - pOut);
        }
      }

      return { scaleX, scaleY, offX, offY, alpha };
    }

    /**
     * Render Text to an offscreen buffer canvas with dynamic resolution.
     */
    static renderTextToCanvas(layer, canvas, targetW, targetH, localSec = 0, clipDur = 5) {
      if (!canvas || typeof canvas.getContext !== 'function' || !layer) return canvas;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;

      const p = Object.assign({}, DEFAULT_TEXT_PROPS, layer.textProps || {});

      const font = (p.fontStyle || 'normal') + ' ' + (p.fontWeight || 'bold') + ' ' + (p.fontSize || 64) + 'px ' + (p.fontFamily || 'Cal Sans');
      const measure = this.measureText(ctx, p.text || 'Text', font, p.letterSpacing, p.lineHeight);

      const padX = p.badgeEnabled ? (p.badgePaddingX * 2 + 16) : 24;
      const padY = p.badgeEnabled ? (p.badgePaddingY * 2 + 16) : 16;
      const shadowPad = p.longShadow ? (p.longShadowLength + 10) : (p.shadowEnabled ? (p.shadowBlur + Math.abs(p.shadowOffsetX) + 6) : 0);

      // Animation padding: extra vertical space so characters can bounce outside text bounds.
      // Stored on layer._textAnimPadY so compositor can compensate position (no squish).
      const normInCheck = normalizeAnimIn(p.animIn || p.animation || 'none');
      const hasAnim = normInCheck === 'bounce_1' || normInCheck === 'bounce_2'
                   || normInCheck === 'bounce_3' || normInCheck === 'bounce_4';
      const animAmp = Number(p.animAmplitude) > 0 ? Number(p.animAmplitude) : 0.6;
      const fontSize = p.fontSize || 64;
      const animPadY = hasAnim ? Math.ceil(fontSize * animAmp * 1.5) : 0;

      // Store on layer so compositor knows to offset the draw position
      if (layer) layer._textAnimPadY = animPadY;

      const reqW = Math.max(Math.ceil(targetW || 0), Math.ceil(measure.width + padX + shadowPad * 2));
      const reqH = Math.max(Math.ceil(targetH || 0), Math.ceil(measure.height + padY + shadowPad * 2)) + animPadY * 2;

      if (canvas.width !== reqW || canvas.height !== reqH) {
        canvas.width = reqW;
        canvas.height = reqH;
      }

      ctx.clearRect(0, 0, reqW, reqH);
      ctx.save();

      const cx = reqW / 2;
      // Shift center down by animPadY so upward bouncing chars don't clip at top
      const cy = reqH / 2;

      // 1. Draw Badge Background Pill / Box if enabled
      if (p.badgeEnabled) {
        ctx.save();
        const boxW = measure.width + p.badgePaddingX * 2;
        const boxH = measure.height + p.badgePaddingY * 2;
        const bx = cx - boxW / 2;
        const by = cy - boxH / 2;
        const rad = Math.min(p.badgeRadius, boxH / 2);

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

      const lines = measure.lines;
      const lineH = measure.lineHeight;
      const totalH = lines.length * lineH;
      const startY = cy - (totalH / 2) + (lineH / 2);

      let globalCharIndex = 0;
      const fullText = lines.join('');
      const totalChars = fullText.length || 1;

      const effectiveAnimIn = p.animIn || (p.animation && p.animation !== 'none' ? p.animation : 'bounce_pop');
      const inDur = Math.max(0.1, Number(p.animInDuration || p.animDuration) || 0.8);

      // Calculate typewriter progress if active
      let isTypewriter = (effectiveAnimIn === 'typewriter' || p.animation === 'typewriter');
      let visibleChars = totalChars;
      if (isTypewriter) {
        const prog = Math.min(1.0, Math.max(0, localSec / inDur));
        visibleChars = Math.floor(prog * totalChars);
      }

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

          // Skip invisible characters in typewriter
          if (isTypewriter && charIndex > visibleChars) {
            continue;
          }

          let offX = 0;
          let offY = 0;
          let scaleX = 1.0;
          let scaleY = 1.0;
          let charAlpha = 1.0;
          let charRotation = 0;

          const normIn = normalizeAnimIn(effectiveAnimIn);
          const fps = (typeof window !== 'undefined' && typeof window.getProjectFps === 'function') ? window.getProjectFps() : 60;
          const fontSize = p.fontSize || 64;

          // ─── AE Text Animator model ────────────────────────────────────────
          // All characters are VISIBLE from frame 0 at their displaced positions.
          // Each character springs from its displaced state → rest with a stagger.
          // No pop-in. No sudden alpha=0→1. Characters are always "on screen"
          // but fly into their final positions like AE Text Animator does.
          //
          // AE values from screenshot: Position=[0, 865], Scale=[0,0]%, Rotation=-27°
          // ── Stagger derived from animInDuration ────────────────────────────
          // User sets animInDuration in UI → controls total cascade speed.
          // stagger = inDur / totalChars so ALL chars finish within inDur.
          // Spring physics tuned so each char settles within its remaining time.

          // ── User-tunable spring parameters ─────────────────────────────────
          const animDecay     = Number(p.animDecay)     > 0 ? Number(p.animDecay)     : 7.0;
          const animFreq      = Number(p.animFreq)      > 0 ? Number(p.animFreq)      : 3;
          const animAmplitude = Number(p.animAmplitude) > 0 ? Number(p.animAmplitude) : 0.6;
          const animStagger   = Number(p.animStagger) >= 0 ? Number(p.animStagger)    : 0.5;
          const animTarget    = p.animTarget || 'character';

          // ── animTarget: compute animation index per character/word/line ──────
          // character → each char has its own stagger index (charIndex)
          // word      → all chars in same word share one stagger index
          // line      → all chars in same line share one stagger index
          let animIndex = charIndex;
          let totalUnits = totalChars;

          if (animTarget === 'line') {
            animIndex = lineIdx;
            totalUnits = lines.length;
          } else if (animTarget === 'word') {
            // Compute word index by counting spaces before this char in the full text
            const fullTextUpToChar = lines.slice(0, lineIdx).join(' ') + (lineIdx > 0 ? ' ' : '') + line.slice(0, i);
            animIndex = (fullTextUpToChar.match(/\s+/g) || []).length;
            // Total word count
            totalUnits = (fullText.replace(/\s+/g, ' ').trim().match(/\s+/g) || []).length + 1;
          }

          // Stagger: last unit starts at localSec = inDur * animStagger
          const stagger = totalUnits > 1
            ? (inDur * animStagger) / (totalUnits - 1)
            : 0;
          const myDelay = stagger * animIndex;
          const t       = localSec - myDelay;


          if (normIn === 'bounce_1' || normIn === 'bounce_3') {
            // Position Y spring — chars enter from below, spring to rest
            if (t <= 0) {
              charAlpha = 0;
            } else {
              const freq      = normIn === 'bounce_3' ? Math.max(0.5, animFreq  - 1) : animFreq;
              const decay     = normIn === 'bounce_3' ? Math.max(0.5, animDecay - 2) : animDecay;
              const amplitude = fontSize * animAmplitude;
              const s = amplitude * Math.cos(freq * t * 2 * Math.PI) / Math.exp(decay * t);
              offY = s;
              charAlpha = Math.min(1.0, t / Math.max(0.005, stagger > 0 ? stagger * 0.8 : 0.03));
            }

          } else if (normIn === 'bounce_2' || normIn === 'bounce_4') {
            // Scale spring — chars pop from 0 → 1 with elastic overshoot
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
            const hash = Math.sin(quant * 9999 + charIndex * 1337);
            const hash2 = Math.cos(quant * 4321 + charIndex * 777);
            if (Math.abs(hash) > 0.55) {
              offX = hash * fontSize * 0.15;
              offY = hash2 * fontSize * 0.08;
              charAlpha = 0.55 + Math.abs(hash) * 0.45;
              scaleX = 1.0 + hash * 0.08;
            }
          }

          if (charAlpha <= 0.001) {
            curX += chW;
            continue;
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
            const steps = Math.min(60, Math.round(p.longShadowLength));
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
            ctx.shadowBlur = p.neonGlowBlur || 16;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.fillStyle = p.fillColor || '#ffffff';
            ctx.fillText(ch, -(chW / 2), 0);
            ctx.fillText(ch, -(chW / 2), 0); // Double pass for intense neon
            ctx.restore();
          } else if (p.shadowEnabled) {
            ctx.save();
            ctx.shadowColor = p.shadowColor || 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = p.shadowBlur || 8;
            ctx.shadowOffsetX = p.shadowOffsetX || 4;
            ctx.shadowOffsetY = p.shadowOffsetY || 4;
            ctx.fillStyle = p.fillColor || '#ffffff';
            ctx.fillText(ch, -(chW / 2), 0);
            ctx.restore();
          }

          // C. Draw Stroke / Outline
          if (p.strokeWidth > 0) {
            ctx.save();
            ctx.strokeStyle = p.strokeColor || '#000000';
            ctx.lineWidth = p.strokeWidth;
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
        if (p.animation === 'typewriter' && localSec < (p.animDuration || 2.5)) {
          const blink = Math.floor(localSec * 4) % 2 === 0;
          if (blink && lineIdx === lines.length - 1) {
            ctx.save();
            ctx.fillStyle = p.fillColor || '#98ce7b';
            ctx.fillRect(curX + 4, curY - p.fontSize * 0.4, 4, p.fontSize * 0.8);
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
