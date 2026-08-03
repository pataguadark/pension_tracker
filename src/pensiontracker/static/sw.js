// sw.js — Pensión Tracker
// Service worker mínimo: cachea solo los estáticos (CSS, JS, fuentes,
// iconos) con estrategia cache-first. Las rutas de la app (registro,
// historial, etc.) siempre van a red: tienen datos dinámicos del usuario
// y no deben servirse obsoletas ni offline.

const CACHE_NAME = 'pensiontracker-static-v2';
const ASSETS_TO_CACHE = [
    '/static/style.css',
    '/static/app.js',
    '/static/pt_logo_header.png',
    '/static/icons/icon-192.png',
    '/static/icons/icon-512.png',
    '/static/icons/favicon.ico',
    '/static/fonts/cormorant-garamond.woff2',
    '/static/fonts/outfit.woff2',
    '/static/fonts/dm-mono-300.woff2',
    '/static/fonts/dm-mono-400.woff2',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin || !url.pathname.startsWith('/static/')) {
        return;
    }
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((resp) => {
                const respClone = resp.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, respClone));
                return resp;
            });
        })
    );
});
