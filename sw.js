// Keš aplikacije, da radi i bez interneta. Verzija se menja sa svakim build-om.
const CACHE = 'kt-38ae546bc4';
const FILES = [
 "./",
 "index.html",
 "manifest.webmanifest",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "src/analysis.js",
 "src/app.js",
 "src/format.js",
 "src/kitchen.js",
 "src/normalize.js",
 "src/parser.js",
 "src/platform/local-store.js",
 "src/platform/speech.js",
 "src/store.js",
 "src/sync.js",
 "src/totals.js",
 "src/ui/analysis.js",
 "src/ui/bills.js",
 "src/ui/dom.js",
 "src/ui/entry.js",
 "src/ui/home.js",
 "src/ui/kitchen.js",
 "src/ui/purchases.js",
 "src/ui/settings.js"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.github.com') return;
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    // Prvo mreža (uvek najnovija verzija), keš samo kad nema interneta.
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
