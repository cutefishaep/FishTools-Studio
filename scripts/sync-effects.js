/**
 * OpenFishTools Studio - Automated Effects Discovery
 *
 * Drop a new `effects/<name>.js` file that calls `FishEffectsRegistry.register({...})`
 * and it appears in the Effects panel automatically. No HTML edits required.
 *
 * Discovery pipeline:
 *   1. scanEffects()    -> executes every effects/*.js in a sandbox and captures the real
 *                          registered definitions (id, name, category, icon, params ...).
 *                          Results are cached per-file by mtime, so repeated calls are cheap.
 *   2. syncEffects()    -> writes effects/manifest.json (static hosts / offline) and
 *                          effects/loader.js (generated fallback file list).
 *   3. Runtime          -> effects/loader.js asks the dev server (/api/effects, live scan),
 *                          falls back to effects/manifest.json, then to its embedded list.
 *
 * Usage:
 *   node scripts/sync-effects.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const EFFECTS_DIR = path.join(ROOT, 'effects');
const LOADER_PATH = path.join(EFFECTS_DIR, 'loader.js');
const MANIFEST_PATH = path.join(EFFECTS_DIR, 'manifest.json');

const RESERVED_FILES = new Set(['loader.js', 'index.js']);

function listEffectFiles() {
  if (!fs.existsSync(EFFECTS_DIR)) return [];
  return fs.readdirSync(EFFECTS_DIR)
    .filter(f => f.endsWith('.js') && !RESERVED_FILES.has(f) && !f.startsWith('.') && !f.startsWith('_'))
    .sort();
}

/* ── Sandbox ─────────────────────────────────────────────────────────────── */

function makePermissiveStub() {
  const cache = new WeakMap();
  const make = () => {
    const target = function () {};
    const proxy = new Proxy(target, {
      get(t, key) {
        if (key === Symbol.toPrimitive) return () => 0;
        if (key === 'then') return undefined;
        if (key === 'length') return 0;
        if (!cache.has(t)) cache.set(t, new Map());
        const m = cache.get(t);
        if (!m.has(key)) m.set(key, make());
        return m.get(key);
      },
      apply() { return make(); },
      construct() { return make(); },
      set() { return true; },
      has() { return true; }
    });
    return proxy;
  };
  return make();
}

function loadEffectFile(file) {
  const defs = [];
  const registry = {
    register(def) { if (def && typeof def === 'object') defs.push(def); },
    get() { return null; },
    getAll() { return []; },
    getByCategory() { return []; }
  };

  const stub = makePermissiveStub();
  const win = {
    FishEffectsRegistry: registry,
    document: stub,
    navigator: { userAgent: 'node', platform: 'node' },
    location: { href: '', protocol: 'file:', hostname: '' },
    devicePixelRatio: 1,
    console,
    Math, JSON, Date, Number, String, Boolean, Array, Object, RegExp, Map, Set, WeakMap, Error,
    Float32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float64Array,
    parseInt, parseFloat, isNaN, isFinite, Infinity, NaN, undefined,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    CustomEvent: function CustomEvent() {},
    Image: function Image() {}, OffscreenCanvas: function OffscreenCanvas() { return stub; },
    HTMLCanvasElement: function HTMLCanvasElement() {}, HTMLImageElement: function HTMLImageElement() {},
    HTMLVideoElement: function HTMLVideoElement() {}, ImageData: function ImageData() {},
    Path2D: function Path2D() {}, THREE: stub
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  win.global = win;

  const filePath = path.join(EFFECTS_DIR, file);
  const code = fs.readFileSync(filePath, 'utf8');
  let error = null;
  try {
    vm.createContext(win);
    new vm.Script(code, { filename: filePath }).runInContext(win, { timeout: 2000 });
  } catch (err) {
    error = err;
  }
  return { defs, error, code };
}

/* ── Scan (cached by mtime) ──────────────────────────────────────────────── */

const scanCache = new Map(); // file -> { mtimeMs, size, result }

function regexFallback(file, code) {
  const idMatch = code.match(/id:\s*['"]([^'"]+)['"]/);
  const nameMatch = code.match(/name:\s*['"]([^'"]+)['"]/);
  const catMatch = code.match(/category:\s*['"]([^'"]+)['"]/);
  const iconMatch = code.match(/icon:\s*['"]([^'"]+)['"]/);
  const id = idMatch ? idMatch[1] : file.replace(/\.js$/, '');
  return [{
    id,
    name: nameMatch ? nameMatch[1] : id,
    category: catMatch ? catMatch[1] : 'lightning',
    icon: iconMatch ? iconMatch[1] : 'assets/FXPH.svg',
    params: [],
    _fallback: true
  }];
}

function scanFile(file) {
  const full = path.join(EFFECTS_DIR, file);
  let stat;
  try { stat = fs.statSync(full); } catch (_) { return null; }
  const cached = scanCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.result;

  const loaded = loadEffectFile(file);
  let defs = loaded.defs;
  let usedFallback = false;
  if (defs.length === 0) {
    defs = regexFallback(file, loaded.code);
    usedFallback = true;
  }
  const result = { file, defs, error: loaded.error, usedFallback };
  scanCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, result });
  return result;
}

/**
 * Executes every effect plugin and returns detailed scan results.
 * @returns {Array<{file:string, defs:Object[], error:Error|null, usedFallback:boolean}>}
 */
function scanEffectsDetailed() {
  return listEffectFiles().map(scanFile).filter(Boolean);
}

/**
 * Lightweight manifest used by the runtime loader and the Effects panel.
 * One entry per registered effect (a file may register several effects).
 */
function scanEffects() {
  const manifest = [];
  scanEffectsDetailed().forEach(entry => {
    entry.defs.forEach(def => {
      manifest.push({
        file: entry.file,
        id: String(def.id),
        name: def.name ? String(def.name) : String(def.id),
        category: def.category ? String(def.category) : 'lightning',
        icon: def.icon ? String(def.icon) : 'assets/FXPH.svg'
      });
    });
  });
  return manifest;
}

/* ── Writers ─────────────────────────────────────────────────────────────── */

function writeIfChanged(filePath, content) {
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return false;
  } catch (_) {}
  const tmp = filePath + '.tmp.' + Date.now() + Math.random().toString(36).slice(2, 6);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
  return true;
}

function buildLoaderSource(files) {
  return `/**
 * OpenFishTools Studio - Modular Effects Runtime Auto-Loader
 *
 * Include this ONE script (after js/effects.js) instead of listing every effect in HTML.
 * Discovery order:
 *   1. /api/effects           live directory scan (dev server)  -> new files appear instantly
 *   2. effects/manifest.json  static manifest (static hosts, PWA, desktop builds)
 *   3. FALLBACK_FILES         list embedded below (generated by scripts/sync-effects.js)
 *
 * Add a new effect by dropping effects/<id>.js that calls FishEffectsRegistry.register({...}).
 * The embedded fallback list is generated - DO NOT EDIT DIRECTLY.
 * Fallback effect files: ${files.length}
 */
(function () {
  'use strict';

  var FALLBACK_FILES = ${JSON.stringify(files, null, 2)};

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = { FALLBACK_FILES: FALLBACK_FILES };
    return;
  }

  function currentVersionQuery() {
    var script = document.currentScript;
    var src = script && script.src ? script.src : '';
    var m = /[?&]v=([^&#]+)/.exec(src);
    if (m) return '?v=' + m[1];
    if (window.OFT_VERSION) return '?v=' + encodeURIComponent(window.OFT_VERSION);
    return '';
  }

  function fetchJsonSync(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
        return JSON.parse(xhr.responseText);
      }
    } catch (_) {}
    return null;
  }

  function filesFromManifest(manifest) {
    if (!Array.isArray(manifest)) return null;
    var seen = {};
    var out = [];
    manifest.forEach(function (item) {
      var f = typeof item === 'string' ? item : (item && item.file);
      if (f && /^[A-Za-z0-9_.-]+\\.js$/.test(f) && !seen[f]) {
        seen[f] = true;
        out.push(f);
      }
    });
    out.sort();
    return out.length ? out : null;
  }

  var isHttp = /^https?:$/.test(window.location.protocol);
  var files = null;
  var source = 'fallback';

  if (isHttp) {
    files = filesFromManifest(fetchJsonSync('/api/effects'));
    if (files) source = 'api';
    if (!files) {
      files = filesFromManifest(fetchJsonSync('effects/manifest.json' + currentVersionQuery()));
      if (files) source = 'manifest';
    }
  }
  if (!files) files = FALLBACK_FILES.slice();

  window.FISH_EFFECTS_FILES = files;
  window.FISH_EFFECTS_SOURCE = source;

  var ver = currentVersionQuery();
  if (document.readyState === 'loading') {
    // Parser-blocking, in-order execution: effects are registered before editor scripts run
    files.forEach(function (file) {
      document.write('<script src="effects/' + file + ver + '"><\\/script>');
    });
  } else {
    // Late load (script injected after parsing): keep order, the gallery listens for registrations
    files.forEach(function (file) {
      var s = document.createElement('script');
      s.src = 'effects/' + file + ver;
      s.async = false;
      document.head.appendChild(s);
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { FALLBACK_FILES: files };
})();
`;
}

function syncEffects() {
  if (!fs.existsSync(EFFECTS_DIR)) return [];

  const manifest = scanEffects();
  const files = Array.from(new Set(manifest.map(m => m.file))).sort();

  const manifestChanged = writeIfChanged(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  const loaderChanged = writeIfChanged(LOADER_PATH, buildLoaderSource(files));

  console.log(
    `[SyncEffects] ${manifest.length} effects in ${files.length} files discovered` +
    (manifestChanged || loaderChanged ? ' (manifest/loader updated)' : ' (already up to date)')
  );
  return manifest;
}

if (require.main === module) {
  syncEffects();
}

module.exports = { syncEffects, scanEffects, scanEffectsDetailed, listEffectFiles, EFFECTS_DIR, ROOT };
