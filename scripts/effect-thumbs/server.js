/**
 * Effect thumbnail render server.
 * Serves the repo statically and accepts POST /save?path=<repo-relative> (raw body) -> writes file.
 * Usage: node scripts/effect-thumbs/server.js  then open http://localhost:8765/scripts/effect-thumbs/render.html in Safari.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8765;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && u.pathname === '/save') {
    const rel = u.searchParams.get('path') || '';
    const abs = path.resolve(ROOT, rel);
    if (!abs.startsWith(ROOT + path.sep)) { res.writeHead(400); return res.end('bad path'); }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.concat(chunks));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  const abs = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(abs).pipe(res);
}).listen(PORT, () => console.log('thumb server on http://localhost:' + PORT));
