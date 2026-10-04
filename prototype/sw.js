// Service worker: cache only this app's own assets, relative to this file,
// so the app works offline after one successful load under any subdirectory.
const CACHE = 'surface-proto-v12-jobs-review-20261004';
const CACHE_PREFIX = 'surface-proto-';
// Precache real files only. './' (the directory URL) is deliberately excluded:
// addAll is atomic and a directory response can vary by server, which would
// abort the whole install and stop the worker from ever becoming ready.
const ASSETS = ['./index.html', './css/style.css', './js/ui.js', './js/core.js', './js/jobs.js', './manifest.webmanifest'];

// cache: 'reload' goes past the browser's HTTP cache, so a long max-age can't
// put an older file into a new version's cache. Still all-or-nothing.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const scopeDir = new URL('.', self.registration.scope).pathname; // trailing-slash dir
  if (url.origin !== self.location.origin) return; // never touch other origins
  if (!url.pathname.startsWith(scopeDir)) return;  // only this app's subdirectory
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then((cache) =>
    cache.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((resp) => {
      if (resp.ok && url.origin === self.location.origin) {
        const copy = resp.clone();
        cache.put(e.request, copy);
      }
      return resp;
    }).catch(() => {
      // Offline fallback for NAVIGATION only. A missed module or stylesheet must
      // fail loudly, never be papered over with an HTML page.
      if (e.request.mode === 'navigate') return cache.match('./index.html');
      return Response.error();
    }))
  ));
});
