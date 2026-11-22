// 오프라인 지원 서비스 워커
// - 같은 출처 파일: 네트워크 먼저(3.5초 안에 안 오면 저장본), 받은 것은 저장
// - 버전 고정 CDN(jsDelivr), 글꼴: 저장본 먼저
// - 예보 API·지도 타일: 네트워크 먼저, 끊기면 저장본
// 파일을 바꿔도 이 버전은 올릴 필요가 없습니다. 바꾸면 예전 저장본을 한꺼번에 지웁니다.
const VERSION = "v3";
const CORE = `core-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;

const PRECACHE = [
  "./",
  "index.html",
  "observe.html",
  "sky.html",
  "diorama.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "css/style.css",
  "css/diorama-map.css",
  "css/theme-glade.css",
  "css/observe.css",
  "css/sky.css",
  "css/pwa.css",
  "js/pwa.js",
  "js/app.js",
  "js/data.js",
  "js/score.js",
  "js/sites.js",
  "js/models.js",
  "js/calendar.js",
  "js/longrange.js",
  "js/events.js",
  "js/core.js",
  "js/retro.js",
  "js/targets.js",
  "js/site-info.js",
  "js/city-lights.js",
  "js/constellations.js",
  "js/messier.js",
  "js/marathon.js",
  "js/observe.js",
  "js/sky.js",
  "js/diorama/scene.js",
  "js/diorama/geo.js",
  "js/diorama/moon.js",
  "js/diorama/night.js",
  "js/diorama/optics.js",
  "js/diorama/sky-map.js",
  "js/diorama/stars.json",
  "js/diorama/horizons.json",
  "js/diorama/city-horizons.json",
  "js/diorama/lights-map.png",
  "js/diorama/lights-terrain.png",
  "models/korea.glb",
  "data/forecast.json",
];

const IMMUTABLE = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.gstatic\.com)\//;
const STYLES = /^https:\/\/fonts\.googleapis\.com\//;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CORE).then((c) =>
      // 파일 하나가 없어도 설치는 계속
      Promise.allSettled(PRECACHE.map((u) => c.add(new Request(u, { cache: "reload" })))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CORE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function put(cacheName, req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const c = await caches.open(cacheName);
    await c.put(req, res.clone());
  }
  return res;
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  return put(RUNTIME, req, await fetch(req));
}

async function networkFirst(req, cacheName, timeoutMs) {
  const net = fetch(req).then((res) => put(cacheName, req, res));
  const timer = timeoutMs
    ? new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    : new Promise(() => {});
  try {
    const first = await Promise.race([net.catch(() => null), timer]);
    if (first) return first;
  } catch (_) {}
  const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
  if (hit) return hit;
  return net; // 저장본도 없으면 네트워크를 끝까지 기다림
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, CORE, 3500));
    return;
  }
  if (IMMUTABLE.test(req.url)) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (STYLES.test(req.url)) {
    e.respondWith(networkFirst(req, RUNTIME, 2500));
    return;
  }
  // 예보 API, 지도 스타일·타일: 온라인이면 새로, 끊기면 마지막 저장본
  e.respondWith(networkFirst(req, RUNTIME, 0));
});
