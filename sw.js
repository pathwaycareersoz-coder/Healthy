// Pain Driven Man — service worker for offline "add to home screen" use.
// Bump CACHE when you ship changes so phones pick up the new version.
const CACHE = "pdm-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for the page (so updates land), cache-first for static icons,
// with an offline fallback to the cached shell.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isDoc = req.mode === "navigate" || url.pathname.endsWith("index.html") || url.pathname.endsWith("/");
  if (isDoc) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
