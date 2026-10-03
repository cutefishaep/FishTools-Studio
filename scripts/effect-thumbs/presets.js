/* Per-effect thumbnail presets (tuned for a 128x128 canvas). Used by render.html. */
const STOCK_IDS = ['1543793', '1170986', '156934', '774731', '127028', '1741205', '2061057', '1472999', '617278', 'coding'];
const CAT_OVERRIDE = {};
// one portrait photo shared by every effect of a category
const PHOTO_BY_CAT = { 'lightning': '1543793', 'layer': '1170986', '3d': '156934', 'movement': '774731', 'warp': '127028', 'wipe': '1741205', 'background': '2061057' };
// categories without renderable effects get a plain portrait photo as their background
const PHOTO_COLLAGES = { 'expression': 'coding', 'artificial-intelligence': '617278' };
const ROT = { rotX: 22, rotY: -32 };

const PRESETS = {
  'anamorphic-flare': { src: 'photo', params: { boost: 130, threshold: 35, size: 90, thickness: 4 } },
  'bevel': { src: 'photo', inset: 16, params: { edgeThickness: 7 } },
  'box_3d': { src: 'photo', params: { shading: 55, edgeOpacity: 80, edgeColor: '#ffffff' }, layer: { rotX: 20, rotY: -30, scaleZ: 60 } },
  'brightness-contrast': { src: 'photo', params: { brightness: -8, contrast: 45 } },
  'camera-lens-blur': { src: 'photo', params: { radius: 4 } },
  'chromatic-aberration': { src: 'photo', params: { amount: 45, redShift: 6, blueShift: -6 } },
  'color-balance': { src: 'photo', params: { red: -30, green: 10, blue: 60 } },
  'color-temperature': { src: 'photo', params: { temperature: 60, tint: 10 } },
  'colorize': { src: 'photo', params: { color: '#ff4fa3', intensity: 70 } },
  'curve': { src: 'photo', params: { contrast: 50 } },
  'deep-glow': { src: 'photo', params: { radius: 12, exposure: 30, coreBoost: 80, threshold: 70 } },
  'diffusion': { src: 'photo', params: { intensity: 70, radius: 12, threshold: 40 } },
  'drop-shadow': { src: 'photo', inset: 24, params: { distance: 8, blur: 6, opacity: 85 } },
  'exposure-gamma': { src: 'photo', params: { exposure: 0, gamma: 6 } },
  'extrude_3d': { src: 'photo', params: { sideMode: 'solid color', faceColor: '#e8a24a', shading: 60, steps: 24 }, layer: { rotX: 18, rotY: -28, scaleZ: 40 } },
  'fast-box-blur': { src: 'photo', params: { radius: 2, iterations: 1 } },
  'fill': { src: 'photo', inset: 20, params: { color: '#ff3d7f' } },
  'flicker': { src: 'photo', sec: 0.37, params: { amount: 60 } },
  'fsmb': { src: 'photo', sec: 0.2, params: { blur: 60 } },
  'glow-aura': { src: 'photo', inset: 26, sec: 1, params: { glowWidth: 24, threshold: 20, intensity: 120 } },
  'grad-exposure': { src: 'photo', params: { exposure: 60, angle: 90 } },
  'gradient-overlay': { src: 'photo', params: { color1: '#ff3d7f', color2: '#3d7fff', opacity: 60, blendMode: 'overlay' } },
  'grid': { src: 'solid', params: { size: 16, border: 1, color: '#00e5ff', opacity: 80 } },
  'haze-flare': { src: 'photo', params: { exposure: 70 } },
  'highlight-shadow': { src: 'photo', params: { highlights: -40, shadows: 50 } },
  'hue-shift': { src: 'photo', params: { hue: 120 } },
  'invert': { src: 'photo', params: {} },
  'linear_wipe': { src: 'photo', params: { completion: 45, angle: 90, feather: 14 } },
  'lumia': { src: 'photo', params: { threshold: 40 } },
  'mono': { src: 'photo', params: { intensity: 100, tintAmount: 0 } },
  'optic-compensation': { src: 'photo', params: { fov: 120 } },
  'oscillate': { src: 'photo', sec: 0.1, params: { amplitude: 20 } },
  'particle-engine': { src: 'solid', sec: 3, params: { size: 9, birthRate: 1000, emitterSizeX: 128, emitterSizeY: 128, velocity: 10, life: 5, preRun: 6, glow: 70 } },
  'pyramid_3d': { src: 'solid', params: { sideMode: 'solid color', faceColor: '#e8a24a', edgeOpacity: 50, apexY: 20 }, layer: { rotX: 10, rotY: -12, scaleZ: 90 } },
  'radio-waves': { src: 'solid', sec: 1.2, params: { expansion: 60, startWidth: 1, endWidth: 3 } },
  'rays': { src: 'photo', params: { intensity: 50, length: 50, threshold: 60 } },
  'rgb-split': { src: 'photo', params: { distance: 6, angle: 0 } },
  'saturation-vibrant': { src: 'photo', params: { saturation: 60, vibrance: 40 } },
  'scanline': { src: 'photo', params: { lineWidth: 1, spacing: 3, opacity: 60 } },
  'shake': { src: 'photo', sec: 0.3, params: { amplitudeX: 6, amplitudeY: 6, rotation: 3 } },
  'sharpen': { src: 'photo', params: { sharpenAmp: 3 } },
  'shatter': { src: 'photo', params: { progress: 12, autoAnimate: 0, pieces: 40, force: 40, spin: 30, gravity: 20 } },
  'solid-aura': { src: 'photo', inset: 22, params: { thickness: 6 } },
  'sphere_3d': { src: 'photo', params: { shading: 65, highlightOpacity: 45, shadowOpacity: 55, rimColor: '#000000', rimWidth: 8, lightX: 32, lightY: 25 }, layer: { rotX: 20, rotY: -30, scaleZ: 60 } },
  'star-burst': { src: 'solid', sec: 1, params: { size: 1, density: 300, scatter: 60, depth: 300 } },
  'swing': { src: 'photo', sec: 0.2, params: { swingAngle: 30 } },
  'tile': { src: 'photo', params: { scale: 50, mirror: 1 } },
  'tint': { src: 'photo', params: { mapBlackTo: '#1b0a3c', mapWhiteTo: '#ffd27a' } },
  'transform': { src: 'photo', params: { scale: 70, rotation: 15 } },
  'turbulent-displace': { src: 'photo', params: { amount: 15, size: 30 } },
  'unsharp-mask': { src: 'photo', params: { amount: 200, radius: 2 } },
  'vignette': { src: 'photo', params: { amount: -80 } },
  'warp': { src: 'photo', params: { warpStyle: 'bulge', bend: 50 } },
  'wave-warp': { src: 'photo', params: { waveHeight: 6, waveWidth: 30 } }
};

// darkness applied over category collages so the label chips stay readable (0..1)
const CATEGORY_DIM = 0.4;
