import { BaseEffect } from './baseEffect.js';

export class ColorGradingEffect extends BaseEffect {
  constructor() {
    super({
      id: 'color_grading',
      name: 'Color Grading',
      category: 'Color & Light',
      params: {
        brightness: { label: 'effects.brightness', type: 'range', min: -1, max: 1, step: 0.05, default: 0 },
        contrast: { label: 'effects.contrast', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
        saturation: { label: 'effects.saturation', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
        hue: { label: 'effects.hue', type: 'range', min: -180, max: 180, step: 1, default: 0 }
      }
    });
  }

  apply(mesh, time, userParams = {}) {
    if (!mesh || !mesh.material) return;
    const b = userParams.brightness !== undefined ? userParams.brightness : 0;
    const c = userParams.contrast !== undefined ? userParams.contrast : 1;
    const s = userParams.saturation !== undefined ? userParams.saturation : 1;

    if (mesh.material.color) {
      const baseR = 1 + b;
      const baseG = 1 + b;
      const baseB = 1 + b;
      mesh.material.color.setRGB(
        Math.max(0, Math.min(1, baseR * c)),
        Math.max(0, Math.min(1, baseG * c)),
        Math.max(0, Math.min(1, baseB * c))
      );
    }
  }
}
