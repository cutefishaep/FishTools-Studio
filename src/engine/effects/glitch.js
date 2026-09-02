import { BaseEffect } from './baseEffect.js';

export class GlitchEffect extends BaseEffect {
  constructor() {
    super({
      id: 'glitch',
      name: 'Digital Glitch',
      category: 'Distortion',
      params: {
        intensity: { label: 'effects.glitchIntensity', type: 'range', min: 0, max: 1, step: 0.05, default: 0.3 },
        speed: { label: 'effects.glitchSpeed', type: 'range', min: 0.1, max: 5, step: 0.1, default: 1 }
      }
    });
  }

  apply(mesh, time, userParams = {}) {
    if (!mesh) return;
    const intensity = userParams.intensity !== undefined ? userParams.intensity : 0.3;
    const speed = userParams.speed !== undefined ? userParams.speed : 1;
    if (intensity <= 0) return;

    const noise = Math.sin(time * speed * 25) * Math.cos(time * speed * 15);
    if (Math.abs(noise) > 0.6) {
      mesh.position.x += (Math.random() - 0.5) * intensity * 0.4;
      mesh.position.y += (Math.random() - 0.5) * intensity * 0.2;
    }
  }
}
