# Problemas frecuentes

Esta guía reúne los problemas más comunes al usar hive-am, con su causa probable y qué hacer. Cada sección es una pregunta: busca la que se parezca a lo que ves.

## La barra lateral dice "Servidor sin conexión. Reintentando…"

El servidor no está corriendo o está en otro puerto. La interfaz reintenta sola.

1. Mira la terminal donde arrancaste hive-am: ¿sigue abierta y sin errores?
2. Si la cerraste, arráncalo de nuevo (`npx hive-am` o `hive-am`). Si lo arrancaste con `hive-am start --background`, `hive-am status` te dice si está corriendo y `hive-am logs` muestra su última salida; usa `hive-am stop` antes de respaldar o reiniciar la carpeta de datos.
3. Si cambiaste el puerto de la API con `HIVE_AM_PORT`, la interfaz tiene que apuntar al mismo puerto. Con el paquete de npm el puerto de la API es fijo (4400).

Cuando el servidor vuelve, el indicador pasa a **Conectado al servidor**.

## En lugar de las listas veo un aviso de que no pudo cargar

La API no respondió (estaba arrancando, detenida o en otro puerto). Arranca el servidor: la interfaz reintenta sola con pausas cada vez más largas, o pulsa **Reintentar**.

## Al arrancar dice que el puerto ya está en uso

Verás `port N is already in use: is hive-am already running?` y el programa sale. Ya hay otra instancia (o algo más) usando ese puerto.

1. Detén la otra instancia. En Linux o macOS, `lsof -ti :4400` te dice qué proceso usa el puerto de la API.
2. Si necesitas dos instancias, usa otro puerto: `HIVE_AM_PORT` para el servidor (al correr desde el código fuente) y `HIVE_AM_WEB_PORT` para la interfaz.

## El proveedor sale como "no encontrado"

Al crear un agente, la tarjeta del proveedor muestra **no encontrado** cuando el programa (`claude`, `opencode` o `kiro-cli`) no está en el `PATH` del servidor de hive-am.

1. Comprueba que el programa funciona en tu terminal.
2. Instálalo, o arranca hive-am desde una terminal donde esté accesible.
3. Reinicia hive-am y vuelve a abrir el formulario: debe aparecer como **instalado**.

## El turno falla con "produced no events"

La herramienta de línea de comandos corrió pero no envió nada que hive-am pudiera usar, y escribió otra cosa en su lugar (a menudo su texto de uso). La primera línea que imprimió aparece en el aviso.

1. Lee esa línea: dice qué no le gustó a la herramienta.
2. Actualiza la herramienta, o prueba el mismo comando a mano en tu terminal.

## El turno falla con un error "exited with code N"

La herramienta de línea de comandos falló: sesión caducada, modelo inválido, sin créditos, etc. El detalle aparece en el aviso rojo de la conversación.

1. Lee el texto del aviso.
2. Prueba el mismo comando a mano en tu terminal con la herramienta correspondiente.
3. Si la sesión caducó, inicia sesión de nuevo en esa herramienta.

> **Nota:** los errores crudos de las herramientas se muestran tal como llegan, sin traducir.

## "Este agente no tiene carpeta de trabajo…"

El agente no tiene carpeta propia y no pertenece a una colonia que se la preste. Abre sus ajustes y elige una **Carpeta de trabajo**, o ponlo en una colonia que tenga carpeta y que él siga.

## "La carpeta no existe"

La ruta que escribiste no existe en el disco. hive-am no expande `~`, así que escribe la ruta completa (por ejemplo `/home/tu-usuario/proyecto`) o elige la carpeta con el botón **Explorar**.

## Un agente no puede editar archivos o ejecutar comandos

Casi siempre es el nivel de permisos del agente (o el de su colonia, si lo sigue).

- **Solo lectura:** planifica y lee; nunca edita ni ejecuta comandos.
- **Editar archivos:** edita dentro de su carpeta, sin tocar `.git` ni llaves privadas. En OpenCode y Kiro bloquea todos los comandos; en Claude solo deja pasar comandos de archivos.
- **Acceso total:** sin restricciones.

Cambia el nivel en los ajustes del agente (o en la colonia, si lo hereda). Un agente con una conexión externa necesita al menos **Editar archivos**. Más en el [capítulo 13](13-permisos-y-seguridad.md).

## Mi mensaje se perdió después de reiniciar o apagar

Si el servidor se detiene a mitad de un turno, ese turno se pierde. La sesión queda intacta y el agente vuelve a **Inactivo** al reiniciar, pero tienes que reenviar el mensaje. Los mensajes en cola que no habían empezado también se pierden.

## La sesión no se reanuda o el agente parece empezar de cero

Normalmente el siguiente mensaje continúa la misma sesión real, incluso tras reiniciar. Hay casos en los que se empieza una sesión nueva:

- Si cambias la carpeta de una colonia y eso mueve a sus agentes, ellos empiezan una conversación nueva. La anterior no se pierde: queda en la pestaña **Sesiones** del agente, donde puedes leerla y reanudarla.
- En OpenCode, una sesión registrada con una carpeta distinta a la del agente se reemplaza por una nueva al enviar el siguiente mensaje.
- Pulsar **Nueva conversación** empieza una sesión nueva a propósito. La actual se conserva en **Sesiones**.

Más detalles en el [capítulo 7](07-sesiones.md).

## El historial sale vacío

Puede que la herramienta haya cambiado el formato de sus archivos o que la sesión se borrara en la propia herramienta. Las conversaciones viven en los almacenes de cada herramienta, no en hive-am: si ya no existen allí, hive-am no las puede mostrar.

## Un orquestador no delega

Si no tiene workers conectados, no puede delegar. Conéctalos en **Relaciones** o en la sección **Equipo** de su formulario, y pídele explícitamente que delegue a un worker por su nombre. Si el orquestador no ve a un agente nuevo, empieza una **Nueva conversación**. Más en el [capítulo 5](05-orquestacion-y-relaciones.md).

## Un orquestador espera sin fin a un worker

La delegación no tiene tiempo límite. Si el worker se colgó, pulsa **Detener** en el worker. Un worker ocupado hace esperar al orquestador, porque cada agente atiende un turno a la vez.

## La cola del agente dejó de avanzar

Una herramienta que no imprime nada durante 10 minutos la detiene hive-am, y el turno falla con "stopped answering". Los mensajes que esperaban detrás se ejecutan. Reenvía el mensaje que falló si aún lo necesitas.

## Detener no vació la cola

**Detener** aborta el turno en curso, pero los mensajes que ya estaban en cola siguen su camino.

## No se abre una terminal

Revisa que no hayas arrancado con `HIVE_AM_TERMINALS=0` y que abras hive-am desde `localhost` o `127.0.0.1`: por una dirección de red local no hay terminales. Detalle en el [capítulo 12](12-terminales.md).

## Una petición responde 413 "The request is too big"

El cuerpo es demasiado grande. Envía menos texto; para archivos, el límite es de 5 por mensaje y 20 MB cada uno.

## Escribir en el chat va lento

Pasa con conversaciones muy largas con muchas herramientas abiertas. Contrae las herramientas con **Contraer todas las herramientas** (el enlace bajo el campo de texto alterna entre expandir y contraer). Si corres hive-am desde el código fuente en modo desarrollo, la versión compilada (`next build` y `next start`) es notablemente más rápida.

## No aparece el costo de un agente

Es esperado: si el modelo no es de una familia conocida y la herramienta no informa el costo, no se muestra. Los valores con `≈` son estimaciones con precios de lista.

## Falla la instalación por `better-sqlite3`

No hay binario precompilado para tu versión de Node o tu sistema. Usa Node 20 LTS o instala las herramientas de compilación de tu sistema.

## Quiero respaldar o restablecer mis datos

- **Respaldo:** detén hive-am y copia `~/.hive-am` completa.
- **Restablecer todo:** detén hive-am y borra `~/.hive-am`. Se recrea al arrancar. Tus conversaciones no se pierden, porque están en los almacenes de cada herramienta.
- **Cambiar de lugar:** define `HIVE_AM_HOME` antes de arrancar.

Si el problema que tienes no está aquí, revisa los mensajes de error de la conversación y de la terminal donde corre hive-am: casi siempre dicen qué falló.

Volver al [índice del manual](README.md)
