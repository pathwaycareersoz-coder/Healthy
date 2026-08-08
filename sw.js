// Pain Driven Man — service worker for offline "add to home screen" use.
// Bump CACHE when you ship changes so phones pick up the new version.
const CACHE = "pdm-v4";
// Must match PUSH_ENDPOINT in index.html (your Cloudflare Worker URL). Empty = push off.
const PUSH_ENDPOINT = "";
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

// Web Push: pushes are payload-less; fetch the due reminder text from the Worker.
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let title = "Pain Driven Man", body = "Time for your next check-in.";
    try {
      if (e.data) { const d = e.data.json(); title = d.title || title; body = d.body || body; }
      else if (PUSH_ENDPOINT) {
        const sub = await self.registration.pushManager.getSubscription();
        if (sub) {
          const r = await fetch(PUSH_ENDPOINT.replace(/\/$/, "") + "/due", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          if (r.ok) { const j = await r.json(); title = j.title || title; body = j.body || body; }
        }
      }
    } catch (_) {}
    await self.registration.showNotification(title, {
      body, icon: "icons/icon-192.png", badge: "icons/favicon-64.png",
      tag: "pdm-push", renotify: true, data: { url: "./index.html" },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { try { await c.focus(); return; } catch (_) {} } }
    if (self.clients.openWindow) await self.clients.openWindow("./index.html");
  })());
});
