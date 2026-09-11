# Changelog

All notable changes to OpenFishTools Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.0] - 2026-09-11

### Removed
- **Google Drive Cloud Save** — Complete removal of GDrive integration. Deleted `js/gdrive-sync.js` (839 lines) and `js/gdrive-config.js` (89 lines). Removed all cloud UI from `index.html` (cloud tab panel, login box, user bar, gdrive config modal) and `editor.html` (cloud status icon, remote update banner). Cleaned all GDrive CSS from `css/layout.css` and `css/editor.css`. Stripped all GDrive JS from `js/editor.js` (media hooks, `triggerGDriveSync`, save bypass, project load block, cloud status UI) and `js/main.js` (`initGDriveDashboard`, cloud project list, `isCloud` branches). Project source is now always `local`.

---

## [0.5.0] - 2026-09-11

### Removed
- **Google Drive Cloud Save** — Complete removal. Deleted gdrive-sync.js + gdrive-config.js. Removed cloud UI (index.html, editor.html), cloud CSS (layout.css, editor.css), GDrive JS (editor.js + main.js). Project source always local.

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
