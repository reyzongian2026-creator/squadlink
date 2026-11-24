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

## Amigos, admisión y audio en v0.2

La suite local de Node pasó 21 de 21 casos en la revisión del módulo social. El recorrido adicional con Happy DOM y el HTTP de la app utilizó una sesión del anfitrión y otra independiente del visitante. Se aceptó la amistad en la interfaz, se verificó la actividad VALORANT del visitante, se confirmó que este seguía fuera mientras esperaba y que pudo acceder a la misma sala protegida tras la autorización.

El script de Chromium amplía el recorrido existente de código manual y audio sintético con tres perfiles, dos amistades confirmadas, estado y actividad, autorización por el anfitrión, persistencia tras recarga y diagnóstico de ruta. Comprueba además que desactivar la reducción de ruido en el navegador persiste al reabrir los controles. La prueba contra localhost en el entorno de desarrollo no llegó a arrancar por el bloqueo del puerto. Los resultados de Chromium de un runner deben vincularse a la revisión que realmente se ejecutó.

## Calidad de voz en 0.5.0-preview.14

Se midió el audio recibido después de la codificación y decodificación WebRTC a 48 kHz. Cada llamada conectó la aplicación instalada con un segundo participante de navegador. Se enviaron en ambos sentidos un tono, silencio, ruido sintético continuo a −38 dBFS RMS, una vocal sintética sola y con ruido, y una señal fuerte.

| Ejecución | Atenuación del ruido entre frases frente al filtro desactivado | Mayor pico recibido con la señal fuerte |
| --- | --- | --- |
| [Windows x64](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45332894401) | 24,10 a 24,13 dB | −2,29 dBFS |
| [macOS Apple Silicon](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45332894322) | 23,99 a 24,10 dB | −2,30 dBFS |

El tono cubrió el 100 % de las ventanas medidas en cada sentido. Ninguna muestra alcanzó el umbral de saturación de la prueba (magnitud PCM ≥ 0,99). Las mediciones corresponden a señales de referencia. El ruido acústico del cuarto, la interfaz de audio y los altavoces de los jugadores requieren una escucha en sus equipos.

## Voz, radio y Arcade en 0.5.0-preview.15

Dos participantes enviaron audio simultáneamente. Se midió el PCM del reproductor de voz del oyente y se controlaron por separado las pistas WebRTC entrante y saliente. Los resultados se obtuvieron con señales de prueba y con las aplicaciones empaquetadas.

| Sistema | Escucha de 100 % a 200 % | Micrófono a +6 / +12 dB | Pico con micrófono a +18 dB |
| --- | --- | --- | --- |
| [Windows x64](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45343833285) | +6,08 dB | +5,98 / +11,95 dB | −2,34 dBFS |
| [Mac con Apple Silicon](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45343833275) | +6,02 dB | +6,04 / +12,05 dB | −2,42 dBFS |

En ambos sistemas, la ganancia de escucha produjo un cambio medido de 0,00 dB en el audio enviado al otro participante. La prueba de señal fuerte con el micrófono a +18 dB registró cero muestras saturadas. Se conservó la misma pista del micrófono al cambiar los niveles.

La emisora de prueba y la energía de voz en ambos sentidos siguieron avanzando al minimizar, restaurar y volver al lobby. Un jugador pudo silenciar y reanudar la radio mientras el otro siguió escuchando. En Arcade se abrieron los dos espacios de cartuchos con ROM de diagnóstico instaladas y el selector de archivos oculto. El instalador de Windows también comprobó la copia de ambos archivos por su hash.

## Atajo de radio y cartuchos en 0.5.0-preview.16

Con dos participantes en la sala, se comprobó el silencio y la reanudación de la radio desde el botón del lobby y mediante **Alt + Mayús + R** en el lobby y en Arcade. Mientras uno silenciaba su radio, en el otro cliente avanzaban la emisora y la voz. Con Squadlink minimizado, Windows recibió la pulsación a través del sistema. En Mac se probó la función registrada por el sistema para esa combinación. El ensayo de Mac con la ventana minimizada no inyectó pulsaciones físicas.

El instalador personal de Windows incluye los cartuchos como archivos internos. La prueba del instalador utilizó dos cartuchos de diagnóstico, eliminó los originales antes de ejecutar el EXE y verificó los hashes de las copias instaladas. El recorrido de Arcade probó la apertura directa de cartuchos integrados, y la recuperación de una importación anterior en la edición pública. [Pruebas de Windows](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45346558666) · [Pruebas de Mac](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45346558637)

## Lobby, radio y Arcade en 0.5.0-preview.17

- El lobby de escritorio conserva las salas visibles durante una caída de red, permite reintentar y pausa las consultas mientras está oculto. La prueba simuló veinte cambios de foco consecutivos y comprobó que se enviaba una sola consulta.
- El directorio conserva las páginas abiertas y el filtro al actualizar. Si falla la petición de la segunda página, la lista anterior sigue disponible.
- Si se desconecta el micrófono nuevo al activarlo durante una llamada, Squadlink conserva el anterior, la pista saliente y su configuración. La prueba simula la desconexión.
- La radio guarda en cada equipo el volumen elegido. Ante un corte de una emisora que ya estaba sonando, intenta reconectarse una vez en ese reproductor. Silenciar o salir cancela el intento pendiente. En el ensayo con dos clientes se interrumpió una emisora de prueba y se verificó que la escucha se reanudara.
- En la edición de escritorio, Mario y Duck Hunt pausan la emulación y liberan sus teclas y audio cuando la ventana pierde el foco. Al volver, P reanuda la partida. La llamada y la radio tienen ciclos de reproducción independientes.

[Validación de Windows x64](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45348499403) · [Validación de macOS Apple Silicon](https://github.com/reyzongian2026-creator/squadlink/actions/runs/45348499393)

En los equipos de CI, la suma de memoria residente de los procesos de Electron fue de 431,7 MiB en inicio y 568,3 MiB en voz para Windows, y de 544,8 MiB y 630,1 MiB respectivamente para macOS. Son lecturas puntuales con instrumentación durante una llamada sintética. Sigue pendiente la comparación con Discord en el mismo equipo y bajo la misma carga.
