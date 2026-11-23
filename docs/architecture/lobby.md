# Squadlink · Diseño del lobby

La primera entrega usa un servidor Node de una instancia, con HTTP nativo, archivos estáticos y estado en memoria. Una PWA sin framework comparte el motor de Edge o Chrome en Windows. La señalización viaja por HTTPS y Server-Sent Events (SSE). Los clientes intercambian audio con WebRTC, con un máximo de cinco miembros por sala para acotar conexiones y tráfico de subida. El minijuego de reflejos se carga al abrirlo y cancela sus temporizadores al salir.

## Contrato

Todas las mutaciones usan JSON, mismo origen y una cookie de sesión aleatoria HttpOnly y SameSite. El servidor deriva la identidad del emisor de la sesión. Los identificadores de miembro son públicos. La cookie se marca Secure en el servicio HTTPS. El apodo puede recordarse localmente y volver a registrarse al caducar la sesión. Una sesión ocupa una sala a la vez.

| Método y recurso | Entrada | Respuesta JSON |
| --- | --- | --- |
| POST /api/session | {nick} | {self:{id,nick},room} |
| GET /api/session | Cookie | {self:{id,nick},room} o 401 |
| POST /api/rooms | {name,password?} | {room} |
| POST /api/join | {code,password?} | {room} |
| POST /api/leave | {} | {ok:true} |
| GET /api/events | Cookie, pertenecer a sala | Eventos SSE room y signal |
| POST /api/member | {muted:boolean} | {ok:true} |
| POST /api/signal | {to,description} o {to,candidate} | {ok:true} |
| GET /api/ice | Cookie, pertenecer a sala | {iceServers:[…]} compatible con RTCConfiguration |

room es null o {code,name,locked,members:[{id,nick,muted}]}. El código tiene seis caracteres alfanuméricos, se normaliza a mayúsculas y se genera por aleatoriedad criptográfica con comprobación de colisiones. Cada evento room contiene la instantánea directamente. Se emite también al suscribirse. Cada evento signal contiene {from,description} o {from,candidate} y solo llega al destinatario de la misma sala. El servidor conserva brevemente las señales anteriores a la primera suscripción. La clave solo se recibe por POST y se compara con un hash salado. Errores JSON {error:string} con HTTP 400, 401, 403, 404, 409 o 429 según el caso.

## Coordinación de clientes y ciclo de vida

Un participante debe poder escuchar aunque rechace el micrófono. Cada par crea una conexión con un transceptor de audio y el ID lexicográficamente menor inicia la oferta. Añadir micro después reutiliza el emisor con replaceTrack. El receptor almacena ICE hasta aplicar la descripción remota. La aplicación libera pistas y conexiones al salir y elimina las de cada miembro ausente. Una reconexión SSE debe reconciliar la instantánea con el estado local. Un cierre no explícito admite un margen de reconexión antes de eliminar al miembro. Las salas vacías se eliminan. Perder el proceso elimina las salas. Las peticiones repetidas de una sesión a su propia sala deben conservar su plaza.

## Operación y pruebas

Localhost permite ensayar dos perfiles de navegador con micrófonos simulados. Los amigos abren la misma URL HTTPS y utilizan código y clave de la sala. Se admite configurar ICE mediante el entorno del servidor. Entre redes con filtros puede hacer falta un relay TURN. Medir bytes iniciales y probar audio en automatización acredita el recorrido funcional. Para evaluar calidad percibida, CPU, FPS y memoria hace falta un ensayo en Windows, con los juegos y equipos objetivo.
