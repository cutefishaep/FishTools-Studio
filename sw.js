/**
 * OpenFishTools Studio - Service Worker
 * Version: 0.5.74
 * 
 * Provides offline caching, lightning-fast boot times,
 * and enables PWA standalone install experience.
 */

const CACHE_NAME = 'oft-studio-v0.5.74';

const CORE_ASSETS = [
  './',
  'index.html',
  'editor.html',
  'desktop.html',
  'manifest.webmanifest',
  'css/theme.css',
  'css/layout.css',
  'css/modal.css',
  'css/context-menu.css',
  'css/safari.css',
  'css/desktop.css',
  'js/modal.js',
  'js/context-menu.js',
  'js/db.js',
  'js/pwa-install.js',
  'js/main.js',
  'js/editor.js',
  'js/desktop.js',
  'js/attributes-clipboard.js',
  'js/template-editor.js',
  'js/fishtools-adapter.js',
  'Extension/extension.html',
  'Extension/css/style.css',
  'Extension/css/fonts.css',
  'assets/icon.svg',
  'assets/copy.svg',
  'assets/paste.svg',
  'assets/pickwhip.svg',
  'assets/layer-null.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/doodles.svg',
  'assets/grid.svg',
  'assets/handles.svg',
  'assets/fonts/CalSans-SemiBold.woff2'
];

// Install: Pre-cache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Purge obsolete caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('oft-studio-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Purging outdated cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Smart caching strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip DevServer SSE, API endpoints, extension URLs, range requests
  if (
    url.pathname.includes('__live_reload') ||
    url.pathname.includes('__config') ||
    url.pathname.startsWith('/api/') ||
    url.protocol.startsWith('chrome-extension') ||
    req.headers.has('range')
  ) {
    return;
  }

  // HTML navigation: Network first, fall back to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(req).then((cached) => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // Same-origin static assets (scripts, styles, icons): Network first, fall back to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(req);
        })
    );
    return;
  }

  // External static assets (fonts, icons): Cache first with network fallback
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => new Response('', { status: 408, statusText: 'Request Timeout' }));
    })
  );
});
