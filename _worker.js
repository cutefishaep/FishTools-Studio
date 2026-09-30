/**
 * Cloudflare Worker Entrypoint with Static Assets & API Routing
 */
import { onRequestPost as handleSharePost, onRequestOptions as handleShareOptions } from './functions/api/share.js';
import { onRequestGet as handleProjectGet, onRequestOptions as handleProjectOptions } from './functions/api/project.js';
import { onRequestGet as handleConfigGet } from './functions/__config.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // Security: block direct access to .env, dotfiles, storage, server internals
      if (
        pathname === '/.env' || pathname.startsWith('/.env') || pathname.includes('/.env') || pathname.startsWith('/.') ||
        pathname === '/storage' || pathname.startsWith('/storage') ||
        pathname === '/server.js' || pathname === '/package.json' || pathname === '/package-lock.json' || pathname === '/wrangler.jsonc'
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

      // 3. API: /__config or /api/config
      if (pathname === '/__config' || pathname === '/api/config') {
        return handleConfigGet({ request, env, params: {}, waitUntil: ctx && ctx.waitUntil ? ctx.waitUntil.bind(ctx) : () => {} });
      }

      const assets = env.ASSETS || env.__STATIC_CONTENT;
      if (!assets) {
        return new Response('Assets binding not available', { status: 500 });
      }

      // 4. Clean URLs: /editor -> /editor.html, /demo -> /demo.html
      if (pathname === '/editor') {
        return assets.fetch(new Request(new URL('/editor.html', request.url), request));
      }
      if (pathname === '/demo') {
        return assets.fetch(new Request(new URL('/demo.html', request.url), request));
      }

      // 5. Shortlink support: e.g. /1, /project-id -> /index.html
      const cleanPath = pathname.replace(/^\/+|\/+$/g, '');
      if (/^[a-zA-Z0-9_-]+$/.test(cleanPath) && !cleanPath.includes('.') && cleanPath !== 'api') {
        return assets.fetch(new Request(new URL('/index.html', request.url), request));
      }

      // 6. Default: serve static assets from directory
      return assets.fetch(request);
    } catch (err) {
      console.error('[Worker Fatal Error]', err);
      return new Response(err.stack || err.message, { status: 500 });
    }
  }
};
