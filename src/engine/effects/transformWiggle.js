import { BaseEffect } from './baseEffect.js';

export class TransformWiggleEffect extends BaseEffect {
  constructor() {
    super({
      id: 'wiggle',
      name: '3D Wiggle / Shake',
      category: 'Transform & 3D',
      params: {
        frequency: { label: 'effects.wiggleFreq', type: 'range', min: 0.5, max: 10, step: 0.5, default: 3 },
        amplitude: { label: 'effects.wiggleAmp', type: 'range', min: 0, max: 2, step: 0.1, default: 0.5 }
      }
    });
  }

  apply(mesh, time, userParams = {}) {
    if (!mesh) return;
    const freq = userParams.frequency !== undefined ? userParams.frequency : 3;
    const amp = userParams.amplitude !== undefined ? userParams.amplitude : 0.5;

    mesh.position.x += Math.sin(time * freq) * amp * 0.15;
    mesh.position.y += Math.cos(time * freq * 1.3) * amp * 0.15;
    mesh.rotation.z += Math.sin(time * freq * 0.8) * amp * 0.05;
  }
}
