# 15. Objetos de la colonia

Además de agentes, una colonia puede tener **objetos**: cosas que hive-am mantiene corriendo o vigila junto a ellos. Hay cuatro tipos: **servidores**, **Docker**, **peticiones HTTP** y **jefe**. Aparecen en el mapa de la Colonia como hexágonos (con el color del tipo y un punto de estado), dentro de la colonia a la que pertenecen o sueltos. Al pulsar uno ves su estado, lo inicias, detienes o reinicias y lees sus logs; el lápiz lo edita.

Se crea con **Nuevo objeto** (arriba a la derecha en la pantalla Colonia): eliges el tipo, un nombre, la colonia y los ajustes de abajo.

## 15.1 Servidor

Un comando de shell que hive-am mantiene corriendo.

| Campo | Significado |
|---|---|
| Carpeta | Ruta absoluta donde corre el comando. |
| Comando de inicio | Se ejecuta con `sh -c` (p. ej. `npm run dev`, `java -jar app.jar`). |
| Comando para detener (opcional) | Se ejecuta primero al detener (p. ej. `docker compose down`). Después el proceso se detiene siempre. |
| Puerto (opcional) | El objeto está **Iniciando** hasta que algo escuche en `127.0.0.1:<puerto>`, y luego **Corriendo**. Un proceso vivo dos minutos sin abrirlo se muestra como error. |
| Variables de entorno | `NOMBRE=valor`, una por línea, sumadas a las de hive-am. |

Cómo corre: el comando arranca en su **propio grupo de procesos** con la salida directo a `~/.hive-am/objects/<id>.log`, y el pid y la hora de inicio se guardan en `<id>.json`. Por eso:

- El servidor **sigue corriendo si hive-am se reinicia**; después se vuelve a encontrar por ese pid y esa hora de inicio (un pid que el sistema reutiliza para otra cosa no se confunde con él).
- **Detener** señala todo el grupo (`sh`, `npm`, `node`…): primero `SIGTERM`, y `SIGKILL` si no terminó en 8 s (`HIVE_AM_OBJECT_STOP_MS`).
- Estados: **Detenido** (nunca iniciado, detenido por ti o terminado con código 0), **Error** (terminó con código distinto de 0 o por una señal; el detalle dice cuál), **Iniciando**, **Corriendo**.
- Un log de más de 5 MB se aparta como `.log.1` cuando el objeto arranca.

## 15.2 Docker

Necesita el comando `docker`. Cada valor se pasa como un argumento aparte (sin shell) y los nombres y mapeos se validan (se rechaza una imagen o un volumen que parezca una opción).

| Modo | Qué hace hive-am | Al eliminar el objeto |
|---|---|---|
| **Crear un contenedor** (imagen, puertos `8080:80`, volúmenes, variables, política de reinicio, comando) | `docker run -d --name hive-am-<id> --label hive-am.object=<id>`, luego `start` / `stop` / `restart` | Se elimina el contenedor. |
| **Proyecto compose** (archivo, nombre del proyecto, servicios) | `docker compose -f archivo [-p proyecto] up -d / stop / restart` | El proyecto se detiene, **no** se elimina. |
| **Contenedor existente** (nombre o id) | Solo `start` / `stop` / `restart` y leer sus logs | Se deja como está. **Nunca se elimina.** |

El estado sale de `docker inspect` (corriendo, reiniciando, terminado con un código, no saludable / health check pendiente) o, en compose, de `docker compose ps`. Un contenedor que no existe es **Detenido** (los creados por hive-am) o **Desconocido** (los existentes).

## 15.2b Peticiones HTTP

Una carpeta de archivos `.http` / `.rest` en el formato de los clientes REST de IntelliJ y VS Code. Pulsa **Abrir el ejecutor** en su panel: a la izquierda están las peticiones de cada archivo (hasta 300 archivos, 4 niveles de profundidad) y a la derecha la elegida y su respuesta. Estado: **Listo** (la carpeta está; el detalle dice cuántas peticiones tiene) o **Error**.

- **Formato:** `###` separa peticiones (el texto que sigue es el nombre, o `# @name x`); `@nombre = valor` define una variable; la línea de petición es `MÉTODO URL [HTTP/1.1]`; las líneas que empiezan con `?` o `&` continúan la URL; las cabeceras siguen hasta la primera línea en blanco; el resto es el cuerpo (`< ./archivo.json` inserta un archivo junto al `.http`, dentro de la carpeta); los manejadores `> {% … %}` se ignoran.
- **Variables:** `{{nombre}}` toma su valor de las variables del archivo y luego del entorno elegido, y `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}` y `{{$randomInt}}` se generan. Los entornos salen de `http-client.env.json` (y de `http-client.private.env.json` encima, para secretos) en la carpeta del archivo o en cualquiera por encima; `$shared` aplica a todos. El objeto puede tener un entorno por defecto.
- **Ejecución:** el servidor envía la petición con `fetch` (60 s de límite, sigue redirecciones, las respuestas de más de 2 MB se cortan, las binarias se describen y no se imprimen). Una petición con un valor que no se puede resolver **no se envía**: el ejecutor nombra los `{{variables}}` que faltan antes de que pulses Ejecutar. **Ctrl+Enter** ejecuta la petición elegida; el icono de lista de un archivo ejecuta todas sus peticiones en orden, cada una conserva su última respuesta y un punto indica cómo salió. La respuesta se ve como Respuesta (JSON con formato), Cabeceras y Petición; la petición mostrada oculta los valores de `Authorization`, `Cookie` y cabeceras de API key.
- **Límites:** solo URLs `http` / `https`; no se lee nada fuera de la carpeta (se rechaza una ruta que salga de ella, incluso por un enlace); ejecutar una petición solo se acepta desde la app local. Los objetos HTTP no tienen logs y no se inician ni se detienen.

## 15.2c Jefe

Agrupa servidores y contenedores Docker **de la misma colonia** (no otros jefes ni objetos HTTP). **Iniciar todo** inicia los miembros en el orden en que están listados, saltando los que ya están arriba; **Detener todo** los detiene en el orden contrario; **Reiniciar todo** hace ambas cosas. Que uno falle no impide intentar los demás: los fallos se informan juntos. Su estado sale de sus miembros: **Corriendo** cuando todos lo están, **Iniciando** mientras uno inicia, **Error** cuando uno falló o solo algunos están arriba (el detalle dice cuáles), **Detenido** cuando ninguno lo está. Sus logs son los de los miembros con `[nombre]` delante de cada línea (el cursor son los cursores de los miembros juntos, así que seguirlo devuelve solo lo nuevo). En el mapa se une a sus miembros con líneas punteadas. Eliminar un jefe deja a sus miembros como están; eliminar un miembro, o moverlo a otra colonia, lo saca de los jefes.

## 15.3 Estado, logs y actualización en vivo

- Una revisión en segundo plano corre cada 3 s (`HIVE_AM_OBJECT_POLL_MS`) y avisa a la interfaz por el WebSocket (`objects_changed`) solo cuando algo cambió; listar nunca espera a `docker` ni a un puerto.
- Los **logs** se leen con un *cursor*: la primera llamada devuelve las últimas N líneas y cada una siguiente solo lo nuevo (un desplazamiento en bytes para servidores, la hora de la última línea para Docker). El panel vuelve a preguntar cada 1,2 s mientras está abierto, quita los códigos de color, conserva los últimos 200 000 caracteres y sigue el final salvo que subas con el scroll.

## 15.4 API

| Ruta | Qué hace |
|---|---|
| `GET /api/objects` | Todos los objetos con su estado. |
| `POST /api/objects` | `{ name, kind, colony_id?, config }` |
| `PATCH /api/objects/:id` | `{ name?, colony_id?, config? }` (el tipo no cambia). |
| `DELETE /api/objects/:id` | Lo elimina (ver 15.2 para lo que pasa con el contenedor). |
| `POST /api/objects/:id/action` | `{ action: "start" \| "stop" \| "restart" }` |
| `GET /api/objects/:id/logs?tail=&after=` | `{ text, cursor, reset? }` |

**Seguridad:** los objetos ejecutan comandos, así que crearlos, cambiarlos, eliminarlos y actuar sobre ellos se rechaza cuando la petición no viene de la app local (la misma regla que las acciones de git). Leer está abierto como el resto de la API, que solo escucha en `127.0.0.1`.

## 15.5 Agentes que cuidan objetos

Un agente con la skill **Colony objects** (`default-objects`, una de las skills que vienen con hive-am) recibe tres herramientas: `object_list`, `object_logs` y `object_action` (iniciar, detener, reiniciar). Para crear uno, elige un objeto en el mapa y pulsa **Crear un agente administrador** en su panel: abre el formulario de agente nuevo con la skill, la colonia y el permiso *Editar archivos* ya puestos (la misma skill se puede agregar a cualquier agente desde el selector de skills). El panel muestra quién cuida cada objeto.

Las reglas las aplica el servidor, no solo las escribe la skill:

- Un agente ve solo los objetos de **su propia colonia**; uno sin colonia ve los que no tienen. El objeto de otra colonia se ve como si no existiera.
- Un agente de **solo lectura** puede listar y leer logs pero no iniciar, detener ni reiniciar nada. (Claude bloquea todas las herramientas MCP en solo lectura de todos modos.)
- **No hay herramienta para crear, editar ni eliminar** objetos, ni para cambiar el comando que corren: eso queda para las personas.
- Cada acción de un agente queda escrita en el log del servidor (`[hive-am] manager asked to restart`), para saber quién hizo qué.
- Un agente sin la skill es rechazado aunque llegue a las herramientas.

API que usa el script MCP: `POST /api/agent-objects/list`, `…/action`, `…/logs` con `{ from: <id del agente>, … }`.

## 15.6 Elegir carpetas y archivos

Todo campo que guarda una ruta usa el mismo selector (`PathPicker` en `web/components/ui.tsx`; `FolderPicker` es su modo carpeta): la carpeta de un agente o de una colonia, la carpeta de un servidor, el archivo compose (modo archivo: lista los `.yml` / `.yaml`) y el lado del host de un volumen Docker (el botón *Añadir una carpeta de esta máquina*). Puedes escribir la ruta o pulsar Explorar, moverte por las carpetas y pulsar **Usar esta carpeta** (al elegir un archivo, pulsa el archivo). `GET /api/fs/dirs?path=&files=yml,yaml` lista carpetas, y archivos con esas extensiones.

## 15.7 Pruebas

`server/scripts/test-objects.ts`, `test-object-kinds.ts` (archivos HTTP, entornos, ejecución contra un servidor local, jefes) y `test-object-tools.ts` (sin modelo; el último pasa por el script MCP y la API HTTP reales): corre procesos reales (estado, espera del puerto, logs por cursor, detener con gracia y kill, reinicio, códigos de salida, comando de parada propio, un servidor iniciado por otro proceso y vuelto a encontrar) y contenedores Docker reales llamados `hive-am-*` desde una imagen local (crear, mapeo de puertos, etiqueta, logs sin marcas de tiempo, reinicio, adoptar uno existente, compose), más la validación de entradas. Omite la parte de Docker si falta Docker o la imagen y nunca toca un contenedor que no creó.

## 15.8 Lo que falta

Las terminales (un panel inferior). Los objetos Docker no se pueden crear en un host Docker remoto y PM2 no está integrado (un objeto servidor mantiene su propio proceso).
