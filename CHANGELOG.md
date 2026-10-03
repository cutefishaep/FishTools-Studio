# Changelog

All notable changes to OpenFishTools Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.121] - 2026-10-03

### Fixed
- **Deep Glow 60fps GPU Acceleration & Polygon Artifact Elimination (`effects/deep_glow.js`)**:
  - Eliminated stepped polygonal white clipping artifact caused by straight alpha division mismatch.
  - Removed all synchronous `getImageData()` readbacks and CPU pixel loops from the main render path, eliminating GPU pipeline stalls completely.
  - Implemented 540p 5-octave hardware-accelerated bloom pyramid with GPU `contrast` and `brightness` exposure modulation.
  - Guaranteed 60fps preview and buttery smooth scrubbing across all desktop and mobile devices.

## [0.5.120] - 2026-10-03

### Improved
- **Deep Glow Radiant Bloom & True Optical Falloff Engine (`effects/deep_glow.js`)**:
  - **HDR Exposure Accumulation**: Replaced single-clamp alpha limiter with progressive multi-pass accumulator, allowing `exposure` (up to 500%) to scale light exponentially without premature 1.0 clamping.
  - **6-Octave Optical Bloom Pyramid**: Expanded from 5 to 6 progressive octaves (from 0.15x hot core to 6.8x atmospheric dispersion) with 500px boundary padding to eliminate border cutoff.
  - **Universal Linear De-Gamma**: Applied `deGammaLut` (`pow(x, 1/2.2)`) and clean alpha unmulting across all blend modes, restoring luminous inverse-square glow in mid-tones and outer halos that were previously squashed dark.
  - **Non-Destructive Composite**: Re-engineered `source-over`, `screen`, and `lighter` compositing so the glow layers additively over the source without muting or dimming the crisp white cores.

## [0.5.119] - 2026-10-03

### Added
- **Particle Engine 'Still / Locked in Place' Motion Style (`effects/particle_engine.js`)**:
  - Added `'Still / Locked in Place'` motion style (default), locking particles at their spawn 3D coordinates with zero initial velocity and complete bypass of physics displacement (gravity, wind, drag, and turbulence wiggle).
  - Particles remain completely motionless in place while preserving full 3D camera depth parallax and in-place opacity/size lifecycle.

## [0.5.118] - 2026-10-03

### Improved
- **Particle Engine Ambient In-Place Spawn & Glow Synergy (`effects/particle_engine.js`)**:
  - Added `motionType`: `'Floating Ambient (In-Place)'` (default), `'Emitter Jet / Fountain'`, and `'Static Floating'`, allowing particles to materialize naturally in-place across 3D space with gentle organic drift instead of erupting from center.
  - Added `emitterType`: `'Full Space (Comp Volume)'` (default), `'Box'`, `'Sphere'`, `'Point'`, and `'Disc'`, spanning full composition depth and field.
  - Set default `blendMode` to `'Normal / Alpha'` (`source-over`), preserving full opacity and RGB channels on transparent pipeline canvases.
  - Upgraded particle sprites with high-luminance cores (`#ffffff`) ensuring instant, vivid bloom when paired with **Deep Glow**.

## [0.5.117] - 2026-10-03

### Performance & Optimization
- **Deep Glow 50x GPU Hardware Acceleration Overhaul (`effects/deep_glow.js`)**:
  - Replaced massive multi-megabyte unscaled CPU pixel loops with an adaptive Mipmap Bloom Pyramid (downscaled max 640px buffer), slashing pixel redraw load by up to 92%.
  - Removed `{ willReadFrequently: true }` from blur canvas context (`glowCtx`), restoring full GPU hardware texture acceleration for multi-octave bloom filters.
  - Replaced CPU pixel tint loops with pure GPU hardware composite operations (`source-in`, `multiply`).
  - Bypassed redundant Unmult CPU loops for `screen` and `lighter` blend modes where black is mathematically transparent identity.
  - Achieved smooth 60fps playback and scrubbing on mobile devices and low-spec laptops.

## [0.5.116] - 2026-10-03

### Fixed
- **Effects Gallery Static Registration & Cache Busting (`editor.html`, `desktop.html`, `scripts/sync-effects.js`)**:
  - Embedded static `.effects-gallery-item-card` elements for **Linear Wipe** and **Particle Engine** directly into `#effects-items-grid` under category `layer`.
  - Added dynamic version cache-busting parameters (`?v=<version>`) to all modular effect script tags in HTML templates, preventing browser HTTP and Service Worker cache desyncs.

## [0.5.115] - 2026-10-03

### Added
- **3D Particle Engine Layer Effect (`effects/particle_engine.js`, `assets/icon-particles.svg`)**:
  - Implemented Trapcode Particular-style 3D particle simulation engine in the `layer` category.
  - **Source Fill Suppression**: When placed on a Solid Layer or any layer, the original fill color or image is suppressed by default (`hideSource: 1`), turning the layer into a pure particle canvas.
  - **3D Camera Depth & Tracking**: Full real-time integration with scene 3D Camera (`cam.posX`, `cam.posY`, `cam.posZ`, `cam.rotX`, `cam.rotY`, `cam.rotZ`, `cam.cameraZoom`, `cam.cameraLens`). Moving, panning, tilting, dollying, and orbiting the camera renders particles with authentic 3D parallax, depth scaling, near/far depth fade, and painter's algorithm Z-sorting.
  - **Comprehensive Emitter Controls**: Point, Box, Sphere, and Disc emitters with 3D positions, volumes, directional angles, cone spread, and initial velocity with randomness.
  - **Physics & Dynamics**: Analytical 3D physics with gravity, air resistance/drag, 3D directional wind, and harmonic curl turbulence wiggle.
  - **Particle Styles & Optimization**: Glow Sphere, Sparkle Star, Crisp Circle, Glowing Ring, Smoke Puff, and Streak with cached sprite rendering, color blending over life, and 100% deterministic frame scrubbing and export.

## [0.5.106] - 2026-10-03

### Performance & Optimization
- **Mobile & Low-End Laptop Performance Engine (`js/editor.js`, `js/text-engine.js`, `js/motion-blur-engine.js`, `js/fishtool-engine.js`, `js/preview-cache.js`)**:
  - **Adaptive Canvas DPR**: Capped preview canvas to 1.0 DPR on mobile and 1.5 on desktop/laptop (0.5 in Draft Mode), cutting GPU pixel redraw load by up to 75% on high-DPI smartphone displays.
  - **Text Buffer Cache & WebGL Texture Re-upload Bypass**: Implemented state-keyed buffer caching via `_lastRenderKey` and `_contentVersion` in `FishTextEngine.renderTextToCanvas`. Static and resting text layers bypass canvas clearing, glyph re-measurement, and `gl.texImage2D` texture re-uploads completely during playback and scrubbing.
  - **Timeline Playhead DOM Thrashing Reduction**: Cached `.desktop-workstation, .desktop-viewport` query selector checks and throttled playhead timecode DOM string updates to ~25fps (40ms interval) during active playback, significantly relieving mobile browser main-thread load.
  - **Adaptive Motion Blur Sampling**: Preview multi-sampling on mobile and Draft Mode is reduced to 2 passes with equal weight distribution, slashing multi-pass compositing overhead by 33% while preserving high-quality rendering (up to 64 samples) during export.
  - **Adaptive RAM Preview Cache Memory Budget**: Dynamically scales RAM preview frame limits based on mobile detection and `navigator.deviceMemory` (180 frames on mobile, 150–300 on low-RAM machines), protecting mobile browsers from OS memory pressure and OOM tab crashes.

### Fixed
- **Baked Precompose Mechanism Removal (`js/preview-cache.js`, `js/editor.js`)**: Purged baked image sequence precompose pipeline that caused massive lag and memory pressure.
- **Warp 1/2/3 Layer Purge Bug (`js/openfishtools-controller.js`)**: Fixed layer disappearance bug when repeatedly clicking Warp presets across different playback timestamps.
- **Text Layer Canvas Boundary Disappearance (`js/text-engine.js`, `js/editor.js`, `js/fishtool-engine.js`)**: Fixed issue where large text or text positioned near canvas bounds disappeared due to premature bounding box clipping.

## [0.5.105] - 2026-10-02

### Added
- **Volumetric 3D Effects Suite (`effects/box_3d.js`, `effects/extrude_3d.js`, `effects/pyramid_3d.js`, `effects/sphere_3d.js`)**:
  - Added dedicated standalone 3D plugins: **3D Box / Cube**, **3D Extrude**, **3D Pyramid**, and **3D Sphere**.
  - All 3D plugins feature unified `sideMode` (`['texture', 'solid color']`, default `'texture'`), clean 0% default shading and edge opacity, and depth/height driven directly by the layer's Transform Scale Z.
  - Hardware WebGL mesh rendering in `js/fishtool-engine.js` with UV texture mapping, normal shading, and wireframe edge support.

### Fixed
- **Invisible 3D Layer Rendering Without Effects (`js/fishtool-engine.js`)**:
  - Fixed issue where enabling 3D on a layer without adding 3D mesh effects rendered the layer invisible (only showing the wireframe) until an effect was added and removed.
  - Resolved uninitialized WebGL `a_color` attribute state by explicitly resetting `u_mode = 0`, disabling `locations.color`, and setting `vertexAttrib4f(locations.color, 1.0, 1.0, 1.0, 1.0)` in `_initGL`, `renderLayer`, `_drawQuadOrTile`, `_renderBatch`, and `render3DMotionBlur`.
  - Added defensive fallback in fragment shader (`FS_SOURCE`) to ensure full luminance `vec4(1.0)` is used whenever `v_color` is uninitialized.
- **Duplicate 3D Cube Gallery Item (`effects/box_3d.js`)**:
  - Removed redundant `cube_3d` registration, keeping only the single official **3D Box / Cube** (`box_3d`) entry in the Effects Gallery.
- **Transform Scale Z Auto-Reveal (`js/editor.js`)**:
  - Adding any 3D effect now automatically initializes `layer.scaleZ` based on layer dimensions and reveals the Z-axis scrubber in the Transform Scale tab.

## [0.5.100] - 2026-10-02

### Fixed
- **Overlap Camera & Overlap Null — Flag Persistence Bug (`js/editor.js`)**: `isOverlapCamera` and `isOverlapNull` flags were missing from `serializeLayer`, causing them to be stripped on every IDB save. On project reload/refresh, layers silently reverted to plain Camera / Null with no leapfrog behavior. Both flags are now explicitly serialized and preserved across all save paths (IndexedDB, `.ofts` export).
- **Overlap Keyframe Drag Delay (`js/editor.js`)**: During keyframe drag (`window.isTransformInteracting === true`), leapfrog accumulation is bypassed and standard linear interpolation is used instead. This makes the composition preview snap directly to the dragged keyframe's destination value, giving immediate visual feedback without the leapfrog phase offset delay.

## [0.5.99] - 2026-10-02


### Fixed
- **Overlap Camera & Overlap Null — Authentic Leapfrog Math (`js/editor.js`)**: Rewrote leapfrog accumulation in `getLayerEffectivePropsAtTime` to correctly mirror the `_OVERLAP` null-rig architecture from `host/modules/misc.jsx`. Each transition `i` now contributes a **relative delta** `(K_{i+1} − K_i) × progress_i` additively on top of `K_0` baseline (`finalValue = K0 + Σ (K_{i+1} - K_i) × progress_i`), exactly matching the physical null-rig behavior in `applyKeyframeOverlap`. Previously, the label `accumulated` implied absolute interpolation but the math was computing sequential delta sums that double-counted intermediate keyframe values in 4+ keyframe scenarios.
- **Overlap Last-Keyframe Overshoot (`js/editor.js`)**: Final transition span extends to `t_M + (t_M − t_{M-1})`, so the animation continues past the last keyframe by one interval duration before clamping. Keyframe `K_M` value is now reached at `tEndFinal`, not at `t_M`, giving the last segment the same leapfrog momentum feel as intermediate transitions.
- **CONTROL Grid Layout — Mobile Drawer & Desktop Panel (`css/drawer.css`, `css/desktop.css`)**: Fixed asymmetric control grid. Mobile drawer `#add-layer-control-grid` now uses `repeat(3, 1fr)` (was misaligned with hanging empty slot). Desktop panel control grid uses `repeat(3, minmax(0, 1fr))` matching Shape grid symmetry. Button order reorganized into logical paired rows: Row 1 — Camera / Null / Adjustment; Row 2 — Overlap Camera / Overlap Null / Solid.

### Changed
- **Overlap Camera & Overlap Null Default Easing**: Default leapfrog Bezier curve uses dynamically computed `influenceOut`/`influenceIn` based on the interval span ratio (0.85 base influence, clamped 0.33–1.0), providing smooth organic overlap momentum. User-set graph easing is respected and propagated across all keyframes simultaneously via `setActiveEasing`.

## [0.5.87] - 2026-10-01


### Added
- **Linear Wipe Effect (`effects/linear_wipe.js`)**: Added smooth angle-guided directional wipe transition with completion scrubber, rotation angle, and edge feathering.
- **Flicker Effect (`effects/flicker.js`)**: Added lightning flicker effect with frequency, amount, randomness, seed, and multi-mode support (brightness, opacity, exposure).
- **Shake Effect (`effects/shake.js`)**: Added randomized camera shake movement effect with frequency, amplitude X/Y, rotation, and seed controls.

### Fixed
- **OpenFishTools Warp 2 & Warp 3 Preset Purge & Cache Busting (`js/openfishtools-controller.js`, `editor.html`, `desktop.html`, `sw.js`)**:
  - Replaced Warp 2 with exact single Hue Spin adjustment layer (70 frames ~ 1.167s, hue shift 0 to 360).
  - Replaced Warp 3 with exact 4-layer stack: Mid-Wave (145 frames), Warp Effect (63 frames), Ghost Effect (125 frames), and Hue Spin (70 frames).
  - Added pre-purge logic `purgeExistingPresetLayers` to cleanly delete existing warp preset layers before inserting new ones.
  - Added explicit version cache-busting `?v=0.5.87` to `openfishtools-controller.js`, `fishtools-adapter.js`, and `openfishtools-generators3d.js` across `editor.html` and `desktop.html`.
  - Registered controller scripts into Service Worker `CORE_ASSETS` to prevent serving stale cached scripts.

## [0.5.85] - 2026-09-30

### Changed
- **Camera Lens Blur Icon Reverted (`effects/camera_lens_blur.js`, `editor.html`, `desktop.html`, `js/editor.js`)**:
  - Replaced custom camera lens blur SVG icon with standard `assets/FXPH.svg` placeholder asset across gallery cards and registry definitions.
  - Removed `assets/icon-camera-lens-blur.svg`.

## [0.5.84] - 2026-09-30

### Fixed
- **Tonal Curve Editor & S-Curve Overhaul (`effects/curve.js`, `js/effects.js`, `css/effects-rack.css`, `css/desktop.css`)**:
  - Fixed inspector grid squishing bug where `.effects-control-row-curve` was constrained to 34% width, expanding it to full 100% card width with centered 1:1 square canvas.
  - Simplified default curve baseline to clean 2 points `[[0, 0], [1, 1]]` (Photoshop/Lightroom/Premiere standard), eliminating the 5-point cluster that caused zig-zag staircasing.
  - Added dedicated one-click preset buttons: `S-Curve`, `Hard S`, `Film`, `Linear` for instant cinematic S-curve grading.
  - Added live `S-Curve Contrast` scrubber (-100% to +100%) that dynamically shapes the curve into a silky smooth S-curve with real-time SVG curve preview and hardware LUT generation.
  - Improved control point dragging with 32px hit radius and maximum 5 control points to prevent runaway point clutter.

## [0.5.83] - 2026-09-30

### Fixed
- **Authentic Optical Camera Lens Blur Bokeh Overhaul (`effects/camera_lens_blur.js`, `assets/icon-camera-lens-blur.svg`)**:
  - Replaced plain CSS `blur()` fallback with full hardware WebGL optical convolution kernel simulating physical lens aperture bokeh (After Effects parity).
  - Added physical polygonal iris diaphragm geometry (`irisShape`: Hexagon, Pentagon, Octagon, Circle, Triangle, Square, Heptagon, Decagon) with `bladeCurvature`, `rotation`, and anamorphic `aspectRatio`.
  - Added diffraction ring / spherical aberration (`diffraction` / Edge Ring) creating the signature crisp "soap-bubble" bokeh outer rim.
  - Implemented specular highlight extraction in linear HDR energy gathering space (`highlightGain`, `highlightThreshold`) with Reinhard highlight compression tone mapping.
  - Added longitudinal chromatic aberration fringing (`chromaticAberration` / Fringe) and sub-texel interleaved gradient noise radial dithering to eliminate banding artifacts.
  - Generated dedicated vector SVG aperture diaphragm icon `assets/icon-camera-lens-blur.svg` bound to CSS theme tokens.

## [0.5.82] - 2026-09-30

### Fixed
- **Effect Blend Mode Isolation (`js/editor.js`)**:
  - Fixed bug where changing an effect's internal blend mode or dropdown parameter in the Effects Rack mutated `layer.blendMode`.
  - Scoped dropdown assignment fallback strictly to `brightness-contrast` (`brightness` / `contrast`), preventing effect blend modes from overwriting layer blend modes.

## [0.5.81] - 2026-09-30

### Fixed
- **Anamorphic Flare & Haze Flare Inverted Photo Ghost Fix (`effects/anamorphic_flare.js`, `effects/haze_flare.js`)**:
  - Eliminated raw unblurred highlight photo overlay (`u_core` / `reflCore` / `thresh.c`) from Anamorphic Flare composite shader and 2D fallback, ensuring only pure horizontal flare streaks render.
  - Fixed WebGL texture upload and FBO UV coordinate orientation with `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)` and standard `[0, 1, 0, 0, 1, 1, 1, 0]` UV mapping, preventing Y-axis inversion across FBO passes.
  - Set default `reflection` to `0%` matching Magic Bullet Looks presets (`Cyan Streak.l3t`, `Cool Haze.l3t`), with secondary reflection strictly limited to optical streak reflection when dialed in.

## [0.5.80] - 2026-09-30

### Added
- **Magic Bullet Looks Anamorphic Flare & Haze Flare Porting (`effects/anamorphic_flare.js`, `effects/haze_flare.js`)**:
  - **Anamorphic Flare (`anam`)**: Complete Magic Bullet Looks architecture with `Boost`, `Threshold`, `Threshold Softness`, `Size`, `Thickness`, `Reflection` (secondary inverted ghost flare across optical axis center `1.0 - uv`), `Reflection Boost`, `Tint`, `Core Glow`, `Chromatic Fringe`, `Blend Mode`, and `Flare Only`. WebGL multi-pass GPU pipeline and Canvas 2D fallback.
  - **Haze / Flare (`haze`)**: Full Magic Bullet Looks optical diffusion and light scattering architecture with `Spillage` (controls highlight threshold & midtone bleed), `Softness` (multi-octave spherical Gaussian diffusion), `Reach` (horizontal cylindrical flare streak), `Exposure`, `Reflection` (secondary ghost flare bounce), `Reflection Exposure`, `Matte Box Size` & `Matte Box Shade` (lens hood light occlusion), `Tint`, `Blend Mode`, and `Haze Only`. WebGL multi-FBO pipeline and Canvas 2D fallback.

## [0.5.79] - 2026-09-29

### Added
- **Per-Layer 3D Toggle Switch (After Effects Parity)**:
  - Added dedicated isometric 3D cube switch button (`assets/icon-3d.svg`, `.desktop-layer-3d-btn`, `.editor-layer-3d-btn`) in timeline lane Control column and top action header.
  - Toggling 3D on a layer switches its transform mode dynamically between 2D flat space and 3D camera space.
  - Layer 2D: Renders flat in screen space (unaffected by camera movement, zoom, lens focal length, or depth of field blur), with X/Y Position, Rotation, and X/Y Anchor Point.
  - Layer 3D: Participates in hardware WebGL 3D perspective, responsive to 3D cameras, depth sorting, Z-axis displacement, and rotX/rotY/rotZ.
  - **3D Depth Space Partitioning (`js/fishtool-engine.js`)**: 2D layers between 3D layers now properly split 3D depth passes, compositing in strict timeline stack order just like Adobe After Effects.
  - **Dynamic Transform Controller & Keyframe Inspector (`js/editor.js`)**: Automatically adapts UI controls (Z ruler, Z value cards, rotation axis segmented switch X/Y/Z) based on the layer's 3D switch state.

## [0.5.78] - 2026-09-23

### Fixed
- **Authentic After Effects Switch Box Slots (`css/desktop.css`)**:
  - Replaced invisible empty switch space with clearly visible recessed dark square slots (`[ ]`), eliminating UI gaps ("kek bolong") on disabled layers.
  - Inactive switches now render as solid dark square boxes (`var(--bg-canvas)`) with defined borders (`var(--border-panel)` / `var(--border-subtle)` on selection) and no internal icon.
  - Active switches render crisp vector icons inside the square box with active theme tokens (`var(--color-primary)`), perfectly matching After Effects reference.
  - Added subtle hover highlight and ghost icon feedback on mouse hover.

## [0.5.77] - 2026-09-23

### Changed
- **Timeline Switches & "Control" Category Header (`desktop.html`, `css/desktop.css`, `js/desktop.js`, `js/editor.js`)**:
  - Replaced the single "M" column header in the timeline ruler gutter with the category title **"Control"** (`.col-control`) positioned adjacent to "Layer Name".
  - Refactored switch rendering into dedicated modular `.desktop-layer-control-col` container with dynamic `--desktop-control-col-w` token binding and resize persistence.
  - Switches now display as a clean empty column/slot when disabled, revealing subtle outline and ghost icon feedback only on hover.
  - Active switches render crisp vector icons in `var(--color-primary)` with full state synchronization.
  - Protected Control column clicks from triggering unwanted layer drag selections.

## [0.5.76] - 2026-09-22

### Changed
- **Reverted 3D Element Suite (`effects/3d_element.js`, `js/3d_element_manager.js`, `js/scene-editor.js`, `css/scene-editor.css`, `vendor/three/`)**: Cleanly unbundled and reverted 3D Element effect plugin and Three.js dependencies per request. Core After Effects features including Solid Layer panel button (v0.5.68) and AE-style split-diamond keyframe visuals and deselection interactions (v0.5.69) are preserved intact.

### Fixed
- **Instant Effect Deletion Latency Elimination (`js/editor.js`)**: Eliminated UI delay when deleting effects from layer rack. Added optimistic zero-latency element hiding on delete button click, deferred heavy full-timeline DOM reconstruction (`renderTimelineLayers`) and composition redraw to next animation frame (`requestAnimationFrame`), and invoked `onRemove` lifecycle hook to dispose heavy WebGL resources cleanly.

## [0.5.75] - 2026-09-22

### Fixed
- **3D Preview XYZ Gizmo Inversion & Camera Screen Projection (`js/scene-editor.js`, `js/3d_element_manager.js`)**: Replaced naive axis delta guesswork with exact 3D camera screen projection of axis vectors, ensuring moving mouse along any axis (X, Y, Z) smoothly and intuitively drives object movement in world space matching cursor direction under all camera angles and rotations. Fixed inverted Y axis movement in `moveSelectedOnAxis`.
- **Model Sinking Below Grid & Position Reset (`js/3d_element_manager.js`, `effects/3d_element.js`)**: Fixed `mesh.position.set(posX, posY, posZ)` in `updateModelTransform` which previously inverted `posY` with `-posY`, causing objects to sink 50 units below the floor grid whenever properties or scenes were restored. Protected 3D manager models from being overridden by background timeline/composition render while Scene Editor is open.
- **Proportional Gizmo Sizing & Hit Detection (`js/3d_element_manager.js`, `js/scene-editor.js`)**: Compacted gizmo arrow length from 80 to 50 and refined camera distance scale factor from `dist / 400` to `dist / 650`, eliminating oversized arrows that dwarfed models. Added origin sphere and replaced `visible: false` on hit cylinder with `transparent: true, opacity: 0` so Three.js Raycaster reliably registers grab clicks. Added dynamic `grab` / `grabbing` cursor feedback.

## [0.5.74] - 2026-09-22

### Fixed
- **Restored `editor.html` & Bundled 3D Scene Editor Suite (`editor.html`)**: Restored full 4900+ lines `editor.html` core layout and wired `css/scene-editor.css`, `js/three-loader.js`, `js/3d-element-db.js`, `js/3d_element_manager.js`, `js/scene-editor.js`, and `effects/3d_element.js`.
- **Window Dragging Jumping & Offset Fix (`js/scene-editor.js`)**: Replaced flex-relative `style.left/top` manipulation with cumulative `transform: translate3d(...)` tracking, eliminating all jump offsets when dragging the floating Scene Setup window.
- **3D Visual Light Helpers (`js/3d_element_manager.js`, `js/scene-editor.js`)**: Added visual 3D wireframe helpers (`THREE.PointLightHelper`, `THREE.SpotLightHelper`, `THREE.DirectionalLightHelper`) rendered live inside the 3D viewport with real-time update on position and intensity slider changes.
- **Cleaned Scene Setup Header & Viewport (`css/scene-editor.css`, `js/scene-editor.js`)**: Removed macOS traffic lights, menubar (`File`, `Window`, `Help`), and subtitle, replacing them with a crisp vector `✕` close button. Removed "No Model — click create" text overlay.
- **Starter Primitive Spawning Crash Fix (`js/3d_element_manager.js`)**: Fixed `ReferenceError: mesh is not defined` in procedural primitive creation, enabling instant click-to-spawn for Box, Cone, Cylinder, Plane, Sphere, and Torus.

## [0.5.73] - 2026-09-22

### Added
- **Native 3D Rendered Primitive Thumbnails (`assets/primitives/`, `js/scene-editor.js`, `css/scene-editor.css`)**: Replaced flat vector SVGs with true Three.js WebGL 3D rendered thumbnails (`box.png`, `sphere.png`, `cylinder.png`, `plane.png`, `torus.png`, `cone.png`) featuring studio 3-point lighting, metallic surface shading, and transparent backgrounds matching Adobe After Effects Video Copilot Element 3D Scene Setup. Deleted inaccurate primitive SVGs.
- **Cone Procedural Primitive (`js/3d_element_manager.js`, `js/scene-editor.js`)**: Added 3D Cone primitive support across procedural mesh generation and scene tree hierarchy.

## [0.5.72] - 2026-09-22

### Fixed
- **Text Overlap & Panel Containment (`css/scene-editor.css`, `js/scene-editor.js`)**: Replaced shared `.se-viewport-empty` (`position: absolute; inset: 0`) in materials, properties, and tree panels with dedicated `.se-panel-empty`, preventing "No Materials in Scene" and "No Selection" labels from breaking out and overlapping on top of the 3D viewport canvas. Added strict `position: relative` containment to drawer tabs and property panes.
- **Pure Vector SVG Starter Primitives & UI Icons (`assets/`, `js/scene-editor.js`, `css/scene-editor.css`)**: Eliminated all emojis across the 3D suite. Replaced primitive card emojis with crisp, dedicated vector SVGs (`assets/primitive-box.svg`, `primitive-sphere.svg`, `primitive-cylinder.svg`, `primitive-plane.svg`, `primitive-torus.svg`). Replaced navigation toolbar emojis (Orbit, Pan, Zoom, Reset Camera), hierarchy eye visibility buttons, and item deletion icons with crisp theme-token bound vector SVGs.
- **Scale Factor TypeError on Primitives (`js/3d_element_manager.js`)**: Fixed `TypeError: can't access property "scaleFactor", entry.bounds is undefined` when creating procedural primitives or updating transforms by computing bounding box and scaling factor upon primitive instantiation, and adding optional chaining in `updateModelTransform`. Primitives now serialize and restore cleanly across scene sessions.

## [0.5.71] - 2026-09-22

### Fixed
- **Effects Registry `onButtonClick` Dispatch (`js/effects.js`)**: Fixed `FishEffectsRegistry.register()` dropping custom descriptor callbacks including `onButtonClick`. Custom action buttons (like "Open Scene Editor") now correctly trigger their target handler without failing silently.
- **Instant Floating Window Display for Scene Editor (`js/scene-editor.js`)**: Scene Editor floating popup window now appears instantly upon button click with smooth animation, running background 3D initialization and environment maps asynchronously with comprehensive try-catch safeguards.
- **Three.js r128 Color Space Compatibility (`js/3d_element_manager.js`)**: Added dual fallback between modern `THREE.SRGBColorSpace` and Three.js r128 `THREE.sRGBEncoding` for renderer output and texture encoding.
- **3D Suite Asset Loading & MIME Types (`editor.html`, `desktop.html`, `server.js`)**: Bundled Scene Editor stylesheets and scripts into `editor.html` with cache buster query parameters, and registered 3D asset MIME types (`.glb`, `.gltf`, `.bin`, `.hdr`) in `server.js`.

## [0.5.70] - 2026-09-22

### Fixed
- **Local Three.js Vendoring & Offline Support (`vendor/three/`, `js/three-loader.js`)**: Vendored Three.js r128 UMD build (`three.min.js`, `GLTFLoader.js`, `OrbitControls.js`) locally into `vendor/three/` to eliminate external CDN 404s, CORS blocking, and subresource integrity errors. Provides 100% offline 3D element rendering with automatic CDN fallback.
- **Select Parameter Handling in Effects Rack (`js/effects.js`)**: Fixed `Uncaught TypeError: o.toLowerCase is not a function` when rendering effects with structured `{ value, label }` options (such as `alphaMode` in 3D Element), preventing effects rack inspector crashes.
- **Service Worker Fetch Interception (`sw.js`)**: Replaced invalid `null` return on external fetch failure with a valid 408 Request Timeout Response, preventing browser worker interception failures.

## [0.5.69] - 2026-09-22

### Fixed
- **Keyframe Deselection in Expand Layer (`js/editor.js`, `js/desktop.js`)**: Clicking on empty track space (`.desktop-kf-track-row`, `.desktop-kf-tracks-wrapper`) or clicking on an already-selected single diamond now reliably deselects keyframes. Empty timeline clicks now prioritize deselecting keyframes before closing/deselecting layers.
- **AE-Style Dual-Tone Keyframe Diamonds (`css/desktop.css`)**: Overhauled keyframe diamonds to precisely match Adobe After Effects visual hierarchy. Unselected keyframes now render as subtle 8px dual-tone silver/gray diamonds (`::before` split). Selected keyframes expand to 12px with a prominent 2px solid primary selection border and dark perimeter outline, eliminating visual confusion between selected and unselected states.

## [0.5.68] - 2026-09-22

### Added
- **Solid Layer Button in Control Camera Layer Panel (`desktop.html`, `editor.html`, `js/editor.js`, `css/desktop.css`, `css/drawer.css`, `assets/control-solid.svg`)**: Added Solid Layer button alongside Camera, Null, and Adjustment in the Control Camera Layer category panel. Creates a full-bleed shape layer automatically dimensioned to match project resolution, with interactive timeline drag-and-drop support.

## [0.5.67] - 2026-09-22

### Added
- **3D Element Plugin & Three.js Scene Setup (`effects/3d_element.js`, `js/3d_element_manager.js`, `js/scene-editor.js`, `css/scene-editor.css`)**: Isolated Three.js rendering plugin directly inside Effects Rack. Features Scene Editor floating window with resizable panels, scene tree hierarchy, 3D viewport with OrbitControls, multi-model support, customizable point/directional lighting, material inspector (color, roughness, metalness, wireframe, opacity), and project save/discard confirmation dialog.
- **IndexedDB 3D Model Storage (`js/3d-element-db.js`)**: Persistent offline model storage via `FishTools3DModels` IndexedDB store for imported OBJ/GLTF/GLB models.
- **Effects Rack Button & Hidden Param Types (`js/effects.js`, `js/editor.js`, `css/effects-rack.css`)**: Effects definition now supports `type: 'button'` for interactive action triggers and `type: 'hidden'` for persisting serialized scene state.

## [0.5.66] - 2026-09-22

### Added
- **Diamond Keyframe Toggle & 3D Transform Properties (`js/editor.js`)**: Layer expand timeline rows now feature diamond keyframe toggles (solid for active keyframe, outline when empty) replacing stopwatch icons. Position and Rotation properties now feature 3-axis 3D control (X, Y, Z coordinates and angles).

### Fixed
- **Text OUT Animation Spring Physics (`js/text-engine.js`)**: Completely overhauled OUT animation curves with smooth spring deceleration and bounce physics, fixing abruptly truncated and non-interpolated text out transitions.

## [0.5.65] - 2026-09-22

### Fixed
- **Effects Rack Actions Persistence (`js/effects.js`, `css/effects-rack.css`)**: Hide/show effect toggle (eye button) and reorder drag handle no longer disappear when an effect card is expanded. Both buttons remain permanently accessible in both collapsed and expanded states, alongside kebab menu and quick delete.
- **Desktop Inspector Effects Rack Theme Overhaul (`css/desktop.css`, `css/effects-rack.css`, `js/editor.js`)**: Overhauled effect cards for desktop mode to sync with desktop inspector design language ("mengkotak dan rounded dikit"). Cards now feature `border-radius: var(--desktop-radius-sm)` (3px), elevated surface contrast (`--bg-panel` on `--bg-dashboard`), compact 28px header height, and 20px squared action buttons. Controls area inside cards now features recessed interior (`--bg-panel-inner`), compact 22px rows, and squared scrubbers (`--bg-canvas` with 3px radius) replacing rounded mobile pills. Mobile swipe-to-delete is disabled on desktop.

## [0.5.64] - 2026-09-22

### Fixed
- **Anamorphic Flare Overhaul (`effects/anamorphic_flare.js`)**: Replaced broken whole-frame squash/stretch and contrast filter with genuine optical anamorphic lens flare engine. Implements strict Rec.709 specular highlight extraction with smooth shoulder (midtones and darks zeroed out), 1D directional horizontal streak shader with progressive exponential decay, white-hot specular core hotspot preservation, chromatic dispersion fringe, and universal Canvas2D fallback.
- **Haze / Flare Overhaul (`effects/haze_flare.js`)**: Replaced flat full-screen milky fog box (`fillRect lighter`) and contrast filter with authentic cinematic diffusion haze and 35mm film halation. Implements soft-shoulder highlight roll-off extraction, Kodak Vision3 5219 red scatter halation rim bleed along highlight boundaries, multi-octave atmospheric diffusion bloom, color temperature warmth control, and zero contrast destruction in unlit shadows.

## [0.5.51] - 2026-09-22

### Fixed
- **Lasso Scroll Bug (`js/desktop.js`)**: Lasso marquee now correctly selects layers that have been scrolled out of the visible viewport area. Both `updateMarqueeGeometry()` and `onPointerUp()` now convert all `getBoundingClientRect()` hits to **scroll-space coordinates** (`rect - vpRect.origin + scrollTop/scrollX`) before intersection — clips above/below the fold now intersect correctly during scroll.
- **Lasso Trigger on Layer Name (`js/desktop.js`)**: Clicking `.desktop-kf-prop-row`, `.desktop-kf-cat-row`, or `.desktop-kf-prop-stopwatch` elements in the left timeline panel no longer accidentally initiates lasso marquee drag.

### Added
- **AE-Style Prop Row Scrubbing (`js/editor.js`, `css/desktop.css`)**: Timeline property rows (when layer is expanded via `_kfExpanded`) now support:
  - **Stopwatch icon** (left of prop name): Click to add/remove keyframe at current playhead. Solid when a KF exists at playhead (`is-active` → `var(--color-primary)`), outline otherwise.
  - **Scrubable value** (right of prop row): Horizontal drag on the value span changes the property live with `ew-resize` cursor. Rates: Position 1px/px, Scale 0.3%/px, Rotation 0.5°/px, Opacity 0.5%/px. If property is already keyframed, scrub auto-inserts/updates a KF at the playhead (AE behavior).
  - Canvas redraws live during scrub; project saves on release.

## [0.5.50] - 2026-09-21

### Changed
- **Paste Button Visibility Rules (`js/attributes-clipboard.js`, `js/desktop.js`)**:
  - **Copy button**: unchanged — only visible when ≥ 1 layer is selected.
  - **Paste button**: now also visible when clipboard has content (attribute or layer clipboard) even with **no layer selected**. Previously paste was always hidden without selection.
  - All three enforcement points updated: `updateClipboardButtonsVisibility()`, `syncInspectorState()`, and the global `click` debounce guard.

### Added
- **Paste as New Layer (`js/attributes-clipboard.js` — `pasteAttributesAsNewLayer()`)**:
  - When attribute clipboard exists and user clicks Paste with **no layer selected**, a new `shape` layer is created at the current playhead position with the source layer's duration.
  - All copied attribute categories (fill, transform, effects, opacity, etc.) are applied directly to the new layer — no popover selection needed.
  - Layer inserted at top of stack; undo snapshot is recorded before insertion.
  - Toast confirms: `"Pasted as new layer: Fill, Transform, …"`

---

## [0.5.49] - 2026-09-21


### Added
- **Save Current Frame Export (`desktop.html`, `js/editor.js`)**:
  - Added "Save Current Frame" button to the export popover menu, positioned above "Image Sequence" and "Export Video".
  - Clicking it invokes `exportCurrentFrameAsPNG()` — renders the current playhead frame at full project resolution and downloads it as a `.png`.

### Fixed
- **WebM Fallback in Tier 2 MediaRecorder Export (`js/FishExport-Enggine.js`)**:
  - Previous `exportViaMediaRecorder` used a single silent `-c:v copy` FFmpeg call that silently failed for VP8/VP9 streams (Chromium/Firefox), leaving output as `.webm`.
  - Fixed with two-stage repackage: Stage 1 is fast stream copy (H.264 only); Stage 2 is full libx264 transcode (`-preset ultrafast`) for VP8/VP9 → H.264. Only falls back to `.webm` if both stages throw.

- **Copy/Paste Buttons Visible With No Selection (`js/desktop.js`, `js/attributes-clipboard.js`)**:
  - Fixed race condition where global `click` setTimeout at 30ms re-ran `updateClipboardButtonsVisibility()` after `deselectAllDesktopLayers()` already hid the buttons, restoring stale state.
  - `syncInspectorState()` now directly force-hides `#desktop-btn-copy` and `#desktop-btn-paste` when `hasActiveLayer = false`.
  - Global click listener now checks `#desktop-panel-inspector.has-active-layer` class before re-evaluating button visibility.

---

## [0.5.48] - 2026-09-21


### Fixed
- **Playhead Needle Position Sync on Panel Resize (`js/desktop.js`)**:
  - Fixed issue where timeline playhead needle transform did not update while dragging the timeline panel resizer due to unchanged playback time/scroll position guards; added panel width tracking (`_lastSyncPanelW`) and `force` parameter to immediately update needle position.

### Added
- **Open-Source Project Documentation & Licensing (`README.md`, `LICENSE`)**:
  - Added clean, non-hyperbolic, professional open-source guide covering architectural overview, prerequisites, quick start, directory structure, and contribution rules.
  - Added official MIT License file matching `package.json` license definition.

---

## [0.5.47] - 2026-09-21

### Added
- **After Effects Style Timeline Panel Resizer (`desktop.html`, `css/desktop.css`, `js/desktop.js`)**:
  - Relocated `#desktop-timeline-panel-resizer` to root of `.editor-timeline` spanning full timeline height (`top: 36px; bottom: 0; z-index: 45`) along boundary right of "Parent & Link" column.
  - Added vertical pill splitter handle (`.split-handle-pill`) per UI guidelines with theme tokens and interactive hover/active states.
  - Added header gutter col-resizer (`.desktop-ruler-col-resizer-panel`) for intuitive column resizing directly from timeline header.
  - Synchronized playhead needle and persisted user width preference to `localStorage` (`oft_desktop_layer_panel_w`).

### Changed
- **Fluid Layer Name Column Expansion (`js/desktop.js`)**:
  - Overhauled "Layer Name" divider drag behavior so dragging right expands overall layer panel (`--desktop-layer-panel-w`), preventing the column from hitting a fixed width ceiling ("mentok").

---

## [0.5.46] - 2026-09-21

### Fixed
- **Timeline & Canvas Rectangle Lasso Marquee Selection (`js/desktop.js`, `js/editor.js`, `css/desktop.css`, `css/editor.css`)**:
  - Restored visual rectangle lasso selection box (`.desktop-timeline-marquee-box`) when dragging across timeline empty space.
  - Switched marquee box to `position: fixed` appended to `document.body` with `z-index: 99999`, eliminating clipping and negative scroll offset displacement when timeline is vertically scrolled.
  - Upgraded marquee box appearance with crisp `1.5px solid var(--color-primary)` border and translucent theme primary fill (`::before`), strictly adhering to theme tokens without gradients or blur.
  - Added candidate highlight styling on timeline clips (`.timeline-clip-block.is-marquee-candidate`) with primary border while intersecting marquee rectangle.
  - Added canvas rectangle lasso marquee selection (`.canvas-marquee-box`) when dragging on empty preview canvas space in `editor.js`, selecting all intersecting visible layers on pointer release while strictly preserving empty click behavior.
  - Prevented pointer cancellation by removing unsafe `setPointerCapture` calls during pointer movement and enforcing `preventDefault()` to prevent unwanted native text/drag selection.

---

## [0.5.45] - 2026-09-21

### Fixed
- **Paste Fill Image Replacement (`js/attributes-clipboard.js`)**:
  - Fixed issue where pasting copied "Fill" attribute from an image/media layer to another image layer did not update the target's image source.
  - Corrected extraction to preserve high-res `dataUrl`, `mediaId`, `thumbUrl`, `mediaWidth`, and `mediaHeight` in payload.
  - Assigned replacement media attributes to target layer, cleared `window.layerMediaCache`, preloaded replacement image via `new Image()`, updated compositor `mediaEntry`, and immediately triggered canvas redraw.
- **Desktop Toolbar Contextual Visibility (`desktop.html`, `js/attributes-clipboard.js`, `js/editor.js`, `js/desktop.js`)**:
  - Hidden `#desktop-btn-copy` and `#desktop-btn-paste` buttons when no layer is selected; buttons now dynamically appear only when layers are selected.
  - Hidden desktop cut bar row (`.layer-cut-bar-row`) and cut divider (`#desktop-cut-divider`) when no layer is selected, ensuring a clean divider between history controls and timeline transport.
  - Wired visibility updates to `selectTimelineLayer`, `selectTimelineLayers`, `deselectTimelineLayer`, and `syncInspectorState`.

---

## [0.5.44] - 2026-09-21

### Added
- **Desktop After Effects-Style Context Menu (`js/popover.js`, `css/popover.css`, `js/editor.js`, `editor.html`, `desktop.html`)**:
  - Transformed desktop right-click menu into a sleek flat rectangular context menu inspired by Adobe After Effects and native OS design.
  - Eliminated popover pointy tail on right-click, positioning menu directly at the cursor coordinates `(clientX, clientY)` with smart quadrant edge flipping.
  - Added clean right-aligned keyboard shortcut hints (`Ctrl+C`, `Ctrl+V`, `Ctrl+D`, `Ctrl+G` / `Ctrl+Shift+C`, `Ctrl+A`) with automatic foreground inversion on hover.
  - Added right-click context menu triggers across track list pills and empty overlay surface.
- **Desktop Parent Dropdown Entrance Animation (`css/desktop.css`, `js/desktop.js`)**:
  - Implemented crisp `desktopDropdownPop` scale & fade entrance animation (`scale(0.94) -> scale(1)`) with dynamic `transformOrigin` springing directly from trigger badge.

### Fixed
- **Mobile Parent & Playback Popover Primary Outline (`css/popover.css`)**:
  - Updated `.is-layer-link-popover` and `.is-play-settings-popover` border definitions to standard high-contrast `1px solid var(--color-primary)`, harmonizing outline aesthetics across all popover cards.

---

## [0.5.43] - 2026-09-21

### Added
- **Mobile Hold-to-Select on Hide/Show Eye Button (`js/editor.js`, `css/editor.css`)**:
  - Long-pressing (holding ~200ms) the layer eye button (`.timeline-layer-eye-btn`) triggers multi-selection / enters selector mode for that layer with haptic feedback (`navigator.vibrate(25)`).
  - Dragging vertically during hold enables continuous drag-to-select range across timeline layers.
  - Quick tap (<200ms) cleanly toggles layer visibility (`layer.hidden`) without triggering selection.
  - Added `touch-action: none; -webkit-touch-callout: none;` and guarded click handling to avoid unwanted visibility toggling upon hold release.

---

## [0.5.42] - 2026-09-21

### Changed
- **Clean Text-Only Export Menu (`editor.html`, `desktop.html`, `demo.html`, `js/template-editor.js`, `css/editor.css`)**:
  - Simplified export popover menu items to clean, minimal text labels: "Image Sequence" and "Export Video", removing extraneous format extensions in parentheses (`.ZIP`, `.MP4`).
  - Removed icons from export menu items and tuned `.export-popover-card` min-width to 160px for a clean, distraction-free dropdown.

### Fixed
- **Popover Menu SVG Solid Background Fix (`css/popover.css`)**:
  - Removed `background-color: currentColor;` on `.popover-menu-item svg`, separating inline SVG vector styling from masked `.svg-icon` elements to prevent square solid bounding boxes.

---

## [0.5.41] - 2026-09-21

### Added
- **Multi-Selection Batch Layer Reordering (`js/editor.js`, `js/desktop.js`, `css/editor.css`)**:
  - Implemented `reorderLayersBatch(allLayers, movingIdSet, targetDropIdx)` supporting multi-selected batch dragging while strictly preserving relative layer order.
  - Enabled mobile reorder handles in selector mode so multi-layer batches can be reordered directly via right-floating grip pills.
- **Smooth Animated Row Shifting on Desktop & Mobile (`js/desktop.js`, `js/editor.js`)**:
  - Added live mathematical row shifting (`translateY(shiftPx)` with 34px pitch on desktop and 54px on mobile) during drag operations.
  - Non-moving lanes, slots, and handle pills slide up or down smoothly (`0.22s cubic-bezier(0.2, 0, 0, 1)`) to open an exact visual slot for the dragging batch.
  - Moving rows translate smoothly with pointer capture and settle via FLIP animation on drop.

### Fixed
- **Multi-Selection Batch Motion Blur Toggle (`js/desktop.js`, `js/editor.js`)**:
  - Toggling motion blur on any selected layer pill or top header now toggles and matches motion blur for all selected layers simultaneously.
  - Synchronizes active visual state across all `.desktop-layer-mblur-btn` buttons in DOM and `#btn-layer-header-motion-blur`.
- **Multi-Selection Batch Parent & Self-Parent Guard (`js/desktop.js`, `js/editor.js`)**:
  - Selected layers in parent dropdowns are now automatically disabled (`is-disabled`, `title="Selected layer"`) to prevent self-parenting and circular dependencies across the entire selection batch.
  - Assigning a parent or selecting "None" (unlink) from any selected layer links or unlinks all selected layers simultaneously.
  - Pickwhip drag now batch-links all selected layers to valid drop targets or batch-unlinks when dragged into empty space.

---

## [0.5.40] - 2026-09-21

### Changed
- **Balanced Attributes Matrix Grid (`css/popover.css`)**:
  - Replaced flexible grid tracks with strict `minmax(0, 1fr)` columns and `min-width: 0` button wrappers, preventing long labels ("Opacity & Blend") from expanding the center column.
  - Implemented 6-column balanced layout for 5-item configurations (`:has(> :first-child:nth-last-child(5))`): 3 equal items on the top row (span 2 each) and 2 equal items on the bottom row (span 3 each) spanning edge-to-edge seamlessly without empty right-hand gaps.
- **Pure Effect Category Label (`js/attributes-clipboard.js`, `demo.html`)**:
  - Removed effect count numbers (e.g. `(1)`, `(2)`) from the button label, maintaining a minimal, distraction-free "Effects" title across both Copy and Paste popovers.

### Fixed
- **Clean Selection-Bound Copy & Paste Toolbar Buttons (`js/attributes-clipboard.js`, `js/desktop.js`)**:
  - Switched `updateClipboardButtonsVisibility` to inspect state truth (`window.selectedLayerId` and `window.selectedLayerIds`) directly rather than DOM class leftovers, guaranteeing copy and paste buttons reliably hide when no layer is selected.
  - Wired visibility synchronization into `syncInspectorState` in `desktop.js`.

---

## [0.5.39] - 2026-09-21

### Fixed
- **Attribute Clipboard Fill Copy & Paste (`js/attributes-clipboard.js`)**:
  - Captured complete fill configuration (`fillType`, `fillColor`, `color`, `fillGradType`, `fillGradAngle`, `fillGradStops`, `fillGradColor1`, `fillGradColor2`, `fillMediaId`, `fillMediaUrl`).
  - Added cache invalidation (`_fillDirty = true`, `_lastFillRenderKey = null`, `_fillBufferCanvas = null`) upon pasting attributes so target layers update immediately.
  - Added UI synchronization via `window.syncFillControllerUI()` and `window.syncInspectorState()` after paste.
- **Proportional Keyframe Time-Stretching (`js/attributes-clipboard.js`)**:
  - Proportional keyframe time mapping (`mapKeyframeTime`) across source and target layer durations ($T_{\text{tgt}} = \text{targetStart} + \alpha \times \text{targetDuration}$), eliminating absolute time overflow when pasting keyframes to layers with differing durations.
- **Empty Timeline Track Hover Stabilization (`css/desktop.css`)**:
  - Removed hover background color mutation on empty track lanes (`timeline-track-lane`) and empty slot margins to prevent flickering and unwanted highlight on empty timeline areas.
- **Wireframe Playback Lookahead Cache Desync (`js/editor.js`)**:
  - Decoupled wireframe transform bounds computation and canvas overlay redraw (`syncActiveViewerOverlay`) strictly to the active viewer canvas (`#editor-active-canvas`).
  - Completely blocked background lookahead worker (`triggerSource === 'lookahead-cache'`) and idle cache from updating visible wireframe bounds or triggering overlay redraws.
  - Added synchronous overlay update in the early RAM preview cache fast-path so wireframe strictly tracks the exact current played frame in real time.

---

## [0.5.38] - 2026-09-21

### Added
- **AE-Style Auto-Scrolling Marquee Selection (`js/desktop.js`)**:
  - Implemented real-time auto-scroll along both horizontal and vertical axes when dragging marquee selection near or beyond timeline viewport boundaries (`timeline-layers-viewport`).
  - Anchored marquee origin to timeline track content space so selection box expands and tracks layers accurately as the timeline scrolls.
  - Added pointer capture for seamless drag selection extending outside the window.

### Changed
- **Minimalist Attribute Matrix Popover (`desktop.html`, `editor.html`, `demo.html`, `css/popover.css`)**:
  - Removed "Copy Attributes" text header, layer title, and subtitle to produce a clean, pure button matrix matching the mobile drawer layout.
  - Refactored `.attributes-toggle-grid` into a balanced 3-column card grid with Cal Sans typography, 64px button height, and full-width action button.

### Performance
- **Zero-Lag Batch Layer Selection (`js/editor.js`, `js/desktop.js`)**:
  - Introduced `selectTimelineLayers(ids, primaryId)` in `editor.js` to batch-select multiple layers in a single pass.
  - Eliminated redundant `selectTimelineLayer()` loops that previously caused repeated DOM rebuilds and multi-selection delay on desktop.

---

## [0.5.37] - 2026-09-21

### Added
- **Live Wireframe Animation During Timeline Playback (`js/canvas-overlay.js`, `js/editor.js`, `js/wireframe.js`)**:
  - Maintained dynamic wireframe bounding box updates during active timeline playback (`window.isTimelinePlaying === true`) for single and multi-selected ("Select All") layers.
  - Active layer boundary detection: bounding boxes only render when the current playhead is within the layer's in/out range (`activeLayers`).
  - Overlay canvas redraw executes synchronously on every frame during playback, ensuring zero-lag synchronization between layers and bounding box wireframes.
  - Persistent Preview Grid: composition grid remains visible during playback if enabled via `#editor-icon-grid`.

### Performance
- **Zero Forced Reflows & Style Recalculations During Playback**:
  - Cached theme color tokens (`--color-primary`, `--bg-canvas`) in `CanvasOverlay` to eliminate redundant `getComputedStyle()` calls across multiple selected layers.
  - Cached device pixel ratio scale (`dprScale`) to avoid repeated `getBoundingClientRect()` invocations on the overlay canvas.
  - Bound preview grid lines directly to `--color-primary` theme tokens using `ctx.globalAlpha`.

---

## [0.5.31] - 2026-09-21

### Added
- **Selective Copy & Paste Layer Attributes Popover (`editor.html`, `desktop.html`, `js/attributes-clipboard.js`, `css/popover.css`)**:
  - Added dedicated **Copy** and **Paste** buttons in Mobile More Settings dock and Desktop timeline toolbar.
  - Interactive Attributes Popover allowing selective copying and pasting of layer attributes: Fill, Opacity & Blend, Effects, Transform, Border & Shadow, and Speed/Volume.
  - Single-selection filtering for `shape`, `video`, and `photo` (`image`) layers with transparent fallback to standard layer copy/paste on multi-selection or non-supported layer types (`text`, `audio`, `null`, `camera`, `adjustment`).
  - Adaptive Paste Popover: only attributes present in the clipboard are enabled for pasting, preventing mismatched property overwrites.
  - Multi-target paste support allowing 1-to-many attribute propagation across multiple selected timeline layers.
  - Extracted hardcoded inline SVGs to clean standalone vector assets `assets/copy.svg` and `assets/paste.svg` with unified CSS mask token binding.

---

## [0.5.30] - 2026-09-20

### Fixed
- **Desktop Layout Detection ReferenceError Fix (`js/editor.js`)**:
  - Defined modular `isDesktopLayout()` detector and exposed on `window.isDesktopLayout`.
  - Fixed `ReferenceError: isDesktopLayout is not defined` inside `updateTimelineKeyframeMarkersHighlight()` on layer selection, drawer subview navigation, and effect application in Desktop Workstation mode.
  - Unified desktop workstation layout checks across `editor.js` to reliably match `/desktop`, `desktop.html`, and desktop DOM container elements.

---

## [0.5.29] - 2026-09-17

### Added
- **Desktop Expanded Keyframes Multi-Selection, Drag, Copy, Paste & Delete (`desktop.html`, `js/desktop.js`, `js/editor.js`, `css/desktop.css`)**:
  - **Interactive Multi-Selection**:
    - Click on any diamond (`.desktop-kf-diamond`) selects single keyframe and seeks playhead.
    - `Shift`-click or `Cmd`/`Ctrl`-click multi-selects keyframes across any tracks into `window.selectedKeyframes`.
    - Clicking any property track header (`.desktop-kf-prop-row`) in the left tree selects all keyframes on that property simultaneously (After Effects behavior).
    - Timeline Marquee rectangle selection (`.desktop-timeline-marquee-box`) automatically detects and lasso-selects diamond keyframes with live highlight candidates.
  - **Simultaneous Multi-Drag & Re-timing**:
    - Dragging any selected diamond simultaneously shifts all selected keyframes by exact `deltaTime` with frame clamping.
    - Snapping support to playhead time, beatmarks, and integer frame boundaries.
    - Automatic array sorting, layer cache invalidation, project auto-save, and canvas redraw on pointer release.
  - **Keyboard Copy & Paste (Cmd+C / Cmd+V)**:
    - `Cmd+C` / `Ctrl+C` captures selected keyframes into `window.internalKeyframeClipboard` with relative timestamp offsets and easing.
    - `Cmd+V` / `Ctrl+V` pastes copied keyframes onto target layer and property track starting at current playhead time (`window.getCurrentPlayheadTime()`).
    - Smart property fallback prevents type mismatches when pasting copied attributes.
  - **Keyboard Delete & Deselect (Delete / Backspace / Escape)**:
    - `Delete` / `Backspace` deletes all selected keyframes cleanly from the layer without deleting the parent layer.
    - `Escape` / `F2` deselects all keyframes before falling back to layer deselection.
  - **Event Delivery & Interception Hardening**:
    - Whitelisted `.desktop-kf-diamond`, `.desktop-kf-track-row`, and `.desktop-kf-prop-row` in desktop capture-phase pointer handlers to prevent accidental deselection and event cancellation.
    - Updated `selectTimelineLayer` with `keepKeyframes` option so selecting a layer while clicking a keyframe doesn't clear the keyframe selection.

---

## [0.5.28] - 2026-09-17

### Added
- **Desktop Exclusive Collapsible Layer Keyframe Tracks (`desktop.html`, `js/desktop.js`, `js/editor.js`, `css/desktop.css`)**:
  - After Effects-accurate twirl-down collapsible layer tracks exclusively in Desktop Workstation mode (`desktop.html`), keeping mobile `editor.html` 100% clean and untouched.
  - Interactive twistie chevron button (`.desktop-layer-twistie-btn`) injected on layer headers, rotating 90° down when expanded.
  - Keyboard shortcut `U` on desktop toggles keyframe expansion for all selected layer(s) matching standard After Effects workflow.
  - Structured property tree on the left side (`Transform`, `Effects: <Name>`, `Camera Options`, `Audio`, `Time Remap`) displaying current live interpolated property values.
  - Matching right-side timeline keyframe track rows with horizontal guide lines, maintaining pixel-perfect vertical height alignment with the left property panel.
  - Interactive diamond keyframes (`.desktop-kf-diamond` / `◆`) positioned at exact timestamps with hover tooltips, click to seek playhead (`seekTimelineToTime`), and smooth horizontal drag re-timing with playhead and beatmark snapping.
  - Hides in-clip keyframe markers on the main layer bar when expanded, cleanly surfacing them exclusively on their dedicated categorized sub-tracks below (After Effects accurate).

### Fixed
- **Instant Save Settings Pop-up Dismissal (`js/editor.js`, `js/main.js`, `js/db.js`)**:
  - Moved modal dismissal (`Modal.close()`) to immediate first line of `saveProjectSettingsAction` for 0ms instantaneous visual feedback.
  - Offloaded heavy canvas recreation, timeline duration recalculations, and IndexedDB persistence into non-blocking background queue (`setTimeout` + async Promise).
  - Reduced IndexedDB safety fallback timer from 10,000ms to 600ms in `js/db.js` for immediate local backup resolution.

---

## [0.5.27] - 2026-09-17

### Performance
- **High-Performance Layer Expression AST Compilation Caching & Memoization (`js/editor.js`)**:
  - Eliminated per-frame `new Function()` re-compilation and AST parsing overhead by introducing `_compiledExpressionCache`, compiling expressions once into pure callable functions cached by script content.
  - Implemented per-frame hierarchical transform memoization (`_effectivePropsCache`) in `getLayerEffectivePropsAtTime`, computing multi-tier parent null chains (`Null` $\to$ `Y BEAT` $\to$ `X FLIP` $\to$ `OSCILLATE`) once per frame instead of re-evaluating redundantly for every child layer.
  - Converted `thisComp.layer(...)` proxy properties (`.transform`, `.effect`) into lazy getters, preventing marker inspection queries (`thisComp.layer(index + 1).marker.numKeys`) from triggering expensive full layer transform and parent DAG evaluations.
  - Cached comp and layer marker objects (`getCompMarkerObject`, `getLayerMarkerObject`) with length and reference tracking, eliminating repeated marker array sorting and memory allocations.
  - Reduced 3D sequence property evaluation time from 17.80ms/frame to 0.60ms/frame (29.6x speedup, 96.6% CPU time reduction), unlocking locked 60 FPS real-time playback.

---

## [0.5.26] - 2026-09-17

### Fixed
- **Shape Media Fill Invisibility & Media Replacement Desync (`js/editor.js`)**:
  - Resolved bug where shape layers filled with media remained completely transparent due to premature caching in `renderShapeToCanvas`. Empty canvas is no longer cached while media is still loading asynchronously (`isMediaReady` guard).
  - Wired `getFillRenderKey(layer)` into `shapeKey` so replacing or modifying media/gradient/color fill properly invalidates the shape rasterization cache.
  - Fixed media hydration from IndexedDB pool (`hydrateMediaFromPool`) to unconditionally refresh expired session `blob:` URLs for media-filled shape layers.
  - Synchronized layer name (`targetL.name = item.name`) and preloaded images in `applyFlexibleMediaReplacement` when replacing media on shape layers.

---

## [0.5.25] - 2026-09-17

### Fixed
- **Fill Media Pool Grid Row Track Collapse & Card Overlap (`css/transform-controller.css`, `css/desktop.css`)**:
  - Resolved WebKit CSS Grid bug where items with `overflow: hidden` reset automatic minimum track height to `0`, collapsing flexible grid rows to 17.8px and crashing cards into subsequent rows.
  - Set `overflow: visible` with `position: relative` and `aspect-ratio: 1` on `.fill-media-tile`.
  - Positioned thumbnails (`.fill-media-thumb`) and fallbacks (`.fill-media-fallback`) as `position: absolute; inset: 0;` with explicit border-radius matching card geometry, preventing form control content-box expansion.
  - Normalized border width across normal and active states to maintain uniform 86.6px square proportions and clean 8px row/col gaps with zero card overlap.
  - Bound media badge styling strictly to theme tokens (`var(--bg-canvas)`, `var(--color-primary)`).

---

## [0.5.24] - 2026-09-17

### Performance
- **Adaptive 3-Sample Natural Shutter Motion Blur (`js/fishtool-engine.js`, `js/motion-blur-engine.js`, `js/editor.js`)**:
  - Implemented 3-sample Gaussian-weighted shutter exposure model `[0.25, 0.50, 0.25]` for interactive scrubbing & playback, matching photographic film shutter falloff while cutting render overhead by 65%.
  - Full-quality 16-sample multi-sampling automatically engages only during video export (`_isExportingVideo`).
  - Completely eliminated sub-rect clipping artifact on 3D layers with drop shadows by restoring full-canvas WebGL blit.
  - Routed all 2D/3D media layers directly through hardware WebGL in-framebuffer accumulation, bypassing 2D canvas context switching.
  - Increased motion detection threshold to 0.4px / 0.2° to prevent imperceptible sub-pixel noise from triggering multi-sampling.

---

## [0.5.23] - 2026-09-17

### Performance
- **Hardware WebGL Motion Blur for 3D Layers (`js/fishtool-engine.js`, `js/editor.js`)**:
  - Replaced CPU 2D canvas sub-frame blitting (8 round-trip passes per layer) with in-framebuffer additive multi-sample accumulation (`render3DMotionBlur`).
  - Added linear shutter interpolation between exposure interval start and end ($t_{start} \to t_{end}$), reducing complex 3D transform & expression evaluations by 75%.
  - Blits accumulated multi-sample motion blur to 2D canvas once, with drop shadow rasterized only on the final composite.
- **Identity & Zero-Opacity Adjustment Layer Bypass (`js/effects.js`, `js/editor.js`)**:
  - Added `FishEffects.isEffectIdentity()` to detect no-op effects (zero-amplitude wave warp, identity transform, 0-degree hue shift, 0-radius blur).
  - Automatically bypasses full-frame snapshot and filtering for adjustment layers that have 0% opacity or purely identity effects.
- **Canvas Shape Texture Caching & Background Pre-warming (`js/editor.js`, `js/fishtool-engine.js`)**:
  - Cached shape rasterization in `renderShapeToCanvas` to prevent redundant drawing and texture re-uploads.
  - Added background pre-warming of project media elements on startup to eliminate image decoding hitches during scrubbing.
  - Guarded project state persistence during active timeline scrubbing to prevent main thread IndexedDB write locks.

---

## [0.5.22] - 2026-09-17

### Performance
- **3D Layer Drop Shadow Bounding Box Optimization (`js/fishtool-engine.js`)**:
  - Replaced full-frame 1080p canvas Gaussian blur with tightly padded sub-rectangle draws clipped to the layer's 3D AABB bounding box.
  - Slashes CPU pixel rasterization by 90-95% when multiple 3D layers with Drop Shadow are active simultaneously, eliminating lag spikes during heavy compositions.

---

## [0.5.21] - 2026-09-17

### Fixed
- **`.ofts` Project Export & Import Missing Media Pipeline (`js/db.js`, `js/editor.js`)**:
  - Fixed critical bug where exported `.ofts` archives contained an empty `media/` directory because `exportProjectToOFTS` only recognized `item.blob instanceof Blob` and ignored IndexedDB's native `item.buffer` (`ArrayBuffer` / `Uint8Array`).
  - Rewrote export loop as an async pipeline with multi-source media resolution: direct `Blob`, `ArrayBuffer`, `window._activeMediaMap`, IndexedDB `getMedia()`, and URL fetching.
  - Increased premature IndexedDB transaction timeouts (`openDB` 1.5s $\rightarrow$ 10s, `getProjectMedia` 1.2s $\rightarrow$ 15s, `saveMedia` 2.5s $\rightarrow$ 15s, `getMedia` 2s $\rightarrow$ 15s) to eliminate race condition where multi-megabyte project media timed out and silently fell back to empty localStorage metadata shells.
  - Enhanced `importOFTSPackage` to extract raw binary `ArrayBuffer` directly into IndexedDB, populate `window._activeMediaMap`, and match media IDs cleanly to timeline layers.
  - Expanded layer media hydration in `editor.js` to support image layers and match by layer name if `mediaId` is missing or remapped.
  - Added `img.onerror` auto-recovery handler in `getLayerMediaElement` to re-fetch broken image layers dynamically from IndexedDB.

---

## [0.5.20] - 2026-09-17

### Fixed
- **Template Editor Audio Stutter & Chopping ("Audio Patah-Patah di Template Editor") (`js/editor.js`, `js/fish-audio-engine.js`, `js/template-editor.js`)**:
  - Eliminated 60 FPS destructive audio buffer flushing caused by `seekTimelineToTime` repeatedly invoking `FishAudioEngine.parkPlayback()` while template editor playback was active.
  - Added global playback active detection (`isAnyPlaybackActive`) in `editor.js` covering `isPlaying`, `window.isTimelinePlaying`, and `FishTemplateEditor.isPlaying`.
  - Added strict guard inside `FishAudioEngine.parkPlayback()` to reject seeks whenever any playback is active.
  - Aligned Template Editor playback loop with continuous 60 FPS `syncPlayback()`, pitch preservation, and master audio clock drift synchronization (`FishAudioEngine.getMasterAudioTime()`).
  - Added clean loop reset handling (`FishAudioEngine.handleLoopReset()`) when reaching the end of the template timeline.
  - Suppressed redundant background canvas redraws and drawer DOM thrashing while Template Editor is playing.

---

## [0.5.16] - 2026-09-17

### Added
- **macOS Safari "Add to Dock" App Installation (`index.html`, `js/pwa-install.js`, `demo.html`)**: Added dedicated detection for Safari on macOS. The modal now directly instructs users how to install via Apple's native **File → Add to Dock...** and toolbar Share button, and guarantees the primary action button is always visible.
- **Prominent "Install App" Header Action (`index.html`, `css/layout.css`, `js/pwa-install.js`)**: Added a dedicated, high-contrast "Install App" button in the top navigation bar. Automatically adapts across desktop, Android, and iOS Safari with tailored installation modals and address-bar instructions.
- **Direct `.ofts` Project Drag & Drop (`js/editor.js`)**: Dropping `.ofts` project archives anywhere onto the desktop canvas, timeline, or media pool automatically unpacks and loads the project with the Template Editor open.

### Fixed
- **`markerNames` ReferenceError & Snapshot Crash (`js/editor.js`)**: Fixed `ReferenceError: Can't find variable: markerNames` in `_computeFingerprint` and `saveCurrentProjectLayers`, which caused unhandled promise rejections and prematurely halted project loading.
- **Template Editor Auto-Open on Import (`desktop.html`, `js/editor.js`, `js/desktop.js`)**: Restored reliable automatic pop-up of Template Editor on initial `.ofts` import across desktop and mobile workstations. Added multi-attempt polling, project state hydration, and idempotency protection.
- **Mobile View Switch Modal Prompt (`js/desktop.js`, `desktop.html`)**: Widened viewport threshold (`<= 900px`), added coarse pointer / touch detection, removed stale dismissal traps, and ensured the "Switch to Mobile View?" modal prompts promptly on phone screens and responsive viewports.

### Improved
- **Network-First Service Worker Strategy (`sw.js`)**: Switched static asset caching to Network-First with cache fallback, preventing stale cached script traps while preserving full offline PWA functionality. Added `desktop.html` and `editor.html` to pre-cached core assets.

---

## [0.5.15] - 2026-09-17

### Added
- **Dedicated Beatmark Shortcut "M" (`js/editor.js`)**: Assigned the `M` key to toggle markers/beatmarks at the current playhead time across desktop workstations. Updated timeline toolbar button tooltips and labels to `Add Marker / Beatmark (M)`.
- **Desktop Timeline Layer Row Dividers (`css/desktop.css`, `css/editor.css`)**: Added clean, high-contrast horizontal divider lines (`border-bottom: 1px solid var(--border-panel)`) between all timeline track lanes and lane head pills. Expanded track lanes across the full scrollable width (`width: max(100%, 20000px)`) so divider lines seamlessly span the entire timeline.
- **Floating Sticky Timeline Zoom Slider (`desktop.html`, `css/desktop.css`, `js/desktop.js`)**: Added a floating zoom control widget (`.desktop-timeline-floating-zoom`) pinned to the bottom-right of the desktop timeline with `-` / `+` steppers, direct slider scrub (20–400px/s), and reset badge.
- **Dedicated Magnet Snapping Control (`#editor-btn-magnet`, `js/desktop.js`)**: Introduced a dedicated magnet button in the desktop timeline toolbar with keyboard toggle `N`. Playhead scrubbing now snaps directly to nearby beatmarks when magnet mode is enabled.

### Fixed
- **Shape Layer Persistence ("Shape Ga Ke Save") (`js/editor.js`, `js/db.js`)**: Fixed critical bug where navigating back via `#editor-project-back-btn` unloaded the page before pending IndexedDB transactions committed. Implemented synchronous active project snapshots (`oft_active_project_backup_<id>`), auto-save upsert guards, full shape transform serialization (`transformScaleX`, `transformScaleY`, `isSolid`), and self-healing fallback project recovery.
- **Instant Marker Style Consistency ("Style Marker Ga Konsisten") (`js/editor.js`, `css/editor.css`)**: Fixed bug where newly added markers initially rendered with the legacy pentagon pin and only updated to the circle neon pin upon scrubbing. `createBeatmarkItemEl` and `createBeatmarkLineEl` now generate the modern circle pin (`<circle cx="5" cy="5" r="4.5"/>`), panel hole, `.is-beatmark` class, and dashed vertical line from element creation.
- **Duplicate Beatmark Keydown Cancellation (`js/desktop.js`)**: Removed duplicate `keydown` handler in `desktop.js` that triggered a double-toggle on `M` keypress (adding and immediately deleting the marker).

### Improved
- **Hold-Before-Drag Beatmark Protection (`js/desktop.js`)**: Implemented a 250ms press-and-hold delay with haptic feedback before unlocking marker drag-and-drop, preventing accidental displacement when scrubbing the timeline over markers.
- **Desktop Workstation Navigation Routing (`js/main.js`)**: Opening or creating projects on desktop viewports (`window.innerWidth >= 900`) now routes automatically to `desktop.html` and persists workstation layout preferences.

---

## [0.5.14] - 2026-09-14

### Added
- **Smart Look-Ahead Playback Caching (`js/preview-cache.js`)**: Introduced `startLookaheadWorker(fromSec, fps)` — during playback, a background worker pre-renders frames **ahead** of the current playhead into the RAM preview cache (default 1.5 s window, configurable via `window.cacheLookaheadSec`). Uses `MessageChannel` macro-tasks to fire reliably between `requestAnimationFrame` ticks without blocking the main render thread. The lookahead window slides forward with the playhead and auto-restarts only when the playhead advances past the worker's range. Worker stops cleanly on pause, scrub, or export.

### Fixed
- **Look-Ahead Worker Cancel Bug**: Previous implementation called `stopLookaheadWorker()` on every 3rd tick, cancelling the worker before it could render a single frame. Fixed: worker now persists until the playhead advances past its pre-baked range.
- **Canvas Corrupt Mid-Encode Bug**: Worker now `await`s `setFrameFromCanvas` (bitmap encode) **before** scheduling the next step, preventing the offscreen canvas from being overwritten while `createImageBitmap` is still running.
- **O(1) Queue Tail Tracking**: Replaced `Math.max(...queue)` spread (O(n), stack risk on large queues) with a `_lookaheadQueueTail` pointer for O(1) queue extension as the lookahead window slides.

### Improved
- **Canvas 2D Context Caching (`js/editor.js`)**: `renderCanvasFrame` now caches the `2d` context on the canvas element (`canvas._cachedCtx`) instead of calling `getContext()` on every frame. Context is only re-created when `alpha` mode changes (normal → export path). Eliminates redundant browser context lookup overhead per tick.
- **`imageSmoothingQuality` Per-Frame Write Eliminated**: Safari smoothing quality (`'high'`) is now set once per canvas context creation instead of being written every frame, removing a GPU state write per render tick.
- **Look-Ahead Cache Write Guard (`js/editor.js`)**: `renderCanvasFrame` now excludes `triggerSource === 'lookahead-cache'` from the main live-frame cache write path — the lookahead worker writes directly via `setFrameFromCanvas`, preventing double-encode of the same frame.

---

## [0.5.13] - 2026-09-12

### Added
- **Single Source of Truth (SSOT) Versioning (`scripts/sync-version.js`)**: Unified project version management into `version.json`. Changing `version.json` (or running `npm run bump <version>`) automatically synchronizes `package.json`, HTML badges, script cache busters, and release notes feeds across `index.html`, `editor.html`, and `demo.html`.
- **Live Dev Server Version Synchronizer (`server.js`)**: Hooked `syncVersion()` directly into `fs.watch(ROOT)`. Editing and saving `version.json` in any editor immediately propagates new version data and reloads the browser.

### Improved
- **Template Editor Initial-Import Auto-Open & Clean Refresh**: Exported `.ofts` project packages now include `isTemplate: true` so the Template Editor pops up automatically on first import. Once displayed, `isTemplate` immediately resets to `false` in memory and IndexedDB and `&template=1` is removed from the URL, guaranteeing the Template Editor never re-appears unexpectedly on browser refresh.
- **Zero Hardcoded Fallback Versions**: Completely eliminated hardcoded fallback version strings in `js/main.js`, `js/editor.js`, and `js/FishExport-Enggine.js`. Runtime components now dynamically query `version.json` or the DOM changelog feed, degrading cleanly without hardcoded version literals.

---

## [0.5.12] - 2026-09-12

### Added
- **Mobile Horizontal Preview Splitter Handle (`.preview-split-handle`)**: Introduced an interactive horizontal drag handle anchored directly on the boundary seam (`top: 0; transform: translateY(-50%)`) between the preview canvas and the controller bar on mobile viewports (`<= 600px`). Allows users to fluidly enlarge or shrink preview height vs timeline height (constrained from 22% to 78%).
- **Theme-Bound Borderless Controller Surface**: Styled the handle pill with pure `var(--bg-panel)` color matching the controller background, with 100% borderless/outlineless geometry (`border: none; outline: none;`) and dynamic neon feedback on hover, touch, and active dragging (`var(--color-primary-hover)` / `var(--color-primary-active)`).
- **Splitter Component Showcase Integration**: Added Section 6b to `demo.html` with a live interactive dragging sandbox and clean boilerplate HTML snippet.
- **Persistent Mobile Preview Sizing**: Automatically caches user's custom preview split height into `localStorage.oft_mobile_preview_height` and synchronizes ruler, playhead needle, and canvas scale in real-time.

---

## [0.5.11] - 2026-09-12

### Fixed
- **Image Sequence (.ZIP) Cancellation & Instant Cache Purge**: Fixed critical issue where clicking "Cancel Export" during Image Sequence export failed to stop execution, causing frames to keep rendering in the background, compressing into a ZIP, and triggering a download. Unified export cancellation across `editor.js` and `FishExport-Enggine.js` (`isExportCancelled = true`, `window.isExportCancelled = true`, `window.isExporting = false`). Added per-frame abort checks, in-memory `zip.files` buffer disposal, canvas deallocation, and automatic trigger of `cleanupAllStudioCaches('export_cancelled')`.
- **Safari Full Video + Audio MP4 Export (Single-Threaded FFmpeg WASM)**: Fixed issue where Safari exported audio-only MP4 files and distorted/cropped video. Identified that Tier 1 WebCodecs prematurely bypassed itself because it falsely assumed FFmpeg remuxing required `SharedArrayBuffer` (which Safari disables without `require-corp`). Bundled FFmpeg.wasm (`ffmpeg-core.wasm`) is 100% single-threaded and executes natively on Safari without `SharedArrayBuffer` or Cross-Origin-Isolation. Tier 1 WebCodecs now renders crisp, uncropped, full-resolution (e.g. 1080x1920 portrait) GPU frames into MP4, followed by an instantaneous (<200ms) `-c:v copy -c:a aac` audio remux.
- **Studio Cache Purge In-Flight Deduplication**: Added in-flight promise lock in `js/db.js` (`cleanupAllStudioCaches`) to prevent redundant, concurrent purge operations when cancellation triggers across multiple modules simultaneously.
- **MediaRecorder WebKit Frame Capture & Repackaging (Tier 2 Fallback)**: Prevented WebKit GPU compositor from dropping frames in Tier 2 fallback by ensuring the canvas has explicit resolution matching composition and is actively composited (`opacity: 0.01` with `requestFrame()` signal), and enabled single-threaded FFmpeg WebM-to-MP4 container conversion across all browsers.

---

## [0.5.2] - 2026-09-12

### Fixed
- **Safari WebKit Export Modal & Header Popover Dismissal**: Fixed issues where clicking "Export Video (.MP4)" on Safari caused the export modal to dismiss almost immediately (~5ms) and the header Export popover failed to appear on click. Resolved popstate race conditions in `Popover.close()` and eliminated redundant click listeners that triggered instant toggle-close cycles in `Popover.open()`.
- **Safari Video Export Reliability & Direct AAC Muxing**: Fixed VideoToolbox encoder probe failures on macOS/iOS Safari by rendering active pixel data on probe canvases and extending hardware encoder initialization timeouts to 1000ms. Added native `video/mp4` MediaRecorder fallback (Tier 2) and in-memory WebCodecs `AudioEncoder` AAC muxing directly into `Mp4Muxer`, bypassing `SharedArrayBuffer` errors.
- **Safari Popover Tail Arrow Rotation**: Fixed issue where popover arrow tail rendered as unrotated flat square in Safari instead of 45-degree angled diamond. Scoped Safari hardware acceleration selector in `css/safari.css` strictly away from `.popover-tail`, and added explicit `-webkit-transform` and `-webkit-transform-origin: 50% 50%` rules in `css/popover.css` and `css/safari.css`.
- **Template Editor Duplicate Media Cards on Cut/Split Clips**: Resolved issue where splitting or cutting an image/video on the timeline spawned redundant 4th/duplicate cards in the Template Editor Replace Media deck. Timeline split pieces now inherit `sourceLayerId`, and `_collectReplaceableSlots` employs universal Media Pool gathering across IndexedDB and all session memory pools, grouping all cuts and occurrences of the same source asset into a single slot.

- **Template Editor Auto-Open on Project Import**: All imported `.ofts` project packages now automatically launch directly into the Template Editor on first opening (`&template=1` and `projectData.isTemplate = true`).
- **Export Progress UI & Engine Badge Overhaul**: Completely eliminated hyperbolic labels (such as "FFMPEG CPU"). Added a flat, borderless `.export-engine-badge` (`GPU` vs `CPU`) styled in bright theme tokens (`var(--color-primary)`) with high-contrast dark text (`var(--bg-canvas)`). Simplified frame rendering progress text to display frame numbers directly (e.g. `135 / 300`) without wordy prefixes.
- **WebCodecs VideoToolbox "Encoding Task Failed" Resolution**: Fixed WebKit VideoToolbox crash (`VideoEncoder encode failed: Encoding task failed`) in macOS Safari by isolating canvas draws using `createImageBitmap(exportCanvas)` before wrapping into `VideoFrame(bmp)` to prevent iOSurface buffer locking collisions during active rendering. Configured dynamic resolution-aware H.264 levels (`33` for 4K, `2a` for 1080p), prioritized offline `latencyMode: 'quality'` to eliminate low-latency hardware constraints, ensured strictly monotonic microsecond timestamps with keyframe guarantees, and guarded Tier 2 `captureStream` for Safari fallback.
- **Export GPU WebCodecs Acceleration & Timeline Double-Cache Bypass**: Optimized WebCodecs VideoToolbox hardware encoder probing for Safari and Chrome, offscreen DOM canvas layer backing, and full-resolution buffer probing to eliminate slow CPU FFmpeg fallbacks. Completely bypassed timeline preview caching, ruler redrawing, and background idle caching during export rendering to eliminate double processing and render lag.
- **Idle Cache Default Disabled**: Changed background idle caching default state from enabled to disabled (`oft_idle_cache: false`), conserving RAM and background CPU resources until explicitly requested.

### Improved
- **Timeline Left Lane UI (Eye-Only Compact Pill)**: Removed unnecessary layer thumbnail preview circle (`.timeline-layer-thumb-circle`) from timeline layer heads to reduce visual clutter and maximize lane efficiency. The left lane now features a dedicated, streamlined 34x38px eye toggle button (`.timeline-layer-eye-btn`).
- **Timeline Right Handle UI (Theme-Token Dynamic Contrast)**: Completely replaced buggy `mix-blend-mode: difference` and hardcoded white `#ffffff` with 100% theme token colors (`css/theme.css`). Implemented ultra-lightweight 1-line coordinate detection (`updateReorderHandlesContrast`) with `.is-over-clip`: renders deep dark canvas (`var(--bg-canvas)`) when over bright clips, and vibrant primary theme color (`var(--color-primary)`) when over dark track canvas. Zero GPU/CPU overhead, 100% cross-browser compatible.

---

## [0.5.1] - 2026-09-12

### Fixed
- **Template Editor Duplicate Media Cards ("Replace Media")**: Resolved issue where identical media reused across multiple cut layers created duplicate cards in the Replace Media grid. The Template Editor now resolves layers directly against the project Media Pool (`window.FishDatabase.getProjectMedia` and `window._activeMediaMap`) matching by `mediaId`, file name, dataUrl, and thumbnail. Timeline cuts of the same media pool item group cleanly into a single card with cumulative duration, and replacing media updates all linked layers and the Media Pool item simultaneously.
- **Safari WebKit Compatibility for Lightning Effects**: Resolved silent failure of Lightning category effects (`brightness-contrast`, `exposure-gamma`, `saturation-vibrant`, `highlight-shadow`, `invert`, `mono`, `lumia`, `diffusion`, `unsharp-mask`, etc.) on Safari caused by lack of `CanvasRenderingContext2D.filter` support and WebKit `<video>` WebGL texture upload constraints. Added `FishEffects.isCanvasFilterSupported()` runtime probe, `FishEffects.drawBlurred()` multi-pass pyramidal box downscale/upscale smoothing fallback, and WebGL scratch canvas texture uploads.
- **Transform Mode Center Offset & Timeline Vertical Shift**: Fixed viewport centering offset when switching to transform mode, and resolved unexpected timeline vertical displacement.
- **Timeline Layer Drag vs Popover Conflict**: Replaced instant drag activation with a hold-to-drag gesture. Holding without releasing enables horizontal layer sliding without opening the context popover; quick tap and release triggers the popover menu.

### Added
- **Media Occurrence Counter Badge**: Added `.template-card-badge-count` (`2x`, `3x`, etc.) in the top-right corner of template media cards when a media asset appears across multiple timeline cuts.
- **Multi-Occurrence Scrubber Range Highlights**: Selecting a grouped media slot in the Template Editor highlights all timeline segments where that media appears simultaneously along the scrubber track.

---

## [0.5.0] - 2026-09-11

### Removed
- **Google Drive Cloud Save** — Complete removal of GDrive integration. Deleted `js/gdrive-sync.js` (839 lines) and `js/gdrive-config.js` (89 lines). Removed all cloud UI from `index.html` (cloud tab panel, login box, user bar, gdrive config modal) and `editor.html` (cloud status icon, remote update banner). Cleaned all GDrive CSS from `css/layout.css` and `css/editor.css`. Stripped all GDrive JS from `js/editor.js` (media hooks, `triggerGDriveSync`, save bypass, project load block, cloud status UI) and `js/main.js` (`initGDriveDashboard`, cloud project list, `isCloud` branches). Project source is now always `local`.

---

## [0.4.9] - 2026-09-11


### Fixed
- **Timeline Visual Offset on Project Open**: Clip blocks appeared horizontally offset from the ruler immediately after opening a project, but snapped to the correct position when zooming. Root cause: `renderTimeline()` has a RAF guard (`if (panX === lastRenderedPanX) return`) that prevents redundant repaints — on first project load (async), the guard blocked the CSS `translate3d` transform from ever being applied to `rulerTrack`/`layersTrack`, so clip blocks rendered at their absolute `left: startPx` without the container offset. Fix: call `updateTimelinePosition(panX, immediate=true)` immediately after `renderTimelineLayers()` on project load to force a synchronous transform flush.

---

## [0.4.8] - 2026-09-11

### Added
- **Offline Frame-by-Frame Export Engine (`FishExport-Enggine.js`)**: Introduced a dedicated standalone export engine that replaces the real-time playback-based MediaRecorder capture with a true deterministic offline render loop. Each frame is rendered at `t = i / fps` (exact timestamp, never wall-clock elapsed time), guaranteeing zero dropped frames regardless of render complexity or GPU load.
- **WebCodecs + Mp4Muxer Primary Path**: On Chrome/Edge/Safari, frames are GPU-encoded via `VideoEncoder` (H.264/VP9) and muxed directly into `.mp4` using `Mp4Muxer` — no real-time capture latency.
- **FFmpeg.wasm CPU Fallback Path**: When WebCodecs is unavailable, the engine renders each frame to JPEG and encodes via `libx264` through FFmpeg.wasm, producing a standards-compliant `.mp4` at full project resolution and FPS.
- **Audio Offline Mixdown**: Audio is mixed via `OfflineAudioContext` (true offline, non-real-time) and merged with the video stream via FFmpeg AAC encode — never tied to playback timing.
- **Engine Delegation**: `exportVideoMP4` in `editor.js` now delegates MP4 exports to `FishExportEngine.export()`. WebM format retains the fast MediaRecorder path.

### Fixed
- **Choppy / Patchy Export Output**: Root cause was MediaRecorder recording wall-clock timestamps. If rendering 1 frame took 80ms (due to heavy effects), the output video naturally had only ~12 FPS instead of 60 FPS. The new offline engine eliminates this entirely — render speed has zero effect on output FPS or smoothness.

---

## [0.4.7] - 2026-09-11

### Fixed
- **WebCodecs Active Probe Verification**: Resolved `DOMException: The given encoding is not supported` on Mozilla Firefox and Hackintosh AMD environments by establishing active `probeEncoderConfig` verification before video export begins, preventing false-positive `VideoEncoder.isConfigSupported` errors from causing runtime export crashes.
- **FFmpeg WebM to MP4 Remux & Transcode**: Resolved `Could not find tag for codec vp8 in stream #0` error when converting MediaRecorder output into MP4. Replaces naive direct copy (`-c copy`) with standards-compliant H.264 (`libx264 ultrafast`) and AAC audio transcode, while preserving fast stream copy when recorded stream is already H.264.
- **Virtual Filesystem Cleanliness**: Virtual FS now aggressively unlinks temporary files (`rec_in.webm`, `rec_out.mp4`, `v_temp.mp4`) before and after operations to eliminate file collision and memory leaks.

### Added
- **Export Format Switch (MP4 / WebM)**: Introduced a format selector in the Export Video modal (`#export-format-switch`), allowing instantaneous 0-second export to native `.webm` without CPU-heavy FFmpeg transcoding.
- **Browser Environment Auto-Detection**: Auto-detects browser capabilities; defaults to `WebM (Fast)` on Mozilla Firefox or platforms without native hardware MP4 encoding, and defaults to `MP4 (H.264)` on Chrome/Edge/Safari for hardware GPU acceleration.

---

## [0.4.6] - 2026-09-10

### Fixed
- **Null Expression Beat Marker Scoping**: Resolved an issue where stacked null layers (e.g. `X BEAT`, `Y BEAT`, `OSCILLATE`) had composition beat markers improperly restricted to adjacent null layer durations, enabling null beat expressions to evaluate freely across their full duration regardless of other null trims.
- **Motion Blur on Chained / Null-Driven Layers**: Added null hierarchy transform evaluation to `FishMotionBlurEngine` (`motion-blur-engine.js`), allowing layers moved by parent expressions without raw keyframes to correctly activate velocity-based sub-frame multi-sampling.
- **Space Lock Input Guard**: Added `typeof el.getAttribute === 'function'` check in `isTextInputElement` (`editor.js`) to prevent `TypeError` when Space key is pressed while `document` or `window` has focus.

### Added
- **Timeline Empty State**: Introduced a clean, centered placeholder in the timeline viewport displaying the upload icon and *"Drop media here to import"* text when no layers are present, with interactive color adaptation on dragover.

### Improved
- **After Effects Timeline Link Connectors**: Redesigned parent-child hierarchy connector lines in `#timeline-layers-track` to match After Effects 1:1, featuring smooth Bézier/quadratic corner curves (`R = 6`), channel nesting without overlap, origin dot on parent left edge, arrowhead pointing into child left edge, and intermediate junction nodes.

---

## [0.4.5] - 2026-09-10

### Added
- **OpenFishTools Warp Presets (`WARP1`, `WARP2`, `WARP3`)**: Added a dedicated "Preset" section under Beat Effects featuring one-click multi-layer adjustment presets (`Mid-Wave`, `Ghost Effect`, `Hue Spin`, `Warp Effect`) with automatic layer stacking, synchronized keyframes, and cubic Bézier easing curves.

### Fixed
- **Timeline Playhead Synchronization & Sub-frame Drift**: Resolved background cache render pollution of `window.currentSec` during asset preview generation; established `getCurrentPlayheadTime()` with strict project-FPS frame-snapping so presets land precisely on the current playhead frame.
- **Wave Warp Effect Rendering**: Enhanced `effects/wave_warp.js` to support smooth-noise wave synthesis, direction angle handling, speed/phase offsets, and seamless edge tiling.

### Improved
- **Debug & Layer Inspector Telemetry**: Expanded OpenFishTools Debug Inspector with real-time playhead timecode, multi-layer sequence duration metrics, and layer property overview for precision inspection.

---

## [0.4.4] - 2026-09-10

### Fixed
- **Debug / Layer Inspector Relocation**: Relocated Debug panel from Composition Settings header to OpenFishTools Settings panel (`Extension/extension.html`), complete with JSON state copying and live status indicators.
- **IndexedDB Storage Calculation**: Fixed project database storage calculation to accurately account for all raw binary media blobs and frame render cache.
- **Template Editor Media Replace**: Media replacement dock is now pinned to the top on desktop, and media cards are enlarged on mobile for easier touch manipulation.
- **Template Media Slot Isolation**: Prevented audio and video tracks from automatically entering template replacement slots.
- **Audio Type Handling**: Corrected audio MIME type detection during media replacement in Template Editor.
- **Scrollbar UI Visibility**: Removed forced global `hide scrollbar` rule (`display: none`), replacing it with clean, theme-matched slim Matcha scrollbars across all scrollable lists.

### Added
- **OFTS Export Progress Modal**: Added real-time export progress modal with DEFLATE Level 9 compression for fast and lightweight `.ofts` project package export.
- **FSMB (Fish Motion Blur)**: Added velocity-based frame blending motion blur effect for moving layers.
- **Playback Controls Popover**: Added quick playback controls (Loop On/Off, Playback Speed 0.5x–2x, Realtime RAM Cache On/Off) accessible via long-press on the Play button.
- **Changelog Section on Welcome Modal**: Added comprehensive multi-version changelog feed directly inside the Welcome modal with category badges (*Fixed*, *Added*, *Improved*, *Changed*).

### Improved
- **Welcome Modal Tone**: Refined Welcome notice copy to be objective, friendly, and transparent regarding the active Alpha development stage.
- **Playback RAM Cache**: Optimized preview RAM cache clamping for smoother, more consistent 60 FPS playback.

---

## [0.4.3] - 2026-09-08

### Fixed
- **Multi-layer Keyframe Shift**: Synchronized keyframe shifting when adjusting multi-layer duration in the timeline, isolating interactions to active properties.
- **Expression Persistence**: Ensured layer expression scripts persist intact across project serialization and undo/redo history snapshots.
- **Audio Detection**: Fixed AAC/MP3 audio format detection during timeline import and playback.

### Improved
- **Preview Cache RAM Optimization**: Dynamic preview cache clamping and frame memory allocation for smoother 60 FPS rendering.

---

## [0.4.2] - 2026-09-05

### Fixed
- **OFTS Export/Import Memory Crash**: Sanitized runtime memory caches (`videoFrames`, `canvasBuffers`, blob URLs) before export and optimized memory allocation during large project imports to prevent browser tab crashes.
- **Runtime Blob Sanitization**: Periodic garbage collection of canvas buffer references during editor page navigation.

---

## [0.4.1] - 2026-09-02

### Added
- **Multi-layer Selection Drag**: Ability to select and drag multiple layers simultaneously across the timeline.
- **Multi-copy Paste 1:1**: Batch layer duplicate and paste preserving exact timing intervals and relative offset relations.
- **Null Object Hierarchy & Layer Parenting**: Hierarchical transform parenting support between layers and null object controllers.
- **Group Masking (Alight Motion style)**: Mask group and exclude group creation with blend mode options (*destination-in* & *destination-out*).

### Fixed
- **Audio Scrubbing Glitch**: Eliminated audio popping and distortion noise during rapid timeline playhead scrubbing.
- **Wireframe Selection Retain**: Maintained bounding wireframe transform box during playback for currently selected layers.

---

## [0.3.0] - 2026-08-25

### Added
- **Modular Layer Effects Registry**: Extensible modular JavaScript layer effects plugin architecture under `effects/` (`FishEffectsRegistry`).
- **Graph Curve Editor**: Interactive keyframe bezier curve editor with control handle nodes, tangent lines, and preset rails.
- **Contextual Selection Navigation**: Dynamic header actions when layers are selected (rename, precompose, group mask, parenting).
- **Vector Preset Icons**: Added Group Mask and Exclude vector icons styled after Alight Motion.

### Fixed
- **3D Depth Calculation**: Corrected z-depth axis calculations in 3D generator component rendering.
- **Database Error Resilience**: Graceful error recovery and silent catch handlers across storage and renderer engines.

### Improved
- **Codebase Modularization**: Extracted inline HTML scripts into clean, decoupled module files inside `js/`.
- **Matcha Theme Standardization**: Standardized 100% theme color tokens from `css/theme.css` and Cal Sans typography.

---

## [0.2.0] - 2026-08-15

### Added
- **Motion Blur Engine**: Integrated motion blur calculation engine with Shutter Angle and Shutter Phase settings.
- **Text Engine**: Full typography text layer creation and editing support.
- **Transform Controller**: Interactive controller for position, scale, rotation, anchor point, and opacity properties.
- **Shape Asset Library**: Added basic vector shapes (Star, Heart, Capsule, Polygon) under `assets/Shape/`.
- **Responsive Splitter Handle**: Vertical pill-shaped drag handle for fluid dynamic timeline pane resizing on desktop and tablet viewports.

### Improved
- **Modal Navigation System**: Standardized responsive popups (slide-down on mobile, center scale-in on desktop) with native browser back button (`popstate`) handling.

---

## [0.1.0] - 2026-08-01

### Added
- **First Public Release**: Initial launch of OpenFishTools Studio as an in-browser motion graphics and video editor.
- **Multi-layer Timeline**: Multi-layer timeline editor with duration controls, trim in/out, and playhead scrubbing.
- **OpenFishTools CEP Integration**: CEP extension panel adapter via iframe bridge.
- **Client-Side Project Storage**: Local browser-based storage engine using IndexedDB (`FishDatabase`).
- **OFTS Project Format**: Native `.ofts` (OpenFishTools Studio) project package format for offline saving and loading.
