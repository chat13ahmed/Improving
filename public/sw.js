/* Business Escalate service worker — makes the app installable & offline-capable.
   Strategy: network-first for the app shell (so edits are picked up online,
   cache is the offline fallback). API calls and writes are never cached. */
const CACHE = 'be-shell-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'vendor/chart.umd.min.js', 'vendor/marked.min.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch { return; }
  // Only handle same-origin GETs; never touch the API (always live)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html', { ignoreSearch: true })))
  );
});
