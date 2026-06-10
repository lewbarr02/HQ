// HQ Service Worker - No Cache Version
self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  // Clear ALL caches
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

// Never cache - always fetch from network
self.addEventListener('fetch', function(e) {
  e.respondWith(fetch(e.request, {cache: 'no-store'}));
});
