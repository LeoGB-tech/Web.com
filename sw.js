// Ancre — met l'appli en cache pour qu'elle s'ouvre sans réseau.
const CACHE = 'ancre-2.0.0';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  const key = e.request.mode === 'navigate' ? '/index.html' : e.request;
  // réseau d'abord (pour les mises à jour), cache si hors ligne
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return r;
  }).catch(() => caches.match(key).then((r) => r || caches.match('/index.html'))));
});
