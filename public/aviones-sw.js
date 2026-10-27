/*
 * Service worker for the installed game «Escuadrón Dui» (/aviones).
 * - The page itself: network first, so a new deploy shows up; the cached copy when offline.
 * - Built assets (/assets/*, hashed names) and sounds: cache first, they never change.
 * Old caches are dropped when the version changes.
 */
const VERSION = 'escuadron-dui-v1';
const PAGINA = '/aviones';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll([PAGINA, '/aviones-192.png', '/aviones-512.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('escuadron-dui-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The game page: fresh when online, cached when not.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(PAGINA, copia));
          return res;
        })
        .catch(() => caches.match(PAGINA)),
    );
    return;
  }

  // Hashed bundles, sounds and icons: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/sonidos/') || url.pathname.startsWith('/aviones-')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copia = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copia));
            }
            return res;
          }),
      ),
    );
  }
});
