/**
 * OpenFishTools Studio — Scene Editor (Floating Window Controller)
 * Full-featured 3D scene editor for the "3D Element" effect.
 * Provides: 3D viewport, scene hierarchy, properties editor, model import, undo/redo.
 *
 * Opens as a draggable, resizable floating window with resizable internal panels.
 * Confirm dialog on close rendered inside the window.
 */
(function(window) {
  'use strict';

  /* ================================================================
     SCENE EDITOR SINGLETON
     ================================================================ */
  const SceneEditor = {
    isOpen: false,
    _fx: null,          // Current effect instance
    _layer: null,       // Current layer
    _mgr: null,         // ThreeElementManager
    _dirty: false,      // Unsaved changes flag
    _selectedId: null,  // Selected scene item ID
    _animFrame: null,   // Animation frame ID

    // DOM references (cached after first build)
    _overlay: null,
    _window: null,
    _viewport: null,
    _viewportCanvas: null,
    _sceneTree: null,
    _propsPanel: null,
    _confirmEl: null,
    _built: false,

    /* ================================================================
       OPEN / CLOSE
       ================================================================ */

    /**
     * Open Scene Editor for an effect instance
     * @param {Object} fx - Effect params object
     * @param {Object} layer - Parent layer
     * @param {ThreeElementManager} mgr - Three.js manager
     */
    async open(fx, layer, mgr) {
      if (this.isOpen) return;

      this._fx = fx;
      this._layer = layer;
      this._mgr = mgr;
      this._dirty = false;
      this._selectedId = null;

      // Build DOM if first time
      if (!this._built) {
        this._buildDOM();
        this._built = true;
      }

      // Init manager if needed
      if (!mgr.ready) {
        await mgr.init();
        // Deserialize existing scene data
        if (fx.sceneData) {
          try {
            const state = typeof fx.sceneData === 'string' ? JSON.parse(fx.sceneData) : fx.sceneData;
            if (state) {
              await mgr.deserialize(state, async (modelId) => {
                if (window.ThreeDB) {
                  await window.ThreeDB.init();
                  const rec = await window.ThreeDB.getModel(modelId);
                  return rec ? rec.data : null;
                }
                return null;
              });
            }
          } catch (e) {
            console.warn('Scene Editor: Failed to deserialize scene', e);
          }
        }

        // Load default HDRI if no environment set
        if (!mgr._envMap) {
          const defaultHDRI = 'assets/env/default_env.jpg';
          await mgr.loadEnvironmentFromURL(defaultHDRI);
        }
      }

      // Enable orbit controls on viewport canvas
      mgr.enableOrbitControls(this._viewportCanvas);

      // Show window
      this._overlay.classList.add('is-active');
      this.isOpen = true;

      // Push history state for back-button close
      history.pushState({ sceneEditorOpen: true }, '');

      // Start render loop
      this._startRenderLoop();

      // Refresh panels
      this._refreshSceneTree();
      this._refreshProperties();
    },

    /**
     * Close Scene Editor
     * @param {boolean} skipConfirm - Skip confirmation dialog
     * @param {boolean} save - Save changes on close
     */
    close(skipConfirm, save) {
      if (!this.isOpen) return;

      if (this._dirty && !skipConfirm) {
        this._showConfirm();
        return;
      }

      if (save && this._mgr && this._fx) {
        // Serialize scene state to effect param
        const serialized = this._mgr.serialize();
        this._fx.sceneData = JSON.stringify(serialized);

        // Trigger save
        if (typeof window.saveCurrentProjectLayers === 'function') {
          window.saveCurrentProjectLayers(true);
        }
        if (typeof window.redrawComposition === 'function') {
          window.redrawComposition();
        }
      }

      // Disable orbit controls
      if (this._mgr) {
        this._mgr.disableOrbitControls();
      }

      // Stop render loop
      this._stopRenderLoop();

      // Hide window
      this._overlay.classList.remove('is-active');
      this._hideConfirm();
      this.isOpen = false;

      // Pop history state
      try { history.back(); } catch (_) {}

      // Clear references
      this._fx = null;
      this._layer = null;
      this._selectedId = null;
    },

    /* ================================================================
       DOM CONSTRUCTION
       ================================================================ */

    _buildDOM() {
      // Create overlay + window
      const overlay = document.createElement('div');
      overlay.className = 'scene-editor-overlay';
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) this.close(false, false);
      });

      const win = document.createElement('div');
      win.className = 'scene-editor-window';
      overlay.appendChild(win);

      // === Title bar ===
      const titlebar = document.createElement('div');
      titlebar.className = 'scene-editor-titlebar';
      titlebar.innerHTML = `
        <span class="scene-editor-title">Scene Editor — 3D Element</span>
        <button class="scene-editor-close" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      `;
      win.appendChild(titlebar);
      this._initDrag(titlebar, win);

      titlebar.querySelector('.scene-editor-close').addEventListener('click', () => {
        this.close(false, false);
      });

      // === Toolbar ===
      const toolbar = document.createElement('div');
      toolbar.className = 'scene-editor-toolbar';
      toolbar.innerHTML = `
        <button class="se-tool-btn" data-action="import">Import</button>
        <span class="se-tool-sep"></span>
        <button class="se-tool-btn" data-action="undo">Undo</button>
        <button class="se-tool-btn" data-action="redo">Redo</button>
        <span class="se-tool-sep"></span>
        <button class="se-tool-btn" data-action="add-light">Add Light</button>
        <span class="se-tool-sep"></span>
        <span style="flex:1"></span>
        <button class="se-tool-btn" data-action="cancel">Cancel</button>
        <button class="se-tool-btn is-primary" data-action="apply">Apply</button>
      `;
      win.appendChild(toolbar);
      this._bindToolbar(toolbar);

      // === Body (viewport + sidebar) ===
      const body = document.createElement('div');
      body.className = 'scene-editor-body';

      // Viewport
      const viewport = document.createElement('div');
      viewport.className = 'scene-editor-viewport';
      viewport.innerHTML = `
        <div class="se-viewport-header">
          <select class="se-viewport-dropdown" data-prop="view">
            <option value="perspective">Perspective</option>
            <option value="front">Front</option>
            <option value="top">Top</option>
            <option value="right">Right</option>
          </select>
          <select class="se-viewport-dropdown" data-prop="render">
            <option value="shaded">Shaded</option>
            <option value="wireframe">Wireframe</option>
          </select>
        </div>
        <div class="se-viewport-empty">No Model</div>
        <canvas class="se-viewport-canvas"></canvas>
      `;
      body.appendChild(viewport);
      this._viewport = viewport;
      this._viewportCanvas = viewport.querySelector('.se-viewport-canvas');

      // Viewport view mode handlers
      viewport.querySelector('[data-prop="render"]').addEventListener('change', (e) => {
        if (!this._mgr) return;
        const wireframe = e.target.value === 'wireframe';
        this._mgr.models.forEach(entry => {
          entry.mesh.traverse(child => {
            if (child.isMesh && child.material) {
              child.material.wireframe = wireframe;
            }
          });
        });
      });

      // Vertical splitter
      const vsplit = document.createElement('div');
      vsplit.className = 'scene-editor-vsplit';
      body.appendChild(vsplit);
      this._initPanelResize(vsplit, 'vertical', viewport, null);

      // Sidebar
      const sidebar = document.createElement('div');
      sidebar.className = 'scene-editor-sidebar';

      // Scene panel
      const scenePanel = document.createElement('div');
      scenePanel.className = 'scene-editor-scene';
      scenePanel.innerHTML = `
        <div class="se-panel-header">Scene</div>
        <div class="se-scene-tree"></div>
      `;
      sidebar.appendChild(scenePanel);
      this._sceneTree = scenePanel.querySelector('.se-scene-tree');

      // Horizontal splitter
      const hsplit = document.createElement('div');
      hsplit.className = 'scene-editor-hsplit';
      sidebar.appendChild(hsplit);
      this._initPanelResize(hsplit, 'horizontal', scenePanel, null);

      // Properties panel
      const propsPanel = document.createElement('div');
      propsPanel.className = 'scene-editor-props';
      propsPanel.innerHTML = `
        <div class="se-panel-header">Properties</div>
        <div class="se-props-content">
          <div class="se-viewport-empty" style="padding:20px">No Selection</div>
        </div>
      `;
      sidebar.appendChild(propsPanel);
      this._propsPanel = propsPanel.querySelector('.se-props-content');

      body.appendChild(sidebar);
      win.appendChild(body);

      // Store splitter sidebar reference for resize
      this._sidebar = sidebar;
      this._initPanelResize(vsplit, 'vertical', viewport, sidebar);

      // === Confirm dialog (inside window) ===
      const confirm = document.createElement('div');
      confirm.className = 'scene-editor-confirm';
      confirm.innerHTML = `
        <div class="se-confirm-card">
          <div class="se-confirm-title">Confirm</div>
          <div class="se-confirm-msg">Discard unsaved scene changes?</div>
          <div class="se-confirm-actions">
            <button class="se-confirm-btn is-danger" data-action="discard">Discard</button>
            <button class="se-confirm-btn is-safe" data-action="keep">Keep Editing</button>
          </div>
        </div>
      `;
      win.appendChild(confirm);
      this._confirmEl = confirm;

      confirm.querySelector('[data-action="discard"]').addEventListener('click', () => {
        this._dirty = false;
        this.close(true, false);
      });
      confirm.querySelector('[data-action="keep"]').addEventListener('click', () => {
        this._hideConfirm();
      });

      // Append to document
      document.body.appendChild(overlay);
      this._overlay = overlay;
      this._window = win;

      // Popstate listener for back button
      window.addEventListener('popstate', (e) => {
        if (this.isOpen) {
          this.close(false, false);
        }
      });
    },

    /* ================================================================
       TOOLBAR ACTIONS
       ================================================================ */

    _bindToolbar(toolbar) {
      toolbar.addEventListener('click', async (e) => {
        const btn = e.target.closest('.se-tool-btn');
        if (!btn) return;
        const action = btn.dataset.action;

        switch (action) {
          case 'import':
            await this._importModel();
            break;
          case 'undo':
            if (this._mgr) {
              await this._mgr.undo(async (id) => {
                if (window.ThreeDB) {
                  await window.ThreeDB.init();
                  const rec = await window.ThreeDB.getModel(id);
                  return rec ? rec.data : null;
                }
                return null;
              });
              this._refreshSceneTree();
              this._refreshProperties();
            }
            break;
          case 'redo':
            if (this._mgr) {
              await this._mgr.redo(async (id) => {
                if (window.ThreeDB) {
                  await window.ThreeDB.init();
                  const rec = await window.ThreeDB.getModel(id);
                  return rec ? rec.data : null;
                }
                return null;
              });
              this._refreshSceneTree();
              this._refreshProperties();
            }
            break;
          case 'add-light':
            if (this._mgr) {
              this._mgr.pushUndo();
              this._mgr.addLight('point', {
                color: '#ffffff',
                intensity: 1.0,
                x: 0, y: 200, z: 200
              });
              this._dirty = true;
              this._refreshSceneTree();
            }
            break;
          case 'cancel':
            this.close(false, false);
            break;
          case 'apply':
            this.close(true, true);
            break;
        }
      });
    },

    /* ================================================================
       MODEL IMPORT
       ================================================================ */

    async _importModel() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.glb,.gltf';
      input.multiple = true;

      input.addEventListener('change', async () => {
        if (!input.files || input.files.length === 0) return;
        if (!this._mgr) return;

        // Init IndexedDB
        if (window.ThreeDB) await window.ThreeDB.init();

        this._mgr.pushUndo();

        for (const file of input.files) {
          try {
            // Save to IndexedDB
            let modelRecord = null;
            if (window.ThreeDB) {
              modelRecord = await window.ThreeDB.saveModel(file);
            }
            const modelId = modelRecord ? modelRecord.id : ('m_' + Date.now());
            const modelName = file.name.replace(/\.(glb|gltf)$/i, '');

            // Read file data
            const data = await file.arrayBuffer();

            // Load into Three.js scene
            await this._mgr.loadModel(modelId, modelName, data);

            this._dirty = true;
          } catch (err) {
            console.error('Scene Editor: Failed to import model', file.name, err);
          }
        }

        // Update viewport empty state
        const emptyLabel = this._viewport.querySelector('.se-viewport-empty');
        if (emptyLabel) emptyLabel.style.display = this._mgr.models.size > 0 ? 'none' : '';

        this._refreshSceneTree();
      });

      input.click();
    },

    /* ================================================================
       SCENE TREE
       ================================================================ */

    _refreshSceneTree() {
      if (!this._sceneTree || !this._mgr) return;
      this._sceneTree.innerHTML = '';

      // Models
      this._mgr.models.forEach((entry, id) => {
        const item = document.createElement('div');
        item.className = 'se-scene-item' + (this._selectedId === id ? ' is-selected' : '');
        item.dataset.id = id;
        item.dataset.type = 'model';
        item.innerHTML = `
          <svg class="se-scene-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span>${entry.name}</span>
        `;
        item.addEventListener('click', () => {
          this._selectedId = id;
          this._selectedType = 'model';
          this._refreshSceneTree();
          this._refreshProperties();
        });

        // Right-click to delete
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (confirm('Remove model "' + entry.name + '"?')) {
            this._mgr.pushUndo();
            this._mgr.removeModel(id);
            if (window.ThreeDB) window.ThreeDB.deleteModel(id);
            this._dirty = true;
            if (this._selectedId === id) {
              this._selectedId = null;
              this._selectedType = null;
            }
            this._refreshSceneTree();
            this._refreshProperties();
          }
        });

        this._sceneTree.appendChild(item);
      });

      // Lights (custom only)
      this._mgr.lights.forEach((entry, id) => {
        if (id.startsWith('__')) return;
        const item = document.createElement('div');
        item.className = 'se-scene-item' + (this._selectedId === id ? ' is-selected' : '');
        item.dataset.id = id;
        item.dataset.type = 'light';
        item.innerHTML = `
          <svg class="se-scene-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          <span>${entry.type} light</span>
        `;
        item.addEventListener('click', () => {
          this._selectedId = id;
          this._selectedType = 'light';
          this._refreshSceneTree();
          this._refreshProperties();
        });
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this._mgr.pushUndo();
          this._mgr.removeLight(id);
          this._dirty = true;
          if (this._selectedId === id) {
            this._selectedId = null;
            this._selectedType = null;
          }
          this._refreshSceneTree();
          this._refreshProperties();
        });
        this._sceneTree.appendChild(item);
      });

      // Update empty label
      const emptyLabel = this._viewport?.querySelector('.se-viewport-empty');
      if (emptyLabel) emptyLabel.style.display = this._mgr.models.size > 0 ? 'none' : '';
    },

    /* ================================================================
       PROPERTIES PANEL
       ================================================================ */

    _refreshProperties() {
      if (!this._propsPanel) return;

      if (!this._selectedId) {
        this._propsPanel.innerHTML = '<div class="se-viewport-empty" style="padding:20px">No Selection</div>';
        return;
      }

      if (this._selectedType === 'model') {
        this._renderModelProperties();
      } else if (this._selectedType === 'light') {
        this._renderLightProperties();
      }
    },

    _renderModelProperties() {
      const entry = this._mgr.models.get(this._selectedId);
      if (!entry) return;
      const t = entry.transform;

      this._propsPanel.innerHTML = `
        <div class="se-prop-group">
          <div class="se-prop-group-title">Transform</div>
          ${this._propRow('Position X', t.x || 0, 'tx')}
          ${this._propRow('Position Y', t.y || 0, 'ty')}
          ${this._propRow('Position Z', t.z || 0, 'tz')}
          ${this._propRow('Rotation X', t.rotX || 0, 'rx', '°')}
          ${this._propRow('Rotation Y', t.rotY || 0, 'ry', '°')}
          ${this._propRow('Rotation Z', t.rotZ || 0, 'rz', '°')}
          ${this._propRow('Scale', t.scale || 100, 'sc', '%')}
        </div>
        <div class="se-prop-group">
          <div class="se-prop-group-title">Material</div>
          ${this._propSlider('Metalness', 0.5, 'metalness', 0, 1)}
          ${this._propSlider('Roughness', 0.5, 'roughness', 0, 1)}
          ${this._propSlider('AO Intensity', 1.0, 'aoIntensity', 0, 2)}
        </div>
        <div class="se-prop-group">
          <div class="se-prop-group-title">Texture</div>
          ${this._texturePicker('Diffuse', 'map')}
        </div>
      `;

      this._bindPropertyInputs();
    },

    _renderLightProperties() {
      const entry = this._mgr.lights.get(this._selectedId);
      if (!entry) return;
      const p = entry.params;

      this._propsPanel.innerHTML = `
        <div class="se-prop-group">
          <div class="se-prop-group-title">${entry.type} Light</div>
          ${this._propSlider('Intensity', p.intensity || 1, 'intensity', 0, 5)}
          ${this._propRow('Position X', p.x || 0, 'lx')}
          ${this._propRow('Position Y', p.y || 0, 'ly')}
          ${this._propRow('Position Z', p.z || 0, 'lz')}
        </div>
      `;

      this._bindPropertyInputs();
    },

    _propRow(label, value, key, suffix) {
      return `
        <div class="se-prop-row">
          <span class="se-prop-label">${label}</span>
          <span class="se-prop-value" data-key="${key}" data-suffix="${suffix || ''}" title="Drag to scrub, click to edit">${Number(value).toFixed(1)}${suffix || ''}</span>
        </div>
      `;
    },

    _propSlider(label, value, key, min, max) {
      const pct = ((value - min) / (max - min)) * 100;
      return `
        <div class="se-prop-row">
          <span class="se-prop-label">${label}</span>
          <div class="se-prop-slider" data-key="${key}" data-min="${min}" data-max="${max}">
            <div class="se-prop-slider-fill" style="width:${pct}%"></div>
            <div class="se-prop-slider-thumb" style="left:${pct}%"></div>
          </div>
          <span class="se-prop-value" data-key="${key}" style="width:40px;text-align:right">${value.toFixed(2)}</span>
        </div>
      `;
    },

    _texturePicker(label, mapType) {
      // Build layer options for "link to layer" dropdown
      let layerOpts = '<option value="">None</option><option value="__upload">Upload Image...</option>';
      const proj = window.currentProjectState;
      if (proj && Array.isArray(proj.layers)) {
        proj.layers.forEach(l => {
          if (l.type !== 'camera' && l.type !== 'audio') {
            layerOpts += `<option value="layer:${l.id}">${l.name || l.id}</option>`;
          }
        });
      }

      return `
        <div class="se-prop-row">
          <span class="se-prop-label">${label}</span>
          <select class="se-prop-select" data-key="texture_${mapType}">
            ${layerOpts}
          </select>
        </div>
      `;
    },

    _bindPropertyInputs() {
      if (!this._propsPanel) return;

      // Scrub values
      this._propsPanel.querySelectorAll('.se-prop-value[data-key]').forEach(el => {
        let startX = 0;
        let startVal = 0;
        let dragging = false;

        el.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          startX = e.clientX;
          startVal = parseFloat(el.textContent) || 0;
          dragging = false;

          if (this._mgr) this._mgr.pushUndo();

          const onMove = (ev) => {
            const dx = ev.clientX - startX;
            if (Math.abs(dx) > 2) dragging = true;
            const newVal = startVal + dx * 0.5;
            const suffix = el.dataset.suffix || '';
            el.textContent = newVal.toFixed(1) + suffix;
            this._applyPropertyChange(el.dataset.key, newVal);
          };

          const onUp = () => {
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            if (!dragging) {
              // Click to edit — show inline input
              this._inlineEdit(el);
            }
          };

          el.addEventListener('pointermove', onMove);
          el.addEventListener('pointerup', onUp);
        });
      });

      // Sliders
      this._propsPanel.querySelectorAll('.se-prop-slider[data-key]').forEach(slider => {
        const key = slider.dataset.key;
        const min = parseFloat(slider.dataset.min) || 0;
        const max = parseFloat(slider.dataset.max) || 1;
        const fill = slider.querySelector('.se-prop-slider-fill');
        const thumb = slider.querySelector('.se-prop-slider-thumb');
        const valEl = this._propsPanel.querySelector(`.se-prop-value[data-key="${key}"]`);

        const update = (clientX) => {
          const rect = slider.getBoundingClientRect();
          let pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          const val = min + pct * (max - min);
          fill.style.width = (pct * 100) + '%';
          thumb.style.left = (pct * 100) + '%';
          if (valEl) valEl.textContent = val.toFixed(2);
          this._applyPropertyChange(key, val);
        };

        slider.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          slider.setPointerCapture(e.pointerId);
          if (this._mgr) this._mgr.pushUndo();
          update(e.clientX);

          const onMove = (ev) => update(ev.clientX);
          const onUp = () => {
            slider.removeEventListener('pointermove', onMove);
            slider.removeEventListener('pointerup', onUp);
          };
          slider.addEventListener('pointermove', onMove);
          slider.addEventListener('pointerup', onUp);
        });
      });

      // Texture select
      this._propsPanel.querySelectorAll('.se-prop-select[data-key]').forEach(sel => {
        sel.addEventListener('change', async () => {
          const val = sel.value;
          const mapType = sel.dataset.key.replace('texture_', '');

          if (val === '__upload') {
            // File upload
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.addEventListener('change', () => {
              if (!input.files[0]) return;
              const img = new Image();
              img.onload = () => {
                this._mgr.setTexture(this._selectedId, mapType, img);
                this._dirty = true;
              };
              img.src = URL.createObjectURL(input.files[0]);
            });
            input.click();
          } else if (val.startsWith('layer:')) {
            // Link to layer — render that layer to canvas and use as texture
            const layerId = val.replace('layer:', '');
            // This would require rendering the layer to an offscreen canvas
            // For now, mark as TODO
            console.log('Scene Editor: Link to layer texture —', layerId);
            this._dirty = true;
          } else {
            // Clear texture
            if (this._selectedId && this._mgr) {
              this._mgr.setTexture(this._selectedId, mapType, null);
              this._dirty = true;
            }
          }
        });
      });
    },

    _applyPropertyChange(key, value) {
      if (!this._mgr || !this._selectedId) return;
      this._dirty = true;

      if (this._selectedType === 'model') {
        const entry = this._mgr.models.get(this._selectedId);
        if (!entry) return;
        const t = entry.transform;

        switch (key) {
          case 'tx': t.x = value; break;
          case 'ty': t.y = value; break;
          case 'tz': t.z = value; break;
          case 'rx': t.rotX = value; break;
          case 'ry': t.rotY = value; break;
          case 'rz': t.rotZ = value; break;
          case 'sc': t.scale = value; break;
          case 'metalness':
          case 'roughness':
          case 'aoIntensity':
            this._mgr.updateMaterials({ [key]: value }, this._selectedId);
            return;
        }
        this._mgr.updateModelTransform(this._selectedId, t);
      } else if (this._selectedType === 'light') {
        const entry = this._mgr.lights.get(this._selectedId);
        if (!entry) return;

        switch (key) {
          case 'intensity': entry.light.intensity = value; entry.params.intensity = value; break;
          case 'lx': entry.light.position.x = value; entry.params.x = value; break;
          case 'ly': entry.light.position.y = value; entry.params.y = value; break;
          case 'lz': entry.light.position.z = value; entry.params.z = value; break;
        }
      }
    },

    _inlineEdit(el) {
      const current = parseFloat(el.textContent) || 0;
      const suffix = el.dataset.suffix || '';
      const input = document.createElement('input');
      input.type = 'number';
      input.value = current;
      input.style.cssText = 'width:100%;height:100%;background:var(--bg-panel-inner);color:var(--text-primary);border:1px solid var(--color-primary);border-radius:2px;font:inherit;font-size:11px;padding:0 4px;outline:none;';
      el.textContent = '';
      el.appendChild(input);
      input.focus();
      input.select();

      const commit = () => {
        const val = parseFloat(input.value) || 0;
        el.textContent = val.toFixed(1) + suffix;
        this._applyPropertyChange(el.dataset.key, val);
      };

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { commit(); input.blur(); }
        if (e.key === 'Escape') { el.textContent = current.toFixed(1) + suffix; }
      });
    },

    /* ================================================================
       RENDER LOOP (Scene Editor viewport)
       ================================================================ */

    _startRenderLoop() {
      const loop = () => {
        if (!this.isOpen || !this._mgr || !this._viewportCanvas) return;
        this._animFrame = requestAnimationFrame(loop);

        // Update orbit controls
        this._mgr.updateOrbitControls();

        // Render to viewport canvas
        const rect = this._viewport.getBoundingClientRect();
        const w = Math.floor(rect.width) || 800;
        const h = Math.floor(rect.height) || 600;

        const rendered = this._mgr.renderForEditor(w, h);
        if (rendered && rendered !== this._viewportCanvas) {
          // Copy to display canvas
          this._viewportCanvas.width = w;
          this._viewportCanvas.height = h;
          const ctx = this._viewportCanvas.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(rendered, 0, 0, w, h);
        }
      };
      this._animFrame = requestAnimationFrame(loop);
    },

    _stopRenderLoop() {
      if (this._animFrame) {
        cancelAnimationFrame(this._animFrame);
        this._animFrame = null;
      }
    },

    /* ================================================================
       PANEL RESIZE (SPLITTER HANDLES)
       ================================================================ */

    _initPanelResize(splitter, direction, panelA, panelB) {
      let startPos = 0;
      let startSizeA = 0;
      let startSizeB = 0;

      splitter.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        splitter.setPointerCapture(e.pointerId);

        const parentRect = splitter.parentElement.getBoundingClientRect();
        const parentSize = direction === 'vertical' ? parentRect.width : parentRect.height;

        if (direction === 'vertical') {
          startPos = e.clientX;
          startSizeA = panelA ? panelA.getBoundingClientRect().width : parentSize * 0.65;
          startSizeB = panelB ? panelB.getBoundingClientRect().width : parentSize * 0.35;
        } else {
          startPos = e.clientY;
          startSizeA = panelA ? panelA.getBoundingClientRect().height : parentSize * 0.5;
          startSizeB = panelB ? panelB.offsetHeight : parentSize * 0.5;
        }

        const onMove = (ev) => {
          const delta = direction === 'vertical' ? (ev.clientX - startPos) : (ev.clientY - startPos);
          const newA = startSizeA + delta;
          const newB = startSizeB - delta;
          const min = parentSize * 0.2;
          const max = parentSize * 0.8;

          if (newA < min || newA > max) return;

          if (direction === 'vertical') {
            if (panelA) panelA.style.width = newA + 'px';
            if (panelA) panelA.style.flex = 'none';
            if (panelB) panelB.style.width = newB + 'px';
          } else {
            if (panelA) panelA.style.height = newA + 'px';
            if (panelA) panelA.style.flex = 'none';
          }
        };

        const onUp = () => {
          splitter.removeEventListener('pointermove', onMove);
          splitter.removeEventListener('pointerup', onUp);
        };

        splitter.addEventListener('pointermove', onMove);
        splitter.addEventListener('pointerup', onUp);
      });
    },

    /* ================================================================
       WINDOW DRAG
       ================================================================ */

    _initDrag(handle, win) {
      let startX = 0, startY = 0;
      let winX = 0, winY = 0;

      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.scene-editor-close')) return;
        if (e.button !== 0) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        handle.style.cursor = 'grabbing';

        startX = e.clientX;
        startY = e.clientY;

        const style = getComputedStyle(win);
        winX = parseInt(style.left) || 0;
        winY = parseInt(style.top) || 0;

        // If window was centered via transform, compute actual position
        if (!win.style.left || win.style.left === 'auto') {
          const rect = win.getBoundingClientRect();
          winX = rect.left;
          winY = rect.top;
          win.style.position = 'fixed';
          win.style.left = winX + 'px';
          win.style.top = winY + 'px';
          win.style.transform = 'none';
        }

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          win.style.left = (winX + dx) + 'px';
          win.style.top = (winY + dy) + 'px';
        };

        const onUp = () => {
          handle.style.cursor = '';
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
      });
    },

    /* ================================================================
       CONFIRM DIALOG
       ================================================================ */

    _showConfirm() {
      if (this._confirmEl) this._confirmEl.style.display = 'flex';
    },

    _hideConfirm() {
      if (this._confirmEl) this._confirmEl.style.display = '';
    }
  };

  // Export
  window.SceneEditor = SceneEditor;

})(typeof window !== 'undefined' ? window : this);
