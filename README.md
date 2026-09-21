# OpenFishTools Studio

OpenFishTools Studio is an open-source, browser-based motion graphics and video editing suite built with vanilla web technologies. It provides an After Effects-style non-linear editor (NLE) with layer compositing, timeline keyframing, a modular effect architecture, and client-side video rendering.

---

## Features

- **Non-Linear Timeline**: Multi-track timeline with keyframe animation, layer nesting (precomps), parent & link hierarchies, and blend modes.
- **After Effects-Style Interface**: Resizable layer and timeline panels, track lane headers, playhead scrubbing, and rectangle lasso marquee selection.
- **Modular Effects Engine**: Extensible visual effect plugin architecture (`effects/*.js`) with real-time canvas rendering.
- **Client-Side Export**: WebCodecs and MP4-muxer integration for in-browser rendering and video generation without server dependencies.
- **Lightweight Architecture**: Vanilla JavaScript and CSS design tokens; no complex build pipeline required to run locally.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.0 or later recommended)
- A modern web browser supporting Canvas and WebCodecs (e.g., Google Chrome, Microsoft Edge, Safari 16.4+)

### Installation & Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/cutefishaep/FishTools-Studio.git
   cd FishTools-Studio
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local server:**
   ```bash
   npm start
   ```

4. **Access the application:**
   - Desktop Interface: `http://localhost:3000/desktop.html`
   - Responsive Interface: `http://localhost:3000/editor.html`
   - Project Launcher: `http://localhost:3000/index.html`

---

## Project Structure

```text
├── assets/          # Vector SVG icons and static assets
├── css/             # CSS styling and design system tokens
│   ├── theme.css    # Central theme tokens (colors, radii, typography)
│   ├── desktop.css  # Desktop NLE layout and component styles
│   └── modal.css    # Reusable modal and dialog styles
├── effects/         # Modular visual effect plugins (FishEffectsRegistry)
├── js/              # Core application logic
│   ├── desktop.js   # Desktop interface, timeline tracks, and panel controls
│   ├── editor.js    # Canvas compositor, layer operations, and playback engine
│   └── main.js      # Application bootstrapping
├── scripts/         # Automation and version management utilities
├── server.js        # Local development HTTP/HTTPS server
├── version.json     # Single source of truth for versioning
└── CHANGELOG.md     # Chronological release notes
```

---

## Development Guidelines

Contributions are welcome. Please follow these project conventions when submitting pull requests:

1. **Design System & Theme Tokens**:
   - All component colors must bind to CSS variables from `css/theme.css` (e.g., `var(--bg-panel)`, `var(--color-primary)`).
   - Avoid hardcoded color literals (hex, rgb, hsl) outside theme tokens.
   - Maintain a flat design: avoid `backdrop-filter: blur`, heavy box shadows, or gradients in UI elements.

2. **Modular Effect Plugins**:
   - Create new visual effects as standalone files in `effects/<effect_id>.js`.
   - Register the effect via `FishEffectsRegistry.register({...})`.
   - Run `npm run sync:effects` to update the effect registry index.

3. **Version Synchronization**:
   - Versioning follows [Semantic Versioning](https://semver.org/).
   - `version.json` serves as the single source of truth.
   - Use `npm run bump <new-version>` to synchronize versions across project files and HTML cache busters.

4. **Code Quality**:
   - Verify JavaScript syntax before submitting:
     ```bash
     node -c js/*.js effects/*.js scripts/*.js
     ```

---

## License

This project is licensed under the [MIT License](LICENSE).
