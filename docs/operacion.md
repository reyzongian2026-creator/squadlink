# Desarrollo y operación de Squadlink

## Ejecutar una copia local

Desde la raíz del repositorio, usa Node.js 22 o superior.

```sh
npm ci
npm start
```

Abre `http://localhost:4179`. Para simular dos jugadores, abre un perfil distinto del navegador, crea una sala en el primero y pega su código en el segundo. En Windows también puedes ejecutar `Iniciar-Squadlink.cmd` y en macOS `./Squadlink.command` después de instalar las dependencias. Los lanzadores abren el navegador y mantienen el servidor en la consola.

Para usar un micrófono desde otro equipo se necesita un origen HTTPS compartido. Cada equipo interpreta `localhost` como su propia máquina. [Requisitos de acceso al micrófono](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

## Componentes y persistencia

| Componente | Responsabilidad |
| --- | --- |
| `windows/` | Cliente WinForms con .NET 10 y Edge WebView2. Pide permiso antes de detectar juegos por nombre de proceso. |
| `public/` | Lobby web, controles de audio, perfil y arcade. El instalador carga este mismo cliente desde el servidor elegido. |
| `server.mjs` y `social.mjs` | Sesiones, códigos y permisos de sala, presencia, solicitudes y señalización WebRTC. Las salas viven en memoria. |
| `progression.mjs` y `postgres-store.mjs` | Validación de rondas, XP, aspecto del personaje y clasificaciones. El despliegue compartido utiliza PostgreSQL. |
| `ops/` | Contenedores de la app, HTTPS y coturn. El relay se puede desplegar por separado del lobby. |

Los miembros intercambian audio directamente cuando WebRTC encuentra una ruta. Cuando la red requiere intermediación, el lobby entrega credenciales TURN temporales a miembros de sala. El servidor retransmite los paquetes. En un grupo de cinco, cada jugador puede mantener cuatro conexiones. El rendimiento en el PC y el caudal de salida del relay requieren mediciones independientes.

Variables de entorno y recuperación de la base en [progreso y persistencia](architecture/progreso.md). Configuración del relay independiente en [Santiago](../ops/santiago/README.md). Guarda los secretos en el gestor del proveedor o en el archivo privado del servidor.

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

## Pruebas y empaquetado

- `npm test` ejecuta las pruebas de Node. Para PostgreSQL, configura `SQUADLINK_TEST_DATABASE_URL` apuntando a una base de pruebas.
- Para las pruebas de navegador, instala la versión de Playwright y Chromium del [flujo de integración](../.github/workflows/voice.yml) y ejecuta `npm run test:browser`.
- En Windows x64 con .NET 10 SDK, `windows/Compilar.cmd` publica el cliente con su runtime en `artifacts/Squadlink-win-x64`. Distribuye la carpeta completa si usas esta variante.
- El [flujo de Windows](../.github/workflows/windows.yml) compila, empaqueta con Inno Setup, instala en un usuario de prueba, inicia el ejecutable, lo desinstala y calcula SHA-256. En `main` publica el instalador y el archivo de huella en GitHub Releases.

Ver también [criterios de aceptación](specs/lobby.md), [arquitectura del lobby](architecture/lobby.md), [revisión de seguridad](security/lobby.md) y [pruebas de directorio y progreso](qa/directorio-y-progreso.md).
