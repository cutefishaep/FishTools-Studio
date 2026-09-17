/**
 * Prepares clean static assets in native/dist for Tauri bundling.
 * Prevents Tauri v2 error where frontendDist contains target/ or node_modules/.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'native', 'dist');

if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });

const filesToCopy = [
  'index.html',
  'editor.html',
  'demo.html',
  'desktop.html',
  'terms.html',
  'privacy.html',
  'version.json',
  'manifest.webmanifest',
  'sw.js'
];

const dirsToCopy = [
  'css',
  'js',
  'assets',
  'shapes',
  'effects',
  'vendor'
];

for (const f of filesToCopy) {
  const src = path.join(ROOT, f);
  const dest = path.join(DIST, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

for (const d of dirsToCopy) {
  const src = path.join(ROOT, d);
  const dest = path.join(DIST, d);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
  }
}

console.log('[BuildNativeDist] Successfully prepared web assets in native/dist');
