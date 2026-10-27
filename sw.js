/* Noor Quran offline worker.
   - The app page always loads fresh when online, and from the saved copy when offline.
   - Surahs, translations and tafsir you have opened are saved, so they open without internet.
   - Recitation audio is never saved (too large); it streams as normal. */
const VERSION = "v1";
const SHELL = "noor-shell-" + VERSION;
const DATA = "noor-data";
const FONTS = "noor-fonts";
const MAX_DATA_ITEMS = 200;
const SHELL_FILES = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
const DATA_HOSTS = ["api.alquran.cloud", "cdn.jsdelivr.net", "raw.githubusercontent.com"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
/* lists the app needs at start-up; saved right away so the app can open offline */
const DATA_PRELOAD = [
  "https://api.alquran.cloud/v1/surah",
  "https://api.alquran.cloud/v1/edition?format=text&type=translation",
  "https://api.alquran.cloud/v1/edition?format=audio&language=ar"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL).then((c) => Promise.all(SHELL_FILES.map((f) => c.add(f).catch(() => null)))),
      caches.open(DATA).then((c) => Promise.all(DATA_PRELOAD.map((u) => c.add(u).catch(() => null))))
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("noor-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, SHELL, true));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL, false));
  } else if (DATA_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(req, DATA, false));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, FONTS));
  }
  /* everything else (recitation audio) goes straight to the network */
});

async function networkFirst(req, cacheName, isPage) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type !== "opaque") {
      const copy = res.clone();
      cache.put(req, copy).then(() => { if (cacheName === DATA) trim(cache); }).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: isPage });
    if (hit) return hit;
    if (isPage) {
      const page = (await cache.match("./")) || (await cache.match("./index.html"));
      if (page) return page;
    }
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  /* the font stylesheet arrives as an "opaque" response; keep it too so Arabic and Urdu fonts work offline */
  if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function trim(cache) {
  const keys = (await cache.keys()).filter((k) => !DATA_PRELOAD.includes(k.url));
  for (let i = 0; i < keys.length - MAX_DATA_ITEMS; i++) await cache.delete(keys[i]);
}
