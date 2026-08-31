// Cam Strength — service worker. Network-first, no offline caching of app data
// (all state lives in localStorage + Supabase). Its only job is to make the app
// installable as a PWA and always serve the freshest index.html.
self.addEventListener('install', function (e) { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).catch(function () { return caches.match(e.request); })
  );
});
