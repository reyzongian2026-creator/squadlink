![Squadlink. Tres jugadores en una sala de voz con Santiago al fondo](docs/media/portada.webp)

# Squadlink

Sala de voz para tu grupo de hasta **cinco jugadores**. Elige un apodo, comparte un código y conversa mientras juegan. En la espera de una partida pueden abrir Reflejos o Memoria sin salir de la sala.

## Squadlink Moderno para Windows

La nueva edición de prueba usa Electron y React. El inicio muestra la sala activa, las salas públicas y accesos a Amigos, Mi jugador, Minijuegos y Clasificación. Crear una sala o entrar con código abre una ventana de escritorio. Las herramientas comparten el motor de voz y los ajustes de audio durante la llamada. Los perfiles se cambian desde **Ajustes**.

Con tu sesión de GitHub abierta, entra en la última compilación correcta y elige **Squadlink-Electron-Windows-x64**. Extrae el ZIP y ejecuta `Squadlink-Moderno-Setup-x64.exe`. Las capturas de la instalación están en **Capturas-Squadlink-Moderno**. [Compilaciones de Squadlink Moderno](https://github.com/reyzongian2026-creator/squadlink/actions/workflows/electron.yml?query=branch%3Apreview%2Felectron-escritorio)

El instalador crea el acceso **Squadlink Moderno** y utiliza un perfil propio. Para compilar la interfaz desde el código, usa Node.js 24 y ejecuta `npm ci`, `npm run build` y `npm start` en `electron/`.

## Edición ligera de Windows Forms

**Squadlink Preview 0.4.0-preview.9** abre con un inicio de Windows Forms. Los botones de Salas, Jugadores y Ajustes están visibles a la vez. Cada opción abre una ventana con título propio. El directorio, los formularios de crear y unirse, los dispositivos de audio, el servidor, el rendimiento y las actualizaciones usan controles nativos. El audio, las vistas detalladas y los minijuegos comparten una instancia de WebView2. La llamada continúa al cerrar una ventana de opciones. Cerrar Inicio sale de la aplicación.

**[Descargar Squadlink Preview 9 para Windows x64](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45143112209/artifacts/14803625793)** · [Ver capturas reales de Windows](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45143112209/artifacts/14803012755)

Inicia sesión en GitHub para descargar los archivos. Descomprime el ZIP del instalador y ejecuta `Squadlink-Setup-x64.exe`. [Consultar las compilaciones del canal Preview](https://github.com/reyzongian2026-creator/squadlink/actions/workflows/windows.yml?query=branch%3Apreview%2Fwindows-escritorio). El archivo `SHA256.txt` permite verificar el instalador. La edición Preview tiene su propio acceso directo, directorio de instalación y perfil de jugador. Puede convivir con la versión estable.

| Espacio | Secciones |
| --- | --- |
| Voz | Explorar salas y Mi sala. Durante una llamada puedes ver los participantes y ajustar su volumen. |
| Comunidad | Amigos y Mi jugador. |
| Juegos | Minijuegos y Clasificación. |
| Ajustes | Rendimiento, Dispositivos y Servidor. |

En **Ajustes → Rendimiento** puedes cambiar de perfil durante una sesión. **Bajo consumo** es el valor inicial. Usa paneles nativos para consultar amigos y participantes, y pide a WebView2 reducir memoria cuando se necesita para voz o funciones detalladas. **Experiencia completa** abre los paneles detallados y conserva el motor listo al cambiar de sección. Windows recuerda la elección al volver a abrir la app. Ambos perfiles mantienen la misma configuración de audio.

La aplicación mantiene la presencia de un perfil vinculado. Si un invitado vuelve al directorio tras salir de un panel, el cliente libera el motor cuando ha terminado cualquier entrada a una sala. El artefacto incluye una captura del directorio con dos salas de prueba. El registro de compilación muestra la memoria del árbol de procesos y el porcentaje de CPU en reposo, medidos en un equipo de prueba de Windows.

En **Ajustes → Actualizaciones**, pulsa **Buscar actualizaciones**. La app compara el número y el intento de compilación con los artefactos válidos del canal Preview de Windows. Puedes activar **Buscar al abrir Squadlink** para ver el aviso en el título de la ventana. La descarga y la instalación son manuales. La Preview 3 necesita una primera instalación manual de la Preview actual sobre el mismo perfil.

### Consumo medido en Windows

| Escenario | Bajo consumo | Experiencia completa |
| --- | ---: | ---: |
| Amigos, como invitado | 72,2 MiB | 338,5 MiB |
| Llamada con audio bidireccional | 396,9 MiB | 414,5 MiB |

El directorio inicial ocupó 70,0 MiB. Son muestras de la suma de memoria residente de los procesos del cliente en un equipo Windows de cuatro procesadores lógicos. Para la llamada se usaron dos clientes y audio sintético en lugar de micrófono físico. Durante la prueba aumentaron tanto los paquetes como la energía del audio recibido en ambos sentidos al cambiar de perfil. Queda pendiente medir FPS con un juego abierto en hardware de gama baja. [Ver ejecución y resultados](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45124762306).

En **Ajustes → Dispositivos**, cada jugador puede comprobar la reducción de ruido y la ganancia automática que informa su micrófono activo. Antes de entrar a una sala, **Grabar prueba de 4 segundos** permite escuchar una muestra local con la entrada elegida. El **Volumen de las voces que escucho** afecta solo a los altavoces o audífonos locales y conserva el volumen relativo de cada compañero. En los controles de sala, el volumen individual se guarda en este equipo. Se recupera al volver a coincidir con el mismo jugador mientras conserve su identidad de sesión; un apodo repetido no hereda el volumen de otra persona.

### Medir FPS de VALORANT en tu PC

El ZIP de Windows incluye `Comparar-FPS.ps1`. Para medir tu equipo, usa la [consola de PresentMon](https://github.com/GameTechDev/PresentMon/releases) y el formato CSV v2. En el campo de práctica, mantén el mismo recorrido, resolución y límite de FPS. Tras calentar el juego, captura primero con Squadlink cerrado. Repite con Squadlink en llamada y el mismo número de participantes. Estos ejemplos usan el nombre `PresentMon.exe`; sustitúyelo por el de tu consola descargada.

```powershell
.\PresentMon.exe --process_name VALORANT-Win64-Shipping.exe --v2_metrics --delay 5 --timed 60 --terminate_after_timed --output_file base.csv
.\PresentMon.exe --process_name VALORANT-Win64-Shipping.exe --v2_metrics --delay 5 --timed 60 --terminate_after_timed --output_file llamada.csv
.\Comparar-FPS.ps1 -Base .\base.csv -ConLlamada .\llamada.csv
```

El informe muestra FPS medios y el percentil 99 del tiempo de fotograma (ms). Un P99 mayor indica fotogramas lentos más largos. Repite la comparación alternando el orden para evaluar la variación entre pasadas. Las capturas permanecen en tu PC. [Opciones de captura de PresentMon](https://github.com/GameTechDev/PresentMon/blob/main/README-ConsoleApplication.md)

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
