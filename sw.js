// Offline cache for the app shell. Bump VERSION whenever any file changes: the app checks for a new
// sw.js every time it opens, installs it in the background and reloads into the new version.
const VERSION = 'lensy-v1.3.0';
const PUSH_CACHE = 'lensy-push'; // this phone's push id + secret (written by the app), kept across versions
const FILES = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'js/app.js', 'js/db.js', 'js/logic.js', 'js/catalog.js', 'js/style.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never mixes in old files.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== PUSH_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Only the app's own page is answered with index.html; any other missing file goes to the network.
  if (e.request.mode === 'navigate' && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
    e.respondWith(caches.open(VERSION).then((c) => c.match('index.html')).then((r) => r || fetch(e.request)));
    return;
  }
  e.respondWith(caches.open(VERSION).then((c) => c.match(e.request, { ignoreSearch: true })).then((r) => r || fetch(e.request)));
});

// ---- Phone notifications (server/Code.gs) ----
// The push itself is empty: on arrival, fetch this phone's due reminders from the Lensy Push server
// and show them. iOS requires a notification for every push, so there is always at least one.
const FALLBACK = { title: 'Lensy 美瞳提醒', body: '有新的提醒，点开看看', url: '#home' };

function pushConfig() {
  return caches.open(PUSH_CACHE).then((c) => c.match('push-config')).then((r) => (r ? r.json() : null)).catch(() => null);
}

self.addEventListener('push', (e) => {
  e.waitUntil(pushConfig()
    .then((cfg) => (cfg ? fetch(cfg.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn: 'inbox', id: cfg.id, secret: cfg.secret }) })
      .then((res) => res.json()).then((body) => (body.ok ? body.result.messages : [])) : []))
    .catch(() => [])
    .then((list) => (list.length ? list : [FALLBACK]))
    .then((list) => Promise.all(list.map((m) => self.registration.showNotification(m.title, {
      body: m.body || '', tag: m.key || undefined, data: { url: m.url || '#home' }, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    })))));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '#home', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.postMessage({ type: 'open', url: target }); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
