/* Dog-Go Tracker — Service Worker
   Amaç: (1) PWA'nın "yüklenebilir" sayılması için tarayıcının aradığı fetch handler'ı sağlamak,
         (2) uygulama kabuğunu (shell) önbelleğe alıp internetsizken de açılabilmesini sağlamak.
   Not: Google Apps Script API çağrıları ve harita karoları (tile) kasıtlı olarak
   önbelleğe alınmıyor — bunlar her zaman güncel/ağdan gelmeli. */

const CACHE_NAME = 'doggo-tracker-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Google Apps Script, hava durumu API'si ve harita karoları hep ağdan gelsin.
  if (url.includes('script.google.com') || url.includes('open-meteo.com') || url.includes('tile.openstreetmap.org')) {
    return; // tarayıcının normal ağ isteğine bırak
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
