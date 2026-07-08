// HQ Service Worker
self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  e.respondWith(fetch(e.request, {cache: 'no-store'}));
});

self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data.json(); } catch(err) { data = {title:'HQ', body: e.data ? e.data.text() : 'Time to check in.'}; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'HQ', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'hq-notification',
      data: { url: data.url || '/' },
      requireInteraction: data.requireInteraction || false,
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list) {
      for(var i=0; i<list.length; i++) {
        if(list[i].url.includes(self.location.origin)) { list[i].focus(); return; }
      }
      return clients.openWindow(url);
    })
  );
});
