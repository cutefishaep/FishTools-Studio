# Changelog

All notable changes to OpenFishTools Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
