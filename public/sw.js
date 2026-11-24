// Live rooms always use the network. Show a small recovery page on offline launches.
const micCache = 'squadlink-mic-worklet-v1';
const worklet = '/voice-cleaner-worklet.js';

// Warm only the small microphone filter, and only after someone opens audio settings.
// Samples, account data and room traffic never enter this cache.
self.addEventListener('message', event => {
  if (event.data !== 'squadlink:prepare-mic-test') return;
  event.waitUntil(caches.open(micCache).then(cache => cache.add(new Request(worklet,{cache:'no-cache'}))).catch(() => {}));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.origin === self.location.origin && url.pathname === worklet && !url.search) {
    event.respondWith(fetch(event.request).then(async response => {
      if (response.ok) {
        try { await (await caches.open(micCache)).put(worklet,response.clone()); } catch {}
      }
      return response;
    }).catch(async error => {
      const cached = await caches.match(worklet,{cacheName:micCache});
      if (cached) return cached;
      throw error;
    }));
    return;
  }
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Squadlink · Sin conexión</title><body style="background:#191922;color:#eee;font:18px system-ui;padding:8vw"><h1>Squadlink</h1><p>No se pudo conectar al servidor de voz.</p><a style="color:#c0f65d" href="/">Volver a intentar</a></body></html>',
    {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}}
  )));
});
