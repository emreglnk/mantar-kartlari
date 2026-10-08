// Service worker — üç önbellek:
//   shell: uygulama dosyaları (cache-first, sürümle yenilenir)
//   api:   iNaturalist API yanıtları (network-first, çevrimdışında önbellekten)
//   img:   gözlem fotoğrafları ve yazı tipleri (cache-first, en fazla IMG_MAX kayıt)
// Uygulama dosyalarından birini değiştirdiğinde VERSION'ı artır.
const VERSION = "v1";
const SHELL = `mk-shell-${VERSION}`;
const API = "mk-api";
const IMG = "mk-img";
const IMG_MAX = 400;
const API_MAX = 600;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/inat.js",
  "./src/store.js",
  "./src/regions.js",
  "./src/edibility.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("mk-shell-") && k !== SHELL).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Sayfadaki "Yeni sürüm" bandına dokunulunca yeni SW hemen devreye girsin.
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  // En eski kayıtlar başta durur; fazlasını sil.
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function networkFirst(req) {
  const c = await caches.open(API);
  try {
    const res = await fetch(req);
    if (res.ok) {
      c.put(req, res.clone()).then(() => trim(API, API_MAX));
    }
    return res;
  } catch (err) {
    const hit = await c.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName, max) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Opak (no-cors) yanıtlar da saklanır: <img> ile yüklenen fotoğraflar böyle gelir.
  if (res.ok || res.type === "opaque") c.put(req, res.clone()).then(() => trim(cacheName, max));
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Gezinmelerde çevrimdışıyken index.html'e düş.
    if (req.mode === "navigate") {
      e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
      return;
    }
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }

  if (url.hostname === "api.inaturalist.org") {
    e.respondWith(networkFirst(req));
    return;
  }

  if (
    url.hostname.endsWith("inaturalist-open-data.s3.amazonaws.com") ||
    url.hostname.endsWith("static.inaturalist.org") ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    e.respondWith(cacheFirst(req, IMG, IMG_MAX));
  }
});
