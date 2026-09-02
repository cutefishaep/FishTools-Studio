export class BaseEffect {
  constructor(config = {}) {
    this.id = config.id || 'custom_effect';
    this.name = config.name || 'Custom Effect';
    this.category = config.category || 'General';
    this.params = config.params || {};
  }

  getDefaultParams() {
    const defaults = {};
    for (const [key, prop] of Object.entries(this.params)) {
      defaults[key] = prop.default !== undefined ? prop.default : 0;
    }
    return defaults;
  }

  apply(mesh, time, userParams = {}) {
    return mesh;
  }

  dispose() {}
}
