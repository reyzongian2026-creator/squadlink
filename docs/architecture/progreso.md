# Progreso, avatar y rankings

La cookie de sesión y la identidad social vinculada determinan el titular de cada partida. El servidor elige cada patrón de memoria y usa su propio reloj al evaluar los reflejos. Solo las operaciones de juego aceptadas conceden XP. La pose, el color de piel, la ropa y los accesorios se presentan en el cliente. El servidor conserva tres índices validados para el aspecto.

## Contrato del cliente

Todas las rutas son POST con JSON bajo /api/progress/. El perfil contiene id, nick, xp, level, revision, avatar y best. La revisión aumenta al cambiar datos. Una respuesta antigua se descarta si ya se aplicó una revisión posterior de la misma identidad. El cliente conserva el respaldo firmado más reciente cuando el servidor proporciona receipt.

| Acción | Solicitud | Resultado |
| --- | --- | --- |
| profile | {} o {receipt} | {profile,scope,receipt?}. Recupera una revisión firmada perteneciente a esta identidad. |
| avatar | {skin,outfit,headgear} | {profile,scope,receipt?}. Los índices enteros admiten 0–5, 0–5 y 0–3. |
| ranking | {} o {game} | {players,scope}. Hasta 30 jugadores con XP o marca positiva. Reflejos ordena por menor tiempo, memoria por más rondas. Desempata el identificador público. |
| start | {game} | Reflejos devuelve runId y delayMs. Memoria devuelve runId, round y sequence. Cada identidad mantiene una partida activa. |
| finish | {runId} o {runId,round,answer} | {profile,scope,receipt?,done,earned,score}. La continuación de memoria incorpora runId, round y sequence de la siguiente ronda. |

Reflejos puntúa si la recepción de la acción ocurre entre 80 y 3000 ms después del instante de señal del servidor. Los XP son 4000 dividido entre milisegundos, redondeados y limitados al rango 2–20. El tiempo incorpora latencia de red y de la interfaz. Memoria verifica el orden de los símbolos y un mínimo de observación de 350 ms más 600 ms por figura. Cada ronda válida otorga 4 XP más su número. La sesión termina en la ronda 12, al fallar o al pasarse el tiempo de inactividad de dos minutos. Cada 100 XP se sube un nivel. Abrir un juego en modo práctica conserva la voz y no acredita XP.

Las rondas tienen identificadores aleatorios de 128 bits. Se permiten hasta 20 inicios por minuto por jugador. El servidor ignora los puntajes suministrados por el cliente y conserva el primer resultado de cada intento para los reintentos. Un marcador de acreditación persistido dentro de la misma escritura impide sumar dos veces una ronda cuando se pierde la confirmación. Se admiten hasta 1000 partidas simultáneas. Los juegos del navegador pueden automatizarse y la identidad de invitado se puede regenerar. Estos rankings sirven para la comunidad y las marcas no certifican reflejos humanos ni resultados de competición con premios.

## Persistencia y migración

| Configuración | Comportamiento |
| --- | --- |
| Adaptador SQL inyectado por el servidor o UPSTASH_REDIS_REST_URL junto con UPSTASH_REDIS_REST_TOKEN | Ranking global y progreso en la base externa. En Redis REST la actualización de perfil y de los tres índices se efectúa mediante una operación Lua con comprobación de versión. |
| SQUADLINK_PROGRESS_FILE en volumen persistente | Archivo privado de una instancia con exclusión de escrituras y reemplazo atómico. El directorio y su copia de seguridad deben sobrevivir a la aplicación. Para desarrollo se usa data/progression.json. |
| Render efímero con SQUADLINK_RECEIPT_SECRET de 32 bytes o más y sin base externa | Ranking de esta sesión del servidor. Los jugadores recuperan sus perfiles con el respaldo HMAC guardado en sus dispositivos. El ranking se vuelve a poblar cuando regresan. |
| Render efímero sin base ni clave | Devuelve 503 hasta configurar almacenamiento. |
| Base configurada pero temporalmente indisponible | Devuelve 503. Los clientes pueden reintentar sin crear registros paralelos en otro almacén. |

Con la misma clave HMAC de al menos 32 bytes se pueden transferir respaldos entre una base global, el piloto y un servidor de Santiago. Cada respaldo se vincula a la huella completa de la identidad y permite restaurar XP, marcas y avatar. Para conservar el histórico global de jugadores que todavía no regresan hay que copiar la base completa. La rotación de la clave invalida los respaldos emitidos con la anterior. Un dispositivo que pierda su identidad de invitado también pierde la capacidad de reclamar ese perfil.

El adaptador de archivos soporta un único proceso escritor. Un clúster necesita una base externa. Las partidas y la deduplicación de respuestas HTTP en curso se mantienen en memoria. Tras reiniciar el proceso se inicia otra partida. Los puntos que se confirmaron en almacenamiento permanecen. Los respaldos solo se entregan junto con el perfil propio.
