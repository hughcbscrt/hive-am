# Recursos

Además de agentes, una colonia puede tener **recursos**: cosas que hive-am mantiene corriendo o vigila junto a tus agentes. Hay cinco tipos: **Servidor**, **Docker**, **Peticiones HTTP**, **Base de datos** y **Clúster**. Cada uno aparece en el mapa de la Colonia como un hexágono, con el color de su tipo y un punto de estado.

En este capítulo aprendes a crear un recurso, a manejar cada tipo y a dejar que un agente administrador lo cuide por ti. Los ejemplos usan el proyecto "Tienda online": la API de la tienda, un Redis, una base SQLite, un archivo de peticiones HTTP y un clúster que agrupa a los dos primeros.

## La pantalla de Recursos

**Recursos** en el menú de la izquierda abre una pantalla con dos zonas:

- **Lista de recursos** (a la izquierda): están agrupados por colonia, cada uno con un punto de estado, su tipo y un resumen. Arriba tienes un buscador (**Buscar un recurso**) y el botón **+** para crear uno. La lista se puede contraer a iconos.
- **El recurso elegido** (a la derecha): una cabecera con su estado y las acciones, y debajo las pestañas.

Los estados que verás en la cabecera y en la lista:

| Estado | Qué significa |
|---|---|
| **Corriendo** | Está en marcha (y, si indicaste un puerto, ya hay algo escuchando). |
| **Iniciando** | Arrancó, pero todavía no escucha en su puerto. |
| **Detenido** | Nunca se inició, lo detuviste tú o terminó con código 0. |
| **Error** | Terminó con un código distinto de 0, o falló su chequeo de salud. El detalle dice el motivo. |
| **Desconocido** | Es un contenedor existente que Docker no encuentra. |
| **Listo** | Solo para peticiones HTTP y bases de datos: se usan, no se inician. |

Las pestañas dependen del tipo:

| Tipo | Pestañas |
|---|---|
| Servidor y Docker | **Resumen**, **Logs**, **Configuración** |
| Clúster | **Resumen** (con sus miembros), **Logs**, **Configuración** |
| Peticiones HTTP | **Peticiones**, **Historial**, **Variables**, **Configuración** |
| Base de datos | **Consultas**, **Esquema**, **Historial**, **Configuración** |

> **Consejo:** la pestaña abierta queda en la dirección de la página (`?tab=`), así que puedes copiar el enlace y abrirlo directo en esa pestaña.

## Crear un recurso

1. Pulsa **+** en la lista de Recursos (o **Nuevo recurso**, arriba a la derecha en la pantalla Colonia). Se abre el panel **Nuevo recurso**.
2. En **Qué tipo de recurso**, elige una tarjeta: **Servidor**, **Docker**, **Peticiones HTTP**, **Base de datos** o **Clúster**.
3. En **General**, escribe el **Nombre** (en una base de datos puede quedar vacío: se toma de la base y el motor).
4. Elige la **Colonia** a la que pertenece. Puedes dejarlo en **Sin colonia**.
5. Si quieres, busca un **Agente administrador** (más abajo explico qué hace).
6. Rellena los campos propios del tipo (los verás en las secciones siguientes) y pulsa **Crear**.

![Panel Nuevo recurso abierto sobre la pantalla de Recursos, con las cinco tarjetas de tipo y los campos Nombre, Colonia y Agente administrador](img/recurso-nuevo.jpg)

*El panel Nuevo recurso. Arriba están las cinco tarjetas de tipo (Servidor aparece elegido); abajo, la sección General con Nombre, Colonia y Agente administrador. Pulsa Crear cuando termines.*

Un recurso se edita después desde su pestaña **Configuración** (o con el lápiz de su tarjeta en el mapa). El tipo no se puede cambiar.

> **Nota:** crear, cambiar, eliminar y actuar sobre un recurso solo se acepta desde la app local, porque los recursos ejecutan comandos en tu máquina.

## Servidor

Un servidor es un comando de shell que hive-am mantiene corriendo: `npm run dev`, `node server.mjs`, `java -jar app.jar`. Tienes sus logs, su uso de CPU y memoria, y acciones para iniciarlo, detenerlo y reiniciarlo.

### Campos al crear

| Campo | Para qué sirve |
|---|---|
| **Carpeta** | Dónde se ejecuta el comando. Pulsa **Explorar** para elegirla. |
| **Comando de inicio** | Lo que se ejecuta, por ejemplo `npm run dev`. |
| **Comando para detener (opcional)** | Se ejecuta antes de detener el proceso (por ejemplo `docker compose down`). Después el proceso se detiene siempre. |
| **Puerto (opcional)** | Si lo indicas, el recurso está **Iniciando** hasta que algo escuche en ese puerto, y luego **Corriendo**. Un proceso vivo dos minutos sin abrirlo se muestra como error. |
| **Variables de entorno** | Una `NOMBRE=valor` por línea, sumadas a las de hive-am. |

### Iniciar, detener y reiniciar

La cabecera del recurso tiene **Iniciar**, **Detener** y **Reiniciar**, además de **Terminal** para abrir una terminal en su carpeta. Dos detalles que conviene saber:

- El servidor **sigue corriendo si hive-am se reinicia**. Cuando vuelve, hive-am lo reencuentra.
- **Detener** pide al proceso que termine y, si no lo hace en 8 segundos, lo fuerza. Ese tiempo se ajusta en **Segundos para detenerse**.

### Resumen

La pestaña **Resumen** reúne tres tarjetas y la salida reciente.

![Pestaña Resumen del servidor API de la tienda: estado Corriendo, CPU y memoria, detalles del comando y última salida](img/recurso-servidor-resumen.jpg)

*Resumen del servidor "API de la tienda". Arriba, el estado (Corriendo desde hace 13 min), el uso (CPU 0 %, memoria 49,5 MB) y los detalles (comando, carpeta, puerto 4555, política de reinicio, chequeo de salud, PID). Abajo, la última salida y el enlace Ver todos los logs.*

### Logs

La pestaña **Logs** ocupa toda la pantalla. Puedes:

1. Escribir en **Buscar en los logs** para resaltar coincidencias, o marcar **Solo coincidencias** para ver únicamente esas líneas.
2. Dejar activo **Seguir el final** para ver lo nuevo según llega (si subes con el scroll, deja de seguir).
3. Usar los botones de la derecha: ajustar líneas, tamaño del texto, pausar, limpiar la vista, copiar y descargar.

Las líneas de error y de advertencia se pintan de color.

![Pestaña Logs del servidor con la caja de búsqueda, la casilla Solo coincidencias y los botones de la barra de herramientas](img/recurso-servidor-logs.jpg)

*La pestaña Logs. Arriba están la búsqueda, la casilla Solo coincidencias y los botones de la derecha (ajuste de línea, tamaño, pausa, limpiar, copiar, descargar). Abajo a la izquierda, el contador de líneas.*

### Configuración y mantenerlo sano

La pestaña **Configuración** muestra los mismos campos que al crear, repartidos en tarjetas (**General**, **Cómo corre**, **Entorno**, **Mantenerlo sano**). Abajo hay una barra que dice si algo quedó sin guardar y ofrece **Guardar**, **Descartar**, **Guardar y reiniciar** (si está corriendo) y **Eliminar**. Los cambios de un recurso que corre se aplican al reiniciarlo.

![Pestaña Configuración del servidor con las tarjetas General, Cómo corre, Entorno y Mantenerlo sano](img/recurso-servidor-configuracion.jpg)

*Configuración del servidor. A la derecha está la tarjeta Mantenerlo sano, con Si termina por sí solo (Reiniciar tras un fallo) y el Chequeo de salud HTTP. Abajo, la barra con Eliminar, Descartar, Guardar y reiniciar y Guardar.*

La tarjeta **Mantenerlo sano** define lo que hive-am hace por sí solo:

- **Si termina por sí solo:** no hacer nada (por defecto), reiniciar tras un fallo o reiniciar siempre. Cada reinicio espera más que el anterior (1 s, 2 s, 4 s, hasta 30 s) y hay un tope en **Reinicios máx.** (por defecto 5 en 10 minutos). Si se supera, queda en error y dice que se rindió. Detenerlo tú nunca se deshace.
- **Chequeo de salud:** puede ser HTTP (sano si la URL responde 2xx o 3xx), puerto (algo acepta conexiones) o comando (termina con 0). Se repite cada N segundos (**Cada (s)**, 15 por defecto) y, tras varios **Fallos seguidos** (3 por defecto), el servidor se muestra como error con el motivo. Marca **Reiniciarlo cuando no esté sano** si quieres que además lo reinicie.
- **Segundos para detenerse:** el plazo tras la señal de terminar antes de forzarlo (8 por defecto).
- **Tamaño del log (MB):** al llegar a ese tamaño (5 por defecto), la parte vieja se aparta y el archivo empieza de nuevo.

> **Nota:** los contadores de reinicio viven en memoria. Si hive-am se detiene, el servidor sigue corriendo pero nadie lo reinicia; hive-am retoma el cuidado cuando arranca.

## Docker

Un recurso Docker maneja contenedores. Necesita el comando `docker` en tu máquina. Al crearlo eliges en **Cómo se maneja** uno de tres modos:

| Modo | Qué hace hive-am | Al eliminar el recurso |
|---|---|---|
| **Crear un contenedor** | Crea el contenedor a partir de una **Imagen**, con **Puertos** (`8080:80`), **Volúmenes** (`/ruta/host:/en/contenedor`), variables de entorno, **Política de reinicio** y **Comando (opcional)**. | Se elimina el contenedor. |
| **Proyecto compose** | Maneja un **Archivo compose**, con **Nombre del proyecto (opcional)** y **Servicios (opcional)** (vacío significa todos). | El proyecto se detiene, no se elimina. |
| **Contenedor existente** | Solo lo inicia, detiene, reinicia y lee sus logs. | Se deja como está. Nunca se elimina. |

Los formularios consultan a Docker para sugerirte lo que ya existe: imágenes locales, contenedores existentes (los que creó hive-am aparecen marcados) y, al elegir un archivo compose, sus servicios. Si Docker no está disponible, las listas salen vacías y siempre puedes escribir el valor a mano.

En modo **Crear un contenedor** puedes fijar límites y red (memoria, CPUs, red, tamaño del log, tiempo para detenerse). Si cambias uno, el contenedor se vuelve a crear la próxima vez que inicia o se reinicia, y lo que había dentro se pierde.

El **Resumen** de un Docker añade procesos, red y disco, y muestra la imagen, los puertos y el número de reinicios.

**Inspeccionar** (en **Más**, para un contenedor creado o uno existente) muestra dos paneles: **Configurado en hive-am**, lo que configuraste (siempre aparece, aunque el contenedor no exista), y **Lo que dice Docker**, el detalle en vivo con sus variables, puertos, montajes, redes, chequeos de salud y **Etiquetas**. Si Docker todavía no tiene el contenedor (se crea la primera vez que lo inicias), no lo encuentra o no está en marcha, Inspeccionar te lo dice en lugar de fallar. Si cambiaste los ajustes desde que se creó el contenedor, te avisa que se creará de nuevo al siguiente inicio.

Su pestaña **JSON crudo** muestra todo lo que dice `docker inspect`, resaltado, con una caja de búsqueda que salta a cada coincidencia y un botón **Copiar JSON** que copia lo que ves. Las variables cuyo nombre parece un secreto (contraseñas, tokens, claves) llegan ocultas; pulsa **Mostrar** para verlas. Las etiquetas y el comando no se ocultan, así que revísalos antes de compartir el JSON. Cada servicio de compose tiene la misma pestaña.

![Resumen del recurso Docker Redis del carrito: estado, CPU y memoria, red y disco, y detalles como contenedor, imagen y puertos](img/recurso-docker.jpg)

*Resumen de "Redis del carrito", un contenedor existente (Se maneja como: Contenedor existente). Fíjate en el uso (CPU, memoria, procesos, red y disco) y en los detalles de imagen redis:7-alpine y puertos publicados.*

**Desde una plantilla.** Al crear un recurso Docker, la opción **Desde una plantilla** ofrece servicios listos (Redis, Valkey, PostgreSQL, MariaDB, MySQL, MongoDB, RabbitMQ, MinIO, Nginx, Mailpit, Adminer). Rellenas unos pocos valores (versión, puertos, usuario, contraseña) y hive-am crea un recurso compose que inicias cuando quieras.

Un recurso compose lista sus **servicios**, y cada uno tiene sus propias acciones de iniciar, detener, reiniciar y ver logs. Cada servicio también ofrece **Inspeccionar**, una shell dentro del contenedor, **Crear de nuevo** y **Reconstruir**.

## Peticiones HTTP

Un recurso de peticiones HTTP apunta a una **carpeta con archivos `.http` o `.rest`**, en el formato de los clientes REST de IntelliJ y VS Code. No se inicia ni se detiene, y no tiene logs: sirve para enviar peticiones y revisar respuestas.

### Crear

Al elegir **Peticiones HTTP** rellena:

- **Carpeta con los archivos .http:** se leen todos los `.http` y `.rest` que haya dentro (hasta 4 niveles).
- **Entorno por defecto (opcional):** uno de los nombres de `http-client.env.json`, por ejemplo `dev`.

El estado queda en **Listo** y el detalle dice cuántas peticiones y archivos encontró.

### El ejecutor

La pestaña **Peticiones** tiene a la izquierda el selector **Entorno**, un buscador de peticiones y la lista de archivos con sus peticiones. Si pulsas un archivo, ves a la derecha sus peticiones y puedes ejecutarlas todas.

![Pestaña Peticiones del recurso API de la tienda (HTTP) con el archivo tienda.http abierto y sus tres peticiones sin ejecutar](img/recurso-http-archivo.jpg)

*El archivo tienda.http con sus tres peticiones (Listar productos, Estado del servicio y Producto inexistente), todas "sin ejecutar". Arriba a la derecha está el botón Ejecutar todo el archivo; a la izquierda, el selector de Entorno (dev).*

### Ejecutar una petición

1. Elige el **Entorno** (por ejemplo `dev`).
2. Pulsa una petición de la lista.
3. Pulsa **Ejecutar** o usa **Ctrl+Enter**.

Si la petición usa una `{{variable}}` sin valor, no se envía: el ejecutor te dice cuáles faltan. Elige un entorno que las defina o agrégalas.

La respuesta tiene estas pestañas:

| Pestaña | Qué muestra |
|---|---|
| **Respuesta** | El cuerpo, como árbol JSON plegable (o **Texto**). Una caja arriba filtra por texto o por JSONPath (`$.items[*].id`). |
| **Cabeceras** | Las cabeceras de la respuesta. |
| **Pruebas** | Las verificaciones y si pasaron (por ejemplo `2/2`). |
| **Petición** | La petición tal como se enviará o se envió. Oculta los valores de `Authorization`, `Cookie` y claves de API. |
| **Variables** | Cada variable con su valor actual y de dónde sale. |
| **Autenticación** | Bearer, Basic o API key; se escribe en la petición como la cabecera correspondiente. |

![Respuesta de la petición Listar productos: árbol JSON con dos productos, estado 200 OK, 6 ms, y las pestañas Respuesta, Cabeceras, Pruebas, Petición, Variables y Autenticación](img/http-respuesta.jpg)

*Respuesta a "Listar productos" (GET {{base}}/products). Arriba a la derecha ves 200 OK, 6 ms y 112 B, y la etiqueta "Guardó: primerSku". Debajo, el árbol JSON con los dos productos.*

### Pruebas y encadenar peticiones

Dentro del archivo `.http`, un bloque `> {% ... %}` después del cuerpo se ejecuta al recibir la respuesta. Con él puedes:

- Comprobar la respuesta: `client.test("nombre", function () { client.assert(response.status === 200, "mensaje"); })`.
- Guardar un valor para las peticiones siguientes: `client.global.set("token", response.body.token)`. Desde entonces lo usas como `{{token}}`.

La pestaña **Pruebas** muestra cada prueba como pasada o fallida y permite **Agregar verificación** (estado, tiempo, una cabecera, un valor del JSON o un texto) y **Guardar verificaciones**, que las escribe en el archivo.

![Pestaña Pruebas de Listar productos con dos verificaciones pasadas: responde 200 y hay productos](img/http-pruebas.jpg)

*La pestaña Pruebas (2/2) de "Listar productos": "responde 200" y "hay productos" pasaron. A la derecha están Agregar verificación y Guardar verificaciones.*

> **Nota:** hive-am no ejecuta JavaScript real. Un intérprete pequeño entiende solo lo que estos scripts necesitan (`response`, `client`, comparaciones, `if`, funciones flecha, métodos básicos de texto y listas). Si un script usa algo fuera de eso, no se ejecuta y la respuesta dice qué no está soportado (la petición ya se envió). Un archivo de script externo (`> ./checks.js`) tampoco se ejecuta.

Una petición con nombre (`### login`) puede usarse en las siguientes: `{{login.response.body.$.token}}`.

### Ejecutar todo el archivo

El botón **Ejecutar todo el archivo** (o el icono de lista junto al archivo) ejecuta sus peticiones en orden, así cada una encuentra lo que guardó la anterior. Cada petición conserva su última respuesta y un punto de color indica cómo salió: verde si todo fue bien, rojo si el estado fue un error, falló una prueba o el script no pudo ejecutarse. Activa **Detener al primer fallo** si quieres cortar en el primer problema.

![Tras ejecutar todo el archivo: Listar productos 200 con pruebas 2/2, Estado del servicio 200 y Producto inexistente 404 en rojo](img/http-ejecutar-todo.jpg)

*Resultado de Ejecutar todo el archivo. La columna Última ejecución muestra 200 (3 ms), 200 (2 ms) y 404 (1 ms) en rojo; la columna Pruebas, 2/2. En la lista de la izquierda, un punto verde o rojo por petición.*

Si abres una petición que respondió con error, el estado aparece en rojo y puedes revisar sus cabeceras y pruebas como en cualquier otra respuesta.

![Respuesta 404 Not Found de la petición Producto inexistente, con la pestaña Pruebas sin verificaciones](img/http-respuesta-404.jpg)

*Una respuesta con error: arriba a la derecha, el estado 404 Not Found en rojo con su tiempo y tamaño. Esta petición no tiene pruebas, y desde aquí puedes agregarlas.*

### Variables y secretos

Una `{{variable}}` toma su valor del entorno elegido (`http-client.env.json`, y `http-client.private.env.json` para secretos), de las variables propias del recurso o de las del archivo (`@nombre = valor`). Lo que guarda un script en la sesión gana sobre todo lo demás, y un archivo env gana sobre las variables del recurso. También hay valores que se generan solos: `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}` y `{{$randomInt}}`.

La pestaña **Variables** del recurso tiene **Todos los entornos** (valores que aplican siempre) y una pestaña por entorno (`dev`, `local`, o uno nuevo con **Nuevo entorno** y **+**). Para agregar una:

1. Elige **Todos los entornos** o el entorno que quieras.
2. Pulsa **Agregar una variable**.
3. Escribe el nombre y el valor. Si es un secreto, márcalo como tal.
4. Pulsa **Guardar**.

![Pestaña Variables del recurso HTTP con las pestañas Todos los entornos, dev y local, y el botón Agregar una variable](img/http-variables.jpg)

*La pestaña Variables del recurso. Arriba están Todos los entornos, dev y local, y un campo para un entorno nuevo. Abajo, el botón Agregar una variable y la barra con Descartar y Guardar.*

Un secreto se oculta al guardar y la interfaz nunca recibe su valor. Guardarlo vacío conserva el anterior.

> **Nota:** los secretos se guardan en la base de datos de hive-am en tu máquina, **sin cifrar**, igual que el token del bot de Telegram.

### Historial y comparar

La pestaña **Historial** guarda las últimas 100 ejecuciones, con su respuesta, y sobrevive a un reinicio. **Comparar con…** muestra las diferencias con la ejecución anterior de esa petición o con cualquier otra: estado, tiempo, tamaño, cabeceras y un diff de la respuesta.

Otras ayudas del ejecutor: **Copiar como…** (cURL, fetch, Python y otros formatos), el **+** junto al entorno para agregar una petición nueva (desde un formulario o pegando un comando cURL) y **Ejecutar con datos…** para correr un archivo una vez por cada fila de un CSV o de un arreglo JSON.

## Base de datos

Un recurso de base de datos se *usa*, no se inicia: hive-am abre una conexión cuando le pides algo (su estado, el esquema, una consulta) y la cierra enseguida. Soporta **MySQL / MariaDB**, **PostgreSQL**, **SQLite** y **SQL Server**.

### Crear la conexión

1. Elige **Base de datos** y el motor en su tarjeta.
2. Pega una **URL de conexión** (`postgresql://usuario:clave@host:5432/app`, `mysql://...`, `mssql://...`, `sqlite:///ruta/app.db`) y los campos se rellenan solos. O rellena **Servidor**, **Puerto**, **Usuario**, **Contraseña** y la base por defecto. En SQLite, indica el archivo.
3. Pulsa **Probar conexión** antes de guardar para comprobar que funciona.
4. Pulsa **Crear**.

La contraseña se queda en el servidor: la interfaz la recibe vacía, y guardar con el campo vacío conserva la anterior. El estado queda en **Listo**, con la versión del motor y lo que tardó la conexión.

Si tu servidor lo pide, activa **Usar SSL / TLS**. Se verifica el certificado salvo que aceptes uno autofirmado, y puedes indicar los archivos `.pem` de la CA y del cliente. La configuración también tiene una tabla de **propiedades del driver** (por ejemplo `charset` en MySQL o `application_name` en PostgreSQL).

### Solo lectura por defecto

Al principio solo se aceptan sentencias que leen (`SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN` y un `PRAGMA` que no cambie nada). El editor muestra la insignia **Solo lectura**. Si apagas esa opción en la **Configuración**, las escrituras se ejecutan de verdad y el mapa muestra **Puede escribir** en rojo.

Un resultado nunca trae más de 1000 filas por defecto, y una consulta que tarda más de 30 segundos se detiene. Ambos límites se ajustan en la configuración.

### Escribir y ejecutar consultas

1. Abre la pestaña **Consultas**.
2. Escribe tu SQL en el editor (con resaltado y sugerencias de tablas y columnas; **Ctrl+Espacio** las pide).
3. Pulsa **Ejecutar** o usa **Ctrl/Cmd+Enter**. Si seleccionas un trozo, se ejecuta solo la selección.
4. Mira la tabla de resultados. Puedes copiarla como **CSV** o **JSON**, o pulsar **Descargar CSV**.

**Formatear** ordena la consulta con el dialecto del motor. **Guardar consulta** la conserva con un nombre y la encuentras en el menú **Guardadas**.

![Pestaña Consultas de la Base de la tienda con una consulta SQL resaltada y una tabla de 20 filas de pedidos](img/db-consulta.jpg)

*La pestaña Consultas de "Base de la tienda" (SQLite). Arriba, los botones Ejecutar, Guardar consulta, Formatear y Guardadas, y la insignia Solo lectura. Abajo, el resultado: 20 filas en 60 ms, con los botones CSV, JSON y Descargar CSV.*

### Esquema

La pestaña **Esquema** lista las tablas y vistas (agrupadas por esquema donde el motor lo permite) con un buscador. Al elegir una ves sus columnas: tipo, si admite nulo, llave y valor por defecto. **Ver las primeras filas** escribe en el editor un `SELECT ... LIMIT 100` (`TOP 100` en SQL Server) con las comillas propias del motor, y **Copiar nombre** copia el nombre de la tabla.

![Pestaña Esquema con las tablas customers, orders y products, y las columnas de orders](img/db-esquema.jpg)

*Esquema de la base. A la izquierda están las tablas customers, orders y products; a la derecha, las columnas de orders con su tipo, nulo, llave (PRI) y valor por defecto. Arriba a la derecha, el botón Ver las primeras filas.*

### Historial

La pestaña **Historial** muestra tus **Consultas guardadas** y las **Consultas recientes** (las últimas 200, con la hora, las filas y lo que tardaron). Un clic en una consulta la trae al editor. **Borrar historial** limpia las recientes.

![Pestaña Historial con consultas guardadas vacías y una consulta reciente de 20 filas](img/db-historial.jpg)

*El historial de la base. Todavía no hay consultas guardadas; en Consultas recientes aparece la que ejecutaste, con "20 filas, 60 ms". Arriba a la derecha está Borrar historial.*

> **Nota:** los agentes ven la base en `object_list` (con su estado), pero todavía no tienen una herramienta para consultarla.

## Clúster

Un clúster agrupa servidores y contenedores Docker **de la misma colonia** (no otros clústeres ni peticiones HTTP). Sirve para iniciar y detener el entorno completo de una vez.

### Crear y manejar

1. Crea un recurso de tipo **Clúster**.
2. En **Recursos que agrupa**, elige los servidores y contenedores.
3. En la pestaña **Resumen**, ordena los miembros con las flechas de subir y bajar: ese es el **orden de inicio**.

La cabecera ofrece **Iniciar todo**, **Detener todo** y **Reiniciar todo**. Iniciar todo arranca los miembros en el orden listado, saltando los que ya están arriba; detener todo los detiene en el orden contrario. Si uno falla, hive-am intenta con los demás y te informa de todos los fallos juntos.

![Resumen del clúster Entorno de la tienda con dos miembros ordenados, estado 2/2 corriendo y logs unificados](img/recurso-cluster.jpg)

*Resumen del clúster "Entorno de la tienda". La tabla Miembros muestra el orden de inicio (API de la tienda primero, Redis del carrito después), su estado, CPU y memoria, y los botones de cada miembro. Abajo, la última salida con el nombre del miembro entre corchetes.*

El estado del clúster sale de sus miembros: **Corriendo** si todos lo están, **Iniciando** mientras uno arranca, **Error** si uno falló o solo algunos están arriba, y **Detenido** si ninguno lo está.

Los **Logs** del clúster juntan los de todos los miembros, con un color y una etiqueta por miembro (puedes ocultar a alguno). Eliminar un clúster deja a sus miembros como estaban.

## Agentes que cuidan recursos

Un agente con la skill **Colony resources** recibe tres herramientas:

- `object_list`: ver los recursos y su estado.
- `object_logs`: leer los logs de un recurso.
- `object_action`: iniciar, detener o reiniciar un recurso.

Son las únicas herramientas. Un agente **no puede crear, editar ni eliminar** recursos, ni cambiar el comando que corren: eso queda para las personas. Además, la skill no solo es una instrucción: el servidor aplica las reglas.

- Un agente ve solo los recursos de **su propia colonia**.
- Un agente de **solo lectura** puede listar y leer logs, pero no iniciar, detener ni reiniciar.
- Cada acción queda escrita en el log del servidor, para saber quién hizo qué.

### Agentes y bases de datos

Para que un agente use una **base de datos**, dale la skill **Database management** (elegirlo como administrador de una base de datos le da la skill). Entonces puede mirar la estructura (tablas, columnas, claves, índices), ejecutar SQL, guardar consultas, leer el historial y, con el permiso adecuado, cambiar los datos. Lo que puede hacer depende de su permiso:

- **Solo lectura:** mirar y leer. Nada de lo que escriba llega a la base de datos.
- **Editar archivos:** además insertar, actualizar, borrar, crear y alterar, ejecutar un script de varias sentencias como una transacción (todo o nada), guardar consultas, exportar un resultado a un archivo en su propia carpeta y ver quién está conectado. No puede hacer `DROP` ni `TRUNCATE`.
- **Acceso total:** además `DROP` y `TRUNCATE`, cambiar cómo se conecta el recurso, crear y eliminar recursos de base de datos y cancelar lo que ejecuta otra sesión.

El interruptor de **solo lectura** del recurso es para ti, en su panel: no frena a un agente. Lo que decide es el permiso del agente, así que en una base de datos que importa, dale al agente un usuario de la base con permisos limitados. Una contraseña que un agente fija se guarda y no se vuelve a mostrar, y ninguna respuesta, entrada del historial ni log la contiene. Cada consulta que ejecuta un agente aparece en la pestaña **Historial** con el nombre del agente. Más en la referencia, [sección 15.12](../../reference/es/15-recursos-de-la-colonia.md#1512-agentes-que-usan-una-base-de-datos).

### Elegir un agente administrador

Un servidor, un contenedor Docker, un clúster o una base de datos puede tener **un agente administrador**. Con uno elegido, solo ese agente ve el recurso y puede actuar sobre él, aunque sea de otra colonia. Sin ninguno, lo cuidan los agentes de su colonia que tengan la skill.

Puedes elegirlo de tres maneras:

1. En el formulario del recurso (al crear o editar), en **Agente administrador**: busca un agente.
2. En la tarjeta del recurso en el mapa de la Colonia, con **Agregar agente administrador**.
3. Desde el formulario de un agente, en **Recursos que cuida** (admite varios).

Elegir un agente que no tiene la skill se la da. Elegir un recurso que ya cuida otro agente se lo quita a ese.

También puedes crear un agente nuevo ya preparado: elige el recurso en el mapa y pulsa **Crear un agente administrador** en su tarjeta.

## La tarjeta del recurso en la colonia

En el mapa de la Colonia, cada recurso es un hexágono. Al pulsarlo aparece una tarjeta con su estado, su comando, las acciones y los logs recientes.

![Mapa de la colonia con la tarjeta del servidor API de la tienda abierta: estado, comando, botones Iniciar, Detener y Reiniciar, logs y la sección Quién lo cuida](img/colonia-tarjeta-recurso.jpg)

*La tarjeta de "API de la tienda" sobre el mapa. Arriba están el estado y el botón Abrir panel; después el comando, Iniciar, Detener y Reiniciar, Terminal aquí y Logs en el panel. Abajo, Quién lo cuida con Crear un agente administrador y Agregar agente administrador. En el mapa, una línea punteada une al servidor con su clúster.*

Pulsa **Abrir panel** para ir a la pantalla completa del recurso. El lápiz de la tarjeta abre su configuración. Un clúster se une a sus miembros con líneas punteadas.

Siguiente: [Explorador de cambios (git)](11-explorador-de-cambios-git.md)
