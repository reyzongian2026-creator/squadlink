# QA de directorio, personaje y progreso

Se trabajó con perfiles de invitado de prueba y una instancia aislada. Las operaciones del recorrido DOM usaron el servidor HTTP de Squadlink con un transporte en memoria. La partida puntuable pasó por el mismo componente de arcade y las mismas rutas de inicio y fin que utiliza la interfaz.

| Área | Evidencia local |
| --- | --- |
| Publicación de salas | Se creó una sala oculta con clave. El propietario editó la descripción, el juego, el nivel y el código privado. Un visitante anónimo vio la publicación, sin el código de partida. Dejó de verla al despublicar. |
| Apodo y amigos | Se recordó el apodo al regresar al formulario de entrada. Una cuenta separada pidió amistad, compartió su actividad y obtuvo permiso para entrar a la sala con clave. Las pruebas de HTTP verificaron el rechazo de un código de acceso erróneo. |
| Personaje | Se eligió la gorra, se guardó desde la interfaz y se comprobó en el perfil devuelto por el servidor. |
| Arcade y puntuación | Se inició una ronda de Reflejos desde el lobby, se esperó la señal y se hizo clic tras una reacción simulada de 180 ms. Se observó XP positivo y una marca en el ranking consultado por otro jugador independiente. También se comprobó el cambio de categoría a Memoria. |
| Control de acceso y consistencia | La suite de Node cubre además visibilidad del directorio, rechazo a editores ajenos, admisión a salas con clave, cambio de anfitrión y pruebas unitarias de progreso. |

Desde la carpeta de Squadlink, `npm test` pasó 31/31 en la revisión de QA y `node --check test/browser-smoke.mjs` pasó. La integración DOM se ejecutó con `HAPPY_DOM_MODULE=../../valorant-store-checker/node_modules/happy-dom/lib/index.js node test/dom-smoke.mjs --run`. En una instalación de pruebas que ya incluya Happy DOM basta `node test/dom-smoke.mjs --run`.

El recorrido ampliado de `npm run test:browser` comprueba tres perfiles, búsqueda y entrada por el directorio, pérdida de la cookie y restauración del apodo, personalización tras recarga, actualización del ranking y la voz. En el piloto compartido omite registrar una puntuación artificial. La ejecución local del navegador requiere abrir un puerto TCP, operación restringida en este entorno. El resultado de Chromium debe verificarse en el runner para el commit que se publique.
