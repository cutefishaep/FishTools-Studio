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

## UI Design Rules (Strict Performance & Aesthetics)
- **NO Heavy Effects**: Banned `backdrop-filter: blur()`, `filter: blur()`, `box-shadow`, `drop-shadow()`, `text-shadow`.
- **NO Gradients**: Only flat solid colors from `css/theme.css` tokens.
- **NO Outlines / Unnecessary Borders**: `outline: none;` globally. Clean borderless surfaces.
- **Pure Flat & Fast**: High performance, crisp vector lines, 100% Cal Sans typography.

## Pop-up & Drawer Navigation Rules
- **Modular Architecture**: All popups/drawers must use the universal `.modal-backdrop` & `.modal-card` system from `css/modal.css` and `js/modal.js`.
- **Responsive Movement**:
  - **Mobile (<= 600px)**: Slide in from BOTTOM to TOP (`transform: translateY(100%)` -> `translateY(0)`). Full width bottom sheet (`width: 100%`) with top rounded corners (`border-radius: 28px 28px 0 0`) for thumb reachability.
  - **Tablet & Desktop (>= 601px)**: Center scale-in (`transform: scale(0.92)` -> `scale(1)`).
- **Close Triggers**:
  - Clicking empty backdrop outside the card closes the popup.
  - No explicit back button required inside simple forms.
- **Native Back Button / Popstate Support**:
  - Opening any overlay/modal must push an internal history state (`history.pushState({ modalOpen: true }, '')`) without changing the visible URL address bar.
  - Pressing browser back, mouse previous button, or Android back gesture must trigger `popstate` to close the modal instead of navigating away.

## Strict Color Token Enforcement (`css/theme.css`) - MANDATORY
- **100% Theme Token Binding**: All colors across every HTML, CSS, and SVG/JS file MUST strictly use CSS custom properties from `css/theme.css` (e.g. `var(--bg-canvas)`, `var(--bg-dashboard)`, `var(--bg-panel)`, `var(--bg-panel-hover)`, `var(--bg-panel-inner)`, `var(--color-primary)`, `var(--color-primary-hover)`, `var(--color-accent)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--text-muted)`, etc.).
- **NO Hardcoded Colors**: Direct color literals (hex `#...`, `rgb()`, `rgba()`, `hsl()`) outside `css/theme.css` are STRICTLY FORBIDDEN in layout and component code (except for specific user swatch choice values or `currentColor`).
- **Seamless Theme Switching**: Every UI element, border, surface, container, and text element must respond synchronously when `data-theme` changes.

## Interactive Contrast & Hover State Rules (High Contrast Guaranteed)
- **Simultaneous Foreground Adaptation**: When an element changes its background/surface on `:hover`, `:focus`, `:active`, or `.is-selected` to a color similar to its inner content (text, icons, badges), the inner content color MUST simultaneously adapt (e.g. Invert text/icon from `var(--color-primary)` to `var(--bg-canvas)` when background becomes solid primary green) to guarantee sharp visibility and prevent content camouflage.
- **Zero Invisibility / Contrast Loss**: Text and vector icons must NEVER blend into their background under any state. Foreground and background must maintain high contrast across all states.

## Modular Component & Element Architecture (Strict Reusability)
- **Strict Modularity**: Every new UI element or interactive component (modals, dropzones, dropdowns, aspect frames, swatches, controls, splitter handles) MUST be built as a decoupled, standalone modular unit.
- **Universal Reusability**: Components must use standalone class abstractions (e.g. `.modal-dropzone`, `.custom-dropdown`, `.modal-aspect-grid`, `.timeline-split-handle`) so developers can easily summon, copy-paste, and compose them anywhere across pages (`index.html`, `editor.html`, `desktop.html`) without reinventing styles.
- **NO Demo File**: `demo.html` is permanently removed. Never recreate `demo.html` or write demo showcases.

## Editor Layout & Splitter Handle Rules
- **Vertical Pill Splitter Handle**: On Tablet & Desktop (`>= 601px`), the timeline boundary features an interactive vertical pill-shaped drag handle (`.timeline-split-handle`) allowing horizontal resize (widening/narrowing) of the left pane vs right timeline pane.
- **Horizontal Preview Splitter Handle (Mobile)**: On Mobile (`<= 600px`), an interactive horizontal pill-shaped drag handle (`.preview-split-handle`) is placed directly below the preview area (`editor-preview`) allowing vertical resize (enlarging/shrinking) of the preview vs timeline.
- **Fluid & Constrained Dragging**: Split resize must use standard Pointer Events (`pointerdown`, `pointermove`, `pointerup`) with clamped ranges (20% to 80% on desktop; 22% to 78% on mobile) to prevent layout collapse.

## Vector Icon Assets & Creation Rules
- **Automatic SVG Generation**: When a requested UI component requires an icon and no matching asset exists in `assets/`, the agent MUST immediately generate a crisp, dedicated vector SVG file in `assets/<name>.svg`.
- **Theme Color Token Binding**: All created SVG icons must strictly use `fill="currentColor"` (or `stroke="currentColor"`), clean geometric paths, viewBox `0 0 24 24`, and NO hardcoded color literals, ensuring full dynamic color response via CSS theme tokens.

## Strict UI Scoping & Premature Mechanism Ban (MANDATORY)
- **NO Premature Logic / Workflows**: When the user requests adding a button, icon, control, or UI component (e.g., "tambah tombol +"), the agent MUST strictly implement ONLY the visual layout, HTML structure, CSS styling, and hover/press states.
- **Explicit Request Required for Actions**: NEVER invent, assume, or attach unrequested business logic, operational mechanisms, or data mutations (e.g., do NOT auto-create layer additions, deletions, or data side-effects) unless the user explicitly commands what the button must execute.

## Modular JS Effects Architecture (`effects/`) - MANDATORY
- **Pure Modular JS Plugin Files**: All layer effects MUST be defined as standalone `.js` files inside the `effects/` directory (e.g. `effects/<id>.js`). No `.xml` files needed.
- **Direct Registry Pattern**: Effects register directly via `FishEffectsRegistry.register({...})` with their own `id`, `name`, `category`, `params`, and rendering logic (`filter`, `render`, or `renderPost`).
- **Unified Parameter & Keyframe Binding**: Every parameter defined in `params` automatically wires to the Effects Rack UI (scrubbers, badges, labels) and timeline keyframing under the standard `${effectInstanceId}:${paramId}` identifier.

## Unified Versioning & Single Source of Truth (SSOT) - MANDATORY
- **Single Source of Truth (`version.json`)**: Version is strictly defined in `version.json`. NEVER manually hunt-and-peck across 10 different files to bump a version.
- **Automated Synchronization**: Run `npm run bump <version>` or edit `version.json` (auto-synced by `server.js` or `npm run bump`). This automatically updates `package.json`, HTML badges, cache busters, and synchronizes the changelog feed from `CHANGELOG.md` across `index.html`, `editor.html`, and `demo.html`.
- **NO Hardcoded Fallback Versions**: Hardcoded version strings in JS code (e.g. `if (!raw) return '0.5.12'`, `syncWelcomeVersionTags('0.5.12')`, or `console.log('v0.5.12')`) are STRICTLY BANNED. Code must dynamically read from `version.json`, `window.OFT_VERSION`, or the DOM, and degrade cleanly without hardcoded version literals.
## File Manipulation Tooling (MANDATORY)
- **Always Use Dedicated Tools**: File creation and edits MUST strictly use `replace_file_content` or `write_to_file`.
- **NO Shell File Manipulation**: NEVER use `cat << 'EOF'`, `sed`, `awk`, `echo >`, Python scratch scripts, or terminal redirection to edit or write files. Always use the built-in tool calls.
