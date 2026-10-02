// Service worker minimal : coquille de l'application disponible hors ligne ; l'API n'est jamais mise en cache.
const CACHE = 'edjambo-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return; // données toujours fraîches
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  // Fichiers statiques (hachés par Vite) : cache d'abord, mise à jour en arrière-plan
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request)
        .then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
