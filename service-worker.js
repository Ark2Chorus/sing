// Bump this with every build -- it's what forces the browser to fetch a
// fresh copy instead of serving a stale cached one.
//
// A file listed with ?v=<hash> never changes under that address (the hash is
// of its contents; `py tools/stamp.py` rewrites them here and in index.html),
// so a copy saved by an earlier build is kept instead of downloaded again.
// That's what spares phones the ~20MB voicebank on builds that don't touch it.
const CACHE_VERSION = 'ark2-chorus-v108';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/singer-male.png',
  './icons/singer-female.png',
  './icons/logo.jpg?v=ddaebaf042',
  './css/app.css?v=44b817cdfb',
  './js/singer.js?v=ce28d90410',
  './js/voicepack.js?v=9915a7387b',
  './js/app.js?v=de9ea85060',
  // The voice, dictionary and instrument samples, so everything plays offline.
  './data/cmudict.js?v=40c42fbdaa',
  './data/voicepack.js?v=4c0afdebe9',
  './data/piano-samples.js?v=4974cea038',
  './data/choir-samples.js?v=fc02f79d45',
  './vendor/opensheetmusicdisplay.min.js?v=7d55739567',
  './vendor/tone.min.js?v=9cf37a5a1b',
  './vendor/jszip.min.js?v=ddd54a3a4a',
  './vendor/lame.min.js?v=c1991df998',     // MP3 export
  // PDF.js for Music Sheet -- kept with the app so sheets open offline.
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/page-flip.browser.js',   // StPageFlip -- the book-style page turn
];
// How long opening the app waits for the site before using the saved page.
const PAGE_WAIT_MS = 4000;

// Each file is saved on its own and a failure doesn't fail the install: a
// failed install would leave an older worker in charge, still answering
// reloads with its own old page, however old that build is. Anything missed
// here comes from the network until the page's "cache-fill" saves it.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => Promise.all(APP_SHELL.map(async (url) => {
      try{
        if (url.includes('?v=')){
          const saved = await caches.match(url);
          if (saved){ await cache.put(url, saved); return; }
        }
        // cache: "reload" fetches each file fresh from the site, not from the
        // browser's HTTP cache -- otherwise a new build could precache old files.
        await cache.add(new Request(url, { cache: "reload" }));
      }catch(err){
        // Left for cache-fill -- and an older copy under this name (from an
        // earlier install of the same version) mustn't stand in for it.
        await cache.delete(url).catch(() => {});
      }
    })))
  );
  self.skipWaiting();
});

// The page asks how much of the app is saved for offline ("cache-status"),
// or asks for anything missing to be fetched again ("cache-fill"). Replies go
// back on the MessageChannel port the page sends.
self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type !== 'cache-status' && type !== 'cache-fill') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    if (type === 'cache-fill'){
      await Promise.all(APP_SHELL.map(async (url) => {
        if (await cache.match(url)) return;
        try{
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (res.ok) await cache.put(url, res);
        }catch(err){ /* still offline: it stays missing */ }
      }));
    }
    const found = await Promise.all(APP_SHELL.map((url) => cache.match(url)));
    const reply = {
      type: 'cache-status', version: CACHE_VERSION, total: APP_SHELL.length,
      have: found.filter(Boolean).length,
      missing: APP_SHELL.filter((url, i) => !found[i])
    };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
  })());
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

// Cache-first for the app shell (~27MB with the voicebank -- once it's
// cached, this is what makes reopening the app instant and offline-capable
// instead of re-downloading it every time).
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

  // Opening the app: the page (~30KB; everything heavy is in the ?v= files)
  // comes from the site first, and the fresh copy is saved. The saved page
  // is only for when the site can't be reached -- offline, or no answer
  // within PAGE_WAIT_MS -- so a saved page from any older build can never
  // keep coming back while the site is there. (config.ark2 and version.json
  // aren't page loads and aren't cached; they always come fresh.)
  if (event.request.mode === 'navigate' && (url.pathname === scope || url.pathname === scope + 'index.html')){
    const fresh = fetch(event.request, { cache: 'no-cache' }).then(async (res) => {
      if (res.ok && res.type === 'basic'){
        const cache = await caches.open(CACHE_VERSION);
        await cache.put('./index.html', res.clone());
      }
      return res;
    });
    event.waitUntil(fresh.catch(() => {}));
    event.respondWith((async () => {
      const slow = new Promise((resolve) => setTimeout(resolve, PAGE_WAIT_MS));
      const first = await Promise.race([fresh.catch(() => null), slow]);
      if (first && first.ok) return first;
      const saved = (await caches.match('./index.html')) || (await caches.match('./'));
      return saved || first || fresh;   // nothing saved: the site's answer, whenever it comes
    })());
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
