/**
 * Cloudflare Worker Entrypoint with Static Assets & API Routing
 */
import { onRequestPost as handleSharePost, onRequestOptions as handleShareOptions } from './functions/api/share.js';
import { onRequestGet as handleProjectGet, onRequestOptions as handleProjectOptions } from './functions/api/project.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // Security: block direct access to .env, dotfiles, storage, server internals, and build scripts
      if (
        pathname === '/.env' || pathname.startsWith('/.env') || pathname.includes('/.env') || pathname.startsWith('/.') ||
        pathname === '/storage' || pathname.startsWith('/storage') ||
        pathname === '/scripts' || pathname.startsWith('/scripts') ||
        pathname === '/server.js' || pathname === '/package.json' || pathname === '/package-lock.json' ||
        pathname === '/wrangler.jsonc' || pathname === '/wrangler.jsonc.example'
      ) {
        return new Response('403 Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }

      // 1. API: /api/share
      if (pathname === '/api/share') {
        if (request.method === 'POST') {
          return handleSharePost({ request, env, params: {}, waitUntil: ctx && ctx.waitUntil ? ctx.waitUntil.bind(ctx) : () => {} });
        }
        if (request.method === 'OPTIONS') {
          return handleShareOptions ? handleShareOptions({ request, env }) : new Response(null, { status: 204 });
        }
      }

      // 2. API: /api/project
      if (pathname === '/api/project') {
        if (request.method === 'GET' || request.method === 'HEAD') {
          return handleProjectGet({ request, env, params: {}, waitUntil: ctx && ctx.waitUntil ? ctx.waitUntil.bind(ctx) : () => {} });
        }
        if (request.method === 'OPTIONS') {
          return handleProjectOptions ? handleProjectOptions({ request, env }) : new Response(null, { status: 204 });
        }
      }

      const assets = env.ASSETS || env.__STATIC_CONTENT;
      if (!assets) {
        return new Response('Assets binding not available', { status: 500 });
      }

      // 4. Clean URLs: /desktop -> /desktop.html, /editor -> /editor.html
      if (pathname === '/desktop') {
        return assets.fetch(new Request(new URL('/desktop.html', request.url), request));
      }
      if (pathname === '/editor') {
        return assets.fetch(new Request(new URL('/editor.html', request.url), request));
      }

      // 5. Shortlink support: e.g. /1, /project-id -> /index.html with dynamic OpenGraph meta tags
      const cleanPath = pathname.replace(/^\/+|\/+$/g, '');
      if (/^[a-zA-Z0-9_-]+$/.test(cleanPath) && !cleanPath.includes('.') && cleanPath !== 'api') {
        const indexRes = await assets.fetch(new Request(new URL('/', request.url), request));
        let html = await indexRes.text();

        // Fetch project metadata from KV to inject rich social preview tags
        const kv = env.PROJECTS_KV;
        let project = null;
        if (kv) {
          try {
            const raw = await kv.get(cleanPath);
            if (raw) project = JSON.parse(raw);
          } catch (_) {}
        }

        if (project) {
          const origin = url.origin;
          const projectName = (project.name || 'Untitled Project').replace(/["<>]/g, '');
          const specs = (project.specs || '').replace(/["<>]/g, '');
          const size = (project.size || '').replace(/["<>]/g, '');
          const aspect = (project.aspectRatio || '').replace(/["<>]/g, '');
          const desc = [specs, size, aspect].filter(Boolean).join(' • ');
          const thumbUrl = `${origin}/api/project?id=${cleanPath}&thumb=1`;
          const shareUrl = `${origin}/${cleanPath}`;

          const ogTags = `
    <!-- Essential OpenGraph Metadata -->
    <title>${projectName}</title>
    <meta name="description" content="${desc}">
    <meta property="og:site_name" content="OpenFishTools Studio">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${shareUrl}">
    <meta property="og:title" content="${projectName}">
    <meta property="og:description" content="${desc}">
    <meta property="og:image" content="${thumbUrl}">
    <meta property="og:image:secure_url" content="${thumbUrl}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="600">
    <meta property="og:image:height" content="600">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${projectName}">
    <meta name="twitter:description" content="${desc}">
    <meta name="twitter:image" content="${thumbUrl}">
`;

          html = html.replace(/<title>.*?<\/title>/i, '');
          html = html.replace('<head>', `<head>${ogTags}`);
        }

        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=60'
          }
        });
      }

      // 6. Default: serve static assets from directory
      return assets.fetch(request);
    } catch (err) {
      console.error('[Worker Fatal Error]', err);
      return new Response(err.stack || err.message, { status: 500 });
    }
  }
};
