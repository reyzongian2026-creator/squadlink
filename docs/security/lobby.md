# Revisión de permisos y privacidad del lobby

La revisión cubre el servidor, el cliente público y los controles locales de admisión. Las pruebas usan únicamente sesiones sintéticas.

| Control revisado | Evidencia |
| --- | --- |
| Identidad y pertenencia | Las sesiones de dos clientes se distinguen y un usuario de otra sala recibe un error al intentar dirigir señalización a un miembro ajeno. El servidor establece la identidad de origen. |
| Privacidad de la clave | El servidor verifica la clave con scrypt y sal por sala. La vista pública omite la clave y el hash. La prueba comprueba que el secreto de la sala no aparece en la respuesta y que el usuario rechazado continúa fuera. |
| Procedencia de mutaciones | En la prueba, la petición de creación con Origin ajeno devuelve un error. La cookie es HttpOnly y SameSite. La opción Secure depende de configurar el origen HTTPS en el servidor compartido. |
| Salida durante una desconexión | Se encontró que el frontend esperaba la respuesta de salida antes de liberar el audio. Se cambió el orden y se añadió una acción para reintentar. Happy DOM verificó controles inmediatamente desactivados y salida confirmada al recuperar conectividad. Las pruebas de voz cubrieron pista liberada y permisos tardíos con dobles. |
| Entrada de nombres | La revisión del código comprobó que la lista de participantes y el título de sala usan textContent. |
| Dependencias | No se declaran paquetes de ejecución de terceros. El motor de navegador y los contenedores del piloto requieren su propio mantenimiento. |

La configuración pública de HTTPS y TURN no se desplegó. Quedan pendientes la comprobación de cookies sobre HTTPS, la ruta de relay y el acceso desde dos redes reales. Las salas con clave restringen la entrada a ese grupo. La instancia permite que invitados creen sus propias salas.
