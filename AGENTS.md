<!-- caveman-begin -->
Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Answer first: Answer, then reason, then next step.
- Kill ceremony: No greeting, hedging, pleasantries, recap, or closer.
- Short word: "fix" not "implement a solution for".
- Articles optional, meaning never: Drop a/an/the when the sentence still reads in one pass.
- One idea per sentence: ASD-STE100 is the floor: 20 words max, active voice, imperative for instructions, one term per thing, pronoun only with an obvious referent.
- Payload verbatim: Code blocks unchanged.
- Tool runs: bounded status: No text between routine calls.
- User's language: Compress the style, not the language.
- Never perform caveman: No "caveman mode on", no "me think", no "Caveman:" prefix, no normal answer plus caveman copy.

Switch: /caveman (default), /ultracave (fragments, each fact once), /megacave (Classical Chinese 文言文)
Stop: "stop caveman" or "normal mode"

Auto-Clarity: plain prose for security warnings, irreversible actions, step order a fragment could scramble, user confused. Resume after.

Boundaries: code, comments, commits, PRs, docs written normal.
Floor: code, commands, paths, numbers and error strings verbatim; never drop not/never/no/only.
<!-- caveman-end -->

# FishTools Studio AI Agent Guidelines

## 1. System Architecture & Component Map
- `desktop.html` & `js/desktop.js`: Desktop NLE interface with After Effects-style track headers, docked panels, timeline tracks, and graph editor.
- `editor.html` & `js/editor.js`: Responsive & mobile NLE interface, canvas layer compositor, layer inspector, keyframe markers, and transform controls.
- `index.html` & `js/main.js`: Project manager & launcher. Handles IndexedDB local projects, cloud shares, template picker, and QR modals.
- `js/fishtool-engine.js`: Core 2D/3D matrix transformation pipeline, multi-layer canvas rendering, camera projections, and composition nesting.
- `js/motion-blur-engine.js`: Sub-frame motion blur computation engine with multi-sample accumulation.
- `js/text-engine.js`: High-precision Canvas text layout, typography metrics, and text transform directives.
- `js/FishExport-Enggine.js`: Video export engine integrating WebCodecs and MP4-muxer for client-side rendering.
- `effects/`: Standalone modular effect plugins registered directly via `FishEffectsRegistry.register({...})`.
- `server.js`: Zero-dependency local development server with SSE live reload and optional Cloudflare tunnel.
- `scripts/prepare-wrangler.js`: Synchronizes `wrangler.jsonc` from `wrangler.jsonc.example` using `.env`.
- `version.json`: Single source of truth for repository version.

## 2. Error Investigation & Diagnostic Protocol (MANDATORY)
When debugging errors, unexpected behavior, or UI bugs:
1. **Access Localhost**: Start the local dev server (`node server.js` or `npm start`) and navigate to `http://localhost:3000` (or `/desktop.html`, `/editor.html`, `/index.html`).
2. **Inspect Browser & Page**: Access the rendered page, inspect DOM structure, and check DevTools console logs.
3. **Capture Screenshots**: Take visual screenshots of the interface to verify layout alignment, theme contrast, and rendering glitches.
4. **Diagnostic Tooling (Read-Only)**: Use Node.js and Python **strictly for read-only diagnostics** (e.g. running AST scope audits, parsing logs, analyzing test matrices).

## 3. Strict File Manipulation Tooling (NO SCRIPT-BASED EDITS)
- **STRICTLY FORBIDDEN**: Using Python scripts, Node.js scripts, `sed`, `awk`, `echo >`, `cat << 'EOF'`, or shell redirection to edit or generate code files.
- **MANDATORY**: All file creations and code modifications MUST strictly use the agent's native tool calls (`replace_file_content` or `write_to_file`).

## 4. UI Design Rules (Strict Flat & Performance Aesthetics)
- **NO Heavy Effects**: Banned `backdrop-filter: blur()`, `filter: blur()`, `box-shadow`, `drop-shadow()`, `text-shadow`.
- **NO Gradients**: Only flat solid colors from `css/theme.css` tokens.
- **NO Outlines / Unnecessary Borders**: `outline: none;` globally. Clean borderless surfaces.
- **Pure Flat & Fast**: High performance, crisp vector lines, 100% Cal Sans typography.

## 5. Pop-up & Drawer Navigation Rules
- **Modular Architecture**: All popups/drawers must use universal `.modal-backdrop` & `.modal-card` from `css/modal.css` and `js/modal.js`.
- **Responsive Movement**:
  - **Mobile (<= 600px)**: Slide in from BOTTOM to TOP (`transform: translateY(100%)` -> `translateY(0)`). Full width bottom sheet (`width: 100%`) with top rounded corners (`border-radius: 28px 28px 0 0`).
  - **Tablet & Desktop (>= 601px)**: Center scale-in (`transform: scale(0.92)` -> `scale(1)`).
- **Close Triggers**: Clicking backdrop outside card closes the popup.
- **Native Back Button / Popstate Support**: Opening any modal pushes `history.pushState({ modalOpen: true }, '')`. Browser back closes modal without navigating away.

## 6. Strict Color Token Enforcement (`css/theme.css`) - MANDATORY
- **100% Theme Token Binding**: All colors MUST use CSS custom properties from `css/theme.css` (e.g. `var(--bg-canvas)`, `var(--bg-panel)`, `var(--color-primary)`, `var(--text-primary)`, `var(--text-secondary)`).
- **NO Hardcoded Colors**: Direct color literals (hex `#...`, `rgb()`, `rgba()`, `hsl()`) outside `css/theme.css` are STRICTLY FORBIDDEN in component code.
- **Seamless Theme Switching**: Every UI element must respond synchronously when `data-theme` changes.

## 7. Interactive Contrast & Hover State Rules
- **Simultaneous Foreground Adaptation**: When an element changes background on `:hover`, `:focus`, `:active`, or `.is-selected`, the inner content color MUST adapt to preserve contrast (e.g. invert text/icon from `var(--color-primary)` to `var(--bg-canvas)` when background becomes solid primary green).
- **Zero Invisibility**: Foreground and background must maintain high contrast across all states.

## 8. Modular Component Architecture
- **Strict Modularity**: Every new component MUST be built as a decoupled, standalone unit (`.modal-dropzone`, `.custom-dropdown`, `.timeline-split-handle`).
- **NO Demo File**: `demo.html` is permanently removed. Never recreate `demo.html`.

## 9. Splitter Handle Rules
- **Desktop (>= 601px)**: Pill splitter handle (`.timeline-split-handle`) for horizontal left/right resize (clamped 20% to 80%).
- **Mobile (<= 600px)**: Pill splitter handle (`.preview-split-handle`) for vertical preview/timeline resize (clamped 22% to 78%).

## 10. Vector Icon Assets Rules
- **Automatic SVG Generation**: When a component needs an icon and none exists in `assets/`, generate a crisp vector SVG in `assets/<name>.svg`.
- **Theme Color Token Binding**: SVGs must use `fill="currentColor"` (or `stroke="currentColor"`), viewBox `0 0 24 24`, clean geometric paths, and zero hardcoded colors.

## 11. Strict UI Scoping & Premature Mechanism Ban
- **NO Premature Workflows**: When user requests UI components (e.g. button, icon, tab), implement ONLY visual layout, CSS styling, and hover/press states.
- **Explicit Request Required**: Never invent, assume, or attach unrequested business logic or mutations unless explicitly commanded.

## 12. Modular JS Effects Architecture (`effects/`)
- **Plugin Architecture**: Layer effects are standalone `.js` files in `effects/<id>.js`.
- **Registry Pattern**: Effects register via `FishEffectsRegistry.register({...})`.
- **Manifest Synchronization**: Run `npm run sync:effects` after adding or editing effects.

## 13. Unified Versioning & SSOT
- **Single Source of Truth**: Version is strictly defined in `version.json`.
- **Automated Synchronization**: Run `npm run bump <version>` to synchronize `package.json`, HTML badges, and cache busters.
- **NO Hardcoded Fallback Versions**: Never write fallback version literals in JavaScript.

## 14. Mandatory Quality & Test Verification
- **Run Tests Before Turn Completion**: Before completing any task, execute:
  ```bash
  npm test
  ```
- All files must pass syntax verification, AST scope audit (0 undeclared references), synchronizers check, and HTML structure integrity.
