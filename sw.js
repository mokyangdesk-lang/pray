/* 365 기도동행 · 홈 화면 앱용 서비스 워커
   화면 파일은 최신을 먼저 받고(인터넷이 없으면 저장본), 기도제목 데이터는 저장하지 않습니다. */
const CACHE = 'gido-v2.0.0';
const SHELL = ['./', 'index.html', 'pastor.html', 'admin.html', 'app.css', 'common.js', 'member.js', 'staff.js', 'qr.js', 'config.js',
  'icons/member-192.png', 'icons/pastor-192.png', 'icons/admin-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // 서버(데이터) 요청은 건드리지 않음
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
