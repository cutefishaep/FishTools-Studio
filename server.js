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
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.hdr': 'image/vnd.radiance',
  '.ofts': 'application/octet-stream'
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

let syncVersion = null;
let syncEffects = null;
try {
  syncVersion = require('./scripts/sync-version.js').syncVersion;
} catch (_) {}
let scanEffectsLive = null;
try {
  const effectsMod = require('./scripts/sync-effects.js');
  syncEffects = effectsMod.syncEffects;
  scanEffectsLive = effectsMod.scanEffects;
} catch (_) {}

// Initial sync of effects manifest and loader
if (typeof syncEffects === 'function') {
  try {
    syncEffects();
  } catch (_) {}
}

// Auto-sync wrangler.jsonc from .env if template exists
try {
  const wranglerMod = require('./scripts/prepare-wrangler.js');
  if (typeof wranglerMod.syncWranglerConfig === 'function') {
    wranglerMod.syncWranglerConfig();
  }
} catch (_) {}

// File watcher for local dev auto-reload
if (!process.env.VERCEL) {
  let debounceTimer = null;
  let isAutoSyncingVersion = false;
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
        normalized.startsWith('storage') ||
        normalized.includes('/storage') ||
        normalized.endsWith('.ofts') ||
        normalized.startsWith('.')
      ) {
        return;
      }

      // Automatically sync effects/loader.js when files in effects/ change
      if (normalized.startsWith('effects/') && normalized.endsWith('.js') && !normalized.endsWith('loader.js')) {
        if (typeof syncEffects === 'function') {
          try {
            console.log('[DevServer] effects/ changed -> Auto-syncing effects/loader.js and manifest.json...');
            syncEffects();
          } catch (e) {
            console.error('[DevServer] Auto-sync effects failed:', e);
          }
        }
      }

      // Automatically sync all files when version.json is modified
      if ((normalized === 'version.json' || normalized.endsWith('/version.json')) && !isAutoSyncingVersion) {
        if (typeof syncVersion === 'function') {
          isAutoSyncingVersion = true;
          try {
            console.log('[DevServer] version.json changed -> Auto-syncing version across all studio files...');
            syncVersion();
          } catch (e) {
            console.error('[DevServer] Auto-sync version failed:', e);
          } finally {
            setTimeout(() => { isAutoSyncingVersion = false; }, 300);
          }
        }
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
// In-memory sliding window IP rate limiter (10 shares / minute / IP)
const shareRateLimitMap = new Map();
function checkShareRateLimit(ip) {
  const now = Date.now();
  const entry = shareRateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    shareRateLimitMap.set(ip, { count: 1, resetTime: now + 60000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}
// Clean up expired rate limiter entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of shareRateLimitMap.entries()) {
    if (now > entry.resetTime) shareRateLimitMap.delete(ip);
  }
}, 120000);

function handleRequest(req, res) {
  const host = req.headers.host || `localhost:${PORT}`;
  const parsedUrl = new URL(req.url, `http://${host}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Security: block direct access to .env, dot-files, internal storage databases, and server internals
  if (
    pathname === '/.env' || pathname.startsWith('/.env') || pathname.includes('/.env') || pathname.startsWith('/.') ||
    pathname === '/storage' || pathname === '/storage/' ||
    (pathname.startsWith('/storage/') && !pathname.startsWith('/storage/files/')) ||
    pathname.endsWith('.json') && pathname.startsWith('/storage') ||
    pathname === '/server.js' || pathname === '/package.json' || pathname === '/package-lock.json'
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
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

  // Effects discovery endpoint: live scan of effects/*.js (cached per file mtime),
  // so a newly dropped effect plugin is picked up on the next page load with no sync step.
  if (pathname === '/api/effects') {
    let payload = null;
    try {
      if (scanEffectsLive) payload = JSON.stringify(scanEffectsLive());
    } catch (_) {}
    if (!payload) {
      const manifestPath = path.join(ROOT, 'effects', 'manifest.json');
      if (fs.existsSync(manifestPath)) payload = fs.readFileSync(manifestPath, 'utf8');
    }
    if (payload) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(payload);
      return;
    }
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

  // API: Save generated 3D primitive thumbnail renders
  if (req.method === 'POST' && pathname === '/api/save-primitives') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const primDir = path.join(ROOT, 'assets', 'primitives');
        if (!fs.existsSync(primDir)) fs.mkdirSync(primDir, { recursive: true });
        for (const [name, dataUrl] of Object.entries(data)) {
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
            const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(path.join(primDir, `${name}.png`), Buffer.from(base64, 'base64'));
          }
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Helper for shares storage
  const SHARES_DIR = path.join(ROOT, 'storage');
  const SHARES_FILE = path.join(SHARES_DIR, 'shares.json');

  function getLocalShares() {
    try {
      if (!fs.existsSync(SHARES_DIR)) fs.mkdirSync(SHARES_DIR, { recursive: true });
      if (!fs.existsSync(SHARES_FILE)) fs.writeFileSync(SHARES_FILE, '{}', 'utf-8');
      return JSON.parse(fs.readFileSync(SHARES_FILE, 'utf-8'));
    } catch (_) {
      return {};
    }
  }

  function saveLocalShares(data) {
    try {
      if (!fs.existsSync(SHARES_DIR)) fs.mkdirSync(SHARES_DIR, { recursive: true });
      fs.writeFileSync(SHARES_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (_) {}
  }

  // API: Share Project (Upload .ofts to Catbox + store metadata)
  if (req.method === 'POST' && pathname === '/api/share') {
    (async () => {
      try {
        // 0. Authorization check: if SHARE_SECRET_TOKEN is set, enforce token
        const expectedToken = process.env.SHARE_SECRET_TOKEN;
        if (expectedToken) {
          const reqToken = req.headers['x-share-token'] ||
            (req.headers['authorization'] ? req.headers['authorization'].replace(/^Bearer\s+/i, '').trim() : '');
          if (!reqToken || reqToken !== expectedToken) {
            res.writeHead(401, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: false, error: 'Token tidak ada, cek .env mu' }));
            return;
          }
        }

        const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
        if (!checkShareRateLimit(clientIp)) {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': '60',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ error: 'Rate limit exceeded. Please wait a minute before sharing again.' }));
          return;
        }

        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host || `localhost:${PORT}`;
        const origin = `${protocol}://${host}`;

        const request = new Request(`${origin}${req.url}`, {
          method: req.method,
          headers: req.headers,
          body: new ReadableStream({
            start(controller) {
              req.on('data', chunk => controller.enqueue(chunk));
              req.on('end', () => controller.close());
              req.on('error', err => controller.error(err));
            }
          }),
          duplex: 'half'
        });

        const formData = await request.formData();
        const file = formData.get('file');

        if (!file || typeof file.size !== 'number' || file.size === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'No valid project file provided' }));
          return;
        }

        // 1. File Size Capping (Max 15MB)
        const MAX_FILE_SIZE = 15 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            error: 'Project exceeds maximum upload limit of 15MB. Please save the project to your local device (Download Project .ofts).'
          }));
          return;
        }

        // 2. Binary Magic Byte Validation: Must be valid ZIP archive
        const headerBuffer = await file.slice(0, 4).arrayBuffer();
        const headerBytes = new Uint8Array(headerBuffer);
        const isZip = headerBytes[0] === 0x50 && headerBytes[1] === 0x4B &&
                      (headerBytes[2] === 0x03 || headerBytes[2] === 0x05 || headerBytes[2] === 0x07);

        if (!isZip) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Security rejection: Uploaded file is not a valid .ofts package.' }));
          return;
        }

        // 3. Sanitize inputs
        const rawName = String(formData.get('name') || 'Untitled Project').trim();
        const sanitizedName = rawName.slice(0, 80).replace(/[^\w\s\-\.\(\)]/gi, '').trim() || 'Untitled Project';

        const rawSpecs = String(formData.get('specs') || '1080p • 60 fps').trim();
        const sanitizedSpecs = rawSpecs.slice(0, 40).replace(/[^\w\s\-\•\.\(\)]/gi, '') || '1080p • 60 fps';

        const rawSize = String(formData.get('size') || '1.0 MB').trim();
        const sanitizedSize = rawSize.slice(0, 20).replace(/[^\w\s\-\.]/gi, '') || '1.0 MB';

        const rawAspect = String(formData.get('aspectRatio') || '16:9').trim();
        const sanitizedAspect = rawAspect.slice(0, 10).replace(/[^\d:]/g, '') || '16:9';

        let sanitizedThumbnail = '';
        const rawThumb = formData.get('thumbnail');
        if (typeof rawThumb === 'string' && (rawThumb.startsWith('data:image/jpeg;base64,') || rawThumb.startsWith('data:image/webp;base64,'))) {
          if (rawThumb.length <= 30000) sanitizedThumbnail = rawThumb;
        }

        // 4. Compute next ID in local shares database
        const shares = getLocalShares();
        const keys = Object.keys(shares);
        let nextId = '1';
        if (keys.length > 0) {
          const numKeys = keys.map(k => parseInt(k, 10)).filter(n => !isNaN(n));
          if (numKeys.length > 0) {
            nextId = String(Math.max(...numKeys) + 1);
          } else {
            nextId = String(keys.length + 1);
          }
        }

        const safeName = (sanitizedName.replace(/[^a-zA-Z0-9_-]/g, '_')) + '.ofts';
        let fileUrl = '';
        let thumbUrl = '';

        const thumbnailFile = formData.get('thumbnailFile');

        // 5. Attempt upload to Catbox API (with 6s timeout)
        try {
          const catboxForm = new FormData();
          catboxForm.append('reqtype', 'fileupload');
          if (process.env.CATBOX_USERHASH) catboxForm.append('userhash', process.env.CATBOX_USERHASH);
          catboxForm.append('fileToUpload', file, safeName);

          const uploadTasks = [
            (async () => {
              try {
                const catboxRes = await fetch('https://catbox.moe/user/api.php', {
                  method: 'POST',
                  body: catboxForm,
                  signal: AbortSignal.timeout(6000)
                });
                if (catboxRes.ok) {
                  const catboxText = (await catboxRes.text()).trim();
                  if (catboxText.startsWith('https://files.catbox.moe/')) {
                    fileUrl = catboxText;
                  }
                }
              } catch (_) {}
            })()
          ];

          if (thumbnailFile && typeof thumbnailFile.arrayBuffer === 'function') {
            uploadTasks.push((async () => {
              try {
                const tForm = new FormData();
                tForm.append('reqtype', 'fileupload');
                if (process.env.CATBOX_USERHASH) tForm.append('userhash', process.env.CATBOX_USERHASH);
                tForm.append('fileToUpload', thumbnailFile, `${sanitizedName.replace(/[^a-zA-Z0-9_-]/g, '_')}_thumb.jpg`);
                const tRes = await fetch('https://catbox.moe/user/api.php', {
                  method: 'POST',
                  body: tForm,
                  signal: AbortSignal.timeout(6000)
                });
                if (tRes.ok) {
                  const tText = (await tRes.text()).trim();
                  if (tText.startsWith('https://files.catbox.moe/')) {
                    thumbUrl = tText;
                  }
                }
              } catch (_) {}
            })());
          }

          await Promise.all(uploadTasks);
        } catch (catboxErr) {
          console.warn('[Share] Catbox upload error/timeout:', catboxErr.message);
        }

        // 6. Local dev fallback: if Catbox is down/unreachable, store .ofts locally
        if (!fileUrl) {
          try {
            const filesDir = path.join(ROOT, 'storage', 'files');
            if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });
            const localFileName = `${nextId}_${safeName}`;
            const localFilePath = path.join(filesDir, localFileName);
            const arrayBuf = await file.arrayBuffer();
            fs.writeFileSync(localFilePath, Buffer.from(arrayBuf));
            fileUrl = `${origin}/storage/files/${localFileName}`;
            console.log(`[Share] Saved to local dev storage: ${fileUrl}`);

            if (!thumbUrl && thumbnailFile && typeof thumbnailFile.arrayBuffer === 'function') {
              const localThumbName = `${nextId}_thumb.jpg`;
              const localThumbPath = path.join(filesDir, localThumbName);
              const tBuf = await thumbnailFile.arrayBuffer();
              fs.writeFileSync(localThumbPath, Buffer.from(tBuf));
              thumbUrl = `${origin}/storage/files/${localThumbName}`;
            }
          } catch (storageErr) {
            console.error('[Share] Local storage fallback failed:', storageErr);
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'Storage provider error and local fallback failed' }));
            return;
          }
        }

        const record = {
          id: nextId,
          name: sanitizedName,
          specs: sanitizedSpecs,
          size: sanitizedSize,
          aspectRatio: sanitizedAspect,
          thumbnail: thumbUrl || sanitizedThumbnail,
          fileUrl,
          createdAt: Date.now()
        };

        shares[nextId] = record;
        saveLocalShares(shares);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(JSON.stringify({
          success: true,
          id: nextId,
          shareUrl: `${origin}/${nextId}`,
          catboxUrl: fileUrl,
          record
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    })();
    return;
  }

  // API: Get Project Metadata or Proxy Download
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/project') {
    (async () => {
      try {
        const rawId = parsedUrl.searchParams.get('id');
        const isDownload = parsedUrl.searchParams.get('download') === '1';

        if (!rawId || typeof rawId !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Missing or invalid id query parameter' }));
          return;
        }

        // Strict ID sanitization
        const id = rawId.slice(0, 32).replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Invalid id format' }));
          return;
        }

        const shares = getLocalShares();
        const record = shares[id];
        if (!record || !record.fileUrl) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'Project Not Found' }));
          return;
        }

        const isThumb = parsedUrl.searchParams.get('thumb') === '1' || parsedUrl.searchParams.get('thumbnail') === '1';
        if (isThumb) {
          if (record.thumbnail && typeof record.thumbnail === 'string') {
            const match = record.thumbnail.match(/^data:(image\/[a-zA-Z0-9\+\-]+);base64,(.+)$/);
            if (match) {
              const mime = match[1];
              const buf = Buffer.from(match[2], 'base64');
              res.writeHead(200, {
                'Content-Type': mime,
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*'
              });
              res.end(buf);
              return;
            }
          }
          res.writeHead(302, { 'Location': '/assets/icon-192.png' });
          res.end();
          return;
        }

        let isCatbox = false;
        let isLocal = false;

        // SSRF Protection: strictly verify storage hostname, port, and credentials
        try {
          const parsedStorageUrl = new URL(record.fileUrl);
          isCatbox = (
            parsedStorageUrl.protocol === 'https:' &&
            parsedStorageUrl.hostname === 'files.catbox.moe' &&
            (parsedStorageUrl.port === '' || parsedStorageUrl.port === '443') &&
            !parsedStorageUrl.username &&
            !parsedStorageUrl.password
          );
          isLocal = (
            (parsedStorageUrl.hostname === 'localhost' || parsedStorageUrl.hostname === '127.0.0.1') &&
            parsedStorageUrl.pathname.startsWith('/storage/files/')
          );
          if (!isCatbox && !isLocal) {
            res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ success: false, error: 'Unauthorized storage source' }));
            return;
          }
        } catch (_) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'Invalid storage URL' }));
          return;
        }

        if (isLocal) {
          const parsedStorageUrl = new URL(record.fileUrl);
          const localRelPath = parsedStorageUrl.pathname.replace(/^\/+/, '');
          const localFilePath = path.join(ROOT, localRelPath);
          if (!fs.existsSync(localFilePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ success: false, error: 'Project Not Found', fileMissing: true }));
            return;
          }
          if (isDownload) {
            const safeName = String(record.name || 'Project').slice(0, 60).replace(/[^a-zA-Z0-9_\-]/g, '_') + '.ofts';
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename="${safeName}"`,
              'Access-Control-Allow-Origin': '*',
              'X-Content-Type-Options': 'nosniff'
            });
            res.end(fs.readFileSync(localFilePath));
            return;
          }
        } else {
          // Verify file is still live and available on Catbox (fast 2-byte range probe)
          try {
            const probe = await fetch(record.fileUrl, {
              headers: { 'Range': 'bytes=0-1' },
              signal: AbortSignal.timeout(4000)
            });
            if (probe.status === 404 || (!probe.ok && probe.status !== 416)) {
              res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ success: false, error: 'Project Not Found', fileMissing: true }));
              return;
            }
          } catch (_) {}

          if (isDownload) {
            // Stream file from Catbox to bypass browser CORS / ISP blocks
            const fileRes = await fetch(record.fileUrl, { signal: AbortSignal.timeout(15000) });
            if (!fileRes.ok) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project Not Found', fileMissing: true }));
              return;
            }
            const safeName = String(record.name || 'Project').slice(0, 60).replace(/[^a-zA-Z0-9_\-]/g, '_') + '.ofts';
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename="${safeName}"`,
              'Access-Control-Allow-Origin': '*',
              'X-Content-Type-Options': 'nosniff'
            });
            const arrayBuffer = await fileRes.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
            return;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, project: record }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message || 'Server error' }));
      }
    })();
    return;
  }

  // Resolve target file
  const relativePath = pathname.replace(/^\/+/, '');
  let filePath = path.join(ROOT, relativePath);

  // If path is directory or root, check for index.html
  if (!relativePath || (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory())) {
    filePath = path.join(ROOT, 'index.html');
  }

  // Clean URL mapping (/desktop -> desktop.html, /editor -> editor.html)
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else if (fs.existsSync(path.join(ROOT, relativePath + '.html'))) {
      filePath = path.join(ROOT, relativePath + '.html');
    }
  }

  // Project short link mapping (e.g. /1, /project-id) -> index.html
  if (!fs.existsSync(filePath) && /^[a-zA-Z0-9_-]+$/.test(relativePath)) {
    filePath = path.join(ROOT, 'index.html');
  }

  // Security: prevent path traversal out of project root
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><title>404 Not Found</title></head><body style="font-family:sans-serif;padding:40px;background:#0d1109;color:#c0dbc0;"><h2>404 Not Found</h2><p>Cannot find <code>${pathname}</code></p><p><a href="/" style="color:#98ce7b;">Go to Home</a> | <a href="/desktop" style="color:#98ce7b;">Go to Desktop</a> | <a href="/editor" style="color:#98ce7b;">Go to Editor</a></p></body></html>`);
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

    const headers = {
      'Content-Type': contentType,
      'Cache-Control': process.env.VERCEL ? 'public, max-age=3600' : 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    };
    if (path.basename(filePath) === 'sw.js') {
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }

    res.writeHead(200, headers);
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
      console.log(`    - Home:    ${publicUrl}/`);
      console.log(`    - Desktop: ${publicUrl}/desktop`);
      console.log(`    - Editor:  ${publicUrl}/editor`);
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
    console.log(`    - Home:    http://localhost:${PORT}/`);
    console.log(`    - Desktop: http://localhost:${PORT}/desktop`);
    console.log(`    - Editor:  http://localhost:${PORT}/editor`);
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
