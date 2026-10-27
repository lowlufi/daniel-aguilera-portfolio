/*
 * Service worker for the installed game «Escuadrón Dui» (/aviones).
 * - The page itself: network first, so a new deploy shows up; the cached copy when
 *   offline, or when the network hangs (a weak signal) for more than a few seconds.
 * - Built assets (/assets/*, hashed names) and sounds: cache first, they never change.
 * - On install it precaches everything the game needs (code, fonts, sounds), so the installed
 *   app opens offline even if some part never got loaded online. The build
 *   (vite.config.ts) fills PRECACHE and derives VERSION from it; in dev both stay as is.
 * Old caches are dropped when the version changes.
 */
const VERSION = 'escuadron-dui-v1';
const PRECACHE = [];
const PAGINA = '/aviones';
/** How long the page waits for the network before falling back to the cached copy. */
const ESPERA_RED = 3500;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then(async (c) => {
        // The page and icons must be there; the rest is best effort, one by one,
        // so a single failed file doesn't throw the whole install away.
        await c.addAll([PAGINA, '/aviones-192.png', '/aviones-512.png']);
        // Files unchanged since the previous version are copied from its cache.
        await Promise.all(
          PRECACHE.map((u) =>
            caches.match(u).then((hit) => (hit ? c.put(u, hit) : c.add(u)).catch(() => {})),
          ),
        );
      })
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

  // The game page: fresh when online, cached when not (or when the network stalls).
  if (req.mode === 'navigate') {
    const red = fetch(req).then((res) => {
      if (res.ok) {
        const copia = res.clone();
        caches.open(VERSION).then((c) => c.put(PAGINA, copia));
      }
      return res;
    });
    e.respondWith(
      new Promise((resolve, reject) => {
        let listo = false;
        const usar = (r) => {
          if (!listo && r) {
            listo = true;
            resolve(r);
          }
        };
        const desdeCache = () => caches.match(PAGINA);
        const t = setTimeout(() => desdeCache().then(usar), ESPERA_RED);
        red.then(
          (res) => {
            clearTimeout(t);
            usar(res);
          },
          () => {
            clearTimeout(t);
            desdeCache().then((hit) => (hit ? usar(hit) : listo || reject(new Error('offline'))));
          },
        );
      }),
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
