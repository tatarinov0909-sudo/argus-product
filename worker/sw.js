const CACHE = 'argus-worker-shell-v1';
const SHELL = ['login.html','loader.html','worker.css','worker-runtime.js','worker-config.js','login.js','auth.js','back.js','fonts.css','fonts/golos-text.ttf','jsqr.js','manifest.webmanifest','worker-icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('argus-worker-shell-') && k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  const relative = url.pathname.slice(new URL('./', self.location.href).pathname.length);
  if (!SHELL.includes(relative)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(url.pathname, copy))); }
    return response;
  }).catch(async () => (await caches.match(url.pathname)) || Response.error()));
});
