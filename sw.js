const CACHE = 'mon-carnet-eps-v17';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './app.js', './app.css', './board.js', './board.css', './capture.js', './session.js', './carnet.js', './carnet.css',
  './store.js', './crypto.js', './cloud.js', './backup.js', './bulletins.js', './portraits.js', './ocr/client/tesseract.min.js', './ocr/client/worker.min.js',
  './ocr/core/tesseract-core-lstm.js', './ocr/client/tesseract-core-lstm.wasm', './ocr/lang/fra.traineddata.gz',
  './fonds/cabines.webp', './fonds/glacier.webp', './fonds/telepherique.webp',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('mon-carnet-eps-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  if (new URL(request.url).pathname.includes('/api/')) return;
  event.respondWith(fetch(request).catch(async () => {
    const cached = await caches.match(request, {ignoreSearch: true});
    return cached || (request.mode === 'navigate' ? await caches.match('./index.html') : null) || Response.error();
  }));
});
