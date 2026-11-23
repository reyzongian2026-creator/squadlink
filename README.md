# Squadlink

Sala de voz para hasta cinco amigos, con acceso por apodo, código compartible, clave opcional y dos minijuegos para la espera (Reflejos y Memoria). Cada grupo se conecta a una misma instancia de Squadlink. El código identifica la sala dentro de esa instancia.

## Descargar para Windows x64

Entra con una cuenta que tenga acceso al repositorio privado y descarga [Squadlink-Setup-x64.exe](https://github.com/reyzongian2026-creator/squadlink/releases/latest/download/Squadlink-Setup-x64.exe). [SHA256.txt](https://github.com/reyzongian2026-creator/squadlink/releases/latest/download/SHA256.txt) contiene su huella. El instalador configura el cliente para tu usuario. Al abrir la app se conecta al lobby compartido de Squadlink en https://squadlink-lobby.onrender.com. El código de sala solo funciona dentro de ese servidor.

## Amigos y actividad

Comparte tu código de amigo y acepta la solicitud. Tus amigos pueden ver si estás en línea, tu juego y desde cuándo estás en la sala. Pueden pedir entrar y el anfitrión decide si acepta. También se puede compartir el código de sala y su clave opcional. El perfil y los contactos se conservan en el dispositivo. Borrar los datos de la app elimina esa identidad.

En el cliente de Windows puedes activar la detección de juegos compatibles. En el navegador puedes indicar el juego manualmente. Dentro de la sala, los ajustes de voz permiten elegir micrófono y salida, y activar la reducción de ruido según el dispositivo. El diagnóstico de conexión muestra la ruta y el tiempo de ida y vuelta cuando WebRTC los reporta.

## Directorio, personaje y clasificación

Un anfitrión puede publicar su sala en el directorio con una descripción, el juego y el nivel que busca. Puede retirar la publicación en cualquier momento. La clave de entrada sigue siendo obligatoria para salas protegidas. El código de partida del juego se comparte con quienes ya están dentro.

El apodo y la identidad del jugador se recuperan en el mismo navegador o perfil de Windows. Cada personaje admite personalización de piel, ropa y accesorios. Las partidas clasificadas de Reflejos y Memoria otorgan XP y tienen tablas de posiciones independientes. Se sube un nivel cada 100 XP. El servidor valida las rondas y el cliente guarda un respaldo firmado del progreso.

El piloto usa PostgreSQL en la red privada de Render. El plan gratuito de esta base expira el 22 de diciembre de 2026. Para conservar la clasificación completa, migrar la base antes de esa fecha y mantener el secreto de firma. Ver [persistencia y migración](docs/architecture/progreso.md) y [relay en Santiago](ops/santiago/README.md).

## Probar en este equipo

Descomprime la carpeta. Con Node.js 22 o superior instalado, abre **Iniciar-Squadlink.cmd** en Windows o **Squadlink.command** en macOS. El lanzador inicia el servidor local y abre el navegador. Mantén la consola abierta mientras pruebas.

También puedes iniciar el servidor desde la carpeta de Squadlink con este comando.

```sh
npm start
```

Abre `http://localhost:4179` en Edge o Chrome. Elige un apodo, crea una sala y copia el código. Abre un segundo perfil del navegador o una ventana privada, entra con otro apodo y pega el código. Si creaste la sala con clave, ingrésala también. Permite el acceso al micro cuando quieras hablar. Usa audífonos si pruebas ambos clientes cerca para evitar realimentación.

El micrófono del navegador requiere HTTPS o el servidor local del propio equipo. Al probar con un amigo en otro PC, ambos necesitan abrir la misma dirección HTTPS. Cada equipo interpreta `localhost` como su propio dispositivo. [Acceso al micrófono](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

## Instalar en Windows

Abre la dirección de la app en Microsoft Edge. Pulsa el icono para instalar en la barra de direcciones y confirma **Instalar**. La app se abre en su propia ventana y queda disponible en Inicio. La opción también está en el menú de Edge, en **Aplicaciones**. Con una instancia compartida, los amigos solo necesitan el navegador. El servidor es quien ejecuta Node. [Instalación de PWA en Microsoft Edge](https://learn.microsoft.com/es-es/microsoft-edge/progressive-web-apps/ux)

## Conectar amigos por Internet

La configuración de `ops/` está pensada para un servidor Linux con Docker Compose, una IPv4 pública alcanzable y dos registros DNS A. Un nombre sirve la app mediante Caddy y el otro identifica el servidor de voz coturn. Pueden apuntar a la misma IP. Los móviles y PC llegan al mismo servidor de salas. WebRTC intenta conectar el audio entre participantes y puede recurrir a TURN cuando la red lo exige.

1. Apunta ambos nombres al servidor. Habilita entrada TCP 80 y 443 para HTTPS, UDP y TCP 3478 para STUN/TURN, y UDP 49160–49200 para los puertos de retransmisión. Si hay NAT, reenvía los mismos puertos del exterior hacia la IP de la interfaz local. El servicio Node solo recibe conexiones internas de Caddy. [HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https)
2. Desde la carpeta del proyecto, crea un archivo privado de configuración en el host con los comandos siguientes. Edita `$HOME/.config/squadlink/pilot.env` y sustituye los dominios e IP de ejemplo. En `TURN_BIND_IP` pon la IPv4 asignada a la interfaz local y en `TURN_PUBLIC_IP` la que ven tus amigos. Asigna a `TURN_SECRET` un valor generado con `openssl rand -hex 32`. Usa un secreto distinto por entorno y reserva el acceso a Docker para los administradores del host.

   ```sh
   install -d -m 700 "$HOME/.config/squadlink"
   install -m 600 ops/pilot.env.example "$HOME/.config/squadlink/pilot.env"
   ```

3. Valida la configuración e inicia los tres servicios en el servidor elegido:

   ```sh
   docker compose --env-file "$HOME/.config/squadlink/pilot.env" -f ops/compose.yaml config --quiet
   docker compose --env-file "$HOME/.config/squadlink/pilot.env" -f ops/compose.yaml up --build -d
   docker compose --env-file "$HOME/.config/squadlink/pilot.env" -f ops/compose.yaml ps
   ```

4. Abre `https://TU_DOMINIO_DE_APP` desde dos conexiones distintas, crea una sala con clave y comprueba el audio en ambos sentidos. Comparte con el grupo la dirección, el código y, si corresponde, la clave. Durante una llamada puedes revisar `edge://webrtc-internals` para ver si el par seleccionado usa un candidato de tipo `relay`. Un fallo de señalización se observa en la conexión al sitio. Si ambos aparecen en sala y el audio no conecta entre redes, revisa los puertos e IP de coturn. El piloto ofrece TURN por UDP/TCP en 3478. Las redes que solo admiten TLS por 443 requieren otro endpoint TURN compatible. [Configuración de coturn](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf)

Las salas y sesiones están en memoria. Al reiniciar el servicio, los jugadores deben crear una nueva sala. Los certificados HTTPS se guardan en los volúmenes de Caddy. Para detener el piloto, ejecuta `docker compose --env-file "$HOME/.config/squadlink/pilot.env" -f ops/compose.yaml down`.

## Verificación

Ejecuta `npm test` desde esta carpeta para revisar las pruebas disponibles. El plan de aceptación está en [la especificación](docs/specs/lobby.md). Para evaluar rendimiento en una PC de gama baja, compara sesiones equivalentes con cinco participantes, el mismo juego, ajustes gráficos y red. Registra RAM, CPU, FPS y cortes de voz con el minijuego cerrado y abierto.

## Cliente de escritorio para Windows x64

En una máquina de compilación con .NET 10 SDK, abre `windows/Compilar.cmd`. Distribuye la carpeta completa `artifacts/Squadlink-win-x64` a los jugadores. El cliente incluye el runtime de .NET y utiliza Microsoft Edge WebView2 Runtime instalado en Windows. Los jugadores abren `Squadlink.exe`, acceden al lobby compartido y crean la sala o introducen su código. El cliente recuerda esa dirección en el perfil de Windows. El lanzador de pruebas `Iniciar-Squadlink.cmd` sirve para ejecutar el servidor local.

El host compartido debe permanecer encendido. El código tiene alcance dentro de ese host. La voz intenta ir directamente de jugador a jugador y usa coturn si los participantes no pueden establecer la conexión directa. Cada jugador puede tener cuatro conexiones de voz al estar cinco en la sala. El consumo de red del relay depende del número de conexiones que necesiten pasar por él.
