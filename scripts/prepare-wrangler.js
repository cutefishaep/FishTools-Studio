#!/usr/bin/env node
/**
 * Automatically generates gitignored wrangler.jsonc from wrangler.jsonc.example and .env
 * Single source of truth: .env (CF_KV_NAMESPACE_ID)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const envPath = path.join(ROOT, '.env');
const templatePath = path.join(ROOT, 'wrangler.jsonc.example');
const targetPath = path.join(ROOT, 'wrangler.jsonc');

function loadEnv() {
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      env[key] = val;
    }
  }
  return env;
}

function syncWranglerConfig() {
  if (!fs.existsSync(templatePath)) return false;
  const env = loadEnv();
  const kvId = env.CF_KV_NAMESPACE_ID || process.env.CF_KV_NAMESPACE_ID || 'YOUR_KV_NAMESPACE_ID';

  let content = fs.readFileSync(templatePath, 'utf8');
  content = content.replace(/YOUR_KV_NAMESPACE_ID/g, kvId);

  fs.writeFileSync(targetPath, content, 'utf8');
  console.log(`[Wrangler] Synchronized wrangler.jsonc with PROJECTS_KV id: ${kvId}`);
  return true;
}

module.exports = { syncWranglerConfig };

if (require.main === module) {
  syncWranglerConfig();
}
