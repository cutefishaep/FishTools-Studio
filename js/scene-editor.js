/**
 * OpenFishTools Studio — Scene Editor (Element 3D Scene Setup Style)
 * Full-featured 3D scene setup window for the "3D Element" effect.
 *
 * Provides:
 * - Top Ribbon (Import, Undo, Redo, Environment, Extrude, Create Primitives)
 * - 3D Viewport with floor grid, navigation toolbar (Orbit, Pan, Zoom), Lighting presets
 * - Left Bottom: Presets & Scene Materials inspector
 * - Center: Scene Hierarchy Tree & Transform/Material Edit Inspector
 * - Right: Model Browser (Starter Primitives & Imported GLB models)
 */
(function(window) {
  'use strict';

  /* ================================================================
     RENDERED 3D PRIMITIVE THUMBNAILS (NATIVE WEBGL 3D RENDERS)
     ================================================================ */
  const PRIMITIVE_THUMBS = {
    box: 'assets/primitives/box.png',
    cone: 'assets/primitives/cone.png',
    cylinder: 'assets/primitives/cylinder.png',
    plane: 'assets/primitives/plane.png',
    sphere: 'assets/primitives/sphere.png',
    torus: 'assets/primitives/torus.png'
  };

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
    _selectedType: null,// 'model' | 'light'
    _animFrame: null,   // Animation frame ID
    _activeNavTool: 'orbit', // 'orbit' | 'pan' | 'zoom'
    _activeTab: 'materials', // 'materials' | 'presets'

    // DOM references (cached after first build)
    _overlay: null,
    _window: null,
    _viewport: null,
    _viewportCanvas: null,
    _sceneTree: null,
    _propsPanel: null,
    _materialsPanel: null,
    _browserBody: null,
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
      this._selectedType = null;

      // Build DOM if first time
      if (!this._built) {
        this._buildDOM();
        this._built = true;
      }

      // Show window immediately for instantaneous user feedback
      this._overlay.classList.add('is-active');
      this.isOpen = true;

      // Push history state for back-button close
      history.pushState({ sceneEditorOpen: true }, '');

      try {
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

          // Load default environment map if none set
          if (!mgr._envMap) {
            const defaultHDRI = 'assets/env/default_env.jpg';
            try {
              await mgr.loadEnvironmentFromURL(defaultHDRI);
            } catch (_) {}
          }
        }

        // Enable orbit controls on viewport container
        mgr.enableOrbitControls(this._viewport);
        this._applyNavTool(this._activeNavTool);

        // Start render loop
        this._startRenderLoop();

        // Refresh all panels
        this._refreshSceneTree();
        this._refreshProperties();
        this._refreshMaterialsPanel();
        this._refreshModelBrowser();
      } catch (err) {
        console.error('Scene Editor open initialization error:', err);
      }
    },

    /**
     * Close Scene Editor
     * @param {boolean} skipConfirm - Skip confirmation dialog
     * @param {boolean} save - Save changes on close
     * @param {boolean} fromPopstate - Triggered by popstate event
     */
    close(skipConfirm, save, fromPopstate = false) {
      if (!this.isOpen) return;

      if (this._dirty && !skipConfirm) {
        this._showConfirm();
        return;
      }

      if (save && this._mgr && this._fx) {
        // Serialize scene state to effect param
        const serialized = this._mgr.serialize();
        this._fx.sceneData = JSON.stringify(serialized);

        // Trigger layer save and preview invalidation
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

      // Pop history state if not already from popstate
      if (!fromPopstate) {
        try { history.back(); } catch (_) {}
      }

      // Clear references
      this._fx = null;
      this._layer = null;
      this._selectedId = null;
      this._selectedType = null;
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

      // === 1. Title bar ===
      const titlebar = document.createElement('div');
      titlebar.className = 'scene-editor-titlebar';
      titlebar.innerHTML = `
        <div class="se-mac-dots">
          <button type="button" class="se-mac-dot is-close" title="Close / Cancel"></button>
          <button type="button" class="se-mac-dot is-min" title="Minimize / Center"></button>
          <button type="button" class="se-mac-dot is-max" title="Toggle Fullscreen"></button>
        </div>
        <span class="scene-editor-title">Scene Setup</span>
        <span class="se-title-meta">FishTools 3D Element</span>
        <span class="se-title-spacer"></span>
        <div class="se-title-actions">
          <button type="button" class="se-title-btn" data-action="cancel" title="Cancel & Discard Changes">Cancel</button>
          <button type="button" class="se-title-btn is-primary" data-action="apply" title="Apply Scene Changes">OK</button>
        </div>
      `;
      win.appendChild(titlebar);
      this._initDrag(titlebar, win);

      // Title bar buttons
      titlebar.querySelector('.is-close').addEventListener('click', () => this.close(false, false));
      titlebar.querySelector('.is-min').addEventListener('click', () => {
        win.style.top = '';
        win.style.left = '';
      });
      titlebar.querySelector('.is-max').addEventListener('click', () => {
        win.classList.toggle('is-maximized');
      });
      titlebar.querySelector('[data-action="cancel"]').addEventListener('click', () => this.close(false, false));
      titlebar.querySelector('[data-action="apply"]').addEventListener('click', () => this.close(true, true));

      // === 2. Top Ribbon Toolbar ===
      const ribbon = document.createElement('div');
      ribbon.className = 'scene-editor-ribbon';
      ribbon.innerHTML = `
        <div class="se-ribbon-menubar">
          <span class="se-ribbon-menu-item">File</span>
          <span class="se-ribbon-menu-item">Window</span>
          <span class="se-ribbon-menu-item">Help</span>
        </div>
        <div class="se-ribbon-actions">
          <button type="button" class="se-ribbon-btn" data-action="import" title="Import 3D model (GLTF, GLB)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            IMPORT
          </button>
          <span class="se-ribbon-sep"></span>
          <button type="button" class="se-ribbon-btn" data-action="undo" title="Undo (Ctrl+Z)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            UNDO
          </button>
          <button type="button" class="se-ribbon-btn" data-action="redo" title="Redo (Ctrl+Y)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
            REDO
          </button>
          <span class="se-ribbon-sep"></span>
          <button type="button" class="se-ribbon-btn" data-action="environment" title="Set Environment Map">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            ENVIRONMENT
          </button>
          <button type="button" class="se-ribbon-btn" data-action="extrude" title="Extrude 3D Text / Shape">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M12 4v16M8 20h8"/></svg>
            EXTRUDE
          </button>
          <div class="se-ribbon-dropdown-wrap">
            <button type="button" class="se-ribbon-btn is-create" data-action="create-toggle" title="Create 3D Primitive">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              CREATE ▾
            </button>
            <div class="se-create-dropdown">
              <div class="se-create-item" data-primitive="box">
                <img class="se-create-thumb" src="${PRIMITIVE_THUMBS.box}" alt="Box" draggable="false">
                <span>Box (Cube)</span>
              </div>
              <div class="se-create-item" data-primitive="sphere">
                <img class="se-create-thumb" src="${PRIMITIVE_THUMBS.sphere}" alt="Sphere" draggable="false">
                <span>Sphere</span>
              </div>
              <div class="se-create-item" data-primitive="cylinder">
                <img class="se-create-thumb" src="${PRIMITIVE_THUMBS.cylinder}" alt="Cylinder" draggable="false">
                <span>Cylinder</span>
              </div>
              <div class="se-create-item" data-primitive="cone">
                <img class="se-create-thumb" src="${PRIMITIVE_THUMBS.cone}" alt="Cone" draggable="false">
                <span>Cone</span>
              </div>
              <div class="se-create-item" data-primitive="plane">
                <img class="se-create-thumb" src="${PRIMITIVE_THUMBS.plane}" alt="Plane" draggable="false">
                <span>Plane (Floor)</span>
              </div>
              <div class="se-create-item" data-primitive="torus">
                <img class="se-create-thumb" src="${PRIMITIVE_THUMBS.torus}" alt="Torus" draggable="false">
                <span>Torus (Donut)</span>
              </div>
            </div>
          </div>
          <span style="flex:1"></span>
          <button type="button" class="se-ribbon-btn" data-action="add-light" title="Add Point Light">+ LIGHT</button>
        </div>
      `;
      win.appendChild(ribbon);
      this._bindRibbon(ribbon);

      // === 3. Body (3-Column Layout) ===
      const body = document.createElement('div');
      body.className = 'scene-editor-body';

      // --- COLUMN 1: PREVIEW & MATERIALS ---
      const colPreview = document.createElement('div');
      colPreview.className = 'se-col-preview';

      // Viewport container
      const viewport = document.createElement('div');
      viewport.className = 'scene-editor-viewport';
      viewport.innerHTML = `
        <div class="se-viewport-header">
          <span class="se-tab-badge">Preview</span>
          <select class="se-viewport-dropdown" data-prop="view" title="Camera View Angle">
            <option value="perspective">Perspective</option>
            <option value="front">Front</option>
            <option value="top">Top</option>
            <option value="right">Right</option>
          </select>
          <select class="se-viewport-dropdown" data-prop="shading" title="Shading Mode">
            <option value="shaded">Shaded</option>
            <option value="wireframe">Wireframe</option>
          </select>
          <label class="se-viewport-check-label" title="Draft Textures Mode">
            <input type="checkbox" data-prop="draft-textures">
            <span>Draft Textures</span>
          </label>
          <span style="flex:1"></span>
          <button type="button" class="se-vp-tool-btn" data-action="reset-camera" title="Reset Camera View">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>
          </button>
        </div>
        <div class="se-viewport-empty">No Model — click CREATE ▾ or IMPORT</div>
        <canvas class="se-viewport-canvas"></canvas>
        <div class="se-vp-bottom-toolbar">
          <button type="button" class="se-vp-tool-btn is-active" data-nav="orbit" title="Orbit Camera Tool (Left-Click Drag)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M21 21v-5h-5"/></svg>
          </button>
          <button type="button" class="se-vp-tool-btn" data-nav="pan" title="Pan Camera Tool (Left-Click Drag)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v4"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M6 14v-1a2 2 0 0 0-4 0v5a7 7 0 0 0 7 7h3a8 8 0 0 0 8-8v-5a2 2 0 0 0-4 0"/></svg>
          </button>
          <button type="button" class="se-vp-tool-btn" data-nav="zoom" title="Zoom Camera Tool (Left-Click Drag)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </button>
          <span class="se-ribbon-sep"></span>
          <select class="se-vp-select" data-prop="lighting" title="Lighting Mode">
            <option value="single">Single Light</option>
            <option value="studio">Studio 3-Point</option>
            <option value="warm">Warm Light</option>
          </select>
        </div>
      `;
      colPreview.appendChild(viewport);
      this._viewport = viewport;
      this._viewportCanvas = viewport.querySelector('.se-viewport-canvas');
      this._bindViewportControls(viewport);

      // Horizontal splitter in Column 1
      const hsplitCol1 = document.createElement('div');
      hsplitCol1.className = 'scene-editor-hsplit';
      colPreview.appendChild(hsplitCol1);

      // Bottom Left Panel (Presets / Scene Materials)
      const previewBottom = document.createElement('div');
      previewBottom.className = 'se-preview-bottom';
      previewBottom.innerHTML = `
        <div class="se-tab-bar">
          <button type="button" class="se-tab-btn is-active" data-tab="materials">Scene Materials</button>
          <button type="button" class="se-tab-btn" data-tab="presets">Presets</button>
        </div>
        <div class="se-tab-content"></div>
      `;
      colPreview.appendChild(previewBottom);
      this._materialsPanel = previewBottom.querySelector('.se-tab-content');
      this._bindBottomLeftTabs(previewBottom);
      this._initPanelResize(hsplitCol1, 'horizontal', viewport, previewBottom);

      body.appendChild(colPreview);

      // Vertical Splitter 1 (between Preview and Scene)
      const vsplit1 = document.createElement('div');
      vsplit1.className = 'scene-editor-vsplit';
      body.appendChild(vsplit1);

      // --- COLUMN 2: SCENE HIERARCHY & EDIT INSPECTOR ---
      const colScene = document.createElement('div');
      colScene.className = 'se-col-scene';

      // Scene tree panel
      const scenePanel = document.createElement('div');
      scenePanel.className = 'scene-editor-scene';
      scenePanel.innerHTML = `
        <div class="se-panel-header">
          <span>Scene</span>
        </div>
        <div class="se-panel-subbar">
          <div class="se-sub-actions">
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
          </div>
          <button type="button" class="se-sub-btn" data-action="quick-primitive" title="Add primitive to group">+ Add to Group</button>
        </div>
        <div class="se-scene-tree"></div>
      `;
      colScene.appendChild(scenePanel);
      this._sceneTree = scenePanel.querySelector('.se-scene-tree');
      scenePanel.querySelector('[data-action="quick-primitive"]').addEventListener('click', () => {
        if (this._mgr) {
          const entry = this._mgr.createPrimitive('box');
          if (entry) {
            this._selectedId = entry.id;
            this._selectedType = 'model';
            this._dirty = true;
            this._refreshSceneTree();
            this._refreshProperties();
          }
        }
      });

      // Horizontal Splitter in Column 2
      const hsplitCol2 = document.createElement('div');
      hsplitCol2.className = 'scene-editor-hsplit';
      colScene.appendChild(hsplitCol2);

      // Edit properties panel
      const propsPanel = document.createElement('div');
      propsPanel.className = 'scene-editor-props';
      propsPanel.innerHTML = `
        <div class="se-panel-header">Edit</div>
        <div class="se-props-content">
          <div class="se-panel-empty">No Selection</div>
        </div>
      `;
      colScene.appendChild(propsPanel);
      this._propsPanel = propsPanel.querySelector('.se-props-content');
      this._initPanelResize(hsplitCol2, 'horizontal', scenePanel, propsPanel);

      body.appendChild(colScene);
      this._initPanelResize(vsplit1, 'vertical', colPreview, colScene);

      // Vertical Splitter 2 (between Scene and Browser)
      const vsplit2 = document.createElement('div');
      vsplit2.className = 'scene-editor-vsplit';
      body.appendChild(vsplit2);

      // --- COLUMN 3: MODEL BROWSER ---
      const colBrowser = document.createElement('div');
      colBrowser.className = 'se-col-browser';
      colBrowser.innerHTML = `
        <div class="se-panel-header">Model Browser</div>
        <div class="se-browser-search-wrap">
          <input type="text" class="se-browser-search-input" placeholder="Search models...">
        </div>
        <div class="se-browser-body"></div>
      `;
      body.appendChild(colBrowser);
      this._browserBody = colBrowser.querySelector('.se-browser-body');
      this._bindModelBrowser(colBrowser);
      this._initPanelResize(vsplit2, 'vertical', colScene, colBrowser);

      win.appendChild(body);

      // === 4. Confirm Dialog ===
      const confirm = document.createElement('div');
      confirm.className = 'scene-editor-confirm';
      confirm.innerHTML = `
        <div class="se-confirm-card">
          <div class="se-confirm-title">Confirm</div>
          <div class="se-confirm-msg">Discard unsaved 3D scene changes?</div>
          <div class="se-confirm-actions">
            <button type="button" class="se-confirm-btn is-danger" data-action="discard">Discard</button>
            <button type="button" class="se-confirm-btn is-safe" data-action="keep">Keep Editing</button>
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

      // Append overlay to DOM
      document.body.appendChild(overlay);
      this._overlay = overlay;
      this._window = win;

      // Popstate listener for browser back button / gestures
      window.addEventListener('popstate', (e) => {
        if (this.isOpen) {
          this.close(false, false, true);
        }
      });
    },

    /* ================================================================
       RIBBON & TOOLBAR BINDING
       ================================================================ */

    _bindRibbon(ribbon) {
      // Toggle create dropdown
      const createBtn = ribbon.querySelector('[data-action="create-toggle"]');
      const createDropdown = ribbon.querySelector('.se-create-dropdown');
      createBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        createDropdown.classList.toggle('is-open');
      });

      // Close create dropdown when clicking outside
      document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('.se-ribbon-dropdown-wrap')) {
          createDropdown.classList.remove('is-open');
        }
      });

      // Create primitive items
      ribbon.querySelectorAll('.se-create-item').forEach(item => {
        item.addEventListener('click', () => {
          const type = item.dataset.primitive || 'box';
          createDropdown.classList.remove('is-open');
          if (this._mgr) {
            const entry = this._mgr.createPrimitive(type);
            if (entry) {
              this._selectedId = entry.id;
              this._selectedType = 'model';
              this._dirty = true;
              this._refreshSceneTree();
              this._refreshProperties();
              this._refreshMaterialsPanel();
            }
          }
        });
      });

      // Action buttons
      ribbon.addEventListener('click', async (e) => {
        const btn = e.target.closest('.se-ribbon-btn');
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
              this._refreshMaterialsPanel();
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
              this._refreshMaterialsPanel();
            }
            break;

          case 'environment':
            this._promptEnvironment();
            break;

          case 'extrude':
            if (this._mgr) {
              const entry = this._mgr.createPrimitive('torus', 'Extrude Mesh');
              if (entry) {
                this._selectedId = entry.id;
                this._selectedType = 'model';
                this._dirty = true;
                this._refreshSceneTree();
                this._refreshProperties();
              }
            }
            break;

          case 'add-light':
            if (this._mgr) {
              this._mgr.pushUndo();
              this._mgr.addLight('point', {
                color: '#ffffff',
                intensity: 1.2,
                x: 100, y: 200, z: 200
              });
              this._dirty = true;
              this._refreshSceneTree();
            }
            break;
        }
      });
    },

    /* ================================================================
       VIEWPORT CONTROLS BINDING
       ================================================================ */

    _bindViewportControls(viewport) {
      // Perspective / Ortho dropdown
      viewport.querySelector('[data-prop="view"]').addEventListener('change', (e) => {
        if (this._mgr && typeof this._mgr.setViewMode === 'function') {
          this._mgr.setViewMode(e.target.value);
        }
      });

      // Shading dropdown (Shaded vs Wireframe)
      viewport.querySelector('[data-prop="shading"]').addEventListener('change', (e) => {
        if (this._mgr && typeof this._mgr.setShadingMode === 'function') {
          this._mgr.setShadingMode(e.target.value);
        }
      });

      // Reset camera button
      viewport.querySelector('[data-action="reset-camera"]').addEventListener('click', () => {
        if (this._mgr && typeof this._mgr.resetCamera === 'function') {
          this._mgr.resetCamera();
        }
      });

      // Lighting preset select
      viewport.querySelector('[data-prop="lighting"]').addEventListener('change', (e) => {
        if (this._mgr && typeof this._mgr.setLightingPreset === 'function') {
          this._mgr.setLightingPreset(e.target.value);
        }
      });

      // Navigation tool buttons (Orbit, Pan, Zoom)
      viewport.querySelectorAll('.se-vp-tool-btn[data-nav]').forEach(btn => {
        btn.addEventListener('click', () => {
          viewport.querySelectorAll('.se-vp-tool-btn[data-nav]').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          this._activeNavTool = btn.dataset.nav;
          this._applyNavTool(this._activeNavTool);
        });
      });
    },

    _applyNavTool(tool) {
      if (!this._mgr || !this._mgr.orbitControls || !window.THREE) return;
      const THREE = window.THREE;
      const controls = this._mgr.orbitControls;

      switch (tool) {
        case 'pan':
          controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
          controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
          break;
        case 'zoom':
          controls.mouseButtons.LEFT = THREE.MOUSE.DOLLY;
          controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
          break;
        case 'orbit':
        default:
          controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
          controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
          break;
      }
    },

    /* ================================================================
       BOTTOM LEFT TABS (PRESETS & MATERIALS)
       ================================================================ */

    _bindBottomLeftTabs(panel) {
      panel.querySelectorAll('.se-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          panel.querySelectorAll('.se-tab-btn').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          this._activeTab = btn.dataset.tab;
          this._refreshMaterialsPanel();
        });
      });
    },

    _refreshMaterialsPanel() {
      if (!this._materialsPanel || !this._mgr) return;

      if (this._activeTab === 'presets') {
        // Render quick material presets
        const presets = [
          { name: 'Chrome', color: '#eeeeee', metal: 0.95, rough: 0.1 },
          { name: 'Gold', color: '#ffd700', metal: 0.9, rough: 0.2 },
          { name: 'Emerald', color: '#98ce7b', metal: 0.1, rough: 0.15 },
          { name: 'Matte Black', color: '#222222', metal: 0.1, rough: 0.8 },
          { name: 'Glossy White', color: '#ffffff', metal: 0.05, rough: 0.05 },
          { name: 'Copper', color: '#b87333', metal: 0.85, rough: 0.25 }
        ];

        this._materialsPanel.innerHTML = `
          <div class="se-presets-grid">
            ${presets.map(p => `
              <div class="se-preset-card" data-preset="${p.name}" title="Apply ${p.name} material">
                <div class="se-preset-swatch" style="background-color:${p.color}"></div>
                <span class="se-preset-name">${p.name}</span>
              </div>
            `).join('')}
          </div>
        `;

        this._materialsPanel.querySelectorAll('.se-preset-card').forEach(card => {
          card.addEventListener('click', () => {
            const p = presets.find(pr => pr.name === card.dataset.preset);
            if (!p || !this._selectedId) return;
            this._mgr.updateMaterials({
              color: p.color,
              metalness: p.metal,
              roughness: p.rough
            }, this._selectedId);
            this._dirty = true;
            this._refreshProperties();
          });
        });
      } else {
        // Render scene materials
        if (this._mgr.models.size === 0) {
          this._materialsPanel.innerHTML = '<div class="se-panel-empty">No Materials in Scene</div>';
          return;
        }

        let html = '<div class="se-materials-list">';
        this._mgr.models.forEach((entry, id) => {
          const mat = entry.materialOverrides || {};
          html += `
            <div class="se-material-card" data-id="${id}">
              <div class="se-material-header">
                <div class="se-preset-swatch" style="background-color:${mat.color || '#98ce7b'};width:16px;height:16px"></div>
                <span>${entry.name} Material</span>
              </div>
              <div class="se-prop-row">
                <span class="se-prop-label">Metalness</span>
                <span class="se-prop-value">${(mat.metalness || 0.2).toFixed(2)}</span>
              </div>
              <div class="se-prop-row">
                <span class="se-prop-label">Roughness</span>
                <span class="se-prop-value">${(mat.roughness || 0.35).toFixed(2)}</span>
              </div>
            </div>
          `;
        });
        html += '</div>';
        this._materialsPanel.innerHTML = html;

        this._materialsPanel.querySelectorAll('.se-material-card').forEach(card => {
          card.addEventListener('click', () => {
            this._selectedId = card.dataset.id;
            this._selectedType = 'model';
            this._refreshSceneTree();
            this._refreshProperties();
          });
        });
      }
    },

    /* ================================================================
       MODEL BROWSER
       ================================================================ */

    _bindModelBrowser(colBrowser) {
      const searchInput = colBrowser.querySelector('.se-browser-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          this._refreshModelBrowser(searchInput.value.trim().toLowerCase());
        });
      }
    },

    async _refreshModelBrowser(searchQuery = '') {
      if (!this._browserBody) return;

      const primitives = [
        { type: 'box', name: 'Box', thumb: PRIMITIVE_THUMBS.box },
        { type: 'cone', name: 'Cone', thumb: PRIMITIVE_THUMBS.cone },
        { type: 'cylinder', name: 'Cylinder', thumb: PRIMITIVE_THUMBS.cylinder },
        { type: 'plane', name: 'Plane', thumb: PRIMITIVE_THUMBS.plane },
        { type: 'sphere', name: 'Sphere', thumb: PRIMITIVE_THUMBS.sphere },
        { type: 'torus', name: 'Torus', thumb: PRIMITIVE_THUMBS.torus }
      ].filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery));

      let importedList = [];
      if (window.ThreeDB) {
        try {
          await window.ThreeDB.init();
          importedList = await window.ThreeDB.listModels();
        } catch (_) {}
      }
      if (searchQuery) {
        importedList = importedList.filter(m => m.name.toLowerCase().includes(searchQuery));
      }

      this._browserBody.innerHTML = `
        <div class="se-browser-section">
          <div class="se-browser-section-title">Starter Primitives</div>
          <div class="se-primitives-grid">
            ${primitives.map(p => `
              <div class="se-primitive-card" data-primitive="${p.type}" title="Click to spawn ${p.name}">
                <div class="se-primitive-thumb-wrap">
                  <img class="se-primitive-thumb" src="${p.thumb}" alt="${p.name}" draggable="false" />
                </div>
                <span class="se-primitive-name">${p.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="se-browser-section">
          <div class="se-browser-section-title">Imported Models (${importedList.length})</div>
          <div class="se-imported-list">
            ${importedList.length === 0 ? '<span style="font-size:10px;color:var(--text-dim)">No custom models yet</span>' : ''}
            ${importedList.map(m => `
              <div class="se-imported-card" data-id="${m.id}" title="Click to insert ${m.name}">
                <div style="display:flex;align-items:center;gap:6px;overflow:hidden">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  <span class="se-imported-name">${m.name}</span>
                </div>
                <button type="button" class="se-scene-item-del" data-delete-id="${m.id}" title="Delete model">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      // Spawn primitive on card click
      this._browserBody.querySelectorAll('.se-primitive-card').forEach(card => {
        card.addEventListener('click', () => {
          const type = card.dataset.primitive;
          if (this._mgr) {
            const entry = this._mgr.createPrimitive(type);
            if (entry) {
              this._selectedId = entry.id;
              this._selectedType = 'model';
              this._dirty = true;
              this._refreshSceneTree();
              this._refreshProperties();
              this._refreshMaterialsPanel();
            }
          }
        });
      });

      // Insert imported model on card click
      this._browserBody.querySelectorAll('.se-imported-card').forEach(card => {
        card.addEventListener('click', async (e) => {
          if (e.target.closest('.se-scene-item-del')) return;
          const id = card.dataset.id;
          if (this._mgr && window.ThreeDB) {
            const rec = await window.ThreeDB.getModel(id);
            if (rec && rec.data) {
              const newId = 'm_' + Date.now();
              await this._mgr.loadModel(newId, rec.name, rec.data);
              this._selectedId = newId;
              this._selectedType = 'model';
              this._dirty = true;
              this._refreshSceneTree();
              this._refreshProperties();
              this._refreshMaterialsPanel();
            }
          }
        });
      });

      // Delete imported model
      this._browserBody.querySelectorAll('[data-delete-id]').forEach(delBtn => {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = delBtn.dataset.deleteId;
          if (window.ThreeDB) {
            await window.ThreeDB.deleteModel(id);
            this._refreshModelBrowser(searchQuery);
          }
        });
      });
    },

    /* ================================================================
       MODEL IMPORT & ENVIRONMENT PROMPT
       ================================================================ */

    async _importModel() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.glb,.gltf';
      input.multiple = true;

      input.addEventListener('change', async () => {
        if (!input.files || input.files.length === 0) return;
        if (!this._mgr) return;

        if (window.ThreeDB) await window.ThreeDB.init();
        this._mgr.pushUndo();

        for (const file of input.files) {
          try {
            let modelRecord = null;
            if (window.ThreeDB) {
              modelRecord = await window.ThreeDB.saveModel(file);
            }
            const modelId = modelRecord ? modelRecord.id : ('m_' + Date.now());
            const modelName = file.name.replace(/\.(glb|gltf)$/i, '');
            const data = await file.arrayBuffer();

            await this._mgr.loadModel(modelId, modelName, data);
            this._selectedId = modelId;
            this._selectedType = 'model';
            this._dirty = true;
          } catch (err) {
            console.error('Scene Editor: Failed to import model', file.name, err);
          }
        }

        const emptyLabel = this._viewport.querySelector('.se-viewport-empty');
        if (emptyLabel) emptyLabel.style.display = this._mgr.models.size > 0 ? 'none' : '';

        this._refreshSceneTree();
        this._refreshProperties();
        this._refreshMaterialsPanel();
        this._refreshModelBrowser();
      });

      input.click();
    },

    _promptEnvironment() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', () => {
        if (!input.files[0] || !this._mgr) return;
        const img = new Image();
        img.onload = () => {
          this._mgr.setEnvironment(img, 1.0);
          this._dirty = true;
        };
        img.src = URL.createObjectURL(input.files[0]);
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
          <button type="button" class="se-scene-item-eye ${entry.mesh && !entry.mesh.visible ? 'is-hidden' : ''}" title="Toggle Visibility">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
            </svg>
          </button>
          <svg class="se-scene-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span class="se-scene-item-title">${entry.name}</span>
          <button type="button" class="se-scene-item-del" title="Remove model">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        `;

        // Toggle visibility
        item.querySelector('.se-scene-item-eye').addEventListener('click', (e) => {
          e.stopPropagation();
          if (entry.mesh) {
            entry.mesh.visible = !entry.mesh.visible;
            this._dirty = true;
            this._refreshSceneTree();
          }
        });

        // Select model
        item.addEventListener('click', () => {
          this._selectedId = id;
          this._selectedType = 'model';
          this._refreshSceneTree();
          this._refreshProperties();
        });

        // Delete model
        item.querySelector('.se-scene-item-del').addEventListener('click', (e) => {
          e.stopPropagation();
          this._mgr.pushUndo();
          this._mgr.removeModel(id);
          this._dirty = true;
          if (this._selectedId === id) {
            this._selectedId = null;
            this._selectedType = null;
          }
          this._refreshSceneTree();
          this._refreshProperties();
          this._refreshMaterialsPanel();
        });

        this._sceneTree.appendChild(item);
      });

      // Lights (custom lights)
      this._mgr.lights.forEach((entry, id) => {
        if (id.startsWith('__')) return;
        const item = document.createElement('div');
        item.className = 'se-scene-item' + (this._selectedId === id ? ' is-selected' : '');
        item.dataset.id = id;
        item.dataset.type = 'light';
        item.innerHTML = `
          <button type="button" class="se-scene-item-eye ${entry.light && !entry.light.visible ? 'is-hidden' : ''}" title="Toggle Visibility">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
            </svg>
          </button>
          <svg class="se-scene-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2"/>
          </svg>
          <span class="se-scene-item-title">${entry.type} light</span>
          <button type="button" class="se-scene-item-del" title="Remove light">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        `;

        item.querySelector('.se-scene-item-eye').addEventListener('click', (e) => {
          e.stopPropagation();
          if (entry.light) {
            entry.light.visible = !entry.light.visible;
            this._dirty = true;
            this._refreshSceneTree();
          }
        });

        item.addEventListener('click', () => {
          this._selectedId = id;
          this._selectedType = 'light';
          this._refreshSceneTree();
          this._refreshProperties();
        });

        item.querySelector('.se-scene-item-del').addEventListener('click', (e) => {
          e.stopPropagation();
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

      // Update empty label in viewport
      const emptyLabel = this._viewport?.querySelector('.se-viewport-empty');
      if (emptyLabel) emptyLabel.style.display = this._mgr.models.size > 0 ? 'none' : '';
    },

    /* ================================================================
       PROPERTIES PANEL
       ================================================================ */

    _refreshProperties() {
      if (!this._propsPanel) return;

      if (!this._selectedId) {
        this._propsPanel.innerHTML = '<div class="se-panel-empty">No Selection</div>';
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
      const t = entry.transform || {};
      const mat = entry.materialOverrides || {};

      this._propsPanel.innerHTML = `
        <div class="se-prop-group">
          <div class="se-prop-group-title">Transform</div>
          ${this._propRow('Position X', t.posX || 0, 'tx')}
          ${this._propRow('Position Y', t.posY || 0, 'ty')}
          ${this._propRow('Position Z', t.posZ || 0, 'tz')}
          ${this._propRow('Rotation X', t.rotX || 0, 'rx', '°')}
          ${this._propRow('Rotation Y', t.rotY || 0, 'ry', '°')}
          ${this._propRow('Rotation Z', t.rotZ || 0, 'rz', '°')}
          ${this._propRow('Scale', t.scaleX || 100, 'sc', '%')}
        </div>
        <div class="se-prop-group">
          <div class="se-prop-group-title">Material</div>
          <div class="se-prop-row">
            <span class="se-prop-label">Color</span>
            <input type="color" class="se-prop-color-input" data-key="mat_color" value="${mat.color || '#98ce7b'}" style="background:none;border:none;width:32px;height:24px;cursor:pointer">
          </div>
          ${this._propSlider('Metalness', mat.metalness !== undefined ? mat.metalness : 0.2, 'metalness', 0, 1)}
          ${this._propSlider('Roughness', mat.roughness !== undefined ? mat.roughness : 0.35, 'roughness', 0, 1)}
          <div class="se-prop-row">
            <span class="se-prop-label">Wireframe</span>
            <label class="se-viewport-check-label">
              <input type="checkbox" data-key="mat_wireframe" ${mat.wireframe ? 'checked' : ''}>
              <span>Wireframe</span>
            </label>
          </div>
        </div>
      `;

      this._bindPropertyInputs();
    },

    _renderLightProperties() {
      const entry = this._mgr.lights.get(this._selectedId);
      if (!entry) return;
      const p = entry.params || {};

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
      const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
      return `
        <div class="se-prop-row">
          <span class="se-prop-label">${label}</span>
          <div class="se-prop-slider" data-key="${key}" data-min="${min}" data-max="${max}">
            <div class="se-prop-slider-fill" style="width:${pct}%"></div>
            <div class="se-prop-slider-thumb" style="left:${pct}%"></div>
          </div>
          <span class="se-prop-value" data-key="${key}" style="width:40px;text-align:right">${Number(value).toFixed(2)}</span>
        </div>
      `;
    },

    _bindPropertyInputs() {
      if (!this._propsPanel) return;

      // Color picker
      const colorInput = this._propsPanel.querySelector('[data-key="mat_color"]');
      if (colorInput) {
        colorInput.addEventListener('input', (e) => {
          this._applyPropertyChange('mat_color', e.target.value);
        });
      }

      // Wireframe checkbox
      const wireCheckbox = this._propsPanel.querySelector('[data-key="mat_wireframe"]');
      if (wireCheckbox) {
        wireCheckbox.addEventListener('change', (e) => {
          this._applyPropertyChange('mat_wireframe', e.target.checked);
        });
      }

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
    },

    _applyPropertyChange(key, value) {
      if (!this._mgr || !this._selectedId) return;
      this._dirty = true;

      if (this._selectedType === 'model') {
        const entry = this._mgr.models.get(this._selectedId);
        if (!entry) return;
        const t = entry.transform || {};

        switch (key) {
          case 'tx': t.posX = value; break;
          case 'ty': t.posY = value; break;
          case 'tz': t.posZ = value; break;
          case 'rx': t.rotX = value; break;
          case 'ry': t.rotY = value; break;
          case 'rz': t.rotZ = value; break;
          case 'sc':
            t.scaleX = value;
            t.scaleY = value;
            t.scaleZ = value;
            break;
          case 'metalness':
          case 'roughness':
            this._mgr.updateMaterials({ [key]: value }, this._selectedId);
            this._refreshMaterialsPanel();
            return;
          case 'mat_color':
            this._mgr.updateMaterials({ color: value }, this._selectedId);
            this._refreshMaterialsPanel();
            return;
          case 'mat_wireframe':
            this._mgr.updateMaterials({ wireframe: !!value }, this._selectedId);
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
        if (e.key === 'Enter') {
          commit();
        } else if (e.key === 'Escape') {
          el.textContent = current.toFixed(1) + suffix;
        }
      });
    },

    /* ================================================================
       RENDER LOOP
       ================================================================ */

    _startRenderLoop() {
      const loop = () => {
        if (!this.isOpen || !this._mgr || !this._viewportCanvas) return;
        this._animFrame = requestAnimationFrame(loop);

        // Update orbit controls
        this._mgr.updateOrbitControls();

        // Render to viewport canvas
        const rect = this._viewport.getBoundingClientRect();
        const w = Math.max(10, Math.floor(rect.width));
        const h = Math.max(10, Math.floor(rect.height));

        const rendered = this._mgr.renderForEditor(w, h);
        if (rendered && rendered !== this._viewportCanvas) {
          if (this._viewportCanvas.width !== w || this._viewportCanvas.height !== h) {
            this._viewportCanvas.width = w;
            this._viewportCanvas.height = h;
          }
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
      splitter.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        splitter.setPointerCapture(e.pointerId);

        const parentRect = splitter.parentElement.getBoundingClientRect();
        const startPos = direction === 'vertical' ? e.clientX : e.clientY;
        const startSizeA = panelA ? (direction === 'vertical' ? panelA.getBoundingClientRect().width : panelA.getBoundingClientRect().height) : 200;
        const startSizeB = panelB ? (direction === 'vertical' ? panelB.getBoundingClientRect().width : panelB.getBoundingClientRect().height) : 200;

        const onMove = (ev) => {
          const delta = direction === 'vertical' ? (ev.clientX - startPos) : (ev.clientY - startPos);
          const newA = Math.max(100, startSizeA + delta);
          const newB = Math.max(100, startSizeB - delta);

          if (direction === 'vertical') {
            if (panelA) {
              panelA.style.width = newA + 'px';
              panelA.style.flex = 'none';
            }
            if (panelB) {
              panelB.style.width = newB + 'px';
              panelB.style.flex = 'none';
            }
          } else {
            if (panelA) {
              panelA.style.height = newA + 'px';
              panelA.style.flex = 'none';
            }
            if (panelB) {
              panelB.style.height = newB + 'px';
              panelB.style.flex = 'none';
            }
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
       WINDOW DRAGGING
       ================================================================ */

    _initDrag(handle, win) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, select, .se-mac-dot')) return;
        if (win.classList.contains('is-maximized')) return;

        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = win.getBoundingClientRect();
        const winX = rect.left;
        const winY = rect.top;

        handle.setPointerCapture(e.pointerId);

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          win.style.left = (winX + dx) + 'px';
          win.style.top = (winY + dy) + 'px';
          win.style.margin = '0';
        };

        const onUp = () => {
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
      if (this._confirmEl) this._confirmEl.classList.add('is-active');
    },

    _hideConfirm() {
      if (this._confirmEl) this._confirmEl.classList.remove('is-active');
    }
  };

  // Export
  window.SceneEditor = SceneEditor;

})(typeof window !== 'undefined' ? window : this);
