/**
 * TEXT PRESET: Default
 * Basic clean white bold text — foundational starting point.
 * Modular plugin for OpenFishTools Studio.
 *
 * Add more presets by creating text/[name].js and calling
 * FishTextEngine.registerPreset({ id, name, desc, props }).
 */

(function () {
  'use strict';

  if (!window.FishTextEngine) return;

  window.FishTextEngine.registerPreset({
    id: 'default',
    name: 'Default',
    desc: 'Basic clean white bold text',
    props: {
      text: 'Your Text Here',
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
      animIn: 'none',
      animOut: 'none',
      animInDuration: 0.8,
      animOutDuration: 0.6
    }
  });

})();
