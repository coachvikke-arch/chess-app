/* App-shell service worker for the installed PWA.
 *
 * WHY THIS EXISTS
 * The app is a single-page bundle behind a hard network round trip on every
 * launch, which is the 1-2s white gap between the Android splash and the first
 * screen. Once the shell is in the Cache API a repeat launch paints from disk
 * before the network is involved at all.
 *
 * WHY HAND-WRITTEN RATHER THAN GENERATED
 * The build emits content-hashed asset names, so a static precache list could
 * never name the main JS/CSS files. Instead the few stable URLs are precached
 * and every other same-origin asset is cached the first time the app fetches it
 * (stale-while-revalidate), which reaches the same result without a build step.
 *
 * WHAT IS DELIBERATELY NOT CACHED
 * /api, /uploads and /socket.io are the live academy's data — a stale copy of a
 * class schedule, a message list or a student's photo is worse than a slow one.
 * Those requests pass straight through to the network.
 *
 * TO SHIP AN UPDATE: bump CACHE_VERSION. The activate step drops every cache
 * whose name does not carry it, so clients pick the new shell up on their next
 * launch.
 */
const CACHE_VERSION = 'mate-zone-v1';
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon-maskable-512.png',
  '/favicon-48.png',
  '/apple-touch-icon.png',
];

/* A cache.put that the disk quota refuses must not turn into an unhandled
   rejection in the worker. */
const put = (cache, request, response) => cache.put(request, response).catch(() => {});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_URLS))
      /* One missing shell file must not abort the install and leave the app
         with no offline copy at all — cache what answered. */
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isApiPath = (url) => url.pathname === '/api' || url.pathname.startsWith('/api/')
  || url.pathname.startsWith('/uploads/')
  || url.pathname.startsWith('/socket.io/');

/* The chess engines are tens of megabytes of wasm. Caching them is a quota
   gamble and revalidating one on every board page is a 100MB download over a
   phone connection, so they keep the behaviour they had before this worker
   existed: straight to the network. */
const isEnginePath = (url) => url.pathname.startsWith('/stockfish');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isApiPath(url) || isEnginePath(url)) return;

  const sameOrigin = url.origin === self.location.origin;
  /* Google Fonts are cross-origin and opaque to the Cache API, but they are a
     render-blocking part of the first paint, so they are worth holding on to. */
  const isFontHost = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFontHost) return;

  /* A page load must not be served from cache: that is how a client stays on a
     stale index.html forever. Network first, cache only as the offline net. */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => put(cache, '/', copy));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error()))
    );
    return;
  }

  /* Vite puts `-<hash>` in every bundle name, so a hashed file's content can
     never change: a new build produces a new URL. Those answer from cache with
     no round trip at all — that is what makes a repeat launch paint instantly. */
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => put(cache, request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  /* Everything else — icons, board and piece images, the font CSS — answers
     from cache immediately and refreshes in the background. */
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => put(cache, request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
