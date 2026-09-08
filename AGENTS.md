<!-- caveman-begin -->
Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
<!-- caveman-end -->

## UI Design Rules (Strict Performance & Aesthetics)
- **NO Heavy Effects**: Banned `backdrop-filter: blur()`, `filter: blur()`, `box-shadow`, `drop-shadow()`, `text-shadow`.
- **NO Gradients**: Only flat solid colors from `css/theme.css` tokens.
- **NO Outlines / Unnecessary Borders**: `outline: none;` globally. Clean borderless surfaces.
- **Pure Flat & Fast**: High performance, crisp vector lines, 100% Cal Sans typography.

## Pop-up & Drawer Navigation Rules
- **Modular Architecture**: All popups/drawers must use the universal `.modal-backdrop` & `.modal-card` system from `css/modal.css` and `js/modal.js`.
- **Responsive Movement**:
  - **Mobile (<= 600px)**: Slide in from TOP to BOTTOM (`transform: translateY(-100%)` -> `translateY(0)`).
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
- **Universal Reusability**: Components must use standalone class abstractions (e.g. `.modal-dropzone`, `.custom-dropdown`, `.modal-aspect-grid`, `.timeline-split-handle`) so developers can easily summon, copy-paste, and compose them anywhere across all pages (`index.html`, `editor.html`, `demo.html`) without reinventing styles.
- **Showcase Integration**: Any newly introduced modular element must be registered in `demo.html` with a live interactive preview and copyable boilerplate snippet.

## Editor Layout & Splitter Handle Rules
- **Vertical Pill Splitter Handle**: On Tablet & Desktop (`>= 601px`), the timeline boundary must feature an interactive vertical pill-shaped drag handle (`.timeline-split-handle`) allowing horizontal resize (widening/narrowing) of the left pane vs right timeline pane.
- **Mobile Exclusion**: The vertical splitter handle is strictly hidden on Mobile (`<= 600px`, `display: none;`), where the editor preserves a clean vertical top/bottom 50/50 flow.
- **Fluid & Constrained Dragging**: Split resize must use standard Pointer Events (`pointerdown`, `pointermove`, `pointerup`) with a clamped range (min 20%, max 80%) to prevent layout collapse.

## Vector Icon Assets & Creation Rules
- **Automatic SVG Generation**: When a requested UI component requires an icon and no matching asset exists in `assets/`, the agent MUST immediately generate a crisp, dedicated vector SVG file in `assets/<name>.svg`.
- **Theme Color Token Binding**: All created SVG icons must strictly use `fill="currentColor"` (or `stroke="currentColor"`), clean geometric paths, viewBox `0 0 24 24`, and NO hardcoded color literals, ensuring full dynamic color response via CSS theme tokens.

## Strict UI Scoping & Premature Mechanism Ban (MANDATORY)
- **NO Premature Logic / Workflows**: When the user requests adding a button, icon, control, or UI component (e.g., "tambah tombol +"), the agent MUST strictly implement ONLY the visual layout, HTML structure, CSS styling, and hover/press states.
- **Explicit Request Required for Actions**: NEVER invent, assume, or attach unrequested business logic, operational mechanisms, or data mutations (e.g., do NOT auto-create layer additions, deletions, or data side-effects) unless the user explicitly commands what the button must execute.

## XML-Based Effects Architecture (`effects/`) - MANDATORY
- **Dedicated XML Definition Files**: All layer effects MUST be defined as standalone `.xml` files inside the `effects/` directory (e.g. `effects/<id>.xml`) and registered in `effects/manifest.xml`.
- **No Hardcoded Effect Logic in Engine**: Effects must never be hardcoded into the core engine or UI. The effects engine and gallery must dynamically parse XML via `DOMParser`, extracting parameter ranges, defaults, units, filter formulas, and rendering pipelines.
- **Unified Parameter & Keyframe Binding**: Every parameter defined in XML must automatically wire to the Effects Rack UI (scrubbers, badges, labels) and timeline keyframing under the standard `${effectInstanceId}:${paramId}` identifier.

