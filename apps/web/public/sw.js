// QueueFlow's service worker (Phase 11, ADR-010) — deliberately minimal.
// Scope: same-origin page/asset requests only. Every API call goes to a
// different origin (NEXT_PUBLIC_API_URL) and is never touched here, so
// live queue state, SSE streams, and customer/staff data are never served
// stale from a cache — this SW only helps the app *shell* reopen (and
// register as installable) when the network is briefly unavailable.
const CACHE_NAME = "queueflow-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only GET, only our own origin — a cross-origin request (the API, at
  // NEXT_PUBLIC_API_URL) is left completely alone, untouched by this SW.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
