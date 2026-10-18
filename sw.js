// Ancre — garde l'appli en cache pour qu'elle s'ouvre sans réseau.
const CACHE = 'ancre-3.0.0';
const FILES = ['./', './index.html', './readability.js', './relais.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const url = (p) => new URL(p, self.registration.scope).href;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map(url))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // le relais passe directement
  const key = req.mode === 'navigate' ? url('./index.html') : req;
  e.respondWith(
    fetch(req).then((r) => {
      if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return r;
    }).catch(() => caches.match(key, { ignoreSearch: true }).then((r) => r || caches.match(url('./index.html'))))
  );
});
