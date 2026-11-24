![Squadlink. Tres jugadores en una sala de voz con Santiago al fondo](docs/media/portada.webp)

# Squadlink

Sala de voz para tu grupo de hasta **cinco jugadores**. Elige un apodo, comparte un código y conversa mientras juegan. En la espera de una partida pueden abrir Reflejos o Memoria sin salir de la sala.

**[Abrir Squadlink en la web](https://squadlink-lobby.onrender.com/)** · [Descargar para Windows x64](https://github.com/reyzongian2026-creator/squadlink/releases/download/moderno-v0.5.0-preview.3/Squadlink-Moderno-Setup-x64.exe) · [Descargar para Mac con Apple Silicon](https://github.com/reyzongian2026-creator/squadlink/releases/download/moderno-v0.5.0-preview.3/Squadlink-Moderno-macOS-arm64.zip)

Squadlink Moderno 0.5.0-preview.3 abre el lobby, los amigos, el arcade y los ajustes en la misma ventana. En Windows, ejecuta el instalador. En Mac, extrae el ZIP y mueve la app a Aplicaciones. La versión de Mac lleva firma local y carece de notarización de Apple. [Ver la versión y sus sumas SHA-256](https://github.com/reyzongian2026-creator/squadlink/releases/tag/moderno-v0.5.0-preview.3)

![Inicio de Squadlink Moderno en Windows, con salas y accesos directos](docs/media/inicio-moderno.png)

**[Descargar Squadlink ligero (Preview 9) para Windows x64](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45143112209/artifacts/14803625793)** · [Ver capturas reales de Windows](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45143112209/artifacts/14803012755)

Para instalar la edición ligera, extrae su ZIP y ejecuta `Squadlink-Setup-x64.exe`.

**[Descargar la versión estable de Windows x64](https://github.com/reyzongian2026-creator/squadlink/releases/latest/download/Squadlink-Setup-x64.exe)** · **[Abrir el lobby web](https://squadlink-lobby.onrender.com/)** · [Versiones y SHA-256](https://github.com/reyzongian2026-creator/squadlink/releases/latest)

El instalador es público y se puede descargar sin iniciar sesión en GitHub. Tus amigos también pueden entrar desde el enlace web. El cliente de Windows se instala para el usuario actual, utiliza Microsoft Edge WebView2 Runtime y abre el lobby compartido. Los jugadores de Windows y del navegador pueden estar en la misma sala.

## La primera partida

1. Abre Squadlink y elige tu apodo. El dispositivo lo recuerda para la próxima sesión.
2. Pulsa **Crear sala**, escribe un nombre y añade una clave si la quieres privada. Puedes indicar juego, nivel y descripción. Activa **Mostrar sala en el directorio** si quieres que otros la encuentren.
3. Comparte el **código de sala** de seis caracteres. Tu amigo abre **Unirme con código** en el mismo lobby e introduce el código y la clave, si la configuraste.
4. Cada jugador pulsa **Activar micrófono** y concede el permiso. En los ajustes de voz puede elegir micrófono y salida, activar reducción de ruido y consultar el diagnóstico cuando el dispositivo lo admite.

![Lobby de Squadlink con los accesos para crear sala y unirse](docs/media/lobby.webp)

| Crear la sala | Entrar con el código |
| --- | --- |
| ![Formulario de creación con juego, nivel, descripción y clave opcional](docs/media/crear.webp) | ![Formulario de ingreso con código de sala y clave opcional](docs/media/unirse.webp) |

## Qué puede hacer el grupo

| Función | Cómo se usa |
| --- | --- |
| Amigos y presencia | Intercambien códigos de amigo y acepten la solicitud. Pueden ver quién está conectado, a qué juega y desde cuándo está en la sala. Un amigo puede pedir entrar y el anfitrión decide. |
| Directorio | Explora las salas publicadas por sus anfitriones. El código de partida del videojuego se comparte dentro de la sala. Es distinto del código de Squadlink. |
| Detección de juegos | El cliente de Windows permite activar la detección de VALORANT, Counter-Strike 2, Rocket League, Fortnite, League of Legends, Dota 2 y Overwatch 2. En la web puedes indicar el juego a mano. |
| Personaje y arcade | Personaliza piel, ropa y accesorios. Cada 100 XP subes un nivel. Reflejos premia los tiempos más cortos y Memoria las secuencias más largas. Cada juego tiene su propia clasificación. |
| Modo partida | Reduce el lobby a los controles de voz mientras juegas. |

La identidad de invitado y los contactos se recuperan desde el mismo perfil del dispositivo. Borrar los datos de la app puede hacerte perder acceso a esa identidad. Un reinicio del lobby cierra las salas y sus códigos. El progreso del piloto compartido se guarda en PostgreSQL.

## Estado del piloto

**El 23 de noviembre de 2026** se verificó audio sintético en ambos sentidos entre dos clientes a través del relay de Santiago por UDP y TCP. El piloto regional tiene apagado programado para el **24 de noviembre a las 00:14, hora de Perú**. Las conexiones directas pueden seguir funcionando después del apagado. Las redes que requieren un relay volverán a necesitar uno activo. [Resultado de la prueba de voz](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45117399894)

Para uso permanente quedan por definir el alojamiento continuo del relay y la continuidad de PostgreSQL antes del **22 de diciembre de 2026**, cuando vence la base gratuita del piloto. Falta medir CPU, RAM, FPS y calidad de voz en partidas reales desde Perú, Chile y Argentina en PCs de gama baja. La [corrección del micrófono al cambiar de entrada](https://github.com/reyzongian2026-creator/squadlink/pull/1) ya está integrada. Al silenciar o salir durante un cambio de entrada, Squadlink detiene tanto el micrófono anterior como el nuevo.

## Si algo falla

| Síntoma | Qué revisar |
| --- | --- |
| El enlace de descarga devuelve 404 | Abre [Releases](https://github.com/reyzongian2026-creator/squadlink/releases) y busca `Squadlink-Setup-x64.exe` entre los archivos de la versión. También puedes entrar al lobby web. |
| El código de sala no funciona | Comprueba que ambos estén en el mismo servidor, que quede un cupo y que el anfitrión siga en la sala o haya otro miembro conectado. Tras un reinicio hay que crear una sala nueva. |
| Entran a la sala, pero no se oyen | Comprueben el permiso del micrófono, los dispositivos elegidos y el diagnóstico de conexión. Si en redes separadas falla, revisen la disponibilidad del relay. |
| Quiero verificar el instalador | Descarga también el archivo SHA256.txt de la misma versión. En PowerShell ejecuta `Get-FileHash .\Squadlink-Setup-x64.exe -Algorithm SHA256` y compara el valor. |

## Desarrollo, pruebas y operación

Para ejecutar el proyecto localmente, usa Node.js 22 o superior, instala las dependencias con `npm ci` y ejecuta `npm start`. Abre `http://localhost:4179`. Las instrucciones para Docker, compilación de Windows, pruebas de navegador y recuperación están en la [guía de desarrollo y operación](docs/operacion.md).

[Arquitectura del lobby](docs/architecture/lobby.md) · [Progreso y rankings](docs/architecture/progreso.md) · [Voz en Santiago](ops/santiago/README.md) · [Controles de seguridad](docs/security/lobby.md) · [Pruebas de aceptación](docs/qa/lobby.md)

<img src="public/icon-192.png" width="64" height="64" alt="Icono de Squadlink">
