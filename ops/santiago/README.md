# Relay de voz en Santiago

Se puede alojar coturn en una VM existente de Oracle Cloud en Chile Central (`sa-santiago-1`) mientras el lobby HTTPS funciona en otro proveedor. La ubicación del relay es verificable en los metadatos de la VM. Los jugadores con conexión WebRTC directa intercambian audio entre sus equipos.

## Disponibilidad y costo

Oracle limita la computación Always Free a la región principal de la cuenta. Hace falta que Chile Central figure como región principal, que haya capacidad para una forma Always Free y que la cuenta tenga cuota libre. La región de una cuenta es permanente. Al elegir la VM hay que comprobar la etiqueta Always Free y el costo del conjunto de disco, procesamiento y red. Una VM ociosa podría ser recuperada. Para una cuenta nueva, Oracle normalmente solicita verificación con teléfono y tarjeta. [Regiones](https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm) · [Cuotas Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) · [Registro](https://docs.oracle.com/en/learn/cloud_free_tier/index.html)

## Activación en una VM ya disponible

1. Prepara una VM Linux con Docker y Compose, IPv4 pública alcanzable y ruta de salida a Internet. En su grupo de seguridad y cortafuegos permite UDP/TCP 3478 y UDP 49160–49200. En OCI la interfaz suele tener una dirección privada distinta de la pública.
2. Copia `ops/pilot.env.example` fuera del repositorio, con permisos 600. Pon la IPv4 privada en `TURN_BIND_IP`, la IPv4 pública en `TURN_PUBLIC_IP` y el nombre DNS del relay o esa IPv4 pública en `TURN_DOMAIN`. En `APP_DOMAIN` pon el dominio del lobby. Genera un secreto aleatorio de 32 bytes o más para `TURN_SECRET`. El administrador del lobby debe configurar el mismo secreto por su canal privado de variables de entorno.
3. Desde el checkout en esa VM ejecuta el comando siguiente. El script comprueba la región mediante OCI IMDSv2 e inicia únicamente el servicio coturn. Reutiliza el Compose del proyecto y sus límites de asignaciones y puertos. [Metadatos de OCI](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/gettingmetadata.htm)

```sh
sh ops/santiago/start-relay.sh "$HOME/.config/squadlink/pilot.env"
```

4. Configura en el servidor del lobby `TURN_URLS=turn:voz.example.com:3478?transport=udp,turn:voz.example.com:3478?transport=tcp`, sustituyendo el host por el relay. Establece el mismo `TURN_SECRET`. Opcionalmente configura `ICE_SERVERS_JSON` con el servidor STUN de esa VM. Reinicia el lobby para cargar las variables. La app entrega credenciales TURN temporales a miembros de sala.
5. Entra a una sala desde dos redes distintas. Comprueba voz en ambos sentidos y revisa el par seleccionado en `edge://webrtc-internals`. Una prueba de la ruta Santiago debe mostrar un candidato `relay` asociado a la IPv4 pública de esta VM, con bytes enviados y recibidos crecientes. La ficha de OCI acredita la región, y el par ICE seleccionado acredita el recorrido efectivo. Una conexión directa tiene su propia latencia y no valida el relay. Para evaluar rendimiento registra RTT, jitter y pérdida durante una partida en los equipos de los jugadores.

Detener el proceso coturn deja de retransmitir las llamadas que dependen de él. La configuración del host y la clave del backend deben mantenerse alineadas si se rota el secreto o cambia la IPv4 pública. El piloto usa TURN UDP/TCP en 3478. Redes que únicamente permiten TLS en 443 necesitan un endpoint TURN TLS adicional.
