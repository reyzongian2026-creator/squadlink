# Pruebas del lobby

Pruebas locales en macOS ARM64 con Node.js 26.5.0. La suite de aceptación usa usuarios y salas independientes. Las peticiones pasan por el cliente y el servidor HTTP reales de Node con streams en memoria. El servidor no necesita abrir un puerto para estas pruebas.

## Resultados

| Criterio | Resultado | Evidencia |
| --- | --- | --- |
| AC1 · Invitado | Pasó el acceso y el recuerdo del apodo al reabrir el formulario | Sesión con cookie propia, apodo persistido en el perfil simulado y separación entre clientes. |
| AC2 · Código | Pasó | Crear, introducir el código en minúsculas, ver dos miembros, repetir ingreso sin ocupar otra plaza y eliminar la sala vacía. |
| AC3 · Clave | Pasó | Rechazo de clave omitida e incorrecta, acceso con la correcta, ausencia de la clave en la respuesta y un único ganador al competir por el último cupo. |
| AC4 · Voz | Verificación parcial | El stream SSE entrega señal y emisor correctos. Se probaron el orden de candidatos ICE, la salida con permiso pendiente, el apagado de pista y el cierre inmediato de controles ante desconexión usando dobles. La llamada con micrófonos y audio RTP continúa pendiente. |
| AC5 · Arcade | Pasó la lógica y el retorno al lobby | Reflejos y Memoria con aciertos o fallos y cancelación de temporizadores. En DOM emulado se abrió Reflejos, se inició una ronda, se cerró y se conservó el código de sala. Continuidad del audio físico pendiente. |
| AC6 · Windows | Verificación parcial | Manifiesto standalone con dos iconos PNG de las dimensiones declaradas, páginas y recursos servidos. Falta instalar en Windows y conectar dos PC al mismo dominio HTTPS. |
| AC7 · Rendimiento | Medición estática | La suma de HTML, app.js, estilo, portada, script de instalación, manifiesto, service worker y dos iconos fue 43 712 bytes sin compresión en la revisión de QA. El import de voz ocurre al entrar a la sala y los juegos al abrirlos. Faltan CPU, RAM, cortes, latencia y FPS durante una partida real. |

## Comandos ejecutados

Desde la carpeta del proyecto, `npm test` pasó 11 de 11 pruebas. El ejecutor usa el módulo de pruebas de Node y el producto no añade dependencias de producción. Se verificaron las respuestas de archivos estáticos y su tipo de contenido, el recurso del hero y los iconos. Una referencia errónea a la portada se corrigió y quedó cubierta.

La prueba de interacción se ejecutó con `HAPPY_DOM_MODULE=../../valorant-store-checker/node_modules/happy-dom/lib/index.js node test/dom-smoke.mjs --run` utilizando la instalación local de Happy DOM para pruebas. En otra máquina con ese paquete disponible basta `node test/dom-smoke.mjs --run`. Se recorrieron crear, modo partida, arcade, salir con fallo temporal de red, reintentar salida y unirse a la sala de un segundo usuario tras corregir una clave. La interfaz desconectó la voz al pulsar salida, antes de esperar al servidor.

Se intentó `PLAYWRIGHT_MODULE=../../venta-directa/node_modules/playwright/index.mjs node test/browser-smoke.mjs --run`. El entorno denegó abrir el puerto local con EPERM. Una comprobación de arranque de Chromium por separado devolvió un error de permiso de MachPort. El script de navegador quedó preparado para ejecutar `npm run test:browser` en una máquina con Playwright y Chromium instalados. Configura dos perfiles y micrófonos sintéticos, observa progreso de bytes y energía entrante en ambos sentidos, mute, salida, continuidad dentro del minijuego y anchos de 360, 390 y 1440 px. No se pudo observar el render ni ejecutar este recorrido WebRTC en el entorno gestionado.

## Prueba pendiente en las PC del grupo

Abrir el mismo servicio HTTPS desde dos redes, instalar la app en Windows, crear una sala con clave, conversar en ambos sentidos y hacer silencio alternativamente. Comparar una sesión equivalente frente a Discord en la misma PC y el mismo juego, con cinco participantes. Registrar CPU, RAM total de los procesos del cliente, FPS y percentil bajo de FPS, RTT, pérdida de paquetes, cortes percibidos y tipo de candidato ICE seleccionado.

### Verificación de varias salas

La suite ampliada pasó 12/12. Diez salas mantuvieron simultáneamente cinco sesiones SSE cada una. Las 50 sesiones recibieron su instantánea y cada emisor envió una oferta de prueba al siguiente miembro de su propia sala. Se usaron transportes dúplex en memoria y el servidor HTTP real. La prueba mide comportamiento funcional concurrente, sin paquetes de audio ni enlaces de Internet. La compilación y el audio del cliente de escritorio requieren verificación en Windows.
