// 웹판 오프라인용 서비스 워커(홈 화면에 추가한 앱 포함). Electron판에서는 쓰지 않는다.
// 방식: 늘 네트워크에서 먼저 받고(새 버전이 바로 보임), 인터넷이 끊기면 저장해 둔 사본을 쓴다.
// 배포 폴더를 만들 때(scripts/build-web.mjs) 아래 VERSION·FILES가 채워져, 처음 설치할 때 모든 파일을 미리 받아 둔다.
const VERSION = 'dev';
const FILES = [];
const CACHE = 'nabitext-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('nabitext-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // 다른 출처(구글 폰트 등)는 브라우저에 맡김
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
