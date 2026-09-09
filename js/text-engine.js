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
    badgeRadius: 8,
    animation: 'bounce_pop',    // legacy alias for animIn
    animSpeed: 1.0,
    animDuration: 0.8,          // legacy alias for animInDuration
    animIn: 'bounce_pop',       // 'none' | 'bounce_pop' | 'bounce_drop' | 'overshoot_slide' | 'elastic_wobble' | 'typewriter' | 'wave' | 'fade_up' | 'glitch'
    animInDuration: 0.8,        // in seconds
    animOut: 'none',            // 'none' | 'bounce_out' | 'slide_out' | 'fade_down' | 'shrink_drop'
    animOutDuration: 0.6,       // in seconds
    presetId: 'default'
  };

  const TEXT_PRESETS = [
    {
      id: 'default',
      name: 'Clean Bold',
      desc: 'Modern flat headline typography',
      props: {
        text: 'OPEN FISH',
        fontSize: 72,
        fontWeight: '700',
        letterSpacing: 3,
        fillColor: '#ffffff',
        strokeWidth: 0,
        longShadow: false,
        neonGlow: false,
        badgeEnabled: false,
        animation: 'none'
      }
    },
    {
      id: 'outline',
      name: 'Hero Outline',
      desc: 'High contrast black stroke outline',
      props: {
        text: 'HEADLINE',
        fontSize: 76,
        fontWeight: '800',
        letterSpacing: 4,
        fillColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 10,
        strokeJoin: 'round',
        longShadow: false,
        neonGlow: false,
        badgeEnabled: false,
        animation: 'none'
      }
    },
    {
      id: 'long_shadow',
      name: 'Long Shadow',
      desc: 'Extruded 45° flat shadow effect',
      props: {
        text: 'SHADOW',
        fontSize: 72,
        fontWeight: '800',
        letterSpacing: 2,
        fillColor: '#98ce7b',
        strokeWidth: 0,
        longShadow: true,
        longShadowColor: 'rgba(13, 17, 9, 0.75)',
        longShadowLength: 32,
        longShadowAngle: 45,
        neonGlow: false,
        badgeEnabled: false,
        animation: 'none'
      }
    },
    {
      id: 'neon',
      name: 'Neon Glow',
      desc: 'Vibrant matcha cyan cyberpunk glow',
      props: {
        text: 'NEON WAVE',
        fontSize: 68,
        fontWeight: '800',
        letterSpacing: 4,
        fillColor: '#ffffff',
        strokeColor: '#98ce7b',
        strokeWidth: 4,
        neonGlow: true,
        neonGlowColor: '#98ce7b',
        neonGlowBlur: 20,
        longShadow: false,
        badgeEnabled: false,
        animation: 'none'
      }
    },
    {
      id: 'typewriter',
      name: 'Typewriter',
      desc: 'Terminal typewriter typing effect',
      props: {
        text: 'System Initialized...',
        fontSize: 54,
        fontWeight: '700',
        letterSpacing: 2,
        fillColor: '#98ce7b',
        strokeWidth: 0,
        longShadow: false,
        neonGlow: false,
        badgeEnabled: false,
        animation: 'typewriter',
        animSpeed: 1.0,
        animDuration: 2.5
      }
    },
    {
      id: 'wave',
      name: 'Kinetic Wave',
      desc: 'Smooth bouncing wave character animation',
      props: {
        text: 'KINETIC FLOW',
        fontSize: 64,
        fontWeight: '800',
        letterSpacing: 3,
        fillColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 6,
        longShadow: false,
        neonGlow: false,
        badgeEnabled: false,
        animation: 'wave',
        animSpeed: 1.2
      }
    },
    {
      id: 'pop_in',
      name: 'Pop-in Bounce',
      desc: 'Elastic staggered character scale pop',
      props: {
        text: 'SUPER POP!',
        fontSize: 70,
        fontWeight: '800',
        letterSpacing: 3,
        fillColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 8,
        longShadow: true,
        longShadowColor: 'rgba(0, 0, 0, 0.4)',
        longShadowLength: 16,
        longShadowAngle: 45,
        badgeEnabled: false,
        animation: 'pop_in',
        animDuration: 1.8
      }
    },
    {
      id: 'badge',
      name: 'Badge Pill',
      desc: 'Contrasting solid surface badge box',
      props: {
        text: 'FEATURED CLIP',
        fontSize: 48,
        fontWeight: '800',
        letterSpacing: 2,
        fillColor: '#0d1109',
        strokeWidth: 0,
        badgeEnabled: true,
        badgeColor: '#98ce7b',
        badgePaddingX: 28,
        badgePaddingY: 14,
        badgeRadius: 999,
        longShadow: false,
        neonGlow: false,
        animation: 'fade_up'
      }
    }
  ];

  const ANIMATION_IN_TYPES = [
    { id: 'none', label: 'None', desc: 'Static crisp typography' },
    { id: 'bounce_pop', label: 'Bounce Pop', desc: 'AE Inertia Spring Overshoot Pop' },
    { id: 'bounce_drop', label: 'Drop Bounce', desc: 'Gravity drop with floor squash & bounce' },
    { id: 'overshoot_slide', label: 'Overshoot Slide', desc: 'Snappy inertia slide with overshoot' },
    { id: 'elastic_wobble', label: 'Jelly Wobble', desc: 'Elastic jelly rubber oscillation' },
    { id: 'typewriter', label: 'Typewriter', desc: 'Sequential character typing with cursor' },
    { id: 'wave', label: 'Kinetic Wave', desc: 'Fluid sinusoidal wave motion' },
    { id: 'fade_up', label: 'Fade Up', desc: 'Smooth vertical cascade fade-in' },
    { id: 'pop_in', label: 'Pop In', desc: 'Elastic bouncy character pop' },
    { id: 'glitch', label: 'Glitch', desc: 'High-energy digital displacement' }
  ];

  const ANIMATION_OUT_TYPES = [
    { id: 'none', label: 'None', desc: 'Static until end of clip' },
    { id: 'bounce_out', label: 'Bounce Out', desc: 'Windup anticipation & spring snap collapse' },
    { id: 'slide_out', label: 'Slide Out', desc: 'Snappy inertia slide exit' },
    { id: 'fade_down', label: 'Fade Down', desc: 'Gravity drop & fade away' },
    { id: 'shrink_drop', label: 'Shrink Drop', desc: 'Scale-down fall through floor' }
  ];

  const ANIMATION_TYPES = ANIMATION_IN_TYPES;

  class FishTextEngine {
    static get PRESETS() { return TEXT_PRESETS; }
    static get ANIMATIONS() { return ANIMATION_IN_TYPES; }
    static get ANIMATION_IN_TYPES() { return ANIMATION_IN_TYPES; }
    static get ANIMATION_OUT_TYPES() { return ANIMATION_OUT_TYPES; }
    static get DEFAULT_PROPS() { return DEFAULT_TEXT_PROPS; }

    static getDefaultProps() {
      return Object.assign({}, DEFAULT_TEXT_PROPS);
    }

    static getPresets() {
      return TEXT_PRESETS;
    }

    static getPreset(presetId) {
      return TEXT_PRESETS.find(p => p.id === presetId) || TEXT_PRESETS[0];
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
     * Render Text to an offscreen buffer canvas.
     */
    static renderTextToCanvas(layer, canvas, targetW, targetH, localSec = 0, clipDur = 5) {
      if (!canvas || typeof canvas.getContext !== 'function' || !layer) return canvas;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;

      const p = Object.assign({}, DEFAULT_TEXT_PROPS, layer.textProps || {});

      const font = (p.fontStyle || 'normal') + ' ' + (p.fontWeight || 'bold') + ' ' + (p.fontSize || 64) + 'px ' + (p.fontFamily || 'Cal Sans');
      const measure = this.measureText(ctx, p.text, font, p.letterSpacing, p.lineHeight);

      const padX = p.badgeEnabled ? (p.badgePaddingX * 2 + 30) : 40;
      const padY = p.badgeEnabled ? (p.badgePaddingY * 2 + 30) : 40;
      const shadowPad = p.longShadow ? (p.longShadowLength + 20) : (p.shadowEnabled ? (p.shadowBlur + Math.abs(p.shadowOffsetX) + 10) : 0);

      const reqW = Math.max(targetW, measure.width + padX + shadowPad * 2);
      const reqH = Math.max(targetH, measure.height + padY + shadowPad * 2);

      if (canvas.width !== reqW || canvas.height !== reqH) {
        canvas.width = reqW;
        canvas.height = reqH;
      }

      ctx.clearRect(0, 0, reqW, reqH);
      ctx.save();

      const cx = reqW / 2;
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
      const effectiveAnimOut = p.animOut || 'none';
      const outDur = Math.max(0.1, Number(p.animOutDuration) || 0.6);
      const clipDuration = Math.max(0.5, Number(clipDur) || 5.0);
      const outStartSec = Math.max(inDur, clipDuration - outDur);

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

          // Character animation displacement & transforms
          let offX = 0;
          let offY = 0;
          let scaleX = 1.0;
          let scaleY = 1.0;
          let charAlpha = 1.0;

          // ==================================================================
          // 1. IN ANIMATION (localSec < inDur)
          // ==================================================================
          if (localSec < inDur && effectiveAnimIn !== 'none') {
            const charDelay = (charIndex / totalChars) * (inDur * 0.45);
            const tChar = Math.max(0, localSec - charDelay);
            const pChar = Math.min(1.0, tChar / (inDur * 0.55));

            // A. AE Inertia Spring Overshoot Pop
            if (effectiveAnimIn === 'bounce_pop' || effectiveAnimIn === 'pop_in') {
              if (pChar < 1.0) {
                const amp = 0.42;
                const freq = 3.6;
                const decay = 5.2;
                const osc = Math.sin(pChar * freq * Math.PI * 2) * Math.exp(-decay * pChar) * amp;
                const base = 1 - Math.pow(1 - pChar, 3);
                const s = Math.max(0, base + osc * (1 - pChar * 0.5));
                scaleX = s;
                scaleY = s;
                charAlpha = Math.min(1.0, pChar * 4);
              }
            }
            // B. AE Gravity Drop with Floor Bounce & Squash/Stretch
            else if (effectiveAnimIn === 'bounce_drop') {
              if (pChar < 1.0) {
                charAlpha = Math.min(1.0, pChar * 5);
                if (pChar < 0.36) {
                  const u = pChar / 0.36;
                  offY = -110 * (1 - u * u);
                  scaleX = 0.92;
                  scaleY = 1.15;
                } else if (pChar < 0.44) {
                  // Floor impact squash
                  const u = (pChar - 0.36) / 0.08;
                  const squash = Math.sin(u * Math.PI);
                  scaleX = 1 + squash * 0.30;
                  scaleY = 1 - squash * 0.25;
                  offY = 0;
                } else if (pChar < 0.70) {
                  // First bounce arc
                  const u = (pChar - 0.44) / 0.26;
                  const arc = Math.sin(u * Math.PI);
                  offY = -34 * arc;
                  scaleX = 1 - arc * 0.1;
                  scaleY = 1 + arc * 0.12;
                } else if (pChar < 0.78) {
                  // Secondary smaller squash
                  const u = (pChar - 0.70) / 0.08;
                  const squash = Math.sin(u * Math.PI);
                  scaleX = 1 + squash * 0.14;
                  scaleY = 1 - squash * 0.10;
                  offY = 0;
                } else if (pChar < 0.92) {
                  // Second minor bounce
                  const u = (pChar - 0.78) / 0.14;
                  const arc = Math.sin(u * Math.PI);
                  offY = -10 * arc;
                  scaleX = 1.0;
                  scaleY = 1.0;
                } else {
                  offY = 0;
                  scaleX = 1.0;
                  scaleY = 1.0;
                }
              }
            }
            // C. AE Overshoot Slide (Snap-in with inertia overshoot)
            else if (effectiveAnimIn === 'overshoot_slide') {
              if (pChar < 1.0) {
                charAlpha = Math.min(1.0, pChar * 3.5);
                const amp = 0.35;
                const freq = 3.0;
                const decay = 4.8;
                const osc = Math.sin(pChar * freq * Math.PI * 2) * Math.exp(-decay * pChar) * amp;
                const base = 1 - Math.pow(1 - pChar, 3);
                const factor = 1 - (base + osc * (1 - pChar * 0.5));
                offX = factor * 90;
                scaleX = 1 + Math.abs(factor) * 0.15;
                scaleY = 1 - Math.abs(factor) * 0.08;
              }
            }
            // D. AE Elastic Wobble / Jelly (asymmetric X/Y spring)
            else if (effectiveAnimIn === 'elastic_wobble') {
              if (pChar < 1.0) {
                charAlpha = Math.min(1.0, pChar * 4);
                const decay = 4.5;
                const freq = 3.8;
                const wobble = Math.sin(pChar * freq * Math.PI * 2) * Math.exp(-decay * pChar) * 0.45;
                scaleX = 1 + wobble;
                scaleY = 1 - wobble * 0.85;
                offY = -Math.sin(pChar * Math.PI) * 12 * (1 - pChar);
              }
            }
            // E. Kinetic Sinusoidal Wave
            else if (effectiveAnimIn === 'wave') {
              const freq = 5.0 * (p.animSpeed || 1.0);
              const phase = charIndex * 0.45;
              offY = Math.sin(localSec * freq + phase) * 10;
            }
            // F. Smooth Fade Up
            else if (effectiveAnimIn === 'fade_up') {
              const ease = 1 - (1 - pChar) * (1 - pChar);
              offY = (1 - ease) * 30;
              charAlpha = ease;
            }
            // G. Digital Glitch
            else if (effectiveAnimIn === 'glitch') {
              const quant = Math.floor(localSec * 12);
              const hash = Math.sin(quant * 9999 + charIndex * 1337);
              if (Math.abs(hash) > 0.75) {
                offX = (hash > 0 ? 1 : -1) * (Math.abs(hash) * 6);
                offY = (Math.cos(quant) * 3);
              }
            }
          }
          // ==================================================================
          // 2. OUT ANIMATION (localSec >= outStartSec)
          // ==================================================================
          else if (localSec >= outStartSec && effectiveAnimOut !== 'none') {
            const tOut = localSec - outStartSec;
            const charDelay = (charIndex / totalChars) * (outDur * 0.4);
            const tCharOut = Math.max(0, tOut - charDelay);
            const pCharOut = Math.min(1.0, tCharOut / (outDur * 0.6));

            // A. AE Spring Bounce Out (Windup anticipation & snap collapse)
            if (effectiveAnimOut === 'bounce_out') {
              if (pCharOut < 0.22) {
                const u = pCharOut / 0.22;
                const squash = Math.sin(u * Math.PI);
                scaleX = 1 + squash * 0.18;
                scaleY = 1 + squash * 0.18;
                offY = -squash * 10;
                charAlpha = 1.0;
              } else {
                const u = (pCharOut - 0.22) / 0.78;
                const s = Math.max(0, 1 - Math.pow(u, 2.5));
                scaleX = s;
                scaleY = s;
                offY = u * 45;
                charAlpha = Math.max(0, 1 - u * 1.4);
              }
            }
            // B. AE Snappy Slide Out
            else if (effectiveAnimOut === 'slide_out') {
              if (pCharOut < 0.20) {
                const u = pCharOut / 0.20;
                offX = -Math.sin(u * Math.PI) * 10;
                charAlpha = 1.0;
              } else {
                const u = (pCharOut - 0.20) / 0.80;
                offX = Math.pow(u, 2) * 120;
                charAlpha = Math.max(0, 1 - u * 1.5);
              }
            }
            // C. Smooth Fade Down
            else if (effectiveAnimOut === 'fade_down') {
              offY = Math.pow(pCharOut, 2) * 45;
              charAlpha = Math.max(0, 1 - pCharOut);
            }
            // D. Shrink & Drop through Floor
            else if (effectiveAnimOut === 'shrink_drop') {
              const s = Math.max(0, 1 - pCharOut);
              scaleX = s;
              scaleY = s;
              offY = pCharOut * 50;
              charAlpha = Math.max(0, 1 - pCharOut);
            }
          }
          // ==================================================================
          // 3. MIDDLE SETTLED / AMBIENT MOTION
          // ==================================================================
          else {
            if (effectiveAnimIn === 'wave') {
              const freq = 5.0 * (p.animSpeed || 1.0);
              const phase = charIndex * 0.45;
              offY = Math.sin(localSec * freq + phase) * 8;
            }
          }

          if (charAlpha <= 0.01) {
            curX += chW;
            continue;
          }

          ctx.save();
          ctx.globalAlpha = charAlpha;

          const renderX = curX + (chW / 2) + offX;
          const renderY = curY + offY;

          ctx.translate(renderX, renderY);
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
