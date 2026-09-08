/**
 * OpenFishTools Studio - Static Build Script for Vercel / Production
 * Copies static web assets into dist/
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

console.log('[Build] Preparing dist directory...');
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });

const ITEMS_TO_COPY = [
  'index.html',
  'editor.html',
  'demo.html',
  'assets',
  'css',
  'js',
  'effects',
  'Database',
  'Shape',
  'vendor'
];

console.log('[Build] Copying static files to dist/...');
for (const item of ITEMS_TO_COPY) {
  const src = path.join(ROOT, item);
  const dest = path.join(DIST, item);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`  + ${item}`);
  }
}

console.log('[Build] Static build complete in dist/!');
