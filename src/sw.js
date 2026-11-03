// Service worker: makes the hosted web app load offline.
// tools/build-web.js replaces VERSION and PRECACHE for deploys; in dev (VERSION 'dev') it is network-first.
const VERSION = 'dev';
const PRECACHE = [];
const CACHE = `recall-${VERSION}`;

self.addEventListener('install', e => {
  self.skipWaiting();
  if (VERSION === 'dev') return;
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(p => new Request(p, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // sync API calls go straight to the network
  if (VERSION === 'dev') { e.respondWith(fetch(req).catch(() => caches.match(req))); return; }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
