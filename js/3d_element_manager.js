/**
 * OpenFishTools Studio — 3D Element Manager (Isolated Three.js Controller)
 * Manages Three.js scene, renderer, camera, models, materials, and lighting.
 * One instance per 3D Element effect. Fully isolated from main engine.
 */
(function(window) {
  'use strict';

  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  /**
   * ThreeElementManager — encapsulated Three.js scene for one 3D Element effect instance.
   * @param {Object} opts - { width, height, antialias }
   */
  class ThreeElementManager {
    constructor(opts = {}) {
      this.ready = false;
      this.disposed = false;
      this._width = opts.width || 1080;
      this._height = opts.height || 1920;
      this._antialias = opts.antialias !== false;

      // Scene graph
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.orbitControls = null;

      // Model registry: Map<id, { mesh, name, transform, material }>
      this.models = new Map();
      // Light registry: Map<id, { light, type, params }>
      this.lights = new Map();

      // Environment
      this._envMap = null;
      this._envIntensity = 1.0;

      // Default HDRI path
      this._defaultHDRI = null;

      // Offscreen canvas for compositing
      this._offscreen = null;

      // Undo stack
      this._undoStack = [];
      this._redoStack = [];
      this._maxUndo = 50;
    }

    /**
     * Initialize Three.js (call after loadThreeJS resolves)
     */
    async init() {
      if (this.ready) return;
      if (!window.THREE) {
        if (typeof window.loadThreeJS === 'function') {
          await window.loadThreeJS();
        } else {
          throw new Error('Three.js not loaded. Include three-loader.js first.');
        }
      }

      const THREE = window.THREE;

      // Scene
      this.scene = new THREE.Scene();

      // Camera (default perspective angled looking down at floor grid, matching AE Element 3D)
      this.camera = new THREE.PerspectiveCamera(
        50, // FOV — will sync from project camera
        this._width / this._height,
        0.1,
        10000
      );
      this.camera.position.set(0, 240, 520);
      this.camera.lookAt(0, 30, 0);

      // Renderer (offscreen, transparent bg)
      this._offscreen = document.createElement('canvas');
      this._offscreen.width = this._width;
      this._offscreen.height = this._height;

      this.renderer = new THREE.WebGLRenderer({
        canvas: this._offscreen,
        alpha: true,
        antialias: this._antialias,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(this._width, this._height);
      this.renderer.setPixelRatio(1); // Use 1 for performance, composite handles DPR
      if (THREE.SRGBColorSpace) {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if (THREE.sRGBEncoding) {
        this.renderer.outputEncoding = THREE.sRGBEncoding;
      }
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;

      // Default lights
      this._addDefaultLights();

      // Floor Grid helper (for Scene Editor viewport — high contrast AE Element 3D style)
      this._gridHelper = new THREE.GridHelper(1400, 35, 0x98ce7b, 0x36432b);
      this._gridHelper.position.y = 0;
      this._gridHelper.visible = false; // Only visible in Scene Editor
      this.scene.add(this._gridHelper);

      // Subtle axes crosshair helper at origin
      this._axesHelper = new THREE.AxesHelper(120);
      this._axesHelper.position.y = 0.5;
      this._axesHelper.visible = false;
      this.scene.add(this._axesHelper);

      this.ready = true;
    }

    /**
     * Add default ambient + directional light
     */
    _addDefaultLights() {
      const THREE = window.THREE;

      // Ambient light
      const ambient = new THREE.AmbientLight(0xffffff, 0.4);
      this.scene.add(ambient);
      this.lights.set('__ambient', {
        light: ambient,
        type: 'ambient',
        params: { color: '#ffffff', intensity: 0.4 }
      });

      // Directional light (main key light)
      const dir = new THREE.DirectionalLight(0xffffff, 1.0);
      dir.position.set(1, 1, 0.5).normalize();
      this.scene.add(dir);
      this.lights.set('__directional', {
        light: dir,
        type: 'directional',
        params: { color: '#ffffff', intensity: 1.0, angleX: 45, angleY: 30 }
      });
    }

    /* ================================================================
       MODEL MANAGEMENT
       ================================================================ */

    /**
     * Load a GLTF/GLB model from ArrayBuffer
     * @param {string} id - Unique model ID (from IndexedDB)
     * @param {string} name - Display name
     * @param {ArrayBuffer} data - GLTF/GLB file data
     * @returns {Promise<Object>} Model entry { id, name, mesh, bounds }
     */
    async loadModel(id, name, data) {
      if (!this.ready) await this.init();
      const THREE = window.THREE;

      return new Promise((resolve, reject) => {
        const loader = new THREE.GLTFLoader();
        loader.parse(data, '', (gltf) => {
          const mesh = gltf.scene;
          mesh.name = name || id;

          // Auto-center and normalize scale
          const box = new THREE.Box3().setFromObject(mesh);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const scaleFactor = maxDim > 0 ? 200 / maxDim : 1; // Normalize to ~200 units

          mesh.position.sub(center); // Center at origin
          mesh.scale.multiplyScalar(scaleFactor);

          // Apply PBR defaults to all mesh materials
          mesh.traverse((child) => {
            if (child.isMesh && child.material) {
              const mat = child.material;
              if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                mat.envMapIntensity = this._envIntensity;
                if (this._envMap) mat.envMap = this._envMap;
              }
            }
          });

          this.scene.add(mesh);

          const entry = {
            id,
            name: name || id,
            mesh,
            bounds: { center: center.clone(), size: size.clone(), scaleFactor },
            transform: { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 100 },
            materialOverrides: {}
          };
          this.models.set(id, entry);
          resolve(entry);
        }, (err) => {
          reject(new Error(`Failed to load model "${name}": ${err.message || err}`));
        });
      });
    }

    /**
     * Remove model from scene
     * @param {string} id
     */
    removeModel(id) {
      const entry = this.models.get(id);
      if (!entry) return;
      this.scene.remove(entry.mesh);
      // Dispose geometry + materials
      entry.mesh.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      this.models.delete(id);
    }

    /**
     * Update model transform
     * @param {string} id
     * @param {Object} transform - { x, y, z, rotX, rotY, rotZ, scale (%) }
     */
    updateModelTransform(id, transform) {
      const entry = this.models.get(id);
      if (!entry || !entry.mesh) return;
      const t = Object.assign(entry.transform, transform);
      const posX = t.x !== undefined ? t.x : (t.posX || 0);
      const posY = t.y !== undefined ? t.y : (t.posY || 0);
      const posZ = t.z !== undefined ? t.z : (t.posZ || 0);
      m.position.set(posX, -posY, posZ); // Y-inverted for screen coords
      m.rotation.set(
        (t.rotX || 0) * DEG2RAD,
        (t.rotY || 0) * DEG2RAD,
        (t.rotZ || 0) * DEG2RAD
      );
      const scaleVal = t.scale !== undefined ? t.scale : (t.scaleX || 100);
      const factor = (entry.bounds && entry.bounds.scaleFactor) ? entry.bounds.scaleFactor : 1;
      const s = (scaleVal / 100) * factor;
      m.scale.set(s, s, s);
    }

    /* ================================================================
       MATERIAL MANAGEMENT
       ================================================================ */

    /**
     * Apply material overrides to all models (or specific model)
     * @param {Object} params - { metalness, roughness, aoIntensity, color, opacity }
     * @param {string} [modelId] - Optional specific model ID
     */
    updateMaterials(params, modelId) {
      const targets = modelId ? [this.models.get(modelId)] : [...this.models.values()];
      targets.forEach(entry => {
        if (!entry || !entry.mesh) return;
        entry.mesh.traverse((child) => {
          if (child.isMesh && child.material) {
            const mat = child.material;
            if (params.metalness !== undefined) mat.metalness = params.metalness;
            if (params.roughness !== undefined) mat.roughness = params.roughness;
            if (params.aoIntensity !== undefined) mat.aoMapIntensity = params.aoIntensity;
            if (params.color !== undefined && !mat._preserveColor) {
              mat.color.set(params.color);
            }
            if (params.opacity !== undefined) {
              mat.opacity = params.opacity;
              mat.transparent = params.opacity < 1.0;
            }
            if (params.envIntensity !== undefined) {
              mat.envMapIntensity = params.envIntensity;
            }
            mat.needsUpdate = true;
          }
        });
      });
    }

    /**
     * Set texture on model from layer canvas or image
     * @param {string} modelId
     * @param {string} mapType - 'map' | 'normalMap' | 'aoMap'
     * @param {HTMLCanvasElement|HTMLImageElement} source
     */
    setTexture(modelId, mapType, source) {
      if (!window.THREE) return;
      const entry = this.models.get(modelId);
      if (!entry) return;
      const THREE = window.THREE;
      const texture = new THREE.CanvasTexture(source);
      texture.flipY = false;
      if (THREE.SRGBColorSpace) {
        texture.colorSpace = THREE.SRGBColorSpace;
      } else if (THREE.sRGBEncoding) {
        texture.encoding = THREE.sRGBEncoding;
      }

      entry.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material[mapType] = texture;
          child.material.needsUpdate = true;
        }
      });
    }

    /* ================================================================
       LIGHTING
       ================================================================ */

    /**
     * Update lighting from effect params
     * @param {Object} params - { ambientIntensity, ambientColor, lightIntensity, lightColor, lightAngleX, lightAngleY }
     */
    updateLighting(params) {
      const ambient = this.lights.get('__ambient');
      if (ambient) {
        if (params.ambientIntensity !== undefined) ambient.light.intensity = params.ambientIntensity;
        if (params.ambientColor !== undefined) ambient.light.color.set(params.ambientColor);
      }

      const dir = this.lights.get('__directional');
      if (dir) {
        if (params.lightIntensity !== undefined) dir.light.intensity = params.lightIntensity;
        if (params.lightColor !== undefined) dir.light.color.set(params.lightColor);
        if (params.lightAngleX !== undefined || params.lightAngleY !== undefined) {
          const ax = ((params.lightAngleX !== undefined ? params.lightAngleX : dir.params.angleX) || 45) * DEG2RAD;
          const ay = ((params.lightAngleY !== undefined ? params.lightAngleY : dir.params.angleY) || 30) * DEG2RAD;
          dir.light.position.set(
            Math.cos(ay) * Math.sin(ax),
            Math.sin(ay),
            Math.cos(ay) * Math.cos(ax)
          ).normalize();
          dir.params.angleX = params.lightAngleX !== undefined ? params.lightAngleX : dir.params.angleX;
          dir.params.angleY = params.lightAngleY !== undefined ? params.lightAngleY : dir.params.angleY;
        }
      }
    }

    /**
     * Add a custom light
     * @param {string} type - 'point' | 'spot' | 'directional'
     * @param {Object} params
     * @returns {string} Light ID
     */
    addLight(type, params = {}) {
      if (!window.THREE) return null;
      const THREE = window.THREE;
      const id = 'light_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      let light;

      switch (type) {
        case 'point':
          light = new THREE.PointLight(params.color || 0xffffff, params.intensity || 1, params.distance || 0);
          light.position.set(params.x || 0, params.y || 200, params.z || 200);
          break;
        case 'spot':
          light = new THREE.SpotLight(params.color || 0xffffff, params.intensity || 1);
          light.position.set(params.x || 0, params.y || 300, params.z || 300);
          light.angle = (params.angle || 30) * DEG2RAD;
          break;
        case 'directional':
        default:
          light = new THREE.DirectionalLight(params.color || 0xffffff, params.intensity || 1);
          light.position.set(params.x || 1, params.y || 1, params.z || 0.5).normalize();
          break;
      }

      this.scene.add(light);
      this.lights.set(id, { light, type, params: { ...params } });
      return id;
    }

    /**
     * Remove a custom light
     * @param {string} id
     */
    removeLight(id) {
      const entry = this.lights.get(id);
      if (!entry) return;
      this.scene.remove(entry.light);
      if (entry.light.dispose) entry.light.dispose();
      this.lights.delete(id);
    }

    /* ================================================================
       ENVIRONMENT
       ================================================================ */

    /**
     * Set environment map from image/HDR
     * @param {HTMLImageElement|HTMLCanvasElement} image
     * @param {number} intensity
     */
    setEnvironment(image, intensity) {
      if (!window.THREE) return;
      const THREE = window.THREE;

      if (this._envMap) {
        this._envMap.dispose();
        this._envMap = null;
      }

      if (image) {
        const texture = new THREE.CanvasTexture(image);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        if (THREE.SRGBColorSpace) {
          texture.colorSpace = THREE.SRGBColorSpace;
        } else if (THREE.sRGBEncoding) {
          texture.encoding = THREE.sRGBEncoding;
        }
        this._envMap = texture;
        this._envIntensity = intensity !== undefined ? intensity : 1.0;
        this.scene.environment = texture;
      } else {
        this.scene.environment = null;
      }

      // Update all model materials
      this.models.forEach(entry => {
        entry.mesh.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.envMap = this._envMap;
            child.material.envMapIntensity = this._envIntensity;
            child.material.needsUpdate = true;
          }
        });
      });
    }

    /**
     * Load environment from file path or URL
     * @param {string} src - Image URL or data URL
     */
    async loadEnvironmentFromURL(src) {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this.setEnvironment(img, this._envIntensity);
          resolve(true);
        };
        img.onerror = () => {
          console.warn('3D Element: Failed to load environment map:', src);
          resolve(false);
        };
        img.src = src;
      });
    }

    /* ================================================================
       CAMERA SYNC
       ================================================================ */

    /**
     * Sync Three.js camera from FishTools project camera layer
     * @param {Object} camData - { posX, posY, posZ, rotX, rotY, rotZ, cameraLens, cameraZoom, fov }
     * @param {number} canvasW - Project canvas width
     * @param {number} canvasH - Project canvas height
     */
    syncCamera(camData, canvasW, canvasH) {
      if (!this.camera || !camData) return;

      // FOV from lens focal length (sensor height ≈ 24mm full-frame equivalent)
      const sensorH = 24;
      const lens = camData.cameraLens || 50;
      const fov = 2 * Math.atan(sensorH / (2 * lens)) * RAD2DEG;
      this.camera.fov = fov;

      // Position (Y inverted for screen → 3D coord system)
      this.camera.position.set(
        (camData.posX || 0) - (canvasW || 1080) / 2,
        -((camData.posY || 0) - (canvasH || 1920) / 2),
        (camData.posZ || 0) + 500
      );

      // Rotation
      this.camera.rotation.set(
        (camData.rotX || 0) * DEG2RAD,
        (camData.rotY || 0) * DEG2RAD,
        (camData.rotZ || 0) * DEG2RAD
      );

      // Zoom
      const zoom = (camData.cameraZoom || 100) / 100;
      this.camera.zoom = zoom;

      this.camera.aspect = (canvasW || 1080) / (canvasH || 1920);
      this.camera.updateProjectionMatrix();
    }

    /* ================================================================
       RENDERING
       ================================================================ */

    /**
     * Render scene to offscreen canvas
     * @param {number} width
     * @param {number} height
     * @returns {HTMLCanvasElement} The offscreen canvas with rendered 3D content
     */
    render(width, height) {
      if (!this.ready || !this.renderer) return this._offscreen;

      if (width !== this._width || height !== this._height) {
        this._width = width;
        this._height = height;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }

      // Hide grid and axes for compositing render
      if (this._gridHelper) this._gridHelper.visible = false;
      if (this._axesHelper) this._axesHelper.visible = false;
      this.renderer.render(this.scene, this.camera);
      return this._offscreen;
    }

    /**
     * Render with grid visible (for Scene Editor viewport)
     */
    renderForEditor(width, height) {
      if (!this.ready || !this.renderer) return this._offscreen;

      if (width !== this._width || height !== this._height) {
        this._width = width;
        this._height = height;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }

      if (this._gridHelper) this._gridHelper.visible = true;
      if (this._axesHelper) this._axesHelper.visible = true;
      this.renderer.render(this.scene, this.camera);
      return this._offscreen;
    }

    /**
     * Get the offscreen canvas for compositing
     */
    getCanvas() {
      return this._offscreen;
    }

    /* ================================================================
       SERIALIZATION
       ================================================================ */

    /**
     * Serialize scene state to JSON (for sceneData param)
     */
    serialize() {
      const data = {
        models: [],
        lights: [],
        environment: {
          intensity: this._envIntensity,
          hdriSrc: this._defaultHDRI || null
        }
      };

      this.models.forEach((entry, id) => {
        data.models.push({
          id,
          name: entry.name,
          primitive: entry.primitive || null,
          transform: { ...entry.transform },
          materialOverrides: { ...entry.materialOverrides }
        });
      });

      this.lights.forEach((entry, id) => {
        if (id.startsWith('__')) return; // Skip default lights
        data.lights.push({
          id,
          type: entry.type,
          params: { ...entry.params }
        });
      });

      return data;
    }

    /**
     * Restore scene state from serialized data
     * @param {Object} data - Serialized scene data
     * @param {Function} getModelData - async (modelId) => ArrayBuffer
     */
    async deserialize(data, getModelData) {
      if (!data) return;

      // Restore environment
      if (data.environment) {
        this._envIntensity = data.environment.intensity || 1.0;
        if (data.environment.hdriSrc) {
          this._defaultHDRI = data.environment.hdriSrc;
          await this.loadEnvironmentFromURL(data.environment.hdriSrc);
        }
      }

      // Restore models
      if (Array.isArray(data.models)) {
        for (const modelDef of data.models) {
          try {
            if (modelDef.primitive) {
              const primEntry = this.createPrimitive(modelDef.primitive, modelDef.name);
              if (primEntry) {
                // Re-key to preserved ID
                this.models.delete(primEntry.id);
                primEntry.id = modelDef.id;
                this.models.set(modelDef.id, primEntry);
                if (modelDef.transform) {
                  this.updateModelTransform(modelDef.id, modelDef.transform);
                }
                if (modelDef.materialOverrides) {
                  this.updateMaterials(modelDef.materialOverrides, modelDef.id);
                }
              }
            } else if (getModelData) {
              const modelData = await getModelData(modelDef.id);
              if (modelData) {
                await this.loadModel(modelDef.id, modelDef.name, modelData);
                if (modelDef.transform) {
                  this.updateModelTransform(modelDef.id, modelDef.transform);
                }
                if (modelDef.materialOverrides) {
                  this.updateMaterials(modelDef.materialOverrides, modelDef.id);
                }
              }
            }
          } catch (e) {
            console.warn('3D Element: Failed to restore model:', modelDef.name, e);
          }
        }
      }

      // Restore custom lights
      if (Array.isArray(data.lights)) {
        data.lights.forEach(lightDef => {
          this.addLight(lightDef.type, lightDef.params);
        });
      }
    }

    /* ================================================================
       UNDO / REDO
       ================================================================ */

    pushUndo() {
      const state = JSON.stringify(this.serialize());
      this._undoStack.push(state);
      if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
      this._redoStack.length = 0;
    }

    async undo(getModelData) {
      if (this._undoStack.length === 0) return;
      this._redoStack.push(JSON.stringify(this.serialize()));
      const state = JSON.parse(this._undoStack.pop());
      this._clearScene();
      await this.deserialize(state, getModelData);
    }

    async redo(getModelData) {
      if (this._redoStack.length === 0) return;
      this._undoStack.push(JSON.stringify(this.serialize()));
      const state = JSON.parse(this._redoStack.pop());
      this._clearScene();
      await this.deserialize(state, getModelData);
    }

    _clearScene() {
      // Remove all models
      [...this.models.keys()].forEach(id => this.removeModel(id));
      // Remove custom lights (keep defaults)
      [...this.lights.keys()].forEach(id => {
        if (!id.startsWith('__')) this.removeLight(id);
      });
    }

    /* ================================================================
       ORBIT CONTROLS (for Scene Editor)
       ================================================================ */

    /**
     * Enable orbit controls on a DOM element (Scene Editor viewport)
     * @param {HTMLElement} domElement
     */
    enableOrbitControls(domElement) {
      if (!window.THREE || !window.THREE.OrbitControls) return;
      if (this.orbitControls) this.orbitControls.dispose();
      this.orbitControls = new window.THREE.OrbitControls(this.camera, domElement);
      this.orbitControls.enableDamping = true;
      this.orbitControls.dampingFactor = 0.08;
      this.orbitControls.minDistance = 10;
      this.orbitControls.maxDistance = 6000;
      this.orbitControls.target.set(0, 30, 0);
      this.orbitControls.screenSpacePanning = true;
      this.orbitControls.update();
    }

    /**
     * Disable orbit controls
     */
    disableOrbitControls() {
      if (this.orbitControls) {
        this.orbitControls.dispose();
        this.orbitControls = null;
      }
    }

    /**
     * Update orbit controls (call in animation loop)
     */
    updateOrbitControls() {
      if (this.orbitControls) this.orbitControls.update();
    }

    /**
     * Reset camera to default AE perspective view
     */
    resetCamera() {
      if (!this.camera) return;
      this.camera.position.set(0, 240, 520);
      if (this.orbitControls) {
        this.orbitControls.target.set(0, 30, 0);
        this.orbitControls.update();
      } else {
        this.camera.lookAt(0, 30, 0);
      }
    }

    /**
     * Switch view perspective (Perspective, Top, Front, Right)
     */
    setViewMode(mode) {
      if (!this.camera) return;
      const dist = 550;
      switch (mode) {
        case 'front':
          this.camera.position.set(0, 30, dist);
          break;
        case 'top':
          this.camera.position.set(0, dist, 0.001);
          break;
        case 'right':
          this.camera.position.set(dist, 30, 0);
          break;
        case 'perspective':
        default:
          this.camera.position.set(0, 240, 520);
          break;
      }
      if (this.orbitControls) {
        this.orbitControls.target.set(0, 30, 0);
        this.orbitControls.update();
      } else {
        this.camera.lookAt(0, 30, 0);
      }
    }

    /**
     * Toggle wireframe shading mode for all meshes
     */
    setShadingMode(mode) {
      const isWire = (mode === 'wireframe');
      this.models.forEach(entry => {
        if (!entry.mesh) return;
        entry.mesh.traverse(child => {
          if (child.isMesh && child.material) {
            child.material.wireframe = isWire;
          }
        });
      });
    }

    /**
     * Quick lighting presets
     */
    setLightingPreset(preset) {
      const dirEntry = this.lights.get('__directional');
      const ambEntry = this.lights.get('__ambient');
      if (!dirEntry || !ambEntry) return;

      switch (preset) {
        case 'studio':
          ambEntry.light.intensity = 0.5;
          ambEntry.light.color.set(0xffffff);
          dirEntry.light.intensity = 1.2;
          dirEntry.light.color.set(0xfff5e6);
          dirEntry.light.position.set(2, 3, 2).normalize();
          break;
        case 'warm':
          ambEntry.light.intensity = 0.35;
          ambEntry.light.color.set(0xffe0b2);
          dirEntry.light.intensity = 1.3;
          dirEntry.light.color.set(0xffb74d);
          dirEntry.light.position.set(1.5, 2, 1).normalize();
          break;
        case 'single':
        default:
          ambEntry.light.intensity = 0.4;
          ambEntry.light.color.set(0xffffff);
          dirEntry.light.intensity = 1.0;
          dirEntry.light.color.set(0xffffff);
          dirEntry.light.position.set(1, 1, 0.5).normalize();
          break;
      }
    }

    /**
     * Create a 3D procedural primitive mesh (Box, Sphere, Cylinder, Plane, Torus)
     * @param {string} type - 'box' | 'sphere' | 'cylinder' | 'plane' | 'torus'
     * @param {string} [customName]
     */
    createPrimitive(type = 'box', customName = null) {
      if (!window.THREE || !this.scene) return null;
      const THREE = window.THREE;
      let geom;
      const defaultName = customName || (type.charAt(0).toUpperCase() + type.slice(1));

      switch (type) {
        case 'sphere':
          geom = new THREE.SphereGeometry(60, 32, 24);
          break;
        case 'cylinder':
          geom = new THREE.CylinderGeometry(50, 50, 100, 32);
          break;
        case 'plane':
          geom = new THREE.PlaneGeometry(140, 140);
          geom.rotateX(-Math.PI / 2);
          break;
        case 'torus':
          geom = new THREE.TorusGeometry(50, 18, 24, 48);
          break;
        case 'cone':
          geom = new THREE.ConeGeometry(50, 90, 32);
          break;
        case 'box':
        default:
          geom = new THREE.BoxGeometry(80, 80, 80);
          break;
      }

      const mat = new THREE.MeshStandardMaterial({
        color: 0x98ce7b,
        roughness: 0.35,
        metalness: 0.2,
        wireframe: false
      });

      const yPos = (type === 'plane' ? 0.5 : 50);
      mesh.position.set(0, yPos, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Calculate model bounding box and center
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const id = 'mesh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      this.scene.add(mesh);

      const entry = {
        id,
        name: defaultName,
        primitive: type,
        mesh,
        bounds: {
          center: center.clone(),
          size: size.clone(),
          scaleFactor: 1.0
        },
        transform: {
          x: 0, y: yPos, z: 0,
          posX: 0, posY: yPos, posZ: 0,
          rotX: 0, rotY: 0, rotZ: 0,
          scale: 100,
          scaleX: 100, scaleY: 100, scaleZ: 100
        },
        materialOverrides: {
          color: '#98ce7b',
          roughness: 0.35,
          metalness: 0.2,
          wireframe: false,
          opacity: 1
        }
      };

      this.models.set(id, entry);
      this.pushUndo();
      return entry;
    }

    /* ================================================================
       CLEANUP
       ================================================================ */

    /**
     * Dispose all GPU resources
     */
    dispose() {
      if (this.disposed) return;
      this.disposed = true;

      this.disableOrbitControls();
      this._clearScene();

      // Dispose default lights
      this.lights.forEach(entry => {
        this.scene.remove(entry.light);
        if (entry.light.dispose) entry.light.dispose();
      });
      this.lights.clear();

      // Dispose environment
      if (this._envMap) {
        this._envMap.dispose();
        this._envMap = null;
      }

      // Dispose grid
      if (this._gridHelper) {
        this.scene.remove(this._gridHelper);
        this._gridHelper.geometry?.dispose();
        this._gridHelper.material?.dispose();
        this._gridHelper = null;
      }

      // Dispose renderer
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer = null;
      }

      this.scene = null;
      this.camera = null;
      this._offscreen = null;
      this.ready = false;
    }
  }

  // Export
  window.ThreeElementManager = ThreeElementManager;

})(typeof window !== 'undefined' ? window : this);
