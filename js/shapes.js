/**
 * SHAPES.JS - Modular Shape Architecture & Plugin Registry
 * OpenFishTools Studio - Decoupled vector shape pipeline
 * Loads and coordinates modular shape plugins from shapes/*.js
 */

(function(global) {
  'use strict';

  const registry = new Map();
  const aliasMap = new Map();

  const FishShapesRegistry = {
    /**
     * Register a new modular shape plugin definition
     * @param {Object} def - Shape plugin descriptor
     */
    register(def) {
      if (!def || !def.id) return;
      const descriptor = {
        id: def.id,
        aliases: Array.isArray(def.aliases) ? def.aliases : [],
        name: def.name || def.id,
        title: def.title || def.name || def.id,
        iconSvg: def.iconSvg || '<rect x="3" y="3" width="18" height="18" rx="2"/>',
        defaultProps: Object.assign({ sizeX: 300, sizeY: 300 }, def.defaultProps || {}),
        controls: Object.assign({
          size: true,
          roundness: false,
          step: false,
          star: false
        }, def.controls || {}),
        getContour: typeof def.getContour === 'function' ? def.getContour : null,
        drawPath: typeof def.drawPath === 'function' ? def.drawPath : null
      };

      registry.set(def.id, descriptor);
      aliasMap.set(def.id, def.id);

      if (Array.isArray(def.aliases)) {
        def.aliases.forEach(alias => {
          aliasMap.set(alias.toLowerCase(), def.id);
        });
      }
    },

    /**
     * Get a shape definition by its id or alias
     * @param {string} id
     * @returns {Object|null}
     */
    get(id) {
      if (!id) return null;
      const key = aliasMap.get(id.toLowerCase()) || id;
      return registry.get(key) || null;
    },

    /**
     * Get all registered unique shape definitions
     * @returns {Array<Object>}
     */
    getAll() {
      return Array.from(registry.values());
    },

    /**
     * Create default shape properties for a shape type
     * @param {string} shapeType
     * @returns {Object}
     */
    createDefaultProps(shapeType) {
      const def = this.get(shapeType);
      if (def && def.defaultProps) {
        return JSON.parse(JSON.stringify(def.defaultProps));
      }
      return { sizeX: 300, sizeY: 300 };
    },

    /**
     * Compute exact local 2D contour points for transform wireframes
     * @param {string} shapeType
     * @param {Object} shapeProps
     * @param {number} w
     * @param {number} h
     * @returns {Array<{x: number, y: number}>}
     */
    getContour(shapeType, shapeProps = {}, w = 300, h = 300) {
      const def = this.get(shapeType);
      const sx = Math.max(1, w);
      const sy = Math.max(1, h);
      if (def && typeof def.getContour === 'function') {
        const pts = def.getContour(shapeProps, sx, sy);
        if (Array.isArray(pts) && pts.length > 0) return pts;
      }
      // Fallback: standard rectangle bounding quad
      const rx = sx / 2;
      const ry = sy / 2;
      return [{ x: -rx, y: -ry }, { x: rx, y: -ry }, { x: rx, y: ry }, { x: -rx, y: ry }];
    },

    /**
     * Draw 2D canvas path for shape compositing
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} shapeType
     * @param {Object} shapeProps
     * @param {number} cx
     * @param {number} cy
     * @param {number} sx
     * @param {number} sy
     * @returns {boolean}
     */
    drawPath(ctx, shapeType, shapeProps = {}, cx = 0, cy = 0, sx = 300, sy = 300) {
      const def = this.get(shapeType);
      if (def && typeof def.drawPath === 'function') {
        def.drawPath(ctx, shapeProps, cx, cy, sx, sy);
        return true;
      }
      // Fallback: standard rectangle
      const rx = sx / 2;
      const ry = sy / 2;
      ctx.rect(cx - rx, cy - ry, sx, sy);
      return false;
    }
  };

  // Expose globally
  global.FishShapesRegistry = FishShapesRegistry;

})(typeof window !== 'undefined' ? window : globalThis);
