# Permisos y seguridad

hive-am es una herramienta local para una sola persona. Los agentes ejecutan CLIs de código en tu máquina, así que conviene saber qué pueden hacer, qué protege hive-am y qué te toca cuidar a ti. Este capítulo explica los niveles de permisos, la herencia desde la colonia, qué puede alcanzar quién, y dónde se guardan tus datos y secretos.

## Los tres niveles de permisos

Cada agente tiene un permiso. Se elige en el formulario del agente, en el campo **¿Qué puede hacer?**.

| Nivel | Descripción en la interfaz |
|---|---|
| **Solo lectura** | Planifica y lee; nunca edita archivos ni ejecuta comandos |
| **Editar archivos** | Edita archivos libremente; las demás acciones de riesgo siguen las reglas del propio CLI |
| **Acceso total** | Ejecuta cualquier cosa sin preguntar. Úsalo en carpetas desechables |

Un agente no es interactivo: si una acción necesita aprobación, no puede pedírtela. Por eso el nivel determina qué se hace y qué falla.

![Pestaña Configuración de un agente, donde se elige el nivel de permisos y el resto del formulario](img/agente-ajustes-configuracion.jpg)

*Ajustes de Reina, pestaña **Configuración**. El campo de permisos está en el formulario, más abajo que el proveedor (desplázate dentro del panel). Si el agente hereda los permisos de su colonia, en su lugar verás la fila **Siguiendo**.*

## Qué significa cada nivel en cada proveedor

Los tres niveles se aplican en los tres proveedores, pero cada CLI lo implementa a su manera.

| Nivel | Claude Code | OpenCode | Kiro |
|---|---|---|---|
| **Solo lectura** | Modo de planificación de Claude | Se deniegan editar, comandos y tareas | Ninguna herramienta de confianza |
| **Editar archivos** | Edita archivos, sin tocar `.git` ni claves. Deja pasar los comandos de archivos (`touch`, `mv`...). Otros comandos de shell no se aprueban y fallan | Edita (incluido `.env`), sin comandos, sin `.git` ni claves, solo dentro de su carpeta | Igual que OpenCode |
| **Acceso total** | Sin restricciones | Sin restricciones | Todas las herramientas de confianza |

> **Nota:** en **Solo lectura**, Claude Code bloquea también las herramientas de hive (delegar, cuaderno, skills a demanda). Las skills a demanda se incluyen completas en las instrucciones en ese caso.

## Qué protege el nivel Editar archivos

Con **Editar archivos**, los tres proveedores:

- No pueden editar `.git`.
- No pueden editar claves privadas (archivos `*.pem` y `*.key`).
- No pueden salir de la carpeta del agente.
- Sí pueden editar `.env`.

OpenCode y Kiro bloquean todos los comandos de shell en este nivel. Claude solo permite los de archivos.

> **Consejo:** si quieres que un agente corra pruebas o instale dependencias, necesita **Acceso total** (en Claude, algunos comandos pasan en **Editar archivos**, pero no cuentes con ello). Dale ese nivel solo en un proyecto que puedas recuperar con git.

La carpeta de trabajo del agente es su límite. En OpenCode, la única excepción es el buzón de adjuntos (`~/.hive-am/inbox/`).

## Herencia de permisos desde la colonia

Una colonia puede prestar sus permisos a sus agentes. Cuando guardas una colonia, hive-am pregunta "¿Qué deben heredar sus agentes?" y puedes marcar **Permisos**. Entonces:

- El permiso de la colonia reemplaza al del agente.
- En el formulario del agente verás la fila **Permisos de** *colonia* con la marca **Siguiendo**. Haz clic para pasarla a **Valor propio** y definir un permiso solo para ese agente.
- La carpeta, el contexto y las skills se heredan de forma distinta. Ver [La colonia](02-la-colonia.md).

Los permisos son uno de los campos que se heredan. El proveedor y el modelo nunca se heredan.

## Agentes con conexiones externas

Un agente vinculado a Telegram o Slack no puede estar en **Solo lectura**: un agente de solo lectura no puede responder por un canal. En el formulario, esa opción aparece bloqueada ("No disponible mientras el agente esté vinculado a una conexión").

Además, quien puede hablarle por el canal controla lo que el agente hace con sus permisos:

- Con **Acceso total**, cualquiera de la lista de personas autorizadas puede hacer que ejecute lo que sea en tu máquina.
- Autorizar un grupo da ese acceso a todos sus miembros, también a quien entre después. Para tener un grupo con **Acceso total**, elige **Solo estas personas** bajo él y lista quién puede hablar ahí: entonces solo entra esa lista, ni siquiera las personas de **Personas (mensajes directos)** salvo que también las añadas, y una lista vacía no admite a nadie. Un grupo que no listas en absoluto sigue dejando entrar a las personas de **Personas (mensajes directos)**.
- OpenCode ignora el ajuste de permisos en estos casos, y puede editar archivos y ejecutar comandos diga lo que diga la configuración. La pantalla de la conexión lo avisa.

Ver [Conexiones](09-conexiones-telegram.md).

## Quién puede llegar a hive-am

- **El servidor solo escucha en `127.0.0.1`.** Otras máquinas de tu red no llegan a él. La web usa el puerto 4401 y el servidor 4400.
- **No hay inicio de sesión.** Cualquiera que pueda abrir hive-am desde esta máquina puede crear agentes y hablarles. Confía en tu propia sesión de usuario.
- Las páginas web que abras en tu navegador podrían intentar hablar con el servidor local. Mientras hive-am esté en marcha, evita navegar sitios que no sean de confianza.
- La interfaz web de Next puede mostrar una dirección de red local. Por eso las acciones más delicadas (siguiente sección) se rechazan si no vienen de la propia app.

## Qué solo se puede hacer desde esta máquina

Algunas acciones ejecutan comandos reales, así que hive-am las rechaza si la petición no viene de la app local:

- **Recursos:** crear, cambiar, eliminar y actuar sobre servidores, contenedores y clústeres. Ver [Recursos](10-recursos.md). Ejecutar peticiones de un recurso HTTP y consultar una base de datos también (usan la contraseña guardada).
- **Terminales:** son tu propio shell. Solo se abren si el servidor se alcanzó por un nombre local (`localhost`, `127.0.0.1` o `[::1]`). Abrir hive-am por una dirección de red local no da terminales. Los agentes no tienen herramienta para abrir ni usar terminales. Ver [Terminales](12-terminales.md).
- **Acciones de git:** commit, pull, push y ramas. Nunca fuerzan ni se saltan los *hooks*, y se limitan a la carpeta del agente. Ver [Explorador de cambios](11-explorador-de-cambios-git.md).

## Dónde se guardan tus datos

Todo vive en tu carpeta personal, en `~/.hive-am/`:

- `hive-am.db`: la base de datos con agentes, colonias, tipos, skills, conexiones y los cuadernos.
- `inbox/`: los archivos que recibe un agente, por el chat o por un canal. Se conservan 14 días, con un máximo de 20 MB cada uno, y nunca se ejecutan.

Puedes cambiar la carpeta con la variable de entorno `HIVE_AM_HOME`.

Las conversaciones no están ahí: las guarda cada CLI en su propio almacén (por ejemplo `~/.claude`). Ver [Sesiones](07-sesiones.md).

Lo que hive-am guarda de su propio registro no crece para siempre. Cada seis horas olvida los mensajes de una conversación de canal que pasen de los 500 más nuevos cuando tengan 30 días, las delegaciones que pasen de las 200 más nuevas, las conversaciones delegadas de un agente que pasen de las 50 más nuevas cuando lleven 90 días sin usarse, y las conversaciones de la lista que la CLI ya no tiene cuando lleven 90 días sin usarse (la que un agente usa ahora nunca se olvida). Solo se recorta la lista propia de hive-am: las conversaciones en sí, en cada CLI, nunca se tocan.

> **Nota:** la base de datos contiene tus prompts, skills y los cuadernos de los agentes en texto plano. El cuaderno rechaza las notas con credenciales.

## Dónde van los secretos

- **Los CLI usan su propia sesión.** hive-am no guarda tus inicios de sesión de Claude, OpenCode ni Kiro.
- **Token del bot:** la única credencial que guarda hive-am es el token del bot de cada conexión externa, en `hive-am.db`. La API nunca lo devuelve: la interfaz solo muestra una pista (como `••••1234`). Al editar la conexión, si dejas el campo vacío se conserva el guardado.
- **Contraseñas de bases de datos:** las de los recursos de tipo base de datos se guardan localmente y no se devuelven por la API. Solo las usan las acciones locales descritas arriba.
- **Los tokens no llegan al agente:** cuando un agente responde por un canal, es el servidor quien envía el mensaje.

> **Importante:** un agente con acceso a archivos podría leer `hive-am.db`, donde está el token del bot. Las instrucciones le dicen que no lo busque, y el servidor revisa lo que se envía por un canal para bloquear secretos conocidos, pero eso no sustituye a un nivel de permisos prudente.

## Recomendaciones prácticas

1. Empieza con **Editar archivos** y sube a **Acceso total** solo en carpetas desechables o respaldadas con git.
2. Usa **Solo lectura** para agentes que revisan código o hacen consultas.
3. Dale a cada agente una carpeta propia y acotada, no tu carpeta personal.
4. Revisa los cambios con la pestaña **Cambios** antes de hacer commit.
5. Con conexiones, autoriza solo a personas y grupos de confianza, y limita los grupos compartidos a **Solo estas personas**.
6. No pongas contraseñas ni tokens en prompts, skills ni cuadernos.
7. No expongas el puerto de hive-am a la red (por ejemplo con un túnel) mientras no haya inicio de sesión.
8. Haz copia de `~/.hive-am/` si tu configuración te importa.

Siguiente: [Problemas frecuentes](14-problemas-frecuentes.md)
