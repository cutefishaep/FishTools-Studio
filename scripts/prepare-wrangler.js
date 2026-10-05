#!/usr/bin/env node
/**
 * Automatically generates gitignored wrangler.jsonc from environment variables or .env
 * Single source of truth: process.env / .env (CF_KV_NAMESPACE_ID)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const envPath = path.join(ROOT, '.env');
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
  const env = loadEnv();
  const kvId = env.CF_KV_NAMESPACE_ID || process.env.CF_KV_NAMESPACE_ID || 'YOUR_KV_NAMESPACE_ID';

  const config = {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "fishtools-studio",
    "main": "_worker.js",
    "compatibility_date": "2026-09-15",
    "keep_vars": true,
    "assets": {
      "directory": ".",
      "binding": "ASSETS",
      "html_handling": "none",
      "run_worker_first": true
    },
    "observability": {
      "enabled": true
    },
    "kv_namespaces": [
      {
        "binding": "PROJECTS_KV",
        "id": kvId,
        "remote": true
      }
    ]
  };

  fs.writeFileSync(targetPath, JSON.stringify(config, null, "\t") + "\n", 'utf8');
  console.log(`[Wrangler] Synchronized wrangler.jsonc with PROJECTS_KV id: ${kvId}`);
  return true;
}

module.exports = { syncWranglerConfig };

if (require.main === module) {
  syncWranglerConfig();
}
