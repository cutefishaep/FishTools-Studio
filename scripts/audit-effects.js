/**
 * OpenFishTools Studio - Effects Audit
 *
 * Executes every effects/*.js plugin in a sandbox and validates the real registered
 * definitions. Fails (exit 1) on errors, prints warnings for soft issues.
 *
 *   node scripts/audit-effects.js            # human readable report
 *   node scripts/audit-effects.js --quiet    # only errors/warnings + summary
 *
 * Checks:
 *   - file executes and registers at least one effect
 *   - id / name / category / icon present, id unique across all files
 *   - icon file exists in the repo
 *   - params: unique ids, known type, numeric min/max/default sanity, select options/default
 *   - effect has some behaviour (filter / render / renderPost / onButtonClick) unless it is a
 *     pure control / expression effect
 *   - no effect <script> tag is hand-listed in HTML any more (loader.js only)
 */

const fs = require('fs');
const path = require('path');
const { scanEffectsDetailed, listEffectFiles, ROOT } = require('./sync-effects.js');

const QUIET = process.argv.includes('--quiet');

const KNOWN_PARAM_TYPES = new Set(['number', 'angle', 'select', 'color', 'switch', 'boolean', 'button', 'action', 'curve']);
const BEHAVIOUR_FREE_CATEGORIES = new Set(['expression', 'extension']);
const HTML_PAGES = ['editor.html', 'desktop.html'];

const errors = [];
const warnings = [];
const addError = (file, msg) => errors.push(`${file}: ${msg}`);
const addWarn = (file, msg) => warnings.push(`${file}: ${msg}`);

const scanned = scanEffectsDetailed();
const idOwner = new Map();
const categories = new Map();
let effectCount = 0;

scanned.forEach(entry => {
  const { file, defs, error, usedFallback } = entry;

  if (usedFallback) {
    addError(file, `registers no effect when executed${error ? ` (${error.message})` : ''}`);
    return;
  }
  if (error) addWarn(file, `threw after registering: ${error.message}`);

  defs.forEach((def, idx) => {
    effectCount++;
    const tag = defs.length > 1 ? `${file}#${idx}` : file;

    if (!def.id || typeof def.id !== 'string') { addError(tag, 'missing string id'); return; }
    const normalizedId = def.id.replace(/_/g, '-');
    if (idOwner.has(normalizedId)) {
      addError(tag, `id "${def.id}" already registered by ${idOwner.get(normalizedId)} (ids compared with _ and - equal)`);
    } else {
      idOwner.set(normalizedId, tag);
    }

    if (!def.name || typeof def.name !== 'string') addWarn(tag, 'missing name (falls back to id)');
    if (!def.category || typeof def.category !== 'string') {
      addWarn(tag, 'missing category (falls back to "lightning")');
    } else {
      const key = def.category.toLowerCase();
      categories.set(key, (categories.get(key) || 0) + 1);
    }

    if (def.icon && typeof def.icon === 'string') {
      if (!fs.existsSync(path.join(ROOT, def.icon))) addError(tag, `icon not found: ${def.icon}`);
    } else {
      addWarn(tag, 'no icon (falls back to assets/FXPH.svg)');
    }

    const params = Array.isArray(def.params) ? def.params : [];
    const seenParams = new Set();
    params.forEach(p => {
      if (!p || typeof p.id !== 'string' || !p.id) { addError(tag, 'param without id'); return; }
      if (seenParams.has(p.id)) addError(tag, `duplicate param id "${p.id}"`);
      seenParams.add(p.id);

      if (!KNOWN_PARAM_TYPES.has(p.type)) {
        addWarn(tag, `param "${p.id}" has unknown type "${p.type}" (UI treats as number)`);
      }
      if (p.type === 'number' || p.type === 'angle' || p.type === undefined) {
        const hasMin = typeof p.min === 'number';
        const hasMax = typeof p.max === 'number';
        if (hasMin && hasMax && p.min > p.max) addError(tag, `param "${p.id}" min (${p.min}) > max (${p.max})`);
        if (typeof p.default === 'number') {
          if (hasMin && p.default < p.min) addWarn(tag, `param "${p.id}" default ${p.default} < min ${p.min}`);
          if (hasMax && p.default > p.max) addWarn(tag, `param "${p.id}" default ${p.default} > max ${p.max}`);
        }
      }
      if (p.type === 'select') {
        if (!Array.isArray(p.options) || p.options.length === 0) {
          addError(tag, `select param "${p.id}" has no options`);
        } else if (p.default !== undefined && !p.options.map(o => (o && o.value !== undefined ? o.value : o)).includes(p.default)) {
          addWarn(tag, `select param "${p.id}" default "${p.default}" not in options`);
        }
      }
    });

    const hasBehaviour = ['filter', 'render', 'renderPost', 'onButtonClick'].some(k => typeof def[k] === 'function');
    const cat = (def.category || '').toLowerCase();
    if (!hasBehaviour && !BEHAVIOUR_FREE_CATEGORIES.has(cat)) {
      addWarn(tag, 'has no filter/render/renderPost/onButtonClick (renders nothing)');
    }
  });
});

// HTML pages must load effects
HTML_PAGES.forEach(page => {
  const full = path.join(ROOT, page);
  if (!fs.existsSync(full)) return;
  const html = fs.readFileSync(full, 'utf8');
  if (!/<script src="effects\//.test(html)) {
    addError(page, 'missing effect <script> tags');
  }
});

// Files on disk that the loader would skip
const onDisk = listEffectFiles();
if (onDisk.length !== scanned.length) addError('effects/', 'scan/list mismatch');

/* ── Report ─────────────────────────────────────────────────────────────── */

if (!QUIET) {
  console.log(`Effects audit: ${effectCount} effects in ${scanned.length} files`);
  const cats = Array.from(categories.entries()).sort((a, b) => b[1] - a[1]);
  console.log('Categories: ' + cats.map(([c, n]) => `${c} (${n})`).join(', '));
}
warnings.forEach(w => console.warn('  WARN  ' + w));
errors.forEach(e => console.error('  ERROR ' + e));
console.log(`Effects audit: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
