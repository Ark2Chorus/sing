// Bump this whenever index.html (or anything else in APP_SHELL) changes --
// it's what forces the browser to fetch a fresh copy instead of serving a
// stale cached one. Everything the app needs (fonts, libraries, the
// voicebank audio) is already embedded inside index.html itself, so the
// shell list here is short.
const CACHE_VERSION = 'ark2-chorus-v32';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: "reload" fetches each file fresh from the site, not from the
    // browser's HTTP cache -- otherwise a new build could precache old files.
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Cache-first for the app shell (index.html is ~26MB thanks to the
// embedded voicebank -- once it's cached, this is what makes reopening the
// app instant and offline-capable instead of re-downloading it every time).
// Anything not in the shell just falls through to a normal network fetch.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        // Offline and not cached (e.g. first visit had no connectivity) --
        // nothing sensible to serve instead, let the browser show its own
        // offline error rather than masking it with a fake response.
        return cached;
      });
    })
  );
});
