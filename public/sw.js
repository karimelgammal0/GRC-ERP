// Service worker: يخلي التطبيق قابل للتثبيت ويفتح بسرعة. بيانات النظام (/api) دايماً من السيرفر ولا تُخزَّن.
const CACHE = 'grc-shell-v2';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/css/app.css', '/js/app.js', '/icons/icon-192.png']).catch(() => {}))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api')) return;
  // الشبكة أولاً (عشان التحديثات تظهر فوراً)، والكاش احتياطي لو النت قطع
  e.respondWith(fetch(r).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); } return res; }).catch(() => caches.match(r).then((m) => m || caches.match('/'))));
});
