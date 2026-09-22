/**
 * OpenFishTools Studio — 3D Element Effect Plugin
 * Renders imported 3D models (GLTF/GLB) using Three.js,
 * synced to the project camera layer. Includes Scene Editor UI.
 *
 * Architecture: Effect → ThreeElementManager (isolated Three.js)
 *               → offscreen WebGL canvas → composited to 2D pipeline
 */
(function(window) {
  'use strict';
  const reg = (window && window.FishEffectsRegistry) || (typeof global !== 'undefined' && global.FishEffectsRegistry);
  if (!reg) return;

  // Per-instance manager cache: effectInstanceId → ThreeElementManager
  const managers = new Map();

  /**
   * Get or create ThreeElementManager for an effect instance
   */
  function getManager(fx, bounds) {
    const fxId = fx._instanceId || fx.id || 'default';
    let mgr = managers.get(fxId);
    if (!mgr || mgr.disposed) {
      mgr = new window.ThreeElementManager({
        width: bounds.w || 1080,
        height: bounds.h || 1920,
        antialias: fx.antiAlias !== false
      });
      managers.set(fxId, mgr);
    }
    return mgr;
  }

  /**
   * Find camera layer in current project
   */
  function findCameraLayer() {
    const proj = window.currentProjectState;
    if (!proj || !Array.isArray(proj.layers)) return null;
    return proj.layers.find(l => l.type === 'camera' && !l.hidden);
  }

  /**
   * Get effective camera props at time
   */
  function getCameraProps(camLayer, time) {
    if (typeof window.getLayerEffectivePropsAtTime === 'function') {
      return window.getLayerEffectivePropsAtTime(camLayer, time, null, null, false);
    }
    return camLayer;
  }

  reg.register({
    id: '3d-element',
    name: '3D Element',
    category: '3d',
    icon: 'assets/FXPH.svg',
    description: 'Import and render 3D models (GLTF/GLB) with PBR materials, lighting, and camera sync',
    params: [
      // Scene data (hidden — stores serialized scene state)
      { id: 'sceneData', label: 'Scene Data', type: 'hidden', default: '' },

      // Scene Editor button
      { id: 'sceneEditor', label: 'Scene Editor', type: 'button', buttonLabel: 'Open Scene Editor' },

      // Material overrides (keyframeable)
      { id: 'metalness',    label: 'Metalness',      type: 'number', default: 0.5,  min: 0, max: 1, step: 0.01 },
      { id: 'roughness',    label: 'Roughness',      type: 'number', default: 0.5,  min: 0, max: 1, step: 0.01 },
      { id: 'aoIntensity',  label: 'AO Intensity',   type: 'number', default: 1.0,  min: 0, max: 2, step: 0.01 },
      { id: 'envIntensity', label: 'Env Intensity',  type: 'number', default: 1.0,  min: 0, max: 3, step: 0.01 },

      // Transform offset
      { id: 'offsetX',    label: 'Offset X',    type: 'number', default: 0,   min: -2000, max: 2000 },
      { id: 'offsetY',    label: 'Offset Y',    type: 'number', default: 0,   min: -2000, max: 2000 },
      { id: 'offsetZ',    label: 'Offset Z',    type: 'number', default: 0,   min: -2000, max: 2000 },
      { id: 'modelScale', label: 'Model Scale', type: 'number', default: 100, min: 1, max: 1000, unit: '%' },

      // Lighting quick controls
      { id: 'ambientIntensity', label: 'Ambient',       type: 'number', default: 0.4,  min: 0, max: 2,   step: 0.01 },
      { id: 'ambientColor',     label: 'Ambient Color',  type: 'color',  default: '#ffffff' },
      { id: 'lightIntensity',   label: 'Light',          type: 'number', default: 1.0,  min: 0, max: 5,   step: 0.01 },
      { id: 'lightColor',       label: 'Light Color',    type: 'color',  default: '#ffffff' },
      { id: 'lightAngleX',      label: 'Light Angle X',  type: 'angle',  default: 45,   min: -180, max: 180 },
      { id: 'lightAngleY',      label: 'Light Angle Y',  type: 'angle',  default: 30,   min: -90,  max: 90 },

      // Render settings
      { id: 'alphaMode', label: 'Alpha', type: 'select', default: 'transparent',
        options: [
          { value: 'transparent', label: 'Transparent' },
          { value: 'opaque', label: 'Opaque' },
          { value: 'premultiplied', label: 'Premultiplied' }
        ]
      },
      { id: 'antiAlias', label: 'Anti-Alias', type: 'boolean', default: true }
    ],

    /**
     * Called when 'sceneEditor' button param is clicked
     */
    onButtonClick(paramId, fx, layer) {
      if (paramId === 'sceneEditor') {
        // Open Scene Editor floating window
        if (typeof window.SceneEditor !== 'undefined' && window.SceneEditor.open) {
          const mgr = getManager(fx, { w: 1080, h: 1920 });
          window.SceneEditor.open(fx, layer, mgr);
        } else {
          console.warn('3D Element: Scene Editor not loaded');
        }
      }
    },

    /**
     * Main render — composites Three.js output onto 2D canvas
     */
    async render(ctx, el, layer, bounds, fx, currentSec) {
      // Skip if no scene data and no models loaded
      const fxId = fx._instanceId || fx.id || 'default';
      let mgr = managers.get(fxId);

      // Lazy init manager
      if (!mgr) {
        // Check if Three.js and manager are available
        if (!window.ThreeElementManager) return;

        mgr = getManager(fx, bounds);

        // Try to init and deserialize scene data
        try {
          await mgr.init();
          if (fx.sceneData) {
            const sceneState = typeof fx.sceneData === 'string' ? JSON.parse(fx.sceneData) : fx.sceneData;
            if (sceneState && (sceneState.models?.length > 0 || sceneState.lights?.length > 0)) {
              await mgr.deserialize(sceneState, async (modelId) => {
                // Fetch model data from IndexedDB
                if (window.ThreeDB) {
                  await window.ThreeDB.init();
                  const record = await window.ThreeDB.getModel(modelId);
                  return record ? record.data : null;
                }
                return null;
              });
            }
          }
        } catch (e) {
          console.warn('3D Element: Init failed', e);
          return;
        }
      }

      if (!mgr.ready || mgr.models.size === 0) return;

      // Update material overrides from animated params
      mgr.updateMaterials({
        metalness: fx.metalness,
        roughness: fx.roughness,
        aoIntensity: fx.aoIntensity,
        envIntensity: fx.envIntensity
      });

      // Update lighting from animated params
      mgr.updateLighting({
        ambientIntensity: fx.ambientIntensity,
        ambientColor: fx.ambientColor,
        lightIntensity: fx.lightIntensity,
        lightColor: fx.lightColor,
        lightAngleX: fx.lightAngleX,
        lightAngleY: fx.lightAngleY
      });

      // Apply global transform offset to all models
      mgr.models.forEach((entry) => {
        const t = entry.transform;
        mgr.updateModelTransform(entry.id, {
          x: (t.x || 0) + (fx.offsetX || 0),
          y: (t.y || 0) + (fx.offsetY || 0),
          z: (t.z || 0) + (fx.offsetZ || 0),
          scale: (t.scale || 100) * ((fx.modelScale || 100) / 100)
        });
      });

      // Sync camera from project camera layer
      const camLayer = findCameraLayer();
      if (camLayer) {
        const camProps = getCameraProps(camLayer, currentSec);
        const proj = window.currentProjectState;
        mgr.syncCamera(camProps, proj?.width || 1080, proj?.height || 1920);
      }

      // Render Three.js scene
      const rendered = mgr.render(bounds.w, bounds.h);

      // Composite onto 2D canvas
      if (rendered) {
        ctx.drawImage(rendered, bounds.x, bounds.y, bounds.w, bounds.h);
      }
    },

    /**
     * Cleanup when effect is removed
     */
    onRemove(fx) {
      const fxId = fx._instanceId || fx.id || 'default';
      const mgr = managers.get(fxId);
      if (mgr) {
        mgr.dispose();
        managers.delete(fxId);
      }
    }
  });

})(typeof window !== 'undefined' ? window : this);
