/**
 * TEXT PRESETS: AE-Style Animation Collection
 * Authentic After Effects damped spring & inertia animations.
 * Each preset = distinct animIn personality. Plugin for OpenFishTools Studio.
 */
(function () {
  'use strict';
  if (!window.FishTextEngine) return;

  // ── Preset: Kinetic Pop ─────────────────────────────────────────────────────
  // Expr 1: delay 20ms, freq 3, amp 50, decay 7 — fast tight per-char Y bounce
  window.FishTextEngine.registerPreset({
    id: 'kinetic_pop',
    name: 'Kinetic Pop',
    desc: 'Fast per-char Y bounce, 20ms stagger — AE Expression 1',
    props: {
      text: 'Kinetic Pop',
      fontSize: 72,
      fontFamily: 'Cal Sans, Inter, sans-serif',
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'center',
      letterSpacing: 2,
      lineHeight: 1.2,
      fillColor: '#ffffff',
      strokeWidth: 0,
      longShadow: false,
      neonGlow: false,
      badgeEnabled: false,
      shadowEnabled: false,
      animIn: 'bounce_1',
      animOut: 'none',
      animInDuration: 0.8,
      animOutDuration: 0.6
    }
  });

  // ── Preset: Elastic Scale ───────────────────────────────────────────────────
  // Expr 2: frame-stagger scale 0→100%, decay 9 — quick elastic pop-in
  window.FishTextEngine.registerPreset({
    id: 'elastic_scale',
    name: 'Elastic Scale',
    desc: 'Frame-stagger scale elastic — AE Expression 2',
    props: {
      text: 'Elastic Scale',
      fontSize: 72,
      fontFamily: 'Cal Sans, Inter, sans-serif',
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'center',
      letterSpacing: 2,
      lineHeight: 1.2,
      fillColor: '#ffffff',
      strokeWidth: 0,
      longShadow: false,
      neonGlow: false,
      badgeEnabled: false,
      shadowEnabled: false,
      animIn: 'bounce_2',
      animOut: 'none',
      animInDuration: 0.6,
      animOutDuration: 0.6
    }
  });

  // ── Preset: Smooth Wave ─────────────────────────────────────────────────────
  // Expr 3: delay 60ms, freq 2, amp 50, decay 8 — wide lazy stagger, smooth wave feel
  window.FishTextEngine.registerPreset({
    id: 'smooth_wave',
    name: 'Smooth Wave',
    desc: 'Slower stagger Y bounce, 60ms delay — AE Expression 3',
    props: {
      text: 'Smooth Wave',
      fontSize: 72,
      fontFamily: 'Cal Sans, Inter, sans-serif',
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'center',
      letterSpacing: 4,
      lineHeight: 1.2,
      fillColor: '#ffffff',
      strokeWidth: 0,
      longShadow: false,
      neonGlow: false,
      badgeEnabled: false,
      shadowEnabled: false,
      animIn: 'bounce_3',
      animOut: 'none',
      animInDuration: 1.2,
      animOutDuration: 0.6
    }
  });

  // ── Preset: Gentle Settle ───────────────────────────────────────────────────
  // Expr 4: frame-stagger scale, dur 0.25s, freq 1, decay 8 — slow gentle elastic
  window.FishTextEngine.registerPreset({
    id: 'gentle_settle',
    name: 'Gentle Settle',
    desc: 'Slow elastic scale settle — AE Expression 4',
    props: {
      text: 'Gentle Settle',
      fontSize: 72,
      fontFamily: 'Cal Sans, Inter, sans-serif',
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'center',
      letterSpacing: 2,
      lineHeight: 1.2,
      fillColor: '#ffffff',
      strokeWidth: 0,
      longShadow: false,
      neonGlow: false,
      badgeEnabled: false,
      shadowEnabled: false,
      animIn: 'bounce_4',
      animOut: 'none',
      animInDuration: 1.0,
      animOutDuration: 0.6
    }
  });

  // ── Preset: Neon Bounce ─────────────────────────────────────────────────────
  // Expr 1 + neon glow overlay
  window.FishTextEngine.registerPreset({
    id: 'neon_bounce',
    name: 'Neon Bounce',
    desc: 'Kinetic pop with neon glow — AE Expression 1',
    props: {
      text: 'Neon Bounce',
      fontSize: 72,
      fontFamily: 'Cal Sans, Inter, sans-serif',
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'center',
      letterSpacing: 3,
      lineHeight: 1.2,
      fillColor: '#98ce7b',
      strokeWidth: 0,
      longShadow: false,
      neonGlow: true,
      neonGlowColor: '#98ce7b',
      neonGlowBlur: 18,
      badgeEnabled: false,
      shadowEnabled: false,
      animIn: 'bounce_1',
      animOut: 'none',
      animInDuration: 0.8,
      animOutDuration: 0.6
    }
  });

  // ── Preset: Title Card ──────────────────────────────────────────────────────
  // Expr 3 + badge pill + slide_out exit — cinematic title feel
  window.FishTextEngine.registerPreset({
    id: 'title_card',
    name: 'Title Card',
    desc: 'Wave stagger in, badge pill, slide out — cinematic',
    props: {
      text: 'Title Card',
      fontSize: 64,
      fontFamily: 'Cal Sans, Inter, sans-serif',
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'center',
      letterSpacing: 4,
      lineHeight: 1.2,
      fillColor: '#ffffff',
      strokeWidth: 0,
      longShadow: false,
      neonGlow: false,
      badgeEnabled: true,
      badgeColor: '#1a2215',
      badgePaddingX: 24,
      badgePaddingY: 12,
      badgeRadius: 6,
      shadowEnabled: false,
      animIn: 'bounce_3',
      animOut: 'slide_out',
      animInDuration: 1.0,
      animOutDuration: 0.5
    }
  });

  // ── Preset: Glitch Reveal ───────────────────────────────────────────────────
  window.FishTextEngine.registerPreset({
    id: 'glitch_reveal',
    name: 'Glitch Reveal',
    desc: 'Digital glitch displacement on entry',
    props: {
      text: 'Glitch Reveal',
      fontSize: 72,
      fontFamily: 'Cal Sans, Inter, sans-serif',
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'center',
      letterSpacing: 2,
      lineHeight: 1.2,
      fillColor: '#ffffff',
      strokeWidth: 0,
      longShadow: false,
      neonGlow: false,
      badgeEnabled: false,
      shadowEnabled: false,
      animIn: 'glitch',
      animOut: 'none',
      animInDuration: 1.0,
      animOutDuration: 0.6
    }
  });

  // ── Preset: Typewriter ──────────────────────────────────────────────────────
  window.FishTextEngine.registerPreset({
    id: 'typewriter_clean',
    name: 'Typewriter',
    desc: 'Sequential character typing with blinking cursor',
    props: {
      text: 'Typewriter_',
      fontSize: 64,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontWeight: '700',
      fontStyle: 'normal',
      textAlign: 'center',
      letterSpacing: 1,
      lineHeight: 1.2,
      fillColor: '#98ce7b',
      strokeWidth: 0,
      longShadow: false,
      neonGlow: false,
      badgeEnabled: false,
      shadowEnabled: false,
      animIn: 'typewriter',
      animOut: 'none',
      animInDuration: 2.0,
      animOutDuration: 0.6
    }
  });

})();
