/**
 * OpenFishTools Studio - Live Server & Cloudflare Tunnel
 * - Runs standalone locally via `run.bat` or `node server.js`
 * - Built-in Cloudflare Tunnel support (`--tunnel`)
 * - Works on Vercel Serverless Function with full static file resolution
 * - Zero external dependencies
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ENABLE_TUNNEL = process.argv.includes('--tunnel');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml; charset=utf-8'
};

const SSE_INJECTION = `
<script>
  (function() {
    if (typeof window === 'undefined') return;
    var es = new EventSource('/__live_reload');
    es.onmessage = function(e) {
      if (e.data === 'reload') {
        console.log('[DevServer] File changed, reloading...');
        window.location.reload();
      }
    };
    es.onerror = function() {};
  })();
</script>
`;

let sseClients = [];

function notifyClients() {
  sseClients.forEach(res => {
    try {
      res.write('data: reload\n\n');
    } catch (e) {}
  });
}

// File watcher for local dev auto-reload
if (!process.env.VERCEL) {
  let debounceTimer = null;
  try {
    fs.watch(ROOT, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const normalized = filename.replace(/\\/g, '/');
      if (
        normalized.includes('node_modules') ||
        normalized.includes('.git') ||
        normalized.includes('.gemini') ||
        normalized.includes('.system_generated') ||
        normalized.includes('scratch') ||
        normalized.startsWith('.')
      ) {
        return;
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`[DevServer] Change detected in ${filename} -> Triggering Live Reload`);
        notifyClients();
      }, 120);
    });
  } catch (err) {}
}

// Lightweight zero-dependency .env loader
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[key]) process.env[key] = val;
        }
      }
    } catch (_) {}
  }
}
loadEnv();

function handleRequest(req, res) {
  const host = req.headers.host || `localhost:${PORT}`;
  const parsedUrl = new URL(req.url, `http://${host}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Security: block direct access to .env and hidden dot-files
  if (pathname === '/.env' || pathname.startsWith('/.env') || pathname.includes('/.env') || pathname.startsWith('/.')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  // App configuration endpoint — same-origin only (Client ID is public but no need for cross-origin)
  if (pathname === '/__config' || pathname === '/api/config') {
    const origin = req.headers.origin || '';
    const allowed = process.env.ALLOWED_ORIGIN || '';
    const isSameOrigin = !origin || origin === allowed || origin.startsWith('http://localhost');
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(isSameOrigin ? { 'Access-Control-Allow-Origin': origin || '*' } : {})
    });
    res.end(JSON.stringify({
      googleClientId: process.env.GOOGLE_CLIENT_ID || ''
    }));
    return;
  }

  // Debug endpoint — local dev only, NEVER exposed in production
  if (pathname === '/__debug') {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    let rootFiles = [];
    let cssFiles = [];
    let jsFiles = [];
    try { rootFiles = fs.readdirSync(ROOT); } catch (e) {}
    try { cssFiles = fs.readdirSync(path.join(ROOT, 'css')); } catch (e) {}
    try { jsFiles = fs.readdirSync(path.join(ROOT, 'js')); } catch (e) {}
    res.end(JSON.stringify({
      ROOT: ROOT,
      cwd: process.cwd(),
      rootFiles,
      cssFiles,
      jsFiles
    }, null, 2));
    return;
  }

  // SSE Live Reload stream
  if (pathname === '/__live_reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('data: connected\n\n');
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // Resolve target file
  const relativePath = pathname.replace(/^\/+/, '');
  let filePath = path.join(ROOT, relativePath);

  // If path is directory or root, check for index.html
  if (!relativePath || (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory())) {
    filePath = path.join(ROOT, 'index.html');
  }

  // Clean URL mapping (/demo -> demo.html, /editor -> editor.html)
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else if (fs.existsSync(path.join(ROOT, relativePath + '.html'))) {
      filePath = path.join(ROOT, relativePath + '.html');
    }
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><title>404 Not Found</title></head><body style="font-family:sans-serif;padding:40px;background:#0d1109;color:#c0dbc0;"><h2>404 Not Found</h2><p>Cannot find <code>${pathname}</code></p><p><a href="/" style="color:#98ce7b;">Go to Home</a> | <a href="/editor" style="color:#98ce7b;">Go to Editor</a> | <a href="/demo" style="color:#98ce7b;">Go to Demo</a></p></body></html>`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    let content = fs.readFileSync(filePath);

    // Inject SSE live reload script into HTML responses (only in local dev)
    if (ext === '.html' && !process.env.VERCEL) {
      let htmlStr = content.toString('utf-8');
      if (htmlStr.includes('</body>')) {
        htmlStr = htmlStr.replace('</body>', `${SSE_INJECTION}\n</body>`);
      } else {
        htmlStr += SSE_INJECTION;
      }
      content = Buffer.from(htmlStr, 'utf-8');
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': process.env.VERCEL ? 'public, max-age=3600' : 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Internal Server Error: ' + err.message);
  }
}

function findCloudflared() {
  const localExe = path.join(ROOT, 'cloudflared.exe');
  if (fs.existsSync(localExe)) return localExe;
  const localBin = path.join(ROOT, 'cloudflared');
  if (fs.existsSync(localBin)) return localBin;
  return 'cloudflared';
}

function startCloudflareTunnel() {
  const bin = findCloudflared();
  console.log('[Cloudflare] Menghubungkan tunnel ke http://localhost:' + PORT + '...');
  
  let cfProcess;
  try {
    cfProcess = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    console.warn('[Cloudflare] Gagal menjalankan cloudflared:', err.message);
    return;
  }

  let tunnelUrlFound = false;

  const handleOutput = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !tunnelUrlFound) {
      tunnelUrlFound = true;
      const publicUrl = match[0];
      console.log('\n===================================================');
      console.log('  CLOUDFLARE PUBLIC TUNNEL ACTIVE!');
      console.log(`  Public Link: ${publicUrl}`);
      console.log('  Routes:');
      console.log(`    - Home:   ${publicUrl}/`);
      console.log(`    - Demo:   ${publicUrl}/demo`);
      console.log(`    - Editor: ${publicUrl}/editor`);
      console.log('===================================================\n');
    }
  };

  cfProcess.stdout.on('data', handleOutput);
  cfProcess.stderr.on('data', handleOutput);

  cfProcess.on('error', (err) => {
    console.warn('[Cloudflare] Tunnel process error:', err.message);
  });

  cfProcess.on('exit', (code) => {
    if (code !== 0 && !tunnelUrlFound) {
      console.warn(`[Cloudflare] Tunnel berhenti dengan kode ${code}`);
    }
  });

  const cleanExit = () => {
    try {
      if (cfProcess && !cfProcess.killed) {
        cfProcess.kill();
      }
    } catch (e) {}
    process.exit(0);
  };

  process.on('SIGINT', cleanExit);
  process.on('SIGTERM', cleanExit);
  process.on('exit', cleanExit);
}

const server = http.createServer(handleRequest);

// Standalone start (local dev)
if (require.main === module) {
  server.listen(PORT, () => {
    console.log('===================================================');
    console.log(`  OpenFishTools Studio - Live Server Running`);
    console.log(`  Local URL: http://localhost:${PORT}`);
    console.log(`  Routes:`);
    console.log(`    - Home:   http://localhost:${PORT}/`);
    console.log(`    - Demo:   http://localhost:${PORT}/demo`);
    console.log(`    - Editor: http://localhost:${PORT}/editor`);
    console.log('  Live Reload: ACTIVE (Watching file changes)');
    if (!ENABLE_TUNNEL) {
      console.log('  Tip: Jalankan dengan --tunnel untuk public link Cloudflare');
    }
    console.log('===================================================');

    if (ENABLE_TUNNEL) {
      startCloudflareTunnel();
    }
  });
}

// Export for Vercel Serverless Function
module.exports = server;
module.exports.default = server;
