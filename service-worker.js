// Bump this whenever index.html (or anything else in APP_SHELL) changes --
// it's what forces the browser to fetch a fresh copy instead of serving a
// stale cached one. Everything the app needs (fonts, libraries, the
// voicebank audio) is already embedded inside index.html itself, so the
// shell list here is short.
const CACHE_VERSION = 'ark2-chorus-v77';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  // PDF.js for Music Sheet -- kept with the app so sheets open offline.
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/page-flip.browser.js',   // StPageFlip -- the book-style page turn
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
  // Other sites (Google Drive listings, streamed songs) go straight to the
  // network -- nothing of theirs is cached here, and passing streamed audio
  // through the worker only gets in the way.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // The singer library and its demo (singer/) are separate pages with their
  // own files; they're not part of the app and aren't handled here.
  const scope = new URL('./', self.location).pathname;
  if (url.pathname.startsWith(scope + 'singer/')) return;

  // Opening the app: always answer with the saved page when there is one,
  // whatever query string or path variant the phone opens it with -- so the
  // installed app starts offline. (config.ark2 and version.json aren't page
  // loads and aren't cached, so they always come fresh from the site.)
  if (event.request.mode === 'navigate' && (url.pathname === scope || url.pathname === scope + 'index.html')){
    event.respondWith(
      caches.match('./index.html').then((cached) =>
        cached || fetch(event.request).catch(() => caches.match('./')))
    );
    return;
  }

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
