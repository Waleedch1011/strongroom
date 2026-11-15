/* Strongroom offline cache.
   Pages: try the network first (so updates arrive at once), fall back to the saved copy when offline.
   Icons and manifest: serve the saved copy, refresh it in the background. */
const CACHE = 'strongroom-v2';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    const network = fetch(req, { cache: 'no-cache' });
    const update = network.then((res) => {
      if (!res || !res.ok || res.type !== 'basic') return;
      const copy = res.clone();
      return caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
    }).catch(() => {});
    event.waitUntil(update);
    event.respondWith((async () => {
      const fresh = await withTimeout(network, NETWORK_TIMEOUT_MS);
      if (fresh && fresh.ok) return fresh;
      const cache = await caches.open(CACHE);
      const saved = await cache.match('./index.html');
      if (saved) return saved;
      return (await network.catch(() => null)) || Response.error();
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (saved) {
      event.waitUntil(network);
      return saved;
    }
    return (await network) || Response.error();
  })());
});
