// Live rooms always use the network. Show a small recovery page on offline launches.
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Squadlink · Sin conexión</title><body style="background:#191922;color:#eee;font:18px system-ui;padding:8vw"><h1>Squadlink</h1><p>No se pudo conectar al servidor de voz.</p><a style="color:#c0f65d" href="/">Volver a intentar</a></body></html>',
    {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}}
  )));
});
