# Contributing to OpenFishTools Studio

Contributions from both human developers and autonomous AI coding agents are welcome. To ensure consistency, stability, and high performance across the suite, please adhere to the following project guidelines.

---

## 1. Design System & Theming Tokens

- **100% Theme Token Binding**: All colors, surface backgrounds, and borders must strictly use CSS custom properties from `css/theme.css` (e.g. `var(--bg-canvas)`, `var(--bg-panel)`, `var(--color-primary)`).
- **No Hardcoded Color Literals**: Never introduce `#...`, `rgb(...)`, `rgba(...)`, or `hsl(...)` color strings in HTML or CSS component files.
- **Pure Flat Aesthetics**: Strictly avoid `backdrop-filter: blur()`, `filter: blur()`, `box-shadow`, `drop-shadow()`, and gradients.
- **Typography**: Strictly use Cal Sans across the interface.

---

## 2. Modular Effect Plugins (`effects/`)

- Add new visual effects as individual `.js` files inside `effects/<effect_id>.js`.
- Register the effect using `FishEffectsRegistry.register({...})`.
- After adding or modifying effects, run:
  ```bash
  npm run sync:effects
  ```
  This automatically updates `effects/manifest.json` and `effects/loader.js`.

---

## 3. Versioning (Single Source of Truth)

- Versions are managed strictly in `version.json`.
- Do not manually edit version strings in HTML files or JS scripts.
- To increment the version and synchronize badges, run:
  ```bash
  npm run bump <new-version>
  ```

---

## 4. Testing & Verification

Before submitting a Pull Request, verify that all tests pass:

```bash
npm test
```

The automated test suite verifies:
1. JavaScript syntax integrity (`node --check`) across all files.
2. AST scope audit with zero undeclared global references.
3. Synchronizer sanity checks (`sync-effects.js` and `sync-version.js`).
4. HTML file structure and completeness.

---

## 5. Development Guidelines for AI Agents

Autonomous agents working on this repository must read [`AGENTS.md`](AGENTS.md) and adhere to:
- The **Error Investigation Protocol** (reproducing issues on `http://localhost:3000`, browser console inspection, screenshot capture).
- The **Tooling Mandate**: Node.js and Python are strictly for read-only diagnostics; code edits must be executed via native editor tool calls.
