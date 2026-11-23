# Squadlink · Lobby de voz para el grupo

Gian juega Valorant y otros títulos con amigos que hoy se reúnen en Discord. Quiere compartir un código, hablar durante la partida y abrir un minijuego mientras esperan. En esta primera versión, dos amigos que usan la misma instancia deberían pasar de abrir la app a conversar con solo elegir un apodo, crear la sala o introducir el código y autorizar el micrófono.

## Alcance y criterios de aceptación

| ID | Recorrido | Resultado comprobable |
| --- | --- | --- |
| AC1 | Primer acceso y reapertura | El jugador elige un apodo de invitado. La app recuerda ese apodo en el mismo perfil del navegador. |
| AC2 | Crear una sala abierta | Se muestra un código que se puede compartir. Un segundo cliente independiente que introduce el código aparece en la misma sala. |
| AC3 | Crear una sala con clave | Con la clave correcta se puede entrar. Si falta o es incorrecta, el usuario recibe un error y no figura entre los miembros. |
| AC4 | Hablar y salir | Dos clientes con permiso de micrófono intercambian audio. Se puede silenciar el micrófono y abandonar la sala. La salida libera el micro y actualiza los participantes. Ante un permiso denegado se indica qué ocurrió. |
| AC5 | Esperar partida | Un participante abre un minijuego, juega y vuelve a la sala conservando la conexión de voz. El juego deja de consumir recursos al cerrarse. |
| AC6 | Acceso desde Windows | Ambos amigos pueden abrir la misma URL desde Windows. El cliente se puede instalar como PWA en un navegador compatible. La guía distingue la prueba local del acceso entre redes. |
| AC7 | Equipos modestos | La pantalla inicial evita video, descargas de juegos y animación continua. QA registra tamaño del cliente y límites de lo medido. Antes de publicar una comparación con Discord se miden CPU, RAM, audio y FPS durante una partida comparable en un equipo Windows de gama baja. |

La prueba inicial usa acceso como invitado. El apodo es una identidad local de presentación. El piloto con amigos medirá cuántos completan su primera llamada sin ayuda y si la voz sigue siendo inteligible durante una partida. Para evaluar la calidad real hacen falta micrófonos, equipos y redes representativos.
