/**
 * OpenFishTools Studio - Live Server & Cloudflare Tunnel
 * - Clean URLs (/demo -> demo.html, /editor -> editor.html, / -> index.html)
 * - Auto Live Reload via Server-Sent Events (SSE) on file changes
 * - Built-in Cloudflare Tunnel support (--tunnel)
 * - Zero external dependencies (uses native Node.js http, fs, path, child_process)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3000;
const ROOT = process.cwd();
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
  '.wasm': 'application/wasm'
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
    es.onerror = function() {
      // Reconnect automatically handled by EventSource
    };
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

// Watch workspace files with debounce
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
} catch (err) {
  console.warn('[DevServer] File watch warning:', err.message);
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

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

  // Resolve target file with clean URL support
  let filePath = path.join(ROOT, pathname);

  // If path is directory or root, check for index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Clean URL mapping (/demo -> demo.html, /editor -> editor.html)
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else if (fs.existsSync(path.join(ROOT, pathname + '.html'))) {
      filePath = path.join(ROOT, pathname + '.html');
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

    // Inject SSE live reload script into HTML responses
    if (ext === '.html') {
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
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Internal Server Error: ' + err.message);
  }
});

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
