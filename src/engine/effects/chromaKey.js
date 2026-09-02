import { BaseEffect } from './baseEffect.js';

export class ChromaKeyEffect extends BaseEffect {
  constructor() {
    super({
      id: 'chroma_key',
      name: 'Chroma Key (Green Screen)',
      category: 'Matte & Mask',
      params: {
        similarity: { label: 'effects.similarity', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
        smoothness: { label: 'effects.smoothness', type: 'range', min: 0, max: 1, step: 0.01, default: 0.08 }
      }
    });
  }

  apply(mesh, time, userParams = {}) {
    if (!mesh || !mesh.material) return;
    if (mesh.material.opacity !== undefined) {
      const sim = userParams.similarity !== undefined ? userParams.similarity : 0.4;
      mesh.material.transparent = true;
      mesh.material.opacity = Math.max(0.2, 1 - sim * 0.5);
    }
  }
}
